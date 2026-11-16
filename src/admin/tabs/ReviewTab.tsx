// Lugar da aba Pendências. A tela de verdade é da T8; a fila já chega pronta pela casca.
import type { FC } from 'react'
import type { AdminQueryState } from '../hooks/useAdminQuery'
import type { ReviewQueue } from '../lib/reviewTypes'
import type { TabProps } from '../lib/tabs'

export const ReviewTab: FC<TabProps & { review: AdminQueryState<ReviewQueue> }> = () => (
  <p className="text-ps-base text-ps-mut">Carregando...</p>
)
