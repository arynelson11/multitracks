-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Assinaturas: cancelamento, inadimplência, estorno, cortesia e histórico  ║
-- ║  completo de pagamentos do Asaas.                                         ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                         ║
-- ║  db/supabase_cota_mensal.sql e ANTES do deploy do código.                 ║
-- ║  Idempotente: rodar de novo não muda nada.                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (decididas pelo dono em 2026-11-16, ver PLAYBACK_STUDIO_FATOS.md):
-- * Cancelamento pelo botão: continua com o plano até o fim do período já
--   pago e depois volta pro Livre.
-- * Arrependimento em até 7 dias da primeira compra: estorna e volta pro Livre
--   na hora.
-- * Renovação não paga até o vencimento (PAYMENT_OVERDUE): no mesmo dia a
--   conta volta pro Livre e a assinatura é cancelada no Asaas. Sem carência.
--   Se o pagamento atrasado daquela cobrança chegar mesmo assim, o plano volta
--   até o fim daquele período e o caso fica marcado pro admin.
-- * Estorno do período atual: volta pro Livre na hora.
--
-- Como o plano vale: profiles.plan continua sendo o plano; profiles.plan_expires_at
-- (novo) diz até quando ele vale. Passou da data, o app e o servidor tratam como
-- Livre mesmo antes de alguém gravar 'free' (ver billing_expire_due_plans).
--
-- Quem escreve: só o backend (service_role). O usuário lê só algumas colunas
-- da PRÓPRIA assinatura (aba Assinatura e aviso de vencimento).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Até quando o plano vale ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

-- ─── 2. Vínculo checkout → usuário (já existe em produção, criado à mão) ────
-- Documenta o formato e garante RLS ligada (só o backend usa). A partir desta
-- versão o webhook NÃO apaga mais a linha no CHECKOUT_PAID: ela liga os eventos
-- de assinatura e de cobrança ao usuário.
create table if not exists public.pending_checkouts (
  id         text primary key,            -- id do checkout no Asaas
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_key   text not null,
  created_at timestamptz not null default now()
);
alter table public.pending_checkouts enable row level security;

-- ─── 3. Assinaturas (uma linha por checkout pago ou cortesia) ───────────────
create table if not exists public.billing_subscriptions (
  id                    text primary key,  -- id do checkout no Asaas, ou 'cortesia:<uuid>'
  kind                  text not null default 'asaas' check (kind in ('asaas', 'courtesy')),
  user_id               uuid not null references auth.users(id) on delete cascade,
  plan_key              text not null check (plan_key in ('essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual')),
  cycle                 text check (cycle in ('MONTHLY', 'YEARLY')),
  asaas_subscription_id text unique,
  asaas_customer_id     text,
  status                text not null default 'active' check (status in ('active', 'canceled')),
  started_at            timestamptz not null default now(),
  last_paid_due_date    date,              -- vencimento da última cobrança paga
  next_due_date         date,              -- próxima renovação (última paga + ciclo)
  paid_until            timestamptz,       -- fim do período pago (fim do dia do próximo vencimento, Brasília)
  access_until          timestamptz,       -- até quando o plano vale depois de cancelada
  cancel_source         text check (cancel_source in ('user', 'user_refund', 'unpaid', 'refund', 'asaas', 'superseded', 'admin')),
  canceled_at           timestamptz,
  asaas_deleted_at      timestamptz,       -- quando o Asaas confirmou a remoção da assinatura
  needs_admin_review    boolean not null default false,
  admin_note            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id, created_at desc);
create index if not exists billing_subscriptions_review_idx
  on public.billing_subscriptions (needs_admin_review) where needs_admin_review;

alter table public.billing_subscriptions enable row level security;
revoke all on table public.billing_subscriptions from anon, authenticated;
-- O usuário vê só estas colunas e só da própria linha.
grant select (id, kind, plan_key, cycle, status, started_at, next_due_date,
              paid_until, access_until, cancel_source, canceled_at, created_at)
  on public.billing_subscriptions to authenticated;
drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own
  on public.billing_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

-- ─── 4. Todos os pagamentos (renovações, vencidos, estornos) ────────────────
-- Uma linha por cobrança do Asaas, atualizada a cada evento. Valores como o
-- Asaas mandou (value = valor da cobrança; net_value = líquido depois da taxa).
-- Nunca guarda dados do cartão. user_id vira null se a conta for excluída
-- (o registro financeiro fica).
create table if not exists public.billing_payments (
  asaas_payment_id      text primary key,
  user_id               uuid references auth.users(id) on delete set null,
  subscription_ref      text,             -- billing_subscriptions.id
  asaas_subscription_id text,
  asaas_checkout_id     text,
  asaas_customer_id     text,
  status                text not null,
  billing_type          text,
  value                 numeric(12, 2),
  net_value             numeric(12, 2),
  original_value        numeric(12, 2),
  interest_value        numeric(12, 2),
  due_date              date,
  payment_date          date,
  confirmed_date        date,
  refunded_at           timestamptz,
  last_event            text not null,
  last_event_at         timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists billing_payments_user_idx on public.billing_payments (user_id, due_date desc);
create index if not exists billing_payments_sub_idx on public.billing_payments (asaas_subscription_id);
alter table public.billing_payments enable row level security;
revoke all on table public.billing_payments from anon, authenticated;

-- ─── 5. Eventos do webhook já recebidos (idempotência pelo id do evento) ────
create table if not exists public.asaas_webhook_events (
  id           text primary key,          -- "evt_..." do Asaas
  event        text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.asaas_webhook_events enable row level security;
revoke all on table public.asaas_webhook_events from anon, authenticated;

-- ─── 6. Datas do período pago ───────────────────────────────────────────────
create or replace function public.billing_cycle_interval(p_cycle text)
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_cycle = 'YEARLY' then interval '1 year' else interval '1 month' end;
$$;

-- Fim do período pago por uma cobrança com vencimento p_due_date: vale até o
-- fim do dia do vencimento seguinte, no horário de Brasília.
create or replace function public.billing_period_end(p_due_date date, p_cycle text)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (((p_due_date + public.billing_cycle_interval(p_cycle))::date + 1)::timestamp)
         at time zone 'America/Sao_Paulo';
$$;

-- ─── 7. Plano do perfil a partir das assinaturas ────────────────────────────
-- Regra única: vale a assinatura ativa mais recente; se não houver, a cancelada
-- que ainda tem acesso; se o usuário tem assinaturas mas nenhuma dá acesso,
-- Livre. Quem não tem nenhuma linha (plano antigo ou dado à mão) não é tocado.
create or replace function public.billing_sync_profile(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select s.plan_key, s.access_until
    into r
    from public.billing_subscriptions s
   where s.user_id = p_user_id
     and ((s.status = 'active' and (s.access_until is null or s.access_until > now()))
          or (s.status = 'canceled' and s.access_until > now()))
   order by (s.status = 'active') desc, s.created_at desc
   limit 1;

  if found then
    update public.profiles
       set plan = r.plan_key, plan_expires_at = r.access_until
     where id = p_user_id;
    return r.plan_key;
  end if;

  if exists (select 1 from public.billing_subscriptions where user_id = p_user_id) then
    update public.profiles set plan = 'free', plan_expires_at = null where id = p_user_id;
    return 'free';
  end if;

  return 'untracked';
end;
$$;

-- ─── 8. Vincular (ou criar) a assinatura de um checkout pago ────────────────
-- Nunca troca o dono de uma linha. p_paid_due_date = vencimento de uma
-- cobrança já paga (estende o período pago). p_activate = aplica no perfil.
create or replace function public.billing_upsert_subscription(
  p_id text,
  p_user_id uuid,
  p_plan_key text,
  p_cycle text,
  p_subscription_id text default null,
  p_customer_id text default null,
  p_paid_due_date date default null,
  p_activate boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  insert into public.billing_subscriptions as s
    (id, kind, user_id, plan_key, cycle, asaas_subscription_id, asaas_customer_id,
     last_paid_due_date, next_due_date, paid_until)
  values
    (p_id, 'asaas', p_user_id, p_plan_key, p_cycle, p_subscription_id, p_customer_id,
     p_paid_due_date,
     case when p_paid_due_date is not null then (p_paid_due_date + public.billing_cycle_interval(p_cycle))::date end,
     case when p_paid_due_date is not null then public.billing_period_end(p_paid_due_date, p_cycle) end)
  on conflict (id) do update
     set asaas_subscription_id = coalesce(s.asaas_subscription_id, excluded.asaas_subscription_id),
         asaas_customer_id     = coalesce(s.asaas_customer_id, excluded.asaas_customer_id),
         next_due_date         = case when excluded.last_paid_due_date > coalesce(s.last_paid_due_date, '-infinity'::date)
                                      then excluded.next_due_date else s.next_due_date end,
         last_paid_due_date    = greatest(s.last_paid_due_date, excluded.last_paid_due_date),
         paid_until            = greatest(s.paid_until, excluded.paid_until),
         updated_at            = now()
   where s.user_id = excluded.user_id
  returning s.user_id into v_owner;

  if v_owner is null then
    return 'owner_mismatch';
  end if;
  if p_activate then
    perform public.billing_sync_profile(p_user_id);
  end if;
  return 'ok';
exception
  when unique_violation then
    -- o id da assinatura já está ligado a OUTRO checkout: não mexe, avisa
    return 'subscription_conflict';
end;
$$;

-- ─── 9. Cobrança paga (PAYMENT_CONFIRMED / PAYMENT_RECEIVED) ────────────────
create or replace function public.billing_payment_confirmed(p_id text, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     public.billing_subscriptions%rowtype;
  v_end timestamptz;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if r.cycle is null or p_due_date is null then
    return jsonb_build_object('result', 'ignored');
  end if;

  v_end := public.billing_period_end(p_due_date, r.cycle);

  update public.billing_subscriptions
     set next_due_date      = case when p_due_date >= coalesce(last_paid_due_date, p_due_date)
                                   then (p_due_date + public.billing_cycle_interval(cycle))::date
                                   else next_due_date end,
         last_paid_due_date = greatest(last_paid_due_date, p_due_date),
         paid_until         = greatest(paid_until, v_end),
         updated_at         = now()
   where id = p_id;

  -- Pagamento que chegou depois do cancelamento (ex.: renovação paga atrasada
  -- depois do corte por falta de pagamento): o plano volta até o fim daquele
  -- período e o caso fica marcado pro admin. A assinatura continua cancelada.
  if r.status = 'canceled' and v_end > coalesce(r.access_until, '-infinity'::timestamptz) then
    update public.billing_subscriptions
       set access_until       = v_end,
           needs_admin_review = true,
           admin_note         = concat_ws(' | ', admin_note,
                                  'pagamento confirmado depois do cancelamento (' || coalesce(r.cancel_source, '?')
                                  || ', vencimento ' || to_char(p_due_date, 'DD/MM/YYYY') || '): plano devolvido ate '
                                  || to_char(v_end at time zone 'America/Sao_Paulo' - interval '1 second', 'DD/MM/YYYY'))
     where id = p_id;
    perform public.billing_sync_profile(r.user_id);
    return jsonb_build_object('result', 'late_after_cancel', 'access_until', v_end);
  end if;

  return jsonb_build_object('result', 'extended', 'paid_until', greatest(r.paid_until, v_end));
end;
$$;

-- ─── 10. Renovação não paga (PAYMENT_OVERDUE) ───────────────────────────────
-- Volta pro Livre agora e pede pro backend cancelar no Asaas.
create or replace function public.billing_payment_overdue(p_id text, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.billing_subscriptions%rowtype;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- evento velho: essa cobrança (ou uma mais nova) já foi paga
  if p_due_date is not null and r.last_paid_due_date is not null and r.last_paid_due_date >= p_due_date then
    return jsonb_build_object('result', 'ignored_paid');
  end if;

  if r.status = 'canceled' then
    return jsonb_build_object(
      'result', 'already_canceled',
      'needs_asaas_delete', (r.kind = 'asaas' and r.asaas_deleted_at is null and r.cancel_source <> 'asaas'),
      'subscription_id', r.asaas_subscription_id);
  end if;

  update public.billing_subscriptions
     set status        = 'canceled',
         cancel_source = 'unpaid',
         canceled_at   = now(),
         access_until  = now(),
         updated_at    = now()
   where id = p_id;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object(
    'result', 'canceled_unpaid',
    'needs_asaas_delete', (r.kind = 'asaas' and r.asaas_deleted_at is null),
    'subscription_id', r.asaas_subscription_id);
end;
$$;

-- ─── 11. Estorno (PAYMENT_REFUNDED) ─────────────────────────────────────────
-- Estorno do período atual: sem pagamento, sem plano pago. Volta pro Livre na
-- hora e pede pro backend cancelar a assinatura no Asaas (sem isso ela cobraria
-- de novo no mês seguinte). Estorno de um período antigo só fica registrado.
create or replace function public.billing_payment_refunded(p_id text, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.billing_subscriptions%rowtype;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if p_due_date is not null and r.last_paid_due_date is not null and p_due_date < r.last_paid_due_date then
    return jsonb_build_object('result', 'ignored_old_period');
  end if;

  update public.billing_subscriptions
     set status        = 'canceled',
         cancel_source = case when status = 'canceled' then cancel_source else 'refund' end,
         canceled_at   = coalesce(canceled_at, now()),
         paid_until    = least(coalesce(paid_until, now()), now()),
         access_until  = least(coalesce(access_until, now()), now()),
         updated_at    = now()
   where id = p_id;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object(
    'result', 'refunded',
    'needs_asaas_delete', (r.kind = 'asaas' and r.asaas_deleted_at is null
                           and coalesce(r.cancel_source, '') <> 'asaas'),
    'subscription_id', r.asaas_subscription_id);
end;
$$;

-- ─── 12. Encerrar uma assinatura (botão, painel do Asaas, troca, admin) ─────
-- p_immediate = true: perde o plano agora (arrependimento, troca, admin).
-- Senão, vale até o fim do período pago (o maior entre o guardado e o que o
-- backend acabou de confirmar no Asaas com p_paid_due_date).
create or replace function public.billing_end_subscription(
  p_id text,
  p_source text,
  p_paid_due_date date default null,
  p_immediate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        public.billing_subscriptions%rowtype;
  v_paid   timestamptz;
  v_access timestamptz;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if r.status = 'canceled' then
    -- já encerrada: só pode encurtar (ex.: arrependimento depois de cancelar)
    if p_immediate and coalesce(r.access_until, now()) > now() then
      update public.billing_subscriptions
         set access_until = now(), cancel_source = p_source, updated_at = now()
       where id = p_id;
      perform public.billing_sync_profile(r.user_id);
      r.access_until := now();
    end if;
    return jsonb_build_object(
      'result', 'already_canceled',
      'access_until', r.access_until,
      'needs_asaas_delete', (r.kind = 'asaas' and r.asaas_deleted_at is null and r.cancel_source <> 'asaas'),
      'subscription_id', r.asaas_subscription_id);
  end if;

  v_paid := case when p_paid_due_date is not null and r.cycle is not null
                 then public.billing_period_end(p_paid_due_date, r.cycle) end;
  v_access := case when p_immediate then now() else greatest(r.paid_until, v_paid) end;
  if v_access is null or v_access < now() then
    v_access := now();
  end if;

  update public.billing_subscriptions
     set status             = 'canceled',
         cancel_source      = p_source,
         canceled_at        = now(),
         access_until       = v_access,
         last_paid_due_date = greatest(last_paid_due_date, p_paid_due_date),
         paid_until         = greatest(paid_until, v_paid),
         asaas_deleted_at   = case when p_source = 'asaas' then coalesce(asaas_deleted_at, now()) else asaas_deleted_at end,
         updated_at         = now()
   where id = p_id;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object(
    'result', 'canceled',
    'access_until', v_access,
    'needs_asaas_delete', (r.kind = 'asaas' and r.asaas_deleted_at is null and p_source <> 'asaas'),
    'subscription_id', r.asaas_subscription_id);
end;
$$;

-- ─── 13. Pequenas marcações ─────────────────────────────────────────────────
create or replace function public.billing_mark_asaas_deleted(p_id text, p_subscription_id text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.billing_subscriptions
     set asaas_deleted_at      = coalesce(asaas_deleted_at, now()),
         asaas_subscription_id = coalesce(asaas_subscription_id, p_subscription_id),
         updated_at            = now()
   where id = p_id;
$$;

create or replace function public.billing_flag_review(p_id text, p_note text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.billing_subscriptions
     set needs_admin_review = true,
         admin_note = case when admin_note is not null and position(p_note in admin_note) > 0
                           then admin_note else concat_ws(' | ', admin_note, p_note) end,
         updated_at = now()
   where id = p_id;
$$;

-- ─── 14. Troca de plano (admin) e cortesia ──────────────────────────────────
create or replace function public.billing_change_plan(p_id text, p_plan_key text, p_cycle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.billing_subscriptions%rowtype;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('result', 'not_active');
  end if;
  update public.billing_subscriptions
     set plan_key = p_plan_key, cycle = coalesce(p_cycle, cycle), updated_at = now()
   where id = p_id;
  perform public.billing_sync_profile(r.user_id);
  return jsonb_build_object('result', 'changed', 'plan_key', p_plan_key);
end;
$$;

-- Cortesia: plano pago sem cobrança. p_until null = sem data pra acabar.
create or replace function public.billing_grant_courtesy(
  p_user_id uuid,
  p_plan_key text,
  p_until timestamptz default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := 'cortesia:' || gen_random_uuid()::text;
begin
  if p_until is not null and p_until <= now() then
    raise exception 'cortesia com fim no passado';
  end if;
  insert into public.billing_subscriptions (id, kind, user_id, plan_key, status, access_until, admin_note)
  values (v_id, 'courtesy', p_user_id, p_plan_key, 'active', p_until, p_note);
  perform public.billing_sync_profile(p_user_id);
  return v_id;
end;
$$;

-- ─── 15. Faxina opcional: grava 'free' em quem já passou do plan_expires_at ─
-- Não é obrigatória (app e servidor já tratam como Livre). Deixa o painel do
-- admin certo. Pode ser agendada com pg_cron (ver PLAYBACK_STUDIO_FATOS.md).
create or replace function public.billing_expire_due_plans()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update public.profiles
     set plan = 'free', plan_expires_at = null
   where plan_expires_at is not null
     and plan_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─── 16. Biblioteca em nuvem respeita o fim do plano ────────────────────────
create or replace function public.user_has_cloud_library()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    coalesce(
      (select p.plan in ('essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual')
              and (p.plan_expires_at is null or p.plan_expires_at > now())
         from public.profiles p
        where p.id = auth.uid()),
      false
    )
    or coalesce(auth.jwt() ->> 'email', '') = 'arynelson11@gmail.com';
$$;
revoke execute on function public.user_has_cloud_library() from public, anon;
grant  execute on function public.user_has_cloud_library() to authenticated;

-- ─── 17. Permissões: só o backend chama as funções de cobrança ──────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.billing_sync_profile(uuid)',
    'public.billing_upsert_subscription(text, uuid, text, text, text, text, date, boolean)',
    'public.billing_payment_confirmed(text, date)',
    'public.billing_payment_overdue(text, date)',
    'public.billing_payment_refunded(text, date)',
    'public.billing_end_subscription(text, text, date, boolean)',
    'public.billing_mark_asaas_deleted(text, text)',
    'public.billing_flag_review(text, text)',
    'public.billing_change_plan(text, text, text)',
    'public.billing_grant_courtesy(uuid, text, timestamptz, text)',
    'public.billing_expire_due_plans()'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

commit;

-- Verificação (só leitura)
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('billing_subscriptions', 'billing_payments', 'asaas_webhook_events', 'pending_checkouts')
 order by table_name;
