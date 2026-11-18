-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Cota MENSAL de separações (5 / 50 / 150 por mês).                       ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, ANTES do deploy do código.       ║
-- ║  Idempotente: rodar de novo não muda nada.                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Antes: profiles.tokens_used só subia; nada zerava. A cota "por mês" era, na
-- prática, vitalícia.
--
-- Regra nova: o período é o MÊS CIVIL no horário de Brasília. Todo dia 1º, às
-- 00:00 de Brasília, o contador de todo mundo volta a zero.
--
-- Como zera (sem cron): profiles.tokens_period_start guarda de qual mês é o
-- contador. A primeira separação de um mês novo encontra o período vencido e,
-- no MESMO UPDATE, recomeça o contador em 1. Duas separações simultâneas na
-- virada não perdem contagem: o UPDATE trava a linha; a segunda espera a
-- primeira gravar e reavalia a condição já com o período novo (READ COMMITTED),
-- então soma em cima (fica 2, nunca 1+1 perdido).
--
-- A assinatura da função não muda (consume_separation_token(uuid, int) →
-- boolean), então o código antigo e o novo funcionam com este SQL.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. De qual mês é o contador (null = nunca contou neste esquema novo).
alter table public.profiles
  add column if not exists tokens_period_start timestamptz;

-- 2. Início do mês civil em Brasília para um instante qualquer.
create or replace function public.separation_period_start(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (date_trunc('month', p_at at time zone 'America/Sao_Paulo'))
         at time zone 'America/Sao_Paulo';
$$;

-- 3. Consumo atômico: zera na virada do mês e soma dentro do limite.
create or replace function public.consume_separation_token(p_user_id uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period     timestamptz := public.separation_period_start(now());
  updated_rows int;
begin
  if p_limit is null or p_limit <= 0 then
    return false;
  end if;

  update public.profiles
     set tokens_used = case
                         when tokens_period_start is null or tokens_period_start < v_period then 1
                         else coalesce(tokens_used, 0) + 1
                       end,
         -- greatest: uma transação com relógio de um instante antes nunca
         -- leva o período de volta para o mês anterior
         tokens_period_start = greatest(coalesce(tokens_period_start, v_period), v_period)
   where id = p_user_id
     and (tokens_period_start is null
          or tokens_period_start < v_period
          or coalesce(tokens_used, 0) < p_limit);
  get diagnostics updated_rows = row_count;
  return updated_rows = 1;
end;
$$;

revoke execute on function public.consume_separation_token(uuid, int) from public;
revoke execute on function public.consume_separation_token(uuid, int) from anon, authenticated;
grant  execute on function public.consume_separation_token(uuid, int) to service_role;

-- 4. Devolução quando o serviço de separação falha depois do consumo.
--    Só devolve dentro do mês corrente: se o mês já virou, o contador antigo
--    não importa mais (a próxima separação zera).
create or replace function public.refund_separation_token(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set tokens_used = greatest(coalesce(tokens_used, 0) - 1, 0)
   where id = p_user_id
     and tokens_period_start >= public.separation_period_start(now());
$$;

revoke execute on function public.refund_separation_token(uuid) from public;
revoke execute on function public.refund_separation_token(uuid) from anon, authenticated;
grant  execute on function public.refund_separation_token(uuid) to service_role;

-- 5. Leitura do contador pelo próprio usuário (aba Assinatura e Separador).
--    SECURITY INVOKER: a RLS "Users can read own profile" limita à própria linha.
--    Se o mês já virou e ninguém separou ainda, mostra 0 (é o que vale).
create or replace function public.get_my_separation_usage()
returns table (used integer, period_start timestamptz, resets_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with b as (
    select public.separation_period_start(now()) as ps,
           ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')
              at time zone 'America/Sao_Paulo') as next_reset
  )
  select coalesce((
           select case when p.tokens_period_start >= b.ps then coalesce(p.tokens_used, 0) else 0 end
             from public.profiles p
            where p.id = auth.uid()
         ), 0)::integer,
         b.ps,
         b.next_reset
    from b;
$$;

revoke execute on function public.get_my_separation_usage() from public, anon;
grant  execute on function public.get_my_separation_usage() to authenticated;

-- 6. Ponto de partida (só na primeira vez, linhas com período nulo):
--    o contador vira o número de separações feitas NESTE mês, contadas na
--    tabela predictions (uma linha por separação iniciada desde a v1.3.17).
--    Quem não separou neste mês começa em 0. O total vitalício antigo não era
--    lido em lugar nenhum (só pelo próprio RPC) e é descartado.
do $$
declare
  v_period timestamptz := public.separation_period_start(now());
begin
  if to_regclass('public.predictions') is not null then
    update public.profiles p
       set tokens_used = (
             select count(*)::int
               from public.predictions pr
              where pr.user_id = p.id
                and pr.created_at >= v_period
           ),
           tokens_period_start = v_period
     where p.tokens_period_start is null;
  end if;
end;
$$;

commit;

-- Verificação (só leitura): quantos perfis já estão no mês corrente.
select count(*) filter (where tokens_period_start >= public.separation_period_start(now())) as no_mes_corrente,
       count(*) as total
  from public.profiles;
