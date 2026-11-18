import { useEffect, useState } from 'react'
import { maxSeparationsPerMonth } from '../lib/plans'
import { fetchQuotaBonus, fetchSeparationUsage, formatDateBR, monthlyLimit, type SeparationUsage } from '../lib/separationUsage'

// Medidor "Separações de Faixas com IA" da aba Assinatura. Lê o contador do
// banco (mesmo número que o servidor usa pra liberar ou barrar a separação)
// e o extra do mês dado pelo admin, que o servidor soma no limite.

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; usage: SeparationUsage; bonus: number }

export function SeparationUsageMeter({ plan, isAdmin = false }: { plan: string; isAdmin?: boolean }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    // As duas leituras juntas: o extra não atrasa o contador. Sem o extra, vale o limite do plano.
    Promise.all([fetchSeparationUsage(), fetchQuotaBonus().catch(() => 0)]).then(([usage, bonus]) => {
      if (!alive) return
      setState(usage ? { status: 'ok', usage, bonus } : { status: 'error' })
    })
    return () => { alive = false }
  }, [plan])

  const bonus = state.status === 'ok' ? state.bonus : 0
  const planLimit = maxSeparationsPerMonth(plan)
  const maxLimit = monthlyLimit(plan, bonus)

  return (
    <div className="w-full bg-white/5 rounded-lg p-4 mb-6 border border-white/10 text-left">
      <div className="flex justify-between items-center mb-2">
        <span className="text-white text-xs font-bold uppercase tracking-wider">Separações de Faixas com IA</span>
        {state.status === 'ok' && !isAdmin && (
          <span className="text-text-muted text-[10px] font-mono">{state.usage.used} / {maxLimit} usadas</span>
        )}
      </div>
      {isAdmin ? (
        <p className="text-white/40 text-[10px] font-mono">Conta admin: sem limite de separações.</p>
      ) : state.status === 'loading' ? (
        <p className="text-white/40 text-[10px] font-mono">Carregando o contador...</p>
      ) : state.status === 'error' ? (
        <p className="text-white/40 text-[10px] font-mono">Não deu para carregar o contador agora. Tente abrir de novo daqui a pouco.</p>
      ) : (
        <>
          <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${state.usage.used / maxLimit > 0.9 ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, Math.round((state.usage.used / maxLimit) * 100))}%` }}
            />
          </div>
          <p className="text-white/30 text-[9px] font-mono mt-2">
            {maxLimit > planLimit
              ? `${planLimit} separações por mês + ${maxLimit - planLimit} ${maxLimit - planLimit === 1 ? 'extra' : 'extras'} neste mês. O contador volta a zero em ${formatDateBR(state.usage.resetsAt)}.`
              : `${planLimit} separações por mês. O contador volta a zero em ${formatDateBR(state.usage.resetsAt)}.`}
          </p>
        </>
      )}
    </div>
  )
}
