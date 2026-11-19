-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Funil do admin (Visão geral > Funil): cadastro, primeira separação,     ║
-- ║  pagante, oferta e anúncio, por mês.                                     ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_eventos.sql (que vem depois de                              ║
-- ║  db/supabase_admin_numeros.sql, ordem do lançamento).                    ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano da Parte 3, D12, e Ruling R17):
-- * Só leitura. Mês sempre de Brasília (America/Sao_Paulo): cadastro às 23:30
--   de 30/11 em Brasília (já 01/12 em UTC) é de novembro.
-- * Coorte pelo mês do cadastro (auth.users.created_at). Conta com o papel de
--   admin (profiles.is_admin) fica fora do funil inteiro, coorte e eventos.
-- * firstSeparation: contas da coorte com ao menos um trabalho em predictions
--   (de qualquer mês).
-- * paying: contas da coorte com primeiro pagamento confirmado, pela mesma
--   regra do isFirstSubscription (api/_lib/billing.ts): conta a assinatura do
--   Asaas (kind 'asaas') com first_paid_at e sem ser compra repetida
--   (cancel_source 'duplicate'; nulo conta), ou a linha do registro antigo
--   payments cujo checkout (asaas_checkout_id) não é uma compra repetida da
--   mesma conta. Todo checkout pago grava payments, então sem essa exclusão a
--   compra repetida contaria de novo (R17). Cortesia não conta.
-- * medianDaysToPay: mediana (percentile_cont 0.5) dos dias entre o cadastro e
--   o primeiro pagamento (o mais cedo entre first_paid_at e payments.paid_at,
--   pelas regras acima), arredondada a 1 casa; nula no mês sem pagante.
-- * Ofertas e anúncios contam pelo mês do evento (product_events.day, já em
--   Brasília), não pelo da coorte: offersShown conta contas distintas com
--   offer_shown; offersUsed, adsShown e adsClicked contam linhas.
-- * p_months meses (de 1 a 24, padrão 6) terminando no mês de Brasília de
--   p_now, do mais novo pro mais antigo, com zeros nos meses vazios.
-- * Só o backend (service_role) executa.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 0. Depende da tabela de eventos ────────────────────────────────────────
do $$
begin
  if to_regclass('public.product_events') is null then
    raise exception 'Rode antes db/supabase_eventos.sql (falta public.product_events)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.product_events'::regclass) then
    raise exception 'RLS desligada em product_events: rode de novo db/supabase_eventos.sql';
  end if;
end;
$$;

-- ─── 1. Funil por mês ───────────────────────────────────────────────────────
-- Formato { months: [ { month 'AAAA-MM', signups, firstSeparation, paying,
-- medianDaysToPay, offersShown, offersUsed, adsShown, adsClicked } ] }; o
-- servidor acrescenta o label de cada mês.
create or replace function public.admin_funnel(p_now timestamptz default now(), p_months int default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := coalesce(p_now, now());
  v_months integer := coalesce(p_months, 6);
  v_last   date;          -- dia 1º do mês de Brasília de p_now
  v_first  date;          -- dia 1º do mês mais antigo
  v_ini    timestamptz;   -- começo do mês mais antigo, em Brasília
  v_fim    timestamptz;   -- fim do mês de p_now, em Brasília
  v_out    jsonb;
begin
  if v_months < 1 or v_months > 24 then
    raise exception 'p_months fora de 1 a 24: %', v_months using errcode = '22023';
  end if;
  v_last  := date_trunc('month', v_now at time zone 'America/Sao_Paulo')::date;
  v_first := (v_last - make_interval(months => v_months - 1))::date;
  v_ini   := v_first::timestamp at time zone 'America/Sao_Paulo';
  v_fim   := (v_last + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  with meses as (
    select g::date as mes
      from generate_series(v_first::timestamp, v_last::timestamp, interval '1 month') g
  ),
  coorte as (
    select date_trunc('month', u.created_at at time zone 'America/Sao_Paulo')::date as mes,
           u.created_at,
           exists (select 1 from public.predictions pr where pr.user_id = u.id) as separou,
           -- least ignora nulo: o mais cedo entre a assinatura e o registro antigo
           least(
             (select min(s.first_paid_at)
                from public.billing_subscriptions s
               where s.user_id = u.id
                 and s.kind = 'asaas'
                 and s.first_paid_at is not null
                 and s.cancel_source is distinct from 'duplicate'),
             (select min(pa.paid_at)
                from public.payments pa
               where pa.user_id = u.id
                 and pa.asaas_checkout_id is not null
                 and not exists (
                   select 1 from public.billing_subscriptions d
                    where d.id = pa.asaas_checkout_id
                      and d.user_id = u.id
                      and d.kind = 'asaas'
                      and d.cancel_source = 'duplicate'))
           ) as pagou_em
      from auth.users u
     where u.created_at >= v_ini
       and u.created_at < v_fim
       and not exists (select 1 from public.profiles p where p.id = u.id and p.is_admin)
  ),
  por_coorte as (
    select c.mes,
           count(*) as signups,
           count(*) filter (where c.separou) as primeira_separacao,
           count(*) filter (where c.pagou_em is not null) as pagantes,
           -- percentile_cont ignora nulo (quem não pagou); sem pagante, nulo
           round((percentile_cont(0.5) within group (
                   order by (extract(epoch from (c.pagou_em - c.created_at)) / 86400)::float8))::numeric, 1) as mediana
      from coorte c
     group by c.mes
  ),
  por_evento as (
    select date_trunc('month', e.day::timestamp)::date as mes,
           count(distinct e.user_id) filter (where e.kind = 'offer_shown') as ofertas_vistas,
           count(*) filter (where e.kind = 'offer_used') as ofertas_usadas,
           count(*) filter (where e.kind = 'ad_shown') as anuncios_vistos,
           count(*) filter (where e.kind = 'ad_clicked') as anuncios_clicados
      from public.product_events e
     where e.day >= v_first
       and e.day < (v_last + interval '1 month')::date
       and not exists (select 1 from public.profiles p where p.id = e.user_id and p.is_admin)
     group by 1
  )
  select jsonb_build_object('months', jsonb_agg(jsonb_build_object(
           'month', to_char(m.mes, 'YYYY-MM'),
           'signups', coalesce(c.signups, 0),
           'firstSeparation', coalesce(c.primeira_separacao, 0),
           'paying', coalesce(c.pagantes, 0),
           'medianDaysToPay', c.mediana,
           'offersShown', coalesce(ev.ofertas_vistas, 0),
           'offersUsed', coalesce(ev.ofertas_usadas, 0),
           'adsShown', coalesce(ev.anuncios_vistos, 0),
           'adsClicked', coalesce(ev.anuncios_clicados, 0)
         ) order by m.mes desc))
    into v_out
    from meses m
    left join por_coorte c on c.mes = m.mes
    left join por_evento ev on ev.mes = m.mes;

  return v_out;
end;
$$;

-- ─── 2. Só o backend executa ────────────────────────────────────────────────
revoke execute on function public.admin_funnel(timestamptz, int) from public, anon, authenticated;
grant  execute on function public.admin_funnel(timestamptz, int) to service_role;

-- ─── 3. Conferência: a função como o servidor espera ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.admin_funnel(timestamptz, integer)')
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'admin_funnel sem security definer ou sem search_path fixo';
  end if;
  if has_function_privilege('authenticated', to_regprocedure('public.admin_funnel(timestamptz, integer)'), 'execute')
     or has_function_privilege('anon', to_regprocedure('public.admin_funnel(timestamptz, integer)'), 'execute') then
    raise exception 'admin_funnel executavel fora do backend';
  end if;
end;
$$;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 1 linha com definer = true, backend = true e usuario = false.
select p.proname,
       p.prosecdef as definer,
       p.proconfig as config,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_funnel';
-- Espera 6 meses, do mês de Brasília de hoje pra trás (os números do "antes").
select m->>'month' as mes, m->>'signups' as cadastros, m->>'firstSeparation' as separaram,
       m->>'paying' as pagantes, m->>'medianDaysToPay' as dias_ate_pagar
  from jsonb_array_elements((public.admin_funnel())->'months') m;
