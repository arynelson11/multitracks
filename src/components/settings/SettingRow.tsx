// Linha de uma opção das Configurações: nome e frase à esquerda, o controle à direita. Numa tela
// estreita o controle desce pra linha de baixo em vez de espremer o texto.
import type React from 'react'
import { cx } from '../ui'

export interface SettingRowProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** O controle (Button, Select...). */
  children: React.ReactNode
  className?: string
}

export function SettingRow({ title, description, children, className }: SettingRowProps) {
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="text-ps-base font-bold text-ps-bone">{title}</h3>
        {description != null && <p className="text-ps-base leading-snug text-pretty text-ps-mut">{description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
