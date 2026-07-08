-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Biblioteca de separações em nuvem = recurso PAGO (Pro/Studio).         ║
-- ║  Trava server-side via RLS. Rodar uma vez no Supabase SQL Editor.       ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Por que existe: antes, QUALQUER usuário logado (inclusive Livre) escrevia em
-- user_separations e ganhava biblioteca em nuvem/sincronização de graça — sem
-- nenhum esforço, automático. O Livre deve usar só a biblioteca LOCAL (IndexedDB
-- no navegador). Esta política impede o Livre de gravar/atualizar na nuvem.
--
-- SELECT e DELETE seguem por dono (permite exportar/limpar dados existentes,
-- ex.: se um pagante fizer downgrade). Só INSERT e UPDATE exigem plano pago.

-- Helper: o usuário atual tem direito à biblioteca em nuvem?
-- SECURITY DEFINER lê profiles ignorando RLS (roda como owner). search_path
-- travado contra ataque de search_path (padrão do projeto).
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
         from public.profiles p
        where p.id = auth.uid()),
      false
    )
    or coalesce(auth.jwt() ->> 'email', '') in ('arynelson11@gmail.com', 'arynel11@gmail.com');
$$;

revoke execute on function public.user_has_cloud_library() from public, anon;
grant  execute on function public.user_has_cloud_library() to authenticated;

-- INSERT: além de ser dono, precisa ter plano com biblioteca em nuvem.
drop policy if exists "user_separations_insert_own"  on public.user_separations;
drop policy if exists "user_separations_insert_paid" on public.user_separations;
create policy "user_separations_insert_paid"
  on public.user_separations for insert
  with check (auth.uid() = user_id and public.user_has_cloud_library());

-- UPDATE: idem.
drop policy if exists "user_separations_update_own"  on public.user_separations;
drop policy if exists "user_separations_update_paid" on public.user_separations;
create policy "user_separations_update_paid"
  on public.user_separations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.user_has_cloud_library());

-- SELECT e DELETE continuam por dono (não recriar se já existem).
-- (As políticas user_separations_select_own / _delete_own permanecem como estão.)

-- Verificação rápida: lista as políticas atuais da tabela.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'user_separations'
order by policyname;
