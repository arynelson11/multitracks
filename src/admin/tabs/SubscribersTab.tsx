// Aba Assinantes: busca por nome, e-mail ou id (espera 300 ms de pausa na digitação), filtros de
// status, marcação (uma por vez), plano e ordem, páginas de 50 e a ficha de cada conta. As ações
// (T26, SubscriberActions) entram no topo da ficha pela renderActions. Resposta fora do formato
// mostra a frase pronta com Tentar de novo (Ruling ADM-T7-forma).
import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Chip, Segmented, cx } from '../../components/ui'
import { SubscriberActions } from '../components/SubscriberActions'
import { ErrorBox, SubscriberDetail, Tag } from '../components/SubscriberDetail'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { EMPTY, planLabel } from '../lib/fmt'
import {
  FLAG_FILTERS,
  PLAN_FILTERS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  billingDateText,
  flagLabel,
  flagNeedsYou,
  lastAccessText,
  pageRangeText,
  statusLabel,
  type FlagFilter,
  type PlanFilter,
  type SortKey,
  type StatusFilter,
} from '../lib/subscriberText'
import { isSubscriberPage, type RenderActions, type SubscriberPage, type SubscriberRow } from '../lib/subscribersTypes'
import type { TabProps } from '../lib/tabs'

const SEARCH_WAIT_MS = 300
// Teto do servidor pra busca (`q` até 120).
const SEARCH_MAX = 120
const MSG_BAD_SHAPE = 'Não deu pra carregar os assinantes. Tente de novo.'

const CONTROL =
  'min-h-ps-touch rounded-ps-md bg-ps-s2 px-3 text-ps-md text-ps-bone inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none'
const ROW =
  'flex w-full min-h-ps-touch flex-col gap-2 rounded-ps-2xl bg-ps-s1 p-3 text-left inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

type Filters = { q: string; status: StatusFilter; flag: FlagFilter | null; plan: PlanFilter; sort: SortKey; page: number }

const START: Filters = { q: '', status: 'all', flag: null, plan: 'all', sort: 'created', page: 1 }

// As ações da ficha (T26). Constante do módulo: a mesma a cada render.
const ACTIONS: RenderActions = (detail, reload) => <SubscriberActions detail={detail} reload={reload} />

type SubscribersTabProps = TabProps & {
  renderActions?: RenderActions
  /** Recarrega a fila de Pendências da casca: as ações da ficha mudam a fila (aviso T8/T26). */
  onQueueChange?: () => void
}

export function SubscribersTab({ onNavigate, focusUserId, renderActions = ACTIONS, onQueueChange }: SubscribersTabProps) {
  const searchId = useId()
  const planId = useId()
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<Filters>(START)
  // A conta da ficha aberta. Um focusUserId novo (vindo de outra aba) abre a ficha dele.
  const [openId, setOpenId] = useState<string | null>(focusUserId)
  const [seenFocus, setSeenFocus] = useState(focusUserId)
  if (focusUserId !== seenFocus) {
    setSeenFocus(focusUserId)
    if (focusUserId) setOpenId(focusUserId)
  }

  // A busca só vai pro servidor depois de 300 ms sem digitar.
  const term = text.trim()
  useEffect(() => {
    if (term === filters.q) return
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: term, page: 1 })), SEARCH_WAIT_MS)
    return () => clearTimeout(timer)
  }, [term, filters.q])

  // Mudar um filtro volta pra primeira página.
  const change = (next: Partial<Omit<Filters, 'page'>>) => setFilters((f) => ({ ...f, ...next, page: 1 }))
  const goTo = (page: number) => setFilters((f) => ({ ...f, page }))

  // `all` e sem marcação não vão no pedido: o servidor trata a falta como sem filtro.
  const list = useAdminQuery<SubscriberPage>('subscribers', {
    q: filters.q || undefined,
    status: filters.status === 'all' ? undefined : filters.status,
    flag: filters.flag ?? undefined,
    plan: filters.plan === 'all' ? undefined : filters.plan,
    sort: filters.sort,
    page: filters.page,
  })
  const { loading, error } = list
  const refetchList = list.refetch
  const data = isSubscriberPage(list.data) ? list.data : null

  // Depois de uma ação na ficha, a lista e a fila de Pendências também chegam de novo (o status, as
  // marcações e as pendências mudam).
  const actions = useMemo<RenderActions>(
    () => (detail, reload) =>
      renderActions(detail, () => {
        reload()
        void refetchList()
        onQueueChange?.()
      }),
    [renderActions, refetchList, onQueueChange],
  )

  let content: ReactNode
  if (!data) {
    content = loading ? (
      <p role="status" className="text-ps-base text-ps-mut">
        Carregando...
      </p>
    ) : (
      <ErrorBox message={error ?? MSG_BAD_SHAPE} onRetry={() => void refetchList()} />
    )
  } else {
    const range = pageRangeText(data)
    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
    const showButtons = filters.page > 1 || lastPage > 1
    content = (
      <>
        {error && <ErrorBox message={error} onRetry={() => void refetchList()} />}
        {data.rows.length === 0 ? (
          <p className="text-ps-base text-ps-mut">{data.total === 0 ? 'Nenhuma conta encontrada.' : 'Nada nesta página.'}</p>
        ) : (
          <ul aria-busy={loading} className={cx('flex flex-col gap-ps-gap', loading && 'opacity-60')}>
            {data.rows.map((row) => (
              <SubscriberItem key={row.userId} row={row} onOpen={() => setOpenId(row.userId)} />
            ))}
          </ul>
        )}
        {(range || showButtons) && (
          <nav aria-label="Páginas de assinantes" className="flex flex-wrap items-center justify-between gap-ps-gap">
            {showButtons && (
              <Button onClick={() => goTo(filters.page - 1)} disabled={loading || filters.page <= 1}>
                Anterior
              </Button>
            )}
            {range && <span className="ps-num text-ps-sm text-ps-mut">{range}</span>}
            {showButtons && (
              <Button onClick={() => goTo(filters.page + 1)} disabled={loading || filters.page >= lastPage}>
                Próxima
              </Button>
            )}
          </nav>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-ps-md font-bold text-ps-bone">Assinantes</h2>
        <p className="text-ps-sm text-ps-mut">Escolha uma conta pra abrir a ficha.</p>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="ps-label">
            Buscar
          </label>
          <input
            id={searchId}
            type="search"
            value={text}
            maxLength={SEARCH_MAX}
            placeholder="Nome, e-mail ou id"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            className={cx(CONTROL, 'w-full placeholder:text-ps-mut')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden="true" className="ps-label">
            Status
          </span>
          <Segmented aria-label="Status" options={STATUS_FILTERS} value={filters.status} onChange={(status) => change({ status })} className="flex-wrap" />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden="true" className="ps-label">
            Marcação
          </span>
          <div role="group" aria-label="Marcação" className="flex flex-wrap gap-ps-gap">
            {FLAG_FILTERS.map((o) => {
              const on = filters.flag === o.value
              return (
                <Chip key={o.value} on={on} aria-pressed={on} onClick={() => change({ flag: on ? null : o.value })}>
                  {o.label}
                </Chip>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <label htmlFor={planId} className="ps-label">
              Plano
            </label>
            <select
              id={planId}
              value={filters.plan}
              onChange={(e) => change({ plan: e.target.value as PlanFilter })}
              // scheme-dark: a lista nativa das opções abre escura também no Windows e no Linux.
              className={cx(CONTROL, 'w-full scheme-dark sm:w-auto')}
            >
              {PLAN_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span aria-hidden="true" className="ps-label">
              Ordem
            </span>
            <Segmented aria-label="Ordem" options={SORT_OPTIONS} value={filters.sort} onChange={(sort) => change({ sort })} className="flex-wrap" />
          </div>
        </div>
      </div>

      {content}

      {openId && (
        <SubscriberDetail key={openId} userId={openId} onClose={() => setOpenId(null)} onNavigate={onNavigate} renderActions={actions} />
      )}
    </section>
  )
}

/** Um par rótulo e valor dentro da linha (só spans: a linha inteira é um botão). */
function RowField({ label, value, num }: { label: string; value: string; num?: boolean }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="text-ps-sm text-ps-mut">{label}</span>
      <span className={cx('text-ps-sm text-ps-bone break-words', num && 'ps-num')}>{value}</span>
    </span>
  )
}

function SubscriberItem({ row, onOpen }: { row: SubscriberRow; onOpen: () => void }) {
  const title = row.name || row.email || row.userId
  const date = billingDateText(row)
  const access = lastAccessText(row)
  return (
    <li>
      <button type="button" onClick={onOpen} className={ROW}>
        <span className="flex w-full flex-wrap items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cx('text-ps-base font-bold text-ps-bone', row.name || row.email ? 'break-words' : 'ps-num break-all')}>{title}</span>
            {row.name && row.email && <span className="text-ps-sm text-ps-mut break-all">{row.email}</span>}
          </span>
          <Tag tone={row.status === 'paid_active' ? 'on' : 'neutral'}>{statusLabel(row.status)}</Tag>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <RowField label="Plano" value={planLabel(row.plan)} />
          {row.courtesyPlan && row.status !== 'courtesy' && <RowField label="Com cortesia" value={planLabel(row.courtesyPlan)} />}
          {date && <RowField label={date.label} value={date.value} num />}
          <RowField label="Separações no mês" value={Number.isFinite(row.separationsMonth) ? String(row.separationsMonth) : EMPTY} num />
          {/* Sem acesso nem login, o rótulo fica pra o `sem dado` não aparecer solto. */}
          {access === EMPTY ? (
            <RowField label="Último acesso" value={EMPTY} />
          ) : (
            <span className="ps-num text-ps-sm text-ps-mut">{access}</span>
          )}
        </span>
        {row.flags.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {row.flags.map((flag) => (
              <Tag key={flag} tone={flagNeedsYou(flag) ? 'alert' : 'neutral'}>
                {flagLabel(flag)}
              </Tag>
            ))}
          </span>
        )}
      </button>
    </li>
  )
}
