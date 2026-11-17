// Visão geral (`?action=overview`), cópia do front do contrato da seção Arquitetura B do plano.
// O backend não importa de src/, então os dois lados mantêm o mesmo formato.

export type PlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'

export type PlanCounts = Partial<Record<PlanKey, number>>

export type CancelSource = 'user' | 'user_refund' | 'unpaid' | 'refund' | 'asaas' | 'admin' | 'account_deleted'

export type Overview = {
  // label vem do servidor ("novembro de 2026")
  month: { start: string; end: string; label: string }
  // refundedBrl e refunds: estornos confirmados no mês, já fora do recebido; disputed: cobranças do mês em
  // estorno pedido, estorno em andamento ou contestação, fora do recebido e do estornado
  revenue: { grossBrl: number; netBrl: number; payments: number; refundedBrl: number; refunds: number; disputed: number }
  // servidor: assinaturas pagas ativas que renovam vezes o preço da tabela, anual dividido por 12
  mrrBrl: number
  subscribers: {
    activeByPlan: PlanCounts
    endingByPlan: PlanCounts
    courtesyByPlan: PlanCounts
    overdueAccounts: number
    blockedWithActiveSub: number
    // plano pago sem linha de assinatura (antes da cobrança nova)
    legacyPaid: number
  }
  cancellations: { total: number; bySource: Partial<Record<CancelSource, number>> }
  // withoutCost: todos os trabalhos sem custo do mês, fora da soma (as notas do custo e da margem);
  // withoutCostPending: os que a varredura de Custos de IA ainda completa (o servidor põe em alerts)
  aiCost: {
    jobs: number
    succeeded: number
    failed: number
    costBrl: number
    costUsd: number
    withoutCost: number
    withoutCostPending: number
  }
  // servidor: receita líquida menos o custo de IA
  marginBrl: number
  // ageDays: servidor, em dias de Brasília
  fx: { date: string | null; rate: number | null; ageDays: number | null }
  // servidor; withoutCostPending: só os sem custo que a varredura de Custos de IA ainda completa
  // (Ruling ADM-sem-custo-visao): o já tentado sem preço conhecido não pede ação
  alerts: { manual: number; auto: number; blockedWithActiveSub: number; withoutCostPending: number; fxOld: boolean }
}

/** Plano (ou motivo) e quantos. */
export type CountEntry = { key: string; count: number }

const PLAN_ORDER: readonly string[] = ['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Valor em dinheiro ou taxa; fora disso a tela mostra `sem dado`, nunca 0. */
export function amountOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Quantidade inteira de 0 pra cima; fora disso a tela mostra `sem dado`, nunca 0. */
export function countOf(v: unknown): number | null {
  return Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null
}

/**
 * Quantidades por plano (ou por motivo), na ordem da tabela de planos e as chaves desconhecidas
 * depois, pra não esconder um plano estranho. Chave que falta no objeto é zero pelo contrato
 * (Partial); objeto que falta ou qualquer quantidade inválida devolve null (`sem dado`), porque a
 * soma deixaria de ser confiável.
 */
export function countEntries(v: unknown): CountEntry[] | null {
  if (!isObj(v)) return null
  const entries: CountEntry[] = []
  for (const [key, raw] of Object.entries(v)) {
    const count = countOf(raw)
    if (count === null) return null
    entries.push({ key, count })
  }
  const rank = (key: string) => {
    const i = PLAN_ORDER.indexOf(key)
    return i === -1 ? PLAN_ORDER.length : i
  }
  return entries.sort((a, b) => rank(a.key) - rank(b.key))
}

/**
 * A resposta tem a forma que a tela usa (Ruling ADM-T7-forma): as seções são objetos, o mês tem o
 * nome e os alertas vêm completos. Os alertas são conferidos campo a campo porque a tela diz "Nada
 * pedindo atenção agora." com eles zerados: alerta que falta nunca vira zero. O total sem custo
 * (aiCost.withoutCost) também: sem ele a margem perderia o "Não inclui". E as cobranças em estorno ou
 * contestação (revenue.disputed): a linha só aparece com alguma, e sem o número o dinheiro que saiu
 * do recebido sumiria sem explicação. Os outros números são lidos um a um na tela, e o que faltar
 * aparece como `sem dado`.
 */
export function isOverview(v: unknown): v is Overview {
  if (!isObj(v)) return false
  const { month, revenue, subscribers, cancellations, aiCost, fx, alerts } = v
  if (!isObj(month) || typeof month.label !== 'string') return false
  if (![revenue, subscribers, cancellations, aiCost, fx].every(isObj)) return false
  if (!isObj(alerts) || typeof alerts.fxOld !== 'boolean') return false
  const totalWithoutCost = isObj(aiCost) ? aiCost.withoutCost : null
  const disputed = isObj(revenue) ? revenue.disputed : null
  return [alerts.manual, alerts.auto, alerts.blockedWithActiveSub, alerts.withoutCostPending, totalWithoutCost, disputed].every(
    (n) => countOf(n) !== null,
  )
}
