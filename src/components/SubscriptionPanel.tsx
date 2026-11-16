import { useEffect, useState } from 'react'
import { isPaidPlan, planDisplayName } from '../lib/plans'
import { formatDateBR } from '../lib/separationUsage'
import {
  accessDateLabel, cancelMySubscription, cancelOutcomeLine, fetchCancelPreview, fetchMySubscriptions,
  type CancelOutcome, type CancelPreview, type MySubscription,
} from '../lib/subscription'

// Bloco da aba Assinatura: decide pelas LINHAS da assinatura (status e
// access_until), nunca pelo plan_expires_at do perfil (COB-N6/Q9). Assinatura
// paga ativa aparece sempre, com o botão de cancelar e a confirmação com o
// desfecho certo (prévia do servidor); cancelada ainda no período mostra até
// quando vale; cortesia aparece como uma linha à parte, sem botão.

type Props = {
  plan: string
  onChanged: () => void
  onOpenPricing: () => void
}

export function SubscriptionPanel({ plan, onChanged, onOpenPricing }: Props) {
  // undefined = carregando (não mostra nada até saber o que é)
  const [subs, setSubs] = useState<{ rows: MySubscription[]; at: number } | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<CancelPreview | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CancelOutcome | null>(null)

  useEffect(() => {
    let alive = true
    fetchMySubscriptions().then((s) => { if (alive) setSubs({ rows: s ?? [], at: Date.now() }) })
    return () => { alive = false }
  }, [plan])

  if (outcome) return <Result outcome={outcome} planName={planDisplayName(outcome.plan)} />
  if (subs === undefined) return null

  // Decide pelas linhas da assinatura (status e access_until), nunca pelo perfil.
  const now = subs.at
  const rows = subs.rows
  const paidActive = rows.find((r) => r.kind === 'asaas' && r.status === 'active')
  const paidGrace = paidActive ? undefined : rows
    .filter((r) => r.kind === 'asaas' && r.status === 'canceled' && r.access_until && Date.parse(r.access_until) > now)
    .sort((a, b) => (a.access_until! < b.access_until! ? 1 : -1))[0]
  const courtesy = rows.find((r) => r.kind === 'courtesy' && r.status === 'active' && (!r.access_until || Date.parse(r.access_until) > now))
  // Assinou antes desta versão (sem linha paga): o servidor acha a assinatura ao
  // cancelar. Uma cortesia na lista não esconde o botão (COB-R6).
  const legacyPaid = !rows.some((r) => r.kind === 'asaas') && isPaidPlan(plan)
  if (!paidActive && !paidGrace && !courtesy && !legacyPaid) return null

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

  const activeName = planDisplayName(paidActive?.plan_key ?? plan)
  const paidUntilLabel = paidActive?.paid_until ? ` (${accessDateLabel(paidActive.paid_until)})` : ''

  return (
    <div className="w-full mb-4 text-left flex flex-col gap-3">
      {courtesy && (
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <p className="text-white text-xs leading-relaxed">
            Plano de cortesia ({planDisplayName(courtesy.plan_key)}), sem cobrança. {courtesy.access_until ? `Vale até ${accessDateLabel(courtesy.access_until)}.` : 'Sem data para acabar.'}
          </p>
        </div>
      )}

      {paidGrace && (
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          {paidGrace.cancel_source === 'unpaid' ? (
            <p className="text-white text-xs leading-relaxed">
              A renovação não foi paga no vencimento, então a assinatura foi encerrada e não renova mais. O pagamento atrasado foi recebido: você continua com o {planDisplayName(paidGrace.plan_key)} até {accessDateLabel(paidGrace.access_until!)}. Para continuar depois disso, assine de novo.
            </p>
          ) : (
            <p className="text-white text-xs leading-relaxed">
              Assinatura cancelada. Você continua com o {planDisplayName(paidGrace.plan_key)} até {accessDateLabel(paidGrace.access_until!)}. Depois disso a conta volta para o Livre. Nada mais é cobrado e seus arquivos não são apagados.
            </p>
          )}
          <button
            onClick={onOpenPricing}
            className="mt-3 px-4 py-2 rounded-lg bg-laranja text-bone text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Assinar de novo
          </button>
        </div>
      )}

      {(paidActive || legacyPaid) && (
        <div>
          {paidActive?.next_due_date && (
            <p className="text-text-muted text-[10px] font-mono mb-2">
              {activeName}. Próxima renovação: {formatDateBR(`${paidActive.next_due_date}T12:00:00Z`)}
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
                  <li>{cancelOutcomeLine(preview, activeName)}</li>
                ) : (
                  <>
                    <li>Você continua com o {activeName} até o fim do período que já pagou{paidUntilLabel}. Depois disso a conta volta para o Livre (5 separações por mês, em 2 faixas).</li>
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
