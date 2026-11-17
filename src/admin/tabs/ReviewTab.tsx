// Aba Pendências: o que precisa do dono (ações manuais, marcações e avisos esgotados) e o que a
// cobrança está tentando sozinha (ações automáticas e avisos que falharam).
// * Fechar à mão ("Já estornei", "Já removi", "Não vou estornar", "Conferido") abre o
//   ConfirmDialog com nota. O erro do servidor (inclusive o 409 de quando o Asaas não confirma)
//   aparece dentro do diálogo, sempre como o próprio AdminApiError, com busy ligado durante o
//   pedido (Ruling ADM-T4-incerto).
// * "Tentar agora" e "Tentar de novo" não têm diálogo: a trava contra repetir e o segurar da
//   resposta incerta ficam fora do componente e sobrevivem à troca de aba (Ruling ADM-T8-trava).
// * Toda ação que deu certo, e todo erro certo, recarrega a fila. O último erro já chega do
//   servidor em frase pronta. Resposta fora do formato mostra a frase pronta (Ruling ADM-T7-forma).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Led, Panel, cx } from '../../components/ui'
import { openExternalUrlLater } from '../../lib/desktop'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { AdminQueryState } from '../hooks/useAdminQuery'
import { AdminApiError, adminGet, adminPost } from '../lib/adminApi'
import { EMPTY, fmtBRL, fmtDateTimeBR, fmtDay, planLabel } from '../lib/fmt'
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
  type CloseTarget,
  type ResultText,
} from '../lib/reviewText'
import type { ReviewAction, ReviewEvent, ReviewFlag, ReviewQueue } from '../lib/reviewTypes'
import type { Navigate, TabProps } from '../lib/tabs'

const RULE = 'Antes de estornar à mão, confira no Asaas se a cobrança já não está estornada.'
const MSG_CHANGED = 'A marcação mudou desde que você abriu. Atualize a lista.'
// Erro que não veio do adminPost: não dá pra saber se a ação saiu, então vale como incerto.
const MSG_UNEXPECTED_ACTION = 'Erro inesperado. Confira no Registro se a ação foi feita antes de tentar de novo.'
const MSG_NO_INVOICE = 'O Asaas não mandou o link da fatura. Busque a cobrança pelo id no painel do Asaas.'
const MSG_INVOICE_FAILED = 'Não deu pra abrir a fatura. Tente de novo.'
const MSG_TAB_BLOCKED = 'O navegador bloqueou a aba nova. Libere as janelas deste site e clique de novo.'
const MSG_BAD_SHAPE = 'Não deu pra carregar as pendências. Tente de novo.'

const SPINNER = <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const OK_TEXT = 'text-ps-base text-ps-bone break-words'

type ActionItem = { kind: 'action'; key: string; title: string; data: ReviewAction }
type FlagItem = { kind: 'flag'; key: string; title: string; data: ReviewFlag }
type EventItem = { kind: 'event'; key: string; title: string; data: ReviewEvent }
type Item = ActionItem | FlagItem | EventItem

/** Fechamento à mão aberto no diálogo. */
type Pending = { item: ActionItem; outcome: 'done' | 'canceled' } | { item: FlagItem; outcome: 'resolve' }

type Feedback = { tone: 'ok' | 'alert'; text: string; label: string }

type RetryActionResult = { status?: unknown; attempts?: unknown; lastError?: unknown }
type RetryEventResult = { processed?: unknown; result?: unknown }
type PaymentLink = { invoiceUrl?: unknown }

const actionItem = (a: ReviewAction): ActionItem => ({ kind: 'action', key: `acao:${a.id}`, title: actionTitle(a.action), data: a })
const flagItem = (f: ReviewFlag): FlagItem => ({ kind: 'flag', key: `marcacao:${f.subscriptionRef}`, title: flagTitle(f.kind), data: f })
const eventItem = (e: ReviewEvent): EventItem => ({ kind: 'event', key: `aviso:${e.id}`, title: eventTitle(e.event), data: e })

/** Mesma divisão do `counts` do servidor: manual = precisa de você; auto = tentando sozinho. */
function splitQueue(q: ReviewQueue): { mine: Item[]; auto: Item[] } {
  return {
    mine: [
      ...q.actions.filter((a) => !a.autoRetry).map(actionItem),
      ...q.flags.map(flagItem),
      ...q.events.filter((e) => e.status === 'exhausted').map(eventItem),
    ],
    auto: [...q.actions.filter((a) => a.autoRetry).map(actionItem), ...q.events.filter((e) => e.status !== 'exhausted').map(eventItem)],
  }
}

/** Nome do item pra mensagem que sobra depois de ele sair da lista. */
function labelOf(item: Item): string {
  const email = item.kind === 'event' ? null : item.data.email
  return email ? `${item.title} (${email})` : item.title
}

/** O alvo do diálogo, pros textos de reviewText. */
function targetOf(p: Pending): CloseTarget {
  if (p.outcome === 'resolve') return { kind: 'flag', email: p.item.data.email }
  return { kind: 'action', email: p.item.data.email, outcome: p.outcome, action: p.item.data }
}

const toFeedback = (r: ResultText): Pick<Feedback, 'tone' | 'text'> => ({ tone: r.ok ? 'ok' : 'alert', text: r.text })

// ── Memória que sobrevive à troca de aba e a fechar e abrir o admin (Ruling ADM-T8-trava e a
// rodada 2 da T8). A casca desmonta a aba na troca de aba, e fechar o admin desmonta a casca
// inteira (a fila nova vem com outro refetch). Por isso a trava dos botões sem diálogo, o segurar
// e o resultado de cada ação ficam numa memória só, aqui no módulo, com chave fixa por botão e
// por id da pendência ou do aviso (nunca pelo refetch). Nada trava pra sempre: o pedido no ar solta
// quando responde (o adminPost tem teto de 35 s), e o segurado solta na primeira fila boa que chega
// depois da resposta (o Atualizar, a volta pra aba ou a abertura do admin trazem uma).

/** running: pedido no ar. Respondido: segura até chegar outra fila boa; `uncertain` = a resposta não chegou. */
type Lock = { running: true } | { running: false; seen: unknown; uncertain: boolean }
type Shared = { locks: Readonly<Record<string, Lock>>; feedback: Readonly<Record<string, Feedback>> }

const memory: {
  state: Shared
  /** A última fila boa que uma aba montada viu: o segurado espera outra. */
  lastQueue: unknown
  /** O refetch da casca aberta agora, pra recarregar quando a resposta chegar (null com o admin fechado). */
  reload: (() => Promise<void>) | null
  listeners: Set<() => void>
} = { state: { locks: {}, feedback: {} }, lastQueue: null, reload: null, listeners: new Set() }

function listen(listener: () => void): () => void {
  memory.listeners.add(listener)
  return () => {
    memory.listeners.delete(listener)
  }
}

const snapshot = () => memory.state

function change(next: (s: Shared) => Shared): void {
  const s = next(memory.state)
  if (s === memory.state) return
  memory.state = s
  memory.listeners.forEach((l) => l())
}

function without<T>(rec: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!Object.hasOwn(rec, key)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

const isLocked = (lock: Lock | undefined, queue: unknown) => lock !== undefined && (lock.running || lock.seen === queue)

// Chave da trava: "<botão>:<item>", e o item é "acao:<id>" ou "aviso:<id>".
const itemOfLock = (lockKey: string) => lockKey.slice(lockKey.indexOf(':') + 1)

/** Chegou uma fila boa: guarda como a última vista e solta o que esperava outra fila. */
function seeQueue(queue: ReviewQueue): void {
  memory.lastQueue = queue
  change((s) => {
    const kept = Object.entries(s.locks).filter(([, l]) => l.running || l.seen === queue)
    return kept.length === Object.keys(s.locks).length ? s : { ...s, locks: Object.fromEntries(kept) }
  })
}

/**
 * A aba saiu da tela: as frases vão embora, menos as dos botões com pedido no ar ou segurados por
 * resposta incerta (a resposta que chegar, ou a frase do Registro, aparecem na volta).
 */
function leaveTab(): void {
  change((s) => {
    const keep = new Set(
      Object.entries(s.locks)
        .filter(([, l]) => l.running || l.uncertain)
        .map(([key]) => itemOfLock(key)),
    )
    const feedback = Object.fromEntries(Object.entries(s.feedback).filter(([key]) => keep.has(key)))
    return Object.keys(feedback).length === Object.keys(s.feedback).length ? s : { ...s, feedback }
  })
}

/**
 * Depois da resposta: 'reload' recarrega a fila e segura até ela chegar (deu certo ou erro certo);
 * 'hold' só segura (incerto: a pessoa confere no Registro e atualiza); 'free' solta na hora.
 */
type After = 'reload' | 'hold' | 'free'

/**
 * Roda a ação com a trava por botão. A conferência é síncrona, na memória do módulo: dois cliques
 * no mesmo instante, um clique depois de voltar pra aba ou de abrir o admin de novo com o pedido no
 * ar, não saem duas vezes. A tarefa começa ainda dentro do clique (antes do primeiro await).
 */
async function runLocked(key: string, task: () => Promise<After>): Promise<void> {
  if (isLocked(memory.state.locks[key], memory.lastQueue)) return
  change((s) => ({ ...s, locks: { ...s.locks, [key]: { running: true } } }))
  let after: After = 'hold'
  try {
    after = await task()
  } finally {
    change((s) => ({
      ...s,
      locks:
        after === 'free'
          ? without(s.locks, key)
          : { ...s.locks, [key]: { running: false, seen: memory.lastQueue, uncertain: after === 'hold' } },
    }))
    if (after === 'reload') void memory.reload?.()
  }
}

const tryKeyOf = (itemKey: string) => `tentar:${itemKey}`
const tryKey = (item: Item) => tryKeyOf(item.key)
const invoiceKey = (item: Item) => `fatura:${item.key}`

export function ReviewTab({ onNavigate, review }: TabProps & { review: AdminQueryState<ReviewQueue> }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<AdminApiError | null>(null)

  const { refetch } = review
  const shared = useSyncExternalStore(listen, snapshot)
  // Resposta fora do formato vale como erro: frase pronta e Tentar de novo, nunca o render quebrado.
  const data = isReviewQueue(review.data) ? review.data : null
  useEffect(() => {
    if (data) seeQueue(data)
  }, [data])
  // A casca aberta agora é quem recarrega quando uma resposta chegar.
  useEffect(() => {
    memory.reload = refetch
    return () => {
      if (memory.reload === refetch) memory.reload = null
      leaveTab()
    }
  }, [refetch])

  // Ações de outras abas (a ficha do assinante) também mudam a fila: voltar pra cá com a lista
  // já na mão recarrega. Na primeira abertura a casca já está pedindo.
  const enteredWithList = useRef(review.data !== null)
  useEffect(() => {
    if (enteredWithList.current) void refetch()
  }, [refetch])

  const locked = (key: string) => isLocked(shared.locks[key], data)
  const running = (key: string) => shared.locks[key]?.running === true

  const say = (item: Item, f: Pick<Feedback, 'tone' | 'text'>) =>
    change((s) => ({ ...s, feedback: { ...s.feedback, [item.key]: { ...f, label: labelOf(item) } } }))
  const forget = (key: string) => change((s) => ({ ...s, feedback: without(s.feedback, key) }))

  const refresh = () => {
    // A frase de uma resposta incerta fica enquanto o botão estiver segurado.
    change((s) => ({
      ...s,
      feedback: Object.fromEntries(Object.entries(s.feedback).filter(([key]) => isLocked(s.locks[tryKeyOf(key)], data))),
    }))
    void refetch()
  }

  const openDialog = (p: Pending) => {
    forget(p.item.key)
    setDialogError(null)
    setPending(p)
  }

  const closeDialog = () => {
    if (busy) return
    setPending(null)
    setDialogError(null)
  }

  const confirm = async (note: string) => {
    const p = pending
    if (!p) return
    setBusy(true)
    setDialogError(null)
    try {
      if (p.outcome === 'resolve') {
        const f = p.item.data
        const r = await adminPost<{ result?: unknown }>('resolve-flag', {
          subscriptionRef: f.subscriptionRef,
          note,
          seenNote: f.adminNote,
          seenAt: f.updatedAt,
        })
        // "changed" não é erro: chegou marcação nova enquanto a lista estava aberta e nada mudou.
        say(p.item, r?.result === 'changed' ? { tone: 'alert', text: MSG_CHANGED } : { tone: 'ok', text: closedText(targetOf(p)) })
      } else {
        await adminPost('close-action', { actionId: p.item.data.id, outcome: p.outcome, note })
        say(p.item, { tone: 'ok', text: closedText(targetOf(p)) })
      }
      setPending(null)
      void refetch()
    } catch (e) {
      const error = e instanceof AdminApiError ? e : new AdminApiError(MSG_UNEXPECTED_ACTION, 0, true)
      setDialogError(error)
      // Erro certo: nada foi feito, mas a lista pode estar velha (outra aba ou a conferência fechou).
      if (!error.uncertain) void refetch()
    } finally {
      setBusy(false)
    }
  }

  const retry = (item: ActionItem | EventItem) =>
    runLocked(tryKey(item), async () => {
      forget(item.key)
      try {
        if (item.kind === 'action') {
          const r = await adminPost<RetryActionResult>('retry-action', { actionId: item.data.id })
          say(item, toFeedback(retryActionText(r ?? {})))
        } else {
          const r = await adminPost<RetryEventResult>('retry-event', { eventId: item.data.id })
          say(item, toFeedback(retryEventText(r ?? {})))
        }
        return 'reload'
      } catch (e) {
        const known = e instanceof AdminApiError
        say(item, { tone: 'alert', text: known ? e.message : MSG_UNEXPECTED_ACTION })
        // Incerto: a ação pode ter sido feita. Segura até a lista ser recarregada, sem recarregar sozinho.
        return known && !e.uncertain ? 'reload' : 'hold'
      }
    })

  const openInvoice = (item: ActionItem) => {
    const id = item.data.paymentId
    if (!id) return
    return runLocked(invoiceKey(item), async () => {
      // A aba abre aqui, ainda dentro do clique (Ruling ADM-T8-aba); o endereço chega depois do pedido.
      const tab = openExternalUrlLater()
      forget(item.key)
      try {
        const r = await adminGet<PaymentLink>('payment-link', { id })
        const url = r?.invoiceUrl
        if (typeof url === 'string' && url.startsWith('https://')) {
          if (!tab.go(url)) say(item, { tone: 'alert', text: MSG_TAB_BLOCKED })
        } else {
          tab.cancel()
          say(item, { tone: 'alert', text: MSG_NO_INVOICE })
        }
      } catch (e) {
        tab.cancel()
        say(item, { tone: 'alert', text: e instanceof AdminApiError ? e.message : MSG_INVOICE_FAILED })
      }
      return 'free'
    })
  }

  const copyId = async (item: ActionItem) => {
    const id = item.data.paymentId
    if (!id) return
    forget(item.key)
    try {
      await navigator.clipboard.writeText(id)
      say(item, { tone: 'ok', text: 'Id copiado.' })
    } catch {
      say(item, { tone: 'alert', text: `Não deu pra copiar. O id é ${id}.` })
    }
  }

  const groups = data ? splitQueue(data) : null
  const shownKeys = new Set(groups ? [...groups.mine, ...groups.auto].map((i) => i.key) : [])
  // Resultado de um item que já saiu da lista (fechou): aparece no topo.
  const gone = Object.entries(shared.feedback).filter(([key]) => !shownKeys.has(key))
  const updated = updatedAtLabel(data?.generatedAt ?? null)
  // A lista de avisos vem com no máximo 100; o counts conta todos.
  const allEvents = data ? Math.max(0, data.counts.total - data.actions.length - data.flags.length) : 0

  const buttonsFor = (item: Item, main: boolean): React.ReactNode => {
    const tryButton = (label: string, target: ActionItem | EventItem) => (
      <Button
        tone={main ? 'primary' : 'default'}
        onClick={() => void retry(target)}
        disabled={locked(tryKey(item))}
        icon={running(tryKey(item)) ? SPINNER : undefined}
      >
        {label}
      </Button>
    )
    if (item.kind === 'flag') {
      return (
        <Button tone="primary" onClick={() => openDialog({ item, outcome: 'resolve' })}>
          Conferido
        </Button>
      )
    }
    if (item.kind === 'event') return tryButton('Tentar de novo', item)
    const a = item.data
    // Só o que a cobrança tenta sozinha aceita "Tentar agora" (o servidor recusa o resto).
    const tryNow = a.autoRetry ? tryButton('Tentar agora', item) : null
    if (a.action === 'refund_payment') {
      return (
        <>
          {a.paymentId && (
            <>
              <Button
                onClick={() => void openInvoice(item)}
                disabled={locked(invoiceKey(item))}
                icon={running(invoiceKey(item)) ? SPINNER : undefined}
              >
                Ver no Asaas
              </Button>
              <Button onClick={() => void copyId(item)}>Copiar id</Button>
            </>
          )}
          <Button tone={main ? 'primary' : 'default'} onClick={() => openDialog({ item, outcome: 'done' })}>
            Já estornei no Asaas
          </Button>
          <Button onClick={() => openDialog({ item, outcome: 'canceled' })}>Não vou estornar</Button>
        </>
      )
    }
    if (a.action === 'admin_review') {
      return (
        <Button tone={main ? 'primary' : 'default'} onClick={() => openDialog({ item, outcome: 'done' })}>
          Conferido
        </Button>
      )
    }
    if (a.action === 'delete_future_payments') {
      return (
        <>
          <Button tone={main ? 'primary' : 'default'} onClick={() => openDialog({ item, outcome: 'done' })}>
            Já removi no Asaas
          </Button>
          {tryNow}
        </>
      )
    }
    return tryNow
  }

  const renderItem = (item: Item, main: boolean) => (
    <ItemCard
      title={item.title}
      feedback={shared.feedback[item.key] ?? null}
      notes={item.kind === 'flag' ? noteLines(item.data.adminNote) : []}
      buttons={buttonsFor(item, main)}
    >
      {item.kind === 'action' && <ActionFields a={item.data} onNavigate={onNavigate} />}
      {item.kind === 'flag' && <FlagFields f={item.data} onNavigate={onNavigate} />}
      {item.kind === 'event' && <EventFields e={item.data} />}
    </ItemCard>
  )

  let body: React.ReactNode
  if (!data || !groups) {
    const stillLoading = review.loading || (review.data === null && !review.error)
    body = stillLoading ? (
      <p role="status" className="text-ps-base text-ps-mut">
        Carregando...
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-ps-gap">
        <p role="alert" className="text-ps-base text-ps-alert break-words">
          {review.error ?? MSG_BAD_SHAPE}
        </p>
        <Button onClick={() => void refetch()}>Tentar de novo</Button>
      </div>
    )
  } else if (groups.mine.length === 0 && groups.auto.length === 0) {
    body = <p className="text-ps-md text-ps-bone">Nada pendente agora.</p>
  } else {
    body = (
      <>
        <Group
          title="Precisa de você"
          alert
          items={groups.mine}
          empty="Nada precisa de você agora."
          render={(i) => renderItem(i, true)}
        />
        <Group
          title="Tentando sozinho"
          items={groups.auto}
          empty="Nada tentando sozinho agora."
          render={(i) => renderItem(i, false)}
        />
      </>
    )
  }

  const copy = pending ? closeDialogText(targetOf(pending)) : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {updated && <p className="text-ps-base text-ps-mut">{updated}</p>}
          <Button
            className="ml-auto"
            onClick={refresh}
            disabled={review.loading}
            icon={<RefreshCw size={16} className={review.loading ? 'animate-spin motion-reduce:animate-none' : undefined} />}
          >
            Atualizar
          </Button>
        </div>
        <p className="text-ps-base text-ps-mut">{RULE}</p>
        {data && data.events.length < allEvents && (
          <p className="text-ps-sm text-ps-mut">
            Mostrando os {data.events.length} avisos mais novos de {allEvents}.
          </p>
        )}
      </div>

      {data && review.error && (
        <p role="alert" className={ALERT_BOX}>
          {review.error}
        </p>
      )}

      {gone.length > 0 && (
        <ul aria-label="Resultado das ações" className="flex flex-col gap-2">
          {gone.map(([key, f]) => (
            <li key={key} className={f.tone === 'ok' ? OK_TEXT : ALERT_BOX}>
              {f.label}: {f.text}
            </li>
          ))}
        </ul>
      )}

      {body}

      {pending && copy && (
        <ConfirmDialog
          key={`${pending.item.key}:${pending.outcome}`}
          open
          title={copy.title}
          confirmLabel={copy.confirmLabel}
          note={{ label: 'Nota', required: true, minLength: 3 }}
          busy={busy}
          error={dialogError}
          onConfirm={(note) => void confirm(note)}
          onCancel={closeDialog}
        >
          {copy.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </ConfirmDialog>
      )}
    </div>
  )
}

function Group({
  title,
  alert = false,
  items,
  empty,
  render,
}: {
  title: string
  alert?: boolean
  items: Item[]
  empty: string
  render: (item: Item) => React.ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {alert && items.length > 0 && <Led state="alert" />}
        <h2 id={id} className="text-ps-md font-bold text-ps-bone">
          {title}
        </h2>
        <span className="ps-num text-ps-base text-ps-mut">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-ps-base text-ps-mut">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.key}>{render(item)}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ItemCard({
  title,
  notes,
  buttons,
  feedback,
  children,
}: {
  title: string
  notes: string[]
  buttons: React.ReactNode
  feedback: Feedback | null
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <article aria-labelledby={id}>
      <Panel className="flex flex-col gap-3 p-4">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone break-words">
          {title}
        </h3>
        <dl className="flex flex-col gap-1.5 text-ps-base">{children}</dl>
        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 border-l-2 border-ps-line-2 pl-3">
            {notes.map((line, i) => (
              <li key={i} className="text-ps-base text-ps-bone break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
        {/* Sem gap aqui: a região de aviso fica sempre na página (pro leitor de tela anunciar) e,
            vazia, não ocupa espaço. */}
        <div className="flex flex-col">
          {buttons != null && <div className="flex flex-wrap gap-2">{buttons}</div>}
          <div role="status">{feedback && <p className={cx('mt-2', feedback.tone === 'ok' ? OK_TEXT : ALERT_BOX)}>{feedback.text}</p>}</div>
        </div>
      </Panel>
    </article>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-ps-mut">{label}</dt>
      <dd className="min-w-0 max-w-full text-ps-bone break-words">{children}</dd>
    </div>
  )
}

const ACCOUNT_LINK =
  'inline-flex max-w-full min-h-ps-touch items-center rounded-ps-sm text-left text-ps-base text-ps-bone underline underline-offset-2 decoration-ps-line-3 break-all hover:text-ps-or focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/** E-mail da conta; com conta ligada, abre a ficha em Assinantes. */
function Account({ userId, email, onNavigate }: { userId: string | null; email: string | null; onNavigate: Navigate }) {
  if (!userId || !email) return <>{email ?? EMPTY}</>
  return (
    <button type="button" className={ACCOUNT_LINK} onClick={() => onNavigate('subscribers', { userId })}>
      {email}
    </button>
  )
}

function ActionFields({ a, onNavigate }: { a: ReviewAction; onNavigate: Navigate }) {
  return (
    <>
      <Field label="Conta">
        <Account userId={a.userId} email={a.email} onNavigate={onNavigate} />
      </Field>
      {a.planKey && <Field label="Plano">{planLabel(a.planKey)}</Field>}
      {a.amount !== null && (
        <Field label="Valor">
          <span className="ps-num">{fmtBRL(a.amount)}</span>
        </Field>
      )}
      {a.dueDate && (
        <Field label="Vencimento">
          <span className="ps-num">{fmtDay(a.dueDate)}</span>
        </Field>
      )}
      {a.paymentId && (
        <Field label="Cobrança">
          <span className="ps-num break-all">{a.paymentId}</span>
        </Field>
      )}
      <Field label="Motivo">{reasonText(a.reason)}</Field>
      <Field label="Aberta em">
        <span className="ps-num">{fmtDateTimeBR(a.createdAt)}</span>
      </Field>
      {a.autoRetry && (
        <>
          <Field label="Tentativas">
            <span className="ps-num">{a.attempts}</span>
          </Field>
          <Field label="Último erro">{a.lastError ?? EMPTY}</Field>
          <Field label="Próxima tentativa">
            <span className="ps-num">{fmtDateTimeBR(a.nextAttemptAt)}</span>
          </Field>
        </>
      )}
    </>
  )
}

function FlagFields({ f, onNavigate }: { f: ReviewFlag; onNavigate: Navigate }) {
  return (
    <>
      <Field label="Conta">
        <Account userId={f.userId} email={f.email} onNavigate={onNavigate} />
      </Field>
      <Field label="Plano">{planLabel(f.planKey)}</Field>
      <Field label="Situação">{flagStatusText(f)}</Field>
    </>
  )
}

function EventFields({ e }: { e: ReviewEvent }) {
  return (
    <>
      <Field label="Situação">{eventStatusText(e.status)}</Field>
      <Field label="Recebido em">
        <span className="ps-num">{fmtDateTimeBR(e.receivedAt)}</span>
      </Field>
      <Field label="Tentativas">
        <span className="ps-num">{e.attempts}</span>
      </Field>
      <Field label="Último erro">{e.lastError ?? EMPTY}</Field>
    </>
  )
}
