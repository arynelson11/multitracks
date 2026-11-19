-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Eventos do produto: oferta do primeiro mês e anúncio da casa.           ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_admin_numeros.sql (que vem depois de                        ║
-- ║  db/supabase_admin_papel.sql ... db/supabase_admin_gestao.sql, ordem do  ║
-- ║  lançamento) e ANTES de db/supabase_admin_funil.sql e do deploy que      ║
-- ║  grava eventos. Idempotente: rodar de novo não muda nada.                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano da Parte 3, D7 e D12; Global Constraints de segurança):
-- * Quem grava é só o backend (service_role), pela public.record_product_event.
--   O usuário não lê nem grava a tabela direto (RLS ligada e sem grant).
-- * Nenhum dado pessoal além da conta (user_id). detail guarda no máximo 40
--   letras (ex.: o limite que abriu a oferta, 'stage-songs').
-- * ad_shown e ad_clicked: no máximo um por conta, lugar e dia de Brasília
--   (índice único parcial); o repetido não grava e a função devolve false.
--   offer_shown e offer_used gravam sempre que o servidor chamar (a trava de um
--   por mês fica no registro da oferta, db/supabase_oferta.sql).
-- * Anúncio sempre com lugar (placement); oferta sempre sem.
-- * O dia (day) é o de Brasília da hora do evento: às 23:30 de 30/11 em
--   Brasília (já 01/12 em UTC) o dia é 2026-11-30.
-- * Excluir a conta não apaga os eventos: user_id vira null e os números dos
--   meses passados não mudam.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Tabela ──────────────────────────────────────────────────────────────
create table if not exists public.product_events (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null
             constraint product_events_kind_check
             check (kind in ('offer_shown', 'offer_used', 'ad_shown', 'ad_clicked')),
  placement  text
             constraint product_events_placement_check
             check (placement in ('home', 'separation-done', 'limit', 'badge')),
  detail     text
             constraint product_events_detail_check
             check (detail is null or length(detail) <= 40),
  day        date not null,                       -- dia de Brasília do evento
  created_at timestamptz not null default now(),
  -- anúncio sempre com lugar, oferta sempre sem
  constraint product_events_ad_placement_check
             check ((kind in ('ad_shown', 'ad_clicked')) = (placement is not null))
);

-- um anúncio visto (ou clicado) por conta, lugar e dia
create unique index if not exists product_events_daily_uidx
  on public.product_events (user_id, kind, placement, day)
  where kind in ('ad_shown', 'ad_clicked');
-- o funil lê por mês
create index if not exists product_events_day_idx
  on public.product_events (day);

alter table public.product_events enable row level security;
revoke all on table public.product_events from anon, authenticated;
revoke all on sequence public.product_events_id_seq from anon, authenticated;

-- ─── 2. Gravar um evento (só o backend) ─────────────────────────────────────
-- Devolve true se gravou e false se era um anúncio repetido no mesmo dia e
-- lugar. Valor fora da lista, anúncio sem lugar ou oferta com lugar recusa com
-- 23514 (CHECK); conta nula recusa com 22023. created_at é a própria hora do
-- evento (p_now), e o dia sai dela.
create or replace function public.record_product_event(
  p_user_id   uuid,
  p_kind      text,
  p_placement text default null,
  p_detail    text default null,
  p_now       timestamptz default now())
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n   integer;
begin
  if p_user_id is null then
    raise exception 'evento sem conta' using errcode = '22023';
  end if;
  insert into public.product_events (user_id, kind, placement, detail, day, created_at)
  values (p_user_id, p_kind, p_placement, p_detail, (v_now at time zone 'America/Sao_Paulo')::date, v_now)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function public.record_product_event(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.record_product_event(uuid, text, text, text, timestamptz) to service_role;

-- ─── 3. Conferência: tabela, CHECK e função como o código espera ────────────
-- (create table if not exists não muda tabela criada por uma versão antiga
-- deste arquivo; se faltar algo, para aqui e nada é gravado)
do $$
declare
  c        text;
  faltando text := '';
begin
  foreach c in array array['id', 'user_id', 'kind', 'placement', 'detail', 'day', 'created_at']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'product_events' and column_name = c
    ) then
      faltando := faltando || ' ' || c;
    end if;
  end loop;
  if faltando <> '' then
    raise exception 'Colunas faltando em product_events (tabela criada por versao antiga deste arquivo?):%', faltando;
  end if;

  foreach c in array array[
    'product_events_kind_check:offer_shown', 'product_events_kind_check:offer_used',
    'product_events_kind_check:ad_shown', 'product_events_kind_check:ad_clicked',
    'product_events_placement_check:home', 'product_events_placement_check:separation-done',
    'product_events_placement_check:limit', 'product_events_placement_check:badge',
    'product_events_ad_placement_check:ad_clicked', 'product_events_detail_check:40'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.product_events'::regclass and contype = 'c'
         and conname = split_part(c, ':', 1)
         and pg_get_constraintdef(oid) like '%' || split_part(c, ':', 2) || '%'
    ) then
      faltando := faltando || ' ' || c;
    end if;
  end loop;
  if faltando <> '' then
    raise exception 'CHECK faltando em product_events (tabela criada por versao antiga deste arquivo?):%', faltando;
  end if;

  if to_regclass('public.product_events_daily_uidx') is null then
    raise exception 'Indice unico product_events_daily_uidx faltando';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.product_events'::regclass) then
    raise exception 'RLS desligada em product_events';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.record_product_event(uuid, text, text, text, timestamptz)')
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'record_product_event sem security definer ou sem search_path fixo';
  end if;
end;
$$;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 7 linhas: id, user_id, kind, placement, detail, day e created_at.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'product_events'
 order by ordinal_position;
-- Espera 4 linhas: os CHECK de kind, placement, detail e anúncio com lugar.
select conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid = 'public.product_events'::regclass and contype = 'c'
 order by conname;
-- Espera 1 linha com relrowsecurity = true.
select relname, relrowsecurity from pg_class where oid = 'public.product_events'::regclass;
-- Espera 1 linha com definer = true, backend = true e usuario = false.
select p.proname,
       p.prosecdef as definer,
       p.proconfig as config,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'record_product_event';
