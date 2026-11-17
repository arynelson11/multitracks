import { describe, expect, it } from 'vitest'
import { accountLabel, actionLabel, displayResult, entryMessage, jsonText, resultLabel } from './auditText'
import type { AuditEntry } from './auditTypes'

const TRAVESSAO = String.fromCharCode(0x2014)

const ACTIONS: Record<string, string> = {
  resolve_flag: 'conferiu marcação',
  close_action: 'fechou pendência',
  retry_action: 'tentou pendência de novo',
  retry_event: 'reprocessou aviso do Asaas',
  change_plan: 'mudou o plano',
  grant_courtesy: 'deu cortesia',
  end_courtesy: 'encerrou cortesia',
  cancel_subscription: 'cancelou a assinatura',
  block: 'bloqueou',
  unblock: 'desbloqueou',
  adjust_quota: 'ajustou a cota',
}

const RESULTS: Record<string, string> = {
  ok: 'feito',
  failed: 'falhou',
  partial: 'em parte',
  pending: 'sem confirmação',
}

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1, createdAt: '2026-11-16T15:00:00Z', finishedAt: '2026-11-16T15:00:01Z', adminEmail: 'admin@igreja.com',
    action: 'resolve_flag', targetUserId: null, targetEmail: null, targetRef: null, result: 'ok',
    message: null, note: null, before: null, after: null, ...over,
  }
}

describe('textos do Registro', () => {
  it('actionLabel e resultLabel de todos os valores', () => {
    for (const [action, label] of Object.entries(ACTIONS)) expect(actionLabel(action), action).toBe(label)
    for (const [result, label] of Object.entries(RESULTS)) expect(resultLabel(result), result).toBe(label)
  })

  it('ação ou resultado novo aparece como veio, e vazio como sem dado', () => {
    expect(actionLabel('nova_acao')).toBe('nova_acao')
    expect(resultLabel('outro')).toBe('outro')
    expect(actionLabel('')).toBe('sem dado')
    expect(resultLabel('')).toBe('sem dado')
  })

  it('nome que existe no Object.prototype não vira rótulo', () => {
    expect(actionLabel('constructor')).toBe('constructor')
    expect(resultLabel('toString')).toBe('toString')
  })

  it('o resultado mostrado: laranja só em feito, âmbar em falhou e em parte, neutro sem confirmação', () => {
    expect(displayResult(entry({ result: 'ok' }))).toEqual({ label: 'feito', tone: 'on' })
    expect(displayResult(entry({ result: 'failed' }))).toEqual({ label: 'falhou', tone: 'alert' })
    expect(displayResult(entry({ result: 'partial' }))).toEqual({ label: 'em parte', tone: 'alert' })
    expect(displayResult(entry({ result: 'pending' }))).toEqual({ label: 'sem confirmação', tone: 'neutral' })
  })

  it('Tentar agora fechado ok com a pendência ainda pendente é falhou de novo', () => {
    const retried = entry({ action: 'retry_action', before: { status: 'pending', attempts: 1 }, after: { status: 'pending', attempts: 2, lastError: 'O Asaas não respondeu.' } })
    expect(displayResult(retried)).toEqual({ label: 'falhou de novo', tone: 'alert' })
    expect(entryMessage(retried)).toBe('O Asaas não respondeu.')
    const done = entry({ action: 'retry_action', after: { status: 'done', attempts: 2, lastError: null } })
    expect(displayResult(done)).toEqual({ label: 'feito', tone: 'on' })
    expect(entryMessage(done)).toBeNull()
  })

  it('aviso reprocessado ok com processed falso é falhou de novo', () => {
    expect(displayResult(entry({ action: 'retry_event', after: { processed: false, result: null } }))).toEqual({ label: 'falhou de novo', tone: 'alert' })
    expect(displayResult(entry({ action: 'retry_event', after: { processed: true, result: 'paid' } }))).toEqual({ label: 'feito', tone: 'on' })
  })

  it('falhou de novo só vale pro registro fechado ok das duas tentativas', () => {
    // falha registrada continua falhou; outra ação com status pendente no depois continua feito
    expect(displayResult(entry({ action: 'retry_action', result: 'failed', after: null })).label).toBe('falhou')
    expect(displayResult(entry({ action: 'retry_action', result: 'pending', after: null })).label).toBe('sem confirmação')
    expect(displayResult(entry({ action: 'close_action', after: { status: 'pending' } })).label).toBe('feito')
    expect(displayResult(entry({ action: 'retry_event', after: { processed: 'false' } })).label).toBe('feito')
    expect(displayResult(entry({ action: 'retry_action', after: 'pending' })).label).toBe('feito')
  })

  it('a mensagem gravada vale mais que o último erro do depois', () => {
    expect(entryMessage(entry({ result: 'failed', message: 'O Asaas não respondeu. Status do Asaas: 503.' }))).toBe('O Asaas não respondeu. Status do Asaas: 503.')
    expect(entryMessage(entry({ action: 'retry_action', message: 'ok', after: { status: 'pending', lastError: 'x' } }))).toBe('ok')
  })

  it('conta: o e-mail, senão a referência, senão sem dado', () => {
    expect(accountLabel(entry({ targetEmail: 'quem@igreja.com', targetRef: 'chk_1' }))).toBe('quem@igreja.com')
    expect(accountLabel(entry({ targetRef: 'evt_1' }))).toBe('evt_1')
    expect(accountLabel(entry())).toBe('sem dado')
  })

  it('JSON com recuo, e nulo como sem dado', () => {
    expect(jsonText({ status: 'pending', attempts: 2 })).toBe('{\n  "status": "pending",\n  "attempts": 2\n}')
    expect(jsonText(null)).toBe('sem dado')
    expect(jsonText(undefined)).toBe('sem dado')
  })

  it('nenhum texto tem travessão', () => {
    const texts = [
      ...Object.keys(ACTIONS).map(actionLabel),
      ...Object.keys(RESULTS).map(resultLabel),
      displayResult(entry({ action: 'retry_event', after: { processed: false } })).label,
      accountLabel(entry()),
      jsonText(null),
    ]
    for (const t of texts) expect(t.includes(TRAVESSAO), t).toBe(false)
  })
})
