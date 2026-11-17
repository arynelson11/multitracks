// Textos da aba Pendências: nome de cada pendência, motivo em português, linhas da nota da
// marcação, o título dos avisos do Asaas que falharam, o texto dos diálogos, o resultado
// de cada ação e a conferência da forma da fila que chega do servidor.
import { EMPTY, cancelSourceLabel, fmtDateTimeBR } from './fmt'
import type { ReviewAction, ReviewEvent, ReviewFlag, ReviewQueue } from './reviewTypes'

const ACTION_TITLES: Record<string, string> = {
  refund_payment: 'Estornar à mão',
  admin_review: 'Caso pra olhar',
  delete_future_payments: 'Remover cobrança futura',
  inactivate_subscription: 'Inativar assinatura no Asaas',
  delete_subscription: 'Remover assinatura no Asaas',
}

// Motivos que a cobrança grava. `compra_duplicada` fica só como legado: desde a COB-I7-v2 a
// compra repetida vira marcação, não pendência.
const REASONS: Record<string, string> = {
  estorno_recusado_pelo_asaas: 'O Asaas recusou o estorno automático do arrependimento',
  arrependimento_pedido_nao_e_a_primeira_assinatura: 'Arrependimento pedido numa assinatura que não é a primeira da conta',
  rede_de_seguranca: 'Renovação passou do vencimento sem aviso do Asaas',
  vencida: 'Renovação vencida',
  estorno: 'Estorno feito no painel',
  compra_duplicada: 'Compra repetida do mesmo plano',
}

// Valores de cancel_source: a parada da assinatura no Asaas guarda por que ela foi cancelada.
const CANCEL_SOURCES = new Set(['user', 'user_refund', 'unpaid', 'refund', 'asaas', 'superseded', 'duplicate', 'admin', 'account_deleted'])

const EVENT_STATUS: Record<ReviewEvent['status'], string> = {
  pending: 'Ainda não processado',
  failed: 'Falhou, tenta de novo sozinho',
  exhausted: 'Parou de tentar sozinho',
}

const FLAG_TITLES: Record<ReviewFlag['kind'], string> = {
  asaas: 'Assinatura marcada pra conferir',
  courtesy: 'Cortesia marcada pra conferir',
}

// Só chave própria do mapa: um motivo como "constructor" não pode cair em nome herdado de objeto.
const own = (map: Record<string, string>, key: string): string | null => (Object.hasOwn(map, key) ? map[key] : null)

/** Nome da pendência; uma ação nova da cobrança aparece com espaço no lugar do sublinhado. */
export function actionTitle(action: string): string {
  return own(ACTION_TITLES, action) ?? action.replace(/_/g, ' ')
}

/**
 * Motivo da pendência em português. Um código desconhecido (sem espaço) troca sublinhado por
 * espaço; texto livre (a conferência diária escreve frases com ids do Asaas, como sub_123)
 * passa como veio, pra o id continuar dando pra buscar no painel do Asaas.
 */
export function reasonText(reason: string | null): string {
  if (!reason) return EMPTY
  const known = own(REASONS, reason)
  if (known) return known
  if (CANCEL_SOURCES.has(reason)) return cancelSourceLabel(reason)
  return /\s/.test(reason) ? reason : reason.replace(/_/g, ' ')
}

/** A nota da marcação junta um aviso por vez com ` | `: cada aviso vira uma linha. */
export function noteLines(adminNote: string | null): string[] {
  if (!adminNote) return []
  return adminNote
    .split(' | ')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function eventTitle(event: string): string {
  return `Aviso do Asaas que falhou: ${event || EMPTY}`
}

export function eventStatusText(status: ReviewEvent['status']): string {
  return EVENT_STATUS[status] ?? status
}

export function flagTitle(kind: ReviewFlag['kind']): string {
  return FLAG_TITLES[kind] ?? 'Marcação pra conferir'
}

/** Situação da assinatura marcada: ativa, ou cancelada e por quê. */
export function flagStatusText(flag: Pick<ReviewFlag, 'status' | 'cancelSource'>): string {
  if (flag.status === 'active') return 'ativa'
  return flag.cancelSource ? `cancelada (${cancelSourceLabel(flag.cancelSource)})` : 'cancelada'
}

// ── Fechar à mão (diálogo) e o resultado de cada ação

/** O que o diálogo fecha: uma marcação (Conferido) ou uma pendência, feita ou descartada. */
export type CloseTarget =
  | { kind: 'flag'; email: string | null }
  | {
      kind: 'action'
      email: string | null
      outcome: 'done' | 'canceled'
      action: Pick<ReviewAction, 'action' | 'paymentId' | 'subscriptionRef'>
    }

export type DialogText = { title: string; confirmLabel: string; body: string[] }

/** Título, botão e texto do diálogo. Diz o que o servidor confere no Asaas antes de fechar. */
export function closeDialogText(t: CloseTarget): DialogText {
  const who = t.email ? [`Conta: ${t.email}.`] : []
  if (t.kind === 'flag') {
    return { title: 'Conferir marcação', confirmLabel: 'Conferido', body: [...who, 'A marcação sai da lista e a nota fica no Registro.'] }
  }
  const a = t.action
  if (a.action === 'refund_payment' && t.outcome === 'canceled') {
    return {
      title: 'Não vou estornar',
      confirmLabel: 'Fechar sem estorno',
      body: [...who, 'A pendência fecha sem estorno e a nota fica no Registro.'],
    }
  }
  if (a.action === 'refund_payment') {
    const payment = a.paymentId ? `a cobrança ${a.paymentId}` : 'a cobrança'
    return {
      title: 'Já estornei no Asaas',
      confirmLabel: 'Marcar como feito',
      body: [...who, `Antes de fechar, o servidor confere no Asaas se ${payment} está estornada.`],
    }
  }
  if (a.action === 'admin_review') {
    // Caso da conferência diária (asaas:<id>): só fecha se o Asaas já não cobra (D8).
    const asaasCase = a.subscriptionRef.startsWith('asaas:')
      ? ['Antes de fechar, o servidor confere no Asaas se esta assinatura parou de cobrar.']
      : []
    return {
      title: 'Conferir caso',
      confirmLabel: 'Conferido',
      body: [...who, 'Este caso não volta a aparecer depois de fechado.', ...asaasCase],
    }
  }
  if (a.action === 'delete_future_payments') {
    return {
      title: 'Já removi no Asaas',
      confirmLabel: 'Marcar como feito',
      body: [...who, 'Antes de fechar, o servidor confere no Asaas se não sobrou cobrança futura em aberto.'],
    }
  }
  return { title: actionTitle(a.action), confirmLabel: 'Marcar como feito', body: who }
}

/** Resultado de um fechamento que deu certo. */
export function closedText(t: CloseTarget): string {
  if (t.kind === 'flag') return 'Marcação conferida.'
  if (t.outcome === 'canceled') return 'Fechado sem estorno.'
  return t.action.action === 'admin_review' ? 'Caso conferido.' : 'Marcado como feito.'
}

export type ResultText = { ok: boolean; text: string }

/** Resposta do retry-action ({ status, attempts, lastError }, com o último erro já em frase pronta). */
export function retryActionText(r: { status?: unknown; lastError?: unknown }): ResultText {
  if (r.status === 'done') return { ok: true, text: 'O Asaas confirmou. A pendência foi fechada.' }
  if (r.status === 'pending') {
    const last = typeof r.lastError === 'string' && r.lastError ? ` ${r.lastError}` : ''
    return { ok: false, text: `O Asaas ainda não confirmou.${last}` }
  }
  return { ok: true, text: 'A pendência não está mais aberta.' }
}

/** Resposta do retry-event ({ processed, result }). */
export function retryEventText(r: { processed?: unknown }): ResultText {
  return r.processed === true
    ? { ok: true, text: 'Aviso processado.' }
    : { ok: false, text: 'O aviso falhou de novo e continua na lista.' }
}

/** "Atualizado às hh:mm" (Brasília) da hora em que o servidor montou a fila. */
export function updatedAtLabel(iso: string | null): string | null {
  const when = fmtDateTimeBR(iso)
  return when === EMPTY ? null : `Atualizado às ${when.slice(-5)}`
}

// ── Forma da fila (como a T7 no Registro, Ruling ADM-T7-forma): só desenha o que tem a forma que
// a tela usa. Um campo de texto que viesse como objeto derrubaria o render ("Objects are not
// valid as a React child"), e um texto que não é texto quebraria o split da nota.

type Check = (v: unknown) => boolean

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText: Check = (v) => typeof v === 'string'
const isTextOrNull: Check = (v) => v === null || typeof v === 'string'
const isNum: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull: Check = (v) => v === null || isNum(v)
const isCount: Check = (v) => isNum(v) && (v as number) >= 0

function hasShape(v: unknown, shape: Record<string, Check>): boolean {
  return isObj(v) && Object.entries(shape).every(([key, check]) => check(v[key]))
}

const ACTION_SHAPE: Record<string, Check> = {
  id: (v) => Number.isSafeInteger(v),
  action: isText,
  reason: isTextOrNull,
  autoRetry: (v) => typeof v === 'boolean',
  attempts: isCount,
  lastError: isTextOrNull,
  nextAttemptAt: isTextOrNull,
  createdAt: isTextOrNull,
  subscriptionRef: isText,
  asaasSubscriptionId: isTextOrNull,
  paymentId: isTextOrNull,
  dueDate: isTextOrNull,
  amount: isNumOrNull,
  userId: isTextOrNull,
  email: isTextOrNull,
  planKey: isTextOrNull,
}

const FLAG_SHAPE: Record<string, Check> = {
  subscriptionRef: isText,
  userId: isTextOrNull,
  email: isTextOrNull,
  planKey: isTextOrNull,
  kind: isText,
  status: isText,
  cancelSource: isTextOrNull,
  adminNote: isTextOrNull,
  // Vai de volta no Conferido como a versão vista (seenAt, obrigatório no servidor).
  updatedAt: isText,
}

const EVENT_SHAPE: Record<string, Check> = {
  id: isText,
  event: isText,
  status: isText,
  attempts: isCount,
  lastError: isTextOrNull,
  receivedAt: isTextOrNull,
}

const listOf = (v: unknown, shape: Record<string, Check>) => Array.isArray(v) && v.every((item) => hasShape(item, shape))

/** A resposta de `?action=review` tem a forma que a aba desenha. Fora dela, a aba mostra a frase pronta. */
export function isReviewQueue(v: unknown): v is ReviewQueue {
  return (
    isObj(v) &&
    listOf(v.actions, ACTION_SHAPE) &&
    listOf(v.flags, FLAG_SHAPE) &&
    listOf(v.events, EVENT_SHAPE) &&
    hasShape(v.counts, { manual: isCount, auto: isCount, total: isCount }) &&
    isTextOrNull(v.generatedAt)
  )
}
