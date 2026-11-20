# Parte 3, faixa C: as demais telas no layout do palco (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (o brief proíbe subagentes nesta faixa). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** levar Metrônomo, conjuntos de pads, letra e teleprompter, novidades, aviso de atualização, tour, página de download, Modo Ao Vivo do host e a casca do /admin para a linguagem do palco novo, sem mudar o que cada tela faz.

**Architecture:** cada tela troca as classes antigas (dourado `primary`, `daw-panel`, hex soltos, `text-[9px]`) pelos tokens `ps-*` e pelas peças de `src/components/ui/` (as atuais e as novas da faixa B, listadas em `~/playback-studio-work/parte3-faixas/kit-novo.md`). Janela por cima usa o `StageDialog` (`src/components/stage/StageDialog.tsx`), menos onde a ordem das camadas proíbe (Modo Ao Vivo, ver T9). Cada tarefa primeiro escreve o teste "nada some" (tudo o que a tela faz hoje continua lá, com o mesmo efeito) e o teste da linguagem nova (nome acessível, alvo de 44 px, nenhuma classe antiga), que falha no visual antigo. As telas também entram no verificador de layout (`scripts/verify-layout/`), numa página própria.

**Tech Stack:** Vite 7, React 19, TypeScript, Tailwind v4 (tokens `ps-*` em `src/styles/ps-tokens.css`), Vitest + Testing Library (jsdom), Chrome headless no verificador.

**Spec:** `docs/superpowers/specs/2026-11-19-parte3-telas-e-livre-design.md` (seções 2.5, 4, 9, 11, 12), com a linguagem de `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (5 e 5b) e o mockup `.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` (na pasta principal do repo). Regras da faixa: `~/playback-studio-work/parte3-faixas/regras-comuns.md`.

## Global Constraints

- Muda a cara, não o que o app faz: nenhuma função some, nenhum botão perde a ação, nenhuma prop ou handler muda de sentido. Nomes exportados e props públicas de cada componente ficam iguais (os testes do App mockam `PadSetsModal`, `LiveModeModal`, `GuidedTour`, `WhatsNewModal` e `LyricsEditor` pelo nome).
- Linguagem: tokens `ps-*`, `font-ps-sans` e `font-ps-mono` (`ps-num` para números), painéis, chips, seletor segmentado, LEDs. Cores com um significado só: laranja = ligado (e a ação principal), branco = armado, cor da seção = seção, âmbar = alerta. O dourado `primary` não entra em tela nova (DESIGN_SYSTEM 1.7).
- Nenhum texto encostando na borda ou cortado: nada de `truncate` em texto que a pessoa precisa ler; largura pelo texto, nunca `w-` fixo com texto dentro; `flex-wrap` em fileira de peças.
- Alvo de toque de 44 px (`min-h-ps-touch`, `min-w-ps-touch`) em todo botão, campo e opção.
- Nada de caminho absoluto "/" novo em `src/`; nada de `window.prompt`, `window.alert` ou `window.confirm` novo (os dois `alert(...)` que já existem no Metrônomo ficam como estão).
- Nada de tela por cima com a música tocando ou na pré-contagem (nenhuma tarefa cria um gatilho novo de abrir tela).
- Português do Brasil; nenhum travessão (U+2014) em linha adicionada, comentário ou commit; "multitracks" e "separação de faixas", nunca "stems".
- Não mexer: `src/App.tsx`, `src/lib/plans.ts`, `src/lib/offer.ts`, `src/lib/checkout.ts`, `src/lib/productEvents.ts`, `src/lib/livre*`, `src/hooks/useLivre.ts`, `src/components/livre/*`, `src/components/PricingModal.tsx`, `LibraryModal.tsx`, `SeparatorStudio.tsx`, `SeparationUsageMeter.tsx`, `api/*`, `db/*`, `src/admin/tabs/*`, `src/admin/components/FunnelPanel*`, `src/admin/components/Subscriber*`, `src/hooks/useAudioEngine.ts`, `src/audio/*`, `src/workers/*`, `src/components/ui/*` e `src/components/stage/*` (só importar), `AuthPage`, `SettingsModal`, `src/components/settings/*`, `ProfileTab`. O que precisar no `App.tsx` vai descrito no relatório.
- Kit: nenhuma peça nova em `src/components/ui/` e nenhuma cópia de peça parecida dentro das telas. Campo de texto, interruptor e abas vêm do kit da faixa B (nomes exatos no `kit-novo.md`); se o kit não tiver a peça, a tela usa as que já existem (`Button`, `Chip`, `Segmented`, `Panel`, `Led`) e o relatório registra.
- Docs no mesmo passo: cada tarefa que muda o que o usuário vê acrescenta uma linha à entrada "2026-11-20: Demais telas no layout do palco (Parte 3, faixa C) [NÃO PUBLICADO]" do `PLAYBACK_STUDIO_FATOS.md` (seção 6) e à seção nova "2.9 Demais telas (Parte 3, faixa C, não publicado)" do `DESIGN_SYSTEM.md`, mais a data no cabeçalho. Uma entrada e uma seção só, pra junção com a faixa B não brigar linha a linha.
- Um commit por tarefa, `git commit -m "..." -- <arquivos>`, mensagem em português sem travessão, terminando com `[Parte 3] [faixa C] [Tn]`. Nada de push, tag, rebase, reset ou merge (a única junção é o commit do kit, uma vez).
- Durante as tarefas, só os testes dos arquivos tocados. Portão completo só na T12.

## Review Focus

1. **Duas janelas do palco ao mesmo tempo.** O `StageDialog` trata o Esc na captura da `window`: duas abertas fecham juntas. Metrônomo, pads, letra e novidades viram `StageDialog`; o Modo Ao Vivo não, porque abre os Planos (`PricingModal`, z-[110]) por cima de si quando passa do limite de aparelhos (T9 tem o teste da camada). A tela de limite da frente 1b também é `StageDialog`: anotar no relatório.
2. **Fechar no meio de uma geração.** O X do Metrônomo era desligado enquanto gerava o click; o `StageDialog` não tem X desligado. Fechar (X, Esc, toque fora) não faz nada enquanto gera (T1 tem o teste).
3. **Texto comprido.** Nome de conjunto de pads, descrição, nome de música, e-mail e IP longos quebram linha, nunca cortam (fixtures do verificador com nomes longos em T1 a T10).
4. **Celular (390 px).** Toda janela cabe em 390 x 844 sem rolar de lado e com o conteúdo rolando dentro (verificador com `--only 390x844` em cada estado que abre no celular; o Modo Ao Vivo só existe no computador).
5. **O tour achando o alvo.** Os passos do tour apontam pra `data-tour` do palco novo, do antigo e do Separador; o restyle do balão não pode mudar o pulo de passo sem alvo (T7 tem o teste que lê os `target` de `App.tsx` e `SeparatorStudio.tsx` e confere que cada um tem dono no código).

---

## Arquivos

| Arquivo | Tarefa | Papel |
|---|---|---|
| `src/test/psLanguage.ts` (novo) | T1 | `oldLanguageClasses(root: ParentNode): string[]`: as classes antigas que sobraram (dourado `primary`, `secondary`, `daw-*`, `bg-[#...]`, `text-[9px]`/`text-[8px]`, `zinc-`, `orange-`, `text-white`, `text-text-muted`, `bg-card`), pra cada teste de tela travar a linguagem nova |
| `src/components/MetronomeModal.tsx` | T1 | Metrônomo |
| `src/components/MetronomeModal.look.test.tsx` (novo) | T1 | nada some + linguagem |
| `scripts/verify-layout/telas.tsx` (novo) | T1, ampliado em T2 a T10 | página das telas da faixa C no verificador: `TelaPage({ estado })`, `TELA_ESTADOS`, `TELA_EXPECT`, `TELA_PREPARE` |
| `scripts/verify-layout/main.tsx`, `fixture.ts`, `run.mjs`, `README.md` | T1, ampliado em T2 a T10 | registrar os estados novos (uma linha em cada lista) |
| `src/components/PadSetsModal.tsx` (+ `PadSetsModal.test.tsx` novo) | T2 | conjuntos de pads |
| `src/components/LyricsEditor.tsx` (+ `LyricsEditor.test.tsx` novo) | T3 | letra e cifra |
| `src/components/Teleprompter.tsx` (novo, + `Teleprompter.test.tsx`) | T4 | teleprompter tirado do `App.tsx`; a troca no App vai descrita no relatório |
| `src/components/WhatsNewModal.tsx` (+ teste novo) | T5 | novidades |
| `src/components/UpdateBanner.tsx` (+ teste novo) | T6 | aviso de atualização |
| `src/components/GuidedTour.tsx` (+ `GuidedTour.test.tsx` novo) | T7 | tour |
| `src/components/DownloadPage.tsx` (+ `DownloadPage.test.tsx`) | T8 | página de download |
| `src/components/LiveModeModal.tsx` (+ teste novo) | T9 | Modo Ao Vivo do host |
| `src/admin/AdminLogin.tsx` (+ teste novo), `src/admin/AdminShell.tsx`, `src/admin/components/ConfirmDialog.tsx` | T10 | casca do admin |
| `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` | T1 a T10 | entrada e seção da faixa C |
| `.superpowers/sdd/2026-11-20-parte3-telas-resto/progress.md` e `report.md` | todas | ledger e relatório |

Fechar e foco: o `StageDialog` já dá X de 44 px com `aria-label="Fechar"`, Esc, toque fora, foco preso e volta do foco; as telas não reimplementam nada disso.

---

### Task 1: Metrônomo (e a página das telas no verificador)

**O que a tela faz hoje (tudo continua):** nome do andamento (Largo a Presto); BPM com − e + (passo 1, limite 40 a 300), campo numérico que corrige no blur; TAP TEMPO (média dos toques, zera em 2,5 s, ponto aceso enquanto conta); 2× (desligado acima de 150); Som do click (7 tipos) e Subdivisão (4), que guardam (`clickLibrarySelection`) e tocam a prévia; Compasso (6, `aria-pressed`, guardado por música em `mt_meter_<id>`); Acentuar o 1 (liga e desliga, vai pro gerador); mensagem de "gerando"; aviso âmbar do click descartado; GERAR CLICK MANUAL; aviso "Esta música já tem click"; aviso "Pare a música pra analisar"; Gerar click IA / Gerar outro click; aviso de falha; resultado da análise (½× ⅔× 3⁄2× 2×, Mover o 1, Deslocar meio tempo, conferências em âmbar, Inserir click); X desligado enquanto gera; toque fora fecha.

**Files:**
- Create: `src/test/psLanguage.ts`, `src/components/MetronomeModal.look.test.tsx`, `scripts/verify-layout/telas.tsx`
- Modify: `src/components/MetronomeModal.tsx`, `scripts/verify-layout/{main.tsx,fixture.ts,run.mjs,README.md}`, `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md`
- Test: `src/components/MetronomeModal.look.test.tsx`, `src/components/MetronomeModal.auto.test.tsx` (sem mudar)

**Interfaces:**
- Produces: `oldLanguageClasses(root: ParentNode): string[]` em `src/test/psLanguage.ts` (usado em todas as tarefas); `TelaPage`, `TELA_ESTADOS` (tupla `as const`), `TELA_EXPECT: Record<TelaEstado, { sel: string; text?: string }>`, `TELA_PREPARE: Partial<Record<TelaEstado, () => void>>` em `scripts/verify-layout/telas.tsx`.
- Props de `MetronomeModal` iguais.

- [ ] **Step 1: Testes que falham** (`MetronomeModal.look.test.tsx`, mesmo `abrir()` e mocks do `.auto.test.tsx`):
  - `é a janela do palco: dialog "Metrônomo", Fechar de 44 px`: `getByRole('dialog', { name: 'Metrônomo' })`; `getByRole('button', { name: 'Fechar' })`; `oldLanguageClasses(document.body)` igual a `[]`; nenhum texto com o travessão.
  - `BPM: − e + andam 1 e param em 40 e 300; o campo corrige no blur`: botões `Diminuir o BPM` e `Aumentar o BPM`; o campo (rótulo `BPM`) vai de 120 a 121; digitar 999 e sair dá 300; digitar 10 dá 40.
  - `TAP TEMPO e 2× continuam`: dois toques no TAP TEMPO mudam o BPM; 2× dobra 120 pra 240 e fica desligado com o BPM em 160.
  - `Som do click e Subdivisão marcam a escolha e guardam`: `Woodblock` fica `aria-pressed="true"` e `localStorage.clickLibrarySelection` passa a ter `"type":"Woodblock"`; `1/8` idem com `"subdivision":"eighth"`.
  - `Acentuar o 1 desligado vai pro gerador`: o interruptor `Acentuar o 1` começa ligado; desligado, GERAR CLICK MANUAL chama `generateManualClickTrackFromSample` com o 5º argumento `false`.
  - `fechar não faz nada enquanto gera`: com o gerador preso numa promessa, Fechar, Esc e toque fora não chamam `onClose`; depois de soltar, o modal fecha como sempre.
- [ ] **Step 2:** `npx vitest run src/components/MetronomeModal` e ver os novos falharem (sem dialog com nome, classes `primary`), e os do `.auto` passarem.
- [ ] **Step 3: Implementar.** `StageDialog size="sm" title="Metrônomo"` com `onClose={() => { if (!isSynthesizing) onClose() }}`. Corpo em blocos `Panel variant="flat"` com rótulo `ps-label`: andamento (`text-ps-mut`) e BPM grande (`ps-num`, campo numérico do kit com `aria-label="BPM"`, ou `input type="number"` com o visual do campo do kit se o kit não tiver tamanho grande), − e + como `Button` só de ícone; TAP TEMPO como `Button` com `Led state={tapCount > 0 ? 'on' : 'off'}`; 2× como `Chip`; Som do click, Subdivisão e Compasso como `Chip` com `on` e `aria-pressed` numa fileira `flex flex-wrap gap-1.5` (o Compasso fica botão com `aria-pressed`: o `.auto.test` acha por `getByRole('button')`); Acentuar o 1 com o interruptor do kit (`Button tone on/default pressed` se não houver); "gerando" em `text-ps-mut` com `Loader2` e `role="status"`; GERAR CLICK MANUAL `Button` padrão e Gerar click IA `Button tone="primary"`, os dois `w-full`. Textos de aviso e o `AutoClickResult` ficam como estão.
- [ ] **Step 4: Verificador.** `scripts/verify-layout/telas.tsx` com `TelaPage` e o estado `metronomo` (música "Grande é o Senhor (Ao Vivo no Ministério Nome Bem Comprido)" com Click e Bateria, então aparece "Esta música já tem click"); registrar `metronomo` em `ESTADOS` de `fixture.ts` e `run.mjs`, o `EXPECT`/`PREPARE` de `main.tsx` espalhando os de `telas.tsx`, e em `main.tsx` renderizar `TelaPage` quando o estado é de tela (sem `checks` de palco). README: linha do estado e o uso `--only 390x844`.
- [ ] **Step 5:** `npx vitest run src/components/MetronomeModal` todos verdes; `node scripts/verify-layout/run.mjs --estado metronomo --only 1024x740,1280x800,1920x1080,390x844` com 0 falhas.
- [ ] **Step 6: Docs.** FATOS: cria a entrada da faixa C com a linha do Metrônomo. DESIGN_SYSTEM: cria a seção 2.9 com a regra do `StageDialog` nas telas (e a exceção do Ao Vivo, que entra na T9) e o Metrônomo.
- [ ] **Step 7: Commit** `feat(telas): metronomo no layout do palco, sem mudar o que ele faz [Parte 3] [faixa C] [T1]`. Linha no ledger.

### Task 2: Conjuntos de pads (`PadSetsModal`)

**O que faz hoje:** abre e busca `GET /api/pad-catalog`; carregando; erro com o código (`500 erro`); vazio ("Nenhum banco de pads disponível" e "Envie pads pelo painel Admin"); lista com nome e descrição; o conjunto em uso marcado; tocar escolhe (`onSelect({ id, name, base_path, note_urls })` e fecha), menos durante a edição; admin: renomear (nome e descrição, Salvar = `PATCH` com `name.trim() || 'Sem nome'` e `description.trim() || null`, atualiza a lista; cancelar) e apagar com confirmação ("Apagar "X"?" e "Esta ação não pode ser desfeita.", confirmar = `DELETE ?id=`, some da lista; cancelar); X fecha.

**Files:** Modify `src/components/PadSetsModal.tsx`, `scripts/verify-layout/*`, FATOS, DESIGN_SYSTEM. Create `src/components/PadSetsModal.test.tsx`.

**Interfaces:** props iguais. Consumes `oldLanguageClasses`, `TelaPage`.

- [ ] **Step 1: Testes** (fetch e `getAuthHeaders` mockados; dois conjuntos, um com descrição longa):
  - `lista, marca o em uso e escolhe`: dialog `Pads da nuvem`; o em uso tem `aria-current="true"`; tocar no outro chama `onSelect` com o objeto exato e `onClose`.
  - `carregando, erro e vazio`: "Carregando" enquanto a busca não volta; resposta 500 `{ code: 'erro' }` mostra "Falha ao carregar o catálogo" e "500 erro" com `role="alert"`; lista vazia mostra os dois textos.
  - `quem não é admin não vê renomear nem apagar`.
  - `admin renomeia: campos preenchidos, Salvar manda o PATCH e atualiza; nome vazio vira "Sem nome"`; `Cancelar a edição` volta sem PATCH; tocar na linha editando não escolhe.
  - `admin apaga com confirmação`: `Apagar <nome>` mostra a pergunta; `Confirmar apagar` manda `DELETE` com `?id=` codificado e tira da lista; `Cancelar` não manda nada.
  - `linguagem`: `oldLanguageClasses` vazio; botões só de ícone com `aria-label`.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3: Implementar.** `StageDialog size="sm" title="Pads da nuvem"`, frase "Escolha um conjunto de pads." em `text-ps-mut`. Cada conjunto numa linha `Panel` com a escolha num `<button>` de verdade (nome em `text-ps-base font-bold`, descrição em `text-ps-sm text-ps-mut`, os dois com `break-words`), em uso com o laranja de ligado (`bg-ps-or-soft`, `inset-ring-ps-or-line`, `Led state="on"`) e `aria-current`. Renomear com dois campos de texto do kit; Salvar `Button tone="primary"` e Cancelar `ghost`, com texto (alvo e clareza). Apagar armado no âmbar (`Button tone="alert"` "Apagar") com "Cancelar". Erro em `text-ps-alert`. Os textos antigos em caixa alta mono viram frase normal; "Falha ao carregar catálogo." vira "Falha ao carregar o catálogo."
- [ ] **Step 4: Verificador:** estados `padsnuvem` (admin, 3 conjuntos com nome e descrição longos, um em uso) e `padsnuvem-editar` (prepare toca em Renomear do primeiro); `fetch` de `/api/pad-catalog` respondido na página.
- [ ] **Step 5:** testes verdes; verificador com 0 falhas nos 4 tamanhos.
- [ ] **Step 6:** docs (linha na entrada e na 2.9).
- [ ] **Step 7: Commit** `feat(telas): conjuntos de pads no layout do palco [Parte 3] [faixa C] [T2]`.

### Task 3: Letra e cifra (`LyricsEditor`)

**O que faz hoje:** nome da música; campo Artista (para a busca); Buscar letra (carregando; acha e preenche a letra e a sincronizada, com a fonte; "Nenhuma letra encontrada"; "Falha na busca"); abas Letra e Cifra; aviso da versão sincronizada; área da letra e da cifra (cifra em mono, sem quebrar linha); Salvar (carregando; "Salvo na nuvem e localmente" ou "Salvo localmente"; "Erro ao salvar"), mandando `lyrics.trim() || null`, `lyricsSynced`, `chords.trim() || null`; X e toque fora fecham.

**Files:** Modify `src/components/LyricsEditor.tsx`, verificador, docs. Create `src/components/LyricsEditor.test.tsx`.

- [ ] **Step 1: Testes** (`searchLyrics` mockado):
  - `busca: preenche a letra e avisa a sincronizada`: resultado `{ plain, synced, source: 'LRCLIB' }` põe a letra na área e mostra "Letra encontrada via LRCLIB (sincronizada)." e o aviso da sincronizada; nada encontrado e erro mostram as frases.
  - `abas Letra e Cifra trocam a área e guardam o texto de cada uma`: as abas do kit (`role="tab"`, `aria-selected`) ou o `Segmented` (`role="radio"`), conforme o kit.
  - `Salvar manda o que está nas áreas e diz onde salvou`: `onSave` com `{ lyrics: null, lyricsSynced: null, chords: 'E B' }` para letra só com espaços; mensagens de nuvem, local e erro.
  - `linguagem`: dialog `Letra e cifra`; `oldLanguageClasses` vazio; nenhum travessão no texto da tela (o aviso e a dica da cifra hoje têm travessão).
- [ ] **Step 2:** ver falhar.
- [ ] **Step 3: Implementar.** `StageDialog size="md" title="Letra e cifra"` com o nome da música em `text-ps-mut` no começo do conteúdo e o Salvar no `footer` (mensagem do salvar ao lado, quebrando linha). Campo de texto do kit no Artista; Buscar letra `Button` com `Sparkles`/`Loader2`; abas do kit (ou `Segmented` com Letra/Cifra); áreas de texto do kit (ou `textarea` com o visual do campo do kit), cifra em `font-ps-mono` com `whitespace-pre` e rolagem de lado dentro da área. Textos sem travessão: "Versão sincronizada disponível: a letra rola sozinha no palco." e "Cole a cifra (acordes sobre a letra). Dica: copie do Cifra Club e cole aqui, os espaços ficam como estão." Sem emoji (`☁️`, `✓`): "Salvo na nuvem e no aparelho." / "Salvo só no aparelho (a música não está na biblioteca da nuvem)."
- [ ] **Step 4: Verificador:** estados `letra` (artista e letra longos, mensagem de busca) e `cifra` (prepare toca na aba Cifra).
- [ ] **Step 5:** verde nos dois. **Step 6:** docs. **Step 7: Commit** `feat(telas): letra e cifra no layout do palco [Parte 3] [faixa C] [T3]`.

### Task 4: Teleprompter (`Teleprompter.tsx`, novo)

**O que faz hoje (no `App.tsx`, linhas 2643 a 2690):** tela cheia por cima (z-50) com o título Teleprompter e o X; sem seções: "Nenhum marcador configurado para esta música."; com seções e uma atual: selo com o nome na cor da seção e a letra da seção bem grande (ou "…"); com seções e nenhuma atual: "Aguardando Seção..."; embaixo, barra do progresso da música e o nome da música (ou "Nenhuma Selecionada").

**Files:** Create `src/components/Teleprompter.tsx`, `src/components/Teleprompter.test.tsx`. Modify verificador e docs. O `App.tsx` não muda nesta faixa.

**Interfaces:**
- Produces: `export function Teleprompter(props: TeleprompterProps)` com
  `interface TeleprompterProps { songName: string | null; hasMarkers: boolean; marker: { label: string; color?: string; lyrics?: string } | null; currentTime: number; duration: number; onClose(): void }`.
- A troca no `App.tsx` (vai no relatório, pro coordenador ou a frente 1b): o bloco `{isTeleprompterMode && (...)}` vira `{isTeleprompterMode && <Teleprompter songName={playlist[activeSongIndex]?.name ?? null} hasMarkers={(playlist[activeSongIndex]?.markers?.length ?? 0) > 0} marker={currentMarker ?? null} currentTime={currentTime} duration={duration} onClose={() => setIsTeleprompterMode(false)} />}` e o import.

- [ ] **Step 1: Testes:** os três estados com os textos; o selo com a cor da seção vinda do dado (`style` com a cor, fundo dela com 12% de opacidade) e verde `#10b981` sem cor; letra vazia mostra "…"; barra em `role="progressbar"` com `aria-valuenow` 25 para 30 s de 120 s e 0 com duração 0; X chama `onClose`; `oldLanguageClasses` vazio; nenhuma tecla é tratada (Espaço e Esc continuam com o palco).
- [ ] **Step 2:** ver falhar (arquivo não existe).
- [ ] **Step 3: Implementar.** `fixed inset-0 z-50 bg-ps-ink-0 font-ps-sans`, barra de cima com `ps-label` "Teleprompter" e X `Button` só de ícone `aria-label="Fechar o teleprompter"`; letra em `text-ps-bone` grande com `whitespace-pre-wrap break-words`; espera em `text-ps-dim` com `animate-ps-blink motion-reduce:animate-none`; nome da música em `ps-label`; barra `bg-ps-s2` com o preenchimento `bg-ps-line-3`. Textos novos: "Nenhuma seção marcada nesta música.", "Esperando a próxima seção...", "Nenhuma música aberta".
- [ ] **Step 4: Verificador:** estados `teleprompter` (seção "Refrão Final Estendido" com 4 linhas longas) e `teleprompter-vazio`.
- [ ] **Step 5** verde, **Step 6** docs (dizer que só aparece depois da troca no App), **Step 7: Commit** `feat(telas): teleprompter como componente no layout do palco, ligacao no App descrita [Parte 3] [faixa C] [T4]`.

### Task 5: Novidades (`WhatsNewModal`)

**O que faz hoje:** mostra a entrada mais nova do `CHANGELOG` (versão, título, itens); nada sem entrada; X, Entendi e toque fora fecham (`onClose`).

- [ ] **Step 1: Testes** (`WhatsNewModal.test.tsx`): dialog com o título da entrada; "Novidades · v<versão>" em `ps-label`; todos os itens numa lista; Entendi (`tone="primary"`) e Fechar chamam `onClose`; `CHANGELOG` vazio (mock) não renderiza nada; `oldLanguageClasses` vazio.
- [ ] **Step 2** falhar. **Step 3:** `StageDialog size="md" title={latest.title}` com o selo da versão antes da lista e Entendi no `footer`. A camada passa de z-[150] para a do `StageDialog` (z-[120]): o tour (z-[200]) continua por cima e o App nunca abre as novidades com o tour aberto.
- [ ] **Step 4** estado `novidades`. **Step 5** verde. **Step 6** docs. **Step 7: Commit** `feat(telas): novidades no layout do palco [Parte 3] [faixa C] [T5]`.

### Task 6: Aviso de atualização (`UpdateBanner`)

**O que faz hoje:** nada sem atualização; Windows (`onUpdateReady`): "Atualização pronta", "Versão X baixada. Reinicie para aplicar.", Reiniciar chama `installUpdate`; Mac (`onUpdateAvailable`): "Nova versão disponível", "Versão X já saiu. Baixe a nova versão.", Baixar chama `installUpdate`; web (service worker esperando ou `controllerchange`): "Uma versão nova do Playback Studio está pronta. Atualize para usar.", Atualizar manda `SKIP_WAITING` e recarrega; "Agora não" esconde; barra no rodapé por cima de tudo (z-[9999]), sem bloquear o app.

- [ ] **Step 1: Testes** (`UpdateBanner.test.tsx`, `window.playbackDesktop` falso): os três casos com título, frase e botão; Reiniciar e Baixar chamam `installUpdate`; Agora não esconde; o aviso é `role="status"` (não é janela, não puxa foco); a frase não usa `truncate`; `oldLanguageClasses` vazio.
- [ ] **Step 2** falhar. **Step 3:** `Panel variant="pop"` no mesmo lugar (`fixed bottom-4`, `w-[min(92vw,440px)]`, z-[9999]), ícone num quadrado `bg-ps-or-soft text-ps-or` (laranja = tem coisa nova ligada), título `text-ps-base font-bold`, frase `text-ps-sm text-ps-mut` quebrando linha, ação `Button tone="primary"`, Agora não `Button` só de ícone `aria-label="Agora não"`; a linha de botões quebra (`flex-wrap`) no celular.
- [ ] **Step 4** estado `atualizacao` (Mac, versão "1.4.30"). **Step 5** verde. **Step 6** docs. **Step 7: Commit** `feat(telas): aviso de atualizacao no layout do palco [Parte 3] [faixa C] [T6]`.

### Task 7: Tour (`GuidedTour`)

**O que faz hoje:** spotlight no `[data-tour=<target>]` (rola até ele, mede de novo em 80 ms, no resize e no scroll), balão embaixo do alvo se couber (mais de 220 px), senão em cima, encostado entre 16 px e a borda; passo sem alvo no meio, com fundo que fecha ao tocar; passo com alvo que não existe é pulado (nos dois sentidos); Próximo / Concluir, voltar, Pular, X; teclas Esc, → e ←.

- [ ] **Step 1: Testes** (`GuidedTour.test.tsx`):
  - `anda, volta, pula passo sem alvo e conclui`: com passos [sem alvo, alvo `a` existente, alvo `b` ausente, alvo `c` existente], Próximo vai do 1 ao 2 e do 2 ao 4; Voltar (`aria-label="Passo anterior"`) volta ao 2; no último o botão diz Concluir e chama `onClose`.
  - `Esc, → e ← fazem o mesmo que os botões`; Pular e Fechar chamam `onClose`.
  - `o balão aponta o alvo`: spotlight com `data-tour-spotlight` medindo o `getBoundingClientRect` do alvo; "Tutorial" em `ps-label`; passo N de M não muda (sem contador novo).
  - `todo alvo do tour tem dono no código`: lê os `target: '...'` de `src/App.tsx` e `src/components/SeparatorStudio.tsx` e confere que cada um aparece como `data-tour="<alvo>"` (ou `data-tour={kind === 'pad' ? 'pads'`) em `src/App.tsx`, `src/components/stage/*.tsx` ou `src/components/SeparatorStudio.tsx`.
  - `linguagem`: `oldLanguageClasses` vazio; contorno do spotlight em laranja (`ps-or`).
- [ ] **Step 2** falhar. **Step 3:** balão `Panel variant="pop"` `w-[300px] max-w-[calc(100vw-32px)] p-5`, `role="dialog"` com `aria-labelledby` no título; Próximo `Button tone="primary"` com a seta; voltar `Button` só de ícone; Pular `Button tone="ghost"`; X `Button` só de ícone `aria-label="Fechar o tutorial"`; spotlight com `outline` laranja `var(--color-ps-or)`. Mesma conta de posição.
- [ ] **Step 4** estados `tour` (alvo no meio da página) e `tour-centro`. **Step 5** verde. **Step 6** docs. **Step 7: Commit** `feat(telas): tour no layout do palco, alvos conferidos [Parte 3] [faixa C] [T7]`.

### Task 8: Página de download (`DownloadPage`)

**O que faz hoje:** pular para o conteúdo; Voltar (link "/" que já existe); marca; selo, título e frase; no celular a instalação vem primeiro, no computador depois dos instaladores; três downloads (Mac Apple Silicon, Mac Intel, Windows) com o do sistema em destaque e "Como instalar?" de cada um; dica de qual Mac; ajuda do Mac (4 passos com o comando `xattr`) e do Windows; "Grátis pra instalar"; 8 funções; requisitos; rodapé com o bloco legal; zoom livre.

- [ ] **Step 1: Testes** (ampliar `DownloadPage.test.tsx`): os três links com os `href` exatos de hoje (`.../Playback-Studio-mac-arm64.dmg`, `-mac-x64.dmg`, `-win.exe`); o do sistema destacado (`data-highlighted="true"` com o navigator de Mac falso); "Como instalar no Windows" abre a ajuda do Windows; as 8 funções e os requisitos; `oldLanguageClasses` vazio (tira `zinc-`, `orange-`, `bg-[#0a0a0c]`); `truncate` fora do subtítulo do download. Os testes que já existem continuam iguais.
- [ ] **Step 2** falhar. **Step 3:** `bg-ps-ink font-ps-sans text-ps-bone` (mantém `site-public`, que dá o foco e o "reduzir movimento"); cartões `Panel`; selo `ps-label` em `ps-or`; título forte em `font-ps-sans` (sem Fraunces: a página passa a ser do app, não da landing); link de download com o visual do `Button tone="primary"` (link estilizado do kit se o `kit-novo.md` tiver; senão as classes do Button no `<a>`, registrado no relatório como pendência pro kit), destaque com `inset-ring-ps-or-line`; comando `xattr` em `font-ps-mono` na `bg-ps-ink-0`.
- [ ] **Step 4** estados `download` (computador Mac) e `download-ajuda` (prepare toca em Como instalar no Mac). **Step 5** verde. **Step 6** docs. **Step 7: Commit** `feat(telas): pagina de download no layout do palco [Parte 3] [faixa C] [T8]`.

### Task 9: Modo Ao Vivo do host (`LiveModeModal`)

**O que faz hoje:** fechado não renderiza; iniciando; erro com a mensagem; ligado: QR Code do endereço, "Conecte na mesma rede" e o endereço selecionável; Quem controla: "Nenhum dispositivo conectado ainda." ou a lista (IP ou "Dispositivo N") com Controla / Só segue (`onToggleDevice(ip)`) e Liberar todos / Bloquear todos (`onToggleAll`); bloco do músico remoto escondido (`{false && ...}`, fica escondido); Desativar Modo Ao Vivo (`onStopServer`); X e toque fora fecham. Props não mudam (a frente 1b põe o limite do Livre pelo App).

**Por que não `StageDialog`:** quem passa do limite de aparelhos ganha os Planos (`PricingModal`, z-[110]) por cima do Ao Vivo; o `StageDialog` (z-[120], foco preso) taparia os Planos. A janela fica com a camada própria em z-[100], com o `Panel variant="pop"` e o mesmo fechar de hoje.

- [ ] **Step 1: Testes** (`LiveModeModal.test.tsx`): os quatro estados; Controla / Só segue com `aria-pressed` e `onToggleDevice('192.168.0.12')`; Liberar todos e Bloquear todos; Desativar chama `onStopServer` (`Button tone="alert"`, âmbar, que é alerta e não perigo vermelho); músico remoto não aparece; `Led state="live"` com o rótulo "Ao vivo" com o servidor ligado; camada com `z-[100]` (abaixo dos Planos); `oldLanguageClasses` vazio; props: o tipo `Parameters<typeof LiveModeModal>[0]` com as mesmas 12 chaves (teste de tipo com `expectTypeOf`).
- [ ] **Step 2** falhar. **Step 3:** camada `fixed inset-0 z-[100] bg-black/60 p-ps-gutter` (toque fora fecha), `Panel variant="pop" role="dialog" aria-modal aria-labelledby` `max-w-md max-h-full overflow-y-auto p-5`; título "Modo Ao Vivo" com `Led live`; X `Button` só de ícone `aria-label="Fechar"`; QR num quadro branco (o QR precisa de fundo claro); endereço em `font-ps-mono break-all select-all`; aparelhos em linhas com `Chip on={approved}` "Controla"/"Só segue"; IP com `break-all`.
- [ ] **Step 4** estado `aovivo` (3 aparelhos, um liberado, endereço longo) e `aovivo-erro`, só nos tamanhos de computador. **Step 5** verde. **Step 6** docs. **Step 7: Commit** `feat(telas): modo ao vivo do host no layout do palco, mesmas props [Parte 3] [faixa C] [T9]`.

### Task 10: Casca do /admin

**O que faz hoje:** `AdminLogin`: e-mail, senha, Entrar (carregando), "Supabase não configurado", "Email ou senha inválidos", sucesso pelo `onAuthStateChange`. `AdminShell`, `ConfirmDialog` e `AdminErrorBoundary` já estão na linguagem nova (v1.4.18): mudam só se o kit novo trouxer a peça que eles fazem à mão (abas do `AdminShell`, campo de nota do `ConfirmDialog`), sem mudar o comportamento que os testes deles já travam.

- [ ] **Step 1: Testes** (`AdminLogin.test.tsx`, `supabase` mockado): campos com rótulo `E-mail` e `Senha` (tipos e `autoComplete` de hoje); Entrar manda `signInWithPassword({ email, password })`; erro mostra "E-mail ou senha inválidos." em `role="alert"`; sem supabase mostra "Supabase não configurado"; Entrar desligado e com `aria-busy` carregando; `oldLanguageClasses` vazio; um `h1` "Painel do admin". Os testes de `AdminApp`, `ConfirmDialog` e `AdminErrorBoundary` continuam passando sem mudança.
- [ ] **Step 2** falhar. **Step 3:** `min-h-screen bg-ps-ink font-ps-sans`, `Panel variant="raised"` `max-w-sm p-5`, marca `PlaybackStudioWordmark` + `ps-label` "Admin" (igual à casca), campos do kit, Entrar `Button tone="primary" type="submit"` `w-full`. Abas do `AdminShell` e o campo do `ConfirmDialog` trocados pelas peças do kit só se a API delas cobrir o que eles fazem hoje (setas/Home/End, contador e LED das Pendências; `maxLength`, `aria-describedby`, `disabled`).
- [ ] **Step 4** estado `adminlogin`. **Step 5** verde (`npx vitest run src/admin`). **Step 6** docs: DESIGN_SYSTEM 1.7 deixa de dizer que o login do admin está no estilo antigo. **Step 7: Commit** `feat(admin): login do admin no layout do palco [Parte 3] [faixa C] [T10]`.

### Task 11: Revisão das telas juntas

- [ ] **Step 1:** `node scripts/verify-layout/run.mjs --estado <todos os da faixa C> --only 1024x740,1280x800,1920x1080,390x844` (o Ao Vivo sem 390) com 0 falhas; e a rodada inteira (8 tamanhos) dos estados da faixa C.
- [ ] **Step 2:** `rg` por `primary|daw-|#1c1c1e|text-\[9px\]` nos arquivos tocados (só o que não é visual pode sobrar) e pelo travessão nas linhas adicionadas (`git diff 52eba03 -U0 | rg '^\+' | rg -P '\x{2014}'`) sem resultado.
- [ ] **Step 3:** conserto do que aparecer, commit `fix(telas): ... [Parte 3] [faixa C] [T11]` (se houver).

### Task 12: Portão e relatório

- [ ] **Step 1** (uma vez, com `caffeinate -i`): `npx vitest run` (código 0, sem "Errors"; teste de tempo que falhar por carga roda sozinho, com o `uptime` anotado), `npx tsc -b`, `npm run typecheck` (7 erros antigos), `npx eslint <arquivos tocados>` sem erro novo, `DESKTOP=1 npx vite build`, `node scripts/verify-layout/run.mjs` (estados da faixa C nos 8 tamanhos + 390) e a rodada normal do palco pra provar que nada do palco mudou.
- [ ] **Step 2:** `report.md` com tarefas e commits, decisões, números do portão, o que ficou de fora e por quê, a troca do teleprompter no `App.tsx` (T4) e as preocupações (duas `StageDialog` abertas, Ao Vivo fora do `StageDialog`, tamanho da letra).
- [ ] **Step 3: Commit** `docs(telas): relatorio da faixa C [Parte 3] [faixa C] [T12]`.
