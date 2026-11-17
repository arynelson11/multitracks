import {
  BillingError,
  addDays,
  brtToday,
  cancelSubscriptionForUser,
  changePlan,
  endCourtesy,
  grantCourtesy,
  type BillingDeps,
} from '../billing.js'
import { AsaasError, type AsaasApi } from '../asaas.js'
import { PLAN_PRICING, isPlanKey, type PlanKey } from '../pricing.js'
import { withAudit } from './audit.js'
import { AdminError, asaasFailure, int, oneOf, str, uuid, type AdminCtx, type AdminHandlers } from './http.js'

// Ações do admin sobre um assinante (Task 16): change-plan, grant-courtesy,
// end-courtesy, cancel-subscription, block, unblock e adjust-quota.
// * O alvo vem sempre do corpo (userId) e cada campo passa por um validador.
// * Plano no app e cobrança no Asaas nunca desencontrados sem aviso: quem mexe
//   nos dois usa as funções da Fase 3 (Asaas primeiro, banco depois) dentro do
//   withAudit (pendente antes, resultado depois). Erro que deixa dúvida se o
//   Asaas já agiu marca a ficha (billing_flag_review), aparece em Pendências,
//   e repetir a ação termina o que faltou. Nenhuma exceção sai daqui depois de
//   agir sem essa marcação (aviso T16/T28).
// * Cortesia mexe só no banco, mas pela Fase 3, que não grava registro: também
//   no withAudit. No assinante antigo ela pede legacyChargeStopped: true (Ruling
//   ADM-T26-cortesia-legado), porque não para a cobrança antiga no Asaas.
// * Bloquear, desbloquear e ajustar cota: a função SQL (T21) grava o registro
//   na mesma transação, então não usam withAudit.
// * Escrita no Asaas (PUT da troca, DELETE do cancelamento) sem resposta que dê
//   certeza é INCERTA, nunca "Nada mudou" (Ruling ADM-T16-incerto): marca a
//   ficha, fecha o registro partial e lança UncertainAdminError (uncertain: true).
// * Resposta e registro só levam frase pronta (com o status do Asaas quando se
//   sabe); o erro cru vai pro log.
// * Nenhum caminho estorna: o estorno é feito no painel do Asaas (FATOS).

const MSG_NO_PAID = 'Esta conta não tem assinatura paga ativa. Para dar um plano sem cobrança, use Dar cortesia.'
const MSG_PLAN_NOT_CHANGED = 'O Asaas não trocou o plano. Nada mudou.'
const MSG_PLAN_SUB_NOT_FOUND = 'O Asaas não achou esta assinatura. Nada mudou.'
const MSG_PLAN_HALF = 'O Asaas trocou o plano, mas o app não. A ficha ficou marcada em Pendências; use Mudar plano de novo para terminar.'
// Toda frase em que a marcação da ficha falhou diz isso: nada vai aparecer em
// Pendências, então quem confere é o admin, no painel do Asaas.
const NOT_FLAGGED = 'Não deu pra marcar a ficha, então nada vai aparecer em Pendências; confira no painel do Asaas'
const MSG_PLAN_HALF_UNMARKED = `O Asaas trocou o plano, mas o app não. ${NOT_FLAGGED} e use Mudar plano de novo para terminar.`
const MSG_PLAN_NOT_SENT = 'Erro no servidor antes de pedir a troca ao Asaas. Nada mudou.'
const MSG_LEGACY_PAID = 'Esta conta tem uma assinatura antiga, de antes da cobrança nova, que pode estar cobrando no Asaas. Mudar plano não vale pra ela, e uma cortesia não para essa cobrança. Confira no painel do Asaas.'
const MSG_NO_ASAAS_KEY = 'O servidor está sem a chave do Asaas.'
const MSG_CANCEL_DOWN = 'O Asaas não respondeu. Nada foi cancelado.'
const MSG_CANCEL_NONE = 'Esta conta não tem assinatura ativa.'
const MSG_CANCEL_SUB_NOT_FOUND = 'O Asaas não achou esta assinatura. Nada foi cancelado. A ficha ficou marcada em Pendências.'
const CANCEL_PARTIAL_PREFIX = 'Parte do cancelamento foi feita'
const MSG_FLAGGED = 'A ficha ficou marcada em Pendências.'
const MSG_COURTESY_NOT_OURS = 'Esta cortesia não é desta conta.'
// Ruling ADM-T26-cortesia-legado: no assinante antigo a cortesia muda o plano no app e não para a
// cobrança antiga no Asaas; o admin confirma que já parou (legacyChargeStopped: true).
const MSG_LEGACY_COURTESY = 'Esta conta tem uma cobrança antiga no Asaas que o app não controla. A cortesia muda o plano no app, mas não para essa cobrança. Pare a cobrança antiga no painel do Asaas e confirme que parou.'
const MSG_LEGACY_STOPPED_FORMAT = 'A confirmação da cobrança antiga está em formato inválido.'
const MSG_DAYS_MISSING = 'Escolha por quantos dias vale a cortesia, ou Sem data.'
const MSG_ADMIN_NOT_BLOCKABLE = 'Não dá pra bloquear uma conta admin.'
const MSG_ALREADY_BLOCKED = 'Esta conta já está bloqueada.'
const MSG_NOT_BLOCKED = 'Esta conta não está bloqueada.'
const MSG_ACCOUNT_NOT_FOUND = 'Conta não encontrada.'
const MSG_QUOTA_MAX = 'A cota extra deste mês já está no máximo (1000).'
const MSG_RESET_NO_AMOUNT = 'Zerar não leva quantidade.'
const MSG_QUOTA_UNCONFIRMED = 'Não deu pra confirmar o ajuste da cota. Ele pode ter sido feito; confira no Registro antes de repetir.'
const MSG_UNCERTAIN = 'O Asaas não respondeu a tempo. A mudança pode ter sido feita. A ficha foi marcada pra conferir; confira em Pendências antes de repetir.'
const MSG_UNCERTAIN_UNMARKED = `O Asaas não respondeu a tempo. A mudança pode ter sido feita. ${NOT_FLAGGED} antes de repetir.`

// Notas da marcação (texto do banco, sem acento como as da Fase 3).
const noteChangePlan = (planKey: PlanKey): string =>
  `troca de plano pelo admin: o Asaas pode ter trocado para ${planKey} e o banco nao; usar Mudar plano de novo`
const NOTE_CANCEL_HALF = 'cancelamento pelo admin pela metade: o Asaas pode ter parado a cobranca e o app nao; usar Cancelar assinatura de novo'

const COURTESY_PREFIX = 'cortesia:'

// ── Datas

// Cortesia de N dias: vale até o fim do dia hoje + N em Brasília (D9). O fim
// do dia é a meia-noite seguinte de Brasília (03:00 em UTC, sem horário de verão).
export function courtesyUntil(now: Date, days: number): string {
  return new Date(addDays(brtToday(now), days + 1) + 'T03:00:00Z').toISOString()
}

// dd/mm/aaaa do último dia com acesso (o fim guardado é o começo do dia seguinte).
function lastAccessDay(accessUntil: string): string {
  const d = brtToday(new Date(Date.parse(accessUntil) - 1000))
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

// ── Planos

// Mesmo nível de billing_plan_rank (SQL da Fase 3): Studio 2, Pro 1.
function planRank(plan: string): number {
  if (plan === 'pro_mensal' || plan === 'pro_anual') return 2
  if (plan === 'essencial_mensal' || plan === 'essencial_anual') return 1
  return 0
}

const planLabel = (plan: string): string => (isPlanKey(plan) ? PLAN_PRICING[plan].label : plan)

// ── Entrada

const accountOf = (body: Record<string, unknown>): string => uuid(body, 'userId', 'a conta')

function planKeyOf(body: Record<string, unknown>): PlanKey {
  const raw = str(body, 'planKey', { label: 'o plano', max: 40 })
  if (!isPlanKey(raw)) throw new AdminError(400, 'O plano está em formato inválido.')
  return raw
}

// days é obrigatório: número de 1 a 365, ou null (sem data). Sem o campo não
// vira cortesia sem data por engano.
function daysOf(body: Record<string, unknown>): number | null {
  if (!Object.hasOwn(body, 'days')) throw new AdminError(400, MSG_DAYS_MISSING)
  if (body.days === null) return null
  return int(body, 'days', { label: 'a duração da cortesia', min: 1, max: 365 })
}

// legacyChargeStopped: opcional; quando vem, só true ou false (Ruling ADM-T3-estrito). Nulo
// conta como ausente, como nos outros campos.
function legacyStoppedOf(body: Record<string, unknown>): boolean {
  const raw = body.legacyChargeStopped
  if (raw === undefined || raw === null) return false
  if (typeof raw !== 'boolean') throw new AdminError(400, MSG_LEGACY_STOPPED_FORMAT)
  return raw
}

// ── Banco

type SubRow = {
  id: string
  kind: string
  user_id: string | null
  plan_key: string
  cycle: string | null
  status: string
  started_at: string
  access_until: string | null
}
const SUB_COLS = 'id, kind, user_id, plan_key, cycle, status, started_at, access_until'

const dbError = (where: string, message: string): BillingError => new BillingError('db_error', `Falha no banco (${where}): ${message}`, 500)

async function rpc<T>(ctx: AdminCtx, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.db.rpc(name, args)
  if (error) throw dbError(name, error.message)
  return data as T
}

async function subscriptionsOf(ctx: AdminCtx, userId: string): Promise<SubRow[]> {
  const { data, error } = await ctx.db.from('billing_subscriptions').select(SUB_COLS).eq('user_id', userId)
  if (error) throw dbError('billing_subscriptions', error.message)
  return (data as SubRow[] | null) ?? []
}

// Assinante de antes da Fase 3 que ainda está num plano pago: o perfil tem
// plano pago valendo e há pagamento antigo (payments) cujo checkout ainda não
// virou linha de assinatura (a mesma regra de legacyCandidates da Fase 3, que
// só o cancelamento adota; a troca de plano não). Só lido quando a conta não
// tem paga ativa.
async function isLegacyPaying(ctx: AdminCtx, userId: string, rows: SubRow[]): Promise<boolean> {
  const prof = await ctx.db.from('profiles').select('plan, plan_expires_at').eq('id', userId).maybeSingle()
  if (prof.error) throw dbError('profiles', prof.error.message)
  const p = prof.data as { plan?: unknown; plan_expires_at?: unknown } | null
  const expires = typeof p?.plan_expires_at === 'string' ? p.plan_expires_at : null
  if (!p || !isPlanKey(p.plan) || (expires !== null && !inFuture(expires, ctx.now))) return false
  const pays = await ctx.db.from('payments').select('asaas_checkout_id, plan_key').eq('user_id', userId)
  if (pays.error) throw dbError('payments', pays.error.message)
  const known = new Set(rows.map((r) => r.id))
  return ((pays.data as { asaas_checkout_id?: unknown; plan_key?: unknown }[] | null) ?? [])
    .some((x) => typeof x.asaas_checkout_id === 'string' && x.asaas_checkout_id !== '' && isPlanKey(x.plan_key) && !known.has(x.asaas_checkout_id))
}

// Pagas ativas, da de início mais recente pra mais antiga (a mesma escolha da
// Fase 3 em changePlan e no cancelamento).
const paidActive = (rows: SubRow[]): SubRow[] =>
  rows.filter((r) => r.kind === 'asaas' && r.status === 'active').sort((a, b) => (a.started_at < b.started_at ? 1 : -1))

const inFuture = (instant: string | null, now: Date): boolean => instant !== null && Date.parse(instant) > now.getTime()

// O "antes" do registro: o que a conta tem de assinatura e cortesia valendo.
const summary = (r: SubRow) => ({ id: r.id, kind: r.kind, planKey: r.plan_key, status: r.status, accessUntil: r.access_until })
const liveSummary = (rows: SubRow[], now: Date) =>
  rows.filter((r) => r.status === 'active' || inFuture(r.access_until, now)).map(summary)

const describeError = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : 'erro sem mensagem')

// Marca a ficha pra Pendências. Nunca lança: devolve se conseguiu, pra a
// resposta e o registro dizerem a verdade.
async function flagReview(ctx: AdminCtx, ids: string[], note: string): Promise<boolean> {
  if (ids.length === 0) return false
  let ok = true
  for (const id of ids) {
    try {
      const { error } = await ctx.db.rpc('billing_flag_review', { p_id: id, p_note: note })
      if (error) {
        ok = false
        console.error(`[admin] marcacao de ${id} nao gravou:`, String(error.message).slice(0, 200))
      }
    } catch (e) {
      ok = false
      console.error(`[admin] marcacao de ${id} nao gravou:`, describeError(e))
    }
  }
  return ok
}

const deps = (ctx: AdminCtx, asaas: AsaasApi | null = ctx.asaas): BillingDeps => ({ db: ctx.db, asaas, now: () => ctx.now })

// ── Escrita incerta no Asaas (Ruling ADM-T16-incerto)

// Erro de resultado incerto: a escrita no Asaas pode ter sido aplicada. Leva
// uncertain: true pra tela segurar o Confirmar até o admin conferir.
export class UncertainAdminError extends AdminError {
  readonly uncertain = true
}

// Falhas de conexão que acontecem antes de o pedido sair (o axios devolve o
// código no "Asaas sem resposta (<código>)" de asaas.ts): certeza de nada feito.
const NOT_SENT_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'])
const NO_RESPONSE_RE = /^Asaas sem resposta \(([^)]*)\)$/

// A escrita que falhou com este erro pode ter chegado e sido aplicada?
// * Recusa (4xx), 404 e 429 (limite de pedidos): o Asaas respondeu que não fez.
// * 5xx: o pedido chegou e não se sabe se foi aplicado.
// * Sem resposta: só os códigos de conexão que não abriu são certeza; timeout,
//   ECONNRESET, resposta cortada e qualquer outro (ou erro que não é do
//   cliente do Asaas) contam como incertos.
export function writeMayHaveLanded(e: unknown): boolean {
  if (!(e instanceof AsaasError)) return true
  if (e.kind !== 'unavailable') return false
  if (e.status === 429) return false
  if (e.status !== undefined) return true
  const code = NO_RESPONSE_RE.exec(e.message)?.[1]
  return code === undefined || !NOT_SENT_CODES.has(code)
}

type AsaasCall = { write: boolean; failed: boolean; error: unknown }

// O Asaas da ação, anotando cada chamada (sem mudar nada nela), pra saber se a
// última antes do erro foi uma escrita e como ela falhou. A Fase 3 transforma
// toda falha do Asaas em asaas_unavailable, e só isto separa a leitura que
// falhou (nada feito) da escrita sem resposta (incerta).
function tracedAsaas(api: AsaasApi | null): { asaas: AsaasApi | null; calls: AsaasCall[] } {
  const calls: AsaasCall[] = []
  if (!api) return { asaas: null, calls }
  const track = async <T>(write: boolean, go: () => Promise<T>): Promise<T> => {
    const call: AsaasCall = { write, failed: false, error: null }
    calls.push(call)
    try {
      return await go()
    } catch (e) {
      call.failed = true
      call.error = e
      throw e
    }
  }
  const asaas: AsaasApi = {
    get<T = unknown>(path: string, params?: Record<string, string | number | boolean>) { return track(false, () => api.get<T>(path, params)) },
    post<T = unknown>(path: string, body?: unknown) { return track(true, () => api.post<T>(path, body)) },
    put<T = unknown>(path: string, body?: unknown) { return track(true, () => api.put<T>(path, body)) },
    del<T = unknown>(path: string) { return track(true, () => api.del<T>(path)) },
  }
  return { asaas, calls }
}

// O erro da Fase 3 veio de uma escrita no Asaas sem resposta que dê certeza:
// a última chamada foi uma escrita que falhou assim, e o erro é ela (como a
// Fase 3 traduz, asaas_unavailable, ou o próprio erro que não é do cliente).
function uncertainWrite(e: unknown, calls: AsaasCall[]): boolean {
  const last = calls[calls.length - 1]
  if (!last || !last.write || !last.failed || !writeMayHaveLanded(last.error)) return false
  return (e instanceof BillingError && e.code === 'asaas_unavailable') || e === last.error
}

const writeSent = (calls: AsaasCall[]): boolean => calls.some((c) => c.write)

const BRT_TIME = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function brtMoment(now: Date): string {
  const d = brtToday(now)
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} às ${BRT_TIME.format(now)}`
}

// Marca a ficha e devolve o erro pro withAudit fechar o registro partial, com
// a frase que diz se a marcação ficou. Quem chama traduz pra UncertainAdminError.
async function uncertainFailure(ctx: AdminCtx, ids: string[], request: string, e: unknown): Promise<BillingError> {
  console.error(`[admin] escrita no Asaas sem resposta (${request}):`, describeError(e))
  const note = `O Asaas não respondeu a tempo ao pedido de ${request} em ${brtMoment(ctx.now)}; conferir se foi feito`
  const flagged = await flagReview(ctx, ids, note)
  return new BillingError('partial', flagged ? MSG_UNCERTAIN : MSG_UNCERTAIN_UNMARKED, 502)
}

// Frase pronta com o status do Asaas, quando se sabe (Rulings ADM-T3-registro e
// ADM-T3-permitidas). O texto do Asaas nunca entra.
function withAsaasStatus(message: string, status: number | null): string {
  return status ? `${message} Status do Asaas: ${status}.` : message
}

// ── Mudar plano (D12)

// Erros em que a Fase 3 garante que o Asaas não trocou nada: falha ou recusa
// do Asaas, assinatura não achada no Asaas e servidor sem a chave. Todo o resto
// depois de ler a assinatura deixa dúvida (pré-voo I1).
const PLAN_UNTOUCHED: ReadonlySet<string> = new Set(['asaas_unavailable', 'asaas_rejected', 'not_found', 'misconfigured'])

function changePlanError(e: unknown): unknown {
  if (!(e instanceof BillingError)) return e
  if (e.code === 'asaas_unavailable' || e.code === 'asaas_rejected') {
    const status = asaasFailure(e)?.status ?? null
    if (status === 404) return new AdminError(502, MSG_PLAN_SUB_NOT_FOUND)
    return new AdminError(502, withAsaasStatus(MSG_PLAN_NOT_CHANGED, status))
  }
  if (e.code === 'not_found') return new AdminError(502, MSG_PLAN_SUB_NOT_FOUND)
  if (e.code === 'misconfigured') return new AdminError(500, MSG_NO_ASAAS_KEY)
  // Só o partial montado aqui chega com este código (frase pronta).
  if (e.code === 'partial') return new AdminError(500, e.message)
  return e
}

const priceOf = (plan: string) => (isPlanKey(plan) ? PLAN_PRICING[plan].value : null)

// ── Cancelar (D13)

function cancelError(e: unknown): unknown {
  if (!(e instanceof BillingError)) return e
  if (e.code === 'asaas_unavailable') return new AdminError(502, withAsaasStatus(MSG_CANCEL_DOWN, asaasFailure(e)?.status ?? null))
  // Na Fase 3, só a assinatura não achada no Asaas vira asaas_rejected, e ela
  // já marcou a ficha antes de recusar.
  if (e.code === 'asaas_rejected') return new AdminError(502, MSG_CANCEL_SUB_NOT_FOUND)
  if (e.code === 'not_found') return new AdminError(404, MSG_CANCEL_NONE)
  if (e.code === 'misconfigured') return new AdminError(500, MSG_NO_ASAAS_KEY)
  if (e.code === 'partial') return new AdminError(e.httpStatus, e.message)
  return e
}

// Assinatura antiga (de antes da Fase 3) é adotada no meio do cancelamento e
// não estava na leitura de antes: lê de novo pra ter o que marcar.
async function paidActiveIdsNow(ctx: AdminCtx, userId: string): Promise<string[]> {
  try {
    return paidActive(await subscriptionsOf(ctx, userId)).map((r) => r.id)
  } catch (e) {
    console.error('[admin] cancel-subscription: nao deu pra reler as assinaturas pra marcar:', describeError(e))
    return []
  }
}

function cancelPartialMessage(phase3: string, flagged: boolean): string {
  const base = phase3.startsWith(CANCEL_PARTIAL_PREFIX) ? phase3 : `${CANCEL_PARTIAL_PREFIX}: ${phase3}`
  return `${base} ${flagged ? MSG_FLAGGED : `${NOT_FLAGGED}.`}`
}

// ── Cortesia (D9)

// Recusas antes de gravar: cortesia igual já ativa (M7); e, com paga cancelada
// ainda no período, só cortesia de plano maior que vá além do fim dela (pré-voo
// I3): senão a cortesia vence a paga e a conta cai pro Livre antes da hora.
function courtesyRefusal(rows: SubRow[], planKey: PlanKey, until: string | null, now: Date): string | null {
  const same = rows.find((r) => r.kind === 'courtesy' && r.status === 'active' && r.plan_key === planKey
    && (r.access_until === null || inFuture(r.access_until, now)))
  if (same) return `Esta conta já tem uma cortesia de ${planLabel(planKey)} ativa.`
  const graced = rows
    .filter((r): r is SubRow & { access_until: string } => r.kind === 'asaas' && r.status === 'canceled' && inFuture(r.access_until, now))
    .sort((a, b) => Date.parse(b.access_until) - Date.parse(a.access_until))
  for (const paid of graced) {
    const higher = planRank(planKey) > planRank(paid.plan_key)
    const beyond = until === null || Date.parse(until) > Date.parse(paid.access_until)
    if (!higher || !beyond) {
      return `Esta conta ainda tem o ${planLabel(paid.plan_key)} pago até ${lastAccessDay(paid.access_until)}. Dê uma cortesia de plano maior que vá além dessa data.`
    }
  }
  return null
}

// Assinante antigo na cortesia (Ruling ADM-T26-cortesia-legado), pela mesma detecção do
// MSG_LEGACY_PAID: sem paga ativa e com pagamento antigo que não virou linha. Sem a confirmação de
// que a cobrança antiga já foi parada no painel do Asaas, recusa (409) antes de mudar qualquer coisa.
// Devolve se a conta é antiga, pra o registro guardar a confirmação; na conta normal o campo não
// muda nada.
async function legacyCourtesyGate(ctx: AdminCtx, userId: string, rows: SubRow[], stopped: boolean): Promise<boolean> {
  if (paidActive(rows).length > 0) return false
  if (!(await isLegacyPaying(ctx, userId, rows))) return false
  if (!stopped) throw new AdminError(409, MSG_LEGACY_COURTESY)
  return true
}

// ── Bloquear (D10)

async function setBlock(ctx: AdminCtx, userId: string, block: boolean, reason: string | null): Promise<{ result: 'blocked' | 'unblocked' }> {
  const result = await rpc<unknown>(ctx, 'admin_set_block', { p_admin: ctx.admin.userId, p_user: userId, p_block: block, p_reason: reason })
  if (block && result === 'blocked') return { result: 'blocked' }
  if (!block && result === 'unblocked') return { result: 'unblocked' }
  if (result === 'not_found') throw new AdminError(404, MSG_ACCOUNT_NOT_FOUND)
  if (block && result === 'is_admin') throw new AdminError(400, MSG_ADMIN_NOT_BLOCKABLE)
  // Conta admin nunca fica bloqueada: desbloquear uma é "não está bloqueada".
  if (result === 'already' || result === 'is_admin') throw new AdminError(409, block ? MSG_ALREADY_BLOCKED : MSG_NOT_BLOCKED)
  // Repetir é seguro: a função responde already.
  throw new Error(`admin_set_block devolveu ${String(result).slice(0, 40)}`)
}

// ── Cota (D11)

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// ── Ações

export const handlers: AdminHandlers = {
  'change-plan': {
    method: 'POST',
    fields: ['userId', 'planKey'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const planKey = planKeyOf(ctx.body)
      const rows = await subscriptionsOf(ctx, userId)
      const [row] = paidActive(rows)
      if (!row) {
        // A dica da cortesia daria um plano de graça a quem o Asaas ainda cobra.
        if (await isLegacyPaying(ctx, userId, rows)) throw new AdminError(409, MSG_LEGACY_PAID)
        throw new AdminError(404, MSG_NO_PAID)
      }
      const before = { planKey: row.plan_key, value: priceOf(row.plan_key), cycle: row.cycle }
      const traced = tracedAsaas(ctx.asaas)
      let uncertain = false
      try {
        return await withAudit(
          ctx,
          { action: 'change_plan', targetUserId: userId, targetRef: row.id, before },
          async () => {
            try {
              return await changePlan(deps(ctx, traced.asaas), { userId, newPlanKey: planKey })
            } catch (e) {
              // O PUT saiu e a resposta não deu certeza: o Asaas pode ter trocado.
              if (uncertainWrite(e, traced.calls)) {
                uncertain = true
                throw await uncertainFailure(ctx, [row.id], `troca de plano para ${planLabel(planKey)}`, e)
              }
              if (e instanceof BillingError && PLAN_UNTOUCHED.has(e.code)) throw e
              // Nenhum pedido saiu pro Asaas (erro do banco antes do PUT): a
              // falha antes de enviar é certeza de nada feito (Ruling
              // ADM-T16-incerto). Não marca, e a frase não diz que o Asaas trocou.
              if (!writeSent(traced.calls)) {
                console.error(`[admin] change-plan falhou antes do PUT (${row.id}):`, describeError(e))
                throw new AdminError(500, MSG_PLAN_NOT_SENT)
              }
              // O PUT saiu e o Asaas aceitou (falha ou recusa já saíram acima),
              // mas o banco não gravou (partial, db_error ou outro): marca a
              // ficha antes de responder e fecha o registro como partial, com a
              // frase que diz se a marcação ficou.
              console.error(`[admin] change-plan pela metade (${row.id}):`, describeError(e))
              const flagged = await flagReview(ctx, [row.id], noteChangePlan(planKey))
              throw new BillingError('partial', flagged ? MSG_PLAN_HALF : MSG_PLAN_HALF_UNMARKED, 500)
            }
          },
          (r) => ({ result: r.result, planKey: r.planKey, value: PLAN_PRICING[r.planKey].value, cycle: PLAN_PRICING[r.planKey].cycle }),
        )
      } catch (e) {
        throw uncertain && e instanceof BillingError ? new UncertainAdminError(502, e.message) : changePlanError(e)
      }
    },
  },

  'grant-courtesy': {
    method: 'POST',
    fields: ['userId', 'planKey', 'days', 'note', 'legacyChargeStopped'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const planKey = planKeyOf(ctx.body)
      const days = daysOf(ctx.body)
      const note = str(ctx.body, 'note', { label: 'a nota', max: 300, optional: true })
      const stopped = legacyStoppedOf(ctx.body)
      const until = days === null ? null : courtesyUntil(ctx.now, days)
      const rows = await subscriptionsOf(ctx, userId)
      const refusal = courtesyRefusal(rows, planKey, until, ctx.now)
      if (refusal) throw new AdminError(409, refusal)
      const legacy = await legacyCourtesyGate(ctx, userId, rows, stopped)
      const before = { subscriptions: liveSummary(rows, ctx.now), ...(legacy ? { legacyChargeStopped: true } : {}) }
      return withAudit(
        ctx,
        { action: 'grant_courtesy', targetUserId: userId, before, note },
        async () => {
          const { courtesyId } = await grantCourtesy(deps(ctx), { userId, planKey, until: until ? new Date(until) : null, note })
          return { courtesyId, until }
        },
        (r) => ({ courtesyId: r.courtesyId, planKey, until: r.until }),
      )
    },
  },

  'end-courtesy': {
    method: 'POST',
    fields: ['userId', 'courtesyId', 'legacyChargeStopped'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const courtesyId = str(ctx.body, 'courtesyId', { label: 'a cortesia', max: 200 })
      const stopped = legacyStoppedOf(ctx.body)
      const rows = courtesyId.startsWith(COURTESY_PREFIX) ? await subscriptionsOf(ctx, userId) : []
      const row = rows.find((r) => r.id === courtesyId && r.kind === 'courtesy')
      if (!row) throw new AdminError(400, MSG_COURTESY_NOT_OURS)
      const legacy = await legacyCourtesyGate(ctx, userId, rows, stopped)
      const before = legacy ? { ...summary(row), legacyChargeStopped: true } : summary(row)
      return withAudit(
        ctx,
        { action: 'end_courtesy', targetUserId: userId, targetRef: courtesyId, before },
        async () => ({ result: (await endCourtesy(deps(ctx), { courtesyId })).result }),
        (r) => r,
      )
    },
  },

  'cancel-subscription': {
    method: 'POST',
    fields: ['userId', 'when'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const when = oneOf(ctx.body, 'when', ['now', 'period_end'] as const, { label: 'quando cancelar' })
      const rows = await subscriptionsOf(ctx, userId)
      const active = paidActive(rows)
      const markIds = async () => (active.length > 0 ? active.map((r) => r.id) : paidActiveIdsNow(ctx, userId))
      const traced = tracedAsaas(ctx.asaas)
      let uncertain = false
      try {
        return await withAudit(
          ctx,
          { action: 'cancel_subscription', targetUserId: userId, targetRef: active[0]?.id ?? null, before: { when, subscriptions: liveSummary(rows, ctx.now) } },
          async () => {
            try {
              const out = await cancelSubscriptionForUser(deps(ctx, traced.asaas), { userId, source: 'admin', immediate: when === 'now' })
              return { result: out.result, accessUntil: out.accessUntil, pendingStop: out.pendingStop }
            } catch (e) {
              // O DELETE saiu e a resposta não deu certeza: o Asaas pode ter
              // parado a cobrança. Cancelar de novo termina (404 conta como já removida).
              if (uncertainWrite(e, traced.calls)) {
                uncertain = true
                const request = `cancelamento da assinatura (${when === 'now' ? 'agora' : 'no fim do período'})`
                throw await uncertainFailure(ctx, await markIds(), request, e)
              }
              if (!(e instanceof BillingError) || e.code !== 'partial') throw e
              // Parte foi feita (o Asaas pode ter parado a cobrança e o banco
              // não): marca a ficha pra aparecer em Pendências. Cancelar de
              // novo termina (a Fase 3 retoma pela assinatura ainda ativa).
              console.error(`[admin] cancel-subscription pela metade (${userId}):`, describeError(e))
              const flagged = await flagReview(ctx, await markIds(), NOTE_CANCEL_HALF)
              throw new BillingError('partial', cancelPartialMessage(e.message, flagged), e.httpStatus)
            }
          },
          (r) => r,
        )
      } catch (e) {
        throw uncertain && e instanceof BillingError ? new UncertainAdminError(502, e.message) : cancelError(e)
      }
    },
  },

  block: {
    method: 'POST',
    fields: ['userId', 'reason'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const reason = str(ctx.body, 'reason', { label: 'o motivo', min: 3, max: 300 })
      return setBlock(ctx, userId, true, reason)
    },
  },

  unblock: {
    method: 'POST',
    fields: ['userId'],
    run: async (ctx) => setBlock(ctx, accountOf(ctx.body), false, null),
  },

  'adjust-quota': {
    method: 'POST',
    fields: ['userId', 'mode', 'amount'],
    run: async (ctx) => {
      const userId = accountOf(ctx.body)
      const mode = oneOf(ctx.body, 'mode', ['reset', 'add'] as const, { label: 'o ajuste' })
      let amount: number | null = null
      if (mode === 'add') amount = int(ctx.body, 'amount', { label: 'a quantidade', min: 1, max: 500 })
      else if (ctx.body.amount !== undefined && ctx.body.amount !== null) throw new AdminError(400, MSG_RESET_NO_AMOUNT)
      // "Somar" não é idempotente (D11: duas abas somam duas vezes). Erro do
      // banco ou resposta fora do contrato não diz que nada mudou: responde
      // incerto (uncertain: true), pra a tela segurar o Confirmar, e o
      // Registro, gravado na mesma transação, mostra se o ajuste ficou.
      let out: unknown
      try {
        out = await rpc<unknown>(ctx, 'admin_adjust_quota', { p_admin: ctx.admin.userId, p_user: userId, p_mode: mode, p_amount: amount })
      } catch (e) {
        console.error('[admin] adjust-quota falhou:', describeError(e))
        throw new UncertainAdminError(500, MSG_QUOTA_UNCONFIRMED)
      }
      const r = typeof out === 'object' && out !== null && !Array.isArray(out) ? (out as Record<string, unknown>) : {}
      if (r.result === 'ok') return { used: numOrNull(r.used), bonus: numOrNull(r.bonus), periodStart: textOrNull(r.periodStart) }
      if (r.result === 'not_found') throw new AdminError(404, MSG_ACCOUNT_NOT_FOUND)
      if (r.result === 'over_limit') throw new AdminError(409, MSG_QUOTA_MAX)
      console.error('[admin] adjust-quota: resposta fora do contrato:', String(r.result).slice(0, 40))
      throw new UncertainAdminError(500, MSG_QUOTA_UNCONFIRMED)
    },
  },
}
