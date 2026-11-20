# Playback Studio — Design System

> **Versão:** 1.0
> **Data:** 2026-05-20
> **Atualizado:** 2026-11-19 (seção 2.8: `<HouseAdCard>`, o cartão do anúncio da casa, e `<LivreBadge>`, o selo do Livre na barra do palco novo, Parte 3, não publicado; seção 2.8: `<LimitScreen>`, a tela de limite do Livre com a oferta do primeiro mês, Parte 3, não publicado; seção 2.7: `<StageDialog>`, a janela por cima da Parte 3, não publicado; seções 1.7 e 2.7: palco novo da Parte 2, publicado na v1.4.19 atrás da chave que nascia em Antigo; as correções da revisão macro e a chave nascendo em Novo saíram na v1.4.20, publicada em 2026-11-19; seções 1.7 e 2.6: linguagem nova da Parte 1, publicada na v1.4.15)
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

> Entrou na Parte 1 do palco novo (2026-11-15, publicada na v1.4.15). No app publicado, por enquanto só o painel "Editar canal", o lápis e a lixeira do EDITAR CANAIS usam; as Partes 2 e 3 migram o palco e as outras telas.
>
> O admin (`src/admin/`) usa só a linguagem nova: tokens `ps-*` e as peças de `src/components/ui/`, sem o dourado `primary` (admin central, 2026-11-17, publicado na v1.4.18 em 2026-11-17). O login da web em `/admin` (`src/admin/AdminLogin.tsx`), que era a última tela no estilo antigo, passou pra linguagem nova na Parte 3 (faixa C, 2026-11-20, não publicado; seção 2.9).

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
| Armado (Parte 2) | `--animate-ps-armglow` | `ps-armglow 1.2s ease-in-out infinite` (borda branca de 2px pulsando, com brilho em volta) |
| | `--animate-ps-stripes` | `ps-stripes .9s linear infinite` (as listras a -45 graus andam um período, 19,8px; a peça põe o fundo listrado de 14px) |
| | `--animate-ps-land` | `ps-land .8s ease-out` (brilho de "pousou" na cor da seção, que a peça põe em `--ps-c`) |

**Classes geradas:** `bg-ps-<cor>`, `text-ps-<cor>` e `inset-ring-ps-<cor>` pra cada cor da tabela; `rounded-ps-{xs,sm,md,lg,xl,2xl,pill}`; `text-ps-{micro,label,sm,base,md,lg}`; `px-ps-gutter`, `gap-ps-gap`, `px-ps-pad-x`, `min-h-ps-touch`, `min-w-ps-touch`; `font-ps-sans`, `font-ps-mono`; `shadow-ps-pop`; `animate-ps-blink`. Utilities próprias: `ps-num` (fonte mono com `tabular-nums`: números de largura fixa) e `ps-label` (rótulo pequeno em caixa alta: 10.5px, peso 700, espaçamento .14em, cor `mut`, sem quebra de linha).

**Fontes:** `font-ps-sans` e `font-ps-mono` usam as versões variáveis empacotadas no app (`@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono`, importadas em `src/main.tsx` antes do `index.css`), então funcionam offline no desktop. O `--font-sans` e o `--font-mono` antigos (seção 1.6) continuam vindo do Google Fonts.

**Código de cores com um significado só** (vale pra toda tela nova):

| Cor | Token | Significa |
|---|---|---|
| Laranja | `ps-or`, `ps-or-soft`, `ps-or-line` | Ligado (Button `on`, Chip `on`, Led `on`). O laranja cheio do Button `primary` marca a ação principal de um painel (ex.: Salvar), e o anel de foco também é laranja. |
| Branco | `ps-arm` | Armado (Button `armed`, Led `armed`; no palco novo, o pulo armado: anel branco, listras andando e borda pulsando) |
| Cor da seção | `ps-sec-*` | Seção da música (Intro, Verso, Pré, Refrão, Ponte, Final) |
| Âmbar | `ps-alert`, `ps-alert-soft`, `ps-alert-line` | Alerta (Button `alert`, Led `alert` piscando) |
| Musgo claro | `ps-moss-hi` | Ao vivo (Led `live` piscando) |
| Vermelho e amarelo | `ps-mute`, `ps-solo` | Mute e Solo do mixer |

Neutros (`ink`, `s1` a `s3`, `raised`, `pop`, `well`, `line*`, `bone`, `mut`, `dim`) não carregam significado: são fundo, superfície, borda e texto.

**Cores de família do canal (paleta por grupo da Parte 2, aprovada pelo dono em 2026-11-16; publicada na v1.4.19):** `FAMILY_COLOR` em `src/lib/channelNames.ts` pinta a faixa de cada canal no mixer, uma cor por grupo: Click ardósia `#94a3b8`, Guia pedra `#a8a29e`, Bateria e Percussão areia `#d4a373`, Baixo e Synth Bass `#22c55e`, Violão turquesa `#2dd4bf`, Guitarra verde-água `#14b8a6`, Teclado, Piano, Pad e Ambiência anil `#818cf8`, Vocal e Backing `#06b6d4`, não reconhecido `#878792`. Essas cores identificam o instrumento e não são código de estado. Nenhuma repete as cores de estado (`ps-or`, `ps-arm`, `ps-alert`, `ps-mute`, `ps-solo`; teste em `src/lib/channelNames.test.ts`) nem as de seção (teste em `src/components/stage/sectionPads.test.tsx`), e todas têm contraste de pelo menos 4,5:1 sobre `#121214`. Cor literal no código, só a que vem de dado: a da família e a da seção. Até a v1.4.18 vale a paleta da Parte 1 (Click no laranja, Bateria no vermelho do Mute, Guia, Violão e Teclado nas cores de Pré, Final e Ponte), que era a exceção registrada aqui.

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
import { Button, Chip, Segmented, Panel, Led, TextField, TextArea, Select, Switch, Tabs, TabPanel, Notice, cx } from './components/ui'
```

> **Parte 3 (2026-11-20, [NÃO PUBLICADO]):** entram `TextField`, `TextArea`, `Select`, `Switch`, `Tabs` com `TabPanel` e `Notice` (login, Configurações e as telas da faixa C), e três limites conhecidos saem: Chip e opção do Segmented ganham o anel de foco laranja, o Chip desligado fica a 35% e a opção desligada do Segmented fica a 35% (a marcada desligada continua com cara de escolhida).

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

#### `<TextField>`, `<TextArea>` e `<Select>` (`Field.tsx`, Parte 3)

```tsx
<TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" icon={<Mail size={15} />} />
<TextField label="Senha" type="password" minLength={6} trailing="mín 6" error={erro} />
<TextArea label="Letra" rows={8} help="Uma linha por verso." value={letra} onChange={(e) => setLetra(e.target.value)} />
<Select label="Saída" value={saida} onChange={(e) => setSaida(e.target.value)}>
  <option value="default">Padrão do sistema</option>
</Select>
```

- **Moldura comum:** rótulo em cima (10.5px, caixa alta, `mut`, quebra linha), caixa `s2` com anel `line` (`line-2` no hover), raio 10px, alvo de 44px e fonte de 16px (no iPhone, fonte menor dá zoom na página ao tocar). Ajuda (`help`) e erro (`error`) embaixo, em 13px.
- **Props comuns:** `label` (obrigatório), `hideLabel` (some da vista, o leitor de tela continua lendo), `help`, `error` e `className` (vai no contêiner do campo inteiro; use pra `flex-1` numa linha). O resto vai pro `<input>`, `<textarea>` ou `<select>` (`value`, `onChange`, `type`, `required`, `minLength`, `placeholder`, `autoComplete`, `disabled`, `id`).
- **Ligações:** `<label htmlFor>` com o id do controle (ou `useId`); `aria-describedby` junta o de quem chama, a ajuda e o erro; com erro, `aria-invalid="true"` e o anel troca o cinza pelo âmbar (`inset-ring-ps-alert-line`), texto do erro em `text-ps-alert`. O erro do campo não tem `role="alert"`: aviso do formulário inteiro é um `Notice` com o papel que a tela precisar.
- **Foco:** anel laranja na caixa (`focus-within`), então ícone e `trailing` ficam dentro dele.
- **Só do TextField:** `icon` (antes do texto, escondido do leitor de tela) e `trailing` (texto curto ou botão depois do texto, ex.: "mín 6"); `inputClassName` pro input.
- **Só do TextArea:** `rows` (padrão 4), cresce na vertical (`resize-y`); `textareaClassName`.
- **Só do Select:** seta própria (o `appearance-none` tira a do sistema), lista no tema escuro (`scheme-dark`, opções em `s2`); `selectClassName`. As opções vêm como filhos.
- Desligado: a caixa fica a 35% e o cursor vira "não pode".

#### `<Switch>` (Parte 3)

```tsx
<Switch label="Pan Estéreo Automático" description="Click e Guia no canal L, faixas no canal R" checked={autoPan} onChange={setAutoPan} />
```

- Linha inteira: nome (13px bold) e descrição à esquerda (quebram linha), interruptor à direita. Tocar no nome também alterna (`<label htmlFor>`).
- É um `<button role="switch">` com `aria-checked`, `aria-labelledby` (o nome) e `aria-describedby` (a descrição). Clique, Espaço e Enter chamam `onChange(!checked)`.
- Ligado: trilha `or-soft` com anel `or-line` e bolinha laranja; desligado: trilha `s3` com anel `line-2` e bolinha `mut`. A bolinha anda com transição, parada com "reduzir movimento".
- Alvo de 44 x 44px (a trilha de 44 x 24 fica dentro), anel de foco laranja. `disabled` deixa a linha a 35% e não chama nada. `hideLabel`, `id`, `title` e `className` (da linha) opcionais.

#### `<Tabs>` e `<TabPanel>` (Parte 3)

```tsx
const id = useId()
<Tabs id={id} aria-label="Abas das Configurações" tabs={[{ value: 'Perfil', label: 'Perfil' }, { value: 'Geral', label: 'Geral' }]} value={aba} onChange={setAba} />
<TabPanel tabsId={id} value={aba}>{conteudo}</TabPanel>
```

- Grupo do v5 (`.tabs`): fundo `s1` com anel `line`, 3px de folga; aba em caixa alta (10.5px, extrabold, espaçamento .12em), atual em laranja (`or-soft`, texto `or`, anel `or-line`), as outras em `mut`. Alvo de 44px.
- **Nunca corta nem rola:** as abas descem de linha (`flex-wrap`); cada uma tem pelo menos a largura do texto (`shrink-0`, `basis-auto`) e as da mesma linha dividem a sobra (`grow`).
- **Teclado (WAI-ARIA):** só a aba atual entra no Tab; setas esquerda e direita andam com volta pulando as desligadas, Home e End vão pra primeira e pra última; cada movimento já abre a aba. Clique na aba atual não chama `onChange`.
- **Ids:** a aba é `${id}-tab-${value}`; o painel é `${id}-panel`. O `TabPanel` (um só, com o conteúdo da aba aberta) leva `role="tabpanel"`, o id do painel e `aria-labelledby` da aba aberta; `tabIndex` 0 por padrão (passe -1 quando o conteúdo já começa num campo).
- Aba `disabled`: a 35% e fora do teclado.

#### `<Notice>` (Parte 3)

```tsx
<Notice tone="alert" role="alert">{erro}</Notice>
<Notice role="status">Cadastro feito. Verifica seu email pra confirmar.</Notice>
```

- `tone`: `info` (padrão, neutro: `s2`, texto `bone`, anel `line`) | `alert` (âmbar: `alert-soft`, texto `alert` em semibold, anel `alert-line`). Sem verde de sucesso: a linguagem não tem cor de "deu certo", então confirmação é `info`.
- Raio 10px, 13px, quebra palavra longa. O papel (`role="alert"`, `role="status"`) e o `aria-live` são de quem usa. Repassa os atributos de `<div>`.

#### `cx(...partes)`

Junta as classes verdadeiras com espaço. Não resolve conflito entre utilidades: quem chama não passa utilidade oposta.

**Regras das peças:**
- **Largura acompanha o texto:** padding e `whitespace-nowrap`, nunca largura fixa (`w-`) com texto dentro. O padding muda por peça: Button usa `px-ps-pad-x` e `w-auto`; Chip usa `px-2.5`; a opção do Segmented usa `px-3`.
- **Alvo de toque de 44px:** `min-h-ps-touch` no Button `md`, no Chip e na opção do Segmented. Na largura, Button e Chip usam `min-w-ps-touch`; a opção do Segmented usa `min-w-[62px]`.
- **Nunca encolhe abaixo do texto:** Button, Chip e opção do Segmented têm `shrink-0`, então numa linha apertada a peça mantém o tamanho em vez de deixar o texto vazar. Numa linha com várias peças, use `flex-wrap` no contêiner (sem ele a linha estoura). Não passe `flex-1` pra Button ou Chip.
- **Variação substitui a base:** o atributo que muda (fundo, texto, anel, altura, raio) fica só na variação, nunca duas utilidades opostas no mesmo elemento (o projeto não usa `tailwind-merge`). O `className` extra entra no fim e não deve trazer utilidade oposta à da peça.
- **Classes literais:** todas as classes das peças são strings inteiras no código, nunca montadas por interpolação.
- Código de cores da seção 1.7: laranja pra ligado e ação principal, branco pra armado, âmbar pra alerta.

**Limites conhecidos (resolver quando uma tela precisar):** o Segmented chama `onChange` de novo quando se clica na opção já selecionada (as telas conferem o valor antes de gravar). Resolvidos na Parte 3 (2026-11-20, não publicado): anel de foco laranja no Chip e na opção do Segmented (por dentro, `-outline-offset-2`, porque as opções são coladas), Chip desligado a 35% (`disabled:opacity-35`, cursor de "não pode") e opção desligada do Segmented a 35% quando não está marcada (a marcada desligada, só leitura, continua com cara de escolhida; antes as Saídas de áudio faziam isso por conta própria).

### 2.7 Palco novo (`src/components/stage/`)

> Parte 2 do palco (2026-11-18, publicada na v1.4.19 atrás da chave CONFIG > Geral > Palco, que nascia em Antigo). Na v1.4.20 (publicada em 2026-11-19) a chave nasce em Novo e entram as correções da revisão macro marcadas "v1.4.20" abaixo. Fonte do visual: mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`). Fatos de produto na entrada de 2026-11-18 do `PLAYBACK_STUDIO_FATOS.md`. Usa só tokens `ps-*` (seção 1.7) e as peças de `src/components/ui/` (seção 2.6).

**Quando aparece:** chave em Novo e janela com pelo menos 1024 x 740 px (`isWideStage` em `stageKeys.ts`); senão, o palco antigo inteiro. A troca só vale com a música parada. Na v1.4.20 a chave nasce em Novo: `stageVersionChosen` marca quem trocou a chave, e 'antigo' sem a marca (o padrão que a v1.4.19 gravava) abre no Novo. Tocando, a trava pode deixar o palco novo numa janela abaixo dos 1024 px (iPad girado, janela estreitada): a casca tem no mínimo 1024 px e rola de lado (`data-stage-hscroll`, v1.4.20), sem cortar nada, até a música parar.

**Contrato único** (`src/lib/stageContracts.ts`): `StageView` (o estado da tela, montado pelo `buildStageView` a partir do motor), `StageActions` (o que a tela pede) e `StageClock` (tempo ouvido, posição e níveis). A casca (`StageShell.tsx`) é memorizada no App: só renderiza de novo quando a vista, as ações, os pads ou os painéis mudam. O que muda a cada quadro (playhead, tempo, bolinhas da contagem, VU, anel do Play) não passa pela renderização do App: cada peça lê no próprio quadro com `useFrame`. As contas da contagem e o texto de espera ("em N comp.", "último comp.", "no fim da seção", "CLICK DESLIGADO") ficam num helper puro, `src/lib/transitionView.ts`, usado por todas as peças.

**Peças, na ordem das faixas da tela:**

| Faixa | Peça | O que é |
|---|---|---|
| Barra do app | `StageAppBar` | REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR, HOST (só no computador), CONFIG, INÍCIO, avatar e SAIR; selo ONLINE (musgo) ou OFFLINE (neutro); selo do Livre (`LivreBadge`, seção 2.8, Parte 3, não publicado) ao lado dele; aviso âmbar SAÍDAS depois dos selos |
| Transporte | `TransportBar`, `PlayButton`, `NextPill` | Fim da música (AUTO / PARAR / FADE), COMEÇO, Play com o anel no pulso do click e o número da pré-contagem, LOOP, CLICK, PRÉ-CONT., SEÇÃO ◂ ▸ e o aviso PRÓXIMA / REPETE na cor da seção |
| Onda | `WaveformSections` | onda da música inteira (o maior pico entre os canais Normal, v1.4.21) com a cor de cada seção, linhas de compasso, blocos de seção, selos, seta tracejada até a seção armada, régua embaixo (22px, rótulo a cada 30 s) e agulha pegável (faixa de 24px em volta do playhead, em toda a altura, cursor de pegar; v1.4.21). Sem blocos (sem seções ou no Livre), a onda inteira vale como a régua |
| Botoeira | `SectionPads` | um botão por seção (teclas 1 a 9), AGORA na cor da seção, armado em branco listrado, brilho ao pousar |
| Faixa do meio | `MidStrip` com `TimeCell`, `KeyCell`, `CurrentSectionCell`, `SongCell` e `BigButton` | tempo e BPM, tom com a grade dos 12 tons (na v1.4.20 com "Definir o tom original" ao lado do 0 dos semitons e "Redefinir detecção de tom" embaixo), seção atual com REPETIR, música, PAD e LETRA |
| Mixer | `StageMixer` com `ChannelStrip`, `PanKnob`, `FaderVU` e `MasterStrip` | canais (mínimo 76px, 88px no EDITAR CANAIS) e o PRINCIPAL (116px); altura mínima de 220px, 200px no EDITAR (v1.4.20) |
| Painéis | `RepertoirePanel`, `PadPanel` (fecham com Esc, `panelDismiss.ts`) | gaveta REPERTÓRIOS e painel de pads |
| Modo EDITAR | `SectionEditBar`, `MeterEditor` | MARCAR pelos 6 tipos, ajustar e remover seções; compasso da música |

Lixeira de dois toques fora do mixer (seções no EDITAR e músicas no REPERTÓRIOS): `TwoTapTrashButton`, com a mesma cara da lixeira do EDITAR CANAIS (seção 1.7). Só uma ação de dois toques armada no palco inteiro (`useExclusiveArm` de `panelDismiss.ts`); na v1.4.20 a lixeira de canal do mixer e o COMEÇO armado entram nessa regra. Pergunta de uma linha (renomear, BPM do metrônomo infinito): `src/components/TextPromptDialog.tsx`, nunca `window.prompt` (o Electron não tem). Ícones: SVG de `icons.tsx` (nomes em `iconNames.ts`), nunca caractere que vira emoji no Mac. Exceção registrada: o menu FAIXAS, o diálogo "Sons dos pads" e as ferramentas do admin no EDITAR usam ícones do lucide (também SVG).

**Regras do palco:**
- **Tempo ouvido:** bolinhas, número grande da contagem, playhead e tempo mostrado seguem `heardNow()`, que é o relógio do áudio menos a latência de saída e a latência da entrada do canal (a do tom): `heardTime` em `src/lib/playTimeline.ts`. Nunca o `ctx.currentTime` cru, senão a tela anda na frente do que se ouve.
- **Fader e pan só arrastando:** mudam só depois de o dedo ou o mouse andar 3px na vertical (`DRAG_START_PX` em `src/lib/faderScale.ts`); tocar sem arrastar não muda nada; arrastar de lado rola o mixer e nunca mexe no volume; gesto cancelado pelo navegador volta o valor de antes. Duplo clique volta a 0 dB ou ao centro. Teclado com foco: setas ±1 dB, PageUp e PageDown ±6 dB, Home e End no silêncio e no topo. Escala: 0 dB em 3/4 do curso, topo em +6 dB (`FADER_MAX_DB`); o palco antigo segue com o topo em 1,2.
- **Alvo de toque de 44px, com uma exceção só:** M e S do mixer, colados, com 32px de altura e cerca de 36px de largura, pra caber 14 canais inteiros em 1280px (aprovado no mockup v5), marcados com `data-touch-exception="ms"`. Bloco de seção mais estreito que 44px na onda tem área de toque igual ao próprio retângulo (não invade o vizinho), marcado com `data-narrow`; o controle principal de armar é a botoeira.
- **Avisos âmbar da grade:** `GRID_WARNING_TEXT` em `stageContracts.ts`: SEM GRADE (sem click e sem BPM salvo), SEM CLICK LIDO (contagem pelo BPM salvo) e COMPASSO ASSUMIDO (click sem acento no 1). Em `ps-alert` na célula TEMPO, com a explicação no `title`. No aviso PRÓXIMA, o texto aparece a partir de 1440px; abaixo vira uma luz âmbar (`Led` alert), com o texto inteiro no `title` e na célula TEMPO. "CLICK DESLIGADO" (o operador não vai ouvir a contagem) e o aviso SAÍDAS da barra também são âmbar.
- **Armado:** branco (`ps-arm`), com as animações `--animate-ps-stripes` e `--animate-ps-armglow` juntas (`animate-[var(--animate-ps-stripes),var(--animate-ps-armglow)]`) na botoeira e nos blocos da onda; o aviso PRÓXIMA usa só `animate-ps-armglow`; ao pousar, `animate-ps-land` com a cor da seção em `--ps-c`. Com "reduzir movimento" as três param (o arquivo de tokens zera as variáveis). Não viraram token: a seta tracejada da onda fica parada (sem a animação de marcha), e o equalizador do pad tocando pisca com `animate-ps-blink` em vez das barras subindo do v5.
- **Nenhum texto cortado nem encostando:** botões com largura pelo texto; texto que não cabe desce aos poucos (variável `--ps-fit`) até 12px, sempre a 4px da borda; em caso extremo a capa da música sai. Nome de seção em até 2 linhas, nunca cortado; nome de canal com 2 linhas sempre reservadas.
- **Tudo que mexe na posição tocando é armado ou pede dois toques (v1.4.20):** a régua da onda, tocando, ignora o toque simples e só o arrasto (mais de 8 px) busca, uma vez ao soltar, com a prévia no playhead (Ruling I1-regua-2; com o ponteiro capturado o arrasto pode sair da régua); a agulha pegável segue a mesma regra (v1.4.21, Ruling AGULHA); COMEÇO tocando arma a primeira seção como um pulo e, sem nada pra armar, pede o segundo toque ("VOLTAR?" no âmbar de alerta, com os dois rótulos na mesma célula pra o botão não mudar de largura e o Play ao lado não andar). Parado, os dois buscam na hora.
- **Larguras:** de 1024 a 1279px, capa menor, PAD e LETRA empilhados e mixer rolando de lado com canais inteiros; 14 canais inteiros em 1280px; aviso da grade em texto no PRÓXIMA a partir de 1440px; o nome do repertório na célula da música aparece a partir de 1700px quando a vista traz um (`repertoireName`; o app ainda não guarda nome de repertório e passa nulo). Abaixo de 1024px (só tocando), a casca rola de lado.
- **Canal calado** (M ou Solo de outro) fica cinza, nunca vermelho, como no mixer atual (seção 1.7).
- **Knob que não muda o som fica travado** (apagado, sem arrasto, motivo no `title`): em "Click e Guia separados"; em "4 ou mais", no Click e na Guia; e, na v1.4.20, em "Tudo junto" com o pan automático ligado (o lado vem do papel). O medidor do PRINCIPAL mostra as saídas 1 e 2 da placa, não a VS: a dica do fader e a descrição do grupo dizem o que cada barra é em cada modo (v1.4.20).
- **Verificador:** `scripts/verify-layout/` monta a casca com dados de teste e mede no Chrome headless texto cortado, texto encostando, alvos de toque, rolagem de lado e ordem das faixas. Na Parte 3 (não publicado): 11 estados (o novo `selo`, barra com o selo do Livre, seção 2.8), a casca sem rolar de lado a partir de 1024px e o aviso SAÍDAS sem cobrir os selos nem o menu. Na v1.4.20: 10 estados (o novo `semtom`, grade de tons sem tom original) e 8 tamanhos (1024x740, 1024x768, 1280x760, 1280x800, 1440x900, 1920x1080 e, abaixo de 1024, 900x740 e 810x1080, onde vale "nada inalcançável"), mais a regra do botão só de ícone (o X do PRÓXIMA). Peça nova ou mudança de layout no palco roda ele antes de entregar.

#### `<StageDialog>`: janela por cima (`src/components/stage/StageDialog.tsx`, Parte 3, não publicado)

```tsx
<StageDialog
  open={aberta}
  title="As separações deste mês acabaram"
  onClose={fechar}
  size="sm"
  footer={<><Button tone="ghost" onClick={fechar}>Agora não</Button><Button tone="primary" onClick={verPlanos}>Ver os planos</Button></>}
>
  <p>No Pro são 50 separações por mês.</p>
</StageDialog>
```

- **Quando usar:** janela que pede uma decisão antes de seguir, por cima do palco novo, do antigo e do Separador (primeiro uso: a tela de limite do Livre). Não é pra cartão que não bloqueia nada (o anúncio da casa é cartão no fluxo da tela), nem pra gaveta do palco (REPERTÓRIOS e pads usam `panelDismiss.ts`), nem pra pergunta de uma linha (`TextPromptDialog`). Uma janela dessas por vez. Quem abre garante a regra do Livre: nunca com a música tocando ou na pré-contagem.
- **Props:** `open`, `title` (o `h2`, ligado por `aria-labelledby`), `onClose`, `children` (o conteúdo), `footer` (as ações, fora da rolagem, alinhadas à direita e quebrando linha quando não cabem) e `size`. Fechada não renderiza nada.
- **Tamanhos:** `md` (padrão, `max-w-lg`, até 512px), `sm` (`max-w-sm`, até 384px) e `lg` (`max-w-2xl`, até 672px, pra letra e cifra; Parte 3, 2026-11-20, não publicado). A camada (`fixed inset-0 z-[120]`, fundo `bg-black/60`) deixa 16px de folga em volta (`p-ps-gutter`), então cabe em 360px de largura. A caixa é o `Panel variant="pop"` (seção 2.6) com padding de 20px, nunca mais alta que a tela: o conteúdo rola dentro e o título e o rodapé ficam parados.
- **Fechar:** X do palco (`Icon name="x"`) no canto, `aria-label="Fechar"`, 44 x 44px (`min-h-ps-touch` e `min-w-ps-touch`). O título quebra linha ao lado dele, nunca cortado.
- **Foco:** abre no primeiro elemento focável, que é o Fechar (um Enter solto fecha, nunca compra). Tab e Shift+Tab giram dentro da janela, pulando o que está desligado; clique no texto deixa o foco na caixa (`tabIndex -1`). Ao fechar, ou quando quem chama tira a janela do ar aberta, o foco volta pra quem abriu; se nessa hora o foco já está em outro lugar fora dela, fica lá.
- **Esc e teclas:** o Esc fecha e é tratado na captura da `window`, antes da pilha dos painéis do palco: um REPERTÓRIOS aberto por baixo continua aberto e o pulo armado não é cancelado. Nenhuma tecla de dentro chega aos atalhos do palco (Espaço não toca, 1 a 9 não armam, setas não pulam).
- **Duas janelas abertas (pilha, Parte 3, 2026-11-20, não publicado):** Esc e toque fora valem só pra de cima, que é a aberta por último; uma janela aberta dentro de outra (no conteúdo dela) é sempre a de cima, mesmo abrindo juntas. Cada janela que abre com outra já aberta sobe um degrau acima da mais alta (`z-index` 121, 122...; sozinha fica no `z-[120]`), então a de cima também aparece por cima, venha antes ou depois no código. Fechada a de cima, o próximo Esc fecha a de baixo. Exemplo: a tela de limite do Livre por cima do Metrônomo fecha sozinha.
- **Toque fora:** fecha. Toque dentro não fecha, e apertar dentro e soltar fora (arrastar pra selecionar o texto) também não.
- Teste: `src/components/stage/stageDialog.test.tsx`.

### 2.8 Livre (`src/components/livre/`)

> Parte 3 (2026-11-19, não publicado). As peças do Livre como amostra: o que acabou, o que o Pro faz e a oferta do primeiro mês. Usa só tokens `ps-*` (seção 1.7), as peças de `src/components/ui/` (seção 2.6) e o `StageDialog` (seção 2.7). As regras de quando aparecem ficam em `src/lib/livreRules.ts`, nunca na peça.

#### `<LimitScreen>`: tela de limite (`src/components/livre/LimitScreen.tsx`, textos em `limitCopy.ts`)

```tsx
<LimitScreen
  kind="stage-songs"
  offer={{ status: 'active', expiresAt: '2026-11-21T15:00:00.000Z', prices: { essencial_mensal: 24.9, pro_mensal: 59.9 } }}
  busyPlan={null}
  error={null}
  onChoose={assinar}      // 'essencial_mensal' = Pro Mensal, 'pro_mensal' = Studio Mensal
  onSeePlans={abrirPlanos}
  onClose={fechar}
/>
```

- **Quando usar:** quando o Livre bate num limite (`LimitKind`: `separations`, `stage-songs`, `live`, `repertoire`, `download`), no palco novo, no antigo e no Separador. Quem abre é o `LimitGate` (T16), que busca a oferta, abre o pagamento e passa o erro. A peça só mostra: nunca abre sozinha, e quem chama garante a regra do Livre pela fila de `livreRules.ts` (`queueRequest` e `queueSettle`): **nunca com a música tocando ou na pré-contagem**; pedida tocando, espera a música parar; aberta quando a música volta a tocar, sai e não volta sozinha.
- **Partes:** `StageDialog` `size="sm"` com o título do limite (o único `h2`), o texto do que o Pro faz (`mut`) e, com a oferta no ar, um quadro (`bg-ps-s1`, anel `line`, raio 12px) com "Primeiro mês com desconto", o relógio e os dois botões, um embaixo do outro na largura do quadro (cabe em 360px sem cortar o preço), e a frase do preço cheio de depois.
- **Textos** (`LIMIT_COPY` e `OFFER_COPY`): resultado antes de recurso, sem número de vendas, nenhum travessão. O título das separações não leva o número ("As separações deste mês acabaram"), porque o admin pode dar separações a mais pra conta. O preço com desconto vem do servidor (`offer.prices`); o preço cheio de "Depois do primeiro mês" sai de `PRICES` (`src/content/site.ts`) com `formatReais`, nunca escrito à mão.
- **Três casos da oferta** (`OfferView`): `active` mostra "Assinar o Pro por R$ 24,90" (laranja, `tone="primary"`, a ação principal), "Assinar o Studio por R$ 59,90" (`default`) e, no rodapé, "Agora não" (`ghost`) e "Ver todos os planos" (`default`). `none` e `loading` mostram só "Agora não" e "Ver os planos" (laranja), sem preço nenhum; oferta `active` já vencida ou com data estragada vira o caso sem oferta.
- **Relógio:** "Termina em 47:59:59", em `ps-num`, cor `bone`, neutro (não é alerta, nem âmbar nem laranja), `role="timer"` (o leitor de tela não lê a cada segundo). Anda a cada 1s só com a oferta no ar; horas passam de 24 (`formatCountdown`, `HH:MM:SS`); o segundo quebrado conta inteiro, então nunca mostra 00:00:00 com a oferta no ar. Ao zerar, a oferta some, fica o caso sem oferta e o relógio para. A oferta que chega depois do carregando começa no relógio de agora.
- **Pagamento abrindo** (`busyPlan`): os dois botões da oferta ficam desligados e o do plano escolhido ganha `aria-busy`; "Agora não", "Ver todos os planos" e o X continuam, pra pessoa poder sair.
- **Erro:** frase pronta de quem chama, dentro da tela, em âmbar (`text-ps-alert`, `role="alert"`), embaixo da oferta. Nunca `window.alert` (o app de computador roda de `file://`). Com o erro a oferta continua e dá pra tentar de novo.
- Teste: `src/components/livre/limitScreen.test.tsx`.

#### `<HouseAdCard>`: cartão do anúncio da casa (`src/components/livre/HouseAdCard.tsx`, textos em `adCopy.ts`)

```tsx
<HouseAdCard placement="home" onCta={abrirPlanos} onDismiss={esconder} />
<HouseAdCard placement="separation-done" onCta={abrirPlanos} onDismiss={esconder} />
```

- **Quando usar:** o anúncio da casa do Livre em dois lugares (spec seção 6): `home` na tela inicial, no máximo uma vez por dia, e `separation-done` ao lado do resultado de uma separação que acabou de terminar. Quem monta é o `AdSlot` (T18), que decide pelas regras de `livreRules.ts` (`shouldShowHomeAd`, `shouldShowSeparationAd`, um anúncio grande por sessão), grava `ad_shown` e `ad_clicked` e garante a regra do Livre: **nunca com a música tocando ou na pré-contagem**. A peça só mostra.
- **Partes:** `Panel variant="raised"` (seção 2.6) com padding de 16px, `role="region"` com o nome do título; título em `bone` (16px, negrito), a frase do resultado em `mut` (só no `home`) e, embaixo à direita, "Agora não" (`ghost`) e "Conhecer o Pro" (`primary`, laranja, a ação principal), com alvo de 44px, largura pelo texto e quebrando linha quando não cabem. Títulos e frases quebram linha, nunca cortam.
- **Textos** (`HOME_AD` e `SEPARATION_AD`): "O que o Pro faz por você" com "Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio." e "No Pro você baixa essas faixas e salva na nuvem". Resultado antes de recurso, sem número de vendas, nenhum travessão.
- **É cartão, não janela:** fica no fluxo da tela, sem som, sem vídeo, sem camada por cima, sem posição fixa e sem puxar o foco; nada em volta fica bloqueado. "Agora não" chama `onDismiss` (quem monta esconde de vez).
- Teste: `src/components/livre/houseAd.test.tsx`.

#### `<LivreBadge>`: selo do Livre (`src/components/livre/LivreBadge.tsx`, texto em `adCopy.ts`)

```tsx
<LivreBadge used={2} limit={3} onClick={abrirPlanos} /> // LIVRE · 2 de 3 músicas este mês
```

- **Quando usar:** só na barra do palco novo (`StageAppBar`), ao lado do selo ONLINE/OFFLINE, quando a vista traz `app.livre`. O `buildStageView` só passa `app.livre` com a música parada e fora da pré-contagem (tocando, o selo some); conta paga e admin recebem nulo. O palco antigo e o Separador não têm selo. O toque chama `openLivreBadge` (abre os Planos; a T17 grava o clique como `ad_clicked` no lugar `badge`).
- **Partes:** botão de 44px de alvo (`min-h-ps-touch` e `min-w-ps-touch`) com a pílula visível de 22px, as mesmas medidas do selo ONLINE/OFFLINE (`text-ps-micro`, extranegrito, `tracking-[0.14em]`) nas cores neutras do OFFLINE (`bg-ps-s2`, `text-ps-mut`, anel `line-2`): é informação, não alerta (nada de âmbar) nem ação principal (nada de laranja além do anel de foco de todo botão). `title="Ver os planos"`.
- **Texto** (`livreBadgeText`): "LIVRE · 2 de 3 músicas este mês", nunca mais do que o limite nem número quebrado ou negativo. **Abaixo de 1280px** a barra não tem lugar pro texto inteiro com OFFLINE, HOST e o aviso SAÍDAS: o selo mostra "LIVRE · 2 de 3" (`livreBadgeShort`) e o "Playback Studio" ao lado do PlayMark sai enquanto o selo está na barra; o nome do botão (`aria-label`) continua com o texto inteiro. Medido em 1024px: OFFLINE, o selo curto, SAÍDAS e o menu cabem sem rolar de lado; em 1280px o texto inteiro cabe com o SAÍDAS.
- **Aviso SAÍDAS:** a casca põe o aviso depois do selo do Livre quando ele está na barra (senão depois do ONLINE) e acerta a posição quando o selo aparece e some com o Play.
- **Verificador:** estado `selo` em `scripts/verify-layout/` (OFFLINE, HOST, SAÍDAS e "3 de 3", palco parado), com duas regras novas da casca: a partir de 1024px nada rola de lado, e o aviso SAÍDAS não cobre o ONLINE, o selo nem o menu.
- Teste: `src/components/livre/houseAd.test.tsx` (peça e texto), `src/components/stage/panels.test.tsx` (barra), `src/components/stage/buildStageView.test.ts` (some tocando) e `src/components/stage/stageShell.test.tsx` (posição do SAÍDAS).


### 2.9 Demais telas (Parte 3, faixa C, 2026-11-20, não publicado)

> As telas que sobravam no visual antigo (spec da Parte 3, seção 9, a parte 6) passam pra linguagem do palco: tokens `ps-*` (seção 1.7), as peças de `src/components/ui/` (seção 2.6) e a janela do palco (`StageDialog`, seção 2.7). Muda a cara, não o que as telas fazem. Fatos na entrada de 2026-11-20 (faixa C) do `PLAYBACK_STUDIO_FATOS.md`.

**Regras da faixa:**
- **Janela por cima é o `StageDialog`** (X de 44 px, Esc, toque fora, foco preso e devolvido, pilha). A exceção é o Modo Ao Vivo do host, que abre os Planos por cima de si (ver o item dele).
- **Nenhuma classe do visual antigo:** nada do dourado `primary` nem do ciano `secondary`, nada de `daw-*`, hex solto na classe, texto de 8 ou 9 px, cores prontas do Tailwind (`zinc`, `orange`...), branco solto ou as fontes antigas. O teste de cada tela confere com `oldLanguageClasses` (`src/test/psLanguage.ts`).
- **Verificador:** cada tela tem um estado em `scripts/verify-layout/` (página `telas.tsx`, lista em `telasEstados.ts`), medido em 1024x740, 1280x800, 1920x1080 e, onde a tela abre no celular, 390x844. Abaixo de 500 px o Chrome headless não abre a janela: a página mede dentro de um iframe do tamanho pedido (`?celular=390x844`, que o `run.mjs` põe sozinho).

| Tela | Arquivo | Como ficou |
|---|---|---|
| Metrônomo | `src/components/MetronomeModal.tsx` | `StageDialog size="sm"` "Metrônomo". Andamento (`ps-label` e o nome do andamento em `mut`), BPM em `TextField` numérico com "BPM" no fim e `IconButton` − e + dos lados; TAP TEMPO (`Button` com `Led` aceso enquanto conta) e 2× (`Chip`); Som do click, Subdivisão e Compasso em `Chip small` com `on` e `aria-pressed`, quebrando linha; "Acentuar o 1" em `Switch`; "gerando" em `Notice role="status"` e o click descartado em `Notice tone="alert"`; GERAR CLICK MANUAL (`Button`) e Gerar click IA (`Button tone="primary"`, a ação principal), um embaixo do outro na largura da janela. Fechar não faz nada enquanto o click é gerado. Teste: `MetronomeModal.look.test.tsx` e `MetronomeModal.auto.test.tsx`. |
| Pads da nuvem | `src/components/PadSetsModal.tsx` | `StageDialog size="sm"` "Pads da nuvem". Lista de linhas (`bg-ps-s1`, raio 12px): a escolha é um `<button>` com o ícone, o nome (`bold`) e a descrição (`mut`), os dois com `break-words`; em uso, a linha fica em `ps-or-soft` com anel `or-line`, nome em `ps-or`, `aria-current` e `Led on` ("Em uso"). Admin: lápis e lixeira em `IconButton ghost` ("Renomear <nome>", "Apagar <nome>"); renomear abre dois `TextField` com Cancelar (`ghost`) e Salvar (`primary`); apagar troca a linha pela confirmação em `ps-alert-soft` com Cancelar e Apagar (`alert`). Carregando em `role="status"`, erro em `Notice tone="alert"`, vazio em `Notice`. Teste: `PadSetsModal.test.tsx`. |
| Letra e cifra | `src/components/LyricsEditor.tsx` | `StageDialog size="lg"` "Letra e cifra". Nome da música em `mut`; `TextField` "Artista (para a busca)" e Buscar letra (`Button`) na mesma linha, quebrando no celular; resposta da busca em `Notice role="status"`; `Tabs` LETRA e CIFRA com um `TabPanel`; `TextArea` de 12 linhas nas duas (rótulo escondido, a aba nomeia), a da cifra com `wrap="off"`, `whitespace-pre` e a fonte mono por `style` (o campo traz `font-ps-sans`, e duas utilidades de fonte brigariam). Salvar (`primary`) no pé, com a mensagem de onde salvou à esquerda. Teste: `LyricsEditor.test.tsx`. |
| Teleprompter | `src/components/Teleprompter.tsx` (novo; o `App.tsx` passa a usar na junção) | Tela cheia `bg-ps-ink-0` (z-50, como antes). Barra de cima com `ps-label` TELEPROMPTER e `IconButton ghost` "Fechar o teleprompter"; selo da seção em pílula com a cor da seção (do dado, fundo dela a 12%; sem cor, o verde `#10b981` de antes); letra em `h1` `font-black` de 36 a 96 px (`text-4xl` a `text-8xl`), `whitespace-pre-wrap` e `break-words`; espera em `ps-dim` piscando (`animate-ps-blink`, parado com reduzir movimento). A área da letra rola quando ela não cabe, centralizada por `my-auto` (com `justify-center` o começo ficaria antes da rolagem). Embaixo, `ProgressBar` "Posição na música" (rótulo escondido) e o nome da música. Teste: `Teleprompter.test.tsx`. |
| Novidades | `src/components/WhatsNewModal.tsx` | `StageDialog` (`md`) com o título da entrada mais nova do changelog; `Tag` neutra "Novidades · v<versão>" (informação, não é ligado); itens em lista com ponto `ps-mut`, texto `bone` com `break-words`; Entendi (`primary`) no `footer`. Teste: `WhatsNewModal.test.tsx`. |
| Aviso de atualização | `src/components/UpdateBanner.tsx` | Não é janela: `role="status"` fixo no rodapé (`z-[9999]`, até 440 px), sem puxar o foco. `Panel variant="pop"` com quadrado do ícone em `ps-or-soft` (tem coisa nova), título `bone` em negrito, frase `mut` com `break-words` (nunca `truncate`), ação em `Button primary` (Reiniciar, Baixar ou Atualizar) e `IconButton ghost` "Agora não"; a linha quebra (`flex-wrap`) quando não cabe. Teste: `UpdateBanner.test.tsx`. |
| Tour | `src/components/GuidedTour.tsx` | Spotlight (`data-tour-spotlight`) com 8 px de folga, contorno de 2 px em `var(--color-ps-or)` e o resto escurecido; passo sem alvo com fundo `bg-black/70` (`data-tour-backdrop`, toque fecha). Balão `Panel variant="pop"` de 300 px (`max-w-[calc(100vw-32px)]`), `role="dialog"` com o título (`h2`) como nome: `ps-label` TUTORIAL, título `bone`, texto `mut`, `IconButton ghost` "Fechar o tutorial" no canto, Pular (`ghost`), `IconButton` "Passo anterior" e Próximo ou Concluir (`primary`). A conta da posição não mudou. Teste: `GuidedTour.test.tsx` (inclui a conferência dos alvos dos tours do `App.tsx` e do `SeparatorStudio.tsx`). |
| Página de download | `src/components/DownloadPage.tsx`, `src/components/InstallAppGuide.tsx` | Página do app (`bg-ps-ink`, `font-ps-sans`; continua `site-public`, que dá o foco laranja e o "reduzir movimento"). Selo `Tag` no topo, título em Inter extranegrito com "Playback Studio" em `ps-or` itálico, blocos em `Panel` (celular, ajuda, funções com `data-feature`, requisitos). Cartão do instalador: `rounded-ps-2xl` em `ps-s1` (anel `line`), o do sistema de quem abre em `ps-or-soft` (anel `or-line`, `data-highlighted`); o link Baixar tem a cara do `Button primary` (o kit não tem link com cara de botão: candidato a `ButtonLink`), e "Como instalar?" é `Button ghost`. Guia de instalar: passo numerado num círculo `ps-s2`, texto `mut` com o destaque em `bone`, Instalar app em `Button primary`, QR code em quadro branco (o QR precisa de fundo claro). Teste: `DownloadPage.test.tsx`, `InstallAppGuide.test.tsx`. |
| Modo Ao Vivo do host | `src/components/LiveModeModal.tsx` | **Exceção ao `StageDialog`:** camada própria `fixed inset-0 z-[100] bg-black/60` (toque fora fecha), porque os Planos (`PricingModal`, z-[110]) abrem por cima quando passa do limite de aparelhos e o `StageDialog` (z-[120], foco preso) os taparia. Caixa `Panel variant="pop"` (`role="dialog"`, até 448 px, rola dentro). Cabeçalho com `Led live` "Ao vivo" (só com o servidor ligado), título e `IconButton ghost` "Fechar"; iniciando em `role="status"` com o ícone piscando; erro em `Notice tone="alert"`; QR code em quadro branco; endereço em `font-ps-mono` com `break-all`; "Quem controla" com Liberar todos ou Bloquear todos (`Button`) e um `Chip small` por aparelho (`on` e `aria-pressed` = Controla); Desativar em `Button tone="alert"`. Teste: `LiveModeModal.test.tsx`. |
| Casca do /admin | `src/admin/AdminLogin.tsx`, `src/admin/AdminShell.tsx`, `src/admin/components/ConfirmDialog.tsx` | Login: fundo `ps-ink`, `Panel variant="raised"` de até 384 px, a marca com o `ps-label` Admin (igual à casca), `h1` "Painel do admin", `TextField` E-mail e Senha, erro em `Notice tone="alert"` e Entrar em `Button primary` na largura do painel (ocupado com `aria-busy` e o ícone girando). Casca: as abas continuam `Chip` (o `Tabs` do kit só tem rótulo de texto, e a aba Pendências mostra contador e LED), sem o anel de foco por fora, que o `Chip` agora já tem. `ConfirmDialog`: a nota passa a ser o `TextArea` do kit, com as linhas de ajuda no `help`. O `AdminErrorBoundary` já estava na linguagem nova. Teste: `AdminLogin.test.tsx` e os de `src/admin` que já existiam. |

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
