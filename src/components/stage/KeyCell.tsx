import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { KEY_NAMES, keyIndex, transposeKeyName } from '../../lib/keyNames'
import { sanitizeSemitones, semitonesBetweenKeys } from '../../lib/pitchRules'
import { Chip, Panel, cx } from '../ui'
import { Icon } from './icons'

export interface KeyCellProps { originalKey: string | null; pitch: number; gridOpen: boolean; onGridOpenChange(open: boolean): void; onChangePitch(semitones: number): void }

const UNKNOWN = 'Tom original desconhecido'
/** Sinal de menos tipográfico (U+2212), como no v5. */
const MINUS = '−'

/** "+2" ou "−1" (sinal de menos); vazio no tom original. */
const shiftText = (s: number): string => (s > 0 ? `+${s}` : s < 0 ? `${MINUS}${-s}` : '')
const shiftTitle = (s: number): string => `Transposto ${Math.abs(s)} ${Math.abs(s) === 1 ? 'semitom' : 'semitons'} ${s > 0 ? 'acima' : 'abaixo'}`
/** Sem tom original, a grade escolhe em semitons, na mesma distância que a grade de tons dá (caminho mais curto). */
const SEMITONE_STEPS: readonly number[] = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
const SEMITONE_NOTE = 'Sem tom original: escolha em semitons'
const semitoneLabel = (n: number): string => `${n === 0 ? '0' : shiftText(n)} ${Math.abs(n) === 1 ? 'semitom' : 'semitons'}${n === 0 ? ', original' : ''}`

// v5 .cell com 12 px de lado (o v5 tem 16): em 1280 a coluna tem 176 px e a fileira −1 ORIG. +1 com
// alvos de 44 px precisa de 147.
const CELL = 'relative flex min-w-0 flex-col justify-center gap-2 px-3 py-3'
// v5 .keybtn: 56 px. A faixa mede o botão (data-fit-width): se o tom, o "original" e a seta não couberem
// na largura, a seta sai e o tom desce pra 30 px (o "m" do menor já é menor). Nada corta.
const KEY_BTN =
  'group/key flex min-h-14 w-full min-w-ps-touch items-center gap-2.5 rounded-ps-lg bg-ps-s2 py-1.5 pr-2.5 pl-3 text-left inset-ring inset-ring-ps-line transition-[box-shadow,transform] duration-150 hover:inset-ring-ps-line-3 aria-expanded:inset-ring-ps-line-3 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const CHIP_EXTRA = 'grow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
// v5 .kp-g button: 50 px de altura; a largura vem do texto (a coluna mais larga manda nas 6), com 6 px de folga.
const GRID_KEY =
  'flex min-h-[50px] min-w-ps-touch flex-col items-center justify-center gap-1 rounded-ps-md px-1.5 transition-[box-shadow,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const GRID_IDLE = 'bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-3'
const GRID_CURRENT = 'bg-ps-or text-ps-on-or'

/** Botão da grade: o rótulo em cima e ORIGINAL embaixo (reservado em todos, visível no original); o atual em laranja. */
function GridButton({ aria, original, current, wide = false, onChoose, children }: { aria: string; original: boolean; current: boolean; wide?: boolean; onChoose(): void; children: ReactNode }) {
  return (
    <button
      type="button" aria-pressed={current} aria-label={aria} onClick={() => onChoose()}
      className={cx(GRID_KEY, wide && 'col-span-6', current ? GRID_CURRENT : GRID_IDLE)}
    >
      <span className="text-ps-md leading-none font-extrabold whitespace-nowrap">{children}</span>
      <span
        data-original-tag="" aria-hidden="true"
        className={cx('text-[8.5px] leading-none font-extrabold tracking-[0.04em]', original ? 'visible' : 'invisible', current ? 'text-ps-on-or' : 'text-ps-mut')}
      >
        ORIGINAL
      </span>
    </button>
  )
}

/** Tom com o "m" do menor menor (60%), como numa cifra: "C#m" ocupa menos e não cansa a leitura. */
function KeyName({ name }: { name: string }) {
  const minor = name.endsWith('m')
  return <>{minor ? name.slice(0, -1) : name}{minor && <small className="text-[0.6em]">m</small>}</>
}

/**
 * TOM da faixa do meio (mockup v5): tom atual (transposto, com sustenido), "original X" e o selo do
 * transporte (+2 / −1); −1 e +1 de meio em meio tom e ORIG. de volta pro original. A grade dos 12
 * tons abre e fecha pelo `gridOpen` da casca: o botão do tom e o toque fora da célula só pedem
 * (`onGridOpenChange`), e o Esc é da casca (que fecha a grade sem cancelar o pulo). Escolher um
 * tom vai pelo caminho mais curto. Sem tom original, nada trava (Ruling T13-semitom): a grade mostra
 * a mudança em semitons, de −6 a +6, com a nota "Sem tom original: escolha em semitons"; o motor
 * recebe semitons, como sempre.
 */
export function KeyCell({ originalKey, pitch, gridOpen, onGridOpenChange, onChangePitch }: KeyCellProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const focusInside = useRef(false)
  const changeRef = useRef(onGridOpenChange)
  const dialogId = useId()

  const shift = sanitizeSemitones(Math.round(pitch))
  const originalIndex = keyIndex(originalKey)
  const current = transposeKeyName(originalKey, shift)
  const currentIndex = keyIndex(current)
  const originalName = transposeKeyName(originalKey, 0)

  useLayoutEffect(() => { changeRef.current = onGridOpenChange })

  // Abriu: o foco vai pro tom atual. Fechou com o foco dentro da grade: volta pro botão do tom.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (gridOpen && dialog) {
      const target = dialog.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? dialog.querySelector<HTMLElement>('button') ?? dialog
      target.focus()
    } else if (!gridOpen && focusInside.current) {
      focusInside.current = false
      triggerRef.current?.focus()
    }
  }, [gridOpen])

  // Toque fora da célula com a grade aberta: pede pra fechar.
  useEffect(() => {
    if (!gridOpen) return
    const onPointerDown = (e: Event) => {
      const root = rootRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) changeRef.current(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [gridOpen])

  const choose = (semitones: number) => {
    onChangePitch(sanitizeSemitones(semitones))
    onGridOpenChange(false)
  }

  return (
    <div ref={rootRef} data-cell="tom" data-tour="tom" className={CELL}>
      <span className="ps-label leading-none">Tom</span>
      <button
        ref={triggerRef} type="button" data-fit-width="" aria-haspopup="dialog" aria-expanded={gridOpen} aria-controls={dialogId}
        aria-label={current ? `Tom atual ${current}. Escolher o tom` : `${UNKNOWN}. Escolher o tom`}
        title={originalIndex !== null ? 'Escolher o tom (grade com os 12 tons)' : 'Escolher a mudança em semitons'} onClick={() => onGridOpenChange(!gridOpen)} className={KEY_BTN}
      >
        <span data-key-current="" className="shrink-0 text-[36px] leading-none font-extrabold tracking-[-0.02em] whitespace-nowrap group-data-[fit]/key:text-[30px]">
          {current ? <KeyName name={current} /> : '?'}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <small data-key-original="" className="text-ps-sm leading-tight text-ps-mut">
            {originalName ? <>original <b className="text-ps-bone">{originalName}</b></> : UNKNOWN}
          </small>
          {shift !== 0 && (
            <span data-key-shift="" title={shiftTitle(shift)} className="ps-num rounded-[5px] bg-ps-or-soft px-[5px] py-[3px] text-ps-sm leading-none font-extrabold text-ps-or">
              {shiftText(shift)}
            </span>
          )}
        </span>
        <Icon name="chd" className="ml-auto size-4 text-ps-mut group-data-[fit]/key:hidden" />
      </button>
      <div className="flex gap-1">
        <Chip aria-label="Descer meio tom" title="Desce meio tom" onClick={() => onChangePitch(sanitizeSemitones(pitch - 1))} className={cx('ps-num', CHIP_EXTRA)}>
          {MINUS}1
        </Chip>
        <Chip small aria-label="Voltar ao tom original" title="Volta ao tom original" onClick={() => onChangePitch(0)} className={CHIP_EXTRA}>
          ORIG.
        </Chip>
        <Chip aria-label="Subir meio tom" title="Sobe meio tom" onClick={() => onChangePitch(sanitizeSemitones(pitch + 1))} className={cx('ps-num', CHIP_EXTRA)}>
          +1
        </Chip>
      </div>
      <div
        ref={dialogRef} id={dialogId} role="dialog" aria-label="Escolher tom" hidden={!gridOpen} tabIndex={-1}
        onFocus={() => { focusInside.current = true }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false }}
        className="absolute bottom-[calc(100%+10px)] left-2 z-40 w-max outline-none"
      >
        <Panel variant="pop" className="p-3">
          <div className="mb-2.5 flex items-center justify-between gap-4">
            <span className="ps-label leading-none">Tom da música</span>
            <span className="text-ps-sm text-ps-mut">{originalIndex !== null ? 'original marcado' : SEMITONE_NOTE}</span>
          </div>
          {originalIndex !== null ? (
            <div className="grid grid-cols-6 gap-1.5">
              {KEY_NAMES.map((name, i) => {
                const label = transposeKeyName(originalKey, i - originalIndex) ?? name
                return (
                  <GridButton
                    key={name} aria={i === originalIndex ? `${label}, original` : label} original={i === originalIndex} current={i === currentIndex}
                    onChoose={() => choose(semitonesBetweenKeys(originalKey, KEY_NAMES[i]))}
                  >
                    <KeyName name={label} />
                  </GridButton>
                )
              })}
            </div>
          ) : (
            // −6 a −1 na primeira linha, o 0 (original) na linha toda, +1 a +6 embaixo.
            <div className="grid grid-cols-6 gap-1.5">
              {SEMITONE_STEPS.map((n) => (
                <GridButton
                  key={n} aria={semitoneLabel(n)} original={n === 0} current={n === shift} wide={n === 0} onChoose={() => choose(n)}
                >
                  <span className="ps-num">{n === 0 ? '0' : shiftText(n)}</span>
                </GridButton>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
