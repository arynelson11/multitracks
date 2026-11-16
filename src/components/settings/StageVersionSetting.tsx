// Chave do palco (R-25): Novo ou Antigo, primeira opção de CONFIG > Geral nos dois palcos.
// Só recebe props; quem grava em settings.stageVersion e aplica na próxima parada é o App (T29).
import { useId } from 'react'
import { Segmented } from '../ui'
import type { SegmentedOption } from '../ui'
import type { StageVersion } from '../../lib/stageContracts'

export interface StageVersionSettingProps { value: StageVersion; onChange(v: StageVersion): void }

const OPTIONS: SegmentedOption<StageVersion>[] = [
  { value: 'novo', label: 'Novo' },
  { value: 'antigo', label: 'Antigo' },
]

export function StageVersionSetting({ value, onChange }: StageVersionSettingProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ps-base font-bold text-ps-bone">Palco</h3>
      <Segmented
        aria-label="Palco"
        options={OPTIONS}
        value={value}
        onChange={(v) => { if (v !== value) onChange(v) }}
        className="self-start max-w-full flex-wrap"
      />
      <p className="text-ps-base leading-snug text-ps-mut">
        Se o palco novo der problema no culto, volte pro antigo aqui. Vale na próxima vez que a música parar. O repertório e o som não mudam.
      </p>
    </section>
  )
}
