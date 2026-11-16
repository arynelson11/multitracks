# Parte 2: palco novo + troca de seção agendada (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Entregar o palco novo do mockup v5 (computador e tablet) com a troca de seção musical: armar, contar 1-2-3-4 só no click e entrar no "1" do compasso seguinte, agendado no relógio do áudio; mais saídas de áudio separadas (VS x Click/Guia), compasso lido do acento do click, BPM com decimais, modo EDITAR do palco, protocolo do Modo Ao Vivo e uma chave pra voltar ao palco antigo.

**Arquitetura:** A lógica de tempo vira módulos puros testados (grade da música, compasso pelo acento, plano da transição, intenção armada, linha do tempo, plano de saídas). O som é montado por peças pequenas de Web Audio testadas com um AudioContext falso (vozes com envelope, bipes da contagem, roteador de saídas por papel) e por um agendador "dois relógios": um relógio em Worker decide QUANDO agendar e todo evento audível é marcado em `AudioContext.currentTime`. O palco novo é uma árvore de componentes pequenos em `src/components/stage/`, alimentada por um contrato único (`StageView` + `StageActions` + `StageClock`), e o `App.tsx` só escolhe entre o palco novo e o antigo pela chave.

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4.2 (tokens `ps-*` da Parte 1) + Web Audio (AudioBufferSourceNode, GainNode, ChannelMerger/Splitter, setSinkId) + signalsmith-stretch (só com tom diferente de 0) + Electron 42 + Vitest 4/jsdom/Testing Library + harness de áudio no Chrome headless (`scripts/verify-pitch/`).

**Spec:** `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (seções 4, 5, "Detalhes aprovados no mockup v5", 5d, 5e, 8, 9, 9b e 10). **Visual (fonte da verdade do layout):** `.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` (CSS nas linhas 10 a 362, marcação nas linhas 391 a 534). **Lógica de armar/contar/pular com som:** `palco-desktop-v6.html` na mesma pasta (agendamento nas linhas 856 a 936, armar e estados nas linhas 1012 a 1107, mixer nas linhas 1110 a 1167, teclado nas linhas 1334 a 1343, bipe da contagem `vCount` na linha 689). **Modelo de formato e decisões da Parte 1:** `docs/superpowers/plans/2026-11-15-parte1-linguagem-canais.md` e `.superpowers/sdd/2026-11-15-parte1-linguagem-canais/progress.md` (linhas "Ruling:" e PASSO DE JUNÇÃO).

## Global Constraints

- Tudo em português do Brasil. Nenhum travessão (caractere Unicode U+2014) em texto de interface, comentário novo, doc ou commit. Nos testes, procurar por ele com `const TRAVESSAO = String.fromCharCode(0x2014)` (nunca o caractere no código). Nenhum texto de interface em inglês.
- Nenhum texto encostando na borda ou cortado (pedido explícito do dono). Botões com largura que acompanha o texto (padding), nunca largura fixa com texto dentro. O palco novo passa no verificador da Tarefa 20 em 1024x768, 1280x760, 1280x800, 1440x900 e 1920x1080.
- Alvos de toque de pelo menos 44px. Única exceção: M/S do mixer com 14 canais em 1280px, que fica em ~36x32px (aprovado no mockup v5), marcados com `data-touch-exception="ms"`.
- Código de cores com um significado só: laranja `#FF6B35` (`ps-or`) = ligado; branco `#F5F5F7` (`ps-arm`) = armado; cor da seção = seção; âmbar `#fbbf24` (`ps-alert`) = alerta.
- Identidade: dark `#121214`, laranja `#FF6B35`, bone `#E8E8EC`, musgo `#5B6B47`. Seções (de `SECTION_SHORTCUTS`): Intro `#3b82f6`, Verso `#10b981`, Pré `#f59e0b`, Refrão `#FF6B35`, Ponte `#8b5cf6`, Final `#ec4899`.
- Inter + JetBrains Mono com números de largura fixa (`ps-num`). Ícones em SVG (os de `src/components/stage/icons.tsx`), nunca caractere que vira emoji no Mac.
- Componentes novos usam só tokens `ps-*` e peças de `src/components/ui/`. Cor literal só a que vem de dado (cor da seção, cor da família do canal). Token novo só com prefixo `ps-`.
- Desktop roda de `file://`: nada de caminho absoluto `/` pra asset (usar import do Vite ou `import.meta.env.BASE_URL`); API só via `apiUrl()`; Worker só por Blob URL.
- **Relógio do áudio manda.** Todo evento audível (início e fim de voz, cruzamento, bipe de contagem, pré-contagem, calar a guia, restaurar o principal) é marcado com tempo do `AudioContext`. `setTimeout`, `setInterval` e `requestAnimationFrame` só decidem QUANDO agendar ou atualizam a tela; nunca disparam o instante de um som.
- **Contagem e guia nunca na PA.** A contagem entra só pela entrada do canal de Click (ou direto no barramento do Click quando a música não tem canal de click) e sai onde o Click sai. Em "Click e Guia separados" e em "4 ou mais saídas", nada dos barramentos Click e Guia chega a uma saída da VS.
- Desempenho: nenhum worklet novo; no máximo um worklet de tom por canal (reserva por id da v1.4.14) e só com tom diferente de 0. Nós nativos permitidos: 1 envelope (GainNode) por voz, no máximo 2 vozes vivas por canal (só durante um cruzamento), 3 barramentos por papel e o roteador. Nada é criado por quadro de tela.
- Click e Guia continuam tocando quando outro canal está em Solo; o M deles continua valendo (spec 9b, Parte 1).
- Manual vence automático: papel manual do canal, compasso escolhido no modo EDITAR, nome do usuário.
- Dados: compasso e grade corrigidos pelo usuário ficam no repertório dele (`SavedSong`) e no aparelho. Na nuvem (`songs`) só escrevem admin ou o dono da música privada, pelas colunas novas `bpm_exact` e `time_signature`. O índice do cache offline só muda pelo caminho que já existe (`updateCachedSongMeta`).
- Planos (`src/lib/plans.ts`): seções e loop infinito são dos pagos (`canUseSections`); banda controlando seções é do Studio (`canBandControlSections`); grade detectada e click gerado são dos pagos (`canUseBpmDetection`). No Livre a botoeira mostra o convite pra marcar seções, que abre o upgrade.
- Nenhuma função existente some: o palco antigo continua inteiro atrás da chave; MARCAR e EDITAR seções saem do palco e vão pro modo EDITAR; lista do repertório e Anotações vão pro painel REPERTÓRIOS.
- Toda função async que faz `setIsLoading(true)` tem `try/finally`.
- Vocabulário de copy: "multitracks", "faixas", "separação de faixas" (não "stems"); "VS" pro playback que vai pra PA.
- Branch `feat/palco-parte2` num clone FORA do iCloud (`~/playback-studio-work/parte2`); commits convencionais com `[Parte 2] [T<N>]`; sempre `git add <arquivo>` por nome, nunca `git add -A`; `git push` e tag só pelo @devops; nada vai pra produção sem o dono ver e aprovar; lançamento web + desktop juntos.
- Toolchain: Node 24 (`source ~/.nvm/nvm.sh && nvm use 24 >/dev/null`), saída de comando redirecionada pra arquivo (`LOGS="$(mktemp -d)"`). Portão de eslint: 0 erros nos arquivos novos e nenhum erro novo nos antigos (Ruling 1 da Parte 1).
- `PLAYBACK_STUDIO_FATOS.md` acompanha cada mudança visível: cada tarefa com efeito pro usuário termina com uma "Linha pro FATOS" no relatório, e o coordenador aplica as linhas no portão da onda (um escritor só, sem conflito). A Tarefa 31 consolida.

## Review Focus

Condições que o spec implica e que mais machucam um operador ao vivo diante do público, cada uma com o teste que a prende na tarefa dona do código:

1. **Contagem ou guia vazando pra PA** em qualquer modo de saída: aparelho de 2 canais com "4 ou mais saídas" escolhido, mapa de saídas com Click em cima da VS, papel do canal trocado na mão no meio da música, música sem canal de click. Esperado: nada do Click/Guia em saída da VS. Testes: T6 `nenhum plano separado põe click ou guia numa saída da VS` (varre todos os mapas e contagens de canal), T12 `split2 e multi nunca ligam os barramentos click e guia numa entrada do merger usada pela VS`, T25 `a pré-contagem nunca liga no destino direto`, T28 `sem canal de click a contagem vai pro barramento do click`, T30 cenário `SPLIT` (energia da contagem e da guia na saída da VS abaixo de -60 dB).
2. **Ministro muda de ideia durante a contagem** (cancelar ou trocar o alvo no último compasso). Esperado: a contagem para na hora, a seção atual segue sem emenda, a guia volta, nenhum som novo entra; trocar o alvo mantém a contagem e o "1". Testes: T17 `cancelar depois de agendado para os bipes, devolve a guia e as vozes antigas` e `trocar o alvo durante a contagem troca só as vozes novas`, T30 cenário `CANCEL`.
3. **Armar em cima da hora, pausar ou buscar com pulo armado** (toque a menos de 50 ms do fim da seção, Espaço logo depois de armar, arrastar a régua). Esperado: o pulo vai pro fim da seção que estiver tocando depois da folga mínima, nunca duas levas de som; pausa e busca re-planejam sem perder a intenção. Testes: T11 `armar a menos da folga mínima mira o fim da seção seguinte`, T17 `reset cancela o agendado e o próximo tick re-planeja na linha do tempo nova`, T28 `pausar com pulo agendado não deixa voz nem bipe vivo`.
4. **Pulo com tom diferente de 0** (worklets ligados, compensação de latência no click/guia). Esperado: cai no "1" com o mesmo erro do tom 0, sem silêncio e sem worklet novo; a guia cala e volta no tempo ouvido (com a latência). Testes: T7 `voz nova entra na mesma entrada do canal (worklet ou atraso), sem criar nó de tom`, T17 `calar a guia usa o tempo ouvido (soma a latência da entrada)`, T30 cenário `JUMP` com `pitch=2`.
5. **App atrás de outra janela no culto** (Holyrics, OBS, projetor), com timers e rAF estrangulados. Esperado: o pulo agendado e o fim de música continuam no tempo. Testes: T5 `o relógio usa Worker e não setInterval da janela`, T29 `electron/main.ts liga backgroundThrottling: false`, item de QA do dono (cobrir o app com outra janela por 1 minuto com pulo armado em loop ∞).

---

## Pré-requisitos

- [ ] **P1. Clone de trabalho fora do iCloud.** `git clone --filter=blob:none <origin do GitHub> ~/playback-studio-work/parte2`, depois `git -C ~/playback-studio-work/parte2 fetch ~/playback-studio-work/juncao p1-orig:p1-orig` (o `p1-orig` do clone da junção é a branch da Parte 1, HEAD `0ca0147`). `npm ci` com Node 24. O repo do iCloud não é usado pra executar (trava git, tsc e eslint; fetch quebrado).
- [ ] **P2. Branch das ondas antes da junção:** `git switch -c feat/palco-parte2 p1-orig`. Nas Ondas 0 a 5 só entram ARQUIVOS NOVOS, mais os 3 arquivos do Grupo M que a junção não muda (`beatGrid.ts`, `AudioAnalyzer.ts`, `MetronomeModal.tsx`; ver B2), pra que a troca de base depois da junção seja limpa.
- [ ] **P2b. Scripts de medição do metrônomo:** copiar `~/playback-studio-work/metronomo/scripts/verify-click/` (sem `node_modules`, `dist` e `results*`) pro clone em `scripts/verify-click/`; a M1 commita.
- [ ] **P3. Docs visíveis aos agentes:** copiar pro clone e commitar (`git add` por nome) o spec, este plano e os mockups v5 e v6: `docs: spec, mockups v5/v6 e plano da Parte 2 [Parte 2]`.
- [ ] **P4. Paleta de famílias aprovada (condição de entrada da Parte 2, Ruling 9 + M8 da Parte 1).** O dono aprova ou ajusta a tabela da Tarefa 21. A Tarefa 21 só roda com a tabela aprovada; as outras tarefas não dependem dela.
- [ ] **P5. Portão J (junção).** Antes da Onda 6: a junção da Parte 1 com o motor novo (v1.4.14/v1.4.15, PASSO DE JUNÇÃO + R1 a R6 do `progress.md`) está concluída e revisada na branch `feat/palco-parte1-juncao`. Então: `git fetch ~/playback-studio-work/juncao feat/palco-parte1-juncao:juncao` e `git rebase --onto juncao p1-orig feat/palco-parte2`. Como as Ondas 0 a 5 só criaram arquivos (mais os 3 do Grupo M, iguais nas duas bases), o rebase não tem conflito; conferir antes `git diff p1-orig juncao -- src/lib/beatGrid.ts src/lib/AudioAnalyzer.ts src/lib/clickLibrary.ts src/components/MetronomeModal.tsx` vazio e rodar o portão completo logo depois.

## Ondas, dependências e paralelismo

| Onda | Tarefas (arquivos disjuntos dentro da onda) | Depende de | Antes da junção? |
|---|---|---|---|
| 0 | T1 Fundação · M1 Base do detector de tempo | P1 a P3 | **SIM** |
| 1 | T2 Grade · T3 Compasso pelo acento · T4 Intenção armada · T5 Linha do tempo e relógio · T6 Plano de saídas · T7 Vozes e contagem · T8 Transporte e PRÓXIMA · M2 Tempo x contratempo e confiança real · M5 Faixas de análise | T1 (T2 a T8); M1 (M2); nada (M5) | **SIM** |
| 2 | T9 Onda com seções · T10 Botoeira · T11 Plano da transição · T12 Roteador de saídas · M4 Andamento: oitava, compasso composto e BPM da música · M6 Gerador: ataque da amostra | T9, T10: T1. T11: T2. T12: T6. M4: M1. M6: M1 | **SIM** |
| 3 | T13 Faixa do meio · T14 Mixer novo · T15 Barra do app, REPERTÓRIOS e pads · T16 Modo EDITAR (seções e compasso) · M3 O "1" do compasso | T13 a T15: T1. T16: T2. M3: M2 | **SIM** |
| 4 | T17 Agendador da troca · T18 Casca do palco e atalhos · T19 Configurações de saída e chave · M7 Metrônomo automático no modal | T17: T4, T5, T7, T11. T18: T8 a T10, T13 a T16. T19: T6. M7: M2 a M6 | **SIM** |
| 5 | T20 Verificador de texto cortado | T18 | **SIM** |
| J | Portão J (P5) | junção concluída | |
| 6 | T21 Paleta · T22 Repertório v3 · T23 Nuvem: BPM decimal e compasso · T25 Motor: saídas por papel | P4 (só T21), P5 | não |
| 7 | T24 Modo Ao Vivo: protocolo · T26 Motor: vozes, linha do tempo e pré-contagem | T26: T25, T5, T7. T24: T4 | não |
| 8 | T27 Motor: grade pela faixa de click e click que falta | T26, T2, T3, T22, M7 | não |
| 9 | T28 Motor: pulo agendado e modo antigo | T27, T17 | não |
| 10 | T29 App: palco novo ligado com a chave · T30 Harness: pulo, contagem e saídas | T29: T18, T19, T23, T24, T28. T30: T28 | não |
| 11 | T31 Documentação viva | todas | não |

**Começam já (não dependem da junção):** T1 a T20 (todas em arquivos novos) e o Grupo M inteiro, M1 a M7 (arquivos novos, mais `beatGrid.ts`, `AudioAnalyzer.ts` e `MetronomeModal.tsx`, que a junção não muda; ver B2). **Dependem da junção:** T21 a T31 (editam arquivos que a junção também mexe: `useAudioEngine.ts`, `App.tsx`, `types.ts`, `channelNames.ts`, `repertoireSchema.ts`, `SettingsContext.tsx`, `SettingsModal.tsx`, `useLiveSync.ts`, `FollowerView.tsx`, biblioteca e nuvem).

O Grupo M também pode sair sozinho antes da Parte 2 (uma versão só do metrônomo, como foi o hotfix do tom), se o dono quiser: ele não depende de nenhuma tarefa T.

**Regras de execução paralela (iguais às da Parte 1):**
- Cada agente só toca os arquivos do bloco **Files** da sua tarefa. Se precisar de outro, para e avisa o coordenador.
- Checkout compartilhado no clone fora do iCloud (Ruling 2 da Parte 1). Commits pequenos, por nome de arquivo, com `[T<N>]` na mensagem. Se aparecer `.git/index.lock`, esperar alguns segundos e repetir; nunca apagar o lock de outro agente.
- Cada agente roda só os testes da própria tarefa. `tsc`, eslint e build completos são do **portão da onda** (coordenador), com o mesmo bloco de comandos da Parte 1 (`vitest run`, `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, eslint nos arquivos da onda, `DESKTOP=1 vite build`). Da Onda 5 em diante o portão roda também `node scripts/verify-layout/run.mjs`; da Onda 6 em diante, `node scripts/verify-pitch/run.mjs`.
- Todo comando de tarefa começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd ~/playback-studio-work/parte2`.

## Arquitetura (decisões que valem pra várias tarefas)

### A. Pulo agendado no relógio do áudio

- **Voz** = uma `AudioBufferSourceNode` + um envelope `GainNode` próprio, ligado na **entrada do canal**: o worklet de tom do canal (tom diferente de 0), o `DelayNode` de compensação (click/guia com a música transposta) ou o `StereoPannerNode` (tom 0). O resto da cadeia do canal (panner, fader, barramento) não muda. Assim o pulo nunca cria worklet nem duplica cadeia.
- **Troca** no instante `T` (o "1" do compasso seguinte, em tempo do contexto): as vozes novas começam em `T - FADE` com offset `alvo - FADE` e o envelope sobe de 0 a 1 em `[T - FADE, T]`; as vozes antigas descem de 1 a 0 no mesmo trecho e continuam mudas até o agendador soltá-las (depois de `T + FADE + 30 ms`). `FADE = 0,005 s`. Com o alvo em 0:00 (sem pré-rolagem possível) a voz nova começa em `T` com envelope 1.
- **Contagem**: bipes sintetizados (receita `vCount` do v6: 1319 Hz no tempo 1 e 988 Hz nos outros, triângulo + quadrada no dobro a 0,1, ataque 4 ms, sustenta até 75 ms, cai até 190 ms, passa-baixa 5200 Hz, picos 0,85 e 0,68) agendados nos tempos do último compasso, ancorados em `T` (`T - k * pulso`), e ligados na entrada do canal de click (passam pelo pan, fader e M dele). O click do arquivo continua tocando por baixo. Se faltam tempos (armou tarde), sai só o que resta, com o número real do tempo (ex.: 3 e 4).
- **Guia calada no último compasso** (9b): automação no ganho do barramento da Guia (não no fader, que o M e o volume cancelam), de `inícioDaContagem + L` até `T + L`, com rampas de 10 ms, onde `L` é a latência da entrada da guia (compensação do tom; 0 no tom 0).
- **Dois relógios**: um Worker (Blob URL) dá um tique a cada 25 ms; em cada tique o agendador recalcula o plano. Nada é agendado antes de faltar `HORIZON = 0,3 s` pro primeiro evento do pulo (primeiro bipe, `T - FADE` ou início da guia calada): armar, trocar e cancelar antes disso não custa nada. Depois de agendado, cancelar vale até `T - 0,03 s` (para os bipes em `now`, devolve a guia em `now`, cancela a descida das vozes antigas e para as vozes novas antes de começarem); depois disso o pulo acontece e a intenção é cancelada logo após.
- **Folga mínima**: o plano é calculado na posição `agora + MIN_LEAD` (`MIN_LEAD = 0,05 s`). Armar a menos disso do fim da seção mira o fim da seção seguinte (determinístico).
- **Linha do tempo**: a posição da música sai de segmentos `{ ctxStart, songStart }`; o pulo agendado acrescenta um segmento em `T`. `getPlaybackPosition` passa a ser `positionAt(segmentos, ctx.currentTime)`. A tela usa o tempo **ouvido**: `ctx.currentTime - outputLatency - L`.
- **Intenção armada** `{ target, plays }`: tocar numa seção tocando arma `{ i, 1 }`; tocar na seção atual = REPETE; REPETIR N = `{ atual, N }`; LOOP e ∞ = `{ atual, 'infinite' }`; tocar de novo na armada cancela; tocar em outra troca o alvo; depois de pousar, `plays` desce 1 (∞ continua). Parado, tocar numa seção leva a VS pro início dela (9b).
- **Fim de música e FADE**: com intenção armada o FADE não começa; se já começou, o pulo devolve o ganho do principal em `T`. O fim da seção final é `min(barra encaixada, duração)` (nunca depois do áudio acabar). O fim da música e o AUTO passam a ser vistos no tique do Worker (não só no rAF).
- **Palco antigo**: a chave "Palco: Antigo" volta a tela antiga E o mecanismo antigo de loop/salto (rAF + `seekTo`, sem contagem). As saídas por papel e a pré-contagem nova valem nos dois (a pré-contagem antiga ia direto pro `destination` e vazaria na PA no modo separado).

### B. Grade e compasso

- **A grade do palco vem SÓ da faixa de click** (sinal limpo e é o que a banda ouve). Medição do coordenador (`.superpowers/sdd/metronomo-auto-investigacao.md`): o `detectBeatGrid` sobre a bateria acerta o tempo quando trava (0,2 a 6,8 ms), mas erra a fase em síncope e contratempo (285 a 394 ms), o "1" em 23 de 54 cenários 4/4, sai pela metade em 160/176 BPM, confunde 6/8 e a confiança não separa pulso de ruído. Por isso o pulo e a contagem nunca dependem do `detectBeatGrid` sobre a bateria.
- **Grade da música** `SongGrid = { bpm, firstDownbeat, signature, countEvery, source, meterSource }`, com `bpm` em pulsos do click por minuto, com decimais. BPM e fase (`source`): `manual` (modo EDITAR) > `click` (lido na faixa de click, original ou gerada pelo app) > `bpm` (BPM salvo da música, sem fase: a contagem fica ancorada no "1" de destino) > nenhuma. Compasso (`meterSource`): `manual` > `salvo` (`time_signature` da nuvem) > `acento` (lido no click) > `padrao` (4/4).
- **Fallback explícito, nunca silencioso** (`gridWarning`): sem grade nenhuma, "SEM GRADE" (o pulo cai na marca, sem contagem); grade do BPM salvo, "SEM CLICK LIDO" (contagem pelo BPM salvo); compasso assumido, "4/4 ASSUMIDO". Os três em âmbar (`ps-alert`) na célula de tempo, com a explicação no `title`, e o aviso PRÓXIMA repete o primeiro quando há pulo armado.
- **Música sem click** (spec 4.5): o click é gerado pelo metrônomo automático corrigido no Grupo M, só quando a confiança calibrada passa do corte; abaixo do corte não gera nada (nunca o caminho da v1.4.9) e vale o fallback acima. Depois de gerado, a grade é lida do click gerado, como de qualquer click.
- **Compasso pelo acento** (função pura `analyzeClickTrack`): acha os ataques do click, mede período e fase por mínimos quadrados (BPM com decimais), mede em cada ataque o pico e o brilho (cruzamentos por zero nos primeiros 15 ms), separa acentuados de normais pelo meio entre os dois grupos (2-médias) e testa `m` em 3, 4, 5, 6, 7 e 12, nessa ordem: aceita o primeiro `m` com exatamente uma fase em que pelo menos 80% dos ataques são acentuados e todas as outras fases com no máximo 20%, vista em pelo menos 4 compassos. Sem acento reconhecível: 4/4. `m` vira `3/4`, `4/4`, `5/4`, `6/8`, `7/8` ou `12/8` (o tipo `TimeSignatureType` que já existe em `AudioAnalyzer.ts`).
- **Encaixe no compasso**: as seções já salvas NÃO são regravadas. Na hora do pulo, o início de cada seção é encaixado na barra mais perto quando a grade tem fase conhecida (`click`, `audio`, `manual`) e a marca está a até 1/4 de compasso dela; senão vale a marca crua. Seções novas (MARCAR no modo EDITAR) já nascem encaixadas.
- **Contagem**: `countEvery` 1 conta todos os pulsos do compasso; 3 conta de 3 em 3 (6/8 conta 2, 12/8 conta 4). Sem grade nenhuma: o pulo cai na marca crua e não há contagem (o aviso mostra "no fim da seção").

### B2. Grupo M: metrônomo automático corrigido (antes da junção)

- Corrige as causas 2 a 8 do relatório do coordenador (`.superpowers/sdd/metronomo-auto-investigacao.md`) e serve a dois lugares: o botão "Gerar click IA" do Metrônomo e o click que falta no palco (T27).
- `beatGrid.ts` é dividido em etapas puras em `src/lib/tempo/` (ataques por banda, tempo x contratempo, o "1", confiança, oitava). A M1 faz a divisão SEM mudar o resultado (teste de equivalência) e porta pro Vitest os sintéticos de `~/playback-studio-work/metronomo/scripts/verify-click/` (`synth.mjs`, `harness.mjs`). Cada tarefa seguinte troca uma etapa e transforma uma linha da tabela do relatório em teste que tem de passar.
- `detectBeatGrid` continua com a mesma assinatura (o Separador usa); a análise nova de várias faixas é `detectSongGrid`.
- Pode rodar antes da junção: `beatGrid.ts`, `AudioAnalyzer.ts` e `clickLibrary.ts` são idênticos na base da Parte 1 (`p1-orig`) e no `main`, e o `MetronomeModal.tsx` só difere pelo T7 da Parte 1, que já está na base. O coordenador confere `git diff p1-orig juncao -- src/lib/beatGrid.ts src/lib/AudioAnalyzer.ts src/lib/clickLibrary.ts src/components/MetronomeModal.tsx` vazio no Portão J (senão, resolve a troca de base com a versão do Grupo M).

### C. Saídas independentes (5e)

- Cada canal liga o fader (`gainNode`) no **barramento do papel** (`click`, `guide`, `normal`) pelo `resolveChannelRole` da Parte 1 (papel manual vence). Os barramentos vão pro **roteador** e dele pro principal (`master`) e pro mudo geral, e daí pro `destination`.
- Modos (`OutputMode`): `stereo` "Tudo junto" (como hoje; pan vale; pan automático antigo só aqui); `split2` "Click e Guia separados" (saída 1 = Click + Guia, saída 2 = VS mono; lado trocável; pan ignorado, a VS é a média de L e R, nunca a soma, então o pico da VS mono nunca passa do maior pico entre L e R do estéreo); `multi` "4 ou mais saídas" (VS estéreo num par, por padrão 1/2, com o pan valendo; Click e Guia em saídas próprias, por padrão 3 e 4, ou na mesma; `destination.channelCount` = canais do aparelho e `channelInterpretation = 'discrete'`).
- Implementação: `ChannelMergerNode` (cada entrada já faz a média pra mono) e `ChannelSplitterNode` pro par estéreo da VS. Trocar de modo ou de aparelho religa só o roteador, sem recriar canais.
- Quem tem hoje o pan automático ligado (padrão) entra em `split2` com Click/Guia na saída 1, o mesmo resultado físico de hoje.
- **Web**: Chrome/Edge têm `AudioContext.setSinkId` e `destination.maxChannelCount` real depois do `setSinkId`. **Electron 42**: o mesmo (Chromium). **Limites conhecidos**: Safari/iPad sem `setSinkId` no AudioContext e com 2 canais (só `stereo` e `split2`, na saída do sistema); Firefox sem `setSinkId` no AudioContext; no Windows algumas placas multicanal aparecem como vários aparelhos estéreo e um AudioContext só fala com um aparelho (aí "4 ou mais saídas" não aparece e o app cai em `split2`, com aviso); sem ASIO. Pads e samples usam outro AudioContext e saem na saída padrão do sistema, nos dois lados (limite conhecido, fora deste plano).

### D. Palco novo e chave

- Componentes em `src/components/stage/`, um por peça do mockup, alimentados pelo contrato da T1. Valores que mudam a cada quadro (playhead, tempo, bolinhas, VU, anel do Play) são lidos por `useFrame` dentro da própria peça, sem re-renderizar a árvore.
- **Chave**: `settings.stageVersion: 'novo' | 'antigo'` (padrão `'novo'`), em CONFIG > Geral, primeira opção, nos dois palcos. Fica longe do palco pra não ser tocada sem querer no culto, e CONFIG está a um toque nos dois. Trocar não para o som (cancela só uma intenção armada).
- Abaixo de 1024x600 o app mostra sempre o layout atual (celular e tablet em retrato ficam pro Projeto 3).
- Entre 1024 e 1279px: mesma ordem de faixas, a faixa do meio esconde o nome do repertório e encolhe a capa, e o mixer rola de lado mostrando só canais inteiros (regra atual de `stripsRef`), sem texto cortado (verificado na T20).

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/lib/stageContracts.ts`, `src/components/stage/icons.tsx`, `src/components/stage/useFrame.ts`, `src/test/fakeAudio.ts` | Contratos do palco e do motor, ícones SVG, laço de quadro, AudioContext falso pros testes | 1 |
| `src/lib/songGrid.ts` | Grade da música: barras, encaixe, seções encaixadas | 2 |
| `src/lib/clickMeter.ts` | Compasso e BPM pelo acento do click | 3 |
| `src/lib/sectionArm.ts` | Intenção armada (armar, repetir, loop, cancelar) | 4 |
| `src/lib/playTimeline.ts`, `src/audio/schedulerClock.ts` | Posição pela linha do tempo; relógio do agendador em Worker | 5 |
| `src/lib/outputPlan.ts` | Plano de saídas por modo e aparelho | 6 |
| `src/audio/voices.ts`, `src/audio/countTones.ts` | Vozes com envelope e cruzamento; bipes da contagem | 7 |
| `src/components/stage/TransportBar.tsx`, `NextPill.tsx`, `PlayButton.tsx` | Transporte e aviso PRÓXIMA | 8 |
| `src/components/stage/WaveformSections.tsx`, `src/components/stage/wavePeaks.ts` | Onda grande com blocos, seta e régua | 9 |
| `src/components/stage/SectionPads.tsx` | Botoeira de seções (e convite no Livre) | 10 |
| `src/lib/sectionTransition.ts` | Plano da troca: instante, alvo, contagem, guia | 11 |
| `src/audio/outputGraph.ts` | Barramentos por papel e roteador de saídas | 12 |
| `src/components/stage/MidStrip.tsx` e células (`TimeCell`, `KeyCell`, `CurrentSectionCell`, `SongCell`, `BigButton`) | Faixa do meio | 13 |
| `src/components/stage/StageMixer.tsx`, `ChannelStrip.tsx`, `PanKnob.tsx`, `FaderVU.tsx`, `MasterStrip.tsx`, `src/lib/faderScale.ts` | Mixer novo | 14 |
| `src/components/stage/StageAppBar.tsx`, `RepertoirePanel.tsx`, `PadPanel.tsx` | Barra do app, painel REPERTÓRIOS (lista + Anotações), painel de pads | 15 |
| `src/lib/sectionEdit.ts`, `src/components/stage/SectionEditBar.tsx`, `MeterEditor.tsx` | Modo EDITAR: marcar, ajustar, remover, compasso | 16 |
| `src/audio/sectionScheduler.ts` | Agendador da troca de seção | 17 |
| `src/components/stage/StageShell.tsx`, `useStageShortcuts.ts`, `useStageViewport.ts` | Casca do palco, atalhos e regra de tamanho de tela | 18 |
| `src/components/settings/AudioOutputsSection.tsx`, `StageVersionSetting.tsx` | Configurações de saída e chave do palco | 19 |
| `scripts/verify-layout/*` | Verificador de texto cortado e alvos de toque | 20 |
| `src/lib/beatGrid.ts`, `src/lib/tempo/*`, `src/test/synthMusic.ts`, `src/test/clickProbe.ts`, `src/test/legacyBeatGrid.ts`, `scripts/verify-click/*` | Detector de tempo em etapas, sintéticos do relatório, cópia congelada do detector antigo pro teste de equivalência | M1 (M2, M3, M4 trocam uma etapa cada) |
| `src/lib/tempoSources.ts` | Faixas de análise pela regra central (bateria inteira, baixo, harmonia, click) | M5 |
| `src/lib/clickAttack.ts`, `src/lib/AudioAnalyzer.ts` | Compensação do ataque de cada amostra de click | M6 |
| `src/components/MetronomeModal.tsx` | Metrônomo automático: resultado antes de inserir, ½× e 2×, mover o 1, meio tempo, aviso de confiança, compasso lembrado | M7 |
| `src/lib/channelNames.ts` (só `FAMILY_COLOR`) | Paleta de famílias aprovada | 21 |
| `src/lib/repertoireSchema.ts`, `src/types.ts` (`Song.grid`, `Song.timeSignature`) | Repertório v3 com a grade | 22 |
| `db/supabase-bpm-exact-migration.sql`, `api/insert-song.ts`, `src/lib/supabase.ts`, `src/hooks/useCloudLibrary.ts`, `src/lib/offlineCache.ts`, `src/components/LibraryModal.tsx`, `src/components/AdminModal.tsx` | BPM com decimais e compasso na nuvem e nos 3 lugares | 23 |
| `src/hooks/useLiveSync.ts`, `src/components/FollowerView.tsx`, `src/types.ts` (`WsMessage`) | Protocolo do pulo no Modo Ao Vivo | 24 |
| `src/hooks/useAudioEngine.ts`, `src/contexts/SettingsContext.tsx` | Saídas por papel (25); vozes, linha do tempo e pré-contagem (26); grade e click que falta (27); pulo agendado e modo antigo (28) | 25 a 28 |
| `src/App.tsx`, `src/components/SettingsModal.tsx`, `electron/main.ts` | Palco novo ligado, chave, Ao Vivo do host | 29 |
| `scripts/verify-pitch/*` | Cenários JUMP, CANCEL, SPLIT, PRECOUNT | 30 |
| `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` | Documentação viva | 31 |

## Decisões tomadas neste plano (o dono deve conferir)

1. O pulo troca as fontes de áudio num instante marcado no relógio do áudio, com cruzamento de 5 ms que termina exatamente no "1"; o agendamento só acontece 0,3 s antes do primeiro som do pulo, e cancelar vale até 30 ms antes do "1".
2. A contagem é um bipe sintetizado (o do protótipo v6) tocando por cima do click do arquivo, dentro do canal Click (respeita fader, pan e M). O click do arquivo não é calado: se algo falhar na contagem, a banda continua com o click.
3. LOOP e ∞ repetem sem contagem e sem calar a guia (como no protótipo v6); REPETIR N conta a cada volta (spec 4.6).
4. A grade do palco (BPM com decimais, onde cai o 1, compasso) vem só da faixa de click, nunca do `detectBeatGrid` sobre a bateria. Compasso pelo acento (mais forte ou mais agudo) com a regra 80%/20% em pelo menos 4 compassos. Ordem do compasso: o do modo EDITAR > o salvo na nuvem (`time_signature`, gravado pelo admin) > o acento > 4/4. Sem click lido vale o BPM salvo e, sem nada, o pulo cai na marca sem contagem; cada fallback aparece em âmbar ("SEM CLICK LIDO", "4/4 ASSUMIDO", "SEM GRADE").
5. Seções já salvas não são regravadas: na hora do pulo o início é encaixado na barra mais perto (até 1/4 de compasso); seções novas nascem encaixadas; uma marca em 0:00 nunca é mexida.
6. Saídas em 3 modos: "Tudo junto", "Click e Guia separados" e "4 ou mais saídas". Quem usa o pan automático hoje (padrão) entra em "separados" com Click/Guia na saída 1. Em 2 saídas o pan dos canais fica sem efeito (a VS é mono) e a VS é a média de L e R. Pads e samples continuam na saída padrão do sistema (limite conhecido).
7. Chave "Palco: Novo | Antigo" em CONFIG > Geral, padrão Novo. "Antigo" volta a tela E o mecanismo antigo de loop/salto (sem contagem). Abaixo de 1024x600 o app mostra sempre o layout atual.
8. BPM com decimais na nuvem por coluna nova `songs.bpm_exact` (o `bpm` inteiro fica pros apps antigos) e compasso em `songs.time_signature`; a migration roda ANTES de lançar o app que grava nelas.
9. O click que falta é gerado só nos planos pagos (é o "BPM pela IA") e só quando o metrônomo automático corrigido (Grupo M) passa do corte de confiança calibrado; abaixo disso não gera (o caminho da v1.4.9, click colado em 0:00, sai do uso). Gera ao carregar uma música nova e, pras músicas já salvas, em segundo plano depois de abrir o app, uma por vez, nunca na música que está tocando.
13. Metrônomo automático (Grupo M): mostra o resultado antes de inserir (BPM, faixas usadas, ½× e 2×), oferece "Deslocar meio tempo" quando tempo e contratempo ficam parecidos, traz o "Mover o 1" do Separador, usa o BPM da música como referência, lembra o compasso por música e avisa em âmbar quando a confiança é baixa (aí não insere sozinho). As melhorias valem também pro click sincronizado do Separador, que usa o mesmo detector.
10. Fader com +6 dB no topo e 0 dB a 3/4 do curso (mockup v5; hoje o máximo é +1,6 dB); o M do PRINCIPAL é um mudo geral (botão do mockup, com função clara); sem atalho de PADS repetido na coluna do mixer (o v5 aprovado não tem; o PAD grande já está na faixa do meio).
11. Parado, tocar numa seção (ou em SEÇÃO ◂ ▸, ou ←/→) leva a VS pro início dela e desarma; tocando, arma. A pré-contagem passa a usar o BPM da música (antes era fixa em 100) e sai pela saída do Click.
12. Bolinhas, número grande e playhead seguem o tempo OUVIDO (descontam a latência de saída e a do tom), não o tempo em que o som foi agendado.

---

### Tarefa 1: Fundação da Parte 2: contratos, ícones, laço de quadro e áudio falso

**Onda:** 0. **Depende de:** P1 a P3. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/stageContracts.ts`, `src/lib/stageContracts.test.ts`
- Create: `src/components/stage/icons.tsx`, `src/components/stage/icons.test.tsx`
- Create: `src/components/stage/useFrame.ts`, `src/components/stage/useFrame.test.tsx`
- Create: `src/test/fakeAudio.ts`, `src/test/fakeAudio.test.ts`

**Interfaces:**
- Consumes: `ChannelRole` de `src/types.ts` (Parte 1), `TimeSignatureType` de `src/lib/AudioAnalyzer.ts` (só tipo).
- Produces (em `src/lib/stageContracts.ts`, usado por todas as tarefas seguintes):

```ts
export type TimeSignature = TimeSignatureType // '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'
export const TIME_SIGNATURES: readonly TimeSignature[] // nessa ordem
export function pulsesPerBar(sig: TimeSignature): number // 3, 4, 5, 6, 7, 12
export function isCompound(sig: TimeSignature): boolean // 6/8 e 12/8
export function countPulses(sig: TimeSignature, countEvery: 1 | 3): number // 6/8+3 -> 2, 12/8+3 -> 4, senão pulsesPerBar
export function signatureForPulses(n: number): TimeSignature | null // 3->'3/4' 4->'4/4' 5->'5/4' 6->'6/8' 7->'7/8' 12->'12/8'

export type GridSource = 'manual' | 'click' | 'bpm'                    // de onde vêm BPM e fase
export type MeterSource = 'manual' | 'salvo' | 'acento' | 'padrao'     // de onde vem o compasso
export interface SongGrid { bpm: number; firstDownbeat: number; signature: TimeSignature; countEvery: 1 | 3; source: GridSource; meterSource: MeterSource }
export const gridHasPhase = (g: SongGrid): boolean // source !== 'bpm'
export type GridWarning = 'sem-grade' | 'sem-click-lido' | 'compasso-assumido'
export const GRID_WARNING_TEXT: Record<GridWarning, { label: string; title: string }>
// 'sem-grade': 'SEM GRADE' / 'Sem click e sem BPM salvo: o pulo cai na marca da seção, sem contagem.'
// 'sem-click-lido': 'SEM CLICK LIDO' / 'A contagem usa o BPM salvo da música. Confira o canal de click.'
// 'compasso-assumido': '4/4 ASSUMIDO' / 'O click não tem acento no 1. Confira o compasso no EDITAR.'

export type Plays = number | 'infinite'
export interface ArmIntent { target: number; plays: Plays }
export interface TimelineSegment { ctxStart: number; songStart: number }
export interface SectionSpan { index: number; start: number; end: number } // segundos da música, já encaixados

export type OutputMode = 'stereo' | 'split2' | 'multi'
export interface OutputSettings { mode: OutputMode; earOnSecond: boolean; multi: { vsPair: number; click: number; guide: number } } // saídas com índice 0
export interface OutputPlan { mode: OutputMode; channels: number; vs: number[]; click: number[]; guide: number[]; applyPan: boolean; fellBackFrom: OutputMode | null }
export type StageVersion = 'novo' | 'antigo'

export interface StageSection { index: number; label: string; color: string; start: number; end: number; bars: number | null }
export interface TransitionView {
  from: number; to: number; kind: 'proxima' | 'repete'; plays: Plays
  switchAt: number | null      // tempo do contexto do "1" de destino (null antes de dar pra calcular)
  countTimes: number[]         // tempo do contexto de cada bipe
  countLabels: number[]        // número real de cada bipe (ex.: [3, 4] numa contagem curta)
  countTotal: number           // bolinhas do aviso (countPulses)
  barsLeft: number | null; committed: boolean; clickAudible: boolean; hasGrid: boolean
}
export interface StageChannel { id: string; label: string; color: string; role: ChannelRole; volume: number; muted: boolean; soloed: boolean; pan: number; silenced: boolean }
export interface StageSong { id: string; name: string; artist?: string; coverImage?: string; originalKey: string | null; pitch: number; bpm: number | null; signature: TimeSignature | null; duration: number; position: number; total: number; prevName: string | null; nextName: string | null; repertoireName: string | null }
export interface StageGates { sections: boolean; infinite: boolean; maxRepeats: number; bandSections: boolean }
export interface StageView {
  song: StageSong | null; sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null
  landed: { index: number; at: number } | null; grid: SongGrid | null; gridWarning: GridWarning | null
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

- Produces (resto):
  - `src/components/stage/icons.tsx`: `export type IconName = 'mark' | 'pause' | 'start' | 'prev' | 'next' | 'loop' | 'metro' | 'sliders' | 'count' | 'chl' | 'chr' | 'chd' | 'x' | 'inf' | 'pad' | 'lyrics' | 'edit' | 'cloud' | 'home' | 'out' | 'rev' | 'trash' | 'grip' | 'plus' | 'minus' | 'check'` e `export function Icon({ name, className }: { name: IconName; className?: string })`. Os 21 primeiros copiam os `<symbol>` do v5 (linhas 366 a 388) como SVG inline (sem `<use href>`, que quebra em `file://` com base diferente); traço `currentColor`, `stroke-width 2`, `aria-hidden="true"`, `focusable="false"`.
  - `src/components/stage/useFrame.ts`: `export function useFrame(cb: (t: number) => void, active?: boolean): void` (requestAnimationFrame; para quando `active` é false e no unmount; guarda o callback mais novo num ref).
  - `src/test/fakeAudio.ts`: `createFakeAudioContext(opts?: { sampleRate?: number; maxChannelCount?: number }): FakeAudioContext` com `currentTime` gravável, `destination` (com `channelCount`, `channelInterpretation`, `maxChannelCount`), `outputLatency`, e as fábricas `createGain`, `createBufferSource`, `createOscillator`, `createBiquadFilter`, `createDelay`, `createStereoPanner`, `createChannelMerger(n)`, `createChannelSplitter(n)`, `createAnalyser`, `createBuffer`. Cada nó grava `connections: { to: unknown; output: number; input: number }[]` e `disconnect()`; cada `AudioParam` grava `events: { kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel'; value?: number; time: number }[]`; fontes gravam `starts: { when: number; offset?: number }[]` e `stops: number[]`. Helpers: `valueAt(param, t): number` (interpreta set, rampa linear e cancel), `connectedTo(node, target, input?): boolean`, `nodesOf(ctx, kind)`.

- [ ] **Step 1: Escrever os testes**

```ts
// stageContracts.test.ts
it('pulsos e contagem por compasso', () => {
  expect(TIME_SIGNATURES.map(pulsesPerBar)).toEqual([3, 4, 5, 6, 7, 12])
  expect(countPulses('6/8', 3)).toBe(2); expect(countPulses('12/8', 3)).toBe(4); expect(countPulses('4/4', 1)).toBe(4)
  expect(signatureForPulses(2)).toBeNull(); expect(signatureForPulses(6)).toBe('6/8')
  expect(isCompound('6/8')).toBe(true); expect(isCompound('3/4')).toBe(false)
})
it('avisos da grade em português, curtos e sem travessão', () => {
  for (const w of Object.values(GRID_WARNING_TEXT)) { expect(w.label.length).toBeLessThanOrEqual(16); expect(w.label + w.title).not.toContain(TRAVESSAO) }
})
// icons.test.tsx (jsdom)
it('todo ícone é SVG escondido do leitor de tela e sem texto', () => {
  for (const name of ICON_NAMES) {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toBe('')
    cleanup()
  }
})
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
```

(`ICON_NAMES` é exportado junto com `IconName`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/lib/stageContracts.test.ts src/components/stage src/test > "$LOGS/t1.log" 2>&1; echo $?`
Expected: diferente de 0 (módulos não existem).

- [ ] **Step 3: Implementar os quatro arquivos** com as assinaturas acima. `stageContracts.ts` só tem tipos, constantes e as funções de compasso (sem React, sem Web Audio).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stageContracts.ts src/lib/stageContracts.test.ts src/components/stage/icons.tsx src/components/stage/icons.test.tsx src/components/stage/useFrame.ts src/components/stage/useFrame.test.tsx src/test/fakeAudio.ts src/test/fakeAudio.test.ts
git commit -m "feat(palco): contratos da Parte 2, icones SVG, laco de quadro e audio falso [Parte 2] [T1]"
```

---

### Tarefa 2: Grade da música (barras, encaixe e seções)

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/songGrid.ts`, `src/lib/songGrid.test.ts`

**Interfaces:**
- Consumes (T1): `SongGrid`, `SectionSpan`, `TimeSignature`, `GridWarning`, `pulsesPerBar`, `isCompound`, `signatureForPulses`, `gridHasPhase`; `Marker` de `src/types.ts`.
- Produces:
  - `pulseSeconds(g: SongGrid): number` (60 / bpm) e `barSeconds(g: SongGrid): number`
  - `nearestBarLine(t: number, g: SongGrid): number`
  - `snapToBar(t: number, g: SongGrid | null): number`: encaixa só com `gridHasPhase(g)` e distância até a barra de no máximo `barSeconds(g) / 4`; `t <= 0` devolve `0`; senão devolve `t`.
  - `barIndexAt(t: number, g: SongGrid): number`
  - `sectionSpans(markers: readonly Marker[], duration: number, grid: SongGrid | null): SectionSpan[]`: marcas ordenadas por tempo; `start` = `snapToBar(marca)`; `end` = `start` da seguinte; a última termina em `snapToBar(duration)` se isso não passar de `duration`, senão em `duration`. Marca com tempo fora de `[0, duration)` ou não finito é ignorada; `index` é o índice na lista de marcas ordenada.
  - `sectionIndexAt(spans: readonly SectionSpan[], t: number): number` (-1 antes da primeira)
  - `gridFromBpm(bpm: number, savedSignature?: TimeSignature | null): SongGrid | null` (source `'bpm'`, `firstDownbeat` 0; compasso salvo com `meterSource 'salvo'`, senão `'4/4'` com `'padrao'`; bpm fora de `[30, 300]` devolve `null`)
  - `interface ClickAnalysisLike { bpm: number; firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null }` e `gridFromClick(a: ClickAnalysisLike, savedSignature?: TimeSignature | null): SongGrid` (source `'click'`; compasso: o salvo (`'salvo'`), senão `signatureForPulses(a.pulsesPerBar)` (`'acento'`), senão `'4/4'` (`'padrao'`); `firstDownbeat` = `a.firstDownbeat ?? a.firstPulse`, normalizado pro intervalo `[0, compasso)`)
  - `withMeter(g: SongGrid, signature: TimeSignature, countEvery: 1 | 3): SongGrid` (`meterSource 'manual'`; `countEvery` vira 1 se o compasso não for composto; BPM e fase ficam)
  - `gridWarning(g: SongGrid | null): GridWarning | null` (`null` dá `'sem-grade'`; `source 'bpm'` dá `'sem-click-lido'`; `meterSource 'padrao'` dá `'compasso-assumido'`; senão `null`)
  - `sanitizeGrid(raw: unknown): SongGrid | null` (bpm finito em `[30, 300]`, `firstDownbeat` finito e `>= 0`, assinatura conhecida, `countEvery` 1 ou 3, `source` e `meterSource` conhecidas; senão `null`)

- [ ] **Step 1: Escrever `src/lib/songGrid.test.ts`**

```ts
const g: SongGrid = { bpm: 120, firstDownbeat: 0.25, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('barras e encaixe', () => {
  expect(barSeconds(g)).toBe(2); expect(nearestBarLine(4.1, g)).toBeCloseTo(4.25)
  expect(snapToBar(4.6, g)).toBeCloseTo(4.25)   // a 0,35 s: encaixa (limite 0,5 s)
  expect(snapToBar(5.3, g)).toBe(5.3)           // a 1,05 s: marca crua
  expect(snapToBar(0, g)).toBe(0)               // marca em 0:00 nunca mexe
  expect(snapToBar(4.6, { ...g, source: 'bpm' })).toBe(4.6) // sem fase: crua
  expect(snapToBar(4.6, null)).toBe(4.6)
})
it('seções encaixadas e a última nunca passa do áudio', () => {
  const m = [{ id: 'b', time: 8.2, label: 'Refrão' }, { id: 'a', time: 0, label: 'Intro' }, { id: 'c', time: 16.4, label: 'Final' }]
  expect(sectionSpans(m, 20.1, g)).toEqual([
    { index: 0, start: 0, end: 8.25 }, { index: 1, start: 8.25, end: 16.25 }, { index: 2, start: 16.25, end: 20.1 },
  ])
  expect(sectionIndexAt(sectionSpans(m, 20.1, g), 8.24)).toBe(0)
})
it('ignora marca inválida', () => expect(sectionSpans([{ id: 'x', time: NaN, label: 'X' }, { id: 'y', time: 99, label: 'Y' }], 30, null)).toEqual([]))
it('grade a partir do bpm salvo e do click, com a origem do compasso', () => {
  expect(gridFromBpm(72.5)).toEqual({ bpm: 72.5, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'bpm', meterSource: 'padrao' })
  expect(gridFromBpm(72.5, '3/4')!.meterSource).toBe('salvo'); expect(gridFromBpm(0)).toBeNull()
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 })).toMatchObject({ signature: '3/4', meterSource: 'acento' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: null, firstDownbeat: null })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 }, '6/8')).toMatchObject({ signature: '6/8', meterSource: 'salvo' })
})
it('aviso da grade nunca some em silêncio', () => {
  expect(gridWarning(null)).toBe('sem-grade'); expect(gridWarning(gridFromBpm(80))).toBe('sem-click-lido')
  expect(gridWarning({ ...g, meterSource: 'padrao' })).toBe('compasso-assumido'); expect(gridWarning(g)).toBeNull()
})
it('compasso manual e sanitização', () => {
  expect(withMeter(g, '6/8', 3)).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', source: 'click' })
  expect(withMeter(g, '3/4', 3).countEvery).toBe(1)
  expect(sanitizeGrid({ ...g, bpm: NaN })).toBeNull(); expect(sanitizeGrid({ ...g, signature: '9/8' })).toBeNull()
  expect(sanitizeGrid(g)).toEqual(g)
})
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/songGrid.test.ts > "$LOGS/t2.log" 2>&1; echo $?`. Expected: diferente de 0.
- [ ] **Step 3: Implementar `src/lib/songGrid.ts`** com as assinaturas acima (puro, sem Web Audio).
- [ ] **Step 4: Rodar e ver passar.** Expected: `0`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/songGrid.ts src/lib/songGrid.test.ts
git commit -m "feat(tempo): grade da musica com encaixe no compasso [Parte 2] [T2]"
```

---

### Tarefa 3: Compasso e BPM pelo acento do click

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/clickMeter.ts`, `src/lib/clickMeter.test.ts`

**Interfaces:**
- Produces: `export interface ClickAnalysis { bpm: number; firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null; onsets: number; accent: 'loud' | 'bright' | null }` (estruturalmente compatível com o `ClickAnalysisLike` da T2) e `export function analyzeClickTrack(samples: Float32Array, sampleRate: number): ClickAnalysis | null`.
- `null` quando há menos de 4 s de áudio, menos de 8 ataques ou nenhum pulso regular.

- [ ] **Step 1: Escrever `src/lib/clickMeter.test.ts`** com um gerador sintético no próprio arquivo: `synthClick({ bpm, seconds, pulsesPerBar, accent: 'loud' | 'bright' | 'none' | 'every2', firstPulse, pickupPulses?, jitterMs?, gap?: [number, number] })` a 48 kHz (bipe de 25 ms; acento `loud` = 1,8x a amplitude, `bright` = mesma amplitude com 2400 Hz em vez de 1200 Hz).

```ts
it('4/4 com acento mais forte, BPM com decimais', () => {
  const a = analyzeClickTrack(synthClick({ bpm: 72.5, seconds: 40, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.31 }), 48000)!
  expect(a.bpm).toBeCloseTo(72.5, 1); expect(Math.abs(a.bpm - 72.5)).toBeLessThan(0.02)
  expect(a.pulsesPerBar).toBe(4); expect(a.accent).toBe('loud'); expect(Math.abs(a.firstDownbeat! - 0.31)).toBeLessThan(0.002)
})
it('3/4 com acento só mais agudo', () => expect(analyzeClickTrack(synthClick({ bpm: 90, seconds: 30, pulsesPerBar: 3, accent: 'bright', firstPulse: 0.1 }), 48000)!.pulsesPerBar).toBe(3))
it('6/8 com acento só no 1', () => expect(analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 6, accent: 'loud', firstPulse: 0.05 }), 48000)!.pulsesPerBar).toBe(6))
it('anacruse: o 1 é o terceiro ataque', () => {
  const a = analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.2, pickupPulses: 2 }), 48000)!
  expect(Math.abs(a.firstDownbeat! - 1.2)).toBeLessThan(0.002)
})
it('sem acento ou acento a cada 2 tempos: compasso desconhecido', () => {
  expect(analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0 }), 48000)!.pulsesPerBar).toBeNull()
  expect(analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000)!.pulsesPerBar).toBeNull()
})
it('tolera variação de 1 ms e um trecho sem click', () => {
  const a = analyzeClickTrack(synthClick({ bpm: 76, seconds: 60, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.4, jitterMs: 1, gap: [20, 26] }), 48000)!
  expect(Math.abs(a.bpm - 76)).toBeLessThan(0.05); expect(a.pulsesPerBar).toBe(4)
})
it('silêncio e áudio curto', () => {
  expect(analyzeClickTrack(new Float32Array(48000 * 10), 48000)).toBeNull()
  expect(analyzeClickTrack(synthClick({ bpm: 120, seconds: 3, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }), 48000)).toBeNull()
})
it('5 minutos analisados em menos de 2 s', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/clickMeter.test.ts > "$LOGS/t3.log" 2>&1; echo $?`. Expected: diferente de 0.
- [ ] **Step 3: Implementar `analyzeClickTrack`** com o algoritmo da seção B da Arquitetura:
  1. Ataques: envelope do valor absoluto; ataque = subida acima de 30% do pico global, com no mínimo 60 ms entre ataques; tempo do ataque = primeira amostra acima do limiar.
  2. Período: mediana dos intervalos entre ataques vizinhos; cada ataque recebe índice `round((t - t0) / mediana)`; descarta ataques a mais de 15% da grade; BPM e fase por mínimos quadrados (índice x tempo).
  3. Traços por ataque nos primeiros 15 ms: pico (`loud`) e cruzamentos por zero (`bright`). Pra cada traço, separa em dois grupos por 2-médias; o limiar é o meio entre as médias.
  4. Pra `m` em `[3, 4, 5, 6, 7, 12]`, nessa ordem, e pra cada traço: aceita o primeiro `m` com exatamente uma fase `p` com pelo menos 80% de acentuados, todas as outras fases com no máximo 20%, e pelo menos 4 ataques na fase `p`. `firstDownbeat` = fase do primeiro ataque com índice `≡ p (mod m)`. Se nenhum `m` passa: `pulsesPerBar` e `firstDownbeat` `null`.
- [ ] **Step 4: Rodar e ver passar.** Expected: `0`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/clickMeter.ts src/lib/clickMeter.test.ts
git commit -m "feat(tempo): compasso e BPM com decimais lidos do acento do click [Parte 2] [T3]"
```

---

### Tarefa 4: Intenção armada (armar, repetir, loop, cancelar)

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

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
export function armAt(intent: ArmIntent | null, index: number, plays: Plays, c: ArmContext): ArmResult // banda e REPETIR
export function armRepeat(intent: ArmIntent | null, plays: Plays, c: ArmContext): ArmResult // na seção atual
export function toggleLoop(intent: ArmIntent | null, c: ArmContext): ArmResult
export function afterLanding(intent: ArmIntent): ArmIntent | null
export function armLabel(intent: ArmIntent | null, current: number): { kind: 'proxima' | 'repete'; plays: Plays } | null
export function isSelfLoop(intent: ArmIntent | null, from: number): boolean // target === from && plays === 'infinite'
```

- Regras: sem `gates.sections` qualquer armar devolve `upgrade: true` sem mudar nada; `'infinite'` sem `gates.infinite` idem; número acima de `gates.maxRepeats` vira `maxRepeats`, abaixo de 1 vira 1. Tocando: tocar na seção já armada cancela; em outra troca o alvo com `plays: 1`. Parado: tocar (ou `stepSection`) devolve `seekToSection` e `intent: null`. `stepSection` parte do alvo armado (se houver) ou da atual, preso entre 0 e `sectionCount - 1`. `toggleLoop` cancela se a intenção já é `{ atual, 'infinite' }`. `afterLanding`: `'infinite'` continua, `plays > 1` desce 1, senão `null`. Índice fora da lista: nada muda.

- [ ] **Step 1: Escrever `src/lib/sectionArm.test.ts`** como tabela (`it.each`) cobrindo cada regra acima, mais:

```ts
it('REPETIR 3 na atual, pousa 3 vezes e desarma', () => {
  let i = armRepeat(null, 3, ctx({ current: 2 })).intent!
  expect(i).toEqual({ target: 2, plays: 3 }); expect(armLabel(i, 2)).toEqual({ kind: 'repete', plays: 3 })
  i = afterLanding(i)!; i = afterLanding(i)!; expect(afterLanding(i)).toBeNull()
})
it('Livre não arma e pede upgrade', () => expect(tapSection(null, 1, ctx({ gates: { ...gates, sections: false } }))).toEqual({ intent: null, seekToSection: null, upgrade: true }))
it('parado leva pro início e desarma', () => expect(tapSection({ target: 3, plays: 1 }, 1, ctx({ isPlaying: false }))).toEqual({ intent: null, seekToSection: 1, upgrade: false }))
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/sectionArm.test.ts > "$LOGS/t4.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (funções puras, nunca mutam a intenção recebida).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sectionArm.ts src/lib/sectionArm.test.ts
git commit -m "feat(secoes): regra unica de armar, repetir, loop e cancelar [Parte 2] [T4]"
```

---

### Tarefa 5: Linha do tempo e relógio do agendador

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/playTimeline.ts`, `src/lib/playTimeline.test.ts`
- Create: `src/audio/schedulerClock.ts`, `src/audio/schedulerClock.test.ts`

**Interfaces:**
- Produces (`playTimeline.ts`):
  - `positionAt(segs: readonly TimelineSegment[], ctxTime: number, rate?: number): number`: usa o último segmento com `ctxStart <= ctxTime`; antes do primeiro, devolve o `songStart` dele (a posição nunca volta).
  - `ctxTimeOf(segs: readonly TimelineSegment[], songTime: number, rate?: number): number` (pelo segmento vigente mais novo)
  - `withSegment(segs, seg: TimelineSegment): TimelineSegment[]` (tira os que começam em `seg.ctxStart` ou depois e acrescenta `seg`)
  - `dropFrom(segs, ctxTime: number): TimelineSegment[]` (cancela os futuros) e `pruneBefore(segs, ctxTime: number): TimelineSegment[]` (mantém o vigente e os futuros)
  - `heardTime(ctxTime: number, outputLatency: number, entryLatency: number): number` (`ctxTime - outputLatency - entryLatency`, com latências não finitas tratadas como 0)
- Produces (`schedulerClock.ts`):

```ts
export interface WorkerLike { postMessage(m: unknown): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null }
export interface SchedulerClock { start(): void; stop(): void; dispose(): void; readonly running: boolean }
export const CLOCK_INTERVAL_MS = 25
export function createSchedulerClock(onTick: () => void, opts?: { intervalMs?: number; createWorker?: (url: string) => WorkerLike; createObjectURL?: (b: Blob) => string; revokeObjectURL?: (url: string) => void }): SchedulerClock
```

  O Worker nasce de um Blob com `setInterval(() => postMessage(0), N)` controlado por mensagens `'start'` e `'stop'`. Sem `Worker` (construtor ausente ou lançando), cai em `window.setInterval` com `console.warn` em português.

- [ ] **Step 1: Escrever os testes**

```ts
it('posição pela linha do tempo, com o pulo agendado', () => {
  const segs = [{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }]
  expect(positionAt(segs, 9)).toBe(30); expect(positionAt(segs, 12)).toBe(32)
  expect(positionAt(segs, 14)).toBe(8); expect(positionAt(segs, 15.5)).toBe(9.5)
  expect(ctxTimeOf(segs.slice(0, 1), 33)).toBe(13)
  expect(dropFrom(segs, 13)).toEqual(segs.slice(0, 1)); expect(pruneBefore(segs, 15)).toEqual(segs.slice(1))
})
it('tempo ouvido', () => expect(heardTime(10, 0.02, NaN)).toBeCloseTo(9.98))
it('o relógio usa Worker e não setInterval da janela', () => {
  const spy = vi.spyOn(window, 'setInterval'); const w = fakeWorker()
  const clock = createSchedulerClock(onTick, { createWorker: () => w, createObjectURL: () => 'blob:x', revokeObjectURL })
  clock.start(); expect(w.sent).toEqual(['start']); w.onmessage!({ data: 0 }); expect(onTick).toHaveBeenCalledTimes(1)
  clock.stop(); expect(w.sent).toEqual(['start', 'stop']); clock.dispose(); expect(w.terminated).toBe(true)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:x'); expect(spy).not.toHaveBeenCalled()
})
it('sem Worker cai no setInterval e avisa', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/playTimeline.test.ts src/audio/schedulerClock.test.ts > "$LOGS/t5.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** os dois arquivos.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/playTimeline.ts src/lib/playTimeline.test.ts src/audio/schedulerClock.ts src/audio/schedulerClock.test.ts
git commit -m "feat(tempo): linha do tempo da musica e relogio do agendador em Worker [Parte 2] [T5]"
```

---

### Tarefa 6: Plano de saídas (Tudo junto, Click e Guia separados, 4 ou mais)

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/outputPlan.ts`, `src/lib/outputPlan.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_OUTPUTS: OutputSettings` = `{ mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }`
  - `outputsFromLegacy(stored: { autoPan?: unknown; outputs?: unknown }): OutputSettings`: `outputs` válido vence; senão `autoPan === false` dá `stereo`, qualquer outro valor dá `DEFAULT_OUTPUTS` (o pan automático é o padrão de hoje).
  - `sanitizeOutputs(raw: unknown): OutputSettings | null`
  - `planOutputs(s: OutputSettings, maxChannelCount: number): OutputPlan`:
    - `maxChannelCount` não finito ou menor que 2 conta como 2.
    - `stereo`: `{ channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], applyPan: true }`.
    - `split2`: saída do ouvido = `earOnSecond ? 1 : 0`; `vs` = a outra; `click` e `guide` = a do ouvido; `applyPan: false`.
    - `multi` com 4 canais ou mais: `channels = min(maxChannelCount, 32)`; `vsPair` par, `vsPair + 1 < channels`, `click` e `guide` dentro de `channels` e fora do par da VS; mapa inválido troca pelo padrão `{ 0, 2, 3 }` (se nem o padrão couber, cai em `split2`); `applyPan: true`.
    - `multi` com menos de 4: plano de `split2` com o ouvido na saída 1 e `fellBackFrom: 'multi'`.
  - `effectivePan(pan: number, plan: OutputPlan): number` (`applyPan ? pan : 0`)
  - `multiChoices(maxChannelCount: number): { vsPairs: number[]; singles: number[] }`
  - `outputSummary(plan: OutputPlan): string` (texto pro usuário, numeração a partir de 1): `stereo` "Tudo junto nas saídas 1 e 2"; `split2` "Click e Guia na saída 1 · VS em mono na saída 2" (ou trocado); `multi` "VS nas saídas 1 e 2 · Click na 3 · Guia na 4".

- [ ] **Step 1: Escrever `src/lib/outputPlan.test.ts`**

```ts
it('nenhum plano separado põe click ou guia numa saída da VS', () => {
  for (const mode of ['split2', 'multi'] as const) for (const max of [0, 1, 2, 3, 4, 6, 8, 18, 64])
    for (const earOnSecond of [false, true]) for (const vsPair of [-2, 0, 1, 2, 4, 30]) for (const click of [-1, 0, 1, 2, 3, 5, 40]) for (const guide of [0, 1, 3, 7]) {
      const p = planOutputs({ mode, earOnSecond, multi: { vsPair, click, guide } }, max)
      for (const o of [...p.click, ...p.guide]) expect(p.vs).not.toContain(o)
      for (const o of [...p.vs, ...p.click, ...p.guide]) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(p.channels) }
    }
})
it('2 canais com 4 ou mais escolhido cai em separados e avisa', () => expect(planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi' }, 2)).toMatchObject({ mode: 'split2', fellBackFrom: 'multi', click: [0], vs: [1] }))
it('pan só vale em tudo junto e em 4 ou mais', ...)
it('quem tinha pan automático entra em separados', () => {
  expect(outputsFromLegacy({ autoPan: true })).toEqual(DEFAULT_OUTPUTS)
  expect(outputsFromLegacy({}).mode).toBe('split2'); expect(outputsFromLegacy({ autoPan: false }).mode).toBe('stereo')
})
it('resumo em português sem travessão', () => { for (const p of planosVariados) expect(outputSummary(p)).not.toContain(TRAVESSAO) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/outputPlan.test.ts > "$LOGS/t6.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/outputPlan.ts src/lib/outputPlan.test.ts
git commit -m "feat(saidas): plano de saidas por papel, independente do pan [Parte 2] [T6]"
```

---

### Tarefa 7: Vozes com envelope e bipes da contagem

**Onda:** 1. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/audio/voices.ts`, `src/audio/voices.test.ts`
- Create: `src/audio/countTones.ts`, `src/audio/countTones.test.ts`

**Interfaces:**
- Consumes (T1): `createFakeAudioContext`, `valueAt`, `connectedTo` (só nos testes).
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

  `startVoice`: fonte → envelope (valor 1) → `spec.entry`; offset negativo vira 0; registra `onended` que desliga fonte e envelope. `startVoicesForSwitch`: com `targetOffset >= fade`, começa em `T - fade` com offset `targetOffset - fade` e envelope `setValueAtTime(0, T - fade)` + `linearRampToValueAtTime(1, T)`; senão começa em `T` com offset `targetOffset` e envelope 1. `fadeOutVoices`: `setValueAtTime(1, T - fade)` + `linearRampToValueAtTime(0, T)`. `restoreVoices`: `cancelScheduledValues(now)` + `setValueAtTime(1, now)`. `stopVoices`: `stop(at)` com try/catch (fonte que nunca começou também para).
- Produces (`countTones.ts`):

```ts
export const COUNT_TONE = { accentHz: 1319, beatHz: 988, accentPeak: 0.85, beatPeak: 0.68, attack: 0.004, hold: 0.075, release: 0.19, lowpassHz: 5200, squareMix: 0.1 } as const
export interface CountBeat { at: number; label: number }
export interface ScheduledCount { readonly beats: readonly CountBeat[]; cancel(now: number): void }
export function scheduleCount(ctx: BaseAudioContext, dest: AudioNode, beats: readonly CountBeat[]): ScheduledCount
```

  Cada bipe (receita `vCount` do v6, linha 689): triângulo na frequência + quadrada no dobro com ganho `squareMix`, envelope com ataque, sustentação até `hold` e queda exponencial até `release`, passa-baixa, tudo ligado SÓ em `dest`. Acento quando `label === 1`. Bipe com `at` menor que `ctx.currentTime` é pulado. `cancel(now)` para todos os osciladores em `now` e desliga os nós.

- [ ] **Step 1: Escrever os testes**

```ts
it('voz nova entra na mesma entrada do canal (worklet ou atraso), sem criar nó de tom', () => {
  const ctx = createFakeAudioContext(); const entry = ctx.createDelay(1) // faz o papel do worklet ou do atraso
  const [v] = startVoicesForSwitch(ctx, [{ channelId: 'a', buffer: buf(30), entry }], 10, 8, 0.005)
  expect(connectedTo(v.env, entry)).toBe(true); expect(v.source.starts).toEqual([{ when: 9.995, offset: 7.995 }])
  expect(valueAt(v.env.gain, 9.995)).toBe(0); expect(valueAt(v.env.gain, 10)).toBe(1)
  expect(nodesOf(ctx, 'AudioWorkletNode')).toHaveLength(0)
})
it('alvo em 0:00 começa no instante, sem pré-rolagem', () => expect(startVoicesForSwitch(ctx, specs, 10, 0, 0.005)[0].source.starts).toEqual([{ when: 10, offset: 0 }]))
it('descida e restauração do envelope', ...)
it('para fonte que nunca começou sem lançar', ...)
it('bipes nos tempos, acento no 1, só no destino', () => {
  const ctx = createFakeAudioContext(); const dest = ctx.createGain()
  scheduleCount(ctx, dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }])
  const oscs = nodesOf(ctx, 'OscillatorNode')
  expect(oscs.map(o => o.frequency.value)).toEqual([1319, 2638, 988, 1976])
  expect(oscs.map(o => o.starts[0].when)).toEqual([6, 6, 6.5, 6.5])
  expect(nodesOf(ctx, 'GainNode').some(n => connectedTo(n, ctx.destination))).toBe(false)
})
it('cancel para tudo em now e pula bipe no passado', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/audio/voices.test.ts src/audio/countTones.test.ts > "$LOGS/t7.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** os dois arquivos.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/audio/voices.ts src/audio/voices.test.ts src/audio/countTones.ts src/audio/countTones.test.ts
git commit -m "feat(audio): vozes com envelope e bipes da contagem agendados [Parte 2] [T7]"
```

---

### Tarefa 8: Transporte e aviso PRÓXIMA

**Onda:** 1. **Depende de:** T1 (peças `Button`, `Chip`, `Segmented`, `Led` da Parte 1). **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/TransportBar.tsx`, `src/components/stage/NextPill.tsx`, `src/components/stage/PlayButton.tsx`, `src/components/stage/transport.test.tsx`

**Interfaces:**
- Consumes (T1): `StageView`, `StageActions`, `StageClock`, `TransitionView`, `ArmIntent`, `StageSection`, `Icon`, `useFrame`.
- Produces:

```ts
export interface StagePulse { seconds: number; firstDownbeat: number }
export interface TransportBarProps {
  view: Pick<StageView, 'isPlaying' | 'isCountingIn' | 'precount' | 'endMode' | 'click' | 'intent' | 'transition' | 'sections' | 'currentSection' | 'gates'>
  actions: Pick<StageActions, 'togglePlay' | 'goToStart' | 'setEndMode' | 'togglePrecount' | 'cyclePrecountBeats' | 'toggleClick' | 'openMetronome' | 'stepSection' | 'cancelArm' | 'toggleLoop'>
  clock: Pick<StageClock, 'heardNow' | 'position'>
  pulse: StagePulse | null
}
export function TransportBar(p: TransportBarProps): JSX.Element
export interface NextPillProps { transition: TransitionView | null; intent: ArmIntent | null; sections: StageSection[]; currentSection: number; clock: Pick<StageClock, 'heardNow'>; onCancel(): void }
export function NextPill(p: NextPillProps): JSX.Element
export function nextPillWaitText(t: TransitionView, heardNow: number): string | null // puro, exportado pro teste
export interface PlayButtonProps { isPlaying: boolean; isCountingIn: boolean; precountTimes: number[]; pulse: StagePulse | null; clock: Pick<StageClock, 'heardNow' | 'position'>; onToggle(): void }
export function PlayButton(p: PlayButtonProps): JSX.Element
```

- Visual: v5 linhas 50 a 107 (+ `.np-wait` do v6 linhas 105 a 108) e marcação 405 a 442. Grade de 3 colunas (esquerda, centro, direita). Esquerda: rótulo "Fim da música" + `Segmented` AUTO / PARAR / FADE (`continue` / `stop` / `fade-out`). Centro: COMEÇO, Play (PlayMark), LOOP, CLICK + botão do metrônomo colado, PRÉ-CONT. + número colado, separador, SEÇÃO ◂ ▸. Direita: `NextPill`.
- Regras de texto do aviso (`nextPillWaitText`), nessa prioridade: `!hasGrid` "no fim da seção"; `!clickAudible` "CLICK DESLIGADO" (cor `ps-alert`); antes do último compasso "em N comp."; no último compasso antes do primeiro bipe ouvido "último comp."; contando: `null` (aparecem as bolinhas). Rótulo: "PRÓXIMA", ou "REPETE" / "REPETE 3x" quando o alvo é a seção atual. O aviso fica escondido (`aria-hidden`, sem animação) sem intenção e no loop ∞ da própria seção.
- Bolinhas: `countTotal` bolinhas; a bolinha `label - 1` acende quando `countTimes[k] <= clock.heardNow()` (lido em `useFrame`).
- Play: `aria-label` "Tocar" / "Pausar"; durante a pré-contagem mostra o número do tempo ouvido no lugar do ícone; anel pulsa quando tocando e a fase do pulso ouvido é menor que 0,14. LOOP aceso quando a intenção é `{ atual, 'infinite' }`. CLICK aceso com `click.on`; sem canal de click fica desabilitado com `title` "Esta música não tem canal de click". PRÉ-CONT. aceso com `precount.enabled`, número apagado quando desligado.

- [ ] **Step 1: Escrever `src/components/stage/transport.test.tsx`** (jsdom, `afterEach(cleanup)`, rAF falso)

```tsx
it.each([
  [{ hasGrid: false }, 10, 'no fim da seção'], [{ clickAudible: false }, 10, 'CLICK DESLIGADO'],
  [{ barsLeft: 3, countTimes: [20, 20.5, 21, 21.5] }, 10, 'em 3 comp.'], [{ barsLeft: 1, countTimes: [20, 20.5, 21, 21.5] }, 19.9, 'último comp.'],
  [{ barsLeft: 1, countTimes: [20, 20.5, 21, 21.5] }, 20.6, null],
])('texto de espera %#', (patch, now, text) => expect(nextPillWaitText({ ...baseView, ...patch }, now)).toBe(text))
it('aviso REPETE 3x na seção atual, com X pra cancelar', () => { /* render NextPill com intent { target: cur, plays: 3 }; clica em "Cancelar pulo" -> onCancel */ })
it('acende as bolinhas pelo tempo ouvido', () => { /* clock.heardNow = 20.6: bolinhas 1 e 2 com data-on="true", 3 e 4 sem */ })
it('aviso escondido no loop infinito da própria seção', ...)
it('botões do transporte chamam as ações certas', () => { /* COMEÇO, Play, LOOP, CLICK, Metrônomo, PRÉ-CONT., número, ◂, ▸, AUTO/PARAR/FADE */ })
it('CLICK desabilitado sem canal de click', ...)
it('sem inglês visível e sem travessão', () => { const t = container.textContent!; expect(t).not.toContain(TRAVESSAO); expect(t).not.toMatch(/\b(Next|Play|Loop|Cancel|Start)\b/) })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/transport.test.tsx > "$LOGS/t8.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar os três componentes.** Só tokens `ps-*`; a cor do nome no aviso vem de `sections[to].color` (style inline); o branco do armado é `ps-arm` com a animação `armglow` do v5, respeitando `prefers-reduced-motion`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/TransportBar.tsx src/components/stage/NextPill.tsx src/components/stage/PlayButton.tsx src/components/stage/transport.test.tsx
git commit -m "feat(palco): transporte novo e aviso PROXIMA com contagem [Parte 2] [T8]"
```

---

### Tarefa 9: Onda grande com seções, seta do armado e régua

**Onda:** 2. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/WaveformSections.tsx`, `src/components/stage/wavePeaks.ts`, `src/components/stage/waveform.test.tsx`

**Interfaces:**
- Produces:

```ts
export function computePeaks(data: Float32Array, buckets: number): Float32Array // maior |x| por balde, normalizado pelo maior; vazio -> zeros
export function arcPath(x1: number, x2: number, baseY: number, maxLift: number): string // curva do v6 drawArc (linhas 996 a 1009)
export interface WaveformSectionsProps {
  peaks: Float32Array | null; duration: number; sections: StageSection[]; currentSection: number
  intent: ArmIntent | null; loopOn: boolean; barLines: number[] | null; sectionsAllowed: boolean
  clock: Pick<StageClock, 'position'>; onTapSection(i: number): void; onSeek(t: number): void
}
export function WaveformSections(p: WaveformSectionsProps): JSX.Element
```

- Visual: v5 linhas 109 a 140 e o desenho do v6 `buildWave` (linhas 971 a 995): onda na cor da seção a 34% e a parte tocada mais clara (recorte por `clip-path` atualizado em `useFrame`), linhas de compasso (`barLines`, a cada 4 mais fortes), régua de 22px embaixo com rótulo a cada 30 s em mono 10px. Blocos são `<button>` com `aria-label` "Armar <nome>", posição e largura em % (`start/duration`, `(end-start)/duration`), selo com o nome, etiqueta "PRÓXIMA" ou "REPETE" no armado (branco listrado animado), "LOOP" no atual com loop. Seta tracejada (`arcPath`) do fim da seção atual ao início da armada quando o alvo é outra seção. Playhead por `transform` em `useFrame`. Arrastar na régua (`data-testid="regua"`, pointer events, funciona no toque) chama `onSeek`, tocando ou parado (spec 9b; o texto do spec fala em régua "no topo", mas vale o mockup v5, que a desenha embaixo da onda). O botão "DEMO" do mockup não entra. Sem `sectionsAllowed`: só a onda e a régua. Canvas com `devicePixelRatio`; se `getContext` devolver `null` (jsdom), não desenha.

- [ ] **Step 1: Escrever `src/components/stage/waveform.test.tsx`**

```tsx
it('picos normalizados', () => expect([...computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2)]).toEqual([0.5, 1]))
it('blocos na posição da seção, estado atual e armado', () => { /* left 25%, width 25%; data-state="atual"; armado com texto PRÓXIMA; intent na atual: REPETE */ })
it('toque no bloco arma; arrastar na régua busca', () => { /* click -> onTapSection(2); pointerdown em x = 50% da régua -> onSeek(duration / 2) */ })
it('seta só quando o alvo é outra seção', ...)
it('Livre: sem blocos', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/waveform.test.tsx > "$LOGS/t9.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/WaveformSections.tsx src/components/stage/wavePeaks.ts src/components/stage/waveform.test.tsx
git commit -m "feat(palco): onda grande com blocos de secao, seta do armado e regua [Parte 2] [T9]"
```

---

### Tarefa 10: Botoeira de seções

**Onda:** 2. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/SectionPads.tsx`, `src/components/stage/sectionPads.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface SectionPadsProps {
  sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null
  landed: StageView['landed']; gates: StageGates; clock: Pick<StageClock, 'heardNow' | 'position'>
  onTap(i: number): void; onUpgrade(): void
}
export function SectionPads(p: SectionPadsProps): JSX.Element
export function padMeta(s: StageSection, i: number, ctx: { current: number; position: number; transition: TransitionView | null; heardNow: number }): string // puro
```

- Visual: v5 linhas 142 a 167 e os textos do v6 `frame` (linhas 1094 a 1100). Um `<button>` por seção, na ordem, faixa da cor da seção à esquerda, tecla 1 a 9 nas 9 primeiras, nome (quebra em até 2 linhas, nunca reticências), meta (`padMeta`): início "m:ss" nas outras; na atual "comp. N/M" (com compasso) ou "m:ss/m:ss" (sem); na armada "em N comp." ou "contagem" no último compasso. Etiquetas AGORA (cor da seção), PRÓXIMA ou REPETE / REPETE Nx (branco); preenchimento de progresso na atual; número grande da contagem na armada; brilho de "pousou" por 0,8 s quando `landed.index` é a seção. `aria-pressed` na armada. Mais seções do que cabem (largura mínima de 104px por botão): rola de lado com botões inteiros e mantém a AGORA à vista.
- Livre (`!gates.sections`): um painel com "Marque as seções da música e troque de parte ao vivo sem parar a VS." e o botão "Conhecer os planos" (`onUpgrade`). Pago sem seções: "Esta música ainda não tem seções. Marque no EDITAR."

- [ ] **Step 1: Escrever `src/components/stage/sectionPads.test.tsx`**

```tsx
it('um botão por seção com tecla até 9', ...)
it.each([...])('meta %s', (_, ctx, text) => expect(padMeta(sec, idx, ctx)).toBe(text))
it('armada mostra REPETE 3x e o número da contagem', ...)
it('Livre mostra o convite e abre o upgrade', () => { /* clica em "Conhecer os planos" -> onUpgrade */ })
it('nome longo nunca é cortado', () => { /* o elemento do nome não tem truncate, text-ellipsis nem line-clamp */ })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/sectionPads.test.tsx > "$LOGS/t10.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/SectionPads.tsx src/components/stage/sectionPads.test.tsx
git commit -m "feat(palco): botoeira de secoes com AGORA, PROXIMA e convite no Livre [Parte 2] [T10]"
```

---

### Tarefa 11: Plano da troca de seção (instante, alvo, contagem e guia)

**Onda:** 2. **Depende de:** T2. **Antes da junção:** sim.

**Files:**
- Create: `src/lib/sectionTransition.ts`, `src/lib/sectionTransition.test.ts`

**Interfaces:**
- Consumes (T2): `sectionIndexAt`, `pulseSeconds`, `barSeconds`, `sanitizeGrid`; (T1): `SongGrid`, `SectionSpan`, `ArmIntent`, `countPulses`.
- Produces:

```ts
export const MIN_LEAD = 0.05
export interface TransitionPlan { from: number; to: number; switchAt: number; targetOffset: number; countTimes: number[]; countLabels: number[]; countTotal: number; guideMuteFrom: number | null; barsLeft: number | null }
export function planTransition(a: { spans: readonly SectionSpan[]; grid: SongGrid | null; position: number; intent: ArmIntent; minLead?: number }): TransitionPlan | null
```

- Regras (todos os tempos em segundos da música):
  - `p = position + minLead`; `from = sectionIndexAt(spans, p)`. Antes da primeira marca, `from = -1` e `switchAt = spans[0].start`.
  - `to = intent.target`; fora da lista ou lista vazia: `null`. `switchAt = spans[from].end`; `targetOffset = spans[to].start`.
  - Grade inválida (`sanitizeGrid` devolve `null`) conta como sem grade.
  - Com grade (inclusive a de BPM salvo, sem fase): `step = pulseSeconds(grid) * grid.countEvery`, `countTotal = countPulses(grid.signature, grid.countEvery)`; candidatos `switchAt - k * step` pra `k = countTotal .. 1` (sempre ancorados no "1" de destino, então a contagem fica no tempo mesmo sem fase); ficam só os `>= p`; `countLabels` = `countTotal - k + 1` de cada um que ficou; `barsLeft = ceil((switchAt - position) / barSeconds(grid) - 1e-6)`.
  - Loop ∞ da própria seção (`to === from && plays === 'infinite'`): sem contagem (`countTimes []`, `guideMuteFrom null`).
  - Sem grade: `countTimes []`, `countTotal 0`, `guideMuteFrom null`, `barsLeft null`.
  - `guideMuteFrom` = primeiro `countTimes`, ou `null` sem contagem.
  - Nunca devolve `NaN` (testado).

- [ ] **Step 1: Escrever `src/lib/sectionTransition.test.ts`**

```ts
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const spans = [{ index: 0, start: 0, end: 8 }, { index: 1, start: 8, end: 16 }, { index: 2, start: 16, end: 30 }]
it('contagem inteira no último compasso', () => expect(planTransition({ spans, grid, position: 5, intent: { target: 0, plays: 1 } })).toEqual({
  from: 0, to: 0, switchAt: 8, targetOffset: 0, countTimes: [6, 6.5, 7, 7.5], countLabels: [1, 2, 3, 4], countTotal: 4, guideMuteFrom: 6, barsLeft: 2 }))
it('armou tarde: contagem curta com o número real', () => {
  const p = planTransition({ spans, grid, position: 6.8, intent: { target: 2, plays: 1 } })!
  expect(p.countTimes).toEqual([7, 7.5]); expect(p.countLabels).toEqual([3, 4]); expect(p.switchAt).toBe(8)
})
it('armar a menos da folga mínima mira o fim da seção seguinte', () => expect(planTransition({ spans, grid, position: 7.96, intent: { target: 0, plays: 1 } })!.switchAt).toBe(16))
it('6/8 contando 2', () => {
  const p = planTransition({ spans, grid: { ...grid, bpm: 180, signature: '6/8', countEvery: 3 }, position: 1, intent: { target: 2, plays: 1 } })!
  expect(p.countTimes).toEqual([6, 7]); expect(p.countTotal).toBe(2)
})
it('BPM salvo sem fase: contagem ancorada no 1 de destino', ...)
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

**Onda:** 2. **Depende de:** T6. **Antes da junção:** sim.

**Files:**
- Create: `src/audio/outputGraph.ts`, `src/audio/outputGraph.test.ts`

**Interfaces:**
- Consumes (T6): `OutputPlan`, `planOutputs`, `DEFAULT_OUTPUTS`; (T1): `createFakeAudioContext`, `connectedTo`, `nodesOf` (testes).
- Produces:

```ts
export interface OutputGraph {
  input(role: ChannelRole): GainNode // barramento do papel: 'click', 'guide', 'normal'
  readonly guideGain: AudioParam     // ganho do barramento da Guia (calar no último compasso)
  readonly master: GainNode          // volume principal: fade e AUTO continuam aqui
  readonly masterMute: GainNode      // mudo geral
  readonly plan: OutputPlan
  apply(plan: OutputPlan): void      // religa só barramentos -> roteador -> principal; barramentos e canais ficam
  levels(): { l: number; r: number } // pico das saídas 1 e 2 (0..1), pro medidor do PRINCIPAL
  dispose(): void
}
export function createOutputGraph(ctx: AudioContext, plan: OutputPlan): OutputGraph
```

- Ligações por modo: `stereo`: os 3 barramentos → `master`. `split2`: `ChannelMerger(2)`; Click e Guia → entrada do ouvido, VS → entrada da VS; merger → `master`. `multi`: `destination.channelCount = plan.channels`, `channelCountMode = 'explicit'`, `channelInterpretation = 'discrete'`; `ChannelMerger(plan.channels)`; VS → `ChannelSplitter(2)` → saídas 0 e 1 do splitter nas entradas `vs[0]` e `vs[1]`; Click → `click[0]`; Guia → `guide[0]` (mesma entrada quando iguais). Sempre `master → masterMute → destination`. Em `stereo` e `split2` o `destination` volta a 2 canais e `'speakers'`. Medidor: `masterMute → ChannelSplitter(2) → 2 AnalyserNode` (fora do caminho do som).

- [ ] **Step 1: Escrever `src/audio/outputGraph.test.ts`**

```ts
it('split2 e multi nunca ligam os barramentos click e guia numa entrada do merger usada pela VS', () => {
  for (const plan of [planOutputs(DEFAULT_OUTPUTS, 2), planOutputs({ ...DEFAULT_OUTPUTS, earOnSecond: true }, 2), planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi' }, 8)]) {
    const ctx = createFakeAudioContext({ maxChannelCount: 8 }); const g = createOutputGraph(ctx, plan)
    const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
    for (const vsIn of plan.vs) { expect(connectedTo(g.input('click'), merger, vsIn)).toBe(false); expect(connectedTo(g.input('guide'), merger, vsIn)).toBe(false) }
  }
})
it('stereo liga tudo no principal', ...)
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

**Onda:** 3. **Depende de:** T1. **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/MidStrip.tsx`, `TimeCell.tsx`, `KeyCell.tsx`, `CurrentSectionCell.tsx`, `SongCell.tsx`, `BigButton.tsx` (todos em `src/components/stage/`), `src/components/stage/midStrip.test.tsx`
- Create: `src/lib/keyNames.ts`, `src/lib/keyNames.test.ts`

**Interfaces:**
- Consumes (T1): contrato do palco, `GRID_WARNING_TEXT`, `Icon`, `useFrame`; `keyToSemitone`, `semitonesBetweenKeys`, `sanitizeSemitones` de `src/lib/pitchRules.ts`; `formatBpm` não é usado (o palco mostra sempre 1 casa).
- Produces:

```ts
// keyNames.ts
export const KEY_NAMES: readonly string[] // ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export function transposeKeyName(key: string | null, semitones: number): string | null // mantém o "m" de menor; não reconhecido -> null
export function keyIndex(key: string | null): number | null
// componentes
export interface TimeCellProps { duration: number; bpm: number | null; signature: TimeSignature | null; gridWarning: GridWarning | null; editMode: boolean; clock: Pick<StageClock, 'position'>; onOpenMeter(): void }
export interface KeyCellProps { originalKey: string | null; pitch: number; onChangePitch(semitones: number): void }
export interface CurrentSectionCellProps { sections: StageSection[]; currentSection: number; intent: ArmIntent | null; gates: StageGates; clock: Pick<StageClock, 'position'>; onArmRepeat(plays: Plays): void; onToggleLoop(): void; onUpgrade(): void }
export interface SongCellProps { song: StageSong | null; onPrev(): void; onNext(): void }
export interface BigButtonProps { kind: 'pad' | 'letra'; on: boolean; live: boolean; sub: string; onPress(): void }
export interface MidStripProps { view: StageView; actions: StageActions; clock: StageClock; onOpenMeter(): void }
```

- Visual: v5 linhas 169 a 258 (CSS) e 459 a 501 (marcação); colunas `minmax(214px,1.1fr) minmax(176px,.9fr) minmax(280px,1.3fr) minmax(316px,2fr) minmax(120px,.75fr) minmax(96px,.6fr)`; abaixo de 1700px some o nome do repertório (v6 linha 244).
- **Tempo**: tempo ouvido "mm:ss" grande em mono e "/ m:ss"; linha "72.0 BPM · 4/4" (`bpm.toFixed(1)`, assinatura) ou "BPM não informado". Os botões de andamento −5 −1 +1 +5 do mockup NÃO entram (Projeto 4). Com `gridWarning`, chip âmbar com `GRID_WARNING_TEXT[w].label` e o `title` da explicação. No modo EDITAR a linha do BPM vira botão "Compasso" (`onOpenMeter`).
- **TOM**: tom atual grande (`transposeKeyName(originalKey, pitch)`), "original X", selo do deslocamento (+2 / −1, com sinal de menos U+2212); toque abre a grade de 12 tons (`role="dialog"`, original marcado ORIGINAL, atual em laranja; Esc e toque fora fecham); chips −1, ORIG., +1. Escolher tom na grade chama `onChangePitch(semitonesBetweenKeys(originalKey, KEY_NAMES[i]))`; −1 e +1 chamam `onChangePitch(sanitizeSemitones(pitch ± 1))`. Sem tom original: grade desabilitada com "Tom original desconhecido"; −1 e +1 continuam.
- **Seção atual**: "Seção atual", "comp. N de M" (com barras) ou "m:ss de m:ss", nome na cor da seção, barra de progresso, REPETIR (branco quando a intenção é repetir a atual), seletor − Nx + (1 até `gates.maxRepeats`; mudar N com REPETIR armado re-arma com o N novo), ∞ (aceso no loop infinito da atual; sem `gates.infinite` chama `onUpgrade`). Sem seções: "Sem seções" e os controles desabilitados.
- **Música**: capa (ou placeholder com o título), "Música 1 de 6 · <repertório>", título, artista, anterior (ícone) e "A SEGUIR <nome>" (ou "Fim do repertório", desabilitado).
- **PAD** (aceso com o painel aberto; LED musgo piscando quando um pad toca; sub "parado" ou "tocando C") e **LETRA** (sub "teleprompter").

- [ ] **Step 1: Escrever os testes**

```ts
it.each([['G', -1, 'F#'], ['Am', 2, 'Bm'], ['Bb', 1, 'B'], ['X', 1, null], [null, 0, null]])('transpõe %s', (k, s, out) => expect(transposeKeyName(k, s)).toBe(out))
```
```tsx
it('tempo ouvido, BPM com 1 casa e compasso', ...)
it('aviso âmbar quando o compasso foi assumido', () => { /* gridWarning 'compasso-assumido' -> texto "4/4 ASSUMIDO" e title com a explicação */ })
it('grade de tons escolhe pelo caminho mais curto', () => { /* original G, toca em E -> onChangePitch(-3) */ })
it('REPETIR 3x arma a repetição da atual e o ∞ pede upgrade no Livre', ...)
it('A SEGUIR mostra a próxima e fica desabilitado no fim', ...)
it('nada de botão de andamento (Projeto 4)', () => expect(screen.queryByText('+5')).toBeNull())
it('sem travessão e sem inglês visível', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/keyNames.test.ts src/components/stage/midStrip.test.tsx > "$LOGS/t13.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/keyNames.ts src/lib/keyNames.test.ts src/components/stage/MidStrip.tsx src/components/stage/TimeCell.tsx src/components/stage/KeyCell.tsx src/components/stage/CurrentSectionCell.tsx src/components/stage/SongCell.tsx src/components/stage/BigButton.tsx src/components/stage/midStrip.test.tsx
git commit -m "feat(palco): faixa do meio com tempo, tom, secao atual, musica, PAD e LETRA [Parte 2] [T13]"
```

---

### Tarefa 14: Mixer novo (pan, fader com nível no trilho, M/S, principal)

**Onda:** 3. **Depende de:** T1 (e `ChannelTrashButton` da Parte 1). **Antes da junção:** sim.

**Files:**
- Create: `src/lib/faderScale.ts`, `src/lib/faderScale.test.ts`
- Create: `src/components/stage/StageMixer.tsx`, `ChannelStrip.tsx`, `PanKnob.tsx`, `FaderVU.tsx`, `MasterStrip.tsx` (em `src/components/stage/`), `src/components/stage/mixer.test.tsx`

**Interfaces:**
- Produces (`faderScale.ts`, a escala do v6 linhas 603, 604, 1110 a 1115):

```ts
export const FADER_ZERO = 0.75 // posição do 0 dB
export function faderToDb(f: number): number // f < 0.02 -> -Infinity; f >= 0.75 -> (f - 0.75) / 0.25 * 6; senão 40 * log10(f / 0.75)
export function faderToGain(f: number): number // 10^(dB/20), 0 no -Infinity
export function gainToFader(g: number): number // inversa; g <= 0 -> 0; g = 1 -> 0.75; teto em 1 (+6 dB)
export function dbText(g: number): string // '0.0 dB', '−3.5 dB', '+2.0 dB', '−∞ dB' (sinal de menos U+2212)
export function panText(pan: number): string // pan de -1 a 1 -> 'L50', 'C', 'R30'
export function dragFader(f0: number, dyPx: number, travelPx: number): number // preso entre 0 e 1
export function dragPan(p0: number, dyPx: number): number // passo de 0,014 por px; |p| < 0,04 vira 0
export function fitStrips(innerWidth: number, gap: number, minWidth: number): { count: number; width: number } // canais inteiros que cabem
```

- Produces (componentes):

```ts
export interface ChannelStripProps { ch: StageChannel; panEnabled: boolean; editMode: boolean; clock: Pick<StageClock, 'level'>; count: { times: number[]; labels: number[] } | null; heardNow: () => number
  onVolume(gain: number): void; onPan(pan: number): void; onMute(): void; onSolo(): void; onEdit(): void; onRemove(): void; dragHandle?: React.HTMLAttributes<HTMLElement> }
export interface MasterStripProps { master: StageView['master']; channelEditMode: boolean; clock: Pick<StageClock, 'masterLevels'>; onVolume(gain: number): void; onToggleMute(): void; onToggleChannelEdit(): void }
export interface StageMixerProps { view: Pick<StageView, 'channels' | 'channelEditMode' | 'outputs' | 'click' | 'transition' | 'master'>; actions: StageActions; clock: StageClock }
```

- Visual: v5 linhas 260 a 313 e o comportamento do v6 linhas 1126 a 1167. Por canal, de cima pra baixo: PAN (arco na cor do canal, centro marcado, valor ao lado; arrastar na vertical gira; duplo clique centraliza), fader com o nível segmentado aceso DENTRO do trilho (`clock.level(id)` em `useFrame`), marca de pico e de 0 dB, M e S (`data-touch-exception="ms"`, ~36x32px), nome (quebra em até 2 linhas, sem reticências). Coluna do PRINCIPAL à direita (116px): EDITAR CANAIS, fader com medidor L/R e escala +6 / 0 / −12 / −24 / −∞, M (mudo geral), "PRINCIPAL".
- **Fader só muda arrastando**: o arrasto começa depois de 3 px de movimento; toque sem arrastar não muda nada; duplo clique volta a 0 dB (`onVolume(1)`). Durante o arrasto aparece o balão com `dbText`.
- Solo escurece os outros (`ch.silenced`); M apaga o canal (faixa do fader cinza, regra `channelFaderFill` da Parte 1).
- Com `outputs.applyPan` falso (Click e Guia separados), o knob fica apagado, não arrasta e tem `title` "Com Click e Guia separados a VS sai em mono: o pan fica sem efeito".
- Balão branco com o número da contagem no canal de Click enquanto a contagem toca (`count` + `heardNow`).
- Modo EDITAR CANAIS: em cada canal o lápis (`onEdit`), a alça de arrastar (pointer events, funciona no toque; `onReorder` via `actions.reorderChannel`) e a lixeira de 2 toques (`ChannelTrashButton` da Parte 1).
- Largura: `fitStrips` com mínimo de 76px por canal; o que não cabe rola de lado com canais inteiros.

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
it('pan apagado e sem efeito com Click e Guia separados', ...)
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

**Onda:** 3. **Depende de:** T1 (e `useTwoTapConfirm` e `ChannelTrashButton` da Parte 1). **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/StageAppBar.tsx`, `RepertoirePanel.tsx`, `PadPanel.tsx` (em `src/components/stage/`), `src/components/stage/panels.test.tsx`

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
```

- **Barra do app** (v5 linhas 35 a 48 e 392 a 402): PlayMark + "Playback *Studio*", selo ONLINE (musgo) ou OFFLINE (neutro, não é alerta), menu REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR (aceso em laranja no modo EDITAR), HOST (só `isDesktop`; aceso com o host ligado), CONFIG, INÍCIO, avatar e SAIR. Botões com 44px de altura (o mockup tinha 32px; a regra de 44px vence). `data-tour` iguais aos do tour atual: `repertorios`, `faixas`, `biblioteca`, `editar`, `host`, `config`, `inicio`.
- **REPERTÓRIOS** (`role="dialog"`, `aria-label="Repertório"`, gaveta da esquerda por cima do palco): Novo (2 toques, "Limpar o repertório?"), Salvar .zip, Carregar .zip (input de arquivo), lista das músicas (capa, nome, artista, tom e BPM; toque escolhe; a ativa marcada "tocando" se `isPlaying`; reordenar pela alça, que funciona no toque; remover com lixeira de 2 toques), Anotações (`textarea` com fonte de 16px pra não dar zoom no iPhone/iPad; `data-tour="anotacoes"`), X e Esc fecham. A lista do repertório e as Anotações saem da frente do palco e ficam aqui (spec 5).
- **Pads** (v5 linhas 315 a 352 e 519 a 532): abas PADS / SAMPLES / LOOPS (`Segmented`), grade 4x3 de C a B com "TOM" no tom da música e equalizador animado no pad tocando, CONJUNTO (abre os conjuntos na nuvem), Volume (arrastar ou tocar no trilho), EDITAR, X. SAMPLES e LOOPS mostram os nós recebidos (a T29 passa o conteúdo atual do App). Esc fecha. A posição (sem cobrir o PRINCIPAL) é da casca (T18).

- [ ] **Step 1: Escrever `src/components/stage/panels.test.tsx`**

```tsx
it('HOST só no desktop e EDITAR aceso no modo editar', ...)
it('OFFLINE não usa cor de alerta', ...)
it('repertório: escolher, reordenar, remover com 2 toques e anotar', ...)
it('Novo pede o segundo toque antes de limpar', ...)
it('pads: toca a nota, marca o tom da música e fecha com Esc', ...)
it('textos em português, sem travessão', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/panels.test.tsx > "$LOGS/t15.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/StageAppBar.tsx src/components/stage/RepertoirePanel.tsx src/components/stage/PadPanel.tsx src/components/stage/panels.test.tsx
git commit -m "feat(palco): barra do app, painel REPERTORIOS com anotacoes e painel de pads [Parte 2] [T15]"
```

---

### Tarefa 16: Modo EDITAR do palco: marcar, ajustar e remover seções; compasso

**Onda:** 3. **Depende de:** T2 (e `useTwoTapConfirm` da Parte 1). **Antes da junção:** sim.

**Files:**
- Create: `src/lib/sectionEdit.ts`, `src/lib/sectionEdit.test.ts`
- Create: `src/components/stage/SectionEditBar.tsx`, `src/components/stage/MeterEditor.tsx`, `src/components/stage/editMode.test.tsx`

**Interfaces:**
- Consumes (T2): `snapToBar`, `barSeconds`, `withMeter`; (T1): `SongGrid`, `TimeSignature`, `TIME_SIGNATURES`, `isCompound`; `SECTION_SHORTCUTS`, `colorForSection` de `src/components/SectionBar.tsx`; `Marker` de `src/types.ts`.
- Produces:

```ts
export function addSectionAt(markers: readonly Marker[], time: number, label: string, grid: SongGrid | null, newId: () => string): Marker[]
export function nudgeSection(markers: readonly Marker[], index: number, bars: number, grid: SongGrid | null): Marker[]
export function removeSection(markers: readonly Marker[], index: number): Marker[]
export interface SectionEditBarProps { sections: StageSection[]; selected: number | null; hasGrid: boolean; onSelect(i: number): void; onMark(label: string): void; onNudge(i: number, dir: -1 | 1): void; onRemove(i: number): void }
export interface MeterEditorProps { grid: SongGrid | null; songBpm: number | null; busy: boolean; onChange(sig: TimeSignature, countEvery: 1 | 3): void; onRedetect(): void; onClose(): void }
```

- Regras puras: `addSectionAt` encaixa o tempo no compasso (`snapToBar`); se já existe marca a menos de meio compasso (ou 0,5 s sem grade com fase), troca o rótulo e a cor dela em vez de criar outra; cor por `colorForSection(label)`; lista sempre ordenada; nunca muta a recebida. `nudgeSection` move `bars` compassos (sem grade com fase, `bars` segundos), sem passar da vizinha (folga de 0,1 s) nem de 0. `removeSection` tira pelo índice.
- **Barra de edição** (no lugar da botoeira, no modo EDITAR): MARCAR com os 6 tipos de `SECTION_SHORTCUTS` (nome, tecla I V P R B F e a cor), cria na posição ouvida; toque numa seção seleciona; pra selecionada: "◂ 1 comp." e "1 comp. ▸" (ou "1 s" sem grade) e a lixeira de 2 toques; dica "Toque numa seção pra ajustar". MARCAR e EDITAR seções só existem aqui (spec 5).
- **Compasso** (`role="dialog"`): `Segmented` com `TIME_SIGNATURES`; em 6/8 e 12/8, `Segmented` "Contar 6" / "Contar 2" (12/8: "Contar 12" / "Contar 4"); origem do BPM ("Lido no click", "BPM salvo da música, sem o 1 do compasso", "Ajustado por você") e do compasso ("Lido no acento do click", "Salvo na biblioteca", "Assumido 4/4", "Escolhido por você"); BPM com 2 casas; "Ler o click de novo" (desabilitado com "Lendo o click..." quando `busy`).

- [ ] **Step 1: Escrever os testes**

```ts
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('marca nova nasce encaixada e colorida', () => expect(addSectionAt([], 8.3, 'Refrão', grid, () => 'n')).toEqual([{ id: 'n', time: 8, label: 'Refrão', color: '#FF6B35' }]))
it('marca perto de outra troca o rótulo em vez de duplicar', ...)
it('ajustar 1 compasso respeita as vizinhas', ...)
it('sem grade ajusta em segundos e não encaixa', ...)
```
```tsx
it('MARCAR cria pelo tipo e mostra a tecla', ...)
it('remover pede o segundo toque', ...)
it('compasso composto oferece contar 6 ou 2', ...)
it('origem do compasso em português', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/sectionEdit.test.ts src/components/stage/editMode.test.tsx > "$LOGS/t16.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sectionEdit.ts src/lib/sectionEdit.test.ts src/components/stage/SectionEditBar.tsx src/components/stage/MeterEditor.tsx src/components/stage/editMode.test.tsx
git commit -m "feat(palco): modo EDITAR com marcar, ajustar e remover secoes e o compasso [Parte 2] [T16]"
```

---

### Tarefa 17: Agendador da troca de seção

**Onda:** 4. **Depende de:** T4, T5, T7, T11. **Antes da junção:** sim (testado com AudioContext falso; o motor liga na T28).

**Files:**
- Create: `src/audio/sectionScheduler.ts`, `src/audio/sectionScheduler.test.ts`

**Interfaces:**
- Consumes: `planTransition`, `MIN_LEAD` (T11); `afterLanding`, `armLabel`, `isSelfLoop` (T4); `positionAt`, `ctxTimeOf`, `withSegment`, `dropFrom` (T5); `Voice`, `fadeOutVoices`, `restoreVoices`, `stopVoices`, `scheduleCount`, `ScheduledCount` (T7).
- Produces:

```ts
export const HORIZON = 0.3, FADE = 0.005, CANCEL_GUARD = 0.03, RELEASE_AFTER = 0.03
export interface SchedulerDeps {
  ctx: BaseAudioContext
  rate(): number
  timeline(): readonly TimelineSegment[]; setTimeline(next: TimelineSegment[]): void
  spans(): readonly SectionSpan[]; grid(): SongGrid | null
  currentVoices(): readonly Voice[]; setCurrentVoices(v: Voice[]): void
  startSwitchVoices(T: number, targetOffset: number, fade: number): Voice[] // o motor cria uma voz por canal com startVoicesForSwitch
  countDestination(): AudioNode | null   // entrada do canal de click, ou o barramento do click
  guideGain(): AudioParam | null
  entryLatency(): number                 // atraso da entrada de click/guia (compensação do tom), 0 no tom 0
  clickAudible(): boolean
  onView(view: TransitionView | null, intent: ArmIntent | null): void
  onLanded(to: number, at: number): void
}
export class SectionScheduler {
  constructor(deps: SchedulerDeps)
  get intent(): ArmIntent | null
  get view(): TransitionView | null
  setIntent(next: ArmIntent | null): void // re-planeja já (chama tick)
  tick(): void                            // relógio (25 ms) e logo depois de cada play()
  reset(): void                           // pausa, busca, troca de música, reinício do play: desfaz o agendado, guarda a intenção
  dispose(): void
}
```

- Comportamento (Arquitetura A): cada `tick` lê `now = ctx.currentTime`, calcula `planTransition` na posição `positionAt(timeline, now)` e converte pra tempo do contexto com `ctxTimeOf`. Fora do horizonte só publica a `view` (`committed: false`). Ao entrar no horizonte (primeiro evento a no máximo `HORIZON` de `now`) **agenda uma vez**: `scheduleCount` nos tempos da contagem em `countDestination()`; no `guideGain()`, `setValueAtTime(1, início + L)`, `linearRampToValueAtTime(0, início + L + 0,01)`, `setValueAtTime(0, T + L)`, `linearRampToValueAtTime(1, T + L + 0,01)` com `L = entryLatency()`; `fadeOutVoices(atuais, T, FADE)`; `startSwitchVoices(T, alvo, FADE)`; `setTimeline(withSegment(timeline, { ctxStart: T, songStart: alvo }))`. Com `now >= T + FADE + RELEASE_AFTER`: `stopVoices(antigas, now)`, as novas viram as atuais, `onLanded(to, T)`, intenção = `afterLanding`, e já planeja a próxima volta. Cancelar ou trocar o alvo agendado com `now < T - CANCEL_GUARD`: `count.cancel(now)`, guia `cancelScheduledValues(now)` + `setValueAtTime(1, now)`, `restoreVoices(antigas, now)`, `stopVoices(novas, now)`, `setTimeline(dropFrom(timeline, T))`; ao trocar o alvo, a contagem e a guia ficam e só as vozes novas são refeitas. Depois de `T - CANCEL_GUARD` o pulo acontece e o cancelamento vale logo depois de pousar. Sem `countDestination()`: sem bipes, o pulo acontece. `onView` só é chamado quando muda algo visível (alvo, `committed`, `barsLeft`, tempos da contagem).

- [ ] **Step 1: Escrever `src/audio/sectionScheduler.test.ts`** (AudioContext falso da T1 com `currentTime` controlado e dependências falsas que registram chamadas)

```ts
it('nada é agendado antes do horizonte', () => { s.setIntent({ target: 0, plays: 1 }); ctx.currentTime = 1; s.tick(); expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0); expect(deps.startSwitchVoices).not.toHaveBeenCalled(); expect(s.view!.committed).toBe(false) })
it('agenda contagem, guia, vozes e linha do tempo ao entrar no horizonte, uma vez só', () => { /* grade 120 4/4, seções [0,8][8,16]; tocando desde 0 em ctx 0; ctx.currentTime = 5.8: 4 bipes em 6, 6.5, 7, 7.5 (8 osciladores); guia com eventos em 6 e 8; startSwitchVoices(8, 0, 0.005); timeline com { ctxStart: 8, songStart: 0 }; segundo tick não agenda de novo */ })
it('calar a guia usa o tempo ouvido (soma a latência da entrada)', () => { /* entryLatency = 0.12: eventos da guia em 6.12 e 8.12; bipes continuam em 6..7.5 */ })
it('cancelar depois de agendado para os bipes, devolve a guia e as vozes antigas', () => { /* ctx 6.6: setIntent(null) -> osciladores com stop em 6.6; guia set 1 em 6.6; vozes antigas restauradas; novas paradas em 6.6; timeline sem o segmento de 8 */ })
it('cancelar a menos de 30 ms do 1 deixa pousar e desarma depois', ...)
it('trocar o alvo durante a contagem troca só as vozes novas', () => { /* alvo 0 -> 1 em ctx 6.6: bipes intocados; novas do alvo 0 paradas; startSwitchVoices(8, 8, 0.005) */ })
it('pousa, solta as vozes antigas e planeja a próxima volta do REPETIR', ...)
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

**Onda:** 4. **Depende de:** T8, T9, T10, T13, T14, T15, T16 (e T2 pras barras). **Antes da junção:** sim.

**Files:**
- Create: `src/components/stage/StageShell.tsx`, `src/components/stage/useStageShortcuts.ts`, `src/components/stage/useStageViewport.ts`, `src/components/stage/stageShell.test.tsx`, `src/components/stage/shortcuts.test.ts`

**Interfaces:**
- Consumes: os componentes de T8 a T10 e T13 a T16; `barSeconds`, `nearestBarLine` (T2); `computePeaks` (T9).
- Produces:

```ts
export interface StageShellProps {
  view: StageView; actions: StageActions; clock: StageClock; peaks: Float32Array | null
  pads: Omit<PadPanelProps, 'open' | 'onClose'>
  slots: { repertoire: React.ReactNode; tracksMenu?: React.ReactNode; adminTools?: React.ReactNode; channelEditPanel?: React.ReactNode }
  keyboardEnabled: boolean
}
export function StageShell(p: StageShellProps): JSX.Element
export type StageKeyAction =
  | { kind: 'togglePlay' } | { kind: 'tapSection'; index: number } | { kind: 'stepSection'; dir: -1 | 1 } | { kind: 'seekBy'; dt: number }
  | { kind: 'escape' } | { kind: 'toggleLoop' } | { kind: 'mark'; label: string }
export function stageKeyAction(e: { code: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean; targetTag?: string; targetEditable?: boolean }, ctx: { editMode: boolean; sectionCount: number }): StageKeyAction | null
export function useStageShortcuts(view: StageView, actions: StageActions, opts: { enabled: boolean; onEscape(): boolean }): void
export function isWideStage(width: number, height: number): boolean // width >= 1024 && height >= 600
export function useStageViewport(): { wide: boolean }
```

- Layout de cima pra baixo (alturas do v5: barra 44px; transporte `clamp(72px,9vh,88px)`; onda `flex 1.15`, mínimo 136px; botoeira `clamp(64px,8vh,82px)`; faixa do meio `clamp(168px,20vh,208px)`; mixer `flex 1`, mínimo 220px): `StageAppBar`, `TransportBar`, `WaveformSections`, `SectionPads` (ou `SectionEditBar` no modo EDITAR), `MidStrip` (abre o `MeterEditor` no modo EDITAR), `StageMixer` + `MasterStrip`, `PadPanel` por cima do mixer sem cobrir o PRINCIPAL. Gutter de 16px (`ps-gutter`). As barras de compasso da onda saem de `barSeconds`/`nearestBarLine` quando a grade tem fase. Os `slots` entram onde o nome diz (REPERTÓRIOS como gaveta, ferramentas do admin abaixo da barra de edição só no modo EDITAR).
- Atalhos (`stageKeyAction`): Espaço = tocar/pausar; 1 a 9 = `tapSection` (só se a seção existe); ←/→ = `stepSection`; Shift+←/→ = `seekBy` ±5; Esc = fechar a grade de tom ou o painel aberto, senão cancelar o pulo (`onEscape` decide); L = loop; I V P R B F = marcar só no modo EDITAR. Ignora com Meta/Ctrl/Alt, com foco em `INPUT`, `TEXTAREA`, `SELECT` ou `contentEditable`, e repetição de tecla (`repeat`) em Espaço, números e L.

- [ ] **Step 1: Escrever os testes**

```ts
it.each([
  [{ code: 'Space' }, { kind: 'togglePlay' }], [{ code: 'Digit3' }, { kind: 'tapSection', index: 2 }], [{ code: 'Digit9' }, null],
  [{ code: 'ArrowLeft' }, { kind: 'stepSection', dir: -1 }], [{ code: 'ArrowRight', shiftKey: true }, { kind: 'seekBy', dt: 5 }],
  [{ code: 'KeyR' }, null], [{ code: 'KeyR', edit: true }, { kind: 'mark', label: 'Refrão' }], [{ code: 'KeyL' }, { kind: 'toggleLoop' }],
  [{ code: 'Space', repeat: true }, null], [{ code: 'Space', targetTag: 'TEXTAREA' }, null], [{ code: 'Digit1', metaKey: true }, null],
])('tecla %o', (e, out) => expect(stageKeyAction(key(e), { editMode: !!e.edit, sectionCount: 5 })).toEqual(out))
it.each([[1024, 600, true], [1023, 800, false], [1280, 599, false]])('palco largo %s x %s', (w, h, ok) => expect(isWideStage(w, h)).toBe(ok))
```
```tsx
it('monta as faixas na ordem do mockup', () => { /* regiões: Transporte, Forma de onda, Seções da música, faixa do meio, Mixer */ })
it('modo EDITAR troca a botoeira pela barra de edição', ...)
it('painel de pads não cobre o PRINCIPAL', () => { /* o painel recebe o estilo right com a largura do principal + gap */ })
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/stageShell.test.tsx src/components/stage/shortcuts.test.ts > "$LOGS/t18.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/components/stage/StageShell.tsx src/components/stage/useStageShortcuts.ts src/components/stage/useStageViewport.ts src/components/stage/stageShell.test.tsx src/components/stage/shortcuts.test.ts
git commit -m "feat(palco): casca do palco novo, atalhos de teclado e regra de tela [Parte 2] [T18]"
```

---

### Tarefa 19: Configurações de saída e chave do palco

**Onda:** 4. **Depende de:** T6. **Antes da junção:** sim (a T29 encaixa no `SettingsModal`).

**Files:**
- Create: `src/components/settings/AudioOutputsSection.tsx`, `src/components/settings/StageVersionSetting.tsx`, `src/components/settings/settings.test.tsx`

**Interfaces:**
- Consumes (T6): `planOutputs`, `outputSummary`, `multiChoices`, `DEFAULT_OUTPUTS`; (T1): `OutputSettings`, `StageVersion`.
- Produces:

```ts
export interface AudioOutputsSectionProps { outputs: OutputSettings; maxChannels: number; supportsDevicePick: boolean; onChange(next: OutputSettings): void }
export function AudioOutputsSection(p: AudioOutputsSectionProps): JSX.Element
export interface StageVersionSettingProps { value: StageVersion; onChange(v: StageVersion): void }
export function StageVersionSetting(p: StageVersionSettingProps): JSX.Element
```

- **Saídas de áudio**: `Segmented` "Tudo junto" / "Click e Guia separados" / "4 ou mais saídas" (a terceira desabilitada com `maxChannels < 4` e a frase "Esta saída tem N canais"); em "separados", `Segmented` "Click e Guia na saída 1 | 2"; em "4 ou mais", três seletores (VS estéreo: pares; Click; Guia), com as opções de `multiChoices`; resumo `outputSummary(planOutputs(outputs, maxChannels))` sempre visível; se o plano caiu de modo (`fellBackFrom`), frase em âmbar "Esta placa tem só 2 canais. Usando Click e Guia na saída 1 e a VS na saída 2." Sem `supportsDevicePick` (Safari/iPad/Firefox): "Neste navegador o som sai pela saída do sistema." Alvos de 44px; seletores com fonte de pelo menos 16px.
- **Palco**: `Segmented` "Novo" / "Antigo" com a ajuda "Se o palco novo der problema no culto, volte pro antigo aqui. O repertório e o som não mudam."

- [ ] **Step 1: Escrever `src/components/settings/settings.test.tsx`**

```tsx
it('4 ou mais saídas desabilitado em placa de 2 canais, com a contagem de canais', ...)
it('mudar o lado do click em separados chama onChange com earOnSecond', ...)
it('resumo e aviso de queda em português', ...)
it('chave do palco alterna Novo e Antigo', ...)
it('sem travessão', ...)
```

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

**Onda:** 5. **Depende de:** T18. **Antes da junção:** sim (roda com dados de exemplo, sem motor).

**Files:**
- Create: `scripts/verify-layout/index.html`, `scripts/verify-layout/main.tsx`, `scripts/verify-layout/fixture.ts`, `scripts/verify-layout/check.ts`, `scripts/verify-layout/vite.config.ts`, `scripts/verify-layout/run.mjs`, `scripts/verify-layout/README.md`, `scripts/verify-layout/.gitignore`
- Modify (só classes, só no passo 3): `src/components/stage/*.tsx` e `src/components/settings/*.tsx` (é a única tarefa da Onda 5)

**Interfaces:**
- Consumes: `StageShell` (T18) e o contrato (T1).
- Produces: `node scripts/verify-layout/run.mjs [--only 1280x800]`, sai com 1 se algum item falhar; JSON em `scripts/verify-layout/results/`.

- `fixture.ts`: `StageView` de exemplo com 14 canais (nomes organizados mais longos da Parte 1, como "Percussão Dedilhado Ambiente"), 9 seções (uma "Refrão Final Estendido"), música e artista longos, 6 no repertório, e variantes por query: `?estado=normal|contando|pads|editar|livre`. `StageActions` vazias e `StageClock` parado em valores fixos (contagem no tempo 2).
- `main.tsx` importa `src/index.css` (tokens `ps-*` e Tailwind) e monta `StageShell` com a variante pedida. `vite.config.ts`: raiz `scripts/verify-layout`, `@vitejs/plugin-react` + `@tailwindcss/vite`, saída em `scripts/verify-layout/.build`.
- `check.ts` (roda na página e manda o resultado por POST, como o `verify-pitch`): pra todo elemento com texto próprio: (a) nada cortado: `scrollWidth <= clientWidth + 1` e `scrollHeight <= clientHeight + 1` quando o `overflow` calculado não é `visible`, e o retângulo do texto (Range) dentro do de todo ancestral com `overflow` diferente de `visible`; (b) nada encostando: em `button`, `[role=radio]` e chips, o texto fica a pelo menos 4px das bordas na horizontal; (c) alvo de toque: `button`, `[role=button]`, `[role=radio]`, `input`, `select` com pelo menos 44x44 (com `data-touch-exception="ms"`, pelo menos 32x30); (d) sem rolagem horizontal da página. Cada falha sai com o seletor, o texto e as medidas.
- `run.mjs`: `vite build` com essa config, servidor local, Chrome headless (`--headless=new`, `--window-size=W,H`, mesmo `CHROME` do `verify-pitch`) em 1024x768, 1280x760, 1280x800, 1440x900 e 1920x1080, nas 5 variantes.

- [ ] **Step 1: Montar o verificador e rodar contra o palco da T18**

Run: `node scripts/verify-layout/run.mjs > "$LOGS/t20.log" 2>&1; echo $?`
Expected na primeira rodada: pode dar 1 com a lista do que cortou.

- [ ] **Step 2: Conferir que o verificador pega erro de propósito**: na fixture, uma variante `?estado=quebrado` com um botão de largura fixa e texto longo. Run: `node scripts/verify-layout/run.mjs --only 1280x800 --estado quebrado > "$LOGS/t20b.log" 2>&1; echo $?`. Expected: `1` com o botão listado.

- [ ] **Step 3: Corrigir o que o verificador apontar nos componentes da Onda 3/4** só mexendo em classes dos arquivos `src/components/stage/*` (esta tarefa é a única da Onda 5, então pode tocar neles) até a rodada normal dar `0` nas 25 combinações. Cada correção num commit separado `fix(palco): ... [T20]`.

- [ ] **Step 4: Rodar de novo.** Run: `node scripts/verify-layout/run.mjs > "$LOGS/t20.log" 2>&1; echo $?`. Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-layout/index.html scripts/verify-layout/main.tsx scripts/verify-layout/fixture.ts scripts/verify-layout/check.ts scripts/verify-layout/vite.config.ts scripts/verify-layout/run.mjs scripts/verify-layout/README.md scripts/verify-layout/.gitignore
git commit -m "test(palco): verificador de texto cortado e alvos de toque em 5 tamanhos de tela [Parte 2] [T20]"
```

(O `.gitignore` do diretório ignora `results/` e `.build/`.)

---

## Grupo M: metrônomo automático corrigido (antes da junção)

Base: relatório `.superpowers/sdd/metronomo-auto-investigacao.md` (causas 1 a 9 e recomendações 1 a 8) e os scripts de medição em `~/playback-studio-work/metronomo/scripts/verify-click/`. Cada tarefa transforma linhas da tabela do relatório em testes que hoje falham. Valores de referência copiados do relatório: tempo certo quando trava (+0,2 a +6,8 ms); contratempo de 285 a 394 ms; o "1" certo em 31 de 54 cenários 4/4; 160 e 176 BPM saem 80 e 88; confiança 0,52 no ruído branco, 0,63 na voz em glissando, 0,39 no pad e 0,953 na bateria a -40 dB; ataque a -20 dB do Classic 1,09 ms e do Percussive 4,44 ms (corpo em 18,8 ms).

### Tarefa M1: Detector de tempo em etapas e sintéticos do relatório no Vitest

**Onda:** 0. **Depende de:** P1 a P3. **Antes da junção:** sim.

**Files:**
- Modify: `src/lib/beatGrid.ts` (vira o orquestrador; `detectBeatGrid` e `formatBpm` com a mesma assinatura)
- Create: `src/lib/tempo/onsets.ts`, `src/lib/tempo/phase.ts`, `src/lib/tempo/downbeat.ts`, `src/lib/tempo/confidence.ts`, `src/lib/tempo/octave.ts`
- Create: `src/test/synthMusic.ts` (porte em TypeScript de `synth.mjs`: `makeSong`, `PATTERNS`), `src/test/clickProbe.ts` (porte de `detectClicks` e `evaluate` de `harness.mjs`), `src/test/legacyBeatGrid.ts` (cópia congelada do `beatGrid.ts` de hoje, só pro teste), `src/lib/beatGrid.equivalence.test.ts`
- Create: `scripts/verify-click/` (cópia dos scripts do relatório, sem `node_modules`, `dist` e `results*`, com `README.md` curto dizendo como rodar)

**Interfaces:**
- Produces:

```ts
// tempo/onsets.ts
export interface OnsetBands { fps: number; full: Float32Array; low: Float32Array; kick: Float32Array; snare: Float32Array }
export function onsetBands(channels: Float32Array[], sampleRate: number): OnsetBands | null // M1: full e low como hoje; kick = low e snare = full (a M2 troca)
// tempo/phase.ts
export function choosePhase(b: OnsetBands, period: number, phase: number): { phase: number; offbeatRisk: boolean } // M1: devolve a fase recebida, risco false
// tempo/downbeat.ts
export interface DownbeatVotes { bass?: OnsetBands; harmony?: OnsetBands[] }
export function chooseDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): number // M1: regra de hoje
// tempo/confidence.ts
export const CONFIDENCE_CUT: number // M1: 0.1 (o corte de hoje, MetronomeModal.tsx:187)
export function measureConfidence(o: Float32Array, period: number, phase: number): number // M1: regra de hoje
// tempo/octave.ts
export function tempoCandidates(rough: number, opts: { nearBpm?: number; signature?: TimeSignature }): number[] // M1: [rough]
export function pickTempo(cands: { bpm: number; score: number }[], opts: { nearBpm?: number }): { bpm: number; alternatives: number[] } // M1: maior score, alternatives []
// beatGrid.ts
export interface TempoTrack { id: string; label: string; use: 'pulse' | 'bass' | 'harmony'; channels: Float32Array[] }
export interface SongGridDetection extends BeatGrid { offbeatRisk: boolean; alternatives: number[]; tracksUsed: string[] }
export function detectSongGrid(tracks: readonly TempoTrack[], sampleRate: number, opts?: BeatGridOptions & { signature?: TimeSignature }): SongGridDetection
// detectBeatGrid(ch, sr, opts) passa a ser detectSongGrid([{ id: 'faixa', label: '', use: 'pulse', channels: ch }], sr, opts) sem os campos novos
```

- [ ] **Step 1: Copiar os scripts e escrever `src/lib/beatGrid.equivalence.test.ts`**: pra 8 músicas de `makeSong` (casos b, c 72,5, c 135,04, d, e pop leve, f 3/4, g -40 dB, humanizado), `detectBeatGrid` novo e `legacyDetectBeatGrid` dão o mesmo `bpm` (±0,01), `firstBeat` (±1e-6), `downbeat` e `confidence` (±1e-6). E um teste de fumaça de `synthMusic` + `clickProbe`: a bateria do caso b tem o 1º golpe em 1,37 s e o click gerado pelo `generateManualClickTrackFromSample` com a grade certa fica a menos de 4 ms dela.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/beatGrid.equivalence.test.ts > "$LOGS/m1.log" 2>&1; echo $?`.
- [ ] **Step 3: Dividir `beatGrid.ts` nas etapas acima sem mudar nenhum cálculo** e criar `detectSongGrid` (com uma faixa `pulse` só, igual ao de hoje).
- [ ] **Step 4: Rodar e ver passar.** Rodar também `./node_modules/.bin/vitest run src/components/SeparatorStudio` se existir teste dele (o Separador usa `detectBeatGrid`).
- [ ] **Step 5: Commit**

```bash
git add src/lib/beatGrid.ts src/lib/tempo/onsets.ts src/lib/tempo/phase.ts src/lib/tempo/downbeat.ts src/lib/tempo/confidence.ts src/lib/tempo/octave.ts src/test/synthMusic.ts src/test/clickProbe.ts src/test/legacyBeatGrid.ts src/lib/beatGrid.equivalence.test.ts scripts/verify-click
git commit -m "refactor(tempo): detector de tempo em etapas, sem mudar o resultado, e sinteticos do relatorio [Parte 2] [M1]"
```

(`git add scripts/verify-click` só depois de conferir com `git status --short scripts/verify-click` que não entrou `node_modules`, `dist` nem `results*`.)

---

### Tarefa M2: Tempo x contratempo, bandas do bumbo e da caixa, e confiança de verdade

**Onda:** 1. **Depende de:** M1. **Antes da junção:** sim.

**Files:**
- Modify: `src/lib/tempo/onsets.ts`, `src/lib/tempo/phase.ts`, `src/lib/tempo/confidence.ts`
- Create: `src/lib/tempo/phase.test.ts`, `src/lib/tempo/confidence.test.ts`

**Interfaces:**
- Mantém as assinaturas da M1. `CONFIDENCE_CUT` passa a ser calibrado (ver passo 3).

- Correções (recomendações 1, 4 e 5 do relatório):
  - `onsetBands`: `prev` começa em 0 no envelope (o golpe em 0,000 deixa de ser perdido); `kick` = passa-baixa de 2 polos abaixo de ~100 Hz; `snare` = banda de 150 a 300 Hz somada a ruído acima de 2 kHz.
  - `choosePhase`: compara a fase φ com φ + meio período pela evidência de bumbo e caixa (cada um normalizado pelo próprio máximo); fica com a maior; `offbeatRisk = true` quando a diferença relativa é menor que 15% ou quando a faixa não tem bumbo nem caixa (baixo em colcheias, loop de shaker).
  - `measureConfidence`: mede contra controle: a mesma busca de fase no envelope com blocos de 2 s embaralhados (16 sorteios com semente fixa); confiança = `clamp((melhor - média dos controles) / (4 * desvio dos controles), 0, 1)`.
- [ ] **Step 1: Escrever os testes com os casos do relatório** (`makeSong`):

```ts
it.each(['e-sincope', 'e-sincope-sem-acento', 'e-one-drop'])('%s: click no tempo, não no contratempo', (caso) => expect(Math.abs(erroDoPrimeiroClick(caso))).toBeLessThan(0.010))
it.each(['bass-colcheias', 'loop-shaker'])('%s: sem bumbo nem caixa, avisa o risco de meio tempo', (caso) => expect(detect(caso).offbeatRisk).toBe(true))
it('o golpe em 0,000 conta (caso a)', ...)
it('a confiança separa pulso de ruído', () => {
  const negativos = ['ruido-branco', 'voz-glissando', 'pad', 'bateria-afogada-bpm-errado'].map(confianca)
  const positivos = ['a', 'b', 'c-72.5', 'c-135.04', 'd', 'g-40db', 'g-50db-chiado', 'humanizado', 'balada-58'].map(confianca)
  expect(Math.max(...negativos)).toBeLessThan(CONFIDENCE_CUT); expect(Math.min(...positivos)).toBeGreaterThanOrEqual(CONFIDENCE_CUT)
})
it('os casos que já davam certo continuam no mesmo erro (até +6,8 ms)', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo > "$LOGS/m2.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar e calibrar `CONFIDENCE_CUT`** no meio do vão entre o maior negativo e o menor positivo medidos (anotar os dois números no comentário da constante e no relatório). Se não houver vão, parar e avisar o coordenador.
- [ ] **Step 4: Rodar e ver passar** (inclui `src/lib/beatGrid.equivalence.test.ts`: os casos de equivalência que mudarem de resultado por causa da correção saem da lista de equivalência e entram nos testes desta tarefa, com o motivo no comentário).
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/onsets.ts src/lib/tempo/phase.ts src/lib/tempo/confidence.ts src/lib/tempo/phase.test.ts src/lib/tempo/confidence.test.ts src/lib/beatGrid.equivalence.test.ts
git commit -m "fix(tempo): tempo x contratempo por bumbo e caixa e confianca medida contra controle [Parte 2] [M2]"
```

---

### Tarefa M3: O "1" do compasso

**Onda:** 3. **Depende de:** M2 (bandas `kick` e `snare`). **Antes da junção:** sim.

**Files:**
- Modify: `src/lib/tempo/downbeat.ts`; `src/lib/beatGrid.equivalence.test.ts` (só se um caso de equivalência mudar de resultado pela correção: sai de lá e vira teste aqui, com o motivo)
- Create: `src/lib/tempo/downbeat.test.ts`

- Correções (recomendação 4): o voto principal do "1" é a troca de acorde e a nota do baixo (`votes.bass`, `votes.harmony`) quando existirem; o bumbo (`kick`, 2 polos) vem depois; o desempate "onde a bateria começa" só vale sem nenhum outro voto.
- [ ] **Step 1: Escrever `downbeat.test.ts`** com a matriz de 54 cenários 4/4 de `downbeat.mjs` (com Bateria + Baixo + Pad) e os casos citados: virada no tempo 4 antes da entrada, música começando em 0,000, bumbo em todo tempo com chimbal aberto no "e".

```ts
it('acerta o 1 em pelo menos 50 dos 54 cenários 4/4 (hoje 31)', () => expect(acertos(cenarios54)).toBeGreaterThanOrEqual(50))
it.each(['virada-antes-da-entrada', 'comeca-em-zero', 'bumbo-em-todo-tempo'])('%s', (c) => expect(downbeatCerto(c)).toBe(true))
it('3/4 com compasso pedido 3/4 acerta o 1', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo/downbeat.test.ts > "$LOGS/m3.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** (com `src/lib/tempo` inteiro).
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/downbeat.ts src/lib/tempo/downbeat.test.ts
git commit -m "fix(tempo): o 1 do compasso pela troca de acorde e pelo baixo [Parte 2] [M3]"
```

---

### Tarefa M4: Andamento: oitava, compasso composto e BPM da música

**Onda:** 2. **Depende de:** M1. **Antes da junção:** sim.

**Files:**
- Modify: `src/lib/tempo/octave.ts`; `src/lib/beatGrid.equivalence.test.ts` (mesma regra da M3)
- Create: `src/lib/tempo/octave.test.ts`

- Correções (recomendação 6): candidatos sempre ½×, 1× e 2× do andamento áspero; o escolhido é o que põe bumbo e caixa em tempos diferentes (contratempo da caixa no 2 e no 4), com preferência pelo mais perto de `nearBpm` (o BPM da música) quando ele existe; `alternatives` = os outros dois, sempre. Em 6/8 e 12/8 (`signature` composto), o pulso achado em semínima pontuada é multiplicado por 3 (o BPM e a grade passam a ser de colcheia, que é o que o click conta).
- [ ] **Step 1: Escrever `octave.test.ts`**

```ts
it.each([[160], [176]])('%s BPM sai inteiro, não pela metade', (bpm) => expect(detect(rapida(bpm)).bpm).toBeCloseTo(bpm, 1))
it('com o BPM da música como referência escolhe a oitava dele', ...)
it('sempre oferece metade e dobro', () => expect(detect(caso('b')).alternatives).toEqual([60, 240]))
it('6/8 pedido em 6/8 conta colcheias (180) com o acento a cada compasso', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempo/octave.test.ts > "$LOGS/m4.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/octave.ts src/lib/tempo/octave.test.ts
git commit -m "fix(tempo): oitava do andamento, compasso composto e BPM da musica como referencia [Parte 2] [M4]"
```

---

### Tarefa M5: Faixas de análise pela regra central

**Onda:** 1. **Depende de:** nada além da base (`channelNames.ts` e `channelRoles.ts` da Parte 1). **Antes da junção:** sim.

**Files:**
- Create: `src/lib/tempoSources.ts`, `src/lib/tempoSources.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TempoSources<T extends ChannelIdentity> { click: T | null; pulse: T[]; bass: T | null; harmony: T[]; label: string }
export function pickTempoSources<T extends ChannelIdentity>(channels: readonly T[]): TempoSources<T>
```

- Regras (recomendações 2 e 3): `click` = `findClickChannel` (papel manual vale); `pulse` = todos os canais das famílias `bateria` e `percussao` (o kit separado KICK, SNARE, HIHAT, OH entra inteiro); se houver kit inteiro ("Drums", "Bateria") e também "Loop" ou "Fill(s)", ficam só os de kit; sem bateria nem percussão, `pulse` = `[baixo]` se houver; `bass` = primeiro `baixo` ou `synthBass`; `harmony` = até 2 entre `pad`, `teclado`, `piano`, `violao`; nunca Guia, Vocal, Backing nem Click em `pulse`, `bass` ou `harmony`. `label` em português pra mostrar no modal, ex. "Bateria, Percussão e Baixo".
- [ ] **Step 1: Escrever `tempoSources.test.ts`** com a tabela de nomes da seção 4 do relatório (13 pacotes), esperando: kit separado (KICK, SNARE, HIHAT, OH, PERC) em `pulse` e BASS em `bass`; BUMBO/CAIXA/CHIMBAL em `pulse`; "Drums" vence "Drum Loop" e "Drum Fills"; "Batería" (espanhol) em `pulse` e "Guía" fora; "Metrônomo" como `click` e fora de `pulse`; pacote só com Pad e Loop: `pulse` = [Loop], `harmony` = [Pad].
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/tempoSources.test.ts > "$LOGS/m5.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** com `channelFamily`, `resolveChannelRole` e `findClickChannel` da Parte 1 (nada de `includes` em pedaço de nome).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/tempoSources.ts src/lib/tempoSources.test.ts
git commit -m "feat(tempo): faixas de analise pela regra central, com o kit inteiro e o baixo [Parte 2] [M5]"
```

---

### Tarefa M6: Gerador de click compensando o ataque de cada amostra

**Onda:** 2. **Depende de:** M1 (`clickProbe`). **Antes da junção:** sim.

**Files:**
- Create: `src/lib/clickAttack.ts`, `src/lib/clickAttack.test.ts`
- Modify: `src/lib/AudioAnalyzer.ts` (`generateManualClickTrackFromSample`, linhas 604 a 662: posição de cada click)

**Interfaces:**
- Produces: `export const CLICK_ATTACK_MS: Readonly<Record<string, number>>` (ataque a -20 dB de cada arquivo de amostra, tirado de `scripts/verify-click/samples.json`, campo `first_m20dB_ms`) e `export function attackSeconds(sampleFile: string): number` (0 pra arquivo desconhecido).
- Correção (recomendação 7): cada click é colocado em `t - attackSeconds(amostra)` (preso em 0), então o ataque audível cai no tempo. O caminho reserva `analyzeBufferAndGenerateClick` (o da v1.4.9) não muda aqui; quem deixa de usá-lo é a M7.
- [ ] **Step 1: Escrever `clickAttack.test.ts`**: tabela tem todas as 29 amostras de `samples.json`; gerando o caso b com a grade certa, o início audível (-20 dB, `clickProbe`) fica a menos de 1 ms do golpe com Classic e com Percussive (hoje 3,6 e 6,9 ms).
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/clickAttack.test.ts > "$LOGS/m6.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/clickAttack.ts src/lib/clickAttack.test.ts src/lib/AudioAnalyzer.ts
git commit -m "fix(click): gerador compensa o ataque de cada amostra [Parte 2] [M6]"
```

---

### Tarefa M7: Metrônomo automático no modal

**Onda:** 4. **Depende de:** M2 a M6. **Antes da junção:** sim.

**Files:**
- Modify: `src/components/MetronomeModal.tsx` (fluxo do "Gerar click IA", `handleAIGenerate`, linhas ~140 a 215; estado do compasso, linha ~49)
- Create: `src/components/MetronomeModal.auto.test.tsx`

**Interfaces:**
- Consumes: `detectSongGrid`, `CONFIDENCE_CUT` (M1/M2), `pickTempoSources` (M5), `formatBpm` (`beatGrid.ts`).
- Produces: prop nova opcional `initialSignature?: TimeSignature` (a T29 passa o compasso da grade da música); sem ela, o compasso vem de `localStorage` `mt_meter_<id da música>` e, sem nada, 4/4. Toda troca de compasso grava nessa chave.

- Fluxo novo (recomendações 3, 5 e 6, causas 6 e 7):
  1. Faixas por `pickTempoSources`. Se a música já tem click: "Esta música já tem click (<nome>)." e o botão segue disponível como "Gerar outro click".
  2. `detectSongGrid` com `nearBpm` = BPM da música (quando houver) e o compasso escolhido.
  3. Mostra o resultado ANTES de inserir: "BPM 135.0 · analisado em Bateria e Baixo", botões "½×" e "2×" (trocam pelo `alternatives`), "Mover o 1" ◂ ▸ (mesma ideia do `SeparatorStudio.tsx:345`), "Deslocar meio tempo" só com `offbeatRisk`, e "Inserir click".
  4. Confiança abaixo de `CONFIDENCE_CUT`: aviso em âmbar "Não deu pra ter certeza do tempo desta música. Confira o BPM ou use o modo manual." e nada é inserido sozinho. O caminho `analyzeBufferAndGenerateClick` (click colado em 0:00, BPM inteiro: o bug da v1.4.9) deixa de ser chamado pelo modal.
- [ ] **Step 1: Escrever `MetronomeModal.auto.test.tsx`** (jsdom; `detectSongGrid` e o gerador mockados): resultado aparece antes de inserir; ½× troca o BPM mostrado; confiança baixa mostra o aviso e não chama `onAddClick`; `analyzeBufferAndGenerateClick` nunca é chamado; compasso escolhido volta ao reabrir o modal da mesma música; `nearBpm` recebe o BPM da música.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/MetronomeModal.auto.test.tsx src/components/MetronomeModal.detectors.test.ts > "$LOGS/m7.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (textos em português, sem travessão; botões de 44px com as peças da Parte 1 só nos elementos novos; o resto do modal fica com o visual atual até a Parte 3).
- [ ] **Step 4: Rodar e ver passar** (inclui o teste de guarda da Parte 1, `MetronomeModal.detectors.test.ts`, que pode precisar aceitar `pickTempoSources` no lugar de `pickTempoSourceChannel`; ajustar o teste antigo só nesse ponto).
- [ ] **Step 5: Commit**

```bash
git add src/components/MetronomeModal.tsx src/components/MetronomeModal.auto.test.tsx src/components/MetronomeModal.detectors.test.ts
git commit -m "feat(metronomo): click IA mostra o resultado antes, com metade e dobro, mover o 1 e aviso de confianca [Parte 2] [M7]"
```

**Linha pro FATOS (M1 a M7):** metrônomo automático (Gerar click IA) corrigido: tempo x contratempo, o 1 do compasso, andamentos rápidos, 6/8, kit separado e confiança real; mostra o BPM antes de inserir com metade/dobro, mover o 1 e aviso quando não tem certeza; o click sincronizado do Separador ganha as mesmas correções. **QA do dono:** gerar click IA em 3 músicas reais (uma sincopada, uma rápida, uma 6/8) e no Separador conferir que o click sincronizado continua no lugar.

---

## Depois do Portão J (junção concluída e troca de base feita)

### Tarefa 21: Paleta de famílias aprovada

**Onda:** 6. **Depende de:** P4, P5.

**Files:**
- Modify: `src/lib/channelNames.ts` (só o objeto `FAMILY_COLOR`)
- Modify: `src/lib/channelNames.test.ts` (teste de igualdade do `FAMILY_COLOR`), `src/lib/channelRoles.test.ts` (teste que fixa a cor da bateria)

- Proposta pro dono aprovar no P4 (motivo: nenhuma cor de canal repete laranja ligado, branco armado, âmbar alerta, vermelho do M, amarelo do S, e as que repetiam cor de seção saem dela; as cores de canal só aparecem no mixer):

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
| desconhecido | `#9d9da8` | `#7a7a85` | separa do click (ardósia) |

- [ ] **Step 1: Atualizar os dois testes pra tabela APROVADA** e acrescentar `it('nenhuma cor de família repete cor de estado', () => { for (const c of Object.values(FAMILY_COLOR)) expect(['#ff6b35', '#f5f5f7', '#fbbf24', '#ef4444', '#facc15']).not.toContain(c.toLowerCase()) })`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/channelNames.test.ts src/lib/channelRoles.test.ts > "$LOGS/t21.log" 2>&1; echo $?`.
- [ ] **Step 3: Trocar os valores de `FAMILY_COLOR`.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/channelNames.ts src/lib/channelNames.test.ts src/lib/channelRoles.test.ts
git commit -m "fix(canais): paleta de familias sem repetir cor de estado nem de secao [Parte 2] [T21]"
```

**Linha pro FATOS:** cores de família do mixer revistas (Click ardósia, Guia pedra, Bateria areia...), sem repetir as cores de estado.

---

### Tarefa 22: Repertório v3 com a grade da música

**Onda:** 6. **Depende de:** T2, P5.

**Files:**
- Modify: `src/lib/repertoireSchema.ts`, `src/lib/repertoireSchema.test.ts`, `src/types.ts` (`Song` ganha `grid?: SongGrid` e `timeSignature?: TimeSignature`)

**Interfaces:**
- Produces: `REPERTOIRE_SCHEMA_VERSION = 3`; `SavedSong` ganha `grid?: SongGrid` e `timeSignature?: TimeSignature` (o compasso que veio da nuvem); `toSavedSong` grava `sanitizeGrid(song.grid) ?? undefined` e `timeSignature`; `migrateSavedSong` leva v1 e v2 pra v3 sem perder nada e descarta grade inválida. O manifest do ZIP não leva a grade (o ZIP nunca levou marcadores nem tom; decisão mantida), então a grade é lida de novo do click ao importar.
- [ ] **Step 1: Testes**: `migrateSavedSong preserva um registro v2 real inteiro e marca v3`; `grade com bpm NaN é descartada e o resto fica`; `grade manual sobrevive a toSavedSong e migrate`; `registro v1 real da Parte 1 chega em v3 igual` (reusar o fixture da T5 da Parte 1).
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/repertoireSchema.test.ts > "$LOGS/t22.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/repertoireSchema.ts src/lib/repertoireSchema.test.ts src/types.ts
git commit -m "feat(repertorio): v3 guarda a grade e o compasso da musica [Parte 2] [T22]"
```

---

### Tarefa 23: Nuvem: BPM com decimais e compasso nos 3 lugares

**Onda:** 6. **Depende de:** P5.

**Files:**
- Create: `db/supabase-bpm-exact-migration.sql`, `src/lib/cloudBpm.ts`, `src/lib/cloudBpm.test.ts`
- Modify: `api/insert-song.ts`, `src/lib/supabase.ts` (`CloudSong`, `insertSong`, `updateSong`), `src/hooks/useCloudLibrary.ts` (`downloadSong`), `src/lib/offlineCache.ts` (`getCachedSong`), `src/components/LibraryModal.tsx` (edição do BPM e o `extra` do `onDownload`), `src/components/AdminModal.tsx` (campo de BPM, linha ~223)

**Interfaces:**
- Produces:

```sql
-- aditiva e segura: apps antigos continuam lendo o bpm inteiro
alter table public.songs add column if not exists bpm_exact numeric(6,2) null check (bpm_exact is null or (bpm_exact > 0 and bpm_exact < 400));
alter table public.songs add column if not exists time_signature text null check (time_signature is null or time_signature in ('3/4','4/4','5/4','6/8','7/8','12/8'));
```

```ts
// cloudBpm.ts
export function preciseBpm(s: { bpm?: number | null; bpm_exact?: number | null }): number | undefined // bpm_exact > 0, senão bpm > 0, senão undefined
export function bpmColumns(value: number): { bpm: number; bpm_exact: number } | null // { round(value), 2 casas }; fora de (0, 400) -> null
export function sanitizeTimeSignature(raw: unknown): TimeSignature | null
```

- `CloudSong` ganha `bpm_exact?: number | null` e `time_signature?: TimeSignature | null` (os `select('*')` já trazem as colunas). `downloadSong` e `getCachedSong` devolvem `bpm: preciseBpm(s)` e `timeSignature`; `LibraryModal` passa `extra.timeSignature` no `onDownload` e o campo de BPM aceita `step="0.01"`; gravar BPM (biblioteca e admin) usa `bpmColumns` (a coluna `bpm` é inteira: mandar 72.5 nela daria erro do Postgres). `api/insert-song.ts` troca `Math.trunc` por `Math.round` e grava `bpm_exact` (2 casas) e `time_signature` validado (mesma regra de `cloudBpm.ts`, repetida no servidor com um comentário apontando pra ela). O snapshot do cache offline continua sendo atualizado só por `updateCachedSongMeta`, que já copia o `CloudSong` inteiro.
- **Ordem de lançamento:** a migration roda no Supabase ANTES de publicar o app que grava as colunas (o @data-engineer aplica; registrar no FATOS).
- [ ] **Step 1: Testes de `cloudBpm.test.ts`**: `preciseBpm` prefere o exato, cai no inteiro, ignora 0; `bpmColumns(72.5)` = `{ bpm: 73, bpm_exact: 72.5 }`; `bpmColumns(0)` e `bpmColumns(NaN)` = `null`; `sanitizeTimeSignature('9/8')` = `null`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/lib/cloudBpm.test.ts > "$LOGS/t23.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** o helper, a migration e as ligações listadas.
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit > "$LOGS/t23-tsc.log" 2>&1; echo $?` e `cd api && ../node_modules/.bin/tsc -p tsconfig.json --noEmit > "$LOGS/t23-api.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add db/supabase-bpm-exact-migration.sql src/lib/cloudBpm.ts src/lib/cloudBpm.test.ts api/insert-song.ts src/lib/supabase.ts src/hooks/useCloudLibrary.ts src/lib/offlineCache.ts src/components/LibraryModal.tsx src/components/AdminModal.tsx
git commit -m "feat(biblioteca): BPM com decimais e compasso salvos na nuvem, sem quebrar apps antigos [Parte 2] [T23]"
```

**Linha pro FATOS:** BPM com decimais (`songs.bpm_exact`) e compasso (`songs.time_signature`) na nuvem; o `bpm` inteiro continua pros apps antigos; migration antes do lançamento.

---

### Tarefa 25: Motor: saídas por papel (VS x Click/Guia), mudo geral e chave nas configurações

**Onda:** 6. **Depende de:** T6, T12, P5.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (criação do contexto em `initEngine`; ligação do ganho de cada canal na restauração, em `loadFiles`, `addChannelToActiveSong` e `createEndlessMetronomeSong`; efeito do `setSinkId`; efeito do pan automático; `updatePan`; `setChannelBus`; troca de papel do `setChannelMeta`; pré-contagem atual; remoção de `bus1GainRef`, `bus2GainRef`, `bus1Volume`, `bus2Volume`, `updateBus1Volume`, `updateBus2Volume`, se o `grep` confirmar que nada usa)
- Modify: `src/contexts/SettingsContext.tsx` (`AppSettings` ganha `outputs` e `stageVersion`)
- Modify (só se preciso, só a busca do principal): `scripts/verify-pitch/www/harness.jsx`
- Create: `src/hooks/useAudioEngine.outputs.test.ts`, `src/contexts/SettingsContext.test.tsx`

**Interfaces:**
- Consumes: `planOutputs`, `effectivePan`, `outputsFromLegacy`, `sanitizeOutputs` (T6); `createOutputGraph` (T12); `resolveChannelRole` (Parte 1).
- Produces:
  - `AppSettings`: `outputs: OutputSettings` (ao carregar: `outputsFromLegacy(salvo)`), `stageVersion: StageVersion` (padrão `'novo'`; valor estranho vira `'novo'`).
  - Retorno do motor ganha: `outputPlan: OutputPlan`, `maxOutputChannels: number`, `masterMuted: boolean`, `toggleMasterMute(): void`, `getOutputLevels(): { l: number; r: number }`.
- Regras: o `gainNode` de cada canal liga em `graph.input(resolveChannelRole(ch))`, nunca direto no principal; `masterGainRef.current = graph.master` (FADE e AUTO seguem iguais); trocar o papel re-liga só aquele canal; o pan do nó é sempre `effectivePan(ch.pan, plan)` (o `ch.pan` salvo não muda); o efeito do pan automático só age com `plan.mode === 'stereo'`; depois do `setSinkId` e no evento `sinkchange`, re-planeja com o `destination.maxChannelCount` novo e chama `graph.apply`; mudar `settings.outputs` também re-planeja. A pré-contagem atual (osciladores) passa a ligar em `graph.input('click')` em vez do `destination` (a T26 refaz a pré-contagem inteira).
- [ ] **Step 1: Escrever os testes** (mesmo esquema de fakes de `useAudioEngine.persistence.test.ts` da Parte 1, com o `createFakeAudioContext` da T1):

```ts
it('canal Click liga no barramento do click e o Baixo no da VS', ...)
it('papel manual Guia no Baixo re-liga no barramento da guia', ...)
it('em separados o pan do nó é 0 e o salvo continua -1; em tudo junto volta -1', ...)
it('placa de 2 canais com 4 ou mais escolhido cai em separados', ...)
it('a pré-contagem nunca liga no destino direto', () => { /* nenhum oscilador ligado em ctx.destination */ })
it('mudo geral zera só o masterMute', ...)
```
```tsx
it('quem tinha pan automático entra em separados e o palco novo é o padrão', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.outputs.test.ts src/contexts/SettingsContext.test.tsx > "$LOGS/t25.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais os testes do motor que já existem (`./node_modules/.bin/vitest run src/hooks > "$LOGS/t25b.log" 2>&1; echo $?`) e `node scripts/verify-pitch/run.mjs LEVELS SPREAD > "$LOGS/t25c.log" 2>&1; echo $?` (o harness acha o principal andando pelas ligações até o `destination`; se ele ainda procura `gain -> master` direto, ajustar só essa busca em `scripts/verify-pitch/www/harness.jsx` e listar no relatório).
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/contexts/SettingsContext.tsx src/hooks/useAudioEngine.outputs.test.ts src/contexts/SettingsContext.test.tsx
git commit -m "feat(saidas): motor separa VS e Click/Guia pelo papel do canal, independente do pan [Parte 2] [T25]"
```

**Linha pro FATOS:** saídas de áudio separadas: Click e Guia numa saída e a VS na outra (placa de 2 canais), ou VS estéreo + Click e Guia em saídas próprias (4 ou mais); quem usava o pan automático já entra no modo separado.

---

### Tarefa 24: Modo Ao Vivo: protocolo do pulo armado e da contagem

**Onda:** 7. **Depende de:** T4, P5.

**Files:**
- Modify: `src/hooks/useLiveSync.ts` (`FollowerState`, `INITIAL_STATE`, `buildPayload`), `src/types.ts` (payload do `HOST_STATE` em `WsMessage`), `src/components/FollowerView.tsx` (faixa mínima acima das seções)
- Create: `src/hooks/useLiveSync.armed.test.ts`, `src/components/FollowerView.armed.test.tsx`

**Interfaces:**
- Produces (em `FollowerState` e no payload do `HOST_STATE`): `armed: { index: number; label: string; color: string; kind: 'proxima' | 'repete'; plays: number | 'infinite' } | null`, `countBeat: number | null`, `countTotal: number | null`. `INITIAL_STATE` com os três `null`. Host antigo (campos ausentes) vira `null`.
- Celular, ainda no visual atual (spec 9b; o redesenho é o Projeto 3): com `armed`, uma faixa "PRÓXIMA: <seção>" ou "REPETE: <seção>" na cor da seção e `countTotal` bolinhas acesas até `countBeat` (aproximado, a rede tem atraso). Comandos que já existem (`arm-jump`, `arm-loop`, `cancel-loop`) não mudam.
- [ ] **Step 1: Testes**: `buildPayload leva armed e a contagem`; `host antigo sem os campos não mostra a faixa`; `faixa mostra PRÓXIMA: Refrão e 2 de 4 bolinhas acesas`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useLiveSync.armed.test.ts src/components/FollowerView.armed.test.tsx > "$LOGS/t24.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveSync.ts src/types.ts src/components/FollowerView.tsx src/hooks/useLiveSync.armed.test.ts src/components/FollowerView.armed.test.tsx
git commit -m "feat(ao-vivo): celular ve o pulo armado e a contagem aproximada [Parte 2] [T24]"
```

---

### Tarefa 26: Motor: vozes, linha do tempo e pré-contagem no relógio do áudio

**Onda:** 7. **Depende de:** T25, T5, T7.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (`play`, `pause`, `getPlaybackPosition`, `stopAllNodes`, `playWithPrecount`, `cancelCountIn`, `addChannelToActiveSong`)
- Create: `src/hooks/useAudioEngine.voices.test.ts`

**Interfaces:**
- Consumes: `startVoice`, `stopVoices`, `Voice` (T7); `scheduleCount`, `ScheduledCount` (T7); `positionAt` (T5).
- Produces (internos que a T27 e a T28 usam, documentados num comentário no topo do bloco):
  - `voicesRef: Ref<Voice[]>` (uma voz por canal tocando), `timelineRef: Ref<TimelineSegment[]>`
  - `entryFor(ch: Channel, pitch: number, compensation: number | null): AudioNode` (worklet do canal, atraso de compensação ou panner: a regra que hoje está dentro do laço do `play`)
  - `countDestination(): AudioNode` (entrada do canal de click pelo papel, ou `graph.input('click')` sem canal de click)
  - `play(opts?: { precount?: boolean }): Promise<void>`; `playWithPrecount()` = `play({ precount: precountEnabled })`
  - Retorno do motor ganha `precountTimes: number[]` (tempo do contexto de cada bipe da pré-contagem em curso, `[]` fora dela)
- Regras: no `play`, o instante comum `when` continua vindo de `nextRenderQuantum` (v1.4.15), depois de todos os `await`; cada canal ganha uma voz (`startVoice`) na `entryFor`; `timelineRef = [{ ctxStart: when, songStart: offset }]`; `getPlaybackPosition` = `pausedAtRef` com play pendente, senão `positionAt(timelineRef, ctx.currentTime, timeStretch)`; `pause` grava a posição pela linha do tempo. **Pré-contagem**: `pulso = 60 / (song.bpm || 100)` (a T27 troca pela grade), `n = precountBeats`, bipes em `t0 + k * pulso` com rótulos 1..n em `countDestination()`, e as vozes começam em `t0 + n * pulso`, tudo agendado de uma vez (some o `setTimeout` que chamava o `play`); `isCountingIn` liga até o último bipe (timer só pra tela); `cancelCountIn` = `pause`, que cancela os bipes. **Canal adicionado tocando** (causa 9 do relatório do metrônomo): ganha uma voz já, na posição atual da linha do tempo, em vez de ficar mudo até o próximo play.
- [ ] **Step 1: Escrever `useAudioEngine.voices.test.ts`**:

```ts
it('uma voz por canal, todas no mesmo instante e no mesmo offset', ...)
it('pré-contagem a 120 BPM: bipes em t0, +0,5, +1, +1,5 no click e as vozes em t0 + 2', ...)
it('pausar na pré-contagem para os bipes e nenhuma voz começa', ...)
it('busca tocando troca as vozes sem passar de 1 por canal', ...)
it('tom +2: as vozes entram no worklet do canal e 10 buscas não criam worklet novo', ...)
it('click adicionado tocando entra na posição atual', ...)
it('posição antes do instante agendado é o offset (não volta)', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.voices.test.ts > "$LOGS/t26.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks > "$LOGS/t26b.log" 2>&1; echo $?` e `node scripts/verify-pitch/run.mjs S1 S2 SPREAD22 SEEKS RESTART LOOP LEVELS NAN METRONOMO > "$LOGS/t26c.log" 2>&1; echo $?` (nada pode piorar em relação à v1.4.15).
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.voices.test.ts
git commit -m "feat(motor): vozes com envelope, linha do tempo e pre-contagem no relogio do audio [Parte 2] [T26]"
```

**Linha pro FATOS:** pré-contagem no BPM da música, saindo pela saída do click; click gerado com a música tocando entra na hora.

---

### Tarefa 27: Motor: grade pela faixa de click e o click que falta

**Onda:** 8. **Depende de:** T26, T2, T3, T22, M7 (detector corrigido).

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (fim do `loadFiles`, `restoreSongs` e o pós-restauração; `saveStateToDB`; assinatura do hook)
- Create: `src/hooks/useAudioEngine.grid.test.ts`

**Interfaces:**
- Consumes: `analyzeClickTrack` (T3); `gridFromClick`, `gridFromBpm`, `withMeter`, `gridWarning`, `pulseSeconds` (T2); `toSavedSong` com grade (T22); `detectSongGrid`, `CONFIDENCE_CUT` (M1/M2); `pickTempoSources` (M5); `generateManualClickTrackFromSample` (com a compensação da M6) e `loadClickSelection`; `findClickChannel` (Parte 1).
- Produces: `useAudioEngine(userId?: string, opts?: { autoClick?: boolean; sectionGates?: StageGates })` (a T28 usa `sectionGates`); retorno ganha `songGrid: SongGrid | null`, `gridWarning: GridWarning | null`, `setSongMeter(songId: string, sig: TimeSignature, countEvery: 1 | 3): void`, `redetectSongGrid(songId: string): Promise<void>`, `isReadingGrid: boolean`; `loadFiles` aceita `meta.timeSignature`.
- Regras da grade (Arquitetura B), por música, guardada em `Song.grid` e no repertório:
  1. Grade com `meterSource 'manual'` salva: fica (o usuário vence).
  2. Tem canal de click: `analyzeClickTrack(canal 0 do buffer do click, sampleRate)` e `gridFromClick(análise, song.timeSignature)`. Análise `null`: cai no passo 4.
  3. Sem click e `autoClick`: `pickTempoSources` + `detectSongGrid` (com `nearBpm` = BPM da música e o compasso salvo); só com `confidence >= CONFIDENCE_CUT` gera o click (`generateManualClickTrackFromSample` com a seleção salva, acento no 1), grava como canal novo "Click gerado" (arquivo por stem, como o `addChannelToActiveSong`) e lê a grade DELE pelo passo 2. Abaixo do corte: não gera.
  4. `gridFromBpm(song.bpm, song.timeSignature)` (pode ser `null`).
  - Uma grade já salva de outra fonte não é recalculada ao reabrir; `redetectSongGrid` recalcula ignorando a salva (menos a manual, que só muda pelo `setSongMeter`).
  - Músicas restauradas sem click: geradas em segundo plano depois da restauração, uma por vez, pulando a música ativa enquanto toca (tenta de novo quando parar).
  - A pré-contagem da T26 passa a usar `pulseSeconds(grid)` quando há grade.
- [ ] **Step 1: Escrever `useAudioEngine.grid.test.ts`** (buffers sintéticos com o gerador da T3; gerador de click e detector mockados no caso 3):

```ts
it('click 3/4 com acento: grade lida do click, salva no repertório', ...)
it('compasso da nuvem 6/8 vence o acento lido', ...)
it('compasso escolhido no EDITAR sobrevive a reabrir o app', ...)
it('sem click e sem autoClick: grade do BPM salvo e aviso SEM CLICK LIDO', ...)
it('sem click, com autoClick e confiança boa: gera "Click gerado" e lê a grade dele', ...)
it('sem click, com autoClick e confiança baixa: não gera nada', ...)
it('música restaurada sem click é gerada em segundo plano, nunca a que está tocando', ...)
it('pré-contagem usa o pulso da grade', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.grid.test.ts > "$LOGS/t27.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar** (todo caminho com `setIsLoading(true)` em `try/finally`; o trabalho pesado roda depois do decode, fora do instante de tocar).
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks src/lib > "$LOGS/t27b.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.grid.test.ts
git commit -m "feat(motor): grade de cada musica lida na faixa de click e click que falta [Parte 2] [T27]"
```

**Linha pro FATOS:** BPM com decimais e compasso de cada música lidos na faixa de click; sem click, o app gera um (planos pagos) quando tem certeza do tempo; avisos em âmbar quando a grade é aproximada.

---

### Tarefa 28: Motor: pulo agendado, REPETIR, LOOP e o modo antigo

**Onda:** 9. **Depende de:** T27, T17, T4, T5.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (laço `updateTime`, `armLoop`, `cancelLoop`, `armJump`, `cancelJump`, `seekTo`, `pause`, `jumpToSong`, `nextSong`, `prevSong`, `executeNextSong`, `changePitch`, reinício da troca de papel, retorno do hook)
- Create: `src/hooks/useAudioEngine.transition.test.ts`

**Interfaces:**
- Consumes: `SectionScheduler` e constantes (T17); `createSchedulerClock` (T5); `tapSection`, `stepSection`, `armAt`, `armRepeat`, `toggleLoop`, `armLabel` (T4); `sectionSpans`, `sectionIndexAt` (T2); `startVoicesForSwitch` (T7); `settings.stageVersion` (T25).
- Produces (retorno do motor):

```ts
sectionIntent: ArmIntent | null
transitionView: TransitionView | null
landed: { index: number; at: number } | null
armSection(i: number): { upgrade: boolean }
stepSection(dir: -1 | 1): { upgrade: boolean }
armRepeat(plays: Plays): { upgrade: boolean }
toggleSectionLoop(): { upgrade: boolean }
armSectionAt(i: number, plays: Plays): { upgrade: boolean } // banda pelo celular
cancelArm(): void
heardNow(): number      // ctx.currentTime - outputLatency - latência da entrada, pra tela
heardPosition(): number // posição da música no tempo ouvido (positionAt no heardNow), pra tela
// continuam, como adaptadores do palco antigo e do Ao Vivo: armJump(i), armLoop(i, n | 'infinite'), cancelJump(), cancelLoop(), pendingJump, activeLoop
```

- Regras: com `stageVersion 'novo'`, o `SectionScheduler` cuida de pulo, REPETIR e LOOP; o relógio do Worker liga no play e desliga na pausa, e cada tique chama `scheduler.tick()` e a checagem de fim de música (que sai do rAF e fica idempotente). `pause`, `seekTo`, troca de música e todo reinício do `play` (tom cruzando o 0, troca de papel) chamam `scheduler.reset()` antes e `scheduler.tick()` depois. Parado, `armSection` e `stepSection` levam ao início da seção (`seekTo`) e desarmam. Com intenção armada, o FADE do fim da música não começa; se já começou, o principal volta a `masterVolume` em `T` (`setValueAtTime`). `pendingJump` e `activeLoop` são derivados da intenção pro palco antigo e pro Ao Vivo. `sectionGates` (opções do hook) decide `upgrade`. Com `stageVersion 'antigo'`, o caminho antigo do rAF (`loopRef`, `jumpRef`, `seekTo` no fim da seção) roda como na v1.4.15, sem contagem; trocar a chave tocando cancela as intenções dos dois caminhos sem parar o som.
- [ ] **Step 1: Escrever `useAudioEngine.transition.test.ts`** (fake de contexto com `currentTime` controlado, relógio do Worker falso):

```ts
it('tocando, armar a próxima agenda a contagem no canal de click e pousa no 1', ...)
it('sem canal de click a contagem vai pro barramento do click', ...)
it('REPETIR 2 conta e volta duas vezes e desarma', ...)
it('LOOP repete sem contagem até cancelar', ...)
it('pausar com pulo agendado não deixa voz nem bipe vivo', ...)
it('busca com pulo armado re-planeja a partir da posição nova', ...)
it('FADE não começa com pulo armado e o principal volta no instante do pulo', ...)
it('parado, tocar numa seção leva pro início dela e desarma', ...)
it('Livre pede upgrade e não arma', ...)
it('palco antigo: sem bipe, salto no fim da seção pelo caminho antigo', ...)
it('banda arma loop infinito pelo celular (armSectionAt com -1 vira infinito no adaptador armLoop)', ...)
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.transition.test.ts > "$LOGS/t28.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `./node_modules/.bin/vitest run src/hooks > "$LOGS/t28b.log" 2>&1; echo $?`.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.transition.test.ts
git commit -m "feat(motor): pulo de secao agendado com contagem no click e o modo antigo [Parte 2] [T28]"
```

**Linha pro FATOS:** troca de seção ao vivo: arma, conta 1-2-3-4 só no click e entra no 1 do compasso seguinte, sem parar a VS; REPETIR usa o mesmo caminho; a guia cala no último compasso.

---

### Tarefa 29: App: palco novo ligado com a chave

**Onda:** 10. **Depende de:** T18, T19, T23, T24, T28, M7.

**Files:**
- Modify: `src/App.tsx`, `src/components/SettingsModal.tsx` (aba Geral), `electron/main.ts` (`webPreferences`)
- Create: `src/components/stage/buildStageView.ts`, `src/components/stage/buildStageView.test.ts`, `src/appWiring.test.ts`

**Interfaces:**
- Consumes: tudo que o motor produz nas T25 a T28; `StageShell`, `useStageViewport` (T18); `AudioOutputsSection`, `StageVersionSetting` (T19); `buildChannelLabels`, `findClickChannel`, `isSilencedBySolo`, `pickWaveformChannel` (Parte 1); `computePeaks` (T9); `sectionSpans`, `sectionIndexAt`, `barSeconds`, `gridHasPhase` (T2); `armLabel` (T4); `canUseSections`, `canBandControlSections`, `canUseBpmDetection` (`plans.ts`).
- Produces:

```ts
export interface EngineStageState {
  song: Song | undefined; playlist: readonly Song[]; activeIndex: number; currentMarkerId: string | null
  isPlaying: boolean; isCountingIn: boolean; precountEnabled: boolean; precountBeats: number; precountTimes: number[]
  playbackMode: 'continue' | 'stop' | 'fade-out'; sectionIntent: ArmIntent | null; transitionView: TransitionView | null
  landed: StageView['landed']; songGrid: SongGrid | null; gridWarning: GridWarning | null; outputPlan: OutputPlan
  masterVolume: number; masterMuted: boolean
}
export function buildStageView(e: EngineStageState, ui: { plan: string | null; isAdmin: boolean; online: boolean; isDesktop: boolean; userName: string | null; hostActive: boolean; editMode: boolean; channelEditMode: boolean; padPanelOpen: boolean; activePad: string | null; repertoireName: string | null }): StageView
```

- Ligações no `App.tsx`:
  - `useAudioEngine(user?.id, { autoClick: canUseBpmDetection(userPlan), sectionGates })`.
  - `const useNewStage = settings.stageVersion === 'novo' && wide` (de `useStageViewport`); com ele, o `StageShell` toma o lugar do cabeçalho, da faixa do repertório e do conteúdo principal; modais, teleprompter, tour e Ao Vivo ficam fora e iguais. Sem ele, o layout de hoje inteiro.
  - O atalho de teclado antigo sai cedo com `if (useNewStage) return` (o palco novo tem o seu).
  - `StageActions` montadas a partir do motor: `tapSection` → `armSection`, `stepSection` → `stepSection`, `armRepeat`, `toggleLoop` → `toggleSectionLoop`; qualquer `{ upgrade: true }` abre o Planos; `toggleClick` → `toggleMute` do canal de `findClickChannel`; `openMetronome` → `setIsMetronomeModalOpen(true)`; `openLyrics` → teleprompter; `markSection`/`nudgeSection`/`removeSection` → `addSectionAt`/`nudgeSection`/`removeSection` (T16) + `setSongMarkers`; `setMeter` → `setSongMeter` e, com admin e `sourceId`, também `updateSong(sourceId, { time_signature })` + `updateCachedSongMeta`; `redetectMeter` → `redetectSongGrid`.
  - `StageClock`: `heardNow` e `heardPosition` do motor; `level(id)` lê o pico do `AnalyserNode` que o App já cria por canal; `masterLevels` = `getOutputLevels`.
  - Ondas: `computePeaks` do canal de `pickWaveformChannel`, memorizado por música.
  - Slots: REPERTÓRIOS (`RepertoirePanel` com `jumpToSong`, `setPlaylistOrder`, `removeSongFromPlaylist`, `clearSession`, exportar/importar e `repertoireNotes`), menu FAIXAS (o conteúdo de hoje), ferramentas do admin (o editor de marcadores de hoje, só no modo EDITAR e só admin), painel Editar canal da Parte 1; SAMPLES e LOOPS do painel de pads com o conteúdo de hoje.
  - `MetronomeModal` recebe `initialSignature` da grade da música.
  - `onDownload` da biblioteca passa `timeSignature: extra?.timeSignature` no `meta` do `loadFiles` (T23 e T27).
  - Ao Vivo do host: `armed`, `countBeat` e `countTotal` no `useLiveSync` (a contagem muda de estado só quando o número do bipe ouvido muda, e só com pulo agendado); comandos `arm-jump` → `armSectionAt(i, 1)`, `arm-loop` → `armSectionAt(i, value === -1 ? 'infinite' : value ?? 1)`, `cancel-loop` → `cancelArm`, mantendo `canBandControlSections`.
  - Tour: os 4 passos de `secoes` ganham o texto do palco novo quando ele está ligado ("Toque numa seção pra armar: ela termina, conta 1-2-3-4 no click e entra no 1. Teclas 1 a 9 armam, setas trocam de seção, Shift + setas andam 5 s.").
- `SettingsModal`, aba Geral: `StageVersionSetting` primeiro; `AudioOutputsSection` junto do seletor de saída; o interruptor do pan automático só aparece em "Tudo junto".
- `electron/main.ts`: `backgroundThrottling: false` em `webPreferences` (timers e rAF não param com a janela atrás do Holyrics ou do OBS).
- [ ] **Step 1: Testes**:

```ts
// buildStageView.test.ts
it('canais com rótulo, cor, papel e calado pelo solo', ...)
it('seções na cor do tipo, com compassos quando a grade tem fase', ...)
it('posição da música, anterior e A SEGUIR', ...)
it('portões do plano Livre e do Studio', ...)
it('click ligado = canal de click sem M; música sem click = channelId null', ...)
// appWiring.test.ts (texto do código, regex tolerante, como a Ruling 5 da Parte 1)
it('electron/main.ts liga backgroundThrottling: false', () => expect(main).toMatch(/backgroundThrottling\s*:\s*false/))
it('o atalho antigo sai cedo com o palco novo', () => expect(app).toMatch(/if\s*\(\s*useNewStage\s*\)\s*return/))
it('o App monta o StageShell', () => expect(app).toMatch(/<StageShell[\s>]/))
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `./node_modules/.bin/vitest run src/components/stage/buildStageView.test.ts src/appWiring.test.ts > "$LOGS/t29.log" 2>&1; echo $?`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais o portão completo (`vitest run`, os dois `tsc`, `DESKTOP=1 vite build`) e `node scripts/verify-layout/run.mjs` (o verificador segue passando com o palco ligado no App? ele usa a fixture; aqui só confirma que nada quebrou na casca).
- [ ] **Step 5: Conferir no app** (`npm run dev` e `npm run dev:desktop`): roteiro do QA do dono, itens 1 a 6, com uma música de 24 canais e outra sem click.
- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/SettingsModal.tsx electron/main.ts src/components/stage/buildStageView.ts src/components/stage/buildStageView.test.ts src/appWiring.test.ts
git commit -m "feat(palco): palco novo ligado no app com a chave pro palco antigo [Parte 2] [T29]"
```

**Linha pro FATOS:** palco novo (computador e tablet a partir de 1024x600): transporte central, onda grande com seções, botoeira, faixa do meio, mixer novo e pads escondidos; chave CONFIG > Geral > Palco (Novo | Antigo); repertório e Anotações no painel REPERTÓRIOS; MARCAR e EDITAR seções só no modo EDITAR.

---

### Tarefa 30: Harness: medir pulo, contagem, cancelamento, saídas e pré-contagem

**Onda:** 10. **Depende de:** T28.

**Files:**
- Modify: `scripts/verify-pitch/www/harness.jsx`, `scripts/verify-pitch/www/tap-worklet.js`, `scripts/verify-pitch/analyze.mjs`, `scripts/verify-pitch/run.mjs`, `scripts/verify-pitch/README.md`

- Medidor: o `tap` passa a medir, por janela de 10 ms e por saída, a energia (Goertzel) nas frequências pedidas em `processorOptions` (988, 1319, a do click de teste e 330 Hz da guia de teste). O principal é achado andando pelas ligações até o `destination` (com o roteador, a saída 1 é o ouvido e a 2 a VS em "separados").
- Música de teste: click com acento no 1 a 120 BPM, "Voz Guia" com seno contínuo de 330 Hz, instrumentos como hoje; marcas nas barras (0, 4, 8, 12, 16 s).
- Cenários novos (em `SCENARIOS` de `run.mjs`, com o critério em `analyze.mjs`):

| Cenário | O que faz | Passa quando |
|---|---|---|
| `JUMP` | toca de 5 s, arma a seção 0 em 6 s (fim da seção em 8 s) | 1º click depois do pulo a até 3 ms de `T` (mais a latência de saída); 4 bipes em `T-2`, `T-1,5`, `T-1`, `T-0,5` com até 3 ms; guia ao menos 40 dB abaixo entre `T-2+0,02` e `T-0,02` e de volta depois de `T+0,02`; no máximo 2 fontes por canal sempre e 1 por canal 100 ms depois de `T`; sem buraco de mais de 10 ms na VS em volta de `T` |
| `JUMP` com `pitch=2` | o mesmo transposto | mesmos critérios contados a partir de `T + latência do worklet`; nenhum worklet novo durante o pulo |
| `CANCEL` | arma, cancela depois do 2º bipe | nenhum bipe 5 ms depois do cancelamento; o click segue a linha do tempo original (sem pulo); guia de volta em até 15 ms |
| `SPLIT` | modo separado, normal e com o lado trocado | contagem, click e guia abaixo de -60 dB na saída da VS; instrumentos abaixo de -60 dB na saída do ouvido; pico da VS mono no máximo 0,1 dB acima do maior pico L/R da mesma música em "Tudo junto" |
| `PRECOUNT` | play com pré-contagem de 4 a 120 BPM | 4 bipes a 0,5 s um do outro (até 2 ms) só no ouvido; 1º click da música no 5º tempo (até 3 ms) |
| `LOOP` (o de hoje) | passa a usar `toggleSectionLoop` | emenda do click a até 3 ms |

- [ ] **Step 1: Escrever os cenários e critérios** (os que existem continuam e passam igual).
- [ ] **Step 2: Rodar contra o commit anterior à T28 e ver falhar.** Run: `node scripts/verify-pitch/run.mjs JUMP CANCEL PRECOUNT --rev <commit da T27> > "$LOGS/t30-antes.log" 2>&1; echo $?`. Expected: `1` (não existe pulo agendado).
- [ ] **Step 3: Rodar no código atual.** Run: `node scripts/verify-pitch/run.mjs > "$LOGS/t30.log" 2>&1; echo $?`. Expected: `0`. Se um critério falhar por erro do motor, parar e avisar o coordenador (a correção é no motor, numa rodada da T28, não aqui).
- [ ] **Step 4: Commit**

```bash
git add scripts/verify-pitch/www/harness.jsx scripts/verify-pitch/www/tap-worklet.js scripts/verify-pitch/analyze.mjs scripts/verify-pitch/run.mjs scripts/verify-pitch/README.md
git commit -m "test(audio): harness mede pulo no 1, contagem so no click, cancelamento, saidas e pre-contagem [Parte 2] [T30]"
```

---

### Tarefa 31: Documentação viva

**Onda:** 11. **Depende de:** todas.

**Files:**
- Modify: `PLAYBACK_STUDIO_FATOS.md` (seção 4 Stack: Worker do agendador, harness e verificadores; seção 5 Telas e features; seção 6 Histórico com a entrada da Parte 2, NÃO publicado), `DESIGN_SYSTEM.md` (peças do palco em `src/components/stage/`, regras de tempo ouvido, fader só arrastando, exceção M/S, avisos âmbar da grade)

- [ ] **Step 1: Consolidar no FATOS** as "Linhas pro FATOS" de todas as tarefas (o coordenador já aplicou uma a uma nos portões; aqui junta e revisa), as 13 decisões deste plano (marcando o que o dono conferiu), os limites conhecidos (Safari/iPad e Firefox só com a saída do sistema e 2 canais; Windows com placa multicanal como vários aparelhos estéreo; sem ASIO; pads e samples na saída padrão; contagem do celular aproximada; LOOP e ∞ sem contagem) e a ordem de lançamento (migration da T23 antes; web + desktop juntos; Parte 1 já publicada antes).
- [ ] **Step 2: DESIGN_SYSTEM** com as peças novas e as regras acima.
- [ ] **Step 3: Conferir sem travessão.** Run: `git diff -U0 PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md | grep '^+' | grep -c "$(printf '\342\200\224')"` (os bytes do caractere em octal, sem escrevê-lo). Expected: nenhuma linha nova com o caractere.
- [ ] **Step 4: Commit**

```bash
git add PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
git commit -m "docs(fatos): Parte 2 do palco novo, metronomo automatico e saidas separadas (nao publicado) [Parte 2] [T31]"
```

---

## QA do dono (depois da Onda 10, antes de qualquer lançamento)

1. Música de 24 canais, tom 0 e tom +2: armar o Refrão no meio do Verso; a contagem só no fone (saída 1), a VS (saída 2) sem bipe; entra no 1 sem soluço. Repetir com o pan automático antigo desligado e "Tudo junto".
2. Cancelar no meio da contagem (X do aviso, tocar de novo na seção, Esc): para na hora, a seção segue, a guia volta.
3. REPETIR 2x, LOOP e ∞; tocar em outra seção durante a contagem troca o alvo.
4. Música sem click (plano pago): o click gerado aparece; numa música difícil (sem bateria), não gera e mostra o aviso âmbar. Plano Livre: botoeira com o convite.
5. Focusrite de 2 canais: "Click e Guia separados" com os dois lados; trocar o aparelho com a música tocando; placa de 4 ou mais (se tiver) com o mapa.
6. Chave Palco: Antigo no meio de uma música: o som não para; o palco antigo funciona como na v1.4.16.
7. App atrás do Holyrics ou do OBS por 1 minuto com loop ∞ armado: o loop segue no tempo (desktop).
8. 1024x768 (iPad paisagem), 1280x800 e 1920x1080: nenhum texto cortado; M/S tocáveis; fader não pula com toque sem querer.
9. Celular no Modo Ao Vivo: vê "PRÓXIMA: <seção>" e as bolinhas.
10. Metrônomo: "Gerar click IA" em uma música sincopada, uma rápida (160 BPM ou mais) e uma 6/8; no Separador, o click sincronizado continua no lugar.
