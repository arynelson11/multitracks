import { describe, expect, it } from 'vitest'
import {
  actionTitle,
  closeDialogText,
  closedText,
  eventStatusText,
  eventTitle,
  flagStatusText,
  flagTitle,
  isReviewQueue,
  noteLines,
  reasonText,
  retryActionText,
  retryEventText,
  updatedAtLabel,
} from './reviewText'
import type { ReviewAction } from './reviewTypes'

type Target = Pick<ReviewAction, 'action' | 'paymentId' | 'subscriptionRef'>

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)

describe('reviewText', () => {
  it('actionTitle dá o nome de cada pendência e troca sublinhado por espaço numa desconhecida', () => {
    expect(actionTitle('refund_payment')).toBe('Estornar à mão')
    expect(actionTitle('admin_review')).toBe('Caso pra olhar')
    expect(actionTitle('delete_future_payments')).toBe('Remover cobrança futura')
    expect(actionTitle('inactivate_subscription')).toBe('Inativar assinatura no Asaas')
    expect(actionTitle('delete_subscription')).toBe('Remover assinatura no Asaas')
    expect(actionTitle('algo_novo_da_cobranca')).toBe('algo novo da cobranca')
  })

  it('reasonText conhece os motivos da cobrança e troca sublinhado por espaço no resto', () => {
    expect(reasonText('estorno_recusado_pelo_asaas')).toBe('O Asaas recusou o estorno automático do arrependimento')
    expect(reasonText('arrependimento_pedido_nao_e_a_primeira_assinatura')).toBe(
      'Arrependimento pedido numa assinatura que não é a primeira da conta',
    )
    expect(reasonText('rede_de_seguranca')).toBe('Renovação passou do vencimento sem aviso do Asaas')
    expect(reasonText('compra_duplicada')).toBe('Compra repetida do mesmo plano')
    expect(reasonText('motivo_que_ninguem_conhece')).toBe('motivo que ninguem conhece')
    // Texto livre (a conferência diária escreve frases) passa como veio.
    expect(reasonText('conferencia: assinatura sub_1 ATIVA no Asaas sem registro no app')).toBe(
      'conferencia: assinatura sub_1 ATIVA no Asaas sem registro no app',
    )
    expect(reasonText(null)).toBe('sem dado')
    expect(reasonText('')).toBe('sem dado')
  })

  it('reasonText traduz vencida, estorno e os motivos de cancel_source', () => {
    expect(reasonText('vencida')).toBe('Renovação vencida')
    expect(reasonText('estorno')).toBe('Estorno feito no painel')
    expect(reasonText('duplicate')).toBe('compra repetida')
    expect(reasonText('superseded')).toBe('troca de plano')
    expect(reasonText('user')).toBe('pelo app')
    expect(reasonText('user_refund')).toBe('arrependimento')
    expect(reasonText('unpaid')).toBe('falta de pagamento')
    expect(reasonText('refund')).toBe('estorno')
    expect(reasonText('asaas')).toBe('no painel do Asaas')
    expect(reasonText('admin')).toBe('pelo admin')
    expect(reasonText('account_deleted')).toBe('conta excluída')
  })

  it('reasonText não cai em nome herdado de objeto', () => {
    expect(reasonText('toString')).toBe('toString')
    expect(reasonText('constructor')).toBe('constructor')
    expect(actionTitle('constructor')).toBe('constructor')
  })

  it('noteLines divide por barra', () => {
    expect(noteLines('Pagamento sem assinatura | Valor diferente do plano')).toEqual([
      'Pagamento sem assinatura',
      'Valor diferente do plano',
    ])
    expect(noteLines(' | só esta |  | ')).toEqual(['só esta'])
    expect(noteLines('uma linha só')).toEqual(['uma linha só'])
    expect(noteLines(null)).toEqual([])
    expect(noteLines('')).toEqual([])
  })

  it('eventTitle diz que o aviso do Asaas falhou', () => {
    expect(eventTitle('PAYMENT_CONFIRMED')).toBe('Aviso do Asaas que falhou: PAYMENT_CONFIRMED')
    expect(eventTitle('')).toBe('Aviso do Asaas que falhou: sem dado')
  })

  it('eventStatusText e flagTitle em português', () => {
    expect(eventStatusText('pending')).toBe('Ainda não processado')
    expect(eventStatusText('failed')).toBe('Falhou, tenta de novo sozinho')
    expect(eventStatusText('exhausted')).toBe('Parou de tentar sozinho')
    expect(flagTitle('asaas')).toBe('Assinatura marcada pra conferir')
    expect(flagTitle('courtesy')).toBe('Cortesia marcada pra conferir')
    expect(flagStatusText({ status: 'active', cancelSource: null })).toBe('ativa')
    expect(flagStatusText({ status: 'canceled', cancelSource: 'unpaid' })).toBe('cancelada (falta de pagamento)')
    expect(flagStatusText({ status: 'canceled', cancelSource: null })).toBe('cancelada')
  })

  it('closeDialogText diz o que o servidor confere antes de fechar', () => {
    const refund: Target = { action: 'refund_payment', paymentId: 'pay_1', subscriptionRef: 'ref-1' }
    expect(closeDialogText({ kind: 'action', email: 'ana@exemplo.com', outcome: 'done', action: refund })).toEqual({
      title: 'Já estornei no Asaas',
      confirmLabel: 'Marcar como feito',
      body: ['Conta: ana@exemplo.com.', 'Antes de fechar, o servidor confere no Asaas se a cobrança pay_1 está estornada.'],
    })
    expect(closeDialogText({ kind: 'action', email: null, outcome: 'canceled', action: refund }).title).toBe('Não vou estornar')
    const asaasCase: Target = { action: 'admin_review', paymentId: null, subscriptionRef: 'asaas:sub_9' }
    expect(closeDialogText({ kind: 'action', email: null, outcome: 'done', action: asaasCase }).body).toEqual([
      'Este caso não volta a aparecer depois de fechado.',
      'Antes de fechar, o servidor confere no Asaas se esta assinatura parou de cobrar.',
    ])
    const otherCase: Target = { ...asaasCase, subscriptionRef: 'conferencia:parcial:2026-11-16' }
    expect(closeDialogText({ kind: 'action', email: null, outcome: 'done', action: otherCase }).body).toEqual([
      'Este caso não volta a aparecer depois de fechado.',
    ])
    expect(closeDialogText({ kind: 'flag', email: null }).title).toBe('Conferir marcação')
  })

  it('closedText, retryActionText e retryEventText', () => {
    const refund: Target = { action: 'refund_payment', paymentId: 'pay_1', subscriptionRef: 'ref-1' }
    expect(closedText({ kind: 'flag', email: null })).toBe('Marcação conferida.')
    expect(closedText({ kind: 'action', email: null, outcome: 'done', action: refund })).toBe('Marcado como feito.')
    expect(closedText({ kind: 'action', email: null, outcome: 'canceled', action: refund })).toBe('Fechado sem estorno.')
    expect(closedText({ kind: 'action', email: null, outcome: 'done', action: { ...refund, action: 'admin_review' } })).toBe('Caso conferido.')
    expect(retryActionText({ status: 'done', lastError: null })).toEqual({ ok: true, text: 'O Asaas confirmou. A pendência foi fechada.' })
    expect(retryActionText({ status: 'pending', lastError: 'O Asaas não respondeu.' })).toEqual({
      ok: false,
      text: 'O Asaas ainda não confirmou. O Asaas não respondeu.',
    })
    expect(retryActionText({ status: 'pending', lastError: null })).toEqual({ ok: false, text: 'O Asaas ainda não confirmou.' })
    expect(retryActionText({})).toEqual({ ok: true, text: 'A pendência não está mais aberta.' })
    expect(retryEventText({ processed: true })).toEqual({ ok: true, text: 'Aviso processado.' })
    expect(retryEventText({ processed: false })).toEqual({ ok: false, text: 'O aviso falhou de novo e continua na lista.' })
  })

  it('updatedAtLabel mostra a hora de Brasília', () => {
    // 15:05 em UTC = 12:05 em Brasília.
    expect(updatedAtLabel('2026-11-16T15:05:00Z')).toBe('Atualizado às 12:05')
    expect(updatedAtLabel('2026-11-16T15:05:00.123456+00:00')).toBe('Atualizado às 12:05')
    expect(updatedAtLabel(null)).toBeNull()
    expect(updatedAtLabel('nao e data')).toBeNull()
  })

  it('isReviewQueue aceita a fila do servidor e recusa o que quebraria a tela', () => {
    const action = {
      id: 7,
      action: 'refund_payment',
      reason: 'estorno',
      autoRetry: false,
      attempts: 0,
      lastError: null,
      nextAttemptAt: '2026-11-16T12:00:00Z',
      createdAt: '2026-11-16T12:00:00Z',
      subscriptionRef: 'ref-1',
      asaasSubscriptionId: null,
      paymentId: 'pay_1',
      dueDate: '2026-11-10',
      amount: 29.9,
      userId: 'u1',
      email: 'ana@exemplo.com',
      planKey: 'essencial_mensal',
    }
    const flag = {
      subscriptionRef: 'ref-2',
      userId: null,
      email: null,
      planKey: 'pro_anual',
      kind: 'asaas',
      status: 'active',
      cancelSource: null,
      adminNote: null,
      updatedAt: '2026-11-16T14:00:00.123456+00:00',
    }
    const event = { id: 'evt_1&1', event: 'PAYMENT_CONFIRMED', status: 'exhausted', attempts: 5, lastError: null, receivedAt: '2026-11-15T10:00:00Z' }
    const ok = {
      actions: [action],
      flags: [flag],
      events: [event],
      counts: { manual: 3, auto: 0, total: 3 },
      generatedAt: '2026-11-16T15:05:00Z',
    }
    expect(isReviewQueue(ok)).toBe(true)
    expect(isReviewQueue({ ...ok, actions: [], flags: [], events: [] })).toBe(true)
    for (const bad of [
      null,
      [],
      'ok',
      { ...ok, actions: undefined },
      { ...ok, flags: 'nada' },
      { ...ok, events: [null] },
      { ...ok, counts: { manual: 1, auto: 0 } },
      { ...ok, counts: { manual: 1, auto: 0, total: -1 } },
      { ...ok, actions: [{ ...action, id: '7' }] },
      { ...ok, actions: [{ ...action, action: 3 }] },
      { ...ok, actions: [{ ...action, email: { nome: 'ana' } }] },
      { ...ok, actions: [{ ...action, autoRetry: 'sim' }] },
      { ...ok, actions: [{ ...action, amount: '29,90' }] },
      { ...ok, actions: [{ ...action, subscriptionRef: null }] },
      { ...ok, flags: [{ ...flag, adminNote: 42 }] },
      { ...ok, flags: [{ ...flag, updatedAt: null }] },
      { ...ok, flags: [{ ...flag, planKey: ['pro'] }] },
      { ...ok, events: [{ ...event, attempts: '5' }] },
      { ...ok, events: [{ ...event, id: 9 }] },
    ]) {
      expect(isReviewQueue(bad)).toBe(false)
    }
  })

  // Parte 3 (T13): a pendência de voltar pro preço cheio depois do primeiro mês com desconto.
  it('restore_full_price tem título e motivo em português, sem travessão', () => {
    const target: Target = { action: 'restore_full_price', paymentId: null, subscriptionRef: 'chk_1' }
    const texts = [
      actionTitle('restore_full_price'),
      reasonText('oferta_primeiro_mes'),
      ...Object.values(closeDialogText({ kind: 'action', email: 'ana@exemplo.com', outcome: 'done', action: target })).flat(),
      closedText({ kind: 'action', email: null, outcome: 'done', action: target }),
    ]
    expect(texts.slice(0, 2)).toEqual(['Voltar pro preço cheio no Asaas', 'Primeiro mês com desconto: a renovação volta pro preço cheio'])
    expect(closeDialogText({ kind: 'action', email: 'ana@exemplo.com', outcome: 'done', action: target })).toEqual({
      title: 'Já troquei no Asaas',
      confirmLabel: 'Marcar como feito',
      body: ['Conta: ana@exemplo.com.', 'Antes de fechar, o servidor confere no Asaas se a assinatura já está no preço cheio do plano.'],
    })
    expect(closedText({ kind: 'action', email: null, outcome: 'done', action: target })).toBe('Marcado como feito.')
    // nada técnico na tela: nem o código da ação nem o do motivo
    expect(texts.filter((t) => t.includes(TRAVESSAO) || t.includes('_'))).toEqual([])
  })

  it('nenhum texto tem travessão', () => {
    const all = [
      ...['refund_payment', 'admin_review', 'delete_future_payments', 'inactivate_subscription', 'delete_subscription'].map(actionTitle),
      ...[
        'estorno_recusado_pelo_asaas',
        'arrependimento_pedido_nao_e_a_primeira_assinatura',
        'rede_de_seguranca',
        'vencida',
        'estorno',
        'compra_duplicada',
        'duplicate',
      ].map(reasonText),
      eventTitle('X'),
      ...(['pending', 'failed', 'exhausted'] as const).map(eventStatusText),
      flagTitle('asaas'),
      flagTitle('courtesy'),
      updatedAtLabel('2026-11-16T15:05:00Z') ?? '',
    ]
    expect(all.filter((t) => t.includes(TRAVESSAO))).toEqual([])
  })
})
