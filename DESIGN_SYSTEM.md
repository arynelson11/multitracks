# Playback Studio — Design System

> **Versão:** 1.0
> **Data:** 2026-05-20
> **Atualizado:** 2026-11-27 (seção 2.7: o foco do botão que desliga dentro do `<StageDialog>`, manutenção, não publicado, vai na v1.4.26; Parte 3, faixas B e C, publicadas na v1.4.25 em 2026-11-27: os "não publicado" das faixas B e C no cabeçalho e nas seções 1.7, 2.6, 2.7, 2.9, 3.5, 3.6, 4.13 e 4.15 passaram pra versão publicada; junção da v1.4.26: o Separador no palco, Parte 3, faixa D (seção 2.10, a gaveta da direita na 2.7, o anúncio do fim da separação na 2.8 e a cor da voz guia na 1.7), e a tela inicial, a Biblioteca e os Planos, Parte 3, partes 3 a 5 (seção 2.11 e as notas nas seções 2.7, 2.8, 2.9, 4.14 e 4.15), continuam não publicados e vão na v1.4.26); 2026-11-21 (Parte 3 publicada na v1.4.24 em 2026-11-21, Publicação 1b: os "não publicado" da 1b nas seções 2.7 e 2.8 passaram pra versão publicada; revisão macro da 1b, publicada na v1.4.24: o `<Segmented>` ganhou `badge` e `title` na opção, pro AUTO travado com o selo LIVRE; o `<LivreBadge>` ganhou o relógio do Ao Vivo e a forma só de texto, tocando; o `<LimitGate>` fica sem desconto depois do 409 e grava o clique dos Planos; o estado `selo` do verificador usa os portões do Livre; juntada com as faixas B e C, publicado na v1.4.25: na seção 2.9, o Modo Ao Vivo do host ganhou a linha do tempo que falta no Livre; seção 2.10: correções da revisão macro da separação, voz guia sempre na cor da família Guia, frases de instrução em `mut`, gaveta e janela de publicar presas à música, e, na seção 2.8, o lugar do anúncio do fim da separação no Separador no palco: Parte 3, faixa D, não publicado, vai na v1.4.26); 2026-11-20 (seções 2.6 e 2.7: peças novas do kit e a pilha e o tamanho `lg` do `<StageDialog>`; seções 3.5, 3.6, 4.13 e 4.15: login, Criar nova senha e Configurações; seção 2.9: demais telas; Parte 3, faixas B e C, publicado na v1.4.25; seções 2.7 e 2.8 conferidas com o código na T20 da Parte 3, publicado na v1.4.24, Publicação 1b: entram na 2.8 o `<LimitGate>`, a tela de limite ligada ao servidor, e o `<AdSlot>`, o lugar do anúncio da casa; o cartão do fim da separação fica embaixo das faixas no Separador; seção 2.10, Separação, Parte 3, faixa D, e seção 2.11, tela inicial, Biblioteca e Planos, Parte 3, partes 3 a 5: não publicado, vai na v1.4.26); 2026-11-19 (seção 2.8: `<HouseAdCard>`, o cartão do anúncio da casa, e `<LivreBadge>`, o selo do Livre na barra do palco novo, Parte 3, publicado na v1.4.24; seção 2.8: `<LimitScreen>`, a tela de limite do Livre com a oferta do primeiro mês, Parte 3, publicado na v1.4.24; seção 2.7: `<StageDialog>`, a janela por cima da Parte 3, publicado na v1.4.24; seções 1.7 e 2.7: palco novo da Parte 2, publicado na v1.4.19 atrás da chave que nascia em Antigo; as correções da revisão macro e a chave nascendo em Novo saíram na v1.4.20, publicada em 2026-11-19; seções 1.7 e 2.6: linguagem nova da Parte 1, publicada na v1.4.15)
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
> O admin (`src/admin/`) usa só a linguagem nova: tokens `ps-*` e as peças de `src/components/ui/`, sem o dourado `primary` (admin central, 2026-11-17, publicado na v1.4.18 em 2026-11-17). O login da web em `/admin` (`src/admin/AdminLogin.tsx`), que era a última tela no estilo antigo, passou pra linguagem nova na Parte 3 (faixa C, 2026-11-20, publicado na v1.4.25; seção 2.9).

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

**Cores de família do canal (paleta por grupo da Parte 2, aprovada pelo dono em 2026-11-16; publicada na v1.4.19):** `FAMILY_COLOR` em `src/lib/channelNames.ts` pinta a faixa de cada canal no mixer, uma cor por grupo: Click ardósia `#94a3b8`, Guia pedra `#a8a29e`, Bateria e Percussão areia `#d4a373`, Baixo e Synth Bass `#22c55e`, Violão turquesa `#2dd4bf`, Guitarra verde-água `#14b8a6`, Teclado, Piano, Pad e Ambiência anil `#818cf8`, Vocal e Backing `#06b6d4`, não reconhecido `#878792`. Essas cores identificam o instrumento e não são código de estado. Nenhuma repete as cores de estado (`ps-or`, `ps-arm`, `ps-alert`, `ps-mute`, `ps-solo`; teste em `src/lib/channelNames.test.ts`) nem as de seção (teste em `src/components/stage/sectionPads.test.tsx`), e todas têm contraste de pelo menos 4,5:1 sobre `#121214`. Cor literal no código, só a que vem de dado: a da família e a da seção. As marcações da voz guia (no player de reserva do Separador e nas ferramentas da separação) usam a cor da família Guia, `FAMILY_COLOR.guia` (pedra), e nunca o âmbar, que é alerta (Parte 3, faixa D, seção 2.10, não publicado, vai na v1.4.26). Até a v1.4.18 vale a paleta da Parte 1 (Click no laranja, Bateria no vermelho do Mute, Guia, Violão e Teclado nas cores de Pré, Final e Ponte), que era a exceção registrada aqui.

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
import { Button, IconButton, Chip, Segmented, Panel, Led, Tag, TextField, TextArea, Select, SearchField, Switch, Slider, Tabs, TabPanel, Notice, Toast, ProgressBar, FilePicker, cx } from './components/ui'
```

> **Parte 3 (2026-11-20, publicado na v1.4.25):** entram `TextField`, `TextArea`, `Select`, `Switch`, `Tabs` com `TabPanel` e `Notice` (login, Configurações e as telas da faixa C), e, a pedido da faixa D, `IconButton`, `Tag`, `ProgressBar`, `Slider`, `FilePicker`, `Toast` e `SearchField`; três limites conhecidos saem: Chip e opção do Segmented ganham o anel de foco laranja, o Chip desligado fica a 35% e a opção desligada do Segmented fica a 35% (a marcada desligada continua com cara de escolhida).

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

- `options`: lista de `{ value, label, disabled?, badge?, title? }`; `value`: o selecionado ou `null`; `onChange(value)`; `aria-label` obrigatório; `className` opcional.
- `badge`: selo pequeno depois do rótulo (`data-segmented-badge`), nas cores neutras do OFFLINE e do selo do Livre (`bg-ps-s2`, `text-ps-mut`, anel `line-2`, `text-ps-micro` extranegrito): é informação, não alerta. Hoje só o AUTO do "Fim da música" usa, com `LIVRE`, no Livre (o AUTO travado, Ruling AUTO-livre); o selo entra no nome da opção ("AUTO LIVRE"). `title`: a dica da opção.
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
- **Alvo de 44px também no controle:** o `<input>` e o `<select>` levam `min-h-ps-touch` além da caixa (a área de texto não: a altura vem das linhas).
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
- **Ids:** a aba é `${id}-tab-` mais o `value` codificado (`encodeURIComponent`: um `value` com espaço, como "minhas músicas", não quebra o `aria-controls` nem o `aria-labelledby`, que são listas de ids separadas por espaço; revisão macro BC, publicado na v1.4.25); o painel é `${id}-panel`. O `TabPanel` (um só, com o conteúdo da aba aberta) leva `role="tabpanel"`, o id do painel e `aria-labelledby` da aba aberta; `tabIndex` 0 por padrão (passe -1 quando o conteúdo já começa num campo).
- Aba `disabled`: a 35% e fora do teclado.

#### `<Notice>` (Parte 3)

```tsx
<Notice tone="alert" role="alert">{erro}</Notice>
<div role="status" className="empty:absolute">{mensagem ? <Notice>{mensagem}</Notice> : null}</div>
```

- `tone`: `info` (padrão, neutro: `s2`, texto `bone`, anel `line`) | `alert` (âmbar: `alert-soft`, texto `alert` em semibold, anel `alert-line`). Sem verde de sucesso: a linguagem não tem cor de "deu certo", então confirmação é `info`.
- Raio 10px, 13px, quebra palavra longa. O papel (`role="alert"`, `role="status"`) e o `aria-live` são de quem usa. Repassa os atributos de `<div>`.
- **Mensagem que aparece depois (status):** a região `role="status"` fica sempre na página e só o texto entra nela, como no `Toast` (região que nasce já com o texto muitas vezes não é lida pelo NVDA e pelo JAWS). Vazia, `empty:absolute` tira ela do fluxo, sem sobrar o espaço do `gap` (revisão macro BC, 2026-11-20, publicado na v1.4.25). O erro com `role="alert"` pode nascer junto com o texto.

#### `<IconButton>` (Parte 3, pedido da faixa D)

```tsx
<IconButton icon={<Icon name="edit" />} aria-label="Editar a música" onClick={editar} />
<IconButton tone="alert" icon={<Trash2 size={16} />} aria-label="Excluir a música" onClick={excluir} />
```

- O `Button` só com ícone, com `aria-label` **obrigatório no tipo** (TypeScript recusa sem ele). O `title` (dica do mouse) é o mesmo nome quando não vem outro. 44 x 44px, ícone escondido do leitor de tela, `type="button"`.
- Aceita as props do `Button` (menos `icon` como opcional e `children`): `tone` (`default`, `ghost`, `alert` e os outros do Button), `pressed`, `disabled`, `size`.
- Na Parte 3 usam ele: o X das Configurações (`SettingsModal`), o "atualizar a lista" do aparelho de saída (`AudioOutputSelect`), o fechar e o voltar do tour (`GuidedTour`), o "Agora não" do aviso de atualização (`UpdateBanner`), o − e o + do BPM no Metrônomo (`MetronomeModal`), o lápis e a lixeira dos pads da nuvem (`PadSetsModal`), o X do Modo Ao Vivo (`LiveModeModal`) e o X do teleprompter (`Teleprompter`); no kit, o limpar do `SearchField`.

#### `<Tag>` (Parte 3, pedido da faixa D)

```tsx
<Tag>OFFLINE</Tag>
<Tag num>128 BPM</Tag>
<Tag>Mais Popular</Tag>
<Tag>Adicionada</Tag>
<Tag tone="live">AO VIVO</Tag>
```

- Selo estático de metadado (não é botão), na cara do selo ONLINE/OFFLINE da barra do palco: 22px de altura, pílula, 10px extrabold com espaçamento .14em, sem quebra.
- `tone`: `neutral` (padrão: `s2`, texto `mut`, anel `line-2`) | `on` (laranja suave) | `live` (musgo, com a luz acesa) | `alert` (âmbar). `num`: fonte mono de largura fixa (BPM, contagem). `dot`: luz antes do texto (padrão: só no `live`).
- Não muda a caixa do texto: escreva como deve aparecer (OFFLINE em caixa alta, tom como `C#m`).
- O tom segue o código de cores da linguagem, um significado só: `on` (laranja) só pra estado ligado ("EM USO", a opção escolhida), `live` (musgo, com a luz) só pra ao vivo ("AO VIVO", "CONECTADO"), `alert` (âmbar) pra alerta ("SEM CLICK") e o resto `neutral` (metadado, destaque de oferta, "Adicionada", "Mais Popular"). (Revisão macro BC, 2026-11-20, publicado na v1.4.25: os exemplos de antes ensinavam "Mais Popular" no laranja e "Adicionada" no musgo.)

#### `<ProgressBar>` (Parte 3, pedido da faixa D)

```tsx
<ProgressBar label="Separando" value={progresso} max={100} valueText={`${progresso}%`} />
<ProgressBar label="Abrindo no palco" hideLabel value={null} />
```

- `role="progressbar"` com `aria-valuemin` 0, `aria-valuemax` (`max`, padrão 100), `aria-valuenow` e `aria-valuetext` (`valueText`). Nome: o rótulo visível (`ps-label`) ou, com `hideLabel`, o `aria-label`.
- Trilha `s3` de 6px, preenchimento laranja na proporção (valor fora do intervalo fica no limite), com transição. `value={null}` (não dá pra saber quanto falta): um terço da barra piscando, sem `aria-valuenow`; parado com "reduzir movimento".

#### `<Slider>` (Parte 3, pedido da faixa D)

```tsx
<Slider label="Volume geral" value={volume} min={0} max={1} step={0.01} valueText={`${Math.round(volume * 100)}%`} onChange={setVolume} />
```

- `input type="range"` no tema: alvo de 44px de altura, trilha `s3` de 6px preenchida em laranja até o valor (variável `--ps-fill` no WebKit, `-moz-range-progress` no Firefox), polegar `bone` de 20px, anel de foco laranja.
- Props: `label`, `hideLabel`, `value`, `onChange(valor: number)`, `min` (0), `max` (100), `step` (1), `valueText` (mostrado ao lado do nome e lido como `aria-valuetext`), `className` (contêiner), `inputClassName`, e o resto do `<input>` (`disabled`, `aria-*`).

#### `<FilePicker>` (Parte 3, pedido da faixa D)

```tsx
<FilePicker label="Carregar áudio" accept="audio/*,.mp3,.wav" fileName={arquivo?.name} onFiles={([f]) => setArquivo(f)} onClear={() => setArquivo(null)} />
<FilePicker label="Imagem de capa" accept="image/*" droppable={false} onFiles={([f]) => setCapa(f)} />
```

- Um `Button` do kit (`tone` e `icon` opcionais) que abre o seletor do sistema (Enter e Espaço são do próprio botão), o nome escolhido ao lado (`fileName`, de quem chama) e o "Tirar" (`Button ghost`, com `onClear`; texto em `clearLabel`).
- **Arrastar e soltar** (`droppable`, padrão ligado): a área tem borda tracejada `line-2`; arrastando por cima, borda `or-line` e fundo `or-soft`. Sem nome escolhido, a dica "ou arraste o arquivo aqui" (ou "os arquivos"), que some em tela de toque.
- **Filtro:** `onFiles` recebe só o que o `accept` aceita (extensão como `.mp3`, sem diferença de maiúscula; tipo como `audio/*` ou `image/png`), e só o primeiro sem `multiple`. O que o `accept` recusou vai pro `onReject` (pra tela avisar). O seletor é limpo depois de cada escolha (o mesmo arquivo pode ser escolhido de novo).
- `help` (frase embaixo, ligada ao botão), `disabled` (não abre nem aceita soltar), `id` (do input de arquivo). Desligado, a área perde o tracejado (a borda fica transparente, sem mudar o tamanho) e a dica de arrastar, e continua segurando o arrastar e o soltar (`preventDefault`) sem pegar o arquivo: sem isso, no app de computador o arquivo solto ali fazia a janela abrir o arquivo e sair do app (revisão macro BC, publicado na v1.4.25).

#### `<Toast>` (Parte 3, pedido da faixa D)

```tsx
<Toast open={salvo} onClose={() => setSalvo(false)} playing={isPlaying || isCountingIn}>Tudo salvo na biblioteca</Toast>
```

- Aviso curto no topo da tela (centralizado, 16px da borda, `z-[130]`), num `Notice` (`tone` `info` ou `alert`) com sombra `ps-pop`. Some sozinho depois de `duration` (padrão 2,5 s) chamando `onClose`.
- **Nunca por cima da música:** com `playing` (música tocando ou na pré-contagem) não aparece e é descartado (`onClose` na hora); se a música começa com ele na tela, some na hora.
- Não puxa o foco e não bloqueia o toque no que está embaixo (`pointer-events-none`). A região `role="status"` (`aria-live="polite"`) fica sempre na página, vazia quando fechado, pra o leitor de tela anunciar quando o texto entra.

#### `<SearchField>` (Parte 3, pedido da faixa D)

```tsx
<SearchField label="Buscar músicas" placeholder="Buscar por nome ou artista" value={busca} onChange={setBusca} />
```

- O `TextField` com `type="search"` (papel `searchbox`), a lupa no começo e, com texto, o limpar (`IconButton ghost` de 44px, `clearLabel`, padrão "Limpar a busca") no fim, que devolve o foco ao campo. O X do próprio navegador some.
- `onChange(texto)` recebe o texto (não o evento). `onClear` opcional (sem ele, limpar chama `onChange('')`). O rótulo nasce escondido (`hideLabel` padrão `true`): o leitor de tela lê, a lupa e o placeholder dizem o que é.

#### `cx(...partes)`

Junta as classes verdadeiras com espaço. Não resolve conflito entre utilidades: quem chama não passa utilidade oposta.

**Regras das peças:**
- **Largura acompanha o texto:** padding e `whitespace-nowrap`, nunca largura fixa (`w-`) com texto dentro. O padding muda por peça: Button usa `px-ps-pad-x` e `w-auto`; Chip usa `px-2.5`; a opção do Segmented usa `px-3`.
- **Alvo de toque de 44px:** `min-h-ps-touch` no Button `md`, no Chip e na opção do Segmented. Na largura, Button e Chip usam `min-w-ps-touch`; a opção do Segmented usa `min-w-[62px]`.
- **Nunca encolhe abaixo do texto:** Button, Chip e opção do Segmented têm `shrink-0`, então numa linha apertada a peça mantém o tamanho em vez de deixar o texto vazar. Numa linha com várias peças, use `flex-wrap` no contêiner (sem ele a linha estoura). Não passe `flex-1` pra Button ou Chip.
- **Variação substitui a base:** o atributo que muda (fundo, texto, anel, altura, raio) fica só na variação, nunca duas utilidades opostas no mesmo elemento (o projeto não usa `tailwind-merge`). O `className` extra entra no fim e não deve trazer utilidade oposta à da peça.
- **Classes literais:** todas as classes das peças são strings inteiras no código, nunca montadas por interpolação.
- Código de cores da seção 1.7: laranja pra ligado e ação principal, branco pra armado, âmbar pra alerta.

**Limites conhecidos (resolver quando uma tela precisar):** o Segmented chama `onChange` de novo quando se clica na opção já selecionada (as telas conferem o valor antes de gravar). Resolvidos na Parte 3 (2026-11-20, publicado na v1.4.25): anel de foco laranja no Chip e na opção do Segmented (por dentro, `-outline-offset-2`, porque as opções são coladas), Chip desligado a 35% (`disabled:opacity-35`, cursor de "não pode") e opção desligada do Segmented a 35% quando não está marcada (a marcada desligada, só leitura, continua com cara de escolhida; antes as Saídas de áudio faziam isso por conta própria).

### 2.7 Palco novo (`src/components/stage/`)

> Parte 2 do palco (2026-11-18, publicada na v1.4.19 atrás da chave CONFIG > Geral > Palco, que nascia em Antigo). Na v1.4.20 (publicada em 2026-11-19) a chave nasce em Novo e entram as correções da revisão macro marcadas "v1.4.20" abaixo. Fonte do visual: mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`). Fatos de produto na entrada de 2026-11-18 do `PLAYBACK_STUDIO_FATOS.md`. Usa só tokens `ps-*` (seção 1.7) e as peças de `src/components/ui/` (seção 2.6).

**Quando aparece:** chave em Novo e janela com pelo menos 1024 x 740 px (`isWideStage` em `stageKeys.ts`); senão, o palco antigo inteiro. A troca só vale com a música parada. Na v1.4.20 a chave nasce em Novo: `stageVersionChosen` marca quem trocou a chave, e 'antigo' sem a marca (o padrão que a v1.4.19 gravava) abre no Novo. Tocando, a trava pode deixar o palco novo numa janela abaixo dos 1024 px (iPad girado, janela estreitada): a casca tem no mínimo 1024 px e rola de lado (`data-stage-hscroll`, v1.4.20), sem cortar nada, até a música parar.

**Contrato único** (`src/lib/stageContracts.ts`): `StageView` (o estado da tela, montado pelo `buildStageView` a partir do motor), `StageActions` (o que a tela pede) e `StageClock` (tempo ouvido, posição e níveis). A casca (`StageShell.tsx`) é memorizada no App: só renderiza de novo quando a vista, as ações, os pads ou os painéis mudam. O que muda a cada quadro (playhead, tempo, bolinhas da contagem, VU, anel do Play) não passa pela renderização do App: cada peça lê no próprio quadro com `useFrame`. As contas da contagem e o texto de espera ("em N comp.", "último comp.", "no fim da seção", "CLICK DESLIGADO") ficam num helper puro, `src/lib/transitionView.ts`, usado por todas as peças.

**Peças, na ordem das faixas da tela:**

| Faixa | Peça | O que é |
|---|---|---|
| Barra do app | `StageAppBar` | REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR, HOST (só no computador), CONFIG, INÍCIO, avatar e SAIR; selo ONLINE (musgo) ou OFFLINE (neutro); selo do Livre (`LivreBadge`, seção 2.8, Parte 3, publicado na v1.4.24) ao lado dele; aviso âmbar SAÍDAS depois dos selos |
| Transporte | `TransportBar`, `PlayButton`, `NextPill` | Fim da música (AUTO / PARAR / FADE), COMEÇO, Play com o anel no pulso do click e o número da pré-contagem, LOOP, CLICK, PRÉ-CONT., SEÇÃO ◂ ▸ e o aviso PRÓXIMA / REPETE na cor da seção |
| Onda | `WaveformSections` | onda da música inteira (o maior pico entre os canais Normal, v1.4.21) com a cor de cada seção, linhas de compasso, blocos de seção, selos, seta tracejada até a seção armada, régua embaixo (22px, rótulo a cada 30 s) e agulha pegável (faixa de 24px em volta do playhead, em toda a altura, cursor de pegar; v1.4.21). Sem blocos (música sem seções; o Livre tem seções desde a Parte 3, publicada na v1.4.24), a onda inteira vale como a régua |
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
- **Verificador:** `scripts/verify-layout/` monta a casca com dados de teste e mede no Chrome headless texto cortado, texto encostando, alvos de toque, rolagem de lado e ordem das faixas. Na Parte 3 (publicado na v1.4.24): 12 estados (o novo `selo`, barra com o selo do Livre, e o `inicio`, o cartão do anúncio da tela inicial, seção 2.8), a casca sem rolar de lado a partir de 1024px e o aviso SAÍDAS sem cobrir os selos nem o menu. Na v1.4.20: 10 estados (o novo `semtom`, grade de tons sem tom original) e 8 tamanhos (1024x740, 1024x768, 1280x760, 1280x800, 1440x900, 1920x1080 e, abaixo de 1024, 900x740 e 810x1080, onde vale "nada inalcançável"), mais a regra do botão só de ícone (o X do PRÓXIMA). Peça nova ou mudança de layout no palco roda ele antes de entregar.

**Gaveta da direita (Parte 3, faixa D, não publicado, vai na v1.4.26):** a `StageShell` aceita `slots.separation`, posto em `data-stage-drawer-right` (`absolute top-11 bottom-0 right-0 z-40 flex`), espelho da `data-stage-drawer` da REPERTÓRIOS e também fora da área que rola. Sem o slot (música comum ou palco antigo) a gaveta não existe. O painel que entra nela está na seção 2.10.

#### `<StageDialog>`: janela por cima (`src/components/stage/StageDialog.tsx`, Parte 3, publicado na v1.4.24, Publicação 1b)

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

- **Quando usar:** janela que pede uma decisão antes de seguir, por cima do palco novo, do antigo e do Separador (primeiro uso: a tela de limite do Livre, `LimitScreen`, e o "Pagamento aberto no navegador" do `LimitGate`, seção 2.8; depois vieram as telas da seção 2.9). A camada ficava acima da tela de Planos (`PricingModal`, `z-[110]`, como na v1.4.25), por isso quem abre os Planos a partir dela fecha ela antes; desde a Parte 3 (partes 3 a 5, seção 2.11, não publicado, vai na v1.4.26) os Planos também são uma janela do palco e entram na pilha, por cima de qualquer outra aberta. Não é pra cartão que não bloqueia nada (o anúncio da casa é cartão no fluxo da tela), nem pra gaveta do palco (REPERTÓRIOS e pads usam `panelDismiss.ts`), nem pra pergunta de uma linha (`TextPromptDialog`). Em geral uma janela dessas por vez; com duas abertas (a tela de limite do Livre por cima do Metrônomo), vale a pilha (abaixo). Quem abre garante a regra do Livre: nunca com a música tocando ou na pré-contagem.
- **Props:** `open`, `title` (o `h2`, ligado por `aria-labelledby`), `onClose`, `children` (o conteúdo), `footer` (as ações, fora da rolagem, alinhadas à direita e quebrando linha quando não cabem) e `size`. Fechada não renderiza nada. Revisão macro BC (2026-11-20, publicado na v1.4.25): `dismissible` (padrão `true`; com `false` só o X fecha, o Esc e o toque fora não, e o Esc segue pra dentro da janela, pra cancelar uma edição na linha; o X ganha a dica "Fechar" sem o "(Esc)"), pra tela com texto digitado e não salvo; `closeDisabled` (nada fecha: X desligado a 35% com a dica "Espere terminar pra fechar", e nem Esc nem toque fora), pra quando fechar estragaria o que está em andamento.
- **Tamanhos:** `md` (padrão, `max-w-lg`, até 512px), `sm` (`max-w-sm`, até 384px) e `lg` (`max-w-2xl`, até 672px, pra letra e cifra; Parte 3, 2026-11-20, publicado na v1.4.25). A camada (`fixed inset-0 z-[120]`, fundo `bg-black/60`) deixa 16px de folga em volta (`p-ps-gutter`), então cabe em 360px de largura. A caixa é o `Panel variant="pop"` (seção 2.6) com padding de 20px, nunca mais alta que a tela: o conteúdo rola dentro e o título e o rodapé ficam parados.
- **Fechar:** X do palco (`Icon name="x"`) no canto, `aria-label="Fechar"`, 44 x 44px (`min-h-ps-touch` e `min-w-ps-touch`). O título quebra linha ao lado dele, nunca cortado.
- **Foco:** abre no primeiro elemento focável, que é o Fechar (um Enter solto fecha, nunca compra). Tab e Shift+Tab giram dentro da janela, pulando o que está desligado; clique no texto deixa o foco na caixa (`tabIndex -1`). Ao fechar, ou quando quem chama tira a janela do ar aberta, o foco volta pra quem abriu; se nessa hora o foco já está em outro lugar fora dela, fica lá. Com duas janelas (pilha, abaixo), só a de cima pega o foco ao abrir; fechada a de cima com outra ainda aberta, o foco vai pra que ficou (no botão que abriu a de cima, se ele estiver nela, senão no primeiro focável dela). Botão que desliga com o foco nele (manutenção 2026-11-27, [NÃO PUBLICADO], vai na v1.4.26): no Chromium o botão focado que fica desligado perde o foco pro body (o Tab sai pra trás da janela e as teclas chegam ao palco antigo), então quem usa a janela leva o foco pra caixa enquanto o botão está desligado e, no fim, devolve pro botão (falha, pra tentar de novo) ou deixa na caixa (a linha sumiu). A volta só acontece com o foco perdido (body) ou na própria caixa: o foco que está num campo de texto fica nele, e uma janela aberta por cima no meio do envio não perde o dela (re-revisão, N1). Um ajudante só, `useBusyFocus` (`src/components/stage/useBusyFocus.ts`): `hold()` no começo e `release(alvo)` no fim, com o alvo no `data-send` do botão. Usado no Salvar e no Apagar dos pads da nuvem e no Salvar e no Buscar letra da letra e cifra. Nos pads, enquanto envia, os campos ficam só de leitura (não desligados) e o escolher conjunto fica desligado a 35%.
- **Esc e teclas:** o Esc fecha e é tratado na captura da `window`, antes da pilha dos painéis do palco: um REPERTÓRIOS aberto por baixo continua aberto e o pulo armado não é cancelado. Nenhuma tecla de dentro chega aos atalhos do palco (Espaço não toca, 1 a 9 não armam, setas não pulam).
- **Duas janelas abertas (pilha, Parte 3, 2026-11-20, publicado na v1.4.25):** Esc e toque fora valem só pra de cima, que é a aberta por último; uma janela aberta dentro de outra (no conteúdo dela) é sempre a de cima, mesmo abrindo juntas. Cada janela que abre com outra já aberta sobe um degrau acima da mais alta (`z-index` 121, 122...; sozinha fica no `z-[120]`), então a de cima também aparece por cima, venha antes ou depois no código. Fechada a de cima, o próximo Esc fecha a de baixo. Um ouvinte só, da pilha inteira, trata o Esc (com um por janela, uma tecla de verdade fechava duas: o navegador roda o fechar da de cima entre um ouvinte e outro). Exemplo: a tela de limite do Livre por cima do Metrônomo fecha sozinha. A pilha fica em `src/components/stage/stageDialogStack.ts` e exporta `hasOpenStageDialog()` (junção da 1b com as faixas B e C): quem trata o Esc por conta própria fora da pilha (as Configurações, seção 4.15) sai cedo quando há janela do palco aberta, senão um Esc fecharia as duas.
- **Toque fora:** fecha. Toque dentro não fecha, e apertar dentro e soltar fora (arrastar pra selecionar o texto) também não.
- Teste: `src/components/stage/stageDialog.test.tsx`.

### 2.8 Livre (`src/components/livre/`)

> Parte 3 (2026-11-19, publicado na v1.4.24 em 2026-11-21, Publicação 1b). As peças do Livre como amostra: o que acabou, o que o Pro faz e a oferta do primeiro mês. Usa só tokens `ps-*` (seção 1.7), as peças de `src/components/ui/` (seção 2.6) e o `StageDialog` (seção 2.7). As regras de quando aparecem ficam em `src/lib/livreRules.ts`, nunca na peça.

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

- **Quando usar:** quando o Livre bate num limite (`LimitKind`: `separations`, `stage-songs`, `live`, `repertoire`, `download`; mais a tela `live-devices` do celular a mais no Ao Vivo, `LimitScreenKind`, que abre a oferta como `live`), no palco novo, no antigo e no Separador. Quem abre é o `LimitGate` (abaixo), que busca a oferta, abre o pagamento e passa o erro. A peça só mostra: nunca abre sozinha, e quem chama garante a regra do Livre pela fila de `livreRules.ts` (`queueRequest` e `queueSettle`): **nunca com a música tocando ou na pré-contagem**; pedida tocando, espera a música parar; aberta quando a música volta a tocar, sai e não volta sozinha.
- **Partes:** `StageDialog` `size="sm"` com o título do limite (o único `h2`), o texto do que o Pro faz (`mut`) e, com a oferta no ar, um quadro (`bg-ps-s1`, anel `line`, raio 12px) com "Primeiro mês com desconto", o relógio e os dois botões, um embaixo do outro na largura do quadro (cabe em 360px sem cortar o preço), e a frase do preço cheio de depois.
- **Textos** (`LIMIT_COPY` e `OFFER_COPY`): resultado antes de recurso, sem número de vendas, nenhum travessão. O título das separações não leva o número ("As separações deste mês acabaram"), porque o admin pode dar separações a mais pra conta. O do celular a mais ("No Livre, só 1 celular da banda controla o palco") não fala dos minutos, que ainda sobram (publicado na v1.4.24). O preço com desconto vem do servidor (`offer.prices`); o preço cheio de "Depois do primeiro mês" sai de `PRICES` (`src/content/site.ts`) com `formatReais`, nunca escrito à mão.
- **Três casos da oferta** (`OfferView`): `active` mostra "Assinar o Pro por R$ 24,90" (laranja, `tone="primary"`, a ação principal), "Assinar o Studio por R$ 59,90" (`default`) e, no rodapé, "Agora não" (`ghost`) e "Ver todos os planos" (`default`). `none` e `loading` mostram só "Agora não" e "Ver os planos" (laranja), sem preço nenhum; oferta `active` já vencida ou com data estragada vira o caso sem oferta.
- **Relógio:** "Termina em 47:59:59", em `ps-num`, cor `bone`, neutro (não é alerta, nem âmbar nem laranja), `role="timer"` (o leitor de tela não lê a cada segundo). Anda a cada 1s só com a oferta no ar; horas passam de 24 (`formatCountdown`, `HH:MM:SS`); o segundo quebrado conta inteiro, então nunca mostra 00:00:00 com a oferta no ar. Ao zerar, a oferta some, fica o caso sem oferta e o relógio para. A oferta que chega depois do carregando começa no relógio de agora.
- **Pagamento abrindo** (`busyPlan`): os dois botões da oferta ficam desligados e o do plano escolhido ganha `aria-busy`; "Agora não", "Ver todos os planos" e o X continuam, pra pessoa poder sair.
- **Erro:** frase pronta de quem chama, dentro da tela, em âmbar (`text-ps-alert`, `role="alert"`), embaixo da oferta. Nunca `window.alert` (o app de computador roda de `file://`). Com o erro a oferta continua e dá pra tentar de novo.
- Teste: `src/components/livre/limitScreen.test.tsx`.

#### `<LimitGate>`: tela de limite ligada ao servidor (`src/components/livre/LimitGate.tsx`)

```tsx
{livre.limit !== null && (
  <LimitGate key={livre.limit} kind={livre.limit} onClose={livre.closeLimit} onSeePlans={() => { livre.closeLimit(); abrirPlanos() }} />
)}
```

- **Quando usar:** é o que o App (nos dois palcos) e o Separador montam quando o `useLivre` libera um pedido de limite (`livre.limit`), já com a música parada. Um por tipo de limite (`key={livre.limit}`): limite novo é tela nova, com a própria abertura da oferta e o próprio anúncio visto. O Separador monta o dele e, com o Separador aberto, o do App não aparece.
- **O que faz:** ao montar, pede a janela da oferta ao servidor uma vez (`fetchOffer({ open: true, trigger })`; o celular a mais abre como `live`, `offerTriggerFor`) e grava o `ad_shown` do lugar `limit`; o StrictMode do desenvolvimento reaproveita o mesmo pedido. Mostra a `LimitScreen` com o carregando e depois a oferta. Escolher o Pro ou o Studio só vale com a oferta no ar: grava o `ad_clicked` do `limit`, desliga os botões enquanto o pagamento abre e chama `startCheckout({ planKey, offer: true })`; dois cliques abrem um pagamento só. Erro vira a frase pronta dentro da tela; com `offerEnded`, o desconto sai de vez e a frase fica (a oferta não é lida de novo: uma leitura que ainda dissesse `active` traria de volta o desconto que o checkout recusou).
- **Pagamento aberto no navegador:** no computador o pagamento abre no navegador do sistema, e a tela troca por um `StageDialog` `size="sm"` com "Pagamento aberto no navegador", "Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes." e "Entendi" (laranja). Na web a página do pagamento abre no lugar.
- **Ver os planos:** quem monta passa um `onSeePlans` que fecha a tela de limite e só depois abre os Planos (a janela do palco fica por cima dos Planos). O `LimitGate` embrulha esse `onSeePlans`: "Ver os planos" e "Ver todos os planos" gravam o `ad_clicked` do `limit` antes de chamar, no App e no Separador.
- Teste: `src/components/livre/limitGate.test.tsx`.

#### `<HouseAdCard>`: cartão do anúncio da casa (`src/components/livre/HouseAdCard.tsx`, textos em `adCopy.ts`)

```tsx
<HouseAdCard placement="home" onCta={abrirPlanos} onDismiss={esconder} />
<HouseAdCard placement="separation-done" onCta={abrirPlanos} onDismiss={esconder} />
```

- **Quando usar:** o anúncio da casa do Livre em dois lugares (spec seção 6): `home` na tela inicial, no máximo uma vez por dia, e `separation-done` embaixo das faixas de uma separação que acabou de terminar, no Separador. Quem monta é o `AdSlot` (abaixo), que decide pelas regras de `livreRules.ts` (`shouldShowHomeAd`, `shouldShowSeparationAd`, um anúncio grande por sessão), grava `ad_shown` e `ad_clicked` e garante a regra do Livre: **nunca com a música tocando ou na pré-contagem**. A peça só mostra.
- **Partes:** `Panel variant="raised"` (seção 2.6) com padding de 16px, `role="region"` com o nome do título; título em `bone` (16px, negrito), a frase do resultado em `mut` (só no `home`) e, embaixo à direita, "Agora não" (`ghost`) e "Conhecer o Pro" (`primary`, laranja, a ação principal), com alvo de 44px, largura pelo texto e quebrando linha quando não cabem. Títulos e frases quebram linha, nunca cortam.
- **Textos** (`HOME_AD` e `SEPARATION_AD`): "O que o Pro faz por você" com "Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio." e "No Pro você baixa essas faixas e salva na nuvem". Resultado antes de recurso, sem número de vendas, nenhum travessão.
- **É cartão, não janela:** fica no fluxo da tela, sem som, sem vídeo, sem camada por cima, sem posição fixa e sem puxar o foco; nada em volta fica bloqueado. "Agora não" chama `onDismiss` (quem monta esconde de vez).
- Teste: `src/components/livre/houseAd.test.tsx` (e o `AdSlot` em `adSlot.test.tsx`).
- **Na tela inicial** (T18, publicado na v1.4.24): embaixo dos dois botões, num `div` `mt-6 w-full max-w-md` da coluna `px-6` do App (no celular de 390px, o cartão fica com 342px). Verificador: estado `inicio` em `scripts/verify-layout/` (o `AdSlot` de verdade na largura da janela, nos 8 tamanhos e em 390x844, este pela rota `/moldura` do verificador, a mesma das faixas B e C). Na tela inicial nova (`HomeScreen`, seção 2.11, não publicado, vai na v1.4.26), o mesmo `div` (`data-home-ad`, com `empty:hidden`) fica embaixo dos dois cartões, na coluna da `HomeScreen`, de 16px de folga.
- **No Separador** (publicado na v1.4.24, a tela ainda no visual antigo): numa faixa no fim da tela, embaixo das faixas, com `border-t` e o cartão no centro com até 28rem de largura (`grid-cols-[minmax(0,28rem)] justify-center`); a faixa some sem o cartão (`empty:hidden`). No Separador no palco (Parte 3, faixa D, seção 2.10, não publicado, vai na v1.4.26): no player de reserva, a mesma faixa com `border-t border-ps-line` e `bg-ps-s1`; com o palco novo, a separação abre no palco e o anúncio vai pro topo da aba FAIXAS da gaveta SEPARAÇÃO (seção 2.10), com as mesmas regras (só no Livre, parado, enquanto a separação que acabou de terminar é a atual).

#### `<AdSlot>`: lugar do anúncio da casa (`src/components/livre/AdSlot.tsx`)

```tsx
<AdSlot placement="home" userId={user.id} isLivre={livre.isLivre} quiet={engineQuiet} onCta={abrirPlanos} />
<AdSlot placement="separation-done" userId={userId} isLivre={isLivre} quiet={quiet} justSeparated={justSeparated} onCta={abrirPlanos} />
```

- **Quando usar:** onde o anúncio da casa pode aparecer (tela inicial e fim da separação). Ele decide uma vez, na primeira vez em que `quiet` (música parada de verdade: nem tocando nem na pré-contagem; no Separador, a dele e a do palco) chega verdadeiro com ele montado (o do fim da separação espera também `justSeparated`): só no Livre, com conta logada, no máximo um anúncio grande por sessão e, na tela inicial, uma vez por dia de Brasília (`shouldShowHomeAd` e `shouldShowSeparationAd` de `livreRules.ts`, com o dia e a sessão lidos na hora). Ao decidir mostrar, grava a sessão, o dia (tela inicial) e o `ad_shown` do lugar, uma vez.
- **Comportamento:** a música que começa esconde o cartão e ele volta quando ela para, sem contar de novo; "Conhecer o Pro" grava o `ad_clicked` do lugar e chama `onCta` (os Planos abrem ali mesmo); "Agora não" esconde de vez nesta tela. Nada aqui mexe no som. Sem `setState` em efeito (Ruling R8): a decisão assenta na renderização e o efeito só grava fora do React.
- Teste: `src/components/livre/adSlot.test.tsx`.

#### `<LivreBadge>`: selo do Livre (`src/components/livre/LivreBadge.tsx`, texto em `adCopy.ts`)

```tsx
<LivreBadge used={2} limit={3} onClick={abrirPlanos} /> // LIVRE · 2 de 3 músicas este mês
<LivreBadge used={2} limit={3} liveLeftMs={432000} />   // tocando, com a sessão do Ao Vivo: LIVRE · 07:12 com a banda hoje (só texto)
```

- **Quando usar:** só na barra do palco novo (`StageAppBar`), ao lado do selo ONLINE/OFFLINE, quando a vista traz `app.livre`. O `buildStageView` passa `app.livre` com a música parada e fora da pré-contagem (tocando, o selo some, menos com a sessão do Ao Vivo ligada, abaixo); conta paga e admin recebem nulo. O palco antigo e o Separador não têm selo. O toque chama `openLivreBadge`, que grava o `ad_clicked` do lugar `badge` e abre os Planos (o selo não grava anúncio visto).
- **Com a sessão do Ao Vivo ligada** (Ruling relogio-livre, revisão macro da 1b): `liveLeftMs` é o tempo que falta hoje com a banda, e o selo mostra "LIVRE · 07:12 com a banda hoje" (abaixo de 1280px, "LIVRE · 07:12", `livreBadgeLiveShort`, mais estreito que o "LIVRE · 3 de 3"); o nome tem as duas contas ("LIVRE · 2 de 3 músicas este mês. No Livre, restam 07:12 hoje com a banda."). Com a sessão ligada a vista mantém o selo também tocando, com `tappable` falso: sem `onClick`, o selo é um `span` com `role="timer"` do mesmo tamanho, só texto, e nada abre por cima do palco. A mesma frase ("No Livre, restam 07:12 hoje com a banda.", `livreLiveLeftText`) aparece dentro da janela do Ao Vivo (`LiveModeModal`, prop `livreTimeLeft`).
- **Partes:** botão de 44px de alvo (`min-h-ps-touch` e `min-w-ps-touch`) com a pílula visível de 22px, as mesmas medidas do selo ONLINE/OFFLINE (`text-ps-micro`, extranegrito, `tracking-[0.14em]`) nas cores neutras do OFFLINE (`bg-ps-s2`, `text-ps-mut`, anel `line-2`): é informação, não alerta (nada de âmbar) nem ação principal (nada de laranja além do anel de foco de todo botão). `title="Ver os planos"`.
- **Texto** (`livreBadgeText`): "LIVRE · 2 de 3 músicas este mês", nunca mais do que o limite nem número quebrado ou negativo. **Abaixo de 1280px** a barra não tem lugar pro texto inteiro com OFFLINE, HOST e o aviso SAÍDAS: o selo mostra "LIVRE · 2 de 3" (`livreBadgeShort`) e o "Playback Studio" ao lado do PlayMark sai enquanto o selo está na barra; o nome do botão (`aria-label`) continua com o texto inteiro. Medido em 1024px: OFFLINE, o selo curto, SAÍDAS e o menu cabem sem rolar de lado; em 1280px o texto inteiro cabe com o SAÍDAS.
- **Aviso SAÍDAS:** a casca põe o aviso depois do selo do Livre quando ele está na barra (senão depois do ONLINE) e acerta a posição quando o selo aparece e some com o Play.
- **Verificador:** estado `selo` em `scripts/verify-layout/` (OFFLINE, HOST, SAÍDAS e "3 de 3", palco parado, com os portões de verdade do Livre, `stageGatesFor('free')`, então o AUTO travado com o selo LIVRE também é medido), com duas regras novas da casca: a partir de 1024px nada rola de lado, e o aviso SAÍDAS não cobre o ONLINE, o selo nem o menu. As duas regras têm prova no estado `quebrado` (palco de mentira com a casca mais larga que a caixa e o SAÍDAS em cima do ONLINE; 18 falhas com as das faixas B e C, uma por ramo e o texto acima do começo da rolagem em duas). O selo com o relógio do Ao Vivo ("LIVRE · 07:12") é mais estreito que o "LIVRE · 3 de 3" medido aqui.
- Teste: `src/components/livre/houseAd.test.tsx` (peça e texto), `src/components/stage/panels.test.tsx` (barra), `src/components/stage/buildStageView.test.ts` (some tocando) e `src/components/stage/stageShell.test.tsx` (posição do SAÍDAS).


### 2.9 Demais telas (Parte 3, faixa C, 2026-11-20, publicado na v1.4.25)

> As telas que sobravam no visual antigo (spec da Parte 3, seção 9, a parte 6) passam pra linguagem do palco: tokens `ps-*` (seção 1.7), as peças de `src/components/ui/` (seção 2.6) e a janela do palco (`StageDialog`, seção 2.7). Muda a cara, não o que as telas fazem. Fatos na entrada de 2026-11-20 (faixa C) do `PLAYBACK_STUDIO_FATOS.md`.

**Regras da faixa:**
- **Janela por cima é o `StageDialog`** (X de 44 px, Esc, toque fora, foco preso e devolvido, pilha). A exceção é o Modo Ao Vivo do host, que abre os Planos por cima de si (ver o item dele).
- **Nenhuma classe do visual antigo:** nada do dourado `primary` nem do ciano `secondary`, nada de `daw-*`, hex solto na classe, texto de 8 ou 9 px, cores prontas do Tailwind (`zinc`, `orange`...), branco solto ou as fontes antigas. O teste de cada tela confere com `oldLanguageClasses` (`src/test/psLanguage.ts`).
- **Verificador:** cada tela tem um estado em `scripts/verify-layout/` (página `telas.tsx`, lista em `telasEstados.ts`), medido nos 8 tamanhos do palco e, onde a tela abre no celular, em 390x844. Abaixo de 500 px o Chrome headless não abre a janela: a página mede dentro de um iframe do tamanho pedido (rota `/moldura` do `run.mjs`, a mesma das telas da faixa B).

| Tela | Arquivo | Como ficou |
|---|---|---|
| Metrônomo | `src/components/MetronomeModal.tsx` | `StageDialog size="sm"` "Metrônomo". Andamento (`ps-label` e o nome do andamento em `mut`), BPM em `TextField` numérico com "BPM" no fim e `IconButton` − e + dos lados; TAP TEMPO (`Button` com `Led` aceso enquanto conta) e 2× (`Chip`); Som do click, Subdivisão e Compasso em `Chip small` com `on` e `aria-pressed`, quebrando linha; "Acentuar o 1" em `Switch`; "gerando" em `Notice role="status"` e o click descartado em `Notice tone="alert"`; GERAR CLICK MANUAL (`Button`) e Gerar click IA (`Button tone="primary"`, a ação principal), um embaixo do outro na largura da janela. Enquanto o click é gerado, `closeDisabled` (X desligado a 35% com a dica, nem Esc nem toque fora fecham); a amostra do click tem prazo de 15 s, então a janela não fica presa (revisão macro BC, publicado na v1.4.25). Teste: `MetronomeModal.look.test.tsx`, `MetronomeModal.auto.test.tsx` e `MetronomeModal.deadline.test.tsx`. |
| Pads da nuvem | `src/components/PadSetsModal.tsx` | `StageDialog size="sm"` "Pads da nuvem". Lista de linhas (`bg-ps-s1`, raio 12px): a escolha é um `<button>` com o ícone, o nome (`bold`) e a descrição (`mut`), os dois com `break-words`; em uso, a linha fica em `ps-or-soft` com anel `or-line`, nome em `ps-or`, `aria-current` e `Led on` ("Em uso"). Admin: lápis e lixeira em `IconButton ghost` ("Renomear <nome>", "Apagar <nome>"); renomear abre dois `TextField` com Cancelar (`ghost`) e Salvar (`primary`); apagar troca a linha pela confirmação em `ps-alert-soft` com Cancelar (com o foco) e Apagar (`alert`). Renomeando ou apagando, `dismissible={false}` e o Esc na linha cancela só ela (revisão macro BC, publicado na v1.4.25). Carregando em `role="status"`, erro em `Notice tone="alert"`, vazio em `Notice`. Teste: `PadSetsModal.test.tsx`. |
| Letra e cifra | `src/components/LyricsEditor.tsx` | `StageDialog size="lg"` "Letra e cifra". Nome da música em `mut`; `TextField` "Artista (para a busca)" e Buscar letra (`Button`) na mesma linha, quebrando no celular; resposta da busca em `Notice role="status"`; `Tabs` LETRA e CIFRA com um `TabPanel`; `TextArea` de 12 linhas nas duas (rótulo escondido, a aba nomeia), a da cifra com `wrap="off"`, `whitespace-pre` e a fonte mono por `style` (o campo traz `font-ps-sans`, e duas utilidades de fonte brigariam). Salvar (`primary`) no pé, com a mensagem de onde salvou à esquerda. Com letra, cifra ou letra sincronizada diferentes do último salvo, `dismissible={false}`: Esc e toque fora não fecham, só o X (revisão macro BC, publicado na v1.4.25). Teste: `LyricsEditor.test.tsx`. |
| Teleprompter | `src/components/Teleprompter.tsx` (novo; o `App.tsx` usa desde a junção das faixas B e C) | Tela cheia `bg-ps-ink-0` (z-50, como antes). Barra de cima com `ps-label` TELEPROMPTER e `IconButton ghost` "Fechar o teleprompter"; selo da seção em pílula com a cor da seção (do dado, fundo dela a 12%; sem cor, o verde `#10b981` de antes); letra em `h1` `font-black` de 36 a 96 px (`text-4xl` a `text-8xl`), `whitespace-pre-wrap` e `break-words`; espera em `ps-dim` piscando (`animate-ps-blink`, parado com reduzir movimento). A área da letra rola quando ela não cabe, centralizada por `my-auto` (com `justify-center` o começo ficaria antes da rolagem). Embaixo, `ProgressBar` "Posição na música" (rótulo escondido; o valor vai sem arredondar, pra barra andar contínua) e o nome da música. Teste: `Teleprompter.test.tsx`. |
| Novidades | `src/components/WhatsNewModal.tsx` | `StageDialog` (`md`) com o título da entrada mais nova do changelog; `Tag` neutra "Novidades · v<versão>" (informação, não é ligado); itens em lista com ponto `ps-mut`, texto `bone` com `break-words`; Entendi (`primary`) no `footer`. Teste: `WhatsNewModal.test.tsx`. |
| Aviso de atualização | `src/components/UpdateBanner.tsx` | Não é janela: `role="status"` fixo no rodapé (`z-[9999]`, até 440 px), sem puxar o foco; a região fica sempre na página (vazia sem aviso, `pointer-events-none`) e o aviso entra nela (revisão macro BC). `Panel variant="pop"` com quadrado do ícone neutro (`ps-s2`, ícone `bone`, anel `line`; antes `ps-or-soft`, mas laranja é ligado), título `bone` em negrito, frase `mut` com `break-words` (nunca `truncate`), ação em `Button primary` (Reiniciar, Baixar ou Atualizar) e `IconButton ghost` "Agora não"; a linha quebra (`flex-wrap`) quando não cabe. Teste: `UpdateBanner.test.tsx`. |
| Tour | `src/components/GuidedTour.tsx` | Spotlight (`data-tour-spotlight`) com 8 px de folga, contorno de 2 px em `var(--color-ps-or)` e o resto escurecido; passo sem alvo com fundo `bg-black/70` (`data-tour-backdrop`, toque fecha). Balão `Panel variant="pop"` de 300 px (`max-w-[calc(100vw-32px)]`), `role="dialog"` com o título (`h2`) como nome: `ps-label` TUTORIAL, título `bone`, texto `mut`, `IconButton ghost` "Fechar o tutorial" no canto, Pular (`ghost`), `IconButton` "Passo anterior" e Próximo ou Concluir (`primary`). A conta da posição não mudou. Teste: `GuidedTour.test.tsx` (inclui a conferência dos alvos dos tours do `App.tsx` e do `SeparatorStudio.tsx`). |
| Página de download | `src/components/DownloadPage.tsx`, `src/components/InstallAppGuide.tsx` | Página do app (`bg-ps-ink`, `font-ps-sans`; continua `site-public`, que dá o foco laranja e o "reduzir movimento"). Selo `Tag` no topo, título em Inter extranegrito com "Playback Studio" em `ps-or` itálico, blocos em `Panel` (celular, ajuda, funções com `data-feature`, requisitos). Cartão do instalador: `rounded-ps-2xl` em `ps-s1` (anel `line`), o do sistema de quem abre com anel `line-3` e o `Tag` neutro "SEU SISTEMA" no alto (`data-highlighted`; revisão macro BC, decisão do coordenador: antes `ps-or-soft` com anel `or-line`); o link Baixar tem a cara do `Button primary` (o kit não tem link com cara de botão: candidato a `ButtonLink`), e "Como instalar?" é `Button ghost`. Guia de instalar: passo numerado num círculo `ps-s2`, texto `mut` com o destaque em `bone`, "Você já está usando o app instalado." em `mut` (antes no musgo do ao vivo), Instalar app em `Button primary`, QR code em quadro branco (o QR precisa de fundo claro). Teste: `DownloadPage.test.tsx`, `InstallAppGuide.test.tsx`. |
| Modo Ao Vivo do host | `src/components/LiveModeModal.tsx` | **Exceção ao `StageDialog`:** camada própria `fixed inset-0 z-[100] bg-black/60` (toque fora fecha), porque os Planos abrem por cima quando passa do limite de aparelhos (na v1.4.25, o `PricingModal` em z-[110], que o `StageDialog`, z-[120] e foco preso, taparia; desde a Parte 3, partes 3 a 5, não publicado, vai na v1.4.26, os Planos são uma janela do palco, z-[120] ou acima, seção 2.11) e um `StageDialog` no Ao Vivo os disputaria. Caixa `Panel variant="pop"` (`role="dialog"`, até 448 px, rola dentro; a área que rola usa `justify-center-safe`, que centraliza só quando cabe: com `justify-center`, a banda inteira conectada jogava o topo do QR acima do começo da rolagem; apertar dentro e soltar fora não fecha; revisão macro BC, publicado na v1.4.25). Cabeçalho com `Led live` "Ao vivo" (só com o servidor ligado), título e `IconButton ghost` "Fechar"; iniciando em `role="status"` com o ícone piscando; erro em `Notice tone="alert"`; QR code em quadro branco; endereço em `font-ps-mono` com `break-all`; "Quem controla" com Liberar todos ou Bloquear todos (`Button`) e um `Chip small` por aparelho (`on` e `aria-pressed` = Controla); Desativar em `Button tone="alert"`. No Livre, entre o endereço e "Quem controla", a linha do tempo do Ao Vivo que falta hoje (prop `livreTimeLeft` da 1b, `role="timer"`, `text-ps-sm` negrito em `bone`, centralizada: informação neutra, nem âmbar nem laranja; junção da 1b final, publicado na v1.4.25). Teste: `LiveModeModal.test.tsx`. |
| Casca do /admin | `src/admin/AdminLogin.tsx`, `src/admin/AdminShell.tsx`, `src/admin/components/ConfirmDialog.tsx` | Login: fundo `ps-ink`, `Panel variant="raised"` de até 384 px, a marca com o `ps-label` Admin (igual à casca), `h1` "Painel do admin", `TextField` E-mail e Senha, erro em `Notice tone="alert"` e Entrar em `Button primary` na largura do painel (ocupado com `aria-busy` e o ícone girando). Casca: as abas continuam `Chip` (o `Tabs` do kit só tem rótulo de texto, e a aba Pendências mostra contador e LED), sem o anel de foco por fora, que o `Chip` agora já tem. `ConfirmDialog`: a nota passa a ser o `TextArea` do kit, com as linhas de ajuda no `help`. O `AdminErrorBoundary` já estava na linguagem nova. Teste: `AdminLogin.test.tsx` e os de `src/admin` que já existiam. |


### 2.10 Separação (Parte 3, faixa D, 2026-11-20, não publicado, vai na v1.4.26)

> O Separador e as ferramentas da separação na linguagem do palco. As telas viram **vistas só de props** em `src/components/separator/` (o estado fica no `SeparatorStudio.tsx`) e as ferramentas viram peças em `src/components/separation/`, usadas pelo Separador de reserva e pelo painel SEPARAÇÃO do palco. Os textos moram em `separatorCopy.ts`. Regras da faixa C valem (nada do dourado `primary`, do roxo nem do amarelo de hoje; `oldLanguageClasses` nos testes). Fatos na entrada de 2026-11-20 "A música separada abre no palco" do FATOS.

**O fluxo:** com o palco novo na tela, o Separador entrega a separação ao App (`onOpenOnStage`), mostrando antes o `SeparatorProgress` "Abrindo no palco" (barra laranja, "Baixando as faixas (n de N)", Voltar cancela; erro em âmbar com Tentar de novo); o App fecha o Separador e o palco abre a gaveta SEPARAÇÃO na aba FAIXAS. Sem o palco novo, o player de reserva do Separador, com as mesmas peças.

| Vista | Arquivo | Como ficou |
|---|---|---|
| Entrada | `SeparatorHome.tsx` | Tela cheia `bg-ps-ink`, barra de cima `bg-ps-ink-0` com Voltar (`Button ghost`); PlayMark e o título em `text-ps-lg` extranegrito, subtítulo em `mut`; "Carregar áudio & iniciar" é o `FilePicker` (`tone="primary"`, ajuda "MP3, WAV ou AAC") num `Panel variant="raised"` (`data-tour="sep-upload"`). "Minhas separações" (`data-tour="sep-biblioteca"`): contagem em `ps-num`, linhas `Panel` tocáveis (o cartão inteiro abre) com nome `bone` e artista `mut` quebrando linha, `Tag num` neutras (tom, BPM, "N faixas"), bolinhas de 10 px com a cor de cada faixa (dado), data em `ps-num` `dim`, "Abrir" (`Button`) e a `TwoTapTrashButton` ("Excluir?", sempre visível). Carregando e vazio em `mut`/`dim`. O aviso de erro entra no topo (`notice`, `Notice tone="alert" role="alert"`). |
| Opções | `SeparatorOptions.tsx` | Mesma casca; título e subtítulo; grupos "Separação Básica" e "Separação Avançada" com cartões `Panel raised` que são um `<button>` inteiro (44 px no mínimo, nome que quebra linha e "N faixas" em `ps-num`). Mostra só as opções que recebe (quem decide é o `separationStemOptions`). |
| Progresso | `SeparatorProgress.tsx` | Centralizado; título, subtítulo `mut`, `ProgressBar` laranja (a ação em andamento), a etapa em `mut`, "N% concluído" em `ps-num`. Com `error`: `Notice tone="alert" role="alert"`, "Tentar de novo" (`primary`) e "Voltar". `onBack` sem erro mostra o Voltar (cancelar). |
| BPM e click | `src/components/separation/BpmClickEditor.tsx` | Peça só de props (Separador num `StageDialog size="sm"` "BPM"; o painel do palco também). Nome do andamento em `mut`; BPM num `TextField` numérico com `ps-num` grande entre `IconButton` − e +, numa caixa `bg-ps-well`; Tap tempo, 2× e ½× em `Chip`; Detectar em `Button` (o `title` diz o motivo: plano sem a detecção ou "Pare a música pra usar"); compasso, som e subdivisão em `Segmented` que quebra linha; acento no `Switch`; Mover o "1" com `IconButton` e o valor com sinal em `ps-num`; Gerar click `tone="primary" size="lg"`; o SYNC opcional (par de `IconButton` com o valor em ms); erro em `Notice tone="alert" role="alert"`. `disabledReason` desliga Detectar, Gerar click e o SYNC. |
| Voz guia | `src/components/separation/VoiceGuideEditor.tsx` | Peça só de props (`StageDialog` "Voz Guia"). Auto-detectar em `Button`; analisando em `Notice role="status"`; `Tabs` Seções e Dinâmicas com a grade de marcações em `Chip` (grade `auto-fill` de 7,5rem, o texto quebra linha); lista "Marcações (N)" com um pino de 4 px na cor da família Guia (`FAMILY_COLOR.guia`, P14), o tempo num `TextField` `ps-num` (grava ao sair e no Enter), o nome que quebra linha e o `IconButton ghost` "Tirar <nome>"; Limpar todos `ghost`; Gerar ou Atualizar canal `size="lg"`, em `primary` só quando há marcação fora do canal (`pending`). `disabledReason` desliga Auto-detectar e Gerar canal; a grade nunca. |
| Publicar na nuvem | `src/components/separation/CloudSaveForm.tsx` | Peça só de props (`StageDialog` "Publicar na Nuvem"). `TextField` Música e Artista (duas colunas a partir de `sm`), BPM (IA) só com a detecção no plano, `Select` do tom, capa pelo `FilePicker` (imagem, com Tirar), `Switch` "Visibilidade global" só pro admin, "Salvar & publicar" `primary size="lg"`. Publicando: "Publicando..." ou "Pronto!", o status em `role="status"` e a `ProgressBar`. Erro em `Notice` âmbar. |
| Barra do player de reserva | `src/components/separator/SeparatorPlayerBar.tsx` | `header` `bg-ps-ink-0` com linha `ps-line`, duas linhas que quebram (`flex-wrap`): Voltar `ghost`, o nome em `text-ps-md` extranegrito que quebra linha e "Separador IA · N CH" em `ps-label`; WAV e MP3 em `Segmented`; Salvar e Exportar em `Button`. Linha 2: BPM e Tom em `Button` (`ps-label` e o valor em `ps-num`), a grade dos tons num `Panel variant="pop"` com 12 `Button` (o tom escolhido em `on`) e o fundo invisível que fecha ao tocar fora; início e fim em `IconButton`, play redondo de 48 px no estilo do `PlayButton` (laranja cheio tocando), LOOP em `Chip on`, o tempo em `ps-num` numa caixa `bg-ps-well`; Voz em `Button` com a contagem (o cadeado sem a voz guia no plano); SYNC com dois `IconButton ghost` e o valor em `ps-num` (apagado sem o Metrônomo); volume geral em `Slider` com o número ao lado. |
| Faixa do player de reserva | `src/components/separator/SeparatorTrackStrip.tsx` | Coluna `bg-ps-s1` com a barra de 3 px na cor da faixa (dado). Grade: número `ps-num` e nome que quebra linha (`dim` quando calada pelo mudo ou pelo solo de outra) com o M e o S do mixer ao lado (`ps-mute` e `ps-solo` acesos, 32 x 36 px, `data-touch-exception="ms"`); embaixo baixar (`IconButton ghost`, girando enquanto converte, cadeado sem o download no plano), o pan redondo de 44 px (rolar ajusta, clique centra, valor C, L ou R em `ps-num`) e o volume em `Slider`; VOL e o número embaixo. No celular em pé (`compact:`) o M e o S descem pra linha própria e o pan e o VOL saem; na tela baixa (`short:`) o pan e o VOL saem. Altura mínima em `laneFloor` (`separatorCopy.ts`): 150, 112 ou 132 px. |
| Onda do player de reserva | `src/components/SeparatorStudio.tsx` | Régua `bg-ps-ink-0` com os tempos em `ps-num` `text-ps-micro` `dim`; agulha `bone` na régua e nas ondas; marcações da voz guia na cor da família Guia (`FAMILY_COLOR.guia` na variável `--cue`, P14), com o nome numa etiqueta `text-ps-ink`; cada faixa com o degradê da cor dela (dado). O aviso "Tudo salvo na biblioteca" é um `Notice` numa região `role="status"` que fica sempre na página. |
| Painel SEPARAÇÃO do palco | `src/components/separation/SeparationPanel.tsx` (no `slots.separation` da `StageShell`) | Gaveta da direita, espelho da REPERTÓRIOS: `w-[420px] max-w-full`, `rounded-l-ps-2xl`, `bg-ps-raised`, sombra `ps-pop`, anel `line-2`, entra da direita (`starting:translate-x-4`); `role="dialog"` sem `aria-modal` (não bloqueia o palco), Esc e foco pela pilha dos painéis (`usePanelDismiss`). Cabeçalho parado com "Separação" em `ps-label`, o nome da música que quebra linha e o X (`IconButton ghost`); `Tabs` Faixas, Voz guia e BPM e click; o conteúdo rola dentro. FAIXAS: o anúncio do fim da separação no topo quando vem, o erro em `Notice` âmbar, WAV e MP3 em `Segmented`, uma linha por faixa (barra de 4 px na cor dela, nome que quebra linha, "Baixar" girando enquanto baixa), "Salvar na nuvem" (`primary`) e "Minhas separações". VOZ GUIA é o `VoiceGuideEditor`; BPM E CLICK é o `BpmClickEditor` com o SYNC dentro. Tocando ou na pré-contagem, Baixar, Salvar na nuvem, Detectar, Gerar click, SYNC, Auto-detectar e Gerar canal ficam desligados com "Pare a música pra usar" no `title`; marcar a voz guia e "Minhas separações" continuam. |

**Correções da revisão macro (2026-11-21, não publicado, vai na v1.4.26):**
- A gaveta SEPARAÇÃO e a janela "Publicar na Nuvem" do palco são da música em que abriram: trocar de música fecha as duas e nada abre sozinho tocando (só a chegada da separação, com a música parada, e o FAIXAS > Separação abrem a gaveta).
- Cada aba da gaveta (e a janela "Publicar na Nuvem") mostra só a frase de erro da ferramenta dela, no `Notice tone="alert"` de sempre.
- "Abrindo no palco" com erro (`SeparatorProgress`): "Tentar de novo" (`primary`), "Abrir aqui no Separador" e "Voltar" (`Button` padrão), nessa ordem, quebrando linha.
- Janelas da Voz Guia e do BPM do Separador de reserva: o Espaço toca e pausa a música (captura na `window`, antes da janela do palco), fora de campo de texto; nenhum botão novo.
- A faixa "Voz Guia" é sempre da cor da família Guia (`FAMILY_COLOR.guia`, pedra), gerada no Separador ou no painel; a gravada antes no âmbar (`#fbbf24`, o `ps-alert`) é mostrada em pedra por `stemColor` (`src/lib/separation/voiceGuide.ts`). Âmbar só pra alerta.
- Frase que informa (a nota do BPM, a da voz guia, a lista vazia de "Minhas separações") em `text-ps-mut`; `text-ps-dim` só pra metadado (data, "+N", tempo da régua). Arquivo que não é de áudio na entrada: `Notice tone="alert"` no topo, pelo `onReject` do `FilePicker`.
- A separação que não abriu no palco (nenhuma faixa decodificou) mostra a frase num `Toast tone="alert"` no topo (6 s, some sozinho e nunca aparece tocando nem na pré-contagem).

### 2.11 Tela inicial, Biblioteca e Planos (Parte 3, partes 3 a 5, 2026-11-20, não publicado, vai na v1.4.26)

> As três telas do começo do app na linguagem do palco, na ordem do spec (seção 10). Cada tela vira uma **vista só de props** (`src/components/home/`, `src/components/library/`, `src/components/pricing/`) e o arquivo de hoje vira o contêiner, com os hooks e a lógica sem mudar de sentido. Regras das faixas C e D valem (nada do dourado `primary`, do ciano `secondary`, do roxo nem de `hw-btn`; `oldLanguageClasses` nos testes). Fatos na entrada de 2026-11-20 "Tela inicial, Biblioteca e Planos" do `PLAYBACK_STUDIO_FATOS.md`.

| Vista | Arquivo | Como ficou |
|---|---|---|
| Tela inicial | `src/components/home/HomeScreen.tsx` (textos em `homeCopy.ts`) | Tela cheia `bg-ps-ink` (`data-home-screen`), coluna centrada com 16 px de folga. O PlayMark num `Panel variant="raised"` de 80 px (sem a luz laranja piscando: laranja aceso quer dizer ligado); "Playback *Studio*" como na barra do palco (Inter extranegrito, Studio em `ps-or` itálico, a marca), de 30 a 48 px; "A plataforma do domingo" em `ps-label`. Multitracks e Separação de Faixas são cartões `Panel raised` que são um `<button>` inteiro (anel `line-2`, `line-3` no mouse, foco laranja, 44 px no mínimo), com o ícone em `bone`, o nome em `text-ps-lg` negrito e a linha de baixo em `mut`, quebrando linha; lado a lado a partir de 640 px, um embaixo do outro no celular, até 448 px. Restaurando, o ícone do Multitracks vira o carregando (`aria-busy`). O anúncio da casa (`AdSlot`) entra pelo `ad`, embaixo, na mesma largura; o lugar dele some quando o `AdSlot` não mostra nada (`empty:hidden`). Teste: `homeScreen.test.tsx`. |
| Biblioteca na Nuvem | `src/components/library/LibraryView.tsx` (regras e textos em `libraryRows.ts`; contêiner `src/components/LibraryModal.tsx`) | `StageDialog size="lg"` "Biblioteca na Nuvem" (o X da janela é o fechar). No alto, presos enquanto a lista rola (`sticky`, fundo `ps-pop`): a busca é o `SearchField` (rótulo escondido "Pesquisar", lupa, limpar de 44 px) com "Atualizar" (`Button` com ícone) ao lado, quebrando linha no celular, e as `Tabs` Plataforma e Minhas Músicas com um `TabPanel`. Carregando: o ícone girando e a frase em `mut` (`role="status"`); vazio: a nuvem em `dim` e a frase em `mut`. Sem espaço no aparelho pra baixar, a frase em `Notice tone="alert"` no alto, dentro do bloco preso da busca e das abas (sempre à vista, mesmo com uma edição aberta; antes era o aviso do navegador). É um estado só dela (`downloadNotice`), separado do erro da edição (`message`); sai quando a janela fecha e a cada toque em IMPORTAR ou ABRIR. No mesmo `Notice` aparecem as frases do fim do baixar que não deu certo (fora do aparelho sem internet, e aí a linha passa ao OFFLINE desligado, sem o ABRIR; sem faixas na nuvem; falha de rede) e a de quando a música abre mas não fica guardada no aparelho ("A música abriu, mas não ficou guardada neste aparelho: sem internet, ela não abre pela Biblioteca.", em âmbar: diz a consequência, sem afirmar a causa); cancelar não mostra nada. Rodapé da janela com a contagem em `ps-num` `mut`. **Cada música** é um `Panel` (`data-library-row`): capa de 48 px (`rounded-ps-md`, sem capa o ícone em `dim`), nome `bone` negrito e artista `mut`, os dois quebrando linha, e os selos `Tag` neutros "TOM: G", "72.5 BPM" (`num`) e OFFLINE com a luz (`dot`). À direita, quebrando pra linha de baixo no celular: editar e a lixeira em `IconButton` ("Editar metadados"; "Excluir da Nuvem" só pro admin com internet, ou "Tirar deste aparelho" pra quem tem a música nele, regra em `removeScopeOf`, girando excluindo), e o baixar: IMPORTAR (`Button primary`, a ação principal da linha), ABRIR (`Button`, dica "Abrir a música guardada neste aparelho"), baixando com o ícone girando, o andamento em `ps-num` (frases pro usuário, "Baixando as multitracks: 128,4 MB (11 de 12)", `LIBRARY_PROGRESS` do `useCloudLibrary`) e "Cancelar" (`ghost`), ADICIONADA (`Tag` neutra com o check: informação, não é "ligado"), OFFLINE (`Button` desligado, com a dica do mouse na volta dele). **A edição** abre na linha, num `Panel raised` com anel `line-2` (`role="group"` "Editar Música"): `TextField` Nome, Artista, BPM (`inputMode="decimal"`, `ps-num`) e Tom em duas colunas a partir de `sm`, a capa pelo `FilePicker` ("Escolher imagem...", com Tirar), o erro em `Notice tone="alert"` e SALVAR (`primary`, girando salvando); X (`IconButton ghost` "Fechar a edição") e Esc fecham a edição; editando, a janela não fecha no Esc nem no toque fora (`dismissible={false}`), só enquanto a edição está à vista: em outra aba ou fora da busca, a janela volta a fechar e a frase de erro fica no alto da lista. **A lixeira** abre uma segunda janela por cima (`StageDialog size="sm"`, pilha): "Excluir da nuvem?" com o texto de antes (só o "Cache Local" virou "deste aparelho") e Excluir, ou "Tirar deste aparelho?" com o texto dele (sem o aviso de "todos") e Tirar; Cancelar (`ghost`) e o botão de confirmar em `Button alert` (a cor de alerta, girando; nada fecha enquanto tira). Se a música sai da lista com ela aberta, ela fecha de vez (nunca reabre sozinha). Ela guarda o que abriu (`removeScopeHolds`): "Tirar deste aparelho?" não vira "Excluir da nuvem?" quando a internet volta, e "Excluir da nuvem?" fecha quando a internet cai. Nada de `daw-panel`, `secondary` nem dourado. Teste: `libraryView.test.tsx`, `libraryRows.test.ts`, `LibraryModal.bpm.test.tsx`, `LibraryModal.livre.test.tsx`. |
| Planos | `src/components/pricing/PricingView.tsx` (cartões e textos em `pricingCatalog.ts`; contêiner `src/components/PricingModal.tsx`) | `StageDialog size="lg"` "Escolha seu Plano" (pilha do palco: aberta por cima de outra janela do palco, fica em cima). A linha de baixo em `mut`. Os 4 cartões têm a cara do `Panel variant="raised"` (`data-plan-card`; um `div` com `rounded-ps-2xl bg-ps-raised inset-ring` e um anel só, escolhido no cartão, como o `DownloadPage`: o `cx` não resolve dois anéis opostos) numa grade de 1 coluna e 2 a partir de 640 px: nome `bone` negrito (com o `Tag` neutro "Mais Popular" no Pro Mensal: destaque não é "ligado"), descrição em `mut` sem altura fixa, preço em `ps-num` de 30 px extranegrito `bone` com o período em `mut`; com a oferta, "Primeiro mês por" em `ps-label`, o preço do primeiro mês no mesmo tamanho e "Depois R$ 49,90/mês. Cancele quando quiser." em `mut` (preço neutro, como na tela de limite: o laranja fica no botão); recursos com o check em `mut`. O botão no pé de cada cartão tem a largura do texto: `primary` (laranja) só no Pro Mensal, a ação principal, e só quando ele não é o plano atual (desligado, fica `default`: laranja é ação ligada); `default` nos outros; girando com "Processando..."; "Seu plano atual" desligado. O Pro Mensal tem o anel `line-3` (mais forte que o `line` dos outros), sem laranja no anel. Os avisos ficam no pé da janela, sempre à vista: "Abrimos o pagamento no seu navegador..." em `Notice role="status"` (sai a cada abertura), a oferta que terminou e o erro em `Notice tone="alert" role="alert"` (o erro sai quando a janela fecha; o que chega com ela fechada aparece na próxima abertura). "Trocar de plano?" é uma segunda janela (`StageDialog size="sm"`) com o texto de antes, "Voltar" (`ghost`) e "Confirmar troca" (`primary`). Teste: `pricingView.test.tsx`, `pricingCatalog.test.ts`, `PricingModal.test.tsx`. |

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
**Localização:** `AuthPage.tsx` (coluna `aside`, só a partir de `lg`)
- Wordmark + "pronto pro" (`ps-label`) + DomingoMark + H1 (Inter bold, 40px, 48px a partir de `xl`) + Sub (`ps-md`, `mut`) + Stepper (3 passos: o primeiro em `or-soft` com o número em `ps-or`, os outros em `s1`)
- **Parte 3 (2026-11-20, publicado na v1.4.25):** na linguagem nova (fundo `ps-ink-0` com linha `ps-line` à direita, brilhos `ps-or` e `ps-moss` decorativos). As marcas (Wordmark e Domingo) mantêm a identidade própria.

### 3.6 Form input field
**Localização:** `src/components/ui/Field.tsx` (`TextField`, seção 2.6)
- **Parte 3 (2026-11-20, publicado na v1.4.25):** o login e a tela Criar nova senha usam o `TextField` do kit (rótulo em `ps-label` ligado ao campo, ícone à esquerda, "mín 6" como `trailing`, anel de foco laranja na caixa). Antes: label uppercase warm-400, input `pl-11 pr-4 py-3` com o anel laranja no input.

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
**Localização:** `AuthPage.tsx`
- Dual column: branding esquerda + formulário direita
- Atmosphere blur circles
- Google OAuth + email/senha form
- Modo login | register | forgot
- **Parte 3 (2026-11-20, publicado na v1.4.25):** fundo `ps-ink`, formulário num `Panel` (`flat`, até 448px, padding 24px e 32px a partir de `sm`), título 28px bold, "Continuar com Google" e o enviar em `Button size="lg"` (o enviar no `primary` laranja, com o texto mantido e o ícone girando enquanto carrega), erro num `Notice` âmbar (`role="alert"`), mensagem num `Notice` neutro dentro da região `role="status"` que fica sempre na página, "Esqueceu sua senha?" em `Button ghost` e a troca de modo ("Criar conta", "Entrar") em `Button` padrão. Fora do `lg` a Wordmark fica no topo, no fluxo da página (antes ficava por cima, em posição absoluta).
- **Criar nova senha** (`NewPasswordPage.tsx`, volta do link de recuperar senha), Parte 3 (2026-11-20, publicado na v1.4.25): mesma linguagem numa coluna só (até 384px): Wordmark em cima, `Panel` com o título, os dois `TextField` de senha, o erro num `Notice` âmbar (`role="alert"`), "Salvar nova senha" em `Button primary` (`lg`, o cadeado vira o ícone girando enquanto salva) e "Cancelar e voltar pra tela de entrar" em `Button ghost`. Depois de salvar: a confirmação num `Notice` neutro (`role="status"`) e "Continuar" em `Button primary`.

### 4.14 Splash screen produto
> **ESTADO ATUAL (Parte 3, 2026-11-20, não publicado, vai na v1.4.26):** a tela inicial passou pra linguagem do palco, na vista `HomeScreen` (seção 2.11). O que segue descreve a de antes.

**Localização:** `App.tsx:336-363`
- Centro: ícone Music animado boot-glow + H1 dual wordmark + tagline mono
- Dois botões hardware lado a lado: Multitracks (primary gold) | Separação IA (purple)


### 4.15 Configurações (`SettingsModal.tsx`, Parte 3, faixa B, 2026-11-20, publicado na v1.4.25)
**Casca:** camada própria (`fixed inset-0 z-[100]`, fundo `bg-black/60`, 16px de folga), não o `StageDialog`: os Planos (`PricingModal`, `z-[110]`; desde a Parte 3, partes 3 a 5, não publicado, vai na v1.4.26, uma janela do palco, seção 2.11) abrem por dentro das Configurações e ficam por cima (o clique dentro deles não chega à camada das Configurações). Caixa no `Panel variant="pop"` (até 672px, `max-h-full`), com `role="dialog"` e o nome "Configurações" (sem `aria-modal`: os Planos abrem por cima, fora da caixa). Toque fora fecha, toque dentro não, e apertar dentro e soltar fora também não. Revisão macro BC (2026-11-20, publicado na v1.4.25), no jeito das janelas do palco: ao abrir, o foco vai pra aba atual; Tab e Shift+Tab giram dentro da camada (Configurações e Planos); ao fechar, o foco volta pra quem abriu; o Esc fecha (na captura da `window`), menos com os Planos abertos, menos com uma janela do palco aberta por cima (`hasOpenStageDialog()`, seção 2.7: a tela de limite do Livre pode abrir por cima das Configurações, e o Esc fecha só ela) e menos quando vem de um campo de texto ou de senha, ou de uma área de texto, preenchido (junção da 1b com as faixas B e C: o nome ou a senha digitados no Perfil não se perdem; o Esc fica tratado e segue pro campo, sem chegar ao palco); nenhuma tecla de dentro chega ao palco antigo (a camada para a propagação e tem `tabIndex -1`, então um clique no texto deixa o foco nela).
- **Cabeçalho:** as abas do kit (`Tabs`, "Abas das Configurações": Perfil, Geral, Buses só em "Tudo junto", Novidades, Assinatura, Sobre), que descem de linha numa tela estreita, e o X do palco (`IconButton` com `Icon name="x"`, `aria-label="Fechar"`, 44px) à direita.
- **Conteúdo:** um `TabPanel` ligado à aba aberta, que rola por dentro (altura de 400px até 70% da tela; em tela baixa, como o celular deitado em 844x390, o piso cai pra 55% da tela e o painel encolhe e rola, nada escondido embaixo), fundo `ps-ink-0` e 24px de folga.
- **Linha de opção** (`src/components/settings/SettingRow.tsx`): nome (13px bold, `bone`) e frase (13px, `mut`) à esquerda, controle à direita; com menos de 224px pro texto o controle desce pra linha de baixo. Separadores `border-ps-line`.
- **Geral:** chave do Palco (`Segmented`, seção 1.7), Tutorial com "Ver tutorial" (`Button`), o aparelho de saída (`AudioOutputSelect.tsx`: título, "atualizar a lista" como `IconButton ghost` com 44px, `Select` do kit até 448px com o aviso do microfone como ajuda) junto das Saídas de áudio (os seletores do mapa de 4 ou mais também são o `Select` do kit), o Pan Estéreo Automático (`Switch`, só em "Tudo junto"), a Grade de Compasso (`Switch` desligado e ligado, "Em breve") e, pra admin, o Painel de Upload numa caixa `s1` com "Abrir Painel" (`Button`).
- **Perfil** (`ProfileTab.tsx`): o avatar do palco em 80px (degradê `ps-or` a `ps-moss`, anel `line-2`, a inicial ou a foto; "Trocar foto" com a câmera no hover e no foco, e o ícone girando à vista enquanto envia), nome (16px bold, quebra em vez de cortar) e e-mail; Nome de exibição (`TextField`) com Salvar (`Button primary`); Senha com "Nova senha" e "Confirmar nova senha" (`TextField`) e Atualizar (`Button`); as mensagens em 13px `mut` (`role="status"`); o plano num `Panel` com "Fazer upgrade" (`Button primary`, só no Livre); "Sair de todos os dispositivos" (`Button`) e "Excluir minha conta" (`Button alert`, no âmbar de alerta; o fluxo continua o `prompt` EXCLUIR, decisão do dono).
- **Novidades:** o aviso de atualização do computador numa caixa `s1` com anel `line`, o ícone num quadrado neutro (`s2`, `mut`) e "Baixar" (`Button primary`, o único laranja: laranja é ligado e a ação principal); cada versão com o título em 13px bold, a versão em `ps-num` à direita e os itens em 13px `mut`; a mais nova numa caixa `s1` com o brilho (`Sparkles`) em `mut`.
- **Assinatura:** só a moldura é nova: `Panel` (até 448px) com "Seu Plano Atual" em `ps-label`, o nome do plano em 28px extrabold, a frase e o botão "Ver Planos & Assinar" ou "Alterar Plano" (`Button primary lg`). O medidor de separações (`SeparationUsageMeter`) e o painel da assinatura (`SubscriptionPanel`) ficam como estão (são de outra frente).
- **Sobre:** Wordmark, "A plataforma do domingo" com a versão em `ps-num` e a frase em 13px `mut`.
- **Verificador:** `scripts/verify-layout/` mede o login, Criar nova senha e as Configurações em cada aba (estados `login`, `criarconta`, `recuperar`, `novasenha` e `config-*`) em 1024x740, 1280x800, 1920x1080, 390x844 e 844x390 (celular deitado).
- **Buses** (só em "Tudo junto"): uma linha por canal com o nome organizado (o nome do arquivo no `title`) e um `Select` do kit (rótulo escondido "Bus de <canal>"); sem canais, a frase "Carregue uma música primeiro para ver os canais."

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
