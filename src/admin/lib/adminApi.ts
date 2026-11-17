// Cliente das ações do admin (`/api/admin-stats?action=...`). Passa sempre pelo apiUrl: no app
// de computador, que roda de file://, um caminho absoluto "/api" não chegaria ao servidor.
import { apiUrl } from '../../lib/api'
import { getAuthHeaders } from '../../lib/supabase'

export type AdminParams = Record<string, string | number | undefined>

const MSG_SESSION = 'Sua sessão expirou. Entre de novo.'
const MSG_FORBIDDEN = 'Esta conta não é admin.'
const MSG_NETWORK = 'Não deu pra falar com o servidor. Confira a internet e tente de novo.'
// Numa ação, a resposta pode ter se perdido depois de o servidor agir: repetir às cegas pode
// fazer duas vezes (Somar na cota, por exemplo). Por isso a frase manda olhar o Registro antes.
const MSG_NETWORK_ACTION = 'A resposta do servidor não chegou. Confira no Registro se a ação foi feita antes de tentar de novo.'
const MSG_TIMEOUT = 'O servidor demorou demais pra responder. Tente de novo.'

// Tetos de tempo (Rulings ADM-T4-teto e ADM-T4-incerto): uma rede pendurada (Wi-Fi sem internet)
// não deixa a tela carregando nem o diálogo ocupado pra sempre. Os tetos contam a partir do fetch,
// depois da renovação do token. A ação espera 35 s, acima do maxDuration de 30 s da função: quando
// a frase aparece, a função já terminou ou foi cortada. A renovação do token tem teto próprio.
const GET_TIMEOUT_MS = 15_000
const POST_TIMEOUT_MS = 35_000
const AUTH_TIMEOUT_MS = 15_000

/** Erro com a frase pronta pra tela. `status` 0 = não chegou ao servidor. */
export class AdminApiError extends Error {
  readonly status: number
  /**
   * Só numa ação (POST): a resposta não chegou ou não veio do nosso servidor (rede, teto estourado,
   * 5xx sem a frase pronta), então a ação pode ter sido feita. Quem mostra o erro não deixa
   * repetir na hora (o ConfirmDialog segura Confirmar até fechar e abrir de novo).
   */
  readonly uncertain: boolean

  constructor(message: string, status: number, uncertain = false) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.uncertain = uncertain
  }
}

/**
 * Diz se o erro de uma ação é incerto: o AdminApiError marcado ou, pra quem guardou só o texto,
 * a frase do Registro (que só sai em erro incerto).
 */
export function isUncertainError(error: unknown): boolean {
  if (error instanceof AdminApiError) return error.uncertain
  return error === MSG_NETWORK_ACTION
}

const actionLost = (status: number) => new AdminApiError(MSG_NETWORK_ACTION, status, true)

function actionUrl(action: string, params?: AdminParams): string {
  const query = new URLSearchParams({ action })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) query.append(key, String(value))
  }
  return apiUrl('/api/admin-stats?' + query.toString())
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function serverError(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === 'string' && error.trim() !== '') return error
  }
  return null
}

/** Cabeçalhos com o token renovado. Até aqui nada saiu pro nosso servidor: o erro é certo. */
async function authHeaders(): Promise<Record<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getAuthHeaders(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('renovação do token sem resposta')), AUTH_TIMEOUT_MS)
      }),
    ])
  } catch {
    throw new AdminApiError(MSG_NETWORK, 0)
  } finally {
    clearTimeout(timer)
  }
}

async function exchange<T>(url: string, init: RequestInit, isAction: boolean): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    // Numa ação, o pedido pode ter chegado ao servidor antes de a rede cair.
    throw isAction ? actionLost(0) : new AdminApiError(MSG_NETWORK, 0)
  }
  const body = await readBody(res)
  if (res.status === 401) throw new AdminApiError(MSG_SESSION, 401)
  if (res.status === 403) throw new AdminApiError(MSG_FORBIDDEN, 403)
  if (res.ok && body !== null) return body as T
  // Frase pronta do nosso servidor (400, 409, 500, 502 "Nada foi marcado"): ele respondeu, e a
  // ação com certeza não foi feita. Pode tentar de novo.
  const message = serverError(body)
  if (message) throw new AdminApiError(message, res.status)
  // Numa ação, 5xx sem a frase (504 da Vercel, função que caiu no meio) ou 2xx sem corpo legível:
  // o servidor pode ter agido.
  if (isAction && (res.status >= 500 || res.ok)) throw actionLost(res.status)
  throw new AdminApiError(`Erro inesperado (código ${res.status}).`, res.status)
}

/** Faz o pedido com teto de tempo. Estourado, corta o fetch (AbortController) e responde a frase pronta. */
async function send<T>(action: string, params: AdminParams | undefined, init: RequestInit): Promise<T> {
  const isAction = init.method === 'POST'
  const headers = await authHeaders()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // O teto corre contra o fetch e a leitura do corpo.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort()
        reject(isAction ? actionLost(0) : new AdminApiError(MSG_TIMEOUT, 0))
      },
      isAction ? POST_TIMEOUT_MS : GET_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([
      exchange<T>(actionUrl(action, params), { ...init, headers, signal: controller.signal }, isAction),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function adminGet<T>(action: string, params?: AdminParams): Promise<T> {
  return send<T>(action, params, {})
}

export async function adminPost<T>(action: string, body: Record<string, unknown>): Promise<T> {
  return send<T>(action, undefined, { method: 'POST', body: JSON.stringify(body) })
}
