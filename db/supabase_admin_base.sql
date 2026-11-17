-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Base do admin: registro das ações (admin_audit_log), fila de            ║
-- ║  pendências e as conferências que o admin faz no banco.                  ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_admin_papel.sql, db/supabase_cota_mensal.sql e              ║
-- ║  db/supabase_assinaturas.sql (ordem do lançamento, D6).                  ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano do admin central, D7, D8 e Rulings ADM-B2 e P2):
-- * Cada ação do admin fica no registro: quem (id e e-mail), quando, o quê
--   (ação e alvo), antes, depois e resultado.
-- * Ação só no banco: a própria função admin_* grava o registro na mesma
--   transação (sem registro, nada muda). Ação com o Asaas: o servidor grava
--   "pendente" antes (admin_log_start) e o resultado depois (admin_log_finish).
-- * O registro só aceita inserir e fechar o pendente uma vez. Apagar, truncar e
--   reescrever são recusados pelo banco, para qualquer papel.
-- * admin_id e target_user_id ficam SEM chave estrangeira, com os e-mails
--   copiados na hora (ADM-B2): excluir a conta de quem aparece no registro, ou
--   de um admin, nunca esbarra nele. O e-mail do alvo fica no registro depois
--   da exclusão da conta (guarda, como na cobrança).
-- * A fila de pendências junta o que precisa do admin: pendências com o Asaas,
--   assinaturas marcadas pra conferir e avisos do Asaas parados. A conferência
--   diária (api/_lib/reconcile.ts) grava só por billing_flag_review e por
--   billing_enqueue_action(..., 'admin_review', ..., p_auto_retry => false),
--   inclusive o caso da conferência parcial do dia (ref conferencia:parcial:<dia>,
--   sem conta): tudo isso aparece aqui (P2).
-- * Só o backend (service_role) chama as funções. As que recebem p_admin
--   recusam com 42501 quem não é admin (public.is_admin_user).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Registro das ações do admin ─────────────────────────────────────────
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  admin_id       uuid,                -- sem chave estrangeira (ADM-B2): excluir a conta nunca esbarra no registro
  admin_email    text not null,       -- copiado na hora
  action         text not null check (action in ('resolve_flag','close_action','retry_action','retry_event','change_plan',
                   'grant_courtesy','end_courtesy','cancel_subscription','block','unblock','adjust_quota')),
  target_user_id uuid,                -- sem chave estrangeira (ADM-B2)
  target_email   text,                -- copiado na hora; fica depois da exclusão da conta
  target_ref     text,
  before         jsonb,
  after          jsonb,
  result         text not null check (result in ('pending','ok','failed','partial')),
  message        text,
  note           text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated;

-- ─── 2. Gatilho: só inserir e fechar o pendente ─────────────────────────────
-- Vale pra todo papel, inclusive o backend e o SQL Editor. Fechar = o pendente
-- vira ok, failed ou partial, e só mudam o resultado, o depois, a mensagem e a
-- hora do fim. A mesma função barra o TRUNCATE (gatilho de comando).
create or replace function public.admin_audit_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'o registro das ações do admin não pode ser apagado' using errcode = '42501';
  end if;
  if old.result <> 'pending' then
    raise exception 'registro já fechado não muda' using errcode = '42501';
  end if;
  if coalesce(new.result, '') not in ('ok', 'failed', 'partial') then
    raise exception 'registro pendente só fecha como ok, failed ou partial' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['result', 'after', 'message', 'finished_at'])
       is distinct from (to_jsonb(old) - array['result', 'after', 'message', 'finished_at']) then
    raise exception 'ao fechar o registro só mudam o resultado, o depois, a mensagem e a hora do fim'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.admin_audit_append_only() from public, anon, authenticated;

drop trigger if exists admin_audit_append_only on public.admin_audit_log;
create trigger admin_audit_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_append_only();

drop trigger if exists admin_audit_no_truncate on public.admin_audit_log;
create trigger admin_audit_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_append_only();

-- ─── 3. Gravar no registro ──────────────────────────────────────────────────
-- Interna: só as outras funções admin_* chamam, na mesma transação da ação
-- (rodam como o dono, então passam pelo revoke). Os e-mails vêm de auth.users
-- na hora; admin sem e-mail no login fica como 'sem dado'.
create or replace function public.admin_audit_insert(
  p_admin uuid,
  p_action text,
  p_target_user uuid,
  p_target_ref text,
  p_before jsonb,
  p_after jsonb,
  p_result text,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  insert into public.admin_audit_log
    (admin_id, admin_email, action, target_user_id, target_email, target_ref,
     before, after, result, note, finished_at)
  values
    (p_admin,
     coalesce((select u.email from auth.users u where u.id = p_admin), 'sem dado'),
     p_action,
     p_target_user,
     (select u.email from auth.users u where u.id = p_target_user),
     p_target_ref,
     p_before,
     p_after,
     p_result,
     p_note,
     case when p_result = 'pending' then null else now() end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.admin_audit_insert(uuid, text, uuid, text, jsonb, jsonb, text, text)
  from public, anon, authenticated, service_role;

-- Ação com o Asaas, passo 1: grava "pendente" antes de qualquer chamada.
create or replace function public.admin_log_start(
  p_admin uuid,
  p_action text,
  p_target_user uuid,
  p_target_ref text,
  p_before jsonb,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  return public.admin_audit_insert(p_admin, p_action, p_target_user, p_target_ref, p_before, null, 'pending', p_note);
end;
$$;

-- Ação com o Asaas, passo 2: fecha o pendente com o resultado. Fecha uma vez
-- só: o gatilho recusa fechar de novo (42501). Registro que não existe: P0002.
create or replace function public.admin_log_finish(p_id bigint, p_result text, p_after jsonb, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.admin_audit_log
     set result = p_result, after = p_after, message = p_message, finished_at = now()
   where id = p_id;
  if not found then
    raise exception 'registro % não existe', p_id using errcode = 'P0002';
  end if;
end;
$$;

-- ─── 4. Fila de pendências (formato ReviewQueue do plano) ───────────────────
-- actions: pendências abertas, manuais (sem nova tentativa) primeiro e depois
--          pela data; e-mail da conta e plano da assinatura (nulos no caso da
--          conferência parcial do dia, que não tem conta nem assinatura).
-- flags:   assinaturas marcadas pra conferir, mais recentes primeiro.
-- events:  avisos do Asaas com falha, esgotados ou pendentes há mais de 10
--          minutos; os 100 mais recentes.
-- counts:  manual = ações sem nova tentativa + marcações + avisos esgotados;
--          auto = ações com nova tentativa + avisos pendentes ou com falha.
--          Contam tudo, inclusive os avisos além dos 100 da lista.
create or replace function public.admin_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actions      jsonb;
  v_flags        jsonb;
  v_events       jsonb;
  v_manual_acts  integer;
  v_auto_acts    integer;
  v_flag_count   integer;
  v_exhausted    integer;
  v_retrying     integer;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'action', a.action,
           'reason', a.reason,
           'autoRetry', a.auto_retry,
           'attempts', a.attempts,
           'lastError', a.last_error,
           'nextAttemptAt', a.next_attempt_at,
           'createdAt', a.created_at,
           'subscriptionRef', a.subscription_ref,
           'asaasSubscriptionId', coalesce(a.asaas_subscription_id, s.asaas_subscription_id),
           'paymentId', a.asaas_payment_id,
           'dueDate', a.due_date,
           'amount', a.amount,
           'userId', coalesce(a.user_id, s.user_id),
           'email', u.email,
           'planKey', s.plan_key
         ) order by a.auto_retry, a.created_at, a.id), '[]'::jsonb),
         count(*) filter (where not a.auto_retry),
         count(*) filter (where a.auto_retry)
    into v_actions, v_manual_acts, v_auto_acts
    from public.billing_pending_actions a
    left join public.billing_subscriptions s on s.id = a.subscription_ref
    left join auth.users u on u.id = coalesce(a.user_id, s.user_id)
   where a.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
           'subscriptionRef', s.id,
           'userId', s.user_id,
           'email', u.email,
           'planKey', s.plan_key,
           'kind', s.kind,
           'status', s.status,
           'cancelSource', s.cancel_source,
           'adminNote', s.admin_note,
           'updatedAt', s.updated_at
         ) order by s.updated_at desc, s.id), '[]'::jsonb),
         count(*)
    into v_flags, v_flag_count
    from public.billing_subscriptions s
    left join auth.users u on u.id = s.user_id
   where s.needs_admin_review;

  select count(*) filter (where e.status = 'exhausted'),
         count(*) filter (where e.status in ('pending', 'failed'))
    into v_exhausted, v_retrying
    from public.asaas_webhook_events e
   where e.status in ('failed', 'exhausted')
      or (e.status = 'pending' and e.received_at < now() - interval '10 minutes');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'event', e.event,
           'status', e.status,
           'attempts', e.attempts,
           'lastError', e.last_error,
           'receivedAt', e.received_at
         ) order by e.received_at desc, e.id), '[]'::jsonb)
    into v_events
    from (select * from public.asaas_webhook_events e
           where e.status in ('failed', 'exhausted')
              or (e.status = 'pending' and e.received_at < now() - interval '10 minutes')
           order by e.received_at desc, e.id
           limit 100) e;

  return jsonb_build_object(
    'actions', v_actions,
    'flags', v_flags,
    'events', v_events,
    'counts', jsonb_build_object(
      'manual', v_manual_acts + v_flag_count + v_exhausted,
      'auto', v_auto_acts + v_retrying,
      'total', v_manual_acts + v_flag_count + v_exhausted + v_auto_acts + v_retrying),
    'generatedAt', now());
end;
$$;

-- ─── 5. Conferir uma marcação ───────────────────────────────────────────────
-- not_found, not_flagged (sem novo registro) ou resolved: tira a marcação,
-- acrescenta a nota ao admin_note e grava o registro, tudo na mesma transação.
-- Uma marcação nova (billing_flag_review) põe a assinatura de volta na fila.
create or replace function public.admin_resolve_flag(p_admin uuid, p_subscription_ref text, p_note text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.billing_subscriptions%rowtype;
  v_note text;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  select * into r from public.billing_subscriptions where id = p_subscription_ref for update;
  if not found then
    return 'not_found';
  end if;
  if not r.needs_admin_review then
    return 'not_flagged';
  end if;
  v_note := concat_ws(' | ', nullif(r.admin_note, ''),
    'conferido pelo admin em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
      || ': ' || coalesce(p_note, ''));
  update public.billing_subscriptions
     set needs_admin_review = false,
         admin_note         = v_note,
         updated_at         = now()
   where id = r.id;
  perform public.admin_audit_insert(p_admin, 'resolve_flag', r.user_id, r.id,
    jsonb_build_object('needsAdminReview', true, 'adminNote', r.admin_note),
    jsonb_build_object('needsAdminReview', false, 'adminNote', v_note),
    'ok', p_note);
  return 'resolved';
end;
$$;

-- ─── 6. Fechar uma pendência à mão ──────────────────────────────────────────
-- not_open (não está aberta ou não existe); not_allowed pra inativar e remover
-- assinatura (só fecham quando o Asaas confirma) e pra descartar (canceled)
-- qualquer ação fora de estorno e caso pra olhar (M10); senão closed, com o
-- registro na mesma transação. O servidor confere no Asaas antes de chamar (D8).
create or replace function public.admin_close_action(p_admin uuid, p_action_id bigint, p_outcome text, p_note text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a      public.billing_pending_actions%rowtype;
  v_note text := 'admin: ' || coalesce(p_note, '');
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'canceled') then
    raise exception 'resultado inválido: use done ou canceled' using errcode = '22023';
  end if;
  select * into a from public.billing_pending_actions where id = p_action_id for update;
  if not found or a.status <> 'pending' then
    return 'not_open';
  end if;
  if a.action in ('delete_subscription', 'inactivate_subscription') then
    return 'not_allowed';
  end if;
  if p_outcome = 'canceled' and a.action not in ('refund_payment', 'admin_review') then
    return 'not_allowed';
  end if;
  update public.billing_pending_actions
     set status    = p_outcome,
         done_at   = now(),
         done_note = v_note
   where id = a.id;
  perform public.admin_audit_insert(p_admin, 'close_action', a.user_id, a.id::text,
    jsonb_build_object('action', a.action, 'status', a.status, 'subscriptionRef', a.subscription_ref,
                       'paymentId', a.asaas_payment_id, 'dueDate', a.due_date, 'amount', a.amount,
                       'attempts', a.attempts, 'lastError', a.last_error),
    jsonb_build_object('status', p_outcome, 'doneAt', now(), 'doneNote', v_note),
    'ok', p_note);
  return 'closed';
end;
$$;

-- ─── 7. Reiniciar um aviso do Asaas ─────────────────────────────────────────
-- not_found, already_done ou reset (volta pra 'failed' com as tentativas
-- zeradas). O servidor grava o registro retry_event em volta (admin_log_start).
create or replace function public.admin_reset_event(p_admin uuid, p_event_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  select status into v_status from public.asaas_webhook_events where id = p_event_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_status = 'done' then
    return 'already_done';
  end if;
  update public.asaas_webhook_events
     set status = 'failed', attempts = 0, last_error = 'reiniciado pelo admin'
   where id = p_event_id;
  return 'reset';
end;
$$;

-- ─── 8. Lista do registro (formato { total, rows: AuditEntry[] }) ───────────
-- Mais novos primeiro. p_target filtra pela conta alvo. Página de 1 a 200 linhas.
create or replace function public.admin_audit_list(p_limit int, p_offset int, p_target uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_rows   jsonb;
begin
  select count(*) into v_total
    from public.admin_audit_log l
   where p_target is null or l.target_user_id = p_target;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'createdAt', l.created_at,
           'finishedAt', l.finished_at,
           'adminEmail', l.admin_email,
           'action', l.action,
           'targetUserId', l.target_user_id,
           'targetEmail', l.target_email,
           'targetRef', l.target_ref,
           'result', l.result,
           'message', l.message,
           'note', l.note,
           'before', l.before,
           'after', l.after
         ) order by l.created_at desc, l.id desc), '[]'::jsonb)
    into v_rows
    from (select * from public.admin_audit_log l
           where p_target is null or l.target_user_id = p_target
           order by l.created_at desc, l.id desc
           limit v_limit offset v_offset) l;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- ─── 9. Só o backend executa ────────────────────────────────────────────────
revoke execute on function public.admin_log_start(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant  execute on function public.admin_log_start(uuid, text, uuid, text, jsonb, text) to service_role;
revoke execute on function public.admin_log_finish(bigint, text, jsonb, text) from public, anon, authenticated;
grant  execute on function public.admin_log_finish(bigint, text, jsonb, text) to service_role;
revoke execute on function public.admin_review_queue() from public, anon, authenticated;
grant  execute on function public.admin_review_queue() to service_role;
revoke execute on function public.admin_resolve_flag(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.admin_resolve_flag(uuid, text, text) to service_role;
revoke execute on function public.admin_close_action(uuid, bigint, text, text) from public, anon, authenticated;
grant  execute on function public.admin_close_action(uuid, bigint, text, text) to service_role;
revoke execute on function public.admin_reset_event(uuid, text) from public, anon, authenticated;
grant  execute on function public.admin_reset_event(uuid, text) to service_role;
revoke execute on function public.admin_audit_list(int, int, uuid) from public, anon, authenticated;
grant  execute on function public.admin_audit_list(int, int, uuid) to service_role;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 1 linha: a tabela, com RLS ligada (relrowsecurity = true).
select relname, relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass;
-- Espera 2 linhas: admin_audit_append_only e admin_audit_no_truncate.
select tgname from pg_trigger where tgrelid = 'public.admin_audit_log'::regclass and not tgisinternal order by tgname;
-- Espera 8 linhas: as 7 funções do backend com backend = true e a interna
-- admin_audit_insert com backend = false.
select p.proname, has_function_privilege('service_role', p.oid, 'execute') as backend
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('admin_audit_insert', 'admin_log_start', 'admin_log_finish', 'admin_review_queue',
                     'admin_resolve_flag', 'admin_close_action', 'admin_reset_event', 'admin_audit_list')
 order by p.proname;
-- Espera 0 linhas: nenhuma admin_* que anon ou authenticated executem.
select p.proname
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname like 'admin\_%'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
