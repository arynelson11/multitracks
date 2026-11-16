import { useEffect, useState } from 'react'
import { isPaidPlan, planDisplayName } from '../lib/plans'
import { formatDateBR } from '../lib/separationUsage'
import {
  accessDateLabel, cancelMySubscription, cancelOutcomeLine, fetchCancelPreview, fetchMySubscription,
  type CancelOutcome, type CancelPreview, type MySubscription,
} from '../lib/subscription'

// Bloco da aba Assinatura pra quem tem plano pago: próxima renovação, botão
// "Cancelar assinatura" com confirmação que mostra o desfecho certo pra esta
// pessoa (prévia do servidor) e o resultado. Cortesia não é assinatura: não
// tem botão de cancelar nem aparece como "cancelada".

type Props = {
  plan: string
  planExpiresAt: string | null
  onChanged: () => void
  onOpenPricing: () => void
}

export function SubscriptionPanel({ plan, planExpiresAt, onChanged, onOpenPricing }: Props) {
  // undefined = carregando (não mostra nada até saber o que é)
  const [sub, setSub] = useState<MySubscription | null | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<CancelPreview | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CancelOutcome | null>(null)

  useEffect(() => {
    let alive = true
    fetchMySubscription().then((s) => { if (alive) setSub(s) })
    return () => { alive = false }
  }, [plan, planExpiresAt])

  if (!isPaidPlan(plan) && !outcome) return null
  if (sub === undefined && !outcome) return null
  const planName = planDisplayName(outcome?.plan ?? plan)

  if (outcome) return <Result outcome={outcome} planName={planName} />

  // Cortesia ativa: plano dado pela equipe, sem cobrança.
  if (sub?.kind === 'courtesy' && sub.status === 'active') {
    return (
      <div className="w-full bg-white/5 rounded-lg p-4 mb-4 border border-white/10 text-left">
        <p className="text-white text-xs leading-relaxed">
          Plano de cortesia, sem cobrança. {sub.access_until ? `Vale até ${accessDateLabel(sub.access_until)}.` : 'Sem data para acabar.'}
        </p>
      </div>
    )
  }

  // Cortada por falta de pagamento e paga depois com atraso: vale até o fim
  // daquele período, sem renovação.
  if (planExpiresAt && sub?.kind === 'asaas' && sub.status === 'canceled' && sub.cancel_source === 'unpaid') {
    return (
      <div className="w-full bg-white/5 rounded-lg p-4 mb-4 border border-white/10 text-left">
        <p className="text-white text-xs leading-relaxed">
          A renovação não foi paga no vencimento, então a assinatura foi encerrada e não renova mais. O pagamento atrasado foi recebido: você continua com o {planName} até {accessDateLabel(planExpiresAt)}. Para continuar depois disso, assine de novo.
        </p>
        <button
          onClick={onOpenPricing}
          className="mt-3 px-4 py-2 rounded-lg bg-laranja text-bone text-xs font-bold uppercase tracking-wider cursor-pointer"
        >
          Assinar de novo
        </button>
      </div>
    )
  }

  // Já cancelada, ainda dentro do período pago.
  if (planExpiresAt && sub?.kind !== 'courtesy') {
    return (
      <div className="w-full bg-white/5 rounded-lg p-4 mb-4 border border-white/10 text-left">
        <p className="text-white text-xs leading-relaxed">
          Assinatura cancelada. Você continua com o {planName} até {accessDateLabel(planExpiresAt)}. Depois disso a conta volta para o Livre. Nada mais é cobrado e seus arquivos não são apagados.
        </p>
        <button
          onClick={onOpenPricing}
          className="mt-3 px-4 py-2 rounded-lg bg-laranja text-bone text-xs font-bold uppercase tracking-wider cursor-pointer"
        >
          Assinar de novo
        </button>
      </div>
    )
  }

  const openConfirm = () => {
    setConfirming(true)
    setError(null)
    setPreview(undefined)
    fetchCancelPreview().then(setPreview)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const res = await cancelMySubscription()
    setBusy(false)
    if (res.ok) {
      setOutcome(res.data)
      setConfirming(false)
      onChanged()
    } else {
      setError(res.error)
    }
  }

  const paidUntilLabel = sub?.status === 'active' && sub.paid_until ? ` (${accessDateLabel(sub.paid_until)})` : ''

  return (
    <div className="w-full mb-4 text-left">
      {sub?.status === 'active' && sub.kind === 'asaas' && sub.next_due_date && (
        <p className="text-text-muted text-[10px] font-mono mb-2">
          Próxima renovação: {formatDateBR(`${sub.next_due_date}T12:00:00Z`)}
        </p>
      )}

      {!confirming ? (
        <button
          onClick={openConfirm}
          className="text-text-muted hover:text-white text-[11px] underline underline-offset-2 cursor-pointer"
        >
          Cancelar assinatura
        </button>
      ) : (
        <div role="dialog" aria-label="Cancelar a assinatura?" className="bg-[#141416] rounded-lg p-4 border border-white/15">
          <h4 className="text-white text-sm font-bold mb-2">Cancelar a assinatura?</h4>
          <ul className="text-zinc-300 text-xs leading-relaxed space-y-1.5 mb-3 list-disc pl-4">
            <li>A renovação automática para e nada mais é cobrado no cartão.</li>
            {preview === undefined ? (
              <li>Conferindo o que acontece com a sua assinatura...</li>
            ) : preview && preview.outcome !== 'none' ? (
              <li>{cancelOutcomeLine(preview, planName)}</li>
            ) : (
              <>
                <li>Você continua com o {planName} até o fim do período que já pagou{paidUntilLabel}. Depois disso a conta volta para o Livre (5 separações por mês, em 2 faixas).</li>
                <li>Se esta é sua primeira assinatura e faz até 7 dias da compra, devolvemos o valor integral no cartão e a conta volta para o Livre na hora. Nas assinaturas seguintes, o pedido de estorno vai para a nossa equipe.</li>
              </>
            )}
            <li>Seus arquivos não são apagados. As separações guardadas na nuvem continuam lá e voltam a aparecer se você assinar de novo. No Livre, o app usa a biblioteca deste aparelho.</li>
          </ul>
          {error && (
            <p role="alert" className="text-amber-300 text-xs leading-relaxed mb-3">{error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setConfirming(false); setError(null) }}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-laranja text-bone text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              Manter assinatura
            </button>
            <button
              onClick={() => { void confirm() }}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-white/25 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Cancelando...' : 'Sim, cancelar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Result({ outcome, planName }: { outcome: CancelOutcome; planName: string }) {
  const until = outcome.accessUntil ? accessDateLabel(outcome.accessUntil) : 'o fim do período pago'
  let text: string
  if (outcome.refunded) {
    text = 'Assinatura cancelada e valor devolvido. O estorno aparece na fatura do cartão em até 10 dias úteis. Sua conta já está no Livre e seus arquivos não foram apagados.'
  } else if (outcome.refundFailed) {
    text = 'Assinatura cancelada e a renovação não vai acontecer. O estorno não saiu automaticamente: a nossa equipe vai fazer e te avisa pelo e-mail da conta. Sua conta já está no Livre.'
  } else if (outcome.refundRequested) {
    text = `Assinatura cancelada. Você continua com o ${planName} até ${until}. Seu pedido de estorno foi para a nossa equipe, que te responde pelo e-mail da conta.`
  } else {
    text = `Assinatura cancelada. Você continua com o ${planName} até ${until}. Nada mais será cobrado.`
  }
  return (
    <div className="w-full bg-white/5 rounded-lg p-4 mb-4 border border-white/10 text-left" role="status">
      <p className="text-white text-xs leading-relaxed">{text}</p>
      {outcome.pendingStop && (
        <p className="text-zinc-400 text-[11px] leading-relaxed mt-2">
          A confirmação com o sistema de pagamento ficou pendente e é tentada de novo sozinha. Se aparecer alguma cobrança nova, fale com a gente pelo WhatsApp.
        </p>
      )}
    </div>
  )
}
