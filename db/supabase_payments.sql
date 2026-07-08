-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Histórico durável de pagamentos por usuário (unit economics).          ║
-- ║  Gravado pelo webhook do Asaas no CHECKOUT_PAID. Leitura só admin.       ║
-- ║  Rodar uma vez no Supabase SQL Editor.                                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝
create table if not exists public.payments (
  id                text primary key,                 -- checkout id do Asaas (idempotente)
  user_id           uuid not null references auth.users(id) on delete cascade,
  plan_key          text not null,
  value             numeric not null,                 -- em reais
  cycle             text,                             -- MONTHLY | YEARLY
  paid_at           timestamptz not null default now(),
  asaas_checkout_id text
);

create index if not exists payments_user_idx on public.payments (user_id);
create index if not exists payments_paid_at_idx on public.payments (paid_at);

alter table public.payments enable row level security;

-- Leitura: só o admin (mesmo padrão de profiles).
drop policy if exists "payments_admin_read" on public.payments;
create policy "payments_admin_read"
  on public.payments for select
  using (auth.jwt() ->> 'email' = 'arynelson11@gmail.com');

-- Sem policy de insert/update/delete: só o service_role (webhook) escreve
-- (service_role bypassa RLS por design).
