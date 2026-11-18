-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Gestão do assinante pelo admin: lista de assinantes, ficha da conta,    ║
-- ║  bloqueio e ajuste da cota do mês.                                       ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_admin_papel.sql, db/supabase_cota_mensal.sql,               ║
-- ║  db/supabase_assinaturas.sql, db/supabase_admin_base.sql e               ║
-- ║  db/supabase_admin_custos.sql (ordem do lançamento, D6).                 ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano do admin central, D10, D11, D18, D20 e seção C):
-- * Só o backend (service_role) chama as cinco funções. As que mudam algo
--   (bloqueio e cota) recusam com 42501 quem não é admin (public.is_admin_user)
--   e gravam o registro (admin_audit_log) na mesma transação: sem registro,
--   nada muda. Resposta que não muda nada (already, is_admin, not_found,
--   over_limit) não grava registro.
-- * Bloquear (D10) só mexe no perfil: blocked_at, blocked_reason e blocked_by.
--   Não mexe na cobrança. Conta admin não é bloqueada.
-- * Ajustar a cota (D11): "Zerar" volta o contador do mês a 0; "Somar N" (1 a
--   500) põe cota extra só no mês atual de Brasília, com teto de 1000 no mês.
--   consume_separation_token não muda: o servidor soma o extra ao limite.
-- * O mês é sempre o de Brasília (separation_period_start), nunca date_trunc em
--   UTC: às 23:30 do último dia do mês em Brasília já é dia 1º em UTC.
-- * Plano efetivo: profiles.plan, ou 'free' se plan_expires_at já passou.
-- * Trabalho sem custo = cost_recorded_at, cost_usd ou cost_brl nulo; as somas
--   em R$ só somam quem tem custo.
-- * Plano de cada cobrança na ficha: o da hora da cobrança, pela mesma função
--   do Financeiro (public.admin_payment_plan, seção 2; Ruling
--   ADM-T22-plano-historico). O numeros a chama, por isso roda depois deste.
-- * O perfil continua protegido pelo gatilho profiles_guard_protected
--   (db/supabase_admin_papel.sql): só as funções security definer e o backend
--   mudam papel, bloqueio, plano e cota. Este arquivo não mexe nele.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Lista de assinantes (formato { total, rows: SubscriberRow[] }) ──────
-- Todas as contas de auth.users, com o perfil. Status, nesta precedência:
--   blocked      perfil com blocked_at;
--   paid_active  assinatura asaas ativa com acesso, ou plano efetivo pago sem
--                nenhuma linha asaas e sem cortesia ativa (assinante de antes da
--                Fase 3, que ganha a marcação review);
--   courtesy     cortesia ativa e nenhuma paga;
--   ending       assinatura encerrada com access_until no futuro;
--   free         o resto.
-- nextDueDate vem da assinatura paga ativa (a mesma que billing_sync_profile
-- escolhe); accessUntil, do que dá o acesso (paga, cortesia ou encerrada). A conta
-- bloqueada mostra as datas do que ela teria sem o bloqueio.
-- Marcações, nesta ordem: review (assinatura marcada pra conferir, ação manual
-- aberta da conta ou assinante antigo sem linha), red (cobrança OVERDUE em
-- aberto, ou corte por unpaid nos últimos 30 dias sem assinatura paga ativa),
-- due7 (próxima cobrança entre hoje e hoje + 7 em Brasília), blocked e
-- inactive30 (plano efetivo pago e último acesso, ou último login, há mais de 30
-- dias ou nunca).
-- Filtros: nulo = sem filtro. p_search procura sem diferenciar caixa no e-mail e
-- no nome, ou o id exato. p_sort: created (cadastro mais novo, o padrão),
-- separations (separações do mês de Brasília) ou last_seen (acesso mais recente,
-- quem nunca entrou no fim). Página de 1 a 200 linhas.
create or replace function public.admin_list_subscribers(
  p_search text,
  p_plan text,
  p_status text,
  p_flag text,
  p_sort text,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_month  timestamptz := public.separation_period_start(now());
  v_next   timestamptz := (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')
                            at time zone 'America/Sao_Paulo';
  v_today  date := public.billing_today();
  v_out    jsonb;
begin
  with contas as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, p.last_seen_at, p.blocked_at,
           coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name') as name,
           case when p.plan_expires_at is not null and p.plan_expires_at <= now() then 'free'
                else coalesce(p.plan, 'free') end as plan
      from auth.users u
      left join public.profiles p on p.id = u.id
  ),
  paga as (
    select distinct on (s.user_id) s.user_id, s.next_due_date, s.access_until
      from public.billing_subscriptions s
     where s.kind = 'asaas' and s.status = 'active' and s.user_id is not null
       and (s.access_until is null or s.access_until > now())
     order by s.user_id, (s.access_until is null) desc, s.started_at desc, s.created_at desc
  ),
  cortesia as (
    select distinct on (s.user_id) s.user_id, s.plan_key, s.access_until
      from public.billing_subscriptions s
     where s.kind = 'courtesy' and s.status = 'active' and s.user_id is not null
       and (s.access_until is null or s.access_until > now())
     order by s.user_id, public.billing_plan_rank(s.plan_key) desc, s.started_at desc, s.created_at desc
  ),
  encerrada as (
    select s.user_id, max(s.access_until) as access_until
      from public.billing_subscriptions s
     where s.status = 'canceled' and s.access_until > now() and s.user_id is not null
     group by s.user_id
  ),
  com_asaas as (
    select distinct s.user_id from public.billing_subscriptions s where s.kind = 'asaas' and s.user_id is not null
  ),
  conferir as (
    select s.user_id from public.billing_subscriptions s where s.needs_admin_review and s.user_id is not null
    union
    select coalesce(a.user_id, s.user_id)
      from public.billing_pending_actions a
      left join public.billing_subscriptions s on s.id = a.subscription_ref
     where a.status = 'pending' and not a.auto_retry and coalesce(a.user_id, s.user_id) is not null
  ),
  vencida as (
    select distinct b.user_id from public.billing_payments b where b.status = 'OVERDUE' and b.user_id is not null
  ),
  cortada as (
    select distinct s.user_id
      from public.billing_subscriptions s
     where s.kind = 'asaas' and s.status = 'canceled' and s.cancel_source = 'unpaid'
       and s.canceled_at >= now() - interval '30 days' and s.user_id is not null
  ),
  separacoes as (
    select pr.user_id, count(*)::int as n
      from public.predictions pr
     where pr.created_at >= v_month and pr.created_at < v_next and pr.user_id is not null
     group by pr.user_id
  ),
  base as (
    select c.*,
           public.billing_plan_rank(c.plan) > 0 as pago,
           pg.user_id is not null as tem_paga, pg.next_due_date, pg.access_until as paga_ate,
           cz.user_id is not null as tem_cortesia, cz.plan_key as courtesy_plan, cz.access_until as cortesia_ate,
           en.access_until as encerrada_ate,
           (public.billing_plan_rank(c.plan) > 0 and ca.user_id is null and cz.user_id is null) as antigo,
           cf.user_id is not null as em_conferencia,
           (vd.user_id is not null or (ct.user_id is not null and pg.user_id is null)) as no_vermelho,
           coalesce(sp.n, 0) as separacoes_mes
      from contas c
      left join paga pg on pg.user_id = c.id
      left join cortesia cz on cz.user_id = c.id
      left join encerrada en on en.user_id = c.id
      left join com_asaas ca on ca.user_id = c.id
      left join (select distinct user_id from conferir) cf on cf.user_id = c.id
      left join vencida vd on vd.user_id = c.id
      left join cortada ct on ct.user_id = c.id
      left join separacoes sp on sp.user_id = c.id
  ),
  situacao as (
    select b.*,
           case when b.tem_paga or b.antigo then 'paid_active'
                when b.tem_cortesia then 'courtesy'
                when b.encerrada_ate is not null then 'ending'
                else 'free' end as acesso
      from base b
  ),
  linhas as (
    select s.id, s.email, s.name, s.plan, s.courtesy_plan, s.created_at, s.last_seen_at, s.last_sign_in_at,
           s.separacoes_mes,
           case when s.blocked_at is not null then 'blocked' else s.acesso end as status,
           s.next_due_date,
           case s.acesso when 'paid_active' then s.paga_ate
                         when 'courtesy' then s.cortesia_ate
                         when 'ending' then s.encerrada_ate end as access_until,
           array_remove(array[
             case when s.em_conferencia or s.antigo then 'review' end,
             case when s.no_vermelho then 'red' end,
             case when s.next_due_date between v_today and v_today + 7 then 'due7' end,
             case when s.blocked_at is not null then 'blocked' end,
             case when s.pago and (coalesce(s.last_seen_at, s.last_sign_in_at) is null
                                   or coalesce(s.last_seen_at, s.last_sign_in_at) < now() - interval '30 days')
                  then 'inactive30' end
           ]::text[], null) as flags
      from situacao s
  ),
  filtradas as (
    select l.*,
           row_number() over (
             order by case when p_sort = 'separations' then l.separacoes_mes end desc nulls last,
                      case when p_sort = 'last_seen' then coalesce(l.last_seen_at, l.last_sign_in_at) end desc nulls last,
                      l.created_at desc nulls last,
                      l.id
           ) as ordem
      from linhas l
     where (v_q is null
            or strpos(lower(coalesce(l.email, '')), v_q) > 0
            or strpos(lower(coalesce(l.name, '')), v_q) > 0
            or l.id::text = v_q)
       and (p_plan is null or l.plan = p_plan)
       and (p_status is null or l.status = p_status)
       and (p_flag is null or p_flag = any (l.flags))
  )
  select jsonb_build_object(
           'total', (select count(*) from filtradas),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'userId', f.id,
                      'email', f.email,
                      'name', f.name,
                      'plan', f.plan,
                      'courtesyPlan', f.courtesy_plan,
                      'status', f.status,
                      'nextDueDate', f.next_due_date,
                      'accessUntil', f.access_until,
                      'separationsMonth', f.separacoes_mes,
                      'createdAt', f.created_at,
                      'lastSeenAt', f.last_seen_at,
                      'lastSignInAt', f.last_sign_in_at,
                      'flags', to_jsonb(f.flags)
                    ) order by f.ordem)
               from filtradas f
              where f.ordem > v_offset and f.ordem <= v_offset + v_limit), '[]'::jsonb))
    into v_out;

  return v_out;
end;
$$;

-- ─── 2. Plano da hora de cada cobrança (a ficha e o Financeiro) ────────────
-- Ruling ADM-T22-plano-historico, numa função só pra a ficha (admin_subscriber_detail,
-- abaixo) e o Financeiro (admin_finance, db/supabase_admin_numeros.sql) mostrarem o
-- mesmo plano pra mesma cobrança. "Mudar plano" reescreve o plan_key da mesma
-- assinatura e grava no registro do admin (change_plan, ok, target_ref = id da
-- assinatura, before.planKey = plano antigo; o registro só aceita inserir e fechar).
-- O dia da cobrança é o do pagamento (confirmed_date, depois payment_date) ou, sem
-- pagamento, o do vencimento. Vale o before.planKey da primeira troca confirmada
-- feita depois desse dia (de Brasília); sem troca depois, o plano atual da
-- assinatura (p_current_plan). Troca no mesmo dia conta no plano novo.
-- Mora aqui porque este arquivo roda antes do numeros (ordem do lançamento). Só lê
-- o registro e roda com os direitos de quem chama (as duas funções acima são
-- security definer); como as outras internas, só o backend executa (seção 6).
create or replace function public.admin_payment_plan(
  p_subscription_ref text,
  p_confirmed_date date,
  p_payment_date date,
  p_due_date date,
  p_current_plan text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
           select a.before ->> 'planKey'
             from public.admin_audit_log a
            where a.action = 'change_plan'
              and a.result = 'ok'
              and a.target_ref = p_subscription_ref
              and coalesce(a.finished_at, a.created_at)
                  >= (coalesce(p_confirmed_date, p_payment_date, p_due_date) + 1)::timestamp
                     at time zone 'America/Sao_Paulo'
            order by coalesce(a.finished_at, a.created_at), a.id
            limit 1),
         p_current_plan);
$$;

-- ─── 3. Ficha da conta (formato SubscriberDetailData sem os campos do servidor) ─
-- Nulo se a conta não existe. O servidor acrescenta quota.limit, plans,
-- asaasLive e mismatches.
-- quota:         used = tokens_used se o contador é do mês atual, senão 0; bonus =
--                quota_bonus se o extra é do mês atual, senão 0; periodStart e
--                resetsAt como get_my_separation_usage.
-- subscriptions: todas as assinaturas e cortesias da conta, mais novas primeiro.
-- payments:      as 50 cobranças mais novas da conta (pelo vencimento), cada uma
--                com o plano da hora dela (admin_payment_plan, seção 2).
-- legacyPayments: pagamentos do registro antigo (public.payments).
-- separations:   do mês de Brasília e o total.
-- aiCost:        R$ do mês e do total, só de quem tem custo; e os sem custo.
-- openActions:   pendências abertas da conta, manuais primeiro (formato ReviewAction).
create or replace function public.admin_subscriber_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month timestamptz := public.separation_period_start(now());
  v_next  timestamptz := (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')
                           at time zone 'America/Sao_Paulo';
  u       auth.users%rowtype;
  p       public.profiles%rowtype;
begin
  select * into u from auth.users where id = p_user;
  if not found then
    return null;
  end if;
  select * into p from public.profiles where id = p_user;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'userId', u.id,
      'email', u.email,
      'name', coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name'),
      'provider', coalesce(p.provider, u.raw_app_meta_data ->> 'provider'),
      'plan', case when p.plan_expires_at is not null and p.plan_expires_at <= now() then 'free'
                   else coalesce(p.plan, 'free') end,
      'planExpiresAt', p.plan_expires_at,
      'isAdmin', coalesce(p.is_admin, false),
      'blockedAt', p.blocked_at,
      'blockedReason', p.blocked_reason,
      'createdAt', u.created_at,
      'lastSignInAt', u.last_sign_in_at,
      'lastSeenAt', p.last_seen_at),
    'quota', jsonb_build_object(
      'used', case when p.tokens_period_start >= v_month then coalesce(p.tokens_used, 0) else 0 end,
      'bonus', case when p.quota_bonus_period is not null
                         and public.separation_period_start(p.quota_bonus_period) = v_month
                    then coalesce(p.quota_bonus, 0) else 0 end,
      'periodStart', v_month,
      'resetsAt', v_next),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id,
               'kind', s.kind,
               'planKey', s.plan_key,
               'cycle', s.cycle,
               'status', s.status,
               'startedAt', s.started_at,
               'nextDueDate', s.next_due_date,
               'paidUntil', s.paid_until,
               'accessUntil', s.access_until,
               'cancelSource', s.cancel_source,
               'canceledAt', s.canceled_at,
               'asaasSubscriptionId', s.asaas_subscription_id,
               'asaasStoppedAt', s.asaas_stopped_at,
               'lastPaidDueDate', s.last_paid_due_date,
               'needsAdminReview', s.needs_admin_review,
               'adminNote', s.admin_note
             ) order by s.started_at desc, s.created_at desc, s.id), '[]'::jsonb)
        from public.billing_subscriptions s
       where s.user_id = p_user),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'paymentId', b.asaas_payment_id,
               'userId', b.user_id,
               'email', u.email,
               'planKey', b.plan_key,
               'status', b.status,
               'value', b.value,
               'netValue', b.net_value,
               'dueDate', b.due_date,
               'paymentDate', b.payment_date,
               'confirmedDate', b.confirmed_date,
               'refundedAt', b.refunded_at,
               'lastEvent', b.last_event,
               'lastEventAt', b.last_event_at,
               'subscriptionRef', b.subscription_ref,
               'originalDueDate', b.original_due_date
             ) order by b.due_date desc nulls last, b.created_at desc, b.asaas_payment_id desc), '[]'::jsonb)
        from (select bp.*,
                     public.admin_payment_plan(bp.subscription_ref, bp.confirmed_date, bp.payment_date, bp.due_date, s.plan_key) as plan_key
                from public.billing_payments bp
                left join public.billing_subscriptions s on s.id = bp.subscription_ref
               where bp.user_id = p_user
               order by bp.due_date desc nulls last, bp.created_at desc, bp.asaas_payment_id desc
               limit 50) b),
    'legacyPayments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id,
               'planKey', x.plan_key,
               'value', x.value,
               'cycle', x.cycle,
               'paidAt', x.paid_at
             ) order by x.paid_at desc, x.id desc), '[]'::jsonb)
        from public.payments x
       where x.user_id = p_user),
    'separations', (
      select jsonb_build_object(
               'month', count(*) filter (where pr.created_at >= v_month and pr.created_at < v_next),
               'total', count(*))
        from public.predictions pr
       where pr.user_id = p_user),
    'aiCost', (
      select jsonb_build_object(
               'monthBrl', coalesce(sum(j.cost_brl) filter (where j.com_custo and j.created_at >= v_month and j.created_at < v_next), 0),
               'totalBrl', coalesce(sum(j.cost_brl) filter (where j.com_custo), 0),
               'jobsWithoutCost', count(*) filter (where not j.com_custo))
        from (select pr.created_at, pr.cost_brl,
                     (pr.cost_recorded_at is not null and pr.cost_usd is not null and pr.cost_brl is not null) as com_custo
                from public.predictions pr
               where pr.user_id = p_user) j),
    'openActions', (
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
             ) order by a.auto_retry, a.created_at, a.id), '[]'::jsonb)
        from public.billing_pending_actions a
        left join public.billing_subscriptions s on s.id = a.subscription_ref
       where a.status = 'pending' and coalesce(a.user_id, s.user_id) = p_user)
  );
end;
$$;

-- ─── 4. Bloquear e desbloquear (D10) ────────────────────────────────────────
-- Respostas: not_found (conta sem perfil); is_admin (bloquear conta admin);
-- already (já está como pedido); blocked (grava blocked_at = now(),
-- blocked_reason e blocked_by = p_admin) ou unblocked (limpa os três), com o
-- registro block ou unblock (antes e depois) na mesma transação. Bloquear exige
-- motivo. blocked_by vira nulo se a conta do admin for excluída (a chave é
-- on delete set null, da T1); o registro guarda o e-mail do admin.
create or replace function public.admin_set_block(p_admin uuid, p_user uuid, p_block boolean, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p        public.profiles%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
  v_after  jsonb;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  if p_block is null then
    raise exception 'bloqueio inválido: use true ou false' using errcode = '22023';
  end if;
  if p_block and v_reason is null then
    raise exception 'bloquear exige o motivo' using errcode = '22023';
  end if;
  -- trava o perfil: dois cliques ao mesmo tempo dão blocked e already
  select * into p from public.profiles where id = p_user for update;
  if not found then
    return 'not_found';
  end if;
  if p_block and p.is_admin then
    return 'is_admin';
  end if;
  if (p.blocked_at is not null) = p_block then
    return 'already';
  end if;

  v_before := jsonb_build_object('blockedAt', p.blocked_at, 'blockedReason', p.blocked_reason, 'blockedBy', p.blocked_by);
  if p_block then
    update public.profiles
       set blocked_at = now(), blocked_reason = v_reason, blocked_by = p_admin
     where id = p_user;
    v_after := jsonb_build_object('blockedAt', now(), 'blockedReason', v_reason, 'blockedBy', p_admin);
  else
    update public.profiles
       set blocked_at = null, blocked_reason = null, blocked_by = null
     where id = p_user;
    v_after := jsonb_build_object('blockedAt', null, 'blockedReason', null, 'blockedBy', null);
  end if;
  perform public.admin_audit_insert(p_admin, case when p_block then 'block' else 'unblock' end, p_user, null,
    v_before, v_after, 'ok', v_reason);
  return case when p_block then 'blocked' else 'unblocked' end;
end;
$$;

-- ─── 5. Ajustar a cota do mês (D11) ─────────────────────────────────────────
-- p_mode reset: tokens_used = 0 e tokens_period_start = começo do mês atual.
-- p_mode add (p_amount de 1 a 500): soma em quota_bonus se o extra é do mês atual,
-- senão começa do zero, e grava quota_bonus_period = começo do mês atual.
-- Resposta { result, used, bonus, periodStart } com used e bonus do mês atual:
-- ok (com o registro adjust_quota na mesma transação), not_found (tudo nulo) ou
-- over_limit (o extra passaria de 1000 no mês; nada muda). "Somar" repetido soma
-- de novo (duas abas somam duas vezes, e as duas ficam no registro).
create or replace function public.admin_adjust_quota(p_admin uuid, p_user uuid, p_mode text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- começo do mês de Brasília como instante (dia 1º 00:00 em America/Sao_Paulo)
  v_period timestamptz := public.separation_period_start(now());
  p        public.profiles%rowtype;
  v_used   integer;
  v_bonus  integer;
  v_before jsonb;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'só admin faz ação de admin' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('reset', 'add') then
    raise exception 'ajuste inválido: use reset ou add' using errcode = '22023';
  end if;
  if p_mode = 'add' and (p_amount is null or p_amount < 1 or p_amount > 500) then
    raise exception 'a quantidade a somar vai de 1 a 500' using errcode = '22023';
  end if;
  -- trava o perfil: duas abas somando ao mesmo tempo somam as duas
  select * into p from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('result', 'not_found', 'used', null, 'bonus', null, 'periodStart', null);
  end if;

  v_used := case when p.tokens_period_start >= v_period then coalesce(p.tokens_used, 0) else 0 end;
  v_bonus := case when p.quota_bonus_period is not null
                       and public.separation_period_start(p.quota_bonus_period) = v_period
                  then coalesce(p.quota_bonus, 0) else 0 end;
  v_before := jsonb_build_object('used', v_used, 'bonus', v_bonus, 'periodStart', v_period);

  if p_mode = 'reset' then
    update public.profiles
       set tokens_used = 0, tokens_period_start = v_period
     where id = p_user;
    v_used := 0;
  else
    if v_bonus + p_amount > 1000 then
      return jsonb_build_object('result', 'over_limit', 'used', v_used, 'bonus', v_bonus, 'periodStart', v_period);
    end if;
    v_bonus := v_bonus + p_amount;
    update public.profiles
       set quota_bonus = v_bonus, quota_bonus_period = v_period
     where id = p_user;
  end if;

  perform public.admin_audit_insert(p_admin, 'adjust_quota', p_user, null, v_before,
    jsonb_build_object('mode', p_mode, 'amount', case when p_mode = 'add' then p_amount end,
                       'used', v_used, 'bonus', v_bonus, 'periodStart', v_period),
    'ok', null);
  return jsonb_build_object('result', 'ok', 'used', v_used, 'bonus', v_bonus, 'periodStart', v_period);
end;
$$;

-- ─── 6. Só o backend executa ────────────────────────────────────────────────
revoke execute on function public.admin_list_subscribers(text, text, text, text, text, int, int) from public, anon, authenticated;
grant  execute on function public.admin_list_subscribers(text, text, text, text, text, int, int) to service_role;
revoke execute on function public.admin_subscriber_detail(uuid) from public, anon, authenticated;
grant  execute on function public.admin_subscriber_detail(uuid) to service_role;
revoke execute on function public.admin_set_block(uuid, uuid, boolean, text) from public, anon, authenticated;
grant  execute on function public.admin_set_block(uuid, uuid, boolean, text) to service_role;
revoke execute on function public.admin_adjust_quota(uuid, uuid, text, int) from public, anon, authenticated;
grant  execute on function public.admin_adjust_quota(uuid, uuid, text, int) to service_role;
revoke execute on function public.admin_payment_plan(text, date, date, date, text) from public, anon, authenticated;
grant  execute on function public.admin_payment_plan(text, date, date, date, text) to service_role;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 4 linhas, todas com definer = true, backend = true e usuario = false.
select p.proname,
       p.prosecdef as definer,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('admin_list_subscribers', 'admin_subscriber_detail', 'admin_set_block', 'admin_adjust_quota')
 order by p.proname;
-- Espera 1 linha, admin_payment_plan, com backend = true e usuario = false (definer = false:
-- roda com os direitos da ficha e do Financeiro, que são security definer).
select p.proname,
       p.prosecdef as definer,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_payment_plan';
-- Espera 1 linha: o gatilho que protege o perfil continua ligado (tgenabled = O).
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard_protected';
