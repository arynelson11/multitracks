# verify-pitch: verificação da troca de tom e do palco novo

Prova automatizada do hotfix da troca de tom (v1.4.10) e, desde a Parte 2 (T30),
do pulo de seção, da contagem, do cancelamento, das saídas e da pré-contagem do
palco novo. Não entra no app e não precisa de dependência nova: usa o `esbuild`
que já vem com o Vite e o Google Chrome instalado na máquina.

## Áudio no Chrome headless (hook real)

```bash
source ~/.nvm/nvm.sh && nvm use 24
node scripts/verify-pitch/run.mjs                 # todos os cenários, código atual
node scripts/verify-pitch/run.mjs S1 S2           # só alguns
node scripts/verify-pitch/run.mjs S1 --rev HEAD~1 # o mesmo teste no src/ de um commit (o "antes")
node scripts/verify-pitch/run.mjs SPLIT --rev b53a95c --tag v1415   # referência do SPLIT (v1.4.15), antes do SPLIT
```

Empacota o `src/hooks/useAudioEngine.ts` de verdade numa página sem a UI,
troca o pacote `signalsmith-stretch` por uma cópia que só conta chamadas do
`process()` (o DSP é o mesmo) e mede a saída do master: click no L, instrumento
transposto no R. Sai com código 1 se algum critério falhar. JSON em
`scripts/verify-pitch/results/`. Outro Chrome: `CHROME=/caminho/do/chrome`.

O hook é montado como o App monta o palco novo (T29): `stageMode: 'novo'`, os
`sectionGates` com tudo liberado e `autoClick`. O `LOOP_ANTIGO` monta com
`stageMode: 'antigo'` (o mecanismo da v1.4.16, que segue sendo o padrão do app
enquanto a chave de CONFIG > Geral > Palco nasce em Antigo). O `build.mjs`
entende o `?worker&inline` do Vite (o Worker da grade da T27 nasce por Blob URL,
como no app): sem isso o motor nunca leria a grade do click aqui.

| Cenário | O que faz |
|---|---|
| `S1` | 24 canais tocando: 0, +2, 0, +3, 0, +5, pausa |
| `S2` | trocas rápidas (80 ms): +2/0, +3/0/+3, 0 |
| `SPREAD` / `SPREAD22` | 1ª e última faixa com o mesmo click em L e R (8 ou 22 instrumentos): diferença de início entre faixas |
| `SEEKS` | 52 reinícios (seek) com 24 canais, no tom 0 e no +2: quantos separam as faixas |
| `LEVELS` | nível de faixa mono e estéreo (pan total e centro) no tom 0 e transposto, com controle do erro do vocoder |
| `RESTART` | buraco no reinício (seek tocando) no tom 0 e no +2 |
| `LOOP` | palco novo: LOOP da seção 1 da música de teste por `toggleSectionLoop`, 5 voltas no tom 0, troca pro +2 tocando (o pedido fica), 5 voltas no +2 e sai do loop |
| `LOOP_ANTIGO` | palco antigo (`armLoop`): loop de seção tocando, no tom 0 e no +2: buraco na emenda (descontado o atraso do rAF que detecta o fim da seção) e volta sem await |
| `STALL` | laço de `start()` travado 15 ms no meio (o motor de áudio passa do instante comum): o play descarta e reagenda todas as faixas juntas |
| `SEEKS_ANTIGO`, `RESTART_ANTIGO`, `SONGS_ANTIGO` | os mesmos `SEEKS`, `RESTART` e `SONGS` montados com `stageMode: 'antigo'` (revisão macro, frente 1 M9) |
| `SONGS` | repertório com 3 músicas: A (24 canais) +2, B (10) +3, C (30) +2, remove B com C tocando, A de volta (+2) e no tom 0. Fontes sem órfãs, worklets rodando = faixas transpostas da música atual, total de worklets <= maior música, sem salto de posição, som em todas as faixas |
| `PENDENTE` | play transposto pela 1ª vez e troca de música antes do worklet nascer (por jumpToSong, prevSong e nextSong): a música anterior não pode tocar |
| `NAN` | tom inválido (NaN) chegando no motor |
| `METRONOMO` | click "Metrônomo" (com acento) gravado depois dos stems, como o Separador faz |
| `METRONOME` | o mesmo com o click em inglês ("Metronome") |
| `JUMP` | palco novo, partes `tom0` e `tom2` (o mesmo transposto): toca da seção 1 (4 s), arma a seção 0 em 5,5 s; contagem no último compasso (6 a 8 s) e pulo no 1 de 8 s pra 0:00 |
| `CANCEL` | arma como no `JUMP` e cancela entre o 2º e o 3º bipe |
| `SPLIT` | partes `separados` ("Click e Guia separados"), `trocado` (o mesmo com o lado trocado) e `junto` ("Tudo junto"): nível de 2,75 a 10,75 s num play simples; no motor de agora, depois, pré-contagem e um pulo armado. Compara com a referência da v1.4.15 |
| `PRECOUNT` | partes `livre` e `trava`: play do 0:00 com pré-contagem de 4 a 120 BPM; na `trava`, a thread principal trava 15 ms no último `start()` de oscilador da contagem (o relógio passa do 1º bipe antes de o play conferir o relógio, como um aparelho ocupado) |

Critérios por item: worklets ativos (0 no tom 0, 1 por canal transposto), nenhum
duplicado, fontes sem órfãs, relógio de áudio em tempo real, posição contínua,
todas as faixas no mesmo instante, click x instrumento em ±2 ms, click/guia fora
do worklet, formantes só em voz, saída sem NaN e com som. No RESTART, LOOP, SEEKS
e STALL, a folga agendada é conferida exata (`when` na grade de blocos, 2 blocos
depois do relógio no `start()`; reagendado pela rede de segurança, 15 blocos a
48 kHz). Desde a v1.4.20 (Ruling I4-busca), com a voz velha ainda em ganho 1 (busca
ou volta do LOOP do palco antigo tocando), as vozes novas começam no máximo 6,4 ms
antes de ela começar a descer (a soltura começa na folga do corte, que cresce com o
`baseLatency`), no limite de bloco: o critério acha o começo da soltura pelo `stop()`
da voz velha (30 ms depois dele). O tempo de reação (da chamada até o som) no RESTART
e no LOOP aceita, na mediana, 1 bloco a mais por isso e outro porque ele é medido do
relógio na chamada, e o motor pode virar um bloco antes do fim da preparação das fontes.

## Palco novo (T30)

Música de teste (`song=palco` ou `song=limpo`, 24 s): click de 4500 Hz por tempo
a 120 BPM desde 0:00 com acento no 1 do 4/4 (0,8 contra 0,4; ataque e soltura em
cosseno, platô de 16 ms), "Voz Guia" com seno de 330 Hz a 0,5, instrumentos com
senos baixinhos longe das frequências medidas (o 1º, um seno de 2200 Hz a 0,03,
é a VS de nível constante), marcas nas barras (0, 4, 8, 12 e 16 s). No `palco` o
último instrumento é o trem de clicks de hoje alinhado nas barras (o início das
faixas, transpostas ou não, depois do pulo); no `limpo` é outro seno (a VS sem
respingo, pra medir o que vaza nela). A grade é a que o motor lê no click (T27):
120 BPM, 1 em 0,77 ms, 4/4 pelo acento, seções encaixadas na barra.

Medidor: o `tap` mede, a cada 1 ms e por saída, a amplitude pelo Goertzel com
janela de Hann de 10 ms em 330 (guia), 988 e 1319 (bipes da contagem), 4500
(click de teste) e 2200 Hz (VS), mais o RMS do passo. O início de um click ou
bipe é o cruzamento de 50% do platô, menos meia janela e meio ataque (exato pra
ataque linear ou em cosseno; numa simulação com a receita do bipe o erro ficou
abaixo de 0,04 ms). Cada pulo conferido vem do `transitionView` (T no relógio do
áudio, contagem planejada, latência da entrada do click), olhado a cada 5 ms,
com o pouso pelo `landed`. Tempos em tempo do contexto, como o tap vê: o que
passa pelo worklet ou pelo atraso da compensação sai L depois.

| Cenário | Passa quando |
|---|---|
| `JUMP` | o pulo cai no 1 do compasso (até 1 ms da linha do tempo do play); clicks de antes na linha do tempo (até 1 ms, confere o medidor); 1º click depois do pulo a até 3 ms de T (+ L no tom 2); 4 bipes em T-2, T-1,5, T-1 e T-0,5 (até 3 ms), 1319 Hz no 1; guia ao menos 40 dB abaixo de T-2+0,02 a T-0,02 e de volta (até 1 dB) depois de T+0,02; no máximo 2 fontes por canal e 1 por canal 100 ms depois de T; sem buraco de mais de 10 ms na VS (RMS 20 dB abaixo); instrumento junto do click antes do pulo (até 2 ms) e o 1º depois no 1 (até 3 ms); click depois do pulo com o nível do play simples (até 0,01 dB, Ruling T30-grade); no tom 2, nenhum worklet novo |
| `CANCEL` | os 2 primeiros bipes nos tempos; nenhum bipe 5 ms depois do cancelamento (abaixo de -50 dB até T+0,5); o click segue a linha do tempo original (até 3 ms, nenhum faltando); nenhuma voz do pulo soou; guia calada na contagem e de volta em até 15 ms (até 1 dB) |
| `SPLIT` | em "separados" e "trocado": click e guia abaixo de -60 dB na saída da VS, instrumentos abaixo de -60 dB na saída do ouvido, contagem (pré-contagem e pulo) no ouvido e abaixo de -60 dB na VS; nas três partes, nível de cada saída igual ao da v1.4.15 com até 0,1 dB (R-24): "separados" e "trocado" contra a v1.4.15 com o pan automático (o lado trocado espelhado), "junto" contra ela sem o pan automático; e o click depois da pré-contagem e depois do pulo com o nível do play simples (até 0,01 dB, Ruling T30-grade) |
| `PRECOUNT` | nas duas partes: 4 bipes a 0,5 s um do outro (até 2 ms), 1319 Hz no 1 (nenhum tique a mais: Ruling T30-reagenda); 1º click da música no 5º tempo (até 3 ms); bipes abaixo de -60 dB na VS |
| `LOOP` | em cada volta, no tom 0 e no +2 (pelo menos 3): último click da seção e 1º da volta a até 3 ms do esperado, a volta no fim da seção pela linha do tempo (até 1 ms), sem buraco na VS e no máximo 2 fontes por canal; nenhum bipe nas voltas |

Referência do `SPLIT`: `node scripts/verify-pitch/run.mjs SPLIT --rev b53a95c --tag v1415`
roda o mesmo áudio no motor da v1.4.15 (por isso o `SPLIT` só usa `loadFiles`,
`play` e `pause` na parte que compara) e grava `results/SPLIT-<parte>_v1415.json`;
as saídas vão gravadas no `localStorage` antes de montar o hook (a v1.4.15 só lê o
pan automático, ligado em "separados" e "trocado"). O `SPLIT` de agora compara com
esses arquivos e falha se eles faltarem. Os níveis são medidos num play simples,
como na v1.4.15.

Fonte que começa fora da grade de amostras (no instante ou no ponto da faixa) é
lida pelo Chrome com interpolação linear, que tira agudos. Antes da Ruling
T30-grade as vozes do pulo e a música da pré-contagem começavam assim: -0,113 dB
em 4500 Hz depois do pulo (a interpolação linear prevê -0,115 dB pela fração do T,
que o `JUMP` mostra no detalhe) e -0,083 dB depois da pré-contagem. Hoje começam
na amostra mais perto e o `JUMP` e o `SPLIT` conferem o nível (até 0,01 dB).

## Regras puras (Node)

```bash
node scripts/verify-pitch/unit.mjs
```

Transpila com o esbuild e testa as regras que o motor usa: Click e Guia fora do
tom (`isPitchExempt`) e formantes só em voz (`wantsFormantCompensation`, família
Vocal ou Backing) pela regra central de `src/lib/channelRoles.ts`, com o papel
manual e o nome dado pelo usuário; e, em `src/lib/pitchRules.ts`, tom em qualquer
grafia para semitons (bemol, minúscula, menor, solfejo; nunca NaN).
