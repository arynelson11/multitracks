// Tela de Planos na linguagem do palco (Parte 3): a janela do palco (StageDialog lg) com os 4
// cartões, a oferta do primeiro mês quando o contêiner manda o preço dela, e o "Trocar de plano?"
// numa segunda janela por cima. Só props: o PricingModal guarda a conta, a oferta e o checkout.
import { Loader2 } from 'lucide-react'
import { Icon } from '../stage/icons'
import { StageDialog } from '../stage/StageDialog'
import { Button, Notice, Panel, Tag, cx } from '../ui'
import { PRICING_COPY } from './pricingCatalog'
import type { PricingPlan } from './pricingCatalog'
import type { CheckoutPlanKey } from '../../lib/checkout'

export interface PricingCardView extends PricingPlan {
  /** O preço do primeiro mês que esta tela mostra (nulo: preço cheio). */
  offerPrice: string | null
  /** O plano de agora, sem data de fim: não dá pra assinar de novo. */
  current: boolean
  /** Abrindo o pagamento deste cartão. */
  loading: boolean
  disabled: boolean
}

export interface PricingViewProps {
  open: boolean
  onClose(): void
  /** Quem já paga: a linha de baixo do título fala da troca. */
  switching: boolean
  /** O nome do plano de agora (pro "Trocar de plano?"). */
  currentName: string
  cards: readonly PricingCardView[]
  /** O pagamento abriu no navegador do sistema (app de computador). */
  openedExternally: boolean
  /** A troca esperando a confirmação (nulo: nenhuma). */
  pending: { name: string; price: string; period: string } | null
  onConfirmSwitch(): void
  onCancelSwitch(): void
  /** A frase do servidor quando a oferta terminou no meio (o desconto já saiu dos cartões). */
  offerNote?: string | null
  /** Erro do último assinar (sem conta, plano já ativo, pagamento fora, rede). */
  message?: string | null
  onChoose(planKey: CheckoutPlanKey): void
}

function PlanCard({ card, onChoose }: { card: PricingCardView; onChoose(planKey: CheckoutPlanKey): void }) {
  return (
    // O Pro Mensal (Mais Popular) tem o anel mais forte e o botão laranja (a ação principal da tela).
    <Panel variant="raised" data-plan-card={card.planKey} className={cx('flex min-w-0 flex-col gap-4 p-5', card.popular && 'inset-ring-ps-line-3')}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="min-w-0 text-ps-md leading-snug font-bold break-words text-ps-bone">{card.name}</h3>
          {card.popular ? <Tag>{PRICING_COPY.popular}</Tag> : null}
        </div>
        <p className="text-ps-base leading-snug break-words text-ps-mut">{card.description}</p>
      </div>
      {card.offerPrice !== null ? (
        <div data-offer className="flex flex-col gap-0.5">
          <p className="ps-label">{PRICING_COPY.firstMonth}</p>
          <span className="ps-num text-3xl leading-tight font-extrabold text-ps-bone">{card.offerPrice}</span>
          <p className="text-ps-sm leading-snug text-ps-mut">{PRICING_COPY.after(card.price, card.period)}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-1">
          <span className="ps-num text-3xl leading-tight font-extrabold text-ps-bone">{card.price}</span>
          <span className="text-ps-base text-ps-mut">{card.period}</span>
        </div>
      )}
      <ul className="flex flex-1 flex-col gap-2">
        {card.features.map((feat) => (
          <li key={feat} className="flex gap-2 text-ps-base leading-snug text-ps-bone">
            <Icon name="check" className="mt-0.5 size-4 text-ps-mut" />
            <span className="min-w-0 break-words">{feat}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap">
        <Button
          tone={card.popular ? 'primary' : 'default'}
          icon={card.loading ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : undefined}
          aria-busy={card.loading || undefined}
          disabled={card.disabled}
          onClick={() => onChoose(card.planKey)}
        >
          {card.loading ? PRICING_COPY.processing : card.current ? PRICING_COPY.current : PRICING_COPY.subscribe}
        </Button>
      </div>
    </Panel>
  )
}

export function PricingView(p: PricingViewProps) {
  if (!p.open) return null
  const notices = p.openedExternally || p.offerNote || p.message
  return (
    // O clique dentro dos Planos (ou no fundo deles) não sai daqui, como antes (a caixa parava o
    // clique): as Configurações, que montam os Planos dentro da camada delas, não fecham juntas.
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <StageDialog
        open={p.open}
        title={PRICING_COPY.title}
        onClose={p.onClose}
        size="lg"
        // Os avisos ficam no pé, sempre à vista (antes eram avisos do navegador por cima de tudo).
        footer={notices ? (
          <div className="flex basis-full flex-col gap-2">
            {p.openedExternally ? <Notice role="status">{PRICING_COPY.opened}</Notice> : null}
            {p.offerNote ? <Notice tone="alert" role="alert">{p.offerNote}</Notice> : null}
            {p.message ? <Notice tone="alert" role="alert">{p.message}</Notice> : null}
          </div>
        ) : undefined}
      >
        <div data-pricing className="flex flex-col gap-4">
          <p className="text-ps-base leading-snug text-ps-mut">{p.switching ? PRICING_COPY.subtitleSwitch : PRICING_COPY.subtitle}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {p.cards.map((card) => <PlanCard key={card.planKey} card={card} onChoose={p.onChoose} />)}
          </div>
        </div>
      </StageDialog>
      {/* Quem já paga confirma a troca antes, numa segunda janela por cima (pilha do palco). */}
      <StageDialog
        open={p.open && p.pending !== null}
        title={PRICING_COPY.switchTitle}
        onClose={p.onCancelSwitch}
        size="sm"
        footer={(
          <>
            <Button tone="ghost" onClick={p.onCancelSwitch}>{PRICING_COPY.back}</Button>
            <Button tone="primary" onClick={p.onConfirmSwitch}>{PRICING_COPY.confirmSwitch}</Button>
          </>
        )}
      >
        {p.pending ? <p className="leading-relaxed text-ps-bone">{PRICING_COPY.switchBody(p.pending.name, p.pending.price, p.pending.period, p.currentName)}</p> : null}
      </StageDialog>
    </div>
  )
}
