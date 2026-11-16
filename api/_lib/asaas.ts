import axios, { type AxiosInstance } from 'axios'

// Cliente mínimo da API v3 do Asaas (https://docs.asaas.com). Toda chamada
// devolve o JSON ou lança AsaasError com um tipo:
//   unavailable: sem resposta, timeout, 5xx ou 429 (tentar de novo depois)
//   not_found:   404 (ex.: assinatura já removida)
//   rejected:    outro 4xx (pedido recusado; tentar de novo não resolve)
// A chave da API vai só no header e nunca é registrada em log.

export type AsaasErrorKind = 'unavailable' | 'not_found' | 'rejected'

export class AsaasError extends Error {
  readonly kind: AsaasErrorKind
  readonly status?: number
  constructor(kind: AsaasErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'AsaasError'
    this.kind = kind
    this.status = status
  }
}

export interface AsaasApi {
  get<T = unknown>(path: string, params?: Record<string, string | number | boolean>): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  put<T = unknown>(path: string, body?: unknown): Promise<T>
  del<T = unknown>(path: string): Promise<T>
}

// Sandbox por padrão; produção só quando ASAAS_ENV === 'production' (evita
// cobrar de verdade por engano em testes).
export function asaasBaseUrl(): string {
  return process.env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3'
}

function describe(data: unknown): string {
  const errors = (data as { errors?: { description?: unknown }[] } | null)?.errors
  const first = Array.isArray(errors) ? errors[0]?.description : undefined
  return typeof first === 'string' ? first.slice(0, 300) : 'erro sem descrição'
}

function toAsaasError(e: unknown): AsaasError {
  if (e instanceof AsaasError) return e
  if (axios.isAxiosError(e)) {
    const status = e.response?.status
    if (!status) return new AsaasError('unavailable', `Asaas sem resposta (${e.code ?? 'rede'})`)
    if (status === 404) return new AsaasError('not_found', 'não encontrado no Asaas', 404)
    if (status === 429 || status >= 500) return new AsaasError('unavailable', `Asaas respondeu ${status}`, status)
    return new AsaasError('rejected', `Asaas recusou (${status}): ${describe(e.response?.data)}`, status)
  }
  return new AsaasError('unavailable', 'falha inesperada ao falar com o Asaas')
}

export function createAsaasApi(apiKey: string, timeoutMs = 9000): AsaasApi {
  const http: AxiosInstance = axios.create({
    baseURL: asaasBaseUrl(),
    headers: { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': 'PlaybackStudio/1.0' },
    timeout: timeoutMs,
  })
  const call = async <T>(p: Promise<{ data: T }>): Promise<T> => {
    try { return (await p).data } catch (e) { throw toAsaasError(e) }
  }
  return {
    get: (path, params) => call(http.get(path, { params })),
    post: (path, body) => call(http.post(path, body ?? {})),
    put: (path, body) => call(http.put(path, body ?? {})),
    del: (path) => call(http.delete(path)),
  }
}

// null quando ASAAS_API_KEY não está configurada.
export function asaasFromEnv(): AsaasApi | null {
  const key = process.env.ASAAS_API_KEY
  return key ? createAsaasApi(key) : null
}

// ── Formatos do Asaas que o backend usa ──

export type AsaasPayment = {
  id: string
  status?: string
  subscription?: string | null
  checkoutSession?: string | null
  customer?: string | null
  dueDate?: string | null
  originalDueDate?: string | null
  paymentDate?: string | null
  clientPaymentDate?: string | null
  confirmedDate?: string | null
  dateCreated?: string | null
  value?: number | null
  netValue?: number | null
  originalValue?: number | null
  interestValue?: number | null
  billingType?: string | null
  deleted?: boolean
}

type ListPage<T> = { data?: T[]; hasMore?: boolean }

const MAX_PAGES = 10

// Todas as cobranças de uma assinatura (paginado, até 1000).
export async function listSubscriptionPayments(api: AsaasApi, subscriptionId: string): Promise<AsaasPayment[]> {
  const all: AsaasPayment[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.get<ListPage<AsaasPayment>>('/payments', { subscription: subscriptionId, limit: 100, offset: page * 100 })
    const data = Array.isArray(res?.data) ? res.data : []
    all.push(...data)
    if (!res?.hasMore || data.length === 0) break
  }
  return all
}

// Descobre a assinatura criada por um checkout pelas cobranças dele
// (GET /payments?checkoutSession=..., filtro documentado em "Listar cobranças").
export async function findSubscriptionIdByCheckout(api: AsaasApi, checkoutId: string): Promise<string | null> {
  const res = await api.get<ListPage<AsaasPayment>>('/payments', { checkoutSession: checkoutId, limit: 10 })
  const hit = (Array.isArray(res?.data) ? res.data : []).find((p) => typeof p.subscription === 'string' && p.subscription)
  return hit?.subscription ?? null
}

export async function getSubscription(api: AsaasApi, subscriptionId: string): Promise<{ id: string; checkoutSession?: string | null; customer?: string | null; status?: string } | null> {
  try {
    return await api.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`)
  } catch (e) {
    if (e instanceof AsaasError && e.kind === 'not_found') return null
    throw e
  }
}

// Remove a assinatura (para a recorrência; o Asaas apaga as cobranças pendentes
// ou vencidas dela). 404 = já removida, conta como sucesso.
export async function deleteSubscription(api: AsaasApi, subscriptionId: string): Promise<'deleted' | 'already_gone'> {
  try {
    await api.del(`/subscriptions/${encodeURIComponent(subscriptionId)}`)
    return 'deleted'
  } catch (e) {
    if (e instanceof AsaasError && e.kind === 'not_found') return 'already_gone'
    throw e
  }
}

// Estorno integral da cobrança (POST /payments/{id}/refund sem valor = total).
export async function refundPayment(api: AsaasApi, paymentId: string, description: string): Promise<void> {
  await api.post(`/payments/${encodeURIComponent(paymentId)}/refund`, { description })
}

// Mantém ligados, por e-mail e SMS, os avisos do próprio Asaas ao cliente sobre
// vencimento e atraso. O Asaas já cria esses avisos ligados para todo cliente
// novo (docs: "Notificações padrões"); aqui só religa o que estiver desligado.
// Os avisos são por cliente (não por assinatura) e têm tarifa por envio.
const KEEP_ON = new Set(['PAYMENT_DUEDATE_WARNING', 'PAYMENT_OVERDUE'])
type AsaasNotification = { id: string; event?: string; enabled?: boolean; emailEnabledForCustomer?: boolean; smsEnabledForCustomer?: boolean }

export async function ensureDueDateNotifications(api: AsaasApi, customerId: string): Promise<number> {
  const res = await api.get<ListPage<AsaasNotification>>(`/customers/${encodeURIComponent(customerId)}/notifications`)
  const off = (Array.isArray(res?.data) ? res.data : []).filter((n) =>
    KEEP_ON.has(n.event ?? '') && (n.enabled === false || n.emailEnabledForCustomer === false || n.smsEnabledForCustomer === false))
  if (off.length === 0) return 0
  await api.put('/notifications/batch', {
    customer: customerId,
    notifications: off.map((n) => ({ id: n.id, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true })),
  })
  return off.length
}
