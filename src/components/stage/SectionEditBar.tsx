import type React from 'react'
import { SECTION_SHORTCUTS } from '../../lib/sectionTypes'
import type { StageSection } from '../../lib/stageContracts'
import { Button, cx } from '../ui'
import { Icon } from './icons'
import { TwoTapTrashButton } from './TwoTapTrashButton'

export interface SectionEditBarProps {
  sections: StageSection[]; selected: number | null
  /**
   * A grade sabe onde cai o 1 (click lido: `gridHasPhase`), que é quando o `nudgeSection` anda
   * em compassos. Só com o BPM salvo, ou sem grade, é falso e o ajuste é de 1 s. Não é o
   * `hasGrid` da botoeira (`grid !== null`): música só com BPM salvo tem grade, mas não fase.
   */
  hasPhase: boolean
  onSelect(i: number): void; onMark(label: string): void; onNudge(i: number, dir: -1 | 1): void; onRemove(i: number): void
}

const HINT_SELECT = 'Toque numa seção pra ajustar'
const HINT_EMPTY = 'Marque a primeira seção no ponto que está tocando.'

// Duas fileiras que quebram linha (nada cortado nem encostando): MARCAR com os 6 tipos em cima;
// embaixo as seções da música e, à direita, o ajuste da selecionada (ou a dica).
const BAR = 'flex flex-col gap-ps-gap rounded-ps-lg bg-ps-s1 p-2 font-ps-sans text-ps-bone inset-ring inset-ring-ps-line'
const ROW = 'flex flex-wrap items-center gap-ps-gap'
// Tipo de seção: bolinha na cor do tipo, nome e tecla do atalho (a mesma caixa da tecla da botoeira).
const TYPE =
  'inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center gap-2 rounded-ps-lg bg-ps-s2 px-ps-pad-x text-ps-base font-bold whitespace-nowrap select-none inset-ring inset-ring-ps-line transition-[box-shadow,transform] duration-150 hover:inset-ring-ps-line-2 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const DOT = 'size-2.5 shrink-0 rounded-ps-pill bg-(--ps-c)'
const KBD =
  'ps-num h-[18px] min-w-[18px] rounded-[5px] px-1 text-center text-ps-micro leading-[18px] font-bold text-ps-mut shadow-[inset_0_0_0_1px_var(--color-ps-line-2),0_1px_0_var(--color-ps-line-2)]'
// Seção da música: faixa da cor à esquerda, como na botoeira. Selecionada = fundo e borda na cor
// da seção (cor da seção = seção; laranja e branco ficam pra ligado e armado). Nome antigo maior
// que 14 caracteres quebra a linha dentro do botão, nunca é cortado.
const CHIP =
  'relative isolate inline-flex min-h-ps-touch min-w-ps-touch max-w-full items-center overflow-clip rounded-ps-lg py-1.5 pr-3 pl-[18px] text-left text-ps-base font-extrabold select-none transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const CHIP_IDLE = 'bg-ps-s2 inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2'
const CHIP_SELECTED = 'bg-[color-mix(in_srgb,var(--ps-c)_20%,var(--color-ps-s1))] inset-ring-2 inset-ring-(--ps-c)'
const STRIP = 'pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-(--ps-c)'

/**
 * Barra do modo EDITAR do palco, no lugar da botoeira. MARCAR cria uma seção do tipo tocado
 * (o App marca na posição ouvida); toque numa seção seleciona; a selecionada anda 1 compasso pra
 * trás ou pra frente (sem fase, 1 s) e sai com a lixeira de dois toques do palco (uma armada por
 * vez no palco inteiro; trocar a seleção ou a selecionada andar desarma). `selected` e os índices
 * dos avisos são o `index` da `StageSection` (a T29 traduz pra marca com `markerIdForSpan`).
 * As teclas I V P R B F aparecem em cada tipo; quem escuta o teclado é o App.
 */
export function SectionEditBar({ sections, selected, hasPhase, onSelect, onMark, onNudge, onRemove }: SectionEditBarProps) {
  const sel = selected === null ? null : sections.find((s) => s.index === selected) ?? null
  const unit = hasPhase ? '1 comp.' : '1 s'
  const unitName = hasPhase ? '1 compasso' : '1 segundo'

  return (
    <div className={BAR}>
      <div role="group" aria-label="Marcar seção" className={ROW}>
        <span className="ps-label px-1">MARCAR</span>
        {SECTION_SHORTCUTS.map(({ name, key, color }) => (
          <button
            key={name}
            type="button"
            aria-label={`Marcar ${name}`}
            aria-keyshortcuts={key}
            title={`Marcar ${name} no ponto que está tocando (tecla ${key})`}
            onClick={() => onMark(name)}
            className={TYPE}
            style={{ '--ps-c': color } as React.CSSProperties}
          >
            <span aria-hidden="true" className={DOT} />
            <span data-section-name="">{name}</span>
            <kbd aria-hidden="true" className={KBD}>{key}</kbd>
          </button>
        ))}
      </div>

      <div className={ROW}>
        {sections.length > 0 && (
          <div role="group" aria-label="Seções da música" className="flex min-w-0 flex-1 flex-wrap gap-ps-gap">
            {sections.map((s) => {
              const on = s.index === sel?.index
              return (
                <button
                  key={s.index}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(s.index)}
                  className={cx(CHIP, on ? CHIP_SELECTED : CHIP_IDLE)}
                  style={{ '--ps-c': s.color } as React.CSSProperties}
                >
                  <span aria-hidden="true" className={STRIP} />
                  <span data-section-name="" className="min-w-0 break-words">{s.label}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="flex min-h-ps-touch flex-wrap items-center gap-ps-gap">
          {sel ? (
            <div role="group" aria-label={`Ajustar ${sel.label}`} className="flex flex-wrap items-center gap-ps-gap">
              <Button
                aria-label={`Mover ${sel.label} ${unitName} pra trás`}
                title={`Mover ${unitName} pra trás`}
                icon={<Icon name="chl" className="size-4" />}
                onClick={() => onNudge(sel.index, -1)}
              >
                {unit}
              </Button>
              <Button
                aria-label={`Mover ${sel.label} ${unitName} pra frente`}
                title={`Mover ${unitName} pra frente`}
                onClick={() => onNudge(sel.index, 1)}
              >
                {unit}
                <span aria-hidden="true"><Icon name="chr" className="size-4" /></span>
              </Button>
              {/* A chave remonta a lixeira (desarmada) quando a seleção muda ou a selecionada anda. */}
              <TwoTapTrashButton
                key={`${sel.index}|${sel.start}|${sel.label}`}
                label={`Apagar a seção ${sel.label}`}
                confirmLabel={`Toque de novo para apagar a seção ${sel.label}`}
                onConfirm={() => onRemove(sel.index)}
              />
            </div>
          ) : (
            <p className="px-1 text-ps-sm text-ps-mut">{sections.length > 0 ? HINT_SELECT : HINT_EMPTY}</p>
          )}
        </div>
      </div>
    </div>
  )
}
