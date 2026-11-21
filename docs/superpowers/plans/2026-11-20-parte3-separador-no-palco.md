# Parte 3, parte 2: a música separada abre no palco (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** O Separador deixa de ter player próprio onde o palco novo aparece: carregar o áudio, a IA separa e a música abre no palco, com um painel SEPARAÇÃO (BAIXAR em WAV ou MP3, SALVAR NA NUVEM, VOZ GUIA, BPM pela IA e SYNC) e o acesso a "Minhas separações" em um toque; onde o palco novo não aparece (tela menor que 1024 x 740 ou palco Antigo), a separação abre no `SeparatorStudio.tsx` de hoje, com todas as funções e a cara do palco.

**Arquitetura:** Primeiro o miolo do Separador sai da tela pra módulos puros em `src/lib/separation/` (voz guia, click, baixar, publicar na nuvem), sem mudar nada pra quem usa. Depois as telas do Separador viram peças de vista em `src/components/separator/` e as três ferramentas viram peças em `src/components/separation/`, usadas pelo Separador de reserva e pelo painel do palco. Por fim o motor aprende de onde a música veio (`Song.separation`), o App recebe a separação do Separador (`onOpenOnStage`), carrega as faixas pelo `loadFiles` e o hook `useStageSeparation` liga as ferramentas ao motor por uma troca atômica de canal (`replaceAppChannel`).

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4 (tokens `ps-*`, peças de `src/components/ui/` com o kit da faixa B e de `src/components/stage/`) + Electron 42 (roda de `file://`) + Supabase (`user_separations`) + R2 (`uploadToR2`) + Vitest 4/jsdom/Testing Library + verificador de layout (`scripts/verify-layout/`) e de áudio (`scripts/verify-pitch/`).

**Spec:** `docs/superpowers/specs/2026-11-19-parte3-telas-e-livre-design.md` (autoridade): seção 8 inteira; seções 2 (objetivos 4 e 5), 4, 6 (anúncio no fim da separação), 9, 11 e 12. Palco: `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (5b e a linguagem). Visual: mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`, só leitura), `DESIGN_SYSTEM.md` 1.7, 2.6, 2.7 e 2.8. Fatos: `PLAYBACK_STUDIO_FATOS.md`. Regras das faixas: `~/playback-studio-work/parte3-faixas/regras-comuns.md`. Kit novo: `~/playback-studio-work/parte3-faixas/kit-novo.md`.

**Base:** este plano parte do código **depois** das tarefas 14 a 19 do plano `docs/superpowers/plans/2026-11-19-parte3-livre-amostra.md` (frente 1b) e do kit da faixa B (commit `6a18d4a`: `TextField`, `TextArea`, `Select`, `Switch`, `Tabs`, `TabPanel`, `Notice` e o `StageDialog` com `size="lg"` e pilha). O que está marcado **[conferir depois da 1b]** depende de um detalhe que o plano da 1b não fixa: antes do passo, abra o arquivo e acerte o nome; a regra do passo continua valendo.

## Global Constraints

- **Muda a cara, não o que o app faz.** Nenhuma função some, nenhum botão perde a ação, nenhuma prop ou handler muda de sentido, fora o que a seção 8 do spec manda (a música separada abre no palco). Antes de mexer numa tela, a tarefa lista o que ela faz hoje e escreve o teste que prova que continua lá.
- Linguagem do palco: tokens `ps-*`, Inter + JetBrains Mono (`font-ps-sans`, `font-ps-mono`, `ps-num`), painéis, chips, seletor segmentado, LEDs. Cores com um significado só: laranja (`ps-or`) = ligado ou ação principal; branco (`ps-arm`) = armado; cor da seção = seção; âmbar (`ps-alert`) = alerta; `ps-mute` e `ps-solo` só no M e no S. Cor literal só a que vem de dado (a cor de cada faixa da separação, a cor da família do canal). O dourado `primary`, o roxo e o amarelo de hoje do Separador saem.
- Nenhum texto encostando na borda ou cortado; botão com largura pelo texto (`whitespace-nowrap`, padding, `shrink-0`), linhas de botões com `flex-wrap`; alvo de toque de 44 px (`min-h-ps-touch`, `min-w-ps-touch`). Botão novo só se for prático e tiver função clara.
- Português do Brasil em todo texto. Nenhum travessão (U+2014) em nenhuma linha adicionada, comentário ou commit; nos testes, `const TRAVESSAO = String.fromCharCode(0x2014)`. Vocabulário: "multitracks" e "separação de faixas" (nunca "stems" em texto de interface).
- Os textos das telas continuam os mesmos. O que hoje aparece em caixa alta só pelo CSS pode aparecer em caixa de frase na cara nova, sem trocar palavra. Mudam só os textos que este plano lista (inglês que vira português, plural, o tour e o limite `download`).
- App de computador (`file://`): nada de caminho absoluto `/` novo em `src/` (assets por `import.meta.env.BASE_URL`, API por `apiUrl()`); nenhum `window.prompt`, `window.alert` ou `window.confirm` novo. Os `alert` que este plano toca viram frase na tela (`Notice tone="alert" role="alert"`), com o mesmo texto.
- Nada de tela por cima com a música tocando ou na pré-contagem no palco: as ferramentas do painel que geram, analisam ou baixam ficam desligadas tocando (motivo no `title`). O anúncio e a tela de limite do Livre seguem a fila da 1b (`useLivre`, `LimitGate`, `AdSlot`).
- Livre (regras da 1b, sem mudar): a separação do mês sempre abre e não conta; reabrir uma de mês anterior conta nas 3 músicas do mês; no Livre, BAIXAR e SALVAR NA NUVEM abrem a tela de limite. Quem paga não perde nada; admin nunca tem limite.
- Peças: só as de `src/components/ui/` (seção 2.6 e o kit novo) e de `src/components/stage/` (o `StageDialog` é a janela; `panelDismiss.ts` e `TwoTapTrashButton` pras gavetas e lixeiras). Nenhuma peça nova em `src/components/ui/`: o que faltar está no fim, em "Pedidos pra dona do kit", e até lá a tela usa uma constante de classe local (como o `INPUT` de `TextPromptDialog.tsx`).
- Testes: teste de DOM começa com `// @vitest-environment jsdom` e chama `afterEach(cleanup)`; sem `jest-dom` e sem `user-event` (`fireEvent` e asserções nativas). `.tsx` exporta só componentes (ESLint `react-refresh/only-export-components`); funções, tipos de dados e textos vão pra um `.ts` ao lado. Ref não é escrito na renderização (`react-hooks/refs`). Leitura de arquivo (`node:fs`) só dentro do próprio `*.test.ts`.
- Execução: worktree nova a partir do HEAD da `feat/parte3-telas-livre` com as T14 a T20 da 1b e o kit da faixa B juntados, branch `feat/parte3-separador-palco`, `npm ci` nela. Todo comando começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd <worktree>` e manda saída longa pra `$LOGS`. Durante as tarefas, só os testes dos arquivos tocados. Commit por tarefa: `git add <arquivos novos>` e `git commit -m "<tipo>(<escopo>): ... [Parte 3 Separador] [T<N>]" -- <todos os arquivos da tarefa>`. Nada de push, tag, rebase, reset nem merge.
- Documentação viva: toda tarefa que muda o que o usuário vê atualiza no mesmo commit o `PLAYBACK_STUDIO_FATOS.md` (entrada datada do dia da execução, marcada **[NÃO PUBLICADO]**, e a seção 5 "Telas e features visíveis") e, quando cria ou muda peça visual, o `DESIGN_SYSTEM.md`.

## Review Focus

Os cinco casos que o spec implica e que mais machucam quem usa, com o teste que prende cada um:

1. **A data da separação reescrita ao salvar pelo palco.** O `saveSeparation` de hoje usa o `createdAt` da lista da própria instância e, sem achar, grava "agora": a separação de outubro salva pelo palco viraria "deste mês" (abre de graça no Livre) e pularia pro topo da lista. Esperado: a data nunca muda. Testes: T7 `saveSeparation com createdAt mantém a data mesmo sem a separação na lista`; T9 `toda gravação do palco leva o createdAt da separação e nunca grava faixas vazias`.
2. **Livre contando a separação duas vezes, ou a do mês contando.** O Separador marca `sep:<id>` ao abrir; o palco marca a música atual pela chave dela. Esperado: a mesma chave `sep:<id>` nos dois lugares, a do mês não conta, a de mês anterior conta uma vez. Testes: T7 `música que veio de uma separação conta como sep:<id>, mesmo com sourceId`, T7 `stageSongOpenOpts: separação deste mês abre sem contar; a de outubro conta; música comum sem opções`, T11 `a música atual e o pulo do repertório passam stageSongOpenOpts`.
3. **Separação chegando com a música tocando, ou aberta duas vezes.** O motor segue vivo com o Separador na frente (INÍCIO não para a música). Esperado: nada troca a música que toca; a separação entra no fim do repertório e vira a atual quando a música parar; a que já está no repertório não é baixada de novo. Testes: T8 `findSeparationSong acha a separação no repertório`, T11 `com a VS tocando a separação espera a parada pra virar a atual`, T11 `separação já no repertório: onOpenOnStage com files nulo e o App só pula`.
4. **Internet caindo no meio de baixar as faixas pro palco.** Esperado: nada entra pela metade no repertório, a frase do erro aparece na tela do Separador com "Tentar de novo" e "Voltar", nenhum `alert`, e a separação nunca é gravada com faixas vazias. Testes: T8 `uma faixa que falha derruba o conjunto e nada é devolvido`, T11 `erro ao baixar mostra a frase e Tentar de novo, sem chamar onOpenOnStage`, T11 `abrir no palco não grava a separação com faixas vazias`.
5. **Dois clicks ou duas vozes guia na mesma música do palco.** A música separada ganha o "Click gerado" do motor; o Gerar click do painel faz outro. Esperado: um click gerado pelo app por música, troca atômica (nem os dois, nem nenhum), e nunca com a música tocando. Testes: T7 `replaceAppChannel troca o Click gerado pelo Metrônomo e marca clickRemoved`, T7 `replaceAppChannel duas vezes deixa um Metrônomo só e o arquivo do antigo sai do disco`, T9 `ferramentas não fazem nada com a música tocando`.

---

## Decisões deste plano (o dono confere)

O spec deixou estes pontos pro construtor (seção 12) ou não decidiu. Cada um vale até o dono mudar.

- **P1. "Minhas separações" fica no início do Separador** (a tela de carregar o áudio), com a cara do palco: um toque a partir da tela inicial ("Separação de faixas"). Não vira aba da Biblioteca: a Biblioteca é a nuvem e as separações do Livre moram só no aparelho. No palco, chega por FAIXAS > "Minhas separações" e pelo botão no painel. Custo se errado: mover a lista (peça `SeparatorHome` pronta pra ser montada em outro lugar).
- **P2. O painel SEPARAÇÃO é uma gaveta à direita**, como a REPERTÓRIOS à esquerda: não bloqueia o palco, fecha no X e no Esc, abre sozinha quando a separação chega e reabre por FAIXAS > "Separação". Nenhum botão novo na barra do app (em 1024 px ela já está no limite com OFFLINE, HOST, SAÍDAS e o selo do Livre).
- **P3. No palco, BAIXAR, SALVAR NA NUVEM, Detectar (BPM e voz guia), Gerar click, SYNC e Gerar canal de voz guia só com a música parada** (motivo no `title`: "Pare a música pra usar"), como a análise do Metrônomo do palco. Marcar uma voz guia funciona tocando, no tempo ouvido. No Separador de reserva nada muda.
- **P4. Voz guia no palco soa como canal.** O palco só toca canais (tocar marcação solta por cima do motor mexeria no relógio do áudio). Marcações novas ficam "ainda não estão no canal" com o Gerar canal aceso em laranja, e fechar a gaveta com marcações novas e a música parada gera o canal sozinho. Arrastar a marcação na onda continua só no Separador de reserva; no palco o tempo se edita no campo, como no Separador hoje.
- **P5. Um click gerado pelo app por música no palco:** o Gerar click do painel troca o "Click gerado" (do motor) ou o "Metrônomo" de antes pelo novo, numa troca só. SYNC só com o Metrônomo do painel, como hoje no Separador.
- **P6. BPM "120" e tom "C" da separação são o padrão sem valor** (o Separador já esconde os dois na lista): o palco recebe sem BPM e sem tom e lê sozinho (tom pelo `detectKey`, grade pelo motor).
- **P7. Separação já no repertório não é baixada de novo:** o palco pula pra ela. O estado do mixer salvo na separação vale só na primeira carga; depois vale o do repertório.
- **P8. Com a VS tocando quando a separação chega**, ela entra no fim do repertório e vira a atual quando a música parar (a mesma regra da 1b pra importar no Livre).
- **P9. No Livre, BAIXAR e SALVAR NA NUVEM abrem a tela de limite `download`** (com a oferta). O texto dela passa a falar dos dois ("Baixar e salvar na nuvem é do Pro"). Nenhum `LimitKind` novo (mudaria `OFFER_TRIGGERS` no servidor e o CHECK do SQL da oferta).
- **P10. Sem registro salvo** (falhou gravar em "Minhas separações"), a separação recém-feita abre no Separador de reserva, como hoje.
- **P11. A ligação `separation` não vai no .zip do repertório** (vale só na conta, como o ponteiro do cache offline).
- **P12. Telas do Separador viram peças de vista (só props) e o contêiner fica no `SeparatorStudio.tsx`:** o verificador de layout monta as vistas sem Supabase e os testes de "nada some" não precisam do motor.
- **P13. A lixeira de "Minhas separações" passa a pedir dois toques** (`TwoTapTrashButton`) e fica sempre visível (hoje só aparece com o mouse em cima, então no toque não aparecia; e apagava com um toque). A função é a mesma.
- **P14. As marcações da voz guia usam a cor da família Guia** (pedra, `FAMILY_COLOR` de `src/lib/channelNames.ts`), não o amarelo de hoje: âmbar é alerta.
- **P15. No palco, "Minhas separações" grava sozinha** (BPM, marcações, tom original, click e voz guia gerados), sempre com a data da separação. O SALVAR do painel é o "Salvar na nuvem" (o EXPORTAR do Separador, que publica na biblioteca da nuvem). O "Salvar" manual de hoje e o aviso "Tudo salvo na biblioteca" continuam no Separador de reserva. O mixer mexido no palco fica no repertório, não volta pra separação.

## Ordem, dependências e publicação

| Onda | Tarefas | Depende de |
|---|---|---|
| 1. Miolo fora da tela (nada muda) | T1 Voz guia · T2 Click do Separador · T3 Baixar e publicar | nenhuma |
| 2. Separador de reserva com a cara do palco | T4 Entrada, opções e progresso · T5 Ferramentas como peças · T6 Player de reserva | T4: nenhuma. T5: T1, T2, T3. T6: T3, T5 |
| 3. A música separada abre no palco | T7 Motor e repertório conhecem a separação · T8 Contas da abertura · T9 Hook da separação no palco · T10 Painel SEPARAÇÃO · T11 Ligar no App e no Separador | T8: T7. T9: T1, T2, T3, T7. T10: T5, T9. T11: T4, T6, T8, T9, T10 |
| 4 | T12 Documentação viva e portão final | todas |

Execução em sequência: T4, T5, T6 e T11 mexem no mesmo `SeparatorStudio.tsx`; T7 e T11 no `App.tsx` e no motor. Portão de cada onda: `npx vitest run`, `npx tsc -b`, `npx eslint <arquivos da onda>` (0 erro nos novos, nenhum erro novo nos antigos), `DESKTOP=1 npx vite build`; da Onda 2 em diante também `node scripts/verify-layout/run.mjs`; na Onda 3 também `node scripts/verify-pitch/run.mjs` (T7 mexe no motor).

**Publicação** (@devops, depois do portão da T12 e do OK do dono): sem SQL, sem função nova em `api/`. Bump e entrada do `src/lib/changelog.ts` com a nota de lançamento da T12, deploy web + Mac + Windows juntos, dono avisado. As Ondas 1 e 2 deixam o app inteiro funcionando (o Separador de reserva vira o de todos até a Onda 3), mas a publicação é uma só, no fim.

## Contratos que várias tarefas usam

- `SeparationLink = { id: string; createdAt: number }` (`src/types.ts`): de qual separação a música do palco veio. `Song.separation?: SeparationLink`; `SavedSong.separation?: SeparationLink`.
- `StemCount = 2 | 4 | 6` e `separationStemOptions(plan)` vêm do `src/lib/plans.ts` da T14 da 1b.
- `StageSeparationOpen = { sep: SavedSeparation; files: File[] | null; justSeparated: boolean }` (`src/lib/separation/stageHandoff.ts`): o que o Separador entrega ao App. `files` nulo = a separação já está no repertório, só pular.
- Nomes de canal gerado pelo app (`src/lib/generatedChannels.ts`): `GENERATED_CLICK_NAME = 'Click gerado'` (o do motor), `SEPARATOR_CLICK_NAME = 'Metrônomo'`, `VOICE_GUIDE_NAME = 'Voz Guia'`, `APP_CLICK_NAMES = [GENERATED_CLICK_NAME, SEPARATOR_CLICK_NAME]`.
- Ids das faixas geradas na separação (como hoje no Separador): `'metronome'` e `'voiceguide'`.
- `VoiceCue = { id: string; time: number; label: string; file: string }` (`src/lib/separation/voiceGuide.ts`), o mesmo formato do `SavedVoiceCue`.
- `SeparatorMeter = '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'` (`src/lib/separation/separatorClick.ts`).
- `DownloadFormat = 'wav' | 'mp3'`, guardado em `playback-studio:download-format` (`src/lib/separation/stemFiles.ts`).

## Mapa de arquivos

- Novos em `src/lib/separation/`: `voiceGuide.ts` (T1), `separatorClick.ts` (T2), `stemFiles.ts`, `cloudPublish.ts` (T3), `stageHandoff.ts` (T8); `src/lib/generatedChannels.ts` (T7). Testes `*.test.ts` ao lado de cada um.
- Novos em `src/components/separator/` (vistas do Separador): `SeparatorHome.tsx`, `SeparatorOptions.tsx`, `SeparatorProgress.tsx`, `separatorCopy.ts` (T4), `SeparatorPlayerBar.tsx`, `SeparatorTrackStrip.tsx` (T6), `separatorTestKit.ts` (T6, ajudante dos testes), testes `separatorScreens.test.tsx` (T4), `separatorPlayer.test.tsx` (T6), `separatorHandoff.test.tsx` (T11).
- Novos em `src/components/separation/` (ferramentas, nos dois lugares): `BpmClickEditor.tsx`, `VoiceGuideEditor.tsx`, `CloudSaveForm.tsx`, `toolsCopy.ts` (T5), `SeparationPanel.tsx` (T10); testes `editors.test.tsx` (T5), `separationPanel.test.tsx` (T10).
- Novo hook: `src/hooks/useStageSeparation.ts` (T9), teste `src/hooks/useStageSeparation.test.ts`; teste novo `src/hooks/useSeparationLibrary.test.ts` (T7).
- Mexidos: `src/components/SeparatorStudio.tsx` (T1 a T6, T11), `src/lib/autoClick.test.ts` (T2), `src/types.ts`, `src/lib/repertoireSchema.ts`, `src/hooks/useAudioEngine.ts`, `src/lib/livreRules.ts`, `src/hooks/useSeparationLibrary.ts` (T7), `src/components/stage/StageShell.tsx` (T10), `src/App.tsx` (T11), `src/components/livre/limitCopy.ts` (T11), `scripts/verify-layout/` (`fixture.ts`, `main.tsx`, `run.mjs`, `README.md`, novos `pages.tsx` e `pageFixtures.ts`) (T4, T6, T10).
- Docs: `PLAYBACK_STUDIO_FATOS.md` e `DESIGN_SYSTEM.md` (nova seção 2.9 "Separação") nas tarefas que mudam o que se vê; nota de lançamento na T12.

---

## Onda 1: o miolo do Separador sai da tela (nada muda pra quem usa)

### Task 1: Voz guia fora da tela

**Tela:** nada muda (é mudança de lugar do código). FATOS e DESIGN_SYSTEM não mudam nas T1 a T3.

**Files:**
- Create: `src/lib/separation/voiceGuide.ts`
- Modify: `src/components/SeparatorStudio.tsx` (tira `GUIDE_SECTIONS`, `GUIDE_DYNAMICS`, `guideUrl`, `formatCueTime`, `float32ToWav`, o corpo de `renderVoiceGuideToBlob`, o de `autoDetectVoiceGuide` e o parse de `updateCueTime`; passa a importar daqui, mesmo comportamento)
- Test: `src/lib/separation/voiceGuide.test.ts`

**Interfaces:**
- Produces:

```ts
export interface VoiceCue { id: string; time: number; label: string; file: string }
export interface GuideCueOption { label: string; file: string }
export const GUIDE_SECTIONS: readonly GuideCueOption[]   // a lista de hoje, na mesma ordem
export const GUIDE_DYNAMICS: readonly GuideCueOption[]
export function guideUrl(file: string): string           // `${BASE_URL}Portugese Guides/...`, cada parte codificada
export function formatCueTime(secs: number): string      // '1:05'
export function parseCueTime(raw: string): number        // 'm:ss(.d)' em segundos, nunca negativo
export function float32ToWav(samples: Float32Array, sampleRate: number): Blob
export type DecodeGuide = (url: string) => Promise<AudioBuffer | null>
export function renderVoiceGuideWav(cues: readonly VoiceCue[], durationSec: number, decode: DecodeGuide): Promise<Blob | null>
export type MonoSource = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'duration' | 'getChannelData'>
export function detectVoiceCues(buffer: MonoSource, bpmText: string, now?: () => number): VoiceCue[]
export function voiceSourceTrack<T extends { id: string; name: string }>(tracks: readonly T[]): T | undefined
```
`renderVoiceGuideWav` mistura em mono a 44100 Hz, com o comprimento `ceil(durationSec * 44100)`; marcação cujo `decode` devolve nulo fica de fora (como o `continue` de hoje); sem marcações, nulo. O cache de áudio fica com quem chama (o `decode`). `detectVoiceCues` é o algoritmo de hoje movido sem mudar nenhuma conta (blocos de 2 s, suavização, fronteiras, teto de 12 seções, rótulos de louvor, contagem 1 a 4 antes do Intro). `voiceSourceTrack`: a faixa da família Vocal (`channelFamily`); sem ela, a primeira Normal (`resolveChannelRole`) que não é `click`, `metronome` nem `voiceguide` nem se chama `Metrônomo`, `Voz Guia` ou `Click gerado`. Funciona com as faixas do Separador (`{ id: 'vocals', name: 'Vocais' }`) e com os canais do palco (id aleatório, nome).

- [ ] **Step 1: Escrever os testes**

```ts
it('formatCueTime e parseCueTime', () => {
  expect(formatCueTime(65)).toBe('1:05')
  expect(parseCueTime('1:05')).toBe(65)
  expect(parseCueTime('2:3.5')).toBe(123.5)
  expect(parseCueTime('abc')).toBe(0)
  expect(parseCueTime('-1:00')).toBe(0)
})
it('guideUrl usa o BASE_URL e codifica cada parte (nunca "/" absoluto no desktop)', () => {
  expect(guideUrl('Song Sections/Portugese - Intro.wav')).toBe(`${import.meta.env.BASE_URL}Portugese%20Guides/Song%20Sections/Portugese%20-%20Intro.wav`)
})
it('float32ToWav escreve o cabeçalho RIFF/WAVE de 16 bits mono', async () => {
  const blob = float32ToWav(new Float32Array(10), 44100)
  expect(blob.size).toBe(44 + 20)
  const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 12))
  expect(head.startsWith('RIFF')).toBe(true); expect(head.endsWith('WAVE')).toBe(true)
})
it('renderVoiceGuideWav põe cada marcação no seu tempo e pula a que não decodifica', async () => { /* decode falso: 'a' devolve 1 amostra 0.5, 'b' devolve null */ })
it('renderVoiceGuideWav sem marcações devolve null', async () => { expect(await renderVoiceGuideWav([], 10, async () => null)).toBeNull() })
it('detectVoiceCues: Intro no 0, Final no fim, refrão no trecho forte, contagem 1 a 4 antes do Intro e tudo em ordem', () => { /* áudio sintético de 120 s com degraus de energia, bpm '120' */ })
it('detectVoiceCues nunca passa de 12 seções (mais a contagem)', () => { /* 40 degraus */ })
it('voiceSourceTrack acha o vocal pela família nos dois formatos e nunca pega a Voz Guia', () => {
  expect(voiceSourceTrack([{ id: 'voiceguide', name: 'Voz Guia' }, { id: 'vocals', name: 'Vocais' }])?.id).toBe('vocals')
  expect(voiceSourceTrack([{ id: 'u1', name: 'Voz Guia' }, { id: 'u2', name: 'Bateria' }])?.id).toBe('u2')
})
it('o SeparatorStudio não define mais o catálogo nem o WAV (importa de voiceGuide.ts)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
  expect(src).not.toMatch(/const GUIDE_SECTIONS|function float32ToWav|function guideUrl/)
  expect(src).toMatch(/from '\.\.\/lib\/separation\/voiceGuide'/)
})
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/separation/voiceGuide.test.ts > $LOGS/t1.txt 2>&1; tail -20 $LOGS/t1.txt`. Esperado: FAIL, módulo inexistente.
- [ ] **Step 3: Implementar** `voiceGuide.ts` movendo o código de hoje e trocar os usos no `SeparatorStudio.tsx` (o `getAudioContext` e o `guideBufferCache` ficam no Separador e entram pelo `decode`).
- [ ] **Step 4: Rodar de novo** o teste e a suíte dos arquivos que leem o Separador: `npx vitest run src/lib/separation src/lib/autoClick.test.ts src/lib/separationUsage.test.ts > $LOGS/t1b.txt 2>&1; tail -8 $LOGS/t1b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/separation/voiceGuide.ts src/lib/separation/voiceGuide.test.ts
git commit -m "refactor(separador): voz guia em src/lib/separation, sem mudar o que faz [Parte 3 Separador] [T1]" -- src/lib/separation/voiceGuide.ts src/lib/separation/voiceGuide.test.ts src/components/SeparatorStudio.tsx
```

### Task 2: Click do Separador fora da tela

**Files:**
- Create: `src/lib/separation/separatorClick.ts`
- Modify: `src/components/SeparatorStudio.tsx` (`BEATS_PER_BAR`, `pickGridSource`, a mensagem do `detectBpmFromAudio`, a conta de alinhamento do `addMetronomeChannel`, o `nudgeClick`, o `handleTapTempo` e os botões de +1, -1, 2x e metade do BPM passam a chamar daqui), `src/lib/autoClick.test.ts` (a conferência "decide pelo corte próprio nos dois lugares" passa a ler `src/lib/separation/separatorClick.ts`, com as duas chamadas de `separatorGridUsable(` lá e nenhuma no Separador)
- Test: `src/lib/separation/separatorClick.test.ts`

**Interfaces:**
- Produces:

```ts
export type SeparatorMeter = '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'
export const SEPARATOR_METERS: readonly SeparatorMeter[]
export const BEATS_PER_BAR: Record<SeparatorMeter, number>
export function pickGridSource<T extends { id: string; name: string }>(tracks: readonly T[]): T | undefined
export function measureGrid(channels: Float32Array[], sampleRate: number, opts: { nearBpm?: number; beatsPerBar: number }): BeatGrid
export function bpmReport(grid: BeatGrid, sourceName: string): { bpm: string; info: string }
export function clickPlan(i: { typedBpm: string; offsetMs: number; downbeatShift: number; grid: BeatGrid | null }): { bpm: number; firstBeat: number; downbeat: number }
export function generateSeparatorClick(i: { plan: ReturnType<typeof clickPlan>; durationSec: number; sel: ClickLibrarySelection; accentBeat1: boolean; meter: SeparatorMeter }): Promise<string> // URL do WAV; lança 'Falha ao gerar metrônomo'
export function nudgeOffset(current: number, deltaMs: number): number        // de -500 a 500
export function tapTempo(taps: readonly number[], now: number): { taps: number[]; bpm: string | null } // guarda as 8 últimas
export function stepBpm(text: string, delta: 1 | -1): string                 // inteiro de 40 a 300, '120' quando vazio
export function scaleBpm(text: string, factor: 2 | 0.5): string              // formatBpm, de 40 a 300
export function tempoName(bpm: number): string                               // o nome de andamento de hoje (getTempoName)
```
`pickGridSource` mantém a ordem de hoje e entende os dois formatos: bateria (id `drums` ou família `bateria`), depois instrumental (id `no_vocals` ou nome "Instrumental"), depois baixo (id `bass` ou família `baixo`), depois a primeira Normal que não é vocal nem gerada (por id ou pelos nomes de `generatedChannels.ts`; até a T7, os três nomes escritos aqui com o comentário de que a T7 junta). `bpmReport` devolve os dois textos de hoje ("Pulso pouco claro nessa música (X). Confira o BPM no TAP." e "N BPM medido na faixa X."). `clickPlan`: com `separatorGridUsable(grid)` vale o BPM da grade, o `firstBeat` dela mais `offsetMs/1000` e o `downbeat` mais o deslocamento; sem, o BPM digitado (abaixo de 20 ou inválido vira 120), `firstBeat = offsetMs/1000` e `downbeat = downbeatShift`.

- [ ] **Step 1: Escrever os testes**

```ts
it('pickGridSource: bateria primeiro, nos dois formatos', () => {
  expect(pickGridSource([{ id: 'bass', name: 'Baixo' }, { id: 'drums', name: 'Bateria' }])?.id).toBe('drums')
  expect(pickGridSource([{ id: 'a1', name: 'Baixo' }, { id: 'a2', name: 'Bateria' }])?.id).toBe('a2')
})
it('pickGridSource: instrumental antes do baixo e nunca Metrônomo, Voz Guia, Click gerado nem vocal', () => { /* ... */ })
it('clickPlan com grade boa usa o BPM e a fase dela mais o SYNC; sem grade, o BPM digitado a partir do deslocamento', () => { /* ... */ })
it('clickPlan com BPM digitado abaixo de 20 ou vazio usa 120', () => { /* ... */ })
it('nudgeOffset para em 500 e em -500', () => { expect(nudgeOffset(495, 10)).toBe(500); expect(nudgeOffset(-495, -10)).toBe(-500) })
it('tapTempo guarda as 8 últimas batidas e calcula pela média', () => { /* 4 toques a cada 500 ms => '120' */ })
it('stepBpm e scaleBpm respeitam 40 e 300', () => { expect(stepBpm('300', 1)).toBe('300'); expect(scaleBpm('200', 2)).toBe('300'); expect(scaleBpm('60', 0.5)).toBe('40') })
it('bpmReport: pulso claro e pouco claro, sem travessão', () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/separation/separatorClick.test.ts src/lib/autoClick.test.ts > $LOGS/t2.txt 2>&1; tail -20 $LOGS/t2.txt`. Esperado: FAIL (módulo novo e a conferência do autoClick apontando pro arquivo novo).
- [ ] **Step 3: Implementar** `separatorClick.ts` e trocar os usos no Separador (o estado e os efeitos continuam no Separador; o cache da grade `beatGridRef` também).
- [ ] **Step 4: Rodar de novo.** Esperado: PASS, e `grep -c "separatorGridUsable(" src/components/SeparatorStudio.tsx` dá 0.
- [ ] **Step 5: Commit**

```bash
git add src/lib/separation/separatorClick.ts src/lib/separation/separatorClick.test.ts
git commit -m "refactor(separador): contas do click e do BPM em src/lib/separation, sem mudar o que faz [Parte 3 Separador] [T2]" -- src/lib/separation/separatorClick.ts src/lib/separation/separatorClick.test.ts src/components/SeparatorStudio.tsx src/lib/autoClick.test.ts
```

### Task 3: Baixar e publicar na nuvem fora da tela

**Files:**
- Create: `src/lib/separation/stemFiles.ts`, `src/lib/separation/cloudPublish.ts`
- Modify: `src/components/SeparatorStudio.tsx` (`downloadStem`, o formato guardado e o `handleSaveToDatabase` passam a chamar daqui; os `alert` de erro ficam até a T5 e a T6)
- Test: `src/lib/separation/stemFiles.test.ts`, `src/lib/separation/cloudPublish.test.ts`

**Interfaces:**
- Produces:

```ts
// stemFiles.ts
export type DownloadFormat = 'wav' | 'mp3'
export const DOWNLOAD_FORMAT_KEY = 'playback-studio:download-format'
export function readDownloadFormat(): DownloadFormat          // try/catch; sem nada ou com erro, 'wav'
export function writeDownloadFormat(f: DownloadFormat): void  // try/catch
export function stemDownloadName(songName: string, stemName: string, ext: DownloadFormat): string // a regra de hoje: [^a-zA-Z0-9] vira _, sem nome vira 'stem'
export function downloadStem(i: { url: string; songName: string; stemName: string; format: DownloadFormat }): Promise<void> // MP3 a 320 kbps pelo audioBlobToMp3Blob; lança em erro
// cloudPublish.ts
export interface CloudPublishInput {
  songName: string; artist: string; songKey: string; bpm: number; cover: File | null; isGlobal: boolean; userId: string | null
  stems: readonly { id: string; name: string; url: string }[]
  voiceGuide: (() => Promise<Blob | null>) | null   // nulo quando a voz guia já é uma das faixas
}
export function publishToCloud(i: CloudPublishInput, onStatus: (s: { status: string; progress: number }) => void): Promise<void> // lança Error com a frase
```
`publishToCloud` é o `handleSaveToDatabase` de hoje sem o estado da tela: capa pro R2 (`covers`), `/api/insert-song` (artista vazio vira "Desconhecido"), cada faixa remota por `/api/upload-stem-from-url` com a chave `stems/<userId>/<songId>/<id>_<agora>.wav` e cada local pelo `uploadToR2('stems', ...)`, a voz guia renderizada na ordem `total + 1`, `/api/insert-stems`; progresso 10, depois até 90 pelas faixas, com os mesmos textos de status. Quem chama decide `isGlobal` (só admin) e o 100.

- [ ] **Step 1: Escrever os testes** (`fetch` por `vi.stubGlobal`, `../r2` e `../audioExport` mockados)

```ts
it('stemDownloadName segue a regra de hoje', () => { expect(stemDownloadName('Águas Puras', 'Vocais', 'mp3')).toBe('_guas_Puras_Vocais.mp3'); expect(stemDownloadName('', 'Baixo', 'wav')).toBe('stem_Baixo.wav') })
it('readDownloadFormat: mp3 guardado vale; armazenamento quebrado volta wav', () => { /* localStorage que lança */ })
it('downloadStem em MP3 converte e baixa com o nome certo', async () => { /* audioBlobToMp3Blob chamado com 320; a[download] */ })
it('downloadStem lança quando o arquivo não chega', async () => { /* fetch rejeita */ })
it('publishToCloud: música, faixas remotas pelo servidor, locais pelo R2, voz guia no fim e o registro das faixas, nessa ordem', async () => { /* confere URLs e corpos */ })
it('publishToCloud manda is_global só como recebeu e artista vazio como Desconhecido', async () => { /* ... */ })
it('publishToCloud: erro do servidor na música vira a frase dele', async () => { await expect(publishToCloud(...)).rejects.toThrow('sem permissão') })
it('nenhum texto de status com travessão', () => { /* coleta os onStatus */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/separation/stemFiles.test.ts src/lib/separation/cloudPublish.test.ts > $LOGS/t3.txt 2>&1; tail -20 $LOGS/t3.txt`.
- [ ] **Step 3: Implementar** os dois módulos e trocar os usos no Separador.
- [ ] **Step 4: Rodar de novo**, mais o portão da Onda 1 (`npx vitest run`, `npx tsc -b`, `npx eslint` nos arquivos da onda, `DESKTOP=1 npx vite build`). Esperado: PASS e nada muda na tela.
- [ ] **Step 5: Commit**

```bash
git add src/lib/separation/stemFiles.ts src/lib/separation/stemFiles.test.ts src/lib/separation/cloudPublish.ts src/lib/separation/cloudPublish.test.ts
git commit -m "refactor(separador): baixar faixa e publicar na nuvem em src/lib/separation, sem mudar o que faz [Parte 3 Separador] [T3]" -- src/lib/separation/stemFiles.ts src/lib/separation/stemFiles.test.ts src/lib/separation/cloudPublish.ts src/lib/separation/cloudPublish.test.ts src/components/SeparatorStudio.tsx
```

---

## Onda 2: o Separador de reserva com a cara do palco

### Task 4: Entrada (carregar e Minhas separações), opções e progresso

**O que a tela faz hoje (não pode sumir):**
- Entrada: tour na primeira vez (`sep_tour_seen`, com os alvos `data-tour="sep-upload"` e `data-tour="sep-biblioteca"`); "Voltar" (`onClose`); título "Separador IA" e o subtítulo "Motor de Separação Multi-faixa Profissional"; "Carregar Áudio & Iniciar" com o seletor de arquivo `accept={AUDIO_FILE_ACCEPT}` e "MP3, WAV ou AAC"; "Minhas Separações" com a contagem (hoje "N salva(s)"; passa a "1 salva" e "N salvas"); carregando (spinner); vazio ("Nenhuma separação salva ainda." e "Faça sua primeira separação e ela aparecerá aqui automaticamente."); cada cartão com nome (ou "Sem título"), artista, tom (fora o "C"), BPM (fora o "120"), "N faixas", as bolinhas com a cor de até 6 faixas e "+N", a data (`toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })`), "Abrir" (o cartão inteiro abre) e a lixeira "Excluir separação" (não abre o cartão).
- Opções: "Voltar" (volta pra entrada e esquece o arquivo); "Separar faixas" com "Selecione o nível de isolamento de instrumentos desejado"; os cartões das faixas que o plano tem (`separationStemOptions(userPlan)`, T14 da 1b): 2 = "Vocais, Instrumental" em "Separação Básica"; 4 = "Vocais, Bateria, Baixo, Outros" e 6 = "Vocais, Bateria, Baixo, Guitarra, Piano, Outros" em "Separação Avançada"; tocar começa a separação. **[conferir depois da 1b]** se sobrou algum cadeado ou selo PRO na tela de opções da T14 (pelo plano, nenhum).
- Processando: "Analisando Frequências", a linha do motor, a barra de progresso, a mensagem de cada etapa e "N% concluído". Erro no processamento: hoje `alert('⚠️ Erro no processamento: ...')` e volta pra entrada; passa a voltar pra entrada com a frase "Erro no processamento: <motivo>" no topo (`notice`, `Notice tone="alert" role="alert"`).
- O fluxo da 1b (T19) dentro do Separador continua: a tela de limite `separations` e o `LimitGate`; não mexer nessa lógica.

**Files:**
- Create: `src/components/separator/SeparatorHome.tsx`, `src/components/separator/SeparatorOptions.tsx`, `src/components/separator/SeparatorProgress.tsx`, `src/components/separator/separatorCopy.ts`, `scripts/verify-layout/pages.tsx`, `scripts/verify-layout/pageFixtures.ts`
- Modify: `src/components/SeparatorStudio.tsx` (os três `return` de antes do player renderizam as vistas), `scripts/verify-layout/fixture.ts` e `main.tsx` (estados de página), `scripts/verify-layout/run.mjs` (tamanhos de página), `scripts/verify-layout/README.md`, `PLAYBACK_STUDIO_FATOS.md` (seção 5, "Tela Separador IA (entrada)", e a entrada datada), `DESIGN_SYSTEM.md` (nova seção 2.9 "Separação": vistas do Separador)
- Test: `src/components/separator/separatorScreens.test.tsx`

**Interfaces:**
- Consumes: `SavedSeparation` (`useSeparationLibrary.ts`), `StemCount` (T14 da 1b), `Panel`, `Button`, `Notice` (kit), `TwoTapTrashButton`, `Icon`.
- Produces:

```ts
export interface SeparatorHomeProps {
  separations: readonly SavedSeparation[]; loading: boolean
  onBack(): void; onPickFile(file: File): void; onOpen(sep: SavedSeparation): void; onDelete(id: string): void
  tour?: React.ReactNode      // o GuidedTour, quando é a primeira vez
  notice?: React.ReactNode    // frase de erro (a T11 usa pra falha ao abrir no palco)
}
export interface SeparatorOptionsProps { options: readonly StemCount[]; onBack(): void; onChoose(count: StemCount): void }
export interface SeparatorProgressProps {
  title: string; subtitle: string; percent: number; detail: string
  error?: string | null; onRetry?(): void; onBack?(): void   // a T11 usa pra "Abrindo no palco"
}
// separatorCopy.ts: HOME_COPY, OPTIONS_COPY (título, subtítulo, grupos e STEM_OPTION_COPY por StemCount), PROGRESS_COPY, separationMeta(sep): string[] (tom, BPM, "N faixas", na regra de hoje)
```

**O que muda no visual:** fundo `bg-ps-ink`, título com o PlayMark e "Separador IA" em `font-ps-sans` (nada de `tracking-[0.15em]` dourado), "Carregar áudio" como um `Panel variant="raised"` grande com o ícone e o texto (o `<label>` com o `input` escondido, foco visível laranja), "Minhas separações" como lista de linhas `Panel` (nome em `bone` que quebra linha, artista em `mut`, tom, BPM e faixas em selos neutros `ps-num`, as bolinhas com a cor de cada faixa, data em `ps-num`, "Abrir" como `Button`, lixeira de dois toques `TwoTapTrashButton` com `label="Excluir <nome>"`, `confirmLabel="Toque de novo para excluir <nome>"`, sempre visível, P13); vazio e carregando em `mut`; opções como cartões `Panel` tocáveis (`button`, 44 px no mínimo, nome e "N faixas"); progresso com a barra em `ps-or` (é a ação em andamento), texto em `mut`, número em `ps-num`. Tudo cabe em 390 px de largura.

- [ ] **Step 1: Escrever os testes**

```ts
it('entrada: Voltar, Carregar áudio com o filtro de áudio e a lista com contagem', () => {
  render(<SeparatorHome separations={[SEP_A, SEP_B]} loading={false} onBack={onBack} onPickFile={onPick} onOpen={onOpen} onDelete={onDelete} />)
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' })); expect(onBack).toHaveBeenCalled()
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input.accept).toBe(AUDIO_FILE_ACCEPT)
  expect(screen.getByText('2 salvas')).toBeTruthy()
})
it('escolher um arquivo chama onPickFile com ele', () => { /* fireEvent.change no input */ })
it('cartão mostra nome, artista, tom fora do C, BPM fora do 120, faixas e data; sem nome vira Sem título', () => { /* ... */ })
it('Abrir abre; a lixeira pede dois toques e não abre o cartão', () => { /* 1º toque: onDelete não; 2º depois de 350 ms: onDelete(id) e onOpen nunca */ })
it('carregando e vazio mostram as frases de hoje', () => { /* ... */ })
it('os alvos do tour continuam: sep-upload e sep-biblioteca', () => { /* querySelector('[data-tour="sep-upload"]') */ })
it('opções: só as do plano, cada uma com o texto de hoje, e tocar chama onChoose', () => {
  render(<SeparatorOptions options={[4, 6]} onBack={onBack} onChoose={onChoose} />)
  expect(screen.queryByText('Vocais, Instrumental')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Vocais, Bateria, Baixo, Outros/ })); expect(onChoose).toHaveBeenCalledWith(4)
})
it('progresso: título, etapa e porcentagem; com erro, a frase em alerta, Tentar de novo e Voltar', () => { /* role="alert", role="progressbar" com aria-valuenow */ })
it('nenhum texto com travessão nas três vistas', () => { expect(document.body.textContent).not.toContain(TRAVESSAO) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separator/separatorScreens.test.tsx > $LOGS/t4.txt 2>&1; tail -20 $LOGS/t4.txt`.
- [ ] **Step 3: Implementar** as vistas, ligar no Separador e, no verificador, os estados de página `separador-inicio` (6 separações com nome e artista longos, uma sem nome, uma com 7 faixas) e `separador-opcoes` (2, 4 e 6). **[conferir antes]** se a faixa B ou C já criou páginas e tamanhos de página no verificador, use o mecanismo dela e só acrescente os estados. Senão: em `run.mjs`, `const PAGE_SIZES = ['1024x740', '1280x800', '1920x1080', '390x844']` e as páginas novas rodam nesses tamanhos quando não há `--only` (os estados do palco continuam nos 8 de hoje); em `main.tsx`, um mapa `PAGES` com o `config` e as páginas novas (de `pages.tsx`), renderizado no lugar do `<Stage>` e sem a conferência de estrutura do palco; cada estado novo ganha a linha no `EXPECT` (`[data-separator-home]`, `[data-separator-options]`) e no `README.md`. Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** o teste, `npx vitest run src/components/separator src/lib/separation > $LOGS/t4b.txt 2>&1; tail -5 $LOGS/t4b.txt`, `npx tsc -b > $LOGS/tsc.txt 2>&1; tail -5 $LOGS/tsc.txt` e `node scripts/verify-layout/run.mjs --estado separador-inicio,separador-opcoes > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt`. Esperado: PASS e os 2 estados passando nos 4 tamanhos de página.
- [ ] **Step 5: Commit**

```bash
git add src/components/separator/SeparatorHome.tsx src/components/separator/SeparatorOptions.tsx src/components/separator/SeparatorProgress.tsx src/components/separator/separatorCopy.ts src/components/separator/separatorScreens.test.tsx scripts/verify-layout/pages.tsx scripts/verify-layout/pageFixtures.ts
git commit -m "feat(separador): entrada, Minhas separacoes, opcoes e progresso com a cara do palco [Parte 3 Separador] [T4]" -- src/components/separator scripts/verify-layout src/components/SeparatorStudio.tsx PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

### Task 5: As três ferramentas como peças (BPM e click, voz guia, salvar na nuvem)

**O que cada janela faz hoje (não pode sumir):**
- **BPM:** título "BPM" com o nome do andamento (`tempoName`); fechar (não fecha gerando o click); -1 e +1 (de 40 a 300, inteiro); campo do BPM que, ao sair, vira 120 se inválido e encaixa entre 40 e 300 com `formatBpm`; "Tap tempo"; "2×" e "½×"; "Detectar BPM da música" ("Analisando a música..." enquanto mede; desligado sem faixas, medindo ou gerando; título "Mede o BPM exato na bateria da música"); a frase do resultado (`gridInfo`); compasso (3/4, 4/4, 5/4, 6/8, 7/8, 12/8); "Acentuar tempo 1"; "Mover o 1" (só com o acento, -1 e +1, valor com sinal, com o título de hoje); som do click (os 7 tipos) e subdivisão (Acentos, 1/4, 1/8, 1/16), escondidos gerando; "Gerando click <tipo>..." gerando; "Gerar click · <tipo> <compasso> <subdivisão>" (desligado sem faixas, medindo ou gerando); a frase "O click é alinhado sozinho à bateria da música. Se precisar, ajuste fino no SYNC da barra."; abrir com o BPM ainda em 120 mede sozinho uma vez por faixa (efeito do Separador, fica). Trocar o som toca a amostra (fica no Separador, pelo `updateClickSel`).
- **Voz guia:** título "Voz Guia"; "Auto-Detectar" ("Analisando..."; com o aviso "Analisando estrutura do áudio..." e "Detectando mudanças de energia e seções"; título "IA analisa o áudio e detecta seções automaticamente"); a instrução (tocando: "Clique em uma seção para marcar o tempo atual", hoje com um "▶" na frente que sai; parado: "Reproduza a música e clique para carimbar o tempo. Ou use Auto-Detectar."); abas "Seções" e "Dinâmicas"; a grade de marcações (cada uma marca no tempo atual); a lista (hoje "Cues adicionados (N)", passa a "Marcações (N)", português) com o tempo editável (sair do campo ou Enter grava), o nome e tirar; "Limpar todos"; "Gerar canal de Voz Guia" ou "Atualizar canal de Voz Guia" ("Gerando canal...") com a frase "Vira um canal no mixer (igual ao Click). Edite os marcadores e clique de novo para atualizar."; os erros de hoje ("Adicione marcadores de voz primeiro.", "Erro ao gerar canal de voz guia.", "Não foi possível analisar a estrutura: ...").
- **Publicar na nuvem:** título "Publicar na Nuvem"; "Salvando projeto multi-faixa de N canais na sua biblioteca."; "Música *" (exemplo "ex: Águas Purificadoras"), "Artista" ("ex: Hillsong"), "BPM (IA)" (só com `canBpm`), "Tom" (os 12), "Imagem de Capa (Opcional)" com "Selecionar imagem..." e tirar, "Visibilidade Global" e "Publicar na Plataforma para todos os usuários." (só admin), "Salvar & Publicar"; publicando: "Publicando..." ou "Pronto!", o status e a barra; fechar escondido publicando; os erros ("Preencha o Nome da Música.", "Erro ao salvar: ..."); no Livre o envio abre o limite ou os Planos como a 1b deixou **[conferir depois da 1b]**.

**Files:**
- Create: `src/components/separation/BpmClickEditor.tsx`, `src/components/separation/VoiceGuideEditor.tsx`, `src/components/separation/CloudSaveForm.tsx`, `src/components/separation/toolsCopy.ts`
- Modify: `src/components/SeparatorStudio.tsx` (as três janelas viram `<StageDialog>` com as peças dentro; os `alert` dessas três ferramentas viram `message` mostrado pela peça), `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` (2.9: as três peças)
- Test: `src/components/separation/editors.test.tsx`

**Interfaces:**
- Consumes: T1 (`VoiceCue`, `GuideCueOption`, `GUIDE_SECTIONS`, `GUIDE_DYNAMICS`, `formatCueTime`), T2 (`SeparatorMeter`, `SEPARATOR_METERS`, `tempoName`), `CLICK_TYPES`, `CLICK_SUBDIVISIONS`, `ClickLibrarySelection`, `formatBpm`, `Button`, `Chip`, `Segmented`, `TextField`, `Select`, `Switch`, `Tabs`, `TabPanel`, `Notice` (kit), `FAMILY_COLOR` (`channelNames.ts`).
- Produces (as peças só mostram; o estado fica com quem monta):

```ts
export interface BpmClickEditorProps {
  bpm: string; meter: SeparatorMeter; accentBeat1: boolean; downbeatShift: number; clickSel: ClickLibrarySelection
  info: string; busy: 'click' | 'bpm' | null; hasTracks: boolean; message?: string | null
  disabledReason?: string | null   // palco: "Pare a música pra usar" (P3); nulo no Separador
  onBpm(text: string): void; onBpmBlur(): void; onStep(delta: 1 | -1): void; onTap(): void; onScale(f: 2 | 0.5): void; onDetect(): void
  onMeter(m: SeparatorMeter): void; onAccent(on: boolean): void; onShiftDownbeat(delta: 1 | -1): void
  onClickSel(patch: Partial<ClickLibrarySelection>): void; onGenerate(): void
  sync?: { offsetMs: number; enabled: boolean; busy: boolean; onNudge(deltaMs: 10 | -10): void }  // o SYNC dentro da peça (o painel do palco usa; o Separador deixa na barra)
}
export interface VoiceGuideEditorProps {
  cues: readonly VoiceCue[]; tab: 'sections' | 'dynamic'; playing: boolean; detecting: boolean; rendering: boolean
  hasChannel: boolean; pending: boolean; message?: string | null; disabledReason?: string | null
  onTab(t: 'sections' | 'dynamic'): void; onAdd(o: GuideCueOption): void; onRemove(id: string): void; onTime(id: string, raw: string): void
  onClear(): void; onDetect(): void; onCommit(): void
}
export interface CloudSaveFormProps {
  channels: number; name: string; artist: string; bpm: string; songKey: string; cover: File | null
  showBpm: boolean; isAdmin: boolean; publishGlobal: boolean
  saving: boolean; progress: number; status: string; message?: string | null
  onChange(patch: Partial<{ name: string; artist: string; bpm: string; songKey: string; cover: File | null; publishGlobal: boolean }>): void
  onSubmit(): void
}
// toolsCopy.ts: BPM_COPY, VOICE_COPY, CLOUD_COPY, KEYS (os 12 tons de hoje), PAUSE_TO_USE = 'Pare a música pra usar'
```
`disabledReason` desliga Detectar, Gerar click, SYNC, Auto-detectar e Gerar canal, com o motivo no `title`; a grade de marcações nunca desliga por ele (P3).

**O que muda no visual:** janelas no `StageDialog` (BPM `sm`, voz guia e publicar `md`), conteúdo em `font-ps-sans`; o BPM grande em `ps-num` com -1 e +1 como `Button` de ícone; TAP, 2× e ½× como `Chip`; Detectar e Gerar click como `Button` (Gerar click é a ação principal, `tone="primary"`); compasso, som e subdivisão como `Segmented` (quebrando linha); acento no `Switch`; mensagens no `Notice` (`role="alert"`, âmbar); voz guia com `Tabs` em vez das abas amarelas, marcações como `Chip`, a lista com `TextField` de tempo e a lixeira de um toque de hoje como `Button` de ícone "Tirar <nome>", e o pino de cada marcação na cor da família Guia (P14); "Gerar canal" laranja quando há marcação nova (`pending`); publicar com `TextField`, `Select` do tom, `Switch` da visibilidade global e a barra de progresso em `ps-or`. Nada de amarelo, roxo ou dourado.

- [ ] **Step 1: Escrever os testes** (uma `describe` por peça, mais o Separador montando as três)

```ts
it('BPM: -1, +1, Tap tempo, 2× e ½× chamam as ações; o nome do andamento aparece', () => { /* ... */ })
it('BPM: Detectar mostra Analisando a música... e desliga; sem faixas desliga Detectar e Gerar click', () => { /* ... */ })
it('BPM: Mover o 1 só com o acento ligado; compasso, som e subdivisão chamam com o valor', () => { /* ... */ })
it('BPM: gerando esconde som e subdivisão e mostra Gerando click <tipo>...', () => { /* ... */ })
it('BPM: disabledReason desliga Detectar e Gerar click com o motivo no title', () => { /* ... */ })
it('BPM: SYNC mostra o deslocamento com sinal e só anda ligado', () => { /* sync.enabled false: botões desligados */ })
it('voz guia: abas, cada marcação chama onAdd, a lista edita o tempo no blur e no Enter e tira', () => { /* ... */ })
it('voz guia: Limpar todas, Auto-detectar e Gerar ou Atualizar canal conforme hasChannel', () => { /* ... */ })
it('voz guia: tocando, a instrução diz pra clicar; marcação nova acende o Gerar canal', () => { /* ... */ })
it('publicar: campos, BPM só com showBpm, visibilidade só pro admin, capa escolhe e tira', () => { /* getByRole('switch', { name: /Visibilidade global/ }) */ })
it('publicar: salvando mostra Publicando..., o status e a barra; message aparece em alerta', () => { /* ... */ })
it('o Separador abre as três no StageDialog e nenhum alert sobrou nessas ferramentas', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
  expect(src).toMatch(/<BpmClickEditor[\s>]/); expect(src).toMatch(/<VoiceGuideEditor[\s>]/); expect(src).toMatch(/<CloudSaveForm[\s>]/)
  expect(src).not.toMatch(/alert\('Adicione marcadores|alert\('Erro ao gerar canal|alert\("Preencha|alert\("Erro ao salvar|alert\('Não deu pra gerar o click|alert\('Não foi possível analisar/)
})
it('nenhum texto com travessão nas três peças', () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separation/editors.test.tsx > $LOGS/t5.txt 2>&1; tail -20 $LOGS/t5.txt`.
- [ ] **Step 3: Implementar** as peças e montar no Separador (o estado de cada janela continua no Separador; o fechar do BPM e do publicar não faz nada gerando ou publicando, como hoje). Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar de novo** e `npx tsc -b`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/separation/BpmClickEditor.tsx src/components/separation/VoiceGuideEditor.tsx src/components/separation/CloudSaveForm.tsx src/components/separation/toolsCopy.ts src/components/separation/editors.test.tsx
git commit -m "feat(separador): BPM e click, voz guia e publicar na nuvem como pecas do palco, erros na tela [Parte 3 Separador] [T5]" -- src/components/separation src/components/SeparatorStudio.tsx PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

### Task 6: Player do Separador de reserva (barra, transporte, faixas e onda)

**O que a tela faz hoje (não pode sumir):**
- Barra: "Voltar" (volta pra entrada salvando, `goToSeparatorHome`); nome da música (ou "Sem título") e "Separador IA · N CH"; formato de download WAV | MP3 (guardado); "Salvar" (só com a separação gravada; "Salvando"; mostra "Tudo salvo na biblioteca"); "Exportar" (abre o publicar); BPM (abre a janela do BPM, mostra o valor); Tom (a grade dos 12 tons, fecha ao escolher ou tocar fora); transporte: início (zera as marcações já tocadas), play e pausa, fim, loop (aceso quando ligado); o tempo "m:ss / m:ss"; Voz (abre a voz guia, com a contagem; cadeado e Planos sem `canVoiceGuide`); SYNC ◂ valor ▸ (desligado sem o Metrônomo, girando gerando, títulos de hoje); volume geral (de 0 a 1) com o valor em dB.
- Faixas: número, nome, M, S, baixar (girando convertendo; título "Baixar <nome> (WAV)"; sem `canDownload`, o caminho da 1b: limite `download` no Livre **[conferir depois da 1b]**; erro ao baixar: hoje `alert('Erro ao baixar a faixa. Tenta de novo.')`, passa a ser a mesma frase num `Notice tone="alert" role="alert"` embaixo da barra), pan (rolar ajusta, clique centra; some em tela baixa), volume (de 0 a 1) com VOL.
- Onda: régua com 9 marcas de tempo, agulha na régua e nas ondas, marcações da voz guia arrastáveis (arrastar muda o tempo; clique leva a agulha), uma faixa de onda por canal com a cor dela, rolagem de lado (40 px por segundo) e na vertical junto com a coluna das faixas, altura das faixas que preenche a tela e recalcula ao girar.
- Espaço toca e pausa (fora de campo de texto); o anúncio `separation-done` e a tela de limite da 1b (T19) continuam onde estão **[conferir depois da 1b]**.

**Files:**
- Create: `src/components/separator/SeparatorPlayerBar.tsx`, `src/components/separator/SeparatorTrackStrip.tsx`, `src/components/separator/separatorTestKit.ts`
- Modify: `src/components/SeparatorStudio.tsx` (o `return` do player usa as duas peças; a área das ondas fica no Separador, com as classes novas; o `title` da marcação vira "<nome> · m:ss, arraste para mover", sem travessão), `scripts/verify-layout/pages.tsx` e `pageFixtures.ts` (estado `separador-player`), `fixture.ts`, `main.tsx`, `README.md`, `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` (2.9)
- Test: `src/components/separator/separatorPlayer.test.tsx`

**Interfaces:**
- Consumes: T3 (`DownloadFormat`), T5 (as janelas), `Button`, `Chip`, `Segmented`, `Led`, `Notice` (kit), `Icon`. O pan continua com o jeito de hoje (rolar ajusta, clique centra), com a cara do `PanKnob` do palco, sem usar o `PanKnob` em si (ele muda por arrasto). O volume da faixa continua horizontal (não é o `FaderVU`).
- Produces:

```ts
export interface SeparatorPlayerBarProps {
  songName: string; channels: number; format: DownloadFormat; canSave: boolean; saving: boolean
  bpm: string; songKey: string; keyPickerOpen: boolean
  isPlaying: boolean; isLooping: boolean; time: string; total: string
  voice: { count: number; locked: boolean } | null   // nulo sem faixas
  sync: { offsetMs: number; enabled: boolean; busy: boolean }
  masterVolume: number
  onBack(): void; onFormat(f: DownloadFormat): void; onSave(): void; onExport(): void; onOpenBpm(): void
  onKeyPicker(open: boolean): void; onKey(k: string): void
  onStart(): void; onTogglePlay(): void; onEnd(): void; onToggleLoop(): void
  onVoice(): void; onNudge(deltaMs: 10 | -10): void; onMaster(v: number): void
}
export interface SeparatorTrackStripProps {
  index: number; name: string; color: string; state: { muted: boolean; soloed: boolean; volume: number; pan: number }
  height: number; compact: boolean; downloading: boolean; downloadTitle: string; downloadLocked: boolean
  onMute(): void; onSolo(): void; onDownload(): void; onPan(pan: number): void; onPanCenter(): void; onVolume(v: number): void
}
// separatorTestKit.ts: fakes do WaveSurfer, do SyncedTrackPlayer e do AudioContext pros testes do Separador montado
```

**O que muda no visual:** a barra fica como a do palco (`bg-ps-ink-0`, linha `ps-line`, botões `Button`/`Chip` com largura pelo texto e quebrando em duas linhas no celular); play no estilo do `PlayButton` do palco (laranja ligado tocando), LOOP como `Chip on`, tempo em `ps-num`; SYNC como o par ◂ valor ▸ em `Chip` com o valor em `ps-num`; volume geral com o valor em dB em `ps-num`; M e S com os tokens `ps-mute` e `ps-solo` (a exceção de 32 px do mixer vale aqui também, marcada `data-touch-exception="ms"`); faixa com a barra da cor dela (dado), nome que quebra linha; régua e agulha em `bone`; marcações da voz guia na cor da família Guia (P14); o aviso "Tudo salvo na biblioteca" como `Notice role="status"`. A grade dos tons usa os mesmos botões da grade de tons do palco (`KeyCell` como referência visual).

- [ ] **Step 1: Escrever os testes** (vistas soltas e o Separador montado com o `separatorTestKit`, `useAuth`, `useSeparationLibrary`, `useLivre`, `../lib/r2` e `GuidedTour` mockados e `localStorage.sep_tour_seen = '1'`; abre uma separação salva tocando no cartão, com `stageAvailable={false}` a partir da T11)

```ts
it('barra: Voltar, formato, Salvar só com a separação gravada, Exportar, BPM e Tom', () => { /* ... */ })
it('barra: início, play, fim e loop chamam as ações; o tempo aparece em m:ss', () => { /* ... */ })
it('barra: Voz com a contagem e cadeado quando travado; SYNC desligado sem o Metrônomo', () => { /* ... */ })
it('grade do tom: abre, escolhe e fecha; tocar fora fecha', () => { /* ... */ })
it('faixa: M, S, baixar com o título do formato, pan com clique que centra e volume', () => { /* ... */ })
it('Separador montado: abrir uma separação mostra a barra, uma faixa por canal e as ondas', () => { /* uma linha por faixa com data-track-id */ })
it('Separador montado: Espaço toca e pausa, menos dentro de campo de texto', () => { /* ... */ })
it('Separador montado: arrastar a marcação muda o tempo dela e o clique leva a agulha', () => { /* pointerdown/move/up no [data-cue] */ })
it('Separador montado: Voltar salva e volta pra entrada', () => { /* saveSeparation chamado, entrada na tela */ })
it('nenhum texto com travessão no player (inclusive os title)', () => { /* varre textContent e os atributos title */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separator/separatorPlayer.test.tsx > $LOGS/t6.txt 2>&1; tail -20 $LOGS/t6.txt`.
- [ ] **Step 3: Implementar** as peças, ligar no Separador (os handlers de hoje passam pelas props sem mudar de sentido) e o estado `separador-player` do verificador (a barra e 7 faixas com os nomes mais longos, sem as ondas de verdade: uma onda falsa de largura fixa). Atualizar o FATOS e o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** o teste, o portão da Onda 2 (`npx vitest run`, `npx tsc -b`, `npx eslint` nos arquivos da onda, `DESKTOP=1 npx vite build`) e `node scripts/verify-layout/run.mjs --estado separador-inicio,separador-opcoes,separador-player > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt`. Esperado: PASS e os 3 estados nos 4 tamanhos de página.
- [ ] **Step 5: Commit**

```bash
git add src/components/separator/SeparatorPlayerBar.tsx src/components/separator/SeparatorTrackStrip.tsx src/components/separator/separatorTestKit.ts src/components/separator/separatorPlayer.test.tsx
git commit -m "feat(separador): player de reserva com a barra, as faixas e a onda na cara do palco [Parte 3 Separador] [T6]" -- src/components/separator src/components/SeparatorStudio.tsx scripts/verify-layout PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

---

## Onda 3: a música separada abre no palco

### Task 7: Motor e repertório conhecem a separação

**Tela:** nada muda até a T11 (T7 a T9 preparam o motor, as contas e o hook). FATOS e DESIGN_SYSTEM mudam na T10 e na T11.

**Files:**
- Create: `src/lib/generatedChannels.ts`
- Modify: `src/types.ts` (`SeparationLink`, `Song.separation`), `src/lib/repertoireSchema.ts` (`SavedSong.separation`, `toSavedSong`, `migrateSavedSong`; `toManifestSong` sem ela, P11), `src/hooks/useAudioEngine.ts` (restaura `separation`; `loadFiles` com `meta.separation` e `meta.channelStates`; `replaceAppChannel`; `addChannelToActiveSong` devolve o canal; `GENERATED_CLICK_NAME` vem de `generatedChannels.ts`), `src/lib/livreRules.ts` (`stageSongKey` lê `separation`; `stageSongOpenOpts`), `src/hooks/useSeparationLibrary.ts` (`saveSeparation` aceita `createdAt`), `src/lib/separation/separatorClick.ts` e `voiceGuide.ts` (os nomes passam a vir de `generatedChannels.ts`)
- Test: `src/lib/repertoireSchema.test.ts`, `src/hooks/useAudioEngine.persistence.test.ts`, `src/lib/livreRules.test.ts`, `src/hooks/useSeparationLibrary.test.ts` (novo, com `idb-keyval` e `../lib/supabase` mockados)

**Interfaces:**
- Produces:

```ts
// types.ts
export interface SeparationLink { id: string; createdAt: number }
export interface ChannelStartState { volume: number; muted: boolean; soloed: boolean; pan: number }   // o mixer salvo de cada faixa da separação
// Song ganha: separation?: SeparationLink
// repertoireSchema.ts
export function sanitizeSeparationLink(v: unknown): SeparationLink | undefined   // id texto não vazio e createdAt número finito
// useAudioEngine.ts
// loadFiles(..., meta?: { ...o de hoje; separation?: SeparationLink; channelStates?: readonly (ChannelStartState | undefined)[] })
//   channelStates na ordem dos arquivos; valor que falta ou fora da faixa fica no padrão de hoje
// replaceAppChannel(songId: string, names: readonly string[], file: File): Promise<Channel | null>
// addChannelToActiveSong(file: File): Promise<Channel | null>
// livreRules.ts
// stageSongKey(song): separation vence sourceId ('sep:<id>'); o resto igual
export function stageSongOpenOpts(song: { separation?: SeparationLink } | null | undefined, now: Date): { freeThisMonth?: boolean }
// useSeparationLibrary.ts
// saveSeparation(data: Omit<SavedSeparation, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): createdAt = data.createdAt ?? o da lista ?? agora
```
`replaceAppChannel` é atômico e lê sempre do `playlistRef`: tira da música `songId` todo canal cujo nome original (`name`, nunca o `customName`) está em `names`, com a mesma limpeza do `removeChannel` de hoje (voz tocando, nós do grafo, nó de tom, arquivo no disco, `clickRemoved` quando sai um click), e acrescenta o canal novo como o `appendChannelToSong` (tocando, entra pelo `addLiveVoice`); canal novo de papel Click agenda a leitura da grade como o `addChannelToActiveSong`. Pra isso o miolo do `removeChannel` vira `dropChannel(songId, channelId)` sobre o `playlistRef`, usado pelos dois. Música que saiu do repertório no meio: devolve nulo e não grava nada. O hook devolve `replaceAppChannel` no objeto de retorno, junto do `addChannelToActiveSong`.

- [ ] **Step 1: Escrever os testes**

```ts
// repertoireSchema.test.ts
it('a ligação com a separação vai e volta no repertório salvo e não vai pro .zip', () => {
  const saved = toSavedSong({ ...SONG, separation: { id: 'sep_1', createdAt: 1_700_000_000_000 } })
  expect(saved.separation).toEqual({ id: 'sep_1', createdAt: 1_700_000_000_000 })
  expect(toManifestSong({ ...SONG, separation: { id: 'sep_1', createdAt: 1 } })).not.toHaveProperty('separation')
})
it('sanitizeSeparationLink descarta id vazio e data quebrada', () => { expect(sanitizeSeparationLink({ id: '', createdAt: 1 })).toBeUndefined(); expect(sanitizeSeparationLink({ id: 'a', createdAt: NaN })).toBeUndefined() })
// useAudioEngine.persistence.test.ts (mesmo harness do setChannelMeta)
it('loadFiles com separation grava a ligação e o estado inicial dos canais, e reabrir o app traz de volta', async () => { /* channelStates[1] = { volume: 0.5, muted: true, soloed: false, pan: -0.3 } */ })
it('replaceAppChannel duas vezes deixa um Metrônomo só e o arquivo do antigo sai do disco', async () => { /* ... */ })
it('replaceAppChannel troca o Click gerado pelo Metrônomo e marca clickRemoved', async () => { /* ... */ })
it('replaceAppChannel numa música que saiu do repertório devolve null e não grava nada', async () => { /* ... */ })
it('addChannelToActiveSong devolve o canal criado', async () => { /* ... */ })
// livreRules.test.ts
it('música que veio de uma separação conta como sep:<id>, mesmo com sourceId', () => { expect(stageSongKey({ ...S, sourceId: 'c1', separation: { id: 'x', createdAt: 0 } })).toBe('sep:x') })
it('stageSongOpenOpts: separação deste mês abre sem contar; a de outubro conta; música comum sem opções', () => { /* now = 2026-11-20 em Brasília */ })
// useSeparationLibrary.test.ts
it('saveSeparation com createdAt mantém a data mesmo sem a separação na lista', async () => { /* Livre: grava no idb-keyval falso com o createdAt passado */ })
it('saveSeparation sem createdAt e sem a separação na lista usa agora (como hoje)', async () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/repertoireSchema.test.ts src/hooks/useAudioEngine.persistence.test.ts src/lib/livreRules.test.ts src/hooks/useSeparationLibrary.test.ts > $LOGS/t7.txt 2>&1; tail -25 $LOGS/t7.txt`.
- [ ] **Step 3: Implementar.** **[conferir depois da 1b]** a forma final do `stageSongKey` da T6 da 1b (a assinatura recebe o tipo da música; só acrescentar `separation?`).
- [ ] **Step 4: Rodar** os testes, a suíte inteira do motor (`npx vitest run src/hooks src/lib > $LOGS/t7b.txt 2>&1; tail -5 $LOGS/t7b.txt`) e `node scripts/verify-pitch/run.mjs > $LOGS/pitch.txt 2>&1; tail -10 $LOGS/pitch.txt`. Esperado: PASS e todos os cenários do verify-pitch aprovados (nada do som mudou).
- [ ] **Step 5: Commit**

```bash
git add src/lib/generatedChannels.ts src/hooks/useSeparationLibrary.test.ts
git commit -m "feat(motor): musica do palco sabe de qual separacao veio, troca atomica do canal gerado e data da separacao preservada [Parte 3 Separador] [T7]" -- src/lib/generatedChannels.ts src/types.ts src/lib/repertoireSchema.ts src/lib/repertoireSchema.test.ts src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.persistence.test.ts src/lib/livreRules.ts src/lib/livreRules.test.ts src/hooks/useSeparationLibrary.ts src/hooks/useSeparationLibrary.test.ts src/lib/separation/separatorClick.ts src/lib/separation/voiceGuide.ts
```

### Task 8: Abrir a separação no palco: as contas

**Files:**
- Create: `src/lib/separation/stageHandoff.ts`
- Test: `src/lib/separation/stageHandoff.test.ts`

**Interfaces:**
- Consumes: `SavedSeparation`, `SavedStem` (`useSeparationLibrary.ts`), `SeparationLink`, `ChannelStartState` (T7), `KEY_NAMES` ou a lista de tons de `src/lib/keyNames.ts`.
- Produces:

```ts
export interface StageSeparationOpen { sep: SavedSeparation; files: File[] | null; justSeparated: boolean }
export interface StageSeparationMeta { name: string; artist?: string; bpm?: number; originalKey?: string; separation: SeparationLink }
export function separationStageMeta(sep: SavedSeparation): StageSeparationMeta
export function stemsToOpen(sep: SavedSeparation): SavedStem[]                    // só URL http(s), na ordem
export function separationChannelStates(stems: readonly SavedStem[]): (ChannelStartState | undefined)[]
export function fetchSeparationFiles(stems: readonly SavedStem[], i: { fetchImpl?: typeof fetch; signal?: AbortSignal; onProgress?(done: number, total: number): void }): Promise<File[]>
export function findSeparationSong(playlist: readonly { separation?: { id: string } }[], sepId: string): number   // -1 sem
export const OPEN_ERROR_TEXT = 'Não deu pra baixar as faixas da separação. Confira a internet e tente de novo.'
```
`separationStageMeta`: nome "Artista - Música" quando há artista (como a Biblioteca), "Sem título" sem nome; `bpm` nulo pra "120" e pra texto que não é número entre 20 e 300 (P6), senão o número com as casas; `originalKey` nulo pra "C" e pra tom fora da lista, senão o tom. `fetchSeparationFiles`: baixa uma faixa por vez (memória do iPad), arquivo `<nome da faixa>.wav` (sem nome, "Faixa N"), tipo do blob ou `audio/wav`; qualquer falha ou `abort` lança e não devolve nada pela metade.

- [ ] **Step 1: Escrever os testes**

```ts
it('separationStageMeta: 120 e C viram sem valor; 72.5 e G# ficam; artista entra no nome', () => { /* ... */ })
it('stemsToOpen pula a faixa local (blob:) e mantém a ordem', () => { /* ... */ })
it('separationChannelStates leva o mixer salvo e deixa vazio o que não tem', () => { /* ... */ })
it('fetchSeparationFiles baixa uma por vez e conta o progresso', async () => { /* onProgress 1/3, 2/3, 3/3 */ })
it('uma faixa que falha derruba o conjunto e nada é devolvido', async () => { await expect(fetchSeparationFiles(...)).rejects.toThrow() })
it('abort no meio para de baixar', async () => { /* ... */ })
it('findSeparationSong acha a separação no repertório', () => { expect(findSeparationSong([{}, { separation: { id: 's1' } }], 's1')).toBe(1); expect(findSeparationSong([], 's1')).toBe(-1) })
it('OPEN_ERROR_TEXT sem travessão', () => { expect(OPEN_ERROR_TEXT).not.toContain(TRAVESSAO) })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/separation/stageHandoff.test.ts > $LOGS/t8.txt 2>&1; tail -20 $LOGS/t8.txt`.
- [ ] **Step 3: Implementar** `stageHandoff.ts`.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/separation/stageHandoff.ts src/lib/separation/stageHandoff.test.ts
git commit -m "feat(separador): contas pra abrir a separacao no palco, tudo ou nada nas faixas [Parte 3 Separador] [T8]" -- src/lib/separation/stageHandoff.ts src/lib/separation/stageHandoff.test.ts
```

### Task 9: Hook da separação no palco

**Files:**
- Create: `src/hooks/useStageSeparation.ts`
- Test: `src/hooks/useStageSeparation.test.ts`

**Interfaces:**
- Consumes: T1 (`renderVoiceGuideWav`, `detectVoiceCues`, `voiceSourceTrack`, `parseCueTime`, `guideUrl`), T2 (`pickGridSource`, `measureGrid`, `bpmReport`, `clickPlan`, `generateSeparatorClick`, `nudgeOffset`, `tapTempo`, `stepBpm`, `scaleBpm`), T3 (`downloadStem`, `readDownloadFormat`, `writeDownloadFormat`, `publishToCloud`), T7 (`APP_CLICK_NAMES`, `SEPARATOR_CLICK_NAME`, `VOICE_GUIDE_NAME`, `Song.separation`).
- Produces:

```ts
export interface StageSeparationBridge {
  song: Song | null          // a música ativa do palco
  busy: boolean              // tocando ou na pré-contagem
  heardPosition(): number
  replaceChannel(names: readonly string[], file: File): Promise<Channel | null>   // o App passa (n, f) => replaceAppChannel(song.id, n, f)
}
export interface StageSeparationStore {
  userId: string | null; isAdmin: boolean
  getSeparation(id: string): Promise<SavedSeparation | null>
  saveSeparation(data: Omit<SavedSeparation, 'id' | 'createdAt'> & { id: string; createdAt: number }): Promise<string | null>
  upload(path: string, file: File): Promise<string | null>     // o App passa uploadToR2('stems', path, file) -> url ou nulo
}
export type SeparationBusy = 'click' | 'bpm' | 'guide' | 'cues' | 'download' | 'cloud' | null
export interface StageSeparation {
  sep: SavedSeparation | null; loading: boolean
  bpm: string; meter: SeparatorMeter; accentBeat1: boolean; downbeatShift: number; clickSel: ClickLibrarySelection
  offsetMs: number; hasClick: boolean; gridInfo: string
  cues: readonly VoiceCue[]; cuesPending: boolean; hasGuide: boolean; guideTab: 'sections' | 'dynamic'
  format: DownloadFormat; downloadingId: string | null
  cloud: { name: string; artist: string; bpm: string; songKey: string; cover: File | null; publishGlobal: boolean; progress: number; status: string }
  busy: SeparationBusy; message: string | null
  setBpm(t: string): void; blurBpm(): void; stepBpm(d: 1 | -1): void; tap(): void; scaleBpm(f: 2 | 0.5): void; detectBpm(): Promise<void>
  setMeter(m: SeparatorMeter): void; setAccent(on: boolean): void; shiftDownbeat(d: 1 | -1): void; setClickSel(p: Partial<ClickLibrarySelection>): void
  generateClick(): Promise<void>; nudge(deltaMs: 10 | -10): void
  setGuideTab(t: 'sections' | 'dynamic'): void; addCue(o: GuideCueOption): void; removeCue(id: string): void; setCueTime(id: string, raw: string): void
  clearCues(): void; detectCues(): Promise<void>; commitVoiceGuide(): Promise<void>
  setFormat(f: DownloadFormat): void; download(stemId: string): Promise<void>
  setCloud(p: Partial<StageSeparation['cloud']>): void; publish(): Promise<boolean>
  flushPending(): Promise<void>   // fechar a gaveta: gera a voz guia pendente se parado (P4) e grava o que falta
}
export function useStageSeparation(bridge: StageSeparationBridge, store: StageSeparationStore): StageSeparation
```
Regras do hook: lê a separação (`getSeparation`) quando a música ativa tem `separation` e zera quando não tem ou muda de música; o estado do BPM, do compasso, das marcações e do SYNC começa do registro (como o `handleOpenSavedSeparation` de hoje). Com `bridge.busy`, toda ação que gera, analisa ou baixa não faz nada (P3); `addCue` funciona sempre, no `heardPosition()`. Gerar click: `clickPlan` + `generateSeparatorClick` sobre os canais do palco (`pickGridSource` nos canais, amostras do `buffer`), arquivo `Metrônomo.wav`, `replaceChannel(APP_CLICK_NAMES, file)` (P5), depois sobe pro R2 em `<userId>/<sepId>/click_<agora>.wav` e grava a separação com a faixa `metronome` trocada. SYNC: `nudgeOffset` e, com o Metrônomo, gera de novo 600 ms depois do último toque. Voz guia: `renderVoiceGuideWav` com a duração da música, arquivo `Voz Guia.wav`, `replaceChannel([VOICE_GUIDE_NAME], file)`, sobe e grava a faixa `voiceguide`; `cuesPending` liga a cada mudança de marcação e desliga ao gerar. BPM, marcações e o tom original da música do palco (`song.originalKey` vira `songKey`) gravam 800 ms depois da última mudança. **Toda gravação leva `id` e `createdAt` da separação** e nunca grava com a lista de faixas vazia. Baixar: `downloadStem` com a URL e o nome da faixa da separação. Publicar: `publishToCloud` com as faixas da separação (a voz guia pendente entra pelo `voiceGuide` quando ainda não é faixa), `isGlobal` só com `isAdmin`. Erro vira `message` (frase de hoje), nunca `alert`.

- [ ] **Step 1: Escrever os testes** (`renderHook`, timers falsos, ponte e loja falsas, `generateSeparatorClick`, `renderVoiceGuideWav` e `downloadStem` mockados)

```ts
it('lê a separação da música ativa e zera numa música comum', async () => { /* ... */ })
it('addCue marca no tempo ouvido, mesmo tocando, e liga cuesPending', () => { /* heardPosition() = 42.5 */ })
it('ferramentas não fazem nada com a música tocando', async () => { /* busy true: generateClick, detectBpm, commitVoiceGuide, download, detectCues sem efeito */ })
it('generateClick troca o click gerado pelo app pelo Metrônomo e grava a faixa metronome com a mesma data', async () => {
  expect(bridge.replaceChannel).toHaveBeenCalledWith(['Click gerado', 'Metrônomo'], expect.objectContaining({ name: 'Metrônomo.wav' }))
  expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sep_1', createdAt: SEP.createdAt, stems: expect.arrayContaining([expect.objectContaining({ id: 'metronome' })]) }))
})
it('nudge anda de 10 em 10 e gera de novo 600 ms depois do último toque', () => { /* ... */ })
it('commitVoiceGuide troca a Voz Guia, grava a faixa voiceguide e desliga cuesPending', async () => { /* ... */ })
it('flushPending parado com marcação nova gera o canal; tocando só grava as marcações', async () => { /* ... */ })
it('toda gravação do palco leva o createdAt da separação e nunca grava faixas vazias', async () => { /* BPM, marcações e tom original */ })
it('download usa a URL e o nome da faixa da separação no formato escolhido', async () => { /* ... */ })
it('publish manda is_global só pro admin e a voz guia pendente', async () => { /* ... */ })
it('erro vira message com a frase de hoje, sem alert', async () => { /* vi.spyOn(window, 'alert') nunca chamado */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/hooks/useStageSeparation.test.ts > $LOGS/t9.txt 2>&1; tail -20 $LOGS/t9.txt`.
- [ ] **Step 3: Implementar** o hook.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStageSeparation.ts src/hooks/useStageSeparation.test.ts
git commit -m "feat(separador): ferramentas da separacao ligadas ao palco, so com a musica parada [Parte 3 Separador] [T9]" -- src/hooks/useStageSeparation.ts src/hooks/useStageSeparation.test.ts
```

### Task 10: Painel SEPARAÇÃO do palco

**Files:**
- Create: `src/components/separation/SeparationPanel.tsx`
- Modify: `src/components/stage/StageShell.tsx` (`slots.separation?: React.ReactNode`, posto numa gaveta da direita `data-stage-drawer-right`, `absolute top-11 bottom-0 right-0 z-40 flex`, espelho da `data-stage-drawer`), `scripts/verify-layout/fixture.ts`, `main.tsx`, `run.mjs`, `README.md` (estado do palco `separacao`: gaveta aberta na aba FAIXAS com 7 faixas e os nomes mais longos, palco parado; e `separacao-voz` na aba VOZ GUIA com 14 marcações), `DESIGN_SYSTEM.md` (2.9: o painel)
- Test: `src/components/separation/separationPanel.test.tsx`, `src/components/stage/stageShell.test.tsx` (`slots.separation fica na gaveta da direita`)

**Interfaces:**
- Consumes: T5 (`BpmClickEditor` com `sync`, `VoiceGuideEditor`), T9 (`StageSeparation`), `usePanelDismiss` (`panelDismiss.ts`), `Tabs`, `TabPanel`, `Segmented`, `Button`, `Notice` (kit), `Icon`.
- Produces:

```ts
export type SeparationTab = 'faixas' | 'voz' | 'bpm'
export interface SeparationPanelProps {
  open: boolean; songName: string; tab: SeparationTab; onTab(t: SeparationTab): void
  s: StageSeparation; playing: boolean
  canDownload: boolean; canCloudSave: boolean
  onLimit(): void            // Livre: BAIXAR e SALVAR NA NUVEM (P9)
  onOpenCloudSave(): void    // abre o StageDialog com o CloudSaveForm (App)
  onMySeparations(): void
  ad?: React.ReactNode       // o AdSlot separation-done (App, só no Livre logo depois de separar)
  onClose(): void
}
```
Partes: cabeçalho "Separação" (`ps-label`) com o nome da música e o X ("Fechar a separação", Esc pela pilha dos painéis); `Tabs` FAIXAS, VOZ GUIA e BPM E CLICK; **FAIXAS:** o anúncio quando vier, o formato WAV | MP3 (`Segmented`), uma linha por faixa da separação (a barra da cor dela, o nome que quebra linha e "Baixar", girando enquanto baixa), "Salvar na nuvem" e "Minhas separações"; **VOZ GUIA:** o `VoiceGuideEditor`; **BPM E CLICK:** o `BpmClickEditor` com o SYNC dentro. Tocando, os botões de P3 ficam desligados com "Pare a música pra usar" no `title`; a gaveta não bloqueia o palco (`role="dialog"` sem `aria-modal`, como a REPERTÓRIOS). Sem `canDownload`, "Baixar" chama `onLimit`; sem `canCloudSave`, "Salvar na nuvem" também. A mensagem de erro do hook aparece no topo da aba (`Notice tone="alert" role="alert"`).

**O que muda no visual:** gaveta da direita com a mesma casca da REPERTÓRIOS espelhada (`w-[420px] max-w-full`, `rounded-l-ps-2xl`, `bg-ps-raised`, sombra `ps-pop`, anel `line-2`, entrando da direita), conteúdo que rola dentro e cabeçalho parado.

- [ ] **Step 1: Escrever os testes**

```ts
it('abas FAIXAS, VOZ GUIA e BPM E CLICK trocam pelo onTab', () => { /* getByRole('tab', { name: 'VOZ GUIA' }) */ })
it('FAIXAS: uma linha por faixa com Baixar, o formato, Salvar na nuvem e Minhas separações', () => { /* ... */ })
it('tocando: Baixar, Salvar na nuvem, Gerar click, SYNC, Detectar e Gerar canal desligados com o motivo', () => { /* title "Pare a música pra usar" */ })
it('tocando, a grade de marcações da voz guia continua ligada', () => { /* ... */ })
it('Livre: Baixar e Salvar na nuvem chamam onLimit e não baixam', () => { /* canDownload e canCloudSave falsos */ })
it('o anúncio aparece no topo da aba FAIXAS quando vem', () => { /* ad = <div data-house-ad="separation-done" /> */ })
it('X e Esc fecham; a gaveta não é modal', () => { /* aria-modal ausente */ })
it('mensagem de erro do hook aparece em alerta', () => { /* ... */ })
it('nenhum texto com travessão', () => { /* ... */ })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separation/separationPanel.test.tsx > $LOGS/t10.txt 2>&1; tail -20 $LOGS/t10.txt`.
- [ ] **Step 3: Implementar** o painel, o `slots.separation` da casca e os dois estados do verificador (o fixture passa o painel no slot novo; a T11 só liga no App). Atualizar o DESIGN_SYSTEM.
- [ ] **Step 4: Rodar** o teste, `npx vitest run src/components/stage/stageShell.test.tsx` e `node scripts/verify-layout/run.mjs --estado separacao,separacao-voz > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt`. Esperado: PASS e os 2 estados nos 8 tamanhos do palco (a gaveta não faz a casca rolar de lado a partir de 1024 px).
- [ ] **Step 5: Commit**

```bash
git add src/components/separation/SeparationPanel.tsx src/components/separation/separationPanel.test.tsx
git commit -m "feat(palco): painel SEPARACAO com baixar, salvar na nuvem, voz guia, BPM e SYNC [Parte 3 Separador] [T10]" -- src/components/separation src/components/stage/StageShell.tsx src/components/stage/stageShell.test.tsx scripts/verify-layout DESIGN_SYSTEM.md
```

### Task 11: Ligar no App e no Separador

**Files:**
- Modify: `src/App.tsx`, `src/components/SeparatorStudio.tsx`, `src/components/livre/limitCopy.ts` (`download`: título "Baixar e salvar na nuvem é do Pro", texto "No Pro cada músico leva a sua faixa pro ensaio, em WAV ou MP3, e a música fica salva na nuvem pra abrir em qualquer aparelho."), `PLAYBACK_STUDIO_FATOS.md` (seção 5: o Separador abre a música no palco e o painel SEPARAÇÃO; seção "Livre": BAIXAR e SALVAR NA NUVEM do palco abrem a tela de limite; entrada datada), `DESIGN_SYSTEM.md` (2.7: o `slots.separation`; 2.9: o fluxo)
- Test: `src/appWiring.test.ts`, `src/components/separator/separatorHandoff.test.tsx` (novo, com o `separatorTestKit`), `src/components/livre/limitScreen.test.tsx`

**Interfaces:**
- Consumes: T7 (`replaceAppChannel`, `loadFiles` com `separation` e `channelStates`, `stageSongOpenOpts`), T8 (`StageSeparationOpen`, `separationStageMeta`, `stemsToOpen`, `separationChannelStates`, `fetchSeparationFiles`, `findSeparationSong`, `OPEN_ERROR_TEXT`), T9, T10, e da 1b: `livre` (`useLivre`), `LimitGate`, `AdSlot`, `trackAd`, `separationKey`, `separationIsThisMonth`, `jumpToSongGated` e o efeito `noteSongOpened(stageSongKey(...))` da T17 **[conferir depois da 1b]**.
- `SeparatorStudio` ganha: `stageAvailable: boolean` (o App passa `wantNewStage`: chave Novo e janela larga), `stageSeparationIds: ReadonlySet<string>` (as separações que já estão no repertório) e `onOpenOnStage(o: StageSeparationOpen): void`.
- Fluxo no Separador:
  - **Separação nova:** depois do auto-save, com registro (`sepId`) e `stageAvailable`, mostra o `SeparatorProgress` "Abrindo no palco" baixando as faixas (`fetchSeparationFiles` com o progresso e um `AbortController` que o "Voltar" cancela) e chama `onOpenOnStage({ sep, files, justSeparated: true })`. Sem registro (P10) ou sem `stageAvailable`, o player de reserva como hoje. Erro ao baixar: `OPEN_ERROR_TEXT` no `SeparatorProgress` com "Tentar de novo" e "Voltar"; nada vai pro App.
  - **Abrir de "Minhas separações":** a trava do Livre da T19 vem antes (sem vaga, a tela de limite e não abre). Com `stageAvailable`: já no repertório, `onOpenOnStage({ sep, files: null, justSeparated: false })`; senão baixa e entrega como acima. Sem `stageAvailable`, o player de reserva.
  - `persistSeparation` não grava nada com a lista de faixas vazia (a separação que vai pro palco nunca é sobrescrita ao fechar o Separador).
  - O tour (`SEP_TOUR_STEPS`) muda dois textos: passo 3 "A IA separa a música em alguns minutos e ela abre no palco, com as ferramentas no painel SEPARAÇÃO." e passo 4 "Tudo que você separa fica salvo aqui. Reabra quando quiser: a música abre no palco." (onde o palco novo não aparece, o player do Separador, com as mesmas ferramentas).
- No App (nomes que os testes procuram):
  - `const openSeparationOnStage = (o: StageSeparationOpen) => { ... }`: fecha o Separador, tira o INÍCIO (`setForceShowSplash(false)`), chama `initEngine()` sem `isReady` e guarda `pendingSeparation`. Um efeito com `isReady && !isRestoring && pendingSeparation` faz: `files` nulo, `jumpToSongGated(findSeparationSong(playlist, sep.id))`; senão `loadFiles(dataTransfer.files, meta.name, undefined, undefined, meta.originalKey, meta.bpm, { artist: meta.artist, separation: meta.separation, channelStates: separationChannelStates(stemsToOpen(sep)) })` e, quando o repertório cresce, a música nova vira a atual. **Com a VS tocando ou na pré-contagem, o pulo espera a parada** (P8). Quando a separação vira a atual, a gaveta abre na aba FAIXAS e `justSeparated` fica ligado até outra música virar a atual.
  - `const stageSeparation = useStageSeparation({ song: activeSong, busy: isPlaying || isCountingIn, heardPosition, replaceChannel: (names, file) => activeSong ? replaceAppChannel(activeSong.id, names, file) : Promise.resolve(null) }, { userId, isAdmin, getSeparation, saveSeparation, upload })` com o `useSeparationLibrary()` do App.
  - `slots.separation`: `<SeparationPanel open={isSeparationPanelOpen && !!activeSong?.separation} ... onLimit={() => livre.requestLimit('download')} onOpenCloudSave={() => setIsCloudSaveOpen(true)} onMySeparations={() => setIsSeparatorOpen(true)} ad={livre.isLivre && justSeparated ? <AdSlot placement="separation-done" justSeparated quiet={!isPlaying && !isCountingIn} ... onCta={() => setIsPricingOpen(true)} /> : null} onClose={() => { void stageSeparation.flushPending(); setIsSeparationPanelOpen(false) }} />`; `canDownload = isAdmin || canDownloadStems(userPlan)`, `canCloudSave = isAdmin || planTier(userPlan) !== 'free'`.
  - O `StageDialog` "Publicar na nuvem" com o `CloudSaveForm` (`isCloudSaveOpen`; não fecha publicando); `stageKeyboard` fica desligado com ele aberto.
  - Menu FAIXAS: o `StageTracksMenu` ganha `hasSeparation: boolean`, `onSeparation(): void` e `onMySeparations(): void`; no topo, com a música atual vinda de uma separação, "Separação" (abre a gaveta); sempre, "Minhas separações" (abre o Separador). O palco antigo não muda (lá a separação abre no Separador).
  - O efeito da música atual e o `jumpToSongGated` da T17 passam `stageSongOpenOpts(song, new Date())` junto com a chave.
  - `<SeparatorStudio onClose={...} stageAvailable={wantNewStage} stageSeparationIds={...} onOpenOnStage={openSeparationOnStage} />`.

- [ ] **Step 1: Escrever os testes**

```ts
// separatorHandoff.test.tsx
it('separação nova com o palco disponível baixa as faixas e chama onOpenOnStage com justSeparated', async () => { /* ... */ })
it('separação nova sem registro salvo abre no player do Separador', async () => { /* saveSeparation devolve null */ })
it('sem stageAvailable a separação abre no player do Separador, como hoje', async () => { /* ... */ })
it('separação já no repertório: onOpenOnStage com files nulo e o App só pula', async () => { /* stageSeparationIds com o id */ })
it('erro ao baixar mostra a frase e Tentar de novo, sem chamar onOpenOnStage', async () => { /* fetch rejeita a 2ª faixa */ })
it('Voltar no meio de baixar cancela', async () => { /* ... */ })
it('abrir no palco não grava a separação com faixas vazias', async () => { /* desmontar o Separador: saveSeparation nunca com stems: [] */ })
it('Livre sem vaga: a tela de limite e nada vai pro palco', async () => { /* useLivre falso com canOpenSong false */ })
// appWiring.test.ts
it('o App entrega a separação pro palco pelo loadFiles com a ligação e o mixer salvo', () => { expect(app).toMatch(/separation:\s*meta\.separation/); expect(app).toMatch(/channelStates:\s*separationChannelStates\(/) })
it('com a VS tocando a separação espera a parada pra virar a atual', () => { expect(app).toMatch(/pendingSeparation[\s\S]{0,400}!isPlaying\s*&&\s*!isCountingIn/) })
it('a gaveta SEPARAÇÃO entra na casca e o Livre baixa e salva pela tela de limite download', () => { expect(app).toMatch(/separation:\s*\(?\s*<SeparationPanel/); expect(app).toMatch(/onLimit=\{\(\)\s*=>\s*livre\.requestLimit\('download'\)\}/) })
it('as ferramentas trocam o canal pela troca atômica do motor', () => { expect(app).toMatch(/replaceAppChannel\(activeSong\.id/) })
it('a música atual e o pulo do repertório passam stageSongOpenOpts', () => { expect(app.match(/stageSongOpenOpts\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2) })
it('menu FAIXAS tem Separação e Minhas separações', () => { expect(app).toMatch(/Minhas separações/); expect(app).toMatch(/onSeparation/) })
it('o Separador recebe stageAvailable pelo wantNewStage', () => { expect(app).toMatch(/<SeparatorStudio[\s\S]*?stageAvailable=\{wantNewStage\}/) })
it('nenhum alert, confirm ou prompt novo no App', () => { /* o mesmo número de alert( da T17 da 1b [conferir depois da 1b] */ })
// limitScreen.test.tsx
it('o limite download fala de baixar e de salvar na nuvem', () => { expect(LIMIT_COPY.download.title).toBe('Baixar e salvar na nuvem é do Pro') })
```
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/separator/separatorHandoff.test.tsx src/appWiring.test.ts src/components/livre/limitScreen.test.tsx > $LOGS/t11.txt 2>&1; tail -25 $LOGS/t11.txt`.
- [ ] **Step 3: Implementar** a ligação no Separador e no App; atualizar o FATOS e o DESIGN_SYSTEM. O `AdSlot separation-done` da T19 continua no player de reserva do Separador; no fluxo do palco ele entra no painel.
- [ ] **Step 4: Rodar** a suíte inteira, `npx tsc -b`, `DESKTOP=1 npx vite build > $LOGS/build.txt 2>&1; tail -5 $LOGS/build.txt`, `node scripts/verify-layout/run.mjs > $LOGS/layout.txt 2>&1; tail -8 $LOGS/layout.txt` e `node scripts/verify-pitch/run.mjs > $LOGS/pitch.txt 2>&1; tail -10 $LOGS/pitch.txt`. Esperado: PASS, build sem erro, todos os estados do palco e das páginas aprovados e o verify-pitch inteiro aprovado.
- [ ] **Step 5: Commit**

```bash
git add src/components/separator/separatorHandoff.test.tsx
git commit -m "feat(separador): a musica separada abre no palco, com o painel SEPARACAO e o Separador como reserva [Parte 3 Separador] [T11]" -- src/App.tsx src/components/SeparatorStudio.tsx src/components/livre/limitCopy.ts src/appWiring.test.ts src/components/separator/separatorHandoff.test.tsx src/components/livre/limitScreen.test.tsx PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

---

## Onda 4

### Task 12: Documentação viva e portão final

**Files:**
- Modify: `PLAYBACK_STUDIO_FATOS.md` (consolida as entradas [NÃO PUBLICADO] das T4 a T11 numa entrada só no Histórico, "A música separada abre no palco (Parte 3, parte 2)", com o que mudou, as decisões P1 a P15 que o usuário percebe, os limites conhecidos (a voz guia do palco só soa como canal; arrastar marcação só no Separador de reserva; a separação já no repertório não pega faixa gerada depois em outro aparelho) e a **nota de lançamento** que o @devops copia pro `src/lib/changelog.ts` no bump: "A música separada abre direto no palco, com baixar, salvar na nuvem, voz guia, BPM e SYNC no painel Separação"; "Minhas separações e o Separador com a cara nova"; "Onde o palco novo não aparece, o Separador continua com tudo"), `DESIGN_SYSTEM.md` (2.9 conferida com o código; 1.7 com a cor da família Guia nas marcações)

- [ ] **Step 1: Escrever** as duas atualizações de documento.
- [ ] **Step 2: Portão final**, uma vez só e com `caffeinate -i`: `npx vitest run` (código 0, sem "Errors"; teste de tempo que falhar por carga, rode sozinho e anote o `uptime`), `npx tsc -b`, `npm run typecheck` (os 7 erros antigos conhecidos: diga se continuam 7), `npx eslint` nos arquivos da parte (nenhum erro novo), `DESKTOP=1 npx vite build`, `node scripts/verify-layout/run.mjs` (os estados do palco com `separacao` e `separacao-voz` nos 8 tamanhos e as páginas `separador-inicio`, `separador-opcoes` e `separador-player` em 1024x740, 1280x800, 1920x1080 e 390x844), `node scripts/verify-pitch/run.mjs`, `find api -name '*.ts' -not -path 'api/_lib/*' -not -path 'api/__tests__/*' | wc -l` (12) e `git diff --name-only <base>... | xargs grep -l "$(printf '\xe2\x80\x94')"` (nenhum arquivo). Diga os números.
- [ ] **Step 3: QA do dono antes de publicar** (anotar no FATOS como pendente): separar uma música no computador e no iPad deitado e ela abrir no palco tocando na primeira vez; BAIXAR em MP3 no app de computador; voz guia gerada no painel e tocando no palco; Separador no celular e com o palco Antigo com todas as funções.
- [ ] **Step 4: Commit**

```bash
git commit -m "docs(fatos): musica separada abrindo no palco, consolidado com a nota de lancamento (nao publicado) [Parte 3 Separador] [T12]" -- PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
```

---

## Pedidos pra dona do kit (faixa B)

Peças que estas telas usam e o kit ainda não tem. Até chegarem, a tela usa uma constante de classe local no próprio arquivo (como o `INPUT` de `TextPromptDialog.tsx`) e troca depois; nenhuma peça nova em `src/components/ui/` sai deste plano.

1. **`FilePicker`:** botão (aparência do `Button`) que abre o seletor de arquivo, com `accept`, `multiple`, o nome do arquivo escolhido ao lado e um "Tirar" opcional; teclado (Enter e Espaço abrem); 44 px. Usos: "Carregar áudio" do Separador, "Imagem de capa" do publicar.
2. **`Slider` horizontal:** `input type="range"` no tema (`min`, `max`, `step`, `value`, `onChange`, `aria-valuetext`), trilha `ps-s3`, preenchimento `ps-or`, polegar de 20 px com alvo de 44 px. Usos: volume geral e volume de cada faixa do Separador de reserva.
3. **`ProgressBar`:** `role="progressbar"` com `aria-valuenow`, `aria-valuemin`, `aria-valuemax` e rótulo; trilha `ps-s3`, preenchimento `ps-or`; altura de 6 px. Usos: separando, abrindo no palco, publicando na nuvem.
4. **`Tag`:** selo estático (não é botão) pra metadado: tom, BPM, "N faixas", OFFLINE; `text-ps-micro`, extranegrito, `ps-num` quando é número, cores neutras (as do selo OFFLINE da barra). Usos: "Minhas separações" (e a Biblioteca, no plano das telas).
5. **Toast:** aviso que aparece e some (2,5 s) sem puxar o foco, `role="status"`, posição no topo do conteúdo. Uso: "Tudo salvo na biblioteca". Até lá, `Notice role="status"` com o tempo controlado pela tela.
