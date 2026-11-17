-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Custo de IA por trabalho (tabela predictions) e câmbio do dia.          ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_admin_papel.sql, db/supabase_cota_mensal.sql,               ║
-- ║  db/supabase_assinaturas.sql e db/supabase_admin_base.sql (ordem do      ║
-- ║  lançamento, D6: primeiro arquivo do Corte B).                           ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano do admin central, D15 a D17, D24, D25 e seção C):
-- * Cada separação (uma linha em predictions) guarda o modelo do demucs
--   (htdemucs ou htdemucs_6s, nunca o dono/nome do Replicate), a versão, o
--   número de faixas, o status, o tempo de processamento, o hardware, o preço
--   por segundo, o custo em US$, o câmbio usado (valor e dia) e o custo em R$.
-- * Quem grava é só o backend (service_role): api/check-separation.ts quando o
--   trabalho termina e a varredura ao abrir Custos de IA. Trabalho de versão sem
--   preço conhecido fica sem custo.
-- * Trabalho sem custo = cost_recorded_at, cost_usd ou cost_brl nulo. Ele conta
--   à parte (withoutCost) e fica fora das duas somas (US$ e R$) e da média.
-- * Câmbio: PTAX de venda do Banco Central, um valor por dia em fx_rates. O R$
--   usa a PTAX pura, sem IOF nem spread do cartão.
-- * Excluir a conta não apaga os trabalhos (D24): user_id vira null, e o custo
--   de IA e a margem dos meses passados não mudam.
-- * Período sempre em dias de Brasília: o dia d vai de d 00:00 a d+1 00:00 em
--   America/Sao_Paulo.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Custo por trabalho em predictions ──────────────────────────────────
-- As linhas antigas ficam com tudo nulo (sem custo) até a varredura completar.
alter table public.predictions
  add column if not exists model            text,           -- model_name do demucs: htdemucs ou htdemucs_6s
  add column if not exists version          text,           -- versão do modelo no Replicate
  add column if not exists stem_count       smallint check (stem_count in (2, 4, 6)),
  add column if not exists status           text check (status in ('starting', 'processing', 'succeeded', 'failed', 'canceled', 'unknown')),
  add column if not exists predict_seconds  numeric(10, 3), -- tempo de processamento cobrado pelo Replicate
  add column if not exists hardware         text,
  add column if not exists usd_per_second   numeric(12, 8),
  add column if not exists cost_usd         numeric(12, 6),
  add column if not exists fx_usd_brl       numeric(10, 4), -- PTAX de venda usada
  add column if not exists fx_date          date,           -- dia dessa PTAX
  add column if not exists cost_brl         numeric(12, 4),
  add column if not exists completed_at     timestamptz,
  add column if not exists cost_recorded_at timestamptz;    -- quando o custo foi gravado (null = falta gravar)

create index if not exists predictions_created_idx
  on public.predictions (created_at);
-- a varredura pega os que ainda não foram gravados, dos mais velhos pros mais novos
create index if not exists predictions_cost_pending_idx
  on public.predictions (created_at) where cost_recorded_at is null;

-- ─── 2. Trabalhos ficam depois da exclusão da conta (D24) ──────────────────
-- Mesmo bloco que a cobrança usou em payments: o vínculo vira null em vez de
-- apagar a linha.
do $$
declare
  c record;
begin
  alter table public.predictions alter column user_id drop not null;
  for c in
    select con.conname, con.confdeltype
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.predictions'::regclass
       and con.contype = 'f'
       and att.attname = 'user_id'
  loop
    if c.confdeltype <> 'n' then
      execute format('alter table public.predictions drop constraint %I', c.conname);
    end if;
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.predictions'::regclass and contype = 'f' and confdeltype = 'n'
  ) then
    alter table public.predictions
      add constraint predictions_user_id_fkey foreign key (user_id)
      references auth.users(id) on delete set null;
  end if;
end;
$$;

-- ─── 3. Câmbio do dia (PTAX de venda) ──────────────────────────────────────
-- Um valor por dia; o backend consulta o Banco Central no máximo a cada 6 horas
-- e, se a consulta falhar, usa a última guardada.
create table if not exists public.fx_rates (
  rate_date  date primary key,                          -- dia da cotação
  usd_brl    numeric(10, 4) not null check (usd_brl > 0),
  source     text not null default 'bcb_ptax_venda',
  fetched_at timestamptz not null default now()         -- quando o backend buscou
);

alter table public.fx_rates enable row level security;
revoke all on table public.fx_rates from anon, authenticated;

-- ─── 4. Custos de IA do período (aba Custos de IA) ─────────────────────────
-- Formato AiCosts sem os campos do servidor (prices, sweep, page e pageSize):
-- range:   { from, to } (dias de Brasília; sem datas, o mês de Brasília de hoje).
-- totals:  jobs; succeeded, failed, canceled e unknown pelo status; withoutCost
--          pela regra do sem custo; costUsd e costBrl somam só os trabalhos com
--          custo; avgBrlPerSucceeded = R$ dos concluídos com custo dividido pela
--          quantidade deles (null se nenhum); predictSeconds soma o tempo.
-- byUser:  as 50 contas de maior costBrl (conta excluída: userId e email null).
-- byModel: por model e stem_count, do maior costBrl pro menor; avgSeconds é a
--          média do tempo de quem tem tempo.
-- fx:      { minDate, maxDate } dos dias de câmbio usados no período.
-- rows:    os trabalhos, mais novos primeiro (página de 1 a 200; total conta todos).
create or replace function public.admin_ai_costs(p_from date, p_to date, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month  date := date_trunc('month', public.billing_today())::date;
  v_from   date := coalesce(p_from, v_month);
  v_to     date := coalesce(p_to, (v_month + interval '1 month' - interval '1 day')::date);
  v_start  timestamptz := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_end    timestamptz := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out    jsonb;
begin
  with j as (
    select pr.*,
           (pr.cost_recorded_at is not null and pr.cost_usd is not null and pr.cost_brl is not null) as com_custo
      from public.predictions pr
     where pr.created_at >= v_start
       and pr.created_at < v_end
  ),
  por_pessoa as (
    select j.user_id, u.email, count(*) as jobs,
           coalesce(sum(j.cost_brl) filter (where j.com_custo), 0) as custo_brl
      from j
      left join auth.users u on u.id = j.user_id
     group by j.user_id, u.email
     order by custo_brl desc, jobs desc, j.user_id nulls last
     limit 50
  ),
  por_modelo as (
    select j.model, j.stem_count, count(*) as jobs,
           coalesce(sum(j.cost_brl) filter (where j.com_custo), 0) as custo_brl,
           round(avg(j.predict_seconds), 3) as avg_seconds
      from j
     group by j.model, j.stem_count
  ),
  pagina as (
    select j.*, u.email
      from j
      left join auth.users u on u.id = j.user_id
     order by j.created_at desc, j.replicate_id desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'range', jsonb_build_object('from', v_from, 'to', v_to),
           'totals', (
             select jsonb_build_object(
                      'jobs', count(*),
                      'succeeded', count(*) filter (where j.status = 'succeeded'),
                      'failed', count(*) filter (where j.status = 'failed'),
                      'canceled', count(*) filter (where j.status = 'canceled'),
                      'unknown', count(*) filter (where j.status = 'unknown'),
                      'withoutCost', count(*) filter (where not j.com_custo),
                      'costUsd', coalesce(sum(j.cost_usd) filter (where j.com_custo), 0),
                      'costBrl', coalesce(sum(j.cost_brl) filter (where j.com_custo), 0),
                      'avgBrlPerSucceeded', round(avg(j.cost_brl) filter (where j.com_custo and j.status = 'succeeded'), 4),
                      'predictSeconds', coalesce(sum(j.predict_seconds), 0))
               from j),
           'byUser', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'userId', b.user_id,
                      'email', b.email,
                      'jobs', b.jobs,
                      'costBrl', b.custo_brl
                    ) order by b.custo_brl desc, b.jobs desc, b.user_id nulls last), '[]'::jsonb)
               from por_pessoa b),
           'byModel', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'model', m.model,
                      'stemCount', m.stem_count,
                      'jobs', m.jobs,
                      'costBrl', m.custo_brl,
                      'avgSeconds', m.avg_seconds
                    ) order by m.custo_brl desc, m.jobs desc, m.model nulls last, m.stem_count nulls last), '[]'::jsonb)
               from por_modelo m),
           'fx', (
             select jsonb_build_object('minDate', min(j.fx_date), 'maxDate', max(j.fx_date))
               from j),
           'rows', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'replicateId', p.replicate_id,
                      'createdAt', p.created_at,
                      'userId', p.user_id,
                      'email', p.email,
                      'model', p.model,
                      'stemCount', p.stem_count,
                      'status', p.status,
                      'predictSeconds', p.predict_seconds,
                      'hardware', p.hardware,
                      'costUsd', p.cost_usd,
                      'costBrl', p.cost_brl,
                      'fxRate', p.fx_usd_brl,
                      'fxDate', p.fx_date
                    ) order by p.created_at desc, p.replicate_id desc), '[]'::jsonb)
               from pagina p),
           'total', (select count(*) from j))
    into v_out;

  return v_out;
end;
$$;

-- ─── 5. Só o backend executa ────────────────────────────────────────────────
revoke execute on function public.admin_ai_costs(date, date, int, int) from public, anon, authenticated;
grant  execute on function public.admin_ai_costs(date, date, int, int) to service_role;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 13 linhas: as colunas novas de predictions.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'predictions'
   and column_name in ('model', 'version', 'stem_count', 'status', 'predict_seconds', 'hardware', 'usd_per_second',
                       'cost_usd', 'fx_usd_brl', 'fx_date', 'cost_brl', 'completed_at', 'cost_recorded_at')
 order by column_name;
-- Espera 1 linha: a tabela de câmbio, com RLS ligada (relrowsecurity = true).
select relname, relrowsecurity from pg_class where oid = 'public.fx_rates'::regclass;
-- Espera 1 linha: a chave de predictions.user_id com on delete set null (confdeltype = n).
select conname, confdeltype from pg_constraint
 where conrelid = 'public.predictions'::regclass and contype = 'f';
-- Espera 1 linha com backend = true e usuario = false.
select p.proname,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_ai_costs';
