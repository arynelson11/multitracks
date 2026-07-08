# Painel Administrativo `/admin` — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma página dedicada `/admin` (só para o email admin) com dados reais de usuários, planos, receita, custo de IA por usuário e sinais de uso, mais o fix de segurança do email admin que não pertence ao dono.

**Architecture:** Rota manual no SPA (padrão do `/download`), renderizando um `AdminApp` code-split. Dados vêm do RPC `get_admin_dashboard_stats` (expandido para plano/atividade reais), do endpoint `admin-stats` (Asaas + Replicate, expandidos com MRR e custo por usuário) e de uma nova tabela `payments` gravada pelo webhook. Cálculos de margem/lucro no cliente (`metrics.ts`).

**Tech Stack:** Vite + React 19 + TypeScript, Tailwind v4, lucide-react, Supabase (auth/DB/RPC), Vercel serverless (`api/*`), Asaas (pagamento), Replicate (IA).

## Global Constraints

- **Admin único:** `arynelson11@gmail.com`. O email `arynel11@gmail.com` **não é do dono** e deve ser removido de TODOS os gates. Nunca reintroduzir.
- **Sem test runner:** o repo não tem vitest/jest. Verificação de cada task = `npm run build` (typecheck via `tsc -b`) + `npm run lint` + checagem funcional (curl/browser). Não instalar framework de teste.
- **Copy sem travessão:** nunca usar em dash (`—`) em texto visível ao usuário. Usar pontos/vírgulas. (No código/comentários pode.)
- **Termo canônico:** "separação de faixas" / "multitracks" (não "stems" como termo principal) em texto visível.
- **Deploy conjunto:** toda mudança sai para web (Vercel) e desktop (Electron Mac AS/Intel + Win). Chamadas de API no front usam sempre `apiUrl()` (desktop aponta para produção) e `getAuthHeaders()`.
- **Segurança server-side:** o front esconde UI, mas toda fonte de dados revalida admin no servidor (`verifyAdmin` nos endpoints; gate de email no RPC). O front nunca é a única trava.
- **Planos (IDs internos, não mudar):** `free`, `essencial_mensal` (Pro Mensal R$49,90), `essencial_anual` (Pro Anual R$454,80/ano = R$37,90/mês), `pro_mensal` (Studio Mensal R$119,90), `pro_anual` (Studio Anual R$1.078,80/ano = R$89,90/mês). Nomes exibidos: Livre / Pro / Studio via `planDisplayName()`.
- **Câmbio:** constante `USD_BRL = 5.4` (estimativa, rotular como tal). Sem API de câmbio.
- **FATOS:** ao final, atualizar `PLAYBACK_STUDIO_FATOS.md` (seção Admin + linha datada no histórico).

---

## Arquivos (mapa)

**Fase A — dados (backend/DB):**
- Modificar: `api/_lib/auth.ts` (remover email extra)
- Modificar: `src/App.tsx` (remover email extra dos gates de UI existentes)
- Criar: `src/lib/admin.ts` (allowlist única no front)
- Modificar: `db/supabase_rpc_setup.sql`, `db/supabase_admin_setup.sql`, `db/supabase_user_separations_plan_gate.sql` (remover email extra)
- Criar: `db/supabase_payments.sql` (tabela `payments`)
- Modificar: `api/webhook/asaas.ts` (gravar `payments`)
- Modificar: `db/supabase_rpc_setup.sql` (RPC com plano/atividade reais)
- Modificar: `api/admin-stats.ts` (Replicate: custo por usuário; Asaas: MRR + por plano)

**Fase B — UI (`src/admin/`):**
- Criar: `src/admin/lib/format.ts`, `src/admin/lib/metrics.ts`
- Criar: `src/admin/components/StatCard.tsx`, `DataTable.tsx`, `BarChart.tsx`
- Criar: `src/admin/hooks/useAdminGuard.ts`, `useAdminUsers.ts`, `useFinanceStats.ts`, `useAiCostStats.ts`
- Criar: `src/admin/AdminApp.tsx`, `AdminLogin.tsx`, `AdminShell.tsx`
- Criar: `src/admin/tabs/OverviewTab.tsx`, `UsersTab.tsx`, `FinanceTab.tsx`, `AiCostTab.tsx`, `UsageTab.tsx`
- Modificar: `src/App.tsx` (rota `/admin` → `AdminApp` lazy)

**Limpeza (final):**
- Remover: `src/components/AdminDashboard.tsx`, `src/components/AdminModal.tsx` (se não usado por mais nada) e botões Admin no `App.tsx`
- Mover/aposentar hooks: `src/hooks/useAdminDashboard.ts`, `useReplicateStats.ts`, `useAsaasStats.ts` (substituídos pelos de `src/admin/hooks/`)
- Modificar: `PLAYBACK_STUDIO_FATOS.md`

---

# FASE A — Fundação de dados

## Task 1: Fix de segurança — remover email admin que não é do dono

**Files:**
- Create: `src/lib/admin.ts`
- Modify: `api/_lib/auth.ts:3`
- Modify: `src/App.tsx` (linhas com `arynel11@gmail.com`: 872, 1938, 1947, 2080; e as só-`arynelson11` 1318, 1338, 1877 ficam)
- Modify: `db/supabase_admin_setup.sql:31`, `db/supabase_rpc_setup.sql` (array `admin_emails`), `db/supabase_user_separations_plan_gate.sql:31`

**Interfaces:**
- Produces: `src/lib/admin.ts` → `export const ADMIN_EMAILS: readonly string[]` e `export function isAdminEmail(email?: string | null): boolean`.

- [ ] **Step 1: Criar allowlist única no front**

Criar `src/lib/admin.ts`:

```ts
// Fonte única de "quem é admin" no front. O servidor tem a sua própria cópia
// em api/_lib/auth.ts (não dá pra importar de src/ no backend). Mantê-las em
// sincronia. O front é só gate de UI; a trava real é server-side.
export const ADMIN_EMAILS = ['arynelson11@gmail.com'] as const;

export function isAdminEmail(email?: string | null): boolean {
  return !!email && (ADMIN_EMAILS as readonly string[]).includes(email);
}
```

- [ ] **Step 2: Backend — remover email extra em `api/_lib/auth.ts`**

Trocar a linha 3:

```ts
const ADMIN_EMAILS = ['arynelson11@gmail.com'];
```

- [ ] **Step 3: Front — usar `isAdminEmail` no `App.tsx`**

Adicionar o import no topo do `src/App.tsx`:

```ts
import { isAdminEmail } from './lib/admin'
```

Substituir cada checagem `user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com'` por `isAdminEmail(user?.email)` (linhas ~872, ~1938, ~1947, ~2080). As checagens que já eram só `=== 'arynelson11@gmail.com'` (linhas ~1318, ~1338, ~1877) também trocar para `isAdminEmail(user?.email)` para uniformizar. Confirmar que sobrou zero ocorrência de `arynel11@gmail.com`:

Run: `grep -rn "arynel11@gmail.com" src/ api/`
Expected: nenhuma linha (exceto, se houver, comentário histórico — remover também).

- [ ] **Step 4: SQL — remover email extra nos três arquivos**

Em `db/supabase_admin_setup.sql` (policy `Admin can read all profiles`), `db/supabase_rpc_setup.sql` (array `admin_emails`) e `db/supabase_user_separations_plan_gate.sql` (`user_has_cloud_library`), trocar `('arynelson11@gmail.com', 'arynel11@gmail.com')` / `ARRAY['arynelson11@gmail.com', 'arynel11@gmail.com']` por apenas `arynelson11@gmail.com`. Ex. em `user_has_cloud_library`:

```sql
    or coalesce(auth.jwt() ->> 'email', '') = 'arynelson11@gmail.com';
```

Confirmar:

Run: `grep -rn "arynel11@gmail.com" db/`
Expected: nenhuma linha.

- [ ] **Step 5: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: sem erros de type/lint.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin.ts api/_lib/auth.ts src/App.tsx db/supabase_admin_setup.sql db/supabase_rpc_setup.sql db/supabase_user_separations_plan_gate.sql
git commit -m "fix(security): remove email admin nao-pertencente de todos os gates [admin]"
```

> **Nota de deploy:** os SQLs alterados precisam ser rodados no Supabase (feito no passo de deploy pelo @devops). Até rodar, o gate antigo continua no banco.

---

## Task 2: Tabela `payments` + gravação no webhook

**Files:**
- Create: `db/supabase_payments.sql`
- Modify: `api/webhook/asaas.ts` (bloco `CHECKOUT_PAID`, antes do delete em ~linha 85)

**Interfaces:**
- Produces: tabela `public.payments (id text pk, user_id uuid, plan_key text, value numeric, cycle text, paid_at timestamptz, asaas_checkout_id text)`. Leitura só admin; escrita só service_role.

- [ ] **Step 1: SQL da tabela**

Criar `db/supabase_payments.sql`:

```sql
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
```

- [ ] **Step 2: Webhook grava o pagamento antes de limpar `pending_checkouts`**

Em `api/webhook/asaas.ts`, adicionar uma tabela de valores no topo do arquivo (após `VALID_PLANS`):

```ts
// Valores por plano (espelha PLAN_PRICING de api/checkout.ts). Usado para
// registrar o pagamento em public.payments (unit economics).
const PLAN_VALUES: Record<string, { value: number; cycle: 'MONTHLY' | 'YEARLY' }> = {
  essencial_mensal: { value: 49.90, cycle: 'MONTHLY' },
  essencial_anual:  { value: 454.80, cycle: 'YEARLY' },
  pro_mensal:       { value: 119.90, cycle: 'MONTHLY' },
  pro_anual:        { value: 1078.80, cycle: 'YEARLY' },
};
```

No bloco `CHECKOUT_PAID`, logo após o `update` de `profiles` dar certo e ANTES do `delete` do `pending_checkouts` (~linha 84), inserir (best-effort, não derruba o sucesso):

```ts
    // Registra o pagamento para histórico por usuário (unit economics).
    // Upsert por checkout.id => idempotente se o Asaas reenviar o webhook.
    const priced = PLAN_VALUES[planKey];
    if (checkout?.id && priced) {
      const { error: payErr } = await supabase
        .from('payments')
        .upsert({
          id: checkout.id,
          user_id: userId,
          plan_key: planKey,
          value: priced.value,
          cycle: priced.cycle,
          asaas_checkout_id: checkout.id,
        }, { onConflict: 'id' });
      if (payErr) console.error('[asaas-webhook] payments insert failed:', payErr.message);
    }
```

- [ ] **Step 3: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add db/supabase_payments.sql api/webhook/asaas.ts
git commit -m "feat(admin): tabela payments durável gravada pelo webhook Asaas [admin]"
```

> **Verificação funcional (no deploy):** rodar `db/supabase_payments.sql`; fazer um checkout de teste no sandbox e confirmar que uma linha entra em `public.payments`.

---

## Task 3: RPC `get_admin_dashboard_stats` com plano e atividade reais

**Files:**
- Modify: `db/supabase_rpc_setup.sql` (corpo da função)

**Interfaces:**
- Produces: RPC retorna JSON:
  ```
  { totalUsers, activeUsers, inactiveUsers, newUsers7d, newUsers30d,
    paidSubscribers, totalSeparations,
    planDistribution: { <planKey>: <count>, ... },
    users: [ { id, email, display_name, provider, created_at,
               last_sign_in_at, is_active, plan, separations_count } ] }
  ```

- [ ] **Step 1: Reescrever o corpo do RETURN da função**

Em `db/supabase_rpc_setup.sql`, manter o cabeçalho (SECURITY DEFINER, search_path, gate de email — já com só `arynelson11@gmail.com` da Task 1) e substituir o bloco `RETURN (...)` por:

```sql
    RETURN (
        WITH sep AS (
            SELECT user_id, COUNT(*)::int AS cnt
            FROM public.predictions
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
                    'separations_count', COALESCE(s.cnt, 0)
                ) ORDER BY u.created_at DESC)
                FROM auth.users u
                LEFT JOIN public.profiles p ON p.id = u.id
                LEFT JOIN sep s ON s.user_id = u.id
            ), '[]'::jsonb)
        )
    );
```

- [ ] **Step 2: Sanidade do SQL (parse)**

Run: `grep -n "planDistribution\|separations_count\|arynel11" db/supabase_rpc_setup.sql`
Expected: aparece `planDistribution` e `separations_count`; **não** aparece `arynel11`.

- [ ] **Step 3: Commit**

```bash
git add db/supabase_rpc_setup.sql
git commit -m "feat(admin): RPC retorna plano/atividade/distribuicao reais [admin]"
```

> **Verificação funcional (no deploy):** rodar o SQL no Supabase; chamar o RPC logado como admin e conferir que `plan` reflete `profiles.plan` real e `planDistribution` bate com a base.

---

## Task 4: `admin-stats?source=replicate` — custo de IA por usuário

**Files:**
- Modify: `api/admin-stats.ts` (função `replicateStats` + imports)

**Interfaces:**
- Consumes: tabela `public.predictions (replicate_id, user_id)`.
- Produces: resposta de `?source=replicate` ganha campo `perUser: Array<{ userId: string; runs: number; costUSD: number; costUSD30d: number }>` (além dos campos atuais).

- [ ] **Step 1: Importar Supabase no endpoint**

No topo de `api/admin-stats.ts`, adicionar:

```ts
import { createClient } from '@supabase/supabase-js';
```

- [ ] **Step 2: Assinatura de `replicateStats` recebe custo por usuário**

Dentro de `replicateStats`, após construir `enriched` (que tem `id` e `cost` por prediction) e antes do `return res.status(200).json(...)`, adicionar o cruzamento com a tabela `predictions`:

```ts
    // Custo de IA por usuário: cruza predictions do Replicate (id + custo) com
    // a tabela public.predictions (replicate_id -> user_id) via service role.
    const perUser: Array<{ userId: string; runs: number; costUSD: number; costUSD30d: number }> = [];
    const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supaUrl && serviceKey) {
      try {
        const supabase = createClient(supaUrl, serviceKey);
        const ids = enriched.map(p => p.id);
        // Busca ownership em lotes (evita URL gigante no .in()).
        const ownerMap = new Map<string, string>(); // replicate_id -> user_id
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { data } = await supabase
            .from('predictions')
            .select('replicate_id, user_id')
            .in('replicate_id', slice);
          for (const row of data ?? []) ownerMap.set(row.replicate_id, row.user_id);
        }
        const agg = new Map<string, { runs: number; costUSD: number; costUSD30d: number }>();
        for (const p of enriched) {
          const uid = ownerMap.get(p.id);
          if (!uid) continue;
          const cur = agg.get(uid) ?? { runs: 0, costUSD: 0, costUSD30d: 0 };
          cur.runs += 1;
          cur.costUSD += p.cost;
          if (new Date(p.created_at) >= startOf30d) cur.costUSD30d += p.cost;
          agg.set(uid, cur);
        }
        for (const [userId, v] of agg) {
          perUser.push({
            userId,
            runs: v.runs,
            costUSD: parseFloat(v.costUSD.toFixed(4)),
            costUSD30d: parseFloat(v.costUSD30d.toFixed(4)),
          });
        }
      } catch (e: any) {
        console.error('[admin-stats] perUser cost join failed:', e?.message);
      }
    }
```

Adicionar `perUser` ao objeto do `return res.status(200).json({ ... })`.

- [ ] **Step 3: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add api/admin-stats.ts
git commit -m "feat(admin): custo de IA por usuario no endpoint replicate [admin]"
```

> **Verificação funcional (no deploy):** `curl -H "Authorization: Bearer <token-admin>" "https://playbackstudio.com.br/api/admin-stats?source=replicate"` e conferir que `perUser` traz `userId`/`costUSD` coerentes.

---

## Task 5: `admin-stats?source=asaas` — MRR e receita por plano

**Files:**
- Modify: `api/admin-stats.ts` (função `asaasStats`)

**Interfaces:**
- Produces: resposta de `?source=asaas` ganha `mrrBRL: number` e `revenueByPlan: Array<{ planKey: string; count: number; monthlyBRL: number }>`.

- [ ] **Step 1: Tabela de preços reversa dentro de `asaasStats`**

No topo de `asaasStats` (antes do `fetchAll`), adicionar:

```ts
  // Mapa valor+ciclo -> plano (espelha PLAN_PRICING de checkout.ts). Usado para
  // classificar assinaturas do Asaas por plano e calcular MRR.
  const PLAN_BY_VALUE: Record<string, string> = {
    '49.9|MONTHLY': 'essencial_mensal',
    '454.8|YEARLY': 'essencial_anual',
    '119.9|MONTHLY': 'pro_mensal',
    '1078.8|YEARLY': 'pro_anual',
  };
  const monthlyEquiv = (value: number, cycle: string) =>
    cycle === 'YEARLY' ? value / 12 : value;
```

- [ ] **Step 2: Calcular MRR e receita por plano a partir das assinaturas ativas**

Após `const activeSubscriptions = subscriptions.filter(...)`, adicionar:

```ts
  let mrrBRL = 0;
  const byPlan = new Map<string, { count: number; monthlyBRL: number }>();
  for (const s of activeSubscriptions) {
    const value = Number(s.value) || 0;
    const cycle = String(s.cycle || 'MONTHLY');
    const monthly = monthlyEquiv(value, cycle);
    mrrBRL += monthly;
    const key = PLAN_BY_VALUE[`${value}|${cycle}`] ?? 'desconhecido';
    const cur = byPlan.get(key) ?? { count: 0, monthlyBRL: 0 };
    cur.count += 1;
    cur.monthlyBRL += monthly;
    byPlan.set(key, cur);
  }
  const revenueByPlan = [...byPlan.entries()].map(([planKey, v]) => ({
    planKey,
    count: v.count,
    monthlyBRL: parseFloat(v.monthlyBRL.toFixed(2)),
  }));
```

Adicionar `mrrBRL: parseFloat(mrrBRL.toFixed(2))` e `revenueByPlan` ao objeto do `return res.status(200).json({ ... })`.

- [ ] **Step 3: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add api/admin-stats.ts
git commit -m "feat(admin): MRR e receita por plano no endpoint asaas [admin]"
```

---

# FASE B — UI do painel

## Task 6: Helpers compartilhados (`format.ts` + `metrics.ts`)

**Files:**
- Create: `src/admin/lib/format.ts`
- Create: `src/admin/lib/metrics.ts`

**Interfaces:**
- Produces `format.ts`: `fmtBRL(n)`, `fmtUSD(n)`, `fmtTime(seconds)`, `fmtDate(iso)`, `fmtShortDate(iso)`.
- Produces `metrics.ts`: `USD_BRL`, `PLAN_MONTHLY_BRL: Record<string,number>`, `planMonthlyBRL(plan)`, `usdToBRL(usd)`, `userMarginBRL({plan, costUSD, exactMonthlyBRL?})`.

- [ ] **Step 1: `format.ts`**

```ts
export function fmtBRL(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function fmtUSD(v: number): string {
  return v < 0.01 ? `$${(v || 0).toFixed(4)}` : `$${(v || 0).toFixed(2)}`;
}
export function fmtTime(seconds: number): string {
  const s = Math.round(seconds || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtShortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
```

- [ ] **Step 2: `metrics.ts`**

```ts
// Câmbio estimado (rotular como estimativa na UI). Sem API de câmbio (YAGNI).
export const USD_BRL = 5.4;

// Receita mensal-equivalente por plano (espelha PLAN_PRICING de checkout.ts;
// anual dividido por 12). Fonte para receita aproximada por usuário.
export const PLAN_MONTHLY_BRL: Record<string, number> = {
  free: 0,
  essencial_mensal: 49.90,
  essencial_anual: 37.90,
  pro_mensal: 119.90,
  pro_anual: 89.90,
};

export function planMonthlyBRL(plan: string | null | undefined): number {
  return PLAN_MONTHLY_BRL[(plan ?? 'free')] ?? 0;
}

export function usdToBRL(usd: number): number {
  return (usd || 0) * USD_BRL;
}

// Margem mensal por usuário: receita (exata se houver, senão aproximada pelo
// plano) menos custo de IA convertido em BRL.
export function userMarginBRL(args: { plan: string; costUSD: number; exactMonthlyBRL?: number }): number {
  const revenue = args.exactMonthlyBRL ?? planMonthlyBRL(args.plan);
  return revenue - usdToBRL(args.costUSD);
}
```

- [ ] **Step 3: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add src/admin/lib/format.ts src/admin/lib/metrics.ts
git commit -m "feat(admin): helpers de formatacao e metricas [admin]"
```

---

## Task 7: Componentes de UI reutilizáveis (`StatCard`, `DataTable`, `BarChart`)

**Files:**
- Create: `src/admin/components/StatCard.tsx`
- Create: `src/admin/components/DataTable.tsx`
- Create: `src/admin/components/BarChart.tsx`

**Interfaces:**
- Produces `StatCard`: `({ icon, label, value, subtext?, color, iconBg }: { icon: LucideIcon; label: string; value: string|number; subtext?: string; color: string; iconBg: string })`.
- Produces `DataTable`: `<T>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: string })` onde `Column<T> = { key: string; header: string; render: (row: T) => ReactNode; className?: string }`.
- Produces `BarChart`: `({ data, format }: { data: { label: string; value: number }[]; format?: (v:number)=>string })`.

- [ ] **Step 1: `StatCard.tsx`** (mesmo visual do card atual em `AdminDashboard.tsx`)

```tsx
import type { LucideIcon } from 'lucide-react';

export function StatCard({ icon: Icon, label, value, subtext, color, iconBg }: {
  icon: LucideIcon; label: string; value: string | number; subtext?: string; color: string; iconBg: string;
}) {
  return (
    <div className="daw-panel rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden group hover:border-white/10 transition-all">
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10 group-hover:opacity-20 transition-opacity" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg border" style={{ backgroundColor: iconBg, borderColor: `${color}30` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">{value}</span>
        {subtext && <span className="text-[10px] text-text-muted font-mono mb-1">{subtext}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `DataTable.tsx`**

```tsx
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, empty = 'Sem dados' }: {
  columns: Column<T>[]; rows: T[]; empty?: string;
}) {
  return (
    <div className="daw-panel rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
        {columns.map(c => <span key={c.key} className={c.className ?? 'flex-1'}>{c.header}</span>)}
      </div>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-text-muted/30 text-xs font-mono">{empty}</div>
      ) : (
        <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/3 transition-colors">
              {columns.map(c => <span key={c.key} className={c.className ?? 'flex-1'}>{c.render(row)}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `BarChart.tsx`** (barras em CSS, sem lib)

```tsx
export function BarChart({ data, format }: {
  data: { label: string; value: number }[]; format?: (v: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 0.0001);
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map(d => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 group">
          <span className="text-[8px] text-primary font-mono opacity-0 group-hover:opacity-100 transition-opacity">
            {format ? format(d.value) : d.value}
          </span>
          <div className="w-full rounded-t-sm bg-primary/20 border-t border-primary/50 transition-all"
            style={{ height: `${Math.max((d.value / max) * 100, 4)}%`, minHeight: '3px' }} />
          <span className="text-[8px] text-text-muted/60 font-mono">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add src/admin/components/
git commit -m "feat(admin): componentes StatCard/DataTable/BarChart [admin]"
```

---

## Task 8: Hooks de dados (`useAdminGuard`, `useAdminUsers`, `useFinanceStats`, `useAiCostStats`)

**Files:**
- Create: `src/admin/hooks/useAdminGuard.ts`
- Create: `src/admin/hooks/useAdminUsers.ts`
- Create: `src/admin/hooks/useFinanceStats.ts`
- Create: `src/admin/hooks/useAiCostStats.ts`

**Interfaces:**
- Consumes: `useAuth()` de `src/hooks/useAuth.ts` (`{ user, loading, signOut }`); `isAdminEmail` de `src/lib/admin.ts`; `apiUrl` de `src/lib/api.ts`; `getAuthHeaders`, `supabase` de `src/lib/supabase.ts`.
- Consumes: RPC `get_admin_dashboard_stats` (Task 3), endpoints `?source=asaas` (Task 5) e `?source=replicate` (Task 4).
- Produces tipos:
  - `AdminUser = { id; email; display_name: string|null; provider: string|null; created_at; last_sign_in_at: string|null; is_active: boolean; plan: string; separations_count: number }`
  - `UsersStats = { totalUsers; activeUsers; inactiveUsers; newUsers7d; newUsers30d; paidSubscribers; totalSeparations; planDistribution: Record<string,number>; users: AdminUser[] }`
  - `FinanceStats = { totalRevenueBRL; paidCount; totalCheckouts; activeSubscriptions; totalSubscriptions; mrrBRL; revenueByPlan: {planKey;count;monthlyBRL}[]; recent: {id;status;amount;createdAt:string|null}[] }`
  - `AiCostStats = { total; succeeded; failed; recentTotal; recentCostUSD; totalCostUSD; recentPredictTime; totalPredictTime; monthlyCosts:{month;cost}[]; topModels:{model;total;succeeded;totalTime;totalCost}[]; recentList:{id;model;status;source;created_at;predict_time:number|null;hardware;estimated_cost}[]; perUser:{userId;runs;costUSD;costUSD30d}[] }`
  - `useAdminGuard(): { status: 'loading'|'anon'|'denied'|'ok'; email: string|null; signOut: ()=>Promise<void> }`

- [ ] **Step 1: `useAdminGuard.ts`**

```ts
import { useAuth } from '../../hooks/useAuth';
import { isAdminEmail } from '../../lib/admin';

export type GuardStatus = 'loading' | 'anon' | 'denied' | 'ok';

export function useAdminGuard(): { status: GuardStatus; email: string | null; signOut: () => Promise<void> } {
  const { user, loading, signOut } = useAuth();
  let status: GuardStatus = 'loading';
  if (!loading) {
    if (!user) status = 'anon';
    else if (!isAdminEmail(user.email)) status = 'denied';
    else status = 'ok';
  }
  return { status, email: user?.email ?? null, signOut };
}
```

- [ ] **Step 2: `useAdminUsers.ts`** (RPC)

```ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

export interface AdminUser {
  id: string; email: string; display_name: string | null; provider: string | null;
  created_at: string; last_sign_in_at: string | null; is_active: boolean;
  plan: string; separations_count: number;
}
export interface UsersStats {
  totalUsers: number; activeUsers: number; inactiveUsers: number;
  newUsers7d: number; newUsers30d: number; paidSubscribers: number;
  totalSeparations: number; planDistribution: Record<string, number>; users: AdminUser[];
}

export function useAdminUsers() {
  const [stats, setStats] = useState<UsersStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!supabase) { setError('Supabase não configurado'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats');
      if (rpcError) throw new Error(`${rpcError.message}. Rodou o SQL do RPC no Supabase?`);
      setStats({
        totalUsers: data?.totalUsers ?? 0,
        activeUsers: data?.activeUsers ?? 0,
        inactiveUsers: data?.inactiveUsers ?? 0,
        newUsers7d: data?.newUsers7d ?? 0,
        newUsers30d: data?.newUsers30d ?? 0,
        paidSubscribers: data?.paidSubscribers ?? 0,
        totalSeparations: data?.totalSeparations ?? 0,
        planDistribution: data?.planDistribution ?? {},
        users: Array.isArray(data?.users) ? data.users : [],
      });
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar usuários');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}
```

- [ ] **Step 3: `useFinanceStats.ts`** (endpoint asaas)

```ts
import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../lib/api';
import { getAuthHeaders } from '../../lib/supabase';

export interface FinanceStats {
  totalRevenueBRL: number; paidCount: number; totalCheckouts: number;
  activeSubscriptions: number; totalSubscriptions: number; mrrBRL: number;
  revenueByPlan: { planKey: string; count: number; monthlyBRL: number }[];
  recent: { id: string; status: string; amount: number; createdAt: string | null }[];
}

export function useFinanceStats() {
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin-stats?source=asaas'), { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar financeiro');
      setStats(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}
```

- [ ] **Step 4: `useAiCostStats.ts`** (endpoint replicate)

```ts
import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../lib/api';
import { getAuthHeaders } from '../../lib/supabase';

export interface AiCostStats {
  total: number; succeeded: number; failed: number;
  recentTotal: number; recentCostUSD: number; totalCostUSD: number;
  recentPredictTime: number; totalPredictTime: number;
  monthlyCosts: { month: string; cost: number }[];
  topModels: { model: string; total: number; succeeded: number; totalTime: number; totalCost: number }[];
  recentList: { id: string; model: string; status: string; source: string; created_at: string; predict_time: number | null; hardware: string; estimated_cost: number }[];
  perUser: { userId: string; runs: number; costUSD: number; costUSD30d: number }[];
}

export function useAiCostStats() {
  const [stats, setStats] = useState<AiCostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin-stats?source=replicate'), { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar custos de IA');
      setStats(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}
```

- [ ] **Step 5: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add src/admin/hooks/
git commit -m "feat(admin): hooks de guard e dados do painel [admin]"
```

---

## Task 9: Casca do painel — rota, login, guard, abas (`AdminApp`, `AdminLogin`, `AdminShell`)

**Files:**
- Create: `src/admin/AdminLogin.tsx`
- Create: `src/admin/AdminShell.tsx`
- Create: `src/admin/AdminApp.tsx`
- Modify: `src/App.tsx` (rota `/admin`, ~linha 544 junto do `/download`)

**Interfaces:**
- Consumes: `useAdminGuard` (Task 8); `supabase` de `src/lib/supabase.ts`.
- Produces: `AdminShell` recebe `({ email, onSignOut, tabs }: { email: string|null; onSignOut: ()=>void; tabs: { id: string; label: string; icon: LucideIcon; content: ReactNode }[] })`. `AdminApp` é `export default`.

- [ ] **Step 1: `AdminLogin.tsx`** (login próprio do painel via Supabase)

```tsx
import { useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError('Supabase não configurado'); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('Email ou senha inválidos');
    setLoading(false);
    // Sucesso: onAuthStateChange do useAuth atualiza o guard automaticamente.
  };

  return (
    <div className="min-h-screen bg-[#0e0e10] flex items-center justify-center p-6">
      <form onSubmit={submit} className="daw-panel rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg border border-primary/20"><Shield size={20} className="text-primary" /></div>
          <div>
            <h1 className="text-white font-black text-sm uppercase tracking-wider">Painel Administrativo</h1>
            <p className="text-[10px] text-text-muted font-mono">Playback Studio</p>
          </div>
        </div>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="email"
          className="w-full daw-input text-white text-sm px-3 py-2.5 rounded-lg" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha" autoComplete="current-password"
          className="w-full daw-input text-white text-sm px-3 py-2.5 rounded-lg" />
        {error && <p className="text-accent-red text-xs font-mono">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-primary text-black font-bold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: `AdminShell.tsx`** (header + navegação de abas)

```tsx
import { useState, type ReactNode } from 'react';
import { Shield, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminTab { id: string; label: string; icon: LucideIcon; content: ReactNode; }

export function AdminShell({ email, onSignOut, tabs }: {
  email: string | null; onSignOut: () => void; tabs: AdminTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find(t => t.id === active) ?? tabs[0];

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border bg-[#141416] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg border border-primary/20"><Shield size={18} className="text-primary" /></div>
          <div>
            <h1 className="font-black text-xs uppercase tracking-wider">Painel Administrativo</h1>
            <p className="text-[10px] text-text-muted font-mono">{email}</p>
          </div>
        </div>
        <button onClick={onSignOut} className="flex items-center gap-1.5 text-text-muted hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">
          <LogOut size={14} /> Sair
        </button>
      </header>
      <nav className="flex gap-1 px-4 sm:px-6 pt-4 overflow-x-auto border-b border-border">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setActive(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg whitespace-nowrap transition-all ${active === t.id ? 'bg-[#141416] text-white border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </nav>
      <main className="p-4 sm:p-6 max-w-6xl mx-auto">{current?.content}</main>
    </div>
  );
}
```

- [ ] **Step 3: `AdminApp.tsx`** (guard + monta as abas)

```tsx
import { Loader2, LayoutDashboard, Users, DollarSign, Cpu, Activity } from 'lucide-react';
import { useAdminGuard } from './hooks/useAdminGuard';
import { AdminLogin } from './AdminLogin';
import { AdminShell } from './AdminShell';
import { OverviewTab } from './tabs/OverviewTab';
import { UsersTab } from './tabs/UsersTab';
import { FinanceTab } from './tabs/FinanceTab';
import { AiCostTab } from './tabs/AiCostTab';
import { UsageTab } from './tabs/UsageTab';

export default function AdminApp() {
  const { status, email, signOut } = useAdminGuard();

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#0e0e10] flex items-center justify-center"><Loader2 size={40} className="text-primary animate-spin" /></div>;
  }
  if (status === 'anon') return <AdminLogin />;
  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-[#0e0e10] flex flex-col items-center justify-center text-white px-6 gap-3">
        <h1 className="text-2xl font-black text-accent-red">Acesso negado</h1>
        <p className="text-text-muted text-sm">Esta conta não tem permissão de administrador.</p>
        <button onClick={signOut} className="text-primary text-sm underline">Trocar de conta</button>
      </div>
    );
  }

  return (
    <AdminShell email={email} onSignOut={signOut} tabs={[
      { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard, content: <OverviewTab /> },
      { id: 'users',    label: 'Usuários',    icon: Users,           content: <UsersTab /> },
      { id: 'finance',  label: 'Financeiro',  icon: DollarSign,      content: <FinanceTab /> },
      { id: 'aicost',   label: 'Custos IA',   icon: Cpu,             content: <AiCostTab /> },
      { id: 'usage',    label: 'Uso & Sinais',icon: Activity,        content: <UsageTab /> },
    ]} />
  );
}
```

- [ ] **Step 4: Rota `/admin` no `App.tsx`**

No topo de `src/App.tsx`, adicionar (junto dos outros imports):

```ts
import { lazy, Suspense } from 'react'
const AdminApp = lazy(() => import('./admin/AdminApp'))
```

(Se `lazy`/`Suspense` já vierem de um import `react` existente, só acrescentar os nomes.)

Logo antes do bloco do `/download` (~linha 543), adicionar:

```tsx
  // ───────────────── PAINEL ADMIN (/admin) ─────────────────
  if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0e0e10] flex items-center justify-center"><Loader2 size={40} className="text-orange-500 animate-spin" /></div>}>
        <AdminApp />
      </Suspense>
    )
  }
```

> As abas ainda não existem até a Task 10-12; para compilar esta task isoladamente, crie stubs mínimos primeiro (ver Step 5).

- [ ] **Step 5: Stubs temporários das abas (para compilar)**

Criar `src/admin/tabs/OverviewTab.tsx`, `UsersTab.tsx`, `FinanceTab.tsx`, `AiCostTab.tsx`, `UsageTab.tsx`, cada um com:

```tsx
export function OverviewTab() { return <div className="text-text-muted text-sm">Em construção.</div>; }
```

(ajustando o nome exportado por arquivo: `OverviewTab`, `UsersTab`, `FinanceTab`, `AiCostTab`, `UsageTab`).

- [ ] **Step 6: Build + lint + verificação funcional**

Run: `npm run build && npm run lint`
Expected: sem erros.

Verificação manual: `npm run dev`, abrir `http://localhost:5173/admin`:
- Deslogado → tela de login do painel.
- Logado como não-admin → "Acesso negado".
- Logado como `arynelson11@gmail.com` → casca com 5 abas ("Em construção").

- [ ] **Step 7: Commit**

```bash
git add src/admin/AdminApp.tsx src/admin/AdminLogin.tsx src/admin/AdminShell.tsx src/admin/tabs/ src/App.tsx
git commit -m "feat(admin): rota /admin com login proprio, guard e casca de abas [admin]"
```

---

## Task 10: Aba Usuários (com paga × custa × margem)

**Files:**
- Modify: `src/admin/tabs/UsersTab.tsx` (substituir o stub)

**Interfaces:**
- Consumes: `useAdminUsers` (`UsersStats`/`AdminUser`), `useAiCostStats` (`perUser`), `StatCard`, `DataTable`, `planDisplayName` de `src/lib/plans.ts`, `fmtBRL`/`fmtUSD`/`fmtDate`, `planMonthlyBRL`/`usdToBRL`/`userMarginBRL`.

- [ ] **Step 1: Implementar `UsersTab.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Users, UserCheck, UserX, Search, RefreshCw } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { planDisplayName } from '../../lib/plans';
import { fmtBRL, fmtUSD, fmtDate } from '../lib/format';
import { planMonthlyBRL, usdToBRL, userMarginBRL } from '../lib/metrics';

interface Row {
  id: string; name: string; email: string; plan: string; created_at: string;
  last_sign_in_at: string | null; is_active: boolean; separations: number;
  revenueBRL: number; costUSD: number; marginBRL: number;
}

export function UsersTab() {
  const { stats, loading, error, refetch } = useAdminUsers();
  const { stats: ai } = useAiCostStats();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'paid' | 'inactive' | 'negative'>('all');

  const costByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of ai?.perUser ?? []) m.set(u.userId, u.costUSD);
    return m;
  }, [ai]);

  const rows: Row[] = useMemo(() => {
    return (stats?.users ?? []).map(u => {
      const costUSD = costByUser.get(u.id) ?? 0;
      const revenueBRL = planMonthlyBRL(u.plan);
      return {
        id: u.id, name: u.display_name || u.email, email: u.email, plan: u.plan,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, is_active: u.is_active,
        separations: u.separations_count, revenueBRL, costUSD,
        marginBRL: userMarginBRL({ plan: u.plan, costUSD }),
      };
    });
  }, [stats, costByUser]);

  const filtered = rows.filter(r => {
    const matchQ = !q || r.email.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase());
    const matchF = filter === 'all' ? true
      : filter === 'paid' ? r.plan !== 'free'
      : filter === 'inactive' ? !r.is_active
      : r.marginBRL < 0;
    return matchQ && matchF;
  }).sort((a, b) => a.marginBRL - b.marginBRL); // pior margem primeiro

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 min-w-0', render: r => (
      <div className="min-w-0">
        <span className="text-xs text-white font-medium truncate block">{r.name}</span>
        <span className="text-[10px] text-text-muted/50 font-mono truncate block">{r.email}</span>
      </div>) },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center', render: r => (
      <span className={`text-[10px] font-bold ${r.plan === 'free' ? 'text-text-muted' : 'text-primary'}`}>{planDisplayName(r.plan)}</span>) },
    { key: 'sep', header: 'Sep.', className: 'w-12 text-center text-[10px] text-text-muted font-mono', render: r => r.separations },
    { key: 'rev', header: 'Paga/mês', className: 'w-20 text-right text-[10px] text-accent-green font-mono', render: r => fmtBRL(r.revenueBRL) },
    { key: 'cost', header: 'Custa IA', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono', render: r => fmtUSD(r.costUSD) },
    { key: 'margin', header: 'Margem/mês', className: 'w-24 text-right text-[10px] font-mono font-bold', render: r => (
      <span className={r.marginBRL < 0 ? 'text-accent-red' : 'text-accent-green'}>{fmtBRL(r.marginBRL)}</span>) },
    { key: 'signup', header: 'Cadastro', className: 'w-24 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtDate(r.created_at) },
  ];

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}     label="Total"       value={stats?.totalUsers ?? '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={UserCheck} label="Ativos 30d"  value={stats?.activeUsers ?? '—'} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={UserX}     label="Inativos"    value={stats?.inactiveUsers ?? '—'} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={Users}     label="Pagantes"    value={stats?.paidSubscribers ?? '—'} subtext={`${stats?.newUsers30d ?? 0} novos 30d`} color="#8b5cf6" iconBg="#8b5cf610" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por email ou nome..."
            className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-lg font-mono" />
        </div>
        <div className="flex lcd-display rounded-lg overflow-hidden border border-border shrink-0">
          {(['all','paid','inactive','negative'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 text-[9px] font-bold uppercase tracking-wider transition-all font-mono ${filter === f ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white'}`}>
              {f === 'all' ? 'Todos' : f === 'paid' ? 'Pagantes' : f === 'inactive' ? 'Inativos' : 'No vermelho'}
            </button>
          ))}
        </div>
        <button onClick={refetch} disabled={loading} className="p-2 text-text-muted hover:text-white rounded-lg disabled:opacity-30">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="text-[10px] text-text-muted/50 font-mono">Receita = plano atual × preço (aproximado). Custo IA = real (Replicate). Margem em BRL, câmbio estimado.</p>
      <DataTable columns={columns} rows={filtered} empty="Nenhum usuário encontrado" />
    </div>
  );
}
```

- [ ] **Step 2: Build + lint + verificação**

Run: `npm run build && npm run lint`
Expected: sem erros.

Verificação manual (`/admin` → Usuários): lista aparece com plano real, coluna Margem, filtro "No vermelho" mostra quem tem margem negativa, ordenação começa pela pior margem.

- [ ] **Step 3: Commit**

```bash
git add src/admin/tabs/UsersTab.tsx
git commit -m "feat(admin): aba Usuarios com paga x custa x margem [admin]"
```

---

## Task 11: Aba Financeiro

**Files:**
- Modify: `src/admin/tabs/FinanceTab.tsx`

**Interfaces:**
- Consumes: `useFinanceStats` (`FinanceStats`), `StatCard`, `DataTable`, `planDisplayName`, `fmtBRL`/`fmtShortDate`.

- [ ] **Step 1: Implementar `FinanceTab.tsx`**

```tsx
import { TrendingUp, Activity, DollarSign, RefreshCw } from 'lucide-react';
import { useFinanceStats } from '../hooks/useFinanceStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { planDisplayName } from '../../lib/plans';
import { fmtBRL, fmtShortDate } from '../lib/format';

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: 'text-accent-green', CONFIRMED: 'text-accent-green', ACTIVE: 'text-accent-green',
  PENDING: 'text-yellow-400', EXPIRED: 'text-text-muted', CANCELLED: 'text-accent-red',
};

export function FinanceTab() {
  const { stats, loading, error, refetch } = useFinanceStats();

  const planCols: Column<{ planKey: string; count: number; monthlyBRL: number }>[] = [
    { key: 'plan', header: 'Plano', className: 'flex-1', render: r => <span className="text-xs text-white">{planDisplayName(r.planKey)}</span> },
    { key: 'count', header: 'Assinantes', className: 'w-24 text-center text-[10px] text-text-muted font-mono', render: r => r.count },
    { key: 'mrr', header: 'MRR', className: 'w-24 text-right text-[10px] text-accent-green font-mono font-bold', render: r => fmtBRL(r.monthlyBRL) },
  ];

  const payCols: Column<{ id: string; status: string; amount: number; createdAt: string | null }>[] = [
    { key: 'id', header: 'ID', className: 'flex-1 text-[10px] text-text-muted font-mono truncate', render: r => r.id },
    { key: 'status', header: 'Status', className: `w-24 text-center text-[9px] font-bold`, render: r => <span className={STATUS_STYLE[r.status] ?? 'text-text-muted'}>{r.status}</span> },
    { key: 'amount', header: 'Valor', className: 'w-24 text-right text-[10px] text-accent-green font-mono', render: r => fmtBRL(r.amount) },
    { key: 'date', header: 'Data', className: 'w-20 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtShortDate(r.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><DollarSign size={14} className="text-accent-green" /> Financeiro (Asaas)</h3>
        <button onClick={refetch} disabled={loading} className="p-1.5 text-text-muted hover:text-white rounded-lg disabled:opacity-30"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Receita total" value={stats ? fmtBRL(stats.totalRevenueBRL) : '—'} subtext={stats ? `${stats.paidCount} pagos` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={DollarSign} label="MRR"           value={stats ? fmtBRL(stats.mrrBRL) : '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Activity}   label="Assinaturas"   value={stats?.activeSubscriptions ?? '—'} subtext={stats ? `${stats.totalSubscriptions} total` : ''} color="#8b5cf6" iconBg="#8b5cf610" />
        <StatCard icon={TrendingUp} label="Checkouts"     value={stats?.totalCheckouts ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
      </div>

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Receita por plano</span>
        <DataTable columns={planCols} rows={stats?.revenueByPlan ?? []} empty="Sem assinaturas ativas" />
      </div>
      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Últimos pagamentos</span>
        <DataTable columns={payCols} rows={stats?.recent ?? []} empty="Sem pagamentos" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add src/admin/tabs/FinanceTab.tsx
git commit -m "feat(admin): aba Financeiro (receita, MRR, por plano) [admin]"
```

---

## Task 12: Aba Custos IA

**Files:**
- Modify: `src/admin/tabs/AiCostTab.tsx`

**Interfaces:**
- Consumes: `useAiCostStats` (`AiCostStats`), `StatCard`, `DataTable`, `BarChart`, `fmtUSD`/`fmtTime`/`fmtShortDate`.

- [ ] **Step 1: Implementar `AiCostTab.tsx`**

```tsx
import { Cpu, Clock, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { BarChart } from '../components/BarChart';
import { fmtUSD, fmtTime, fmtShortDate } from '../lib/format';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export function AiCostTab() {
  const { stats, loading, error, refetch } = useAiCostStats();
  const avgPerRun = stats && stats.succeeded > 0 ? stats.totalCostUSD / stats.succeeded : 0;

  const modelCols: Column<AiModelRow>[] = [
    { key: 'model', header: 'Modelo', className: 'flex-1 text-xs text-white font-mono truncate', render: r => r.model.split('/').pop() },
    { key: 'runs', header: 'Runs', className: 'w-12 text-center text-[10px] text-text-muted font-mono', render: r => r.total },
    { key: 'time', header: 'Tempo', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtTime(r.totalTime) },
    { key: 'cost', header: 'Custo', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono font-bold', render: r => fmtUSD(r.totalCost) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><Cpu size={14} className="text-cyan-400" /> Custos de IA (Replicate)</h3>
        <button onClick={refetch} disabled={loading} className="p-1.5 text-text-muted hover:text-white rounded-lg disabled:opacity-30"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Gasto 30d"   value={stats ? fmtUSD(stats.recentCostUSD) : '—'} subtext={stats ? `${stats.recentTotal} runs` : ''} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={Clock}      label="Gasto total" value={stats ? fmtUSD(stats.totalCostUSD) : '—'} subtext={stats ? `${stats.total} runs` : ''} color="#f59e0b" iconBg="#f59e0b10" />
        <StatCard icon={Activity}   label="Sucesso"      value={stats && stats.total > 0 ? `${Math.round((stats.succeeded / stats.total) * 100)}%` : '—'} subtext={stats ? `${stats.failed} erros` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={Cpu}        label="Custo/sep."   value={fmtUSD(avgPerRun)} color="#06b6d4" iconBg="#06b6d410" />
      </div>

      {stats && stats.monthlyCosts.length > 0 && (
        <div className="daw-panel rounded-lg p-4 space-y-3">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Gasto mensal</span>
          <BarChart data={stats.monthlyCosts.map(c => ({ label: monthLabel(c.month), value: c.cost }))} format={fmtUSD} />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Últimas separações</span>
        <DataTable
          columns={[
            { key: 'id', header: 'ID', className: 'flex-1 text-[10px] text-text-muted font-mono truncate', render: r => r.id },
            { key: 'status', header: 'Status', className: 'w-16 text-center text-[9px] font-bold', render: r => <span className={r.status === 'succeeded' ? 'text-accent-green' : r.status === 'failed' ? 'text-accent-red' : 'text-text-muted'}>{r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'erro' : r.status}</span> },
            { key: 'time', header: 'Tempo', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => r.predict_time != null ? fmtTime(r.predict_time) : '—' },
            { key: 'cost', header: 'Custo', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono hidden sm:block', render: r => r.estimated_cost > 0 ? fmtUSD(r.estimated_cost) : '—' },
            { key: 'date', header: 'Data', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden md:block', render: r => fmtShortDate(r.created_at) },
          ]}
          rows={stats?.recentList ?? []} empty="Sem separações" />
      </div>

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Modelos</span>
        <DataTable columns={modelCols} rows={stats?.topModels ?? []} empty="Sem dados" />
      </div>
    </div>
  );
}

type AiModelRow = { model: string; total: number; succeeded: number; totalTime: number; totalCost: number };
```

- [ ] **Step 2: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add src/admin/tabs/AiCostTab.tsx
git commit -m "feat(admin): aba Custos IA (Replicate) [admin]"
```

---

## Task 13: Aba Uso & Sinais + Aba Visão Geral

**Files:**
- Modify: `src/admin/tabs/UsageTab.tsx`
- Modify: `src/admin/tabs/OverviewTab.tsx`

**Interfaces:**
- Consumes: `useAdminUsers`, `useAiCostStats`, `useFinanceStats`, `StatCard`, `DataTable`, `BarChart`, formatters, `metrics` (`usdToBRL`), `planDisplayName`.

- [ ] **Step 1: Implementar `UsageTab.tsx`** (sinais de uso: power users, sumidos, sucesso/erro)

```tsx
import { useMemo } from 'react';
import { Activity, Zap, UserX } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { BarChart } from '../components/BarChart';
import { planDisplayName } from '../../lib/plans';
import { fmtDate } from '../lib/format';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export function UsageTab() {
  const { stats } = useAdminUsers();
  const { stats: ai } = useAiCostStats();

  const users = stats?.users ?? [];
  const powerUsers = useMemo(() => [...users].sort((a, b) => b.separations_count - a.separations_count).slice(0, 10), [users]);
  const churned = useMemo(() => users.filter(u => !u.is_active && u.plan !== 'free'), [users]);

  const puCols: Column<typeof users[number]>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 text-xs text-white truncate', render: u => u.display_name || u.email },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center text-[10px] text-primary', render: u => planDisplayName(u.plan) },
    { key: 'sep', header: 'Separações', className: 'w-24 text-right text-[10px] text-text-muted font-mono', render: u => u.separations_count },
  ];
  const chCols: Column<typeof users[number]>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 text-xs text-white truncate', render: u => u.display_name || u.email },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center text-[10px] text-primary', render: u => planDisplayName(u.plan) },
    { key: 'last', header: 'Último acesso', className: 'w-28 text-right text-[10px] text-accent-red font-mono', render: u => fmtDate(u.last_sign_in_at) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={Activity} label="Separações totais" value={stats?.totalSeparations ?? '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Zap}      label="Taxa de sucesso"   value={ai && ai.total > 0 ? `${Math.round((ai.succeeded / ai.total) * 100)}%` : '—'} subtext={ai ? `${ai.failed} erros` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={UserX}    label="Pagantes sumidos"  value={churned.length} subtext="risco de churn" color="#ef4444" iconBg="#ef444410" />
      </div>

      {ai && ai.monthlyCosts.length > 0 && (
        <div className="daw-panel rounded-lg p-4 space-y-3">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Separações por mês (proxy: runs de IA)</span>
          <BarChart data={ai.monthlyCosts.map(c => ({ label: monthLabel(c.month), value: c.cost }))} />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono flex items-center gap-1.5"><Zap size={11} className="text-primary" /> Power users</span>
        <DataTable columns={puCols} rows={powerUsers} empty="Sem dados" />
      </div>
      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono flex items-center gap-1.5"><UserX size={11} className="text-accent-red" /> Pagantes que sumiram (mais de 30 dias sem entrar)</span>
        <DataTable columns={chCols} rows={churned} empty="Nenhum pagante sumido" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implementar `OverviewTab.tsx`** (raio-x: entra, sai, lucro)

```tsx
import { useMemo } from 'react';
import { TrendingUp, Cpu, DollarSign, Users, LayoutDashboard } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useFinanceStats } from '../hooks/useFinanceStats';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { fmtBRL, fmtUSD } from '../lib/format';
import { usdToBRL } from '../lib/metrics';

export function OverviewTab() {
  const { stats: users } = useAdminUsers();
  const { stats: fin } = useFinanceStats();
  const { stats: ai } = useAiCostStats();

  const profit = useMemo(() => {
    if (!fin || !ai) return null;
    return fin.totalRevenueBRL - usdToBRL(ai.totalCostUSD);
  }, [fin, ai]);

  return (
    <div className="space-y-4">
      <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><LayoutDashboard size={14} className="text-primary" /> Visão Geral</h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Entra (receita)" value={fin ? fmtBRL(fin.totalRevenueBRL) : '—'} subtext={fin ? `MRR ${fmtBRL(fin.mrrBRL)}` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={Cpu}        label="Sai (IA)"        value={ai ? fmtUSD(ai.totalCostUSD) : '—'} subtext={ai ? fmtBRL(usdToBRL(ai.totalCostUSD)) : ''} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={DollarSign} label="Lucro estimado"  value={profit != null ? fmtBRL(profit) : '—'} subtext="câmbio estimado" color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Users}      label="Usuários"        value={users?.totalUsers ?? '—'} subtext={users ? `${users.paidSubscribers} pagantes` : ''} color="#8b5cf6" iconBg="#8b5cf610" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}      label="Novos 7d"    value={users?.newUsers7d ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
        <StatCard icon={Users}      label="Novos 30d"   value={users?.newUsers30d ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
        <StatCard icon={DollarSign} label="Assinaturas" value={fin?.activeSubscriptions ?? '—'} color="#8b5cf6" iconBg="#8b5cf610" />
        <StatCard icon={Cpu}        label="Gasto IA 30d" value={ai ? fmtUSD(ai.recentCostUSD) : '—'} color="#f59e0b" iconBg="#f59e0b10" />
      </div>

      <p className="text-[10px] text-text-muted/50 font-mono">Lucro = receita total (Asaas) menos custo de IA (Replicate) convertido a câmbio estimado. Para margem por cliente, ver a aba Usuários.</p>
    </div>
  );
}
```

- [ ] **Step 3: Build + lint + verificação completa**

Run: `npm run build && npm run lint`
Expected: sem erros.

Verificação manual (`/admin`, logado como admin): as 5 abas carregam com dados; Visão Geral mostra entra/sai/lucro; números batem entre abas (ex.: total de usuários igual em Visão Geral e Usuários).

- [ ] **Step 4: Commit**

```bash
git add src/admin/tabs/UsageTab.tsx src/admin/tabs/OverviewTab.tsx
git commit -m "feat(admin): abas Uso & Sinais e Visao Geral [admin]"
```

---

## Task 14: Limpeza — remover admin antigo, atualizar FATOS

**Files:**
- Modify: `src/App.tsx` (remover imports/botões/estado do `AdminModal`/`AdminDashboard` que não são mais usados)
- Delete: `src/components/AdminDashboard.tsx`
- Modify/Delete: `src/components/AdminModal.tsx` (só deletar se não for o uploader de músicas usado noutro lugar — verificar antes)
- Modify: `PLAYBACK_STUDIO_FATOS.md`

- [ ] **Step 1: Descobrir o que o botão Admin antigo abre e se `AdminModal` tem outra função**

Run: `grep -n "AdminModal\|AdminDashboard\|isAdminOpen\|isAdminDashboardOpen\|useAdminUpload" src/App.tsx`
Expected: identificar que `AdminDashboard` é o painel-modal (a substituir) e `AdminModal` (o `isAdminOpen`) — confirmar se é uploader de músicas (usa `useAdminUpload`). **Se `AdminModal` for uploader, NÃO deletar** — apenas remover o `AdminDashboard`.

- [ ] **Step 2: Trocar o botão "ADMIN" para abrir `/admin`**

No `src/App.tsx`, os botões que hoje fazem `setIsAdminDashboardOpen(true)` (linhas ~873 e ~2081) passam a navegar para a página nova:

```tsx
<button onClick={() => { window.location.href = '/admin' }} ...>
```

Remover o estado `isAdminDashboardOpen` e a renderização `<AdminDashboard .../>` (linha ~1939) e o import `AdminDashboard` (linha 12).

- [ ] **Step 3: Deletar o componente antigo**

```bash
git rm src/components/AdminDashboard.tsx
```

(Não deletar `AdminModal.tsx` se for o uploader — confirmado no Step 1.)

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: sem erros e sem referência pendente a `AdminDashboard`.

Run: `grep -rn "AdminDashboard\|useAdminDashboard\|useAsaasStats\|useReplicateStats" src/`
Expected: nenhuma referência a `AdminDashboard`. (Os hooks antigos `useAdminDashboard`/`useAsaasStats`/`useReplicateStats` podem ser deletados também se nada mais os usa — remover neste passo se `grep` só apontar eles mesmos.)

- [ ] **Step 5: Atualizar `PLAYBACK_STUDIO_FATOS.md`**

- Seção "Admin": trocar para só `arynelson11@gmail.com` (remover `arynel11@gmail.com`) e adicionar uma linha: "Painel completo em playbackstudio.com.br/admin (login próprio, só admin): abas Visão Geral, Usuários, Financeiro, Custos IA, Uso & Sinais; unit economics por usuário (paga × custa × margem)."
- Adicionar linha datada no "Histórico de mudanças" (topo):

```markdown
### 2026-07-08 — Painel /admin completo + fix de segurança de admin
Nova página `playbackstudio.com.br/admin` (rota própria, code-split, login próprio, só `arynelson11@gmail.com`): 5 abas com dados reais (usuários/planos reais de profiles, receita e MRR do Asaas, custo de IA por usuário do Replicate cruzando a tabela predictions, sinais de uso e margem por cliente). Nova tabela `public.payments` gravada pelo webhook para histórico exato de receita por usuário. Removido o email admin `arynel11@gmail.com` (não pertencia ao dono) de todos os gates (auth.ts, RPC, RLS, user_has_cloud_library, App.tsx). SQLs a rodar: `supabase_payments.sql`, `supabase_rpc_setup.sql` atualizado, e os gates com email corrigido. Aposentado o antigo modal AdminDashboard.
```

- [ ] **Step 6: Commit final**

Run: `npm run build && npm run lint`
Expected: sem erros.

```bash
git add -A
git commit -m "chore(admin): aposenta modal antigo e atualiza FATOS [admin]"
```

> **Deploy (via @devops):** bump de versão + push + tag; rodar no Supabase `db/supabase_payments.sql`, `db/supabase_rpc_setup.sql` (atualizado) e os três SQL de gate com email corrigido. Testar o webhook/pagamento em sandbox antes de produção. Toda atualização sai para web + desktop.

---

## Self-Review (checado contra o spec)

- **Página `/admin` dedicada, login próprio, só admin** → Tasks 8 (guard), 9 (rota/login/casca). ✔
- **Reusa sessão (opção A)** → `useAdminGuard` usa `useAuth`. ✔
- **Fix email admin não-pertencente em todos os pontos** → Task 1 (front+backend+3 SQL) + Task 14 (FATOS). ✔
- **Plano/atividade reais** → Task 3 (RPC). ✔
- **Financeiro: receita, MRR, por plano** → Task 5 (endpoint) + Task 11 (aba). ✔
- **Custos IA + custo por usuário** → Task 4 (endpoint) + Task 12 (aba) + Task 10 (merge na aba Usuários). ✔
- **Unit economics: paga × custa × margem, destaque no vermelho, ordenável** → Task 6 (metrics) + Task 10 (aba Usuários). ✔
- **Receita exata futura: tabela payments no webhook** → Task 2. ✔
- **Uso & Sinais (power users, sumidos, sucesso/erro)** → Task 13. ✔
- **Visão Geral (entra/sai/lucro)** → Task 13. ✔
- **Code-split, não incha bundle** → Task 9 (`lazy`/`Suspense`). ✔
- **Sem lib de gráfico nova** → Task 7 (`BarChart` em CSS). ✔
- **Estados loading/erro/vazio por aba** → hooks retornam `loading`/`error`; `DataTable` tem `empty`. ✔
- **Copy sem travessão / termo "separações"** → textos usam "separações"/"multitracks"; sem `—`. ✔
- **Deploy web+desktop, FATOS atualizado** → Task 14 + nota de deploy. ✔

**Consistência de tipos:** `AdminUser.separations_count`, `perUser[].costUSD/costUSD30d`, `FinanceStats.mrrBRL/revenueByPlan`, `AiCostStats.perUser` — nomes idênticos entre RPC/endpoints (Fase A) e hooks/abas (Fase B). ✔

**Placeholders:** nenhum "TBD/TODO"; todo passo tem código real ou comando com saída esperada. ✔
