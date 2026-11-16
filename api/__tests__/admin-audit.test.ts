import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb, type FakeDb } from './fakeSupabase.js'
import { BillingError } from '../_lib/billing.js'
import { AsaasError } from '../_lib/asaas.js'
import { AdminError, toHttpError, type AdminCtx } from '../_lib/admin/http.js'
import { auditFinish, auditStart, withAudit } from '../_lib/admin/audit.js'

// Registro de cada ação do admin (D7): ação que fala com o Asaas grava
// "pendente" antes e o resultado depois. Sem conseguir gravar o pendente, a
// ação não roda. O SQL de admin_log_start e admin_log_finish é da T5; aqui o
// contrato é testado com setRpc no Supabase falso.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const NO_LOG = 'Não deu pra registrar a ação no histórico, então nada foi feito.'

let db: FakeDb
let steps: string[]

function ctxOf(): AdminCtx {
  return {
    db: db as unknown as SupabaseClient,
    asaas: null,
    admin: { userId: ADMIN_ID, email: 'admin@igreja.com' },
    now: new Date('2026-11-16T15:00:00Z'),
    query: {},
    body: {},
  }
}

const finishArgs = () => db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args

beforeEach(() => {
  steps = []
  db = createFakeDb({
    rpc: {
      admin_log_start: () => { steps.push('start'); return 41 },
      admin_log_finish: () => { steps.push('finish'); return null },
    },
  })
})

describe('registro das ações do admin', () => {
  it('withAudit grava início e fim ok com o depois', async () => {
    const out = await withAudit(
      ctxOf(),
      { action: 'change_plan', targetUserId: USER_ID, before: { planKey: 'essencial_mensal' }, note: 'pedido no WhatsApp' },
      async () => { steps.push('acao'); return { result: 'changed', planKey: 'pro_mensal' } },
      (r) => ({ planKey: r.planKey }),
    )
    expect(out).toEqual({ result: 'changed', planKey: 'pro_mensal' })
    expect(steps).toEqual(['start', 'acao', 'finish'])
    expect(db.rpcCalls).toEqual([
      {
        name: 'admin_log_start',
        args: { p_admin: ADMIN_ID, p_action: 'change_plan', p_target_user: USER_ID, p_target_ref: null, p_before: { planKey: 'essencial_mensal' }, p_note: 'pedido no WhatsApp' },
      },
      { name: 'admin_log_finish', args: { p_id: 41, p_result: 'ok', p_after: { planKey: 'pro_mensal' }, p_message: null } },
    ])
  })

  it('sem a função do depois, fecha ok com depois nulo', async () => {
    await withAudit(ctxOf(), { action: 'retry_action', targetRef: '7' }, async () => 'feito')
    expect(db.rpcCalls[0].args).toMatchObject({ p_target_user: null, p_target_ref: '7', p_before: null, p_note: null })
    expect(finishArgs()).toEqual({ p_id: 41, p_result: 'ok', p_after: null, p_message: null })
  })

  it('BillingError partial fecha como partial e relança', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new BillingError('partial', 'O Asaas trocou o plano, mas o app não.', 500)
    await expect(withAudit(ctxOf(), { action: 'change_plan', targetUserId: USER_ID }, async () => { throw err })).rejects.toBe(err)
    expect(finishArgs()).toEqual({ p_id: 41, p_result: 'partial', p_after: null, p_message: 'O Asaas trocou o plano, mas o app não.' })
  })

  it('erro comum fecha como failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('connect ECONNREFUSED 10.0.0.7:5432')
    await expect(withAudit(ctxOf(), { action: 'retry_event', targetRef: 'evt_1' }, async () => { throw err })).rejects.toBe(err)
    // o registro guarda a mesma frase que o admin viu, sem o detalhe técnico
    expect(finishArgs()).toEqual({ p_id: 41, p_result: 'failed', p_after: null, p_message: 'Erro inesperado no servidor.' })
  })

  it('erro do Asaas com frase pronta fecha failed com a frase e o status do Asaas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new BillingError('asaas_unavailable', 'O Asaas não respondeu.', 502)
    await expect(withAudit(ctxOf(), { action: 'cancel_subscription', targetUserId: USER_ID }, async () => { throw err })).rejects.toBe(err)
    expect(finishArgs()).toMatchObject({ p_result: 'failed', p_message: 'O Asaas não respondeu. Status do Asaas: sem dado.' })
  })

  it('misconfigured fecha failed com a frase genérica', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new BillingError('misconfigured', 'Troca de plano indisponível (servidor sem ASAAS_API_KEY).', 500)
    await expect(withAudit(ctxOf(), { action: 'change_plan', targetUserId: USER_ID }, async () => { throw err })).rejects.toBe(err)
    expect(finishArgs()).toEqual({ p_id: 41, p_result: 'failed', p_after: null, p_message: 'Configuração do servidor incompleta. Avise o suporte.' })
    expect(JSON.stringify(finishArgs())).not.toContain('ASAAS_API_KEY')
    expect(log.mock.calls.flat().join(' ')).toContain('ASAAS_API_KEY')
  })

  it('o registro não leva o texto técnico do Asaas e o log leva', async () => {
    const cases: [unknown, string, string][] = [
      [new BillingError('asaas_rejected', 'O Asaas não trocou o plano: Asaas recusou (400): O valor informado é inválido. Nada mudou.', 502),
        'O Asaas recusou o pedido. Status do Asaas: 400.', 'Asaas recusou (400): O valor informado é inválido'],
      [new BillingError('asaas_unavailable', 'O Asaas não trocou o plano: Asaas respondeu 503. Nada mudou.', 502),
        'O Asaas não respondeu. Status do Asaas: 503.', 'Asaas respondeu 503'],
      [new BillingError('asaas_unavailable', 'O Asaas não trocou o plano: Asaas sem resposta (ECONNABORTED). Nada mudou.', 502),
        'O Asaas não respondeu. Status do Asaas: sem dado.', 'ECONNABORTED'],
      [new AsaasError('not_found', 'não encontrado no Asaas', 404), 'O Asaas não achou o que foi pedido. Status do Asaas: 404.', 'não encontrado no Asaas'],
      [new AsaasError('rejected', 'Asaas recusou (400): Cliente sem CPF', 400), 'O Asaas recusou o pedido. Status do Asaas: 400.', 'Cliente sem CPF'],
    ]
    for (const [err, saved, logged] of cases) {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      db.rpcCalls.length = 0
      // quem chama (a T16) pega o erro e responde sozinho: o detalhe tem que ir pro log mesmo assim
      const caught = await withAudit(ctxOf(), { action: 'change_plan', targetUserId: USER_ID }, async () => { throw err }).catch((e: unknown) => e)
      expect(caught).toBe(err)
      const message = String(finishArgs()?.p_message)
      expect(message, saved).toBe(saved)
      expect(message).not.toMatch(/Asaas recusou \(|Asaas respondeu|ECONNABORTED|CPF/)
      expect(log.mock.calls.flat().join(' '), saved).toContain(logged)
      log.mockRestore()
    }
  })

  it('partial e erro comum também vão pro log com o detalhe', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const partial = new BillingError('partial', 'O Asaas trocou o plano, mas o banco respondeu not_found. Conferir à mão.', 500)
    await withAudit(ctxOf(), { action: 'change_plan', targetUserId: USER_ID }, async () => { throw partial }).catch(() => null)
    await withAudit(ctxOf(), { action: 'retry_event', targetRef: 'evt_1' }, async () => { throw new BillingError('db_error', 'Falha no banco (x): deadlock detected', 500) }).catch(() => null)
    const text = log.mock.calls.flat().join(' ')
    expect(text).toContain('respondeu not_found')
    expect(text).toContain('deadlock detected')
  })

  it('sem conseguir registrar o início a ação não roda', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.setRpc('admin_log_start', () => { throw new Error('permission denied for function admin_log_start') })
    const fn = vi.fn(async () => 'feito')
    const err = await withAudit(ctxOf(), { action: 'grant_courtesy', targetUserId: USER_ID }, fn).catch((e: unknown) => e)
    expect(fn).not.toHaveBeenCalled()
    expect(err).toBeInstanceOf(AdminError)
    expect(toHttpError(err)).toEqual({ status: 500, error: NO_LOG })
    expect(db.rpcCalls.map((c) => c.name)).toEqual(['admin_log_start'])
  })

  it('início sem id devolvido também não deixa a ação rodar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.setRpc('admin_log_start', () => null)
    const fn = vi.fn(async () => 'feito')
    await expect(withAudit(ctxOf(), { action: 'end_courtesy', targetUserId: USER_ID }, fn)).rejects.toMatchObject({ status: 500, message: NO_LOG })
    expect(fn).not.toHaveBeenCalled()
  })

  it('auditStart devolve o id do registro, também quando o bigint chega como texto', async () => {
    expect(await auditStart(ctxOf(), { action: 'resolve_flag', targetRef: 'chk_1' })).toBe(41)
    db.setRpc('admin_log_start', () => '42')
    expect(await auditStart(ctxOf(), { action: 'resolve_flag', targetRef: 'chk_1' })).toBe(42)
  })

  it('fechar o registro falhando não lança: a ação já feita devolve o resultado e o registro fica pendente', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.setRpc('admin_log_finish', () => { throw new Error('timeout') })
    const out = await withAudit(ctxOf(), { action: 'change_plan', targetUserId: USER_ID }, async () => ({ result: 'changed' }))
    expect(out).toEqual({ result: 'changed' })
    expect(log).toHaveBeenCalled()
    await expect(auditFinish(ctxOf(), 41, 'ok')).resolves.toBeUndefined()
  })

  it('a função do depois que quebra não desfaz o sucesso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await withAudit(ctxOf(), { action: 'block', targetUserId: USER_ID }, async () => 'feito', () => { throw new Error('x') })
    expect(out).toBe('feito')
    expect(finishArgs()).toEqual({ p_id: 41, p_result: 'ok', p_after: null, p_message: null })
  })
})
