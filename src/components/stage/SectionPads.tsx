import { useEffect, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, StageClock, StageGates, StageSection, StageView, TransitionView } from '../../lib/stageContracts'
import { countState } from '../../lib/transitionView'
import { Button, cx } from '../ui'
import { Icon } from './icons'
import { padMeta, padProgress, padTag } from './sectionPadMeta'
import { setFlag, setText } from './stageDom'
import { useFrame } from './useFrame'

export interface SectionPadsProps {
  sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null; isPlaying: boolean
  landed: StageView['landed']; gates: StageGates; clock: Pick<StageClock, 'heardNow' | 'position'>; onTap(i: number): void; onUpgrade(): void
}

const INVITE = 'Marque as seções da música e troque de parte ao vivo sem parar a VS.'
const NO_SECTIONS = 'Esta música ainda não tem seções. Marque no EDITAR.'
/** Teclas de atalho 1 a 9 nas 9 primeiras seções. */
const KEYS = 9
/** Margem lateral da fileira (px-ps-gutter): a AGORA para com essa folga da borda ao rolar. */
const GUTTER = 16
/** Folga mínima entre a tecla e a etiqueta; menos que isso a tecla sai (nunca uma por cima da outra). */
const KEY_GAP = 4
/** Nome a 16 px em até 2 linhas (altura de linha 1,1); passou disso, desce pra 14 px. Nunca corta. */
const NAME_PX = 16
const NAME_LEADING = 1.1
const NAME_MAX_LINES = 2

// v5 .botoeira: fileira com 8 px entre os botões. Colunas iguais quando cabe; quando não cabe, cada
// botão fica com o que o texto dele pede (no mínimo 104 px) e a fileira rola de lado.
const ROW = 'relative grid grid-flow-col auto-cols-[minmax(min-content,1fr)] gap-ps-gap overflow-x-auto px-ps-gutter pt-2.5 [scrollbar-width:thin]'
// v5 .sp: 64 a 82 px de altura (8vh), faixa da cor à esquerda. Cresce na altura se o nome quebrar
// em 2 linhas (a fileira inteira acompanha, pra todos ficarem iguais). Foco por dentro: a fileira rola e
// cortaria o contorno de fora.
const PAD =
  'group relative isolate flex min-w-[104px] min-h-[clamp(64px,8vh,82px)] flex-col justify-center gap-0.5 overflow-clip rounded-ps-lg py-[5px] pr-2.5 pl-[18px] text-left font-ps-sans text-ps-bone select-none transition-[transform,background-color] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
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
  'ps-num h-[18px] min-w-[18px] rounded-[5px] px-1 text-center text-ps-micro leading-[18px] font-bold text-ps-mut shadow-[inset_0_0_0_1px_var(--color-ps-line-2),0_1px_0_var(--color-ps-line-2)] group-data-[tight=true]:hidden'
// v5 .tag: no canto de cima, fora do fluxo (não muda a largura do botão quando aparece).
const TAG =
  'absolute top-0 right-0 inline-flex h-[18px] items-center gap-[3px] rounded-[5px] px-1.5 text-[9.5px] leading-none font-extrabold tracking-[0.1em] whitespace-nowrap text-ps-ink-0'
// Nome e meta numa caixa só; o número grande fica à direita dela, no espaço que o nome sempre reserva (pr-5).
const BODY = 'relative flex flex-col gap-0.5'
const NAME = 'block pr-5 text-ps-md leading-[1.1] font-extrabold tracking-[0.03em] break-words data-[fit=small]:text-[14px]'
const META = 'ps-num block text-ps-sm leading-[13px] whitespace-nowrap'
// v5 .big: número da contagem em branco de armado. 26 px (o v5 tem 30) pra caber entre a etiqueta e a
// borda de baixo no botão de 64 px sem encostar em nada.
const BIG =
  'ps-num pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 text-[26px] leading-none font-extrabold text-ps-arm [text-shadow:0_0_12px_color-mix(in_srgb,var(--color-ps-arm)_45%,transparent)]'
const NOTE = 'flex min-h-[clamp(64px,8vh,82px)] flex-wrap items-center gap-x-4 gap-y-2 rounded-ps-lg bg-ps-s1 px-4 py-2.5 inset-ring inset-ring-ps-line'

interface PadParts { s: StageSection; meta: HTMLElement; fill: HTMLElement | null; big: HTMLElement | null }

/** Nome em 16 px; se passar de 2 linhas na largura que o botão dá, 14 px. A tecla sai se a etiqueta não cabe ao lado. */
function fitPad(pad: HTMLElement): void {
  const name = pad.querySelector<HTMLElement>('[data-pad-name]')
  if (name) {
    delete name.dataset.fit
    if (name.offsetHeight > NAME_PX * NAME_LEADING * (NAME_MAX_LINES + 0.5)) name.dataset.fit = 'small'
  }
  setFlag(pad, 'tight', false)
  const key = pad.querySelector<HTMLElement>('[data-pad-key]')
  const tag = pad.querySelector<HTMLElement>('[data-pad-tag]')
  if (key && tag) setFlag(pad, 'tight', tag.getBoundingClientRect().left < key.getBoundingClientRect().right + KEY_GAP)
}

/** Rola a fileira o mínimo pra o botão caber inteiro, com a margem lateral. */
function keepInView(row: HTMLElement, pad: HTMLElement | null): void {
  if (!pad) return
  const left = pad.offsetLeft - GUTTER
  const right = pad.offsetLeft + pad.offsetWidth + GUTTER
  if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left)
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth
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
 * Botoeira de seções do palco novo (mockup v5, textos do v6): um botão por seção na ordem da
 * música, com a tecla de atalho, o nome e a linha de baixo do `padMeta`. AGORA na cor da seção;
 * PRÓXIMA, REPETE ou REPETE Nx em branco, listrado e pulsando (animações da T1); número grande da
 * contagem pelo tempo OUVIDO; brilho quando pousa. Linha de baixo, progresso e número saem do
 * relógio a cada quadro, escritos direto no DOM. No Livre, convite pros planos; no pago sem
 * seções, o caminho pro EDITAR. O toque só chama `onTap`: quem decide é a regra da T4.
 */
export function SectionPads({ sections, currentSection, intent, transition, isPlaying, landed, gates, clock, onTap, onUpgrade }: SectionPadsProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const partsRef = useRef<PadParts[]>([])
  const showPads = gates.sections && sections.length > 0
  const selfLoop = isSelfLoop(intent, currentSection)
  const armedIndex = intent !== null && !selfLoop ? intent.target : null
  // A conta do motor só vale pro alvo armado agora (troca de alvo chega antes da conta nova).
  const pending = armedIndex !== null && transition !== null && transition.to === armedIndex ? transition : null

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

  // Depois de cada renderização: guarda as peças de cada botão, acerta nome e tecla e pinta.
  useLayoutEffect(() => {
    const row = rowRef.current
    const parts: PadParts[] = []
    if (row && showPads) {
      sections.forEach((s, k) => {
        const pad = row.children[k] as HTMLElement | undefined
        const meta = pad?.querySelector<HTMLElement>('[data-pad-meta]')
        if (!pad || !meta) return
        fitPad(pad)
        parts.push({ s, meta, fill: pad.querySelector<HTMLElement>('[data-pad-fill]'), big: pad.querySelector<HTMLElement>('[data-pad-big]') })
      })
    }
    partsRef.current = parts
    paint()
  })
  // A AGORA sempre à vista quando a fileira rola (só quando a seção muda, pra não brigar com quem rolou).
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row && showPads) keepInView(row, row.querySelector<HTMLElement>(`[data-section-pad="${currentSection}"]`))
  }, [currentSection, showPads, sections.length])
  // Janela mudou de largura ou as fontes chegaram: mede de novo e traz a AGORA de volta.
  const refit = useRef(() => {})
  useLayoutEffect(() => {
    refit.current = () => {
      const row = rowRef.current
      if (!row) return
      for (const p of row.querySelectorAll<HTMLElement>('[data-section-pad]')) fitPad(p)
      keepInView(row, row.querySelector<HTMLElement>(`[data-section-pad="${currentSection}"]`))
    }
  })
  useEffect(() => {
    const row = rowRef.current
    if (!row || !showPads) return
    let alive = true
    document.fonts?.ready.then(() => { if (alive) refit.current() })
    if (typeof ResizeObserver === 'undefined') return () => { alive = false }
    const ro = new ResizeObserver(() => refit.current())
    ro.observe(row)
    return () => { alive = false; ro.disconnect() }
  }, [showPads])
  useFrame(paint, showPads)

  if (!gates.sections || sections.length === 0) {
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

  return (
    <div ref={rowRef} data-tour="secoes" role="group" aria-label="Seções da música" className={ROW}>
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
          </button>
        )
      })}
    </div>
  )
}
