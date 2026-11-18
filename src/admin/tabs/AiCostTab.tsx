// Aba Custos de IA: quanto as separações custaram no Replicate, trabalho por trabalho, com o câmbio
// e o preço do hardware que entraram na conta.
// * Período por Segmented (este mês, mês passado, últimos 90 dias), em dias de Brasília.
// * As somas vêm do servidor e só contam trabalho com dólar e real gravados. O resto aparece contado
//   à parte, em dois números (Ajuste ADM-sem-custo): o alerta âmbar e o botão contam só o que a
//   varredura ainda completa ("N trabalhos ainda sem custo"); o já tentado sem preço conhecido
//   aparece neutro ("N trabalhos sem preço conhecido (fora da soma)"), porque não há o que fazer.
//   Na linha do trabalho é igual: "sem custo" em âmbar no pendente, "sem preço conhecido" neutro.
// * Cada trabalho usa a PTAX do próprio dia: a linha mostra o dia do câmbio dela.
// * "Completar custos que faltam" não tem diálogo. A trava contra mandar duas vezes e o segurar da
//   resposta incerta ficam no módulo e sobrevivem à troca de aba, como o "Tentar agora" das
//   Pendências (Rulings ADM-T4-incerto e ADM-T8-trava). Deu certo ou erro certo: recarrega e solta
//   quando os números novos chegam. Incerto: segura até a aba receber números de novo (Atualizar,
//   outro período ou a volta pra aba), sem recarregar sozinha.
// * Resposta fora do formato mostra a frase pronta e Tentar de novo (Ruling ADM-T7-forma).
import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Led, Panel, Segmented, cx, type SegmentedOption } from '../../components/ui'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { AdminApiError, adminPost } from '../lib/adminApi'
import { hasCost, isAiCosts, type AiCosts, type AiJob } from '../lib/aiCostsTypes'
import { EMPTY, fmtBRL, fmtDateTimeBR, fmtDay, fmtUSD } from '../lib/fmt'
import { addDaysLocal, brtTodayLocal, monthRange } from '../lib/period'
import type { Navigate, TabProps } from '../lib/tabs'

const MSG_BAD_SHAPE = 'Não deu pra carregar os custos de IA. Tente de novo.'
// Incerto: a varredura pode ter completado custos. Ela não grava no Registro, então as frases não
// mandam conferir lá; o MSG_HELD embaixo manda clicar em Atualizar enquanto o botão estiver preso.
const MSG_SWEEP_LOST = 'A resposta da varredura não chegou, e ela pode ter completado parte dos custos.'
// Erro que não veio do adminPost: não dá pra saber se a varredura saiu, então vale como incerto.
const MSG_SWEEP_UNEXPECTED = 'Erro inesperado, e a varredura pode ter completado parte dos custos.'
const MSG_HELD = 'Clique em Atualizar pra ver os números de agora.'

const SPINNER = <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const OK_TEXT = 'text-ps-base text-ps-bone break-words'

type PeriodKey = 'month' | 'last' | 'd90'

const PERIODS: SegmentedOption<PeriodKey>[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last', label: 'Mês passado' },
  { value: 'd90', label: 'Últimos 90 dias' },
]

/** Dias de Brasília do período (os 90 dias contam hoje). */
function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  if (key === 'month') return monthRange(today, 0)
  if (key === 'last') return monthRange(today, -1)
  return { from: addDaysLocal(today, -89), to: today }
}

// ── Memória que sobrevive à troca de aba e a fechar e abrir o admin (como na aba Pendências). A
// casca desmonta a aba na troca, e um pedido no ar não pode virar dois com a volta pra aba. Nada
// trava pra sempre: o pedido no ar solta quando responde (o adminPost tem teto de 35 s), e o
// segurado solta nos primeiros números que a aba recebe depois da resposta.

type Feedback = { tone: 'ok' | 'alert'; text: string }
/** running: pedido no ar. Respondido: segura até chegarem outros números; `uncertain` = a resposta não chegou. */
type Lock = { running: true } | { running: false; seen: unknown; uncertain: boolean }
type Shared = { lock: Lock | null; feedback: Feedback | null }

const memory: {
  state: Shared
  /** Os últimos números que uma aba montada recebeu: o segurado espera outros. */
  lastData: unknown
  /** O refetch da aba aberta agora, pra recarregar quando a resposta chegar (null com a aba fora da tela). */
  reload: (() => Promise<void>) | null
  listeners: Set<() => void>
} = { state: { lock: null, feedback: null }, lastData: null, reload: null, listeners: new Set() }

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

const isLocked = (lock: Lock | null, data: unknown) => lock !== null && (lock.running || lock.seen === data)

/** Chegaram números: guarda como os últimos vistos e solta o que esperava outros. */
function seeData(data: AiCosts): void {
  memory.lastData = data
  change((s) => (s.lock && !s.lock.running && s.lock.seen !== data ? { ...s, lock: null } : s))
}

/** A aba saiu da tela: a frase vai embora, menos com o pedido no ar ou segurado por resposta incerta. */
function leaveTab(): void {
  change((s) => {
    const keep = s.lock !== null && (s.lock.running || s.lock.uncertain)
    return keep || s.feedback === null ? s : { ...s, feedback: null }
  })
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** "a, b e c". */
function joinPt(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/** O que a varredura fez, em frase pronta. */
function sweepText(result: unknown): Feedback {
  const r = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>
  const recorded = count(r.recorded)
  const brl = count(r.brlCompleted)
  const unknown = count(r.unknown)
  const failed = count(r.failed)
  const parts: string[] = []
  if (recorded > 0) parts.push(`${recorded} ${recorded === 1 ? 'custo gravado' : 'custos gravados'}`)
  if (brl > 0) parts.push(`${brl} ${brl === 1 ? 'trabalho ganhou' : 'trabalhos ganharam'} o valor em R$`)
  if (unknown > 0) parts.push(`${unknown} sem dado do Replicate`)
  if (failed > 0) parts.push(`${failed} sem resposta do Replicate`)
  let text = parts.length > 0 ? `Varredura feita: ${joinPt(parts)}.` : 'Varredura feita: nada pra completar agora.'
  if (r.more === true) text += ' Ainda faltam trabalhos: clique de novo pra continuar.'
  return { tone: failed > 0 ? 'alert' : 'ok', text }
}

/**
 * Manda a varredura com a trava do módulo. A conferência é síncrona: dois cliques no mesmo
 * instante, ou um clique depois de voltar pra aba com o pedido no ar, não saem duas vezes.
 */
async function runSweep(): Promise<void> {
  if (isLocked(memory.state.lock, memory.lastData)) return
  change(() => ({ lock: { running: true }, feedback: null }))
  let feedback: Feedback
  let uncertain = true
  try {
    feedback = sweepText(await adminPost<unknown>('ai-costs-sweep', {}))
    uncertain = false
  } catch (e) {
    const known = e instanceof AdminApiError
    // Erro certo: nada foi feito, e os números podem estar velhos. Incerto: pode ter sido feito.
    uncertain = !known || e.uncertain
    const text = !known ? MSG_SWEEP_UNEXPECTED : e.uncertain ? MSG_SWEEP_LOST : e.message
    feedback = { tone: 'alert', text }
  }
  change(() => ({ feedback, lock: { running: false, seen: memory.lastData, uncertain } }))
  if (!uncertain) void memory.reload?.()
}

// ── Formatação desta tela.

const USD_PER_SECOND = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

/** Tempo de processamento: `45 s`, `1 min 23 s`, `3 h 12 min`. */
function fmtSeconds(v: number | null): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return EMPTY
  if (v > 0 && v < 1) return 'menos de 1 s'
  const s = Math.round(v)
  if (s < 60) return `${s} s`
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`
}

const STATUS_LABELS: Record<string, string> = {
  succeeded: 'concluído',
  failed: 'falhou',
  canceled: 'cancelado',
  unknown: 'sem dado do Replicate',
  starting: 'em andamento',
  processing: 'em andamento',
}

function statusLabel(status: string | null): string {
  if (!status) return EMPTY
  return STATUS_LABELS[status] ?? status
}

/** `htdemucs, 4 faixas`. */
function modelLabel(model: string | null, stemCount: number | null): string {
  const stems = typeof stemCount === 'number' ? `${stemCount} faixas` : `faixas ${EMPTY}`
  return `${model ?? `modelo ${EMPTY}`}, ${stems}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function fxText(fx: AiCosts['fx']): string {
  if (fx.minDate && fx.maxDate) {
    return `Câmbio PTAX de venda do Banco Central, de ${fmtDay(fx.minDate)} a ${fmtDay(fx.maxDate)}, sem IOF nem spread do cartão.`
  }
  return 'Câmbio PTAX de venda do Banco Central, sem IOF nem spread do cartão. Nenhum trabalho deste período tem câmbio gravado.'
}

/** `https://replicate.com/pricing` vira `replicate.com/pricing`. */
const sourceLabel = (source: string) => source.replace(/^https?:\/\//, '').replace(/\/$/, '')

// ── Tela.

export function AiCostTab({ onNavigate }: TabProps) {
  // Trocar de período volta pra primeira página.
  const [view, setView] = useState<{ period: PeriodKey; page: number }>({ period: 'month', page: 1 })
  const { from, to } = periodRange(view.period, brtTodayLocal())
  const query = useAdminQuery<AiCosts>('ai-costs', { from, to, page: view.page })
  const { loading, error, refetch } = query
  // Resposta fora do formato vale como erro, nunca quebra o render.
  const data = isAiCosts(query.data) ? query.data : null
  const shared = useSyncExternalStore(listen, snapshot)

  useEffect(() => {
    if (data) seeData(data)
  }, [data])
  // A aba aberta agora é quem recarrega quando a resposta chegar.
  useEffect(() => {
    memory.reload = refetch
    return () => {
      if (memory.reload === refetch) memory.reload = null
      leaveTab()
    }
  }, [refetch])

  const locked = isLocked(shared.lock, data)
  const running = shared.lock?.running === true
  const held = shared.lock !== null && !shared.lock.running && shared.lock.uncertain && locked

  const refresh = () => {
    // A frase de uma resposta incerta fica enquanto o botão estiver segurado.
    change((s) => (s.feedback && !isLocked(s.lock, data) ? { ...s, feedback: null } : s))
    void refetch()
  }

  const feedback = shared.feedback && (
    <p className={cx(shared.feedback.tone === 'ok' ? OK_TEXT : ALERT_BOX)}>
      {shared.feedback.text}
      {held && <span className="mt-1 block">{MSG_HELD}</span>}
    </p>
  )

  let body: React.ReactNode
  if (!data) {
    body = loading ? (
      <p role="status" className="text-ps-base text-ps-mut">
        Carregando...
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-ps-gap">
        <p role="alert" className="text-ps-base text-ps-alert break-words">
          {error ?? MSG_BAD_SHAPE}
        </p>
        <Button onClick={() => void refetch()}>Tentar de novo</Button>
      </div>
    )
  } else {
    const t = data.totals
    body = (
      <div aria-busy={loading} className={cx('flex flex-col gap-5', loading && 'opacity-60')}>
        {error && (
          <div className="flex flex-wrap items-center gap-ps-gap">
            <p role="alert" className={ALERT_BOX}>
              {error}
            </p>
            <Button onClick={() => void refetch()}>Tentar de novo</Button>
          </div>
        )}

        {/* Só os pendentes: o já tentado sem preço não tem o que completar (fica neutro nos totais). */}
        {t.withoutCostPending > 0 ? (
          <WithoutCost
            count={t.withoutCostPending}
            locked={locked}
            running={running}
            feedback={feedback}
            onSweep={() => void runSweep()}
          />
        ) : (
          <div role="status">{feedback}</div>
        )}

        <Totals totals={t} />

        <div className="grid gap-5 lg:grid-cols-2">
          <ByModel rows={data.byModel} />
          <ByUser rows={data.byUser} onNavigate={onNavigate} />
        </div>

        <Jobs
          data={data}
          loading={loading}
          onNavigate={onNavigate}
          onPage={(page) => setView((v) => ({ ...v, page }))}
        />

        <Basis fx={data.fx} prices={data.prices} />
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-ps-md font-bold text-ps-bone">Custos de IA</h2>
          <Button
            className="ml-auto"
            onClick={refresh}
            disabled={loading}
            icon={<RefreshCw size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />}
          >
            Atualizar
          </Button>
        </div>
        {/* O grupo quebra linha numa tela estreita, em vez de vazar pro lado. */}
        <Segmented
          aria-label="Período"
          className="max-w-full flex-wrap self-start"
          options={PERIODS}
          value={view.period}
          onChange={(period) => setView({ period, page: 1 })}
        />
        {data && (
          <p className="text-ps-sm text-ps-mut">
            Período: <span className="ps-num">{`${fmtDay(data.range.from)} a ${fmtDay(data.range.to)}`}</span>, em dias de
            Brasília.
          </p>
        )}
      </header>
      {body}
    </section>
  )
}

function WithoutCost({
  count: n,
  locked,
  running,
  feedback,
  onSweep,
}: {
  count: number
  locked: boolean
  running: boolean
  feedback: React.ReactNode
  onSweep: () => void
}) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <Panel className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Led state="alert" />
          <h3 id={id} className="text-ps-md font-bold text-ps-alert">
            <span className="ps-num">{n}</span> {n === 1 ? 'trabalho ainda sem custo' : 'trabalhos ainda sem custo'}
          </h3>
        </div>
        <p className="text-ps-base text-ps-mut">
          Ficam fora das somas até o custo ser gravado. A varredura consulta o Replicate e completa o que faltar.
        </p>
        {/* Sem gap aqui: a região de aviso fica sempre na página (pro leitor de tela anunciar) e,
            vazia, não ocupa espaço. */}
        <div className="flex flex-col">
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" onClick={onSweep} disabled={locked} icon={running ? SPINNER : undefined}>
              Completar custos que faltam
            </Button>
          </div>
          <div role="status">{feedback && <div className="mt-2">{feedback}</div>}</div>
        </div>
      </Panel>
    </section>
  )
}

function Totals({ totals: t }: { totals: AiCosts['totals'] }) {
  const id = useId()
  const others = [
    t.canceled > 0 ? plural(t.canceled, 'cancelado', 'cancelados') : null,
    t.unknown > 0 ? `${t.unknown} sem dado do Replicate` : null,
  ].filter((s): s is string => s !== null)
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-ps-md font-bold text-ps-bone">
        Totais do período
      </h3>
      <dl className="grid grid-cols-2 gap-ps-gap sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Custo em R$" value={fmtBRL(t.costBrl)} />
        <Stat label="Custo em US$" value={fmtUSD(t.costUsd)} />
        <Stat label="Trabalhos" value={String(t.jobs)} note={others.length > 0 ? joinPt(others) : null} />
        <Stat label="Concluídos" value={String(t.succeeded)} />
        <Stat label="Falhas" value={String(t.failed)} />
        <Stat label="Média por separação concluída" value={fmtBRL(t.avgBrlPerSucceeded)} />
        <Stat label="Tempo de processamento" value={fmtSeconds(t.predictSeconds)} />
      </dl>
      <p className="text-ps-sm text-ps-mut">As somas só contam trabalhos com custo gravado em US$ e R$.</p>
      {/* Neutro: a varredura já tentou e não há preço pra calcular, então não há ação possível. */}
      {t.withoutCostUnpriced > 0 && (
        <p className="text-ps-base text-ps-bone break-words">
          <span className="ps-num">{t.withoutCostUnpriced}</span>{' '}
          {t.withoutCostUnpriced === 1 ? 'trabalho sem preço conhecido' : 'trabalhos sem preço conhecido'} (fora da soma)
        </p>
      )}
    </section>
  )
}

function Stat({ label, value, note = null }: { label: string; value: string; note?: string | null }) {
  return (
    <Panel className="flex min-w-0 flex-col gap-1 p-3">
      {/* Sem o ps-label, que não quebra linha: "Média por separação concluída" vazaria a 320 px. */}
      <dt className="text-ps-sm font-bold text-ps-mut break-words">{label}</dt>
      <dd className="ps-num text-ps-md text-ps-bone break-words">{value}</dd>
      {note && <dd className="text-ps-sm text-ps-mut break-words">{note}</dd>}
    </Panel>
  )
}

function ByModel({ rows }: { rows: AiCosts['byModel'] }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <Panel className="flex flex-col gap-2 p-4">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone">
          Por modelo e faixas
        </h3>
        {rows.length === 0 ? (
          <p className="text-ps-base text-ps-mut">Nenhum trabalho neste período.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={`${r.model}:${r.stemCount}`} className="flex flex-col gap-0.5 border-t border-ps-line py-2 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-ps-base font-bold text-ps-bone break-words">{modelLabel(r.model, r.stemCount)}</span>
                  <span className="ps-num text-ps-base text-ps-bone">{fmtBRL(r.costBrl)}</span>
                </div>
                <p className="text-ps-sm text-ps-mut">
                  <span className="ps-num">{r.jobs}</span> {r.jobs === 1 ? 'trabalho' : 'trabalhos'}, média de{' '}
                  <span className="ps-num">{fmtSeconds(r.avgSeconds)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}

function ByUser({ rows, onNavigate }: { rows: AiCosts['byUser']; onNavigate: Navigate }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <Panel className="flex flex-col gap-2 p-4">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone">
          Por pessoa
        </h3>
        <p className="text-ps-sm text-ps-mut">As 50 contas de maior custo no período.</p>
        {rows.length === 0 ? (
          <p className="text-ps-base text-ps-mut">Nenhum trabalho neste período.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li
                key={r.userId ?? 'conta-excluida'}
                className="flex flex-wrap items-center justify-between gap-x-3 border-t border-ps-line py-1 first:border-t-0"
              >
                <div className="min-w-0 max-w-full">
                  <Account userId={r.userId} email={r.email} onNavigate={onNavigate} />
                </div>
                <p className="text-ps-sm text-ps-mut">
                  <span className="ps-num">{r.jobs}</span> {r.jobs === 1 ? 'trabalho' : 'trabalhos'},{' '}
                  <span className="ps-num text-ps-base text-ps-bone">{fmtBRL(r.costBrl)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}

function Jobs({
  data,
  loading,
  onNavigate,
  onPage,
}: {
  data: AiCosts
  loading: boolean
  onNavigate: Navigate
  onPage: (page: number) => void
}) {
  const id = useId()
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
  const showPages = data.page > 1 || lastPage > 1
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone">
          Trabalhos
        </h3>
        <span className="text-ps-base text-ps-mut">
          <span className="ps-num">{data.total}</span> no período, do mais novo pro mais antigo
        </span>
      </div>
      {data.rows.length === 0 ? (
        <p className="text-ps-base text-ps-mut">{data.total === 0 ? 'Nenhum trabalho neste período.' : 'Nada nesta página.'}</p>
      ) : (
        <ul className="grid gap-ps-gap md:grid-cols-2">
          {data.rows.map((job) => (
            <JobRow key={job.replicateId} job={job} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
      {showPages && (
        <nav aria-label="Páginas dos trabalhos" className="flex flex-wrap items-center justify-between gap-ps-gap">
          <Button onClick={() => onPage(data.page - 1)} disabled={loading || data.page <= 1}>
            Mais novos
          </Button>
          <span className="ps-num text-ps-sm text-ps-mut">{`Página ${data.page} de ${lastPage}`}</span>
          <Button onClick={() => onPage(data.page + 1)} disabled={loading || data.page >= lastPage}>
            Anteriores
          </Button>
        </nav>
      )}
    </section>
  )
}

function JobRow({ job, onNavigate }: { job: AiJob; onNavigate: Navigate }) {
  return (
    <li>
      <Panel className="flex h-full flex-col gap-1.5 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="ps-num text-ps-base text-ps-bone">{fmtDateTimeBR(job.createdAt)}</span>
          <span className="text-ps-sm font-bold text-ps-mut">{statusLabel(job.status)}</span>
        </div>
        <Account userId={job.userId} email={job.email} onNavigate={onNavigate} />
        <p className="flex flex-wrap gap-x-3 text-ps-sm text-ps-mut">
          <span>{modelLabel(job.model, job.stemCount)}</span>
          <span>
            tempo <span className="ps-num">{fmtSeconds(job.predictSeconds)}</span>
          </span>
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-ps-base">
          {/* Com dólar e sem real conta como sem custo: o dólar sozinho não aparece, como na soma.
              Âmbar só no que a varredura ainda completa; o já tentado sem preço fica neutro. */}
          {hasCost(job) ? (
            <>
              <span className="ps-num text-ps-bone">{fmtBRL(job.costBrl)}</span>
              <span className="ps-num text-ps-sm text-ps-mut">{fmtUSD(job.costUsd)}</span>
              {job.fxDate && (
                <span className="text-ps-sm text-ps-mut">
                  PTAX de <span className="ps-num">{fmtDay(job.fxDate)}</span>
                </span>
              )}
            </>
          ) : job.costPending ? (
            <span className="text-ps-alert">sem custo</span>
          ) : (
            <span className="text-ps-mut">sem preço conhecido</span>
          )}
        </p>
        <p className="ps-num text-ps-sm text-ps-mut break-all">{job.replicateId}</p>
      </Panel>
    </li>
  )
}

function Basis({ fx, prices }: { fx: AiCosts['fx']; prices: AiCosts['prices'] }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <Panel className="flex flex-col gap-2 p-4">
        <h3 id={id} className="text-ps-md font-bold text-ps-bone">
          Câmbio e preço
        </h3>
        <p className="text-ps-base text-ps-bone break-words">{fxText(fx)}</p>
        <p className="text-ps-base text-ps-bone break-words">Cada trabalho usa a PTAX do próprio dia.</p>
        <p className="text-ps-base text-ps-bone break-words">
          Preço do hardware conferido em <span className="ps-num">{fmtDay(prices.checkedAt)}</span> ({sourceLabel(prices.source)})
        </p>
        {prices.table.length > 0 && (
          <ul className="flex flex-col">
            {prices.table.map((p) => (
              <li key={p.hardware} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-ps-line py-1.5 first:border-t-0">
                <span className="ps-num text-ps-base text-ps-bone break-all">{p.hardware}</span>
                <span className="text-ps-sm text-ps-mut">
                  <span className="ps-num text-ps-base text-ps-bone">
                    {typeof p.usdPerSecond === 'number' ? USD_PER_SECOND.format(p.usdPerSecond) : EMPTY}
                  </span>{' '}
                  por segundo
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}

const ACCOUNT_LINK =
  'inline-flex max-w-full min-h-ps-touch items-center rounded-ps-sm text-left text-ps-base text-ps-bone underline underline-offset-2 decoration-ps-line-3 break-all hover:text-ps-or focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/** E-mail da conta, que abre a ficha em Assinantes; sem conta, `conta excluída`. */
function Account({ userId, email, onNavigate }: { userId: string | null; email: string | null; onNavigate: Navigate }) {
  if (userId === null) return <span className="text-ps-base text-ps-mut">conta excluída</span>
  if (!email) return <span className="text-ps-base text-ps-mut">{EMPTY}</span>
  return (
    <button type="button" className={ACCOUNT_LINK} onClick={() => onNavigate('subscribers', { userId })}>
      {email}
    </button>
  )
}
