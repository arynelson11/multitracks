import { useEffect, useState } from 'react'
import { isPaidPlan, planDisplayName } from '../lib/plans'
import { formatDateBR } from '../lib/separationUsage'
import { accessDateLabel, cancelMySubscription, fetchMySubscription, type CancelOutcome, type MySubscription } from '../lib/subscription'

// Bloco da aba Assinatura pra quem paga: próxima renovação, botão "Cancelar
// assinatura" com confirmação e o resultado. Regras (servidor):
// fica com o plano até o fim do período pago e depois volta pro Livre; no
// arrependimento em até 7 dias da primeira compra, estorna e volta na hora.

type Props = {
  plan: string
  planExpiresAt: string | null
  onChanged: () => void
  onOpenPricing: () => void
}

export function SubscriptionPanel({ plan, planExpiresAt, onChanged, onOpenPricing }: Props) {
  const [sub, setSub] = useState<MySubscription | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CancelOutcome | null>(null)

  useEffect(() => {
    let alive = true
    fetchMySubscription().then((s) => { if (alive) setSub(s) })
    return () => { alive = false }
  }, [plan, planExpiresAt])

  if (!isPaidPlan(plan) && !outcome) return null
  const planName = planDisplayName(outcome?.plan ?? plan)

  if (outcome) {
    return (
      <div className="w-full bg-white/5 rounded-lg p-4 mb-4 border border-white/10 text-left" role="status">
        {outcome.refunded ? (
          <p className="text-white text-xs leading-relaxed">
            Assinatura cancelada e valor devolvido. O estorno aparece na fatura do cartão em até 10 dias úteis. Sua conta já está no Livre e seus arquivos não foram apagados.
          </p>
        ) : (
          <p className="text-white text-xs leading-relaxed">
            Assinatura cancelada. Você continua com o {planName} até {outcome.accessUntil ? accessDateLabel(outcome.accessUntil) : 'o fim do período pago'}. Nada mais será cobrado.
          </p>
        )}
      </div>
    )
  }

  // Já cancelada, ainda dentro do período pago.
  if (planExpiresAt) {
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

  const paidUntilLabel = sub?.status === 'active' && sub.paid_until ? ` (${accessDateLabel(sub.paid_until)})` : ''

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

  return (
    <div className="w-full mb-4 text-left">
      {sub?.status === 'active' && sub.kind === 'asaas' && sub.next_due_date && (
        <p className="text-text-muted text-[10px] font-mono mb-2">
          Próxima renovação: {formatDateBR(`${sub.next_due_date}T12:00:00Z`)}
        </p>
      )}

      {!confirming ? (
        <button
          onClick={() => { setConfirming(true); setError(null) }}
          className="text-text-muted hover:text-white text-[11px] underline underline-offset-2 cursor-pointer"
        >
          Cancelar assinatura
        </button>
      ) : (
        <div role="dialog" aria-label="Cancelar a assinatura?" className="bg-[#141416] rounded-lg p-4 border border-white/15">
          <h4 className="text-white text-sm font-bold mb-2">Cancelar a assinatura?</h4>
          <ul className="text-zinc-300 text-xs leading-relaxed space-y-1.5 mb-3 list-disc pl-4">
            <li>A renovação automática para e nada mais é cobrado no cartão.</li>
            <li>Você continua com o {planName} até o fim do período que já pagou{paidUntilLabel}. Depois disso a conta volta para o Livre (5 separações por mês, em 2 faixas).</li>
            <li>Se você assinou há até 7 dias e esta é a primeira cobrança, devolvemos o valor integral no cartão e a conta volta para o Livre na hora.</li>
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
