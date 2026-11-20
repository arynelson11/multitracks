// A tela de limite do Livre ligada ao servidor (Parte 3, D8): ao aparecer abre a janela da oferta
// do primeiro mês com o limite que bateu, grava o anúncio visto e, ao escolher um plano, abre o
// pagamento com o desconto. Quem decide QUANDO ela aparece é o useLivre (nunca com a música
// tocando ou na pré-contagem); aqui só se monta quando já pode.
//
// Regra de cobrança: `offer: true` só sai quando a tela mostrou o desconto. Os botões de assinar
// só existem com a oferta no ar (LimitScreen); sem a oferta (sem internet, já assinou, janela
// vencida), a tela leva pros Planos, com o preço cheio. Se o servidor diz que a oferta terminou,
// o desconto some, a frase dele aparece e a pessoa decide; nada abre sozinho.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { StageDialog } from '../stage/StageDialog'
import { LimitScreen } from './LimitScreen'
import type { OfferView } from './limitCopy'
import type { LimitKind } from '../../lib/livreRules'
import { fetchOffer, toOfferView } from '../../lib/offer'
import type { OfferResponse } from '../../lib/offer'
import { startCheckout } from '../../lib/checkout'
import { trackAd } from '../../lib/productEvents'

type OfferPlanKey = 'essencial_mensal' | 'pro_mensal'

export interface LimitGateProps {
  kind: LimitKind
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
  // A janela abre com o limite que fez a tela aparecer (o primeiro, se outro vier por cima).
  const [trigger] = useState(kind)
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
    if (!out.offerEnded) return
    // A oferta terminou no meio: tira o desconto já e lê de novo, sem abrir janela. O servidor
    // lê do mesmo jeito nos dois pedidos, então a resposta é sem oferta; se mesmo assim disser
    // que a janela segue aberta, vale ela, e a frase de oferta terminada sai (nunca as duas juntas).
    setOffer({ status: 'loading' })
    const view = toOfferView(await fetchOffer({ open: false }), Date.now())
    if (!mounted.current) return
    setOffer(view)
    if (view.status === 'active') setError(null)
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
      onSeePlans={onSeePlans}
      onClose={onClose}
    />
  )
}
