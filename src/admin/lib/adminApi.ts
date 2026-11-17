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

async function send<T>(action: string, params: AdminParams | undefined, init: RequestInit): Promise<T> {
  let res: Response
  try {
    const headers = await getAuthHeaders()
    res = await fetch(actionUrl(action, params), { ...init, headers })
  } catch {
    throw new AdminApiError(init.method === 'POST' ? MSG_NETWORK_ACTION : MSG_NETWORK, 0)
  }
  const body = await readBody(res)
  if (res.status === 401) throw new AdminApiError(MSG_SESSION, 401)
  if (res.status === 403) throw new AdminApiError(MSG_FORBIDDEN, 403)
  if (!res.ok || body === null) {
    throw new AdminApiError(serverError(body) ?? `Erro inesperado (código ${res.status}).`, res.status)
  }
  return body as T
}

export async function adminGet<T>(action: string, params?: AdminParams): Promise<T> {
  return send<T>(action, params, {})
}

export async function adminPost<T>(action: string, body: Record<string, unknown>): Promise<T> {
  return send<T>(action, undefined, { method: 'POST', body: JSON.stringify(body) })
}
