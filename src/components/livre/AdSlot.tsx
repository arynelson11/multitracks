// Lugar do anúncio da casa (Parte 3, spec seção 6): monta o HouseAdCard na tela inicial e no fim
// da separação e decide se ele aparece, pelas regras de src/lib/livreRules.ts. A decisão sai uma
// vez, na primeira vez em que a música está parada com ele montado (o do fim da separação espera
// também a separação terminar): só no Livre, no máximo um anúncio grande por sessão e, na tela
// inicial, uma vez por dia de Brasília. Ao decidir mostrar, grava a sessão, o dia (tela inicial)
// e o anúncio visto, uma vez.
//
// O cartão só aparece com a música parada: a música que começa esconde ele e ele volta quando
// ela para (sem contar de novo). "Agora não" esconde de vez nesta tela. Nada aqui mexe no som.
//
// Sem setState em efeito (Ruling R8): a decisão assenta na renderização; o efeito só grava fora
// do React (store do Livre e o evento do funil).
import { useEffect, useRef, useState } from 'react'
import { HouseAdCard } from './HouseAdCard'
import { shouldShowHomeAd, shouldShowSeparationAd } from '../../lib/livreRules'
import { bigAdShownThisSession, markBigAdShown, readHomeAdDay, writeHomeAdDay } from '../../lib/livreStore'
import { brtDay } from '../../lib/separationUsage'
import { trackAd } from '../../lib/productEvents'

export interface AdSlotProps {
  placement: 'home' | 'separation-done'
  /** Conta logada. Sem conta não há onde contar: nada aparece. */
  userId: string | null
  isLivre: boolean
  /** Música parada de verdade: nem tocando nem na pré-contagem. */
  quiet: boolean
  /** Fim da separação: a separação acabou de terminar (até a pessoa abrir outra). */
  justSeparated?: boolean
  onCta(): void
}

type Decision =
  | { kind: 'waiting' }
  | { kind: 'skip' }
  | { kind: 'show'; day: string }
  | { kind: 'dismissed' }

const WAITING: Decision = { kind: 'waiting' }
const SKIP: Decision = { kind: 'skip' }
const deviceNow = () => new Date()

// Lê a sessão e o dia guardado na hora de decidir (duas telas do app nunca decidem com dado velho).
function decide(placement: AdSlotProps['placement'], userId: string | null, isLivre: boolean, quiet: boolean, justSeparated: boolean): Decision {
  if (userId === null) return SKIP
  const day = brtDay(deviceNow())
  const bigAdThisSession = bigAdShownThisSession()
  const show = placement === 'home'
    ? shouldShowHomeAd({ isLivre, quiet, lastHomeDay: readHomeAdDay(userId), today: day, bigAdThisSession })
    : shouldShowSeparationAd({ isLivre, quiet, justSeparated, bigAdThisSession })
  return show ? { kind: 'show', day } : SKIP
}

export function AdSlot({ placement, userId, isLivre, quiet, justSeparated = false, onCta }: AdSlotProps) {
  // O do fim da separação só vale logo depois de separar: montado antes, ainda não decide.
  const moment = quiet && (placement === 'home' || justSeparated)
  const [decision, setDecision] = useState<Decision>(WAITING)
  let current = decision
  if (decision.kind === 'waiting' && moment) {
    current = decide(placement, userId, isLivre, quiet, justSeparated)
    setDecision(current)
  }

  // Grava uma vez por cartão (o StrictMode do desenvolvimento roda o efeito duas vezes).
  const recorded = useRef(false)
  useEffect(() => {
    if (decision.kind !== 'show' || recorded.current) return
    recorded.current = true
    markBigAdShown()
    if (placement === 'home' && userId !== null) writeHomeAdDay(userId, decision.day)
    trackAd('ad_shown', placement)
  }, [decision, placement, userId])

  if (current.kind !== 'show' || !isLivre || !moment) return null
  return (
    <HouseAdCard
      placement={placement}
      onCta={() => { trackAd('ad_clicked', placement); onCta() }}
      onDismiss={() => setDecision({ kind: 'dismissed' })}
    />
  )
}
