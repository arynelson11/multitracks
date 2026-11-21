# Parte 3, partes 3 a 5: tela inicial, Biblioteca e Planos no layout do palco (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Levar três telas pra linguagem do palco novo, na ordem do spec (seção 10: tela inicial, depois Biblioteca, depois Planos), cada uma publicável sozinha, sem tirar nenhuma função: a tela inicial (o retorno do splash no `App.tsx`, com o anúncio da casa da 1b), a Biblioteca (`LibraryModal.tsx`, abas PLATAFORMA e MINHAS MÚSICAS, com a trava do Livre da 1b) e os Planos (`PricingModal.tsx`, mantendo a oferta do primeiro mês da 1b).

**Arquitetura:** Cada tela vira uma peça de vista (só props, sem hook) e um contêiner que guarda os hooks e a lógica de hoje sem mudar de sentido: `src/components/home/HomeScreen.tsx` (o App é o contêiner), `src/components/library/LibraryView.tsx` com o `LibraryModal.tsx`, `src/components/pricing/PricingView.tsx` com o `PricingModal.tsx`. As janelas usam o `StageDialog` (`size="lg"` do kit da faixa B, com a pilha pra confirmação por cima); os campos, abas e avisos usam o kit novo. O verificador de layout monta as vistas como páginas, sem Supabase.

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4 (tokens `ps-*`, peças de `src/components/ui/` com o kit da faixa B e de `src/components/stage/`) + Electron 42 (roda de `file://`) + Supabase (biblioteca na nuvem) + Asaas (só pelo checkout da 1b) + Vitest 4/jsdom/Testing Library + `scripts/verify-layout/`.

**Spec:** `docs/superpowers/specs/2026-11-19-parte3-telas-e-livre-design.md` (autoridade): seções 2 (objetivo 5), 4, 6 (anúncio na tela inicial), 7 (oferta nos Planos), 9, 10 (ordem 3, 4, 5), 11 e 12. Palco: `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (5b e a linguagem). Visual: mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`, só leitura), `DESIGN_SYSTEM.md` 1.7, 2.6, 2.7 e 2.8. Fatos: `PLAYBACK_STUDIO_FATOS.md`. Regras das faixas: `~/playback-studio-work/parte3-faixas/regras-comuns.md`. Kit novo: `~/playback-studio-work/parte3-faixas/kit-novo.md`.

**Base:** este plano parte do código **depois** das tarefas 14 a 19 do plano `docs/superpowers/plans/2026-11-19-parte3-livre-amostra.md` (frente 1b: a T16 mexe no `PricingModal`, a T17 no `LibraryModal` com `onBeforeDownload`, a T18 põe o `AdSlot` e o `PricingModal` na tela inicial) e do kit da faixa B (commit `6a18d4a`). Roda depois do plano `docs/superpowers/plans/2026-11-20-parte3-separador-no-palco.md` (que cria as páginas do verificador e mexe no mesmo `App.tsx`). O que está marcado **[conferir depois da 1b]** depende de um detalhe que o plano da 1b não fixa: antes do passo, abra o arquivo e acerte o nome; a regra do passo continua valendo.

## Global Constraints

- **Muda a cara, não o que o app faz.** Nenhuma função some, nenhum botão perde a ação, nenhuma prop ou handler muda de sentido. Antes de mexer, a tarefa lista o que a tela faz hoje e escreve o teste que prova que continua lá.
- Linguagem do palco: tokens `ps-*`, Inter + JetBrains Mono (`font-ps-sans`, `font-ps-mono`, `ps-num`), painéis, chips, seletor segmentado, LEDs. Cores com um significado só: laranja (`ps-or`) = ligado ou ação principal; branco (`ps-arm`) = armado; âmbar (`ps-alert`) = alerta. O dourado `primary`, o `secondary` e o roxo de hoje saem destas telas.
- Nenhum texto encostando na borda ou cortado; botão com largura pelo texto; linhas de botões com `flex-wrap`; alvo de toque de 44 px. Botão novo só se for prático e tiver função clara.
- Português do Brasil em todo texto. Nenhum travessão (U+2014) em nenhuma linha adicionada, comentário ou commit; nos testes, `const TRAVESSAO = String.fromCharCode(0x2014)`. Vocabulário: "multitracks" e "separação de faixas".
- Os textos continuam os mesmos. O que hoje aparece em caixa alta só pelo CSS pode aparecer em caixa de frase, sem trocar palavra. Mudam só os textos que este plano lista.
- Copy (FATOS e spec 12): resultado antes de recurso, sem prometer número de vendas. Nenhum texto de venda novo nestas telas além do que a 1b já pôs.
- App de computador (`file://`): nada de caminho absoluto `/` novo em `src/` (API por `apiUrl()`, link externo por `openExternalUrl()`); nenhum `window.prompt`, `window.alert` ou `window.confirm` novo. Os `alert` e o `confirm` destas telas viram frase na janela (`Notice tone="alert" role="alert"`) e confirmação numa janela do palco, com o mesmo texto (Q2, Q3).
- Livre (regras da 1b, sem mudar): anúncio e tela de limite nunca com a música tocando ou na pré-contagem (a fila da 1b decide; estas telas só mostram); a Biblioteca pergunta ao Livre antes de baixar (`onBeforeDownload`); os Planos mostram o primeiro mês com desconto só com a janela da oferta aberta e nunca no anual. Quem paga não perde nada.
- Peças: só as de `src/components/ui/` (2.6 e o kit novo: `TextField`, `Select`, `Switch`, `Tabs`, `TabPanel`, `Notice`) e de `src/components/stage/` (`StageDialog`, `Icon`, `TwoTapTrashButton`). Nenhuma peça nova em `src/components/ui/`: o que faltar está no fim, em "Pedidos pra dona do kit", e até lá a tela usa uma constante de classe local.
- Testes: teste de DOM com `// @vitest-environment jsdom` e `afterEach(cleanup)`; sem `jest-dom` e sem `user-event`. `.tsx` exporta só componentes; funções, tipos de dados e textos num `.ts` ao lado. Leitura de arquivo (`node:fs`) só dentro do próprio `*.test.ts`. Seletor de teste por papel, nome ou `data-*`, nunca por classe (os testes de hoje que usam `div.relative` passam a `[data-plan-card]`).
- Execução: worktree nova a partir do HEAD do plano do Separador (branch `feat/parte3-separador-palco`), branch `feat/parte3-inicio-biblioteca-planos`, `npm ci`. Todo comando começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd <worktree>`. Durante as tarefas, só os testes dos arquivos tocados. Commit por tarefa: `git add <arquivos novos>` e `git commit -m "<tipo>(<escopo>): ... [Parte 3 Telas] [T<N>]" -- <todos os arquivos da tarefa>`. Nada de push, tag, rebase, reset nem merge.
- Documentação viva: cada tarefa atualiza no mesmo commit o `PLAYBACK_STUDIO_FATOS.md` (entrada datada do dia da execução, marcada **[NÃO PUBLICADO]**, e a seção 5 "Telas e features visíveis") e o `DESIGN_SYSTEM.md` (nova seção 2.10 "Telas no layout do palco").

## Review Focus

1. **Planos com a oferta da 1b.** Esperado: com a janela do mês aberta, Pro Mensal e Studio Mensal mostram o primeiro mês com desconto e assinam com `offer: true`; o anual nunca; sem janela, tudo como antes; quem já paga confirma a troca antes; oferta que terminou no meio volta ao preço cheio com a frase do servidor, sem cobrar cheio sem a pessoa ver; erro na janela, sem `alert` (o app de computador). Testes: T4 os dois testes da T16 da 1b passando com a vista nova, T4 `oferta que terminou no meio mostra a frase e o preço cheio`, T4 `erro de rede vira frase na janela, sem alert`.
2. **Biblioteca no Livre.** Esperado: baixar passa sempre pelo `onBeforeDownload`; falso não baixa, não marca ADICIONADA e não gasta a vaga. Testes: T3 `onBeforeDownload falso não baixa nada` (o da T17 da 1b, passando com a vista nova), T3 `ADICIONADA só depois do download que deu certo`.
3. **Biblioteca sem internet.** Esperado: música no cache mostra ABRIR e abre; a que não está no cache mostra OFFLINE desligado; excluir sem internet só tira do aparelho, com o texto certo na confirmação; editar some sem internet. Testes: T3 `sem internet: ABRIR no cache, OFFLINE desligado fora dele e sem editar`, T3 `excluir sem internet pergunta "Remover do cache offline" e com internet avisa que some pra todos`.
4. **Tela inicial com a música tocando** (a pessoa volta pelo INÍCIO com a VS tocando). Esperado: o anúncio não aparece (a regra é da 1b; a vista não força nada); Multitracks volta ao palco sem reiniciar o motor (`initEngine` só sem `isReady`). Testes: T1 `a tela inicial é a HomeScreen, com o Multitracks ligando o motor só sem isReady`, T1 `o anúncio entra embaixo dos dois botões quando vem; sem ad, nenhum anúncio`.
5. **Nome longo e celular** (música, artista e plano com nome grande, 390 px de largura, janela de 1024 x 740). Esperado: nada cortado, linhas quebrando, botões inteiros. Testes: os estados do verificador `inicio`, `inicio-anuncio`, `biblioteca`, `biblioteca-editar`, `planos` e `planos-oferta` em 1024x740, 1280x800, 1920x1080 e 390x844.

---

## Decisões deste plano (o dono confere)

- **Q1. Biblioteca e Planos no `StageDialog size="lg"`** (até 672 px, do kit). No celular, a janela ocupa a tela menos os 16 px de folga e o conteúdo rola dentro. Os Planos mostram os 4 cartões em 2 colunas a partir de 640 px e em 1 coluna no celular.
- **Q2. Excluir da Biblioteca:** o `window.confirm` vira uma segunda janela do palco por cima (pilha do kit) com o mesmo texto de hoje, "Cancelar" e "Excluir" (âmbar, `tone="alert"`). Não é a lixeira de dois toques porque o aviso "para todos os usuários" precisa aparecer escrito.
- **Q3. Os `alert` da Biblioteca e dos Planos viram frase dentro da janela** (`Notice tone="alert" role="alert"`), com o mesmo texto; o `\n` do erro de rede vira duas frases.
- **Q4. Telas abertas pelo próprio usuário continuam abrindo com a música tocando**, como hoje (Biblioteca e Planos). A regra "nada por cima tocando" vale pro que abre sozinho (anúncio, oferta, tela de limite), que a 1b já cuida.
- **Q5. Os preços dos cartões dos Planos saem de `PRICES` (`src/content/site.ts`) com `formatReais`**, os mesmos valores de hoje: o cartão não desalinha do FATOS.
- **Q6. A Biblioteca e os Planos novos valem nos dois palcos e no Separador** (são as mesmas janelas). O palco antigo em si não muda.
- **Q7. Tela inicial:** os dois cartões neutros (laranja só no "Studio" da marca e no foco); o roxo da Separação e o dourado saem; a luz laranja piscando no logo sai (laranja aceso quer dizer ligado). "Minhas separações" fica no início do Separador (plano do Separador, P1), a um toque daqui.
- **Q8. "Trocar de plano?"** vira uma janela do palco por cima dos Planos (`StageDialog size="sm"`, pilha do kit), com o mesmo texto, "Voltar" e "Confirmar troca" (laranja). Hoje é um bloco dentro da janela com `role="dialog"`; o nome continua "Trocar de plano?".
- **Q9. O selo "Mais Popular" e o anel laranja ficam no Pro Mensal** (é a ação principal da janela: o botão dele é `tone="primary"`, os outros `default`).

## Ordem, dependências e publicação

| Parte | Tarefas | Publicável sozinha |
|---|---|---|
| A. Tela inicial | T1 | sim: portão no fim da T1, publicação A |
| B. Biblioteca | T2 Casca · T3 Linhas, editar, excluir e baixar | sim: portão no fim da T3, publicação B |
| C. Planos | T4 | sim: portão no fim da T4, publicação C |

Portão de cada parte, uma vez e com `caffeinate -i`: `npx vitest run` (código 0, sem "Errors"), `npx tsc -b`, `npm run typecheck` (os 7 erros antigos conhecidos: diga se continuam 7), `npx eslint` nos arquivos da parte (nenhum erro novo), `DESKTOP=1 npx vite build`, `node scripts/verify-layout/run.mjs` (os estados novos da parte nos 4 tamanhos de página e os do palco nos 8 de sempre) e `git diff --name-only <base>... | xargs grep -l "$(printf '\xe2\x80\x94')"` (nenhum arquivo). Este plano não mexe no motor: sem verify-pitch.

**Cada publicação** (@devops, depois do portão da parte e do OK do dono): sem SQL e sem função nova em `api/`. Bump e entrada do `src/lib/changelog.ts` com a nota de lançamento da parte (escrita no FATOS pela tarefa), deploy web + Mac + Windows juntos, dono avisado. As partes podem sair juntas se o dono preferir.

## Contratos que várias tarefas usam

- `StageDialog` com `size="lg"` e a pilha (kit da faixa B): a janela de cima é a aberta por último; Esc e toque fora valem só pra ela.
- `onBeforeDownload?: (songId: string) => boolean` no `LibraryModal` (T17 da 1b): falso não baixa nada.
- Da T16 da 1b nos Planos: `fetchOffer({ open: false })` ao abrir, `toOfferView`, `startCheckout({ planKey, confirmedSwitch?, offer? })` e `CheckoutPlanKey` **[conferir depois da 1b]**.
- Páginas do verificador: o mapa `PAGES` em `scripts/verify-layout/main.tsx` e `PAGE_SIZES = ['1024x740', '1280x800', '1920x1080', '390x844']` em `run.mjs`, criados pela T4 do plano do Separador. **[conferir antes]** se ainda não existem, a T1 deste plano cria do mesmo jeito.

## Mapa de arquivos

- Novos: `src/components/home/HomeScreen.tsx`, `src/components/home/homeCopy.ts` (T1); `src/components/library/LibraryView.tsx`, `src/components/library/libraryRows.ts` (T2, T3); `src/components/pricing/PricingView.tsx`, `src/components/pricing/pricingCatalog.ts` (T4). Testes: `src/components/home/homeScreen.test.tsx`, `src/components/library/libraryView.test.tsx`, `src/components/library/libraryRows.test.ts`, `src/components/pricing/pricingView.test.tsx`, `src/components/pricing/pricingCatalog.test.ts`.
- Mexidos: `src/App.tsx` (T1, só o retorno do splash), `src/components/LibraryModal.tsx` (T2, T3), `src/components/PricingModal.tsx` (T4), `src/components/LibraryModal.bpm.test.tsx` e o teste da Biblioteca da T17 da 1b (T3), `src/components/PricingModal.test.tsx` (T4), `src/appWiring.test.ts` (T1), `scripts/verify-layout/pages.tsx`, `pageFixtures.ts`, `fixture.ts`, `main.tsx`, `README.md` (T1, T3, T4).
- Docs: `PLAYBACK_STUDIO_FATOS.md` e `DESIGN_SYSTEM.md` (2.10) em toda tarefa.

---

## Parte A: tela inicial

### Task 1: Tela inicial no layout do palco

**O que a tela faz hoje (não pode sumir):**
- Aparece quando o motor ainda não está pronto (`!isReady`) e quando a pessoa toca INÍCIO (`forceShowSplash`), na web e no app de computador.
- Logo (`PlayMark size="lg"`), "Playback Studio" e "A plataforma do domingo".
- "Multitracks" com "Motor de playback profissional": tira o INÍCIO (`setForceShowSplash(false)`) e liga o motor só sem `isReady` (`initEngine()`); restaurando o repertório (`isRestoring`), o ícone vira o spinner.
- "Separação de Faixas" com "Separar instrumentos com IA": abre o Separador (`setIsSeparatorOpen(true)`).
- Da T18 da 1b: o `AdSlot placement="home"` embaixo dos dois botões (o "Conhecer o Pro" abre os Planos) e o `PricingModal` dentro desse retorno **[conferir depois da 1b]** os nomes exatos das props do `AdSlot` e onde o `PricingModal` ficou.
- Uma coluna no celular, os dois botões lado a lado a partir de 640 px.

**Files:**
- Create: `src/components/home/HomeScreen.tsx`, `src/components/home/homeCopy.ts`
- Modify: `src/App.tsx` (o retorno do splash vira `<HomeScreen ... />` com o `AdSlot` no `ad` e o `PricingModal` ao lado), `scripts/verify-layout/pages.tsx`, `pageFixtures.ts`, `fixture.ts`, `main.tsx`, `README.md` (estados de página `inicio` e `inicio-anuncio`; **[conferir antes]** o mecanismo de páginas), `PLAYBACK_STUDIO_FATOS.md` (seção 5: a tela inicial; entrada datada com a nota de lançamento da parte A: "A tela inicial com a cara nova do palco"), `DESIGN_SYSTEM.md` (2.10: `HomeScreen`)
- Test: `src/components/home/homeScreen.test.tsx`, `src/appWiring.test.ts`

**Interfaces:**
- Consumes: `PlayMark` (`src/components/brand/PlayMark.tsx`), `Panel` (kit), ícones do lucide de hoje (`Play`, `Wand2`, `Loader2`).
- Produces:

```ts
export interface HomeScreenProps {
  restoring: boolean
  onMultitracks(): void
  onSeparator(): void
  ad?: React.ReactNode   // o AdSlot da 1b; a vista não decide nada sobre anúncio
}
// homeCopy.ts: HOME_COPY = { title, tagline, multitracks: { label, sub }, separator: { label, sub } } com os textos de hoje
```

**O que muda no visual:** fundo `bg-ps-ink`, coluna centrada com 16 px de folga nos lados; o logo num quadro `Panel variant="raised"` de 80 px (sem a luz laranja, Q7); "Playback *Studio*" como na barra do palco (`font-ps-sans`, "Studio" em `ps-or` itálico, marca); "A plataforma do domingo" em `ps-label`; os dois botões como cartões grandes (`button` com a cara do `Panel raised`: `bg-ps-raised`, `rounded-ps-2xl`, anel `line-2`, `hover` anel `line-3`, foco laranja), ícone em `bone`, nome em `text-ps-lg` negrito e a linha de baixo em `mut`, texto que quebra linha; `aria-busy` no Multitracks restaurando; o anúncio embaixo na mesma largura (até 448 px).

- [ ] **Step 1: Escrever os testes**

```ts
// homeScreen.test.tsx
it('Multitracks e Separação de Faixas com as linhas de hoje chamam as ações', () => {
  render(<HomeScreen restoring={false} onMultitracks={onM} onSeparator={onS} />)
  fireEvent.click(screen.getByRole('button', { name: /Multitracks/ })); expect(onM).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Separação de Faixas/ })); expect(onS).toHaveBeenCalled()
  expect(screen.getByText('Motor de playback profissional')).toBeTruthy(); expect(screen.getByText('Separar instrumentos com IA')).toBeTruthy()
})
it('restaurando, o Multitracks mostra o spinner e fica aria-busy', () => { /* ... */ })
it('marca e frase de hoje: Playback Studio e A plataforma do domingo', () => { /* ... */ })
it('o anúncio entra embaixo dos dois botões quando vem; sem ad, nenhum anúncio', () => { /* ad = <div data-house-ad="home" /> */ })
it('nenhum texto com travessão', () => { /* ... */ })
// appWiring.test.ts
it('a tela inicial é a HomeScreen, com o Multitracks ligando o motor só sem isReady', () => {
  expect(app).toMatch(/<HomeScreen[\s\S]*?onMultitracks=\{\(\)\s*=>\s*\{\s*setForceShowSplash\(false\);?\s*if\s*\(!isReady\)\s*initEngine\(\)/)
  expect(app).toMatch(/onSeparator=\{\(\)\s*=>\s*setIsSeparatorOpen\(true\)\}/)
})
it('o AdSlot home continua na tela inicial, no ad da HomeScreen', () => { expect(app).toMatch(/<HomeScreen[\s\S]*?ad=\{[\s\S]*?<AdSlot[\s\S]*?placement="home"/) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/home/homeScreen.test.tsx src/appWiring.test.ts > $LOGS/t1.txt 2>&1; tail -20 $LOGS/t1.txt`.
- [ ] **Step 3: Implementar** a vista, ligar no App (só o retorno do splash; nada mais do App muda) e os estados `inicio` e `inicio-anuncio` (com o `HouseAdCard placement="home"`) no verificador, com `EXPECT` em `[data-home-screen]`. Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** os testes e o **portão da parte A** (seção "Ordem"), com `node scripts/verify-layout/run.mjs --estado inicio,inicio-anuncio > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt` antes da rodada inteira. Esperado: PASS e os 2 estados nos 4 tamanhos de página.
- [ ] **Step 5: Commit**

```bash
git add src/components/home/HomeScreen.tsx src/components/home/homeCopy.ts src/components/home/homeScreen.test.tsx
git commit -m "feat(inicio): tela inicial com a cara do palco, anuncio da casa no mesmo lugar [Parte 3 Telas] [T1]" -- src/components/home src/App.tsx src/appWiring.test.ts scripts/verify-layout PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

---

## Parte B: Biblioteca

### Task 2: Casca da Biblioteca (cabeçalho, busca, abas, carregando, vazio, rodapé)

**O que a tela faz hoje (não pode sumir), nesta tarefa:**
- Abre e fecha pelo `isOpen`; ao abrir, atualiza a lista (`refreshSongs`).
- Título "Biblioteca na Nuvem"; atualizar (`refreshSongs`); fechar (`onClose`).
- Busca "Pesquisar por nome, artista ou tom..." (`setSearchQuery`) com o X de limpar quando há texto.
- Abas "Plataforma" (só `is_global`) e "Minhas Músicas" (não global e do próprio usuário).
- Carregando: spinner e "Carregando a biblioteca...".
- Vazio: "Nenhuma música encontrada." com busca; senão "Plataforma vazia." ou "Nenhuma música pessoal encontrada.".
- Rodapé: "N música(s) exibida(s)", contando pela aba (hoje sem a busca; continua igual).

**Files:**
- Create: `src/components/library/LibraryView.tsx`, `src/components/library/libraryRows.ts`
- Modify: `src/components/LibraryModal.tsx` (vira o contêiner: hooks e lógica de hoje, renderiza a `LibraryView` dentro de um `StageDialog size="lg"`), `PLAYBACK_STUDIO_FATOS.md` (entrada datada: a casca da Biblioteca na janela do palco), `DESIGN_SYSTEM.md` (2.10: `LibraryView`, a casca)
- Test: `src/components/library/libraryView.test.tsx`, `src/components/library/libraryRows.test.ts`

**Interfaces:**
- Consumes: `CloudSong` (`src/lib/supabase.ts`), `preciseBpm` (`cloudBpm.ts`), `StageDialog`, `Tabs`, `TabPanel`, `TextField`, `Button`, `Notice` (kit), `Icon`.
- Produces:

```ts
// libraryRows.ts
export type LibraryTab = 'platform' | 'personal'
export function songsForTab(songs: readonly CloudSong[], tab: LibraryTab, userId: string | null | undefined): CloudSong[]  // a regra de hoje
export function libraryEmptyText(query: string, tab: LibraryTab): string
export function libraryCountText(n: number): string   // hoje "N música(s) exibida(s)"; passa a "1 música exibida" e "N músicas exibidas"
// LibraryView.tsx (a T3 completa as linhas)
export interface LibraryViewProps {
  open: boolean; onClose(): void; onRefresh(): void
  query: string; onQuery(q: string): void
  tab: LibraryTab; onTab(t: LibraryTab): void
  loading: boolean; countText: string; emptyText: string | null
  message?: string | null
  children?: React.ReactNode   // as linhas (T3)
}
```

**O que muda no visual:** a janela é o `StageDialog size="lg"` com o título "Biblioteca na Nuvem" (o X do `StageDialog` é o fechar de hoje); embaixo do título, uma linha com a busca (`TextField` com a lupa no `icon`, o rótulo escondido "Pesquisar" e o limpar como `trailing`, botão de ícone de 44 px "Limpar a busca") e "Atualizar" (`Button` com ícone); as abas como `Tabs` ("Plataforma" e "Minhas Músicas", caixa alta do kit); carregando e vazio em `mut` no meio; rodapé em `ps-num` `mut`. Nada de `daw-panel`, `secondary` nem dourado.

- [ ] **Step 1: Escrever os testes**

```ts
// libraryRows.test.ts
it('songsForTab: Plataforma só global; Minhas Músicas só do usuário e não global', () => { /* ... */ })
it('libraryEmptyText: com busca, Nenhuma música encontrada.; sem, por aba', () => { /* ... */ })
it('libraryCountText: 1 música exibida e 3 músicas exibidas', () => { /* ... */ })
// libraryView.test.tsx
it('fechada não renderiza nada; aberta mostra o título e fecha no X', () => { /* getByRole('dialog', { name: 'Biblioteca na Nuvem' }) */ })
it('Atualizar chama onRefresh; a busca chama onQuery e o Limpar só aparece com texto', () => { /* ... */ })
it('as abas Plataforma e Minhas Músicas trocam pelo onTab', () => { /* getByRole('tab', { name: /Plataforma/i }) */ })
it('carregando e vazio mostram as frases de hoje; o rodapé conta', () => { /* ... */ })
it('message aparece em alerta dentro da janela', () => { /* role="alert" */ })
it('nenhum texto com travessão', () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/library > $LOGS/t2.txt 2>&1; tail -20 $LOGS/t2.txt`.
- [ ] **Step 3: Implementar** `libraryRows.ts`, a casca da `LibraryView` e o `LibraryModal` como contêiner (nesta tarefa as linhas de hoje entram como `children`, com as classes de hoje, até a T3; a parte B só publica depois da T3). Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** os testes da pasta e os de hoje da Biblioteca: `npx vitest run src/components/library src/components/LibraryModal > $LOGS/t2b.txt 2>&1; tail -8 $LOGS/t2b.txt`. Esperado: PASS (os de hoje ainda acham "Editar metadados", o "BPM" e o salvar, que só mudam na T3).
- [ ] **Step 5: Commit**

```bash
git add src/components/library/LibraryView.tsx src/components/library/libraryRows.ts src/components/library/libraryView.test.tsx src/components/library/libraryRows.test.ts
git commit -m "feat(biblioteca): casca da Biblioteca na janela do palco, com busca, abas e estados [Parte 3 Telas] [T2]" -- src/components/library src/components/LibraryModal.tsx PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

### Task 3: Linhas, editar, excluir e baixar

**O que a tela faz hoje (não pode sumir), nesta tarefa:**
- Cada música: capa (ou o ícone de música), nome, artista (ou "Artista Desconhecido"), "TOM: <tom>", "<bpm> BPM" (`preciseBpm`), "OFFLINE" quando está no cache; destaque quando já foi adicionada nesta abertura.
- Editar (só com internet e sendo admin ou dono): "Editar metadados" abre o formulário na própria linha com Nome, Artista, BPM (aceita "72,5"), Tom, "Nova Capa (Opcional)" com "Escolher imagem..." e o nome do arquivo, "Salvar" (girando salvando) e fechar sem salvar. Salvar grava na nuvem (`updateSong`), sobe a capa (`uploadToR2('covers', ...)`), atualiza o cache (`updateCachedSongMeta`), avisa o repertório (`onSongEdited` com os valores de antes e depois) e relê a lista. BPM inválido: `INVALID_BPM_MESSAGE` e não grava. Erros: "Erro ao salvar alterações na música." e "Erro ao editar.".
- Excluir (no cache, ou com internet sendo admin ou dono): com internet pergunta "Excluir "<nome>" da Nuvem e do Cache Local? Isso removerá permanentemente para todos os usuários."; sem internet, "Remover "<nome>" do Cache Offline local?"; confirmando, `removeSong`; girando enquanto exclui; título "Excluir da Nuvem" ou "Remover do Cache Local".
- Baixar: baixando, o spinner, o progresso (`downloadProgress`) e "Cancelar" (`cancelDownload`); já adicionada, "ADICIONADA"; sem internet e fora do cache, "OFFLINE" desligado; senão "ABRIR" (no cache, "Carregar do cache local offline") ou "IMPORTAR" ("Baixar e importar da Nuvem"), desligado enquanto outra baixa. Baixar chama `downloadSong` e, com arquivos ou o cache, `onDownload(...)` com os mesmos argumentos de hoje e marca ADICIONADA.
- Da T17 da 1b: `onBeforeDownload(songId)` falso não baixa nada **[conferir depois da 1b]** onde a T17 pôs a pergunta (antes do `downloadSong`).

**Files:**
- Modify: `src/components/library/LibraryView.tsx` (linhas, formulário de edição, botões de baixar e a confirmação de excluir), `src/components/library/libraryRows.ts` (`downloadStateOf`), `src/components/LibraryModal.tsx` (o `alert` vira `message`; o `window.confirm` vira a confirmação da vista; os handlers continuam com o mesmo sentido), `src/components/LibraryModal.bpm.test.tsx` (o salvar passa a `{ name: /Salvar/i }`; o `alert` de BPM inválido passa a ser a frase `role="alert"` com `INVALID_BPM_MESSAGE`), o teste da Biblioteca da T17 da 1b (`LibraryModal.livre.test.tsx` ou o nome que ela deu, só os seletores **[conferir depois da 1b]**), `scripts/verify-layout/pages.tsx`, `pageFixtures.ts`, `fixture.ts`, `main.tsx`, `README.md` (estados `biblioteca` e `biblioteca-editar`), `PLAYBACK_STUDIO_FATOS.md` (seção 5: a Biblioteca; entrada datada com a nota da parte B: "A Biblioteca com a cara nova do palco"), `DESIGN_SYSTEM.md` (2.10)
- Test: `src/components/library/libraryView.test.tsx`, `src/components/library/libraryRows.test.ts`, `src/components/LibraryModal.bpm.test.tsx`

**Interfaces:**
- Consumes: T2, `StageDialog` (a confirmação é uma segunda janela, pilha do kit), `TextField`, `Button`, `Notice` (kit), `Icon`.
- Produces (acrescenta na `LibraryViewProps`):

```ts
// libraryRows.ts
export type DownloadState = 'downloading' | 'added' | 'offline' | 'open' | 'import'
export function downloadStateOf(i: { downloading: boolean; added: boolean; online: boolean; cached: boolean }): DownloadState  // a ordem de hoje
export interface LibraryRow {
  id: string; name: string; artist: string | null; coverUrl: string | null; key: string | null; bpm: number | undefined
  cached: boolean; state: DownloadState; progress: string; canEdit: boolean; canDelete: boolean; deleting: boolean
}
export interface LibraryEdit { id: string; name: string; artist: string; bpmText: string; key: string; file: File | null }
// LibraryViewProps ganha:
//   rows: readonly LibraryRow[]; anyDownloading: boolean; online: boolean
//   edit: LibraryEdit | null; savingEdit: boolean
//   onImport(id: string, name: string): void; onCancel(id: string): void
//   onEdit(id: string): void; onEditChange(p: Partial<LibraryEdit>): void; onEditSave(): void; onEditClose(): void
//   onAskDelete(id: string): void
//   confirmDelete: { name: string; online: boolean; busy: boolean } | null; onConfirmDelete(): void; onCancelDelete(): void
```

**O que muda no visual:** cada música numa linha `Panel` (capa de 48 px com `rounded-ps-md`, nome em `bone` que quebra linha, artista em `mut`, tom, BPM e OFFLINE em selos neutros `ps-num`; OFFLINE com a luz musgo como o selo da barra do palco), ações à direita com largura pelo texto e quebrando pra linha de baixo no celular: "Editar" (`Button` de ícone, `aria-label="Editar metadados"`, mesmo `title`), excluir (`Button` de ícone com o `title` de hoje), "Importar" ou "Abrir" (`Button`; "Importar" é a ação principal da linha, `tone="primary"`), "Adicionada" (selo `on`, laranja suave: ligado), baixando com o spinner, o progresso em `ps-num` e "Cancelar" (`Button tone="ghost"`); o formulário de edição dentro da linha com `TextField` (Nome, Artista, BPM com `inputMode="decimal"`, Tom), a capa por um seletor de arquivo e "Salvar" (`tone="primary"`); a confirmação de excluir numa segunda janela `StageDialog size="sm"` com o título "Excluir da nuvem?" (com internet) ou "Remover do aparelho?" (sem), o texto de hoje e "Cancelar" e "Excluir" (`tone="alert"`, girando excluindo).

- [ ] **Step 1: Escrever os testes**

```ts
it('linha: capa, nome, artista ou Artista Desconhecido, TOM, BPM e OFFLINE no cache', () => { /* ... */ })
it('downloadStateOf segue a ordem de hoje', () => { /* baixando > adicionada > offline fora do cache > abrir no cache > importar */ })
it('Importar chama onImport com id e nome; Abrir no cache; desligado enquanto outra baixa', () => { /* ... */ })
it('baixando mostra o progresso e Cancelar chama onCancel', () => { /* ... */ })
it('ADICIONADA só depois do download que deu certo', async () => { /* contêiner com downloadSong mockado devolvendo nulo: sem ADICIONADA */ })
it('onBeforeDownload falso não baixa nada', async () => { /* o teste da T17 da 1b, passando com a vista nova */ })
it('sem internet: ABRIR no cache, OFFLINE desligado fora dele e sem editar', () => { /* ... */ })
it('Editar abre o formulário com Nome, Artista, BPM, Tom e capa; Salvar chama onEditSave; fechar não salva', () => { /* ... */ })
it('BPM inválido mostra INVALID_BPM_MESSAGE em alerta e não grava', async () => { /* LibraryModal.bpm.test.tsx ajustado */ })
it('excluir sem internet pergunta "Remover do cache offline" e com internet avisa que some pra todos', () => { /* textos de hoje na 2ª janela */ })
it('a confirmação: Cancelar não exclui; Excluir chama removeSong uma vez; Esc fecha só a confirmação', async () => { /* a Biblioteca continua aberta */ })
it('nenhum window.confirm nem alert sobrou na Biblioteca', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/LibraryModal.tsx'), 'utf8')
  expect(src).not.toMatch(/\b(confirm|alert)\s*\(/)
})
it('nenhum texto com travessão', () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/library src/components/LibraryModal > $LOGS/t3.txt 2>&1; tail -25 $LOGS/t3.txt`.
- [ ] **Step 3: Implementar** as linhas, a edição, a confirmação e o contêiner; ajustar os dois testes de hoje (só seletores e o `alert` virando frase); os estados `biblioteca` (8 músicas com nomes e artistas longos, uma em cada estado de baixar, uma no cache e uma pessoal com editar) e `biblioteca-editar` (formulário aberto) no verificador, `EXPECT` em `[role="dialog"][aria-label="Biblioteca na Nuvem"]` ou pelo `aria-labelledby` do título. Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** os testes e o **portão da parte B**, com `node scripts/verify-layout/run.mjs --estado biblioteca,biblioteca-editar > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt` antes da rodada inteira. Esperado: PASS e os 2 estados nos 4 tamanhos de página.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(biblioteca): musicas, editar, excluir com confirmacao do palco e baixar com a cara nova [Parte 3 Telas] [T3]" -- src/components/library src/components/LibraryModal.tsx src/components/LibraryModal.bpm.test.tsx scripts/verify-layout PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```
(Acrescente ao `--` o arquivo de teste da Biblioteca da T17 da 1b.)

---

## Parte C: Planos

### Task 4: Planos no layout do palco, com a oferta do primeiro mês

**O que a tela faz hoje (não pode sumir):**
- Abre e fecha pelo `isOpen`; toque fora fecha; X fecha.
- "Escolha seu Plano" e a linha de baixo: quem já paga, "Trocar de plano: o novo é cobrado cheio e o atual termina na hora, sem proporcional."; senão "Desbloqueie todo o poder do seu estúdio em nuvem".
- Os 4 cartões (Pro Mensal, Pro Anual, Studio Mensal, Studio Anual), cada um com nome, descrição, preço, período e as linhas de recursos de hoje; "Mais Popular" no Pro Mensal.
- O botão de cada cartão: "Assinar Agora"; "Processando..." abrindo o pagamento; "Seu plano atual" desligado no plano atual sem data de fim.
- Quem já paga: antes de assinar, "Trocar de plano?" com "O <novo> é cobrado cheio agora (<preço><período>). O <atual> termina na hora, assim que o novo for pago, sem desconto proporcional do que já foi pago.", "Voltar" e "Confirmar troca" (manda `confirmedSwitch: true`).
- Assinar: no app de computador abre o pagamento no navegador do sistema (`openExternalUrl`) e mostra "Abrimos o pagamento no seu navegador. Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes."; na web vai pro endereço do pagamento.
- Erros: sem login, "Por favor, faça login para assinar um plano."; resposta do servidor com `error` (o 409 de plano já ativo, a mensagem pronta); senão "Não deu para abrir o pagamento agora. Tente de novo em alguns minutos."; rede, "Não foi possível conectar com o servidor." e o motivo.
- Da T16 da 1b: ao abrir, `fetchOffer({ open: false })` (nunca abre janela); assinar passa pelo `startCheckout`; com a janela aberta, Pro Mensal e Studio Mensal mostram o primeiro mês com desconto e mandam `offer: true`; oferta que terminou (`offerEnded`) mostra a frase do servidor e volta ao preço cheio **[conferir depois da 1b]** os nomes do estado da oferta no `PricingModal`, o texto exato do preço do primeiro mês e como o `offerEnded` aparece.

**Files:**
- Create: `src/components/pricing/PricingView.tsx`, `src/components/pricing/pricingCatalog.ts`
- Modify: `src/components/PricingModal.tsx` (vira o contêiner: `useAuth`, a oferta e o checkout da 1b, `pendingPlan`, `openedExternally`; os `alert` viram `message`), `src/components/PricingModal.test.tsx` (`card()` passa a `closest('[data-plan-card]')`; "no Livre assina direto" passa a `queryByRole('dialog', { name: 'Trocar de plano?' })` nulo; os testes da T16 só nos seletores), `scripts/verify-layout/pages.tsx`, `pageFixtures.ts`, `fixture.ts`, `main.tsx`, `README.md` (estados `planos`, quem já paga e o plano atual, e `planos-oferta`, Livre com a janela aberta), `PLAYBACK_STUDIO_FATOS.md` (seção 5: os Planos; seção "Cobrança": nada muda nas regras; entrada datada com a nota da parte C: "A tela de Planos com a cara nova do palco"), `DESIGN_SYSTEM.md` (2.10)
- Test: `src/components/pricing/pricingView.test.tsx`, `src/components/pricing/pricingCatalog.test.ts`, `src/components/PricingModal.test.tsx`

**Interfaces:**
- Consumes: `PRICES` (`src/content/site.ts`), `formatReais`, `annualPerMonth` (`src/lib/prices.ts`), `CheckoutPlanKey` (T16 da 1b), `StageDialog` (`lg` e `sm` empilhada), `Panel`, `Button`, `Notice` (kit).
- Produces:

```ts
// pricingCatalog.ts
export interface PricingPlan { planKey: CheckoutPlanKey; name: string; price: string; period: '/mês' | '/ano'; description: string; features: readonly string[]; popular: boolean; offerable: boolean }
export const PRICING_PLANS: readonly PricingPlan[]   // a ordem, os nomes, as descrições e os recursos de hoje; preços por PRICES e formatReais (Q5); offerable só nos dois mensais
// PricingView.tsx
export interface PricingCardView extends PricingPlan { offerPrice: string | null; current: boolean; loading: boolean; disabled: boolean }
export interface PricingViewProps {
  open: boolean; onClose(): void
  switching: boolean; currentName: string
  cards: readonly PricingCardView[]
  openedExternally: boolean
  pending: { name: string; price: string; period: string } | null; onConfirmSwitch(): void; onCancelSwitch(): void
  message?: string | null
  onChoose(planKey: CheckoutPlanKey): void
}
```
O contêiner monta os `cards` (o `offerPrice` só com a janela ativa e `offerable`, pela regra da T16) e guarda a lógica de hoje do `handleSubscribe` sem mudar de sentido; quem escolhe com plano pago passa pelo `pending` antes (Q8).

**O que muda no visual:** `StageDialog size="lg"` com o título "Escolha seu Plano" e a linha de baixo em `mut`; os 4 cartões em `Panel variant="raised"` com `data-plan-card`, em 2 colunas a partir de 640 px e 1 no celular; nome em `bone` negrito, descrição em `mut` (quebra linha, sem altura fixa), preço em `ps-num` grande com o período em `mut`; com a oferta, o preço do primeiro mês em `ps-or` e o preço cheio de depois em `mut` embaixo (texto da T16); recursos com o ícone de check em `mut`; "Mais Popular" como selo `bg-ps-or-soft text-ps-or` e anel `ps-or-line` no cartão do Pro Mensal (Q9); botão de cada cartão no pé dele, com largura pelo texto (nada de `w-full`), `tone="primary"` no Pro Mensal e `default` nos outros, "Seu plano atual" desligado; "Abrimos o pagamento no seu navegador..." como `Notice role="status"`; erro como `Notice tone="alert" role="alert"`; "Trocar de plano?" numa segunda janela `StageDialog size="sm"` com "Voltar" (`ghost`) e "Confirmar troca" (`primary`).

- [ ] **Step 1: Escrever os testes**

```ts
// pricingCatalog.test.ts
it('preços de hoje, pelos PRICES: R$ 49,90, R$ 454,80, R$ 119,90 e R$ 1.078,80; equivalências de R$ 37,90 e R$ 89,90 por mês', () => { /* ... */ })
it('só Pro Mensal e Studio Mensal aceitam a oferta; Mais Popular só no Pro Mensal', () => { /* ... */ })
// pricingView.test.tsx
it('título e a linha de baixo mudam com quem já paga', () => { /* ... */ })
it('os 4 cartões com nome, descrição, preço, período e recursos; Assinar Agora chama onChoose', () => { /* ... */ })
it('Processando... no cartão abrindo e Seu plano atual desligado', () => { /* ... */ })
it('com offerPrice, o primeiro mês aparece no cartão e o preço cheio continua escrito', () => { /* ... */ })
it('Trocar de plano? é uma segunda janela com o texto de hoje; Voltar e Confirmar troca chamam as ações', () => { /* getByRole('dialog', { name: 'Trocar de plano?' }) */ })
it('aberto no navegador e erro aparecem dentro da janela', () => { /* role="status" e role="alert" */ })
it('nenhum texto com travessão', () => { /* ... */ })
// PricingModal.test.tsx (os de hoje e os da T16, com os seletores novos, mais:)
it('erro de rede vira frase na janela, sem alert', async () => { /* fetch rejeita; vi.spyOn(window, 'alert') nunca chamado; texto "Não foi possível conectar com o servidor." */ })
it('sem login, a frase de hoje na janela e nada de checkout', async () => { /* ... */ })
it('oferta que terminou no meio mostra a frase e o preço cheio', async () => { /* startCheckout devolve offerEnded [conferir depois da 1b] */ })
it('nenhum alert sobrou nos Planos', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/PricingModal.tsx'), 'utf8')
  expect(src).not.toMatch(/\balert\s*\(/)
})
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/pricing src/components/PricingModal.test.tsx > $LOGS/t4.txt 2>&1; tail -25 $LOGS/t4.txt`.
- [ ] **Step 3: Implementar** o catálogo, a vista e o contêiner; ajustar os testes de hoje e os da T16 (só seletores e os `alert` que viraram frase); os estados `planos` e `planos-oferta` no verificador, com `EXPECT` em `[data-plan-card]`. Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** os testes e o **portão da parte C**, com `node scripts/verify-layout/run.mjs --estado planos,planos-oferta > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt` antes da rodada inteira. Esperado: PASS e os 2 estados nos 4 tamanhos de página (em 390 px, um cartão por linha e o preço do primeiro mês inteiro).
- [ ] **Step 5: Commit**

```bash
git add src/components/pricing/PricingView.tsx src/components/pricing/pricingCatalog.ts src/components/pricing/pricingView.test.tsx src/components/pricing/pricingCatalog.test.ts
git commit -m "feat(planos): Planos na janela do palco, com a oferta do primeiro mes e erros na tela [Parte 3 Telas] [T4]" -- src/components/pricing src/components/PricingModal.tsx src/components/PricingModal.test.tsx scripts/verify-layout PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

---

## Pedidos pra dona do kit (faixa B)

Peças que estas telas usam e o kit ainda não tem. Até chegarem, a tela usa uma constante de classe local no próprio arquivo e troca depois; nenhuma peça nova em `src/components/ui/` sai deste plano. (`FilePicker` e `Tag` são os mesmos pedidos do plano do Separador; os dois planos usam a mesma peça quando ela chegar.)

1. **`FilePicker`:** botão que abre o seletor de arquivo (`accept`, `multiple`), com o nome do arquivo escolhido e um "Tirar" opcional; 44 px; teclado. Uso: "Nova Capa (Opcional)" da Biblioteca.
2. **`Tag`:** selo estático (não é botão) pra metadado: tom, BPM, OFFLINE, "Mais Popular"; `text-ps-micro`, extranegrito, `ps-num` quando é número; tom neutro (o do selo OFFLINE da barra), `on` (laranja suave) e `live` (musgo, com a luz). Usos: linhas da Biblioteca, "Adicionada", o selo do Pro Mensal.
3. **`SearchField`** (ou um jeito documentado de fazer com o `TextField`): lupa no começo e o limpar como botão de 44 px no `trailing`, com `type="search"` e o rótulo escondido. Uso: busca da Biblioteca.
4. **`IconButton`** (ou a regra documentada de `Button` só com ícone): 44 x 44, `aria-label` obrigatório no tipo, tons `default`, `ghost` e `alert`. Usos: editar, excluir e limpar a busca.
