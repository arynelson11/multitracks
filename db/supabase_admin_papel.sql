-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Papel de admin no perfil (profiles.is_admin) e campos do admin.         ║
-- ║  Rodar UMA vez no Supabase > SQL Editor, ANTES de                        ║
-- ║  db/supabase_cota_mensal.sql e de db/supabase_assinaturas.sql.           ║
-- ║  Idempotente: rodar de novo não muda nada.                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Antes: quem era admin vinha do e-mail escrito à mão em cada regra do banco
-- (policies, get_admin_dashboard_stats, user_has_cloud_library) e no código.
-- Agora: admin é profiles.is_admin. O e-mail do dono aparece uma vez só, na
-- linha que marca o primeiro admin (seção 6). As regras usam public.is_admin().
--
-- O que este arquivo faz:
-- 1. Colunas novas do perfil: papel, bloqueio, último acesso e cota extra do mês.
-- 2. Funções: is_admin() (quem está logado), is_admin_user(id) (só o backend) e
--    touch_last_seen() (o app grava a última abertura, no máximo 1 vez por hora).
-- 3. Gatilho que recusa mudança em papel, bloqueio, plano e cota feita por quem
--    não é o backend, mesmo que alguém abra uma policy de update ou de insert no
--    painel: linha nova criada fora do backend só nasce no padrão.
-- 4. Policies de admin reescritas com is_admin() (cada uma só se a tabela existir).
-- 5. get_admin_dashboard_stats() com a trava trocada por is_admin().
-- 6. Primeiro admin (a conta do dono).
-- Depois do commit, uma conferência só de leitura.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 1. Colunas novas do perfil ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false;
alter table public.profiles
  add column if not exists blocked_at timestamptz;
alter table public.profiles
  add column if not exists blocked_reason text;
alter table public.profiles
  add column if not exists blocked_by uuid references auth.users(id) on delete set null;
-- última abertura do app (gravada por touch_last_seen)
alter table public.profiles
  add column if not exists last_seen_at timestamptz;
-- separações extras dadas pelo admin, só no mês de quota_bonus_period
alter table public.profiles
  add column if not exists quota_bonus integer not null default 0 check (quota_bonus between 0 and 1000);
alter table public.profiles
  add column if not exists quota_bonus_period timestamptz;

-- ─── 2. Funções do papel ────────────────────────────────────────────────────
-- Quem está logado é admin? Sem login (anon) devolve falso. SECURITY DEFINER lê
-- profiles ignorando RLS, então pode ser usada dentro das policies de profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to anon, authenticated, service_role;

-- Essa conta é admin? Só o backend e as funções admin_* chamam.
create or replace function public.is_admin_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_user), false);
$$;
revoke execute on function public.is_admin_user(uuid) from public, anon, authenticated;
grant  execute on function public.is_admin_user(uuid) to service_role;

-- Última abertura do app: grava na própria linha só se nunca gravou ou se a última
-- gravação tem mais de 1 hora.
create or replace function public.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
$$;
revoke execute on function public.touch_last_seen() from public, anon;
grant  execute on function public.touch_last_seen() to authenticated;

-- ─── 3. Gatilho que protege papel, bloqueio, plano e cota ───────────────────
-- Vale no UPDATE (nenhum campo protegido muda) e no INSERT (linha nova só no padrão).
-- Compara por jsonb pra funcionar mesmo antes de as colunas da cobrança e da cota
-- existirem. Passa direto quem é o backend (service_role), o SQL Editor (postgres)
-- e as funções SECURITY DEFINER (rodam como o dono, postgres).
create or replace function public.profiles_guard_protected() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  k text;
  j jsonb;
  keys text[] := array['is_admin','blocked_at','blocked_reason','blocked_by','last_seen_at','quota_bonus',
                       'quota_bonus_period','plan','plan_expires_at','tokens_used','tokens_period_start'];
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;   -- backend, SQL Editor e funções security definer
  end if;
  if tg_op = 'INSERT' then
    -- Linha criada fora do backend nasce no padrão: sem admin, sem bloqueio, plano Livre
    -- e cota padrão. Qualquer um dos campos protegidos fora disso recusa a criação
    -- (Ruling ADM-T1-insert). O cadastro normal (handle_new_user) já grava só o padrão.
    j := to_jsonb(new);
    foreach k in array keys loop
      if not (case k
                when 'is_admin'    then coalesce((j->>k)::boolean, false) = false
                when 'plan'        then coalesce(j->>k, 'free') = 'free'
                when 'quota_bonus' then coalesce((j->>k)::int, 0) = 0
                when 'tokens_used' then coalesce((j->>k)::int, 0) = 0
                else (j->>k) is null
              end) then
        raise exception 'campo protegido do perfil: %', k using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;
  foreach k in array keys loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception 'campo protegido do perfil: %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists profiles_guard_protected on public.profiles;
create trigger profiles_guard_protected
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_protected();

-- ─── 4. Policies de admin pelo papel ────────────────────────────────────────
drop policy if exists "Admin can read all profiles" on public.profiles;
create policy "Admin can read all profiles"
  on public.profiles for select
  using (public.is_admin());

-- As tabelas abaixo podem não existir (a base dos testes SQL não tem songs nem stems):
-- cada policy só é recriada se a tabela existir.
do $$
begin
  if to_regclass('public.payments') is not null then
    execute 'drop policy if exists "payments_admin_read" on public.payments';
    execute 'create policy "payments_admin_read" on public.payments for select using (public.is_admin())';
  end if;
  if to_regclass('public.songs') is not null then
    execute 'drop policy if exists songs_admin_write on public.songs';
    execute 'create policy songs_admin_write on public.songs for all to authenticated
               using (public.is_admin()) with check (public.is_admin())';
  end if;
  if to_regclass('public.stems') is not null then
    execute 'drop policy if exists stems_admin_write on public.stems';
    execute 'create policy stems_admin_write on public.stems for all to authenticated
               using (public.is_admin()) with check (public.is_admin())';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists storage_admin_write on storage.objects';
    execute $p$create policy storage_admin_write on storage.objects for all to authenticated
               using      (bucket_id in ('covers', 'stems', 'samples', 'loops') and public.is_admin())
               with check (bucket_id in ('covers', 'stems', 'samples', 'loops') and public.is_admin())$p$;
  end if;
end
$$;

-- ─── 5. Painel antigo: mesma resposta, trava pelo papel ─────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Bloqueia ataque de search_path em SECURITY DEFINER (CVE-class).
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: admin access required'
            USING ERRCODE = '42501';
    END IF;

    RETURN (
        WITH sep AS (
            SELECT user_id, COUNT(*)::int AS cnt
            FROM public.predictions
            GROUP BY user_id
        ),
        pay AS (
            -- Receita EXATA por usuário a partir da tabela payments (gravada pelo
            -- webhook do Asaas). total_paid = LTV; last_value/last_cycle = último
            -- pagamento, pra derivar o mensal-equivalente exato da margem.
            SELECT user_id,
                   SUM(value) AS total_paid,
                   (ARRAY_AGG(value ORDER BY paid_at DESC))[1] AS last_value,
                   (ARRAY_AGG(cycle ORDER BY paid_at DESC))[1] AS last_cycle
            FROM public.payments
            GROUP BY user_id
        )
        SELECT jsonb_build_object(
            'totalUsers',      (SELECT COUNT(*) FROM auth.users),
            'activeUsers',     (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
            'inactiveUsers',   (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at < now() - interval '30 days' OR last_sign_in_at IS NULL),
            'newUsers7d',      (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
            'newUsers30d',     (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
            'paidSubscribers', (SELECT COUNT(*) FROM public.profiles WHERE plan IN ('essencial_mensal','essencial_anual','pro_mensal','pro_anual')),
            'totalSeparations',(SELECT COALESCE(SUM(cnt),0) FROM sep),
            'planDistribution', COALESCE((
                SELECT jsonb_object_agg(plan, cnt) FROM (
                    SELECT COALESCE(p.plan,'free') AS plan, COUNT(*) AS cnt
                    FROM auth.users u
                    LEFT JOIN public.profiles p ON p.id = u.id
                    GROUP BY 1
                ) d
            ), '{}'::jsonb),
            'users', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', u.id,
                    'email', u.email,
                    'display_name', COALESCE(p.display_name, u.raw_user_meta_data ->> 'full_name'),
                    'provider', COALESCE(p.provider, u.raw_app_meta_data ->> 'provider'),
                    'created_at', u.created_at,
                    'last_sign_in_at', u.last_sign_in_at,
                    'is_active', (u.last_sign_in_at >= now() - interval '30 days'),
                    'plan', COALESCE(p.plan, 'free'),
                    'separations_count', COALESCE(s.cnt, 0),
                    'total_paid', COALESCE(py.total_paid, 0),
                    'exact_monthly_brl', CASE
                        WHEN py.last_value IS NULL THEN NULL
                        WHEN py.last_cycle = 'YEARLY' THEN round((py.last_value / 12)::numeric, 2)
                        ELSE py.last_value
                    END
                ) ORDER BY u.created_at DESC)
                FROM auth.users u
                LEFT JOIN public.profiles p ON p.id = u.id
                LEFT JOIN sep s ON s.user_id = u.id
                LEFT JOIN pay py ON py.user_id = u.id
            ), '[]'::jsonb)
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

-- ─── 6. Primeiro admin (a única linha com o e-mail) ─────────────────────────
update public.profiles set is_admin = true where id in (select id from auth.users where lower(email) = 'arynelson11@gmail.com');

commit;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────
-- Espera 1 linha: a conta do dono.
select id, email from public.profiles where is_admin;
-- Espera 0 linhas: nenhuma policy decide mais pelo e-mail.
select schemaname, tablename, policyname from pg_policies where coalesce(qual,'') || coalesce(with_check,'') like '%arynelson11@gmail.com%';
-- Espera no máximo user_has_cloud_library, que o db/supabase_assinaturas.sql troca logo
-- depois (ordem do lançamento). Qualquer outra função aqui: parar e avisar.
select proname from pg_proc where prosrc like '%arynelson11@gmail.com%';
