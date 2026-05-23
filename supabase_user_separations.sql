-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Biblioteca de separações por usuário — backup em nuvem.            ║
-- ║  Rodar uma vez no Supabase SQL Editor.                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create table if not exists public.user_separations (
  id          text primary key,                                       -- preserva ID local ("sep_<ts>_<rand>")
  user_id     uuid not null references auth.users(id) on delete cascade,
  song_name   text not null,
  artist      text not null default '',
  bpm         text not null default '120',
  song_key    text not null default 'C',
  stems       jsonb not null default '[]'::jsonb,
  voice_cues  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists user_separations_user_created_idx
  on public.user_separations (user_id, created_at desc);

alter table public.user_separations enable row level security;

drop policy if exists "user_separations_select_own" on public.user_separations;
drop policy if exists "user_separations_insert_own" on public.user_separations;
drop policy if exists "user_separations_update_own" on public.user_separations;
drop policy if exists "user_separations_delete_own" on public.user_separations;

create policy "user_separations_select_own"
  on public.user_separations for select
  using (auth.uid() = user_id);

create policy "user_separations_insert_own"
  on public.user_separations for insert
  with check (auth.uid() = user_id);

create policy "user_separations_update_own"
  on public.user_separations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_separations_delete_own"
  on public.user_separations for delete
  using (auth.uid() = user_id);

-- Trigger pra manter updated_at em sync
create or replace function public.tg_user_separations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists user_separations_updated_at on public.user_separations;
create trigger user_separations_updated_at
  before update on public.user_separations
  for each row execute function public.tg_user_separations_updated_at();
