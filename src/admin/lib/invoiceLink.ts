// Fatura e id de uma cobrança do Asaas, usados por Pendências e Financeiro (Ruling ADM-T18-fatura).
// "Ver no Asaas" abre a fatura do cliente (`invoiceUrl`, consultada na hora pelo `payment-link`),
// onde se vê o status mas não se estorna; o estorno é no painel do Asaas, buscando pelo id.
import { openExternalUrlLater } from '../../lib/desktop'
import { AdminApiError, adminGet } from './adminApi'

export const MSG_NO_INVOICE = 'O Asaas não mandou o link da fatura. Busque a cobrança pelo id no painel do Asaas.'
export const MSG_INVOICE_FAILED = 'Não deu pra abrir a fatura. Tente de novo.'
export const MSG_TAB_BLOCKED = 'O navegador bloqueou a aba nova. Libere as janelas deste site e clique de novo.'

/** Frase pra mostrar ao lado da cobrança. */
export type PaymentFeedback = { tone: 'ok' | 'alert'; text: string }

type PaymentLink = { invoiceUrl?: unknown }

/**
 * Abre a fatura da cobrança. Chame no próprio clique: a aba abre antes do primeiro await
 * (Ruling ADM-T8-aba) e recebe o endereço depois do pedido, só se for https; sem link, ou com
 * erro, a aba fecha. Devolve null quando a fatura abriu, ou a frase do problema.
 */
export async function openPaymentInvoice(paymentId: string): Promise<PaymentFeedback | null> {
  const tab = openExternalUrlLater()
  try {
    const r = await adminGet<PaymentLink>('payment-link', { id: paymentId })
    const url = r?.invoiceUrl
    if (typeof url === 'string' && url.startsWith('https://')) {
      return tab.go(url) ? null : { tone: 'alert', text: MSG_TAB_BLOCKED }
    }
    tab.cancel()
    return { tone: 'alert', text: MSG_NO_INVOICE }
  } catch (e) {
    tab.cancel()
    return { tone: 'alert', text: e instanceof AdminApiError ? e.message : MSG_INVOICE_FAILED }
  }
}

/** Copia o id da cobrança. Sem área de transferência, a frase traz o id pra copiar à mão. */
export async function copyPaymentId(paymentId: string): Promise<PaymentFeedback> {
  try {
    await navigator.clipboard.writeText(paymentId)
    return { tone: 'ok', text: 'Id copiado.' }
  } catch {
    return { tone: 'alert', text: `Não deu pra copiar. O id é ${paymentId}.` }
  }
}
