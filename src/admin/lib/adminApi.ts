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

// Teto de tempo (Ruling ADM-T4-teto): uma rede pendurada (Wi-Fi sem internet) não deixa a tela
// carregando nem o diálogo ocupado pra sempre. A ação tem o teto do maxDuration da função (30 s);
// estourado, vale a mesma frase da falha de rede, porque o servidor pode ter agido.
const GET_TIMEOUT_MS = 15_000
const POST_TIMEOUT_MS = 30_000

/** Erro com a frase pronta pra tela. `status` 0 = não chegou ao servidor. */
export class AdminApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

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

async function request<T>(url: string, init: RequestInit, isAction: boolean): Promise<T> {
  let res: Response
  try {
    const headers = await getAuthHeaders()
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new AdminApiError(isAction ? MSG_NETWORK_ACTION : MSG_NETWORK, 0)
  }
  const body = await readBody(res)
  if (res.status === 401) throw new AdminApiError(MSG_SESSION, 401)
  if (res.status === 403) throw new AdminApiError(MSG_FORBIDDEN, 403)
  if (!res.ok || body === null) {
    throw new AdminApiError(serverError(body) ?? `Erro inesperado (código ${res.status}).`, res.status)
  }
  return body as T
}

/** Faz o pedido com teto de tempo. Estourado, corta o fetch (AbortController) e responde a frase pronta. */
async function send<T>(action: string, params: AdminParams | undefined, init: RequestInit): Promise<T> {
  const isAction = init.method === 'POST'
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // O teto corre contra o pedido inteiro, inclusive a renovação do token e a leitura do corpo.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort()
        reject(new AdminApiError(isAction ? MSG_NETWORK_ACTION : MSG_TIMEOUT, 0))
      },
      isAction ? POST_TIMEOUT_MS : GET_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([
      request<T>(actionUrl(action, params), { ...init, signal: controller.signal }, isAction),
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
