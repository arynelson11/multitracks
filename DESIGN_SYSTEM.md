# Playback Studio — Design System

> **Versão:** 1.0
> **Data:** 2026-05-20
> **Pareado com:** `PLAYBACK_STUDIO_BRAND_BOOK.md` (estratégia + briefing pros designers)
> **Este documento:** referência operacional pareando código existente com vocabulário atomic design (Brad Frost). Lê este se você vai TOCAR o código.

---

## Como usar este documento

- **Designer começando do zero:** lê o brand book primeiro, depois esse aqui pra ver o que já existe em código.
- **Dev implementando feature nova:** começa aqui — usa os tokens e componentes documentados antes de criar novo.
- **Audit de consistência:** os mapas atom/molecule/organism abaixo são o checklist.

**Arquitetura dual da marca:** este sistema cobre **marketing** (landing/auth/onboarding) sob paleta laranja+dark. O **produto interno** (mixer/editor/separator) mantém DAW dark gold (`--color-primary: #d4a843`) — propositalmente diferente. Não unificar.

---

## 1. Tokens (átomos primários)

Definidos em `src/index.css` no bloco `@theme` — consumidos via Tailwind v4 (`bg-laranja`, `text-bone`, etc).

### 1.1 Cores de marca

| Token | Hex | Class Tailwind | Uso |
|---|---|---|---|
| `--color-laranja` | `#FF6B35` | `bg-laranja` / `text-laranja` / `border-laranja` | CTA primário, accents, italic "Studio" do wordmark |
| `--color-laranja-light` | `#FF9268` | `bg-laranja-light` | Hover de CTAs |
| `--color-laranja-dark` | `#CC4A1F` | `bg-laranja-dark` | Pressed, hover dark |
| `--color-laranja-wash` | `#FFE5DC` | `bg-laranja-wash` | Light mode raro (PDF/emails) |
| `--color-musgo` | `#5B6B47` | `bg-musgo` / `text-musgo` | Success, accent secundário |
| `--color-musgo-light` | `#8B9B6E` | `text-musgo-light` | Success hover, secondary accent |
| `--color-musgo-dark` | `#3D4A2F` | `bg-musgo-dark` | Borders success cards |
| `--color-musgo-wash` | `#E6E8DC` | `bg-musgo-wash` | Success banner light (raro) |

### 1.2 Surfaces (sistema dark)

| Token | Hex | Class Tailwind | Uso |
|---|---|---|---|
| `--color-tinta` | `#121214` | `bg-tinta` / `text-tinta` | BG principal página + app shell |
| `--color-tinta-raised` | `#1A1A1E` | `bg-tinta-raised` | Cards, panels, dropdowns |
| `--color-tinta-soft` | `#0E0E10` | `bg-tinta-soft` | Modal backdrop, section divider |
| `--color-tinta-border` | `#2A2A2E` | `border-tinta-border` | Border sutil entre surfaces |

### 1.3 Texto e neutros

| Token | Hex | Class Tailwind | Uso |
|---|---|---|---|
| `--color-bone` | `#E8E8EC` | `text-bone` | Texto principal sobre dark |
| `--color-warm-100` | `#D4D4D8` | `text-warm-100` | Texto secundário forte |
| `--color-warm-200` | `#A1A1AA` | `text-warm-200` | Body secundário |
| `--color-warm-400` | `#71717A` | `text-warm-400` | Captions, hints |
| `--color-warm-600` | `#52525B` | `text-warm-600` | Disabled, divider labels |

### 1.4 Estado semântico

| Token | Hex | Uso |
|---|---|---|
| `--color-success` | `#5B6B47` (musgo) | Toast success, badge "pronto" |
| `--color-warning` | `#F5A524` | Toast warning, badge "atenção" |
| `--color-error` | `#EF4444` | Toast error, validação form |
| `--color-info` | `#5C6E7E` | Toast info, hints contextuais |

### 1.5 Tokens do produto interno (DAW) — não unificar com marketing

| Token | Hex | Uso |
|---|---|---|
| `--color-background` | `#121214` | App shell (compartilhado com tinta) |
| `--color-surface` | `#1a1a1e` | Cards do DAW |
| `--color-surface-raised` | `#222226` | Cards raised do DAW |
| `--color-primary` | `#d4a843` | **Gold do DAW** — distinto do laranja de marca |
| `--color-secondary` | `#06b6d4` | Cyan accent do DAW |
| `--color-accent-green` | `#4ade80` | Success do DAW (VU verde) |
| `--color-accent-red` | `#ef4444` | Peak VU, alerta crítico |
| `--color-accent-amber` | `#f59e0b` | Warning VU |
| `--color-text-main` | `#d0d0d4` | Texto principal DAW (frio, mais cinza que `bone`) |
| `--color-text-muted` | `#71717a` | Texto secundário DAW |
| `--color-border` | `#2a2a2e` | Border DAW |
| `--color-border-light` | `#333338` | Border destacado DAW |

**Regra dual:** marketing usa marca (laranja/musgo/bone). Produto usa DAW (gold/cyan/text-main). Eles convivem na mesma página apenas no DemoMixer embedded da landing — proposital.

### 1.6 Tipografia

| Token | Família | Class Tailwind | Uso |
|---|---|---|---|
| `--font-display` | Fraunces (variable) | `font-display` | H1/H2/H3 marketing, wordmark, badges grandes |
| `--font-sans` | Inter | (default body) | UI, body, botões |
| `--font-mono` | JetBrains Mono | `font-mono` | Code, labels técnicos, BPM, time codes |
| `--font-handwriting` | Caveat (placeholder) | `font-handwriting` | Visual Hammer "domingo." — substituir por SVG custom |

**Escala:** Tailwind defaults (`text-xs` 12px → `text-5xl` 48px). Headlines de marketing usam `text-[clamp(...)]` inline pra responsividade fluida (ver `LandingPage.tsx`).

---

## 2. Átomos

Componentes atômicos individuais usados em todas as superfícies de marketing.

### 2.0 `<PlayMark>` — `src/components/brand/PlayMark.tsx`

O **símbolo** da marca. Triângulo de play com 3 cortes horizontais sugerindo separação de stems (4 bandas: voz/baixo/bateria/outros).

```tsx
<PlayMark size="md" />                          // laranja default (currentColor)
<PlayMark size="favicon" />                     // 2 cortes wider stroke pra 16px
<PlayMark size="lg" className="text-bone" />    // monocromático sobre dark
```

**Props:**
- `size`: `favicon` (16px) | `sm` (20px) | `md` (28px) | `lg` (40px) | `xl` (64px). Default `md`.
- `className`: extras tailwind. Cor via `text-*` (default `text-laranja`).

**Regras:**
- viewBox 64×64 sempre (SVG mantém proporção em qualquer size)
- Cor via `currentColor` — flexível
- Fundo transparente (cuts são alpha — adaptam ao bg)
- Tamanho `favicon` simplifica pra 2 cortes (legibilidade em 16px)

**Conceito:** play (ação universal) + cortes horizontais (stems separados). A marca diz "a gente separa qualquer música" sem precisar de texto.

### 2.1 `<PlaybackStudioWordmark>` — `src/components/brand/PlaybackStudioWordmark.tsx`

Wordmark dual-weight da marca. NÃO substituir por texto simples — sempre usar esse componente.

```tsx
<PlaybackStudioWordmark size="md" tone="light" />
// Renders: Playback (semibold bone) + Studio (italic medium laranja)
```

**Props:**
- `size`: `sm` (16px) | `md` (20px) | `lg` (28px) | `xl` (48px). Default `md`.
- `tone`: `dark` (tinta sobre claro, raro) | `light` (bone sobre dark, default) | `accent` (laranja, momento especial).
- `className`: extras tailwind.

**Regras:**
- Sempre que aparecer "Playback Studio" como assinatura visual, usar este componente
- **NUNCA** estilizar Studio sem o italic+laranja — descaracteriza a marca
- Para tom monocromático (B&W obrigatório), envolver com classe que reseta cor

### 2.2 `<DomingoMark>` — `src/components/brand/DomingoMark.tsx`

Visual Hammer manuscrito da marca. Implementação atual usa Caveat font (placeholder até SVG custom).

```tsx
<DomingoMark size="md" tone="laranja" />
// Renders: "domingo." em Caveat 500, rotação -2deg, laranja
```

**Props:**
- `size`: `sm` (24px) | `md` (36px) | `lg` (56px) | `xl` (88px). Default `md`.
- `tone`: `laranja` (default) | `tinta` | `bone`.
- `rotate`: bool (default true) — rotação -2deg.
- `withPeriod`: bool (default true) — adiciona ponto final.

**Regras:**
- Sempre aparecer ao lado de "pronto pro" ou em CTA de domingo
- Quando substituir Caveat por SVG custom: trocar internamente, manter API
- Rotação NUNCA passa de -3deg (pinta de erro de layout)

### 2.3 `<BrandLogo>` — `src/components/BrandLogo.tsx`

Orquestrador: 5 variantes cobrindo todos os contextos de marca.

```tsx
<BrandLogo size="md" variant="wordmark" tone="light" />     // só wordmark
<BrandLogo size="md" variant="mark" />                       // só PlayMark
<BrandLogo size="md" variant="horizontal" tone="light" />    // PlayMark + wordmark (nav)
<BrandLogo size="lg" variant="lockup" tone="light" />        // wordmark + "domingo."
<BrandLogo size="lg" variant="full" tone="light" />          // PlayMark + wordmark + "domingo."
```

**Props:**
- `size`: `sm` | `md` | `lg`. Default `md`.
- `variant`: `wordmark` (default) | `mark` | `horizontal` | `lockup` | `full`.
- `tone`: `dark` | `light` (default).

**Uso por contexto:**
- `wordmark`: footer, espaços comprimidos
- `mark`: favicon, app icon, contextos onde palavra não cabe
- `horizontal`: nav header (padrão usado em landing + app)
- `lockup`: pricing card title, materiais oficiais formais
- `full`: hero da landing, OG image, brindes, peça assinada

### 2.4 Buttons (padrões coded)

Não temos `<Button>` componente isolado — todos os botões são construídos inline com classes Tailwind por enquanto. Os padrões consolidados:

#### Primário — CTA laranja
```html
class="bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl
       font-semibold text-[15px] transition-all hover:scale-[1.02]
       cursor-pointer shadow-lg shadow-laranja/25"
```

#### Secundário — ghost dark
```html
class="bg-tinta-raised hover:bg-tinta-border border border-tinta-border
       text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all
       cursor-pointer"
```

#### Pill toggle
```html
class="px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer
       [active] bg-bone text-tinta
       [inactive] text-warm-200 hover:text-bone"
```

#### Link inline
```html
class="text-laranja hover:underline cursor-pointer font-medium"
```

**Próximo passo (Fase B):** abstrair em `<Button variant="primary|secondary|link|pill" />` quando houver 5+ duplicações reais.

### 2.5 Icons — Lucide React

Stack: [`lucide-react`](https://lucide.dev/) — line-art consistente com a marca (Brand Book §4.6).

**Regras:**
- Tamanhos: 12, 14, 16, 20, 24px
- Cor herdada via `text-*` ou explícita via prop `className="text-laranja"`
- Stroke padrão (não usar fill colorido em ícones grandes)
- Para ações: par sempre com texto (não ícone sozinho exceto em UI denso DAW)

---

## 3. Moléculas

Combinações pequenas de átomos com propósito específico.

### 3.1 Hero CTA cluster
**Localização:** `LandingPage.tsx:206-228`
- Botão primário laranja + botão secundário ghost + (opcional) botão de instalar PWA musgo
- Texto de safety abaixo: "Sem cartão de crédito · Cancele quando quiser"

### 3.2 Pricing card
**Localização:** `LandingPage.tsx:426-483`
- Border `border-tinta-border` (highlight: `border-laranja`)
- Badge "Mais escolhido" — top-center, laranja
- Price block: símbolo R$ + valor `text-[40px]` font-display + `/mês`
- Features list com `Check` icon (musgo padrão / laranja se highlight)
- CTA inferior

### 3.3 FAQ accordion item
**Localização:** `LandingPage.tsx:495-512`
- Container `bg-tinta-raised border-tinta-border rounded-xl`
- Header com label + ChevronDown rotacionando
- Body expandido com border-top

### 3.4 Testimonial card
**Localização:** `LandingPage.tsx:381-391`
- Stars laranja (5x), texto warm-200, nome+role bottom

### 3.5 Auth column header
**Localização:** `AuthPage.tsx:67-99`
- Wordmark + "pronto pro" + DomingoMark + H1 + Sub + Stepper (3 passos)

### 3.6 Form input field
**Localização:** `AuthPage.tsx:155-188`
- Label uppercase tracking-wider warm-400
- Input com icon esquerdo, focus ring laranja
- Padding pl-11 pr-4 py-3

### 3.7 Audience card
**Localização:** `LandingPage.tsx:333-343`
- Icon container 10×10 com bg-musgo/15
- Title font-display + desc warm-200

### 3.8 Step number indicator
**Localização:** `LandingPage.tsx:297-313`
- Círculo 14×14 laranja com número font-display 24px
- Lado a lado com title+desc

---

## 4. Organismos

Seções completas — múltiplas moléculas trabalhando juntas.

### 4.1 Marketing nav
**Localização:** `LandingPage.tsx:157-175`
- Fixed top, backdrop-blur, border-bottom
- BrandLogo md / left | Entrar + CTA primário / right

### 4.2 Hero section
**Localização:** `LandingPage.tsx:178-240`
- Atmosphere blur circles (laranja+musgo)
- DomingoMark inline com label
- H1 clamp 2.4-5rem com "domingo" italic laranja
- Subheadline + CTA cluster (§3.1)
- DemoMixer embedded como prova visual

### 4.3 Stakes section (Miller)
**Localização:** `LandingPage.tsx:243-260`
- Section bg-tinta-soft (mais escuro)
- Heading + bloco de empatia em card raised

### 4.4 Guide / 3 benefícios
**Localização:** `LandingPage.tsx:263-287`
- Grid 3 colunas, cards numerados com icon laranja-wash bg

### 4.5 Plan / 3 passos
**Localização:** `LandingPage.tsx:290-324`
- Cards horizontais com step number (§3.8)

### 4.6 Audience grid
**Localização:** `LandingPage.tsx:327-345`
- Grid 2-3 colunas de Audience cards (§3.7)

### 4.7 Success timeline
**Localização:** `LandingPage.tsx:348-370`
- Card single com rows Sexta→Sábado→Domingo→Segunda

### 4.8 Testimonials row
**Localização:** `LandingPage.tsx:373-394`
- Grid 3 colunas de testimonial cards (§3.4)

### 4.9 Pricing section
**Localização:** `LandingPage.tsx:397-487`
- Toggle mensal/anual + grid 3 pricing cards (§3.2)

### 4.10 FAQ section
**Localização:** `LandingPage.tsx:490-514`
- Container max-w-2xl + lista de accordion items (§3.3)

### 4.11 CTA final
**Localização:** `LandingPage.tsx:516-545`
- Card destacado com border-laranja, DomingoMark, H2, CTA

### 4.12 Footer marketing
**Localização:** `LandingPage.tsx:548-561`
- Wordmark + tagline + nav links + copyright

### 4.13 Auth split
**Localização:** `AuthPage.tsx:58-220`
- Dual column: branding esquerda + formulário direita
- Atmosphere blur circles
- Google OAuth + email/senha form
- Modo login | register | forgot

### 4.14 Splash screen produto
**Localização:** `App.tsx:336-363`
- Centro: ícone Music animado boot-glow + H1 dual wordmark + tagline mono
- Dois botões hardware lado a lado: Multitracks (primary gold) | Separação IA (purple)

---

## 5. Templates (páginas)

| Template | Arquivo | Contexto |
|---|---|---|
| **Landing** | `LandingPage.tsx` | `brand-context-dark`, exibida quando user não logado |
| **Auth** | `AuthPage.tsx` | Mesmo modo, mostrada após click em "Entrar" |
| **Splash** | `App.tsx:336-363` | Após auth, antes do engine boot — mantém DAW gold no botão Multitracks |
| **DAW App** | `App.tsx:367+` | Produto interno, DAW dark gold full |
| **SeparatorStudio** | `SeparatorStudio.tsx` | Modal full-screen do separador IA |

---

## 6. Brand context utility

CSS class definida em `src/index.css`:

```css
.brand-context-dark {
  background-color: var(--color-tinta);
  color: var(--color-bone);
}
```

**Aplicada em:** `LandingPage.tsx:155` — toda landing herda essa base. Headers tem reset para `font-display` automático.

**`.brand-context-light` existe** mas só pra casos raros (PDF, email light). Não usar em UI normal.

---

## 7. Gaps conhecidos / próximas iterações

### 7.1 Bloqueando o launch — nada
Hoje todas as superfícies marketing renderam funcionalmente. Build passa. tsc clean.

### 7.2 Não-bloqueante mas planejado

| Item | Por quê | Quando |
|---|---|---|
| **Visual Hammer SVG custom** | Caveat é fonte genérica — substituir por SVG hand-drawn de ilustrador pra trademark/ownability | Fase B (próximo mês) |
| **`<Button>` componente** | 4 padrões inline duplicados — abstrair quando atingir 8+ duplicações | Fase B |
| **`<Card>` componente** | Mesmo padrão `bg-tinta-raised border-tinta-border rounded-2xl p-7` em 8+ lugares | Fase B |
| **Logo PNG/SVG em `public/`** | `public/logo.png` e `public/logo.svg` ainda apontam pra logo antiga (cyan-purple). Substituir pelo novo wordmark/monograma PS | Antes do launch público |
| **Animação Visual Hammer no hero** | Atualmente estático — pode "desenhar-se" no scroll-in pra reforçar handcraft | Fase B |
| **Dark mode toggle** | Brand book menciona light mode raro pra PDFs/emails — não temos UI toggle ainda | Fase C (opcional) |
| **Lint debt** | 117 erros pré-existentes (`any` types em `lib/`, `hooks/`, `SeparatorStudio.tsx`) — não relacionados ao rebrand mas marca o código | Backlog técnico |
| **Bundle splitting** | 559kB main chunk — code-split por rota (separator IA, modals admin) | Fase C |

### 7.3 Decisões de design pendentes (pros designers)

- **Visual Hammer custom:** estilo final — caneta esferográfica? marcador? lápis 2B? (Brand Book §4.1 sugere caneta esferográfica grossa OU marcador)
- **Monograma "PS" do favicon:** P bold + S italic laranja sobre quadrado tinta? Ou laranja-on-tinta inverso? (Brand Book §4.4)
- **Imagery comissionada:** Fase B do roadmap. Briefing já no Brand Book §4.5.
- **Sonic branding:** se haverá sound logo (Brand Book §10.1)
- **Handles social oficiais:** confirmar entre `@playbackstudio.br`, `@playbackstudioapp`, `@usaplaybackstudio`

---

## 8. Comando rápido pra novo designer

> "Lê o `PLAYBACK_STUDIO_BRAND_BOOK.md` pra entender estratégia + paleta + tom.
> Depois lê o `DESIGN_SYSTEM.md` (esse arquivo) pra ver o que já existe em código.
> Os tokens estão em `src/index.css`. Os componentes de marca em `src/components/brand/`.
> A landing inteira está em `src/components/LandingPage.tsx`.
> A auth em `src/components/AuthPage.tsx`.
> Rodar: `npm run dev` → `http://localhost:5173`.
> Pra entender o produto interno, abre `src/App.tsx` (DAW preserva gold dark — não unificar)."

---

*Doc v1.0 gerado em 2026-05-20 pela Design Squad (Brad Frost atomic lens). Atualizar conforme o sistema cresce — manter pareado com Brand Book.*
