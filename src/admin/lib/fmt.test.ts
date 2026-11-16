import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  cancelSourceLabel,
  fmtBRL,
  fmtDateTimeBR,
  fmtDay,
  fmtUSD,
  paymentStatusLabel,
  planLabel,
} from './fmt'

// O Intl separa o símbolo da moeda com espaço sem quebra (U+00A0).
const NBSP = String.fromCharCode(0xa0)
const plain = (s: string) => s.replaceAll(NBSP, ' ')

describe('fmt', () => {
  it('valor vazio aparece como sem dado', () => {
    expect(EMPTY).toBe('sem dado')
    expect(fmtBRL(null)).toBe('sem dado')
    expect(fmtUSD(null)).toBe('sem dado')
    expect(fmtDay(null)).toBe('sem dado')
    expect(fmtDateTimeBR(null)).toBe('sem dado')
    expect(planLabel(null)).toBe('sem dado')
    expect(paymentStatusLabel(null)).toBe('sem dado')
    expect(cancelSourceLabel(null)).toBe('sem dado')
  })

  it('fmtBRL(1078.8) dá R$ 1.078,80', () => {
    expect(plain(fmtBRL(1078.8))).toBe('R$ 1.078,80')
    expect(plain(fmtBRL(0))).toBe('R$ 0,00')
  })

  it('fmtUSD usa 4 casas abaixo de US$ 0,01', () => {
    expect(plain(fmtUSD(0.0042))).toBe('US$ 0,0042')
    expect(plain(fmtUSD(12.5))).toBe('US$ 12,50')
    expect(plain(fmtUSD(0))).toBe('US$ 0,00')
  })

  it("fmtDay('2026-12-01') mostra 01/12/2026", () => {
    expect(fmtDay('2026-12-01')).toBe('01/12/2026')
    expect(fmtDay('2026-01-31')).toBe('31/01/2026')
  })

  it('fmtDay com instante mostra o dia de Brasília, não o de UTC', () => {
    expect(fmtDay('2026-12-01T02:30:00Z')).toBe('30/11/2026')
    expect(fmtDay('não é data')).toBe('sem dado')
  })

  it("fmtDateTimeBR('2026-12-01T02:30:00Z') mostra 30/11/2026 23:30", () => {
    expect(fmtDateTimeBR('2026-12-01T02:30:00Z')).toBe('30/11/2026 23:30')
    expect(fmtDateTimeBR('2026-11-16T15:05:00Z')).toBe('16/11/2026 12:05')
    expect(fmtDateTimeBR('lixo')).toBe('sem dado')
  })

  it('planLabel dos 5 planos', () => {
    expect(planLabel('free')).toBe('Livre')
    expect(planLabel('essencial_mensal')).toBe('Pro Mensal')
    expect(planLabel('essencial_anual')).toBe('Pro Anual')
    expect(planLabel('pro_mensal')).toBe('Studio Mensal')
    expect(planLabel('pro_anual')).toBe('Studio Anual')
    expect(planLabel('plano_novo')).toBe('plano_novo')
  })

  it("paymentStatusLabel('OVERDUE') dá vencida", () => {
    expect(paymentStatusLabel('OVERDUE')).toBe('vencida')
    expect(paymentStatusLabel('PENDING')).toBe('em aberto')
    expect(paymentStatusLabel('CONFIRMED')).toBe('confirmada')
    expect(paymentStatusLabel('RECEIVED')).toBe('recebida')
    expect(paymentStatusLabel('RECEIVED_IN_CASH')).toBe('recebida em dinheiro')
    expect(paymentStatusLabel('REFUNDED')).toBe('estornada')
    expect(paymentStatusLabel('REFUND_REQUESTED')).toBe('estorno pedido')
    expect(paymentStatusLabel('REFUND_IN_PROGRESS')).toBe('estorno em andamento')
    expect(paymentStatusLabel('DELETED')).toBe('removida')
    expect(paymentStatusLabel('CHARGEBACK_REQUESTED')).toBe('contestação')
    expect(paymentStatusLabel('AWAITING_RISK_ANALYSIS')).toBe('awaiting_risk_analysis')
  })

  it('cancelSourceLabel traduz cada origem do cancelamento', () => {
    expect(cancelSourceLabel('user')).toBe('pelo app')
    expect(cancelSourceLabel('user_refund')).toBe('arrependimento')
    expect(cancelSourceLabel('unpaid')).toBe('falta de pagamento')
    expect(cancelSourceLabel('refund')).toBe('estorno')
    expect(cancelSourceLabel('asaas')).toBe('no painel do Asaas')
    expect(cancelSourceLabel('superseded')).toBe('troca de plano')
    expect(cancelSourceLabel('duplicate')).toBe('compra repetida')
    expect(cancelSourceLabel('admin')).toBe('pelo admin')
    expect(cancelSourceLabel('account_deleted')).toBe('conta excluída')
    expect(cancelSourceLabel('outro')).toBe('outro')
  })
})
