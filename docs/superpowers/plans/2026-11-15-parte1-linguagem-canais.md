# Parte 1: linguagem nova + canais organizados (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Entregar a base da linguagem visual nova (tokens `ps-*` e peças base) sem mudar a cara das telas atuais, e organizar os canais com uma regra central única: nome reconhecido, cor por família, ordem padrão, papel do canal (Click / Guia / Normal) e renomear no EDITAR CANAIS.

**Arquitetura:** Primeiro entram módulos novos, puros e testados: `src/lib/channelNames.ts` e `src/lib/channelRoles.ts` (a regra central), `src/lib/repertoireSchema.ts` (formato salvo do repertório, versão 2, com migração), `src/styles/ps-tokens.css` (tokens) e `src/components/ui/` (peças base). Depois, cada arquivo grande é ligado à regra central por um único agente por onda. O nome original do canal (`Channel.name`) nunca é sobrescrito: o nome organizado é calculado na exibição; nome do usuário, papel manual e ordem manual ficam só no repertório persistido do usuário.

**Stack:** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4.2 (`@theme`) + idb-keyval + Web Audio + Electron. Novos: Vitest 4 + jsdom + Testing Library (testes) e `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` (fontes empacotadas, funcionam offline no desktop).

**Spec:** `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (seções 5b, 5c, 5d e 9b). Visual: `.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` (bloco `<style>`, linhas 10 a 362, de onde saem os tokens).

## Global Constraints

- Tudo em português do Brasil. Nenhum travessão (caractere Unicode U+2014) em texto de interface, comentário novo, doc ou commit. Nos testes, procurar por ele com o escape `'\u2014'`.
- Nenhum texto encostando na borda ou cortado. Botões com largura que acompanha o texto (padding), nunca largura fixa com texto dentro.
- Alvos de toque de pelo menos 44px (a exceção M/S de ~36x32px é da Parte 2, não se aplica aqui).
- Código de cores com um significado só: laranja = ligado; branco = armado; cor da seção = seção; âmbar = alerta.
- Identidade: dark `#121214`, laranja `#FF6B35`, bone `#E8E8EC`, musgo `#5B6B47`. Seções: Intro `#3b82f6`, Verso `#10b981`, Pré `#f59e0b`, Refrão `#FF6B35`, Ponte `#8b5cf6`, Final `#ec4899`.
- Fontes Inter + JetBrains Mono, números de largura fixa (`tabular-nums`). Ícones em SVG (lucide-react ou SVG inline), nunca caractere que vira emoji no Mac.
- Tokens existentes não mudam na Parte 1 (ex.: `--color-primary: #d4a843` continua). Token novo só com prefixo `ps-`.
- Desktop roda de `file://`: nada de caminho absoluto `/` para asset (usar import do Vite ou `import.meta.env.BASE_URL`); API só via `apiUrl()`.
- Dados da música: a Parte 1 só mexe no que é do usuário (repertório persistido `SavedSong`/`SavedChannel` no IndexedDB, chave `mt_meta_playlist_<userId>`). Nunca no banco/nuvem (`songs`, `stems`, `api/*`) nem no índice compartilhado do cache offline (`src/lib/offlineCache.ts`).
- `Channel.name` guarda o nome original do arquivo e nunca é sobrescrito. O nome organizado é só exibição.
- Manual vence automático: nome do usuário, papel manual (em tudo: pan automático ouvido x PA, fora da troca de tom, "a música já tem click") e ordem manual.
- Canais com papel Click ou Guia continuam tocando quando outro canal está em Solo; o M deles continua funcionando normalmente (spec 9b).
- Desempenho: nenhum worklet ou nó de áudio novo por canal; o motor signalsmith só existe com tom diferente de 0 (regressão v1.3.10).
- Toda função async que faz `setIsLoading(true)` tem `try/finally`.
- Vocabulário de copy: "multitracks", "faixas", "separação de faixas" (não "stems").
- Branch `feat/palco-parte1-linguagem-canais`; commits convencionais; `git push`/tag só pelo @devops; nada vai pra produção sem o dono ver e aprovar; lançamento web + desktop juntos.
- Toolchain: Node 26 local trava `tsc`/`eslint`. Rodar tudo com Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`) e com a saída redirecionada para arquivo (repo dentro do iCloud).
- Sempre `git add <arquivo>` por nome. Nunca `git add -A` (o iCloud cria cópias " 2" e a memória dos agentes fica suja no working tree).

## Review Focus

1. **Repertório salvo antes da atualização** (sem os campos novos), reaberto offline e no desktop: nenhuma música, volume, mute, pan, marcador ou letra pode sumir. Teste na Tarefa 5 (`migrateSavedSong preserva um registro v1 real inteiro`).
2. **Nome de arquivo estranho** (acento, caixa mista, emoji, só número, vazio, só espaços): o rótulo nunca fica vazio nem lança erro. Teste na Tarefa 4 (linhas `'🎸 GTR'`, `'01'`, `''`, `'   '` da tabela de reconhecimento).
3. **Dois canais com o nome original idêntico** (ex.: dois `GTR_1`) e o usuário reordena ou renomeia um: os números ficam presos a cada canal, não à posição. Teste na Tarefa 4 (`numeração estável com nomes idênticos`).
4. **Trocar o papel de um canal com a música tocando e tom diferente de 0**: sem silêncio, sem worklet sobrando, mesma posição. A decisão está no helper puro testado na Tarefa 4 (`pitchChangeAction`); a passagem real pelo áudio é o item 4 do QA manual da Tarefa 13 (o único lugar com interface pra disparar).
5. **ZIP de repertório entre versões** (exportado pela versão antiga e importado na nova, e manifest novo com ordem manual): a ordem manual não pode virar automática. Teste na Tarefa 5 (`migrateSavedSong respeita channelOrder que já veio no manifest`).

---

## Pré-requisitos (antes da Onda 0)

- [ ] **P1. Isolar o trabalho do click sincronizado (decisão do dono).** As mudanças do click sincronizado no Separador precisam estar num commit próprio antes de criar a branch. Estado visto ao escrever este plano: já estão no commit local `af08e51` (`fix(separador): click sincronizado no compasso + upload no iPad`), no `main` local, ainda não enviado ao `origin`. O dono decide: (a) lançar `af08e51` antes pelo @devops, ou (b) deixar a Parte 1 sair junto com ele. Nenhum agente resolve isso sozinho.
- [ ] **P2. Criar a branch** a partir do `main` local que contém `af08e51`: `git switch -c feat/palco-parte1-linguagem-canais`. Os arquivos soltos (`.claude/agent-memory/aiox-devops/*`, `.claude/settings.local 2.json`, `image.png`) ficam fora de qualquer commit desta branch.
- [ ] **P3. Commit de docs** pra que agentes em worktree enxerguem o material: `git add docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md docs/superpowers/plans/2026-11-15-parte1-linguagem-canais.md .superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` e `git commit -m "docs: spec do palco ao vivo, mockup v5 e plano da Parte 1"`. (Se o dono preferir não versionar o mockup, os agentes leem pelo caminho absoluto do checkout principal.)
- [ ] **P4. Node 24:** `source ~/.nvm/nvm.sh && nvm use 24 && node -v` mostra `v24.x`.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.test.json`, `tsconfig.app.json`, `src/smoke.test.tsx` | Infra de testes e dependências novas | 1 |
| `src/types.ts` | `ChannelRole`, `ChannelOrderMode`, campos novos de `Channel` e `Song` | 1 |
| `src/styles/ps-tokens.css` (novo), `src/index.css` (1 linha), `src/main.tsx` (imports de fonte) | Tokens da linguagem nova e fontes | 2 |
| `src/components/ui/*` (novo) | Peças base: Button, Chip, Segmented, Panel, Led | 3 |
| `src/lib/channelNames.ts`, `src/lib/channelRoles.ts` (novos) | Regra central: reconhecimento, rótulo, cor, ordem, papel, solo, pan automático | 4 |
| `src/lib/repertoireSchema.ts` (novo) | Formato salvo do repertório v2, migração, manifest do ZIP | 5 |
| `src/hooks/useAudioEngine.ts` | Detectores e ganhos pela regra central (6); persistência e `setChannelMeta` (12) | 6, 12 |
| `src/components/MetronomeModal.tsx` | Faixa de análise pela regra central | 7 |
| `src/components/SeparatorStudio.tsx` | Achados por nome pela regra central | 8 |
| `src/components/SettingsModal.tsx` | Aba Buses com nome organizado | 9 |
| `src/components/ChannelEditPanel.tsx` (novo) | Painel "Editar canal": renomear + papel | 10 |
| `src/App.tsx` | Nomes/cores/onda/solo/ao vivo (11); EDITAR CANAIS abre o painel (13) | 11, 13 |
| `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md` | Documentação viva | 14 |

## Ondas, dependências e como rodar em paralelo

| Onda | Tarefas (arquivos disjuntos dentro da onda) | Depende de |
|---|---|---|
| 0 | T1 Fundação | P1 a P4 |
| 1 | T2 Tokens · T3 Peças base · T4 Regra central de canais · T5 Esquema do repertório | T1 |
| 2 | T6 Motor: detectores e solo · T7 Metrônomo · T8 Separador · T9 Configurações · T10 Painel Editar canal · T11 Palco: nomes e cores | T6, T7, T8, T9, T11: T4. T10: T3 e T4 (T2 pro visual) |
| 3 | T12 Motor: nome, papel e ordem guardados | T4, T5, T6 |
| 4 | T13 Palco: EDITAR CANAIS · T14 Documentação viva | T13: T10, T11, T12. T14: T2 a T12 |

**Regras de execução paralela:**
- Cada agente só toca os arquivos do bloco **Files** da sua tarefa. Se precisar de outro arquivo, para e avisa o coordenador.
- Pode ser checkout compartilhado (recomendado aqui, por causa do iCloud e do `node_modules`) ou worktree. Em worktree: criar fora do iCloud e rodar `npm ci` com Node 24 em cada uma.
- Commits pequenos, por nome de arquivo. Se aparecer `.git/index.lock`, esperar alguns segundos e repetir; nunca apagar o lock de outro agente em uso.
- Cada agente roda só os testes da própria tarefa. O `tsc` completo e o build são do **portão da onda**, rodado pelo coordenador quando todos os agentes da onda terminam.

**Portão de cada onda (coordenador):**

```bash
cd "/Users/macbookpro/Documents/Documentos - MacBook Pro de MacBook/multitracks-1"
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null
LOGS="$(mktemp -d)"
./node_modules/.bin/vitest run > "$LOGS/vitest.log" 2>&1; echo "vitest=$?"
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit > "$LOGS/tsc-app.log" 2>&1; echo "tsc-app=$?"
./node_modules/.bin/tsc -p tsconfig.test.json --noEmit > "$LOGS/tsc-test.log" 2>&1; echo "tsc-test=$?"
./node_modules/.bin/eslint <arquivos tocados na onda> > "$LOGS/eslint.log" 2>&1; echo "eslint=$?"
./node_modules/.bin/vite build > "$LOGS/build.log" 2>&1; echo "build=$?"
```

Esperado: todos `=0`. Se algum travar mais de 10 minutos com 0% de CPU, é o Node errado (conferir `node -v`).

## Decisões tomadas neste plano (o dono deve conferir)

1. Tokens novos com prefixo `ps-` num arquivo próprio, sem tocar nos antigos: as telas atuais ficam iguais até a Parte 3.
2. Fontes Inter e JetBrains Mono passam a vir empacotadas no app (hoje vêm do Google Fonts e somem no desktop offline). Só as peças novas usam as fontes empacotadas; o `font-sans` antigo continua igual.
3. Chip e seletor segmentado com alvo de 44px (o mockup tinha chip de 42px e segmento de 38px; a regra de 44px do spec venceu).
4. Reconhecimento por palavra inteira, não por pedaço (hoje `ag` acerta "stage" e `eg` acerta "legato").
5. Complemento só com palavras do dicionário (Base, Dedilhado, Solo, Ambiente, Reverso, Arpejo, Loop, FX, Dobra, L, R); palavra desconhecida sai do nome (`PIANO DELAY` vira `Piano`), pra nunca inventar nem mostrar lixo.
6. Número de instrumento repetido é refeito pelo app: `KEY 1_1`, `KEY 2_1` viram Teclado 1, Teclado 2 pela ordem natural do nome original (e não pela posição), então o número não muda ao arrastar.
7. Papel automático vem do nome original; se o original não for Click/Guia, olha o nome dado pelo usuário. Renomear o Click pra "Pulso" não tira o papel de Click.
8. Cores de família do mockup; as duas que o mockup não tinha: Ambiência `#818cf8` e não reconhecido `#9d9da8`.
9. Migração de repertório antigo: a ordem é considerada manual só quando dá pra provar (canais vindos do cache com `srcIdx` fora de ordem crescente); no resto vale a ordem padrão. Quem arrumou na mão uma música importada do computador vai ver a ordem padrão uma vez e pode arrastar de novo.
10. Nome e papel ficam no repertório do usuário (que é o que fica offline naquele aparelho/conta). Se a música for removida do repertório e baixada de novo da biblioteca, volta ao automático. Um cadastro por conta que sobreviva a isso pode entrar depois, se o dono quiser.
11. Nome personalizado com no máximo 24 caracteres; no mixer atual o nome quebra em até 2 linhas, sem caixa alta e sem o corte manual de 8 letras de hoje.
12. No Separador, as checagens por id interno (`metronome`, `click`, `voiceguide`) ficam; só os achados por nome passam pela regra central.
13. "A música já tem click" ganha o helper `findClickChannel` agora (testado), mas quem usa é a Parte 2.
14. Sem botão "voltar à ordem automática" nesta parte (o spec não pede).
15. Corrigido junto: `sourceId` passa a ser salvo no repertório (hoje se perde ao reabrir o app) e mudar volume ou desmutar com outro canal em Solo deixa de vazar som.

---

### Tarefa 1: Fundação: infra de testes, fontes e tipos de canal

**Onda:** 0. **Depende de:** P1 a P4.

**Files:**
- Modify: `package.json` (scripts e dependências), `package-lock.json` (só adições), `tsconfig.app.json` (adicionar `exclude`), `src/types.ts:1-40`
- Create: `vitest.config.ts`, `tsconfig.test.json`, `src/smoke.test.tsx`

**Interfaces:**
- Produces:
  - Em `src/types.ts`: `export type ChannelRole = 'click' | 'guide' | 'normal'`; `export type ChannelOrderMode = 'auto' | 'manual'`; `Channel` ganha `customName?: string` e `role?: ChannelRole`; `Song` ganha `channelOrder?: ChannelOrderMode`. Comentário em PT: `name` é o nome original do arquivo e nunca é sobrescrito; campo ausente quer dizer automático.
  - `npm test` = `vitest run`; `npm run typecheck` = `tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.test.json --noEmit`.
  - Convenção de teste: arquivos `src/**/*.test.ts(x)` ao lado do código; ambiente padrão `node`; teste de componente começa com `// @vitest-environment jsdom` e chama `afterEach(cleanup)`; imports explícitos de `vitest` (sem globals). Os testes ficam fora do `tsconfig.app.json` (o build de produção e o CI não mudam) e são checados pelo `tsconfig.test.json`.

- [ ] **Step 1: Instalar as dependências com Node 24**

```bash
cd "/Users/macbookpro/Documents/Documentos - MacBook Pro de MacBook/multitracks-1"
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null
npm install -D vitest@^4.1.12 jsdom@^26.1.0 @testing-library/react@^16.3.3 @testing-library/dom@^10
npm install @fontsource-variable/inter@^5.3.0 @fontsource-variable/jetbrains-mono@^5.3.0
```

- [ ] **Step 2: Conferir que o lockfile só ganhou pacotes (sem drift)**

```bash
LOGS="$(mktemp -d)"; git show HEAD:package-lock.json > "$LOGS/lock-head.json"
node -e 'const a=require(process.argv[1]).packages,b=require(process.cwd()+"/package-lock.json").packages;console.log(JSON.stringify({moved:Object.keys(a).filter(k=>b[k]&&a[k].version!==b[k].version),gone:Object.keys(a).filter(k=>!b[k])}))' "$LOGS/lock-head.json"
npm ci --dry-run > "$LOGS/ci-dry.log" 2>&1; echo "ci-dry=$?"
```

Esperado: `{"moved":[],"gone":[]}` e `ci-dry=0`. Se `moved` ou `gone` vier com algo, parar e avisar o coordenador (não commitar drift).

- [ ] **Step 3: Escrever o teste de fumaça `src/smoke.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(cleanup)

describe('infra de testes', () => {
  it('renderiza React no jsdom', () => {
    render(<p>pronto pro domingo</p>)
    expect(screen.getByText('pronto pro domingo')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test > "$LOGS/t1.log" 2>&1; echo $?; tail -5 "$LOGS/t1.log"`
Expected: código diferente de 0 com `Missing script: "test"`.

- [ ] **Step 5: Criar a configuração**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true },
})
```

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
    "types": ["vite/client", "node"]
  },
  "include": ["src"],
  "exclude": []
}
```

Em `tsconfig.app.json`, adicionar `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]`. Em `package.json`, scripts `"test": "vitest run"` e `"typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.test.json --noEmit"`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test > "$LOGS/t1.log" 2>&1; echo $?`
Expected: `0`, 1 teste passando.

- [ ] **Step 7: Adicionar os tipos em `src/types.ts`** (conforme o bloco Interfaces).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck > "$LOGS/tc.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.test.json tsconfig.app.json src/smoke.test.tsx src/types.ts
git commit -m "test: infra de testes (Vitest), fontes empacotadas e tipos de papel e ordem do canal [Parte 1]"
```

---

### Tarefa 2: Tokens da linguagem nova (`ps-*`) e fontes empacotadas

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/styles/ps-tokens.css`, `src/styles/ps-tokens.test.ts`
- Modify: `src/index.css:1` (uma linha nova logo depois de `@import "tailwindcss";`), `src/main.tsx:1-3` (imports das fontes antes de `./index.css`)

**Interfaces:**
- Produces (utilities do Tailwind que as Tarefas 3, 10 e as Partes 2 e 3 usam):
  - Cores: `bg-ps-<cor>`, `text-ps-<cor>`, `inset-ring-ps-<cor>` para cada cor da tabela abaixo.
  - `rounded-ps-{xs,sm,md,lg,xl,2xl,pill}`; `text-ps-{micro,label,sm,base,md,lg}`; `px-ps-gutter`, `gap-ps-gap`, `px-ps-pad-x`, `min-h-ps-touch`, `min-w-ps-touch`; `font-ps-sans`, `font-ps-mono`; `shadow-ps-pop`; `animate-ps-blink`.
  - Utilities próprias: `ps-num` (mono + `tabular-nums`) e `ps-label` (rótulo pequeno em caixa alta).

`src/styles/ps-tokens.css` tem um bloco `@theme static { ... }` (o `static` garante que as variáveis existam mesmo quando só usadas via `var()` em style inline) com exatamente estes valores, extraídos do mockup v5:

| Grupo | Token | Valor |
|---|---|---|
| Fundo e superfícies `--color-ps-*` | `ink` / `ink-0` / `s1` / `s2` / `s3` | `#121214` / `#0b0b0d` / `#17171a` / `#1f1f23` / `#2b2b31` |
| | `raised` / `pop` / `well` | `#1b1b1f` / `#1d1d22` / `#151518` |
| Linhas | `line` / `line-2` / `line-3` | `rgba(255,255,255,.07)` / `rgba(255,255,255,.15)` / `rgba(255,255,255,.28)` |
| Texto | `bone` / `mut` / `dim` | `#E8E8EC` / `#9d9da8` / `#686872` |
| Laranja (ligado) | `or` / `or-soft` / `or-line` / `on-or` | `#FF6B35` / `rgba(255,107,53,.12)` / `rgba(255,107,53,.55)` / `#1a0b04` |
| Musgo | `moss` / `moss-hi` | `#5B6B47` / `#a9c47f` |
| Armado e alerta | `arm` / `alert` / `alert-soft` / `alert-line` | `#F5F5F7` / `#fbbf24` / `rgba(251,191,36,.12)` / `rgba(251,191,36,.5)` |
| Mixer | `mute` / `solo` | `#ef4444` / `#facc15` |
| Seções | `sec-intro` / `sec-verso` / `sec-pre` / `sec-refrao` / `sec-ponte` / `sec-final` | `#3b82f6` / `#10b981` / `#f59e0b` / `#FF6B35` / `#8b5cf6` / `#ec4899` |
| Raios `--radius-ps-*` | `xs` / `sm` / `md` / `lg` / `xl` / `2xl` / `pill` | `6px` / `8px` / `10px` / `12px` / `14px` / `16px` / `999px` |
| Espaços `--spacing-ps-*` | `gutter` / `gap` / `pad-x` / `touch` | `16px` / `8px` / `12px` / `44px` |
| Texto `--text-ps-*` | `micro` / `label` / `sm` / `base` / `md` / `lg` | `10px` / `10.5px` / `11px` / `13px` / `16px` / `21px` |
| Fontes | `--font-ps-sans` | `'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif` |
| | `--font-ps-mono` | `'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace` |
| Sombra | `--shadow-ps-pop` | `0 20px 50px rgba(0,0,0,.65)` |
| Animação | `--animate-ps-blink` | `ps-blink 1.4s ease-in-out infinite` (com `@keyframes ps-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }` dentro do `@theme`) |

Fora do `@theme`: `@utility ps-num { font-family: var(--font-ps-mono); font-variant-numeric: tabular-nums; }` e `@utility ps-label { font-size: var(--text-ps-label); font-weight: 700; letter-spacing: .14em; color: var(--color-ps-mut); text-transform: uppercase; white-space: nowrap; }`.

- [ ] **Step 1: Escrever o teste `src/styles/ps-tokens.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const vars = (css: string) =>
  Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))

// Cópia literal das 38 declarações do bloco @theme de src/index.css em HEAD (bloco das linhas 14 a 70).
const LEGACY: Record<string, string> = {
  '--color-laranja': '#FF6B35',
  '--color-primary': '#d4a843',
  '--color-background': '#121214',
  '--font-sans': "'Inter', system-ui, -apple-system, sans-serif",
  // ... as outras 34 declarações, copiadas do arquivo
}
const NEW: Record<string, string> = {
  '--color-ps-ink': '#121214',
  '--color-ps-or': '#FF6B35',
  '--color-ps-arm': '#F5F5F7',
  '--radius-ps-lg': '12px',
  '--spacing-ps-touch': '44px',
  // ... todas as linhas da tabela de tokens desta tarefa
}

describe('tokens da linguagem nova', () => {
  it('tokens antigos continuam idênticos (as telas da Parte 3 não mudam)', () => {
    const v = vars(read('../index.css'))
    expect(Object.keys(LEGACY)).toHaveLength(38)
    for (const [k, val] of Object.entries(LEGACY)) expect(v[k]).toBe(val)
  })
  it('index.css não declara nenhum token ps- e importa ps-tokens logo depois do tailwind', () => {
    const css = read('../index.css')
    expect(css).not.toMatch(/--[\w-]*-ps-/)
    expect(css).toMatch(/@import "tailwindcss";\s*\n@import "\.\/styles\/ps-tokens\.css";/)
  })
  it('tokens novos com os valores do mockup v5, num @theme static', () => {
    const css = read('./ps-tokens.css')
    expect(css).toMatch(/@theme static\s*\{/)
    const v = vars(css)
    for (const [k, val] of Object.entries(NEW)) expect(v[k]).toBe(val)
    expect(css).toMatch(/@utility ps-num/)
    expect(css).toMatch(/@utility ps-label/)
    expect(css).not.toContain('\u2014')
  })
  it('main.tsx carrega as fontes empacotadas antes do index.css', () => {
    const main = read('../main.tsx')
    const iInter = main.indexOf('@fontsource-variable/inter')
    const iMono = main.indexOf('@fontsource-variable/jetbrains-mono')
    const iCss = main.indexOf("'./index.css'")
    expect(iInter).toBeGreaterThan(-1)
    expect(iMono).toBeGreaterThan(-1)
    expect(Math.max(iInter, iMono)).toBeLessThan(iCss)
  })
})
```

O implementador completa `LEGACY` com as 38 declarações reais e `NEW` com todas as linhas da tabela (nada de amostra).

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/styles/ps-tokens.test.ts > "$LOGS/t2.log" 2>&1; echo $?`
Expected: diferente de 0 (`ps-tokens.css` não existe).

- [ ] **Step 3: Criar `src/styles/ps-tokens.css`, a linha de import em `src/index.css` e os imports de fonte em `src/main.tsx`**

Nas fontes, importar o CSS do pacote que registra só latin e latin-ext no peso variável normal (conferir com `ls node_modules/@fontsource-variable/inter/*.css`); se o pacote não tiver arquivo por subset, usar `import '@fontsource-variable/inter'` e `import '@fontsource-variable/jetbrains-mono'`. Não mexer no `<link>` do Google Fonts em `index.html`.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/styles/ps-tokens.test.ts > "$LOGS/t2.log" 2>&1; echo $?`
Expected: `0`, 4 testes passando.

- [ ] **Step 5: Conferir as fontes no build do desktop (file://)**

Run: `DESKTOP=1 ./node_modules/.bin/vite build > "$LOGS/build-desktop.log" 2>&1; echo $?; grep -ho 'url([^)]*\.woff2)' dist/assets/*.css | head -3`
Expected: `0` e URLs começando com `url(./` (nunca `url(/`).

- [ ] **Step 6: Conferir que nada mudou na tela** com `npm run dev`: palco, Separador, Biblioteca e Configurações com a mesma aparência de antes.

- [ ] **Step 7: Commit**

```bash
git add src/styles/ps-tokens.css src/styles/ps-tokens.test.ts src/index.css src/main.tsx
git commit -m "feat(ui): tokens ps-* da linguagem nova e fontes empacotadas [Parte 1]"
```

---

### Tarefa 3: Peças base (Button, Chip, Segmented, Panel, Led)

**Onda:** 1. **Depende de:** T1 (os nomes das classes vêm da T2; os testes não precisam do CSS).

**Files:**
- Create: `src/components/ui/cx.ts`, `src/components/ui/Button.tsx`, `src/components/ui/Chip.tsx`, `src/components/ui/Segmented.tsx`, `src/components/ui/Panel.tsx`, `src/components/ui/Led.tsx`, `src/components/ui/index.ts`
- Test: `src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces (export pelo barril `src/components/ui/index.ts`):
  - `cx(...parts: Array<string | false | null | undefined>): string`
  - `type ButtonTone = 'default' | 'on' | 'armed' | 'alert' | 'primary' | 'ghost'`; `Button(props: ButtonProps)` com `ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { tone?: ButtonTone; size?: 'md' | 'lg'; pressed?: boolean; icon?: React.ReactNode }`. `type` padrão `"button"`; `pressed` vira `aria-pressed`; `icon` sai antes do texto dentro de `<span aria-hidden="true">`; `className` é somado no fim.
  - `Chip(props: ChipProps)` com `ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { on?: boolean; small?: boolean }`.
  - `Segmented<T extends string>(props: { options: { value: T; label: string; disabled?: boolean }[]; value: T | null; onChange: (value: T) => void; 'aria-label': string; className?: string })`.
  - `Panel(props: React.HTMLAttributes<HTMLDivElement> & { variant?: 'flat' | 'raised' | 'pop' })` (sem padding próprio; quem usa passa).
  - `type LedState = 'off' | 'on' | 'live' | 'alert' | 'armed'`; `Led(props: { state: LedState; size?: 'sm' | 'md'; label?: string; className?: string })`.

Classes fixas (strings literais no código, nunca montadas por interpolação, pro Tailwind enxergar):

| Peça | Base | Variações |
|---|---|---|
| Button | `inline-flex items-center justify-center gap-2 w-auto min-w-ps-touch min-h-ps-touch px-ps-pad-x rounded-ps-lg font-ps-sans text-ps-sm font-bold tracking-[0.1em] whitespace-nowrap select-none transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none` | default `bg-ps-s1 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2`; on `bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line`; armed `bg-ps-s1 text-ps-arm inset-ring-2 inset-ring-ps-arm`; alert `bg-ps-alert-soft text-ps-alert inset-ring inset-ring-ps-alert-line`; primary `bg-ps-or text-ps-on-or`; ghost `bg-transparent text-ps-mut hover:text-ps-bone hover:bg-ps-s1`; size lg `min-h-14` |
| Chip | `inline-flex items-center justify-center gap-1.5 min-w-ps-touch min-h-ps-touch px-2.5 rounded-ps-md bg-ps-s2 text-ps-bone text-ps-base font-bold tabular-nums whitespace-nowrap inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2 active:scale-[0.96]` | on `bg-ps-or-soft text-ps-or inset-ring-ps-or-line`; small `text-ps-sm tracking-[0.08em] font-extrabold` |
| Segmented | contêiner `inline-flex p-[3px] gap-0.5 rounded-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line`; opção `min-w-[62px] min-h-ps-touch px-3 rounded-[9px] text-ps-sm font-extrabold tracking-[0.1em] text-ps-mut whitespace-nowrap hover:text-ps-bone` | selecionada `bg-ps-s3 text-ps-bone inset-ring inset-ring-ps-line-2` |
| Panel | `rounded-ps-2xl inset-ring` | flat `bg-ps-s1 inset-ring-ps-line`; raised `bg-ps-raised inset-ring-ps-line`; pop `bg-ps-pop rounded-ps-xl inset-ring-ps-line-2 shadow-ps-pop` |
| Led | `inline-block shrink-0 rounded-full` | sm `size-1.5`, md `size-2`; off `bg-ps-s3`; on `bg-ps-or shadow-[0_0_8px_var(--color-ps-or)]`; live `bg-ps-moss-hi shadow-[0_0_8px_var(--color-ps-moss-hi)] animate-ps-blink motion-reduce:animate-none`; alert `bg-ps-alert shadow-[0_0_8px_var(--color-ps-alert)] animate-ps-blink motion-reduce:animate-none`; armed `bg-ps-arm shadow-[0_0_8px_rgba(255,255,255,0.55)]` |

Segmented: `role="radiogroup"` com o `aria-label`; cada opção é `<button type="button" role="radio" aria-checked>`; tabindex itinerante (a selecionada tem `tabIndex=0`, as outras `-1`; sem seleção, a primeira habilitada fica com 0); setas direita/baixo vão pra próxima habilitada com volta, esquerda/cima pra anterior, Home/End pra primeira/última, e cada movimento chama `onChange` e põe o foco na opção. Led sem `label` tem `aria-hidden="true"`; com `label`, `role="img"` e `aria-label`.

- [ ] **Step 1: Escrever o teste `src/components/ui/ui.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button, Chip, Led, Panel, Segmented } from './index'

afterEach(cleanup)
const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$))/

describe('Button', () => {
  it('largura acompanha o texto: sem w- fixo, com padding e alvo de 44px', () => {
    render(<Button>Salvar</Button>)
    const b = screen.getByRole('button', { name: 'Salvar' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).not.toMatch(FIXED_WIDTH)
    for (const c of ['px-ps-pad-x', 'min-h-ps-touch', 'min-w-ps-touch', 'whitespace-nowrap']) expect(b.className).toContain(c)
  })
  it('código de cores: on laranja, armed branco, alert âmbar', () => {
    render(<><Button tone="on">A</Button><Button tone="armed">B</Button><Button tone="alert">C</Button></>)
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('text-ps-or')
    expect(screen.getByRole('button', { name: 'B' }).className).toContain('inset-ring-ps-arm')
    expect(screen.getByRole('button', { name: 'C' }).className).toContain('text-ps-alert')
  })
  it('pressed vira aria-pressed; clique dispara; disabled não dispara', () => {
    const onClick = vi.fn()
    render(<><Button pressed onClick={onClick}>Loop</Button><Button disabled onClick={onClick}>Off</Button></>)
    const loop = screen.getByRole('button', { name: 'Loop' })
    expect(loop.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(loop)
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('só ícone exige aria-label e o ícone fica escondido do leitor de tela', () => {
    render(<Button icon={<svg data-testid="i" />} aria-label="Editar canal" />)
    expect(screen.getByRole('button', { name: 'Editar canal' })).toBeTruthy()
    expect(screen.getByTestId('i').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Chip', () => {
  it('alvo de 44px, números tabulares, on laranja', () => {
    render(<Chip on>+1</Chip>)
    const c = screen.getByRole('button', { name: '+1' })
    expect(c.className).not.toMatch(FIXED_WIDTH)
    for (const k of ['min-h-ps-touch', 'tabular-nums', 'text-ps-or']) expect(c.className).toContain(k)
  })
})

describe('Segmented', () => {
  const opts = [{ value: 'click', label: 'Click' }, { value: 'guide', label: 'Guia' }, { value: 'normal', label: 'Normal' }] as const
  it('radiogroup com rótulo, opção atual marcada e sem largura fixa', () => {
    render(<Segmented aria-label="Papel do canal" options={[...opts]} value="guide" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Papel do canal' })).toBeTruthy()
    const guia = screen.getByRole('radio', { name: 'Guia' })
    expect(guia.getAttribute('aria-checked')).toBe('true')
    expect(guia.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'Click' }).tabIndex).toBe(-1)
    expect(guia.className).not.toMatch(FIXED_WIDTH)
    expect(guia.className).toContain('min-w-[62px]')
  })
  it('clique e setas chamam onChange (com volta), Home e End', () => {
    const onChange = vi.fn()
    render(<Segmented aria-label="Papel" options={[...opts]} value="normal" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Click' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'End' })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['click', 'click', 'click', 'normal'])
  })
})

describe('Panel e Led', () => {
  it('Panel pop usa a superfície pop com sombra', () => {
    render(<Panel variant="pop" data-testid="p" />)
    const p = screen.getByTestId('p')
    for (const k of ['bg-ps-pop', 'shadow-ps-pop', 'inset-ring-ps-line-2']) expect(p.className).toContain(k)
  })
  it('Led: decorativo sem label; com label vira img; live pisca e respeita movimento reduzido', () => {
    const { container } = render(<><Led state="on" /><Led state="live" label="Ao vivo" /></>)
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain('bg-ps-or')
    const live = screen.getByRole('img', { name: 'Ao vivo' })
    expect(live.className).toContain('animate-ps-blink')
    expect(live.className).toContain('motion-reduce:animate-none')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/components/ui > "$LOGS/t3.log" 2>&1; echo $?`
Expected: diferente de 0 (`./index` não existe).

- [ ] **Step 3: Implementar as peças** conforme a tabela de classes e o bloco Interfaces.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/components/ui > "$LOGS/t3.log" 2>&1; echo $?`
Expected: `0`, 9 testes passando.

- [ ] **Step 5: Lint dos arquivos novos**

Run: `./node_modules/.bin/eslint src/components/ui > "$LOGS/t3-lint.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui
git commit -m "feat(ui): pecas base Button, Chip, Segmented, Panel e Led [Parte 1]"
```

---

### Tarefa 4: Regra central de canais (nome, cor, ordem, papel, solo, pan automático)

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/channelNames.ts`, `src/lib/channelRoles.ts`
- Test: `src/lib/channelNames.test.ts`, `src/lib/channelRoles.test.ts`

**Interfaces:**
- Consumes: `ChannelRole`, `ChannelOrderMode` de `src/types.ts` (T1).
- Produces em `src/lib/channelNames.ts`:
  - `type ChannelFamily = 'click' | 'guia' | 'bateria' | 'percussao' | 'baixo' | 'synthBass' | 'violao' | 'guitarra' | 'teclado' | 'piano' | 'pad' | 'ambiencia' | 'vocal' | 'backing' | 'desconhecido'`
  - `interface ChannelIdentity { id: string; name: string; customName?: string; role?: ChannelRole; srcIdx?: number }` (o `Channel` e o `SavedChannel` cabem nela)
  - `interface ChannelRecognition { family: ChannelFamily; label: string }` (rótulo sem número de repetição)
  - `interface ChannelLabel { id: string; label: string; autoLabel: string; isCustom: boolean; family: ChannelFamily; color: string; role: ChannelRole }`
  - `const FAMILY_LABEL: Record<Exclude<ChannelFamily, 'desconhecido'>, string>` (coluna "Rótulo" da tabela abaixo), `const FAMILY_COLOR: Record<ChannelFamily, string>`, `const FAMILY_RANK: Record<ChannelFamily, number>`
  - `cleanChannelName(raw: string): string`
  - `recognizeChannel(raw: string, opts?: { ignoreRoleFamilies?: boolean }): ChannelRecognition`
  - `roleFromName(raw: string): ChannelRole`
  - `resolveChannelRole(ch: ChannelIdentity): ChannelRole`
  - `channelFamily(ch: ChannelIdentity): ChannelFamily`
  - `buildChannelLabels(channels: readonly ChannelIdentity[]): ChannelLabel[]` (mesma ordem da entrada)
  - `sortChannelsByDefault<T extends ChannelIdentity>(channels: readonly T[]): T[]` (estável, não muta)
  - `arrangeChannels<T extends ChannelIdentity>(channels: readonly T[], mode: ChannelOrderMode | undefined): T[]` (`'manual'` devolve a mesma ordem; senão `sortChannelsByDefault`)
- Produces em `src/lib/channelRoles.ts`:
  - `interface AutoPanRouting { pan: -1 | 0 | 1; bus: '1' | '2' | '1/2' }`
  - `interface MixState { volume: number; muted: boolean; soloed: boolean }`
  - `interface ChannelMetaPatch { customName?: string | null; role?: ChannelRole | null }` (`undefined` = não mexe; `null` = volta ao automático)
  - `const CUSTOM_NAME_MAX = 24`
  - `isPitchExempt(ch: ChannelIdentity): boolean` (papel diferente de `normal`)
  - `isSoloSafe(ch: ChannelIdentity): boolean` (papel `click` ou `guide`)
  - `channelGain<T extends ChannelIdentity & MixState>(ch: T, all: readonly T[]): number`: 0 se `muted`; 0 se algum canal de `all` está em solo, este não está e não é solo-safe; senão `ch.volume`
  - `isSilencedBySolo<T extends ChannelIdentity & MixState>(ch: T, all: readonly T[]): boolean`
  - `autoPanFor(ch: ChannelIdentity, autoPanEnabled: boolean): AutoPanRouting` (ligado: click/guia `{ pan: -1, bus: '1' }` = ouvido, normal `{ pan: 1, bus: '2' }` = PA; desligado: `{ pan: 0, bus: '1/2' }`)
  - `findClickChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined` (consumido pela Parte 2: "a música já tem click")
  - `pickMainChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined` (primeiro de papel `normal`; onda do SectionBar e detecção de tom)
  - `pickTempoSourceChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined` (família bateria, depois baixo, depois primeiro normal, depois o primeiro)
  - `applyChannelMetaPatch<T extends ChannelIdentity>(ch: T, patch: ChannelMetaPatch): T` (cópia nova, nunca muta)
  - `applyChannelMetaToList<T extends ChannelIdentity>(channels: readonly T[], channelId: string, patch: ChannelMetaPatch, mode: ChannelOrderMode | undefined): { channels: T[]; before?: T; after?: T; roleChanged: boolean }` (`after` é o mesmo objeto que está em `channels`; reordena com `arrangeChannels`; `roleChanged` = `resolveChannelRole(before) !== resolveChannelRole(after)`; id desconhecido devolve a lista igual e `after` indefinido)
  - `pitchChangeAction(before: ChannelIdentity, after: ChannelIdentity, ctx: { isPlaying: boolean; pitch: number }): 'none' | 'release' | 'restart'`

**Regra de reconhecimento (decide os testes):**

1. Limpeza do bruto, nesta ordem: `trim`; tira extensão de áudio no fim (`wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus|caf`, sem diferenciar caixa); tira sufixo de cópia (`copy`/`cópia`, com ou sem número e parênteses, e `(1)`); tira **um** sufixo de exportação `[_-]\d{1,3}` no fim.
2. Tokens: remove acentos (NFD, sem marcas), caixa alta, separa por qualquer coisa que não seja letra ou número e separa letra de número (`GTR1` vira `GTR`, `1`). Casamento sempre por token inteiro (ou sequência de tokens), nunca por pedaço.
3. Família = a primeira desta lista (ordem de prioridade) que tiver alguma palavra presente. Com `ignoreRoleFamilies`, pula `click` e `guia`.

| # | Família | Rótulo | Palavras (tokens) e sequências |
|---|---|---|---|
| 1 | click | Click | CLICK, CLIQUE, CLK, METRO, METRONOMO, METRONOME, MTR, TEMPO, BEAT |
| 2 | guia | Guia | GUIA, GUIDE, GUIDES, CUE, CUES |
| 3 | backing | Backing | BV, BVS, BGV, BGVS, BACKING, BACKINGS, CORO, CHOIR; sequências BACK+VOCAL, BACK+VOX |
| 4 | synthBass | Synth Bass | SUB, SUBBASS, SYNTHBASS; sequências SYNTH+BASS, SYN+BASS, SUB+BASS |
| 5 | baixo | Baixo | BASS, BASSES, BAIXO, BX |
| 6 | violao | Violão | AG, ACOUSTIC, ACUSTICO, VIOLAO, VIOLOES, VL; sequências AC+GTR, AC+GUITAR |
| 7 | guitarra | Guitarra | EG, GTR, GTRS, GUITAR, GUITARS, GUIT, GUITARRA, GUITARRAS |
| 8 | piano | Piano | PIANO, PIANOS, PNO |
| 9 | pad | Pad | PAD, PADS |
| 10 | teclado | Teclado | KEY, KEYS, KEYBOARD, KEYBOARDS, TECLADO, TECLADOS, TECL, TEC, SYNTH, SYNTHS, SYN, ORGAN, ORGAO, RHODES, WURLI, EP |
| 11 | bateria | Bateria | DRUMS, DRUM, DRM, BATERIA, BAT, KIT; peças com rótulo próprio: KICK = Bumbo, SNARE = Caixa, HAT/HIHAT/HH = Chimbal, OH/OVERHEAD/OVERHEADS = Overhead, TOMS = Tons |
| 12 | percussao | Percussão | PERC, PERCS, PERCUSSION, PERCUSSAO, PERCUSSOES, SHAKER, CAJON, CONGA, CONGAS |
| 13 | vocal | Vocal | VOX, VOCAL, VOCALS, VOCAIS, VOC, VOZ, VOZES, VOICE, LEAD, LV |
| 14 | ambiencia | Ambiência | AMB, AMBIENCE, AMBIENT, AMBIENCIA |

4. Complemento (depois do rótulo da família, no máximo 2 palavras, na ordem em que aparecem, sem repetir): só tokens do dicionário abaixo, traduzidos. O dicionário vence o "é palavra de outra família" (por isso `GTR AMB` vira Guitarra Ambiente e `LEAD SYNTH` vira Teclado Solo). Tokens que casaram a família escolhida, números e qualquer outra palavra saem. Click e Guia nunca têm complemento.
   Dicionário: BASE, BASES, RHYTHM, RITMO, RIT = Base · DEDIL, DEDILHADO, DED = Dedilhado · ARP, ARPEJO, ARPEGGIO = Arpejo · SOLO, LEAD = Solo · AMB, AMBIENT, AMBIENCE, AMBIENTE = Ambiente · REVERSE = Reverso · LOOP, LOOPS = Loop · FX = FX · DOUBLE, DBL, DOBRA = Dobra · L, LEFT, ESQ = L · R, RIGHT, DIR = R.
5. Não reconhecido: rótulo = `cleanChannelName(raw)`: passo 1 da limpeza; `_` vira espaço; espaços colapsados; cada palavra toda em maiúscula com 3 letras ou mais, ou toda em minúscula, vira Capitalizada (pt-BR); palavras mistas ou siglas de até 2 letras ficam como estão; vazio vira `Canal`. Números ficam (`Track 5` continua `Track 5`).
6. `roleFromName`: família 1 = `click`, família 2 = `guide`, senão `normal`.
7. `resolveChannelRole`: `ch.role` se existir; senão `roleFromName(name)` se não for `normal`; senão `roleFromName(customName)` se houver `customName`; senão `normal`.
8. `channelFamily`: papel `click` = `click`; `guide` = `guia`; papel `normal` = primeira família diferente de `desconhecido` entre `recognizeChannel(customName, { ignoreRoleFamilies: true })` e `recognizeChannel(name, { ignoreRoleFamilies: true })`; senão `desconhecido`.
9. `buildChannelLabels`: rótulo automático = `Click` / `Guia` pelo papel, senão `recognizeChannel(name, { ignoreRoleFamilies: true }).label`. Canais sem `customName` com o mesmo rótulo automático (sem diferenciar caixa) ganham ` 1`, ` 2`... na ordem natural do nome original (`localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })`), desempate por `srcIdx` e depois por `id`. Canal com `customName` mostra o nome do usuário como está e não entra na numeração. `color = FAMILY_COLOR[channelFamily(ch)]`.
10. Ordem (`FAMILY_RANK`): click 0, guia 1, bateria 2, percussao 3, baixo 4, synthBass 5, violao 6, guitarra 7, teclado 8, piano 9, pad 10, ambiencia 10, vocal 11, backing 12, desconhecido 13.
11. Cores (`FAMILY_COLOR`): click `#FF6B35`, guia `#f59e0b`, bateria `#ef4444`, percussao `#f97316`, baixo `#22c55e`, synthBass `#16a34a`, violao `#ec4899`, guitarra `#f43f5e`, teclado `#8b5cf6`, piano `#a855f7`, pad `#6366f1`, ambiencia `#818cf8`, vocal `#06b6d4`, backing `#0ea5e9`, desconhecido `#9d9da8`.
12. `applyChannelMetaPatch`: `customName` string = espaços colapsados, `trim`, corta em 24; vazio ou só espaços = remove o campo (automático); `null` remove; `role` `null` remove; `undefined` não mexe.
13. `pitchChangeAction`: se `isPitchExempt` não mudou ou `pitch === 0`, `'none'`; parado: `'release'` se passou a ser isento, senão `'none'`; tocando: `'restart'`.

- [ ] **Step 1: Escrever `src/lib/channelNames.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  FAMILY_COLOR, arrangeChannels, buildChannelLabels, channelFamily, recognizeChannel,
  resolveChannelRole, roleFromName, sortChannelsByDefault, type ChannelIdentity,
} from './channelNames'

const mk = (names: string[]): ChannelIdentity[] => names.map((name, i) => ({ id: `c${i}`, name }))
const labels = (names: string[]) => buildChannelLabels(mk(names)).map((l) => l.label)

describe('reconhecimento (spec 5c)', () => {
  it.each([
    ['CLICK 13', 'Click', 'click'], ['Click_IA_120bpm', 'Click', 'click'], ['Metrônomo', 'Click', 'click'],
    ['Metronomo Loop', 'Click', 'click'], ['CLK', 'Click', 'click'], ['MTR', 'Click', 'click'],
    ['TEMPO', 'Click', 'click'], ['BEAT', 'Click', 'click'],
    ['Voz Guia', 'Guia', 'guia'], ['GUIDE VOX', 'Guia', 'guia'], ['CUE', 'Guia', 'guia'],
    ['DRUMS_1', 'Bateria', 'bateria'], ['BAT', 'Bateria', 'bateria'], ['KIT', 'Bateria', 'bateria'],
    ['KICK', 'Bumbo', 'bateria'], ['SNARE', 'Caixa', 'bateria'], ['HH', 'Chimbal', 'bateria'],
    ['PERC', 'Percussão', 'percussao'], ['BASS_1', 'Baixo', 'baixo'], ['BX', 'Baixo', 'baixo'],
    ['baixo', 'Baixo', 'baixo'], ['SYNTH BASS', 'Synth Bass', 'synthBass'], ['SUB', 'Synth Bass', 'synthBass'],
    ['AG BASE_1', 'Violão Base', 'violao'], ['AG DEDIL', 'Violão Dedilhado', 'violao'],
    ['ACOUSTIC GTR', 'Violão', 'violao'], ['VL', 'Violão', 'violao'],
    ['GTR SOLO', 'Guitarra Solo', 'guitarra'], ['GTR AMB', 'Guitarra Ambiente', 'guitarra'],
    ['EG LEAD', 'Guitarra Solo', 'guitarra'], ['GUIT', 'Guitarra', 'guitarra'],
    ['KEYS', 'Teclado', 'teclado'], ['LEAD SYNTH', 'Teclado Solo', 'teclado'], ['RHODES', 'Teclado', 'teclado'],
    ['PIANO DELAY', 'Piano', 'piano'], ['PNO', 'Piano', 'piano'], ['Piano/TeCL', 'Piano', 'piano'],
    ['PAD L', 'Pad L', 'pad'], ['SYNTH PAD', 'Pad', 'pad'], ['AMB REVERSE', 'Ambiência Reverso', 'ambiencia'],
    ['LEAD VOX', 'Vocal', 'vocal'], ['Vocais', 'Vocal', 'vocal'], ['VOZ', 'Vocal', 'vocal'],
    ['BV', 'Backing', 'backing'], ['BACKING VOCAL', 'Backing', 'backing'], ['CORO', 'Backing', 'backing'],
    ['CHOIR', 'Backing', 'backing'], ['drums copy.wav', 'Bateria', 'bateria'],
    ['MASTER_1', 'Master', 'desconhecido'], ['stage', 'Stage', 'desconhecido'], ['legato', 'Legato', 'desconhecido'],
    ['Outros/Fx', 'Outros/Fx', 'desconhecido'], ['Track 5', 'Track 5', 'desconhecido'],
    ['🎸 GTR', 'Guitarra', 'guitarra'], ['01', '01', 'desconhecido'], ['', 'Canal', 'desconhecido'],
    ['   ', 'Canal', 'desconhecido'],
  ])('%s vira %s (%s)', (raw, label, family) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
  })
})

describe('rótulos da lista', () => {
  it('lista real do dono', () => {
    expect(labels(['CLICK 13', 'BASS_1', 'DRUMS_1', 'AG BASE_1', 'AG DEDIL_1', 'AMB REVERSE_1', 'GTR AMB_1',
      'GTR SOLO_1', 'GTR1_1', 'KEY 1_1', 'KEY 2_1', 'MASTER_1', 'PIANO DELAY_1'])).toEqual(['Click', 'Baixo',
      'Bateria', 'Violão Base', 'Violão Dedilhado', 'Ambiência Reverso', 'Guitarra Ambiente', 'Guitarra Solo',
      'Guitarra', 'Teclado 1', 'Teclado 2', 'Master', 'Piano'])
  })
  it('número segue o nome original, não a posição', () => {
    expect(labels(['KEY 2_1', 'KEY 1_1'])).toEqual(['Teclado 2', 'Teclado 1'])
  })
  it('numeração estável com nomes idênticos (srcIdx desempata, reordenar não troca)', () => {
    const a = { id: 'a', name: 'GTR_1', srcIdx: 5 }
    const b = { id: 'b', name: 'GTR_1', srcIdx: 2 }
    const byId = (list: ChannelIdentity[]) => Object.fromEntries(buildChannelLabels(list).map((l) => [l.id, l.label]))
    expect(byId([a, b])).toEqual({ a: 'Guitarra 2', b: 'Guitarra 1' })
    expect(byId([b, a])).toEqual({ a: 'Guitarra 2', b: 'Guitarra 1' })
  })
  it('nome do usuário vence, não entra na numeração e guarda o automático', () => {
    const [x, y] = buildChannelLabels([{ id: 'x', name: 'GTR_1', customName: 'Solo do Zé' }, { id: 'y', name: 'GTR_2' }])
    expect([x.label, x.isCustom, x.autoLabel, y.label]).toEqual(['Solo do Zé', true, 'Guitarra', 'Guitarra'])
  })
  it('cor pela família, inclusive pelo nome do usuário', () => {
    expect(buildChannelLabels([{ id: 'v', name: 'Track 7', customName: 'Violão do Zé' }])[0].color).toBe(FAMILY_COLOR.violao)
    expect(FAMILY_COLOR).toEqual({ click: '#FF6B35', guia: '#f59e0b', bateria: '#ef4444', percussao: '#f97316',
      baixo: '#22c55e', synthBass: '#16a34a', violao: '#ec4899', guitarra: '#f43f5e', teclado: '#8b5cf6',
      piano: '#a855f7', pad: '#6366f1', ambiencia: '#818cf8', vocal: '#06b6d4', backing: '#0ea5e9', desconhecido: '#9d9da8' })
  })
})

describe('papel', () => {
  it.each([['CLICK', 'click'], ['Metrônomo', 'click'], ['BEAT', 'click'], ['GUIDE', 'guide'], ['CUE', 'guide'],
    ['Voz Guia', 'guide'], ['Vocal', 'normal'], ['stage', 'normal'], ['guitarra', 'normal']])('%s = %s', (n, r) => {
    expect(roleFromName(n)).toBe(r)
  })
  it('manual vence; renomear não tira o papel do original; nome do usuário conta se o original for normal', () => {
    expect(resolveChannelRole({ id: '1', name: 'CLICK', role: 'normal' })).toBe('normal')
    expect(resolveChannelRole({ id: '2', name: 'Track 7', role: 'click' })).toBe('click')
    expect(resolveChannelRole({ id: '3', name: 'CLICK', customName: 'Pulso' })).toBe('click')
    expect(resolveChannelRole({ id: '4', name: 'Track 7', customName: 'Click' })).toBe('click')
  })
  it('papel Normal manual tira o canal da família click/guia', () => {
    expect(channelFamily({ id: '1', name: 'CUE VOX', role: 'normal' })).toBe('vocal')
    expect(buildChannelLabels([{ id: '2', name: 'CLICK 13', role: 'normal' }])[0]).toMatchObject({ label: 'Click 13', family: 'desconhecido' })
  })
})

describe('ordem padrão', () => {
  it('Click, Guia, Bateria... não reconhecido no fim; mesma família mantém a ordem original', () => {
    const input = ['Vocal', 'Track X', 'GTR 2', 'Click', 'Pad', 'Bass', 'GTR 1', 'Guia', 'Backing', 'Piano', 'KEYS', 'AG', 'SUB', 'PERC', 'DRUMS', 'AMB']
    expect(sortChannelsByDefault(mk(input)).map((c) => c.name)).toEqual(['Click', 'Guia', 'DRUMS', 'PERC', 'Bass',
      'SUB', 'AG', 'GTR 2', 'GTR 1', 'KEYS', 'Piano', 'Pad', 'AMB', 'Vocal', 'Backing', 'Track X'])
  })
  it('manual não reordena; automático é idempotente e não muta a entrada', () => {
    const list = mk(['Vocal', 'Click'])
    expect(arrangeChannels(list, 'manual').map((c) => c.name)).toEqual(['Vocal', 'Click'])
    const once = arrangeChannels(list, 'auto')
    expect(arrangeChannels(once, undefined)).toEqual(once)
    expect(list.map((c) => c.name)).toEqual(['Vocal', 'Click'])
  })
})
```

- [ ] **Step 2: Escrever `src/lib/channelRoles.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  applyChannelMetaPatch, applyChannelMetaToList, autoPanFor, channelGain, findClickChannel, isPitchExempt,
  isSilencedBySolo, isSoloSafe, pickMainChannel, pickTempoSourceChannel, pitchChangeAction,
} from './channelRoles'

const mix = (id: string, name: string, extra: object = {}) => ({ id, name, volume: 0.8, muted: false, soloed: false, ...extra })

describe('solo não cala Click e Guia (spec 9b)', () => {
  it('solo no Baixo: Click e Guia seguem, Bateria cala', () => {
    const all = [mix('c', 'CLICK'), mix('g', 'Voz Guia'), mix('d', 'DRUMS'), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0.8, 0.8, 0, 0.8])
    expect(all.map((ch) => isSilencedBySolo(ch, all))).toEqual([false, false, true, false])
    expect([isSoloSafe({ id: '1', name: 'CUE' }), isSoloSafe({ id: '2', name: 'CLICK', role: 'normal' })]).toEqual([true, false])
  })
  it('o M do Click continua funcionando com solo ligado', () => {
    const all = [mix('c', 'CLICK', { muted: true }), mix('b', 'BASS', { soloed: true })]
    expect(channelGain(all[0], all)).toBe(0)
  })
  it('vale o papel manual: Normal num CLICK cala; Click num Track segue', () => {
    const all = [mix('c', 'CLICK', { role: 'normal' }), mix('t', 'Track 7', { role: 'click' }), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0, 0.8, 0.8])
  })
  it('sem solo vale o volume; solo no próprio Click cala os normais e mantém a Guia', () => {
    const none = [mix('d', 'DRUMS')]
    expect(channelGain(none[0], none)).toBe(0.8)
    const all = [mix('c', 'CLICK', { soloed: true }), mix('g', 'GUIA'), mix('d', 'DRUMS')]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0.8, 0.8, 0])
  })
})

describe('efeitos do papel', () => {
  it('troca de tom e pan automático seguem o papel', () => {
    expect(isPitchExempt({ id: '1', name: 'Metrônomo' })).toBe(true)
    expect(isPitchExempt({ id: '2', name: 'BASS', role: 'guide' })).toBe(true)
    expect(autoPanFor({ id: '1', name: 'CUE' }, true)).toEqual({ pan: -1, bus: '1' })
    expect(autoPanFor({ id: '2', name: 'BASS' }, true)).toEqual({ pan: 1, bus: '2' })
    expect(autoPanFor({ id: '3', name: 'CLICK' }, false)).toEqual({ pan: 0, bus: '1/2' })
  })
  it('achadores', () => {
    const list = [{ id: 'a', name: 'CLICK', role: 'normal' as const }, { id: 'b', name: 'Track', role: 'click' as const },
      { id: 'c', name: 'Voz Guia' }, { id: 'd', name: 'BASS' }, { id: 'e', name: 'DRUMS' }]
    expect(findClickChannel(list)?.id).toBe('b')
    expect(pickMainChannel(list)?.id).toBe('a')
    expect(pickTempoSourceChannel(list)?.id).toBe('e')
    expect(pickTempoSourceChannel([{ id: 'x', name: 'Click' }, { id: 'y', name: 'Pad' }])?.id).toBe('y')
  })
  it('patch de nome e papel: limpa, corta em 24, vazio volta ao automático, não muta', () => {
    const ch = { id: '1', name: 'GTR_1', customName: 'Velho', role: 'click' as const }
    expect(applyChannelMetaPatch(ch, { customName: '  Guitarra   do  Zé ' }).customName).toBe('Guitarra do Zé')
    expect(applyChannelMetaPatch(ch, { customName: 'x'.repeat(30) }).customName).toHaveLength(24)
    expect('customName' in applyChannelMetaPatch(ch, { customName: '   ' })).toBe(false)
    expect('role' in applyChannelMetaPatch(ch, { role: null })).toBe(false)
    expect(applyChannelMetaPatch(ch, {})).toEqual(ch)
    expect(ch.customName).toBe('Velho')
  })
  it('aplicar na lista reordena no automático, respeita o manual e avisa mudança de papel', () => {
    const list = [{ id: 'v', name: 'Vocal' }, { id: 't', name: 'Track 7' }]
    const auto = applyChannelMetaToList(list, 't', { role: 'click' }, 'auto')
    expect(auto.channels.map((c) => c.id)).toEqual(['t', 'v'])
    expect(auto.roleChanged).toBe(true)
    expect(auto.channels).toContain(auto.after)
    expect(applyChannelMetaToList(list, 't', { role: 'click' }, 'manual').channels.map((c) => c.id)).toEqual(['v', 't'])
    expect(applyChannelMetaToList(list, 't', { customName: 'Zé' }, 'auto').roleChanged).toBe(false)
    expect(applyChannelMetaToList(list, 'nao-existe', { role: 'click' }, 'auto').after).toBeUndefined()
  })
  it('pitchChangeAction decide o que o motor faz quando o papel muda', () => {
    const normal = { id: '1', name: 'BASS' }
    const guia = { id: '1', name: 'BASS', role: 'guide' as const }
    expect(pitchChangeAction(normal, guia, { isPlaying: true, pitch: 2 })).toBe('restart')
    expect(pitchChangeAction(normal, guia, { isPlaying: false, pitch: 2 })).toBe('release')
    expect(pitchChangeAction(guia, normal, { isPlaying: false, pitch: 2 })).toBe('none')
    expect(pitchChangeAction(normal, guia, { isPlaying: true, pitch: 0 })).toBe('none')
    expect(pitchChangeAction(normal, { ...normal, customName: 'Zé' }, { isPlaying: true, pitch: 2 })).toBe('none')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/lib/channelNames.test.ts src/lib/channelRoles.test.ts > "$LOGS/t4.log" 2>&1; echo $?`
Expected: diferente de 0 (módulos não existem).

- [ ] **Step 4: Implementar `src/lib/channelNames.ts` e `src/lib/channelRoles.ts`** seguindo a regra numerada acima. `channelRoles.ts` importa de `channelNames.ts` (nunca o contrário). Nenhum dos dois importa React, idb ou Web Audio.

- [ ] **Step 5: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/lib/channelNames.test.ts src/lib/channelRoles.test.ts > "$LOGS/t4.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/channelNames.ts src/lib/channelRoles.ts src/lib/channelNames.test.ts src/lib/channelRoles.test.ts
git commit -m "feat(canais): regra central de nome, cor, ordem e papel do canal [Parte 1]"
```

---

### Tarefa 5: Esquema do repertório v2 e migração

**Onda:** 1. **Depende de:** T1.

**Files:**
- Create: `src/lib/repertoireSchema.ts`
- Test: `src/lib/repertoireSchema.test.ts`

**Interfaces:**
- Consumes: `Channel`, `Song`, `Marker`, `ChannelRole`, `ChannelOrderMode` de `src/types.ts`.
- Produces:
  - `const REPERTOIRE_SCHEMA_VERSION = 2`
  - `interface SavedChannel { id: string; name: string; volume: number; muted: boolean; soloed: boolean; pan: number; bus: '1' | '2' | '1/2'; srcId?: string; srcIdx?: number; customName?: string; role?: ChannelRole }`
  - `interface SavedSong { id: string; sourceId?: string; name: string; bpm?: number; coverImage?: string; channels: SavedChannel[]; duration: number; pitch?: number; originalKey?: string | null; artist?: string; markers?: Marker[]; lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null; channelOrder?: ChannelOrderMode; schemaVersion?: number }` (substitui as interfaces locais de `useAudioEngine.ts:17-47`)
  - `type ChannelLike = Pick<Channel, 'id' | 'name' | 'volume' | 'muted' | 'soloed' | 'pan' | 'bus' | 'srcId' | 'srcIdx' | 'customName' | 'role'>`; `type SongLike = Omit<Song, 'channels'> & { channels: ChannelLike[] }`
  - `toSavedChannel(ch: ChannelLike): SavedChannel` (monta campo a campo: nunca leva `buffer`, nós de áudio nem `file`)
  - `toSavedSong(song: SongLike): SavedSong` (mesmo mapeamento do `saveStateToDB` atual em `useAudioEngine.ts:173-199`: `bus || '1/2'`, `pitch || 0`, `originalKey || null`, `lyrics/lyricsSynced/chords ?? null`; mais `sourceId`, `channelOrder ?? 'auto'` e `schemaVersion: 2`)
  - `inferChannelOrder(channels: readonly SavedChannel[]): ChannelOrderMode` (`'manual'` só se todos os canais têm `srcIdx` e a sequência não é crescente; senão `'auto'`)
  - `migrateSavedSong(saved: SavedSong): SavedSong` (idempotente; `schemaVersion === 2` volta igual; senão `channelOrder: saved.channelOrder ?? inferChannelOrder(saved.channels)` e `schemaVersion: 2`, todo o resto intacto)
  - `interface ManifestChannel { id: string; name: string; volume: number; muted: boolean; soloed: boolean; pan: number; bus: '1' | '2' | '1/2'; customName?: string; role?: ChannelRole }`; `interface ManifestSong { id: string; name: string; coverImage?: string; duration: number; channelOrder: ChannelOrderMode; channels: ManifestChannel[] }`; `toManifestSong(song: SongLike): ManifestSong` (o manifest do ZIP de hoje mais `channelOrder`, `customName` e `role`)

- [ ] **Step 1: Escrever `src/lib/repertoireSchema.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { inferChannelOrder, migrateSavedSong, toManifestSong, toSavedSong, type SavedSong, type SongLike } from './repertoireSchema'

const v1: SavedSong = {
  id: 's1', name: 'Ministério - Grande és Tu', bpm: 72, coverImage: 'data:image/png;base64,AAA', duration: 312.5,
  pitch: -2, originalKey: 'G', artist: 'Ministério',
  markers: [{ id: 'm1', time: 12.3, label: 'Refrão', color: '#FF6B35', lyrics: 'linha' }],
  lyrics: 'letra', lyricsSynced: '[00:12.30] linha', chords: 'G D Em',
  channels: [
    { id: 'a', name: 'CLICK 13', volume: 0.7, muted: false, soloed: false, pan: -1, bus: '1', srcId: 'cloud-1', srcIdx: 0 },
    { id: 'b', name: 'BASS_1', volume: 1.1, muted: true, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 1 },
    { id: 'c', name: 'GTR SOLO_1', volume: 0.5, muted: false, soloed: true, pan: 0.3, bus: '1/2', srcId: 'cloud-1', srcIdx: 2 },
  ],
}

describe('repertório v2', () => {
  it('migrateSavedSong preserva um registro v1 real inteiro', () => {
    expect(migrateSavedSong(v1)).toEqual({ ...v1, channelOrder: 'auto', schemaVersion: 2 })
  })
  it('ordem só é manual quando dá pra provar pelo srcIdx', () => {
    const ch = v1.channels
    expect(inferChannelOrder([ch[2], ch[0], ch[1]])).toBe('manual')
    expect(inferChannelOrder(ch)).toBe('auto')
    expect(inferChannelOrder(ch.map((c) => ({ ...c, srcIdx: undefined })))).toBe('auto')
    expect(inferChannelOrder([ch[1], { ...ch[0], srcIdx: undefined }])).toBe('auto')
  })
  it('migrateSavedSong respeita channelOrder que já veio no manifest e é idempotente', () => {
    const fromZip = { ...v1, channels: v1.channels.map((c) => ({ ...c, srcId: undefined, srcIdx: undefined })), channelOrder: 'manual' as const }
    expect(migrateSavedSong(fromZip).channelOrder).toBe('manual')
    const once = migrateSavedSong(v1)
    expect(migrateSavedSong(once)).toEqual(once)
  })
  it('toSavedSong salva sourceId, nome e papel do usuário e nunca leva áudio', () => {
    const song = { ...v1, sourceId: 'cloud-1', channelOrder: 'manual',
      channels: v1.channels.map((c, i) => ({ ...c, buffer: {}, gainNode: {}, pannerNode: {}, sourceNode: null,
        pitchShiftNode: null, file: {}, ...(i === 1 ? { customName: 'Baixo do Zé', role: 'guide' } : {}) })),
    } as unknown as SongLike
    const saved = toSavedSong(song)
    expect(saved).toMatchObject({ sourceId: 'cloud-1', channelOrder: 'manual', schemaVersion: 2 })
    expect(saved.channels[1]).toMatchObject({ customName: 'Baixo do Zé', role: 'guide' })
    for (const ch of saved.channels) {
      expect(Object.keys(ch).every((k) => ['id', 'name', 'volume', 'muted', 'soloed', 'pan', 'bus', 'srcId', 'srcIdx', 'customName', 'role'].includes(k))).toBe(true)
    }
  })
  it('manifest do ZIP leva ordem, nome e papel', () => {
    const m = toManifestSong({ ...v1, channelOrder: 'manual', channels: v1.channels.map((c) => ({ ...c, role: 'normal' })) } as unknown as SongLike)
    expect(m.channelOrder).toBe('manual')
    expect(Object.keys(m).sort()).toEqual(['channelOrder', 'channels', 'coverImage', 'duration', 'id', 'name'])
    expect(m.channels[0]).toMatchObject({ id: 'a', name: 'CLICK 13', role: 'normal', bus: '1' })
    expect('srcIdx' in m.channels[0]).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/lib/repertoireSchema.test.ts > "$LOGS/t5.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Implementar `src/lib/repertoireSchema.ts`** conforme o bloco Interfaces. Campos opcionais com valor `undefined` podem ficar de fora do objeto salvo.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/lib/repertoireSchema.test.ts > "$LOGS/t5.log" 2>&1; echo $?`
Expected: `0`, 5 testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repertoireSchema.ts src/lib/repertoireSchema.test.ts
git commit -m "feat(repertorio): esquema v2 com nome, papel e ordem do canal e migracao [Parte 1]"
```

---

### Tarefa 6: Motor usa a regra central nos detectores, no solo e no pan automático

**Onda:** 2. **Depende de:** T4.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (`135-139` `isClickOrGuideName`, `161-170` `applyPitchToChannel`, `225-252` efeito do autoPan, `293-297` ganho na restauração, `331-334` canal principal, `423-461` `play`, `758-766` `routingFor`, `941-944` canal principal, `995-1023` `createEndlessMetronomeSong`, `1062-1068` e `1104` `addChannelToActiveSong`, `1324-1388` `updateVolume`/`toggleMute`/`toggleSolo`)
- Test: `src/hooks/useAudioEngine.detectors.test.ts`

**Interfaces:**
- Consumes (T4): `isPitchExempt`, `autoPanFor`, `pickMainChannel`, `channelGain` de `src/lib/channelRoles.ts`.
- Produces: nenhum símbolo novo; o motor passa a seguir a regra central. Efeito desejado (spec 9b): canais como `Metrônomo` (com acento) e `CUE` passam a ser tratados como click/guia (ouvido, sem troca de tom, tocando no solo).

- [ ] **Step 1: Escrever o teste de guarda `src/hooks/useAudioEngine.detectors.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./useAudioEngine.ts', import.meta.url)), 'utf8')

describe('motor usa a regra central de canais', () => {
  it('sem detector de click/guia por pedaço de nome', () => {
    expect(src).not.toMatch(/includes\(\s*'(click|metronomo|metronom|metro|guia|guide)'\s*\)/)
    expect(src).not.toMatch(/isClickOrGuideName/)
  })
  it('solo e mute passam pelo channelGain (solo não cala Click e Guia)', () => {
    expect(src).not.toMatch(/anySoloed\s*&&\s*!ch\.soloed/)
    expect(src).not.toMatch(/some\(\s*c\s*=>\s*c\.soloed\s*\)\s*&&\s*!metaCh\.soloed/)
    expect(src).toMatch(/channelGain\(/)
  })
  it('importa os helpers da regra central', () => {
    expect(src).toMatch(/from '\.\.\/lib\/channelRoles'/)
    for (const fn of ['isPitchExempt(', 'autoPanFor(', 'pickMainChannel(']) expect(src).toContain(fn)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.detectors.test.ts > "$LOGS/t6.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Trocar cada detector pela regra central**
  - Apagar `isClickOrGuideName`; em `applyPitchToChannel` e nas duas checagens do `play` usar `isPitchExempt(ch)`.
  - Efeito do autoPan: `newPan = settings.autoPan ? autoPanFor(ch, true).pan : 0` (continua mexendo só no pan, como hoje).
  - `routingFor(fileName)`: `return autoPanFor({ id: '', name: fileName }, settings.autoPan)`.
  - `createEndlessMetronomeSong` e `addChannelToActiveSong`: `pan` e `bus` vêm de `autoPanFor({ id: '', name: <nome do arquivo> }, settings.autoPan)`; as ligações de `gain.connect` ficam como estão.
  - Restauração e `loadFiles`: canal principal = `pickMainChannel(channels)`.
  - Ganho: restauração (`293-297`), `play` (`449-451`), `updateVolume`, `toggleMute` e `toggleSolo` calculam o ganho com `channelGain(ch, listaAtualizada)`, onde `listaAtualizada` já tem a mudança daquele clique (em `toggleSolo`, reaplicar em todos os canais da música; em `updateVolume` e `toggleMute`, só no canal mexido). Na restauração, a lista é `metaSong.channels`.
  - Não mexer em `nameL.includes('metronomo loop')` (é o loop do metrônomo infinito, não detector de papel).

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.detectors.test.ts src/lib > "$LOGS/t6.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Conferir no app** (`npm run dev`, importar do computador uma pasta com `Metrônomo.wav`, `CUE.wav`, `Bass.wav`, `Drums.wav`): pan automático ligado deixa Metrônomo e CUE à esquerda; tom +2 não transpõe os dois; Solo no Bass mantém Metrônomo e CUE tocando e cala Drums; M no Metrônomo com o Solo ligado cala o Metrônomo; mexer no fader do Drums com o Solo ligado não faz ele voltar a tocar.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.detectors.test.ts
git commit -m "fix(motor): detectores, solo e pan automatico pela regra central de canais [Parte 1]"
```

---

### Tarefa 7: Metrônomo escolhe a faixa de análise pela regra central

**Onda:** 2. **Depende de:** T4.

**Files:**
- Modify: `src/components/MetronomeModal.tsx:150-166` (escolha de `targetChannel` em `handleAIGenerate`)
- Test: `src/components/MetronomeModal.detectors.test.ts`

**Interfaces:**
- Consumes (T4): `pickTempoSourceChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined`.

- [ ] **Step 1: Escrever o teste de guarda** (mesmo formato da Tarefa 6, lendo `./MetronomeModal.tsx`): não pode casar `/includes\(\s*'(drum|bateria|bass|baixo|click|metronomo|guia|guide)'\s*\)/`; tem que conter `pickTempoSourceChannel(` e importar de `'../lib/channelRoles'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/components/MetronomeModal.detectors.test.ts > "$LOGS/t7.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Substituir as linhas 150 a 166** por `const targetChannel = pickTempoSourceChannel(playlistCurrentSong.channels)`. O resto (`detectBeatGrid`, geração do click, alerta "Nenhuma faixa disponível para análise.") fica igual.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/components/MetronomeModal.detectors.test.ts > "$LOGS/t7.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Conferir no app**: numa música com `DRUMS_1`, "Gerar click IA" mostra `Analisando faixa "DRUMS_1"...`; numa sem bateria, usa o baixo.

- [ ] **Step 6: Commit**

```bash
git add src/components/MetronomeModal.tsx src/components/MetronomeModal.detectors.test.ts
git commit -m "fix(metronomo): faixa de analise pela regra central de canais [Parte 1]"
```

---

### Tarefa 8: Separador usa a regra central nos achados por nome

**Onda:** 2. **Depende de:** T4.

**Files:**
- Modify: `src/components/SeparatorStudio.tsx:476-480` (fonte da detecção de seções) e `1277-1283` (`pickGridSource`)
- Test: `src/components/SeparatorStudio.detectors.test.ts`

**Interfaces:**
- Consumes (T4): `channelFamily(ch: ChannelIdentity): ChannelFamily` e `resolveChannelRole(ch: ChannelIdentity): ChannelRole` de `src/lib/channelNames.ts`. Um `StemData` vira identidade com `{ id: s.id, name: s.name }`.

- [ ] **Step 1: Escrever o teste de guarda** lendo `./SeparatorStudio.tsx`: não pode casar `/n\.includes\('voc(al)?'\)/` nem `/\/bateria\|drum\/i/`; tem que conter `channelFamily(` e importar de `'../lib/channelNames'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/components/SeparatorStudio.detectors.test.ts > "$LOGS/t8.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Trocar os achados por nome**
  - `vocalStem` = primeiro stem com `channelFamily({ id: s.id, name: s.name }) === 'vocal'` (a Voz Guia deixa de ser confundida com o vocal, porque é da família `guia`).
  - `fallbackStem` = primeiro stem fora dos ids `click`, `metronome`, `voiceguide` **e** com `resolveChannelRole(...) === 'normal'`.
  - `pickGridSource`: trocar `/bateria|drum/i.test(s.name)` por `channelFamily(...) === 'bateria'`; `notGenerated` ganha a mesma checagem de papel `normal`. As checagens por id ficam.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/components/SeparatorStudio.detectors.test.ts > "$LOGS/t8.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Conferir no app**: abrir uma separação com Voz Guia gerada e rodar a detecção de seções e o SYNC do click: os dois continuam funcionando como antes.

- [ ] **Step 6: Commit**

```bash
git add src/components/SeparatorStudio.tsx src/components/SeparatorStudio.detectors.test.ts
git commit -m "fix(separador): achados de faixa por nome pela regra central [Parte 1]"
```

---

### Tarefa 9: Configurações (aba Buses) mostra o nome organizado

**Onda:** 2. **Depende de:** T4.

**Files:**
- Modify: `src/components/SettingsModal.tsx:194-196`
- Test: `src/components/SettingsModal.labels.test.ts`

**Interfaces:**
- Consumes (T4): `buildChannelLabels(channels: readonly ChannelIdentity[]): ChannelLabel[]`.

- [ ] **Step 1: Escrever o teste de guarda** lendo `./SettingsModal.tsx`: tem que conter `buildChannelLabels(` e não pode casar `/>\{ch\.name\}</`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/components/SettingsModal.labels.test.ts > "$LOGS/t9.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Mostrar o rótulo**: mapa `id -> label` com `useMemo` sobre `buildChannelLabels(channels)`; o `<span>` mostra o rótulo com `title={ch.name}` (o nome original aparece ao passar o mouse). Estilo da aba fica igual (o restyle é da Parte 3).

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/components/SettingsModal.labels.test.ts > "$LOGS/t9.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/SettingsModal.labels.test.ts
git commit -m "feat(config): aba Buses com o nome organizado do canal [Parte 1]"
```

---

### Tarefa 10: Painel "Editar canal" (renomear e escolher o papel)

**Onda:** 2. **Depende de:** T3, T4 (e T2 pro visual).

**Files:**
- Create: `src/components/ChannelEditPanel.tsx`
- Test: `src/components/ChannelEditPanel.test.tsx`

**Interfaces:**
- Consumes: `Panel`, `Segmented`, `Button` de `./ui` (T3); `resolveChannelRole`, `ChannelIdentity` de `../lib/channelNames` e `CUSTOM_NAME_MAX` de `../lib/channelRoles` (T4).
- Produces: `ChannelEditPanel(props: ChannelEditPanelProps)` com `interface ChannelEditPanelProps { channel: ChannelIdentity; autoLabel: string; onSave: (value: { customName: string | null; role: ChannelRole | null }) => void; onClose: () => void }`. `null` = automático. O valor salvo é compatível com `ChannelMetaPatch`.

Comportamento e textos exatos:
- Fundo `fixed inset-0 z-[90]` escurecido, centralizado, com `p-ps-gutter`; `Panel variant="pop"` com `role="dialog"`, `aria-modal="true"`, `aria-labelledby` apontando pro título `<h2>` "Editar canal"; largura `w-full max-w-[420px]`, `p-5`, coluna com `gap-4`.
- Campo "Nome" (`<label htmlFor="channel-edit-name">Nome</label>`), `maxLength={CUSTOM_NAME_MAX}`, `placeholder={autoLabel}`, valor inicial `channel.customName ?? ''`, foco ao abrir, Enter salva. Abaixo: "Arquivo: {channel.name}". Se o campo não estiver vazio: botão ghost "Usar nome automático" (esvazia o campo).
- "Papel do canal": `Segmented` com `aria-label="Papel do canal"` e opções Click (`click`), Guia (`guide`), Normal (`normal`). Valor mostrado = escolha manual ou, se não houver, `resolveChannelRole({ ...channel, role: undefined, customName: nomeDigitado || undefined })` (acompanha o que está sendo digitado). Sem escolha manual aparece o selo "Automático"; com escolha manual aparece o botão ghost "Usar papel automático".
- Texto de ajuda do papel mostrado: click "Canal do click: vai pro ouvido da banda no pan automático, não muda com a troca de tom e continua tocando no Solo."; guide "Canal da voz guia: vai pro ouvido da banda no pan automático, não muda com a troca de tom e continua tocando no Solo."; normal "Canal da música: vai pra PA no pan automático e acompanha a troca de tom."
- Aviso fixo: "Vale só pro seu repertório. A música da biblioteca não muda."
- Rodapé: `Button tone="ghost"` "Cancelar" (chama `onClose`) e `Button tone="primary"` "Salvar" (chama `onSave({ customName: nome.trim() || null, role: escolhaManual })`). Esc chama `onClose`.

- [ ] **Step 1: Escrever `src/components/ChannelEditPanel.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelEditPanel } from './ChannelEditPanel'
import type { ChannelIdentity } from '../lib/channelNames'

afterEach(cleanup)
const setup = (channel: ChannelIdentity = { id: 'c1', name: 'GTR_1' }, autoLabel = 'Guitarra') => {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<ChannelEditPanel channel={channel} autoLabel={autoLabel} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}
const nameInput = () => screen.getByLabelText('Nome') as HTMLInputElement

describe('ChannelEditPanel', () => {
  it('mostra título, arquivo original e o nome automático como placeholder', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Editar canal' })).toBeTruthy()
    expect(screen.getByText('Arquivo: GTR_1')).toBeTruthy()
    expect([nameInput().placeholder, nameInput().value, nameInput().maxLength]).toEqual(['Guitarra', '', 24])
  })
  it('papel automático marcado com o selo Automático', () => {
    setup({ id: 'c1', name: 'CLICK 13' }, 'Click')
    expect(screen.getByRole('radio', { name: 'Click' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Automático')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar papel automático' })).toBeNull()
  })
  it('papel automático acompanha o nome digitado', () => {
    setup({ id: 'c1', name: 'Track 7' }, 'Track 7')
    fireEvent.change(nameInput(), { target: { value: 'Click' } })
    expect(screen.getByRole('radio', { name: 'Click' }).getAttribute('aria-checked')).toBe('true')
  })
  it('salva nome limpo e papel manual', () => {
    const { onSave } = setup()
    fireEvent.change(nameInput(), { target: { value: '  Guitarra do Zé  ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Guia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSave).toHaveBeenCalledWith({ customName: 'Guitarra do Zé', role: 'guide' })
  })
  it('voltar ao automático manda null nos dois', () => {
    const { onSave } = setup({ id: 'c1', name: 'GTR_1', customName: 'Zé', role: 'click' })
    fireEvent.click(screen.getByRole('button', { name: 'Usar nome automático' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar papel automático' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSave).toHaveBeenCalledWith({ customName: null, role: null })
  })
  it('Enter no nome salva; Esc e Cancelar fecham sem salvar', () => {
    const { onSave, onClose } = setup()
    fireEvent.keyDown(nameInput(), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  it('textos de ajuda e aviso da biblioteca, sem travessão', () => {
    setup()
    expect(screen.getByText('Canal da música: vai pra PA no pan automático e acompanha a troca de tom.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Click' }))
    expect(screen.getByText('Canal do click: vai pro ouvido da banda no pan automático, não muda com a troca de tom e continua tocando no Solo.')).toBeTruthy()
    expect(screen.getByText('Vale só pro seu repertório. A música da biblioteca não muda.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('\u2014')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/components/ChannelEditPanel.test.tsx > "$LOGS/t10.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Implementar `src/components/ChannelEditPanel.tsx`** conforme o comportamento acima. Campo de texto com tokens: `w-full min-h-ps-touch px-3 rounded-ps-md bg-ps-s2 text-ps-bone text-ps-base inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none`. Textos podem quebrar linha; nada com largura fixa.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/components/ChannelEditPanel.test.tsx > "$LOGS/t10.log" 2>&1; echo $?`
Expected: `0`, 7 testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChannelEditPanel.tsx src/components/ChannelEditPanel.test.tsx
git commit -m "feat(canais): painel Editar canal com renomear e papel [Parte 1]"
```

---

### Tarefa 11: Palco mostra nomes, cores, onda e solo pela regra central

**Onda:** 2. **Depende de:** T4.

**Files:**
- Modify: `src/App.tsx` (`1` import de `useMemo`; `150-174` payload do Modo Ao Vivo; `352-362` `getChannelGroup`; `389-404` laço do VU; `1306` `waveBuffer`; `1482-1504` faixa do canal; `1543-1548` preenchimento do fader)
- Test: `src/App.channels.test.ts`

**Interfaces:**
- Consumes (T4): `buildChannelLabels`, `ChannelLabel` de `./lib/channelNames`; `pickMainChannel`, `channelGain`, `isSilencedBySolo` de `./lib/channelRoles`.
- Produces: `const channelLabels: Map<string, ChannelLabel>` em `App`, declarado com `useMemo(() => new Map(buildChannelLabels(channels).map((l) => [l.id, l])), [channels])` **antes** da chamada de `useLiveSync` (a Tarefa 13 usa).

- [ ] **Step 1: Escrever o teste de guarda** lendo `./App.tsx`: não pode conter `getChannelGroup` nem casar `/includes\(\s*'(click|metronomo|guia|guide)'\s*\)/` nem `/name: c\.name/` nem `/some\(c => c\.soloed\) && !ch\.soloed/` nem `/!channels\.some\(c => c\.soloed\) \|\| ch\.soloed/`; tem que conter `buildChannelLabels(`, `pickMainChannel(channels)`, `channelGain(` e `isSilencedBySolo(`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/App.channels.test.ts > "$LOGS/t11.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Ligar o palco à regra central**
  - Apagar `getChannelGroup`. Cor da faixa do canal, brilho ativo e gradiente do fader usam `channelLabels.get(ch.id)?.color`.
  - Nome do canal: mostra o rótulo inteiro (sem o corte manual de 8 letras), com `title` = `"<rótulo> (arquivo: <nome original>)"` e classes `w-full text-center text-[9px] sm:text-[10px] font-semibold leading-[11px] min-h-[22px] break-words line-clamp-2 mt-1 mb-1.5` (sem `uppercase`, `font-mono` e `truncate`).
  - `waveBuffer={(pickMainChannel(channels) ?? channels[0])?.buffer || null}`.
  - Modo Ao Vivo: `name: channelLabels.get(c.id)?.label ?? c.name` (o celular da banda vê o nome organizado).
  - Solo: `isMutedByOther = ch.muted || isSilencedBySolo(ch, channels)`; no VU, o pico do Principal soma `chLevel * channelGain(ch, channels)`.
  - O canal Principal (cor `#d4a843`) fica como está: o restyle é da Parte 2.

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/App.channels.test.ts > "$LOGS/t11.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Conferir no app** em 1280px e 1024px: uma música com `CLICK 13`, `GTR SOLO_1`, `KEY 1_1`, `KEY 2_1`, `AG DEDIL_1` mostra Click, Guitarra Solo, Teclado 1, Teclado 2, Violão Dedilhado, cada um com a cor da família, sem texto cortado; a onda do SectionBar continua sendo de um canal de música; com Solo num canal, Click e Guia não ficam com o fader vermelho; no celular conectado ao Modo Ao Vivo o mixer mostra os mesmos nomes.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.channels.test.ts
git commit -m "feat(palco): nomes, cores e solo dos canais pela regra central [Parte 1]"
```

---

### Tarefa 12: Motor guarda nome, papel e ordem (`setChannelMeta`, migração, ordem padrão)

**Onda:** 3. **Depende de:** T4, T5, T6.

**Files:**
- Modify: `src/hooks/useAudioEngine.ts` (`17-47` interfaces locais; `173-200` `saveStateToDB`; `273-372` restauração; `824-843` registro provisório e `951-966` `newSong` em `loadFiles`; `1026-1035` `createEndlessMetronomeSong`; `1107-1110` `addChannelToActiveSong`; `1434-1440` `reorderChannels`; `1544-1558` manifest do `exportPlaylist`; `1735-1812` retorno do hook; efeito novo de reinício)
- Test: `src/hooks/useAudioEngine.persistence.test.ts`

**Interfaces:**
- Consumes: `SavedSong`, `toSavedSong`, `migrateSavedSong`, `toManifestSong`, `REPERTOIRE_SCHEMA_VERSION` (T5); `arrangeChannels` (T4); `applyChannelMetaToList`, `autoPanFor`, `pitchChangeAction`, `isPitchExempt`, `channelGain`, `ChannelMetaPatch` (T4).
- Produces: no retorno do hook, `setChannelMeta(channelId: string, patch: ChannelMetaPatch): void`. `Song.channelOrder`, `Song.sourceId`, `Channel.customName` e `Channel.role` passam a ser salvos e restaurados.

- [ ] **Step 1: Escrever o teste de guarda `src/hooks/useAudioEngine.persistence.test.ts`** (mesmo formato da Tarefa 6):
  - não contém `interface SavedChannel` nem `interface SavedSong`;
  - importa `toSavedSong`, `migrateSavedSong` e `toManifestSong` de `'../lib/repertoireSchema'` e `arrangeChannels` de `'../lib/channelNames'`;
  - casa `/const reorderChannels[\s\S]{0,400}channelOrder\s*=\s*'manual'/`;
  - contém `migrateSavedSong)` ou `map(migrateSavedSong` (a restauração migra), `pitchChangeAction(` e `setChannelMeta,` no retorno.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/hooks/useAudioEngine.persistence.test.ts > "$LOGS/t12.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Persistência e migração**
  - Apagar as interfaces locais e importar `SavedSong` de `../lib/repertoireSchema`.
  - `saveStateToDB`: `await set(DB_KEY_META, list.map(toSavedSong))`.
  - Restauração: `savedMeta` passa por `.map(migrateSavedSong)`; cada `Channel` restaurado ganha `customName` e `role`; cada `Song` ganha `sourceId` e `channelOrder`; os canais decodificados passam por `arrangeChannels(channels, metaSong.channelOrder)`.
  - `loadFiles`: o registro provisório ganha `sourceId: meta?.sourceId`, `channelOrder: 'auto'` e `schemaVersion: REPERTOIRE_SCHEMA_VERSION`; o `newSong` usa `channels: arrangeChannels(newChannels, 'auto')` e `channelOrder: 'auto'`.
  - `createEndlessMetronomeSong`: `channelOrder: 'auto'`.
  - `addChannelToActiveSong`: `song.channels = arrangeChannels([...song.channels, newChannel], song.channelOrder)`.
  - `reorderChannels`: além da nova ordem, `song.channelOrder = 'manual'`.
  - `exportPlaylist`: `const manifest = playlist.map(toManifestSong)` (o `importPlaylist` não muda: a restauração migra).

- [ ] **Step 4: `setChannelMeta(channelId, patch)`** (algoritmo):
  1. `song = playlist[activeSongIndex]`; se não houver, sai. `{ channels: next, before, after, roleChanged } = applyChannelMetaToList(song.channels, channelId, patch, song.channelOrder)`; sem `before`/`after`, sai.
  2. Se `roleChanged`: com `settings.autoPan`, `autoPanFor(after, true)` grava `pan` e `bus` em `after` (já é cópia nova) e faz `after.pannerNode.pan.setTargetAtTime(pan, ctx.currentTime, 0.05)`; e reaplica o ganho de todos os canais de `next` com `channelGain(ch, next)` (`cancelScheduledValues` + `setValueAtTime`, igual ao `toggleSolo`), porque mudar o papel muda quem toca no Solo.
  3. `pitchChangeAction(before, after, { isPlaying, pitch: currentPitchRef.current })`: `'release'` fecha o `after.pitchShiftNode` (`disconnect` + `close`, como no `changePitch` voltando a 0) e grava `null`; `'restart'` marca `restartAfterMetaRef.current = true`.
  4. `updatePlaylistAndSave` com a música `{ ...song, channels: next }`.
  5. Efeito novo `useEffect(..., [channels, isPlaying, play, stopAllNodes, timeStretch, duration])`: se `restartAfterMetaRef.current`, zera a marca; se tocando, calcula a posição como o ramo `crossesBypass` do `changePitch`, chama `stopAllNodes()`, fecha o `pitchShiftNode` de todo canal com `isPitchExempt(ch)` e chama `void play()`. Assim o `play` já usa os canais novos e nenhum worklet fica sobrando.

- [ ] **Step 5: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run src/hooks src/lib > "$LOGS/t12.log" 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 6: Conferir que o repertório existente sobrevive** (Review Focus 1): antes de trocar de branch, anotar 2 músicas do repertório (volumes, mutes, pans, marcadores, letra); com esta branch, `npm run dev`, abrir o app logado: tudo igual (só a ordem dos canais pode mudar nas músicas em ordem automática). Repetir com o DevTools em "Offline" e recarregando. Exportar o repertório em ZIP e importar de novo: tudo volta.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.persistence.test.ts
git commit -m "feat(motor): salva nome, papel e ordem do canal no repertorio v2 [Parte 1]"
```

---

### Tarefa 13: EDITAR CANAIS abre o painel e aplica no motor

**Onda:** 4. **Depende de:** T10, T11, T12.

**Files:**
- Modify: `src/App.tsx` (desestruturação do `useAudioEngine` nas linhas `63-79`; sobreposição de edição do canal `1567-1577`; renderização do painel junto dos outros modais)
- Test: `src/App.channelEdit.test.ts`

**Interfaces:**
- Consumes: `setChannelMeta(channelId: string, patch: ChannelMetaPatch): void` (T12); `ChannelEditPanel` e suas props (T10); `channelLabels: Map<string, ChannelLabel>` (T11); `Button` de `./components/ui` (T3).

- [ ] **Step 1: Escrever o teste de guarda** lendo `./App.tsx`: contém `<ChannelEditPanel`, `setChannelMeta(` e `aria-label="Renomear e escolher papel"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./node_modules/.bin/vitest run src/App.channelEdit.test.ts > "$LOGS/t13.log" 2>&1; echo $?`
Expected: diferente de 0.

- [ ] **Step 3: Ligar o EDITAR CANAIS**
  - Estado `editingChannelId: string | null`; volta pra `null` quando `activeSongIndex` muda ou quando o canal some de `channels`.
  - Na sobreposição de edição de cada canal, além de "Arrastar" e da lixeira: `Button` só com ícone `Pencil` (lucide) e `aria-label="Renomear e escolher papel"`, com `e.stopPropagation()`, que abre o painel daquele canal; e, quando `channelLabels.get(ch.id)?.role` não for `normal`, o texto "Papel: Click" ou "Papel: Guia".
  - `{editingChannelId && <ChannelEditPanel channel={canal} autoLabel={channelLabels.get(id)?.autoLabel ?? canal.name} onSave={(v) => { setChannelMeta(id, v); setEditingChannelId(null) }} onClose={() => setEditingChannelId(null)} />}`.
  - Arrastar continua chamando `reorderChannels` (que agora marca a ordem como manual).

- [ ] **Step 4: Rodar e ver passar**

Run: `./node_modules/.bin/vitest run > "$LOGS/t13.log" 2>&1; echo $?`
Expected: `0` (suíte inteira).

- [ ] **Step 5: QA manual (web `npm run dev` e desktop `npm run dev:desktop`)**
  1. Música da biblioteca com nomes crus: mixer em ordem padrão, nomes organizados e cores por família.
  2. EDITAR CANAIS, lápis, renomear "Guitarra do Zé", Salvar: muda no mixer, na aba Buses e no celular do Modo Ao Vivo; recarregar com a internet desligada: continua.
  3. Papel: "Baixo" vira Guia com pan automático ligado: vai pra esquerda (ouvido); tom +2 não transpõe o baixo; Solo em outro canal mantém o baixo tocando; voltar pra Normal transpõe de novo e o Solo volta a calar.
  4. **Review Focus 4:** com a música TOCANDO e tom +2, trocar o papel de um canal: a música segue da mesma posição (reinício curto), sem silêncio; repetir numa música de 24 canais: nada de silêncio total.
  5. Arrastar um canal: ordem manual; trocar de música, voltar e recarregar: a ordem continua. Numa música não arrastada, um canal renomeado pra "Click" vai pro começo.
  6. Outra conta baixando a mesma música da biblioteca vê os nomes automáticos (nada mudou na nuvem).
  7. Em 1280px e 1024px, nome de 24 caracteres cabe em até 2 linhas no canal; o painel não corta texto em nenhuma largura até 360px.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.channelEdit.test.ts
git commit -m "feat(palco): EDITAR CANAIS renomeia e escolhe o papel do canal [Parte 1]"
```

---

### Tarefa 14: Documentação viva

**Onda:** 4. **Depende de:** T2 a T12 (o conteúdo descrito).

**Files:**
- Modify: `PLAYBACK_STUDIO_FATOS.md` (seção 4 Stack, seção 5 "Tela ao vivo", seção 6 Histórico), `DESIGN_SYSTEM.md` (seções novas 1.7 e 2.6)

- [ ] **Step 1: FATOS**
  - Seção 4: linhas "Testes: Vitest + Testing Library (jsdom), `npm test`." e "Fontes Inter e JetBrains Mono empacotadas no app (funcionam offline no desktop)."
  - Seção 5, bullet do mixer: acrescentar "com nomes organizados automaticamente (Click, Guia, Bateria, Baixo, Violão Base, Guitarra Solo, Teclado 1...), cor por família e ordem padrão; EDITAR CANAIS renomeia, escolhe o papel (Click / Guia / Normal), reordena e remove (chega na versão da Parte 1, ainda não publicada)". O @devops tira o "ainda não publicada" no lançamento.
  - Seção 6, no topo: `### 2026-11-15: Parte 1 do palco novo: linguagem nova + canais organizados (NÃO publicado ainda)`, com: tokens `ps-*` em `src/styles/ps-tokens.css` e peças base em `src/components/ui/` (tokens antigos intactos, telas atuais iguais até a Parte 3); fontes empacotadas; regra central de canais em `src/lib/channelNames.ts` e `src/lib/channelRoles.ts` (reconhecimento PT/EN/siglas, complemento, sufixos, numeração, cor, ordem padrão); papel do canal com manual vencendo o automático (pan ouvido x PA, fora da troca de tom, Click e Guia tocando no Solo); repertório v2 com migração (nome, papel e ordem só no repertório do usuário, nunca na nuvem); efeito desejado em músicas salvas (`Metrônomo` com acento e `CUE` passam a ir pro ouvido); `sourceId` passa a ser salvo; as 15 decisões deste plano marcadas "pro dono conferir".

- [ ] **Step 2: DESIGN_SYSTEM.md**: "1.7 Linguagem nova (palco v5): tokens `ps-*`" (tabela de tokens da Tarefa 2, código de cores com um significado só, regra "token novo nunca sobrescreve token antigo", `primary` dourado não entra em tela nova) e "2.6 Peças base (`src/components/ui/`)" (Button, Chip, Segmented, Panel, Led: props, tons e a regra de largura que acompanha o texto e alvo de 44px).

- [ ] **Step 3: Conferir travessão só no texto novo**

Run: `git diff -U0 PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md | grep '^+' | grep -c "$(printf '\342\200\224')"`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md
git commit -m "docs(fatos): Parte 1 do palco novo, linguagem nova e canais organizados (nao publicado)"
```

---

## Fechamento (coordenador, depois da Onda 4)

- [ ] Portão completo (comandos da seção "Portão de cada onda") com `eslint .` no lugar da lista de arquivos, mais `DESKTOP=1 ./node_modules/.bin/vite build` com a checagem de `url(./` das fontes. Tudo `=0`.
- [ ] `git log --oneline main..HEAD` mostra só os commits deste plano (mais o de docs do P3); `git status --short` sem arquivo de código solto.
- [ ] Revisão do branch inteiro (skill de execução) e apresentação pro dono ver no app. Nada é enviado sem a aprovação dele.
- [ ] Depois da aprovação, o @devops faz o lançamento (versão no `package.json`, entrada em `src/lib/changelog.ts`, tira o "ainda não publicado" do FATOS, push e tag, web + desktop juntos). Texto sugerido pra Novidades: título "Canais organizados e renomear no EDITAR CANAIS"; itens "Os canais agora aparecem com nome claro (Click, Guia, Bateria, Baixo, Violão Base, Guitarra Solo...) numa ordem padrão e com cor por instrumento.", "No EDITAR CANAIS você renomeia qualquer canal e diz se ele é Click, Guia ou Normal. O que você escolhe vale sempre, e Click e Guia continuam tocando quando você usa o Solo.", "Essas escolhas ficam só no seu repertório: a música da biblioteca continua igual pra todo mundo."
- [ ] Pra Parte 2 ficam prontos: tokens `ps-*` (incluindo `arm`, `alert`, `sec-*`, `mute`, `solo`), peças base, `findClickChannel` ("a música já tem click"), `isSoloSafe`/`channelGain` e o papel do canal pra contagem só no click.
