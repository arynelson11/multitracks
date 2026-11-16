import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, StageClock, StageGates, StageSection, StageView, TransitionView } from '../../lib/stageContracts'
import { countState } from '../../lib/transitionView'
import { Button, cx } from '../ui'
import { Icon } from './icons'
import { PAD_COUNT_TEXT, padMeta, padProgress, padReserve, padTag } from './sectionPadMeta'
import { setText } from './stageDom'
import { useFrame } from './useFrame'

export interface SectionPadsProps {
  sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null; isPlaying: boolean
  landed: StageView['landed']; gates: StageGates; clock: Pick<StageClock, 'heardNow' | 'position'>; onTap(i: number): void; onUpgrade(): void
}

const INVITE = 'Marque as seções da música e troque de parte ao vivo sem parar a VS.'
const NO_SECTIONS = 'Esta música ainda não tem seções. Marque no EDITAR.'
/** Teclas de atalho 1 a 9 nas 9 primeiras seções. */
const KEYS = 9
/** Espaço entre os botões e entre a janela e os indicadores (gap-ps-gap). */
const GAP = 8
/** Indicador das pontas: tocável (44 px ou mais) e com o número a 8 px das bordas. */
const MORE_W = 52
/** Nome a 16 px em até 2 linhas (altura de linha 1,1); passou disso, desce pra 14 px. Nunca corta. */
const NAME_PX = 16
const NAME_SMALL_PX = 14
const NAME_LEADING = 1.1
const NAME_MAX_LINES = 2
/** Ainda passou de 2 linhas a 14 px: a reserva alarga de 8 em 8 px até caber, no máximo 240 px (dado antigo maior que isso quebra). */
const PAD_MIN_PX = 104
const WIDEN_STEP = 8
const WIDEN_MAX = 240

// v5 .botoeira, com a Ruling T10-rolagem: a janela mostra sempre um número inteiro de botões, todos
// da mesma largura; a rolagem encaixa no começo de cada botão (nunca para no meio). Sem barra de
// rolagem: quem pagina são os indicadores das pontas (e o arrasto no iPad).
const TRACK = 'flex items-stretch gap-ps-gap'
const ROW = 'flex min-w-0 flex-1 gap-ps-gap overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
// v5 .sp: 64 a 82 px de altura (8vh), faixa da cor à esquerda; 4 px entre a linha da tecla e o nome
// (a caixa das letras da Inter sobe 2 px acima da linha). Cresce na altura se o nome quebrar
// em 2 linhas (a fileira inteira acompanha, pra todos ficarem iguais). Foco por dentro: a fileira rola e
// cortaria o contorno de fora.
const PAD =
  'relative isolate flex flex-none snap-start min-w-[104px] min-h-[clamp(64px,8vh,82px)] flex-col justify-center overflow-clip rounded-ps-lg py-1 pr-2.5 pl-[18px] text-left font-ps-sans text-ps-bone select-none transition-[transform,background-color] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const IDLE_RING = 'inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2'
const CURRENT_BG = 'bg-[color-mix(in_srgb,var(--ps-c)_20%,var(--color-ps-s1))]'
const CURRENT_RING = 'inset-ring-2 inset-ring-(--ps-c)'
// Armado (Ruling T1): listras com color-mix do branco de armado, borda branca fixa (é o que fica com
// movimento reduzido) e as animações da T1 por cima (o brilho já redesenha a mesma borda).
const ARMED =
  'inset-ring-2 inset-ring-ps-arm bg-[image:repeating-linear-gradient(-45deg,color-mix(in_srgb,var(--color-ps-arm)_7.5%,transparent)_0_7px,transparent_7px_14px)] animate-[var(--animate-ps-stripes),var(--animate-ps-armglow)]'
const STRIP = 'pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-(--ps-c)'
const FILL = 'pointer-events-none absolute inset-0 origin-left scale-x-0 bg-[color-mix(in_srgb,var(--ps-c)_18%,transparent)]'
const LAND = 'pointer-events-none absolute inset-0 animate-ps-land'
const TOP = 'relative flex h-[18px] items-center'
const KBD =
  'ps-num h-[18px] min-w-[18px] rounded-[5px] px-1 text-center text-ps-micro leading-[18px] font-bold text-ps-mut shadow-[inset_0_0_0_1px_var(--color-ps-line-2),0_1px_0_var(--color-ps-line-2)]'
const TAG_BOX = 'inline-flex h-[18px] items-center gap-[3px] rounded-[5px] px-1.5 text-[9.5px] leading-none font-extrabold tracking-[0.1em] whitespace-nowrap'
// v5 .tag: no canto de cima, fora do fluxo; a largura dela já está na reserva do botão, ao lado da tecla.
const TAG = `absolute top-0 right-0 ${TAG_BOX} text-ps-ink-0`
// Nome e meta numa caixa só; o número grande fica à direita dela, no espaço que o nome sempre reserva (pr-6).
const BODY = 'relative mt-1 flex flex-col gap-[3px]'
const NAME = 'block pr-6 text-ps-md leading-[1.1] font-extrabold tracking-[0.03em] break-words data-[fit=small]:text-[14px]'
const META = 'ps-num block text-ps-sm leading-[13px] whitespace-nowrap'
// v5 .big: número da contagem em branco de armado. 25 px (o v5 tem 30): a caixa das letras cabe na
// altura de nome + meta, então fica a 4 px da etiqueta e da borda de baixo no botão de 64 px.
const BIG =
  'ps-num pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 text-[25px] leading-none font-extrabold text-ps-arm [text-shadow:0_0_12px_color-mix(in_srgb,var(--color-ps-arm)_45%,transparent)]'
// Reserva (Ruling T10-largura): o estado mais largo da música, invisível e sem altura; só entra na largura.
const SIZER = 'pointer-events-none invisible flex h-0 flex-col overflow-hidden'
const MORE =
  'flex min-w-[52px] flex-1 items-center justify-center gap-1 rounded-ps-lg bg-ps-s1 px-2 text-ps-bone inset-ring inset-ring-ps-line select-none transition-[transform,box-shadow] duration-150 hover:inset-ring-ps-line-2 active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or disabled:pointer-events-none disabled:opacity-35'
const NOTE = 'flex min-h-[clamp(64px,8vh,82px)] flex-wrap items-center gap-x-4 gap-y-2 rounded-ps-lg bg-ps-s1 px-4 py-2.5 inset-ring inset-ring-ps-line'

interface PadParts { s: StageSection; meta: HTMLElement; fill: HTMLElement | null; big: HTMLElement | null }
/** Janela da fileira: `k` botões inteiros à vista, `step` = largura do botão + espaço; `overflow` quando nem todos cabem. */
interface RowLayout { k: number; step: number; overflow: boolean }
const NO_LAYOUT: RowLayout = { k: 0, step: 0, overflow: false }

const tooTall = (name: HTMLElement, px: number) => name.offsetHeight > px * NAME_LEADING * (NAME_MAX_LINES + 0.5)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Mede a fileira UMA vez por layout (seções, teto do plano, largura da tela, fontes); trocar de
 * estado nunca passa por aqui. 1) O que cada botão pede na largura livre: a reserva do estado mais
 * largo entra no min-content, e o nome cabe em 2 linhas (16 px; senão 14 px; senão a reserva alarga).
 * 2) Todos ficam com a largura do maior pedido (no mínimo 104 px), dividindo a sobra: cabe tudo, a
 * fileira inteira; não cabe, `k` botões inteiros entre os indicadores, em pixels inteiros (a rolagem
 * encaixa sem sobrar meio pixel de vizinho). 3) O nome na largura final.
 */
function layoutRow(track: HTMLElement, row: HTMLElement): RowLayout {
  const pads = [...row.querySelectorAll<HTMLElement>('[data-section-pad]')]
  const names = pads.map((pad) => pad.querySelector<HTMLElement>('[data-pad-name]'))
  const n = pads.length
  let padMin = PAD_MIN_PX
  pads.forEach((pad, k) => {
    const name = names[k]
    if (name) delete name.dataset.fit
    pad.style.width = 'min-content'
    let w = Math.max(PAD_MIN_PX, Math.ceil(parseFloat(getComputedStyle(pad).width)) || pad.offsetWidth)
    pad.style.width = `${w}px`
    if (name && tooTall(name, NAME_PX)) {
      name.dataset.fit = 'small'
      while (tooTall(name, NAME_SMALL_PX) && w < WIDEN_MAX) {
        w = Math.min(WIDEN_MAX, w + WIDEN_STEP)
        pad.style.width = `${w}px`
      }
      delete name.dataset.fit
    }
    padMin = Math.max(padMin, w)
  })
  row.dataset.padMin = String(padMin)

  const avail0 = track.clientWidth
  let layout = NO_LAYOUT
  let padW: number | null = null
  if (avail0 > 0 && n > 0) {
    if (n * padMin + (n - 1) * GAP <= avail0) {
      padW = (avail0 - (n - 1) * GAP) / n
      layout = { k: n, step: padW + GAP, overflow: false }
    } else {
      const avail = avail0 - 2 * (MORE_W + GAP)
      const k = Math.max(1, Math.floor((avail + GAP) / (padMin + GAP)))
      padW = Math.max(padMin, Math.floor((avail - (k - 1) * GAP) / k))
      layout = { k, step: padW + GAP, overflow: true }
    }
  }
  for (const pad of pads) pad.style.width = padW === null ? '' : `${padW}px`
  row.style.flex = layout.overflow ? 'none' : ''
  row.style.width = layout.overflow && padW !== null ? `${layout.k * padW + (layout.k - 1) * GAP}px` : ''
  names.forEach((name) => { if (name && tooTall(name, NAME_PX)) name.dataset.fit = 'small' })
  return layout
}

/**
 * Primeiro botão da janela pra a AGORA ficar à vista (e o alvo armado também, quando os dois
 * cabem juntos), mexendo o mínimo a partir de onde a janela está.
 */
function pickFirst(first: number, k: number, n: number, current: number, armed: number): number {
  let f = first
  const show = (i: number) => {
    if (i < 0) return
    if (i < f) f = i
    else if (i >= f + k) f = i - k + 1
  }
  if (armed >= 0 && current >= 0 && Math.abs(armed - current) < k) show(armed)
  show(current)
  return clamp(f, 0, Math.max(0, n - k))
}

function scrollToFirst(row: HTMLElement, f: number, step: number, smooth: boolean): void {
  const left = Math.round(f * step)
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (smooth && !reduce && typeof row.scrollTo === 'function') row.scrollTo({ left, behavior: 'smooth' })
  else row.scrollLeft = left
}

function setScale(el: HTMLElement, p: number): void {
  const v = `scaleX(${Math.round(p * 1000) / 1000})`
  if (el.style.transform !== v) el.style.transform = v
}

/** O que o toque faz, pra dica do botão (a regra é a da T4: tocando arma ou cancela; parado leva pro início). */
function hint(s: StageSection, key: string | null, isPlaying: boolean, pressed: boolean, loop: boolean, current: boolean): string {
  const k = key ? ` (tecla ${key})` : ''
  if (!isPlaying) return `Ir pro início de ${s.label}${k}`
  if (pressed && loop) return `Desligar o loop de ${s.label}${k}`
  if (pressed) return `Cancelar o pulo pra ${s.label}${k}`
  if (current) return `Repetir ${s.label}${k}`
  return `Armar ${s.label}${k}. Toque de novo pra cancelar.`
}

/**
 * Conta do indicador da ponta, escrita direto no DOM (a janela anda pela rolagem, não pelo React):
 * quantas seções estão fora daquele lado ("‹ 3", "5 ›"); sem nenhuma, desabilitado e só a seta.
 */
function writeMore(btn: HTMLButtonElement | null, side: 'antes' | 'depois', count: number): void {
  if (!btn) return
  const label = count === 0 ? `Nenhuma seção ${side}` : `Ver ${count} ${count === 1 ? 'seção' : 'seções'} ${side}`
  if (btn.disabled !== (count === 0)) btn.disabled = count === 0
  if (btn.getAttribute('aria-label') !== label) { btn.setAttribute('aria-label', label); btn.title = label }
  const num = btn.querySelector<HTMLElement>('[data-pads-more-count]')
  if (num) setText(num, count > 0 ? String(count) : '')
}

/** Indicador da ponta: tocável (52 px), pagina pela quantidade de botões à vista. A conta vem do writeMore. */
function MoreButton({ side, ref, onPage }: { side: 'antes' | 'depois'; ref: React.Ref<HTMLButtonElement>; onPage(): void }) {
  return (
    <button ref={ref} type="button" data-pads-more={side} onClick={onPage} className={MORE}>
      {side === 'antes' && <Icon name="chl" className="size-4" />}
      <span data-pads-more-count="" className="ps-num text-ps-base leading-none font-bold empty:hidden" />
      {side === 'depois' && <Icon name="chr" className="size-4" />}
    </button>
  )
}

/**
 * Botoeira de seções do palco novo (mockup v5, textos do v6): um botão por seção na ordem da
 * música, com a tecla de atalho, o nome e a linha de baixo do `padMeta`. AGORA na cor da seção;
 * PRÓXIMA, REPETE ou REPETE Nx em branco, listrado e pulsando (animações da T1); número grande da
 * contagem pelo tempo OUVIDO; brilho quando pousa. Cada botão reserva a largura do estado mais
 * largo da música, então nada anda debaixo do dedo. Quando não cabe tudo, a janela mostra botões
 * inteiros e os indicadores das pontas paginam. Linha de baixo, progresso e número saem do relógio
 * a cada quadro, escritos direto no DOM. No Livre, convite pros planos; no pago sem seções, o
 * caminho pro EDITAR. O toque só chama `onTap`: quem decide é a regra da T4.
 */
export function SectionPads({ sections, currentSection, intent, transition, isPlaying, landed, gates, clock, onTap, onUpgrade }: SectionPadsProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const partsRef = useRef<PadParts[]>([])
  const relayout = useRef(() => {})
  const firstRef = useRef(0) // primeiro botão inteiro da janela (a rolagem manda; não é estado do React)
  const beforeRef = useRef<HTMLButtonElement>(null)
  const afterRef = useRef<HTMLButtonElement>(null)
  const [layout, setLayout] = useState<RowLayout>(NO_LAYOUT)
  const n = sections.length
  const showPads = gates.sections && n > 0
  const selfLoop = isSelfLoop(intent, currentSection)
  const armedIndex = intent !== null && !selfLoop ? intent.target : null
  // A conta do motor só vale pro alvo armado agora (troca de alvo chega antes da conta nova).
  const pending = armedIndex !== null && transition !== null && transition.to === armedIndex ? transition : null
  const reserve = padReserve(sections, gates.maxRepeats)
  // Muda só com o que muda a largura: seções (nomes, compassos, tempos) e o teto do REPETE.
  const layoutKey = `${gates.maxRepeats}#${sections.map((s) => `${s.index}|${s.label}|${s.bars}|${s.start}|${s.end}`).join('~')}`
  const curPos = sections.findIndex((s) => s.index === currentSection)
  const armedPos = armedIndex === null ? -1 : sections.findIndex((s) => s.index === armedIndex)

  const paint = () => {
    const parts = partsRef.current
    if (parts.length === 0) return
    const heardNow = clock.heardNow()
    const position = clock.position()
    const label = pending ? countState(pending, heardNow).currentLabel : null
    for (const p of parts) {
      setText(p.meta, padMeta(p.s, p.s.index, { current: currentSection, position, transition: pending, heardNow }))
      if (p.fill) setScale(p.fill, padProgress(p.s, position))
      if (p.big) setText(p.big, label !== null ? String(label) : '')
    }
  }

  // Depois de cada renderização: guarda as peças de cada botão e pinta (sem medir nada).
  useLayoutEffect(() => {
    const row = rowRef.current
    const parts: PadParts[] = []
    if (row && showPads) {
      sections.forEach((s, k) => {
        const pad = row.children[k] as HTMLElement | undefined
        const meta = pad?.querySelector<HTMLElement>('[data-pad-meta]')
        if (!pad || !meta) return
        parts.push({ s, meta, fill: pad.querySelector<HTMLElement>('[data-pad-fill]'), big: pad.querySelector<HTMLElement>('[data-pad-big]') })
      })
    }
    partsRef.current = parts
    paint()
  })
  useLayoutEffect(() => {
    relayout.current = () => {
      const track = trackRef.current
      const row = rowRef.current
      if (!track || !row) return
      const next = layoutRow(track, row)
      setLayout((prev) => (prev.k === next.k && prev.step === next.step && prev.overflow === next.overflow ? prev : next))
    }
  })
  // Mede só quando o layout muda (seções, teto do plano); a janela e as fontes chamam pelo efeito de baixo.
  useLayoutEffect(() => {
    if (showPads) relayout.current()
  }, [layoutKey, showPads])
  useEffect(() => {
    const track = trackRef.current
    if (!track || !showPads) return
    let alive = true
    document.fonts?.ready.then(() => { if (alive) relayout.current() })
    if (typeof ResizeObserver === 'undefined') return () => { alive = false }
    const ro = new ResizeObserver(() => relayout.current())
    ro.observe(track)
    return () => { alive = false; ro.disconnect() }
  }, [showPads])
  const showFirst = (f: number) => {
    firstRef.current = f
    writeMore(beforeRef.current, 'antes', f)
    writeMore(afterRef.current, 'depois', Math.max(0, n - layout.k - f))
  }
  // A AGORA (e o alvo armado, se cabem juntos) à vista já encaixada, quando a seção, o alvo ou a janela mudam.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || !layout.overflow) return
    const now = clamp(Math.round(row.scrollLeft / layout.step), 0, n - layout.k)
    const f = pickFirst(now, layout.k, n, curPos, armedPos)
    scrollToFirst(row, f, layout.step, false)
    firstRef.current = f
    writeMore(beforeRef.current, 'antes', f)
    writeMore(afterRef.current, 'depois', Math.max(0, n - layout.k - f))
  }, [curPos, armedPos, layout, n])
  useFrame(paint, showPads)

  const onScroll = () => {
    const row = rowRef.current
    if (row && layout.overflow) showFirst(clamp(Math.round(row.scrollLeft / layout.step), 0, n - layout.k))
  }
  const page = (dir: -1 | 1) => {
    const row = rowRef.current
    if (!row || !layout.overflow) return
    const f = clamp(firstRef.current + dir * layout.k, 0, n - layout.k)
    scrollToFirst(row, f, layout.step, true)
    showFirst(f)
  }

  if (!showPads) {
    return (
      <div data-tour="secoes" role="group" aria-label="Seções da música" className="px-ps-gutter pt-2.5">
        <div className={NOTE}>
          {!gates.sections ? (
            <>
              <p className="min-w-0 font-ps-sans text-ps-base leading-snug text-ps-bone">{INVITE}</p>
              <Button onClick={onUpgrade}>Conhecer os planos</Button>
            </>
          ) : (
            <p className="min-w-0 font-ps-sans text-ps-base leading-snug text-ps-mut">{NO_SECTIONS}</p>
          )}
        </div>
      </div>
    )
  }

  const reservedTags = [...reserve.tags.map((text) => ({ text, loop: false })), { text: 'AGORA', loop: true }]
  return (
    <div data-tour="secoes" role="group" aria-label="Seções da música" className="px-ps-gutter pt-2.5">
      <div ref={trackRef} data-pads-track="" className={TRACK}>
        {layout.overflow && <MoreButton side="antes" ref={beforeRef} onPage={() => page(-1)} />}
        <div ref={rowRef} data-pads-scroller="" onScroll={onScroll} className={ROW}>
          {sections.map((s, k) => {
            const tag = padTag(intent, s.index, currentSection)
            const current = s.index === currentSection
            const armed = s.index === armedIndex
            const loop = tag !== null && tag.loop
            const pressed = intent !== null && intent.target === s.index
            const key = k < KEYS ? String(k + 1) : null
            const state = armed ? (tag?.kind === 'repete' ? 'repete' : 'armada') : current ? (loop ? 'loop' : 'atual') : 'normal'
            let spoken = s.label
            if (tag?.kind === 'agora') spoken += loop ? ', agora, em loop' : ', agora'
            else if (tag) spoken += `, ${tag.text.toLowerCase()}`
            return (
              <button
                key={s.index}
                type="button"
                data-section-pad={s.index}
                data-state={state}
                aria-pressed={pressed}
                aria-keyshortcuts={key ?? undefined}
                aria-label={spoken}
                title={hint(s, key, isPlaying, pressed, loop, current)}
                style={{ '--ps-c': s.color } as React.CSSProperties}
                className={cx(PAD, current ? CURRENT_BG : 'bg-ps-s1', armed ? ARMED : current ? CURRENT_RING : IDLE_RING)}
                onClick={() => onTap(s.index)}
              >
                {landed !== null && landed.index === s.index && <span key={landed.at} data-pad-land="" aria-hidden="true" className={LAND} />}
                {current && <span data-pad-fill="" aria-hidden="true" className={FILL} />}
                <span aria-hidden="true" className={STRIP} />
                <span className={TOP}>
                  {key && <kbd data-pad-key="" aria-hidden="true" className={KBD}>{key}</kbd>}
                  {tag && (
                    <span data-pad-tag="" data-kind={tag.kind} aria-hidden="true" className={cx(TAG, tag.kind === 'agora' ? 'bg-(--ps-c)' : 'bg-ps-arm')}>
                      {tag.text}
                      {tag.loop && <Icon name="loop" className="size-2.5 stroke-3" />}
                    </span>
                  )}
                </span>
                <span className={BODY}>
                  <span data-pad-name="" className={NAME}>{s.label}</span>
                  <span data-pad-meta="" className={cx(META, armed ? 'font-bold text-ps-arm' : current ? 'text-ps-bone' : 'text-ps-mut')} />
                  {armed && <span data-pad-big="" aria-hidden="true" className={BIG} />}
                </span>
                <span data-pad-sizer="" aria-hidden="true" className={SIZER}>
                  {reservedTags.map((t) => (
                    <span key={`${t.text}${t.loop}`} className="flex gap-1">
                      {key && <kbd className={KBD}>{key}</kbd>}
                      <span className={TAG_BOX}>
                        {t.text}
                        {t.loop && <Icon name="loop" className="size-2.5 stroke-3" />}
                      </span>
                    </span>
                  ))}
                  {reserve.metas.map((m) => <span key={m} className={META}>{m}</span>)}
                  <span className={cx(META, 'pr-6')}>{PAD_COUNT_TEXT}</span>
                </span>
              </button>
            )
          })}
        </div>
        {layout.overflow && <MoreButton side="depois" ref={afterRef} onPage={() => page(1)} />}
      </div>
    </div>
  )
}
