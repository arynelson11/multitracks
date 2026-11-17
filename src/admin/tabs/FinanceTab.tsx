// Aba Financeiro: as cobranças de um período em dias de Brasília, com o valor pago real, os
// totais, a receita por mês (12 meses até o fim do período, separada por plano), as vencidas
// ("No vermelho") e, em cada cobrança, a fatura no Asaas e o id pra buscar no painel. Nenhum
// caminho estorna: o estorno é feito no painel do Asaas (FATOS). Valor que falta aparece como
// `sem dado`, nunca como zero.
import { Fragment, useId, useRef, useState } from 'react'
import type React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Panel, Segmented, cx, type SegmentedOption } from '../../components/ui'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { EMPTY, fmtBRL, fmtDay, paymentStatusLabel, planLabel } from '../lib/fmt'
import { copyPaymentId, openPaymentInvoice, type PaymentFeedback } from '../lib/invoiceLink'
import { brtTodayLocal } from '../lib/period'
import {
  barWidths,
  fmtCount,
  isFinancePage,
  monthLabel,
  paidDay,
  periodRange,
  planEntries,
  type FinanceMonth,
  type FinanceOverdue,
  type FinancePage,
  type FinancePeriod,
  type FinanceRow,
  type FinanceStatus,
  type FinanceTotals,
} from '../lib/financeTypes'
import type { Navigate, TabProps } from '../lib/tabs'

// Teto de página do servidor (?action=finance aceita de 1 a 1000).
const MAX_PAGE = 1000
const RULE = 'Estorno é feito no painel do Asaas. Antes de estornar, confira se a cobrança já não está estornada.'
const MSG_BAD_SHAPE = 'Não deu pra carregar o financeiro. Tente de novo.'

const PERIODS: SegmentedOption<FinancePeriod>[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'last_12', label: 'Últimos 12 meses' },
]

const STATUSES: SegmentedOption<FinanceStatus>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'paid', label: 'Pagas' },
  { value: 'pending', label: 'Em aberto' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'refunded', label: 'Estornadas' },
  { value: 'deleted', label: 'Removidas' },
]

const SPINNER = <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const OK_TEXT = 'text-ps-base text-ps-bone break-words'
const H2 = 'text-ps-md font-bold text-ps-bone'
const ACCOUNT_LINK =
  'inline-flex max-w-full min-h-ps-touch items-center rounded-ps-sm text-left text-ps-base text-ps-bone underline underline-offset-2 decoration-ps-line-3 break-all hover:text-ps-or focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

type View = { period: FinancePeriod; status: FinanceStatus; page: number }

export function FinanceTab({ onNavigate }: TabProps) {
  const [view, setView] = useState<View>({ period: 'month', status: 'all', page: 1 })
  const rowsHeading = useId()
  // Hoje em Brasília: 23:30 do dia 30 ainda é o dia 30, mesmo já sendo dia 1º em UTC.
  const { from, to } = periodRange(view.period, brtTodayLocal())
  // O servidor exige as duas datas juntas: sozinha, a outra sairia do mês atual.
  const query = useAdminQuery<FinancePage>('finance', { from, to, status: view.status, page: view.page })
  const { loading, error, refetch } = query
  // Resposta fora do formato (servidor antigo, corpo de outra ação) vale como erro, nunca quebra o render.
  const data = isFinancePage(query.data) ? query.data : null
  // De qual filtro é o dado na tela. Enquanto o filtro novo carrega, o hook ainda devolve o dado do
  // anterior: um total de outro período parece certo e está errado, então ele some até o novo chegar.
  // No Atualizar (mesmo filtro) o dado fica, apagado.
  const key = `${from}|${to}|${view.status}|${view.page}`
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (!loading && data && shownFor !== key) setShownFor(key)
  const current = data && shownFor === key ? data : null

  const errorBox = (message: string) => (
    <div className="flex flex-wrap items-center gap-ps-gap">
      <p role="alert" className="text-ps-base text-ps-alert break-words">
        {message}
      </p>
      <Button onClick={() => void refetch()}>Tentar de novo</Button>
    </div>
  )

  let body: React.ReactNode
  if (!current) {
    body = loading ? (
      <p role="status" className="text-ps-base text-ps-mut">
        Carregando...
      </p>
    ) : (
      errorBox(error ?? MSG_BAD_SHAPE)
    )
  } else {
    const lastPage = Math.min(MAX_PAGE, Math.max(1, Math.ceil(current.total / current.pageSize)))
    body = (
      <div aria-busy={loading} className={cx('flex flex-col gap-6', loading && 'opacity-60')}>
        <p className="ps-num text-ps-sm text-ps-mut">{`De ${fmtDay(current.range.from)} a ${fmtDay(current.range.to)}`}</p>
        {error && errorBox(error)}
        <Totals totals={current.totals} />
        <Months months={current.byMonth} />
        <Overdue rows={current.overdue} onNavigate={onNavigate} />
        <section aria-labelledby={rowsHeading} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id={rowsHeading} className={H2}>
              Cobranças
            </h2>
            <span className="ps-num text-ps-base text-ps-mut">{fmtCount(current.total)}</span>
          </div>
          <p className="text-ps-sm text-ps-mut">
            Entram no período pela data de pagamento, ou pelo vencimento quando não foram pagas.
          </p>
          {current.rows.length === 0 ? (
            <p className="text-ps-base text-ps-mut">
              {current.total === 0 ? 'Nenhuma cobrança neste filtro.' : 'Nada nesta página.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-ps-gap">
              {current.rows.map((row) => (
                <PaymentItem key={row.paymentId} row={row} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
          {(view.page > 1 || lastPage > 1) && (
            <nav aria-label="Páginas das cobranças" className="flex flex-wrap items-center justify-between gap-ps-gap">
              <Button onClick={() => setView({ ...view, page: view.page - 1 })} disabled={loading || view.page <= 1}>
                Página anterior
              </Button>
              <span className="ps-num text-ps-sm text-ps-mut">{`Página ${current.page} de ${lastPage}`}</span>
              <Button onClick={() => setView({ ...view, page: view.page + 1 })} disabled={loading || view.page >= lastPage}>
                Próxima página
              </Button>
            </nav>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Trocar o filtro volta pra primeira página. */}
          <Segmented
            aria-label="Período"
            options={PERIODS}
            value={view.period}
            onChange={(period) => setView({ ...view, period, page: 1 })}
            className="max-w-full flex-wrap"
          />
          <Button
            className="ml-auto"
            onClick={() => void refetch()}
            disabled={loading}
            icon={<RefreshCw size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />}
          >
            Atualizar
          </Button>
        </div>
        <Segmented
          aria-label="Status da cobrança"
          options={STATUSES}
          value={view.status}
          onChange={(status) => setView({ ...view, status, page: 1 })}
          className="max-w-full flex-wrap self-start"
        />
        <p className="text-ps-base text-ps-mut">{RULE}</p>
      </div>
      {body}
    </div>
  )
}

function Totals({ totals }: { totals: FinanceTotals }) {
  const headingId = useId()
  const overdueCount = totals.overdueCount
  const hasOverdue = typeof overdueCount === 'number' && overdueCount > 0
  // Ruling ADM-T22-totais: vencimento dentro do período e ainda não paga hoje, contada por cobrança.
  const overdueSub =
    typeof overdueCount === 'number' && Number.isFinite(overdueCount)
      ? `${fmtCount(overdueCount)} ${overdueCount === 1 ? 'cobrança' : 'cobranças'}`
      : `Cobranças: ${EMPTY}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={H2}>
        Totais do período
      </h2>
      {/* Uma coluna até 400 px: em duas, um valor de 7 dígitos quebraria no meio do número. */}
      <div className="grid grid-cols-1 gap-ps-gap min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Tile label="Recebido bruto" value={fmtBRL(totals.grossBrl)} sub="Valor das cobranças pagas" />
        <Tile label="Líquido" value={fmtBRL(totals.netBrl)} sub="Depois das taxas do Asaas" />
        <Tile label="Pagas" value={fmtCount(totals.paidCount)} sub="Cobranças pagas" />
        {/* Estorno pedido ou em andamento fica fora do total (Ruling ADM-T22-totais). */}
        <Tile label="Estornado" value={fmtBRL(totals.refundedBrl)} sub="Só estorno confirmado, já fora do recebido" />
        <Tile label="Vencido no período" value={fmtBRL(totals.overdueBrl)} sub={overdueSub} alert={hasOverdue} />
      </div>
      {/* Nem recebido nem estornado: contado à parte pra a diferença pro painel do Asaas não sumir. */}
      {totals.disputedCount > 0 && (
        <p className="text-ps-sm text-ps-mut break-words">
          <span className="ps-num">{fmtCount(totals.disputedCount)}</span> em estorno ou contestação, fora do recebido
        </p>
      )}
    </section>
  )
}

function Tile({ label, value, sub, alert = false }: { label: string; value: string; sub: string; alert?: boolean }) {
  const id = useId()
  return (
    <Panel role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1 p-3">
      <span id={id} className="ps-label">
        {label}
      </span>
      <span className={cx('ps-num text-ps-md font-bold break-words', alert ? 'text-ps-alert' : 'text-ps-bone')}>{value}</span>
      <span className="text-ps-sm text-ps-mut break-words">{sub}</span>
    </Panel>
  )
}

function Months({ months }: { months: FinanceMonth[] }) {
  const headingId = useId()
  // Valor ausente fica fora da escala: os outros meses mantêm a proporção.
  const widths = barWidths(months.map((m) => m.grossBrl))
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={H2}>
        Receita por mês
      </h2>
      <p className="text-ps-sm text-ps-mut">
        Bruto pago em cada mês de Brasília, nos 12 meses até o fim do período. A barra compara com o maior mês.
      </p>
      {months.length === 0 ? (
        <p className="text-ps-base text-ps-mut">Nenhum mês pra mostrar.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {months.map((m, i) => (
            <MonthItem key={`${m.month}:${i}`} month={m} width={widths[i]} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MonthItem({ month, width }: { month: FinanceMonth; width: number | null }) {
  const plans = planEntries(month.byPlan)
  const plansKnown = typeof month.byPlan === 'object' && month.byPlan !== null
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="ps-num text-ps-base font-bold text-ps-bone">{monthLabel(month.month)}</span>
        <span className="text-ps-base text-ps-bone">
          <span className="text-ps-sm text-ps-mut">Bruto</span> <span className="ps-num">{fmtBRL(month.grossBrl)}</span>
        </span>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-ps-pill bg-ps-well inset-ring inset-ring-ps-line">
        {width !== null && <div data-bar={month.month} className="h-full rounded-ps-pill bg-ps-mut" style={{ width: `${width}%` }} />}
      </div>
      <p className="text-ps-sm text-ps-mut">
        Líquido <span className="ps-num text-ps-bone">{fmtBRL(month.netBrl)}</span>
      </p>
      {/* Os planos repartem o BRUTO do mês, não o líquido (Ruling ADM-T22-byPlan). Mês sem plano
          nenhum não mostra a linha. */}
      {(!plansKnown || plans.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-ps-sm text-ps-mut">
          <span>Bruto por plano:</span>{' '}
          {plansKnown ? (
            plans.map((p, i) => (
              <Fragment key={p.key}>
                {i > 0 && ' '}
                <span>
                  {planLabel(p.key)} <span className="ps-num text-ps-bone">{fmtBRL(p.value as number | null)}</span>
                </span>
              </Fragment>
            ))
          ) : (
            <span>{EMPTY}</span>
          )}
        </div>
      )}
    </li>
  )
}

function Overdue({ rows, onNavigate }: { rows: FinanceOverdue[]; onNavigate: Navigate }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id={headingId} className={H2}>
          No vermelho
        </h2>
        <span className={cx('ps-num text-ps-base', rows.length > 0 ? 'text-ps-alert' : 'text-ps-mut')}>{rows.length}</span>
      </div>
      <p className="text-ps-sm text-ps-mut">Todas as cobranças vencidas e não pagas, de qualquer período.</p>
      {rows.length === 0 ? (
        <p className="text-ps-base text-ps-mut">Nenhuma cobrança vencida.</p>
      ) : (
        <ul className="flex flex-col gap-ps-gap">
          {rows.map((o) => (
            <li key={o.paymentId}>
              <Panel className="p-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Field label="Conta" wide>
                    <Account userId={o.userId} email={o.email} onNavigate={onNavigate} />
                  </Field>
                  <Field label="Plano">{planLabel(o.planKey)}</Field>
                  <Field label="Vencimento">
                    <span className="ps-num text-ps-alert">{fmtDay(o.dueDate)}</span>
                  </Field>
                  <Field label="Valor">
                    <span className="ps-num">{fmtBRL(o.value)}</span>
                  </Field>
                  <Field label="Cobrança">
                    <span className="ps-num break-all">{o.paymentId}</span>
                  </Field>
                </dl>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PaymentItem({ row, onNavigate }: { row: FinanceRow; onNavigate: Navigate }) {
  const [feedback, setFeedback] = useState<PaymentFeedback | null>(null)
  const [opening, setOpening] = useState(false)
  // Trava síncrona: dois cliques seguidos não abrem duas abas.
  const busy = useRef(false)

  const openInvoice = async () => {
    if (busy.current) return
    busy.current = true
    // A aba abre aqui, ainda dentro do clique (Ruling ADM-T8-aba): antes do primeiro await.
    const opened = openPaymentInvoice(row.paymentId)
    setOpening(true)
    setFeedback(null)
    try {
      setFeedback(await opened)
    } finally {
      busy.current = false
      setOpening(false)
    }
  }

  const copyId = async () => {
    setFeedback(null)
    setFeedback(await copyPaymentId(row.paymentId))
  }

  return (
    <li>
      <Panel className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cx('text-ps-base font-bold', row.status === 'OVERDUE' ? 'text-ps-alert' : 'text-ps-bone')}>
            {paymentStatusLabel(row.status)}
          </span>
          <span className="ps-num text-ps-sm text-ps-mut break-all">{row.paymentId}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Valor">
            <span className="ps-num">{fmtBRL(row.value)}</span>
          </Field>
          <Field label="Líquido">
            <span className="ps-num">{fmtBRL(row.netValue)}</span>
          </Field>
          <Field label="Vencimento">
            <span className="ps-num">{fmtDay(row.dueDate)}</span>
          </Field>
          <Field label="Pagamento">
            <span className="ps-num">{fmtDay(paidDay(row))}</span>
          </Field>
          <Field label="Plano">{planLabel(row.planKey)}</Field>
          {row.refundedAt && (
            <Field label="Estorno">
              <span className="ps-num">{fmtDay(row.refundedAt)}</span>
            </Field>
          )}
          <Field label="Conta" wide>
            <Account userId={row.userId} email={row.email} onNavigate={onNavigate} />
          </Field>
        </dl>
        {/* Sem gap aqui: a região de aviso fica sempre na página (pro leitor de tela anunciar) e,
            vazia, não ocupa espaço. */}
        <div className="flex flex-col">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void openInvoice()} disabled={opening} icon={opening ? SPINNER : undefined}>
              Ver no Asaas
            </Button>
            <Button onClick={() => void copyId()}>Copiar id</Button>
          </div>
          <div role="status">
            {feedback && <p className={cx('mt-2', feedback.tone === 'ok' ? OK_TEXT : ALERT_BOX)}>{feedback.text}</p>}
          </div>
        </div>
      </Panel>
    </li>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col', wide && 'col-span-full')}>
      <dt className="text-ps-sm text-ps-mut">{label}</dt>
      <dd className="min-w-0 text-ps-base text-ps-bone break-words">{children}</dd>
    </div>
  )
}

/** E-mail da conta; com conta ligada, abre a ficha em Assinantes. */
function Account({ userId, email, onNavigate }: { userId: string | null; email: string | null; onNavigate: Navigate }) {
  if (!userId || !email) return <span className="text-ps-base text-ps-bone break-all">{email ?? EMPTY}</span>
  return (
    <button type="button" className={ACCOUNT_LINK} onClick={() => onNavigate('subscribers', { userId })}>
      {email}
    </button>
  )
}
