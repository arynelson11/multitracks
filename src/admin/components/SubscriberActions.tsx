// Ações na ficha do assinante (T26): mudar plano, dar e encerrar cortesia, cancelar, bloquear e
// desbloquear e ajustar a cota do mês. Cada uma abre o ConfirmDialog com a frase do efeito no
// Asaas e no app antes do Confirmar; o pedido vai pelo adminPost e o servidor (T16) confere tudo
// de novo. Nada sai duas vezes: o diálogo fica ocupado (busy) com o pedido no ar, uma trava aqui
// segura um segundo envio, e o erro incerto (o servidor pode ter feito) segura o Confirmar até
// fechar e abrir de novo. Depois de cada resposta a ficha chega de novo (reload).
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Panel, Segmented, cx } from '../../components/ui'
import { ConfirmDialog } from './ConfirmDialog'
import { AdminApiError, adminPost } from '../lib/adminApi'
import {
  BILLING_CONTINUES,
  blockText,
  cancelText,
  changePlanText,
  courtesyLastDay,
  courtesyText,
  doneText,
  endCourtesyText,
  isFuture,
  lastDayOf,
  planRank,
  quotaText,
  unblockText,
  type AfterCourtesy,
  type PlanPrice,
} from '../lib/actionText'
import { planLabel } from '../lib/fmt'
import { brtTodayLocal, monthRange } from '../lib/period'
import type { SubscriberDetailData, SubscriptionRow } from '../lib/subscribersTypes'

const MSG_UNEXPECTED = 'Erro inesperado. Confira no Registro se a ação foi feita antes de tentar de novo.'
const MSG_PICK_PLAN = 'Escolha o plano novo.'
const MSG_PICK_COURTESY_PLAN = 'Escolha o plano da cortesia.'
// A mesma frase do servidor quando a duração falta.
const MSG_PICK_DAYS = 'Escolha por quantos dias vale a cortesia, ou Sem data.'
const MSG_DAYS_RANGE = 'Escreva um número de dias de 1 a 365.'
const MSG_PICK_WHEN = 'Escolha quando cancelar.'
const MSG_PICK_MODE = 'Escolha entre Zerar e Somar.'
const MSG_AMOUNT_RANGE = 'Escreva um número de separações de 1 a 500.'

// 16px (text-ps-md): abaixo disso o Safari do iPhone e do iPad amplia a tela ao focar o campo.
const CONTROL =
  'w-full min-h-ps-touch rounded-ps-md bg-ps-s2 px-3 text-ps-md text-ps-bone inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none disabled:opacity-35'
const NOTE_FIELD =
  'w-full min-h-[88px] px-3 py-2.5 rounded-ps-md bg-ps-s2 text-ps-bone text-ps-md inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none resize-y disabled:opacity-35'
const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const OK_TEXT = 'text-ps-base text-ps-bone break-words'

type Kind = 'change-plan' | 'grant-courtesy' | 'end-courtesy' | 'cancel' | 'block' | 'unblock' | 'quota'
type Open = { kind: Exclude<Kind, 'end-courtesy'> } | { kind: 'end-courtesy'; courtesy: SubscriptionRow }

type DaysChoice = '7' | '30' | '90' | 'other' | 'none'
type When = 'now' | 'period_end'
type Mode = 'reset' | 'add'
type Form = { plan: string; days: DaysChoice | null; otherDays: string; note: string; when: When | null; mode: Mode | null; amount: string }

const EMPTY_FORM: Form = { plan: '', days: null, otherDays: '', note: '', when: null, mode: null, amount: '' }

const DAYS_OPTIONS: { value: DaysChoice; label: string }[] = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'other', label: 'Outro' },
  { value: 'none', label: 'Sem data' },
]
const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: 'period_end', label: 'No fim do período' },
  { value: 'now', label: 'Agora' },
]
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'reset', label: 'Zerar' },
  { value: 'add', label: 'Somar' },
]

const TITLES: Record<Kind, string> = {
  'change-plan': 'Mudar o plano',
  'grant-courtesy': 'Dar cortesia',
  'end-courtesy': 'Encerrar cortesia',
  cancel: 'Cancelar a assinatura',
  block: 'Bloquear a conta',
  unblock: 'Desbloquear a conta',
  quota: 'Ajustar a cota do mês',
}

/** Número inteiro escrito de `min` a `max`, ou null. */
function intIn(text: string, min: number, max: number): number | null {
  const t = text.trim()
  if (!/^\d{1,4}$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}

/** Dias da cortesia: número, null (sem data) ou undefined (ainda sem escolha válida). */
function daysOf(form: Form): number | null | undefined {
  if (form.days === null) return undefined
  if (form.days === 'none') return null
  if (form.days === 'other') return intIn(form.otherDays, 1, 365) ?? undefined
  return Number(form.days)
}

// ── O estado da conta que decide os botões e as frases

type Account = {
  /** A paga ativa de início mais recente (a mesma escolha do servidor). */
  paid: SubscriptionRow | null
  /** Cortesias que ainda valem. */
  courtesies: SubscriptionRow[]
  /** Pagas canceladas ainda dentro do período pago. */
  graced: SubscriptionRow[]
}

function accountOf(detail: SubscriberDetailData, now: Date = new Date()): Account {
  const subs = detail.subscriptions
  const future = (at: string | null) => isFuture(at, now)
  const paid = subs
    .filter((s) => s.kind === 'asaas' && s.status === 'active')
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null
  return {
    paid,
    courtesies: subs.filter((s) => s.kind === 'courtesy' && s.status === 'active' && (s.accessUntil === null || future(s.accessUntil))),
    graced: subs.filter((s) => s.kind === 'asaas' && s.status === 'canceled' && future(s.accessUntil)),
  }
}

/** O plano que vale quando esta cortesia acabar: o de nível mais alto que sobra (empate: a paga). */
function afterCourtesy(ending: SubscriptionRow, account: Account): AfterCourtesy {
  const options: { rank: number; after: AfterCourtesy }[] = []
  if (account.paid) options.push({ rank: planRank(account.paid.planKey), after: { kind: 'paid', planKey: account.paid.planKey } })
  for (const c of account.courtesies) {
    if (c.id !== ending.id) options.push({ rank: planRank(c.planKey), after: { kind: 'courtesy', planKey: c.planKey } })
  }
  for (const g of account.graced) {
    const lastDay = lastDayOf(g.accessUntil)
    if (lastDay) options.push({ rank: planRank(g.planKey), after: { kind: 'paid_until', planKey: g.planKey, lastDay } })
  }
  // sort é estável: no empate fica a primeira (paga ativa, depois cortesia, depois paga no período).
  options.sort((a, b) => b.rank - a.rank)
  return options[0]?.after ?? { kind: 'free' }
}

function priceOf(detail: SubscriberDetailData, key: string): PlanPrice {
  const p = detail.plans.find((x) => x.key === key)
  return p ? { label: p.label, value: p.value, cycle: p.cycle } : { label: planLabel(key), value: null, cycle: null }
}

// ── O pedido de cada ação

type Request = { ok: true; action: string; body: Record<string, unknown> } | { ok: false; message: string }

const fail = (message: string): Request => ({ ok: false, message })

function requestOf(open: Open, form: Form, note: string, userId: string): Request {
  switch (open.kind) {
    case 'change-plan':
      return form.plan ? { ok: true, action: 'change-plan', body: { userId, planKey: form.plan } } : fail(MSG_PICK_PLAN)
    case 'grant-courtesy': {
      if (!form.plan) return fail(MSG_PICK_COURTESY_PLAN)
      const days = daysOf(form)
      if (days === undefined) return fail(form.days === 'other' ? MSG_DAYS_RANGE : MSG_PICK_DAYS)
      const text = form.note.trim()
      const body: Record<string, unknown> = { userId, planKey: form.plan, days }
      if (text) body.note = text
      return { ok: true, action: 'grant-courtesy', body }
    }
    case 'end-courtesy':
      return { ok: true, action: 'end-courtesy', body: { userId, courtesyId: open.courtesy.id } }
    case 'cancel':
      return form.when ? { ok: true, action: 'cancel-subscription', body: { userId, when: form.when } } : fail(MSG_PICK_WHEN)
    case 'block':
      return { ok: true, action: 'block', body: { userId, reason: note } }
    case 'unblock':
      return { ok: true, action: 'unblock', body: { userId } }
    case 'quota': {
      if (!form.mode) return fail(MSG_PICK_MODE)
      if (form.mode === 'reset') return { ok: true, action: 'adjust-quota', body: { userId, mode: 'reset' } }
      const amount = intIn(form.amount, 1, 500)
      return amount === null ? fail(MSG_AMOUNT_RANGE) : { ok: true, action: 'adjust-quota', body: { userId, mode: 'add', amount } }
    }
  }
}

function confirmLabelOf(open: Open, form: Form): string {
  if (open.kind === 'cancel') {
    if (form.when === 'now') return 'Cancelar assinatura agora'
    return form.when === 'period_end' ? 'Cancelar no fim do período' : 'Cancelar assinatura'
  }
  if (open.kind === 'quota') {
    if (form.mode === 'reset') return 'Zerar contador'
    return form.mode === 'add' ? 'Somar separações' : 'Ajustar cota'
  }
  const labels: Record<Exclude<Kind, 'cancel' | 'quota'>, string> = {
    'change-plan': 'Mudar plano',
    'grant-courtesy': 'Dar cortesia',
    'end-courtesy': 'Encerrar cortesia',
    block: 'Bloquear',
    unblock: 'Desbloquear',
  }
  return labels[open.kind]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

type Notice = { tone: 'ok' | 'alert'; text: string }

export function SubscriberActions({ detail, reload }: { detail: SubscriberDetailData; reload: () => void }) {
  const titleId = useId()
  const [current, setCurrent] = useState<Open | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AdminApiError | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Trava do envio: mesmo que o Confirmar chame duas vezes, só um pedido sai por vez.
  const sending = useRef(false)

  const { profile, quota } = detail
  const account = accountOf(detail)
  const { paid, courtesies } = account
  const blocked = profile.blockedAt !== null
  const hasLimit = typeof quota.limit === 'number'

  const openDialog = (open: Open) => {
    if (sending.current) return
    setForm(EMPTY_FORM)
    setError(null)
    setNotice(null)
    setCurrent(open)
  }

  const closeDialog = () => {
    if (busy) return
    setCurrent(null)
    setError(null)
  }

  const confirm = async (note: string) => {
    if (!current || sending.current) return
    const req = requestOf(current, form, note, profile.userId)
    // Escolha que falta ou número fora da faixa: nada sai. Erro novo a cada vez, pra o diálogo soltar.
    if (!req.ok) {
      setError(new AdminApiError(req.message, 0))
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const out = await adminPost<unknown>(req.action, req.body)
      setCurrent(null)
      setNotice({ tone: 'ok', text: doneText(req.action, out) })
    } catch (e) {
      const err = e instanceof AdminApiError ? e : new AdminApiError(MSG_UNEXPECTED, 0, true)
      // O próprio AdminApiError vai pro diálogo: com o incerto, Confirmar fica segurado.
      setError(err)
      // O incerto fica na ficha depois de fechar o diálogo, pra conferir antes de repetir.
      if (err.uncertain) setNotice({ tone: 'alert', text: err.message })
    } finally {
      sending.current = false
      setBusy(false)
    }
    // A ficha, o registro dela, a lista e a fila de Pendências chegam de novo: a ação (ou a
    // marcação que o servidor fez no erro) muda o que a tela mostra.
    reload()
  }

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }))
    // Mudou a escolha: a frase de escolha que faltava some.
    if (error && error.status === 0 && !error.uncertain) setError(null)
  }

  const buttons: ReactNode[] = []
  const add = (key: string, label: string, open: Open) =>
    buttons.push(
      <Button key={key} onClick={() => openDialog(open)} className="max-w-full">
        <span className="min-w-0 whitespace-normal text-center">{label}</span>
      </Button>,
    )
  if (paid) add('change-plan', 'Mudar plano', { kind: 'change-plan' })
  add('grant-courtesy', 'Dar cortesia', { kind: 'grant-courtesy' })
  for (const c of courtesies) {
    add(`end-${c.id}`, courtesies.length > 1 ? `Encerrar cortesia de ${planLabel(c.planKey)}` : 'Encerrar cortesia', { kind: 'end-courtesy', courtesy: c })
  }
  if (paid) add('cancel', 'Cancelar assinatura', { kind: 'cancel' })
  if (!profile.isAdmin) {
    if (blocked) add('unblock', 'Desbloquear', { kind: 'unblock' })
    else add('block', 'Bloquear', { kind: 'block' })
  }
  if (hasLimit) add('quota', 'Ajustar cota', { kind: 'quota' })

  let dialog: ReactNode = null
  if (current) {
    const tone = current.kind === 'block' || (current.kind === 'cancel' && form.when === 'now') ? 'alert' : 'primary'
    dialog = (
      <ConfirmDialog
        open
        title={TITLES[current.kind]}
        confirmLabel={confirmLabelOf(current, form)}
        tone={tone}
        note={current.kind === 'block' ? { label: 'Motivo', required: true, minLength: 3, maxLength: 300 } : undefined}
        busy={busy}
        error={error}
        onConfirm={(note) => void confirm(note)}
        onCancel={closeDialog}
      >
        <DialogBody open={current} form={form} set={set} busy={busy} detail={detail} account={account} />
      </ConfirmDialog>
    )
  }

  return (
    <section aria-labelledby={titleId}>
      <Panel className="flex flex-col gap-3 p-4">
        <h3 id={titleId} className="text-ps-md font-bold text-ps-bone">
          Ações
        </h3>
        <p className="text-ps-sm text-ps-mut">Cada ação pede confirmação, diz o que muda no Asaas e fica no Registro.</p>
        <div className="flex flex-wrap gap-2">{buttons}</div>
        <div role="status">{notice && <p className={notice.tone === 'ok' ? OK_TEXT : ALERT_BOX}>{notice.text}</p>}</div>
      </Panel>
      {dialog}
    </section>
  )
}

type BodyProps = {
  open: Open
  form: Form
  set: (patch: Partial<Form>) => void
  busy: boolean
  detail: SubscriberDetailData
  account: Account
}

/** O que vai acontecer, ou o que ainda falta escolher pra saber. */
function Effect({ text, hint }: { text: string | null; hint?: string }) {
  if (text) return <p className="text-ps-base text-ps-bone break-words">{text}</p>
  return hint ? <p className="text-ps-base text-ps-mut break-words">{hint}</p> : null
}

function Group({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="ps-label">
          {label}
        </label>
      ) : (
        <span aria-hidden="true" className="ps-label">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

function PlanSelect({ id, value, keys, busy, onChange }: { id: string; value: string; keys: string[]; busy: boolean; onChange: (v: string) => void }) {
  return (
    <select
      id={id}
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      // scheme-dark: a lista nativa das opções abre escura também no Windows e no Linux.
      className={cx(CONTROL, 'scheme-dark')}
    >
      <option value="" disabled>
        Escolha o plano
      </option>
      {keys.map((key) => (
        <option key={key} value={key}>
          {planLabel(key)}
        </option>
      ))}
    </select>
  )
}

function NumberField({ id, value, busy, onChange }: { id: string; value: string; busy: boolean; onChange: (v: string) => void }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      className={cx(CONTROL, 'ps-num')}
    />
  )
}

const withBusy = <T extends string>(options: { value: T; label: string }[], busy: boolean) =>
  options.map((o) => ({ ...o, disabled: busy }))

function DialogBody({ open, form, set, busy, detail, account }: BodyProps) {
  const planId = useId()
  const daysId = useId()
  const noteId = useId()
  const amountId = useId()
  const { paid } = account

  switch (open.kind) {
    case 'change-plan': {
      if (!paid) return null
      const others = detail.plans.map((p) => p.key).filter((key) => key !== paid.planKey)
      return (
        <div className="flex flex-col gap-3">
          <Group label="Plano novo" htmlFor={planId}>
            <PlanSelect id={planId} value={form.plan} keys={others} busy={busy} onChange={(plan) => set({ plan })} />
          </Group>
          <Effect
            text={form.plan ? changePlanText(priceOf(detail, paid.planKey), priceOf(detail, form.plan), paid.nextDueDate) : null}
            hint="Escolha o plano novo pra ver o efeito."
          />
        </div>
      )
    }
    case 'grant-courtesy': {
      const days = daysOf(form)
      const text =
        form.plan && days !== undefined ? courtesyText(form.plan, days === null ? null : courtesyLastDay(days), paid?.planKey ?? null) : null
      return (
        <div className="flex flex-col gap-3">
          <Group label="Plano da cortesia" htmlFor={planId}>
            <PlanSelect id={planId} value={form.plan} keys={detail.plans.map((p) => p.key)} busy={busy} onChange={(plan) => set({ plan })} />
          </Group>
          <Group label="Por quanto tempo">
            <Segmented
              aria-label="Por quanto tempo"
              options={withBusy(DAYS_OPTIONS, busy)}
              value={form.days}
              onChange={(d) => set({ days: d })}
              className="flex-wrap"
            />
          </Group>
          {form.days === 'other' && (
            <Group label="Quantos dias (1 a 365)" htmlFor={daysId}>
              <NumberField id={daysId} value={form.otherDays} busy={busy} onChange={(otherDays) => set({ otherDays })} />
            </Group>
          )}
          <Effect text={text} hint="Escolha o plano e por quanto tempo pra ver o efeito." />
          <Group label="Nota (opcional)" htmlFor={noteId}>
            <textarea
              id={noteId}
              rows={2}
              maxLength={300}
              value={form.note}
              disabled={busy}
              onChange={(e) => set({ note: e.target.value })}
              className={NOTE_FIELD}
            />
          </Group>
        </div>
      )
    }
    case 'end-courtesy':
      return <Effect text={endCourtesyText(open.courtesy.planKey, afterCourtesy(open.courtesy, account))} />
    case 'cancel': {
      if (!paid) return null
      const lastPaidDay = isFuture(paid.paidUntil) ? lastDayOf(paid.paidUntil) : null
      return (
        <div className="flex flex-col gap-3">
          <Group label="Quando">
            <Segmented
              aria-label="Quando cancelar"
              options={withBusy(WHEN_OPTIONS, busy)}
              value={form.when}
              onChange={(when) => set({ when })}
              className="flex-wrap"
            />
          </Group>
          <Effect text={form.when ? cancelText(form.when, paid.planKey, lastPaidDay) : null} hint="Escolha quando cancelar pra ver o efeito." />
        </div>
      )
    }
    case 'block':
      // O bloqueio não mexe na cobrança (D10): o aviso fica em âmbar antes do Confirmar.
      return (
        <div className="flex flex-col gap-3">
          <Effect text={blockText(false)} />
          {paid && <p className={ALERT_BOX}>{BILLING_CONTINUES}</p>}
        </div>
      )
    case 'unblock':
      return <Effect text={unblockText()} />
    case 'quota': {
      const lastDay = monthRange(brtTodayLocal(), 0).to
      const used = num(detail.quota.used)
      const limit = num(detail.quota.limit)
      const bonus = num(detail.quota.bonus)
      const amount = intIn(form.amount, 1, 500)
      let text: string | null = null
      if (form.mode === 'reset') text = quotaText('reset', used, limit, bonus, null, lastDay)
      else if (form.mode === 'add' && amount !== null) text = quotaText('add', used, limit, bonus, amount, lastDay)
      return (
        <div className="flex flex-col gap-3">
          <Group label="Ajuste">
            <Segmented aria-label="Ajuste" options={withBusy(MODE_OPTIONS, busy)} value={form.mode} onChange={(mode) => set({ mode })} />
          </Group>
          {form.mode === 'add' && (
            <Group label="Quantas separações (1 a 500)" htmlFor={amountId}>
              <NumberField id={amountId} value={form.amount} busy={busy} onChange={(v) => set({ amount: v })} />
            </Group>
          )}
          <Effect text={text} hint={form.mode === 'add' ? 'Escreva quantas separações somar pra ver o efeito.' : 'Escolha entre Zerar e Somar pra ver o efeito.'} />
        </div>
      )
    }
  }
}
