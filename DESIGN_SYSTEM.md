# Playback Studio — Design System

> **Versão:** 1.0
> **Data:** 2026-05-20
> **Atualizado:** 2026-11-16 (seções 1.7 e 2.6: linguagem nova da Parte 1 do palco, publicada na v1.4.15)
> **Pareado com:** `PLAYBACK_STUDIO_BRAND_BOOK.md` (estratégia + briefing pros designers)
> **Este documento:** referência operacional pareando código existente com vocabulário atomic design (Brad Frost). Lê este se você vai TOCAR o código.

---

## Como usar este documento

- **Designer começando do zero:** lê o brand book primeiro, depois esse aqui pra ver o que já existe em código.
- **Dev implementando feature nova:** começa aqui — usa os tokens e componentes documentados antes de criar novo.
- **Audit de consistência:** os mapas atom/molecule/organism abaixo são o checklist.

**Arquitetura dual da marca:** este sistema cobre **marketing** (landing/auth/onboarding) sob paleta laranja+dark. O **produto interno** (mixer/editor/separator) mantém DAW dark gold (`--color-primary: #d4a843`) — propositalmente diferente. Não unificar.

**Linguagem nova do palco (desde a Parte 1, 2026-11-15, publicada na v1.4.15):** substitui o "Não unificar" do parágrafo acima e do título da seção 1.5 pra tudo que é tela nova do produto. Telas novas do produto usam os tokens `ps-*` (seção 1.7) e as peças base de `src/components/ui/` (seção 2.6). O dourado do DAW continua só nas telas atuais, até elas migrarem na Parte 3.

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

### 1.7 Linguagem nova (palco v5): tokens `ps-*`

> Entrou na Parte 1 do palco novo (2026-11-15, publicada na v1.4.15). Por enquanto só o painel "Editar canal", o lápis e a lixeira do EDITAR CANAIS usam; as Partes 2 e 3 migram o palco e as outras telas.
>
> O admin (`src/admin/`) usa só a linguagem nova: tokens `ps-*` e as peças de `src/components/ui/`, sem o dourado `primary` (admin central, 2026-11-17, NÃO publicado ainda). Falta uma tela: o login da web em `/admin` (`src/admin/AdminLogin.tsx`), que ainda está no estilo antigo e só aparece pra quem abre `/admin` sem estar logado.

**Onde:** `src/styles/ps-tokens.css`, num bloco `@theme static` (o `static` faz o Tailwind emitir todas as variáveis, mesmo as que só aparecem via `var()` em style inline). O `src/index.css` importa esse arquivo logo depois de `@import "tailwindcss";`. Valores tirados do mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`). Teste: `src/styles/ps-tokens.test.ts`.

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
| Animação | `--animate-ps-blink` | `ps-blink 1.4s ease-in-out infinite` (opacidade de 1 a .35 e de volta) |

**Classes geradas:** `bg-ps-<cor>`, `text-ps-<cor>` e `inset-ring-ps-<cor>` pra cada cor da tabela; `rounded-ps-{xs,sm,md,lg,xl,2xl,pill}`; `text-ps-{micro,label,sm,base,md,lg}`; `px-ps-gutter`, `gap-ps-gap`, `px-ps-pad-x`, `min-h-ps-touch`, `min-w-ps-touch`; `font-ps-sans`, `font-ps-mono`; `shadow-ps-pop`; `animate-ps-blink`. Utilities próprias: `ps-num` (fonte mono com `tabular-nums`: números de largura fixa) e `ps-label` (rótulo pequeno em caixa alta: 10.5px, peso 700, espaçamento .14em, cor `mut`, sem quebra de linha).

**Fontes:** `font-ps-sans` e `font-ps-mono` usam as versões variáveis empacotadas no app (`@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono`, importadas em `src/main.tsx` antes do `index.css`), então funcionam offline no desktop. O `--font-sans` e o `--font-mono` antigos (seção 1.6) continuam vindo do Google Fonts.

**Código de cores com um significado só** (vale pra toda tela nova):

| Cor | Token | Significa |
|---|---|---|
| Laranja | `ps-or`, `ps-or-soft`, `ps-or-line` | Ligado (Button `on`, Chip `on`, Led `on`). O laranja cheio do Button `primary` marca a ação principal de um painel (ex.: Salvar), e o anel de foco também é laranja. |
| Branco | `ps-arm` | Armado (Button `armed`, Led `armed`) |
| Cor da seção | `ps-sec-*` | Seção da música (Intro, Verso, Pré, Refrão, Ponte, Final) |
| Âmbar | `ps-alert`, `ps-alert-soft`, `ps-alert-line` | Alerta (Button `alert`, Led `alert` piscando) |
| Musgo claro | `ps-moss-hi` | Ao vivo (Led `live` piscando) |
| Vermelho e amarelo | `ps-mute`, `ps-solo` | Mute e Solo do mixer |

Neutros (`ink`, `s1` a `s3`, `raised`, `pop`, `well`, `line*`, `bone`, `mut`, `dim`) não carregam significado: são fundo, superfície, borda e texto.

**Exceção registrada, cores de família do canal:** `FAMILY_COLOR` em `src/lib/channelNames.ts` pinta a faixa de cada canal no mixer (Click `#FF6B35`, Guia `#f59e0b`, Bateria `#ef4444`, Percussão `#f97316`, Baixo `#22c55e`, Synth Bass `#16a34a`, Violão `#ec4899`, Guitarra `#f43f5e`, Teclado `#8b5cf6`, Piano `#a855f7`, Pad `#6366f1`, Ambiência `#818cf8`, Vocal `#06b6d4`, Backing `#0ea5e9`, não reconhecido `#9d9da8`). Essas cores identificam o instrumento e não são código de estado. Algumas repetem cores de estado ou de seção (Click no laranja, Bateria no vermelho do Mute, Guia, Violão e Teclado nas cores de Pré, Final e Ponte). Vieram do mockup v5 aprovado e ficam assim na Parte 1; a paleta de famílias deve ser revista com o design antes da Parte 2, que põe seção e canal na mesma tela.

**Mixer atual (Parte 1, revisão final):**
- **Fader de canal calado** (M ligado ou calado pelo Solo de outro canal): preenchimento cinza neutro, `rgba(255,255,255,0.12)` a `rgba(255,255,255,0.04)`, nunca vermelho, pra bateria calada não parecer bateria tocando. O M aceso continua marcando o mute. Canal tocando usa a cor da família. Regra em `channelFaderFill` (`src/lib/channelRoles.ts`).
- **Lixeira de dois toques** no EDITAR CANAIS (`src/components/ChannelTrashButton.tsx` com o hook `src/hooks/useTwoTapConfirm.ts`): no pé da sobreposição do canal, a pelo menos 24px do lápis, alvo de 44px. O primeiro toque arma: o botão fica no âmbar de alerta (`bg-ps-alert`, `#fbbf24`), com o texto "Apagar?" em escuro (`text-ps-ink`) e o `aria-label` "Toque de novo para apagar o canal <rótulo>". O segundo toque em até 3 segundos apaga. Desarma sozinha no fim dos 3 segundos, com Esc, ao armar a lixeira de outro canal, ao sair do EDITAR CANAIS ou ao trocar de música (`resetKey` do hook). Segundo toque antes de 350 ms (`TWO_TAP_MIN_GAP_MS`, duplo clique) e repetição de tecla (Enter ou Espaço segurado) não contam. Armada, a largura acompanha o texto (padding e `whitespace-nowrap`) e cabe na coluna mais estreita do mixer (96px).

**Regras:**
- **Token novo nunca sobrescreve token antigo.** Todo token novo leva o prefixo `ps-` e mora em `src/styles/ps-tokens.css`; o `src/index.css` não declara nenhum `ps-`. As 38 declarações antigas do `@theme` de `src/index.css` ficam idênticas, e o teste `ps-tokens.test.ts` trava isso. É o que garante que as telas atuais não mudam até a Parte 3.
- **O `primary` dourado (`--color-primary: #d4a843`) não entra em tela nova.** Ele continua só nas telas atuais do DAW (seção 1.5). Em tela nova, "ligado" e ação principal são laranja (`ps-or`).
- Classe sempre escrita inteira no código (string literal), nunca montada por interpolação, senão o Tailwind não gera o CSS.

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

> Os padrões acima são do marketing. Na linguagem nova do produto já existe um `<Button>` de verdade, em `src/components/ui/` (seção 2.6).

### 2.5 Icons — Lucide React

Stack: [`lucide-react`](https://lucide.dev/) — line-art consistente com a marca (Brand Book §4.6).

**Regras:**
- Tamanhos: 12, 14, 16, 20, 24px
- Cor herdada via `text-*` ou explícita via prop `className="text-laranja"`
- Stroke padrão (não usar fill colorido em ícones grandes)
- Para ações: par sempre com texto (não ícone sozinho exceto em UI denso DAW)

### 2.6 Peças base (`src/components/ui/`)

> Linguagem nova (tokens `ps-*`, seção 1.7), da Parte 1 do palco (2026-11-15, publicada na v1.4.15). Primeiro uso: o painel "Editar canal" (`src/components/ChannelEditPanel.tsx`) e o lápis de cada canal no EDITAR CANAIS (`src/App.tsx`). A lixeira do EDITAR CANAIS usa os mesmos tokens, mas é botão próprio (seção 1.7, "Mixer atual"). Teste: `src/components/ui/ui.test.tsx`.

Telas importam sempre do barril:

```tsx
import { Button, Chip, Segmented, Panel, Led, cx } from './components/ui'
```

#### `<Button>`

```tsx
<Button tone="primary" onClick={salvar}>Salvar</Button>
<Button tone="ghost" onClick={fechar}>Cancelar</Button>
<Button icon={<Pencil size={16} />} aria-label="Renomear e escolher papel" />
```

**Props** (aceita também todos os atributos de `<button>`):
- `tone`: `default` (superfície `s1` com linha) | `on` (ligado: laranja suave, texto laranja) | `armed` (armado: anel branco de 2px) | `alert` (alerta: âmbar) | `primary` (ação principal: laranja cheio, texto `on-or`) | `ghost` (transparente, texto `mut`). Default `default`.
- `size`: `md` (altura mínima 44px) | `lg` (altura mínima 56px). Default `md`.
- `pressed`: vira `aria-pressed` (botão de liga e desliga). Use esta prop; um `aria-pressed` passado direto é sobrescrito.
- `icon`: sai antes do texto, escondido do leitor de tela. Botão só com ícone precisa de `aria-label` (o tipo não obriga, a regra sim).
- `type` padrão `"button"`, pra nunca enviar formulário sem querer.
- Estados: anel de foco laranja, `disabled` com 35% de opacidade e sem clique, encolhe de leve ao apertar.

#### `<Chip>`

```tsx
<Chip on={ligado} onClick={alternar}>+1</Chip>
```

- `on`: ligado (laranja suave, texto laranja). Desligado: superfície `s2` com linha.
- `small`: texto de 11px em extrabold com espaçamento (o normal é 13px em bold).
- No mínimo 44x44px, números tabulares, `type="button"` padrão.

#### `<Segmented>`

```tsx
<Segmented
  aria-label="Papel do canal"
  options={[{ value: 'click', label: 'Click' }, { value: 'guide', label: 'Guia' }, { value: 'normal', label: 'Normal' }]}
  value={papel}
  onChange={setPapel}
/>
```

- `options`: lista de `{ value, label, disabled? }`; `value`: o selecionado ou `null`; `onChange(value)`; `aria-label` obrigatório; `className` opcional.
- É um `radiogroup`: cada opção tem `role="radio"` e `aria-checked`. Só a selecionada entra no Tab (sem seleção, a primeira habilitada). Setas andam com volta, pulando as desabilitadas; Home e End vão pra primeira e pra última habilitada; cada movimento já seleciona.
- Opção com no mínimo 62px de largura e 44px de altura. Selecionada: superfície `s3` com anel `line-2`; as outras ficam em `mut`.

#### `<Panel>`

```tsx
<Panel variant="pop" role="dialog" aria-modal="true" aria-labelledby="titulo" className="w-full max-w-[420px] p-5">
  ...
</Panel>
```

- `variant`: `flat` (superfície `s1`, raio 16px) | `raised` (superfície `raised`, raio 16px) | `pop` (painel flutuante: superfície `pop`, raio 14px, anel `line-2` e sombra `ps-pop`). Default `flat`.
- Sem padding próprio: quem usa passa. Repassa todos os atributos de `<div>` (`role`, `aria-*`, `data-*`).

#### `<Led>`

```tsx
<Led state="on" size="sm" />
```

- `state`: `off` (superfície `s3`) | `on` (laranja com brilho) | `live` (musgo claro piscando) | `alert` (âmbar piscando) | `armed` (branco com brilho).
- `size`: `sm` (6px) | `md` (8px). Default `md`.
- `label`: sem ele o Led é só decoração (escondido do leitor de tela); com ele vira imagem com nome (`role="img"` e `aria-label`). O piscar para quando o sistema está com "reduzir movimento".

#### `cx(...partes)`

Junta as classes verdadeiras com espaço. Não resolve conflito entre utilidades: quem chama não passa utilidade oposta.

**Regras das peças:**
- **Largura acompanha o texto:** padding e `whitespace-nowrap`, nunca largura fixa (`w-`) com texto dentro. O padding muda por peça: Button usa `px-ps-pad-x` e `w-auto`; Chip usa `px-2.5`; a opção do Segmented usa `px-3`.
- **Alvo de toque de 44px:** `min-h-ps-touch` no Button `md`, no Chip e na opção do Segmented. Na largura, Button e Chip usam `min-w-ps-touch`; a opção do Segmented usa `min-w-[62px]`.
- **Nunca encolhe abaixo do texto:** Button, Chip e opção do Segmented têm `shrink-0`, então numa linha apertada a peça mantém o tamanho em vez de deixar o texto vazar. Numa linha com várias peças, use `flex-wrap` no contêiner (sem ele a linha estoura). Não passe `flex-1` pra Button ou Chip.
- **Variação substitui a base:** o atributo que muda (fundo, texto, anel, altura, raio) fica só na variação, nunca duas utilidades opostas no mesmo elemento (o projeto não usa `tailwind-merge`). O `className` extra entra no fim e não deve trazer utilidade oposta à da peça.
- **Classes literais:** todas as classes das peças são strings inteiras no código, nunca montadas por interpolação.
- Código de cores da seção 1.7: laranja pra ligado e ação principal, branco pra armado, âmbar pra alerta.

**Limites conhecidos (resolver quando uma tela precisar):** Chip e Segmented ainda não têm o anel de foco laranja do Button; Chip não tem visual de desabilitado; a opção desabilitada do Segmented não tem estilo próprio; o Segmented chama `onChange` de novo quando se clica na opção já selecionada.

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
