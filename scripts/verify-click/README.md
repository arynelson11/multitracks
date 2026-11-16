# verify-click: medição do metrônomo automático

Scripts da investigação do metrônomo automático (16/11/2026, v1.4.14). Rodam o
código REAL de `src/lib/beatGrid.ts` e `src/lib/AudioAnalyzer.ts` em Node puro,
com shims mínimos de Web Audio (`shims.mjs`), sem Chrome e sem dependência nova:
o `build.mjs` usa o `esbuild` que já vem com o Vite.

Os sintéticos e a sonda de click também existem em TypeScript pro Vitest
(`src/test/synthMusic.ts` e `src/test/clickProbe.ts`); os testes do detector de
tempo (`src/lib/beatGrid.equivalence.test.ts` e `src/lib/tempo/*.test.ts`) usam
esses. Estes scripts ficam pra medir de novo a tabela inteira do relatório.

## Rodar

```bash
source ~/.nvm/nvm.sh && nvm use 24
cd scripts/verify-click
node build.mjs harness.mjs && node dist/harness.mjs b,c1   # só alguns casos (ids em CASES)
node dist/harness.mjs all                                  # todos (demora; grava results.json)
node build.mjs downbeat.mjs && node dist/downbeat.mjs      # o "1" em 54 cenários 4/4
```

`node build.mjs <entrada.mjs>` empacota em `dist/<entrada>.mjs`. Saídas em
`results*.json` e `dist/` ficam fora do git.

| Script | O que mede |
|---|---|
| `harness.mjs` | pipeline do botão AUTO (escolha da faixa, grade, click gerado) contra a grade real, e o mesmo áudio na v1.4.9 |
| `samples.mjs` | atraso próprio de cada amostra de click (`node samples.mjs "../../public/Click Tracks"`, gera o `samples.json`) |
| `gridsweep.mjs` | erro do 1º tempo conforme onde o ataque cai no hop, e confiança de faixas sem pulso |
| `downbeat.mjs` | acento no 1 em 4/4 (onde a música começa, intro, virada) |
| `cointoss.mjs` | baixo em colcheias e shaker: tempo ou contratempo |
| `names.mjs` | qual faixa o AUTO escolhe pelo nome (não precisa de build) |
| `realdemo.mjs`, `stemsagree.mjs` | música real: as stems do demo |

## Arquivos que não vão pro git

- `v149/` (fontes da v1.4.9, usadas por `harness.mjs` e `realdemo.mjs`):

  ```bash
  mkdir -p v149
  git show 5e051c2:src/lib/AudioAnalyzer.ts > v149/AudioAnalyzer.ts
  git show 5e051c2:src/lib/clickLibrary.ts > v149/clickLibrary.ts
  git show 5e051c2:src/components/MetronomeModal.tsx > v149/MetronomeModal.tsx
  ```

- `demo-wav/` (stems do demo em WAV, usadas por `realdemo.mjs` e `stemsagree.mjs`):

  ```bash
  mkdir -p demo-wav
  for f in ../../public/demo/*.mp3; do ffmpeg -loglevel error -i "$f" "demo-wav/$(basename "$f" .mp3).wav"; done
  ```
