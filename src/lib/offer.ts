// Oferta do primeiro mês no app (Parte 3, D8): pergunta ao servidor o estado da janela de 48
// horas da conta logada (POST /api/checkout?action=offer, api/checkout.ts). Com `open` a tela de
// limite abre a janela do mês, com o limite que bateu em `trigger`; sem `open` (tela de Planos)
// só lê. Os preços com desconto vêm do servidor, o mesmo lugar que cobra (api/_lib/offer.ts).
import { apiUrl } from './api'
import { getAuthHeaders } from './supabase'
import type { LimitKind } from './livreRules'
import type { OfferView } from '../components/livre/limitCopy'

export type OfferResponse = {
  status: 'active' | 'expired' | 'used' | 'none' | 'ineligible'
  expiresAt: string | null
  prices: { essencial_mensal: number; pro_mensal: number }
}

const STATUSES: readonly OfferResponse['status'][] = ['active', 'expired', 'used', 'none', 'ineligible']

const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

// A resposta do servidor, conferida. Fora do formato vale como sem resposta (nulo): a tela
// mostra o preço cheio, nunca um desconto montado de dado estragado.
function parseOffer(data: unknown): OfferResponse | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const status = STATUSES.find((s) => s === d.status)
  if (!status) return null
  const p = (d.prices ?? {}) as Record<string, unknown>
  if (!isPrice(p.essencial_mensal) || !isPrice(p.pro_mensal)) return null
  return {
    status,
    expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : null,
    prices: { essencial_mensal: p.essencial_mensal, pro_mensal: p.pro_mensal },
  }
}

/** Estado da oferta da conta logada. Nulo sem sessão, sem internet ou com qualquer erro. */
export async function fetchOffer(i: { open: boolean; trigger?: LimitKind }): Promise<OfferResponse | null> {
  try {
    const headers = await getAuthHeaders()
    if (!headers.Authorization) return null
    const response = await fetch(apiUrl('/api/checkout?action=offer'), {
      method: 'POST',
      headers,
      body: JSON.stringify(i.open ? { open: true, trigger: i.trigger } : { open: false }),
    })
    if (!response.ok) return null
    const raw = await response.text()
    return parseOffer(raw ? JSON.parse(raw) : null)
  } catch {
    return null
  }
}

/**
 * O que a tela mostra. Só `active` com `expiresAt` no futuro (pelo relógio `now`) vira oferta;
 * vencida, usada, de quem já assinou, sem janela ou sem resposta é o preço cheio (`none`).
 */
export function toOfferView(r: OfferResponse | null, now: number): OfferView {
  if (!r || r.status !== 'active' || r.expiresAt === null) return { status: 'none' }
  const end = Date.parse(r.expiresAt)
  if (!Number.isFinite(end) || !(end > now)) return { status: 'none' }
  return { status: 'active', expiresAt: r.expiresAt, prices: { ...r.prices } }
}
