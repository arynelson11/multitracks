# verify-pitch: verificação da troca de tom

Prova automatizada do hotfix da troca de tom (v1.4.10). Não entra no app e não
precisa de dependência nova: usa o `esbuild` que já vem com o Vite e o Google
Chrome instalado na máquina.

## Áudio no Chrome headless (hook real)

```bash
source ~/.nvm/nvm.sh && nvm use 24
node scripts/verify-pitch/run.mjs                 # todos os cenários, código atual
node scripts/verify-pitch/run.mjs S1 S2           # só alguns
node scripts/verify-pitch/run.mjs S1 --rev HEAD~1 # o mesmo teste no src/ de um commit (o "antes")
```

Empacota o `src/hooks/useAudioEngine.ts` de verdade numa página sem a UI,
troca o pacote `signalsmith-stretch` por uma cópia que só conta chamadas do
`process()` (o DSP é o mesmo) e mede a saída do master: click no L, instrumento
transposto no R. Sai com código 1 se algum critério falhar. JSON em
`scripts/verify-pitch/results/`. Outro Chrome: `CHROME=/caminho/do/chrome`.

| Cenário | O que faz |
|---|---|
| `S1` | 24 canais tocando: 0, +2, 0, +3, 0, +5, pausa |
| `S2` | trocas rápidas (80 ms): +2/0, +3/0/+3, 0 |
| `SPREAD` / `SPREAD22` | 1ª e última faixa com o mesmo click em L e R (8 ou 22 instrumentos): diferença de início entre faixas |
| `SEEKS` | 52 reinícios (seek) com 24 canais, no tom 0 e no +2: quantos separam as faixas |
| `LEVELS` | nível de faixa mono e estéreo (pan total e centro) no tom 0 e transposto, com controle do erro do vocoder |
| `RESTART` | buraco no reinício (seek tocando) no tom 0 e no +2 |
| `LOOP` | loop de seção tocando, no tom 0 e no +2: buraco na emenda (descontado o atraso do rAF que detecta o fim da seção) e volta sem await |
| `STALL` | laço de `start()` travado 15 ms no meio (o motor de áudio passa do instante comum): o play descarta e reagenda todas as faixas juntas |
| `SONGS` | repertório com 3 músicas: A (24 canais) +2, B (10) +3, C (30) +2, remove B com C tocando, A de volta (+2) e no tom 0. Fontes sem órfãs, worklets rodando = faixas transpostas da música atual, total de worklets <= maior música, sem salto de posição, som em todas as faixas |
| `PENDENTE` | play transposto pela 1ª vez e troca de música antes do worklet nascer (por jumpToSong, prevSong e nextSong): a música anterior não pode tocar |
| `NAN` | tom inválido (NaN) chegando no motor |
| `METRONOMO` | click "Metrônomo" (com acento) gravado depois dos stems, como o Separador faz |
| `METRONOME` | o mesmo com o click em inglês ("Metronome") |

Critérios por item: worklets ativos (0 no tom 0, 1 por canal transposto), nenhum
duplicado, fontes sem órfãs, relógio de áudio em tempo real, posição contínua,
todas as faixas no mesmo instante, click x instrumento em ±2 ms, click/guia fora
do worklet, formantes só em voz, saída sem NaN e com som.

## Regras puras (Node)

```bash
node scripts/verify-pitch/unit.mjs
```

Testa `src/lib/pitchRules.ts` (transpilado com o esbuild): reconhecimento de
click/guia por nome sem acento e sem caixa, decisão de formantes (só voz) e
tom em qualquer grafia para semitons (bemol, minúscula, menor; nunca NaN).
