-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Números da Visão geral e do Financeiro do admin.                        ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_admin_papel.sql, db/supabase_cota_mensal.sql,               ║
-- ║  db/supabase_assinaturas.sql, db/supabase_admin_base.sql,                ║
-- ║  db/supabase_admin_custos.sql e db/supabase_admin_gestao.sql (ordem do   ║
-- ║  lançamento, D6: último arquivo do Corte B).                             ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano do admin central, D18, seção C e Rulings ADM-T22-byPlan e
-- ADM-T22-totais):
-- * Só leitura. Mês e dia sempre de Brasília: o dia d vai de d 00:00 a d+1
--   00:00 em America/Sao_Paulo (pagamento às 23:30 do dia 30 em Brasília é do
--   dia 30, mesmo já sendo dia 1º em UTC).
-- * Receita pelo que foi pago de fato: cobrança com status pago (CONFIRMED,
--   RECEIVED, RECEIVED_IN_CASH) e data de pagamento no período, sendo a data
--   de pagamento coalesce(confirmed_date, payment_date). Bruto soma value,
--   líquido soma net_value (valores como o Asaas mandou).
-- * Estorno: só o confirmado (REFUNDED), pela hora do estorno (refunded_at; sem
--   ela, a hora do último evento). Estorno pedido ou em andamento não entra.
--   Cobrança estornada não é receita, nem no mês em que foi paga.
-- * Vencido: cobrança que segue vencida hoje (OVERDUE), contada por cobrança.
--   Nos totais do Financeiro, só as de vencimento dentro do período; a lista
--   "No vermelho" traz todas, de qualquer período.
-- * Soma vazia é 0 (R$ 0,00), nunca nulo: o servidor e a tela mostram nulo
--   como "sem dado".
-- * Custo de IA: trabalho sem custo = cost_recorded_at, cost_usd ou cost_brl
--   nulo; conta à parte (withoutCost) e fica fora das duas somas. US$ e R$
--   somam os MESMOS trabalhos (igual à aba Custos de IA, T10).
-- * Plano de cada cobrança no Financeiro: o da hora da cobrança (Ruling
--   ADM-T22-plano-historico). "Mudar plano" reescreve o plan_key da mesma
--   assinatura e grava no registro do admin (change_plan, ok, target_ref = id
--   da assinatura, before.planKey = plano antigo; o registro só aceita inserir
--   e fechar). Vale o before.planKey da primeira troca confirmada feita depois
--   do dia da cobrança (pagamento, ou vencimento quando não paga); sem troca
--   depois, o plano atual da assinatura. Troca no mesmo dia conta no plano novo.
-- * Plano pago = billing_plan_rank > 0 (os 4 planos), igual à lista de
--   Assinantes (T21): 'gratuito' e nomes fora da tabela não contam.
-- * Só o backend (service_role) executa.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Visão geral (formato Overview sem os campos do servidor) ───────────
-- month:         { start, end } do mês de Brasília de p_now (dia 1º e último dia).
-- revenue:       receita do mês (grossBrl, netBrl, payments) e estornos
--                confirmados no mês (refundedBrl, refunds).
-- subscribers:   por plano, contando linhas de assinatura:
--                activeByPlan   pagas ativas com acesso válido (as que renovam);
--                endingByPlan   canceladas com acesso depois de p_now;
--                courtesyByPlan cortesias ativas com acesso válido;
--                overdueAccounts      contas distintas com cobrança vencida;
--                blockedWithActiveSub contas bloqueadas com paga ativa;
--                legacyPaid     perfis com plano efetivo pago (um dos 4
--                               planos, sem ter vencido), sem nenhuma linha
--                               paga (assinante de antes da Fase 3) e sem
--                               cortesia ativa (essa já conta em courtesyByPlan).
-- cancellations: pagas canceladas no mês por motivo, sem troca de plano
--                (superseded) e sem compra repetida (duplicate).
-- aiCost:        trabalhos criados no mês.
-- fx:            a cotação mais recente até o dia de p_now ({ date, rate }, nulos
--                sem nenhuma guardada).
create or replace function public.admin_overview(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now     timestamptz := coalesce(p_now, now());
  v_today   date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_start   date := date_trunc('month', v_today::timestamp)::date;
  v_end     date := (v_start + interval '1 month')::date - 1;
  v_ini     timestamptz := v_start::timestamp at time zone 'America/Sao_Paulo';
  v_fim     timestamptz := (v_end + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_paid    text[] := array['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
  v_revenue jsonb;
  v_subs    jsonb;
  v_cancel  jsonb;
  v_ai      jsonb;
  v_fx      jsonb;
begin
  -- Receita e estornos
  with c as (
    select b.value, b.net_value,
           (b.status = any (v_paid) and coalesce(b.confirmed_date, b.payment_date) between v_start and v_end) as paga,
           (b.status = 'REFUNDED'
            and coalesce(b.refunded_at, b.last_event_at) >= v_ini
            and coalesce(b.refunded_at, b.last_event_at) < v_fim) as estornada
      from public.billing_payments b
  )
  select jsonb_build_object(
           'grossBrl', coalesce(sum(c.value) filter (where c.paga), 0),
           'netBrl', coalesce(sum(c.net_value) filter (where c.paga), 0),
           'payments', count(*) filter (where c.paga),
           'refundedBrl', coalesce(sum(c.value) filter (where c.estornada), 0),
           'refunds', count(*) filter (where c.estornada))
    into v_revenue
    from c;

  -- Assinantes
  with ativa as (
    select s.user_id, s.kind, s.plan_key
      from public.billing_subscriptions s
     where s.status = 'active'
       and (s.access_until is null or s.access_until > v_now)
  )
  select jsonb_build_object(
           'activeByPlan', coalesce((
             select jsonb_object_agg(q.plan_key, q.n)
               from (select a.plan_key, count(*) as n from ativa a where a.kind = 'asaas' group by a.plan_key) q), '{}'::jsonb),
           'endingByPlan', coalesce((
             select jsonb_object_agg(q.plan_key, q.n)
               from (select s.plan_key, count(*) as n
                       from public.billing_subscriptions s
                      where s.status = 'canceled' and s.access_until > v_now
                      group by s.plan_key) q), '{}'::jsonb),
           'courtesyByPlan', coalesce((
             select jsonb_object_agg(q.plan_key, q.n)
               from (select a.plan_key, count(*) as n from ativa a where a.kind = 'courtesy' group by a.plan_key) q), '{}'::jsonb),
           'overdueAccounts', (
             select count(distinct b.user_id) from public.billing_payments b where b.status = 'OVERDUE'),
           'blockedWithActiveSub', (
             select count(*)
               from public.profiles p
              where p.blocked_at is not null
                and exists (select 1 from ativa a where a.user_id = p.id and a.kind = 'asaas')),
           'legacyPaid', (
             select count(*)
               from public.profiles p
              where public.billing_plan_rank(p.plan) > 0
                and (p.plan_expires_at is null or p.plan_expires_at > v_now)
                and not exists (select 1 from public.billing_subscriptions s where s.user_id = p.id and s.kind = 'asaas')
                and not exists (select 1 from ativa a where a.user_id = p.id and a.kind = 'courtesy')))
    into v_subs;

  -- Cancelamentos do mês
  with c as (
    select s.cancel_source
      from public.billing_subscriptions s
     where s.kind = 'asaas'
       and s.status = 'canceled'
       and s.canceled_at >= v_ini
       and s.canceled_at < v_fim
       and s.cancel_source is distinct from 'superseded'
       and s.cancel_source is distinct from 'duplicate'
  )
  select jsonb_build_object(
           'total', (select count(*) from c),
           'bySource', coalesce((
             select jsonb_object_agg(q.cancel_source, q.n)
               from (select c.cancel_source, count(*) as n from c where c.cancel_source is not null group by c.cancel_source) q),
             '{}'::jsonb))
    into v_cancel;

  -- Custo de IA do mês
  select jsonb_build_object(
           'jobs', count(*),
           'succeeded', count(*) filter (where j.status = 'succeeded'),
           'failed', count(*) filter (where j.status = 'failed'),
           'costBrl', coalesce(sum(j.cost_brl) filter (where j.com_custo), 0),
           'costUsd', coalesce(sum(j.cost_usd) filter (where j.com_custo), 0),
           'withoutCost', count(*) filter (where not j.com_custo))
    into v_ai
    from (select pr.status, pr.cost_usd, pr.cost_brl,
                 (pr.cost_recorded_at is not null and pr.cost_usd is not null and pr.cost_brl is not null) as com_custo
            from public.predictions pr
           where pr.created_at >= v_ini
             and pr.created_at < v_fim) j;

  -- Câmbio guardado mais recente até o dia
  select jsonb_build_object('date', f.rate_date, 'rate', f.usd_brl)
    into v_fx
    from public.fx_rates f
   where f.rate_date <= v_today
   order by f.rate_date desc
   limit 1;

  return jsonb_build_object(
    'month', jsonb_build_object('start', v_start, 'end', v_end),
    'revenue', v_revenue,
    'subscribers', v_subs,
    'cancellations', v_cancel,
    'aiCost', v_ai,
    'fx', coalesce(v_fx, jsonb_build_object('date', null, 'rate', null)));
end;
$$;

-- ─── 2. Financeiro (formato FinancePage sem page e pageSize) ───────────────
-- p_from e p_to: dias de Brasília (sem datas, o mês de Brasília de hoje).
-- p_status: all, paid (os três pagos), pending (PENDING), overdue (OVERDUE),
-- refunded (REFUNDED, REFUND_REQUESTED, REFUND_IN_PROGRESS) ou deleted
-- (DELETED); outro valor é recusado. O filtro vale só pra rows e total.
-- range:   { from, to }.
-- totals:  do período, com qualquer filtro: grossBrl, netBrl e paidCount pela
--          receita; refundedBrl pelos estornos confirmados no período;
--          overdueBrl e overdueCount pelas vencidas com vencimento no período.
-- byMonth: os 12 meses até o mês de p_to (até o próprio dia p_to), do mais
--          velho pro mais novo, pela data de pagamento; byPlan é o BRUTO por
--          plano (o da hora do pagamento) e soma o grossBrl do mês.
-- overdue: todas as vencidas, de qualquer período, do vencimento mais velho.
-- rows:    as cobranças do período (pela data de pagamento, ou pelo vencimento
--          quando não paga), mais novas primeiro; página de 1 a 200 linhas.
-- O plano de cada cobrança (byPlan, rows[].planKey e overdue[].planKey) é o da
-- hora da cobrança, pelo registro das trocas de plano (regra no cabeçalho).
create or replace function public.admin_finance(p_from date, p_to date, p_status text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month  date := date_trunc('month', public.billing_today()::timestamp)::date;
  v_from   date := coalesce(p_from, v_month);
  v_to     date := coalesce(p_to, (v_month + interval '1 month')::date - 1);
  v_first  date := (date_trunc('month', v_to::timestamp) - interval '11 months')::date;
  v_last   date := date_trunc('month', v_to::timestamp)::date;
  v_status text := coalesce(p_status, 'all');
  v_paid   text[] := array['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
  v_filter text[];
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out    jsonb;
begin
  v_filter := case v_status
                when 'paid' then v_paid
                when 'pending' then array['PENDING']
                when 'overdue' then array['OVERDUE']
                when 'refunded' then array['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']
                when 'deleted' then array['DELETED']
              end;
  if v_status <> 'all' and v_filter is null then
    raise exception 'status desconhecido: %', v_status using errcode = '22023';
  end if;

  with cob as (
    select b.asaas_payment_id, b.user_id, u.email, b.status, b.value, b.net_value,
           b.due_date, b.payment_date, b.confirmed_date, b.refunded_at, b.last_event, b.last_event_at,
           b.status = any (v_paid) as paga,
           coalesce(b.confirmed_date, b.payment_date) as dia_pago,
           coalesce(b.confirmed_date, b.payment_date, b.due_date) as dia,
           -- plano da hora da cobrança: o antigo da primeira troca confirmada depois do dia dela
           coalesce((select a.before ->> 'planKey'
                       from public.admin_audit_log a
                      where a.action = 'change_plan'
                        and a.result = 'ok'
                        and a.target_ref = b.subscription_ref
                        and coalesce(a.finished_at, a.created_at)
                            >= (coalesce(b.confirmed_date, b.payment_date, b.due_date) + 1)::timestamp
                               at time zone 'America/Sao_Paulo'
                      order by coalesce(a.finished_at, a.created_at), a.id
                      limit 1),
                    s.plan_key) as plan_key
      from public.billing_payments b
      left join public.billing_subscriptions s on s.id = b.subscription_ref
      left join auth.users u on u.id = b.user_id
  ),
  filtradas as (
    select c.*
      from cob c
     where c.dia between v_from and v_to
       and (v_filter is null or c.status = any (v_filter))
  ),
  pagina as (
    select f.*
      from filtradas f
     order by f.dia desc, f.last_event_at desc, f.asaas_payment_id desc
     limit v_limit offset v_offset
  ),
  pagas as (
    select date_trunc('month', c.dia_pago::timestamp)::date as mes, c.plan_key, c.value, c.net_value
      from cob c
     where c.paga and c.dia_pago between v_first and v_to
  ),
  meses as (
    select g::date as mes from generate_series(v_first::timestamp, v_last::timestamp, interval '1 month') g
  ),
  por_mes as (
    select m.mes, coalesce(sum(p.value), 0) as bruto, coalesce(sum(p.net_value), 0) as liquido
      from meses m
      left join pagas p on p.mes = m.mes
     group by m.mes
  ),
  por_plano as (
    select q.mes, jsonb_object_agg(q.plan_key, q.bruto) as planos
      from (select p.mes, p.plan_key, coalesce(sum(p.value), 0) as bruto
              from pagas p
             where p.plan_key is not null
             group by p.mes, p.plan_key) q
     group by q.mes
  )
  select jsonb_build_object(
           'range', jsonb_build_object('from', v_from, 'to', v_to),
           'totals', (
             select jsonb_build_object(
                      'grossBrl', coalesce(sum(c.value) filter (where c.paga and c.dia_pago between v_from and v_to), 0),
                      'netBrl', coalesce(sum(c.net_value) filter (where c.paga and c.dia_pago between v_from and v_to), 0),
                      'paidCount', count(*) filter (where c.paga and c.dia_pago between v_from and v_to),
                      'refundedBrl', coalesce(sum(c.value) filter (
                                       where c.status = 'REFUNDED'
                                         and (coalesce(c.refunded_at, c.last_event_at) at time zone 'America/Sao_Paulo')::date
                                             between v_from and v_to), 0),
                      'overdueBrl', coalesce(sum(c.value) filter (where c.status = 'OVERDUE' and c.due_date between v_from and v_to), 0),
                      'overdueCount', count(*) filter (where c.status = 'OVERDUE' and c.due_date between v_from and v_to))
               from cob c),
           'byMonth', (
             select jsonb_agg(jsonb_build_object(
                      'month', to_char(pm.mes, 'YYYY-MM'),
                      'grossBrl', pm.bruto,
                      'netBrl', pm.liquido,
                      'byPlan', coalesce(pp.planos, '{}'::jsonb)
                    ) order by pm.mes)
               from por_mes pm
               left join por_plano pp on pp.mes = pm.mes),
           'overdue', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'paymentId', c.asaas_payment_id,
                      'userId', c.user_id,
                      'email', c.email,
                      'planKey', c.plan_key,
                      'dueDate', c.due_date,
                      'value', c.value
                    ) order by c.due_date nulls last, c.asaas_payment_id), '[]'::jsonb)
               from cob c
              where c.status = 'OVERDUE'),
           'rows', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'paymentId', p.asaas_payment_id,
                      'userId', p.user_id,
                      'email', p.email,
                      'planKey', p.plan_key,
                      'status', p.status,
                      'value', p.value,
                      'netValue', p.net_value,
                      'dueDate', p.due_date,
                      'paymentDate', p.payment_date,
                      'confirmedDate', p.confirmed_date,
                      'refundedAt', p.refunded_at,
                      'lastEvent', p.last_event,
                      'lastEventAt', p.last_event_at
                    ) order by p.dia desc, p.last_event_at desc, p.asaas_payment_id desc), '[]'::jsonb)
               from pagina p),
           'total', (select count(*) from filtradas))
    into v_out;

  return v_out;
end;
$$;

-- ─── 3. Só o backend executa ────────────────────────────────────────────────
revoke execute on function public.admin_overview(timestamptz) from public, anon, authenticated;
grant  execute on function public.admin_overview(timestamptz) to service_role;
revoke execute on function public.admin_finance(date, date, text, int, int) from public, anon, authenticated;
grant  execute on function public.admin_finance(date, date, text, int, int) to service_role;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 2 linhas, admin_finance e admin_overview, com backend = true e usuario = false.
select p.proname,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_overview', 'admin_finance')
 order by p.proname;
