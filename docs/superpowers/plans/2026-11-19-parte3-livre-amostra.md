# Parte 3, partes 0 e 1: Livre como amostra, anúncio da casa e oferta do primeiro mês (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Medir o funil no admin e guardar o plano no aparelho primeiro; depois ligar o Livre como amostra (3 separações em 4 ou 6 faixas, 3 músicas diferentes por mês no palco, Ao Vivo com 1 celular e 10 minutos por dia), o anúncio da casa só com a música parada e a oferta do primeiro mês (Pro R$ 24,90, Studio R$ 59,90), sobre peças base no estilo do palco.

**Arquitetura:** O que custa dinheiro é barrado no servidor: cota e faixas em `api/separate-audio.ts`, desconto conferido em `api/checkout.ts`, volta ao preço cheio por pendência em `api/_lib/billing.ts`. O resto do Livre é contado no aparelho por regras puras (`src/lib/livreRules.ts`) num store local compartilhado (`src/lib/livreStore.ts`), servido pelo hook `useLivre`, que só deixa aparecer tela por cima com o motor parado (`isPlaying` e `isCountingIn` falsos). Eventos e oferta são escritos só pelo servidor, em tabelas novas, por `?action=` em `api/checkout.ts` (usuário) e `api/admin-stats.ts` (admin), sem arquivo novo em `api/`.

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4 (tokens `ps-*`, peças de `src/components/ui/` e `src/components/stage/`) + Electron 42 (roda de `file://`) + Vercel Functions + Supabase (Postgres, RLS, funções `security definer`) + Asaas (só por mock nos testes) + Vitest 4/jsdom/Testing Library + Postgres descartável (`~/playback-studio-work/admin-sql-tests/run-all.sh`).

**Spec:** `docs/superpowers/specs/2026-11-19-parte3-telas-e-livre-design.md` (autoridade): seções 1 a 7, 9b, 10A partes (0) e (1), 11 e 12; da seção 8 só a regra "separação do mês sempre abre", aplicada ao player de hoje do Separador. Fatos: `PLAYBACK_STUDIO_FATOS.md`. Visual: `DESIGN_SYSTEM.md` 1.7, 2.6 e 2.7. Estilo e convenções: `docs/superpowers/plans/2026-11-15-parte2-palco-novo.md` e `docs/superpowers/plans/2026-11-17-admin-central.md`.

## Global Constraints

- Português do Brasil em tudo. Nenhum travessão (caractere U+2014) em texto de interface, mensagem do servidor, nota de pendência, comentário novo, doc ou commit. Nos testes, `const TRAVESSAO = String.fromCharCode(0x2014)`, nunca o caractere no código.
- Copy: resultado antes de recurso, sem prometer número de vendas, "multitracks" e "separação de faixas" (nunca "stems" em texto de interface).
- Valores do spec (sempre estes): Livre **3 separações por mês, em 4 ou 6 faixas**; **até 3 músicas diferentes por mês no palco** (separadas, importadas ou do catálogo); Ao Vivo do Livre **1 celular, uma sessão de até 10 minutos por dia**, contador zera **à meia-noite de Brasília**; Pro 50 e Studio 150 separações (sem mudança). Oferta: **Pro Mensal R$ 24,90** no primeiro mês (cheio R$ 49,90), **Studio Mensal R$ 59,90** (cheio R$ 119,90), anual sem oferta; janela de **48 horas** a partir da primeira vez que aparece naquele mês, relógio visível; **volta uma vez por mês** até assinar; registro **um por conta e por mês**; só na **primeira assinatura da conta**. Plano guardado no aparelho vale offline **até a data de fim do plano ou 30 dias sem conferir, o que vier antes**.
- Nunca anúncio, oferta, aviso de limite ou tela por cima aparecendo **com a música tocando ou na pré-contagem** (o estado vem do motor: `isPlaying` e `isCountingIn`). Nenhum limite do Livre para o som: o limite só vale na hora de abrir a próxima. No máximo **um anúncio grande por sessão** além da tela de limite; o selo é permanente e discreto.
- Mês e dia sempre os de Brasília (`America/Sao_Paulo`); a cota segue no `consume_separation_token` por mês civil de Brasília.
- No máximo 12 funções em `api/` (Hobby da Vercel). Nenhum arquivo novo na raiz de `api/`: ação de usuário é `?action=` em `api/checkout.ts`; ação de admin é `?action=` em `api/admin-stats.ts`. `api/_lib/` e `api/__tests__/` não contam (`api/__tests__/functions-limit.test.ts` continua passando com 12).
- App de computador (`file://`): API só por `apiUrl()`, nenhum caminho absoluto `/` pra asset, link externo só por `openExternalUrl()`, nenhum `window.prompt`, `window.alert` ou `window.confirm` novo (os que já existem ficam, menos os que este plano troca pela tela de limite).
- Segurança (padrões do projeto): tabela nova com RLS ligada e `revoke all ... from anon, authenticated`; função nova `security definer`, `set search_path = public, pg_temp`, `revoke execute ... from public, anon, authenticated` e `grant execute ... to service_role`. Cada arquivo SQL em transação, `set local lock_timeout = '5s'`, `set local statement_timeout = '60s'`, idempotente (roda duas vezes no teste), com conferência no fim que dá `raise exception` se faltar coluna, CHECK ou função. Escrita de evento e de oferta só pelo servidor. Nenhum dado pessoal nos eventos além da conta (`user_id`). O CPF nunca é guardado nem registrado em log: só o HMAC-SHA256 dele.
- SQL só fica escrito. Rodar na produção é passo de publicação, **só com o OK do dono**. Testes SQL só no Postgres descartável: `PBS_REPO=~/playback-studio-work/parte2 bash ~/playback-studio-work/admin-sql-tests/run-all.sh <arquivo>`.
- Asaas só por mock nos testes (`createFakeAsaas` e `createBillingDb` de `api/__tests__/billingHarness.ts`). Nenhuma chamada de rede.
- Visual: só tokens `ps-*` e peças de `src/components/ui/` e `src/components/stage/`. Laranja (`ps-or`) = ligado ou ação principal; branco (`ps-arm`) = armado; âmbar (`ps-alert`) = alerta. Números com `ps-num`. Alvos de toque de pelo menos 44 px (`min-h-ps-touch`). Nenhum texto encostando na borda ou cortado; botão com largura pelo texto. Nada de restyle de outras telas nesta parte.
- Quem paga não perde nada. O palco antigo (Configurações > Geral > Palco > Antigo) recebe os mesmos limites e a tela de limite, sem restyle e sem selo. Admin (`isAdmin`) nunca tem limite do Livre.
- Testes: teste de DOM começa com `// @vitest-environment jsdom` e chama `afterEach(cleanup)`; sem `jest-dom` e sem `user-event` (`fireEvent` e asserções nativas). `.tsx` exporta só componentes (ESLint `react-refresh/only-export-components`); funções e constantes vão pra um `.ts` ao lado. Ref não é escrito durante a renderização (`react-hooks/refs`). Leitura de arquivo (`node:fs`) só dentro do próprio `*.test.ts`. Teste de API importa o handler e usa `createRes()` de `api/__tests__/fakeSupabase.ts`.
- Execução: clone `~/playback-studio-work/parte2`, branch `feat/parte3-telas-livre`. Todo comando começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd ~/playback-studio-work/parte2` e manda saída longa pra `$LOGS`. Commits convencionais terminando com `[Parte 3] [T<N>]`, sempre `git add <arquivo>` por nome. Nada de push, tag ou publicação: só o @devops, web + Mac + Windows juntos, depois do dono aprovar.
- Documentação viva: toda tarefa que muda comportamento atualiza `PLAYBACK_STUDIO_FATOS.md` (e `DESIGN_SYSTEM.md` quando cria peça visual) **no mesmo commit**, marcando "(não publicado)". A T20 consolida e escreve a entrada do Histórico.

## Review Focus

Os cinco casos que o spec implica e que mais machucam quem usa, com o teste que prende cada um na tarefa dona do código:

1. **Quem paga, no culto, sem internet** (app de computador offline): abrir como Livre e bater nas 3 músicas. Esperado: vale o último plano conhecido até a data de fim ou 30 dias sem conferir. Testes: T4 `sem internet, a conta que pagava abre com o plano guardado`, T4 `30 dias e 1 minuto sem conferir: o plano guardado não vale`, T15 `conta paga nunca vê limite nem selo`.
2. **Tela por cima com a música tocando por um caminho indireto**: a banda aperta "próxima" ou escolhe música pelo celular, os 10 minutos do Ao Vivo acabam no meio da música, a pessoa toca play com a tela de limite aberta. Esperado: nada aparece tocando; o som nunca para; a tela aparece uma vez quando a música para. Testes: T6 `queueRequest com a música tocando guarda e só mostra quando para`, T6 `tocando com a tela aberta, a tela sai e não volta sozinha`, T15 `os 10 minutos acabam com a música tocando: a banda sai na hora e a tela só aparece quando a música para`, T8 `o selo some com a música tocando e na pré-contagem`, T17 `comandos next, prev e select-song da banda passam pelas versões com o Livre`, T18 `o anúncio da tela inicial não aparece com a música tocando`.
3. **Assinatura que fica com o preço do desconto pra sempre** (Asaas fora na troca, assinatura ainda sem id, aviso do Asaas repetido, duas compras com desconto, arrependimento antes da troca). Esperado: toda compra com desconto ganha a pendência de voltar ao preço cheio, que insiste até dar certo e aparece em Pendências. Testes: T13 `Asaas fora na troca: a pendência restore_full_price fica aberta e a próxima rodada troca e fecha`, T13 `dois checkouts com desconto pagos: cada um ganha a sua pendência`, T13 `assinatura encerrada antes da troca fecha a pendência sem chamar o Asaas`, T13 `marcar como feito com o Asaas ainda em 24,90 é recusado`.
4. **Versões misturadas na produção**: qualquer app anterior à Publicação 1b (v1.4.21, v1.4.22 da Publicação 1a e v1.4.23; Ruling R18) mandando 2 faixas no Livre; código novo no ar antes do SQL da oferta. Esperado: o antigo continua separando (com a cota nova); o webhook ativa normal sem as colunas novas; a tela abre sem oferta. Testes: T11 `Livre no app antigo pedindo 2 faixas ainda separa`, T13 `sem as colunas da oferta (SQL ainda não rodou) o CHECKOUT_PAID ativa normal`, T12 `erro do banco na oferta: 200 com status none`.
5. **Virada do dia e do mês em Brasília** (23:30 de 30/11 em Brasília já é 01/12 em UTC): contador de músicas, 10 minutos do Ao Vivo, janela de 48 h que atravessa o mês, cadastro no funil. Esperado: conta no dia e no mês de Brasília; janela aberta no fim do mês continua valendo e não abre outra. Testes: T6 `às 23:30 de 30/11 em Brasília ainda é novembro` (o `brtMonth`, que já existia), os novos da R13: T6 `brtDay: 23:30 de 30/11 em Brasília ainda é 30/11; à meia-noite vira 01/12`, T6 `brtDay aceita texto ISO e vira o ano no fuso de Brasília` e T6 `a meia-noite de Brasília zera os minutos (03:00 UTC)` (`src/lib/livreRules.test.ts`), T6 `música aberta às 23:30 de 30/11 em Brasília conta em novembro; à meia-noite começa dezembro` e T6 `a meia-noite de Brasília zera os minutos guardados` (`src/lib/livreStore.test.ts`), T6 `liveLedgerFor de outro dia de Brasília volta zerado`, T10 `janela aberta em 30/11 às 21:00 de Brasília vale em 01/12 e não abre outra`, T1 `cadastro às 23:30 de 30/11 em Brasília conta em novembro`.

---

## Decisões deste plano (o dono confere)

O spec deixou estes pontos pro construtor ou não decidiu. Cada um vale até o dono mudar.

- **D1. Duas publicações dentro desta parte.** 1a = Onda 1 (funil no admin, tabela de eventos e plano guardado no aparelho), sem mudança visível pro usuário. 1b = Ondas 2 a 6 (Livre novo, anúncio, oferta). Assim o "antes" roda na produção e fica anotado antes de as regras novas ligarem (spec 9b).
- **D2. Servidor aceita 2, 4 e 6 faixas no Livre.** O spec manda deixar de forçar 2; o app novo oferece só 4 e 6 ao Livre (`separationStemOptions`), mas o servidor não recusa 2, pra o app de computador antigo seguir separando (com a cota de 3).
- **D3. "Música diferente" no palco** = chave `cloud:<id da nuvem>` (catálogo), `song:<id do item no repertório>` (importada) ou `sep:<id da separação>` (player do Separador). Conta quando a música vira a atual no palco. A música restaurada ao abrir o app conta, mas nunca é barrada (já estava aberta). O metrônomo infinito não conta.
- **D4. Repertório no Livre.** Nada é apagado. Importar ou baixar do catálogo acrescenta a música e, com a VS parada, ela vira a atual ("uma música por vez"); escolher outra do repertório troca a atual e conta. Ficam do pago: próxima e anterior entre músicas, o AUTO entre músicas, Salvar e Carregar `.zip`, e os comandos de próxima, anterior e escolher música vindos da banda. Novo repertório, remover e reordenar continuam pra todos.
- **D5. Tempo do Ao Vivo do Livre** corre enquanto a sessão do host está ligada (`hostActive`: HOST local ou código remoto), em passos de 1 s com teto de 5 s por passo (o computador dormindo não gasta os minutos). Aos 10 minutos o app desliga a sessão (a banda sai) e não mexe no motor.
- **D6. Fila "só parado".** Pedido de tela com a música tocando espera e aparece uma vez quando ela para. Tela aberta e a música começa (pela banda, por exemplo): a tela sai e não volta sozinha.
- **D7. Eventos.** `ad_shown` e `ad_clicked` gravam no máximo um por conta, lugar e dia; `offer_shown` grava quando a janela do mês abre; `offer_used` quando o primeiro pagamento com desconto confirma. O selo grava só o clique.
- **D8. Janela da oferta.** Vale a janela ativa de qualquer mês (a aberta em 30/11 continua valendo em 01/12 e não abre outra). Só a tela de limite abre janela; a tela de Planos mostra o primeiro mês com desconto enquanto há janela aberta. Checkout com oferta vencida ou sem direito responde 409 e a tela mostra o preço cheio: nunca cobra cheio sem a pessoa ver.
- **D9. CPF.** HMAC-SHA256 dos 11 dígitos com o segredo `OFFER_CPF_SECRET` (variável nova na Vercel). Sem o segredo ou com o Asaas fora, a ficha ganha "CPF não conferido". O registro da oferta fica depois da exclusão da conta (`user_id` vira nulo, o hash fica) pra conferência de conta nova continuar valendo.
- **D10. Preço cheio.** A pendência nova `restore_full_price` nasce no `CHECKOUT_PAID` de todo checkout com desconto e é tentada na hora. Usa o plano atual da assinatura (se o admin trocou o plano antes, vai o preço do novo). Assinatura já encerrada fecha a pendência sem chamar o Asaas. "Marcar como feito" à mão só com o Asaas mostrando o preço cheio.
- **D11. Pads.** O painel de pads e os pads do aparelho abrem no Livre (rodam no aparelho); os conjuntos de pads da nuvem (`PadSetsModal`) seguem pagos. SAMPLES e LOOPS não mudam.
- **D12. Funil.** Coorte pelo mês do cadastro (Brasília); conta admin fica fora; "primeira separação" = ao menos um trabalho em `predictions`; "pagante" = primeiro pagamento confirmado (`billing_subscriptions` do Asaas com `first_paid_at`, sem a compra repetida, ou o registro antigo `payments`); cortesia não conta; tempo até virar pagante = mediana em dias. Ofertas e anúncios contam pelo mês do evento.
- **D13. Textos com os números velhos do Livre** ("5 separações em 2 faixas") mudam no mesmo passo em `src/content/site.ts`, `src/components/LandingPage.tsx`, `src/components/SubscriptionPanel.tsx` e `src/lib/subscription.ts`: só o texto, sem restyle (ficariam falsos).
- **D14. Cota sem SQL.** O limite vem de `api/_lib/plan.ts` (`PLAN_LIMITS`); `consume_separation_token` recebe o limite do servidor. Não há SQL de cota nesta parte.

## Ordem, dependências e publicação

| Onda | Tarefas | Depende de |
|---|---|---|
| 1 | T1 SQL dos eventos e do funil · T2 Funil no servidor · T3 Funil na Visão geral · T4 Plano guardado no aparelho | T2: T1. T3: T2 |
| Portão M | suíte, `tsc`, eslint, build do desktop, `run-all.sh` inteiro. **Publicação 1a** | Onda 1 |
| 2 | T5 Janela do palco · T6 Regras do Livre no aparelho · T7 Tela de limite · T8 Cartão de anúncio e selo · T9 AUTO só quando permitido · T10 SQL da oferta | T7: T5, T6. T8: T6. T10: T1 |
| 3 | T11 Separação do Livre no servidor · T12 Oferta, eventos e checkout com desconto · T13 Preço cheio, CPF e Pendências | T12: T10. T13: T12 |
| 4 | T14 Planos: funções próprias e Livre novo · T15 Hook do Livre · T16 Oferta e eventos no app | T15: T6, T14. T16: T7, T12 |
| 5 | T17 Palco e repertório no Livre · T18 Ao Vivo do Livre e anúncio da tela inicial · T19 Separador no Livre | T17: T8, T9, T15, T16. T18: T17. T19: T18 |
| 6 | T20 Documentação viva e portão final | todas |

Execução recomendada em sequência (T17, T18 e T19 mexem no mesmo `App.tsx` ou no `SeparatorStudio.tsx` que outras tocam antes). Portão de cada onda: `npx vitest run`, `npx tsc -b`, `npx eslint <arquivos da onda>` (0 erro nos novos, nenhum erro novo nos antigos), `DESKTOP=1 npx vite build`; da Onda 2 em diante também `node scripts/verify-layout/run.mjs`; na onda da T9 (motor) também `node scripts/verify-pitch/run.mjs`.

**SQL na produção, nesta ordem, cada um só com o OK do dono e antes do deploy que o usa:**
1. Publicação 1a: `db/supabase_eventos.sql`, depois `db/supabase_admin_funil.sql`.
2. Publicação 1b: `db/supabase_oferta.sql`.
Os três rodam depois dos arquivos que já estão na produção (`supabase_admin_papel.sql` ... `supabase_admin_numeros.sql`). Conferir as consultas do fim de cada arquivo.

**Publicação 1a** (@devops, depois do Portão M): OK do dono, SQL 1, bump e entrada do `src/lib/changelog.ts` (o teste dele prende a primeira entrada à versão do `package.json`; o item é o plano guardado no aparelho), deploy web + Mac + Windows; o dono abre Visão geral > Funil e os números de julho a novembro de 2026 entram no Histórico do FATOS como "antes", com a data.
**Publicação 1b** (@devops, depois do Portão da Onda 6): `OFFER_CPF_SECRET` na Vercel (produção, 32 ou mais caracteres aleatórios, nunca no código), OK do dono, SQL 2, bump e entrada do changelog com a nota de lançamento da T20, deploy web + Mac + Windows juntos, dono avisado.

## Contratos que várias tarefas usam

- `LimitKind = 'separations' | 'stage-songs' | 'live' | 'repertoire' | 'download'` (front, `src/lib/livreRules.ts`) e a mesma lista em `OFFER_TRIGGERS` (servidor, `api/_lib/offer.ts`; o front não importa de `api/`).
- `AdPlacement = 'home' | 'separation-done' | 'limit' | 'badge'` (front) e `AD_PLACEMENTS` (servidor), mesma lista.
- `POST /api/checkout?action=offer`, corpo `{ open?: boolean; trigger?: LimitKind }` -> `200 { status: 'active' | 'expired' | 'used' | 'none' | 'ineligible'; expiresAt: string | null; prices: { essencial_mensal: 24.9; pro_mensal: 59.9 } }`. Erro de banco: `200` com `status: 'none'`. Conta bloqueada: `403`.
- `POST /api/checkout?action=track`, corpo `{ kind: 'ad_shown' | 'ad_clicked'; placement: AdPlacement }` -> `200 { ok: boolean }` (falso = repetido no dia ou erro de banco); fora da lista `400`. A conta vem só do login.
- `POST /api/checkout` (criar checkout) ganha `offer?: boolean`. Com `offer: true`: `400` fora de Pro Mensal e Studio Mensal; `409 { error, offerEnded: true }` sem direito ou sem janela ativa.
- `GET /api/admin-stats?action=funnel&months=N` (N de 1 a 24, padrão 6) -> `{ months: FunnelMonth[] }`, do mais novo pro mais antigo, com `FunnelMonth = { month: 'AAAA-MM'; label: string; signups: number; firstSeparation: number; paying: number; medianDaysToPay: number | null; offersShown: number; offersUsed: number; adsShown: number; adsClicked: number }`.

## Mapa de arquivos

- Novos SQL: `db/supabase_eventos.sql`, `db/supabase_admin_funil.sql` (T1), `db/supabase_oferta.sql` (T10). Testes fora do repositório: `45-funil-tests.sql` (T1), `46-oferta-tests.sql` (T10); `run-all.sh` e `README.md` ganham os três arquivos no fim do `ORDER`.
- Servidor novo: `api/_lib/admin/funnel.ts` (T2), `api/_lib/offer.ts` (T12), `api/_lib/offerCpf.ts` (T13). Mexidos: `api/_lib/admin/registry.ts` (T2), `api/_lib/plan.ts` e `api/separate-audio.ts` (T11), `api/checkout.ts` (T12), `api/_lib/billing.ts` (T12, T13), `api/_lib/asaas.ts` e `api/_lib/admin/review.ts` (T13).
- Admin novo: `src/admin/lib/funnelTypes.ts`, `src/admin/components/FunnelPanel.tsx` (T3). Mexidos: `src/admin/tabs/OverviewTab.tsx` (T3), `src/admin/lib/reviewText.ts`, `src/admin/lib/reviewTypes.ts` (T13).
- App novo: `src/lib/planCache.ts` (T4), `src/components/stage/StageDialog.tsx` (T5), `src/lib/livreRules.ts`, `src/lib/livreStore.ts` (T6), `src/components/livre/limitCopy.ts`, `src/components/livre/LimitScreen.tsx` (T7), `src/components/livre/adCopy.ts`, `src/components/livre/HouseAdCard.tsx`, `src/components/livre/LivreBadge.tsx` (T8), `src/lib/autoAdvance.ts` (T9), `src/hooks/useLivre.ts` (T15), `src/lib/offer.ts`, `src/lib/checkout.ts`, `src/lib/productEvents.ts`, `src/components/livre/LimitGate.tsx` (T16), `src/components/livre/AdSlot.tsx` (T18).
- App mexido: `src/hooks/useAuth.ts` (T4), `src/lib/separationUsage.ts` (T6), `src/lib/stageContracts.ts`, `src/components/stage/buildStageView.ts`, `src/components/stage/StageAppBar.tsx`, `scripts/verify-layout/fixture.ts`, `scripts/verify-layout/run.mjs` (T8), `src/hooks/useAudioEngine.ts` (T9), `src/lib/plans.ts` e textos do Livre (T14), `src/components/PricingModal.tsx` (T16), `src/App.tsx` (T8 stub, T14, T17, T18), `src/components/LibraryModal.tsx` (T17), `src/components/SeparatorStudio.tsx` (T14, T19).
- Docs: `PLAYBACK_STUDIO_FATOS.md` e `DESIGN_SYSTEM.md` nas tarefas que mudam comportamento ou criam peça; `src/lib/changelog.ts` só pelo @devops no bump (nota de lançamento escrita na T20).

---

## Onda 1: medição e plano guardado (sai antes, Publicação 1a)

### Task 1: SQL dos eventos e do funil

**Files:**
- Create: `db/supabase_eventos.sql`, `db/supabase_admin_funil.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/45-funil-tests.sql`
- Modify (fora do repositório): `~/playback-studio-work/admin-sql-tests/run-all.sh` (o `ORDER` ganha no fim `db/supabase_eventos.sql db/supabase_admin_funil.sql db/supabase_oferta.sql`), `README.md` da mesma pasta (lista do `ORDER` e o `PBS_REPO=~/playback-studio-work/parte2`)

**Interfaces:**
- Produces: tabela `public.product_events (id bigserial primary key, user_id uuid references auth.users(id) on delete set null, kind text not null check (kind in ('offer_shown','offer_used','ad_shown','ad_clicked')), placement text check (placement in ('home','separation-done','limit','badge')), detail text check (detail is null or length(detail) <= 40), day date not null, created_at timestamptz not null default now())`, com `check ((kind in ('ad_shown','ad_clicked')) = (placement is not null))`, índice único `product_events_daily_uidx (user_id, kind, placement, day) where kind in ('ad_shown','ad_clicked')` e índice `(day)`.
- Produces: `public.record_product_event(p_user_id uuid, p_kind text, p_placement text default null, p_detail text default null, p_now timestamptz default now()) returns boolean` (grava com `day = (p_now at time zone 'America/Sao_Paulo')::date`, `on conflict do nothing`; devolve se gravou).
- Produces: `public.admin_funnel(p_now timestamptz default now(), p_months int default 6) returns jsonb` no formato `{ "months": [ { "month", "signups", "firstSeparation", "paying", "medianDaysToPay", "offersShown", "offersUsed", "adsShown", "adsClicked" } ] }`, `p_months` meses terminando no mês de Brasília de `p_now`, do mais novo pro mais antigo, zeros nos meses vazios; `p_months` fora de 1 a 24 dá `raise exception ... using errcode = '22023'`. Regras da D12: coorte por `auth.users.created_at` no mês de Brasília; perfis com `is_admin` fora; `firstSeparation` = existe linha em `predictions` da conta; `paying` = existe `billing_subscriptions` com `kind = 'asaas'`, `first_paid_at` não nulo e `cancel_source` diferente de `'duplicate'` (nulo conta), ou existe linha em `payments`; `medianDaysToPay` = `percentile_cont(0.5)` dos dias entre o cadastro e o primeiro pagamento (o menor entre `first_paid_at` e `payments.paid_at`), arredondado a 1 casa, nulo sem pagante; `offersShown` = contas distintas com `offer_shown` no mês do evento; `offersUsed`, `adsShown` e `adsClicked` = linhas do mês do evento.
- Os dois arquivos: cabeçalho no padrão dos outros ("Rodar DEPOIS de db/supabase_admin_numeros.sql"; o funil "DEPOIS de db/supabase_eventos.sql"), transação, `lock_timeout`, `statement_timeout`, RLS, revoke/grant, conferência no fim (colunas da tabela, os dois CHECK, `prosecdef` e `search_path` das duas funções).

- [ ] **Step 1: Escrever as verificações** em `45-funil-tests.sql` (formato do admin: `select ok('<nome>', <expressão>);`, blocos em `begin ... rollback`, contas próprias `c4500000-0000-4000-8000-00000000000N`):

```sql
select ok('product_events tem RLS e anon e authenticated não leem', ...);
select ok('record_product_event e admin_funnel são security definer com search_path fixo e só service_role executa', ...);
select ok('authenticated não executa record_product_event nem admin_funnel', erro_de($$select public.admin_funnel()$$) like '42501:%');
select ok('ad_shown grava e o segundo do mesmo dia e lugar devolve false', record_product_event(:'U1','ad_shown','home') and not record_product_event(:'U1','ad_shown','home'));
select ok('ad_shown no dia seguinte grava de novo', ...);
select ok('kind fora da lista falha com 23514', erro_de($$select record_product_event(...,'compra',null)$$) like '23514:%');
select ok('ad sem placement falha com 23514', ...);
select ok('evento às 23:30 de 30/11 em Brasília fica no dia 2026-11-30', ... p_now => '2026-12-01T02:30:00Z' ...);
select ok('funil: 3 cadastros em novembro, 2 com separação e 1 pagante', (m->>'signups')::int = 3 and (m->>'firstSeparation')::int = 2 and (m->>'paying')::int = 1);
select ok('cadastro às 23:30 de 30/11 em Brasília conta em novembro', ...);
select ok('funil: conta admin fica fora', ...);
select ok('funil: cortesia e compra repetida não contam como pagante', ...);
select ok('funil: pagante antigo pela tabela payments conta', ...);
select ok('funil: pagantes em 2 e 3 dias dão mediana 2.5', (m->>'medianDaysToPay')::numeric = 2.5);
select ok('funil: mês sem pagante tem medianDaysToPay nulo', m->'medianDaysToPay' = 'null'::jsonb);
select ok('funil: ofertas e anúncios contam pelo mês do evento', ...);
select ok('funil: p_months 0 e 25 falham com 22023', ...);
select ok('funil: 6 meses do mais novo pro mais antigo, com zeros nos vazios', jsonb_array_length(f->'months') = 6 and f->'months'->0->>'month' = '2026-11');
\i /repo-db/supabase_eventos.sql
\i /repo-db/supabase_admin_funil.sql
select ok('reaplicar os dois arquivos não muda nada', ...);
```

- [ ] **Step 2: Rodar e ver falhar:** `PBS_REPO=~/playback-studio-work/parte2 bash ~/playback-studio-work/admin-sql-tests/run-all.sh 45-funil-tests.sql > $LOGS/t1.txt 2>&1; tail -5 $LOGS/t1.txt`. Esperado: falhas por função inexistente.
- [ ] **Step 3: Escrever `db/supabase_eventos.sql` e `db/supabase_admin_funil.sql`** com o que está em Interfaces.
- [ ] **Step 4: Rodar a suíte SQL inteira:** `PBS_REPO=~/playback-studio-work/parte2 bash ~/playback-studio-work/admin-sql-tests/run-all.sh > $LOGS/t1b.txt 2>&1; tail -5 $LOGS/t1b.txt`. Esperado: `0 falhas` (inclusive 20, 30 e 40 a 44, com cada migration aplicada duas vezes).
- [ ] **Step 5: Commit**

```bash
git add db/supabase_eventos.sql db/supabase_admin_funil.sql
git commit -m "feat(admin): tabela de eventos do produto e funil por mes de cadastro, escritos so pelo servidor [Parte 3] [T1]"
```

### Task 2: Funil no servidor do admin

**Files:**
- Create: `api/_lib/admin/funnel.ts`
- Modify: `api/_lib/admin/registry.ts` (`mergeHandlers(..., funnel)`)
- Test: `api/__tests__/admin-funnel.test.ts`; Modify: `api/__tests__/admin-registry.test.ts` (a lista `ACTIONS` ganha `funnel: 'GET'`; o comentário passa a dizer 21 ações)

**Interfaces:**
- Consumes: `public.admin_funnel(p_now, p_months)` (T1); `monthLabel(startDay: string)` de `api/_lib/admin/overview.ts`; `AdminCtx`, `AdminHandlers`, `AdminError` de `api/_lib/admin/http.ts`.
- Produces: `export const handlers: AdminHandlers = { funnel: { method: 'GET', fields: ['months'], run } }`; `export function funnelMonths(query: Record<string, string>): number` (padrão 6; inteiro de 1 a 24; fora disso `AdminError(400, 'Escolha de 1 a 24 meses.')`); `export type FunnelMonth` (formato dos Contratos). Cada número conferido (inteiro de 0 pra cima; `firstSeparation` e `paying` até `signups`; `medianDaysToPay` número finito de 0 pra cima ou nulo; `month` no formato `AAAA-MM`); fora do formato vira erro inesperado, nunca número inventado. O `run` chama `ctx.db.rpc('admin_funnel', { p_now: ctx.now.toISOString(), p_months })`; `label` = `monthLabel(month + '-01')`.

- [ ] **Step 1: Escrever os testes** (banco falso de `fakeSupabase.ts` com `rpc: { admin_funnel }`, chamando o handler pelo roteador como em `admin-overview.test.ts`):

```ts
it('devolve os meses do banco com o nome do mês', async () => { expect(body.months[0]).toMatchObject({ month: '2026-11', label: 'novembro de 2026', signups: 3 }) })
it('months padrão 6 e aceita de 1 a 24', async () => { expect(db.rpcCalls[0].args).toMatchObject({ p_months: 6 }) })
it('months 0, 25 ou texto: 400 sem chamar o banco', async () => { expect(res.statusCode).toBe(400); expect(res.body.error).toBe('Escolha de 1 a 24 meses.'); expect(db.rpcCalls).toHaveLength(0) })
it('firstSeparation maior que signups é fora do formato: 500 com a frase genérica', async () => { expect(res.statusCode).toBe(500) })
it('medianDaysToPay nulo passa como nulo', async () => { expect(body.months[1].medianDaysToPay).toBeNull() })
```
e em `admin-registry.test.ts`: `it('todas as 21 ações respondem 403 pra usuário comum', ...)` com `funnel: 'GET'` na lista.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-funnel.test.ts api/__tests__/admin-registry.test.ts > $LOGS/t2.txt 2>&1; tail -20 $LOGS/t2.txt`. Esperado: FAIL (`funnel` não existe).
- [ ] **Step 3: Implementar `api/_lib/admin/funnel.ts`** e registrar em `registry.ts`.
- [ ] **Step 4: Rodar de novo** os dois arquivos e `api/__tests__/admin-router.test.ts`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/funnel.ts api/_lib/admin/registry.ts api/__tests__/admin-funnel.test.ts api/__tests__/admin-registry.test.ts
git commit -m "feat(admin): acao funnel no roteador do admin, conferida e com o nome do mes [Parte 3] [T2]"
```

### Task 3: Funil na Visão geral

**Files:**
- Create: `src/admin/lib/funnelTypes.ts`, `src/admin/components/FunnelPanel.tsx`
- Modify: `src/admin/tabs/OverviewTab.tsx` (renderiza `<FunnelPanel />` depois dos números do mês), `PLAYBACK_STUDIO_FATOS.md` (seção "Admin": a Visão geral ganha o funil; "(20 ações)" vira "(21 ações)")
- Test: `src/admin/components/FunnelPanel.test.tsx`

**Interfaces:**
- Consumes: `?action=funnel` (T2) por `useAdminQuery<Funnel>('funnel', { months: 6 })`.
- Produces: `export type FunnelMonth`, `export type Funnel = { months: FunnelMonth[] }`, `export function isFunnel(v: unknown): v is Funnel`, `export function pctOf(n: number, of: number): string | null` (`'67%'`, inteiro arredondado; nulo com `of = 0`) em `funnelTypes.ts`; `export function FunnelPanel()` (Panel com título "Funil do Livre", nota "Cadastros, primeira separação e pagantes contam pelo mês do cadastro; ofertas e anúncios, pelo mês em que aconteceram.", tabela dentro de `overflow-x-auto` pra a página nunca rolar de lado; colunas Mês, Cadastros, 1ª separação, Pagantes, Dias até pagar, Ofertas vistas e usadas, Anúncios vistos e clicados; vazio aparece `sem dado`).

- [ ] **Step 1: Escrever os testes:**

```ts
it('uma linha por mês com cadastros, primeira separação e pagantes com a porcentagem', () => { expect(row.textContent).toContain('2 (67%)') })
it('mês sem cadastro mostra sem dado na porcentagem', () => { expect(row.textContent).toContain('sem dado') })
it('mediana nula mostra sem dado e 2.5 mostra 2,5 dias', () => { ... })
it('erro do servidor mostra a frase e Tentar de novo', () => { ... })
it('pctOf(2, 3) = 67% e pctOf(1, 0) = null', () => { expect(pctOf(2, 3)).toBe('67%'); expect(pctOf(1, 0)).toBeNull() })
it('nenhum travessão no painel', () => { expect(container.textContent).not.toContain(TRAVESSAO) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/components/FunnelPanel.test.tsx > $LOGS/t3.txt 2>&1; tail -20 $LOGS/t3.txt`.
- [ ] **Step 3: Implementar** `funnelTypes.ts`, `FunnelPanel.tsx` e a linha no `OverviewTab.tsx`; atualizar o FATOS.
- [ ] **Step 4: Rodar** este teste e `src/admin/tabs/*.test.tsx`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/lib/funnelTypes.ts src/admin/components/FunnelPanel.tsx src/admin/components/FunnelPanel.test.tsx src/admin/tabs/OverviewTab.tsx PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(admin): funil do Livre na Visao geral, por mes de cadastro [Parte 3] [T3]"
```

### Task 4: Plano guardado no aparelho

**Files:**
- Create: `src/lib/planCache.ts`
- Modify: `src/hooks/useAuth.ts` (`fetchPlan` e o `onAuthStateChange`), `PLAYBACK_STUDIO_FATOS.md` (seção "Exclusivo do app desktop", item "Tocar offline": o último plano conhecido vale offline até a data de fim do plano ou 30 dias sem conferir)
- Test: `src/lib/planCache.test.ts`, `src/hooks/useAuth.test.ts`

**Interfaces:**
- Consumes: `PlanState` e `effectivePlan` de `src/lib/planState.ts`.
- Produces: `export const PLAN_CACHE_KEY = 'ps-plano-guardado'`; `export const PLAN_CACHE_MAX_AGE_MS = 30 * 86_400_000`; `export function savePlanCache(userId: string, state: PlanState, now?: Date): void`; `export function readPlanCache(userId: string, now?: Date): PlanState | null` (nulo sem registro, JSON estragado, outra conta ou `checkedAt` com mais de 30 dias); `export function clearPlanCache(): void`. Guarda `{ userId, plan, planExpiresAt, checkedAt }`; toda leitura e escrita em `try/catch` (sem `localStorage` vira nulo e nada quebra).
- `useAuth.fetchPlan`: leitura que deu certo chama `savePlanCache`; leitura que falhou (`state` nulo) numa conta que ainda não foi lida nesta aba usa `readPlanCache(userId)` (sem ele, `'free'` como hoje); a mesma conta mantém o que tinha. O `userPlan` continua passando por `effectivePlan`, então a data de fim passada vira Livre. Sair da conta (`onAuthStateChange` sem sessão) chama `clearPlanCache()`.

- [ ] **Step 1: Escrever os testes:**

```ts
// planCache.test.ts
it('guarda e devolve o plano da mesma conta', () => { savePlanCache(U, { plan: 'pro_mensal', planExpiresAt: null }, T0); expect(readPlanCache(U, T0)).toEqual({ plan: 'pro_mensal', planExpiresAt: null }) })
it('outra conta não herda o plano guardado', () => { expect(readPlanCache(OUTRA, T0)).toBeNull() })
it('29 dias sem conferir ainda vale', () => { expect(readPlanCache(U, addMs(T0, 29 * DAY))).not.toBeNull() })
it('30 dias e 1 minuto sem conferir: o plano guardado não vale', () => { expect(readPlanCache(U, addMs(T0, 30 * DAY + 60_000))).toBeNull() })
it('JSON estragado ou localStorage que lança devolve null e não quebra', () => { ... })
it('clearPlanCache apaga', () => { ... })
// useAuth.test.ts (mesmo mock do arquivo; a leitura do plano passa a poder falhar)
it('sem internet, a conta que pagava abre com o plano guardado', async () => { expect(result.current.userPlan).toBe('pro_mensal') })
it('plano guardado com data de fim passada abre como Livre', async () => { expect(result.current.userPlan).toBe('free') })
it('leitura que deu certo grava o plano no aparelho', async () => { expect(readPlanCache(U)).toEqual({ plan: 'pro_mensal', planExpiresAt: null }) })
it('sair da conta apaga o plano guardado', async () => { expect(readPlanCache(U)).toBeNull() })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/planCache.test.ts src/hooks/useAuth.test.ts > $LOGS/t4.txt 2>&1; tail -20 $LOGS/t4.txt`.
- [ ] **Step 3: Implementar** `planCache.ts` e a mudança no `useAuth.ts`; atualizar o FATOS.
- [ ] **Step 4: Rodar** os dois e `src/lib/planState.test.ts`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/planCache.ts src/lib/planCache.test.ts src/hooks/useAuth.ts src/hooks/useAuth.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(plano): ultimo plano conhecido guardado no aparelho vale offline ate o fim do plano ou 30 dias [Parte 3] [T4]"
```

**Portão M e Publicação 1a** (seção "Ordem, dependências e publicação").

---

## Onda 2: peças base e regras puras (nada muda pro usuário ainda)

### Task 5: Janela do palco

**Files:**
- Create: `src/components/stage/StageDialog.tsx`
- Modify: `DESIGN_SYSTEM.md` (seção 2.7, item `<StageDialog>`: quando usar, tamanhos, foco, Esc e toque fora)
- Test: `src/components/stage/stageDialog.test.tsx`

**Interfaces:**
- Produces: `export interface StageDialogProps { open: boolean; title: string; onClose(): void; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' }` e `export function StageDialog(props)`. Camada `fixed inset-0 z-[120]` com fundo `bg-black/60` e padding de 16 px (cabe em 360 px de largura), caixa `bg-ps-pop rounded-ps-xl shadow-ps-pop inset-ring inset-ring-ps-line-2`, `max-w-sm` (sm) ou `max-w-lg` (md, padrão), altura máxima da tela com rolagem dentro. `role="dialog"`, `aria-modal="true"`, `aria-labelledby` no `h2`. Botão de fechar com `Icon name="x"` e `aria-label="Fechar"`, 44 px. Foco no primeiro elemento focável ao abrir; Tab e Shift+Tab giram dentro; ao fechar, o foco volta pra quem abriu (como `TextPromptDialog`). Esc fecha com `stopPropagation` (não chega aos atalhos do palco); toque fora fecha, toque dentro não. Fechado não renderiza nada.

- [ ] **Step 1: Escrever os testes:**

```ts
it('fechado não renderiza nada', () => { expect(container.firstChild).toBeNull() })
it('role dialog, aria-modal e o título ligado por aria-labelledby', () => { ... })
it('abre com o foco no primeiro botão e devolve o foco a quem abriu ao fechar', () => { ... })
it('Esc fecha e não chega a um ouvinte de keydown na janela', () => { expect(onClose).toHaveBeenCalledTimes(1); expect(windowKeydown).not.toHaveBeenCalled() })
it('toque fora fecha; toque dentro não', () => { ... })
it('Tab no último botão volta pro primeiro e Shift+Tab no primeiro vai pro último', () => { ... })
it('o botão Fechar tem 44 px (min-h-ps-touch)', () => { expect(btn.className).toContain('min-h-ps-touch') })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/stage/stageDialog.test.tsx > $LOGS/t5.txt 2>&1; tail -20 $LOGS/t5.txt`.
- [ ] **Step 3: Implementar** `StageDialog.tsx`; atualizar o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/StageDialog.tsx src/components/stage/stageDialog.test.tsx DESIGN_SYSTEM.md
git commit -m "feat(palco): janela por cima no estilo do palco, com foco preso, Esc e toque fora [Parte 3] [T5]"
```

### Task 6: Regras do Livre no aparelho

**Files:**
- Create: `src/lib/livreRules.ts`, `src/lib/livreStore.ts`
- Modify: `src/lib/separationUsage.ts` (acrescenta `brtDay`)
- Test: `src/lib/livreRules.test.ts`, `src/lib/livreStore.test.ts`

**Interfaces:**
- Consumes: `brtMonth(at)` de `src/lib/separationUsage.ts`.
- Produces em `separationUsage.ts`: `export function brtDay(at: Date | string): string` (`'AAAA-MM-DD'` de Brasília, mesmo formatador do `brtMonth`).
- Produces em `livreRules.ts` (puro):
  - `export type LimitKind = 'separations' | 'stage-songs' | 'live' | 'repertoire' | 'download'`; `export const LIMIT_KINDS: readonly LimitKind[]`; `export type AdPlacement = 'home' | 'separation-done' | 'limit' | 'badge'`; `export type EngineBusy = { isPlaying: boolean; isCountingIn: boolean }`; `export function isQuiet(e: EngineBusy): boolean`.
  - `export type StageLedger = { month: string; keys: readonly string[] }`; `export function stageLedgerFor(raw: unknown, month: string): StageLedger` (outro mês, formato errado ou nulo: `{ month, keys: [] }`); `export type OpenDecision = { allowed: true; counts: boolean } | { allowed: false }`; `export function decideOpen(l: StageLedger, key: string, limit: number, opts?: { freeThisMonth?: boolean }): OpenDecision` (chave já contada: abre sem contar; `freeThisMonth`: abre sem contar, mesmo cheio; senão abre e conta se `keys.length < limit`); `export function withOpened(l: StageLedger, key: string): StageLedger` (idempotente); `export function stageUsed(l: StageLedger, limit: number): number` (`min(keys.length, limit)`).
  - `export function stageSongKey(song: { id: string; sourceId?: string; duration: number; channels: readonly { name: string }[] }): string | null` (`cloud:<sourceId>`, senão `song:<id>`; nulo pro metrônomo infinito: um canal só chamado `Metronomo Loop` e duração 36000); `export function separationKey(id: string): string` (`sep:<id>`); `export function separationIsThisMonth(createdAt: number, now: Date): boolean`.
  - `export type LiveLedger = { day: string; usedMs: number }`; `export const LIVE_TICK_CAP_MS = 5000`; `export function liveLedgerFor(raw: unknown, day: string): LiveLedger`; `export function addLiveTime(l: LiveLedger, deltaMs: number): LiveLedger` (delta negativo, NaN ou infinito soma 0; teto `LIVE_TICK_CAP_MS` por passo); `export function liveRemainingMs(l: LiveLedger, limitMs: number): number` (nunca negativo).
  - `export function shouldShowHomeAd(i: { isLivre: boolean; quiet: boolean; lastHomeDay: string | null; today: string; bigAdThisSession: boolean }): boolean`; `export function shouldShowSeparationAd(i: { isLivre: boolean; quiet: boolean; justSeparated: boolean; bigAdThisSession: boolean }): boolean`.
  - `export type QuietQueue<T> = { pending: T | null; shown: T | null }`; `export function queueRequest<T>(q: QuietQueue<T>, item: T, quiet: boolean): QuietQueue<T>` (parado: `shown = item`; tocando: `pending = item`, o mais novo vence); `export function queueSettle<T>(q: QuietQueue<T>, quiet: boolean): QuietQueue<T>` (parado com pendente: vira `shown`; tocando com `shown`: `shown = null`, descartado); `export function queueDismiss<T>(q: QuietQueue<T>): QuietQueue<T>`.
- Produces em `livreStore.ts` (aparelho, `localStorage` com `try/catch` em tudo; leitura que falha devolve vazio, escrita que falha não faz nada):
  - chaves `ps-livre-musicas:<userId>`, `ps-livre-aovivo:<userId>`, `ps-livre-anuncio-inicio:<userId>`;
  - `export function readStageLedger(userId: string, month: string): StageLedger`; `export function recordStageSong(userId: string, key: string, month: string): StageLedger` (lê, junta e grava na hora: duas telas do app nunca se apagam);
  - `export function readLiveLedger(userId: string, day: string): LiveLedger`; `export function writeLiveLedger(userId: string, l: LiveLedger): void`;
  - `export function readHomeAdDay(userId: string): string | null`; `export function writeHomeAdDay(userId: string, day: string): void`;
  - `export function bigAdShownThisSession(): boolean`; `export function markBigAdShown(): void` (variável do módulo: vale até recarregar o app);
  - `export function subscribeLivre(cb: () => void): () => void`; `export function livreVersion(): number` (número que sobe a cada escrita, pro `useSyncExternalStore`; também sobe com o evento `storage` de outra janela).

- [ ] **Step 1: Escrever os testes:**

```ts
it('música já contada no mês abre sem contar de novo', () => { expect(decideOpen({ month: '2026-11', keys: ['cloud:a'] }, 'cloud:a', 3)).toEqual({ allowed: true, counts: false }) })
it('com 2 de 3 abre uma nova e conta; com 3 de 3 a nova é barrada', () => { expect(decideOpen(l2, 'song:x', 3)).toEqual({ allowed: true, counts: true }); expect(decideOpen(l3, 'song:x', 3)).toEqual({ allowed: false }) })
it('separação do mês abre com 3 de 3 e não conta', () => { expect(decideOpen(l3, 'sep:s1', 3, { freeThisMonth: true })).toEqual({ allowed: true, counts: false }) })
it('stageLedgerFor de outro mês volta vazio (o mês virou)', () => { expect(stageLedgerFor({ month: '2026-11', keys: ['a'] }, '2026-12').keys).toEqual([]) })
it('às 23:30 de 30/11 em Brasília ainda é novembro', () => { expect(brtMonth(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11'); expect(brtMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12') })
it('stageSongKey: nuvem usa o sourceId, importada usa o id e o metrônomo infinito devolve null', () => { ... })
it('separação de 30/11 23:30 de Brasília é de novembro', () => { expect(separationIsThisMonth(Date.parse('2026-12-01T02:30:00Z'), new Date('2026-11-15T12:00:00Z'))).toBe(true) })
it('addLiveTime soma e limita o passo a 5 s; delta negativo não soma', () => { expect(addLiveTime(l0, 60_000).usedMs).toBe(5000); expect(addLiveTime(l0, -10).usedMs).toBe(0) })
it('liveRemainingMs: 600000 de limite e 599000 usados sobra 1000; nunca negativo', () => { ... })
it('liveLedgerFor de outro dia de Brasília volta zerado', () => { expect(liveLedgerFor({ day: '2026-11-18', usedMs: 600000 }, '2026-11-19').usedMs).toBe(0) })
it('queueRequest com a música tocando guarda e só mostra quando para', () => { const q = queueRequest(EMPTY, 'live', false); expect(q.shown).toBeNull(); expect(queueSettle(q, true).shown).toBe('live') })
it('tocando com a tela aberta, a tela sai e não volta sozinha', () => { const q = queueSettle({ pending: null, shown: 'live' }, false); expect(q.shown).toBeNull(); expect(queueSettle(q, true).shown).toBeNull() })
it('queueRequest parado mostra na hora', () => { expect(queueRequest(EMPTY, 'repertoire', true).shown).toBe('repertoire') })
it('anúncio da tela inicial: uma vez por dia, só no Livre, só parado e sem outro anúncio grande na sessão', () => { ... })
it('anúncio do fim da separação: só logo depois de separar, parado e sem outro anúncio grande na sessão', () => { ... })
// livreStore.test.ts (jsdom)
it('recordStageSong grava e a leitura seguinte vê, sem duplicar a chave', () => { ... })
it('localStorage que lança: leitura vazia e escrita não quebra', () => { ... })
it('subscribeLivre avisa depois de gravar e livreVersion sobe', () => { ... })
it('markBigAdShown vale pra sessão inteira', () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/livreRules.test.ts src/lib/livreStore.test.ts > $LOGS/t6.txt 2>&1; tail -20 $LOGS/t6.txt`.
- [ ] **Step 3: Implementar** `brtDay`, `livreRules.ts` e `livreStore.ts`.
- [ ] **Step 4: Rodar** os dois e `src/lib/separationUsage.test.ts`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/livreRules.ts src/lib/livreRules.test.ts src/lib/livreStore.ts src/lib/livreStore.test.ts src/lib/separationUsage.ts
git commit -m "feat(livre): regras puras de musicas do mes, minutos do Ao Vivo, anuncio e fila so com a musica parada [Parte 3] [T6]"
```

### Task 7: Tela de limite com a oferta

**Files:**
- Create: `src/components/livre/limitCopy.ts`, `src/components/livre/LimitScreen.tsx`
- Modify: `DESIGN_SYSTEM.md` (seção nova 2.8 "Livre (`src/components/livre/`)": tela de limite)
- Test: `src/components/livre/limitScreen.test.tsx`

**Interfaces:**
- Consumes: `StageDialog` (T5); `LimitKind` (T6); `formatReais` de `src/lib/prices.ts`; `Button` de `src/components/ui`.
- Produces em `limitCopy.ts`: `export const LIMIT_COPY: Record<LimitKind, { title: string; body: string }>`; `export const OFFER_COPY`; `export function offerRemainingMs(expiresAt: string, now: number): number` (nunca negativo); `export function formatCountdown(ms: number): string` (`HH:MM:SS`, horas podem passar de 24).
- Produces em `limitCopy.ts` também: `export type OfferView = { status: 'loading' } | { status: 'active'; expiresAt: string; prices: { essencial_mensal: number; pro_mensal: number } } | { status: 'none' }`.
- Produces em `LimitScreen.tsx`: `export interface LimitScreenProps { kind: LimitKind; offer: OfferView; busyPlan: 'essencial_mensal' | 'pro_mensal' | null; error: string | null; now?: () => number; onChoose(planKey: 'essencial_mensal' | 'pro_mensal'): void; onSeePlans(): void; onClose(): void }`; `export function LimitScreen(props)`. Relógio atualiza a cada 1 s só com a oferta ativa; ao chegar a zero a oferta some e fica o caso sem oferta. Botão principal laranja (`tone="primary"`); o relógio em `ps-num`, neutro (não é alerta). Erro dentro da tela, nunca `alert`.

Copy exata (decisão do plano; regra de copy do produto):

```ts
LIMIT_COPY = {
  separations: { title: 'As 3 separações deste mês acabaram', body: 'No Pro são 50 separações por mês, e cada instrumento chega pronto pro ensaio.' },
  'stage-songs': { title: 'Você já tocou 3 músicas diferentes este mês', body: 'No Pro o culto inteiro roda no palco, música atrás de música, sem contar nada.' },
  live: { title: 'Os 10 minutos de hoje com a banda acabaram', body: 'No Pro até 4 celulares da banda acompanham o culto do começo ao fim.' },
  repertoire: { title: 'Montar o repertório é do Pro', body: 'No Pro você monta o culto em ordem e passa de uma música pra outra sem parar o palco.' },
  download: { title: 'Baixar as faixas é do Pro', body: 'No Pro cada músico leva a sua faixa pro ensaio, em WAV ou MP3.' },
}
OFFER_COPY = {
  heading: 'Primeiro mês com desconto',
  pro: (v: string) => `Assinar o Pro por R$ ${v}`,            // R$ 24,90
  studio: (v: string) => `Assinar o Studio por R$ ${v}`,      // R$ 59,90
  after: 'Depois do primeiro mês, Pro R$ 49,90 e Studio R$ 119,90 por mês. Cancele quando quiser, com garantia de 7 dias.',
  clock: (t: string) => `Termina em ${t}`,
  seePlans: 'Ver todos os planos', plans: 'Ver os planos', later: 'Agora não',
}
```

- [ ] **Step 1: Escrever os testes:**

```ts
it('cada tipo de limite mostra o próprio título', () => { for (const k of LIMIT_KINDS) expect(screenFor(k).getByRole('heading').textContent).toBe(LIMIT_COPY[k].title) })
it('com a oferta ativa mostra Pro por R$ 24,90, Studio por R$ 59,90 e o relógio 47:59:59', () => { ... })
it('o relógio anda e, ao zerar, a oferta some e ficam Ver os planos e Agora não', () => { vi.advanceTimersByTime(...) })
it('sem oferta mostra só Ver os planos e Agora não', () => { ... })
it('carregando a oferta não mostra preço nenhum', () => { ... })
it('escolher o Pro chama onChoose com essencial_mensal; busyPlan desliga os dois', () => { ... })
it('o erro aparece dentro da tela e nenhum alert é chamado', () => { expect(alertSpy).not.toHaveBeenCalled() })
it('formatCountdown(172800000) é 48:00:00 e negativo é 00:00:00', () => { expect(formatCountdown(172_800_000)).toBe('48:00:00'); expect(formatCountdown(-5)).toBe('00:00:00') })
it('nenhum travessão e nenhum stems nos textos', () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/livre/limitScreen.test.tsx > $LOGS/t7.txt 2>&1; tail -20 $LOGS/t7.txt`.
- [ ] **Step 3: Implementar** `limitCopy.ts` e `LimitScreen.tsx`; atualizar o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/livre/limitCopy.ts src/components/livre/LimitScreen.tsx src/components/livre/limitScreen.test.tsx DESIGN_SYSTEM.md
git commit -m "feat(livre): tela de limite com a oferta do primeiro mes e o relogio de 48 horas [Parte 3] [T7]"
```

### Task 8: Cartão de anúncio e selo do Livre

**Files:**
- Create: `src/components/livre/adCopy.ts`, `src/components/livre/HouseAdCard.tsx`, `src/components/livre/LivreBadge.tsx`
- Modify: `src/lib/stageContracts.ts` (`StageView['app']` ganha `livre: { used: number; limit: number } | null`; `StageActions` ganha `openLivreBadge(): void`), `src/components/stage/buildStageView.ts` (entrada `ui.livre`), `src/components/stage/StageAppBar.tsx` (selo ao lado do ONLINE/OFFLINE; `actions` inclui `openLivreBadge`), `src/App.tsx` (só o mínimo pra compilar: `livre: null` na entrada do `buildStageView` e `openLivreBadge: () => setIsPricingOpen(true)` no `stageImpl`), `scripts/verify-layout/fixture.ts` e `scripts/verify-layout/run.mjs` (estado novo `selo`: OFFLINE, HOST ligado, palco parado e `livre: { used: 3, limit: 3 }`; `BASE.app.livre = null`), `DESIGN_SYSTEM.md` (2.8: cartão de anúncio e selo)
- Test: `src/components/livre/houseAd.test.tsx`, `src/components/stage/buildStageView.test.ts`, `src/components/stage/panels.test.tsx` (barra do app)

**Interfaces:**
- Consumes: `Panel`, `Button` de `src/components/ui`; `AdPlacement` (T6).
- Produces em `adCopy.ts`: `export const HOME_AD = { title: 'O que o Pro faz por você', body: 'Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio.', cta: 'Conhecer o Pro', dismiss: 'Agora não' }`; `export const SEPARATION_AD = { title: 'No Pro você baixa essas faixas e salva na nuvem', cta: 'Conhecer o Pro', dismiss: 'Agora não' }`; `export function livreBadgeText(used: number, limit: number): string` (`'LIVRE · 2 de 3 músicas este mês'`).
- Produces: `export interface HouseAdCardProps { placement: 'home' | 'separation-done'; onCta(): void; onDismiss(): void }` e `export function HouseAdCard(props)` (Panel `raised`, sem som, sem vídeo, nada bloqueado em volta); `export interface LivreBadgeProps { used: number; limit: number; onClick(): void }` e `export function LivreBadge(props)` (botão de 44 px de alvo com a pílula visível de 22 px no estilo do selo ONLINE, neutro, `title="Ver os planos"`).
- `buildStageView`: `app.livre = ui.livre && !e.isPlaying && !e.isCountingIn ? ui.livre : null`.

- [ ] **Step 1: Escrever os testes:**

```ts
it('cartão da tela inicial mostra o resultado; Conhecer o Pro chama onCta e Agora não chama onDismiss', () => { ... })
it('cartão do fim da separação mostra No Pro você baixa essas faixas e salva na nuvem', () => { ... })
it('livreBadgeText(2, 3) é LIVRE · 2 de 3 músicas este mês', () => { expect(livreBadgeText(2, 3)).toBe('LIVRE · 2 de 3 músicas este mês') })
it('o selo é um botão de 44 px que chama onClick', () => { expect(btn.className).toContain('min-h-ps-touch') })
// buildStageView.test.ts
it('o selo some com a música tocando e na pré-contagem', () => { expect(build({ isPlaying: true }, { livre: L }).app.livre).toBeNull(); expect(build({ isCountingIn: true }, { livre: L }).app.livre).toBeNull(); expect(build({}, { livre: L }).app.livre).toEqual(L) })
it('conta paga: app.livre nulo', () => { expect(build({}, { livre: null }).app.livre).toBeNull() })
// panels.test.tsx
it('a barra do app mostra o selo com app.livre e o toque chama openLivreBadge', () => { ... })
it('sem app.livre a barra não mostra o selo', () => { ... })
it('nenhum travessão nos textos do anúncio e do selo', () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/livre/houseAd.test.tsx src/components/stage/buildStageView.test.ts src/components/stage/panels.test.tsx > $LOGS/t8.txt 2>&1; tail -20 $LOGS/t8.txt`.
- [ ] **Step 3: Implementar** as peças, o contrato, a barra, o mínimo no `App.tsx` e o estado `selo` do verificador; atualizar o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** os testes, `npx tsc -b > $LOGS/tsc.txt 2>&1; tail -5 $LOGS/tsc.txt` e `node scripts/verify-layout/run.mjs --estado selo > $LOGS/layout.txt 2>&1; tail -5 $LOGS/layout.txt`. Esperado: PASS, 0 erro de tipo e o estado `selo` passando nos 8 tamanhos (nada cortado com OFFLINE, HOST e o selo em 1024x740).
- [ ] **Step 5: Commit**

```bash
git add src/components/livre/adCopy.ts src/components/livre/HouseAdCard.tsx src/components/livre/LivreBadge.tsx src/components/livre/houseAd.test.tsx src/lib/stageContracts.ts src/components/stage/buildStageView.ts src/components/stage/buildStageView.test.ts src/components/stage/StageAppBar.tsx src/components/stage/panels.test.tsx src/App.tsx scripts/verify-layout/fixture.ts scripts/verify-layout/run.mjs DESIGN_SYSTEM.md
git commit -m "feat(livre): cartao do anuncio da casa e selo do Livre no palco parado [Parte 3] [T8]"
```

### Task 9: AUTO só quando permitido

**Files:**
- Create: `src/lib/autoAdvance.ts`
- Modify: `src/hooks/useAudioEngine.ts` (`opts` ganha `autoNext?: boolean`, padrão verdadeiro; `checkSongEnd` usa `shouldAutoAdvance`)
- Test: `src/lib/autoAdvance.test.ts`

**Interfaces:**
- Produces: `export function shouldAutoAdvance(i: { mode: 'continue' | 'stop' | 'fade-out'; activeIndex: number; length: number; allowed: boolean }): boolean` (só `continue`, com próxima música e `allowed`). `useAudioEngine(userId, { ..., autoNext })` com `const autoNext = opts?.autoNext ?? true` no começo do hook: com `autoNext` falso, o fim da música no `continue` para como no `stop` (nenhum timer da próxima). Nada mais no motor muda.

- [ ] **Step 1: Escrever os testes:**

```ts
it('continue com próxima música e permitido avança', () => { expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 0, length: 2, allowed: true })).toBe(true) })
it('não permitido (Livre) não avança', () => { expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 0, length: 2, allowed: false })).toBe(false) })
it('stop e fade-out não avançam; a última música não avança', () => { ... })
it('o fim da música no motor passa por shouldAutoAdvance com o autoNext', () => { expect(readFileSync('src/hooks/useAudioEngine.ts', 'utf8')).toMatch(/shouldAutoAdvance\(\{[^}]*allowed:\s*autoNext/) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/autoAdvance.test.ts > $LOGS/t9.txt 2>&1; tail -20 $LOGS/t9.txt`.
- [ ] **Step 3: Implementar** `autoAdvance.ts` e a opção no motor.
- [ ] **Step 4: Rodar** este teste, `src/hooks/useAudioEngine.*.test.ts` e `node scripts/verify-pitch/run.mjs > $LOGS/pitch.txt 2>&1; tail -5 $LOGS/pitch.txt`. Esperado: PASS (nenhuma mudança nos testes do motor) e o harness de tom igual.
- [ ] **Step 5: Commit**

```bash
git add src/lib/autoAdvance.ts src/lib/autoAdvance.test.ts src/hooks/useAudioEngine.ts
git commit -m "feat(motor): AUTO entre musicas so quando o plano permite (autoNext) [Parte 3] [T9]"
```

### Task 10: SQL da oferta do primeiro mês

**Files:**
- Create: `db/supabase_oferta.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/46-oferta-tests.sql`

**Interfaces:**
- Consumes: `public.record_product_event` (T1); `public.pending_checkouts`, `public.billing_pending_actions`, `public.billing_enqueue_action` (`db/supabase_assinaturas.sql`).
- Produces: tabela `public.first_month_offers (id bigserial primary key, user_id uuid references auth.users(id) on delete set null, month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'), shown_at timestamptz not null, expires_at timestamptz not null, trigger_kind text not null check (trigger_kind in ('separations','stage-songs','live','repertoire','download')), used_at timestamptz, checkout_id text, cpf_hash text check (cpf_hash is null or cpf_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default now())`, índice único `first_month_offers_user_month_uidx (user_id, month) where user_id is not null` e índice `(cpf_hash) where cpf_hash is not null`.
- Produces: `pending_checkouts` ganha `offer_month text` e `offer_value numeric(12, 2)` (`add column if not exists`).
- Produces: o CHECK de `billing_pending_actions.action` passa a aceitar `'restore_full_price'` além dos 5 de hoje (bloco `do` que derruba o CHECK de `action` que existir, ache o nome que tiver, e cria `billing_pending_actions_action_check` com os 6 valores).
- Produces (todas `security definer`, só `service_role`; mês = `to_char(p_now at time zone 'America/Sao_Paulo', 'YYYY-MM')`; resposta `{ "status", "expiresAt", "month" }`):
  - `public.offer_current(p_user_id uuid, p_now timestamptz default now()) returns jsonb`: `used` se alguma linha da conta tem `used_at`; senão `active` se alguma linha tem `p_now < expires_at` (de qualquer mês, a mais nova); senão `expired` se há linha do mês de `p_now`; senão `none`.
  - `public.offer_open_window(p_user_id uuid, p_trigger text, p_now timestamptz default now()) returns jsonb`: o mesmo do `offer_current`, e com `none` cria a linha do mês (`shown_at = p_now`, `expires_at = p_now + interval '48 hours'`, `on conflict do nothing`) e, se criou, grava `record_product_event(p_user_id, 'offer_shown', null, p_trigger, p_now)` na mesma transação; devolve `active`.
  - `public.offer_mark_used(p_user_id uuid, p_month text, p_checkout_id text, p_now timestamptz default now()) returns text`: `'marked'` (grava `used_at` e `checkout_id`, e `offer_used`), `'already'` (já usada: nenhum evento novo) ou `'no_offer'`.
  - `public.offer_record_cpf(p_user_id uuid, p_month text, p_cpf_hash text) returns boolean`: grava o hash na linha da conta e do mês e devolve se existe outra linha usada com o mesmo hash e `user_id` diferente (ou nulo).
- Arquivo com cabeçalho "Rodar DEPOIS de db/supabase_assinaturas.sql e db/supabase_eventos.sql", transação, `lock_timeout`, `statement_timeout`, RLS, revoke/grant, conferência no fim (colunas novas de `pending_checkouts`, o CHECK com `'restore_full_price'` e `'admin_review'`, as 4 funções `security definer`).

- [ ] **Step 1: Escrever as verificações** em `46-oferta-tests.sql` (contas `c4600000-0000-4000-8000-00000000000N`):

```sql
select ok('first_month_offers tem RLS e anon e authenticated não leem', ...);
select ok('as 4 funções são security definer e só service_role executa', ...);
select ok('offer_open_window abre a janela de 48 horas e grava offer_shown uma vez', (w->>'status') = 'active' and (w->>'expiresAt')::timestamptz = '2026-11-19T15:00:00Z'::timestamptz + interval '48 hours');
select ok('abrir de novo no mesmo mês devolve a mesma janela, sem outro evento', ...);
select ok('duas chamadas seguidas criam uma linha só', ...);
select ok('passadas as 48 horas o status é expired e não abre outra no mesmo mês', ...);
select ok('no mês seguinte abre uma janela nova', ...);
select ok('janela aberta em 30/11 às 21:00 de Brasília vale em 01/12 e não abre outra', ...);
select ok('offer_current sem registro devolve none e não cria linha', ...);
select ok('offer_mark_used marca, grava offer_used e a segunda chamada devolve already sem outro evento', ...);
select ok('depois de usada o status é used em qualquer mês', ...);
select ok('offer_record_cpf devolve true quando outra conta já usou a oferta com o mesmo hash', ...);
select ok('hash fora do formato falha com 23514', ...);
select ok('trigger fora da lista falha com 23514', ...);
select ok('excluir a conta mantém o registro com user_id nulo e o hash', ...);
select ok('pending_checkouts tem offer_month e offer_value', ...);
select ok('billing_pending_actions aceita restore_full_price e continua aceitando as 5 antigas', ...);
select ok('billing_enqueue_action com restore_full_price não duplica a aberta', ...);
\i /repo-db/supabase_oferta.sql
select ok('reaplicar não muda nada', ...);
```
- [ ] **Step 2: Rodar e ver falhar:** `PBS_REPO=~/playback-studio-work/parte2 bash ~/playback-studio-work/admin-sql-tests/run-all.sh 46-oferta-tests.sql > $LOGS/t10.txt 2>&1; tail -5 $LOGS/t10.txt`.
- [ ] **Step 3: Escrever `db/supabase_oferta.sql`.**
- [ ] **Step 4: Rodar a suíte SQL inteira** (sem argumento). Esperado: `0 falhas`, inclusive `30-billing-tests.sql` com o CHECK novo.
- [ ] **Step 5: Commit**

```bash
git add db/supabase_oferta.sql
git commit -m "feat(oferta): registro da oferta do primeiro mes por conta e por mes, janela de 48 horas e pendencia de preco cheio [Parte 3] [T10]"
```

---

## Onda 3: servidor

### Task 11: Separação do Livre no servidor

**Files:**
- Modify: `api/_lib/plan.ts` (`PLAN_LIMITS.free` de 5 para 3), `api/separate-audio.ts` (sai a trava de 2 faixas do Livre e o comentário dela; `PAID_PLANS` deixa de ser importado se não sobrar uso), `PLAYBACK_STUDIO_FATOS.md` (seção "Cobrança, cota e cancelamento", cota mensal: "Livre 3, em 4 ou 6 faixas (não publicado)")
- Test: `api/__tests__/separate-audio.test.ts`, `api/__tests__/plan.test.ts`, e os testes que esperavam 5 no Livre (`api/__tests__/admin-subscribers.test.ts` se algum caso usar o limite do Livre)

**Interfaces:**
- Produces: `PLAN_LIMITS = { free: 3, essencial_mensal: 50, essencial_anual: 50, pro_mensal: 150, pro_anual: 150 }`. `separate-audio` aceita 2, 4 e 6 em todos os planos (D2), com a cota e a cota extra do admin como hoje.

- [ ] **Step 1: Escrever os testes** (o teste antigo "Livre só 2 faixas" vira os de baixo):

```ts
it('Livre separa em 4 faixas com htdemucs e conta 1', async () => { expect(res.statusCode).toBe(200); expect(createPrediction.mock.calls[0][0].input.model_name).toBe('htdemucs'); expect(db.tables.profiles[0].tokens_used).toBe(1) })
it('Livre separa em 6 faixas com htdemucs_6s', async () => { ... })
it('Livre no app antigo pedindo 2 faixas ainda separa', async () => { expect(res.statusCode).toBe(200); expect(input.two_stems).toBe('vocals') })
it('a 4ª separação do Livre no mês recebe 402 com limit 3', async () => { expect(res.statusCode).toBe(402); expect(res.body.limit).toBe(3); expect(res.body.error).toContain('3 separações') })
it('Livre com cota extra 2 do admin vai até 5', async () => { ... })
// plan.test.ts
it('PLAN_LIMITS do Livre é 3', () => { expect(PLAN_LIMITS.free).toBe(3) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/separate-audio.test.ts api/__tests__/plan.test.ts > $LOGS/t11.txt 2>&1; tail -20 $LOGS/t11.txt`.
- [ ] **Step 3: Implementar** a mudança nos dois arquivos; atualizar o FATOS.
- [ ] **Step 4: Rodar** `npx vitest run api > $LOGS/t11b.txt 2>&1; tail -5 $LOGS/t11b.txt`. Esperado: PASS (ajustar só os casos que esperavam 5 no Livre).
- [ ] **Step 5: Commit**

```bash
git add api/_lib/plan.ts api/separate-audio.ts api/__tests__/separate-audio.test.ts api/__tests__/plan.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(livre): servidor da 3 separacoes por mes ao Livre e deixa de forcar 2 faixas [Parte 3] [T11]"
```

### Task 12: Oferta, eventos e checkout com desconto

**Files:**
- Create: `api/_lib/offer.ts`
- Modify: `api/checkout.ts` (ações `offer` e `track`, e `offer: true` na criação), `api/_lib/billing.ts` (só `accountSubscriptionCount`), `PLAYBACK_STUDIO_FATOS.md` (seção "Cobrança": oferta do primeiro mês, quem tem direito, janela, "(não publicado)")
- Test: `api/__tests__/offer.test.ts`, `api/__tests__/checkout-create.test.ts`

**Interfaces:**
- Consumes: `offer_current`, `offer_open_window` (T10); `record_product_event` (T1); `PLAN_PRICING`, `PlanKey` de `api/_lib/pricing.ts`.
- Produces em `billing.ts`: `export async function accountSubscriptionCount(db: SupabaseClient, userId: string): Promise<number>` (o corpo de hoje do `isFirstSubscription`, devolvendo `ids.size`); `isFirstSubscription` passa a ser `(await accountSubscriptionCount(db, userId)) <= 1` (mesma regra do arrependimento: compra repetida e cortesia não contam).
- Produces em `offer.ts`: `export const OFFER_WINDOW_HOURS = 48`; `export const OFFER_PRICING = { essencial_mensal: 24.9, pro_mensal: 59.9 } as const`; `export type OfferPlanKey = keyof typeof OFFER_PRICING`; `export function isOfferPlan(k: unknown): k is OfferPlanKey`; `export const OFFER_TRIGGERS` (os 5 de `LimitKind`); `export const AD_KINDS = ['ad_shown', 'ad_clicked'] as const`; `export const AD_PLACEMENTS = ['home', 'separation-done', 'limit', 'badge'] as const`; `export type OfferStatus = 'active' | 'expired' | 'used' | 'none' | 'ineligible'`; `export type OfferAnswer = { status: OfferStatus; expiresAt: string | null; month: string | null }`; `export async function readOffer(db: SupabaseClient, userId: string, o: { open: boolean; trigger?: string; now: Date }): Promise<OfferAnswer>` (conta com assinatura anterior: `ineligible` sem chamar RPC nenhum; senão `offer_open_window` com `open` e `offer_current` sem); `export async function recordAdEvent(db: SupabaseClient, userId: string, kind: string, placement: string, now: Date): Promise<boolean>`.
- `api/checkout.ts`: a ordem passa a ser `cancel`, `cancel-preview`, `sync` (como hoje), conta bloqueada 403, `offer`, `track`, ação desconhecida 400, criar checkout. `offer` e `track` seguem os Contratos. Criar checkout com `offer: true`: `isOfferPlan` senão `400 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.'`; `accountSubscriptionCount === 0` senão `409 { error: 'A oferta do primeiro mês vale só na primeira assinatura da conta.', offerEnded: true }`; `readOffer(open: false)` com `active` senão `409 { error: 'A oferta do primeiro mês terminou. O preço agora é o cheio.', offerEnded: true }` (RPC com erro também dá esse 409, nunca cobra cheio por baixo); item com `value: OFFER_PRICING[planKey]`, `subscription.cycle` igual; `pending_checkouts` grava `offer_month` (o `month` da janela) e `offer_value`. Sem `offer`, nada muda (o `insert` não manda as colunas novas).

- [ ] **Step 1: Escrever os testes** (`createBillingDb` com `setRpc` pros RPCs da oferta; `axios` falso como em `checkout-create.test.ts`; hora fixa `2026-11-19T15:00:00Z`):

```ts
it('Livre sem assinatura: open abre a janela e devolve active, expiresAt e os preços 24,9 e 59,9', async () => { expect(res.body).toEqual({ status: 'active', expiresAt: '2026-11-21T15:00:00.000Z', prices: { essencial_mensal: 24.9, pro_mensal: 59.9 } }) })
it('quem já teve assinatura recebe ineligible e nada é gravado', async () => { expect(res.body.status).toBe('ineligible'); expect(db.rpcCalls.map((c) => c.name)).not.toContain('offer_open_window') })
it('open false só lê com offer_current e nunca abre', async () => { ... })
it('trigger fora da lista com open: 400', async () => { ... })
it('erro do banco na oferta: 200 com status none', async () => { expect(res.statusCode).toBe(200); expect(res.body.status).toBe('none') })
it('conta bloqueada: offer e track respondem 403', async () => { ... })
it('track grava ad_shown da tela inicial com a conta do login', async () => { expect(call.args).toMatchObject({ p_user_id: USER_A, p_kind: 'ad_shown', p_placement: 'home' }) })
it('track com kind ou placement fora da lista: 400 sem gravar', async () => { ... })
it('track ignora user_id de outra conta no corpo', async () => { ... })
it('oferta ativa no Pro Mensal: item com value 24.9 e pending_checkouts com offer_value 24.9 e o mês', async () => { expect(post.mock.calls[0][1].items[0].value).toBe(24.9); expect(db.tables.pending_checkouts[0]).toMatchObject({ offer_value: 24.9, offer_month: '2026-11' }) })
it('oferta no Studio Mensal: 59.9', async () => { ... })
it('oferta no Pro Anual: 400 com a frase', async () => { ... })
it('janela vencida: 409 com offerEnded e nenhum checkout no Asaas', async () => { expect(res.statusCode).toBe(409); expect(res.body.offerEnded).toBe(true); expect(post).not.toHaveBeenCalled() })
it('segunda assinatura da conta: 409 com offerEnded', async () => { ... })
it('sem offer no corpo: preço cheio 49.9 e pending_checkouts sem as colunas da oferta', async () => { ... })
it('accountSubscriptionCount não conta compra repetida nem cortesia', async () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/offer.test.ts api/__tests__/checkout-create.test.ts > $LOGS/t12.txt 2>&1; tail -20 $LOGS/t12.txt`.
- [ ] **Step 3: Implementar** `offer.ts`, `accountSubscriptionCount` e as ações em `checkout.ts`; atualizar o FATOS.
- [ ] **Step 4: Rodar** `npx vitest run api > $LOGS/t12b.txt 2>&1; tail -5 $LOGS/t12b.txt`. Esperado: PASS, com `functions-limit.test.ts` em 12 e `cancel-subscription.test.ts` igual.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/offer.ts api/checkout.ts api/_lib/billing.ts api/__tests__/offer.test.ts api/__tests__/checkout-create.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(oferta): janela da oferta e eventos de anuncio por action no checkout, desconto so na primeira assinatura [Parte 3] [T12]"
```

### Task 13: Preço cheio depois do primeiro pagamento, CPF e Pendências

**Files:**
- Create: `api/_lib/offerCpf.ts`
- Modify: `api/_lib/billing.ts` (`Owner`, `checkoutOwner`, `onCheckoutPaid`, `activateFromCheckout`, `PendingAction` e `runPendingActions`), `api/_lib/asaas.ts` (`getCustomerCpf`; o tipo devolvido por `getSubscription` ganha `value?: number`), `api/_lib/admin/review.ts` (conferência antes de "marcar como feito" na pendência nova), `src/admin/lib/reviewText.ts`, `src/admin/lib/reviewTypes.ts`, `api/__tests__/billingHarness.ts` (o banco falso aceita `restore_full_price` e os RPCs `offer_mark_used` e `offer_record_cpf`), `PLAYBACK_STUDIO_FATOS.md` (seção "Cobrança": volta ao preço cheio, CPF e a pendência nova; seção "Admin": Pendências mostra "Voltar pro preço cheio no Asaas")
- Test: `api/__tests__/offer-activation.test.ts`, `api/__tests__/admin-review.test.ts`, `api/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: `offer_mark_used`, `offer_record_cpf`, `billing_enqueue_action` com `'restore_full_price'` (T10); `PLAN_PRICING`.
- Produces em `asaas.ts`: `export async function getCustomerCpf(api: AsaasApi, customerId: string): Promise<string | null>` (`GET /customers/{id}`, só os dígitos de `cpfCnpj`; 404 ou sem campo dá nulo; outro erro lança `AsaasError`).
- Produces em `offerCpf.ts` (importa só `node:crypto`, `asaas.ts` e `import type { BillingDeps }`; nunca registra o CPF em log): `export function hashCpf(cpf: string, secret: string): string` (HMAC-SHA256 em hex dos dígitos); `export async function checkOfferCpf(deps: BillingDeps, i: { userId: string; checkoutId: string; customerId: string | null; month: string }): Promise<'ok' | 'reused' | 'unchecked'>` (sem `OFFER_CPF_SECRET`, sem cliente, sem CPF ou com o Asaas fora: `billing_flag_review(checkoutId, 'oferta do primeiro mes: CPF nao conferido (Asaas fora ou servidor sem OFFER_CPF_SECRET)')` e `'unchecked'`; mesmo CPF já usado noutra conta: `billing_flag_review(checkoutId, 'oferta do primeiro mes: o mesmo CPF ja usou a oferta em outra conta')` e `'reused'`). Nunca lança.
- `billing.ts`: `Owner` ganha `offer: { month: string; value: number } | null`, lido de `pending_checkouts.offer_month` e `offer_value`; se o `select` com as colunas novas der `42703` ou `PGRST204`, lê de novo sem elas (`offer: null`). `activateFromCheckout` recebe `offer?: { month: string; value: number } | null` e, com ela: `payments.value` = `offer.value`; `offer_mark_used` (se `'marked'`, roda `checkOfferCpf`); **sempre** `billing_enqueue_action(p_ref = checkoutId, p_action = 'restore_full_price', p_reason = 'oferta_primeiro_mes', p_amount = PLAN_PRICING[planKey].value)` e `tryPending` com o id. Erro de banco nesses passos lança (o aviso fica pra nova tentativa); erro do Asaas fica na pendência.
- `runPendingActions`: `PendingAction['action']` inclui `'restore_full_price'`. Ramo novo: linha da assinatura ausente ou `status = 'canceled'` fecha com `billing_action_done(..., p_note = 'assinatura encerrada, nada a trocar')` sem chamar o Asaas; senão `put('/subscriptions/{subId}', { value, cycle, description, updatePendingPayments: true })` com o `PLAN_PRICING` do `plan_key` atual da linha, e fecha com `p_note = 'preco cheio: R$ ' + valor com vírgula`.
- `review.ts`: "marcar como feito" (`done`) em `restore_full_price` só passa se `getSubscription` mostra `value` igual ao `PLAN_PRICING` do plano da linha; senão `AdminError(409, 'No Asaas a assinatura ainda está em R$ X. Use Tentar agora ou troque no painel do Asaas antes de marcar como feito.')`. Descartar continua recusado pelo banco.
- `reviewText.ts`: `ACTION_TITLES.restore_full_price = 'Voltar pro preço cheio no Asaas'`; `REASONS.oferta_primeiro_mes = 'Primeiro mês com desconto: a renovação volta pro preço cheio'`. `reviewTypes.ts`: a união de `action` inclui `'restore_full_price'`.

- [ ] **Step 1: Escrever os testes** (`createBillingDb` e `createFakeAsaas`, chamando `handleAsaasEvent` com um `CHECKOUT_PAID` e `runPendingActions`):

```ts
it('CHECKOUT_PAID com oferta: marca a oferta, grava payments com 24.9 e troca no Asaas pra 49.9 com updatePendingPayments', async () => { expect(asaas.put).toHaveBeenCalledWith('/subscriptions/sub_1', { value: 49.9, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)', updatePendingPayments: true }); expect(payments[0].value).toBe(24.9) })
it('Asaas fora na troca: a pendência restore_full_price fica aberta e a próxima rodada troca e fecha', async () => { ... })
it('o plano já vale mesmo com a troca pendente', async () => { expect(profile.plan).toBe('essencial_mensal') })
it('assinatura encerrada antes da troca fecha a pendência sem chamar o Asaas', async () => { expect(asaas.put).not.toHaveBeenCalled() })
it('admin trocou pro Studio antes da troca: vai 119.9', async () => { ... })
it('dois checkouts com desconto pagos: cada um ganha a sua pendência', async () => { ... })
it('CHECKOUT_PAID repetido: não grava outro offer_used nem duplica a pendência aberta', async () => { ... })
it('checkout sem oferta: nenhuma pendência de preço', async () => { ... })
it('sem as colunas da oferta (SQL ainda não rodou) o CHECKOUT_PAID ativa normal', async () => { db.failTable... 42703 só no select com offer_month; expect(result).toEqual({ result: 'activated' }) })
it('CPF já usado noutra conta marca a ficha', async () => { expect(sub.admin_note).toContain('o mesmo CPF ja usou a oferta em outra conta') })
it('Asaas fora ao ler o CPF marca CPF não conferido e não derruba a ativação', async () => { ... })
it('sem OFFER_CPF_SECRET marca CPF não conferido', async () => { ... })
it('hashCpf ignora pontos e traço, tem 64 caracteres e nunca contém o número', () => { expect(hashCpf('123.456.789-09', 's')).toBe(hashCpf('12345678909', 's')); expect(hashCpf('12345678909', 's')).not.toContain('12345678909') })
it('o CPF nunca vai pro log', async () => { expect(JSON.stringify(logSpy.mock.calls)).not.toContain('12345678909') })
it('arrependimento depois da oferta: a prévia mostra 24,90', async () => { expect(preview.amount).toBe(24.9) })
// admin-review.test.ts
it('marcar como feito com o Asaas ainda em 24,90 é recusado', async () => { expect(res.statusCode).toBe(409) })
it('marcar como feito com o Asaas em 49,90 fecha', async () => { ... })
it('restore_full_price tem título e motivo em português, sem travessão', () => { ... })
// reconcile.test.ts
it('primeira cobrança de 24,90 numa assinatura de 49,90 não vira marcação', async () => { expect(flags).toHaveLength(0) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/offer-activation.test.ts api/__tests__/admin-review.test.ts api/__tests__/reconcile.test.ts > $LOGS/t13.txt 2>&1; tail -20 $LOGS/t13.txt`.
- [ ] **Step 3: Implementar** o que está em Interfaces; atualizar o FATOS.
- [ ] **Step 4: Rodar** `npx vitest run api src/admin > $LOGS/t13b.txt 2>&1; tail -5 $LOGS/t13b.txt`. Esperado: PASS, com `asaas-webhook.test.ts` e o `forbiddenInWebhook` sem achado novo (o PUT não é estorno).
- [ ] **Step 5: Commit**

```bash
git add api/_lib/offerCpf.ts api/_lib/billing.ts api/_lib/asaas.ts api/_lib/admin/review.ts src/admin/lib/reviewText.ts src/admin/lib/reviewTypes.ts api/__tests__/billingHarness.ts api/__tests__/offer-activation.test.ts api/__tests__/admin-review.test.ts api/__tests__/reconcile.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(oferta): depois do primeiro pagamento a assinatura volta pro preco cheio por pendencia, CPF conferido por hash [Parte 3] [T13]"
```

---

## Onda 4: o app conhece o Livre novo

### Task 14: Planos: funções próprias e Livre novo

**Files:**
- Modify: `src/lib/plans.ts`; `src/App.tsx` (só: `autoClick: canUseGeneratedClick(userPlan)`; tom, tom original e seletor de tom por `canChangeKey`; biblioteca por `canUsePlatformCatalog`; o painel de pads do celular abre pra todos; `padSets` dos dois palcos por `canUseCloudPads`; `handlePremiumFeature` sai), `src/components/SeparatorStudio.tsx` (só a tela de opções: os cartões vêm de `separationStemOptions(userPlan)`; no Livre aparecem 4 e 6 sem cadeado e o de 2 não aparece), `scripts/verify-layout/fixture.ts` (a constante `LIVRE` fica como o convite das seções; comentário dizendo que nenhum plano usa mais), textos com os números velhos (D13: `src/content/site.ts` linhas do Livre, `src/components/LandingPage.tsx` lista do Livre e o parágrafo "No Livre você separa 5 músicas...", `src/components/SubscriptionPanel.tsx` e `src/lib/subscription.ts` "(5 separações por mês, em 2 faixas)" viram "(3 separações por mês, em 4 ou 6 faixas)"), `PLAYBACK_STUDIO_FATOS.md` (seção "Livre": a tabela nova do spec, seção 5, marcada "(não publicado)")
- Test: `src/lib/plans.test.ts` (novo), `src/components/stage/buildStageView.test.ts`, `src/appWiring.test.ts`, `src/lib/separationUsage.test.ts`, `src/components/SeparationUsageMeter.test.tsx`, `src/components/LandingPage.test.tsx`, `src/lib/subscription.test.ts`

**Interfaces:**
- Produces em `plans.ts` (as que já existem mantêm o nome):
  - `canUseLiveMode(id)`: todos. `maxLiveDevices(id)`: Studio `Infinity`, Pro 4, Livre 1. `export function liveDailyLimitMs(id): number | null` (Livre `600_000`, pagos nulo).
  - `maxSeparationsPerMonth(id)`: Livre 3. `export type StemCount = 2 | 4 | 6`; `export function separationStemOptions(id): readonly StemCount[]` (Livre `[4, 6]`, pagos `[2, 4, 6]`).
  - Todos: `canUseBpmDetection`, `canUseVoiceGuide`, `canUseSections`, `export function canUseGeneratedClick(id)`, `export function canChangeKey(id)`, `export function canUsePlatformCatalog(id)`.
  - Pagos: `canDownloadStems`, `export function canUseCloudPads(id)`, `export function canUseRepertoire(id)` (próxima, anterior e AUTO entre músicas, `.zip`). Studio: `canBandControlSections`.
  - `export function maxStageSongsPerMonth(id): number` (Livre 3, pagos `Infinity`).
  - O "Gerar click IA" do Metrônomo (`MetronomeModal.tsx`) já não tem trava de plano no código; continua sem (nenhuma função nova pra ele).

- [ ] **Step 1: Escrever os testes:**

```ts
it('Livre: 3 separações em 4 ou 6 faixas; Pro 50 e Studio 150 em 2, 4 ou 6', () => { expect(maxSeparationsPerMonth('free')).toBe(3); expect(separationStemOptions('free')).toEqual([4, 6]); expect(separationStemOptions('pro_anual')).toEqual([2, 4, 6]) })
it('Livre: 3 músicas por mês no palco; pagos sem limite', () => { expect(maxStageSongsPerMonth('free')).toBe(3); expect(maxStageSongsPerMonth('essencial_mensal')).toBe(Infinity) })
it('Livre: Ao Vivo com 1 celular e 10 minutos por dia; Pro 4 e Studio sem limite, sem teto de tempo', () => { expect(maxLiveDevices('free')).toBe(1); expect(liveDailyLimitMs('free')).toBe(600_000); expect(liveDailyLimitMs('pro_mensal')).toBeNull() })
it('voz guia, BPM pela IA, click gerado, seções, tom e catálogo abertos pra todos', () => { ... })
it('baixar, pads da nuvem e repertório seguem pagos; banda nas seções só no Studio', () => { ... })
// buildStageView.test.ts: 'portões do plano Livre e do Studio' passa a esperar { sections: true, infinite: true, maxRepeats: 9, bandSections: false } no Livre
// appWiring.test.ts
it('o motor recebe autoClick: canUseGeneratedClick(userPlan)', () => { expect(app).toMatch(/autoClick:\s*canUseGeneratedClick\(userPlan\)/) })
it('handlePremiumFeature sumiu: tom por canChangeKey, biblioteca por canUsePlatformCatalog e pads da nuvem por canUseCloudPads', () => { expect(app).not.toMatch(/handlePremiumFeature/) })
// o teste antigo do setOriginalKey passa a procurar canChangeKey no lugar de handlePremiumFeature
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/plans.test.ts src/components/stage/buildStageView.test.ts src/appWiring.test.ts > $LOGS/t14.txt 2>&1; tail -20 $LOGS/t14.txt`.
- [ ] **Step 3: Implementar** `plans.ts`, as trocas nos chamadores e os textos; atualizar o FATOS.
- [ ] **Step 4: Rodar a suíte inteira:** `npx vitest run > $LOGS/t14b.txt 2>&1; tail -5 $LOGS/t14b.txt`. Esperado: PASS depois de trocar 5 por 3 e "2 faixas" por "4 ou 6 faixas" nos testes de `separationUsage`, `SeparationUsageMeter`, `LandingPage` e `subscription`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts src/App.tsx src/components/SeparatorStudio.tsx scripts/verify-layout/fixture.ts src/content/site.ts src/components/LandingPage.tsx src/components/SubscriptionPanel.tsx src/lib/subscription.ts src/components/stage/buildStageView.test.ts src/appWiring.test.ts src/lib/separationUsage.test.ts src/components/SeparationUsageMeter.test.tsx src/components/LandingPage.test.tsx src/lib/subscription.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(livre): plans.ts com uma funcao por recurso; Livre com palco completo, 3 separacoes em 4 ou 6 faixas [Parte 3] [T14]"
```

### Task 15: Hook do Livre

**Files:**
- Create: `src/hooks/useLivre.ts`
- Test: `src/hooks/useLivre.test.ts`

**Interfaces:**
- Consumes: T6 (regras e store); `planTier`, `maxStageSongsPerMonth`, `liveDailyLimitMs` (T14); `brtMonth`, `brtDay`.
- Produces:

```ts
export type LivreState = {
  isLivre: boolean                                   // !isAdmin && planTier(plan) === 'free'
  stage: { used: number; limit: number }
  canOpenSong(key: string | null, opts?: { freeThisMonth?: boolean }): boolean   // não grava; chave nula sempre abre
  canOpenNewSong(): boolean
  noteSongOpened(key: string | null, opts?: { freeThisMonth?: boolean }): void   // grava; nunca barra
  live: { remainingMs: number; limitMs: number | null }
  canStartLive(): boolean
  limit: LimitKind | null                            // a tela a mostrar agora (só com o motor parado)
  requestLimit(kind: LimitKind): void
  closeLimit(): void
}
export function useLivre(i: { userId: string | null; plan: string; isAdmin: boolean; busy: EngineBusy; liveActive: boolean; onLiveExpired(): void; now?: () => Date }): LivreState
```
Leitura do store por `useSyncExternalStore(subscribeLivre, livreVersion)`. Fila pela `QuietQueue` (T6), assentada num efeito quando `busy` muda. Conta paga ou admin: tudo aberto, `limit` nunca deixa de ser nulo, nenhum timer. Ao Vivo: com `isLivre && liveActive && limitMs !== null`, `setInterval` de 1000 ms soma `addLiveTime` e grava; ao chegar a 0, `onLiveExpired()` uma vez por esgotamento e `requestLimit('live')`. O hook não recebe nada do motor além de `busy`: não tem como parar o som.

- [ ] **Step 1: Escrever os testes** (`renderHook`, timers falsos, `localStorage` do jsdom limpo a cada teste):

```ts
it('conta paga nunca vê limite nem selo', () => { expect(r.isLivre).toBe(false); expect(r.canOpenSong('song:9')).toBe(true); r.requestLimit('stage-songs'); expect(r.limit).toBeNull() })
it('admin no Livre não tem limite', () => { ... })
it('Livre: 3 músicas diferentes contam 3, a 4ª nova é barrada e a 1ª de novo abre', () => { ... expect(r.stage).toEqual({ used: 3, limit: 3 }); expect(r.canOpenSong('song:d')).toBe(false); expect(r.canOpenSong('song:a')).toBe(true) })
it('separação do mês abre com 3 de 3 e não conta', () => { ... })
it('requestLimit com a música tocando só mostra quando para', () => { ... })
it('Ao Vivo: 10 minutos com a sessão ligada chamam onLiveExpired uma vez e pedem a tela live', () => { vi.advanceTimersByTime(600_000); expect(onLiveExpired).toHaveBeenCalledTimes(1); expect(r.limit).toBe('live') })
it('os 10 minutos acabam com a música tocando: a banda sai na hora e a tela só aparece quando a música para', () => { ... })
it('canStartLive falso com os 10 minutos gastos e verdadeiro no dia seguinte de Brasília', () => { ... })
it('sessão desligada não gasta minutos', () => { ... })
it('duas instâncias (palco e Separador) veem a mesma contagem', () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/hooks/useLivre.test.ts > $LOGS/t15.txt 2>&1; tail -20 $LOGS/t15.txt`.
- [ ] **Step 3: Implementar** `useLivre.ts`.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLivre.ts src/hooks/useLivre.test.ts
git commit -m "feat(livre): hook com as musicas do mes, os 10 minutos do Ao Vivo e a tela de limite so com a musica parada [Parte 3] [T15]"
```

### Task 16: Oferta e eventos no app

**Files:**
- Create: `src/lib/offer.ts`, `src/lib/checkout.ts`, `src/lib/productEvents.ts`, `src/components/livre/LimitGate.tsx`
- Modify: `src/components/PricingModal.tsx` (ao abrir, `fetchOffer({ open: false })`, que nunca abre janela; assinar passa por `startCheckout`; com janela ativa, Pro Mensal e Studio Mensal mostram o primeiro mês com desconto e mandam `offer: true`; o resto e os `alert` de hoje ficam), `PLAYBACK_STUDIO_FATOS.md` (seção "Cobrança": a tela de Planos mostra o primeiro mês com desconto enquanto a janela está aberta)
- Test: `src/lib/offer.test.ts`, `src/lib/checkout.test.ts`, `src/lib/productEvents.test.ts`, `src/components/livre/limitGate.test.tsx`, `src/components/PricingModal.test.tsx`

**Interfaces:**
- Consumes: Contratos `?action=offer`, `?action=track` e `offer: true` (T12); `LimitScreen`, `OfferView` (T7); `apiUrl`, `getAuthHeaders`, `isElectron`, `openExternalUrl`.
- Produces:
  - `offer.ts`: `export type OfferResponse = { status: 'active' | 'expired' | 'used' | 'none' | 'ineligible'; expiresAt: string | null; prices: { essencial_mensal: number; pro_mensal: number } }`; `export async function fetchOffer(i: { open: boolean; trigger?: LimitKind }): Promise<OfferResponse | null>` (nulo sem internet ou com erro); `export function toOfferView(r: OfferResponse | null, now: number): OfferView` (`active` só com `expiresAt` no futuro; o resto vira `none`).
  - `checkout.ts`: `export type CheckoutPlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'`; `export type CheckoutOutcome = { kind: 'opened'; external: boolean } | { kind: 'error'; message: string; offerEnded: boolean }`; `export async function startCheckout(i: { planKey: CheckoutPlanKey; confirmedSwitch?: boolean; offer?: boolean }): Promise<CheckoutOutcome>` (no Electron abre por `openExternalUrl`; na web vai pra `data.url`; erro de rede vira frase em português).
  - `productEvents.ts`: `export function trackAd(kind: 'ad_shown' | 'ad_clicked', placement: AdPlacement): void` (dispara e esquece; nunca lança; sem sessão não manda).
  - `LimitGate.tsx`: `export interface LimitGateProps { kind: LimitKind; onClose(): void; onSeePlans(): void }` e `export function LimitGate(props)`: ao montar, `fetchOffer({ open: true, trigger: kind })` e `trackAd('ad_shown', 'limit')` uma vez; escolher chama `trackAd('ad_clicked', 'limit')` e `startCheckout({ planKey, offer: true })`; `offerEnded` busca de novo com `open: false` e mostra a frase do servidor.

- [ ] **Step 1: Escrever os testes** (`fetch` falso por `vi.stubGlobal`):

```ts
it('fetchOffer manda open e trigger pro /api/checkout?action=offer pelo apiUrl', async () => { expect(url).toContain('/api/checkout?action=offer'); expect(JSON.parse(init.body)).toEqual({ open: true, trigger: 'stage-songs' }) })
it('fetchOffer sem internet devolve null', async () => { ... })
it('toOfferView: active com expiresAt no futuro; expired, used, ineligible, none e null viram none', () => { ... })
it('startCheckout com offer manda offer true e no Electron abre no navegador do sistema', async () => { ... })
it('startCheckout com 409 offerEnded devolve error com offerEnded', async () => { ... })
it('trackAd manda kind e placement e nunca lança sem internet', () => { ... })
it('LimitGate abre a janela com o tipo do limite e mostra o relógio', async () => { ... })
it('LimitGate: escolher o Pro chama startCheckout com offer true e grava ad_clicked limit', async () => { ... })
it('LimitGate: oferta que terminou no meio mostra a frase do servidor e tira os preços com desconto', async () => { ... })
it('LimitGate sem internet abre a tela sem oferta', async () => { ... })
// PricingModal.test.tsx
it('com a janela aberta, Pro Mensal mostra primeiro mês por R$ 24,90, Studio Mensal R$ 59,90, e assinar manda offer true', async () => { ... })
it('anual nunca mostra a oferta e sem janela tudo fica como antes', async () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/offer.test.ts src/lib/checkout.test.ts src/lib/productEvents.test.ts src/components/livre/limitGate.test.tsx src/components/PricingModal.test.tsx > $LOGS/t16.txt 2>&1; tail -20 $LOGS/t16.txt`.
- [ ] **Step 3: Implementar**; atualizar o FATOS.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/offer.ts src/lib/offer.test.ts src/lib/checkout.ts src/lib/checkout.test.ts src/lib/productEvents.ts src/lib/productEvents.test.ts src/components/livre/LimitGate.tsx src/components/livre/limitGate.test.tsx src/components/PricingModal.tsx src/components/PricingModal.test.tsx PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(oferta): tela de limite ligada a oferta, checkout compartilhado e eventos de anuncio no app [Parte 3] [T16]"
```

---

## Onda 5: ligar

### Task 17: Palco e repertório no Livre

**Files:**
- Modify: `src/App.tsx`, `src/components/LibraryModal.tsx`, `PLAYBACK_STUDIO_FATOS.md` (seção "Livre": músicas do mês, uma música por vez, o que do repertório é pago, o selo; seção 5 "Telas e features visíveis": a tela de limite)
- Test: `src/appWiring.test.ts`, `src/components/LibraryModal.bpm.test.tsx` (ou um `LibraryModal.livre.test.tsx` novo com o mesmo mock)

**Interfaces:**
- Consumes: `useLivre` (T15), `stageSongKey` (T6), `canUseRepertoire` (T14), `LimitGate` (T16), `trackAd` (T16), `autoNext` (T9), `LivreBadge` pela barra (T8).
- `LibraryModal` ganha `onBeforeDownload?: (songId: string) => boolean`; falso não baixa nada.
- `App.tsx` (nomes internos que os testes procuram):
  - `const livre = useLivre({ userId: user?.id ?? null, plan: userPlan, isAdmin, busy: { isPlaying, isCountingIn }, liveActive: false, onLiveExpired: () => {} })` (a T18 liga o Ao Vivo).
  - `useAudioEngine(..., { ..., autoNext: isAdmin || canUseRepertoire(userPlan) })`.
  - Efeito na troca da música atual: `livre.noteSongOpened(stageSongKey(activeSong))`.
  - `importFilesGated(files: FileList)`: Livre sem vaga (`!canOpenNewSong()`) pede `requestLimit('stage-songs')`; senão `loadFiles` e, no Livre com a VS parada, a música nova vira a atual (`jumpToSong(playlist.length - 1)` num efeito que vê o repertório crescer depois de um carregamento pedido aqui). O `onDownload` da biblioteca segue o mesmo caminho.
  - `jumpToSongGated(i: number)`: Livre e `!canOpenSong(stageSongKey(playlist[i]))` pede `'stage-songs'`; senão `jumpToSong(i)`.
  - `nextSongGated()`, `prevSongGated()`: Livre pede `'repertoire'` (o anterior na primeira música continua voltando pro começo dela); senão `nextSong()`/`prevSong()`.
  - `exportZipGated()`, `importZipGated(file: File)`: Livre pede `'repertoire'`; senão `handleExport()` e `importPlaylist(file)`.
  - Usados nos dois palcos (`stageImpl` e os botões, listas e menus do palco antigo) e nos comandos `next`, `prev` e `select-song` da banda.
  - `<LimitGate kind={livre.limit} ... />` quando `livre.limit` existe, com "Ver todos os planos" fechando a tela e abrindo os Planos; `stageKeyboard` fica desligado com `livre.limit !== null`.
  - Entrada do `buildStageView`: `livre: livre.isLivre ? livre.stage : null`; `openLivreBadge: () => { trackAd('ad_clicked', 'badge'); setIsPricingOpen(true) }`.

- [ ] **Step 1: Escrever os testes:**

```ts
// LibraryModal
it('onBeforeDownload falso não baixa nada', async () => { expect(downloadSong).not.toHaveBeenCalled() })
it('onBeforeDownload verdadeiro baixa e chama onDownload', async () => { ... })
// appWiring.test.ts
it('a biblioteca pergunta ao Livre com cloud:<id> antes de baixar', () => { expect(app).toMatch(/onBeforeDownload=\{\(songId\)\s*=>[\s\S]{0,200}cloud:\$\{songId\}/) })
it('importar, repertório, próxima, anterior e .zip passam pelas versões com o Livre nos dois palcos', () => { for (const n of ['importFilesGated', 'jumpToSongGated', 'nextSongGated', 'prevSongGated', 'exportZipGated', 'importZipGated']) expect(app).toMatch(new RegExp(`\\b${n}\\(`)); expect(app).not.toMatch(/onClick=\{nextSong\}|onClick=\{prevSong\}|onChange=\{handleImport\}/) })
it('comandos next, prev e select-song da banda passam pelas versões com o Livre', () => { expect(app).toMatch(/case 'next':\s*nextSongGated\(\)/); expect(app).toMatch(/case 'select-song':[^\n]*jumpToSongGated\(/) })
it('o motor recebe autoNext pelo plano', () => { expect(app).toMatch(/autoNext:\s*isAdmin\s*\|\|\s*canUseRepertoire\(userPlan\)/) })
it('a música atual conta pelo stageSongKey', () => { expect(app).toMatch(/noteSongOpened\(stageSongKey\(/) })
it('a tela de limite está no App e desliga os atalhos', () => { expect(app).toMatch(/<LimitGate[\s\S]*?kind=\{livre\.limit\}/); expect(app).toMatch(/stageKeyboard\s*=[\s\S]{0,400}livre\.limit\s*===\s*null/) })
it('o selo grava o clique e abre os Planos', () => { expect(app).toMatch(/openLivreBadge:\s*\(\)\s*=>\s*\{\s*trackAd\('ad_clicked',\s*'badge'\)/) })
it('nenhum alert, confirm ou prompt novo no App', () => { expect(app.match(/\balert\s*\(/g)).toHaveLength(4); expect(app).not.toMatch(/\b(confirm|prompt)\s*\(/) }) // os 4 de hoje: editor de marcadores do admin
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/appWiring.test.ts src/components/LibraryModal*.test.tsx > $LOGS/t17.txt 2>&1; tail -20 $LOGS/t17.txt`.
- [ ] **Step 3: Implementar** a ligação no `App.tsx` e a prop no `LibraryModal`; atualizar o FATOS.
- [ ] **Step 4: Rodar** a suíte inteira, `tsc` dos dois projetos e `node scripts/verify-layout/run.mjs > $LOGS/layout.txt 2>&1; tail -5 $LOGS/layout.txt`. Esperado: PASS e os 11 estados nos 8 tamanhos.
- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/LibraryModal.tsx src/appWiring.test.ts src/components/LibraryModal.livre.test.tsx PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(livre): palco e repertorio com 3 musicas por mes, uma por vez, e tela de limite nos dois palcos [Parte 3] [T17]"
```

### Task 18: Ao Vivo do Livre e anúncio da tela inicial

**Files:**
- Create: `src/components/livre/AdSlot.tsx`
- Modify: `src/App.tsx`, `PLAYBACK_STUDIO_FATOS.md` (seção "Livre": Ao Vivo com 1 celular e 10 minutos por dia; anúncio da casa: tela inicial uma vez por dia, um anúncio grande por sessão; seção "Exclusivo do app desktop": o Livre também tem o Modo Ao Vivo, com o limite)
- Test: `src/components/livre/adSlot.test.tsx`, `src/appWiring.test.ts`

**Interfaces:**
- Consumes: `useLivre` (T15), `HouseAdCard` (T8), `trackAd` (T16), `shouldShowHomeAd`, `shouldShowSeparationAd`, store do anúncio (T6), `maxLiveDevices` (T14).
- Produces: `export interface AdSlotProps { placement: 'home' | 'separation-done'; userId: string | null; isLivre: boolean; quiet: boolean; justSeparated?: boolean; onCta(): void }` e `export function AdSlot(props)`: decide na primeira vez em que `quiet` é verdadeiro com ele montado (regras da T6); ao decidir mostrar, `markBigAdShown()`, na tela inicial `writeHomeAdDay(userId, brtDay(now))`, e `trackAd('ad_shown', placement)` uma vez; renderiza o cartão só com `quiet`; "Conhecer o Pro" grava `ad_clicked` e chama `onCta`; "Agora não" esconde de vez.
- `App.tsx`:
  - `const onLiveExpired = () => { void handleStopLiveMode(); setRemoteSessionCode(null); setApprovedIps([]) }` (nada do motor) e `useLivre({ ..., liveActive: hostActive, onLiveExpired })`; o hook guarda a versão mais nova do callback num ref.
  - `handleStartLiveMode`: sai o teste de `canUseLiveMode`; Livre com `!livre.canStartLive()` pede `requestLimit('live')` e para.
  - Aprovar celular (`onToggleDevice`, `onToggleAll`): passou de `maxLiveDevices(userPlan)` no Livre pede `requestLimit('live')`; nos pagos abre os Planos como hoje.
  - Tela inicial (o retorno do splash): `<AdSlot placement="home" ... quiet={!isPlaying && !isCountingIn} onCta={() => setIsPricingOpen(true)} />` embaixo dos dois botões, e o `PricingModal` também renderizado dentro desse retorno.

- [ ] **Step 1: Escrever os testes:**

```ts
// adSlot.test.tsx
it('mostra na tela inicial uma vez por dia e grava ad_shown home uma vez', () => { ... })
it('o anúncio da tela inicial não aparece com a música tocando', () => { expect(container.textContent).not.toContain(HOME_AD.title) })
it('não mostra se já houve anúncio grande na sessão', () => { ... })
it('conta paga nunca vê o anúncio', () => { ... })
it('Conhecer o Pro grava ad_clicked e chama onCta; Agora não esconde de vez', () => { ... })
it('o do fim da separação só aparece com justSeparated', () => { ... })
// appWiring.test.ts
it('a sessão do Ao Vivo conta os minutos do Livre e, quando acabam, desliga a banda sem tocar no motor', () => { const body = app.match(/const onLiveExpired = \(\) => \{[^}]*\}/)![0]; expect(body).toMatch(/handleStopLiveMode\(\)/); expect(body).not.toMatch(/\b(pause|stopAll\w*|cancelCountIn)\(/); expect(app).toMatch(/liveActive:\s*hostActive/) })
it('começar o Ao Vivo no Livre sem minutos pede a tela live', () => { expect(app).toMatch(/canStartLive\(\)[\s\S]{0,120}requestLimit\('live'\)/) })
it('o 2º celular no Livre pede a tela live; no pago passa do teto e abre os Planos', () => { ... })
it('a tela inicial tem o AdSlot home e o PricingModal', () => { ... })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/livre/adSlot.test.tsx src/appWiring.test.ts > $LOGS/t18.txt 2>&1; tail -20 $LOGS/t18.txt`.
- [ ] **Step 3: Implementar**; atualizar o FATOS.
- [ ] **Step 4: Rodar** a suíte inteira e `DESKTOP=1 npx vite build > $LOGS/build.txt 2>&1; tail -5 $LOGS/build.txt`. Esperado: PASS e build sem erro.
- [ ] **Step 5: Commit**

```bash
git add src/components/livre/AdSlot.tsx src/components/livre/adSlot.test.tsx src/App.tsx src/appWiring.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(livre): Ao Vivo com 1 celular e 10 minutos por dia, e anuncio da casa na tela inicial [Parte 3] [T18]"
```

### Task 19: Separador no Livre

**Files:**
- Modify: `src/components/SeparatorStudio.tsx`, `PLAYBACK_STUDIO_FATOS.md` (seção "Livre": separação do mês sempre abre; reabrir separação de mês anterior conta; baixar mostra a tela de limite; anúncio ao terminar a separação)
- Test: `src/components/separatorLivre.test.ts` (novo, conferência no texto do código como em `appWiring.test.ts`)

**Interfaces:**
- Consumes: `useLivre` com `busy: { isPlaying, isCountingIn: false }` e `liveActive: false` (T15); `separationKey`, `separationIsThisMonth` (T6); `LimitGate` (T16); `AdSlot` (T18).
- Mudanças:
  - Cota no começo de `processAudio` e o `402`: em vez do `alert` e do `setIsPricingOpen(true)`, `livre.requestLimit('separations')` (com o mesmo texto do servidor no Livre; nos pagos a tela de Planos como hoje).
  - Baixar sem `canDownload`: no Livre `requestLimit('download')`; nos pagos nada muda.
  - `handleOpenSavedSeparation(sep)`: no Livre, `freeThisMonth = separationIsThisMonth(sep.createdAt, new Date())`; com `canOpenSong(separationKey(sep.id), { freeThisMonth })` abre e chama `noteSongOpened` com as mesmas opções; senão pede `'stage-songs'` e não abre.
  - Separação nova que acabou de terminar abre sem contar (é do mês) e liga `justSeparated` até a pessoa abrir outra; `<AdSlot placement="separation-done" justSeparated={...} quiet={!isPlaying} ... />` ao lado do resultado, com "Conhecer o Pro" abrindo os Planos.
  - `<LimitGate>` renderizado pelo próprio Separador quando `livre.limit` existe.

- [ ] **Step 1: Escrever os testes:**

```ts
const sep = read('./SeparatorStudio.tsx')
it('as opções de faixas vêm de separationStemOptions', () => { expect(sep).toMatch(/separationStemOptions\(userPlan\)/) })
it('limite de separações e o 402 pedem a tela separations e não usam alert', () => { expect(sep).toMatch(/requestLimit\('separations'\)/); expect(sep).not.toMatch(/alert\(`Você já usou/) })
it('baixar no Livre pede a tela download', () => { expect(sep).toMatch(/requestLimit\('download'\)/) })
it('abrir separação salva passa por canOpenSong com separationKey e freeThisMonth', () => { expect(sep).toMatch(/canOpenSong\(separationKey\(sep\.id\),\s*\{\s*freeThisMonth/) })
it('o anúncio do fim da separação fica ao lado do resultado e só com a música parada', () => { expect(sep).toMatch(/<AdSlot[\s\S]*?placement="separation-done"[\s\S]*?quiet=\{!isPlaying\}/) })
it('a tela de limite é renderizada pelo Separador', () => { expect(sep).toMatch(/<LimitGate[\s\S]*?kind=\{livre\.limit\}/) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separatorLivre.test.ts > $LOGS/t19.txt 2>&1; tail -20 $LOGS/t19.txt`.
- [ ] **Step 3: Implementar**; atualizar o FATOS.
- [ ] **Step 4: Rodar** a suíte inteira, `tsc` dos dois projetos e `DESKTOP=1 npx vite build`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/SeparatorStudio.tsx src/components/separatorLivre.test.ts PLAYBACK_STUDIO_FATOS.md
git commit -m "feat(livre): Separador com 4 ou 6 faixas, separacao do mes sempre abre, tela de limite e anuncio ao terminar [Parte 3] [T19]"
```

---

## Onda 6

### Task 20: Documentação viva e portão final

**Files:**
- Modify: `PLAYBACK_STUDIO_FATOS.md` (consolida as linhas "(não publicado)" das T3 a T19; seção "Livre" reescrita com a tabela do spec seção 5 e as regras D3 a D5; "Cobrança": oferta, janela, CPF, preço cheio e `OFFER_CPF_SECRET`; "Admin": funil, 21 ações, pendência nova; entrada nova no Histórico "Livre como amostra, anúncio da casa e oferta do primeiro mês" com o que mudou, a ordem do SQL da Publicação 1b, o "antes" do funil anotado na Publicação 1a, os limites conhecidos (a contagem no aparelho pode ser burlada limpando o aparelho; o app antigo ainda mostra "5 separações" até atualizar) e a **nota de lançamento** que o @devops copia pro `src/lib/changelog.ts` no bump: Livre com o palco completo e 3 músicas por mês; 3 separações por mês em 4 ou 6 faixas; Ao Vivo de 10 minutos por dia com 1 celular; primeiro mês do Pro por R$ 24,90 e do Studio por R$ 59,90; o plano fica guardado no aparelho pra tocar sem internet), `DESIGN_SYSTEM.md` (2.7 `StageDialog` e 2.8 Livre conferidos com o código)

- [ ] **Step 1: Escrever** as duas atualizações de documento.
- [ ] **Step 2: Portão final:** `npx vitest run`, `npx tsc -b`, `npx eslint` nos arquivos da parte, `DESKTOP=1 npx vite build`, `node scripts/verify-layout/run.mjs`, `node scripts/verify-pitch/run.mjs`, `PBS_REPO=~/playback-studio-work/parte2 bash ~/playback-studio-work/admin-sql-tests/run-all.sh`, `find api -name '*.ts' -not -path 'api/_lib/*' -not -path 'api/__tests__/*' | wc -l` e `git diff --name-only main... | xargs grep -l "$(printf '\xe2\x80\x94')"`. Esperado: tudo verde, `0 falhas` no SQL, `12` funções e nenhum arquivo com travessão.
- [ ] **Step 3: Commit**

```bash
git add PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
git commit -m "docs(fatos): Livre como amostra, anuncio da casa, oferta do primeiro mes e funil, consolidados (nao publicado) [Parte 3] [T20]"
```

**Publicação 1b** (seção "Ordem, dependências e publicação").
