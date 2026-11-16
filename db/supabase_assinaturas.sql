-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Assinaturas: cancelamento, inadimplência, estorno, cortesia, pendências  ║
-- ║  com o Asaas, job diário e histórico completo de pagamentos.              ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                         ║
-- ║  db/supabase_cota_mensal.sql e ANTES do merge/deploy do código.           ║
-- ║  Idempotente: rodar de novo não muda nada.                                ║
-- ║  Liga a extensão pg_cron e agenda o job diário (OBRIGATÓRIO).             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (dono e coordenador, 2026-11-16; ver PLAYBACK_STUDIO_FATOS.md):
-- * Cancelamento pelo botão: plano até o fim do período já pago, depois Livre.
-- * Arrependimento em até 7 dias da primeira cobrança: estorno automático só
--   na PRIMEIRA assinatura da conta; nas seguintes vira pedido pro admin.
-- * Renovação vencida (PAYMENT_OVERDUE): Livre no mesmo dia e assinatura
--   INATIVADA no Asaas (não removida: a cobrança vencida continua pagável).
--   Paga depois do vencimento: plano até o fim daquele período + marca pro admin.
-- * A liquidação do cartão (PAYMENT_RECEIVED ~30 dias depois do CONFIRMED) é
--   a MESMA cobrança: nunca conta como pagamento atrasado.
-- * Estorno do período atual: Livre na hora e assinatura removida no Asaas.
-- * Tudo que precisa ser feito no Asaas e falha vira pendência
--   (billing_pending_actions), tentada de novo até dar certo; o admin vê a lista.
-- * Job diário (pg_cron): rebaixa quem passou do fim do período pago e, como
--   rede de segurança, trata como vencida a assinatura cuja próxima cobrança
--   passou de 1 dia sem pagamento confirmado.
--
-- Como o plano vale: profiles.plan + profiles.plan_expires_at (até quando vale).
-- Quem escreve: só o backend (service_role) e o job. O usuário lê só algumas
-- colunas da PRÓPRIA assinatura.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Até quando o plano vale ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

-- ─── 2. Vínculo checkout → usuário (já existe em produção, criado à mão) ────
-- O webhook NÃO apaga mais a linha no CHECKOUT_PAID: ela liga os eventos de
-- assinatura e de cobrança ao usuário.
create table if not exists public.pending_checkouts (
  id         text primary key,            -- id do checkout no Asaas
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_key   text not null,
  created_at timestamptz not null default now()
);
alter table public.pending_checkouts enable row level security;
-- true quando a pessoa confirmou "Trocar de plano?" na tela (Alterar Plano).
alter table public.pending_checkouts add column if not exists switch_confirmed boolean;
-- hora em que o checkout foi criado (decide entre planos diferentes pagos juntos)
alter table public.pending_checkouts add column if not exists created_at timestamptz default now();

-- ─── 3. Registro antigo de pagamentos fica depois da exclusão da conta ──────
-- (guarda fiscal): o vínculo com o usuário vira null em vez de apagar a linha.
do $$
declare
  c record;
begin
  if to_regclass('public.payments') is null then
    return;
  end if;
  alter table public.payments alter column user_id drop not null;
  for c in
    select con.conname, con.confdeltype
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.payments'::regclass
       and con.contype = 'f'
       and att.attname = 'user_id'
  loop
    if c.confdeltype <> 'n' then
      execute format('alter table public.payments drop constraint %I', c.conname);
    end if;
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payments'::regclass and contype = 'f' and confdeltype = 'n'
  ) then
    alter table public.payments
      add constraint payments_user_id_fkey foreign key (user_id)
      references auth.users(id) on delete set null;
  end if;
end;
$$;

-- ─── 4. Assinaturas (uma linha por checkout pago ou cortesia) ───────────────
-- user_id vira null se a conta for excluída: o histórico fica (guarda fiscal).
create table if not exists public.billing_subscriptions (
  id                    text primary key,  -- id do checkout no Asaas, ou 'cortesia:<uuid>'
  kind                  text not null default 'asaas' check (kind in ('asaas', 'courtesy')),
  user_id               uuid references auth.users(id) on delete set null,
  plan_key              text not null check (plan_key in ('essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual')),
  cycle                 text check (cycle in ('MONTHLY', 'YEARLY')),
  asaas_subscription_id text unique,
  asaas_customer_id     text,
  status                text not null default 'active' check (status in ('active', 'canceled')),
  started_at            timestamptz not null default now(),  -- início da assinatura (1º pagamento)
  first_paid_at         timestamptz,       -- 1º pagamento confirmado (null = ainda sem pagamento)
  checkout_created_at   timestamptz,       -- quando a pessoa abriu este checkout (intenção)
  checkout_paid_at      timestamptz,       -- hora exata do CHECKOUT_PAID (desempata duas compras pagas no mesmo dia)
  switch_confirmed      boolean not null default false,  -- veio do "Trocar de plano?" confirmado
  anchor_due_date       date,              -- 1º vencimento: base da recorrência (dia 31 continua 31)
  last_paid_due_date    date,              -- vencimento da última cobrança paga
  next_due_date         date,              -- próxima renovação (do Asaas quando conhecida)
  paid_until            timestamptz,       -- fim do período pago (fim do dia do próximo vencimento, Brasília)
  access_until          timestamptz,       -- até quando o plano vale depois de cancelada
  cancel_source         text check (cancel_source in ('user', 'user_refund', 'unpaid', 'refund', 'asaas', 'superseded', 'duplicate', 'admin', 'account_deleted')),
  canceled_at           timestamptz,
  asaas_stopped_at      timestamptz,       -- quando o Asaas confirmou que a recorrência parou
  asaas_stop_kind       text check (asaas_stop_kind in ('deleted', 'inactivated')),
  needs_admin_review    boolean not null default false,
  admin_note            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id, started_at desc);
create index if not exists billing_subscriptions_review_idx
  on public.billing_subscriptions (needs_admin_review) where needs_admin_review;
create index if not exists billing_subscriptions_due_idx
  on public.billing_subscriptions (next_due_date) where status = 'active' and kind = 'asaas';

alter table public.billing_subscriptions enable row level security;
revoke all on table public.billing_subscriptions from anon, authenticated;
grant select (id, kind, plan_key, cycle, status, started_at, next_due_date,
              paid_until, access_until, cancel_source, canceled_at, created_at)
  on public.billing_subscriptions to authenticated;
drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own
  on public.billing_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

-- ─── 5. Todos os pagamentos (renovações, vencidos, estornos) ────────────────
-- Uma linha por cobrança do Asaas, atualizada a cada evento (só por evento mais
-- novo). Valores como o Asaas mandou. Nunca guarda dados do cartão. user_id
-- vira null se a conta for excluída (o registro financeiro fica).
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
  due_date              date,              -- vencimento atual (muda se adiado no painel)
  original_due_date     date,              -- vencimento de quando a cobrança foi criada (o ciclo)
  payment_date          date,
  confirmed_date        date,
  refunded_at           timestamptz,
  last_event            text not null,
  last_event_at         timestamptz not null default now(),  -- dateCreated do evento no Asaas
  created_at            timestamptz not null default now()
);
create index if not exists billing_payments_user_idx on public.billing_payments (user_id, due_date desc);
create index if not exists billing_payments_sub_idx on public.billing_payments (subscription_ref, due_date);
alter table public.billing_payments enable row level security;
revoke all on table public.billing_payments from anon, authenticated;

-- ─── 6. Eventos do webhook: gravados antes de processar ─────────────────────
-- O webhook grava o evento (sem dados de cartão), responde 200 e processa.
-- O que falhar por Asaas ou rede fica 'failed' e o job tenta de novo; depois
-- de 20 tentativas fica 'exhausted' (o admin vê).
create table if not exists public.asaas_webhook_events (
  id           text primary key,          -- "evt_..." do Asaas
  event        text not null,
  payload      jsonb,
  status       text not null default 'pending' check (status in ('pending', 'done', 'failed', 'exhausted')),
  attempts     integer not null default 0,
  last_error   text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists asaas_webhook_events_retry_idx
  on public.asaas_webhook_events (received_at) where status <> 'done';
alter table public.asaas_webhook_events enable row level security;
revoke all on table public.asaas_webhook_events from anon, authenticated;

-- ─── 7. Pendências com o Asaas (o admin vê esta lista) ──────────────────────
-- delete_subscription / inactivate_subscription: tentadas de novo sozinhas
-- (próximo webhook, próximo login do usuário, job diário) até dar certo.
-- delete_future_payments: depois de inativar, remover as cobranças em aberto que
-- ainda vão vencer (a da renovação seguinte já gerada); nunca a vencida guardada
-- em asaas_payment_id. Não trava a exclusão da conta.
-- refund_payment: estorno que o admin precisa fazer ou aprovar (não automático).
-- admin_review: caso pro admin olhar (ex.: assinatura antiga não achada no Asaas).
-- Antes de qualquer estorno manual, o admin confere o status da cobrança no Asaas.
create table if not exists public.billing_pending_actions (
  id                    bigserial primary key,
  subscription_ref      text not null,     -- billing_subscriptions.id (sem FK: o histórico fica)
  user_id               uuid references auth.users(id) on delete set null,
  action                text not null check (action in ('delete_subscription', 'inactivate_subscription', 'delete_future_payments', 'refund_payment', 'admin_review')),
  reason                text not null,
  asaas_subscription_id text,
  asaas_payment_id      text,              -- cobrança que motivou (na inativação: a vencida, que nunca é removida)
  due_date              date,              -- cobrança que motivou (vencida, estorno)
  amount                numeric(12, 2),
  auto_retry            boolean not null default true,
  status                text not null default 'pending' check (status in ('pending', 'done', 'canceled')),
  attempts              integer not null default 0,
  last_error            text,
  next_attempt_at       timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  done_at               timestamptz,
  done_note             text
);
create unique index if not exists billing_pending_actions_open_uidx
  on public.billing_pending_actions (subscription_ref, action) where status = 'pending';
create index if not exists billing_pending_actions_due_idx
  on public.billing_pending_actions (next_attempt_at) where status = 'pending' and auto_retry;
alter table public.billing_pending_actions enable row level security;
revoke all on table public.billing_pending_actions from anon, authenticated;

-- ─── 8. Datas ───────────────────────────────────────────────────────────────
create or replace function public.billing_cycle_months(p_cycle text)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_cycle = 'YEARLY' then 12 else 1 end;
$$;

-- Hoje em Brasília.
create or replace function public.billing_today()
returns date
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Próximo vencimento a partir da âncora (1º vencimento), não do último pago:
-- âncora 31/01 dá 28/02, 31/03, 30/04... sem escorregar pro dia 28.
create or replace function public.billing_next_due(p_anchor date, p_last_paid date, p_cycle text)
returns date
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor, p_last_paid);
  v_step   integer := public.billing_cycle_months(p_cycle);
  v_months integer;
  v_next   date;
begin
  if p_last_paid is null then
    return null;
  end if;
  -- âncora ainda à frente (ciclo trocado pelo admin): o próximo é ela
  if v_anchor > p_last_paid then
    return v_anchor;
  end if;
  v_months := (extract(year from p_last_paid)::int * 12 + extract(month from p_last_paid)::int)
            - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int);
  v_next := (v_anchor + make_interval(months => (greatest(v_months, 0) / v_step + 1) * v_step))::date;
  if v_next <= p_last_paid then
    v_next := (p_last_paid + make_interval(months => v_step))::date;
  end if;
  return v_next;
end;
$$;

-- O período pago vale até o fim do dia do próximo vencimento, em Brasília.
create or replace function public.billing_access_end(p_next_due date)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select ((p_next_due + 1)::timestamp) at time zone 'America/Sao_Paulo';
$$;

-- Ciclo seguinte ao último pago (o vencimento ORIGINAL dele), pela âncora,
-- pulando ciclo de cobrança removida. É o mesmo cálculo do registro de
-- cobrança (seção 16); usado pela troca de ciclo e pela rede de segurança.
create or replace function public.billing_next_cycle(p_ref text, p_anchor date, p_last_paid date, p_cycle text)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_calc  date := public.billing_next_due(p_anchor, p_last_paid, p_cycle);
  v_guard integer := 0;
begin
  while v_calc is not null and v_guard < 12 and exists (
    select 1 from public.billing_payments
     where subscription_ref = p_ref and status = 'DELETED' and coalesce(original_due_date, due_date) = v_calc
  ) loop
    v_calc := public.billing_next_due(p_anchor, v_calc, p_cycle);
    v_guard := v_guard + 1;
  end loop;
  return v_calc;
end;
$$;

-- Ordem dos planos (COB-R7): Studio (pro_*) acima do Pro (essencial_*).
create or replace function public.billing_plan_rank(p_plan text)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_plan in ('pro_mensal', 'pro_anual') then 2
              when p_plan in ('essencial_mensal', 'essencial_anual') then 1
              else 0 end;
$$;

-- ─── 9. Plano do perfil a partir das assinaturas ────────────────────────────
-- Entre as assinaturas pagas ativas vale a de INÍCIO mais recente (não a linha
-- criada por último: a de quem assinou antes desta versão nasce depois mas
-- começou antes). Com cortesia ativa (com ou sem data), vale o MAIOR plano entre
-- a paga ativa e a cortesia (COB-R7; empate, a paga); a cobrança segue só a paga.
-- Sem nada ativo, a cancelada que ainda tem acesso; com assinaturas mas sem
-- acesso, Livre. Quem não tem nenhuma linha (plano antigo ou dado à mão) não é
-- tocado.
create or replace function public.billing_sync_profile(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r             record;
  v_paid_plan   text;
  v_paid_until  timestamptz;
  v_court_plan  text;
  v_court_until timestamptz;
begin
  if p_user_id is null then
    return 'no_user';
  end if;
  -- trava o perfil: duas mudanças ao mesmo tempo não gravam um plano velho
  perform 1 from public.profiles where id = p_user_id for update;

  select s.plan_key, s.access_until
    into v_paid_plan, v_paid_until
    from public.billing_subscriptions s
   where s.user_id = p_user_id and s.kind = 'asaas' and s.status = 'active'
     and (s.access_until is null or s.access_until > now())
   order by (s.access_until is null) desc, s.started_at desc, s.created_at desc
   limit 1;
  select s.plan_key, s.access_until
    into v_court_plan, v_court_until
    from public.billing_subscriptions s
   where s.user_id = p_user_id and s.kind = 'courtesy' and s.status = 'active'
     and (s.access_until is null or s.access_until > now())
   order by public.billing_plan_rank(s.plan_key) desc, s.started_at desc, s.created_at desc
   limit 1;

  if v_court_plan is not null
     and (v_paid_plan is null or public.billing_plan_rank(v_court_plan) > public.billing_plan_rank(v_paid_plan)) then
    -- Cortesia de plano maior por cima de uma paga ativa: o perfil fica com a
    -- data da paga (sem data), senão no fim da cortesia quem paga contaria como
    -- Livre até o job; o job diário volta pro plano pago quando a cortesia acaba.
    update public.profiles
       set plan = v_court_plan,
           plan_expires_at = case when v_paid_plan is not null then v_paid_until else v_court_until end
     where id = p_user_id;
    return v_court_plan;
  end if;
  if v_paid_plan is not null then
    update public.profiles
       set plan = v_paid_plan, plan_expires_at = v_paid_until
     where id = p_user_id;
    return v_paid_plan;
  end if;

  select s.plan_key, s.access_until
    into r
    from public.billing_subscriptions s
   where s.user_id = p_user_id
     and s.status = 'canceled' and s.access_until > now()
   order by s.started_at desc, s.created_at desc
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

-- ─── 10. Pendências: criar, concluir, registrar falha ───────────────────────
drop function if exists public.billing_enqueue_action(text, text, text, text, date, numeric, boolean);
create or replace function public.billing_enqueue_action(
  p_ref text,
  p_action text,
  p_reason text,
  p_payment_id text default null,
  p_due_date date default null,
  p_amount numeric default null,
  p_auto_retry boolean default true,
  p_user_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  bigint;
  r     public.billing_subscriptions%rowtype;
begin
  select * into r from public.billing_subscriptions where id = p_ref;
  -- caso pro admin olhar não volta depois de fechado
  if p_action = 'admin_review' then
    select id into v_id from public.billing_pending_actions
     where subscription_ref = p_ref and action = 'admin_review' order by id limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  insert into public.billing_pending_actions
    (subscription_ref, user_id, action, reason, asaas_subscription_id, asaas_payment_id, due_date, amount, auto_retry)
  values
    (p_ref, coalesce(r.user_id, p_user_id), p_action, p_reason, r.asaas_subscription_id, p_payment_id, p_due_date, p_amount, p_auto_retry)
  on conflict (subscription_ref, action) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.billing_pending_actions
     where subscription_ref = p_ref and action = p_action and status = 'pending';
  end if;
  return v_id;
end;
$$;

-- Concluída. Pra parar a recorrência, grava também na assinatura (a parada vale
-- assim que o Asaas aceitou). Inativação concluída cria, NA MESMA transação, a
-- pendência própria de remover as cobranças futuras (COB-R2), com a vencida da
-- decisão guardada pra nunca ser removida; devolve o id dela.
drop function if exists public.billing_action_done(bigint, text, text);
create or replace function public.billing_action_done(p_action_id bigint, p_subscription_id text default null, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.billing_pending_actions%rowtype;
begin
  update public.billing_pending_actions
     set status = 'done', done_at = now(), done_note = p_note
   where id = p_action_id and status = 'pending'
  returning * into a;
  if not found then
    -- o aviso do próprio Asaas (SUBSCRIPTION_INACTIVATED) fechou a inativação
    -- enquanto ela rodava: a remoção das cobranças futuras continua valendo
    select * into a from public.billing_pending_actions
     where id = p_action_id and status = 'done' and action = 'inactivate_subscription';
    if not found then
      return null;
    end if;
  end if;
  if a.action in ('delete_subscription', 'inactivate_subscription') then
    update public.billing_subscriptions
       set admin_note            = replace(admin_note, 'acontece mesmo assim (pendente)', 'acontece mesmo assim (feita em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')'),
           asaas_stopped_at      = coalesce(asaas_stopped_at, now()),
           asaas_stop_kind       = coalesce(asaas_stop_kind, case when a.action = 'delete_subscription' then 'deleted' else 'inactivated' end),
           asaas_subscription_id = coalesce(asaas_subscription_id, p_subscription_id),
           updated_at            = now()
     where id = a.subscription_ref;
  end if;
  if a.action = 'inactivate_subscription' then
    return public.billing_enqueue_action(a.subscription_ref, 'delete_future_payments', a.reason,
                                         a.asaas_payment_id, a.due_date, null, true, a.user_id);
  end if;
  return null;
end;
$$;

-- Falhou: tenta de novo mais tarde (10 min, 20, 40... até 24 h). Recusa
-- definitiva do Asaas (4xx) volta a cada 24 h e fica visível pro admin.
create or replace function public.billing_action_failed(p_action_id bigint, p_error text, p_permanent boolean default false)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.billing_pending_actions
     set attempts        = attempts + 1,
         last_error      = left(p_error, 500),
         next_attempt_at = now() + case
                             when p_permanent then interval '24 hours'
                             else least(interval '24 hours', interval '10 minutes' * power(2, least(attempts, 8)))
                           end
   where id = p_action_id and status = 'pending';
$$;

-- O Asaas avisou que a recorrência parou (removida ou inativada): fecha as
-- pendências de parar a recorrência dessa assinatura.
create or replace function public.billing_mark_asaas_stopped(p_id text, p_kind text, p_subscription_id text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.billing_subscriptions
     set admin_note            = replace(admin_note, 'acontece mesmo assim (pendente)', 'acontece mesmo assim (feita em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')'),
         asaas_stopped_at      = coalesce(asaas_stopped_at, now()),
         asaas_stop_kind       = coalesce(asaas_stop_kind, p_kind),
         asaas_subscription_id = coalesce(asaas_subscription_id, p_subscription_id),
         updated_at            = now()
   where id = p_id;
  update public.billing_pending_actions
     set status = 'done', done_at = now(), done_note = 'confirmado pelo Asaas (' || p_kind || ')'
   where subscription_ref = p_id and status = 'pending'
     and action in ('delete_subscription', 'inactivate_subscription');
end;
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

-- ─── 11. Vincular (ou criar) a assinatura de um checkout pago ────────────────
-- Nunca troca o dono. p_paid_due_date = vencimento de uma cobrança já paga.
-- p_started_at = início real (pra quem assinou antes desta versão: a data do
-- pagamento em payments). p_activate = aplica no perfil.
drop function if exists public.billing_upsert_subscription(text, uuid, text, text, text, text, date, boolean, timestamptz);
drop function if exists public.billing_upsert_subscription(text, uuid, text, text, text, text, date, boolean, timestamptz, timestamptz, timestamptz, boolean);
create or replace function public.billing_upsert_subscription(
  p_id text,
  p_user_id uuid,
  p_plan_key text,
  p_cycle text,
  p_subscription_id text default null,
  p_customer_id text default null,
  p_paid_due_date date default null,
  p_activate boolean default false,
  p_started_at timestamptz default null,
  p_first_paid_at timestamptz default null,
  p_checkout_created_at timestamptz default null,
  p_switch_confirmed boolean default false,
  p_checkout_paid_at timestamptz default null   -- hora exata do CHECKOUT_PAID (COB-R4)
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_next  date := public.billing_next_due(p_paid_due_date, p_paid_due_date, p_cycle);
begin
  insert into public.billing_subscriptions as s
    (id, kind, user_id, plan_key, cycle, asaas_subscription_id, asaas_customer_id, started_at,
     first_paid_at, checkout_created_at, checkout_paid_at, switch_confirmed,
     anchor_due_date, last_paid_due_date, next_due_date, paid_until)
  values
    (p_id, 'asaas', p_user_id, p_plan_key, p_cycle, p_subscription_id, p_customer_id, coalesce(p_started_at, now()),
     p_first_paid_at, p_checkout_created_at, p_checkout_paid_at, coalesce(p_switch_confirmed, false),
     p_paid_due_date, p_paid_due_date, v_next,
     case when v_next is not null then public.billing_access_end(v_next) end)
  on conflict (id) do update
     set asaas_subscription_id = coalesce(s.asaas_subscription_id, excluded.asaas_subscription_id),
         first_paid_at         = least(s.first_paid_at, excluded.first_paid_at),
         checkout_created_at   = coalesce(s.checkout_created_at, excluded.checkout_created_at),
         checkout_paid_at      = least(s.checkout_paid_at, excluded.checkout_paid_at),
         switch_confirmed      = s.switch_confirmed or excluded.switch_confirmed,
         asaas_customer_id     = coalesce(s.asaas_customer_id, excluded.asaas_customer_id),
         started_at            = least(s.started_at, coalesce(p_started_at, s.started_at)),
         anchor_due_date       = coalesce(s.anchor_due_date, excluded.anchor_due_date),
         next_due_date         = case when excluded.last_paid_due_date > coalesce(s.last_paid_due_date, '-infinity'::date)
                                      then public.billing_next_due(coalesce(s.anchor_due_date, excluded.anchor_due_date),
                                                                   excluded.last_paid_due_date, coalesce(s.cycle, excluded.cycle))
                                      else s.next_due_date end,
         last_paid_due_date    = greatest(s.last_paid_due_date, excluded.last_paid_due_date),
         paid_until            = greatest(s.paid_until, excluded.paid_until),
         updated_at            = now()
   where s.user_id is not distinct from excluded.user_id
  returning s.user_id into v_owner;

  if not found then
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

-- ─── 12. Cobrança paga (PAYMENT_CONFIRMED / PAYMENT_RECEIVED) ────────────────
-- p_paid_on = dia em que o cliente pagou (confirmedDate/paymentDate).
-- * Cobrança já contada (vencimento <= último pago), como a liquidação do
--   cartão ~30 dias depois do CONFIRMED ou um reenvio: não muda nada.
-- * Assinatura ativa: estende o período.
-- * Cortada por falta de pagamento:
--     paga em dia (evento atrasado ou rede de segurança) e ainda não inativada
--     no Asaas: volta ativa, sem marcar nada;
--     paga depois do vencimento: plano até o fim daquele período + admin.
-- * Cancelada pelo usuário ou pelo painel: período pago vale + admin avalia estorno.
-- * Encerrada por arrependimento, estorno, admin, troca ou exclusão da conta:
--   nunca devolve acesso; só marca pro admin.
-- p_due_date = ciclo da cobrança (vencimento original); p_real_due = vencimento
-- atual (pode ter sido adiado no painel): atraso é pagar depois DELE.
drop function if exists public.billing_payment_confirmed(text, date, date);
create or replace function public.billing_payment_confirmed(p_id text, p_due_date date, p_paid_on date default null, p_real_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.billing_subscriptions%rowtype;
  v_next date;
  v_end  timestamptz;
  v_note text;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if r.cycle is null or p_due_date is null then
    return jsonb_build_object('result', 'ignored');
  end if;
  if r.last_paid_due_date is not null and p_due_date <= r.last_paid_due_date then
    return jsonb_build_object('result', 'already_counted');
  end if;

  v_next := public.billing_next_due(coalesce(r.anchor_due_date, p_due_date), p_due_date, r.cycle);
  v_end  := public.billing_access_end(v_next);

  update public.billing_subscriptions
     set anchor_due_date    = coalesce(anchor_due_date, p_due_date),
         first_paid_at      = coalesce(first_paid_at, (coalesce(p_paid_on, public.billing_today()))::timestamp at time zone 'America/Sao_Paulo'),
         last_paid_due_date = p_due_date,
         next_due_date      = v_next,
         paid_until         = greatest(paid_until, v_end),
         updated_at         = now()
   where id = p_id;

  if r.status = 'active' then
    -- a linha pode ter nascido do evento de cobrança antes do CHECKOUT_PAID
    perform public.billing_sync_profile(r.user_id);
    return jsonb_build_object('result', 'extended', 'paid_until', greatest(r.paid_until, v_end));
  end if;

  if r.cancel_source = 'unpaid' then
    if p_paid_on is not null and p_paid_on <= coalesce(p_real_due, p_due_date) and r.asaas_stopped_at is null then
      update public.billing_subscriptions
         set status = 'active', cancel_source = null, canceled_at = null, access_until = null, updated_at = now()
       where id = p_id;
      update public.billing_pending_actions
         set status = 'canceled', done_at = now(), done_note = 'pago em dia: corte desfeito'
       where subscription_ref = p_id and status = 'pending' and action = 'inactivate_subscription';
      -- desfazer o corte sempre marca pro admin (COB-R5)
      perform public.billing_flag_review(p_id, 'corte desfeito: cobranca do vencimento ' || to_char(p_due_date, 'DD/MM/YYYY')
                || ' paga em dia (em ' || to_char(p_paid_on, 'DD/MM/YYYY') || ')');
      perform public.billing_sync_profile(r.user_id);
      return jsonb_build_object('result', 'reactivated');
    end if;
    v_note := 'cobranca vencida paga depois (vencimento ' || to_char(p_due_date, 'DD/MM/YYYY')
              || coalesce(', pago em ' || to_char(p_paid_on, 'DD/MM/YYYY'), '')
              || '): plano devolvido ate ' || to_char(v_end at time zone 'America/Sao_Paulo' - interval '1 second', 'DD/MM/YYYY')
              || '; sem renovacao: a inativacao no Asaas acontece mesmo assim'
              || case when r.asaas_stopped_at is null then ' (pendente)' else ' (feita)' end;
    update public.billing_subscriptions
       set access_until = greatest(coalesce(access_until, '-infinity'::timestamptz), v_end), updated_at = now()
     where id = p_id;
    perform public.billing_flag_review(p_id, v_note);
    perform public.billing_sync_profile(r.user_id);
    return jsonb_build_object('result', 'late_payment', 'access_until', v_end);
  end if;

  if r.cancel_source in ('user', 'asaas') then
    update public.billing_subscriptions
       set access_until = greatest(coalesce(access_until, '-infinity'::timestamptz), v_end), updated_at = now()
     where id = p_id;
    perform public.billing_flag_review(p_id, 'cobranca paga depois do cancelamento (vencimento ' || to_char(p_due_date, 'DD/MM/YYYY')
              || '): periodo pago vale; avaliar estorno');
    perform public.billing_sync_profile(r.user_id);
    return jsonb_build_object('result', 'paid_after_cancel', 'access_until', v_end);
  end if;

  perform public.billing_flag_review(p_id, 'cobranca paga em assinatura encerrada (' || coalesce(r.cancel_source, '?')
            || ', vencimento ' || to_char(p_due_date, 'DD/MM/YYYY') || '): avaliar estorno');
  return jsonb_build_object('result', 'flagged_closed');
end;
$$;

-- ─── 13. Renovação não paga (PAYMENT_OVERDUE, ou rede de segurança do job) ──
-- Volta pro Livre agora e deixa pendente INATIVAR a assinatura no Asaas (a
-- cobrança vencida continua pagável pelo link do e-mail). A pendência guarda o
-- id da cobrança vencida desta decisão (p_payment_id; na rede de segurança, a
-- cobrança do ciclo conhecida em billing_payments): a remoção das cobranças
-- futuras nunca a apaga, nem se o vencimento for adiado depois (COB-R2).
drop function if exists public.billing_payment_overdue(text, date, text);
create or replace function public.billing_payment_overdue(p_id text, p_due_date date, p_reason text default 'vencida', p_payment_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.billing_subscriptions%rowtype;
  v_act  bigint;
  v_pay  text;
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
    select id into v_act from public.billing_pending_actions
     where subscription_ref = p_id and status = 'pending' and action in ('delete_subscription', 'inactivate_subscription');
    return jsonb_build_object('result', 'already_canceled', 'action_id', v_act);
  end if;

  update public.billing_subscriptions
     set status        = 'canceled',
         cancel_source = 'unpaid',
         canceled_at   = now(),
         access_until  = now(),
         updated_at    = now()
   where id = p_id;
  if r.kind = 'asaas' and r.asaas_stopped_at is null then
    v_pay := coalesce(p_payment_id, (
      select b.asaas_payment_id from public.billing_payments b
       where b.subscription_ref = p_id and b.status in ('PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS')
         and (b.due_date = p_due_date or b.original_due_date = p_due_date)
       order by b.due_date
       limit 1));
    v_act := public.billing_enqueue_action(p_id, 'inactivate_subscription', p_reason, v_pay, p_due_date);
  end if;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object('result', 'canceled_unpaid', 'action_id', v_act);
end;
$$;

-- ─── 14. Estorno (PAYMENT_REFUNDED) ─────────────────────────────────────────
-- Estorno do período atual: Livre na hora e assinatura removida no Asaas
-- (pendência). Fecha o pedido de estorno do admin, se houver. Estorno de um
-- período antigo só fica registrado.
create or replace function public.billing_payment_refunded(p_id text, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     public.billing_subscriptions%rowtype;
  v_act bigint;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  update public.billing_pending_actions
     set status = 'done', done_at = now(), done_note = 'estorno confirmado pelo Asaas'
   where subscription_ref = p_id and status = 'pending' and action = 'refund_payment';

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
  if r.kind = 'asaas' and r.asaas_stop_kind is distinct from 'deleted' and coalesce(r.cancel_source, '') <> 'asaas' then
    v_act := public.billing_enqueue_action(p_id, 'delete_subscription', 'estorno', null, p_due_date);
  end if;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object('result', 'refunded', 'action_id', v_act);
end;
$$;

-- Corte da rede de segurança desfeito: o Asaas mostra que a próxima cobrança
-- de verdade é outra (data mudada no painel ou cobrança removida), ainda não
-- venceu e não há cobrança vencida sem pagamento (o backend confere antes).
-- Volta ativa com o vencimento real e marca pro admin. Recusa (e marca) se a
-- pessoa já tem outra assinatura paga ativa.
drop function if exists public.billing_undo_safety_cut(text, date);
create or replace function public.billing_undo_safety_cut(p_id text, p_real_due date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.billing_subscriptions%rowtype;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found or r.status <> 'canceled' or r.cancel_source <> 'unpaid' or r.asaas_stopped_at is not null then
    return jsonb_build_object('result', 'not_applicable');
  end if;
  if exists (select 1 from public.billing_subscriptions o
              where o.user_id = r.user_id and o.id <> p_id and o.kind = 'asaas' and o.status = 'active') then
    perform public.billing_flag_review(p_id, 'rede de seguranca: corte mantido porque ja existe outra assinatura paga ativa');
    return jsonb_build_object('result', 'refused_other_active');
  end if;
  perform public.billing_flag_review(p_id, 'rede de seguranca desfeita: proxima cobranca real em ' || to_char(p_real_due, 'DD/MM/YYYY'));
  update public.billing_subscriptions
     set status = 'active', cancel_source = null, canceled_at = null, access_until = null,
         next_due_date = p_real_due, paid_until = greatest(paid_until, public.billing_access_end(p_real_due)), updated_at = now()
   where id = p_id;
  update public.billing_pending_actions
     set status = 'canceled', done_at = now(), done_note = 'rede de seguranca desfeita: proxima cobranca real em ' || to_char(p_real_due, 'DD/MM/YYYY')
   where subscription_ref = p_id and status = 'pending' and action = 'inactivate_subscription';
  perform public.billing_sync_profile(r.user_id);
  return jsonb_build_object('result', 'undone');
end;
$$;

-- Rede de segurança com a cobrança do ciclo cortado já paga e contada (o
-- backend recebeu already_counted ao conferir no Asaas): o corte foi indevido
-- (COB-R1). Desfaz SEMPRE e marca pro admin; NUNCA inativa (fecha a pendência
-- de inativar). O próximo vencimento sai do último ciclo pago (e da data real
-- da cobrança em aberto desse ciclo, se o Asaas já mandou). Se a assinatura já
-- está parada no Asaas, não volta a "ativa cobrando": fica com o plano até o
-- fim do período pago, sem renovação (regra do N1).
-- COB-S1: só vale pra pagamento EM DIA (o backend confere a data e se não há
-- cobrança vencida sem pagamento). Se o acesso já foi devolvido até o fim do
-- período (pagamento atrasado contado antes, regra do N1), recusa sem mexer em
-- nada ('refused_late') e a inativação segue.
create or replace function public.billing_undo_counted_cut(p_id text, p_cut_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.billing_subscriptions%rowtype;
  v_calc date;
  v_real date;
  v_next date;
  v_cut  text := coalesce(to_char(p_cut_due, 'DD/MM/YYYY'), '?');
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if r.access_until is not null and r.access_until > now() then
    return jsonb_build_object('result', 'refused_late');
  end if;
  update public.billing_pending_actions
     set status = 'canceled', done_at = now(), done_note = 'rede de seguranca: ciclo ' || v_cut || ' ja pago, corte indevido (nao inativa)'
   where subscription_ref = p_id and status = 'pending' and action = 'inactivate_subscription';
  if r.status <> 'canceled' or r.cancel_source is distinct from 'unpaid' or r.cycle is null or r.last_paid_due_date is null then
    perform public.billing_flag_review(p_id, 'rede de seguranca: cobranca do ciclo ' || v_cut || ' ja estava paga; nada desfeito e nada inativado, conferir');
    return jsonb_build_object('result', 'not_applicable');
  end if;

  v_calc := public.billing_next_cycle(p_id, coalesce(r.anchor_due_date, r.last_paid_due_date), r.last_paid_due_date, r.cycle);
  select due_date into v_real
    from public.billing_payments
   where subscription_ref = p_id
     and status in ('PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS')
     and coalesce(original_due_date, due_date) = v_calc
   order by due_date
   limit 1;
  v_next := coalesce(v_real, v_calc);

  if r.asaas_stopped_at is not null then
    update public.billing_subscriptions
       set access_until = greatest(coalesce(access_until, '-infinity'::timestamptz), public.billing_access_end(v_next)),
           paid_until   = greatest(paid_until, public.billing_access_end(v_next)),
           updated_at   = now()
     where id = p_id;
    perform public.billing_flag_review(p_id, 'rede de seguranca: cobranca do ciclo ' || v_cut || ' ja estava paga (corte indevido); assinatura ja parada no Asaas: plano ate '
              || to_char(public.billing_access_end(v_next) at time zone 'America/Sao_Paulo' - interval '1 second', 'DD/MM/YYYY') || ', sem renovacao');
    perform public.billing_sync_profile(r.user_id);
    return jsonb_build_object('result', 'restored_until_period_end', 'access_until', public.billing_access_end(v_next));
  end if;

  update public.billing_subscriptions
     set status = 'active', cancel_source = null, canceled_at = null, access_until = null,
         next_due_date = v_next, paid_until = greatest(paid_until, public.billing_access_end(v_next)), updated_at = now()
   where id = p_id;
  perform public.billing_flag_review(p_id, 'rede de seguranca desfeita: cobranca do ciclo ' || v_cut || ' ja estava paga (corte indevido); proximo vencimento '
            || to_char(v_next, 'DD/MM/YYYY'));
  perform public.billing_sync_profile(r.user_id);
  return jsonb_build_object('result', 'undone', 'next_due_date', v_next);
end;
$$;

-- ─── 15. Encerrar uma assinatura (botão, painel, troca, admin, exclusão) ────
-- p_immediate: perde o plano agora. Senão vale até o fim do período pago (o
-- maior entre o guardado e o que o backend confirmou no Asaas).
-- p_already_stopped: o backend já parou a recorrência no Asaas antes de gravar
-- (botão do app). Senão, cria a pendência de parar (p_stop: delete|inactivate).
-- p_note: marcação pro admin gravada NA MESMA transação do corte (compra
-- repetida, troca fora do Alterar Plano: COB-R3), pra nunca sobrar linha
-- encerrada sem marcação.
drop function if exists public.billing_end_subscription(text, text, date, boolean, text, boolean);
create or replace function public.billing_end_subscription(
  p_id text,
  p_source text,
  p_paid_due_date date default null,
  p_immediate boolean default false,
  p_stop text default 'delete',
  p_already_stopped boolean default false,
  p_note text default null
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
  v_act    bigint;
  v_action text := case when p_stop = 'inactivate' then 'inactivate_subscription' else 'delete_subscription' end;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if r.status = 'canceled' then
    -- já encerrada: só pode encurtar (arrependimento, exclusão da conta)
    if p_immediate and coalesce(r.access_until, now()) > now() then
      update public.billing_subscriptions
         set access_until = now(), cancel_source = p_source, updated_at = now()
       where id = p_id;
      perform public.billing_sync_profile(r.user_id);
      r.access_until := now();
    end if;
    if p_already_stopped and r.asaas_stopped_at is null then
      perform public.billing_mark_asaas_stopped(p_id, case when p_stop = 'inactivate' then 'inactivated' else 'deleted' end);
    end if;
    select id into v_act from public.billing_pending_actions
     where subscription_ref = p_id and status = 'pending' and action in ('delete_subscription', 'inactivate_subscription');
    return jsonb_build_object('result', 'already_canceled', 'access_until', r.access_until, 'action_id', v_act);
  end if;

  if p_paid_due_date is not null and r.cycle is not null then
    v_paid := public.billing_access_end(public.billing_next_due(coalesce(r.anchor_due_date, p_paid_due_date), p_paid_due_date, r.cycle));
  end if;
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
         updated_at         = now()
   where id = p_id;

  if r.kind = 'asaas' then
    if p_source = 'asaas' or p_already_stopped then
      perform public.billing_mark_asaas_stopped(p_id, case when p_stop = 'inactivate' then 'inactivated' else 'deleted' end);
    elsif r.asaas_stopped_at is null then
      v_act := public.billing_enqueue_action(p_id, v_action, p_source);
    end if;
  end if;
  if p_note is not null then
    perform public.billing_flag_review(p_id, p_note);
  end if;
  perform public.billing_sync_profile(r.user_id);

  return jsonb_build_object('result', 'canceled', 'access_until', v_access, 'action_id', v_act);
end;
$$;

-- Até quando o plano valeria se cancelasse agora (pra tela de confirmação).
create or replace function public.billing_preview_access(p_id text, p_paid_due_date date default null)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(
           s.paid_until,
           case when p_paid_due_date is not null and s.cycle is not null
                then public.billing_access_end(public.billing_next_due(coalesce(s.anchor_due_date, p_paid_due_date), p_paid_due_date, s.cycle)) end)
    from public.billing_subscriptions s
   where s.id = p_id;
$$;

-- ─── 16. Registro de cada cobrança (só evento mais novo atualiza) ──────────
drop function if exists public.billing_record_payment(text, text, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date, date, text, timestamptz);
create or replace function public.billing_record_payment(
  p_payment_id text, p_ref text, p_user_id uuid, p_subscription_id text, p_checkout_id text, p_customer_id text,
  p_status text, p_billing_type text, p_value numeric, p_net_value numeric, p_original_value numeric, p_interest_value numeric,
  p_due_date date, p_payment_date date, p_confirmed_date date, p_event text, p_event_at timestamptz,
  p_original_due_date date default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows  integer;
  v_real  date;
  v_calc  date;
  v_new   date;
  v_guard integer;
  r       public.billing_subscriptions%rowtype;
begin
  insert into public.billing_payments as b
    (asaas_payment_id, user_id, subscription_ref, asaas_subscription_id, asaas_checkout_id, asaas_customer_id,
     status, billing_type, value, net_value, original_value, interest_value, due_date, original_due_date, payment_date, confirmed_date,
     refunded_at, last_event, last_event_at)
  values
    (p_payment_id, p_user_id, p_ref, p_subscription_id, p_checkout_id, p_customer_id,
     p_status, p_billing_type, p_value, p_net_value, p_original_value, p_interest_value, p_due_date,
     coalesce(p_original_due_date, p_due_date), p_payment_date, p_confirmed_date,
     case when p_event = 'PAYMENT_REFUNDED' then now() end, p_event, coalesce(p_event_at, now()))
  on conflict (asaas_payment_id) do update
     set user_id = coalesce(b.user_id, excluded.user_id),
         subscription_ref = coalesce(excluded.subscription_ref, b.subscription_ref),
         asaas_subscription_id = coalesce(excluded.asaas_subscription_id, b.asaas_subscription_id),
         asaas_checkout_id = coalesce(excluded.asaas_checkout_id, b.asaas_checkout_id),
         asaas_customer_id = coalesce(excluded.asaas_customer_id, b.asaas_customer_id),
         status = excluded.status, billing_type = coalesce(excluded.billing_type, b.billing_type),
         value = coalesce(excluded.value, b.value), net_value = coalesce(excluded.net_value, b.net_value),
         original_value = coalesce(excluded.original_value, b.original_value),
         interest_value = coalesce(excluded.interest_value, b.interest_value),
         due_date = coalesce(excluded.due_date, b.due_date),
         original_due_date = coalesce(b.original_due_date, excluded.original_due_date),
         payment_date = coalesce(excluded.payment_date, b.payment_date),
         confirmed_date = coalesce(excluded.confirmed_date, b.confirmed_date),
         refunded_at = coalesce(b.refunded_at, excluded.refunded_at),
         last_event = excluded.last_event, last_event_at = excluded.last_event_at
   where excluded.last_event_at >= b.last_event_at;
  get diagnostics v_rows = row_count;

  -- Próximo vencimento (COB-Q2): o ciclo é o vencimento ORIGINAL da cobrança.
  -- * O ciclo seguinte ao último pago é o calculado pela âncora, pulando ciclo
  --   de cobrança removida.
  -- * Se o Asaas já mandou a cobrança desse ciclo, a data REAL dela manda
  --   (inclusive adiada no painel por PAYMENT_UPDATED); adiada, marca pro admin.
  -- * Sem cobrança conhecida desse ciclo, vale a âncora (N4): uma cobrança de
  --   um ciclo mais distante nunca empurra o vencimento.
  select * into r from public.billing_subscriptions where id = p_ref;
  if found and r.status = 'active' and r.kind = 'asaas' and r.last_paid_due_date is not null then
    v_calc := public.billing_next_due(coalesce(r.anchor_due_date, r.last_paid_due_date), r.last_paid_due_date, r.cycle);
    v_guard := 0;
    while v_guard < 12 and exists (
      select 1 from public.billing_payments
       where subscription_ref = p_ref and status = 'DELETED' and coalesce(original_due_date, due_date) = v_calc
    ) loop
      v_calc := public.billing_next_due(coalesce(r.anchor_due_date, r.last_paid_due_date), v_calc, r.cycle);
      v_guard := v_guard + 1;
    end loop;
    select due_date into v_real
      from public.billing_payments
     where subscription_ref = p_ref
       and status in ('PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS')
       and coalesce(original_due_date, due_date) = v_calc
     order by due_date
     limit 1;
    v_new := coalesce(v_real, v_calc);
    if v_real is not null and v_real > v_calc then
      perform public.billing_flag_review(p_ref, 'vencimento adiado de ' || to_char(v_calc, 'DD/MM/YYYY') || ' para ' || to_char(v_real, 'DD/MM/YYYY'));
    end if;
    if v_new is distinct from r.next_due_date then
      update public.billing_subscriptions
         set next_due_date = v_new, paid_until = public.billing_access_end(v_new), updated_at = now()
       where id = p_ref;
    end if;
  end if;

  return case when v_rows = 1 then 'recorded' else 'stale' end;
end;
$$;

-- ─── 17. Troca de plano (admin) e cortesia ──────────────────────────────────
create or replace function public.billing_change_plan(p_id text, p_plan_key text, p_cycle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        public.billing_subscriptions%rowtype;
  v_anchor date;
begin
  select * into r from public.billing_subscriptions where id = p_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('result', 'not_active');
  end if;
  -- Troca de ciclo: o Asaas mantém a próxima cobrança no ciclo de sempre (com o
  -- valor novo), então o ciclo dela vira a âncora do ciclo novo. Âncora = o
  -- vencimento ORIGINAL desse ciclo (o seguinte ao último pago, pela âncora
  -- antiga), NUNCA o next_due_date, que pode ser a data adiada no painel: com
  -- a data adiada como âncora, o pagamento desse ciclo devolveria a própria
  -- data adiada como próximo vencimento e a rede cortaria quem pagou (COB-R1).
  v_anchor := r.anchor_due_date;
  if p_cycle is not null and p_cycle is distinct from r.cycle and r.last_paid_due_date is not null then
    v_anchor := coalesce(public.billing_next_cycle(p_id, coalesce(r.anchor_due_date, r.last_paid_due_date), r.last_paid_due_date, r.cycle), v_anchor);
  end if;
  update public.billing_subscriptions
     set plan_key        = p_plan_key,
         cycle           = coalesce(p_cycle, cycle),
         anchor_due_date = v_anchor,
         updated_at      = now()
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

-- ─── 18. Job diário (OBRIGATÓRIO, agendado no fim deste arquivo) ────────────
-- Grava 'free' em quem passou do plan_expires_at (versões antigas do app só
-- leem profiles.plan; o painel admin conta pagantes por ele).
create or replace function public.billing_expire_due_plans()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
  r record;
begin
  -- Quem tem assinaturas registradas é recalculado (uma cortesia que acabou
  -- não pode derrubar uma assinatura paga ativa); o resto vira Livre. Também
  -- recalcula quem está no plano de uma cortesia que já acabou e não tem mais
  -- nada ativo nesse plano (cortesia maior por cima de uma paga: o perfil fica
  -- sem data, COB-R7).
  n := 0;
  for r in
    select p.id, exists (select 1 from public.billing_subscriptions s where s.user_id = p.id) as tracked
      from public.profiles p
     where (p.plan_expires_at is not null and p.plan_expires_at <= now())
        or (exists (select 1 from public.billing_subscriptions c
                     where c.user_id = p.id and c.kind = 'courtesy' and c.status = 'active'
                       and c.plan_key = p.plan and c.access_until <= now())
            and not exists (select 1 from public.billing_subscriptions o
                             where o.user_id = p.id and o.plan_key = p.plan
                               and ((o.status = 'active' and (o.access_until is null or o.access_until > now()))
                                    or (o.status = 'canceled' and o.access_until > now()))))
  loop
    if r.tracked then
      perform public.billing_sync_profile(r.id);
    else
      update public.profiles set plan = 'free', plan_expires_at = null where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Rede de segurança: assinatura ativa cuja próxima cobrança passou de 1 dia
-- sem pagamento confirmado é tratada como vencida, mesmo sem o evento do Asaas.
-- A inativação no Asaas fica pendente; antes de inativar, o backend confere no
-- Asaas se a cobrança foi paga (se foi, desfaz o corte).
create or replace function public.billing_daily_job()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_cut    integer := 0;
  v_expire integer;
begin
  for r in
    select id, next_due_date
      from public.billing_subscriptions
     where status = 'active' and kind = 'asaas'
       and next_due_date is not null
       and next_due_date < public.billing_today() - 1
       and not exists (
         select 1 from public.billing_payments b
          where b.subscription_ref = billing_subscriptions.id
            and (b.due_date = billing_subscriptions.next_due_date or b.original_due_date = billing_subscriptions.next_due_date)
            and b.status = 'DELETED')
  loop
    perform public.billing_payment_overdue(r.id, r.next_due_date, 'rede_de_seguranca');
    v_cut := v_cut + 1;
  end loop;
  v_expire := public.billing_expire_due_plans();
  return jsonb_build_object('cortadas_sem_pagamento', v_cut, 'planos_expirados', v_expire, 'em', now());
end;
$$;

-- ─── 19. Biblioteca em nuvem respeita o fim do plano ────────────────────────
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

-- ─── 20. Permissões: só o backend chama as funções de cobrança ──────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.billing_sync_profile(uuid)',
    'public.billing_enqueue_action(text, text, text, text, date, numeric, boolean, uuid)',
    'public.billing_undo_safety_cut(text, date)',
    'public.billing_undo_counted_cut(text, date)',
    'public.billing_next_cycle(text, date, date, text)',
    'public.billing_action_done(bigint, text, text)',
    'public.billing_action_failed(bigint, text, boolean)',
    'public.billing_mark_asaas_stopped(text, text, text)',
    'public.billing_flag_review(text, text)',
    'public.billing_upsert_subscription(text, uuid, text, text, text, text, date, boolean, timestamptz, timestamptz, timestamptz, boolean, timestamptz)',
    'public.billing_payment_confirmed(text, date, date, date)',
    'public.billing_payment_overdue(text, date, text, text)',
    'public.billing_payment_refunded(text, date)',
    'public.billing_end_subscription(text, text, date, boolean, text, boolean, text)',
    'public.billing_preview_access(text, date)',
    'public.billing_record_payment(text, text, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date, date, text, timestamptz, date)',
    'public.billing_change_plan(text, text, text)',
    'public.billing_grant_courtesy(uuid, text, timestamptz, text)',
    'public.billing_expire_due_plans()',
    'public.billing_daily_job()'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ─── 21. Conferência: as colunas que o código usa existem ────────────────────
-- (create table if not exists não muda tabela criada por uma versão antiga
-- deste arquivo; se faltar coluna, para aqui e nada é gravado)
do $$
declare
  c   text;
  faltando text := '';
begin
  foreach c in array array[
    'asaas_webhook_events.status', 'asaas_webhook_events.payload', 'asaas_webhook_events.attempts', 'asaas_webhook_events.last_error',
    'billing_subscriptions.started_at', 'billing_subscriptions.anchor_due_date', 'billing_subscriptions.asaas_stopped_at',
    'billing_subscriptions.asaas_stop_kind', 'billing_subscriptions.needs_admin_review',
    'billing_payments.last_event_at', 'billing_pending_actions.auto_retry', 'billing_pending_actions.next_attempt_at',
    'pending_checkouts.switch_confirmed', 'pending_checkouts.created_at', 'profiles.plan_expires_at', 'profiles.tokens_period_start',
    'billing_subscriptions.first_paid_at', 'billing_subscriptions.checkout_created_at', 'billing_subscriptions.switch_confirmed',
    'billing_payments.original_due_date', 'billing_subscriptions.checkout_paid_at'
  ]
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = split_part(c, '.', 1) and column_name = split_part(c, '.', 2)
    ) then
      faltando := faltando || ' ' || c;
    end if;
  end loop;
  if faltando <> '' then
    raise exception 'Colunas faltando (tabela criada por versao antiga deste arquivo?):%', faltando;
  end if;
  -- e os CHECK que aceitam os valores novos (tabela antiga recusaria)
  foreach c in array array[
    'billing_subscriptions:duplicate', 'billing_pending_actions:admin_review', 'asaas_webhook_events:exhausted',
    'billing_pending_actions:delete_future_payments'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = ('public.' || split_part(c, ':', 1))::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%''' || split_part(c, ':', 2) || '''%'
    ) then
      faltando := faltando || ' ' || c;
    end if;
  end loop;
  if faltando <> '' then
    raise exception 'CHECK sem os valores novos (tabela criada por versao antiga deste arquivo?):%', faltando;
  end if;
end;
$$;

-- ─── 22. Agenda o job diário (03:15 de Brasília) ────────────────────────────
-- Se der erro aqui, ligue a extensão pg_cron no painel (Database > Extensions)
-- e rode este arquivo de novo. Agendar pelo nome substitui o anterior.
create extension if not exists pg_cron;
select cron.schedule('playback-cobranca-diaria', '15 6 * * *', $$select public.billing_daily_job()$$);

commit;

-- Verificação (só leitura)
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('billing_subscriptions', 'billing_payments', 'billing_pending_actions', 'asaas_webhook_events', 'pending_checkouts')
 order by table_name;
select jobname, schedule, command from cron.job where jobname = 'playback-cobranca-diaria';
