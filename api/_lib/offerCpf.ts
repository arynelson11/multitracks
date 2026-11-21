import { createHmac } from 'node:crypto'
import { AsaasError, getCustomerCpf } from './asaas.js'
import type { BillingDeps } from './billing.js'

// Conferência do CPF da oferta do primeiro mês (Parte 3, D9). Depois do primeiro pagamento
// com desconto, o CPF do cliente no Asaas vira um HMAC-SHA256 com o segredo OFFER_CPF_SECRET
// (variável da Vercel) e só o hash vai pro registro da oferta (offer_record_cpf, em
// db/supabase_oferta.sql), que diz se outra conta (ou uma conta já excluída) já usou a oferta
// com o mesmo CPF. O número nunca é guardado nem registrado em log: nem aqui, nem no erro.
// Nada aqui derruba a cobrança: qualquer falha vira a marcação "CPF não conferido" na ficha
// da assinatura (billing_flag_review), pro admin olhar.

// As marcações aparecem na ficha do admin: português com acento e sem nome de variável.
const NOTE_REUSED = 'oferta do primeiro mês: o mesmo CPF já usou a oferta em outra conta'
const NOTE_UNCHECKED = 'oferta do primeiro mês: CPF não conferido (Asaas fora ou segredo do CPF não configurado no servidor)'

export type OfferCpfResult = 'ok' | 'reused' | 'unchecked'

// HMAC-SHA256 em hex (64 letras de 0-9 e a-f) dos dígitos do CPF: com ou sem pontos e traço,
// o mesmo hash.
export function hashCpf(cpf: string, secret: string): string {
  return createHmac('sha256', secret).update(cpf.replace(/\D/g, '')).digest('hex')
}

// Lê o CPF do cliente no Asaas, grava o hash no registro da oferta da conta naquele mês e marca
// a ficha quando o mesmo CPF já usou a oferta noutra conta ('reused') ou quando não deu pra
// conferir ('unchecked': servidor sem o segredo, checkout sem cliente, cliente sem CPF, Asaas
// fora ou o registro recusando, inclusive sem a linha do mês, P0002). Nunca lança.
export async function checkOfferCpf(
  deps: BillingDeps,
  i: { userId: string; checkoutId: string; customerId: string | null; month: string },
): Promise<OfferCpfResult> {
  const result = await compare(deps, i)
  if (result !== 'ok') await flag(deps, i.checkoutId, result === 'reused' ? NOTE_REUSED : NOTE_UNCHECKED)
  return result
}

async function compare(
  deps: BillingDeps,
  i: { userId: string; checkoutId: string; customerId: string | null; month: string },
): Promise<OfferCpfResult> {
  const secret = process.env.OFFER_CPF_SECRET
  if (!secret || !i.customerId || !deps.asaas) return 'unchecked'
  let cpf: string | null
  try {
    cpf = await getCustomerCpf(deps.asaas, i.customerId)
  } catch (e) {
    // Só o tipo do erro vai pro log (a mensagem do Asaas fica de fora).
    console.warn('[offer] CPF nao conferido: Asaas fora', { checkoutId: i.checkoutId, kind: e instanceof AsaasError ? e.kind : 'erro' })
    return 'unchecked'
  }
  if (!cpf) return 'unchecked'
  try {
    const { data, error } = await deps.db.rpc('offer_record_cpf', { p_user_id: i.userId, p_month: i.month, p_cpf_hash: hashCpf(cpf, secret) })
    if (error) {
      console.warn('[offer] CPF nao conferido: registro da oferta recusou', { checkoutId: i.checkoutId, code: error.code ?? null })
      return 'unchecked'
    }
    return data === true ? 'reused' : 'ok'
  } catch {
    console.warn('[offer] CPF nao conferido: falha ao falar com o banco', { checkoutId: i.checkoutId })
    return 'unchecked'
  }
}

async function flag(deps: BillingDeps, checkoutId: string, note: string): Promise<void> {
  try {
    const { error } = await deps.db.rpc('billing_flag_review', { p_id: checkoutId, p_note: note })
    if (error) console.warn('[offer] marcacao do CPF nao gravada', { checkoutId, code: error.code ?? null })
  } catch {
    console.warn('[offer] marcacao do CPF nao gravada', { checkoutId })
  }
}
