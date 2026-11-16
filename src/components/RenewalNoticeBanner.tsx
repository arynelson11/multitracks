import { useEffect, useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { isPaidPlan } from '../lib/plans'
import { brtTodayKey, fetchMySubscription, renewalNotice } from '../lib/subscription'

// Aviso de vencimento do plano MENSAL: aparece de 3 dias antes até o dia da
// renovação. Se a renovação não for paga, a conta volta pro Livre no mesmo
// dia (regra do dono), então vale avisar antes. "Entendi" esconde até o dia
// seguinte (guardado só neste aparelho).

const DISMISS_KEY = 'renewal_notice_dismissed_on'


function label(daysLeft: number, dueDate: string): string {
  const ddmm = `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}`
  if (daysLeft === 0) return `Sua assinatura vence hoje (${ddmm}).`
  return `Sua assinatura vence em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} (${ddmm}).`
}

export function RenewalNoticeBanner({ userId, plan }: { userId: string | null | undefined; plan: string }) {
  const [notice, setNotice] = useState<{ daysLeft: number; dueDate: string } | null>(null)
  const eligible = !!userId && isPaidPlan(plan)

  useEffect(() => {
    if (!eligible) return
    let dismissedToday = false
    try { dismissedToday = localStorage.getItem(DISMISS_KEY) === brtTodayKey() } catch { /* sem storage: mostra */ }
    if (dismissedToday) return
    let alive = true
    fetchMySubscription().then((sub) => { if (alive) setNotice(renewalNotice(sub)) })
    return () => { alive = false }
  }, [eligible, userId])

  if (!eligible || !notice) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, brtTodayKey()) } catch { /* ignora */ }
    setNotice(null)
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9991] w-[min(92vw,460px)] bg-[#1c1c1e] border border-amber-400/40 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] p-4 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-400/15 flex items-center justify-center">
        <CalendarClock className="w-5 h-5 text-amber-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-bold leading-tight">{label(notice.daysLeft, notice.dueDate)}</p>
        <p className="text-zinc-400 text-xs leading-snug mt-1">
          A renovação é cobrada no cartão cadastrado. Se não for paga até o vencimento, a conta volta para o Livre no mesmo dia (seus arquivos não são apagados).
        </p>
        <button onClick={dismiss} className="mt-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer">
          Entendi
        </button>
      </div>
      <button onClick={dismiss} aria-label="Fechar aviso de vencimento" className="shrink-0 p-1 text-zinc-500 hover:text-white cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
