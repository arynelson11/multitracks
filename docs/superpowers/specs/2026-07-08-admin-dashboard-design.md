# Painel Administrativo `/admin` — Design

> **Data:** 2026-07-08
> **Autor:** Ary Nelson + Claude
> **Status:** aprovado o formato, aguardando revisão do spec

## 1. Problema

Hoje o "admin" do Playback Studio é um **modal dentro do app** (`AdminDashboard.tsx`), aberto por um botão na barra. Ele tem três defeitos que impedem o Ary de ter controle real do negócio:

1. **Dados falsos de plano.** O RPC `get_admin_dashboard_stats` lê de `auth.users` e crava `plan: 'free'`, `songs_count: 0`, `tokens_used: 0` para todo mundo. O plano real vive em `profiles.plan` (atualizado pelo webhook do Asaas) e nunca é lido. Ou seja, "quais planos assinaram" hoje é fake.
2. **É um modal, não uma página.** Não dá pra abrir `playbackstudio.com.br/admin` direto, com login próprio.
3. **Organização rasa.** Tudo empilhado numa tela só; sem abas, sem visão de lucro (entra − sai), sem sinais de uso.

## 2. Objetivo

Uma **página dedicada em `/admin`**, com acesso só do email admin, organizada em abas, mostrando **dados reais**: quem entrou, quantos são, quais planos assinaram, quanto entra de dinheiro, quanto sai em API do Replicate, lucro estimado, e sinais de uso (quem usa, quem sumiu, quem bate a cota).

## 3. Achado de segurança (corrigir junto)

O email `arynel11@gmail.com` está cravado como admin e **não pertence ao dono**. Quem registrar esse email hoje ganha admin + tudo ilimitado + leitura de todos os perfis. Remover de **todos** os pontos:

- `api/_lib/auth.ts` → `ADMIN_EMAILS`
- `db/supabase_rpc_setup.sql` → `admin_emails`
- `db/supabase_admin_setup.sql` → policy `Admin can read all profiles`
- `db/supabase_user_separations_plan_gate.sql` → `user_has_cloud_library()`
- `src/App.tsx` → checagem de admin (buscar a lista de emails)
- `PLAYBACK_STUDIO_FATOS.md` → seção Admin

**Fica só:** `arynelson11@gmail.com`. Para não repetir a lista em 5 lugares, centralizar num único ponto por camada: uma constante compartilhada no front, uma no `api/_lib/`, e (idealmente) migrar o gate do banco para ler uma allowlist única. Mínimo aceitável: um único email em todos os pontos, sem o email estranho.

## 4. Arquitetura

### 4.1 Rota

SPA Vite sem router; rotas são manuais via `window.location.pathname` (padrão já usado para `/download` em `src/App.tsx`). Seguir o mesmo padrão:

- Em `src/App.tsx` (ou num wrapper acima dele), se `pathname === '/admin'`, renderizar `<AdminApp />` (lazy) em vez do app normal.
- `AdminApp` é **code-split** (`React.lazy` + `Suspense`) para não pesar no bundle principal que os usuários comuns baixam.
- Vercel já reescreve tudo que não é `/api` para `index.html` (`vercel.json`), então `/admin` carrega o SPA normalmente. Nada muda no `vercel.json`.
- Funciona em web e desktop (Electron) sem config extra, porque é a mesma bundle.

### 4.2 Acesso (opção A — reusa sessão)

1. `AdminApp` lê a sessão Supabase atual.
2. Se **não logado** → tela de login própria do painel (email + senha via Supabase auth).
3. Se **logado mas não admin** → tela "acesso negado" (sem vazar que a rota existe além disso).
4. Se **logado e admin** → renderiza o dashboard.
5. O gate é **defesa em profundidade**: o front esconde a UI, mas os dados só vêm de endpoints/RPC que revalidam admin no servidor (já é assim em `verifyAdmin` e no RPC). O front nunca é a única trava.

### 4.3 Componentes (isolados, uma responsabilidade cada)

```
src/admin/
  AdminApp.tsx            # entry: roteia login/negado/dashboard; layout com abas
  AdminLogin.tsx          # tela de login própria do painel
  AdminShell.tsx          # header + navegação de abas + slot de conteúdo
  tabs/
    OverviewTab.tsx       # Visão Geral (KPIs consolidados + lucro)
    UsersTab.tsx          # Usuários (lista real, busca, filtros)
    FinanceTab.tsx        # Financeiro (Asaas: receita, MRR, por plano)
    AiCostTab.tsx         # Custos IA (Replicate)
    UsageTab.tsx          # Uso & Sinais (atividade, churn, cota)
  components/
    StatCard.tsx          # card de KPI reutilizável (extraído do atual)
    DataTable.tsx         # tabela genérica com header + linhas
    BarChart.tsx          # gráfico de barras simples (sem lib nova)
  hooks/
    useAdminUsers.ts      # RPC expandido (plano/atividade reais)
    useFinanceStats.ts    # admin-stats?source=asaas (expandido)
    useAiCostStats.ts     # admin-stats?source=replicate (já existe, renomear/reusar)
    useAdminGuard.ts      # sessão + checagem de admin
  lib/
    metrics.ts            # cálculos derivados (MRR, lucro, conversão, câmbio)
```

O modal atual (`AdminModal.tsx` / `AdminDashboard.tsx`) e o botão Admin na barra do app **são removidos** depois que o `/admin` estiver funcionando (uma coisa só, sem duplicar). Os hooks atuais (`useReplicateStats`, `useAsaasStats`, `useAdminDashboard`) são reaproveitados/movidos para `src/admin/hooks/`.

### 4.4 Dados

**a) Usuários e planos reais — RPC expandido `get_admin_dashboard_stats`:**
- Ler `plan`, `created_at`, `last_sign_in_at` de `profiles` (JOIN com `auth.users` para email/nome/provider).
- Por usuário: `plan` real, `songs_count` real (contar `public.songs` por dono, ou `user_separations`), separações no mês corrente (se houver tabela de quota/uso), status ativo (last_sign_in ≥ 30d).
- Agregados reais: total, novos 7d/30d, ativos, **distribuição por plano** (quantos em cada `plan`), assinantes pagos (plan ≠ free).
- Continua `SECURITY DEFINER` + `SET search_path` + gate de email admin (padrão do projeto).

**b) Financeiro — `admin-stats?source=asaas` (expandir):**
- Já retorna receita total, pagos, assinaturas ativas, recentes.
- Adicionar: **MRR** (soma do valor mensal das assinaturas ativas), **receita por plano** (mapear `subscription.value`/ciclo → plano via tabela de preços do `plans.ts`/`checkout.ts`), novos assinantes no mês.

**c) Custos IA — `admin-stats?source=replicate` (já pronto):**
- Total/30d de custo USD, por mês, por hardware, top models, runs, tempo de compute. Adicionar **custo médio por separação** (custo total ÷ nº de runs succeeded).

**d) Lucro — `src/admin/lib/metrics.ts` (cliente):**
- `lucroBRL = receitaBRL − (custoReplicateUSD × câmbioUSDBRL)`.
- Câmbio: constante configurável (ex.: `USD_BRL = 5.4`) com nota de que é estimativa. Sem chamar API de câmbio (YAGNI).

**e) Uso & Sinais — deriva do RPC + Replicate:**
- Separações ao longo do tempo (por mês, do Replicate).
- Taxa de sucesso/erro (do Replicate).
- Quem sumiu: usuários com `last_sign_in_at` > 30d (risco de churn), destacando os que já foram pagantes.
- Quem bate a cota: usuários próximos do limite do plano no mês (se a tabela de uso permitir).
- Power users: top por nº de separações.

### 4.5 Fluxo de dados

```
/admin  →  AdminApp  →  useAdminGuard (sessão Supabase)
                          ├─ não logado → AdminLogin
                          ├─ não admin  → Acesso negado
                          └─ admin      → AdminShell (abas)
                                            ├─ useAdminUsers      → supabase.rpc(get_admin_dashboard_stats)  [revalida admin]
                                            ├─ useFinanceStats    → GET /api/admin-stats?source=asaas        [verifyAdmin]
                                            ├─ useAiCostStats     → GET /api/admin-stats?source=replicate     [verifyAdmin]
                                            └─ metrics.ts         → deriva lucro/MRR/conversão no cliente
```

## 5. Erros e estados

- Cada aba tem **loading (skeleton)**, **erro** (mensagem clara, botão tentar de novo) e **vazio** ("sem dados ainda").
- Falha em uma fonte não derruba as outras (já é `Promise.allSettled` no endpoint; manter por-aba independente).
- Sessão expirada → volta pro login do painel.
- Erro de RPC (ex.: SQL não rodado) → mensagem dizendo qual SQL rodar (padrão atual já faz isso).

## 6. Segurança

- Front esconde UI, mas **toda** fonte de dados revalida admin no servidor (`verifyAdmin` nos endpoints, gate de email no RPC). Nunca confiar só no front.
- Remover o email não-pertencente (seção 3) antes de considerar pronto.
- Não expor a lista de emails admin no bundle além do estritamente necessário para o gate de UI (o servidor é a trava real).

## 7. Testes / verificação

- **Manual (obrigatório):** logar como admin em `/admin`, conferir cada aba com dados reais; logar como não-admin e confirmar bloqueio; deslogado e confirmar tela de login.
- Conferir que o número de assinantes/receita bate com o painel do Asaas.
- Conferir que o custo Replicate bate (ordem de grandeza) com o painel do Replicate.
- `npm run lint` e `npm run build` limpos.
- Confirmar que o bundle principal (usuário comum) **não** cresceu com o admin (code-split funcionando).
- Rodar os SQLs alterados no Supabase e confirmar que o RPC retorna plano real.

## 8. Fora de escopo (YAGNI)

- Sistema de feedback escrito pelo usuário (o dono confirmou que "feedbacks" = sinais de uso).
- Ações de escrita no painel (banir usuário, mudar plano manual, reembolso) — só leitura nesta versão.
- API de câmbio em tempo real (constante basta).
- `react-router` ou entrada Vite separada.
- Gráficos com biblioteca externa (barras simples em CSS/SVG bastam, sem dependência nova).

## 9. Deploy

Segue a regra do projeto: toda atualização sai junto para **web (Vercel) e desktop (Electron Mac AS/Intel, Win)** via bump + push + tag pelo @devops. SQLs alterados rodam no Supabase no passo do deploy. Atualizar `PLAYBACK_STUDIO_FATOS.md` (seção Admin + linha no histórico) no mesmo passo.
