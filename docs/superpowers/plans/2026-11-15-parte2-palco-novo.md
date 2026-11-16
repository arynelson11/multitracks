# Parte 2: palco novo + troca de seção agendada (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Revisão:** 2026-11-16, depois da varredura prévia (`.superpowers/sdd/2026-11-15-parte2-palco-novo/preflight.md`, 45 achados) e das decisões do coordenador (`preflight-rulings.md`: R-BASE, R-REFS, R-23, R-24, R-25, R-30, R-31, R-32, R-35, R-DEMAIS) e das Rulings M1-a a M1-d (`progress.md`). Onde este texto e um documento antigo divergem, vale este texto.

**Objetivo:** Entregar o palco novo do mockup v5 (computador e tablet) com a troca de seção musical: armar, contar 1-2-3-4 só no click e entrar no "1" do compasso seguinte, agendado no relógio do áudio; mais saídas de áudio separadas (VS x Click/Guia), compasso lido do acento do click, BPM com decimais, modo EDITAR do palco, protocolo do Modo Ao Vivo, metrônomo automático corrigido e uma chave pra voltar ao palco antigo.

**Arquitetura:** A lógica de tempo vira módulos puros testados (grade da música, compasso pelo acento, plano da transição, intenção armada, linha do tempo, plano de saídas). O som é montado por peças pequenas de Web Audio testadas com um AudioContext falso (vozes com envelope, bipes da contagem, roteador de saídas por papel) e por um agendador "dois relógios": um relógio em Worker decide QUANDO agendar e todo evento audível é marcado em `AudioContext.currentTime`. O palco novo é uma árvore de componentes pequenos em `src/components/stage/`, alimentada por um contrato único (`StageView` + `StageActions` + `StageClock`); o `App.tsx` escolhe entre o palco novo e o antigo por uma decisão só (`useNewStage`), que vale pra tela e pro mecanismo.

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4.2 (tokens `ps-*` da Parte 1) + Web Audio (AudioBufferSourceNode, GainNode, StereoPanner, ChannelMerger/Splitter, setSinkId) + signalsmith-stretch (só com tom diferente de 0) + Electron 42 + Vitest 4/jsdom/Testing Library + harness de áudio no Chrome headless (`scripts/verify-pitch/`) + medição do metrônomo em Node (`scripts/verify-click/`).

**Spec:** `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (seções 4, 5, "Detalhes aprovados no mockup v5", 5d, 5e, 8, 9, 9b e 10). **Visual (fonte da verdade do layout):** `.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` (CSS nas linhas 10 a 362, marcação nas linhas 391 a 534). **Lógica de armar/contar/pular com som:** `palco-desktop-v6.html` na mesma pasta (agendamento 856 a 936, armar e estados 1012 a 1107, mixer 1110 a 1167, teclado 1334 a 1343, bipe `vCount` na 689). **Referências fora do git (R-REFS):** `.superpowers/sdd/2026-11-15-parte2-palco-novo/refs/metronomo-auto-investigacao.md` (relatório do metrônomo automático) e `.superpowers/sdd/2026-11-15-parte2-palco-novo/refs/parte1-progress.md` (Rulings e PASSO DE JUNÇÃO da Parte 1).

## Global Constraints

- Tudo em português do Brasil. Nenhum travessão (caractere Unicode U+2014) em texto de interface, comentário novo, doc ou commit. Nos testes, `const TRAVESSAO = String.fromCharCode(0x2014)` (nunca o caractere no código). Texto de interface em português; ficam como no mockup aprovado só estes rótulos: LOOP, CLICK, PAD, HOST, ONLINE, OFFLINE, SAMPLES, LOOPS, FADE, AUTO, Synth Bass, Backing, Shaker. Teste de "sem inglês" procura uma lista fechada de palavras proibidas, sem diferenciar caixa: `next`, `play`, `cancel`, `start`, `repeat`, `section`, `edit`, `settings`, `upgrade`.
- Nenhum texto encostando na borda ou cortado (pedido explícito do dono). Botões com largura que acompanha o texto, nunca largura fixa com texto dentro. O palco novo passa no verificador da T20 em 1024x768, 1280x760, 1280x800, 1440x900 e 1920x1080.
- Alvos de toque de pelo menos 44px. Única exceção: M/S do mixer (~36x32px com 14 canais em 1280px, aprovado no mockup v5), marcados com `data-touch-exception="ms"`.
- Código de cores com um significado só: laranja `#FF6B35` (`ps-or`) = ligado; branco `#F5F5F7` (`ps-arm`) = armado; cor da seção = seção; âmbar `#fbbf24` (`ps-alert`) = alerta.
- Identidade: dark `#121214`, laranja `#FF6B35`, bone `#E8E8EC`, musgo `#5B6B47`. Seções (de `SECTION_SHORTCUTS`): Intro `#3b82f6`, Verso `#10b981`, Pré `#f59e0b`, Refrão `#FF6B35`, Ponte `#8b5cf6`, Final `#ec4899`.
- Inter + JetBrains Mono com números de largura fixa (`ps-num`). Ícones em SVG (`src/components/stage/icons.tsx`), nunca caractere que vira emoji no Mac.
- Componentes novos usam só tokens `ps-*` (inclusive as animações do armado, criadas na T1) e peças de `src/components/ui/`. Cor literal só a que vem de dado (cor da seção, cor da família). Token novo só com prefixo `ps-`.
- Desktop roda de `file://`: nada de caminho absoluto `/` pra asset; API só via `apiUrl()`; Worker só por Blob URL.
- **Relógio do áudio manda.** Todo evento audível de tempo musical (início e fim de voz, cruzamento, bipe de contagem, pré-contagem, calar a guia, restaurar o principal, rampa do FADE) é marcado com tempo do `AudioContext`. `setTimeout`, `setInterval` e `requestAnimationFrame` só decidem QUANDO agendar ou atualizam a tela. **Exceção escrita (R-32):** troca de música (AUTO entra a próxima 5 s depois do fim; "próxima" com a música tocando espera 1,5 s de fade) não é evento de tempo musical e continua por timer.
- **Contagem e guia nunca na PA.** A contagem entra só pela entrada do canal de Click (ou, sem canal de click, por um atraso próprio no barramento do Click) e sai onde o Click sai. Em "Click e Guia separados" e em "4 ou mais saídas", nenhum caminho dos barramentos Click e Guia chega a uma saída da VS (testado com busca no grafo, não só ligação direta).
- Desempenho: nenhum worklet novo; no máximo um worklet de tom por canal (reserva por id da v1.4.14) e só com tom diferente de 0. Nós nativos permitidos: 1 envelope por voz, no máximo 2 vozes vivas por canal (só durante um cruzamento), 3 barramentos por papel, o roteador e um atraso de contagem. Nada é criado por quadro de tela.
- Click e Guia continuam tocando quando outro canal está em Solo; o M deles continua valendo (spec 9b, Parte 1).
- Manual vence automático: papel manual do canal, compasso escolhido no modo EDITAR, nome do usuário.
- Dados (R-30): compasso e grade corrigidos pelo usuário ficam no repertório dele (`SavedSong`) e no aparelho. Na nuvem (`songs.bpm_exact`, `songs.time_signature`) grava quem hoje pode editar BPM e tom daquela música: o admin nas músicas da biblioteca e o dono na música privada. O índice do cache offline só muda por `updateCachedSongMeta`.
- Planos (`src/lib/plans.ts`): seções e loop infinito são dos pagos (`canUseSections`); banda controlando seções é do Studio (`canBandControlSections`); click gerado é dos pagos (`canUseBpmDetection`). No Livre a botoeira mostra o convite pra marcar seções.
- Nenhuma função existente some: o palco antigo continua inteiro atrás da chave; MARCAR e EDITAR seções saem do palco e vão pro modo EDITAR; lista do repertório e Anotações vão pro painel REPERTÓRIOS.
- Toda função async que faz `setIsLoading(true)` tem `try/finally`.
- Vocabulário: "multitracks", "faixas", "separação de faixas" (não "stems"); "VS" pro playback que vai pra PA.
- **Testes:** teste de DOM começa com `// @vitest-environment jsdom` e chama `afterEach(cleanup)`; não há `jest-dom` nem `user-event` (usar `fireEvent` e asserções nativas). Ajudantes em `src/test/*.ts` não usam API do Node (`node:fs` etc.): `tsconfig.app.json` checa `src/test`; leitura de arquivo fica dentro do próprio `*.test.ts`. ESLint `react-refresh/only-export-components` é erro: arquivo `.tsx` exporta só componentes; função ou array exportado vai pra um `.ts` ao lado. `react-hooks/refs` é erro: ref não é escrito durante a renderização (usar `useLayoutEffect`). TypeScript com `erasableSyntaxOnly`: sem propriedade declarada no construtor de classe.
- Branch `feat/palco-parte2` no clone `~/playback-studio-work/parte2` (fora do iCloud); commits convencionais com `[Parte 2] [T<N>]` ou `[M<N>]`; sempre `git add <arquivo>` por nome, nunca `git add -A`; `git push` e tag só pelo @devops; nada vai pra produção sem o dono ver e aprovar; lançamento web + desktop juntos.
- Toolchain: Node 24 (`source ~/.nvm/nvm.sh && nvm use 24 >/dev/null`), saída de comando redirecionada pra arquivo (`LOGS="$(mktemp -d)"`). Portão de eslint: 0 erros nos arquivos novos e nenhum erro novo nos antigos (Ruling 1 da Parte 1).
- `PLAYBACK_STUDIO_FATOS.md` acompanha cada mudança visível: cada tarefa com efeito pro usuário termina com uma "Linha pro FATOS" no relatório, e o coordenador aplica as linhas no portão da onda (um escritor só). A T31 consolida.

## Review Focus

Condições que mais machucam um operador ao vivo diante do público, cada uma com o teste que a prende na tarefa dona do código:

1. **Contagem ou guia vazando pra PA** em qualquer modo de saída: placa de 2 canais com "4 ou mais saídas" escolhido, mapa com Click em cima da VS, papel do canal trocado na mão no meio da música, música sem canal de click. Esperado: nada do Click/Guia em saída da VS. Testes: T6 `nenhum plano separado põe click ou guia do lado ou na saída da VS`, T12 `nenhum caminho dos barramentos click e guia chega a uma saída da VS` (com `reaches`), T25 `em separados o pan efetivo é o do papel, nunca o do knob` e `a pré-contagem nunca liga no destino direto`, T28 `sem canal de click a contagem vai pro barramento do click`, T30 cenário `SPLIT`.
2. **Ministro muda de ideia durante a contagem** (cancelar ou trocar o alvo no último compasso). Esperado: a contagem para na hora, a seção segue sem emenda, a guia volta; trocar o alvo mantém a contagem e o "1"; trocar pro loop ∞ da própria seção cancela a contagem. Testes: T17 `cancelar depois de agendado para os bipes, devolve a guia e as vozes antigas`, `trocar o alvo durante a contagem troca só as vozes novas`, `trocar pro loop infinito da própria seção cancela os bipes e devolve a guia`; T30 `CANCEL`.
3. **Armar em cima da hora, pausar ou buscar com pulo armado.** Esperado: o pulo vai pro fim da seção que estiver tocando depois da folga mínima, nunca duas levas de som; pausa e busca re-planejam. Testes: T11 `armar a menos da folga mínima mira o fim da seção seguinte`, T5 `conversão pro contexto usa o segmento vigente, não o futuro`, T17 `reset cancela o agendado e o próximo tick re-planeja na linha do tempo nova`, T28 `pausar com pulo agendado não deixa voz nem bipe vivo`.
4. **Pulo com tom diferente de 0** (worklets ligados, compensação de latência). Esperado: cai no "1" com o mesmo erro do tom 0, sem silêncio e sem worklet novo; guia e contagem no tempo ouvido. Testes: T7 `voz nova entra na mesma entrada do canal e só cria fonte e ganho`, T17 `calar a guia usa o tempo ouvido (soma a latência da entrada)`, T26 `tom +2: 10 buscas não criam worklet novo`, T26 `sem canal de click e com tom +2 a contagem passa pelo atraso L`, T30 `JUMP` com `pitch=2`.
5. **App atrás de outra janela no culto** (Holyrics, OBS, projetor). Esperado: pulo agendado e fim de música no tempo. Testes: T5 `o relógio usa Worker e não setInterval da janela`, T29 `electron/main.ts liga backgroundThrottling: false`, item 7 do QA do dono.

---

## Pré-requisitos

- [ ] **P1. Base v1.4.16 (R-BASE).** A Parte 2 parte da v1.4.16 publicada (ajustes do tom encaixados na Parte 1). Quando ela sair: `git fetch origin && git rebase <tag v1.4.16> feat/palco-parte2` no clone `~/playback-studio-work/parte2` (na branch só estão o plano e a M1). Conferir `git log --oneline v1.4.16..feat/palco-parte2` (só commits de docs do plano e o `3fdb062` da M1 rebaseado) e rodar o portão completo (a equivalência da M1 continua 18/18). Não existe mais Portão J: as ondas são definidas só por arquivo e interface.
  - Se a v1.4.16 atrasar, podem começar sobre a b53a95c (v1.4.15) as tarefas que não tocam os arquivos da v1.4.16 (`useAudioEngine.ts`, `pitchRules.ts`, `useAudioEngine.persistence.test.ts`, `useAudioEngine.detectors.test.ts`, `channelRoles.test.ts`, `scripts/verify-pitch/*`, `PLAYBACK_STUDIO_FATOS.md`), e o rebase continua limpo. Esperam a v1.4.16: T13, T21, T22, T25 a T28, T30 e T31.
- [ ] **P2. Ambiente:** Node 24 e `npm ci` no clone (já feitos); nada roda no repo do iCloud.
- [ ] **P3. Referências (R-REFS):** os briefs citam `.superpowers/sdd/2026-11-15-parte2-palco-novo/refs/` (não commitado).
- [ ] **P4. Paleta de famílias aprovada pelo dono** (condição da Parte 1, Ruling 9 + M8). Só a T21 depende dela; se não vier até a Onda 1, a T21 vai pra qualquer onda seguinte (nenhuma outra tarefa depois da M5 mexe em `channelNames.ts`).
- [x] **M1 feita** (`3fdb062`, revisada): detector de tempo em etapas, sintéticos e sonda do relatório no Vitest.

## Ondas, dependências e paralelismo

Duas tarefas da mesma onda nunca tocam o mesmo arquivo (conferido pela varredura). Arquivos com mais de um dono, e a ordem: `beatGrid.ts` (M2, depois M4); `beatGrid.equivalence.test.ts` (M2, M4, M3, M6, uma por onda, só se mudar um caso); `channelNames.ts` e o teste dele (M5, depois T21); `SectionBar.tsx` (T9, depois T16); `types.ts` (T24, depois T22); `useAudioEngine.ts` (T25, T26, T27, T28, nessa ordem); `useAudioEngine.detectors.test.ts` (T25, depois T26); `scripts/verify-pitch/www/harness.jsx` (T25 só se preciso, depois T30); componentes de `stage/` e `settings/` (cada um da sua tarefa, depois T20).

| Onda | Tarefas | Depende de |
|---|---|---|
| 0 | T1 Fundação · M2 Tempo x contratempo, kit somado e confiança · M5 Faixas de análise e nomes de bateria · T23 Nuvem: BPM decimal e compasso · T24 Ao Vivo: protocolo | T1, T23, T24, M5: base. M2: M1 |
| 1 | T2 Grade · T3 Compasso pelo acento · T4 Intenção armada · T5 Linha do tempo e relógio · T6 Plano de saídas · T7 Vozes e contagem · T8 Transporte e PRÓXIMA · M4 Andamento e `preferBpm` · T21 Paleta | T2 a T8: T1. M4: M2. T21: P4, M5 |
| 2 | T9 Onda com seções · T10 Botoeira · T11 Plano da transição · T12 Roteador de saídas · T22 Repertório v3 · M3 O "1" do compasso | T9, T10: T1. T11: T2. T12: T6. T22: T2, T24. M3: M2, M4 |
| 3 | T13 Faixa do meio · T14 Mixer novo · T15 Barra do app, REPERTÓRIOS e pads · T16 Modo EDITAR · T25 Motor: saídas por papel · M6 Gerador com ataque | T13 a T15: T1. T16: T2, T9. T25: T6, T12. M6: M3 |
| 4 | T17 Agendador · T18 Casca e atalhos · T19 Configurações de saída e chave · T26 Motor: vozes, linha do tempo e pré-contagem · M7 Metrônomo automático no modal | T17: T4, T5, T7, T11. T18: T8 a T10, T13 a T16. T19: T6. T26: T25, T5, T7. M7: M2 a M6 |
| 5 | T20 Verificador de texto cortado · T27 Motor: grade pela faixa de click e click que falta | T20: T18, T19. T27: T26, T2, T3, T22, T23, M7 |
| 6 | T28 Motor: pulo agendado e modo antigo | T27, T17 |
| 7 | T29 App: palco novo ligado · T30 Harness | T29: T18, T19, T20, T23, T24, T28, M7. T30: T28 |
| 8 | T31 Documentação viva | todas |

37 tarefas a executar (a M1 já está feita) em 9 ondas. Caminho crítico: T1, T6, T12, T25, T26, T27, T28, T29, T31.

**Regras de execução paralela (iguais às da Parte 1):**
- Cada agente só toca os arquivos do bloco **Files** da sua tarefa. Se precisar de outro, para e avisa o coordenador.
- Checkout compartilhado no clone. Commits pequenos, por nome de arquivo. Se aparecer `.git/index.lock`, esperar e repetir; nunca apagar o lock de outro agente.
- Cada agente roda só os testes da própria tarefa. `tsc`, eslint e build completos são do **portão da onda** (`vitest run`, `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, eslint nos arquivos da onda, `DESKTOP=1 vite build`). Da Onda 3 em diante o portão roda também `node scripts/verify-pitch/run.mjs`; da Onda 5 em diante, `node scripts/verify-layout/run.mjs`.
- Todo comando de tarefa começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd ~/playback-studio-work/parte2`.

## Arquitetura (decisões que valem pra várias tarefas)

### A. Pulo agendado no relógio do áudio

- **Voz** = uma `AudioBufferSourceNode` + um envelope `GainNode` próprio, ligado na **entrada do canal**: o worklet de tom do canal (tom diferente de 0), o `DelayNode` de compensação (click/guia com a música transposta) ou o `StereoPannerNode` (tom 0). O resto da cadeia do canal (panner, fader, barramento) não muda. O pulo nunca cria worklet nem duplica cadeia.
- **Troca** no instante `T` (o "1" do compasso seguinte, em tempo do contexto): as vozes novas começam em `T - FADE` com offset `alvo - FADE`, envelope de 0 a 1 em `[T - FADE, T]`; as antigas descem de 1 a 0 no mesmo trecho e ficam mudas até o agendador soltá-las (`T + FADE + 30 ms`). `FADE = 0,005 s`. Com o alvo em 0:00 a voz nova começa em `T` com envelope 1.
- **Contagem**: bipes sintetizados (receita `vCount` do v6: 1319 Hz no tempo 1 e 988 Hz nos outros, triângulo + quadrada no dobro a 0,1, ataque 4 ms, sustenta até 75 ms, cai até 190 ms, passa-baixa 5200 Hz, picos 0,85 e 0,68) nos tempos do último compasso, ancorados em `T` (`T - k * passo`), ligados na entrada do canal de click (passam pelo pan, fader e M dele). O click do arquivo continua tocando por baixo. Armou tarde: sai só o que resta, com o número real do tempo. **Sem canal de click (R-35):** os bipes vão por um `DelayNode` próprio (criado uma vez) no barramento do Click, com o mesmo atraso `L` da compensação do tom (0 no tom 0), pra sair no tempo da música transposta.
- **Guia calada no último compasso (spec 9b; R-31, ligada, decisão pro dono):** atrás da constante `GUIDE_MUTE_ON_JUMP = true` (em `src/lib/sectionTransition.ts`). Automação no ganho do barramento da Guia (não no fader), de `inícioDaContagem + L` até `T + L`, rampas de 10 ms, `L` = latência da entrada da guia.
- **Dois relógios**: Worker (Blob URL) com tique a cada 25 ms; em cada tique o agendador recalcula o plano. Nada é agendado antes de faltar `HORIZON = 0,3 s` pro primeiro evento do pulo. Depois de agendado, cancelar vale até `T - 0,03 s`; depois disso o pulo acontece e o cancelamento vale logo após. Trocar o alvo agendado refaz só as vozes novas; se o plano novo não tem contagem (loop ∞ da própria seção), cancela os bipes e devolve a guia.
- **Folga mínima**: o plano é calculado em `agora + MIN_LEAD` (`MIN_LEAD = 0,05 s`). Armar a menos disso do fim da seção mira o fim da seção seguinte.
- **Linha do tempo**: a posição sai de segmentos `{ ctxStart, songStart }`; o pulo agendado acrescenta um segmento em `T`. A conversão música → contexto usa o segmento vigente num instante de referência (`ctxTimeOf(segs, songTime, atCtx)`), nunca o segmento futuro. A tela usa o tempo **ouvido**: `ctx.currentTime - outputLatency - L`.
- **Intenção armada** `{ target, plays }`: tocar numa seção tocando arma `{ i, 1 }`; tocar na atual = REPETE; REPETIR N = `{ atual, N }`; LOOP e ∞ = `{ atual, 'infinite' }`; tocar na armada cancela; tocar em outra troca o alvo; ao pousar, `plays` desce 1 (∞ continua). Parado, tocar numa seção leva a VS pro início dela e desarma. A banda pelo celular continua com o sentido antigo do "repetir N" (ver T28).
- **FADE (R-32)**: com FADE e a música tocando, o principal ganha uma rampa única agendada de `duração - 5 s` até a duração; pausa, busca, pulo e intenção armada cancelam a rampa (com intenção armada o FADE não começa; se já começou, o pulo devolve o ganho em `T`). O fim da seção final é `min(barra encaixada, duração)`. O fim da música é visto no tique do Worker.
- **Palco antigo**: com `useNewStage` falso (R-25) o motor usa o mecanismo antigo de loop/salto (rAF + `seekTo`, sem contagem), como na v1.4.16. Saídas por papel e pré-contagem nova valem nos dois.

### B. Grade e compasso

- **A grade do palco vem só da faixa de click** (sinal limpo e é o que a banda ouve). Relatório do metrônomo (`refs/metronomo-auto-investigacao.md`): o `detectBeatGrid` sobre a bateria acerta o tempo quando trava (0,2 a 6,8 ms), mas erra a fase em síncope e contratempo (285 a 394 ms), o "1" em 23 de 54 cenários 4/4, sai pela metade em 160/176 BPM, confunde 6/8 e a confiança não separa pulso de ruído. O pulo e a contagem nunca dependem do `detectBeatGrid` sobre a bateria.
- **Grade da música** `SongGrid = { bpm, firstDownbeat, signature, countEvery, source, meterSource }`, `bpm` em pulsos do click por minuto, com decimais. BPM e fase (`source`): `click` (lido na faixa de click, original ou gerada) > `bpm` (BPM salvo, sem fase: a contagem fica ancorada no "1" de destino). Não há ajuste manual de BPM ou fase. Compasso (`meterSource`): `manual` (modo EDITAR) > `salvo` (`time_signature` da nuvem) > `acento` (lido no click) > `padrao` (4/4). O compasso manual é independente: "Ler o click de novo" relê BPM e fase e mantém o compasso manual.
- **Fallback explícito, nunca silencioso** (`gridWarning`): sem grade, "SEM GRADE" (pulo na marca, sem contagem); só BPM salvo, "SEM CLICK LIDO"; compasso assumido, "4/4 ASSUMIDO". Em âmbar na célula de tempo, com a explicação no `title`; o aviso PRÓXIMA mostra o mesmo texto quando há pulo armado.
- **Compasso pelo acento** (`analyzeClickTrack`, T3): ataques do click, período e fase por mínimos quadrados, pico e brilho por ataque, 2-médias, `m` em 3, 4, 5, 6, 7, 12 com a regra 80%/20% em pelo menos 4 compassos; sem acento: `pulsesPerBar null` (4/4 assumido). `m` vira `3/4`, `4/4`, `5/4`, `6/8`, `7/8` ou `12/8` (`TimeSignature` = `TimeSignatureType` de `AudioAnalyzer.ts`).
- **Encaixe no compasso**: seções salvas não são regravadas; na hora do pulo o início é encaixado na barra mais perto (fase conhecida e até 1/4 de compasso); seções novas (MARCAR) já nascem encaixadas; marca em 0:00 nunca mexe.
- **Contagem**: `countEvery` 1 conta todos os pulsos; 3 conta de 3 em 3 (6/8 conta 2, 12/8 conta 4).
- **Música sem click**: gerado pelo metrônomo automático corrigido (Grupo M, `planAutoClick`), só nos planos pagos, só com confiança acima do corte calibrado, e só ao carregar a música (decisão 10). Abaixo do corte não gera (nunca o caminho da v1.4.9) e vale o fallback acima.

### B2. Grupo M: metrônomo automático corrigido

- Corrige as causas 2 a 8 do relatório e serve ao "Gerar click IA" do Metrônomo (M7) e ao click que falta no palco (T27), pelo mesmo helper (`planAutoClick`).
- A M1 (feita) dividiu `beatGrid.ts` em etapas em `src/lib/tempo/` sem mudar o resultado (18/18 e 528 comparações bit a bit) e portou `synth.mjs` e a sonda do `harness.mjs`. Assinaturas reais na T M1 abaixo. Cada tarefa seguinte troca uma etapa e transforma linhas da tabela do relatório em teste.
- `detectBeatGrid` (Separador) continua com a mesma assinatura e o mesmo sentido de `nearBpm` (refino rígido de ±0,8%). A preferência suave pela oitava do BPM da música é a opção nova `preferBpm` (M4). O Separador ganha as correções de fase, confiança e "1" sem mudar de contrato (item do QA).
- Casos do relatório com nome único em `src/test/tempoCases.ts` (M2), separados em grupo de calibração e grupo de validação do corte de confiança.

### C. Saídas independentes (5e, R-23, R-24)

- Cada canal liga o fader (`gainNode`) no **barramento do papel** (`click`, `guide`, `normal`) pelo `resolveChannelRole` da Parte 1 (papel manual vence). Barramentos → roteador → principal (`master`) → mudo geral → `destination`.
- **Nível igual à v1.4.15 (R-24).** O operador não pode ter de mexer no ganho da mesa depois da atualização.
  - `stereo` "Tudo junto": como a v1.4.15 sem pan automático; o pan do knob vale.
  - `split2` "Click e Guia separados": como a v1.4.15 com o pan automático, por construção: o motor força o pan EFETIVO pelo papel (Click e Guia no lado do ouvido, `-1`, ou `+1` com o lado trocado; o resto no lado da VS) e ignora o knob. No `StereoPannerNode`, pan ±1 deixa o outro lado em silêncio exato e põe a faixa mono inteira, ou a estéreo como L+R, no lado escolhido: o mesmo nível da v1.4.15. Sem merger.
  - `multi` "4 ou mais saídas": `destination.channelCount` = canais do aparelho, `channelInterpretation 'discrete'`, `ChannelMerger(N)`; VS estéreo num par (padrão 1/2) com o pan do knob, por um `ChannelSplitter(2)`; Click e Guia com pan efetivo `-1` e só o lado esquerdo de um `ChannelSplitter` de cada barramento vai pra saída própria (padrão 3 e 4): mesmo nível do ouvido da v1.4.15.
- **Migração (R-23):** na primeira carga, quem tinha o pan automático ligado (padrão) passa a `split2` com Click/Guia na saída 1; os pans ±1 que o pan automático gravou nos canais voltam a 0 uma vez; o pan automático fica desligado e o interruptor dele só aparece em "Tudo junto". A aba "Buses" das Configurações (que só mexia no pan) só aparece em "Tudo junto".
- Trocar de modo ou de aparelho religa só o roteador e os pans efetivos, sem recriar canais. Trocar o papel de um canal religa só o fader dele (`gainNode.disconnect(barramentoAntigo)`, pra não cortar o medidor do App).
- **Web**: Chrome/Edge têm `AudioContext.setSinkId` e `destination.maxChannelCount` real depois dele. **Electron 42**: o mesmo. **Limites conhecidos**: Safari/iPad sem `setSinkId` no AudioContext e com 2 canais (só `stereo` e `split2`, na saída do sistema); Firefox sem `setSinkId` no AudioContext; no Windows, placa multicanal que aparece como vários aparelhos estéreo não dá "4 ou mais" (cai em `split2`, com aviso); sem ASIO. Pads e samples usam outro AudioContext e saem na saída padrão do sistema, nos dois lados (fora deste plano).

### D. Palco novo e chave (R-25)

- Componentes em `src/components/stage/`, um por peça do mockup, alimentados pelo contrato da T1. Valores de cada quadro (playhead, tempo, bolinhas, VU, anel do Play) são lidos por `useFrame` dentro da peça. Contas de contagem e de texto de espera ficam num helper puro da T1, usado por todas as peças.
- **Uma decisão só**: `useNewStage = settings.stageVersion === 'novo' && tela >= 1024x600`. Ela escolhe a tela E o mecanismo de pulo (o motor recebe `stageMode`), e os comandos da banda passam pelos adaptadores que a respeitam. A escolha só muda com a música parada: redimensionar ou trocar a chave tocando fica valendo na próxima parada.
- A chave `settings.stageVersion: 'novo' | 'antigo'` (padrão `'novo'`) fica em CONFIG > Geral, primeira opção, nos dois palcos.
- Abaixo de 1024x600: palco antigo inteiro (tela e mecanismo). Entre 1024 e 1279px: mesma ordem de faixas, capa menor e mixer rolando de lado com canais inteiros; o nome do repertório some abaixo de 1700px (v6 linha 244). Verificado na T20.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/lib/stageContracts.ts`, `src/lib/transitionView.ts`, `src/components/stage/icons.tsx`, `src/components/stage/iconNames.ts`, `src/components/stage/useFrame.ts`, `src/test/fakeAudio.ts`, `src/styles/ps-tokens.css` (+ teste) | Contratos, helpers de contagem e espera, ícones, laço de quadro, AudioContext falso, tokens das animações do armado | T1 |
| `src/lib/songGrid.ts` | Grade: barras, encaixe, seções, avisos | T2 |
| `src/lib/clickMeter.ts` | Compasso e BPM pelo acento do click | T3 |
| `src/lib/sectionArm.ts` | Intenção armada | T4 |
| `src/lib/playTimeline.ts`, `src/audio/schedulerClock.ts` | Linha do tempo; relógio em Worker | T5 |
| `src/lib/outputPlan.ts` | Plano de saídas e pan efetivo por papel | T6 |
| `src/audio/voices.ts`, `src/audio/countTones.ts` | Vozes com envelope; bipes da contagem | T7 |
| `src/components/stage/TransportBar.tsx`, `NextPill.tsx`, `PlayButton.tsx` | Transporte e aviso PRÓXIMA | T8 |
| `src/components/stage/WaveformSections.tsx`, `src/components/stage/wavePeaks.ts`, `src/components/SectionBar.tsx` (usa o `computePeaks` novo) | Onda grande | T9 |
| `src/components/stage/SectionPads.tsx`, `src/components/stage/sectionPadMeta.ts` | Botoeira | T10 |
| `src/lib/sectionTransition.ts` | Plano da troca e `GUIDE_MUTE_ON_JUMP` | T11 |
| `src/audio/outputGraph.ts` | Barramentos por papel e roteador | T12 |
| `src/components/stage/MidStrip.tsx` e células, `src/lib/keyNames.ts`, `src/lib/pitchRules.ts` (`parseKey`) | Faixa do meio, nomes de tom | T13 |
| `src/components/stage/StageMixer.tsx`, `ChannelStrip.tsx`, `PanKnob.tsx`, `FaderVU.tsx`, `MasterStrip.tsx`, `src/lib/faderScale.ts` | Mixer novo | T14 |
| `src/components/stage/StageAppBar.tsx`, `RepertoirePanel.tsx`, `PadPanel.tsx`, `TwoTapTrashButton.tsx` | Barra do app, REPERTÓRIOS, pads, lixeira genérica | T15 |
| `src/lib/sectionEdit.ts`, `src/lib/sectionTypes.ts`, `src/components/SectionBar.tsx` (reexporta), `src/components/stage/SectionEditBar.tsx`, `MeterEditor.tsx` | Modo EDITAR | T16 |
| `src/audio/sectionScheduler.ts` | Agendador | T17 |
| `src/components/stage/StageShell.tsx`, `useStageShortcuts.ts`, `stageKeys.ts`, `useStageViewport.ts` | Casca, atalhos, tela | T18 |
| `src/components/settings/AudioOutputsSection.tsx`, `StageVersionSetting.tsx` | Configurações de saída e chave | T19 |
| `scripts/verify-layout/*` | Verificador de texto cortado e toque | T20 |
| `src/lib/channelNames.ts` (`FAMILY_COLOR`), `src/lib/channelRoles.ts` (comentário) | Paleta | T21 |
| `src/lib/repertoireSchema.ts`, `src/types.ts` (`Song`), `src/hooks/useAudioEngine.persistence.test.ts` | Repertório v3 | T22 |
| `db/supabase-bpm-exact-migration.sql`, `api/insert-song.ts`, `src/lib/cloudBpm.ts`, `src/lib/supabase.ts`, `src/hooks/useCloudLibrary.ts`, `src/lib/offlineCache.ts`, `src/components/LibraryModal.tsx`, `src/components/AdminModal.tsx` | BPM decimal e compasso na nuvem | T23 |
| `src/hooks/useLiveSync.ts`, `src/components/FollowerView.tsx`, `src/types.ts` (`WsMessage`) | Protocolo do Ao Vivo | T24 |
| `src/hooks/useAudioEngine.ts` | Saídas (25); vozes, linha do tempo, pré-contagem (26); grade e click que falta (27); pulo agendado e modo antigo (28) | 25 a 28 |
| `src/contexts/SettingsContext.tsx` | `outputs`, `stageVersion`, migração | T25 |
| `src/hooks/useAudioEngine.detectors.test.ts` | Guarda de forma do motor | T25, T26 |
| `src/App.tsx`, `src/components/SettingsModal.tsx`, `electron/main.ts`, `src/components/stage/buildStageView.ts` | Palco ligado, chave, Ao Vivo do host, tour | T29 |
| `scripts/verify-pitch/*` | Cenários JUMP, CANCEL, SPLIT, PRECOUNT | T30 |
| `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` | Documentação viva | T31 |
| `src/lib/beatGrid.ts`, `src/lib/tempo/*`, `src/test/synthMusic.ts`, `src/test/clickProbe.ts`, `src/test/legacyBeatGrid.ts`, `scripts/verify-click/*` | Detector em etapas e sintéticos | M1 (feita); M2 e M4 mexem em `beatGrid.ts` |
| `src/test/tempoCases.ts` | Catálogo nomeado dos casos do relatório | M2 |
| `src/lib/tempoSources.ts`, `src/lib/channelNames.ts` (peças da bateria, `nameTokens`) | Faixas de análise | M5 |
| `src/lib/clickAttack.ts`, `src/lib/AudioAnalyzer.ts`, `src/test/clickShims.ts` | Ataque das amostras; calços do gerador | M6 |
| `src/lib/autoClick.ts`, `src/components/MetronomeModal.tsx` | Fluxo único do click automático; modal | M7 |

## Decisões tomadas neste plano (o dono deve conferir)

1. O pulo troca as fontes de áudio num instante marcado no relógio do áudio, com cruzamento de 5 ms que termina exatamente no "1"; o agendamento acontece 0,3 s antes do primeiro som do pulo, e cancelar vale até 30 ms antes do "1".
2. A contagem é um bipe sintetizado (o do protótipo v6) tocando por cima do click do arquivo, dentro do canal Click (respeita fader, pan e M). O v6 aprovado trocava o click pelo bipe; aqui o click não é calado, pra banda nunca ficar sem click se a contagem falhar.
3. LOOP e ∞ repetem sem contagem e sem calar a guia (como no v6); REPETIR N conta a cada volta (spec 4.6).
4. **Guia calada no último compasso antes do pulo (spec 9b, R-31): ligada**, atrás da constante `GUIDE_MUTE_ON_JUMP = true`, pra desligar sem mexer em três tarefas.
5. A grade do palco (BPM com decimais, onde cai o 1, compasso) vem só da faixa de click. Compasso: o do modo EDITAR > o salvo na nuvem > o acento > 4/4. Sem click lido vale o BPM salvo; sem nada, o pulo cai na marca sem contagem. Cada fallback aparece em âmbar ("SEM CLICK LIDO", "4/4 ASSUMIDO", "SEM GRADE").
6. Seções já salvas não são regravadas: o encaixe no compasso é feito na hora do pulo (até 1/4 de compasso); seções novas nascem encaixadas; marca em 0:00 nunca é mexida.
7. **Saídas (R-24, R-23):** 3 modos. Em "Click e Guia separados" o nível de cada saída é igual ao da v1.4.15 com o pan automático (faixa mono igual; estéreo igual à soma L+R), e "Tudo junto" é igual à v1.4.15. Quem usava o pan automático entra em "separados" com Click/Guia na saída 1; os pans ±1 gravados pelo pan automático voltam a 0 uma vez; o pan automático e a aba Buses só aparecem em "Tudo junto". Pads e samples seguem na saída padrão do sistema (limite conhecido).
8. **Chave e tela (R-25):** "Palco: Novo | Antigo" em CONFIG > Geral, padrão Novo. O palco novo (tela e mecanismo) vale com a chave em Novo e a tela com pelo menos 1024x600; abaixo disso, o palco antigo inteiro. A troca só vale com a música parada.
9. **Nuvem (R-30):** BPM com decimais em `songs.bpm_exact` (o `bpm` inteiro fica pros apps antigos) e compasso em `songs.time_signature`; grava quem hoje edita BPM e tom daquela música (admin na biblioteca, dono na música privada). A migration roda antes de lançar.
10. **Click que falta (diverge do spec 4.5, "sempre existe click"):** gerado só nos planos pagos (é o "BPM pela IA"), só com o metrônomo corrigido acima do corte de confiança, e só ao carregar a música (nova, ou uma já salva quando fica ativa parada). Sem geração em lote em segundo plano (pesa na memória do iPad). O caminho da v1.4.9 (click colado em 0:00) sai do uso.
11. Fader com +6 dB no topo e 0 dB a 3/4 do curso (mockup v5; hoje o máximo é +1,6 dB); o M do PRINCIPAL é um mudo geral; sem atalho de PADS repetido na coluna do mixer (spec 5 pedia; o v5 aprovado não tem).
12. Parado, tocar numa seção (ou SEÇÃO ◂ ▸, ou ←/→) leva a VS pro início dela e desarma; tocando, arma. A pré-contagem passa a usar o BPM da música (antes 100 fixo) e sai pela saída do Click.
13. Bolinhas, número grande e playhead seguem o tempo OUVIDO (descontam a latência de saída e a do tom).
14. Metrônomo automático: mostra o resultado antes de inserir (BPM, faixas usadas, ½× e 2×), "Deslocar meio tempo" quando tempo e contratempo ficam parecidos, "Mover o 1", BPM da música como referência suave, compasso lembrado por música e aviso âmbar com confiança baixa (aí não insere). O Separador ganha as mesmas correções sem mudar o BPM que ele força.
15. Reconhecimento de nomes ampliado: BUMBO, CAIXA, CHIMBAL e BATERA viram Bateria; SHAKER e LOOP sozinho viram Percussão; BAJO vira Baixo. Muda rótulo, cor e ordem desses canais.
16. A banda pelo celular mantém o sentido antigo do "repetir N" numa seção diferente da atual (vai pra ela e repete N vezes, N+1 passagens); na seção atual, N voltas.
17. FADE vira uma rampa única agendada no relógio do áudio; a troca de música (AUTO e "próxima") continua por timer, por não ser evento de tempo musical (R-32).
18. A régua de arrastar pra posicionar fica embaixo da onda (mockup v5), não no topo (texto do spec 9b).

---

### Tarefa 1: Fundação: contratos, helpers de contagem, ícones, laço de quadro, áudio falso e tokens do armado

**Onda:** 0. **Depende de:** base.

**Files:**
- Create: `src/lib/stageContracts.ts`, `src/lib/stageContracts.test.ts`, `src/lib/transitionView.ts`, `src/lib/transitionView.test.ts`
- Create: `src/components/stage/icons.tsx`, `src/components/stage/iconNames.ts`, `src/components/stage/icons.test.tsx`
- Create: `src/components/stage/useFrame.ts`, `src/components/stage/useFrame.test.tsx`
- Create: `src/test/fakeAudio.ts`, `src/test/fakeAudio.test.ts`
- Modify: `src/styles/ps-tokens.css` (animações do armado), `src/styles/ps-tokens.test.ts` (afirma os tokens novos)

**Interfaces:**
- Consumes: `ChannelRole` de `src/types.ts`; `TimeSignatureType` de `src/lib/AudioAnalyzer.ts` (só tipo).
- Produces (em `src/lib/stageContracts.ts`):

```ts
export type TimeSignature = TimeSignatureType // '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'
export const TIME_SIGNATURES: readonly TimeSignature[] // nessa ordem
export function pulsesPerBar(sig: TimeSignature): number // 3, 4, 5, 6, 7, 12
export function isCompound(sig: TimeSignature): boolean // 6/8 e 12/8
export function countPulses(sig: TimeSignature, countEvery: 1 | 3): number // 6/8+3 -> 2, 12/8+3 -> 4, senão pulsesPerBar
export function signatureForPulses(n: number): TimeSignature | null // 3->'3/4' 4->'4/4' 5->'5/4' 6->'6/8' 7->'7/8' 12->'12/8'

export type GridSource = 'click' | 'bpm'                            // de onde vêm BPM e fase
export type MeterSource = 'manual' | 'salvo' | 'acento' | 'padrao'  // de onde vem o compasso
export interface SongGrid { bpm: number; firstDownbeat: number; signature: TimeSignature; countEvery: 1 | 3; source: GridSource; meterSource: MeterSource }
export const gridHasPhase = (g: SongGrid): boolean // source === 'click'
export type GridWarning = 'sem-grade' | 'sem-click-lido' | 'compasso-assumido'
export const GRID_WARNING_TEXT: Record<GridWarning, { label: string; title: string }>
// 'sem-grade': 'SEM GRADE' / 'Sem click e sem BPM salvo: o pulo cai na marca da seção, sem contagem.'
// 'sem-click-lido': 'SEM CLICK LIDO' / 'A contagem usa o BPM salvo da música. Confira o canal de click.'
// 'compasso-assumido': '4/4 ASSUMIDO' / 'O click não tem acento no 1. Confira o compasso no EDITAR.'

export type Plays = number | 'infinite'
export interface ArmIntent { target: number; plays: Plays }
export interface TimelineSegment { ctxStart: number; songStart: number }
export interface SectionSpan { index: number; start: number; end: number } // segundos da música, encaixados; index = posição na lista de spans

export type OutputMode = 'stereo' | 'split2' | 'multi'
export interface OutputSettings { mode: OutputMode; earOnSecond: boolean; multi: { vsPair: number; click: number; guide: number } } // saídas com índice 0
export interface OutputPlan { mode: OutputMode; channels: number; vs: number[]; click: number[]; guide: number[]; panByRole: boolean; fellBackFrom: OutputMode | null }
export type StageVersion = 'novo' | 'antigo'
export type StageMode = 'novo' | 'antigo' // o que vale agora (chave + tela), decidido pelo App

export interface StageSection { index: number; label: string; color: string; start: number; end: number; bars: number | null }
export interface TransitionView {
  from: number; to: number; kind: 'proxima' | 'repete'; plays: Plays
  switchAt: number | null; countTimes: number[]; countLabels: number[]; countTotal: number // tempos do contexto
  barsLeft: number | null; committed: boolean; clickAudible: boolean; hasGrid: boolean
}
export interface StageChannel { id: string; label: string; color: string; role: ChannelRole; volume: number; muted: boolean; soloed: boolean; pan: number; silenced: boolean }
export interface StageSong { id: string; name: string; artist?: string; coverImage?: string; originalKey: string | null; pitch: number; bpm: number | null; signature: TimeSignature | null; duration: number; position: number; total: number; prevName: string | null; nextName: string | null; repertoireName: string | null }
export interface StageGates { sections: boolean; infinite: boolean; maxRepeats: number; bandSections: boolean }
export interface StageView {
  song: StageSong | null; sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null
  landed: { index: number; at: number } | null; grid: SongGrid | null; gridWarning: GridWarning | null; isReadingGrid: boolean
  isPlaying: boolean; isCountingIn: boolean; precount: { enabled: boolean; beats: number; times: number[] }
  endMode: 'continue' | 'stop' | 'fade-out'; click: { channelId: string | null; on: boolean }
  channels: StageChannel[]; master: { volume: number; muted: boolean }; outputs: OutputPlan; gates: StageGates
  editMode: boolean; channelEditMode: boolean; padPanelOpen: boolean; activePad: string | null
  app: { online: boolean; isDesktop: boolean; isAdmin: boolean; userName: string | null; hostActive: boolean }
}
export interface StageActions {
  togglePlay(): void; goToStart(): void; setEndMode(m: StageView['endMode']): void; togglePrecount(): void; cyclePrecountBeats(): void
  toggleClick(): void; openMetronome(): void; tapSection(i: number): void; stepSection(dir: -1 | 1): void; cancelArm(): void
  armRepeat(plays: Plays): void; toggleLoop(): void; seek(t: number): void; seekBy(dt: number): void; changePitch(semitones: number): void
  prevSong(): void; nextSong(): void; setVolume(id: string, gain: number): void; toggleMute(id: string): void; toggleSolo(id: string): void
  setPan(id: string, pan: number): void; setMasterVolume(gain: number): void; toggleMasterMute(): void; togglePadPanel(): void; openLyrics(): void
  openRepertoires(): void; openTracks(): void; openLibrary(): void; toggleEditMode(): void; toggleChannelEditMode(): void; openHost(): void
  openSettings(): void; goHome(): void; signOut(): void; openUpgrade(): void; openChannelEdit(id: string): void
  reorderChannel(from: number, to: number): void; removeChannel(id: string): void
  markSection(label: string): void; nudgeSection(index: number, bars: number): void; removeSection(index: number): void
  setMeter(sig: TimeSignature, countEvery: 1 | 3): void; redetectMeter(): void
}
export interface StageClock { heardNow(): number; position(): number; level(channelId: string): number; masterLevels(): { l: number; r: number } }
```

- Produces (em `src/lib/transitionView.ts`, a conta única que o PRÓXIMA (T8), a botoeira (T10) e o balão do Click (T14) usam):

```ts
export interface CountState { lit: boolean[]; currentLabel: number | null; inLastBar: boolean; counting: boolean }
export function countState(t: TransitionView, heardNow: number): CountState // lit[label-1] = bipe já ouvido; inLastBar = já passou do início do último compasso (pelo primeiro tempo possível da contagem)
export function transitionWaitText(t: TransitionView, heardNow: number): string | null
// prioridade: !hasGrid 'no fim da seção'; !clickAudible 'CLICK DESLIGADO'; contando null; barsLeft > 1 'em N comp.'; senão 'último comp.'
```

- Produces (resto):
  - `iconNames.ts`: `export type IconName = 'mark' | 'pause' | 'start' | 'prev' | 'next' | 'loop' | 'metro' | 'sliders' | 'count' | 'chl' | 'chr' | 'chd' | 'x' | 'inf' | 'pad' | 'lyrics' | 'edit' | 'cloud' | 'home' | 'out' | 'rev' | 'trash' | 'grip' | 'plus' | 'minus' | 'check'` e `export const ICON_NAMES: readonly IconName[]`.
  - `icons.tsx`: só `export function Icon({ name, className }: { name: IconName; className?: string })`. Os 21 primeiros copiam os `<symbol>` do v5 (linhas 367 a 387) como SVG inline (sem `<use href>`); os 5 últimos seguem os desenhos equivalentes do `lucide-react` (`Trash2`, `GripVertical`, `Plus`, `Minus`, `Check`), redesenhados no mesmo traço; `currentColor`, `stroke-width 2`, `aria-hidden="true"`, `focusable="false"`.
  - `useFrame.ts`: `export function useFrame(cb: (t: number) => void, active?: boolean): void` (requestAnimationFrame; para quando `active` é false e no unmount; o callback mais novo é guardado num ref atualizado em `useLayoutEffect`, nunca na renderização).
  - `fakeAudio.ts`: `createFakeAudioContext(opts?: { sampleRate?: number; maxChannelCount?: number; outputLatency?: number })` com `currentTime` gravável, `state` (`'running'`), `resume()`, `suspend()`, `close()`, `decodeAudioData(buf)` (devolve um `AudioBuffer` falso com `duration`, `numberOfChannels`, `sampleRate`, `getChannelData`), `setSinkId(id)` (troca `maxChannelCount` pelo mapa `opts.sinks` e dispara `sinkchange`), `addEventListener`/`removeEventListener`, `destination` (`channelCount`, `channelCountMode`, `channelInterpretation`, `maxChannelCount`), `audioWorklet.addModule()`, e as fábricas `createGain`, `createBufferSource`, `createOscillator`, `createBiquadFilter`, `createDelay`, `createStereoPanner`, `createChannelMerger(n)`, `createChannelSplitter(n)`, `createAnalyser`, `createBuffer`. O contexto guarda `created: { kind: string; node: unknown }[]` (todo nó criado, na ordem). Cada nó grava `connections: { to; output; input }[]` e `disconnect(alvo?)`; cada `AudioParam` grava `events: { kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel'; value?; time }[]`; fontes gravam `starts` e `stops`. Helpers: `valueAt(param, t)` (interpreta `set`, `linear`, `exp`, `target` e `cancel`), `connectedTo(a, b, input?)` (ligação direta), `reaches(from, to, input?)` (busca no grafo inteiro, seguindo ligações e respeitando `output`/`input` de merger e splitter), `nodesOf(ctx, kind)`. Worklet de tom nos testes do motor continua pelo `vi.mock('signalsmith-stretch')`, como no `useAudioEngine.persistence.test.ts`.
  - `ps-tokens.css`: `--animate-ps-armglow` (borda branca pulsando, 1,2 s), `--animate-ps-stripes` (listras andando, 0,9 s, linear), `--animate-ps-land` (brilho de pousou, 0,8 s), com os `@keyframes` do v5 (linhas 107, 130 e 167) e desligadas em `prefers-reduced-motion`.

- [ ] **Step 1: Escrever os testes**

```ts
// stageContracts.test.ts
it('pulsos e contagem por compasso', () => {
  expect(TIME_SIGNATURES.map(pulsesPerBar)).toEqual([3, 4, 5, 6, 7, 12])
  expect(countPulses('6/8', 3)).toBe(2); expect(countPulses('12/8', 3)).toBe(4); expect(countPulses('4/4', 1)).toBe(4)
  expect(signatureForPulses(2)).toBeNull(); expect(signatureForPulses(6)).toBe('6/8')
})
it('avisos da grade curtos e sem travessão', () => { for (const w of Object.values(GRID_WARNING_TEXT)) { expect(w.label.length).toBeLessThanOrEqual(16); expect(w.label + w.title).not.toContain(TRAVESSAO) } })
// transitionView.test.ts
const t: TransitionView = { from: 1, to: 0, kind: 'proxima', plays: 1, switchAt: 22, countTimes: [20, 20.5, 21, 21.5], countLabels: [1, 2, 3, 4], countTotal: 4, barsLeft: 1, committed: true, clickAudible: true, hasGrid: true }
it.each([
  [{ hasGrid: false }, 10, 'no fim da seção'], [{ clickAudible: false }, 10, 'CLICK DESLIGADO'],
  [{ barsLeft: 3 }, 10, 'em 3 comp.'], [{}, 19.9, 'último comp.'], [{}, 20.6, null],
])('texto de espera %#', (patch, now, text) => expect(transitionWaitText({ ...t, ...patch }, now)).toBe(text))
it('bolinhas pelo tempo ouvido e contagem curta com o número real', () => {
  expect(countState(t, 20.6)).toMatchObject({ lit: [true, true, false, false], currentLabel: 2, counting: true })
  expect(countState({ ...t, countTimes: [21, 21.5], countLabels: [3, 4] }, 21.2).lit).toEqual([false, false, true, false])
})
// icons.test.tsx (jsdom)
it('todo ícone é SVG escondido do leitor de tela e sem texto', () => { for (const name of ICON_NAMES) { const { container } = render(<Icon name={name} />); expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true'); expect(container.textContent).toBe(''); cleanup() } })
// useFrame.test.tsx (jsdom, rAF falso com vi.stubGlobal)
it('chama a cada quadro e para no unmount', ...)
it('não chama com active false', ...)
// fakeAudio.test.ts
it('grava start, stop e rampas e calcula valueAt', () => {
  const ctx = createFakeAudioContext(); const g = ctx.createGain()
  g.gain.setValueAtTime(1, 2); g.gain.linearRampToValueAtTime(0, 2.01)
  expect(valueAt(g.gain, 2.005)).toBeCloseTo(0.5, 5)
  const s = ctx.createBufferSource(); s.start(3, 1.5); s.stop(4)
  expect(s.starts).toEqual([{ when: 3, offset: 1.5 }]); expect(s.stops).toEqual([4])
})
it('reaches acha caminho com nó no meio e respeita a entrada do merger', () => {
  const ctx = createFakeAudioContext(); const a = ctx.createGain(), mid = ctx.createGain(), m = ctx.createChannelMerger(2)
  a.connect(mid); mid.connect(m, 0, 1)
  expect(connectedTo(a, m)).toBe(false); expect(reaches(a, m, 1)).toBe(true); expect(reaches(a, m, 0)).toBe(false)
})
it('setSinkId troca os canais do destino e avisa', ...)
// ps-tokens.test.ts (acrescentar)
it('tokens das animações do armado', () => { for (const t of ['--animate-ps-armglow', '--animate-ps-stripes', '--animate-ps-land']) expect(css).toContain(t) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/stageContracts.test.ts src/lib/transitionView.test.ts src/components/stage src/test src/styles > "$LOGS/t1.log" 2>&1; echo $?`. Expected: diferente de 0.
- [ ] **Step 3: Implementar.** `stageContracts.ts` e `transitionView.ts` sem React e sem Web Audio.
- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: `0`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/stageContracts.ts src/lib/stageContracts.test.ts src/lib/transitionView.ts src/lib/transitionView.test.ts src/components/stage/icons.tsx src/components/stage/iconNames.ts src/components/stage/icons.test.tsx src/components/stage/useFrame.ts src/components/stage/useFrame.test.tsx src/test/fakeAudio.ts src/test/fakeAudio.test.ts src/styles/ps-tokens.css src/styles/ps-tokens.test.ts
git commit -m "feat(palco): contratos, helpers de contagem, icones, laco de quadro, audio falso e tokens do armado [Parte 2] [T1]"
```

---

### Tarefa 2: Grade da música (barras, encaixe, seções e avisos)

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/songGrid.ts`, `src/lib/songGrid.test.ts`

**Interfaces:**
- Consumes (T1): `SongGrid`, `SectionSpan`, `TimeSignature`, `GridWarning`, `pulsesPerBar`, `isCompound`, `signatureForPulses`, `gridHasPhase`; `Marker` de `src/types.ts`.
- Produces:
  - `pulseSeconds(g: SongGrid): number` (60 / bpm) e `barSeconds(g: SongGrid): number`
  - `nearestBarLine(t: number, g: SongGrid): number`
  - `snapToBar(t: number, g: SongGrid | null): number`: encaixa só com `gridHasPhase(g)` e distância de no máximo `barSeconds(g) / 4`; `t <= 0` devolve `0`; senão `t`.
  - `barIndexAt(t: number, g: SongGrid): number`
  - `sectionSpans(markers: readonly Marker[], duration: number, grid: SongGrid | null): SectionSpan[]`: marcas ordenadas; marca com tempo não finito ou fora de `[0, duration)` é ignorada; `start` = `snapToBar(marca)`; `end` = `start` da seguinte; a última termina em `snapToBar(duration)` se isso não passar de `duration`, senão em `duration`; `index` = posição na lista de spans (é esse índice que o palco, a banda e o motor usam).
  - `markerIdForSpan(markers, duration, grid, spanIndex): string | null` (pro modo EDITAR achar a marca do bloco)
  - `sectionIndexAt(spans: readonly SectionSpan[], t: number): number` (-1 antes da primeira)
  - `gridFromBpm(bpm: number, savedSignature?: TimeSignature | null): SongGrid | null` (source `'bpm'`, `firstDownbeat` 0; compasso salvo com `meterSource 'salvo'`, senão `'4/4'` com `'padrao'`; bpm fora de `[30, 300]` dá `null`)
  - `interface ClickAnalysisLike { bpm: number; firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null }` e `gridFromClick(a: ClickAnalysisLike, savedSignature?: TimeSignature | null): SongGrid` (source `'click'`; compasso: o salvo (`'salvo'`), senão `signatureForPulses(a.pulsesPerBar)` (`'acento'`), senão `'4/4'` (`'padrao'`); `firstDownbeat` = `a.firstDownbeat ?? a.firstPulse` normalizado pra `[0, compasso)`)
  - `withMeter(g: SongGrid, signature: TimeSignature, countEvery: 1 | 3): SongGrid` (`meterSource 'manual'`; `countEvery` vira 1 se não for composto; BPM, fase e `source` ficam)
  - `keepManualMeter(next: SongGrid, previous: SongGrid | null): SongGrid` (se `previous.meterSource === 'manual'`, reaplica o compasso dele em `next`; é o que o "Ler o click de novo" usa)
  - `gridWarning(g: SongGrid | null): GridWarning | null` (`null` dá `'sem-grade'`; `source 'bpm'` dá `'sem-click-lido'`; `meterSource 'padrao'` dá `'compasso-assumido'`; senão `null`)
  - `sanitizeGrid(raw: unknown): SongGrid | null` (bpm finito em `[30, 300]`, `firstDownbeat` finito e `>= 0`, assinatura, `countEvery`, `source` e `meterSource` conhecidos)

- [ ] **Step 1: Escrever `src/lib/songGrid.test.ts`**

```ts
const g: SongGrid = { bpm: 120, firstDownbeat: 0.25, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('barras e encaixe', () => {
  expect(barSeconds(g)).toBe(2); expect(nearestBarLine(4.1, g)).toBeCloseTo(4.25)
  expect(snapToBar(4.6, g)).toBeCloseTo(4.25)   // a 0,35 s da barra: encaixa (limite 0,5 s)
  expect(snapToBar(5.3, g)).toBe(5.3)           // a 0,95 s da barra de 6,25: marca crua
  expect(snapToBar(0, g)).toBe(0); expect(snapToBar(4.6, { ...g, source: 'bpm' })).toBe(4.6); expect(snapToBar(4.6, null)).toBe(4.6)
})
it('seções encaixadas e a última nunca passa do áudio', () => {
  const m = [{ id: 'b', time: 8.2, label: 'Refrão' }, { id: 'a', time: 0, label: 'Intro' }, { id: 'c', time: 16.4, label: 'Final' }]
  expect(sectionSpans(m, 20.1, g)).toEqual([{ index: 0, start: 0, end: 8.25 }, { index: 1, start: 8.25, end: 16.25 }, { index: 2, start: 16.25, end: 20.1 }])
  expect(markerIdForSpan(m, 20.1, g, 1)).toBe('b')
})
it('ignora marca inválida e o índice é o da lista de spans', () => expect(sectionSpans([{ id: 'x', time: NaN, label: 'X' }, { id: 'y', time: 99, label: 'Y' }, { id: 'z', time: 3, label: 'Z' }], 30, null)).toEqual([{ index: 0, start: 3, end: 30 }]))
it('grade a partir do bpm salvo e do click, com a origem do compasso', () => {
  expect(gridFromBpm(72.5)).toEqual({ bpm: 72.5, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'bpm', meterSource: 'padrao' })
  expect(gridFromBpm(72.5, '3/4')!.meterSource).toBe('salvo'); expect(gridFromBpm(0)).toBeNull()
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 })).toMatchObject({ signature: '3/4', meterSource: 'acento' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: null, firstDownbeat: null })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 }, '6/8')).toMatchObject({ signature: '6/8', meterSource: 'salvo' })
})
it('compasso manual sobrevive a reler o click', () => expect(keepManualMeter(g, withMeter(g, '6/8', 3))).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', bpm: 120 }))
it('aviso da grade nunca some em silêncio', () => {
  expect(gridWarning(null)).toBe('sem-grade'); expect(gridWarning(gridFromBpm(80))).toBe('sem-click-lido')
  expect(gridWarning({ ...g, meterSource: 'padrao' })).toBe('compasso-assumido'); expect(gridWarning(g)).toBeNull()
})
it('compasso manual e sanitização', () => {
  expect(withMeter(g, '6/8', 3)).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', source: 'click' })
  expect(withMeter(g, '3/4', 3).countEvery).toBe(1)
  expect(sanitizeGrid({ ...g, bpm: NaN })).toBeNull(); expect(sanitizeGrid({ ...g, signature: '9/8' })).toBeNull(); expect(sanitizeGrid({ ...g, source: 'manual' })).toBeNull()
  expect(sanitizeGrid(g)).toEqual(g)
})
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/songGrid.test.ts > "$LOGS/t2.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar `src/lib/songGrid.ts`** (puro).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/songGrid.ts src/lib/songGrid.test.ts
git commit -m "feat(tempo): grade da musica com encaixe no compasso e avisos [Parte 2] [T2]"
```

---

### Tarefa 3: Compasso e BPM pelo acento do click

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/clickMeter.ts`, `src/lib/clickMeter.test.ts`

**Interfaces:**
- Produces: `export interface ClickAnalysis { bpm: number; firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null; onsets: number; accent: 'loud' | 'bright' | null }` (compatível por estrutura com o `ClickAnalysisLike` da T2) e `export function analyzeClickTrack(samples: Float32Array, sampleRate: number): ClickAnalysis | null`. `null` com menos de 4 s, menos de 8 ataques ou sem pulso regular.

- [ ] **Step 1: Escrever `src/lib/clickMeter.test.ts`** com um gerador sintético no próprio arquivo: `synthClick({ bpm, seconds, pulsesPerBar, accent: 'loud' | 'bright' | 'none' | 'every2', firstPulse, pickupPulses?, jitterMs?, gap?: [number, number] })` a 48 kHz (bipe de 25 ms; `loud` = 1,8x a amplitude; `bright` = mesma amplitude com 2400 Hz em vez de 1200 Hz).

```ts
it('4/4 com acento mais forte, BPM com decimais', () => {
  const a = analyzeClickTrack(synthClick({ bpm: 72.5, seconds: 40, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.31 }), 48000)!
  expect(Math.abs(a.bpm - 72.5)).toBeLessThan(0.02); expect(a.pulsesPerBar).toBe(4); expect(a.accent).toBe('loud'); expect(Math.abs(a.firstDownbeat! - 0.31)).toBeLessThan(0.002)
})
it('3/4 com acento só mais agudo', () => expect(analyzeClickTrack(synthClick({ bpm: 90, seconds: 30, pulsesPerBar: 3, accent: 'bright', firstPulse: 0.1 }), 48000)!.pulsesPerBar).toBe(3))
it('6/8 com acento só no 1', () => expect(analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 6, accent: 'loud', firstPulse: 0.05 }), 48000)!.pulsesPerBar).toBe(6))
it('anacruse: o 1 é o terceiro ataque', () => expect(Math.abs(analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.2, pickupPulses: 2 }), 48000)!.firstDownbeat! - 1.2)).toBeLessThan(0.002))
it('sem acento ou acento a cada 2 tempos: compasso desconhecido, BPM ainda medido', () => {
  const sem = analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0 }), 48000)!
  expect(sem.pulsesPerBar).toBeNull(); expect(Math.abs(sem.bpm - 100)).toBeLessThan(0.02)
  expect(analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000)!.pulsesPerBar).toBeNull()
})
it('tolera variação de 1 ms e um trecho sem click', () => { const a = analyzeClickTrack(synthClick({ bpm: 76, seconds: 60, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.4, jitterMs: 1, gap: [20, 26] }), 48000)!; expect(Math.abs(a.bpm - 76)).toBeLessThan(0.05); expect(a.pulsesPerBar).toBe(4) })
it('silêncio e áudio curto', () => { expect(analyzeClickTrack(new Float32Array(48000 * 10), 48000)).toBeNull(); expect(analyzeClickTrack(synthClick({ bpm: 120, seconds: 3, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }), 48000)).toBeNull() })
it('5 minutos analisados em menos de 2 s', () => { const x = synthClick({ bpm: 120, seconds: 300, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }); const t0 = performance.now(); analyzeClickTrack(x, 48000); expect(performance.now() - t0).toBeLessThan(2000) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/clickMeter.test.ts > "$LOGS/t3.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar `analyzeClickTrack`** (Arquitetura B):
  1. Ataques: envelope do valor absoluto; ataque = subida acima de 30% do pico global, no mínimo 60 ms entre ataques; tempo = primeira amostra acima do limiar.
  2. Período: mediana dos intervalos vizinhos; índice de cada ataque `round((t - t0) / mediana)`; descarta ataques a mais de 15% da grade; BPM e fase por mínimos quadrados (índice x tempo).
  3. Traços por ataque nos primeiros 15 ms: pico (`loud`) e cruzamentos por zero (`bright`). Pra cada traço, 2-médias e limiar no meio das médias. Se as duas médias ficam a menos de 10% uma da outra (todos os ataques iguais: o 2-médias degenera), esse traço não marca acento.
  4. Pra `m` em `[3, 4, 5, 6, 7, 12]`, nessa ordem, e pra cada traço válido: aceita o primeiro `m` com exatamente uma fase `p` com pelo menos 80% de acentuados, todas as outras com no máximo 20%, e pelo menos 4 ataques na fase `p`. `firstDownbeat` = tempo do primeiro ataque com índice `≡ p (mod m)`. Sem `m`: `pulsesPerBar` e `firstDownbeat` `null`, `accent null`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/clickMeter.ts src/lib/clickMeter.test.ts
git commit -m "feat(tempo): compasso e BPM com decimais lidos do acento do click [Parte 2] [T3]"
```

---

### Tarefa 4: Intenção armada (armar, repetir, loop, cancelar)

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/sectionArm.ts`, `src/lib/sectionArm.test.ts`

**Interfaces:**
- Consumes (T1): `ArmIntent`, `Plays`, `StageGates`.
- Produces:

```ts
export interface ArmContext { current: number; isPlaying: boolean; sectionCount: number; gates: StageGates }
export interface ArmResult { intent: ArmIntent | null; seekToSection: number | null; upgrade: boolean }
export function tapSection(intent: ArmIntent | null, index: number, c: ArmContext): ArmResult
export function stepSection(intent: ArmIntent | null, dir: -1 | 1, c: ArmContext): ArmResult
export function armAt(intent: ArmIntent | null, index: number, plays: Plays, c: ArmContext): ArmResult // REPETIR e banda
export function armRepeat(intent: ArmIntent | null, plays: Plays, c: ArmContext): ArmResult // na seção atual
export function toggleLoop(intent: ArmIntent | null, c: ArmContext): ArmResult
export function bandRepeat(index: number, times: Plays, current: number): { target: number; plays: Plays } // sentido antigo da banda: outra seção = times + 1 passagens; ∞ continua ∞
export function afterLanding(intent: ArmIntent): ArmIntent | null
export function armLabel(intent: ArmIntent | null, current: number): { kind: 'proxima' | 'repete'; plays: Plays } | null
export function isSelfLoop(intent: ArmIntent | null, from: number): boolean // target === from && plays === 'infinite'
```

- Regras: sem `gates.sections` qualquer armar devolve `upgrade: true` sem mudar nada; `'infinite'` sem `gates.infinite` idem; número acima de `gates.maxRepeats` vira o teto, abaixo de 1 vira 1. Tocando: tocar na armada cancela (inclusive o loop ∞); em outra troca o alvo com `plays: 1`. Parado: tocar (ou `stepSection`) devolve `seekToSection` e `intent: null`. `stepSection` parte do alvo armado (se houver) ou da atual, preso em `[0, sectionCount - 1]`. `toggleLoop` cancela se a intenção já é `{ atual, 'infinite' }`. `afterLanding`: `'infinite'` continua, `plays > 1` desce 1, senão `null`. Índice fora da lista: nada muda.

- [ ] **Step 1: Escrever `src/lib/sectionArm.test.ts`** como tabela (`it.each`) cobrindo cada regra, mais:

```ts
it('REPETIR 3 na atual pousa 3 vezes e desarma', () => {
  let i = armRepeat(null, 3, ctx({ current: 2 })).intent!
  expect(i).toEqual({ target: 2, plays: 3 }); expect(armLabel(i, 2)).toEqual({ kind: 'repete', plays: 3 })
  i = afterLanding(i)!; i = afterLanding(i)!; expect(afterLanding(i)).toBeNull()
})
it('Livre não arma e pede upgrade', () => expect(tapSection(null, 1, ctx({ gates: { ...gates, sections: false } }))).toEqual({ intent: null, seekToSection: null, upgrade: true }))
it('parado leva pro início e desarma', () => expect(tapSection({ target: 3, plays: 1 }, 1, ctx({ isPlaying: false }))).toEqual({ intent: null, seekToSection: 1, upgrade: false }))
it('repetir 2 da banda numa outra seção vira 3 passagens; na atual, 2', () => { expect(bandRepeat(4, 2, 1)).toEqual({ target: 4, plays: 3 }); expect(bandRepeat(1, 2, 1)).toEqual({ target: 1, plays: 2 }); expect(bandRepeat(4, 'infinite', 1)).toEqual({ target: 4, plays: 'infinite' }) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/sectionArm.test.ts > "$LOGS/t4.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (funções puras; nunca mutam a intenção recebida).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sectionArm.ts src/lib/sectionArm.test.ts
git commit -m "feat(secoes): regra unica de armar, repetir, loop e cancelar [Parte 2] [T4]"
```

---

### Tarefa 5: Linha do tempo e relógio do agendador

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/playTimeline.ts`, `src/lib/playTimeline.test.ts`, `src/audio/schedulerClock.ts`, `src/audio/schedulerClock.test.ts`

**Interfaces:**
- Produces (`playTimeline.ts`):
  - `segmentAt(segs: readonly TimelineSegment[], ctxTime: number): TimelineSegment | null` (o último com `ctxStart <= ctxTime`; antes do primeiro, o primeiro)
  - `positionAt(segs, ctxTime: number, rate?: number): number` (pelo `segmentAt`; antes do primeiro segmento devolve o `songStart` dele: a posição nunca volta)
  - `ctxTimeOf(segs, songTime: number, atCtx: number, rate?: number): number` (converte pelo segmento vigente em `atCtx`; nunca usa um segmento que começa depois de `atCtx`)
  - `withSegment(segs, seg): TimelineSegment[]` (tira os que começam em `seg.ctxStart` ou depois e acrescenta `seg`), `dropFrom(segs, ctxTime): TimelineSegment[]`, `pruneBefore(segs, ctxTime): TimelineSegment[]`
  - `heardTime(ctxTime: number, outputLatency: number, entryLatency: number): number` (latências não finitas contam 0)
- Produces (`schedulerClock.ts`):

```ts
export interface WorkerLike { postMessage(m: unknown): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null }
export interface SchedulerClock { start(): void; stop(): void; dispose(): void; readonly running: boolean }
export const CLOCK_INTERVAL_MS = 25
export function createSchedulerClock(onTick: () => void, opts?: { intervalMs?: number; createWorker?: (url: string) => WorkerLike; createObjectURL?: (b: Blob) => string; revokeObjectURL?: (url: string) => void; setIntervalFn?: typeof setInterval; clearIntervalFn?: typeof clearInterval }): SchedulerClock
```

  O Worker nasce de um Blob com `setInterval(() => postMessage(0), N)` controlado por `'start'` e `'stop'`. Sem `Worker` (ausente ou lançando), cai no `setIntervalFn` (padrão `globalThis.setInterval`) com `console.warn` em português.

- [ ] **Step 1: Escrever os testes** (ambiente `node`; o relógio recebe as funções de timer por opção, então não precisa de jsdom)

```ts
it('posição pela linha do tempo, com o pulo agendado', () => {
  const segs = [{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }]
  expect(positionAt(segs, 9)).toBe(30); expect(positionAt(segs, 12)).toBe(32); expect(positionAt(segs, 14)).toBe(8); expect(positionAt(segs, 15.5)).toBe(9.5)
  expect(dropFrom(segs, 13)).toEqual(segs.slice(0, 1)); expect(pruneBefore(segs, 15)).toEqual(segs.slice(1))
})
it('conversão pro contexto usa o segmento vigente, não o futuro', () => {
  const segs = [{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }]
  expect(ctxTimeOf(segs, 33, 12)).toBe(13)   // vigente em 12: o primeiro
  expect(ctxTimeOf(segs, 10, 14.5)).toBe(16) // vigente em 14,5: o segundo
})
it('tempo ouvido', () => expect(heardTime(10, 0.02, NaN)).toBeCloseTo(9.98))
it('o relógio usa Worker e não setInterval da janela', () => {
  const setIntervalFn = vi.fn(); const w = fakeWorker(); const onTick = vi.fn(); const revokeObjectURL = vi.fn()
  const clock = createSchedulerClock(onTick, { createWorker: () => w, createObjectURL: () => 'blob:x', revokeObjectURL, setIntervalFn })
  clock.start(); expect(w.sent).toEqual(['start']); w.onmessage!({ data: 0 }); expect(onTick).toHaveBeenCalledTimes(1)
  clock.stop(); clock.dispose(); expect(w.terminated).toBe(true); expect(revokeObjectURL).toHaveBeenCalledWith('blob:x'); expect(setIntervalFn).not.toHaveBeenCalled()
})
it('sem Worker cai no setInterval e avisa', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/playTimeline.test.ts src/audio/schedulerClock.test.ts > "$LOGS/t5.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/playTimeline.ts src/lib/playTimeline.test.ts src/audio/schedulerClock.ts src/audio/schedulerClock.test.ts
git commit -m "feat(tempo): linha do tempo da musica e relogio do agendador em Worker [Parte 2] [T5]"
```

---

### Tarefa 6: Plano de saídas e pan efetivo por papel

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/outputPlan.ts`, `src/lib/outputPlan.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_OUTPUTS: OutputSettings` = `{ mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }`
  - `migrateOutputs(stored: { autoPan?: unknown; outputs?: unknown }): { outputs: OutputSettings; autoPan: boolean; resetLegacyPans: boolean }` (R-23): `outputs` válido vence (sem reset); senão `autoPan === false` dá `stereo`; qualquer outro valor (o pan automático era o padrão) dá `DEFAULT_OUTPUTS`, `autoPan: false` e `resetLegacyPans: true`.
  - `sanitizeOutputs(raw: unknown): OutputSettings | null`
  - `planOutputs(s: OutputSettings, maxChannelCount: number): OutputPlan`:
    - `maxChannelCount` não finito ou menor que 2 conta como 2.
    - `stereo`: `{ channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false }`.
    - `split2`: lado do ouvido `earOnSecond ? 1 : 0`; `vs` = o outro; `click` e `guide` = o do ouvido; `panByRole: true`.
    - `multi` com 4 ou mais: `channels = min(maxChannelCount, 32)`; `vsPair` par, `vsPair + 1 < channels`, `click` e `guide` dentro de `channels` e fora do par; mapa inválido vira o padrão `{ 0, 2, 3 }` (se nem ele couber, `split2`); `panByRole: true` só pra Click e Guia (o pan do knob vale na VS).
    - `multi` com menos de 4: plano de `split2` com o ouvido na saída 1 e `fellBackFrom: 'multi'`.
  - `effectivePan(pan: number, role: ChannelRole, plan: OutputPlan): number` (R-24): `stereo` devolve `pan`; `split2` devolve `-1` (ouvido na saída 1) ou `+1` (trocado) pra `click`/`guide` e o oposto pra `normal`; `multi` devolve `-1` pra `click`/`guide` e `pan` pra `normal`.
  - `multiChoices(maxChannelCount: number): { vsPairs: number[]; singles: number[] }`
  - `outputSummary(plan: OutputPlan): string` (numeração a partir de 1): "Tudo junto nas saídas 1 e 2"; "Click e Guia na saída 1 · VS na saída 2" (ou trocado); "VS nas saídas 1 e 2 · Click na 3 · Guia na 4".

- [ ] **Step 1: Escrever `src/lib/outputPlan.test.ts`**

```ts
it('nenhum plano separado põe click ou guia do lado ou na saída da VS', () => {
  for (const mode of ['split2', 'multi'] as const) for (const max of [0, 1, 2, 3, 4, 6, 8, 18, 64]) for (const earOnSecond of [false, true])
    for (const vsPair of [-2, 0, 1, 2, 4, 30]) for (const click of [-1, 0, 1, 2, 3, 5, 40]) for (const guide of [0, 1, 3, 7]) {
      const p = planOutputs({ mode, earOnSecond, multi: { vsPair, click, guide } }, max)
      for (const o of [...p.click, ...p.guide]) expect(p.vs).not.toContain(o)
      for (const o of [...p.vs, ...p.click, ...p.guide]) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(p.channels) }
      if (p.mode === 'split2') for (const pan of [-1, -0.3, 0, 1]) {
        expect(Math.sign(effectivePan(pan, 'click', p))).toBe(earOnSecond && !p.fellBackFrom ? 1 : -1)
        expect(effectivePan(pan, 'normal', p)).toBe(-effectivePan(pan, 'guide', p))
      }
    }
})
it('2 canais com 4 ou mais escolhido cai em separados e avisa', () => expect(planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi' }, 2)).toMatchObject({ mode: 'split2', fellBackFrom: 'multi', click: [0], vs: [1] }))
it('tudo junto usa o pan do knob; 4 ou mais usa o knob só na VS', ...)
it('migração: pan automático (padrão) vira separados, desliga e zera os pans uma vez', () => {
  expect(migrateOutputs({ autoPan: true })).toEqual({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: true })
  expect(migrateOutputs({})).toMatchObject({ resetLegacyPans: true }); expect(migrateOutputs({ autoPan: false })).toMatchObject({ outputs: { mode: 'stereo' }, resetLegacyPans: false })
  expect(migrateOutputs({ autoPan: true, outputs: { ...DEFAULT_OUTPUTS, mode: 'stereo' } })).toMatchObject({ outputs: { mode: 'stereo' }, resetLegacyPans: false })
})
it('resumo em português sem travessão', () => { for (const p of planosVariados) expect(outputSummary(p)).not.toContain(TRAVESSAO) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/outputPlan.test.ts > "$LOGS/t6.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/outputPlan.ts src/lib/outputPlan.test.ts
git commit -m "feat(saidas): plano de saidas e pan efetivo pelo papel do canal [Parte 2] [T6]"
```

---

### Tarefa 7: Vozes com envelope e bipes da contagem

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/audio/voices.ts`, `src/audio/voices.test.ts`, `src/audio/countTones.ts`, `src/audio/countTones.test.ts`

**Interfaces:**
- Produces (`voices.ts`):

```ts
export interface Voice { channelId: string; source: AudioBufferSourceNode; env: GainNode }
export interface VoiceSpec { channelId: string; buffer: AudioBuffer; entry: AudioNode; loop?: boolean }
export function startVoice(ctx: BaseAudioContext, spec: VoiceSpec, at: number, offset: number, rate?: number): Voice
export function startVoicesForSwitch(ctx: BaseAudioContext, specs: readonly VoiceSpec[], T: number, targetOffset: number, fade: number, rate?: number): Voice[]
export function fadeOutVoices(voices: readonly Voice[], T: number, fade: number): void
export function restoreVoices(voices: readonly Voice[], now: number): void
export function stopVoices(voices: readonly Voice[], at: number): void
```

  `startVoice`: fonte → envelope (1) → `spec.entry`; offset negativo vira 0; `onended` desliga fonte e envelope. `startVoicesForSwitch`: com `targetOffset >= fade`, começa em `T - fade` com offset `targetOffset - fade`, envelope `setValueAtTime(0, T - fade)` + `linearRampToValueAtTime(1, T)`; senão começa em `T` com offset `targetOffset` e envelope 1. `fadeOutVoices`: `setValueAtTime(1, T - fade)` + `linearRampToValueAtTime(0, T)`. `restoreVoices`: `cancelScheduledValues(now)` + `setValueAtTime(1, now)`. `stopVoices`: `stop(at)` com try/catch.
- Produces (`countTones.ts`):

```ts
export const COUNT_TONE = { accentHz: 1319, beatHz: 988, accentPeak: 0.85, beatPeak: 0.68, attack: 0.004, hold: 0.075, release: 0.19, lowpassHz: 5200, squareMix: 0.1 } as const
export interface CountBeat { at: number; label: number }
export interface ScheduledCount { readonly beats: readonly CountBeat[]; cancel(now: number): void }
export function scheduleCount(ctx: BaseAudioContext, dest: AudioNode, beats: readonly CountBeat[]): ScheduledCount
```

  Bipe (receita `vCount` do v6, linha 689): triângulo na frequência + quadrada no dobro com ganho `squareMix`, envelope ataque/sustenta/queda exponencial, passa-baixa; tudo ligado SÓ em `dest`. Acento com `label === 1`. Bipe com `at < ctx.currentTime` é pulado. `cancel(now)` para os osciladores em `now` e desliga os nós.

- [ ] **Step 1: Escrever os testes**

```ts
it('voz nova entra na mesma entrada do canal e só cria fonte e ganho', () => {
  const ctx = createFakeAudioContext(); const entry = ctx.createDelay(1) // faz o papel do worklet ou do atraso do canal
  const before = ctx.created.length
  const [v] = startVoicesForSwitch(ctx, [{ channelId: 'a', buffer: buf(30), entry }], 10, 8, 0.005)
  expect(connectedTo(v.env, entry)).toBe(true); expect(v.source.starts).toEqual([{ when: 9.995, offset: 7.995 }])
  expect(valueAt(v.env.gain, 9.995)).toBe(0); expect(valueAt(v.env.gain, 10)).toBe(1)
  expect(ctx.created.slice(before).map(n => n.kind).sort()).toEqual(['AudioBufferSourceNode', 'GainNode'])
})
it('alvo em 0:00 começa no instante, sem pré-rolagem', () => expect(startVoicesForSwitch(ctx, specs, 10, 0, 0.005)[0].source.starts).toEqual([{ when: 10, offset: 0 }]))
it('descida e restauração do envelope', ...)
it('para fonte que nunca começou sem lançar', ...)
it('bipes nos tempos, acento no 1, só no destino', () => {
  const ctx = createFakeAudioContext(); const dest = ctx.createGain()
  scheduleCount(ctx, dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }])
  const oscs = nodesOf(ctx, 'OscillatorNode')
  expect(oscs.map(o => o.frequency.value)).toEqual([1319, 2638, 988, 1976]); expect(oscs.map(o => o.starts[0].when)).toEqual([6, 6, 6.5, 6.5])
  expect(oscs.every(o => reaches(o, dest))).toBe(true); expect(oscs.some(o => reaches(o, ctx.destination))).toBe(false)
})
it('cancel para tudo em now e pula bipe no passado', ...)
```

(`ctx.created` é a lista de nós criados que o fake da T1 guarda.)

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/audio/voices.test.ts src/audio/countTones.test.ts > "$LOGS/t7.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/audio/voices.ts src/audio/voices.test.ts src/audio/countTones.ts src/audio/countTones.test.ts
git commit -m "feat(audio): vozes com envelope e bipes da contagem agendados [Parte 2] [T7]"
```

---

### Tarefa 8: Transporte e aviso PRÓXIMA

**Onda:** 1. **Depende de:** T1 (e `Button`, `Chip`, `Segmented`, `Led` da Parte 1).

**Files:**
- Create: `src/components/stage/TransportBar.tsx`, `src/components/stage/NextPill.tsx`, `src/components/stage/PlayButton.tsx`, `src/components/stage/transport.test.tsx`

**Interfaces:**
- Consumes (T1): contrato, `countState`, `transitionWaitText`, `GRID_WARNING_TEXT`, `Icon`, `useFrame`, tokens `animate-ps-armglow`.
- Produces:

```ts
export interface StagePulse { seconds: number; firstDownbeat: number }
export interface TransportBarProps {
  view: Pick<StageView, 'isPlaying' | 'isCountingIn' | 'precount' | 'endMode' | 'click' | 'intent' | 'transition' | 'sections' | 'currentSection' | 'gates' | 'gridWarning'>
  actions: Pick<StageActions, 'togglePlay' | 'goToStart' | 'setEndMode' | 'togglePrecount' | 'cyclePrecountBeats' | 'toggleClick' | 'openMetronome' | 'stepSection' | 'cancelArm' | 'toggleLoop'>
  clock: Pick<StageClock, 'heardNow' | 'position'>; pulse: StagePulse | null
}
export interface NextPillProps { transition: TransitionView | null; intent: ArmIntent | null; sections: StageSection[]; currentSection: number; gridWarning: GridWarning | null; clock: Pick<StageClock, 'heardNow'>; onCancel(): void }
export interface PlayButtonProps { isPlaying: boolean; isCountingIn: boolean; precountTimes: number[]; pulse: StagePulse | null; clock: Pick<StageClock, 'heardNow' | 'position'>; onToggle(): void }
```

(Os três arquivos exportam só o componente; a conta fica em `transitionView.ts`.)

- Visual: v5 linhas 50 a 107 (+ `.np-wait` do v6, 105 a 108) e marcação 405 a 442. Esquerda: "Fim da música" + `Segmented` AUTO / PARAR / FADE (`continue` / `stop` / `fade-out`, `data-tour="modos"`). Centro: COMEÇO, Play (PlayMark, `data-tour="play"`), LOOP, CLICK + metrônomo colado (`data-tour="metronomo"` no metrônomo), PRÉ-CONT. + número (`data-tour="precontagem"`), separador, SEÇÃO ◂ ▸. Direita: `NextPill`.
- Aviso: texto de espera por `transitionWaitText` ("CLICK DESLIGADO" em `ps-alert`); bolinhas por `countState(...).lit`; com `gridWarning` igual a `'sem-click-lido'` ou `'compasso-assumido'`, uma linha âmbar com `GRID_WARNING_TEXT[w].label` e o `title`. Rótulo "PRÓXIMA", ou "REPETE" / "REPETE 3x" quando o alvo é a atual. Escondido (`aria-hidden`, sem animação) sem intenção e no loop ∞ da própria seção. X com `aria-label` "Cancelar pulo".
- Play: `aria-label` "Tocar" / "Pausar"; na pré-contagem mostra o número do bipe ouvido; anel pulsa tocando quando a fase do pulso ouvido é menor que 0,14. LOOP aceso com `{ atual, 'infinite' }`. CLICK aceso com `click.on`; sem canal de click, desabilitado com `title` "Esta música não tem canal de click". PRÉ-CONT. aceso com `precount.enabled`.

- [ ] **Step 1: Escrever `src/components/stage/transport.test.tsx`** (`// @vitest-environment jsdom`, rAF falso)

```tsx
it('aviso REPETE 3x na seção atual, com X pra cancelar', () => { /* intent { target: cur, plays: 3 }; fireEvent.click no "Cancelar pulo" -> onCancel */ })
it('acende as bolinhas pelo tempo ouvido', () => { /* heardNow 20.6 -> bolinhas 1 e 2 com data-on="true" */ })
it('mostra o aviso âmbar da grade com pulo armado', () => { /* gridWarning 'sem-click-lido' -> "SEM CLICK LIDO" com title */ })
it('aviso escondido no loop infinito da própria seção', ...)
it('botões do transporte chamam as ações certas', () => { /* COMEÇO, Play, LOOP, CLICK, Metrônomo, PRÉ-CONT., número, ◂, ▸, AUTO/PARAR/FADE */ })
it('CLICK desabilitado sem canal de click', ...)
it('sem palavra proibida em inglês e sem travessão', () => { const t = container.textContent!; expect(t).not.toContain(TRAVESSAO); expect(t).not.toMatch(/\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/transport.test.tsx > "$LOGS/t8.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (só tokens `ps-*`; cor do nome da seção por style inline).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/TransportBar.tsx src/components/stage/NextPill.tsx src/components/stage/PlayButton.tsx src/components/stage/transport.test.tsx
git commit -m "feat(palco): transporte novo e aviso PROXIMA com contagem [Parte 2] [T8]"
```

---

### Tarefa 9: Onda grande com seções, seta do armado e régua

**Onda:** 2. **Depende de:** T1.

**Files:**
- Create: `src/components/stage/WaveformSections.tsx`, `src/components/stage/wavePeaks.ts`, `src/components/stage/waveform.test.tsx`
- Modify: `src/components/SectionBar.tsx` (o `computePeaks` privado sai e ele importa o de `wavePeaks.ts`; nada mais muda)

**Interfaces:**
- Produces:

```ts
// wavePeaks.ts
export function computePeaks(data: Float32Array, buckets: number): Float32Array // maior |x| por balde, normalizado pelo maior; vazio -> zeros (mesma regra do SectionBar)
export function arcPath(x1: number, x2: number, baseY: number, maxLift: number): string // curva do v6 drawArc (996 a 1009)
// WaveformSections.tsx (só o componente)
export interface WaveformSectionsProps {
  peaks: Float32Array | null; duration: number; sections: StageSection[]; currentSection: number; isPlaying: boolean
  intent: ArmIntent | null; loopOn: boolean; barLines: number[] | null; sectionsAllowed: boolean
  clock: Pick<StageClock, 'position'>; onTapSection(i: number): void; onSeek(t: number): void
}
```

- Visual: v5 linhas 109 a 140 e v6 `buildWave` (971 a 995): onda na cor da seção a 34%, parte tocada mais clara (`clip-path` em `useFrame`), linhas de compasso (`barLines`, a cada 4 mais fortes), régua de 22px EMBAIXO da onda com rótulo a cada 30 s (o spec 9b fala em régua no topo; vale o mockup v5). Blocos são `<button>` com `aria-label` "Armar <nome>" tocando e "Ir para <nome>" parado, posição e largura em %, selo com o nome, etiqueta "PRÓXIMA" ou "REPETE" no armado (branco, `animate-ps-stripes` + `animate-ps-armglow`), "LOOP" no atual com loop. Seta tracejada (`arcPath`) do fim da atual até a armada quando o alvo é outra seção. Playhead por `transform` em `useFrame`. Arrastar na régua (`data-testid="regua"`, pointer events, toque) chama `onSeek`, tocando ou parado. Sem o botão "DEMO" do mockup. Sem `sectionsAllowed`: só onda e régua. Canvas com `devicePixelRatio`; `getContext` nulo (jsdom) não desenha.

- [ ] **Step 1: Escrever `src/components/stage/waveform.test.tsx`** (`// @vitest-environment jsdom`; `getBoundingClientRect` da régua simulado com `vi.spyOn`, porque o jsdom devolve zero)

```tsx
it('picos normalizados', () => expect([...computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2)]).toEqual([0.5, 1]))
it('blocos na posição da seção, estado atual e armado', () => { /* left 25%, width 25%; data-state="atual"; armada com PRÓXIMA; intent na atual: REPETE */ })
it('rótulo de acessibilidade muda tocando e parado', ...)
it('toque no bloco arma; arrastar na régua busca', () => { /* click -> onTapSection(2); pointerdown no meio da régua (rect de 1000 px simulado) -> onSeek(duration / 2) */ })
it('seta só quando o alvo é outra seção', ...)
it('Livre: sem blocos', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/waveform.test.tsx > "$LOGS/t9.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** e trocar o `computePeaks` do `SectionBar.tsx` pelo import (o palco antigo desenha igual).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/WaveformSections.tsx src/components/stage/wavePeaks.ts src/components/stage/waveform.test.tsx src/components/SectionBar.tsx
git commit -m "feat(palco): onda grande com blocos de secao, seta do armado e regua [Parte 2] [T9]"
```

---

### Tarefa 10: Botoeira de seções

**Onda:** 2. **Depende de:** T1.

**Files:**
- Create: `src/components/stage/SectionPads.tsx`, `src/components/stage/sectionPadMeta.ts`, `src/components/stage/sectionPads.test.tsx`

**Interfaces:**
- Produces:

```ts
// sectionPadMeta.ts
export function padMeta(s: StageSection, i: number, ctx: { current: number; position: number; transition: TransitionView | null; heardNow: number }): string
// SectionPads.tsx (só o componente)
export interface SectionPadsProps {
  sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null; isPlaying: boolean
  landed: StageView['landed']; gates: StageGates; clock: Pick<StageClock, 'heardNow' | 'position'>; onTap(i: number): void; onUpgrade(): void
}
```

- Visual: v5 linhas 142 a 167 e textos do v6 `frame` (1094 a 1100). Um `<button>` por seção, faixa da cor à esquerda, tecla 1 a 9 nas 9 primeiras, nome (quebra em até 2 linhas, nunca reticências), meta por `padMeta`: início "m:ss" nas outras; na atual "comp. N/M" (com `bars`) ou "m:ss/m:ss"; na armada `transitionWaitText` ("em N comp.") ou "contagem" no último compasso. AGORA (cor da seção), PRÓXIMA ou REPETE / REPETE Nx (branco, animações da T1); progresso na atual; número grande = `countState(...).currentLabel`; brilho de pousou (`animate-ps-land`) quando `landed.index` é a seção. `aria-pressed` na armada; `data-tour="secoes"` no contêiner. Largura mínima de 104px por botão; o que não cabe rola de lado, com a AGORA à vista.
- Livre (`!gates.sections`): "Marque as seções da música e troque de parte ao vivo sem parar a VS." + botão "Conhecer os planos" (`onUpgrade`). Pago sem seções: "Esta música ainda não tem seções. Marque no EDITAR."

- [ ] **Step 1: Escrever `src/components/stage/sectionPads.test.tsx`** (`// @vitest-environment jsdom`)

```tsx
it('um botão por seção com tecla até 9', ...)
it.each([...])('meta %s', (_, ctx, text) => expect(padMeta(sec, idx, ctx)).toBe(text))
it('armada mostra REPETE 3x e o número da contagem', ...)
it('Livre mostra o convite e abre o upgrade', ...)
it('nome longo nunca é cortado', () => { /* elemento do nome sem truncate, text-ellipsis nem line-clamp */ })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/sectionPads.test.tsx > "$LOGS/t10.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/SectionPads.tsx src/components/stage/sectionPadMeta.ts src/components/stage/sectionPads.test.tsx
git commit -m "feat(palco): botoeira de secoes com AGORA, PROXIMA e convite no Livre [Parte 2] [T10]"
```

---

### Tarefa 11: Plano da troca de seção (instante, alvo, contagem e guia)

**Onda:** 2. **Depende de:** T2.

**Files:**
- Create: `src/lib/sectionTransition.ts`, `src/lib/sectionTransition.test.ts`

**Interfaces:**
- Consumes (T2): `sectionIndexAt`, `pulseSeconds`, `barSeconds`, `sanitizeGrid`; (T1): `SongGrid`, `SectionSpan`, `ArmIntent`, `countPulses`.
- Produces:

```ts
export const MIN_LEAD = 0.05
export const GUIDE_MUTE_ON_JUMP = true // spec 9b, R-31: decisão pro dono; false desliga o calar a guia sem mexer em mais nada
export interface TransitionPlan { from: number; to: number; switchAt: number; targetOffset: number; countTimes: number[]; countLabels: number[]; countTotal: number; guideMuteFrom: number | null; barsLeft: number | null }
export function planTransition(a: { spans: readonly SectionSpan[]; grid: SongGrid | null; position: number; intent: ArmIntent; minLead?: number }): TransitionPlan | null
```

- Regras (tempos em segundos da música): `p = position + minLead`; `from = sectionIndexAt(spans, p)`; antes da primeira marca `from = -1` e `switchAt = spans[0].start`. `to = intent.target` (fora da lista ou lista vazia: `null`); `switchAt = spans[from].end`; `targetOffset = spans[to].start`. Grade inválida (`sanitizeGrid` nulo) conta como sem grade. Com grade (inclusive só BPM): `step = pulseSeconds * countEvery`, `countTotal = countPulses(...)`; candidatos `switchAt - k * step` pra `k = countTotal .. 1`, ficam os `>= p`, `countLabels = countTotal - k + 1`; `barsLeft = ceil((switchAt - position) / barSeconds - 1e-6)`. Loop ∞ da própria seção: sem contagem e `guideMuteFrom null`. Sem grade: `countTimes []`, `countTotal 0`, `barsLeft null`. `guideMuteFrom` = primeiro `countTimes` quando `GUIDE_MUTE_ON_JUMP`, senão `null`. Nunca `NaN`.

- [ ] **Step 1: Escrever `src/lib/sectionTransition.test.ts`**

```ts
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const spans = [{ index: 0, start: 0, end: 8 }, { index: 1, start: 8, end: 16 }, { index: 2, start: 16, end: 30 }]
it('contagem inteira no último compasso', () => expect(planTransition({ spans, grid, position: 5, intent: { target: 0, plays: 1 } })).toEqual({
  from: 0, to: 0, switchAt: 8, targetOffset: 0, countTimes: [6, 6.5, 7, 7.5], countLabels: [1, 2, 3, 4], countTotal: 4, guideMuteFrom: 6, barsLeft: 2 }))
it('armou tarde: contagem curta com o número real', () => { const p = planTransition({ spans, grid, position: 6.8, intent: { target: 2, plays: 1 } })!; expect(p.countTimes).toEqual([7, 7.5]); expect(p.countLabels).toEqual([3, 4]); expect(p.switchAt).toBe(8) })
it('armar a menos da folga mínima mira o fim da seção seguinte', () => expect(planTransition({ spans, grid, position: 7.96, intent: { target: 0, plays: 1 } })!.switchAt).toBe(16))
it('6/8 contando 2', () => { const p = planTransition({ spans, grid: { ...grid, bpm: 180, signature: '6/8', countEvery: 3 }, position: 1, intent: { target: 2, plays: 1 } })!; expect(p.countTimes).toEqual([6, 7]); expect(p.countTotal).toBe(2) })
it('BPM salvo sem fase: contagem ancorada no 1 de destino', () => expect(planTransition({ spans, grid: { ...grid, source: 'bpm', bpm: 100 }, position: 5, intent: { target: 0, plays: 1 } })!.countTimes).toEqual([5.6, 6.2, 6.8, 7.4]))
it('loop infinito da própria seção não conta nem cala a guia', ...)
it('sem grade: marca crua, sem contagem', ...)
it('antes da primeira marca vai pro início da primeira', ...)
it('nunca NaN com grade quebrada', () => { const p = planTransition({ spans, grid: { ...grid, bpm: NaN }, position: 5, intent: { target: 1, plays: 1 } })!; expect(Object.values(p).flat().some(Number.isNaN)).toBe(false) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/sectionTransition.test.ts > "$LOGS/t11.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sectionTransition.ts src/lib/sectionTransition.test.ts
git commit -m "feat(secoes): plano da troca com contagem ancorada no 1 do destino [Parte 2] [T11]"
```

---

### Tarefa 12: Barramentos por papel e roteador de saídas

**Onda:** 2. **Depende de:** T6.

**Files:**
- Create: `src/audio/outputGraph.ts`, `src/audio/outputGraph.test.ts`

**Interfaces:**
- Consumes (T6): `OutputPlan`, `planOutputs`, `DEFAULT_OUTPUTS`; (T1): fake de áudio com `reaches`.
- Produces:

```ts
export interface OutputGraph {
  input(role: ChannelRole): GainNode // barramento do papel
  readonly guideGain: AudioParam     // calar a guia no último compasso
  readonly countDelay: DelayNode     // contagem sem canal de click (R-35): liga no barramento do click; o motor ajusta delayTime = L
  readonly master: GainNode          // volume principal: FADE e AUTO continuam aqui
  readonly masterMute: GainNode      // mudo geral
  readonly plan: OutputPlan
  apply(plan: OutputPlan): void      // religa barramentos -> roteador -> principal; barramentos e canais ficam
  levels(): { l: number; r: number } // pico das saídas 1 e 2 (0..1) pro medidor do PRINCIPAL
  dispose(): void
}
export function createOutputGraph(ctx: AudioContext, plan: OutputPlan): OutputGraph
```

- Ligações por modo (R-24): `stereo` e `split2`: os 3 barramentos → `master` (em `split2` quem separa é o pan efetivo por papel, que o motor aplica nos panners com `effectivePan`; o grafo não muda). `multi`: `destination.channelCount = plan.channels`, `channelCountMode 'explicit'`, `channelInterpretation 'discrete'`; `ChannelMerger(plan.channels)`; VS → `ChannelSplitter(2)` → saídas 0 e 1 nas entradas `vs[0]` e `vs[1]`; Click → `ChannelSplitter(2)`, só a saída 0 (lado esquerdo, onde o pan −1 põe tudo) na entrada `click[0]`; Guia igual em `guide[0]`; merger → `master`. Sempre `master → masterMute → destination`; em `stereo`/`split2` o `destination` volta a 2 canais e `'speakers'`. Medidor: `masterMute → ChannelSplitter(2) → 2 AnalyserNode`, fora do caminho do som.

- [ ] **Step 1: Escrever `src/audio/outputGraph.test.ts`**

```ts
it('nenhum caminho dos barramentos click e guia chega a uma saída da VS', () => {
  const ctx = createFakeAudioContext({ maxChannelCount: 8 }); const plan = planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi' }, 8); const g = createOutputGraph(ctx, plan)
  const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
  for (const vsIn of plan.vs) { expect(reaches(g.input('click'), merger, vsIn)).toBe(false); expect(reaches(g.input('guide'), merger, vsIn)).toBe(false); expect(reaches(g.countDelay, merger, vsIn)).toBe(false) }
  expect(reaches(g.input('click'), merger, plan.click[0])).toBe(true)
})
it('stereo e separados ligam os barramentos direto no principal, sem merger', ...)
it('multi configura o destino em discreto com os canais do plano', ...)
it('apply troca o roteador sem recriar os barramentos', () => { /* input('normal') antes === depois; merger antigo desligado */ })
it('caminho final principal -> mudo -> destino', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/audio/outputGraph.test.ts > "$LOGS/t12.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/audio/outputGraph.ts src/audio/outputGraph.test.ts
git commit -m "feat(saidas): barramentos por papel e roteador de saidas [Parte 2] [T12]"
```

---

### Tarefa 13: Faixa do meio (tempo, TOM, seção atual, música, PAD e LETRA)

**Onda:** 3. **Depende de:** T1 (e da base v1.4.16, por causa do solfejo em `pitchRules.ts`).

**Files:**
- Create: `src/components/stage/MidStrip.tsx`, `TimeCell.tsx`, `KeyCell.tsx`, `CurrentSectionCell.tsx`, `SongCell.tsx`, `BigButton.tsx` (em `src/components/stage/`), `src/components/stage/midStrip.test.tsx`, `src/lib/keyNames.ts`, `src/lib/keyNames.test.ts`
- Modify: `src/lib/pitchRules.ts` (exporta `parseKey`, que `keyToSemitone` passa a usar por dentro; resultado igual)

**Interfaces:**
- Consumes (T1): contrato, `GRID_WARNING_TEXT`, `Icon`, `useFrame`; `semitonesBetweenKeys`, `sanitizeSemitones` de `pitchRules.ts`.
- Produces:

```ts
// pitchRules.ts
export function parseKey(key: string | null | undefined): { semitone: number; minor: boolean } | null // mesma regra de keyToSemitone (inclui o solfejo da v1.4.16: "Lá m", "Rém", "Sib")
// keyNames.ts (fonte única dos 12 nomes; a T29 troca as duas cópias de App.tsx por ela)
export const KEY_NAMES: readonly string[] // ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export function transposeKeyName(key: string | null, semitones: number): string | null // nome com sustenido; mantém o "m" de menor pelo parseKey
export function keyIndex(key: string | null): number | null
// componentes (cada .tsx exporta só o componente)
export interface TimeCellProps { duration: number; bpm: number | null; signature: TimeSignature | null; gridWarning: GridWarning | null; editMode: boolean; clock: Pick<StageClock, 'position'>; onOpenMeter(): void }
export interface KeyCellProps { originalKey: string | null; pitch: number; gridOpen: boolean; onGridOpenChange(open: boolean): void; onChangePitch(semitones: number): void }
export interface CurrentSectionCellProps { sections: StageSection[]; currentSection: number; intent: ArmIntent | null; gates: StageGates; clock: Pick<StageClock, 'position'>; onArmRepeat(plays: Plays): void; onToggleLoop(): void; onUpgrade(): void }
export interface SongCellProps { song: StageSong | null; onPrev(): void; onNext(): void }
export interface BigButtonProps { kind: 'pad' | 'letra'; on: boolean; live: boolean; sub: string; onPress(): void }
export interface MidStripProps { view: StageView; actions: StageActions; clock: StageClock; keyGridOpen: boolean; onKeyGridOpenChange(open: boolean): void; onOpenMeter(): void }
```

- Visual: v5 linhas 169 a 258 e 459 a 501; colunas `minmax(214px,1.1fr) minmax(176px,.9fr) minmax(280px,1.3fr) minmax(316px,2fr) minmax(120px,.75fr) minmax(96px,.6fr)`; abaixo de 1700px some o nome do repertório (v6 linha 244).
- **Tempo**: tempo ouvido "mm:ss" grande em mono e "/ m:ss"; "72.0 BPM · 4/4" (`bpm.toFixed(1)`) ou "BPM não informado". Sem os botões de andamento (Projeto 4). Com `gridWarning`, chip âmbar com o rótulo e o `title`. No modo EDITAR a linha vira o botão "Compasso" (`onOpenMeter`).
- **TOM** (`data-tour="tom"`): tom atual (`transposeKeyName`), "original X", selo +2 / −1 (sinal de menos U+2212); a grade de 12 tons abre e fecha pelo `gridOpen` controlado pela casca (T18), `role="dialog"`, original marcado ORIGINAL, atual em laranja; escolher chama `onChangePitch(semitonesBetweenKeys(originalKey, KEY_NAMES[i]))`; −1/+1 chamam `onChangePitch(sanitizeSemitones(pitch ± 1))`; ORIG. chama `onChangePitch(0)`. Sem tom original: grade desabilitada com "Tom original desconhecido".
- **Seção atual**: "comp. N de M" (com barras) ou "m:ss de m:ss", nome na cor da seção, progresso, REPETIR (branco quando armado na atual), seletor − Nx + (1 até `gates.maxRepeats`; mudar N com REPETIR armado re-arma), ∞ (aceso no loop da atual; sem `gates.infinite`, `onUpgrade`). Sem seções: "Sem seções" e controles desabilitados.
- **Música**: capa (ou placeholder com o título), "Música 1 de 6 · <repertório>", título, artista, anterior e "A SEGUIR <nome>" (ou "Fim do repertório", desabilitado).
- **PAD** (`data-tour="pads"`; aceso com o painel aberto; LED musgo piscando com pad tocando; sub "parado" ou "tocando C") e **LETRA** (sub "teleprompter").

- [ ] **Step 1: Escrever os testes**

```ts
it.each([['G', -1, 'F#'], ['Am', 2, 'Bm'], ['Bb', 1, 'B'], ['Lá m', 2, 'Bm'], ['X', 1, null], [null, 0, null]])('transpõe %s', (k, s, out) => expect(transposeKeyName(k, s)).toBe(out))
it('parseKey e keyToSemitone concordam', () => { for (const k of ['C', 'F#m', 'Ebm', 'Sib', 'Rém', 'Lá m']) expect(parseKey(k)!.semitone).toBe(keyToSemitone(k)) })
```
```tsx
it('tempo ouvido, BPM com 1 casa e compasso', ...)
it('aviso âmbar quando o compasso foi assumido', ...)
it('grade de tons escolhe pelo caminho mais curto', () => { /* original G, toca em E -> onChangePitch(-3) */ })
it('Esc da grade é tratado pela casca (a célula só pede pra fechar)', () => { /* gridOpen true; fechar -> onGridOpenChange(false) */ })
it('REPETIR 3x arma a repetição da atual e o ∞ pede upgrade no Livre', ...)
it('A SEGUIR mostra a próxima e fica desabilitado no fim', ...)
it('sem botão de andamento (Projeto 4)', () => expect(screen.queryByText('+5')).toBeNull())
it('sem travessão e sem palavra proibida em inglês', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/keyNames.test.ts src/components/stage/midStrip.test.tsx > "$LOGS/t13.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (e `node scripts/verify-pitch/unit.mjs > "$LOGS/t13-unit.log" 2>&1; echo $?` continua `0` com o `parseKey`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/keyNames.ts src/lib/keyNames.test.ts src/lib/pitchRules.ts src/components/stage/MidStrip.tsx src/components/stage/TimeCell.tsx src/components/stage/KeyCell.tsx src/components/stage/CurrentSectionCell.tsx src/components/stage/SongCell.tsx src/components/stage/BigButton.tsx src/components/stage/midStrip.test.tsx
git commit -m "feat(palco): faixa do meio com tempo, tom, secao atual, musica, PAD e LETRA [Parte 2] [T13]"
```

---

### Tarefa 14: Mixer novo (pan, fader com nível no trilho, M/S, principal)

**Onda:** 3. **Depende de:** T1 (e `ChannelTrashButton` da Parte 1).

**Files:**
- Create: `src/lib/faderScale.ts`, `src/lib/faderScale.test.ts`, `src/components/stage/StageMixer.tsx`, `ChannelStrip.tsx`, `PanKnob.tsx`, `FaderVU.tsx`, `MasterStrip.tsx` (em `src/components/stage/`), `src/components/stage/mixer.test.tsx`

**Interfaces:**
- Produces (`faderScale.ts`, escala do v6 linhas 603, 604, 1110 a 1115):

```ts
export const FADER_ZERO = 0.75
export function faderToDb(f: number): number // f < 0.02 -> -Infinity; f >= 0.75 -> (f - 0.75) / 0.25 * 6; senão 40 * log10(f / 0.75)
export function faderToGain(f: number): number
export function gainToFader(g: number): number // g <= 0 -> 0; g = 1 -> 0.75; teto 1 (+6 dB)
export function dbText(g: number): string // '0.0 dB', '−3.5 dB', '+2.0 dB', '−∞ dB'
export function panText(pan: number): string // 'L50', 'C', 'R30'
export function dragFader(f0: number, dyPx: number, travelPx: number): number
export function dragPan(p0: number, dyPx: number): number // 0,014 por px; |p| < 0,04 vira 0
export function fitStrips(innerWidth: number, gap: number, minWidth: number): { count: number; width: number }
```

- Produces (componentes, cada `.tsx` exporta só o componente):

```ts
export interface ChannelStripProps { ch: StageChannel; panEditable: boolean; editMode: boolean; clock: Pick<StageClock, 'level' | 'heardNow'>; count: TransitionView | null
  onVolume(gain: number): void; onPan(pan: number): void; onMute(): void; onSolo(): void; onEdit(): void; onRemove(): void; dragHandle?: React.HTMLAttributes<HTMLElement> }
export interface MasterStripProps { master: StageView['master']; channelEditMode: boolean; clock: Pick<StageClock, 'masterLevels'>; onVolume(gain: number): void; onToggleMute(): void; onToggleChannelEdit(): void }
export interface StageMixerProps { view: Pick<StageView, 'channels' | 'channelEditMode' | 'outputs' | 'click' | 'transition' | 'master'>; actions: StageActions; clock: StageClock }
```

- Visual: v5 linhas 260 a 313 e v6 1126 a 1167 (`data-tour="mixer"` no mixer). Por canal: PAN (arco na cor do canal, centro marcado, valor ao lado; arrastar na vertical; duplo clique centraliza), fader com o nível segmentado DENTRO do trilho (`clock.level(id)` em `useFrame`), marca de pico e de 0 dB, M e S (`data-touch-exception="ms"`), nome (até 2 linhas, sem reticências). PRINCIPAL (116px): EDITAR CANAIS, fader com medidor L/R e escala +6 / 0 / −12 / −24 / −∞, M (mudo geral), "PRINCIPAL".
- **Fader só muda arrastando** (o arrasto começa depois de 3 px; toque sem arrastar não muda nada; duplo clique volta a 0 dB). Balão com `dbText` durante o arrasto. Solo escurece os outros (`ch.silenced`); M apaga (faixa cinza, `channelFaderFill` da Parte 1).
- `panEditable` = `!(outputs.mode === 'split2')` pra todos e, em `multi`, só pros canais `normal`. Sem edição, o knob fica apagado, não arrasta e tem `title` "Com Click e Guia separados o pan não decide a saída".
- Balão branco com o número da contagem no canal de Click, por `countState(count, clock.heardNow()).currentLabel`.
- Modo EDITAR CANAIS: lápis (`onEdit`), alça de arrastar (pointer events, funciona no toque; `actions.reorderChannel`) e `ChannelTrashButton` da Parte 1.
- Largura: `fitStrips` com mínimo de 76px; o que não cabe rola de lado com canais inteiros.

- [ ] **Step 1: Escrever os testes**

```ts
it.each([[0.75, 0], [1, 6], [0.375, 40 * Math.log10(0.5)], [0.01, -Infinity]])('faderToDb(%s)', (f, db) => expect(faderToDb(f)).toBeCloseTo(db, 6))
it('ida e volta do ganho', () => { for (const g of [0, 0.1, 0.5, 1, 1.5, 1.99]) expect(faderToGain(gainToFader(g))).toBeCloseTo(g, 4) })
it.each([[1, '0.0 dB'], [0, '−∞ dB'], [0.5, '−6.0 dB']])('dbText(%s)', (g, t) => expect(dbText(g)).toBe(t))
it.each([[-0.5, 'L50'], [0, 'C'], [0.3, 'R30']])('panText(%s)', (p, t) => expect(panText(p)).toBe(t))
it('14 canais em 1280px cabem inteiros', () => expect(fitStrips(1114, 0, 76).count).toBe(14))
```
```tsx
it('toque no fader não muda o volume; arrastar muda; duplo clique volta a 0 dB', ...)
it('duplo clique no pan centraliza', ...)
it('pan travado com Click e Guia separados', ...)
it('M e S marcados como exceção de toque', () => { for (const b of screen.getAllByRole('button', { name: /^(M|S)$/ })) expect(b.dataset.touchException).toBe('ms') })
it('balão da contagem só no canal de click', ...)
it('modo EDITAR CANAIS mostra lápis, alça e lixeira de 2 toques', ...)
it('nome do canal nunca é cortado', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/faderScale.test.ts src/components/stage/mixer.test.tsx > "$LOGS/t14.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/faderScale.ts src/lib/faderScale.test.ts src/components/stage/StageMixer.tsx src/components/stage/ChannelStrip.tsx src/components/stage/PanKnob.tsx src/components/stage/FaderVU.tsx src/components/stage/MasterStrip.tsx src/components/stage/mixer.test.tsx
git commit -m "feat(palco): mixer novo com pan, nivel no trilho, fader so arrastando e principal [Parte 2] [T14]"
```

---

### Tarefa 15: Barra do app, painel REPERTÓRIOS (lista + Anotações) e painel de pads

**Onda:** 3. **Depende de:** T1 (e `useTwoTapConfirm` da Parte 1).

**Files:**
- Create: `src/components/stage/StageAppBar.tsx`, `RepertoirePanel.tsx`, `PadPanel.tsx`, `TwoTapTrashButton.tsx` (em `src/components/stage/`), `src/components/stage/panels.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface StageAppBarProps { app: StageView['app']; editMode: boolean; actions: Pick<StageActions, 'openRepertoires' | 'openTracks' | 'openLibrary' | 'toggleEditMode' | 'openHost' | 'openSettings' | 'goHome' | 'signOut'> }
export interface RepertoireSongItem { id: string; name: string; artist?: string; coverImage?: string; originalKey?: string | null; bpm?: number | null }
export interface RepertoirePanelProps {
  open: boolean; songs: RepertoireSongItem[]; activeIndex: number; isPlaying: boolean; notes: string
  onNotesChange(v: string): void; onSelect(i: number): void; onReorder(from: number, to: number): void; onRemove(id: string): void
  onNew(): void; onExport(): void; onImport(file: File): void; onClose(): void
}
export interface PadPanelProps {
  open: boolean; onClose(): void; view: 'pads' | 'samples' | 'loops'; onViewChange(v: PadPanelProps['view']): void
  notes: readonly string[]; activeNote: string | null; songKeyIndex: number | null; volume: number; setName: string | null
  onPlayNote(note: string): void; onVolume(v: number): void; onOpenSets(): void; onEditPads(): void
  samples?: React.ReactNode; loops?: React.ReactNode
}
export interface TwoTapTrashButtonProps { label: string; confirmLabel: string; onConfirm(): void } // lixeira genérica de 2 toques (a ChannelTrashButton da Parte 1 diz "Apagar o canal" e não serve pra música)
```

- **Barra do app** (v5 linhas 35 a 48 e 392 a 402): PlayMark + "Playback *Studio*", selo ONLINE (musgo) ou OFFLINE (neutro, não é alerta), REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR (aceso no modo EDITAR), HOST (só `isDesktop`; aceso com host ligado), CONFIG, INÍCIO, avatar e SAIR; botões de 44px. `data-tour`: `repertorios`, `faixas`, `biblioteca`, `editar`, `host`, `config`, `inicio`.
- **REPERTÓRIOS** (`role="dialog"`, `aria-label="Repertório"`, gaveta da esquerda, `data-tour="setlist-area"` na lista): Novo (2 toques, "Limpar o repertório?"), Salvar .zip, Carregar .zip, lista (capa, nome, artista, tom, BPM; toque escolhe; a ativa marcada "tocando"; alça de reordenar que funciona no toque; `TwoTapTrashButton` com `label` "Tirar <nome> do repertório"), Anotações (`textarea` de 16px, `data-tour="anotacoes"`), X.
- **Pads** (v5 linhas 315 a 352 e 519 a 532): abas PADS / SAMPLES / LOOPS, grade 4x3 de C a B com "TOM" no tom da música e equalizador no pad tocando, CONJUNTO, Volume (arrastar ou tocar no trilho), EDITAR, X; SAMPLES e LOOPS mostram os nós recebidos.
- **Esc** (achado 8): cada painel aberto escuta `keydown` em `document` na fase de CAPTURA enquanto está aberto; no Esc fecha e chama `preventDefault()` (o atalho global da T18 ignora evento com `defaultPrevented`).

- [ ] **Step 1: Escrever `src/components/stage/panels.test.tsx`** (`// @vitest-environment jsdom`)

```tsx
it('HOST só no desktop e EDITAR aceso no modo editar', ...)
it('OFFLINE não usa cor de alerta', ...)
it('repertório: escolher, reordenar, tirar música com 2 toques e anotar', ...)
it('lixeira genérica anuncia o rótulo recebido, não "canal"', ...)
it('Novo pede o segundo toque antes de limpar', ...)
it('pads: toca a nota, marca o tom da música', ...)
it('Esc fecha o painel e marca o evento como tratado', () => { /* fireEvent.keyDown(document, { key: 'Escape' }) -> onClose e evento com defaultPrevented */ })
it('textos em português, sem travessão', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/panels.test.tsx > "$LOGS/t15.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/StageAppBar.tsx src/components/stage/RepertoirePanel.tsx src/components/stage/PadPanel.tsx src/components/stage/TwoTapTrashButton.tsx src/components/stage/panels.test.tsx
git commit -m "feat(palco): barra do app, painel REPERTORIOS com anotacoes e painel de pads [Parte 2] [T15]"
```

---

### Tarefa 16: Modo EDITAR do palco: marcar, ajustar e remover seções; compasso

**Onda:** 3. **Depende de:** T2, T9 (`SectionBar.tsx`) (e `useTwoTapConfirm` da Parte 1).

**Files:**
- Create: `src/lib/sectionTypes.ts`, `src/lib/sectionEdit.ts`, `src/lib/sectionEdit.test.ts`, `src/components/stage/SectionEditBar.tsx`, `src/components/stage/MeterEditor.tsx`, `src/components/stage/editMode.test.tsx`
- Modify: `src/components/SectionBar.tsx` (`SECTION_SHORTCUTS` e `colorForSection` passam a vir de `src/lib/sectionTypes.ts` e são reexportados; quem importa do `SectionBar` continua funcionando)

**Interfaces:**
- Consumes (T2): `snapToBar`, `barSeconds`, `gridHasPhase`; (T1): `SongGrid`, `TimeSignature`, `TIME_SIGNATURES`, `isCompound`, `TwoTapTrashButton` (T15, mesma onda: usar `useTwoTapConfirm` direto, não o botão); `Marker` de `src/types.ts`.
- Produces:

```ts
// sectionTypes.ts (puro, sem React)
export const SECTION_SHORTCUTS: { name: string; key: string; code: string; color: string }[] // os 6 de hoje, iguais
export function colorForSection(label: string): string
// sectionEdit.ts
export function addSectionAt(markers: readonly Marker[], time: number, label: string, grid: SongGrid | null, newId: () => string): Marker[]
export function nudgeSection(markers: readonly Marker[], markerId: string, bars: number, grid: SongGrid | null): Marker[]
export function removeSection(markers: readonly Marker[], markerId: string): Marker[]
// componentes
export interface SectionEditBarProps { sections: StageSection[]; selected: number | null; hasGrid: boolean; onSelect(i: number): void; onMark(label: string): void; onNudge(i: number, dir: -1 | 1): void; onRemove(i: number): void }
export interface MeterEditorProps { grid: SongGrid | null; songBpm: number | null; busy: boolean; onChange(sig: TimeSignature, countEvery: 1 | 3): void; onRedetect(): void; onClose(): void }
```

- Regras: `addSectionAt` encaixa (`snapToBar`); marca a menos de meio compasso (ou 0,5 s sem fase) troca o rótulo e a cor dela em vez de duplicar; cor por `colorForSection`; lista ordenada; nunca muta a recebida. `nudgeSection` move `bars` compassos (sem fase, `bars` segundos), sem passar da vizinha (folga 0,1 s) nem de 0. Operações por `markerId` (a T29 traduz o índice do bloco com `markerIdForSpan` da T2).
- **Barra de edição** (no lugar da botoeira): MARCAR com os 6 tipos (nome, tecla I V P R B F, cor), cria na posição ouvida; toque seleciona; pra selecionada "◂ 1 comp." / "1 comp. ▸" (ou "1 s") e lixeira de 2 toques; dica "Toque numa seção pra ajustar".
- **Compasso** (`role="dialog"`, Esc pela regra de captura da T15): `Segmented` com `TIME_SIGNATURES`; em 6/8 e 12/8 "Contar 6" / "Contar 2" (12/8: "Contar 12" / "Contar 4"); origem do BPM ("Lido no click", "BPM salvo da música, sem o 1 do compasso") e do compasso ("Lido no acento do click", "Salvo na biblioteca", "Assumido 4/4", "Escolhido por você"); BPM com 2 casas; "Ler o click de novo" (relê BPM e fase e mantém o compasso escolhido; desabilitado com "Lendo o click..." quando `busy`).

- [ ] **Step 1: Escrever os testes**

```ts
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('marca nova nasce encaixada e colorida', () => expect(addSectionAt([], 8.3, 'Refrão', grid, () => 'n')).toEqual([{ id: 'n', time: 8, label: 'Refrão', color: '#FF6B35' }]))
it('marca perto de outra troca o rótulo em vez de duplicar', ...)
it('ajustar 1 compasso respeita as vizinhas', ...)
it('sem fase ajusta em segundos e não encaixa', ...)
it('sectionTypes é igual ao que o SectionBar exportava', ...)
```
```tsx
it('MARCAR cria pelo tipo e mostra a tecla', ...)
it('remover pede o segundo toque', ...)
it('compasso composto oferece contar 6 ou 2', ...)
it('origem do compasso em português e botão ocupado lendo o click', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/sectionEdit.test.ts src/components/stage/editMode.test.tsx > "$LOGS/t16.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sectionTypes.ts src/lib/sectionEdit.ts src/lib/sectionEdit.test.ts src/components/stage/SectionEditBar.tsx src/components/stage/MeterEditor.tsx src/components/stage/editMode.test.tsx src/components/SectionBar.tsx
git commit -m "feat(palco): modo EDITAR com marcar, ajustar e remover secoes e o compasso [Parte 2] [T16]"
```

---

### Tarefa 17: Agendador da troca de seção

**Onda:** 4. **Depende de:** T4, T5, T7, T11.

**Files:**
- Create: `src/audio/sectionScheduler.ts`, `src/audio/sectionScheduler.test.ts`

**Interfaces:**
- Consumes: `planTransition`, `MIN_LEAD` (T11); `afterLanding`, `armLabel`, `isSelfLoop` (T4); `positionAt`, `ctxTimeOf`, `withSegment`, `dropFrom` (T5); `Voice`, `fadeOutVoices`, `restoreVoices`, `stopVoices`, `scheduleCount`, `ScheduledCount` (T7).
- Produces:

```ts
export const HORIZON = 0.3, FADE = 0.005, CANCEL_GUARD = 0.03, RELEASE_AFTER = 0.03
export interface SchedulerDeps {
  ctx: BaseAudioContext; rate(): number
  timeline(): readonly TimelineSegment[]; setTimeline(next: TimelineSegment[]): void
  spans(): readonly SectionSpan[]; grid(): SongGrid | null
  currentVoices(): readonly Voice[]; setCurrentVoices(v: Voice[]): void
  startSwitchVoices(T: number, targetOffset: number, fade: number): Voice[] // o motor cria uma voz por canal com startVoicesForSwitch
  countDestination(): AudioNode | null   // entrada do canal de click, ou o countDelay do roteador
  guideGain(): AudioParam | null
  entryLatency(): number                 // atraso da entrada de click/guia (compensação do tom), 0 no tom 0
  clickAudible(): boolean
  onView(view: TransitionView | null, intent: ArmIntent | null): void
  onLanded(to: number, at: number): void
}
export class SectionScheduler {
  constructor(deps: SchedulerDeps) // campos atribuídos no corpo (erasableSyntaxOnly: sem propriedade no construtor)
  get intent(): ArmIntent | null
  get view(): TransitionView | null
  setIntent(next: ArmIntent | null): void // re-planeja já (chama tick)
  tick(): void                            // relógio (25 ms) e logo depois de cada play()
  reset(): void                           // pausa, busca, troca de música, reinício do play: desfaz o agendado, guarda a intenção
  dispose(): void
}
```

- Comportamento (Arquitetura A): cada `tick` lê `now`, calcula `planTransition` em `positionAt(timeline, now)` e converte pro contexto com `ctxTimeOf(timeline, t, now)` (segmento vigente em `now`, nunca o futuro). Fora do horizonte só publica a `view` (`committed: false`). Ao entrar no horizonte, agenda uma vez: `scheduleCount` em `countDestination()`; no `guideGain()`, se o plano tem `guideMuteFrom`, `setValueAtTime(1, início + L)`, `linearRampToValueAtTime(0, início + L + 0,01)`, `setValueAtTime(0, T + L)`, `linearRampToValueAtTime(1, T + L + 0,01)`; `fadeOutVoices(atuais, T, FADE)`; `startSwitchVoices(T, alvo, FADE)`; `setTimeline(withSegment(timeline, { ctxStart: T, songStart: alvo }))`. Com `now >= T + FADE + RELEASE_AFTER`: `stopVoices(antigas, now)`, as novas viram as atuais, `onLanded(to, T)`, intenção = `afterLanding`, e já planeja a próxima volta. Cancelar com `now < T - CANCEL_GUARD`: `count.cancel(now)`, guia `cancelScheduledValues(now)` + `setValueAtTime(1, now)`, `restoreVoices(antigas, now)`, `stopVoices(novas, now)`, `setTimeline(dropFrom(timeline, T))`. Trocar o alvo agendado: refaz só as vozes novas; se o plano novo não tem contagem (loop ∞ da própria seção), também cancela os bipes e devolve a guia (achado 45). Depois de `T - CANCEL_GUARD` o pulo acontece e o cancelamento vale logo depois. Sem `countDestination()`: sem bipes, o pulo acontece. `onView` só quando muda algo visível.

- [ ] **Step 1: Escrever `src/audio/sectionScheduler.test.ts`** (fake da T1 com `currentTime` controlado e dependências falsas que registram chamadas; grade 120 4/4, seções [0,8] [8,16], tocando desde 0 em ctx 0)

```ts
it('nada é agendado antes do horizonte', () => { s.setIntent({ target: 0, plays: 1 }); ctx.currentTime = 1; s.tick(); expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0); expect(deps.startSwitchVoices).not.toHaveBeenCalled(); expect(s.view!.committed).toBe(false) })
it('agenda contagem, guia, vozes e linha do tempo ao entrar no horizonte, uma vez só', () => { /* ctx 5.8: 4 bipes em 6, 6.5, 7, 7.5; guia com eventos em 6 e 8; startSwitchVoices(8, 0, 0.005); timeline com { ctxStart: 8, songStart: 0 }; segundo tick não agenda de novo */ })
it('calar a guia usa o tempo ouvido (soma a latência da entrada)', () => { /* entryLatency 0.12: guia em 6.12 e 8.12; bipes continuam em 6..7.5 */ })
it('com GUIDE_MUTE_ON_JUMP falso a guia não é tocada', ...) // via vi.mock do módulo da T11
it('cancelar depois de agendado para os bipes, devolve a guia e as vozes antigas', () => { /* ctx 6.6: setIntent(null) -> stop em 6.6; guia em 1; antigas restauradas; novas paradas; timeline sem o segmento de 8 */ })
it('cancelar a menos de 30 ms do 1 deixa pousar e desarma depois', ...)
it('trocar o alvo durante a contagem troca só as vozes novas', () => { /* alvo 0 -> 1 em ctx 6.6: bipes intocados; startSwitchVoices(8, 8, 0.005) */ })
it('trocar pro loop infinito da própria seção cancela os bipes e devolve a guia', ...)
it('pousa, solta as vozes antigas e a segunda volta do REPETIR usa o segmento novo', () => { /* intent { 0, 2 }: depois de pousar em 8, a próxima volta mira 16 (8 + 8) convertida pelo segmento vigente */ })
it('loop infinito da própria seção sem bipe e sem mexer na guia', ...)
it('reset cancela o agendado e o próximo tick re-planeja na linha do tempo nova', ...)
it('sem destino da contagem o pulo acontece sem bipes', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/audio/sectionScheduler.test.ts > "$LOGS/t17.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/audio/sectionScheduler.ts src/audio/sectionScheduler.test.ts
git commit -m "feat(secoes): agendador da troca de secao no relogio do audio [Parte 2] [T17]"
```

---

### Tarefa 18: Casca do palco, atalhos de teclado e regra de tamanho de tela

**Onda:** 4. **Depende de:** T8, T9, T10, T13, T14, T15, T16 (e T2).

**Files:**
- Create: `src/components/stage/StageShell.tsx`, `src/components/stage/useStageShortcuts.ts`, `src/components/stage/stageKeys.ts`, `src/components/stage/useStageViewport.ts`, `src/components/stage/stageShell.test.tsx`, `src/components/stage/stageKeys.test.ts`

**Interfaces:**
- Consumes: componentes de T8 a T10 e T13 a T16; `barSeconds`, `nearestBarLine`, `pulseSeconds`, `gridHasPhase` (T2/T1); `SECTION_SHORTCUTS` (T16, `src/lib/sectionTypes.ts`).
- Produces:

```ts
// StageShell.tsx (só o componente)
export interface StageShellProps {
  view: StageView; actions: StageActions; clock: StageClock; peaks: Float32Array | null
  pads: Omit<PadPanelProps, 'open' | 'onClose'>
  slots: { repertoire: React.ReactNode; tracksMenu?: React.ReactNode; adminTools?: React.ReactNode; channelEditPanel?: React.ReactNode }
  keyboardEnabled: boolean
}
// stageKeys.ts
export type StageKeyAction =
  | { kind: 'togglePlay' } | { kind: 'tapSection'; index: number } | { kind: 'stepSection'; dir: -1 | 1 } | { kind: 'seekBy'; dt: number }
  | { kind: 'escape' } | { kind: 'toggleLoop' } | { kind: 'mark'; label: string }
export function stageKeyAction(e: { code: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean; targetTag?: string; targetEditable?: boolean }, ctx: { editMode: boolean; sectionCount: number }): StageKeyAction | null
export function isWideStage(width: number, height: number): boolean // width >= 1024 && height >= 600
// useStageShortcuts.ts
export function useStageShortcuts(view: StageView, actions: StageActions, opts: { enabled: boolean }): void
// useStageViewport.ts
export function useStageViewport(): { wide: boolean }
```

- Layout (alturas do v5: barra 44px; transporte `clamp(72px,9vh,88px)`; onda `flex 1.15`, mínimo 136px; botoeira `clamp(64px,8vh,82px)`; faixa do meio `clamp(168px,20vh,208px)`; mixer `flex 1`, mínimo 220px; gutter 16px): `StageAppBar`, `TransportBar` (pulso do Play por `pulseSeconds` e `firstDownbeat` quando a grade tem fase), `WaveformSections` (barras por `barSeconds`/`nearestBarLine`), `SectionPads` ou `SectionEditBar` no modo EDITAR, `MidStrip` (estado `keyGridOpen` mora aqui), `StageMixer` + `MasterStrip`, `PadPanel` por cima do mixer com `right` = largura do PRINCIPAL + gap. REPERTÓRIOS como gaveta; ferramentas do admin abaixo da barra de edição, só no modo EDITAR; `MeterEditor` com `busy = view.isReadingGrid`.
- Atalhos (`stageKeyAction`): Espaço tocar/pausar; 1 a 9 `tapSection` (se a seção existe); ←/→ `stepSection`; Shift+←/→ `seekBy` ±5; Esc: fecha a grade de tom se aberta, senão `cancelArm`; L loop; I V P R B F marcam só no modo EDITAR. Ignora com `defaultPrevented` (painéis e diálogos tratam o próprio Esc na captura, T15/T16), Meta/Ctrl/Alt, foco em `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`, e `repeat` em Espaço, números e L.

- [ ] **Step 1: Escrever os testes**

```ts
it.each([
  [{ code: 'Space' }, { kind: 'togglePlay' }], [{ code: 'Digit3' }, { kind: 'tapSection', index: 2 }], [{ code: 'Digit9' }, null],
  [{ code: 'ArrowLeft' }, { kind: 'stepSection', dir: -1 }], [{ code: 'ArrowRight', shiftKey: true }, { kind: 'seekBy', dt: 5 }],
  [{ code: 'KeyR' }, null], [{ code: 'KeyR', edit: true }, { kind: 'mark', label: 'Refrão' }], [{ code: 'KeyL' }, { kind: 'toggleLoop' }],
  [{ code: 'Space', repeat: true }, null], [{ code: 'Space', targetTag: 'TEXTAREA' }, null], [{ code: 'Digit1', metaKey: true }, null],
  [{ code: 'Escape', defaultPrevented: true }, null], [{ code: 'Escape' }, { kind: 'escape' }],
])('tecla %o', (e, out) => expect(stageKeyAction(key(e), { editMode: !!e.edit, sectionCount: 5 })).toEqual(out))
it.each([[1024, 600, true], [1023, 800, false], [1280, 599, false]])('palco largo %s x %s', (w, h, ok) => expect(isWideStage(w, h)).toBe(ok))
```
```tsx
it('monta as faixas na ordem do mockup', ...)
it('modo EDITAR troca a botoeira pela barra de edição', ...)
it('Esc com a grade de tom aberta fecha a grade e não cancela o pulo', ...)
it('painel de pads não cobre o PRINCIPAL', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/stageShell.test.tsx src/components/stage/stageKeys.test.ts > "$LOGS/t18.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/StageShell.tsx src/components/stage/useStageShortcuts.ts src/components/stage/stageKeys.ts src/components/stage/useStageViewport.ts src/components/stage/stageShell.test.tsx src/components/stage/stageKeys.test.ts
git commit -m "feat(palco): casca do palco novo, atalhos de teclado e regra de tela [Parte 2] [T18]"
```

---

### Tarefa 19: Configurações de saída e chave do palco

**Onda:** 4. **Depende de:** T6.

**Files:**
- Create: `src/components/settings/AudioOutputsSection.tsx`, `src/components/settings/StageVersionSetting.tsx`, `src/components/settings/settings.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface AudioOutputsSectionProps { outputs: OutputSettings; maxChannels: number; supportsDevicePick: boolean; onChange(next: OutputSettings): void }
export interface StageVersionSettingProps { value: StageVersion; onChange(v: StageVersion): void }
```

- **Saídas de áudio**: `Segmented` "Tudo junto" / "Click e Guia separados" / "4 ou mais saídas" (a terceira desabilitada com `maxChannels < 4` e "Esta saída tem N canais"); em "separados", "Click e Guia na saída 1 | 2"; em "4 ou mais", três seletores (VS estéreo por pares; Click; Guia) com `multiChoices`; resumo `outputSummary(planOutputs(...))` sempre visível; com `fellBackFrom`, em âmbar: "Esta placa tem só 2 canais. Usando Click e Guia na saída 1 e a VS na saída 2." Sem `supportsDevicePick`: "Neste navegador o som sai pela saída do sistema." Alvos de 44px; seletores com fonte de 16px.
- **Palco**: `Segmented` "Novo" / "Antigo" com "Se o palco novo der problema no culto, volte pro antigo aqui. Vale na próxima vez que a música parar. O repertório e o som não mudam."

- [ ] **Step 1: Escrever `src/components/settings/settings.test.tsx`** (`// @vitest-environment jsdom`): `4 ou mais saídas desabilitado em placa de 2 canais`; `mudar o lado do click chama onChange com earOnSecond`; `resumo e aviso de queda em português`; `chave do palco alterna Novo e Antigo`; `sem travessão`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/settings/settings.test.tsx > "$LOGS/t19.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AudioOutputsSection.tsx src/components/settings/StageVersionSetting.tsx src/components/settings/settings.test.tsx
git commit -m "feat(config): saidas de audio separadas e chave do palco [Parte 2] [T19]"
```

---

### Tarefa 20: Verificador de texto cortado e de alvos de toque

**Onda:** 5. **Depende de:** T18, T19.

**Files:**
- Create: `scripts/verify-layout/index.html`, `main.tsx`, `fixture.ts`, `check.ts`, `vite.config.ts`, `run.mjs`, `README.md`, `.gitignore` (todos em `scripts/verify-layout/`)
- Modify (só classes, só no passo 3; é a única tarefa da onda que mexe em componentes): `src/components/stage/*.tsx`, `src/components/settings/*.tsx`

- `fixture.ts`: `StageView` de exemplo com 14 canais (nomes organizados mais longos da Parte 1, como "Percussão Dedilhado Ambiente"), 9 seções (uma "Refrão Final Estendido"), música e artista longos, 6 no repertório. Variantes por query `?estado=`: `normal`, `contando`, `pads`, `editar`, `livre`, `repertorio` (gaveta aberta), `tom` (grade de tons aberta), `compasso` (diálogo do compasso aberto), `config` (as duas seções da T19 numa página própria, com placa de 2 e de 8 canais) e `quebrado` (botão de largura fixa com texto longo, só pra provar que o verificador pega). `StageActions` vazias e `StageClock` parado (contagem no tempo 2).
- `main.tsx` importa `src/index.css` e monta a variante. `vite.config.ts`: raiz `scripts/verify-layout`, `@vitejs/plugin-react` + `@tailwindcss/vite`, saída em `.build`.
- `check.ts` (roda na página e manda o resultado por POST, como o `verify-pitch`): pra todo elemento com texto próprio: (a) nada cortado (`scrollWidth`/`scrollHeight` contra `client*` quando o `overflow` não é `visible`, e o retângulo do texto dentro de todo ancestral com `overflow` diferente de `visible`); (b) nada encostando (em `button`, `[role=radio]` e chips, texto a pelo menos 4px das bordas na horizontal); (c) toque (`button`, `[role=button]`, `[role=radio]`, `input`, `select` com 44x44; com `data-touch-exception="ms"`, 32x30); (d) sem rolagem horizontal da página. Falha sai com seletor, texto e medidas.
- `run.mjs`: `vite build` com essa config, servidor local, Chrome headless (`--headless=new`, `--window-size=W,H`, `CHROME` igual ao do `verify-pitch`) nos 5 tamanhos e nas 9 variantes normais (45 combinações); `--estado quebrado` roda só a de prova.

- [ ] **Step 1: Montar o verificador e rodar contra o palco.** Run: `node scripts/verify-layout/run.mjs > "$LOGS/t20.log" 2>&1; echo $?`. Na primeira rodada pode dar `1` com a lista.
- [ ] **Step 2: Provar que pega erro.** Run: `node scripts/verify-layout/run.mjs --only 1280x800 --estado quebrado > "$LOGS/t20b.log" 2>&1; echo $?`. Expected: `1` com o botão listado.
- [ ] **Step 3: Corrigir o que apontar** só nas classes dos componentes, um commit por correção (`fix(palco): ... [T20]`), até a rodada normal dar `0`.
- [ ] **Step 4: Rodar de novo.** Expected: `0` nas 45 combinações.
- [ ] **Step 5: Commit**

```bash
git add scripts/verify-layout/index.html scripts/verify-layout/main.tsx scripts/verify-layout/fixture.ts scripts/verify-layout/check.ts scripts/verify-layout/vite.config.ts scripts/verify-layout/run.mjs scripts/verify-layout/README.md scripts/verify-layout/.gitignore
git commit -m "test(palco): verificador de texto cortado e alvos de toque em 5 tamanhos de tela [Parte 2] [T20]"
```

(O `.gitignore` do diretório ignora `results/` e `.build/`.)

---

### Tarefa 21: Paleta de famílias aprovada

**Onda:** 1 (ou qualquer onda seguinte, se o P4 atrasar). **Depende de:** P4, M5 (`channelNames.ts`), base v1.4.16 (`channelRoles.test.ts`).

**Files:**
- Modify: `src/lib/channelNames.ts` (só `FAMILY_COLOR`), `src/lib/channelNames.test.ts` (igualdade do `FAMILY_COLOR`), `src/lib/channelRoles.test.ts` (cor da bateria), `src/lib/channelRoles.ts` (só o comentário de `channelFaderFill` que cita "o vermelho é a cor da família Bateria")

- Proposta pro dono aprovar no P4 (nenhuma cor de canal repete laranja ligado, branco armado, âmbar alerta, vermelho do M ou amarelo do S; as que repetiam cor de seção saem dela):

| Família | Hoje | Proposta | Por quê |
|---|---|---|---|
| click | `#FF6B35` | `#94a3b8` (ardósia) | laranja = ligado |
| guia | `#f59e0b` | `#a8a29e` (pedra) | cor da Pré e quase o âmbar de alerta |
| bateria | `#ef4444` | `#d4a373` (areia) | vermelho do M |
| percussao | `#f97316` | `#b08968` (caramelo) | quase o laranja ligado |
| baixo | `#22c55e` | `#22c55e` | mantém |
| synthBass | `#16a34a` | `#16a34a` | mantém |
| violao | `#ec4899` | `#2dd4bf` (turquesa) | cor do Final |
| guitarra | `#f43f5e` | `#14b8a6` (verde-água) | quase o vermelho do M |
| teclado | `#8b5cf6` | `#818cf8` (anil) | cor da Ponte |
| piano | `#a855f7` | `#a5b4fc` (anil claro) | quase a Ponte |
| pad | `#6366f1` | `#6366f1` | mantém |
| ambiencia | `#818cf8` | `#93c5fd` (céu claro) | o anil passa pro teclado |
| vocal | `#06b6d4` | `#06b6d4` | mantém |
| backing | `#0ea5e9` | `#67e8f9` (ciano claro) | separa do vocal |
| desconhecido | `#9d9da8` | `#7a7a85` | separa do click |

- [ ] **Step 1: Atualizar os testes pra tabela APROVADA** e acrescentar `it('nenhuma cor de família repete cor de estado', () => { for (const c of Object.values(FAMILY_COLOR)) expect(['#ff6b35', '#f5f5f7', '#fbbf24', '#ef4444', '#facc15']).not.toContain(c.toLowerCase()) })`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/channelNames.test.ts src/lib/channelRoles.test.ts > "$LOGS/t21.log" 2>&1; echo $?`.
- [ ] **Step 3: Trocar os valores e o comentário.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/channelNames.ts src/lib/channelNames.test.ts src/lib/channelRoles.test.ts src/lib/channelRoles.ts
git commit -m "fix(canais): paleta de familias sem repetir cor de estado nem de secao [Parte 2] [T21]"
```

**Linha pro FATOS:** cores de família do mixer revistas (Click ardósia, Guia pedra, Bateria areia...), sem repetir as cores de estado.

---

### Tarefa 22: Repertório v3 com a grade da música

**Onda:** 2. **Depende de:** T2, T24 (`types.ts`), base v1.4.16 (`useAudioEngine.persistence.test.ts`).

**Files:**
- Modify: `src/lib/repertoireSchema.ts`, `src/lib/repertoireSchema.test.ts`, `src/types.ts` (`Song` ganha `grid?: SongGrid` e `timeSignature?: TimeSignature`), `src/hooks/useAudioEngine.persistence.test.ts` (os literais `schemaVersion: 2` viram `REPERTOIRE_SCHEMA_VERSION`)

**Interfaces:**
- Produces: `REPERTOIRE_SCHEMA_VERSION = 3`; `SavedSong` ganha `grid?: SongGrid` e `timeSignature?: TimeSignature`; `toSavedSong` grava `sanitizeGrid(song.grid) ?? undefined` e `timeSignature`; `migrateSavedSong` leva v1 e v2 pra v3 sem perder nada e descarta grade inválida. O manifest do ZIP não leva a grade (o ZIP nunca levou marcadores nem tom); ao importar, a grade é lida de novo do click.
- [ ] **Step 1: Testes**: `migrateSavedSong preserva um registro v2 real inteiro e marca v3`; `grade com bpm NaN é descartada e o resto fica`; `compasso manual sobrevive a toSavedSong e migrate`; `registro v1 real da Parte 1 chega em v3 igual` (fixture da T5 da Parte 1); a suíte `useAudioEngine.persistence.test.ts` passa com a constante.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/repertoireSchema.test.ts src/hooks/useAudioEngine.persistence.test.ts > "$LOGS/t22.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/repertoireSchema.ts src/lib/repertoireSchema.test.ts src/types.ts src/hooks/useAudioEngine.persistence.test.ts
git commit -m "feat(repertorio): v3 guarda a grade e o compasso da musica [Parte 2] [T22]"
```

---

### Tarefa 23: Nuvem: BPM com decimais e compasso nos 3 lugares

**Onda:** 0. **Depende de:** base.

**Files:**
- Create: `db/supabase-bpm-exact-migration.sql`, `src/lib/cloudBpm.ts`, `src/lib/cloudBpm.test.ts`
- Modify: `api/insert-song.ts`, `src/lib/supabase.ts` (`CloudSong`, `insertSong`, `updateSong`), `src/hooks/useCloudLibrary.ts` (`downloadSong`), `src/lib/offlineCache.ts` (`getCachedSong`), `src/components/LibraryModal.tsx` (edição do BPM, `onSongEdited`, `updateCachedSongMeta`, `extra` do `onDownload`), `src/components/AdminModal.tsx` (campo de BPM, por símbolo `setMetadata`)

**Interfaces:**
- Produces:

```sql
-- aditiva e segura: apps antigos continuam lendo o bpm inteiro
alter table public.songs add column if not exists bpm_exact numeric(6,2) null check (bpm_exact is null or (bpm_exact > 0 and bpm_exact < 400));
alter table public.songs add column if not exists time_signature text null check (time_signature is null or time_signature in ('3/4','4/4','5/4','6/8','7/8','12/8'));
```

```ts
// cloudBpm.ts (tipo do compasso: TimeSignatureType de AudioAnalyzer.ts)
export function preciseBpm(s: { bpm?: number | null; bpm_exact?: number | null }): number | undefined // bpm_exact > 0, senão bpm > 0, senão undefined
export function bpmColumns(value: number): { bpm: number; bpm_exact: number } | null // { round(value), 2 casas }; fora de (0, 400) -> null
export function sanitizeTimeSignature(raw: unknown): TimeSignatureType | null
```

- `CloudSong` ganha `bpm_exact?: number | null` e `time_signature?: TimeSignatureType | null` (os `select('*')` já trazem). `downloadSong` e `getCachedSong` devolvem `bpm: preciseBpm(s)` e `timeSignature`; `LibraryModal` passa `extra.timeSignature` no `onDownload`, o campo de BPM aceita `step="0.01"`, e o `onSongEdited` leva `bpm` e `prevBpm` pelo `preciseBpm` (é por eles que o `syncSongMeta` do motor acha a música no repertório; com o inteiro o decimal se perderia), e o patch do `updateCachedSongMeta` leva `bpm` e `bpm_exact`. Gravar BPM (biblioteca e admin) usa `bpmColumns` (a coluna `bpm` é inteira). `api/insert-song.ts` troca `Math.trunc` por `Math.round` e grava `bpm_exact` e `time_signature` validado (mesma regra de `cloudBpm.ts`, repetida no servidor com comentário apontando pra ela, no padrão de `api/_lib/plan.js`).
- **Ordem de lançamento:** a migration roda no Supabase ANTES de publicar o app que grava as colunas (@data-engineer; registrar no FATOS).
- [ ] **Step 1: Testes de `cloudBpm.test.ts`**: `preciseBpm` prefere o exato, cai no inteiro, ignora 0; `bpmColumns(72.5)` = `{ bpm: 73, bpm_exact: 72.5 }`; `bpmColumns(0)` e `bpmColumns(NaN)` = `null`; `sanitizeTimeSignature('9/8')` = `null`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/cloudBpm.test.ts > "$LOGS/t23.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** o helper, a migration e as ligações.
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit > "$LOGS/t23-tsc.log" 2>&1; echo $?` e `cd api && ../node_modules/.bin/tsc -p tsconfig.json --noEmit > "$LOGS/t23-api.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add db/supabase-bpm-exact-migration.sql src/lib/cloudBpm.ts src/lib/cloudBpm.test.ts api/insert-song.ts src/lib/supabase.ts src/hooks/useCloudLibrary.ts src/lib/offlineCache.ts src/components/LibraryModal.tsx src/components/AdminModal.tsx
git commit -m "feat(biblioteca): BPM com decimais e compasso salvos na nuvem, sem quebrar apps antigos [Parte 2] [T23]"
```

**Linha pro FATOS:** BPM com decimais (`songs.bpm_exact`) e compasso (`songs.time_signature`) na nuvem; o `bpm` inteiro continua pros apps antigos; migration antes do lançamento.

---

### Tarefa 24: Modo Ao Vivo: protocolo do pulo armado e da contagem

**Onda:** 0. **Depende de:** base.

**Files:**
- Modify: `src/hooks/useLiveSync.ts` (`FollowerState`, `INITIAL_STATE`, `buildPayload` e a leitura do payload nos dois caminhos, rede local e nuvem), `src/types.ts` (payload do `HOST_STATE` em `WsMessage`), `src/components/FollowerView.tsx` (faixa mínima acima das seções)
- Create: `src/hooks/useLiveSync.armed.test.ts`, `src/components/FollowerView.armed.test.tsx`

**Interfaces:**
- Produces (em `FollowerState` e no `HOST_STATE`): `armed: { index: number; label: string; color: string; kind: 'proxima' | 'repete'; plays: number | 'infinite' } | null`, `countBeat: number | null`, `countTotal: number | null`. `INITIAL_STATE` com os três `null`. O seguidor grava `{ ...payload }`: campo ausente (host antigo) é normalizado pra `null` na leitura, nos dois caminhos.
- Celular, no visual atual (o redesenho é o Projeto 3): com `armed`, faixa "PRÓXIMA: <seção>" ou "REPETE: <seção>" na cor da seção e `countTotal` bolinhas acesas até `countBeat` (aproximado). Comandos existentes (`arm-jump`, `arm-loop`, `cancel-loop`) não mudam.
- [ ] **Step 1: Testes** (`FollowerView` em jsdom): `buildPayload leva armed e a contagem`; `host antigo sem os campos vira null e não mostra a faixa`; `faixa mostra PRÓXIMA: Refrão e 2 de 4 bolinhas acesas`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useLiveSync.armed.test.ts src/components/FollowerView.armed.test.tsx > "$LOGS/t24.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveSync.ts src/types.ts src/components/FollowerView.tsx src/hooks/useLiveSync.armed.test.ts src/components/FollowerView.armed.test.tsx
git commit -m "feat(ao-vivo): celular ve o pulo armado e a contagem aproximada [Parte 2] [T24]"
```

---

### Tarefa 25: Motor: saídas por papel, migração do pan automático e mudo geral

**Onda:** 3. **Depende de:** T6, T12, base v1.4.16.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (`initEngine`; ligação do fader de cada canal na restauração, em `loadFiles`, `addChannelToActiveSong` e `createEndlessMetronomeSong`; efeito do `setSinkId`; efeito do pan automático; `updatePan`; `setChannelBus`; troca de papel do `setChannelMeta`; pré-contagem atual; remoção de `bus1GainRef`, `bus2GainRef`, `bus1Volume`, `bus2Volume`, `updateBus1Volume`, `updateBus2Volume` se o `grep` confirmar que nada usa)
- Modify: `src/contexts/SettingsContext.tsx` (`outputs`, `stageVersion`, `legacyPanReset`, migração)
- Modify: `src/hooks/useAudioEngine.detectors.test.ts` (só se a guarda do `autoPanFor(` precisar acompanhar o efeito do pan automático, que agora só age em "Tudo junto")
- Modify (só se preciso, só a busca do principal): `scripts/verify-pitch/www/harness.jsx`
- Create: `src/hooks/useAudioEngine.outputs.test.ts`, `src/contexts/SettingsContext.test.tsx`

**Interfaces:**
- Consumes: `planOutputs`, `effectivePan`, `migrateOutputs`, `sanitizeOutputs`, `DEFAULT_OUTPUTS` (T6); `createOutputGraph` (T12); `resolveChannelRole` (Parte 1).
- Produces:
  - `AppSettings`: `outputs: OutputSettings`, `stageVersion: StageVersion` (padrão `'novo'`, valor estranho vira `'novo'`), `legacyPanReset: boolean`. Ao carregar, `migrateOutputs(salvo)`: grava `outputs`, `autoPan` e, quando `resetLegacyPans`, `legacyPanReset: true` (R-23).
  - Retorno do motor: `outputPlan: OutputPlan`, `maxOutputChannels: number`, `masterMuted: boolean`, `toggleMasterMute(): void`, `getOutputLevels(): { l: number; r: number }`.
- Regras: o `gainNode` liga em `graph.input(resolveChannelRole(ch))`, nunca direto no principal; `masterGainRef.current = graph.master`. O pan do nó é sempre `effectivePan(ch.pan, papel, plan)`; o `ch.pan` salvo só muda pelo knob (que a tela trava fora de "Tudo junto"). Com `legacyPanReset`, na primeira restauração os canais com `|pan| === 1` voltam a `pan: 0`, o repertório é salvo e o flag desliga. O efeito do pan automático só age com `plan.mode === 'stereo'`. Depois do `setSinkId` e no `sinkchange`, re-planeja com o `maxChannelCount` novo e chama `graph.apply`; mudar `settings.outputs` também. Trocar o papel religa só aquele fader com `gainNode.disconnect(barramentoAntigo)` (o `AnalyserNode` que o App liga no `gainNode` continua). A pré-contagem atual liga em `graph.input('click')` em vez do `destination` (a T26 refaz). Sem `settings.outputs` (mocks de testes antigos), o motor usa `migrateOutputs({ autoPan: settings.autoPan }).outputs`.
- [ ] **Step 1: Escrever os testes** (esquema de fakes do `useAudioEngine.persistence.test.ts`, com o `createFakeAudioContext` e o `reaches` da T1):

```ts
it('canal Click liga no barramento do click e o Baixo no da VS', ...)
it('papel manual Guia no Baixo religa no barramento da guia sem cortar o medidor', ...)
it('em separados o pan efetivo é o do papel, nunca o do knob', () => { /* Click com knob +0.6 -> pan do nó -1; Baixo com knob -1 -> +1; earOnSecond -> invertido */ })
it('em tudo junto vale o knob', ...)
it('migração: pans ±1 gravados voltam a 0 uma vez e o flag desliga', ...)
it('placa de 2 canais com 4 ou mais escolhido cai em separados', ...)
it('a pré-contagem nunca liga no destino direto', () => { /* nenhum oscilador alcança ctx.destination sem passar pelo barramento do click */ })
it('mudo geral zera só o masterMute', ...)
```
```tsx
it('quem tinha pan automático entra em separados, sem pan automático, e o palco novo é o padrão', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.outputs.test.ts src/contexts/SettingsContext.test.tsx > "$LOGS/t25.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks > "$LOGS/t25b.log" 2>&1; echo $?` e `node scripts/verify-pitch/run.mjs LEVELS SPREAD S1 > "$LOGS/t25c.log" 2>&1; echo $?` (o harness acha o principal andando pelas ligações até o `destination`; se ainda procura `gain -> master` direto, ajustar só essa busca).
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/contexts/SettingsContext.tsx src/hooks/useAudioEngine.outputs.test.ts src/contexts/SettingsContext.test.tsx
git commit -m "feat(saidas): motor separa VS e Click/Guia pelo papel do canal, no nivel da v1.4.15 [Parte 2] [T25]"
```

(Acrescentar ao `git add` o `useAudioEngine.detectors.test.ts` e o `harness.jsx` só se foram mudados.)

**Linha pro FATOS:** saídas de áudio separadas pelo papel do canal: "Click e Guia separados" (mesmo nível do pan automático de antes) ou VS estéreo + Click e Guia em saídas próprias (4 ou mais); quem usava o pan automático entra no modo separado e os pans gravados por ele voltam ao centro.

---

### Tarefa 26: Motor: vozes, linha do tempo e pré-contagem no relógio do áudio

**Onda:** 4. **Depende de:** T25, T5, T7.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (`play`, `pause`, `getPlaybackPosition`, `stopAllNodes`, `playWithPrecount`, `cancelCountIn`, `addChannelToActiveSong`, `removeChannel`, `updateTimeStretch`)
- Modify: `src/hooks/useAudioEngine.detectors.test.ts` (a guarda que exige `isPitchExempt(` e `channelGain(` no corpo do `play` passa a apontar pro `entryFor` e pra preparação do ganho)
- Create: `src/hooks/useAudioEngine.voices.test.ts`

**Interfaces:**
- Consumes: `startVoice`, `stopVoices`, `Voice`, `scheduleCount` (T7); `positionAt` (T5); `graph.countDelay` (T12).
- Produces (internos documentados no topo do bloco, usados por T27 e T28): `voicesRef: Ref<Voice[]>`; `timelineRef: Ref<TimelineSegment[]>`; `entryFor(ch, pitch, compensation): AudioNode` (worklet, atraso de compensação ou panner: a regra que hoje está no laço do `play`); `countDestination(): AudioNode` (entrada do canal de click pelo papel; sem canal de click, `graph.countDelay` com `delayTime = compensation ?? 0`, R-35); `play(opts?: { precount?: boolean }): Promise<void>`. Retorno ganha `precountTimes: number[]`.
- Regras: no `play`, o instante comum `when` vem de `nextRenderQuantum` (v1.4.16), depois de todos os `await`; cada canal ganha uma voz na `entryFor`; `timelineRef = [{ ctxStart: when, songStart: offset }]`; `getPlaybackPosition` = `pausedAtRef` com play pendente, senão `positionAt(timelineRef, ctx.currentTime, timeStretch)`; `pause` grava a posição pela linha do tempo. **Pré-contagem**: `pulso = 60 / (song.bpm || 100)` (a T27 troca pela grade), `n = precountBeats`, bipes em `t0 + k * pulso` (rótulos 1..n) em `countDestination()`, vozes em `t0 + n * pulso`, tudo agendado de uma vez (some o `setTimeout` que chamava o `play`); `isCountingIn` liga até o último bipe (timer só pra tela); `cancelCountIn` = `pause`. **Canal adicionado tocando** (causa 9 do relatório): ganha uma voz já, na posição atual. **Remover canal tocando** para a voz dele. **`updateTimeStretch`** aplica nas vozes.
- [ ] **Step 1: Escrever `useAudioEngine.voices.test.ts`**:

```ts
it('uma voz por canal, todas no mesmo instante e no mesmo offset', ...)
it('pré-contagem a 120 BPM: bipes em t0, +0,5, +1, +1,5 no click e as vozes em t0 + 2', ...)
it('pausar na pré-contagem para os bipes e nenhuma voz começa', ...)
it('busca tocando troca as vozes sem passar de 1 por canal', ...)
it('tom +2: as vozes entram no worklet do canal e 10 buscas não criam worklet novo', () => { /* conta pelo mock de signalsmith-stretch */ })
it('sem canal de click e com tom +2 a contagem passa pelo atraso L', () => { /* countDelay.delayTime = latência; bipes alcançam o barramento do click só pelo countDelay */ })
it('click adicionado tocando entra na posição atual', ...)
it('remover canal tocando para a voz dele', ...)
it('posição antes do instante agendado é o offset (não volta)', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.voices.test.ts > "$LOGS/t26.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks > "$LOGS/t26b.log" 2>&1; echo $?` e `node scripts/verify-pitch/run.mjs > "$LOGS/t26c.log" 2>&1; echo $?` (todos os cenários da v1.4.16; nada pode piorar).
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.detectors.test.ts src/hooks/useAudioEngine.voices.test.ts
git commit -m "feat(motor): vozes com envelope, linha do tempo e pre-contagem no relogio do audio [Parte 2] [T26]"
```

**Linha pro FATOS:** pré-contagem no BPM da música, saindo pela saída do click; click gerado com a música tocando entra na hora.

---

### Tarefa 27: Motor: grade pela faixa de click e o click que falta

**Onda:** 5. **Depende de:** T26, T2, T3, T22, T23, M7.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (fim do `loadFiles`, `restoreSongs`, troca de música ativa, `saveStateToDB`, assinatura do hook)
- Create: `src/hooks/useAudioEngine.grid.test.ts`

**Interfaces:**
- Consumes: `analyzeClickTrack` (T3); `gridFromClick`, `gridFromBpm`, `keepManualMeter`, `withMeter`, `gridWarning`, `pulseSeconds` (T2); `toSavedSong` com grade (T22); `planAutoClick`, `renderAutoClick` (M7); `findClickChannel` (Parte 1); `loadClickSelection`.
- Produces: `useAudioEngine(userId?: string, opts?: { autoClick?: boolean; sectionGates?: StageGates; stageMode?: StageMode })` (sem `opts`: `autoClick` falso, portões liberados, `'novo'`; a T28 usa os dois últimos); retorno ganha `songGrid: SongGrid | null`, `gridWarning: GridWarning | null`, `setSongMeter(songId: string, sig: TimeSignature, countEvery: 1 | 3): void`, `redetectSongGrid(songId: string): Promise<void>`, `isReadingGrid: boolean`; `loadFiles` aceita `meta.timeSignature` (vai pra `Song.timeSignature`).
- Regras da grade, por música (`Song.grid`, salva no repertório):
  1. Tem canal de click: `analyzeClickTrack(canal 0 do buffer, sampleRate)` → `gridFromClick(análise, song.timeSignature)` → `keepManualMeter(nova, salva)`. Análise nula: passo 3.
  2. Sem click, `autoClick` e a música sendo carregada agora (`loadFiles`) ou uma música salva que acabou de ficar ativa com a VS parada: `planAutoClick(canais, { songBpm: song.bpm, signature: song.timeSignature })`; com `ok`, `renderAutoClick` e o WAV vira o canal "Click gerado" daquela música (caminho próprio `appendChannelToSong(songId, file)`, que grava o arquivo por stem e serve pra música que não é a ativa) e a grade sai dele pelo passo 1. Sem `ok`: não gera.
  3. `gridFromBpm(song.bpm, song.timeSignature)` com `keepManualMeter` (pode ser `null`).
  - Grade salva não é recalculada ao reabrir; `redetectSongGrid` refaz os passos 1 e 3 e mantém o compasso manual. Sem geração em lote em segundo plano (decisão 10).
  - A pré-contagem da T26 passa a usar `pulseSeconds(grid)` quando há grade.
- [ ] **Step 1: Escrever `useAudioEngine.grid.test.ts`** (buffers sintéticos com o gerador da T3; `planAutoClick` e `renderAutoClick` mockados no passo 2):

```ts
it('click 3/4 com acento: grade lida do click, salva no repertório', ...)
it('compasso da nuvem 6/8 vence o acento lido', ...)
it('compasso escolhido no EDITAR sobrevive a reabrir e a "Ler o click de novo"', ...)
it('sem click e sem autoClick: grade do BPM salvo e aviso SEM CLICK LIDO', ...)
it('sem click, com autoClick e plano ok: gera "Click gerado" e lê a grade dele', ...)
it('sem click, com autoClick e confiança baixa: não gera nada', ...)
it('música salva sem click gera só quando fica ativa parada, nunca tocando', ...)
it('pré-contagem usa o pulso da grade', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.grid.test.ts > "$LOGS/t27.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (todo caminho com `setIsLoading(true)` em `try/finally`; o trabalho pesado roda depois do decode, nunca no instante de tocar).
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks src/lib > "$LOGS/t27b.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.grid.test.ts
git commit -m "feat(motor): grade de cada musica lida na faixa de click e click que falta [Parte 2] [T27]"
```

**Linha pro FATOS:** BPM com decimais e compasso de cada música lidos na faixa de click; sem click, o app gera um (planos pagos) ao carregar, quando tem certeza do tempo; avisos em âmbar quando a grade é aproximada.

---

### Tarefa 28: Motor: pulo agendado, REPETIR, LOOP, FADE agendado e o modo antigo

**Onda:** 6. **Depende de:** T27, T17, T4, T5.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (laço `updateTime`, `armLoop`, `cancelLoop`, `armJump`, `cancelJump`, `seekTo`, `pause`, `jumpToSong`, `nextSong`, `prevSong`, `executeNextSong`, `changePitch`, reinício da troca de papel, FADE, retorno do hook)
- Create: `src/hooks/useAudioEngine.transition.test.ts`

**Interfaces:**
- Consumes: `SectionScheduler` e constantes (T17); `createSchedulerClock` (T5); `tapSection`, `stepSection`, `armAt`, `armRepeat`, `toggleLoop`, `bandRepeat`, `armLabel` (T4); `sectionSpans`, `sectionIndexAt` (T2); `startVoicesForSwitch` (T7); opções `sectionGates` e `stageMode` (T27).
- Produces (retorno do motor):

```ts
sectionIntent: ArmIntent | null
transitionView: TransitionView | null
landed: { index: number; at: number } | null
sectionSpansView: SectionSpan[]        // as spans da música ativa (palco e HOST_STATE usam esses índices)
armSection(i: number): { upgrade: boolean }
stepSection(dir: -1 | 1): { upgrade: boolean }
armRepeat(plays: Plays): { upgrade: boolean }
toggleSectionLoop(): { upgrade: boolean }
cancelArm(): void
heardNow(): number      // ctx.currentTime - outputLatency - latência da entrada
heardPosition(): number // positionAt no heardNow
// adaptadores (palco antigo e banda), que respeitam o stageMode vigente:
armJump(i: number): void                          // novo: { i, 1 }; antigo: caminho da v1.4.16
armLoop(i: number, n: number | 'infinite'): void  // novo: bandRepeat(i, n, atual); antigo: caminho da v1.4.16
cancelJump(): void; cancelLoop(): void; pendingJump: number | null; activeLoop: { index: number; remaining: number | 'infinite' } | null
```

- Regras: com `stageMode 'novo'`, o `SectionScheduler` cuida de pulo, REPETIR e LOOP; o relógio do Worker liga no play e desliga na pausa; cada tique chama `scheduler.tick()` e a checagem de fim de música (idempotente, também no rAF). `pause`, `seekTo`, troca de música e todo reinício do `play` chamam `scheduler.reset()` antes e `scheduler.tick()` depois. Parado, `armSection` e `stepSection` levam ao início da seção e desarmam. **FADE (R-32):** tocando em `fade-out`, uma rampa única no principal de `duração - 5 s` até a duração (`setValueAtTime` + `linearRampToValueAtTime`), agendada no `play`; `reset` cancela; com intenção armada não agenda; ao pousar, `setValueAtTime(masterVolume, T)`. Troca de música (AUTO, próxima) segue por timer (exceção escrita). Os índices de seção são os das spans (`sectionSpansView`); os adaptadores recebem índice de span no modo novo. `stageMode` novo só passa a valer com a VS parada (se chegar tocando, fica pendente até a próxima parada). Sem `sectionGates`, tudo liberado. Com `stageMode 'antigo'`, o caminho do rAF (`loopRef`, `jumpRef`, `seekTo` no fim da seção) roda como na v1.4.16, sem contagem.
- [ ] **Step 1: Escrever `useAudioEngine.transition.test.ts`** (fake de contexto com `currentTime` controlado, relógio do Worker falso):

```ts
it('tocando, armar a próxima agenda a contagem no canal de click e pousa no 1', ...)
it('sem canal de click a contagem vai pro barramento do click', ...)
it('REPETIR 2 conta e volta duas vezes e desarma', ...)
it('LOOP repete sem contagem até cancelar', ...)
it('pausar com pulo agendado não deixa voz nem bipe vivo', ...)
it('busca com pulo armado re-planeja a partir da posição nova', ...)
it('FADE é uma rampa agendada; com pulo armado não começa e o principal volta no instante do pulo', ...)
it('parado, tocar numa seção leva pro início dela e desarma', ...)
it('Livre pede upgrade e não arma', ...)
it('modo antigo: sem bipe, salto no fim da seção pelo caminho antigo', ...)
it('banda: repetir 2 numa outra seção vira 3 passagens no modo novo', ...)
it('trocar o modo tocando só vale na próxima parada', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.transition.test.ts > "$LOGS/t28.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks > "$LOGS/t28b.log" 2>&1; echo $?` e `node scripts/verify-pitch/run.mjs LOOP RESTART SEEKS > "$LOGS/t28c.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.transition.test.ts
git commit -m "feat(motor): pulo de secao agendado com contagem no click, FADE agendado e o modo antigo [Parte 2] [T28]"
```

**Linha pro FATOS:** troca de seção ao vivo: arma, conta 1-2-3-4 só no click e entra no 1 do compasso seguinte, sem parar a VS; REPETIR usa o mesmo caminho; a guia cala no último compasso; FADE do fim da música no relógio do áudio.

---

### Tarefa 29: App: palco novo ligado com a chave

**Onda:** 7. **Depende de:** T18, T19, T20, T23, T24, T28, M7.

**Files:**
- Modify: `src/App.tsx`, `src/components/SettingsModal.tsx` (aba Geral e aba Buses), `electron/main.ts` (`webPreferences`)
- Create: `src/components/stage/buildStageView.ts`, `src/components/stage/buildStageView.test.ts`, `src/appWiring.test.ts`

**Interfaces:**
- Consumes: tudo que o motor produz nas T25 a T28; `StageShell`, `useStageViewport` (T18); `AudioOutputsSection`, `StageVersionSetting` (T19); `buildChannelLabels`, `findClickChannel`, `isSilencedBySolo`, `pickWaveformChannel` (Parte 1); `computePeaks` (T9); `barSeconds`, `gridHasPhase` (T2, T1); `armLabel` (T4); `KEY_NAMES` (T13); `addSectionAt`, `nudgeSection`, `removeSection` (T16); `markerIdForSpan` (T2); `canUseSections`, `canBandControlSections`, `canUseBpmDetection` (`plans.ts`).
- Produces:

```ts
export interface EngineStageState {
  song: Song | undefined; playlist: readonly Song[]; activeIndex: number; spans: SectionSpan[]; currentMarkerId: string | null
  isPlaying: boolean; isCountingIn: boolean; precountEnabled: boolean; precountBeats: number; precountTimes: number[]
  playbackMode: 'continue' | 'stop' | 'fade-out'; sectionIntent: ArmIntent | null; transitionView: TransitionView | null
  landed: StageView['landed']; songGrid: SongGrid | null; gridWarning: GridWarning | null; isReadingGrid: boolean; outputPlan: OutputPlan
  masterVolume: number; masterMuted: boolean
}
export function buildStageView(e: EngineStageState, ui: { plan: string | null; isAdmin: boolean; online: boolean; isDesktop: boolean; userName: string | null; hostActive: boolean; editMode: boolean; channelEditMode: boolean; padPanelOpen: boolean; activePad: string | null; repertoireName: string | null }): StageView
```

- Ligações no `App.tsx`:
  - **Uma decisão só (R-25):** `useNewStage = settings.stageVersion === 'novo' && wide`, com trava: o valor efetivo só muda com a VS parada (um ref guarda o último valor aplicado e só troca quando `!isPlaying`). Esse valor escolhe a tela e vai pro motor como `stageMode`.
  - `useAudioEngine(user?.id, { autoClick: canUseBpmDetection(userPlan), sectionGates, stageMode })`, com `sectionGates` montados pelo plano.
  - Com `useNewStage`, o `StageShell` toma o lugar do cabeçalho, da faixa do repertório e do conteúdo principal; modais, teleprompter, tour e Ao Vivo ficam fora e iguais. Sem ele, o layout de hoje inteiro.
  - O atalho de teclado antigo sai cedo com `if (useNewStage) return`.
  - `StageActions` a partir do motor: `tapSection` → `armSection`; `stepSection`; `armRepeat`; `toggleLoop` → `toggleSectionLoop`; `{ upgrade: true }` abre o Planos; `toggleClick` → `toggleMute` do canal de `findClickChannel`; `openMetronome`; `openLyrics` → teleprompter; `markSection`/`nudgeSection`/`removeSection` → funções da T16 (com `markerIdForSpan` pro índice do bloco) + `setSongMarkers`; `setMeter` → `setSongMeter` e, com `sourceId`, grava na nuvem se o usuário pode editar BPM e tom daquela música (R-30: admin, ou dono da música privada pelo `user_id` de `songs`; a RLS continua sendo a trava): `updateSong(sourceId, { time_signature })` + `updateCachedSongMeta`; `redetectMeter` → `redetectSongGrid`.
  - `StageClock`: `heardNow` e `heardPosition` do motor; `level(id)` lê o pico do `AnalyserNode` que o App já liga por canal; `masterLevels` = `getOutputLevels`.
  - Onda: `computePeaks` do canal de `pickWaveformChannel`, memorizado por música.
  - Slots: REPERTÓRIOS (`RepertoirePanel` com `jumpToSong`, `setPlaylistOrder`, `removeSongFromPlaylist`, `clearSession`, exportar/importar e `repertoireNotes`), menu FAIXAS (o de hoje), ferramentas do admin (editor de marcadores de hoje, só no modo EDITAR e só admin), painel Editar canal da Parte 1; SAMPLES e LOOPS com o conteúdo de hoje.
  - `MetronomeModal` recebe `initialSignature` da grade da música; `onDownload` da biblioteca passa `timeSignature: extra?.timeSignature` no `meta` do `loadFiles`.
  - As duas cópias do array de 12 tons do `App.tsx` passam a usar `KEY_NAMES` (T13).
  - **Ao Vivo do host:** `HOST_STATE.sections` sai das spans quando o palco novo vale (os índices batem com os comandos); `armed`, `countBeat` e `countTotal` no `useLiveSync` (a contagem só muda de estado quando o número do bipe ouvido muda, e só com pulo agendado; o App já re-renderiza a cada quadro pelo `currentTime`, então o custo é desprezível). Comandos da banda só pelos adaptadores (`arm-jump` → `armJump(i)`, `arm-loop` → `armLoop(i, value === -1 ? 'infinite' : value ?? 1)`, `cancel-loop` → `cancelLoop`), com `canBandControlSections`; eles respeitam o `stageMode`.
  - **Tour** (`TOUR_STEPS`): com o palco novo, troca só os textos que mudaram: `setlist-area` e `anotacoes` apontam pra `repertorios` ("A lista do repertório e as Anotações ficam no painel REPERTÓRIOS."); os 4 de `secoes`: "Toque numa seção pra armar: ela termina, conta 1-2-3-4 no click e entra no 1."; "REPETIR com o número de vezes, ou ∞ e LOOP pra repetir sem parar."; "Tocar de novo na seção armada, no X do aviso ou Esc cancela."; "Teclas 1 a 9 armam, setas trocam de seção, Shift + setas andam 5 s; marcar seções fica no EDITAR."; `config`: "Ajustes do app, saídas de áudio (Click e Guia separados da VS) e a chave do palco. É aqui também que você reabre este tutorial." Os `data-tour` já vêm dos componentes (T8, T10, T13, T14, T15).
- `SettingsModal`: na aba Geral, `StageVersionSetting` primeiro e `AudioOutputsSection` junto do seletor de saída; o interruptor do pan automático só aparece em "Tudo junto" (desligado por padrão, R-23); a aba "Buses" só aparece em "Tudo junto" (fora dele ela mexeria num pan que não decide a saída).
- `electron/main.ts`: `backgroundThrottling: false` em `webPreferences`.
- [ ] **Step 1: Testes**:

```ts
// buildStageView.test.ts
it('canais com rótulo, cor, papel e calado pelo solo', ...)
it('seções pelas spans, na cor do tipo, com compassos quando a grade tem fase', ...)
it('posição da música, anterior e A SEGUIR', ...)
it('portões do plano Livre e do Studio', ...)
it('click ligado = canal de click sem M; música sem click = channelId null', ...)
it('isReadingGrid e gridWarning passam pro palco', ...)
// appWiring.test.ts (texto do código, regex tolerante, Ruling 5 da Parte 1)
it('electron/main.ts liga backgroundThrottling: false', () => expect(main).toMatch(/backgroundThrottling\s*:\s*false/))
it('o atalho antigo sai cedo com o palco novo', () => expect(app).toMatch(/if\s*\(\s*useNewStage\s*\)\s*return/))
it('o App monta o StageShell e passa o stageMode pro motor', () => { expect(app).toMatch(/<StageShell[\s>]/); expect(app).toMatch(/stageMode/) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/buildStageView.test.ts src/appWiring.test.ts > "$LOGS/t29.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais o portão completo e `node scripts/verify-layout/run.mjs`.
- [ ] **Step 5: Conferir no app** (`npm run dev` e `npm run dev:desktop`): itens 1 a 6 do QA do dono, com uma música de 24 canais e outra sem click.
- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/SettingsModal.tsx electron/main.ts src/components/stage/buildStageView.ts src/components/stage/buildStageView.test.ts src/appWiring.test.ts
git commit -m "feat(palco): palco novo ligado no app com a chave pro palco antigo [Parte 2] [T29]"
```

**Linha pro FATOS:** palco novo (computador e tablet a partir de 1024x600): transporte central, onda grande com seções, botoeira, faixa do meio, mixer novo e pads escondidos; chave CONFIG > Geral > Palco (Novo | Antigo), que vale na próxima parada; repertório e Anotações no painel REPERTÓRIOS; MARCAR e EDITAR seções só no modo EDITAR.

---

### Tarefa 30: Harness: medir pulo, contagem, cancelamento, saídas e pré-contagem

**Onda:** 7. **Depende de:** T28.

**Files:**
- Modify: `scripts/verify-pitch/www/harness.jsx`, `scripts/verify-pitch/www/tap-worklet.js`, `scripts/verify-pitch/analyze.mjs`, `scripts/verify-pitch/run.mjs`, `scripts/verify-pitch/README.md`

- Medidor: o `tap` mede, por janela de 10 ms e por saída, a energia (Goertzel) nas frequências pedidas em `processorOptions` (988, 1319, a do click de teste e 330 Hz da guia de teste). O principal é achado andando pelas ligações até o `destination`. O hook é montado com `sectionGates` explícitos (tudo liberado) e `stageMode: 'novo'`.
- Música de teste: click com acento no 1 a 120 BPM, "Voz Guia" com seno de 330 Hz, instrumentos como hoje; marcas nas barras (0, 4, 8, 12, 16 s).
- Cenários novos (em `SCENARIOS`, critério em `analyze.mjs`); os que já existem na v1.4.16 continuam passando:

| Cenário | O que faz | Passa quando |
|---|---|---|
| `JUMP` | toca de 4 s, arma a seção 0 em 5,5 s (fim da seção em 8 s; o primeiro bipe em 6 s fica depois do horizonte) | 1º click depois do pulo a até 3 ms de `T`; 4 bipes em `T-2`, `T-1,5`, `T-1`, `T-0,5` com até 3 ms; guia ao menos 40 dB abaixo entre `T-2+0,02` e `T-0,02` e de volta depois de `T+0,02`; no máximo 2 fontes por canal e 1 por canal 100 ms depois de `T`; sem buraco de mais de 10 ms na VS em volta de `T` |
| `JUMP` com `pitch=2` | o mesmo transposto | mesmos critérios a partir de `T + latência do worklet`; nenhum worklet novo |
| `CANCEL` | arma, cancela depois do 2º bipe | nenhum bipe 5 ms depois do cancelamento; o click segue a linha do tempo original; guia de volta em até 15 ms |
| `SPLIT` | "Click e Guia separados", normal e com o lado trocado; e "Tudo junto" | contagem, click e guia abaixo de -60 dB na saída da VS e instrumentos abaixo de -60 dB na saída do ouvido; **nível de cada saída igual ao da v1.4.15 com o pan automático, com até 0,1 dB (R-24)**, e "Tudo junto" igual à v1.4.15 sem pan automático: rodar `node scripts/verify-pitch/run.mjs SPLIT --rev b53a95c --tag v1415` (o mesmo áudio no motor da v1.4.15; por isso o `SPLIT` só usa API que a v1.4.15 tem, `loadFiles`, `play` e `pause`, e liga o pan automático por `localStorage` quando roda com `--rev`) e o `analyze.mjs` compara os dois JSON |
| `PRECOUNT` | play com pré-contagem de 4 a 120 BPM | 4 bipes a 0,5 s um do outro (até 2 ms) só no ouvido; 1º click da música no 5º tempo (até 3 ms) |
| `LOOP` (o da v1.4.16) | passa a usar `toggleSectionLoop` | emenda do click a até 3 ms |

- [ ] **Step 1: Escrever os cenários e critérios.**
- [ ] **Step 2: Rodar contra o commit da T27 e ver falhar.** Run: `node scripts/verify-pitch/run.mjs JUMP CANCEL PRECOUNT --rev <commit da T27> > "$LOGS/t30-antes.log" 2>&1; echo $?`. Expected: `1`.
- [ ] **Step 3: Rodar no código atual.** Run: `node scripts/verify-pitch/run.mjs > "$LOGS/t30.log" 2>&1; echo $?` e a comparação do `SPLIT` com a v1.4.15. Expected: `0`. Falha que é do motor: parar e avisar o coordenador (correção numa rodada da T28 ou T25).
- [ ] **Step 4: Commit**

```bash
git add scripts/verify-pitch/www/harness.jsx scripts/verify-pitch/www/tap-worklet.js scripts/verify-pitch/analyze.mjs scripts/verify-pitch/run.mjs scripts/verify-pitch/README.md
git commit -m "test(audio): harness mede pulo no 1, contagem so no click, cancelamento, saidas e pre-contagem [Parte 2] [T30]"
```

---

### Tarefa 31: Documentação viva

**Onda:** 8. **Depende de:** todas.

**Files:**
- Modify: `PLAYBACK_STUDIO_FATOS.md` (seção 4 Stack: Worker do agendador, harness e verificadores; seção 5 Telas e features; seção 6 Histórico com a entrada da Parte 2, NÃO publicado), `DESIGN_SYSTEM.md` (peças do palco, tempo ouvido, fader só arrastando, exceção M/S, avisos âmbar da grade, animações do armado)

- [ ] **Step 1: Consolidar no FATOS** as "Linhas pro FATOS" (o coordenador já aplicou nos portões; aqui junta e revisa), as 18 decisões deste plano na ordem da lista (marcando o que o dono conferiu), os limites conhecidos (Safari/iPad e Firefox só na saída do sistema e com 2 canais; Windows com placa multicanal como vários aparelhos estéreo; sem ASIO; pads e samples na saída padrão; contagem do celular aproximada; LOOP e ∞ sem contagem; troca de música por timer) e a ordem de lançamento (migration da T23 antes; web + desktop juntos).
- [ ] **Step 2: DESIGN_SYSTEM** com as peças novas e as regras.
- [ ] **Step 3: Conferir sem travessão.** Run: `git diff -U0 PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md | grep '^+' | grep -c "$(printf '\342\200\224')"`. Expected: `0`.
- [ ] **Step 4: Commit**

```bash
git add PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
git commit -m "docs(fatos): Parte 2 do palco novo, metronomo automatico e saidas separadas (nao publicado) [Parte 2] [T31]"
```

---

## Grupo M: metrônomo automático corrigido

Base: `refs/metronomo-auto-investigacao.md` (causas 1 a 9, recomendações 1 a 8) e `scripts/verify-click/` (commitado pela M1). Valores do relatório: tempo certo quando trava (+0,2 a +6,8 ms); contratempo de 285 a 394 ms; o "1" certo em 31 de 54 cenários 4/4; 160 e 176 BPM saem 80 e 88; confiança 0,52 no ruído branco, 0,63 na voz em glissando, 0,39 no pad, 0,16 na bateria afogada em ruído (valor atual, medido pela M1) e 0,953 na bateria a -40 dB; ataque a -20 dB do Classic 1,09 ms e do Percussive 4,44 ms.

### Tarefa M1: Detector de tempo em etapas e sintéticos do relatório no Vitest (FEITA)

**Status:** feita em `3fdb062`, revisada (equivalência 18/18 e 528 comparações bit a bit contra o detector antigo). Relatório: `.superpowers/sdd/2026-11-15-parte2-palco-novo/task-M1-report.md`.

**Assinaturas reais (o que as tarefas M2 a M7 consomem):**

```ts
// src/lib/tempo/onsets.ts
export const ONSET_LAG_FRAMES = 1.5
export interface OnsetBands { fps: number; full: Float32Array; low: Float32Array; kick: Float32Array; snare: Float32Array } // M1: kick = low, snare = full
export function sampleAt(o: Float32Array, x: number): number
export function combScore(o: Float32Array, period: number, phase: number): number
export function onsetBands(channels: Float32Array[], sampleRate: number): OnsetBands | null // null nos casos da reserva antiga (menos de 4 s etc.)
// src/lib/tempo/octave.ts
export function roughTempo(o: Float32Array, fps: number): number
export function tempoCandidates(rough: number, opts: { nearBpm?: number; signature?: TimeSignatureType }): number[] // M1: [rough]
export function pickTempo(cands: { bpm: number; score: number }[], opts: { nearBpm?: number }): { bpm: number; alternatives: number[] }
// src/lib/tempo/phase.ts (período e fase em QUADROS da onset)
export function choosePhase(b: OnsetBands, period: number, phase: number): { phase: number; offbeatRisk: boolean } // M1: identidade
// src/lib/tempo/confidence.ts (quadros)
export const CONFIDENCE_CUT = 0.1
export function measureConfidence(o: Float32Array, period: number, phase: number): number
// src/lib/tempo/downbeat.ts (período e firstBeat em SEGUNDOS)
export interface DownbeatVotes { bass?: OnsetBands; harmony?: OnsetBands[] }
export function chooseDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): number
// src/lib/beatGrid.ts
export interface TempoTrack { id: string; label: string; use: 'pulse' | 'bass' | 'harmony'; channels: Float32Array[] }
export interface SongGridDetection extends BeatGrid { offbeatRisk: boolean; alternatives: number[]; tracksUsed: string[] }
export function detectSongGrid(tracks: readonly TempoTrack[], sampleRate: number, opts?: BeatGridOptions & { signature?: TimeSignatureType }): SongGridDetection
// M1: usa só a PRIMEIRA faixa pulse; bass e harmony viram DownbeatVotes; sem pulso medível, reserva (bpm nearBpm ?? 120, confiança 0)
export function detectBeatGrid(channels: Float32Array[], sampleRate: number, opts?: BeatGridOptions): BeatGrid // = detectSongGrid com uma faixa pulse
```

A busca grossa e fina de período e fase ficou em `beatGrid.ts` (`fitGrid`, privada), uma vez por candidato de `tempoCandidates`. Os calços de `AudioContext`/`fetch` do gerador de click estão dentro de `src/lib/beatGrid.equivalence.test.ts` (a M6 tira de lá).

---

### Tarefa M2: Kit somado, tempo x contratempo e confiança de verdade

**Onda:** 0. **Depende de:** M1.

**Files:**
- Modify: `src/lib/beatGrid.ts` (Ruling M1-a e M1-b: soma das faixas de pulso e `fps` na confiança), `src/lib/tempo/onsets.ts`, `src/lib/tempo/phase.ts`, `src/lib/tempo/confidence.ts`
- Modify (só se um caso de equivalência mudar de resultado pela correção: sai de lá e vira teste aqui, com o motivo): `src/lib/beatGrid.equivalence.test.ts`
- Create: `src/test/tempoCases.ts`, `src/lib/tempo/phase.test.ts`, `src/lib/tempo/confidence.test.ts`, `src/lib/tempo/pulseSum.test.ts`

**Interfaces:**
- Produces:

```ts
// src/test/tempoCases.ts (catálogo único com nome; M3, M4 e M6 usam)
export interface TempoCase { id: string; group: 'calibracao' | 'validacao'; positive: boolean; song: () => SynthSong; note: string }
export const TEMPO_CASES: readonly TempoCase[] // ids de harness.mjs (a, b, c1, d1, e1, f1, g1, x_*), de gridsweep.mjs (negativos) e de cointoss.mjs (baixo, shaker)
export function tempoCase(id: string): TempoCase
// confidence.ts (Ruling M1-b)
export function measureConfidence(o: Float32Array, period: number, phase: number, fps: number): number
```

- Correções (recomendações 1, 2, 4 e 5):
  - `detectSongGrid` soma as faixas `pulse` (Ruling M1-a): `onsetBands` de cada uma, cada banda normalizada pelo próprio máximo, somadas banda a banda antes de período e fase; `tracksUsed` lista todas. O teste da M1 "só a primeira faixa de pulso entra" vira o teste novo daqui.
  - `onsetBands`: `prev` começa em 0 (o golpe em 0,000 conta); `kick` = passa-baixa de 2 polos abaixo de ~100 Hz; `snare` = 150 a 300 Hz somada a ruído acima de 2 kHz.
  - `choosePhase`: compara φ com φ + meio período pela evidência de bumbo e caixa (cada uma normalizada); fica com a maior; `offbeatRisk = true` quando a diferença relativa é menor que 15% ou quando não há bumbo nem caixa.
  - `measureConfidence`: contra controle: a mesma busca de fase com blocos de 2 s (`2 * fps` quadros) embaralhados, 16 sorteios com semente fixa; confiança = `clamp((melhor - média dos controles) / (4 * desvio), 0, 1)`.
- [ ] **Step 1: Escrever os testes**

```ts
it.each(['x_popsync', 'x_kicksync', 'x_sync16even', 'e1'])('%s: click no tempo, não no contratempo', (id) => expect(Math.abs(erroDoPrimeiroClick(tempoCase(id)))).toBeLessThan(0.010))
it.each(['bass-colcheias', 'loop-shaker'])('%s: sem bumbo nem caixa, avisa o risco de meio tempo', (id) => expect(detect(tempoCase(id)).offbeatRisk).toBe(true))
it('kit separado (KICK, SNARE, HIHAT) somado acha o tempo que a peça sozinha não acha', ...)
it('o golpe em 0,000 conta (caso a)', ...)
it('corte calibrado no grupo de calibração separa o grupo de validação', () => {
  const val = TEMPO_CASES.filter(c => c.group === 'validacao')
  expect(Math.max(...val.filter(c => !c.positive).map(confianca))).toBeLessThan(CONFIDENCE_CUT)
  expect(Math.min(...val.filter(c => c.positive).map(confianca))).toBeGreaterThanOrEqual(CONFIDENCE_CUT)
})
it('os casos que já davam certo continuam no mesmo erro (até +6,8 ms)', ...)
```

(Os ids `bass-colcheias` e `loop-shaker` são os nomes dados no catálogo aos casos do `cointoss.mjs`; a tarefa escolhe os ids finais e os testes usam os do catálogo.)

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo src/lib/beatGrid.equivalence.test.ts > "$LOGS/m2.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar e calibrar `CONFIDENCE_CUT`** só com o grupo `calibracao`, no meio do vão entre o maior negativo e o menor positivo (anotar os dois números no comentário da constante e no relatório). Sem vão, parar e avisar o coordenador.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/beatGrid.ts src/lib/tempo/onsets.ts src/lib/tempo/phase.ts src/lib/tempo/confidence.ts src/test/tempoCases.ts src/lib/tempo/phase.test.ts src/lib/tempo/confidence.test.ts src/lib/tempo/pulseSum.test.ts
git commit -m "fix(tempo): kit somado, tempo x contratempo por bumbo e caixa e confianca contra controle [Parte 2] [M2]"
```

(Com `src/lib/beatGrid.equivalence.test.ts` no `git add` só se ele mudou.)

---

### Tarefa M3: O "1" do compasso

**Onda:** 2. **Depende de:** M2 (bandas), M4 (teste de equivalência na onda anterior).

**Files:**
- Modify: `src/lib/tempo/downbeat.ts`; `src/lib/beatGrid.equivalence.test.ts` (mesma regra da M2)
- Create: `src/lib/tempo/downbeat.test.ts`

- Correções (recomendação 4): voto principal do "1" pela troca de acorde e pela nota do baixo (`votes.bass`, `votes.harmony`, já ligados pela M1); depois o bumbo (`kick`); o desempate "onde a bateria começa" só sem outro voto.
- [ ] **Step 1: Escrever `downbeat.test.ts`** com a matriz de 54 cenários 4/4 de `downbeat.mjs` (Bateria + Baixo + Pad) e os casos: virada no tempo 4 antes da entrada, música começando em 0,000, bumbo em todo tempo com chimbal aberto no "e".

```ts
it('acerta o 1 em pelo menos 50 dos 54 cenários 4/4 (hoje 31)', () => expect(acertos(cenarios54)).toBeGreaterThanOrEqual(50))
it.each(['virada-antes-da-entrada', 'comeca-em-zero', 'bumbo-em-todo-tempo'])('%s', (c) => expect(downbeatCerto(tempoCase(c))).toBe(true))
it('3/4 com compasso pedido 3/4 acerta o 1', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo/downbeat.test.ts > "$LOGS/m3.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** (com `src/lib/tempo` inteiro e a equivalência).
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/downbeat.ts src/lib/tempo/downbeat.test.ts
git commit -m "fix(tempo): o 1 do compasso pela troca de acorde e pelo baixo [Parte 2] [M3]"
```

---

### Tarefa M4: Andamento: oitava, compasso composto e `preferBpm`

**Onda:** 1. **Depende de:** M2 (`beatGrid.ts`), T1 (`TimeSignature`, `pulsesPerBar`).

**Files:**
- Modify: `src/lib/tempo/octave.ts`, `src/lib/beatGrid.ts` (Ruling M1-c e M1-d: evidência por banda de cada candidato, `preferBpm`, `beatsPerBar` pelo compasso, `TimeSignature` dos contratos)
- Modify (mesma regra da M2): `src/lib/beatGrid.equivalence.test.ts`
- Create: `src/lib/tempo/octave.test.ts`

**Interfaces:**
- Produces:

```ts
// BeatGridOptions ganha preferBpm (suave); nearBpm continua o refino rígido de ±0,8% que o Separador usa (achado 18)
export interface BeatGridOptions { nearBpm?: number; beatsPerBar?: number; preferBpm?: number }
export function pickTempo(cands: { bpm: number; score: number; kickOnBeat: number; snareOffBeat: number }[], opts: { nearBpm?: number; preferBpm?: number }): { bpm: number; alternatives: number[] }
```

- Correções (recomendação 6): candidatos ½×, 1× e 2× do áspero; escolhido o que põe bumbo no tempo e caixa no contratempo do compasso (backbeat), com preferência pelo mais perto de `preferBpm` quando ele existe; `alternatives` = os outros dois. Em 6/8 e 12/8, o pulso achado em semínima pontuada é multiplicado por 3 (grade em colcheia). Quem passa só `signature` ganha `beatsPerBar = pulsesPerBar(signature)`. Com `nearBpm`, tudo como hoje (teste de equivalência do caminho do Separador continua passando).
- [ ] **Step 1: Escrever `octave.test.ts`**

```ts
it.each([[160], [176]])('%s BPM sai inteiro, não pela metade', (bpm) => expect(detect(rapida(bpm)).bpm).toBeCloseTo(bpm, 1))
it('com preferBpm escolhe a oitava dele', ...)
it('com nearBpm continua o refino rígido (Separador)', ...)
it('sempre oferece metade e dobro', () => expect(detect(tempoCase('b')).alternatives).toEqual([60, 240]))
it('6/8 pedido em 6/8 conta colcheias (180) com o acento a cada compasso', ...)
it('signature 3/4 sem beatsPerBar acha o 1 a cada 3', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo/octave.test.ts src/lib/beatGrid.equivalence.test.ts > "$LOGS/m4.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/octave.ts src/lib/beatGrid.ts src/lib/tempo/octave.test.ts
git commit -m "fix(tempo): oitava do andamento, compasso composto e BPM da musica como referencia suave [Parte 2] [M4]"
```

---

### Tarefa M5: Faixas de análise e nomes de bateria em português e espanhol

**Onda:** 0. **Depende de:** base (`channelNames.ts` e `channelRoles.ts` da Parte 1).

**Files:**
- Create: `src/lib/tempoSources.ts`, `src/lib/tempoSources.test.ts`
- Modify: `src/lib/channelNames.ts` (peças e palavras novas, `nameTokens` exportado), `src/lib/channelNames.test.ts`

**Interfaces:**
- Produces:

```ts
// channelNames.ts
export function nameTokens(raw: string): string[] // o tokenizador que o reconhecimento já usa (sem acento, minúsculo, camelCase e separadores quebrados)
// tempoSources.ts
export interface TempoSources<T extends ChannelIdentity> { click: T | null; pulse: T[]; bass: T | null; harmony: T[]; label: string }
export function pickTempoSources<T extends ChannelIdentity>(channels: readonly T[]): TempoSources<T>
```

- Reconhecimento (achado 19; muda rótulo, cor e ordem): BUMBO, CAIXA, CHIMBAL viram peças da bateria (Bumbo, Caixa, Chimbal); BATERA vira Bateria; SHAKER vira Percussão ("Shaker"); um nome cuja única palavra reconhecível é LOOP (ou LOOPS) vira Percussão ("Loop"); BAJO vira Baixo. Os testes atuais de `channelNames.test.ts` continuam passando.
- Regras de `pickTempoSources` (recomendações 2 e 3): `click` = `findClickChannel` (papel manual vale); `pulse` = todos os canais de `bateria` e `percussao` (kit separado entra inteiro); se houver kit inteiro (tokens com DRUMS/BATERIA/BATERA sem LOOP nem FILL/FILLS) e também canais com LOOP ou FILL(S), ficam só os de kit; sem bateria nem percussão, `pulse` = `[baixo]` se houver; `bass` = primeiro `baixo` ou `synthBass`; `harmony` = até 2 entre `pad`, `teclado`, `piano`, `violao`; nunca Guia, Vocal, Backing nem Click em `pulse`, `bass` ou `harmony`. `label` em português ("Bateria, Percussão e Baixo"). Nada de `includes` em pedaço de nome: só `channelFamily`, `resolveChannelRole` e `nameTokens`.
- [ ] **Step 1: Escrever os testes** com a tabela da seção 4 do relatório (13 pacotes): kit separado (KICK, SNARE, HIHAT, OH, PERC) em `pulse` e BASS em `bass`; BUMBO/CAIXA/CHIMBAL em `pulse`; "Drums" vence "Drum Loop" e "Drum Fills"; "Batería" em `pulse` e "Guía" fora; "Metrônomo" como `click`; só Pad e Loop: `pulse` = [Loop], `harmony` = [Pad]; e em `channelNames.test.ts` os rótulos novos ("Bumbo", "Caixa", "Chimbal", "Shaker", "Loop") com família e cor.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempoSources.test.ts src/lib/channelNames.test.ts > "$LOGS/m5.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/lib > "$LOGS/m5b.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempoSources.ts src/lib/tempoSources.test.ts src/lib/channelNames.ts src/lib/channelNames.test.ts
git commit -m "feat(tempo): faixas de analise pela regra central e nomes de bateria em pt e es [Parte 2] [M5]"
```

**Linha pro FATOS:** canais BUMBO, CAIXA, CHIMBAL e BATERA passam a aparecer como peças da Bateria; SHAKER e LOOP como Percussão; BAJO como Baixo.

---

### Tarefa M6: Gerador de click compensando o ataque de cada amostra

**Onda:** 3. **Depende de:** M1, M3 (teste de equivalência na onda anterior).

**Files:**
- Create: `src/lib/clickAttack.ts`, `src/lib/clickAttack.test.ts`, `src/test/clickShims.ts` (os calços de `AudioContext`, `fetch` e `decodeAudioData` que a M1 deixou dentro do teste de equivalência, sem API do Node)
- Modify: `src/lib/AudioAnalyzer.ts` (`generateManualClickTrackFromSample`, por símbolo: posição de cada click), `src/lib/beatGrid.equivalence.test.ts` (passa a importar os calços)

**Interfaces:**
- Produces: `export const CLICK_ATTACK_MS: Readonly<Record<string, number>>` (ataque a -20 dB de cada arquivo, de `scripts/verify-click/samples.json`, campo `first_m20dB_ms`) e `export function attackSeconds(type: ClickTrackType, subdivision: ClickSubdivision): number` (tipos de `src/lib/clickLibrary.ts`; mapeia tipo e subdivisão pro nome do arquivo como `getClickSampleUrl` faz, ex. Classic + quarter → "Classic.wav"; desconhecido dá 0).
- Correção (recomendação 7): cada click em `t - attackSeconds(tipo, subdivisão)` (preso em 0). O caminho reserva `analyzeBufferAndGenerateClick` não muda aqui (quem deixa de chamá-lo é a M7).
- [ ] **Step 1: Escrever `clickAttack.test.ts`**: a tabela tem as 29 amostras de `samples.json`; caso b com a grade CERTA, o início audível (-20 dB, `clickProbe`) fica a no máximo 0,3 ms do golpe com Classic e com Percussive (hoje 1,09 e 4,44 ms com a grade certa).
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/clickAttack.test.ts > "$LOGS/m6.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (e mover os calços; o teste de fumaça da M1 continua passando, agora com erro menor).
- [ ] **Step 4: Rodar e ver passar**, com `src/lib/beatGrid.equivalence.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/clickAttack.ts src/lib/clickAttack.test.ts src/test/clickShims.ts src/lib/AudioAnalyzer.ts src/lib/beatGrid.equivalence.test.ts
git commit -m "fix(click): gerador compensa o ataque de cada amostra [Parte 2] [M6]"
```

---

### Tarefa M7: Fluxo único do click automático e o modal do Metrônomo

**Onda:** 4. **Depende de:** M2 a M6, T1.

**Files:**
- Create: `src/lib/autoClick.ts`, `src/lib/autoClick.test.ts`, `src/components/MetronomeModal.auto.test.tsx`
- Modify: `src/components/MetronomeModal.tsx` (por símbolo: `handleAIGenerate`, o estado do compasso, o `BEATS_PER_BAR` local)

**Interfaces:**
- Produces:

```ts
// autoClick.ts (o motor usa o mesmo na T27)
export interface AutoClickChannel { id: string; name: string; customName?: string; role?: ChannelRole; buffer: AudioBuffer }
export type AutoClickPlan =
  | { ok: true; detection: SongGridDetection; signature: TimeSignature; label: string }
  | { ok: false; reason: 'ja-tem-click' | 'sem-faixa' | 'confianca-baixa'; detection?: SongGridDetection; label: string }
export function toTempoTracks(s: TempoSources<AutoClickChannel>): TempoTrack[]
export function planAutoClick(channels: readonly AutoClickChannel[], opts: { songBpm?: number; signature?: TimeSignature; allowExistingClick?: boolean }): AutoClickPlan
export function renderAutoClick(plan: Extract<AutoClickPlan, { ok: true }>, duration: number, sel: ClickLibrarySelection): Promise<Blob> // generateManualClickTrackFromSample(sel.type, sel.subdivision, ...) com acento no 1
// MetronomeModal: prop nova opcional initialSignature?: TimeSignature
```

- Fluxo (`planAutoClick`): `pickTempoSources`; com click e sem `allowExistingClick`, `ja-tem-click`; sem `pulse`, `sem-faixa`; `detectSongGrid(toTempoTracks(...), sr, { preferBpm: songBpm, signature })`; `confidence < CONFIDENCE_CUT`, `confianca-baixa`. Nunca chama `analyzeBufferAndGenerateClick`.
- Modal (recomendações 3, 5 e 6; causas 6 e 7): com click: "Esta música já tem click (<nome>)." e o botão vira "Gerar outro click" (`allowExistingClick`). Mostra o resultado ANTES de inserir: "BPM 135.0 · analisado em Bateria e Baixo", "½×" e "2×" (pelo `alternatives`), "Mover o 1" ◂ ▸ (como o `SeparatorStudio`), "Deslocar meio tempo" só com `offbeatRisk`, e "Inserir click". `confianca-baixa`: em âmbar "Não deu pra ter certeza do tempo desta música. Confira o BPM ou use o modo manual." e nada é inserido. O compasso inicial vem de `initialSignature`, senão de `localStorage` `mt_meter_<id da música>`, senão 4/4; toda troca grava nessa chave. Tempos do compasso por `pulsesPerBar` (sai o `BEATS_PER_BAR` local).
- [ ] **Step 1: Escrever os testes**: `autoClick.test.ts` (`ja-tem-click`, `sem-faixa`, `confianca-baixa` com detector mockado, `ok` com o caso b sintético, e que `analyzeBufferAndGenerateClick` nunca é chamado); `MetronomeModal.auto.test.tsx` (jsdom; resultado aparece antes de inserir; ½× troca o BPM mostrado; confiança baixa mostra o aviso e não chama `onAddClick`; compasso volta ao reabrir a mesma música; `preferBpm` recebe o BPM da música).
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/autoClick.test.ts src/components/MetronomeModal.auto.test.tsx > "$LOGS/m7.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (botões novos com as peças da Parte 1 e 44px; o resto do modal fica com o visual atual até a Parte 3).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/autoClick.ts src/lib/autoClick.test.ts src/components/MetronomeModal.tsx src/components/MetronomeModal.auto.test.tsx
git commit -m "feat(metronomo): click IA com fluxo unico, resultado antes de inserir e aviso de confianca [Parte 2] [M7]"
```

**Linha pro FATOS (M2 a M7):** metrônomo automático (Gerar click IA) corrigido: kit separado somado, tempo x contratempo, o 1 do compasso, andamentos rápidos, 6/8 e confiança real; mostra o BPM antes de inserir com metade/dobro, mover o 1 e aviso quando não tem certeza; o click sincronizado do Separador ganha as mesmas correções de fase, confiança e "1".

---

## QA do dono (depois da Onda 7, antes de qualquer lançamento)

1. Música de 24 canais, tom 0 e tom +2: armar o Refrão no meio do Verso; contagem só no fone (saída 1), VS (saída 2) sem bipe; entra no 1 sem soluço. O ganho da mesa NÃO precisa mudar em relação à v1.4.15/v1.4.16 (R-24).
2. Cancelar no meio da contagem (X do aviso, tocar de novo na seção, Esc): para na hora, a seção segue, a guia volta.
3. REPETIR 2x, LOOP e ∞; tocar em outra seção durante a contagem troca o alvo.
4. Música sem click (plano pago): o click gerado aparece ao carregar; numa música difícil (sem bateria), não gera e mostra o aviso âmbar. Plano Livre: botoeira com o convite.
5. Focusrite de 2 canais: "Click e Guia separados" com os dois lados; trocar o aparelho tocando; placa de 4 ou mais (se tiver) com o mapa. Repertório antigo com o pan automático: os pans voltaram ao centro e a mesa soa igual.
6. Chave Palco: Antigo com a música tocando: nada muda até parar; depois da parada, o palco antigo funciona como na v1.4.16. Janela do desktop estreita (menos de 1024 px): palco antigo inteiro.
7. App atrás do Holyrics ou do OBS por 1 minuto com loop ∞ armado: o loop segue no tempo (desktop).
8. 1024x768 (iPad paisagem), 1280x800 e 1920x1080: nenhum texto cortado; M/S tocáveis; fader não pula com toque sem querer.
9. Celular no Modo Ao Vivo: vê "PRÓXIMA: <seção>" e as bolinhas; "repetir 2" pelo celular numa outra seção dá 3 passagens, como antes.
10. Metrônomo: "Gerar click IA" numa música sincopada, numa rápida (160 BPM ou mais) e numa 6/8; no Separador, o click sincronizado continua no lugar.
11. Canais com nome BUMBO, CAIXA, CHIMBAL, SHAKER ou LOOP aparecem com o nome e a cor novos.
