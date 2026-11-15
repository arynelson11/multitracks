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
| `SPREAD` | 1ª e última faixa com o mesmo click em L e R: diferença de início entre faixas |
| `NAN` | tom inválido (NaN) chegando no motor |
| `METRONOMO` | click "Metrônomo" (com acento) gravado depois dos stems, como o Separador faz |

Critérios por item: worklets ativos (0 no tom 0, 1 por canal transposto), nenhum
duplicado, fontes sem órfãs, relógio de áudio em tempo real, posição contínua,
todas as faixas no mesmo instante, click x instrumento em ±2 ms, click/guia fora
do worklet, formantes só em voz, saída sem NaN e com som.

## Regras puras (Node)

```bash
node scripts/verify-pitch/unit.mjs
```

Testa `src/lib/pitchRules.ts` (transpilado com o esbuild): reconhecimento de
click/guia por nome sem acento e sem caixa e decisão de formantes (só voz).
