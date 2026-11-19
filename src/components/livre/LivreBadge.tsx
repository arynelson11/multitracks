// Selo do Livre na barra do palco novo (Parte 3, spec seção 6): "LIVRE · 2 de 3 músicas este
// mês", discreto e permanente com o palco parado; o toque abre os Planos. Mesma pílula de 22 px
// do selo ONLINE/OFFLINE da barra (mockup v5 .online), nas cores neutras do OFFLINE: é
// informação, não alerta nem ação principal. O botão em volta dá o alvo de 44 px. Abaixo de
// 1280 px a barra não tem lugar pro texto inteiro com OFFLINE, HOST e o aviso SAÍDAS: o selo
// mostra "LIVRE · 2 de 3" e o nome do botão continua com o texto inteiro. Quem decide se aparece
// é o buildStageView (só com a música parada e fora da pré-contagem).
import { LIVRE_BADGE_REST, livreBadgeShort, livreBadgeText } from './adCopy'

export interface LivreBadgeProps {
  used: number
  limit: number
  onClick(): void
}

const BTN =
  'group inline-flex shrink-0 items-center justify-center min-h-ps-touch min-w-ps-touch select-none rounded-ps-pill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
// As mesmas medidas do selo ONLINE/OFFLINE (StageAppBar), com as cores neutras do OFFLINE.
const PILL =
  'inline-flex h-[22px] shrink-0 items-center rounded-ps-pill px-[9px] text-ps-micro leading-none font-extrabold tracking-[0.14em] whitespace-nowrap bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line-2 transition-colors duration-150 group-hover:text-ps-bone group-hover:inset-ring-ps-line-3'

export function LivreBadge({ used, limit, onClick }: LivreBadgeProps) {
  return (
    <button type="button" data-livre-badge="" aria-label={livreBadgeText(used, limit)} title="Ver os planos" onClick={onClick} className={BTN}>
      <span data-livre-pill="" className={PILL}>
        {/* Uma linha de texto só (o flex da pílula comeria o espaço antes de "músicas"). */}
        <span>
          {livreBadgeShort(used, limit)}
          <span className="hidden xl:inline">{LIVRE_BADGE_REST}</span>
        </span>
      </span>
    </button>
  )
}
