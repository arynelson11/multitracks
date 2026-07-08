-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Ownership de predictions do Replicate (fecha IDOR em check-separation) ║
-- ║  Rodar uma vez no Supabase SQL Editor ANTES de publicar o deploy.       ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Por que existe: sem essa tabela, qualquer usuário autenticado conseguia
-- consultar a separação de qualquer outro por ID (check-separation.ts).
-- O backend grava aqui o dono de cada prediction (separate-audio.ts) e valida
-- na consulta (check-separation.ts). Acesso é 100% via service_role (backend);
-- RLS habilitada sem policy nega anon/authenticated por padrão.

create table if not exists public.predictions (
  replicate_id text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists predictions_user_idx
  on public.predictions (user_id);

-- RLS habilitada e SEM policies: só o service_role (que bypassa RLS por design)
-- lê/escreve. anon e authenticated ficam sem acesso direto — a proteção real
-- está nos endpoints /api/separate-audio e /api/check-separation.
alter table public.predictions enable row level security;
