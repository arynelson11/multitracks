// A tela de limite do Livre ligada ao servidor (Parte 3, D8): ao aparecer abre a janela da oferta
// do primeiro mês com o limite que bateu, grava o anúncio visto e, ao escolher um plano, abre o
// pagamento com o desconto. Quem decide QUANDO ela aparece é o useLivre (nunca com a música
// tocando ou na pré-contagem); aqui só se monta quando já pode.
//
// Regra de cobrança: `offer: true` só sai quando a tela mostrou o desconto. Os botões de assinar
// só existem com a oferta no ar (LimitScreen); sem a oferta (sem internet, já assinou, janela
// vencida), a tela leva pros Planos, com o preço cheio. Se o servidor diz que a oferta terminou,
// o desconto some de vez, a frase dele aparece e a pessoa decide; nada abre sozinho. Os dois
// botões dos Planos ("Ver os planos" e "Ver todos os planos") gravam o anúncio clicado.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { StageDialog } from '../stage/StageDialog'
import { LimitScreen } from './LimitScreen'
import type { OfferView } from './limitCopy'
import { offerTriggerFor } from '../../lib/livreRules'
import type { LimitScreenKind } from '../../lib/livreRules'
import { fetchOffer, toOfferView } from '../../lib/offer'
import type { OfferResponse } from '../../lib/offer'
import { startCheckout } from '../../lib/checkout'
import { trackAd } from '../../lib/productEvents'

type OfferPlanKey = 'essencial_mensal' | 'pro_mensal'

export interface LimitGateProps {
  kind: LimitScreenKind
  onClose(): void
  onSeePlans(): void
}

// No computador o pagamento abre no navegador do sistema: a tela diz isso em vez de sumir.
const OPENED = {
  title: 'Pagamento aberto no navegador',
  body: 'Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes.',
  ok: 'Entendi',
} as const

export function LimitGate({ kind, onClose, onSeePlans }: LimitGateProps) {
  // A janela abre com o limite que fez a tela aparecer (o primeiro, se outro vier por cima). O
  // celular a mais abre como o Ao Vivo (o servidor só aceita os 5 limites).
  const [trigger] = useState(() => offerTriggerFor(kind))
  const [offer, setOffer] = useState<OfferView>({ status: 'loading' })
  const [busyPlan, setBusyPlan] = useState<OfferPlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openedOutside, setOpenedOutside] = useState(false)
  const opening = useRef<Promise<OfferResponse | null> | null>(null)
  const busy = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Uma vez por tela: o StrictMode do desenvolvimento roda o efeito duas vezes, e a segunda
  // aproveita o mesmo pedido (nem segunda janela, nem segundo anúncio visto).
  useEffect(() => {
    let current = true
    if (!opening.current) {
      opening.current = fetchOffer({ open: true, trigger })
      trackAd('ad_shown', 'limit')
    }
    void opening.current.then((r) => {
      if (current) setOffer(toOfferView(r, Date.now()))
    })
    return () => { current = false }
  }, [trigger])

  const choose = async (planKey: OfferPlanKey) => {
    // Os botões só aparecem com o desconto na tela; um clique repetido não abre outro pagamento.
    if (busy.current || offer.status !== 'active') return
    busy.current = true
    setBusyPlan(planKey)
    setError(null)
    trackAd('ad_clicked', 'limit')
    const out = await startCheckout({ planKey, offer: true })
    busy.current = false
    if (!mounted.current) return
    setBusyPlan(null)
    if (out.kind === 'opened') {
      if (out.external) setOpenedOutside(true)
      return
    }
    setError(out.message)
    // A oferta terminou no meio: o desconto sai de vez e a frase fica, sem ler a oferta de novo.
    // Quem decide a cobrança é o checkout; uma leitura que ainda dissesse `active` (relógios
    // diferentes, corrida entre as duas leituras) mostraria o desconto recusado em laço.
    if (out.offerEnded) setOffer({ status: 'none' })
  }

  const seePlans = () => {
    trackAd('ad_clicked', 'limit')
    onSeePlans()
  }

  if (openedOutside) {
    return (
      <StageDialog
        open
        title={OPENED.title}
        onClose={onClose}
        size="sm"
        footer={<Button tone="primary" onClick={onClose}>{OPENED.ok}</Button>}
      >
        <p className="text-ps-mut">{OPENED.body}</p>
      </StageDialog>
    )
  }

  return (
    <LimitScreen
      kind={kind}
      offer={offer}
      busyPlan={busyPlan}
      error={error}
      onChoose={(planKey) => { void choose(planKey) }}
      onSeePlans={seePlans}
      onClose={onClose}
    />
  )
}
