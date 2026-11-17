// Ficha de um assinante, só de leitura: a conta, as assinaturas, o que o Asaas diz agora (com as
// diferenças em âmbar), as pendências, o uso e o custo, os pagamentos e as últimas ações do admin
// nesta conta. Painel lateral a partir de 1024 px e tela cheia abaixo. As ações (T26) entram no
// topo pela renderActions, que só recebe a ficha desta conta e nunca uma resposta fora do formato
// (Ruling ADM-T7-forma).
import { useCallback, useEffect, useId, useRef } from 'react'
import type React from 'react'
import type { ReactNode } from 'react'
import { Button, Panel, cx } from '../../components/ui'
import { useAdminQuery, type AdminQueryState } from '../hooks/useAdminQuery'
import { actionLabel, displayResult, entryMessage, type ResultTone } from '../lib/auditText'
import { isAuditPage, type AuditEntry, type AuditPage } from '../lib/auditTypes'
import { EMPTY, cancelSourceLabel, fmtBRL, fmtDateTimeBR, fmtDay, paymentStatusLabel, planLabel } from '../lib/fmt'
import { actionTitle, noteLines, reasonText } from '../lib/reviewText'
import type { ReviewAction } from '../lib/reviewTypes'
import {
  asaasStatusLabel,
  cycleLabel,
  jobsWithoutCostText,
  providerLabel,
  quotaText,
  subscriptionStatusText,
  subscriptionTitle,
} from '../lib/subscriberText'
import {
  isSubscriberDetailData,
  type AsaasLive,
  type LegacyPayment,
  type RenderActions,
  type SubscriberDetailData,
  type SubscriberPayment,
  type SubscriptionRow,
} from '../lib/subscribersTypes'
import type { Navigate } from '../lib/tabs'

const MSG_BAD_SHAPE = 'Não deu pra carregar a ficha. Tente de novo.'
const MSG_AUDIT_BAD_SHAPE = 'Não deu pra carregar o registro desta conta. Tente de novo.'
const MSG_ASAAS_FAILED = 'Não deu pra consultar o Asaas agora.'
// Quantas ações do admin a ficha mostra (a página do Registro traz 50).
const AUDIT_SHOWN = 10

const WELL = 'flex flex-col gap-2 rounded-ps-md bg-ps-well p-3 inset-ring inset-ring-ps-line'
const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const EMPTY_TEXT = 'text-ps-base text-ps-mut'
// O que pode receber foco dentro da ficha (inclusive o que as ações põem no topo).
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

const TAG_TONES: Record<ResultTone, string> = {
  on: 'bg-ps-or-soft text-ps-or',
  alert: 'bg-ps-alert-soft text-ps-alert',
  neutral: 'bg-ps-s2 text-ps-mut',
}

/** Etiqueta curta de estado: laranja = ligado, âmbar = precisa de você, neutra pro resto. */
export function Tag({ tone, children }: { tone: ResultTone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-ps-md px-2 py-0.5 text-ps-sm font-bold whitespace-nowrap', TAG_TONES[tone])}>
      {children}
    </span>
  )
}

/** Frase pronta do erro com o botão de tentar de novo. */
export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-ps-gap">
      <p role="alert" className="min-w-0 text-ps-base text-ps-alert break-words">
        {message}
      </p>
      <Button onClick={onRetry}>Tentar de novo</Button>
    </div>
  )
}

type SubscriberDetailProps = {
  userId: string
  onClose: () => void
  onNavigate: Navigate
  renderActions?: RenderActions
}

export function SubscriberDetail({ userId, onClose, onNavigate, renderActions }: SubscriberDetailProps) {
  const query = useAdminQuery<SubscriberDetailData>('subscriber', { userId })
  const audit = useAdminQuery<AuditPage>('audit', { page: 1, userId })
  const refetchDetail = query.refetch
  const refetchAudit = audit.refetch
  // Só a ficha desta conta: resposta fora do formato, ou de outra conta, vale como erro e nunca
  // chega às ações.
  const detail = isSubscriberDetailData(query.data) && query.data.profile.userId === userId ? query.data : null
  // Depois de uma ação: a ficha e o registro dela chegam de novo.
  const reload = useCallback(() => {
    void refetchDetail()
    void refetchAudit()
  }, [refetchDetail, refetchAudit])
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Abre com o foco na ficha e, ao fechar, devolve o foco a quem abriu.
  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  // Esc fecha e o Tab não sai da ficha. Um diálogo de ação aberto por cima segura as teclas dele.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof HTMLElement) || !items.includes(active)
      if (e.shiftKey ? active === first || outside : active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
  }

  const profile = detail?.profile
  const title = profile ? profile.name || profile.email || profile.userId : 'Ficha do assinante'
  const subtitle = profile?.name && profile.email ? profile.email : null

  let body: ReactNode
  if (!detail) {
    body = query.loading ? (
      <p role="status" className={EMPTY_TEXT}>
        Carregando...
      </p>
    ) : (
      <ErrorBox message={query.error ?? MSG_BAD_SHAPE} onRetry={() => void refetchDetail()} />
    )
  } else {
    body = (
      <>
        {query.error && <ErrorBox message={query.error} onRetry={() => void refetchDetail()} />}
        {renderActions?.(detail, reload)}
        <AccountSection detail={detail} />
        <SubscriptionsSection subscriptions={detail.subscriptions} />
        <AsaasSection detail={detail} />
        <OpenActionsSection detail={detail} onNavigate={onNavigate} />
        <UsageSection detail={detail} />
        <PaymentsSection payments={detail.payments} legacy={detail.legacyPayments} />
        <AuditSection audit={audit} />
      </>
    )
  }

  return (
    // Fora do painel (a partir de 1024 px sobra o fundo) um clique fecha a ficha.
    <div
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[80] flex justify-end bg-black/70"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={query.loading || undefined}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-y-auto bg-ps-ink font-ps-sans text-ps-bone outline-none lg:max-w-[560px] lg:border-l lg:border-ps-line-2 lg:shadow-ps-pop"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ps-line bg-ps-ink px-ps-gutter py-2">
          <div className="flex min-w-0 flex-col gap-0.5 py-2.5">
            <h2 id={titleId} className="text-ps-md font-bold text-ps-bone break-words">
              {title}
            </h2>
            {subtitle && <p className="text-ps-sm text-ps-mut break-all">{subtitle}</p>}
          </div>
          <Button tone="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
        <div className="flex flex-col gap-4 px-ps-gutter py-4">{body}</div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <Panel className="flex flex-col gap-3 p-4">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone">
          {title}
        </h3>
        {children}
      </Panel>
    </section>
  )
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">{children}</dl>
}

function Field({ label, value, num, breakAll }: { label: string; value: string; num?: boolean; breakAll?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="ps-label">{label}</dt>
      <dd className={cx('text-ps-base text-ps-bone', num && 'ps-num', breakAll ? 'break-all' : 'break-words')}>{value}</dd>
    </div>
  )
}

const countText = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : EMPTY)

function AccountSection({ detail }: { detail: SubscriberDetailData }) {
  const p = detail.profile
  return (
    <Section title="Conta">
      <Fields>
        <Field label="Cadastro" value={fmtDay(p.createdAt)} num />
        <Field label="Último acesso" value={fmtDateTimeBR(p.lastSeenAt)} num />
        <Field label="Último login" value={fmtDateTimeBR(p.lastSignInAt)} num />
        <Field label="Entra com" value={providerLabel(p.provider)} />
        <Field label="Plano no app" value={p.planExpiresAt ? `${planLabel(p.plan)}, até ${fmtDay(p.planExpiresAt)}` : planLabel(p.plan)} />
        {p.isAdmin && <Field label="Papel" value="Admin" />}
        <Field label="Bloqueio" value={p.blockedAt ? `Bloqueada desde ${fmtDateTimeBR(p.blockedAt)}` : 'Não bloqueada'} />
        {p.blockedAt && <Field label="Motivo do bloqueio" value={p.blockedReason || EMPTY} />}
        <Field label="Id da conta" value={p.userId} num breakAll />
      </Fields>
    </Section>
  )
}

function SubscriptionsSection({ subscriptions }: { subscriptions: SubscriptionRow[] }) {
  return (
    <Section title="Assinaturas">
      {subscriptions.length === 0 ? (
        <p className={EMPTY_TEXT}>Nenhuma assinatura.</p>
      ) : (
        <ul className="flex flex-col gap-ps-gap">
          {subscriptions.map((s) => (
            <SubscriptionItem key={s.id} s={s} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function SubscriptionItem({ s }: { s: SubscriptionRow }) {
  const paid = s.kind === 'asaas'
  return (
    <li className={WELL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-ps-base font-bold text-ps-bone break-words">{subscriptionTitle(s)}</p>
        <Tag tone={s.status === 'active' ? 'on' : 'neutral'}>{subscriptionStatusText(s)}</Tag>
      </div>
      <Fields>
        {paid && <Field label="Ciclo" value={cycleLabel(s.cycle)} />}
        <Field label="Início" value={fmtDay(s.startedAt)} num />
        {paid && s.status === 'active' && <Field label="Próxima cobrança" value={fmtDay(s.nextDueDate)} num />}
        {paid && <Field label="Pago até" value={fmtDay(s.paidUntil)} num />}
        {(s.accessUntil || !paid) && <Field label="Acesso até" value={s.accessUntil ? fmtDay(s.accessUntil) : 'sem data para acabar'} num />}
        {s.status === 'canceled' && <Field label="Encerrada em" value={fmtDateTimeBR(s.canceledAt)} num />}
        {s.status === 'canceled' && <Field label="Motivo" value={cancelSourceLabel(s.cancelSource)} />}
        {s.asaasSubscriptionId && <Field label="Id no Asaas" value={s.asaasSubscriptionId} num breakAll />}
      </Fields>
      {s.needsAdminReview ? (
        <div className="flex flex-col gap-1 rounded-ps-md bg-ps-alert-soft px-3 py-2.5">
          <p className="text-ps-base font-bold text-ps-alert">Para conferir</p>
          {noteLines(s.adminNote).map((line, i) => (
            <p key={i} className="text-ps-sm text-ps-bone break-words">
              {line}
            </p>
          ))}
        </div>
      ) : (
        s.adminNote && <p className="text-ps-sm text-ps-mut break-words">{`Nota: ${s.adminNote}`}</p>
      )}
    </li>
  )
}

function AsaasSection({ detail }: { detail: SubscriberDetailData }) {
  const { asaasLive, mismatches, subscriptions } = detail
  return (
    <Section title="No Asaas agora">
      {mismatches.length > 0 && (
        // A variação do Panel já traz o anel neutro: o ! garante o âmbar por cima dele.
        <Panel className="flex flex-col gap-2 p-3 inset-ring-ps-alert-line!">
          <h4 className="text-ps-base font-bold text-ps-alert">Diferença entre o app e o Asaas</h4>
          <ul className="flex flex-col gap-1">
            {mismatches.map((line, i) => (
              <li key={i} className="text-ps-base text-ps-bone break-words">
                {line}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {asaasLive.length === 0 ? (
        <p className={EMPTY_TEXT}>Nenhuma assinatura pra consultar no Asaas.</p>
      ) : (
        <ul className="flex flex-col gap-ps-gap">
          {asaasLive.map((live, i) => (
            <AsaasItem key={`${live.subscriptionRef}-${i}`} live={live} subscription={subscriptions.find((s) => s.id === live.subscriptionRef)} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function AsaasItem({ live, subscription }: { live: AsaasLive; subscription: SubscriptionRow | undefined }) {
  return (
    <li className={WELL}>
      <p className="text-ps-base font-bold text-ps-bone break-all">{subscription ? subscriptionTitle(subscription) : live.subscriptionRef}</p>
      {live.ok === true ? (
        <Fields>
          <Field label="Status" value={asaasStatusLabel(live)} />
          <Field label="Valor" value={fmtBRL(live.value)} num />
          <Field label="Ciclo" value={cycleLabel(live.cycle)} />
          <Field label="Cobrança em aberto vence" value={fmtDay(live.openDueDate)} num />
        </Fields>
      ) : (
        <p className={ALERT_BOX}>{live.error || MSG_ASAAS_FAILED}</p>
      )}
    </li>
  )
}

function OpenActionsSection({ detail, onNavigate }: { detail: SubscriberDetailData; onNavigate: Navigate }) {
  const actions = detail.openActions
  // A marcação "para conferir" de uma assinatura também mora em Pendências.
  const flagged = detail.subscriptions.some((s) => s.needsAdminReview)
  return (
    <Section title="Pendências desta conta">
      {actions.length === 0 ? (
        <p className={EMPTY_TEXT}>Nenhuma pendência aberta desta conta.</p>
      ) : (
        <ul className="flex flex-col gap-ps-gap">
          {actions.map((a) => (
            <OpenActionItem key={a.id} a={a} />
          ))}
        </ul>
      )}
      {(actions.length > 0 || flagged) && (
        <Button className="self-start" onClick={() => onNavigate('review')}>
          Abrir Pendências
        </Button>
      )}
    </Section>
  )
}

function OpenActionItem({ a }: { a: ReviewAction }) {
  return (
    <li className={WELL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-ps-base font-bold text-ps-bone break-words">{actionTitle(a.action)}</p>
        <Tag tone={a.autoRetry ? 'neutral' : 'alert'}>{a.autoRetry ? 'Tentando sozinha' : 'Precisa de você'}</Tag>
      </div>
      <p className="text-ps-sm text-ps-bone break-words">{reasonText(a.reason)}</p>
      {a.paymentId && (
        <p className="ps-num text-ps-sm text-ps-mut break-all">
          {a.amount === null ? `Cobrança ${a.paymentId}` : `Cobrança ${a.paymentId}, ${fmtBRL(a.amount)}`}
        </p>
      )}
      <p className="ps-num text-ps-sm text-ps-mut">{`Aberta em ${fmtDateTimeBR(a.createdAt)}`}</p>
      {a.lastError && <p className="text-ps-sm text-ps-alert break-words">{a.lastError}</p>}
    </li>
  )
}

function UsageSection({ detail }: { detail: SubscriberDetailData }) {
  const { separations, quota, aiCost } = detail
  const withoutCost = jobsWithoutCostText(aiCost.jobsWithoutCost)
  return (
    <Section title="Uso e custo">
      <Fields>
        <Field label="Separações no mês" value={countText(separations.month)} num />
        <Field label="Separações no total" value={countText(separations.total)} num />
        <Field label="Cota do mês" value={quotaText(quota)} num />
        <Field label="Renova em" value={fmtDay(quota.resetsAt)} num />
        <Field label="Custo de IA no mês" value={fmtBRL(aiCost.monthBrl)} num />
        <Field label="Custo de IA no total" value={fmtBRL(aiCost.totalBrl)} num />
      </Fields>
      {withoutCost && <p className="text-ps-sm text-ps-mut">{withoutCost}</p>}
    </Section>
  )
}

function PaymentsSection({ payments, legacy }: { payments: SubscriberPayment[]; legacy: LegacyPayment[] }) {
  return (
    <Section title="Pagamentos">
      {payments.length === 0 && legacy.length === 0 && <p className={EMPTY_TEXT}>Nenhum pagamento registrado.</p>}
      {payments.length > 0 && (
        <ul className="flex flex-col gap-ps-gap">
          {payments.map((p) => (
            <PaymentItem key={p.paymentId} p={p} />
          ))}
        </ul>
      )}
      {legacy.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-ps-sm font-bold text-ps-mut">Pagamentos de antes do registro de assinaturas</h4>
          <ul className="flex flex-col gap-ps-gap">
            {legacy.map((l) => (
              <li key={l.id} className={WELL}>
                <p className="text-ps-base font-bold text-ps-bone break-words">{planLabel(l.planKey)}</p>
                <Fields>
                  <Field label="Valor" value={fmtBRL(l.value)} num />
                  <Field label="Ciclo" value={cycleLabel(l.cycle)} />
                  <Field label="Pago em" value={fmtDay(l.paidAt)} num />
                </Fields>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

function PaymentItem({ p }: { p: SubscriberPayment }) {
  const overdue = p.status === 'OVERDUE'
  return (
    <li className={WELL}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={cx('text-ps-base font-bold', overdue ? 'text-ps-alert' : 'text-ps-bone')}>{paymentStatusLabel(p.status)}</span>
        <span className="ps-num min-w-0 text-ps-sm text-ps-mut break-all">{p.paymentId}</span>
      </div>
      <Fields>
        <Field label="Valor" value={fmtBRL(p.value)} num />
        <Field label="Líquido" value={fmtBRL(p.netValue)} num />
        <Field label="Vencimento" value={fmtDay(p.dueDate)} num />
        {/* Data de pagamento: a de confirmação, senão a de pagamento (regra comum C). */}
        <Field label="Pagamento" value={fmtDay(p.confirmedDate ?? p.paymentDate)} num />
        {p.refundedAt && <Field label="Estornada em" value={fmtDay(p.refundedAt)} num />}
      </Fields>
    </li>
  )
}

function AuditSection({ audit }: { audit: AdminQueryState<AuditPage> }) {
  const data = isAuditPage(audit.data) ? audit.data : null
  const retry = () => void audit.refetch()
  let content: ReactNode
  if (!data) {
    content = audit.loading ? (
      <p role="status" className={EMPTY_TEXT}>
        Carregando...
      </p>
    ) : (
      <ErrorBox message={audit.error ?? MSG_AUDIT_BAD_SHAPE} onRetry={retry} />
    )
  } else {
    content = (
      <>
        {audit.error && <ErrorBox message={audit.error} onRetry={retry} />}
        {data.rows.length === 0 ? (
          <p className={EMPTY_TEXT}>Nenhuma ação do admin nesta conta.</p>
        ) : (
          <ul className="flex flex-col gap-ps-gap">
            {data.rows.slice(0, AUDIT_SHOWN).map((entry) => (
              <AuditItem key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
        {data.total > AUDIT_SHOWN && <p className="text-ps-sm text-ps-mut">{`Mostrando as ${AUDIT_SHOWN} mais novas de ${data.total}.`}</p>}
      </>
    )
  }
  return <Section title="Registro desta conta">{content}</Section>
}

function AuditItem({ entry }: { entry: AuditEntry }) {
  const result = displayResult(entry)
  const message = entryMessage(entry)
  return (
    <li className={WELL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-ps-base font-bold text-ps-bone break-words">{actionLabel(entry.action)}</p>
        <Tag tone={result.tone}>{result.label}</Tag>
      </div>
      <p className="flex flex-wrap gap-x-2 text-ps-sm text-ps-mut">
        <span className="ps-num">{fmtDateTimeBR(entry.createdAt)}</span>
        <span className="break-all">{`por ${entry.adminEmail}`}</span>
      </p>
      {message && <p className="text-ps-sm text-ps-bone break-words">{message}</p>}
      {entry.note && <p className="text-ps-sm text-ps-mut break-words">{`Nota: ${entry.note}`}</p>}
    </li>
  )
}
