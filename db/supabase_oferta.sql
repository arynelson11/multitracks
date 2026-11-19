-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Oferta do primeiro mês: registro por conta e por mês, janela de 48      ║
-- ║  horas, CPF conferido por hash e a pendência de voltar ao preço cheio.   ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, DEPOIS de                       ║
-- ║  db/supabase_assinaturas.sql e db/supabase_eventos.sql (ordem do         ║
-- ║  lançamento: depois de db/supabase_admin_funil.sql) e ANTES do deploy    ║
-- ║  que usa a oferta. Idempotente: rodar de novo não muda nada.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Regras (plano da Parte 3, D8, D9 e D10; decisões do dono no spec, seção 7):
-- * Um registro por conta e por mês de Brasília (America/Sao_Paulo). A janela
--   vale 48 horas a partir da primeira vez que a oferta aparece naquele mês e
--   volta uma vez por mês até a conta usar.
-- * Vale a janela ativa de qualquer mês: a aberta em 30/11 às 21:00 de Brasília
--   continua valendo em 01/12 e não abre outra enquanto vale.
-- * Usada uma vez (primeiro pagamento com desconto confirmado), acabou: o status
--   fica 'used' em qualquer mês.
-- * Resposta de offer_current e offer_open_window: { status, expiresAt, month }.
--     used    month do registro usado; expiresAt nulo
--     active  month e expiresAt da janela ativa (a mais nova); expiresAt em UTC
--             no formato do toISOString do JavaScript (2026-11-21T15:00:00.000Z)
--     expired month de Brasília de p_now (a janela dele já passou); expiresAt nulo
--     none    os dois nulos (nenhum registro no mês e nenhuma janela ativa)
-- * Só a tela de limite abre janela (offer_open_window, com o limite que abriu
--   em trigger_kind). Ao abrir, grava offer_shown em product_events na mesma
--   transação; offer_mark_used grava offer_used. offer_shown uma vez por registro;
--   offer_used uma vez por conta (já usada noutro mês, a resposta é 'already').
-- * CPF: o servidor guarda só o HMAC-SHA256 em hex (64 letras), nunca o número.
--   offer_record_cpf devolve true quando outra conta (ou uma conta já excluída)
--   usou a oferta com o mesmo hash: o servidor marca a ficha pro admin. Duas
--   contas com o mesmo hash ao mesmo tempo se veem (trava pelo hash). Sem o
--   registro da conta naquele mês, recusa com P0002 (o hash nunca some calado).
-- * Excluir a conta não apaga o registro: user_id vira null e o hash fica, pra
--   conferência de conta nova continuar valendo.
-- * pending_checkouts guarda o mês da janela (offer_month) e o valor cobrado no
--   primeiro mês (offer_value) quando o checkout sai com a oferta: os dois juntos
--   (AAAA-MM e valor maior que zero) ou nenhum.
-- * Pendência nova restore_full_price: depois do primeiro pagamento com
--   desconto, a assinatura no Asaas volta pro preço cheio (tentada até dar certo).
-- * Quem grava e lê é só o backend (service_role). O usuário não lê nem grava a
--   tabela (RLS ligada e sem grant).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 0. Depende da cobrança e dos eventos ───────────────────────────────────
do $$
begin
  if to_regclass('public.pending_checkouts') is null
     or to_regclass('public.billing_pending_actions') is null
     or to_regprocedure('public.billing_enqueue_action(text, text, text, text, date, numeric, boolean, uuid)') is null then
    raise exception 'Rode antes db/supabase_assinaturas.sql (falta pending_checkouts, billing_pending_actions ou billing_enqueue_action)';
  end if;
  if to_regprocedure('public.record_product_event(uuid, text, text, text, timestamptz)') is null then
    raise exception 'Rode antes db/supabase_eventos.sql (falta public.record_product_event)';
  end if;
end;
$$;

-- ─── 1. Registro da oferta ──────────────────────────────────────────────────
create table if not exists public.first_month_offers (
  id           bigserial primary key,
  user_id      uuid references auth.users(id) on delete set null,   -- null depois da exclusão da conta
  month        text not null
               constraint first_month_offers_month_check
               check (month ~ '^[0-9]{4}-[0-9]{2}$'),              -- mês de Brasília, AAAA-MM
  shown_at     timestamptz not null,                                -- primeira vez que apareceu no mês
  expires_at   timestamptz not null,                                -- shown_at + 48 horas
  trigger_kind text not null
               constraint first_month_offers_trigger_kind_check
               check (trigger_kind in ('separations', 'stage-songs', 'live', 'repertoire', 'download')),
  used_at      timestamptz,                                         -- primeiro pagamento com desconto
  checkout_id  text,                                                -- checkout do Asaas que usou
  cpf_hash     text
               constraint first_month_offers_cpf_hash_check
               check (cpf_hash is null or cpf_hash ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 em hex, nunca o CPF
  created_at   timestamptz not null default now()
);

-- um registro por conta e por mês (o da conta excluída, user_id null, fica fora)
create unique index if not exists first_month_offers_user_month_uidx
  on public.first_month_offers (user_id, month)
  where user_id is not null;
-- conferência do CPF
create index if not exists first_month_offers_cpf_hash_idx
  on public.first_month_offers (cpf_hash)
  where cpf_hash is not null;

alter table public.first_month_offers enable row level security;
revoke all on table public.first_month_offers from anon, authenticated;
revoke all on sequence public.first_month_offers_id_seq from anon, authenticated;

-- ─── 2. Checkout com a oferta ───────────────────────────────────────────────
alter table public.pending_checkouts add column if not exists offer_month text;
alter table public.pending_checkouts add column if not exists offer_value numeric(12, 2);
-- os dois juntos (mês AAAA-MM e valor maior que zero) ou nenhum
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pending_checkouts'::regclass and contype = 'c' and conname = 'pending_checkouts_offer_check'
  ) then
    alter table public.pending_checkouts
      add constraint pending_checkouts_offer_check
      check ((offer_month is null and offer_value is null)
             or (offer_month is not null and offer_value is not null
                 and offer_month ~ '^[0-9]{4}-[0-9]{2}$' and offer_value > 0));
  end if;
end;
$$;

-- ─── 3. Pendência de voltar ao preço cheio ──────────────────────────────────
-- Troca o CHECK de action (o nome que tiver; o padrão do Postgres é
-- billing_pending_actions_action_check) por um com os 6 valores. Se já está
-- certo, não mexe (rodar de novo não trava a tabela).
do $$
declare
  v_att   smallint;
  v_certo boolean;
  c       record;
begin
  select attnum into v_att
    from pg_attribute
   where attrelid = 'public.billing_pending_actions'::regclass and attname = 'action' and not attisdropped;

  select count(*) = 1
         and bool_and(conname = 'billing_pending_actions_action_check'
                      and pg_get_constraintdef(oid) like all (array[
                        '%''delete_subscription''%', '%''inactivate_subscription''%', '%''delete_future_payments''%',
                        '%''refund_payment''%', '%''admin_review''%', '%''restore_full_price''%']))
    into v_certo
    from pg_constraint
   where conrelid = 'public.billing_pending_actions'::regclass and contype = 'c' and conkey = array[v_att];

  if coalesce(v_certo, false) then
    return;
  end if;

  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.billing_pending_actions'::regclass and contype = 'c' and conkey = array[v_att]
  loop
    execute format('alter table public.billing_pending_actions drop constraint %I', c.conname);
  end loop;

  alter table public.billing_pending_actions
    add constraint billing_pending_actions_action_check
    check (action in ('delete_subscription', 'inactivate_subscription', 'delete_future_payments',
                      'refund_payment', 'admin_review', 'restore_full_price'));
end;
$$;

-- ─── 4. Funções (só o backend) ──────────────────────────────────────────────
-- Estado da oferta da conta, sem gravar nada. Conta nula recusa com 22023.
create or replace function public.offer_current(p_user_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_month text := to_char(v_now at time zone 'America/Sao_Paulo', 'YYYY-MM');
  o       public.first_month_offers%rowtype;
begin
  if p_user_id is null then
    raise exception 'oferta sem conta' using errcode = '22023';
  end if;

  -- usada uma vez, acabou (vale em qualquer mês)
  select * into o
    from public.first_month_offers
   where user_id = p_user_id and used_at is not null
   order by used_at desc, id desc
   limit 1;
  if found then
    return jsonb_build_object('status', 'used', 'expiresAt', null, 'month', o.month);
  end if;

  -- janela ativa de qualquer mês (a aberta em 30/11 continua valendo em 01/12)
  select * into o
    from public.first_month_offers
   where user_id = p_user_id and v_now < expires_at
   order by expires_at desc, id desc
   limit 1;
  if found then
    return jsonb_build_object(
      'status', 'active',
      'expiresAt', to_char(o.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'month', o.month);
  end if;

  if exists (select 1 from public.first_month_offers where user_id = p_user_id and month = v_month) then
    return jsonb_build_object('status', 'expired', 'expiresAt', null, 'month', v_month);
  end if;

  return jsonb_build_object('status', 'none', 'expiresAt', null, 'month', null);
end;
$$;

-- Mesmo estado do offer_current; com 'none', abre a janela do mês de Brasília de
-- p_now (48 horas) e grava offer_shown na mesma transação. Duas chamadas ao
-- mesmo tempo criam um registro só (a segunda devolve a mesma janela).
-- p_trigger fora da lista recusa com 23514 (CHECK) quando a janela é aberta.
create or replace function public.offer_open_window(p_user_id uuid, p_trigger text, p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := coalesce(p_now, now());
  v_answer jsonb;
  v_id     bigint;
begin
  v_answer := public.offer_current(p_user_id, v_now);
  if v_answer->>'status' <> 'none' then
    return v_answer;
  end if;

  insert into public.first_month_offers (user_id, month, shown_at, expires_at, trigger_kind)
  values (p_user_id, to_char(v_now at time zone 'America/Sao_Paulo', 'YYYY-MM'), v_now,
          v_now + interval '48 hours', p_trigger)
  on conflict (user_id, month) where user_id is not null do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.record_product_event(p_user_id, 'offer_shown', null, p_trigger, v_now);
  end if;

  return public.offer_current(p_user_id, v_now);
end;
$$;

-- Primeiro pagamento com desconto confirmado. 'marked' grava used_at, o
-- checkout e offer_used; 'already' quando a conta já usou a oferta, em qualquer
-- mês (nenhum evento novo); 'no_offer' sem registro da conta naquele mês. As
-- chamadas da mesma conta esperam a vez (trava das linhas da conta), então dois
-- pagamentos ao mesmo tempo, mesmo de meses diferentes, dão um uso só.
create or replace function public.offer_mark_used(
  p_user_id     uuid,
  p_month       text,
  p_checkout_id text,
  p_now         timestamptz default now())
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_id  bigint;
begin
  if p_user_id is null then
    raise exception 'oferta sem conta' using errcode = '22023';
  end if;

  perform 1 from public.first_month_offers where user_id = p_user_id order by id for update;
  if exists (select 1 from public.first_month_offers where user_id = p_user_id and used_at is not null) then
    return 'already';
  end if;

  update public.first_month_offers
     set used_at = v_now,
         checkout_id = p_checkout_id
   where user_id = p_user_id and month = p_month and used_at is null
  returning id into v_id;
  if v_id is null then
    return 'no_offer';
  end if;
  perform public.record_product_event(p_user_id, 'offer_used', null, null, v_now);
  return 'marked';
end;
$$;

-- Guarda o hash do CPF no registro da conta e do mês e devolve true se outra
-- conta (ou uma conta já excluída) usou a oferta com o mesmo hash. Hash fora do
-- formato (64 letras de 0-9 e a-f) recusa com 23514, mesmo sem o registro. Sem
-- o registro da conta naquele mês recusa com P0002 (nada gravado). A trava pelo
-- hash faz a segunda de duas chamadas ao mesmo tempo esperar a primeira e vê-la.
create or replace function public.offer_record_cpf(p_user_id uuid, p_month text, p_cpf_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'oferta sem conta' using errcode = '22023';
  end if;
  if p_cpf_hash is null or p_cpf_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash do CPF fora do formato (64 letras de 0-9 e a-f)' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cpf_hash, 0));

  update public.first_month_offers
     set cpf_hash = p_cpf_hash
   where user_id = p_user_id and month = p_month;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'sem registro da oferta dessa conta nesse mes' using errcode = 'P0002';
  end if;

  return exists (
    select 1
      from public.first_month_offers
     where cpf_hash = p_cpf_hash
       and used_at is not null
       and user_id is distinct from p_user_id);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.offer_current(uuid, timestamptz)',
    'public.offer_open_window(uuid, text, timestamptz)',
    'public.offer_mark_used(uuid, text, text, timestamptz)',
    'public.offer_record_cpf(uuid, text, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ─── 5. Conferência: tabela, colunas, CHECK e funções como o código espera ──
-- (create table if not exists não muda tabela criada por uma versão antiga
-- deste arquivo; se faltar algo, para aqui e nada é gravado)
do $$
declare
  c        text;
  faltando text := '';
begin
  foreach c in array array[
    'first_month_offers.id', 'first_month_offers.user_id', 'first_month_offers.month',
    'first_month_offers.shown_at', 'first_month_offers.expires_at', 'first_month_offers.trigger_kind',
    'first_month_offers.used_at', 'first_month_offers.checkout_id', 'first_month_offers.cpf_hash',
    'first_month_offers.created_at', 'pending_checkouts.offer_month', 'pending_checkouts.offer_value'
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

  foreach c in array array[
    'first_month_offers:first_month_offers_month_check:[0-9]{4}-[0-9]{2}',
    'first_month_offers:first_month_offers_trigger_kind_check:''separations''',
    'first_month_offers:first_month_offers_trigger_kind_check:''stage-songs''',
    'first_month_offers:first_month_offers_trigger_kind_check:''live''',
    'first_month_offers:first_month_offers_trigger_kind_check:''repertoire''',
    'first_month_offers:first_month_offers_trigger_kind_check:''download''',
    'first_month_offers:first_month_offers_cpf_hash_check:[0-9a-f]{64}',
    'billing_pending_actions:billing_pending_actions_action_check:''delete_subscription''',
    'billing_pending_actions:billing_pending_actions_action_check:''inactivate_subscription''',
    'billing_pending_actions:billing_pending_actions_action_check:''delete_future_payments''',
    'billing_pending_actions:billing_pending_actions_action_check:''refund_payment''',
    'billing_pending_actions:billing_pending_actions_action_check:''admin_review''',
    'billing_pending_actions:billing_pending_actions_action_check:''restore_full_price''',
    'pending_checkouts:pending_checkouts_offer_check:offer_value > (0)::numeric',
    'pending_checkouts:pending_checkouts_offer_check:[0-9]{4}-[0-9]{2}'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = ('public.' || split_part(c, ':', 1))::regclass and contype = 'c'
         and conname = split_part(c, ':', 2)
         and strpos(pg_get_constraintdef(oid), split_part(c, ':', 3)) > 0
    ) then
      faltando := faltando || ' ' || c;
    end if;
  end loop;
  if faltando <> '' then
    raise exception 'CHECK sem os valores novos (tabela criada por versao antiga deste arquivo?):%', faltando;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.first_month_offers'::regclass and contype = 'f'
       and confrelid = 'auth.users'::regclass and confdeltype = 'n'
  ) then
    raise exception 'first_month_offers.user_id sem FK on delete set null (o registro precisa ficar depois da exclusao da conta)';
  end if;
  if not exists (
    select 1 from pg_index
     where indexrelid = to_regclass('public.first_month_offers_user_month_uidx') and indisunique
  ) then
    raise exception 'Indice unico first_month_offers_user_month_uidx faltando';
  end if;
  if to_regclass('public.first_month_offers_cpf_hash_idx') is null then
    raise exception 'Indice first_month_offers_cpf_hash_idx faltando';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.first_month_offers'::regclass) then
    raise exception 'RLS desligada em first_month_offers';
  end if;
  if has_table_privilege('anon', 'public.first_month_offers', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.first_month_offers', 'select, insert, update, delete, truncate, references, trigger')
     or has_sequence_privilege('anon', 'public.first_month_offers_id_seq', 'usage, select, update')
     or has_sequence_privilege('authenticated', 'public.first_month_offers_id_seq', 'usage, select, update') then
    raise exception 'first_month_offers ou a sequencia dela com privilegio pra anon ou authenticated';
  end if;

  foreach c in array array[
    'public.offer_current(uuid, timestamptz)',
    'public.offer_open_window(uuid, text, timestamptz)',
    'public.offer_mark_used(uuid, text, text, timestamptz)',
    'public.offer_record_cpf(uuid, text, text)'
  ]
  loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(c)
         and p.prosecdef
         and p.proconfig @> array['search_path=public, pg_temp']
    ) then
      raise exception '% sem security definer ou sem search_path fixo', c;
    end if;
    if has_function_privilege('authenticated', to_regprocedure(c), 'execute')
       or has_function_privilege('anon', to_regprocedure(c), 'execute') then
      raise exception '% executavel fora do backend', c;
    end if;
    if not has_function_privilege('service_role', to_regprocedure(c), 'execute') then
      raise exception '% sem execute pro service_role', c;
    end if;
  end loop;
end;
$$;

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 10 linhas: id, user_id, month, shown_at, expires_at, trigger_kind,
-- used_at, checkout_id, cpf_hash e created_at.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'first_month_offers'
 order by ordinal_position;
-- Espera 3 linhas: os CHECK de month, trigger_kind e cpf_hash.
select conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid = 'public.first_month_offers'::regclass and contype = 'c'
 order by conname;
-- Espera 1 linha: o CHECK dos dois juntos, mês AAAA-MM e valor maior que zero.
select conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid = 'public.pending_checkouts'::regclass and contype = 'c' and conname = 'pending_checkouts_offer_check';
-- Espera 2 linhas: offer_month (text) e offer_value (numeric 12, 2).
select column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pending_checkouts' and column_name in ('offer_month', 'offer_value')
 order by column_name;
-- Espera 1 linha com os 6 valores, entre eles 'restore_full_price' e 'admin_review'.
select conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid = 'public.billing_pending_actions'::regclass and contype = 'c' and conname = 'billing_pending_actions_action_check';
-- Espera 1 linha com relrowsecurity = true.
select relname, relrowsecurity from pg_class where oid = 'public.first_month_offers'::regclass;
-- Espera 4 linhas com definer = true, backend = true e usuario = false.
select p.proname,
       p.prosecdef as definer,
       p.proconfig as config,
       has_function_privilege('service_role', p.oid, 'execute') as backend,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('offer_current', 'offer_open_window', 'offer_mark_used', 'offer_record_cpf')
 order by p.proname;
