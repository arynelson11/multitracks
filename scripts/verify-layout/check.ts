// Verificador de layout (T20): roda na página, mede o que está na tela e manda o resultado por
// POST pro run.mjs, como o verify-pitch. Quatro regras (regra do dono: nenhum texto encostando na
// borda ou cortado):
//   (a) cortado: texto que não cabe na própria caixa (overflow diferente de visible) ou que passa
//       de um contêiner que corta (overflow hidden ou clip, ou antes do começo de uma rolagem); e
//       nada (texto, desenho, quadro) começando acima do topo de uma área que rola; numa
//       fileira que rola de lado, nada pela metade na borda (Ruling T10-rolagem: parado, nenhum botão
//       aparece pela metade), fora a casca inteira que rola de lado abaixo de 1024 px
//       (`data-scroll-reach`, Ruling I2-estreito: o que fica na borda chega rolando). Vale também pra
//       caixa que emoldura o texto (selo, botão, aviso) e pra caixa do botão só de ícone (o X do aviso
//       PRÓXIMA, a lixeira);
//   (b) encostando: em botão, [role=radio] e selo, o texto fica a 4 px ou mais das bordas na
//       horizontal; em caixa maior (célula, painel), o texto não sai dela;
//   (c) toque: button, [role=button], [role=radio], input e select com 44x44 px; M/S do mixer
//       (data-touch-exception="ms") com 32x30; bloco estreito da onda (data-narrow) é exceção aceita
//       na largura (Ruling T9-estreito) e só aparece na contagem;
//   (d) a página não rola de lado.
// A página ainda pode juntar regras próprias (`PageSteps.checks`, tipo 'estrutura').
// Não usa elementFromPoint (não mede o que está por cima): as etiquetas PRÓXIMA, REPETE e LOOP da
// onda (pointer-events-none) não mudam nada aqui.

export type FailureKind = 'cortado' | 'encostando' | 'toque' | 'rolagem' | 'estrutura'
export interface Failure { kind: FailureKind; selector: string; text: string; detail: string }
export interface CheckReport {
  name: string; estado: string; viewport: { w: number; h: number }
  failures: Failure[]; counts: { texts: number; targets: number; msException: number; narrowException: number; iconButtons: number }
  fatal?: string
}

/** Folga de arredondamento (subpixel) nas comparações de retângulo. */
const EPS = 0.5
/** Distância mínima do texto até a borda de botão, opção ou selo (na horizontal). */
const MIN_GAP = 4
const TOUCH = 44
const MS_TOUCH = { w: 32, h: 30 }
/** Caixa visível com texto e até esta altura, fora de botão, conta como selo (pílula, etiqueta, aviso); mais alta é célula ou painel. */
const CHIP_MAX_H = 40

const CONTROL = 'button, [role="button"], [role="radio"]'
const TARGET = 'button, [role="button"], [role="radio"], input:not([type="hidden"]), select'
const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'TEXTAREA', 'TITLE'])

interface Box { left: number; right: number; top: number; bottom: number }

const r1 = (v: number) => Math.round(v * 10) / 10

/** Opacidade (alfa) de uma cor computada: rgb(), rgba(), color(... / a), transparent. */
function alphaOf(color: string): number {
  const c = color.trim()
  if (c === 'transparent' || c === '') return 0
  const slash = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(c)
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1])
  const rgba = /^rgba\(([^)]*)\)$/.exec(c)
  if (rgba) {
    const parts = rgba[1].split(',')
    return parts.length === 4 ? Number(parts[3]) : 1
  }
  return 1
}

/** Divide uma lista separada por vírgula sem quebrar dentro de parênteses (box-shadow com rgba). */
function splitTop(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of value) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** Alguma sombra (o inset-ring do Tailwind é box-shadow) com cor visível e tamanho maior que zero. */
function hasVisibleShadow(shadow: string): boolean {
  if (!shadow || shadow === 'none') return false
  return splitTop(shadow).some((s) => {
    const color = /(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-f]+)/i.exec(s)
    if (color && alphaOf(color[1]) === 0) return false
    const nums = s.replace(/(rgba?|color|oklch|oklab)\([^)]*\)/gi, '').match(/-?[\d.]+px/g) ?? []
    return nums.some((n) => parseFloat(n) !== 0)
  })
}

/** Caixa que se vê: fundo, imagem de fundo, sombra ou borda lateral. */
function hasVisibleBox(el: Element): boolean {
  const cs = getComputedStyle(el)
  if (alphaOf(cs.backgroundColor) > 0 || cs.backgroundImage !== 'none') return true
  if (hasVisibleShadow(cs.boxShadow)) return true
  const side = (w: string, c: string) => parseFloat(w) > 0 && alphaOf(c) > 0
  return side(cs.borderLeftWidth, cs.borderLeftColor) || side(cs.borderRightWidth, cs.borderRightColor)
}

/** Está desenhado: tem caixa, não está invisível, nenhum ancestral com opacidade 0 nem recorte de leitor de tela. */
function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const s = getComputedStyle(cur)
    if (Number(s.opacity) === 0) return false
    // sr-only (Tailwind v4: clip-path inset(50%) num quadrado de 1 px) e o clip antigo.
    if (s.clipPath === 'inset(50%)' || (s.clip && s.clip !== 'auto')) return false
  }
  return true
}

/**
 * Bloco que contém o elemento (quem corta o que transborda dele). Posição estática ou relativa: o
 * pai. Absoluta: o ancestral posicionado (ou com transform, filtro, will-change, contain). Fixa: o
 * ancestral com transform e afins, senão a janela (nulo).
 */
function containingBlock(el: Element): Element | null {
  const pos = getComputedStyle(el).position
  if (pos !== 'absolute' && pos !== 'fixed') return el.parentElement
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const s = getComputedStyle(cur)
    const makesBlock =
      s.transform !== 'none' || s.filter !== 'none' || s.backdropFilter !== 'none' || s.perspective !== 'none' ||
      /transform|perspective|filter/.test(s.willChange) || /paint|layout|strict|content/.test(s.contain)
    if (makesBlock) return cur
    if (pos === 'absolute' && s.position !== 'static') return cur
  }
  return null
}

/**
 * Ancestrais que cortam o elemento: os da cadeia de blocos que contêm, com overflow diferente de
 * visible. Um contêiner fora dessa cadeia não corta (o absoluto escapa do pai que não é posicionado).
 * A própria caixa fica com a regra do scrollWidth/scrollHeight.
 */
function clippers(el: Element): Element[] {
  const out: Element[] = []
  for (let cur = containingBlock(el); cur && cur !== document.documentElement; cur = containingBlock(cur)) {
    const s = getComputedStyle(cur)
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(cur)
  }
  return out
}

/** Área que o contêiner deixa ver: a caixa de dentro das bordas, sem a barra de rolagem. */
function clipBox(el: Element): Box {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
}

function ownTextNodes(el: Element): Text[] {
  return [...el.childNodes].filter((n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
}

let measureCtx: CanvasRenderingContext2D | null = null

/** Tinta de cima e de baixo do texto (px a partir do topo da linha), medida no canvas com a fonte do elemento. */
function inkOffsets(text: string, cs: CSSStyleDeclaration): { top: number; bottom: number } | null {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return null
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const shown = cs.textTransform === 'uppercase' ? text.toUpperCase() : cs.textTransform === 'lowercase' ? text.toLowerCase() : text
  const m = measureCtx.measureText(shown.trim())
  return { top: m.fontBoundingBoxAscent - m.actualBoundingBoxAscent, bottom: m.fontBoundingBoxAscent + m.actualBoundingBoxDescent }
}

interface TextGeom { box: Box; ink: Box; text: string }

/**
 * Retângulo do texto próprio do elemento. Na horizontal, o das letras (avanço); na vertical, a
 * tinta (o retângulo da linha passa da tinta com leading-none e acusaria corte que não se vê).
 */
function textGeom(el: Element): TextGeom | null {
  const nodes = ownTextNodes(el)
  if (nodes.length === 0) return null
  const cs = getComputedStyle(el)
  let box: Box | null = null
  let inkTop = Infinity
  let inkBottom = -Infinity
  for (const node of nodes) {
    const range = document.createRange()
    range.selectNodeContents(node)
    const off = inkOffsets(node.textContent ?? '', cs)
    for (const r of range.getClientRects()) {
      if (r.width < EPS || r.height < EPS) continue
      box = box
        ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) }
        : { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      inkTop = Math.min(inkTop, off ? r.top + off.top : r.top)
      inkBottom = Math.max(inkBottom, off ? r.top + off.bottom : r.bottom)
    }
  }
  if (!box) return null
  return { box, ink: { left: box.left, right: box.right, top: inkTop, bottom: inkBottom }, text: nodes.map((n) => (n.textContent ?? '').trim()).join(' ') }
}

const SELECTOR_SKIP = new Set(['data-state', 'data-waiting', 'data-center', 'data-on', 'data-fit', 'data-loop', 'data-out', 'data-quiet', 'data-dragging', 'data-drop-target', 'data-narrow'])

function token(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id && !el.id.startsWith('_')) return `${tag}#${el.id}`
  const attrs: string[] = []
  for (const a of el.attributes) {
    if (attrs.length >= 2) break
    if (a.name.startsWith('data-') && !SELECTOR_SKIP.has(a.name)) attrs.push(a.value && a.value.length <= 24 ? `[${a.name}="${a.value}"]` : `[${a.name}]`)
  }
  for (const name of ['role', 'aria-label', 'title']) {
    if (attrs.length >= 2) break
    const v = el.getAttribute(name)
    if (v) attrs.push(`[${name}="${v.length > 40 ? `${v.slice(0, 40)}...` : v}"]`)
  }
  if (attrs.length > 0) return tag + attrs.join('')
  const parent = el.parentElement
  if (!parent) return tag
  const same = [...parent.children].filter((c) => c.tagName === el.tagName)
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag
}

/** Caminho legível até o elemento (até 5 níveis). */
export function describe(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  if (el === document.body) return 'body'
  for (let i = 0; cur && cur !== document.body && i < 5; i++) {
    parts.unshift(token(cur))
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
const px = (v: number) => `${r1(v)}px`

/** Parte que se vê depois dos contêineres que rolam; nulo = rolada pra fora (chega rolando). */
type Visible = Box | null

/**
 * Sobe pelos contêineres que cortam `start` (do mais perto pro mais longe) com a parte de `box` que
 * ainda se vê. O que esconde (hidden, clip) acusa o que passa da borda. O que rola acusa o que fica
 * antes do começo (em cima ou à esquerda, com a rolagem no início não se chega lá) e, de lado, o que
 * fica pela metade na borda (Ruling T10-rolagem); o que está todo depois do fim foi rolado pra fora
 * (chega rolando) e os de fora não contam mais nesse eixo. Embaixo, a rolagem é como a página.
 */
function walkClips(start: Element, box: Box, fail: (detail: string) => void): Visible {
  let vx: [number, number] | null = [box.left, box.right]
  let vy: [number, number] | null = [box.top, box.bottom]
  for (const c of clippers(start)) {
    const s = getComputedStyle(c)
    const b = clipBox(c)
    const where = describe(c)
    const xs = s.overflowX
    if (vx && (xs === 'hidden' || xs === 'clip')) {
      if (vx[0] < b.left - EPS) fail(`passa ${px(b.left - vx[0])} da borda esquerda de ${where} (overflow-x ${xs})`)
      if (vx[1] > b.right + EPS) fail(`passa ${px(vx[1] - b.right)} da borda direita de ${where} (overflow-x ${xs})`)
    } else if (vx && (xs === 'auto' || xs === 'scroll')) {
      const before = vx[1] <= b.left + EPS
      const after = vx[0] >= b.right - EPS
      // A casca que rola de lado na tela estreita (Ruling I2-estreito): o que está na borda chega rolando.
      const reach = c.hasAttribute('data-scroll-reach')
      if (before && c.scrollLeft <= 0) fail(`fica antes do começo da fileira que rola ${where} (não chega rolando)`)
      else if (!before && !after && !reach) {
        if (vx[0] < b.left - EPS) fail(`pela metade na borda esquerda da fileira que rola ${where} (${px(b.left - vx[0])} escondidos)`)
        if (vx[1] > b.right + EPS) fail(`pela metade na borda direita da fileira que rola ${where} (${px(vx[1] - b.right)} escondidos)`)
      }
      if (before || after) vx = null
    }
    if (vx) vx = [Math.max(vx[0], b.left), Math.min(vx[1], b.right)]
    const ys = s.overflowY
    if (vy && (ys === 'hidden' || ys === 'clip')) {
      if (vy[0] < b.top - EPS) fail(`passa ${px(b.top - vy[0])} da borda de cima de ${where} (overflow-y ${ys})`)
      if (vy[1] > b.bottom + EPS) fail(`passa ${px(vy[1] - b.bottom)} da borda de baixo de ${where} (overflow-y ${ys})`)
    } else if (vy && (ys === 'auto' || ys === 'scroll')) {
      const before = vy[1] <= b.top + EPS
      const after = vy[0] >= b.bottom - EPS
      if (!after && vy[0] < b.top - EPS && c.scrollTop <= 0) fail(`passa ${px(b.top - vy[0])} da borda de cima de ${where}, antes do começo da rolagem (overflow-y ${ys})`)
      if (before || after) vy = null
    }
    if (vy) vy = [Math.max(vy[0], b.top), Math.min(vy[1], b.bottom)]
  }
  // A janela corta de lado (a página não rola de lado, regra d).
  if (vx && (vx[0] < -EPS || vx[1] > window.innerWidth + EPS)) fail(`sai da janela na horizontal (${px(vx[0])} a ${px(vx[1])} em ${window.innerWidth}px)`)
  return vx && vy ? { left: vx[0], right: vx[1], top: vy[0], bottom: vy[1] } : null
}

/**
 * (a) Texto cortado: pela própria caixa (scrollWidth/scrollHeight com overflow diferente de visible)
 * ou por um contêiner (`walkClips`, com a tinta na vertical).
 */
function checkCut(el: Element, g: TextGeom, add: (f: Failure) => void): Visible {
  const cs = getComputedStyle(el)
  const fail = (detail: string) => add({ kind: 'cortado', selector: describe(el), text: g.text, detail })
  if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) fail(`conteúdo com ${el.scrollWidth}px numa caixa de ${el.clientWidth}px (overflow-x ${cs.overflowX})`)
  if (cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1) fail(`conteúdo com ${el.scrollHeight}px de altura numa caixa de ${el.clientHeight}px (overflow-y ${cs.overflowY})`)
  return walkClips(el, { left: g.box.left, right: g.box.right, top: g.ink.top, bottom: g.ink.bottom }, fail)
}

/**
 * (a) A caixa que emoldura o texto (selo, botão, aviso) também não pode ser cortada: borda ou fundo
 * comido por um contêiner é texto encostando num corte. Cada caixa é medida uma vez.
 */
function checkFrameCut(frame: Element, g: TextGeom, add: (f: Failure) => void) {
  const r = frame.getBoundingClientRect()
  const sel = describe(frame)
  walkClips(frame, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, (detail) => add({ kind: 'cortado', selector: sel, text: g.text, detail: `a caixa do texto ${detail}` }))
}

/** Caixa visível mais perto do texto, subindo até `stop` (inclusive). */
function nearestVisibleBox(el: Element, stop: Element | null): Element | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (hasVisibleBox(cur)) return cur
    if (cur === stop) return null
  }
  return null
}

/**
 * (b) Texto encostando na borda de botão, opção ou selo: a 4 px ou mais da caixa que se vê (a
 * mais perto do texto dentro do botão; sem nenhuma, o próprio botão). Texto fora de botão dentro
 * de caixa maior (célula, painel) não precisa da folga, mas não pode sair dela.
 */
function checkTouching(el: Element, g: TextGeom, frame: Element | null, shown: Visible, add: (f: Failure) => void) {
  if (!frame) return
  const r = frame.getBoundingClientRect()
  const where = frame === el ? 'a própria caixa' : describe(frame)
  const left = g.box.left - r.left
  const right = r.right - g.box.right
  if (el.closest(CONTROL) || r.height <= CHIP_MAX_H) {
    if (left < MIN_GAP - EPS || right < MIN_GAP - EPS) {
      add({ kind: 'encostando', selector: describe(el), text: g.text, detail: `texto a ${px(left)} da esquerda e ${px(right)} da direita de ${where} (mínimo ${MIN_GAP}px)` })
    }
    return
  }
  // Na caixa grande vale o que se vê: o texto rolado pra fora numa fileira não está saindo da caixa.
  if (!shown) return
  const out = { left: shown.left - r.left, right: r.right - shown.right, top: shown.top - r.top, bottom: r.bottom - shown.bottom }
  if (out.left < -EPS || out.right < -EPS || out.top < -EPS || out.bottom < -EPS) {
    add({ kind: 'encostando', selector: describe(el), text: g.text, detail: `texto sai de ${where}: ${px(out.left)} da esquerda, ${px(out.right)} da direita, ${px(out.top)} de cima, ${px(out.bottom)} de baixo` })
  }
}

/** Caixa que emoldura o texto: a visível mais perto dentro do botão (sem nenhuma, o botão); fora de botão, a visível mais perto. */
function textFrame(el: Element): Element | null {
  const control = el.closest(CONTROL)
  const visible = nearestVisibleBox(el, control)
  return control ? visible ?? control : visible
}

/**
 * (a) Botão só de ícone (o X do aviso PRÓXIMA, a lixeira, o Metrônomo): sem texto próprio ele não
 * entra na conta dos textos, então a caixa dele é medida aqui, com as mesmas regras de corte.
 */
function checkIconButtons(add: (f: Failure) => void, frames: Set<Element>, counts: CheckReport['counts']) {
  for (const el of document.querySelectorAll(CONTROL)) {
    if (frames.has(el) || (el.textContent ?? '').trim() !== '' || !isShown(el) || el.closest('[inert]')) continue
    frames.add(el)
    counts.iconButtons++
    const r = el.getBoundingClientRect()
    const name = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
    walkClips(el, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, (detail) => add({ kind: 'cortado', selector: describe(el), text: name, detail: `o botão só de ícone ${detail}` }))
  }
}

/** (c) Alvos de toque. */
function checkTargets(add: (f: Failure) => void, counts: CheckReport['counts']) {
  for (const el of document.querySelectorAll(TARGET)) {
    if (!isShown(el) || el.closest('[inert]') || getComputedStyle(el).pointerEvents === 'none') continue
    counts.targets++
    const r = el.getBoundingClientRect()
    // Bloco estreito da onda (Ruling T9-estreito): a largura é a da seção, a altura continua valendo.
    const narrow = el.hasAttribute('data-narrow') && r.width < TOUCH - EPS
    if (narrow) counts.narrowException++
    const ms = el.getAttribute('data-touch-exception') === 'ms'
    const min = ms ? MS_TOUCH : { w: narrow ? 0 : TOUCH, h: TOUCH }
    if (ms) counts.msException++
    if (r.width < min.w - EPS || r.height < min.h - EPS) {
      const rule = narrow ? `altura mínima ${min.h}px, bloco estreito` : `mínimo ${min.w}x${min.h}${ms ? ', exceção do M/S' : ''}`
      add({ kind: 'toque', selector: describe(el), text: textOf(el), detail: `alvo de ${r1(r.width)}x${r1(r.height)}px (${rule})` })
    }
  }
}

/**
 * (a) Nada acima do topo de uma área que rola (revisão macro BC, BC2-I2): com a rolagem no começo,
 * o que começa antes do topo nunca chega rolando (numa coluna que rola, o `justify-center` joga
 * metade do excesso pra cima). Vale pra qualquer filho, não só texto: o QR code é um desenho.
 */
function checkScrollTops(add: (f: Failure) => void): void {
  for (const c of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(c)
    if ((s.overflowY !== 'auto' && s.overflowY !== 'scroll') || c.scrollTop > 0 || !isShown(c)) continue
    const top = clipBox(c).top
    for (const child of c.children) {
      const cs = getComputedStyle(child)
      if (cs.position === 'absolute' || cs.position === 'fixed' || !isShown(child)) continue
      const r = child.getBoundingClientRect()
      if (r.height > 0 && r.top < top - EPS) {
        add({ kind: 'cortado', selector: describe(child), text: '', detail: `começa ${px(top - r.top)} acima do topo de ${describe(c)}, que rola (com a rolagem no começo, não chega rolando)` })
      }
    }
  }
}

/** Mede a página inteira agora. */
function runChecks(): Pick<CheckReport, 'failures' | 'counts'> {
  const failures: Failure[] = []
  const seen = new Set<string>()
  const add = (f: Failure) => {
    const key = `${f.kind}|${f.selector}|${f.detail}`
    if (seen.has(key)) return
    seen.add(key)
    failures.push(f)
  }
  const counts = { texts: 0, targets: 0, msException: 0, narrowException: 0, iconButtons: 0 }
  const frames = new Set<Element>()

  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP_TEXT.has(el.tagName) || el.closest('svg') || ownTextNodes(el).length === 0 || !isShown(el)) continue
    if (alphaOf(getComputedStyle(el).color) === 0) continue // número apagado (bolinha da contagem sem bipe): não se vê
    const g = textGeom(el)
    if (!g) continue
    counts.texts++
    const shown = checkCut(el, g, add)
    const frame = textFrame(el)
    checkTouching(el, g, frame, shown, add)
    if (frame && !frames.has(frame)) {
      frames.add(frame)
      checkFrameCut(frame, g, add)
    }
  }
  checkIconButtons(add, frames, counts)
  checkTargets(add, counts)
  checkScrollTops(add)

  const page = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  if (page > window.innerWidth) add({ kind: 'rolagem', selector: 'html', text: '', detail: `a página rola de lado: ${page}px numa janela de ${window.innerWidth}px` })
  return { failures, counts }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const nextFrames = (n: number) => new Promise<void>((resolve) => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)))
  step(n)
})

/** Espera as fontes, as medidas dos componentes (ResizeObserver, fontes.ready) e as transições de entrada. */
async function settle(ms = 700): Promise<void> {
  await Promise.all([
    document.fonts.load('800 16px "Inter Variable"'),
    document.fonts.load('400 16px "Inter Variable"'),
    document.fonts.load('700 16px "JetBrains Mono Variable"'),
  ]).catch(() => {})
  await document.fonts.ready
  await nextFrames(3)
  await sleep(ms)
  await nextFrames(3)
}

async function post(name: string, report: CheckReport): Promise<void> {
  await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(report) })
}

export interface PageSteps {
  /** O que abrir depois de montar (a grade de tons ou o compasso, por exemplo). */
  prepare?: () => void | Promise<void>
  /** Confere que a página está no estado pedido; joga erro se não estiver (senão a medida passaria sem medir nada). */
  expect?: () => void
  /** Regras próprias da página, medidas junto com as quatro. */
  checks?: () => Failure[]
}

/** Roda a verificação da página e manda o resultado: espera assentar, prepara, confere o estado e mede. */
export async function verifyPage(name: string, estado: string, steps: PageSteps = {}): Promise<void> {
  const base = { name, estado, viewport: { w: window.innerWidth, h: window.innerHeight } }
  try {
    await settle()
    if (steps.prepare) {
      await steps.prepare()
      await settle()
    }
    steps.expect?.()
    const result = runChecks()
    result.failures.push(...(steps.checks?.() ?? []))
    await post(name, { ...base, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await post(name, { ...base, failures: [], counts: { texts: 0, targets: 0, msException: 0, narrowException: 0, iconButtons: 0 }, fatal: message })
  }
}

/** Erro antes de medir (estado desconhecido, falha ao montar): o run.mjs mostra e sai com 1. */
export function reportFatal(name: string, estado: string, message: string): void {
  void post(name, { name, estado, viewport: { w: window.innerWidth, h: window.innerHeight }, failures: [], counts: { texts: 0, targets: 0, msException: 0, narrowException: 0, iconButtons: 0 }, fatal: message })
}
