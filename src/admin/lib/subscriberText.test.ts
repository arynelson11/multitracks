import { describe, expect, it } from 'vitest'
import {
  FLAG_FILTERS,
  PLAN_FILTERS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  asaasStatusLabel,
  billingDateText,
  cycleLabel,
  flagLabel,
  flagNeedsYou,
  fmtLastDay,
  jobsWithoutCostText,
  lastAccessText,
  pageRangeText,
  providerLabel,
  quotaText,
  statusLabel,
  subscriptionStatusText,
  subscriptionTitle,
} from './subscriberText'

const TRAVESSAO = String.fromCharCode(0x2014)

describe('statusLabel e flagLabel', () => {
  it('cada status da lista em português', () => {
    expect(statusLabel('paid_active')).toBe('Pagando')
    expect(statusLabel('ending')).toBe('Até o fim do período')
    expect(statusLabel('courtesy')).toBe('Cortesia')
    expect(statusLabel('free')).toBe('Livre')
    expect(statusLabel('blocked')).toBe('Bloqueado')
    // status novo aparece como veio, vazio é sem dado
    expect(statusLabel('novo_status')).toBe('novo_status')
    expect(statusLabel(null)).toBe('sem dado')
    expect(statusLabel('constructor')).toBe('constructor')
  })

  it('cada marcação em português, e só Para conferir e No vermelho em alerta', () => {
    expect(flagLabel('review')).toBe('Para conferir')
    expect(flagLabel('red')).toBe('No vermelho')
    expect(flagLabel('due7')).toBe('Vence em 7 dias')
    expect(flagLabel('blocked')).toBe('Bloqueado')
    expect(flagLabel('inactive30')).toBe('Sumido há 30 dias')
    expect(flagLabel('outra')).toBe('outra')
    expect(['review', 'red', 'due7', 'blocked', 'inactive30'].filter(flagNeedsYou)).toEqual(['review', 'red'])
  })
})

describe('lastAccessText', () => {
  it('mostra o último acesso no horário de Brasília', () => {
    expect(lastAccessText({ lastSeenAt: '2026-12-01T02:30:00Z', lastSignInAt: '2026-11-01T12:00:00Z' })).toBe('Último acesso 30/11/2026 23:30')
  })

  it('lastAccessText cai pro último login', () => {
    expect(lastAccessText({ lastSeenAt: null, lastSignInAt: '2026-11-16T15:00:00Z' })).toBe('Último login 16/11/2026 12:00')
    // acesso gravado com data ilegível também cai pro login
    expect(lastAccessText({ lastSeenAt: 'ontem', lastSignInAt: '2026-11-16T15:00:00Z' })).toBe('Último login 16/11/2026 12:00')
  })

  it('sem os dois mostra sem dado', () => {
    expect(lastAccessText({ lastSeenAt: null, lastSignInAt: null })).toBe('sem dado')
  })
})

// O banco guarda o fim do acesso, do período pago, da cortesia e do plano como 00:00 de Brasília
// do dia SEGUINTE ao último dia (billing_access_end, courtesyUntil da T16, plan_expires_at).
describe('fmtLastDay', () => {
  it('o fim guardado mostra o último dia com acesso, não o dia seguinte', () => {
    expect(fmtLastDay('2026-12-17T03:00:00+00:00')).toBe('16/12/2026')
    expect(fmtLastDay('2026-12-17T03:00:00Z')).toBe('16/12/2026')
    // billing_access_end('2026-12-01'): pago até o fim do dia 01/12
    expect(fmtLastDay('2026-12-02T03:00:00+00:00')).toBe('01/12/2026')
    // courtesyUntil da T16 pedida às 22:00 de Brasília do dia 16/11 com 30 dias
    expect(fmtLastDay('2026-12-17T03:00:00.000Z')).toBe('16/12/2026')
    // virada do ano
    expect(fmtLastDay('2027-01-01T03:00:00+00:00')).toBe('31/12/2026')
  })

  it('instante no meio do dia (cancelar agora) continua no mesmo dia', () => {
    expect(fmtLastDay('2026-11-16T17:00:00+00:00')).toBe('16/11/2026')
  })

  it('um dia AAAA-MM-DD já é o último dia; vazio ou ilegível é sem dado', () => {
    expect(fmtLastDay('2026-12-16')).toBe('16/12/2026')
    expect(fmtLastDay(null)).toBe('sem dado')
    expect(fmtLastDay('ontem')).toBe('sem dado')
  })
})

describe('billingDateText', () => {
  it('pagando mostra a próxima cobrança; até o fim, o fim do acesso', () => {
    expect(billingDateText({ status: 'paid_active', nextDueDate: '2026-12-01', accessUntil: null })).toEqual({ label: 'Próxima cobrança', value: '01/12/2026' })
    expect(billingDateText({ status: 'paid_active', nextDueDate: null, accessUntil: null })).toEqual({ label: 'Próxima cobrança', value: 'sem dado' })
    expect(billingDateText({ status: 'ending', nextDueDate: null, accessUntil: '2026-12-01T03:00:00+00:00' })).toEqual({ label: 'Acesso até', value: '30/11/2026' })
  })

  it('cortesia sem data diz que não acaba', () => {
    expect(billingDateText({ status: 'courtesy', nextDueDate: null, accessUntil: '2026-12-17T03:00:00+00:00' })).toEqual({ label: 'Cortesia até', value: '16/12/2026' })
    expect(billingDateText({ status: 'courtesy', nextDueDate: null, accessUntil: null })).toEqual({ label: 'Cortesia até', value: 'sem data para acabar' })
  })

  it('livre e bloqueado só mostram uma data que exista', () => {
    expect(billingDateText({ status: 'free', nextDueDate: null, accessUntil: null })).toBeNull()
    expect(billingDateText({ status: 'blocked', nextDueDate: '2026-12-05', accessUntil: null })).toEqual({ label: 'Próxima cobrança', value: '05/12/2026' })
    expect(billingDateText({ status: 'blocked', nextDueDate: null, accessUntil: '2026-12-06T03:00:00+00:00' })).toEqual({ label: 'Acesso até', value: '05/12/2026' })
  })
})

describe('pageRangeText', () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({}))
  it('de quem a quem da lista inteira', () => {
    expect(pageRangeText({ page: 1, pageSize: 50, total: 132, rows: rows(50) })).toBe('1 a 50 de 132')
    expect(pageRangeText({ page: 2, pageSize: 50, total: 132, rows: rows(50) })).toBe('51 a 100 de 132')
    expect(pageRangeText({ page: 3, pageSize: 50, total: 132, rows: rows(32) })).toBe('101 a 132 de 132')
  })
  it('página vazia não tem faixa', () => {
    expect(pageRangeText({ page: 4, pageSize: 50, total: 132, rows: [] })).toBeNull()
  })
})

describe('textos da ficha', () => {
  it('forma de entrar, ciclo e status no Asaas em português', () => {
    expect(providerLabel('email')).toBe('e-mail e senha')
    expect(providerLabel('google')).toBe('Google')
    expect(providerLabel('github')).toBe('github')
    expect(providerLabel(null)).toBe('sem dado')
    expect(cycleLabel('MONTHLY')).toBe('mensal')
    expect(cycleLabel('YEARLY')).toBe('anual')
    expect(cycleLabel('WEEKLY')).toBe('weekly')
    expect(cycleLabel(null)).toBe('sem dado')
    expect(asaasStatusLabel({ status: 'ACTIVE', deleted: false })).toBe('ativa')
    expect(asaasStatusLabel({ status: 'INACTIVE', deleted: false })).toBe('inativa')
    expect(asaasStatusLabel({ status: 'EXPIRED', deleted: false })).toBe('expirada')
    expect(asaasStatusLabel({ status: 'ACTIVE', deleted: true })).toBe('removida')
  })

  it('assinatura paga ou cortesia, ativa ou encerrada', () => {
    expect(subscriptionTitle({ planKey: 'essencial_mensal', kind: 'asaas' })).toBe('Pro Mensal, assinatura paga')
    expect(subscriptionTitle({ planKey: 'pro_anual', kind: 'courtesy' })).toBe('Studio Anual, cortesia')
    expect(subscriptionStatusText({ status: 'active' })).toBe('ativa')
    expect(subscriptionStatusText({ status: 'canceled' })).toBe('encerrada')
  })

  it('cota como usadas / limite + extra', () => {
    expect(quotaText({ used: 4, limit: 5, bonus: 0 })).toBe('4 / 5')
    expect(quotaText({ used: 4, limit: 5, bonus: 10 })).toBe('4 / 5 + 10 extra')
    expect(quotaText({ used: 12, limit: null, bonus: 0 })).toBe('12 / sem limite')
  })

  it('trabalhos sem custo contados à parte', () => {
    expect(jobsWithoutCostText(0)).toBeNull()
    expect(jobsWithoutCostText(1)).toBe('1 trabalho sem custo')
    expect(jobsWithoutCostText(3)).toBe('3 trabalhos sem custo')
  })
})

describe('opções dos filtros', () => {
  it('status, marcação, plano e ordem com os valores do contrato', () => {
    expect(STATUS_FILTERS.map((o) => [o.value, o.label])).toEqual([
      ['all', 'Todos'], ['paid_active', 'Pagando'], ['ending', 'Até o fim do período'], ['courtesy', 'Cortesia'], ['free', 'Livre'], ['blocked', 'Bloqueados'],
    ])
    expect(FLAG_FILTERS.map((o) => [o.value, o.label])).toEqual([
      ['due7', 'Vence em 7 dias'], ['red', 'No vermelho'], ['review', 'Para conferir'], ['inactive30', 'Sumidos há 30 dias'],
    ])
    expect(PLAN_FILTERS.map((o) => [o.value, o.label])).toEqual([
      ['all', 'Todos os planos'], ['essencial_mensal', 'Pro Mensal'], ['essencial_anual', 'Pro Anual'], ['pro_mensal', 'Studio Mensal'], ['pro_anual', 'Studio Anual'],
    ])
    expect(SORT_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['created', 'Mais novos'], ['separations', 'Mais separações'], ['last_seen', 'Último acesso'],
    ])
  })

  it('texto sem TRAVESSAO', () => {
    const texts = [
      ...[STATUS_FILTERS, FLAG_FILTERS, PLAN_FILTERS, SORT_OPTIONS].flatMap((list) => list.map((o) => o.label)),
      ...['paid_active', 'ending', 'courtesy', 'free', 'blocked'].map(statusLabel),
      ...['review', 'red', 'due7', 'blocked', 'inactive30'].map(flagLabel),
      lastAccessText({ lastSeenAt: null, lastSignInAt: null }),
      billingDateText({ status: 'courtesy', nextDueDate: null, accessUntil: null })?.value ?? '',
      quotaText({ used: 1, limit: null, bonus: 2 }),
      jobsWithoutCostText(2) ?? '',
    ]
    for (const t of texts) expect(t).not.toContain(TRAVESSAO)
  })
})
