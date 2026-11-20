import type React from 'react'
import { Button } from './Button'
import type { ButtonProps } from './Button'

/** Sem texto, o nome do botão é o aria-label: o tipo obriga. O title (dica do mouse) é o mesmo, se não vier outro. */
export type IconButtonProps = Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> & {
  icon: React.ReactNode
  'aria-label': string
}

/** Botão só de ícone: o Button do kit com 44 x 44 px, ícone escondido do leitor de tela. */
export function IconButton({ icon, title, 'aria-label': label, ...rest }: IconButtonProps) {
  return <Button {...rest} icon={icon} aria-label={label} title={title ?? label} />
}
