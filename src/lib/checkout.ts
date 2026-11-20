// Abrir o pagamento de um plano (POST /api/checkout, api/checkout.ts), num lugar só pra tela de
// Planos (PricingModal) e a tela de limite do Livre (LimitGate). O servidor sabe o preço, o
// ciclo e o texto do item no Asaas: o app manda só o plano, a confirmação da troca e, quando a
// tela mostrou o desconto do primeiro mês, `offer: true`. Nenhuma resposta vira sucesso calado:
// só um link do pagamento abre alguma coisa, e o resto volta como frase pra mostrar na tela.
import { apiUrl } from './api'
import { getAuthHeaders } from './supabase'
import { isElectron, openExternalUrl } from './desktop'

export type CheckoutPlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'

export type CheckoutOutcome =
  | { kind: 'opened'; external: boolean }
  | { kind: 'error'; message: string; offerEnded: boolean }

const MSG_DOWN = 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.'
const MSG_NETWORK = 'Não foi possível conectar com o servidor. Confira a internet e tente de novo.'
// O 401 do servidor vem em inglês ("Invalid or expired token").
const MSG_SESSION = 'Sua sessão expirou. Entre de novo na sua conta para assinar.'

export async function startCheckout(i: { planKey: CheckoutPlanKey; confirmedSwitch?: boolean; offer?: boolean }): Promise<CheckoutOutcome> {
  let response: Response
  try {
    response = await fetch(apiUrl('/api/checkout'), {
      method: 'POST',
      headers: await getAuthHeaders(),
      // Sem a oferta o corpo é o de sempre; app antigo também não manda o campo (preço cheio).
      body: JSON.stringify({ planKey: i.planKey, confirmedSwitch: i.confirmedSwitch === true, ...(i.offer === true ? { offer: true } : {}) }),
    })
  } catch (e) {
    console.error('[checkout] rede:', e instanceof Error ? e.message : e)
    return { kind: 'error', message: MSG_NETWORK, offerEnded: false }
  }

  let data: Record<string, unknown> = {}
  try {
    const raw = await response.text()
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch { /* não-JSON (página de erro do servidor): fica a frase padrão */ }

  const url = typeof data.url === 'string' ? data.url : ''
  if (response.ok && url) {
    // No app de computador o pagamento abre no navegador do sistema (cartão e 3D Secure
    // funcionam lá; o app relê o plano ao voltar).
    if (isElectron) {
      openExternalUrl(url)
      return { kind: 'opened', external: true }
    }
    window.location.href = url
    return { kind: 'opened', external: false }
  }

  console.error('[checkout] HTTP', response.status)
  // 409 com offerEnded: sem direito à oferta ou janela fechada, nada criado no Asaas. O 409 de
  // "já tem este plano" não traz o campo.
  const offerEnded = response.status === 409 && data.offerEnded === true
  if (response.status === 401) return { kind: 'error', message: MSG_SESSION, offerEnded }
  const message = typeof data.error === 'string' && data.error.trim() ? data.error : MSG_DOWN
  return { kind: 'error', message, offerEnded }
}
