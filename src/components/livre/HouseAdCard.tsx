// Cartão do anúncio da casa (Parte 3, spec seção 6): um Panel no fluxo da tela, sem som, sem
// vídeo e sem cobrir nada, com "Conhecer o Pro" e "Agora não". Só mostra; quem monta (AdSlot,
// T18) decide quando, grava o evento e garante a regra do Livre: nunca com a música tocando ou
// na pré-contagem, no máximo um anúncio grande por sessão.
import { useId } from 'react'
import { Button, Panel } from '../ui'
import { HOUSE_AD_COPY } from './adCopy'
import type { HouseAdPlacement } from './adCopy'

export interface HouseAdCardProps {
  placement: HouseAdPlacement
  onCta(): void
  onDismiss(): void
}

export function HouseAdCard({ placement, onCta, onDismiss }: HouseAdCardProps) {
  const copy = HOUSE_AD_COPY[placement]
  const titleId = useId()
  return (
    <Panel
      variant="raised"
      role="region"
      aria-labelledby={titleId}
      data-house-ad={placement}
      className="flex min-w-0 flex-col gap-3 p-4 font-ps-sans"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p id={titleId} className="text-ps-md leading-snug font-bold break-words text-ps-bone">{copy.title}</p>
        {copy.body && <p className="text-ps-base leading-relaxed break-words text-ps-mut">{copy.body}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button tone="ghost" onClick={onDismiss}>{copy.dismiss}</Button>
        <Button tone="primary" onClick={onCta}>{copy.cta}</Button>
      </div>
    </Panel>
  )
}
