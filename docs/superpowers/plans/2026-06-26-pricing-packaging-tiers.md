# Packaging por tier (Livre/Pro/Studio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o plano Livre um "gostinho" da separação (5/mês, 2 faixas, só ouvir) e mover download, BPM, voz guia, seções/loop e 4/6 faixas para o pago, distribuídos entre Pro e Studio.

**Architecture:** Centralizar as novas regras em `src/lib/plans.ts` (helpers por capability sobre `planTier()`), e consumir nas telas (`SeparatorStudio.tsx`, `App.tsx`). Toda trava nova abre o `PricingModal` já existente. `isAdmin` continua furando tudo. Copy alinhada em `LandingPage.tsx` e `PricingModal.tsx`.

**Tech Stack:** React + TypeScript, Vite, Tailwind. Sem framework de testes — validação por `tsc` + `eslint` + verificação manual.

## Global Constraints

- **Sem em dash em copy de usuário:** nunca usar "—" em texto visível. Reestruturar com pontos ou vírgulas.
- **Vocabulário:** termo canônico é "multitracks" e "separação de faixas" (não "stems") em copy de usuário.
- **IDs internos de plano não mudam:** `free`, `essencial_mensal/anual`, `pro_mensal/anual` continuam (AbacatePay + `profiles.plan`). Só o mapa de tier em `plans.ts` os consome.
- **Imports relativos:** seguir o padrão existente (`../lib/plans`, `./lib/plans`).
- **Ciclo de cada tarefa:** editar, rodar `npx tsc --noEmit -p tsconfig.app.json` (deve passar sem erro), rodar `npm run lint` (sem novos erros), verificar manualmente, commitar.
- **Admin bypass:** `isAdmin` (email arynelson11@/arynel11@gmail.com) ignora todas as travas.

---

### Task 1: Helpers de capability em plans.ts

**Files:**
- Modify: `src/lib/plans.ts` (append ao final, após `canBandControlSections`)

**Interfaces:**
- Consumes: `planTier(id)` já existente.
- Produces:
  - `canDownloadStems(id: string | null | undefined): boolean`
  - `canUseBpmDetection(id: string | null | undefined): boolean`
  - `canUseVoiceGuide(id: string | null | undefined): boolean`
  - `canUseSections(id: string | null | undefined): boolean`

- [ ] **Step 1: Adicionar os helpers ao final de `src/lib/plans.ts`**

Após a função `canBandControlSections` (última do arquivo), adicionar:

```ts

// Baixar a faixa separada pro computador (WAV/MP3) é exclusivo do pago.
export function canDownloadStems(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// BPM detectado pela IA: recurso de preparo, exclusivo do pago.
export function canUseBpmDetection(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Voz guia (manual e automática): exclusivo do pago.
export function canUseVoiceGuide(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Marcar seções e usar loop ao vivo: exclusivo do pago.
export function canUseSections(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros. (Os novos exports ficam sem consumidor por enquanto, o que é válido.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/plans.ts
git commit -m "feat(plans): helpers de gating por capability (download/bpm/voz guia/seções)"
```

---

### Task 2: Separação em 4 faixas vira Pro

**Files:**
- Modify: `src/components/SeparatorStudio.tsx` (bloco de opções, ~1247-1289)

**Interfaces:**
- Consumes: `canUsePro` e `handleSelectOption(stemsCount, requirePro, requireStudio)` já existentes na tela de opções.
- Produces: nada novo (UI).

Hoje a "Separação Básica" oferece 2 e 4 faixas livres. A mudança move 4 faixas pra "Separação Avançada" (Pro), ao lado de 6, ambas com cadeado pra quem não é Pro.

- [ ] **Step 1: Substituir o bloco `<div className="space-y-12">` ... `</div>`**

Trocar TODO o bloco atual (de `<div className="space-y-12">` até o `</div>` que o fecha, logo antes de `</div>\n        </div>\n      </div>`) por:

```tsx
            <div className="space-y-12">
              {/* Separação Básica */}
              <div>
                <h2 className="text-white font-bold text-sm mb-4">Separação Básica</h2>
                <div className="grid grid-cols-1 gap-4">
                  <div 
                    onClick={() => handleSelectOption(2, false, false)}
                    className="hw-btn flex flex-col p-6 rounded-xl cursor-pointer hover:bg-white/5 transition-colors border border-border/50 hover:border-primary/50 group"
                  >
                    <div className="text-white font-bold text-base mb-2 group-hover:text-primary transition-colors">Vocais, Instrumental</div>
                    <div className="text-text-muted text-xs">2 faixas</div>
                  </div>
                </div>
              </div>

              {/* Separação Avançada (Pro) */}
              <div>
                <h2 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
                  Separação Avançada
                  {!canUsePro && <span className="bg-yellow-500/20 text-yellow-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider ml-2">PRO</span>}
                </h2>
                <div className="grid grid-cols-1 gap-4">
                  <div 
                    onClick={() => handleSelectOption(4, true, false)}
                    className={`hw-btn flex items-center p-6 rounded-xl border transition-colors group ${canUsePro ? 'cursor-pointer hover:bg-white/5 border-border/50 hover:border-primary/50' : 'cursor-not-allowed opacity-50 border-border/20 bg-black/20'}`}
                  >
                    <div className="flex-1">
                      <div className="text-white font-bold text-base mb-2">Vocais, Bateria, Baixo, Outros</div>
                      <div className="text-text-muted text-xs">4 faixas</div>
                    </div>
                    {!canUsePro && <Lock size={20} className="text-text-muted/50" />}
                  </div>
                  <div 
                    onClick={() => handleSelectOption(6, true, false)}
                    className={`hw-btn flex items-center p-6 rounded-xl border transition-colors group ${canUsePro ? 'cursor-pointer hover:bg-white/5 border-border/50 hover:border-primary/50' : 'cursor-not-allowed opacity-50 border-border/20 bg-black/20'}`}
                  >
                    <div className="flex-1">
                      <div className="text-white font-bold text-base mb-2">Vocais, Bateria, Baixo, Guitarra, Piano, Outros</div>
                      <div className="text-text-muted text-xs">6 faixas</div>
                    </div>
                    {!canUsePro && <Lock size={20} className="text-text-muted/50" />}
                  </div>
                </div>
              </div>

            </div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

Run: `npm run dev`. Numa conta Livre, abrir o Separador e subir um áudio: só "2 faixas" deve estar clicável; "4 faixas" e "6 faixas" aparecem com cadeado e badge PRO, e clicar abre o PricingModal.

- [ ] **Step 4: Commit**

```bash
git add src/components/SeparatorStudio.tsx
git commit -m "feat(separator): separação em 4 faixas passa a exigir Pro"
```

---

### Task 3: Download das faixas só no pago

**Files:**
- Modify: `src/components/SeparatorStudio.tsx` (import ~152, `downloadStem` ~242, botão de download ~1620)

**Interfaces:**
- Consumes: `canDownloadStems` (Task 1), `userPlan`, `isAdmin`, `setIsPricingOpen` já existentes.
- Produces: `const canDownload` no corpo do componente.

- [ ] **Step 1: Importar o helper**

Localizar o import do `useAuth` no topo e adicionar, logo abaixo dele, o import do helper de plano (Tasks 4 e 5 estendem este mesmo import):

```tsx
import { canDownloadStems } from '../lib/plans';
```

- [ ] **Step 2: Derivar `canDownload` após `isAdmin`**

Logo após a linha `const isAdmin = user?.email === ...;` (~153), adicionar:

```tsx
  const canDownload = isAdmin || canDownloadStems(userPlan);
```

- [ ] **Step 3: Guardar `downloadStem`**

No início de `const downloadStem = async (stem: StemData) => {`, antes de `try {`, inserir:

```tsx
    if (!canDownload) { setIsPricingOpen(true); return; }
```

- [ ] **Step 4: Trocar o botão de download (~1620)**

Substituir o botão atual por:

```tsx
                      <button onClick={() => canDownload ? downloadStem(stem) : setIsPricingOpen(true)} disabled={encodingStemId === stem.id}
                        title={canDownload ? `Baixar ${stem.name} (${downloadFormat.toUpperCase()})` : 'Download disponível nos planos pagos'}
                        className="w-6 h-5 rounded cursor-pointer border border-[#222] bg-[#333] text-[#666] hover:bg-[#444] hover:text-primary flex items-center justify-center transition-all active:scale-90 disabled:opacity-60 disabled:cursor-wait">
                        {encodingStemId === stem.id ? <Loader2 size={9} className="animate-spin" /> : canDownload ? <Download size={9} /> : <Lock size={9} />}
                      </button>
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json` (sem erros)
Run: `npm run lint` (sem novos erros)

- [ ] **Step 6: Verificação manual**

Conta Livre: o botão de download de cada faixa mostra cadeado e abre o PricingModal. Conta paga/admin: baixa normal.

- [ ] **Step 7: Commit**

```bash
git add src/components/SeparatorStudio.tsx
git commit -m "feat(separator): download das faixas exclusivo dos planos pagos"
```

---

### Task 4: Voz guia só no pago

**Files:**
- Modify: `src/components/SeparatorStudio.tsx` (botão Voz Guia ~1549)

**Interfaces:**
- Consumes: `canUseVoiceGuide` (Task 1), `setShowVoiceGuide`, `setIsPricingOpen`.
- Produces: `const canVoiceGuide` no corpo do componente.

- [ ] **Step 1: Estender o import e derivar `canVoiceGuide`**

Atualizar o import de plano (criado na Task 3) para:

```tsx
import { canDownloadStems, canUseVoiceGuide } from '../lib/plans';
```

E logo após a linha `const canDownload = isAdmin || canDownloadStems(userPlan);` adicionar:

```tsx
  const canVoiceGuide = isAdmin || canUseVoiceGuide(userPlan);
```

- [ ] **Step 2: Trocar o botão da Voz Guia (~1549)**

Substituir o botão atual por:

```tsx
              <button onClick={() => canVoiceGuide ? setShowVoiceGuide(true) : setIsPricingOpen(true)}
                title={canVoiceGuide ? 'Voz guia' : 'Voz guia disponível nos planos pagos'}
                className={`transport-btn flex items-center gap-1.5 h-9 px-3.5 rounded-md cursor-pointer transition-all ${voiceCues.length > 0 ? 'text-yellow-400 border-yellow-500/30' : 'text-white/70 hover:text-yellow-400'}`}>
                {canVoiceGuide ? <Mic size={12} /> : <Lock size={12} />}
                <span className="text-[7px] uppercase tracking-widest font-bold font-mono hidden md:inline">
                  VOZ {voiceCues.length > 0 && `(${voiceCues.length})`}
                </span>
              </button>
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json` (sem erros)
Run: `npm run lint` (sem novos erros)

- [ ] **Step 4: Verificação manual**

Conta Livre: botão VOZ mostra cadeado e abre o PricingModal. Conta paga/admin: abre o modal de voz guia normalmente.

- [ ] **Step 5: Commit**

```bash
git add src/components/SeparatorStudio.tsx
git commit -m "feat(separator): voz guia exclusiva dos planos pagos"
```

---

### Task 5: Ocultar BPM no Livre

**Files:**
- Modify: `src/components/SeparatorStudio.tsx` (campo BPM ~1740-1745)

**Interfaces:**
- Consumes: `canUseBpmDetection` (Task 1).
- Produces: `const canBpm` no corpo do componente.

- [ ] **Step 1: Estender o import e derivar `canBpm`**

Atualizar o import de plano (agora com dois helpers) para:

```tsx
import { canDownloadStems, canUseVoiceGuide, canUseBpmDetection } from '../lib/plans';
```

E logo após a linha `const canVoiceGuide = isAdmin || canUseVoiceGuide(userPlan);` adicionar:

```tsx
  const canBpm = isAdmin || canUseBpmDetection(userPlan);
```

- [ ] **Step 2: Envolver o campo BPM em condicional**

Substituir o `<div>` do campo BPM (o que contém o `<label>BPM (IA)</label>` e seu `<input>`) por:

```tsx
                   {canBpm && (
                     <div>
                       <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">BPM (IA)</label>
                       <input type="number" value={bpm} onChange={e => setBpm(e.target.value)} 
                         className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                       />
                     </div>
                   )}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json` (sem erros)
Run: `npm run lint` (sem novos erros)

- [ ] **Step 4: Verificação manual**

Conta Livre: o campo "BPM (IA)" não aparece no painel de metadados (só "Tom"). Conta paga/admin: BPM aparece normal.

- [ ] **Step 5: Commit**

```bash
git add src/components/SeparatorStudio.tsx
git commit -m "feat(separator): oculta BPM da IA no plano Livre"
```

---

### Task 6: Seções/loop só no pago + remover loop-finito-grátis

**Files:**
- Modify: `src/App.tsx` (import ~24, `addSectionMarker` ~212, props do `SectionBar` ~1297-1298)
- Modify: `src/lib/plans.ts` (remover `canUseInfiniteLoop` e `FREE_MAX_LOOP_REPEATS`)

**Interfaces:**
- Consumes: `canUseSections` (Task 1), `userPlan`, `setIsPricingOpen` já existentes em App.
- Produces: remove `canUseInfiniteLoop` e `FREE_MAX_LOOP_REPEATS` do projeto.

- [ ] **Step 1: Atualizar o import em `src/App.tsx` (~24)**

Trocar:

```tsx
import { canUseInfiniteLoop, canUseLiveMode, maxLiveDevices, canBandControlSections, FREE_MAX_LOOP_REPEATS } from './lib/plans'
```

por:

```tsx
import { canUseSections, canUseLiveMode, maxLiveDevices, canBandControlSections } from './lib/plans'
```

- [ ] **Step 2: Gatear `addSectionMarker` (~212)**

Substituir a função por:

```tsx
  const addSectionMarker = useCallback((label: string) => {
    if (!canUseSections(userPlan)) { setIsPricingOpen(true); return }
    const activeSong = playlist[activeSongIndex]
    if (!activeSong) return
    const newMarker = { id: crypto.randomUUID(), time: currentTime, label, color: colorForSection(label) }
    const newMarkers = [...(activeSong.markers || []), newMarker].sort((a, b) => a.time - b.time)
    setSongMarkers(activeSong.id, newMarkers)
  }, [playlist, activeSongIndex, currentTime, setSongMarkers, userPlan])
```

- [ ] **Step 3: Atualizar props do `SectionBar` (~1297-1298)**

Trocar as duas linhas:

```tsx
                infiniteAllowed={canUseInfiniteLoop(userPlan)}
                maxRepeats={canUseInfiniteLoop(userPlan) ? 9 : FREE_MAX_LOOP_REPEATS}
```

por:

```tsx
                infiniteAllowed={canUseSections(userPlan)}
                maxRepeats={9}
```

- [ ] **Step 4: Remover helpers mortos de `src/lib/plans.ts`**

Apagar o bloco do loop finito (a constante `FREE_MAX_LOOP_REPEATS` e a função `canUseInfiniteLoop`, incluindo o comentário acima delas):

```ts
// Loop de seção: grátis repete um número limitado de vezes; pago libera o
// infinito (uso de ministração ao vivo).
export const FREE_MAX_LOOP_REPEATS = 4
export function canUseInfiniteLoop(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros (nenhum consumidor restante de `canUseInfiniteLoop`/`FREE_MAX_LOOP_REPEATS`).
Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 6: Verificação manual**

Conta Livre no player: clicar "Marcar" (ou teclar V/R) abre o PricingModal, nenhuma seção é criada. Conta paga/admin: marca seções e usa loop infinito normal.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/lib/plans.ts
git commit -m "feat(live): seções e loop ao vivo exclusivos do pago; remove loop-finito-grátis"
```

---

### Task 7: Copy dos planos na LandingPage

**Files:**
- Modify: `src/components/LandingPage.tsx` (array `PLANS`, features de Livre e Pro)

**Interfaces:** apenas copy.

- [ ] **Step 1: Atualizar as features do plano Livre**

Substituir o array `features` do plano `id: 'gratuito'` por:

```tsx
    features: [
      '5 separações de faixas por mês',
      'Separação em 2 faixas (vocal e instrumental)',
      'Ouça cada faixa isolada no mixer',
      'Biblioteca de separações local, salva no navegador',
    ],
```

- [ ] **Step 2: Atualizar as features do plano Pro**

Substituir o array `features` do plano `id: 'essencial'` por:

```tsx
    features: [
      '50 separações de faixas por mês',
      'Separação em 2, 4 e 6 faixas',
      'Download das faixas em WAV e MP3',
      'BPM pela IA e click com levada brasileira',
      'Voz guia pra orientar a equipe',
      'Pads de ambiente',
      'Marque seções e repita em loop infinito ao vivo',
      'Transposição de tom',
      'Modo Ao Vivo: banda conecta por QR Code, até 4 aparelhos',
      'Teleprompter de letras',
      'Biblioteca cloud e repertório com backup .zip',
      'Suporte por email',
    ],
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Na landing, conferir que o card Livre mostra só as 4 linhas novas e o Pro lista download, 2/4/6 faixas, BPM e teleprompter. Nenhum "—" em nenhuma linha.

- [ ] **Step 5: Commit**

```bash
git add src/components/LandingPage.tsx
git commit -m "docs(pricing): copy dos planos Livre e Pro alinhada ao novo gating"
```

---

### Task 8: Copy do PricingModal

**Files:**
- Modify: `src/components/PricingModal.tsx` (features de `essencial_mensal`, ~19)

**Interfaces:** apenas copy.

- [ ] **Step 1: Atualizar as features do Pro Mensal**

Trocar a linha:

```tsx
        features: ['50 separações de faixas por mês', 'Loop infinito ao vivo', 'Modo Ao Vivo (até 4 aparelhos)', 'Pads, voice guide e click brasileiro'],
```

por:

```tsx
        features: ['Separação em 2, 4 e 6 faixas', 'Download em WAV e MP3', 'BPM pela IA, voz guia e pads', 'Modo Ao Vivo (até 4 aparelhos)'],
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

Abrir o PricingModal (clicar numa trava como conta Livre) e conferir que o card Pro Mensal cita as faixas, download e BPM. Nenhum "—".

- [ ] **Step 4: Commit**

```bash
git add src/components/PricingModal.tsx
git commit -m "docs(pricing): destaca download, faixas e BPM no card Pro do modal"
```

---

## Notas de fechamento

- Após a Task 8, rodar `npm run build` uma vez para garantir que `tsc -b` + Vite passam de ponta a ponta antes de qualquer deploy.
- Deploy sai junto pro app (Mac AS/Intel, Win) e navegador conforme o fluxo de bump+push+tag, quando o usuário autorizar.
