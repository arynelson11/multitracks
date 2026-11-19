// Tela de limite do Livre: diz o que acabou, o que o Pro faz e, com a janela da oferta aberta,
// o primeiro mês com desconto e o relógio das 48 horas. Só mostra; quem abre (LimitGate, T16)
// busca a oferta, abre o pagamento e garante a regra do Livre: nunca com a música tocando ou
// na pré-contagem (fila do livreRules). Erro aparece dentro da tela, nunca em window.alert.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { StageDialog } from '../stage/StageDialog'
import type { LimitKind } from '../../lib/livreRules'
import { formatReais } from '../../lib/prices'
import { LIMIT_COPY, OFFER_COPY, formatCountdown, offerRemainingMs } from './limitCopy'
import type { OfferView } from './limitCopy'

type OfferPlanKey = 'essencial_mensal' | 'pro_mensal'

export interface LimitScreenProps {
  kind: LimitKind
  offer: OfferView
  /** O plano cujo pagamento está abrindo: os dois botões da oferta ficam desligados. */
  busyPlan: OfferPlanKey | null
  /** Frase pronta pra pessoa (pagamento que não abriu, oferta que terminou). */
  error: string | null
  /** Relógio do aparelho (padrão `Date.now`); os testes passam o deles. */
  now?: () => number
  onChoose(planKey: OfferPlanKey): void
  onSeePlans(): void
  onClose(): void
}

export function LimitScreen({ kind, offer, busyPlan, error, now = Date.now, onChoose, onSeePlans, onClose }: LimitScreenProps) {
  const copy = LIMIT_COPY[kind]
  const nowRef = useRef(now)
  useLayoutEffect(() => { nowRef.current = now })

  // O relógio da tela. Quando chega outra oferta (a do servidor depois do carregando), ele
  // acerta na hora, na renderização (sem setState em efeito, Ruling R8): a resposta que
  // demorou não deixa o relógio mostrar mais do que falta.
  const expiresAt = offer.status === 'active' ? offer.expiresAt : null
  const [clock, setClock] = useState(() => now())
  const [clockFor, setClockFor] = useState(expiresAt)
  if (clockFor !== expiresAt) {
    setClockFor(expiresAt)
    setClock(now())
  }

  const remaining = expiresAt === null ? 0 : offerRemainingMs(expiresAt, clock)
  // Oferta vencida (ou com data estragada) é o caso sem oferta.
  const live = offer.status === 'active' && remaining > 0 ? offer : null
  const ticking = live !== null

  // Anda a cada 1 s só com a oferta no ar; ao zerar, a oferta some e o relógio para.
  useEffect(() => {
    if (!ticking) return
    const id = window.setInterval(() => setClock(nowRef.current()), 1000)
    return () => window.clearInterval(id)
  }, [ticking])

  const busy = busyPlan !== null

  const footer = (
    <>
      <Button tone="ghost" onClick={onClose}>{OFFER_COPY.later}</Button>
      {live
        ? <Button onClick={onSeePlans}>{OFFER_COPY.seePlans}</Button>
        : <Button tone="primary" onClick={onSeePlans}>{OFFER_COPY.plans}</Button>}
    </>
  )

  return (
    <StageDialog open title={copy.title} onClose={onClose} size="sm" footer={footer}>
      <div className="flex flex-col gap-4" aria-busy={offer.status === 'loading' || undefined}>
        <p className="text-ps-mut">{copy.body}</p>
        {live && (
          <section aria-label={OFFER_COPY.heading} className="flex flex-col gap-3 rounded-ps-lg bg-ps-s1 p-4 inset-ring inset-ring-ps-line">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-bold">{OFFER_COPY.heading}</p>
              {/* Número neutro: o relógio informa, não é alerta. */}
              <p role="timer" className="ps-num text-ps-sm text-ps-bone">{OFFER_COPY.clock(formatCountdown(remaining))}</p>
            </div>
            {/* Um embaixo do outro, na largura do quadro: cabe em 360 px sem cortar o preço. */}
            <div className="flex flex-col gap-2">
              <Button
                tone="primary"
                disabled={busy}
                aria-busy={busyPlan === 'essencial_mensal' || undefined}
                onClick={() => onChoose('essencial_mensal')}
              >
                {OFFER_COPY.pro(formatReais(live.prices.essencial_mensal))}
              </Button>
              <Button
                disabled={busy}
                aria-busy={busyPlan === 'pro_mensal' || undefined}
                onClick={() => onChoose('pro_mensal')}
              >
                {OFFER_COPY.studio(formatReais(live.prices.pro_mensal))}
              </Button>
            </div>
            <p className="text-ps-sm text-ps-mut">{OFFER_COPY.after}</p>
          </section>
        )}
        {error && <p role="alert" className="text-ps-alert">{error}</p>}
      </div>
    </StageDialog>
  )
}
