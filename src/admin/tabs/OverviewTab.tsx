// Aba Visão geral: o mês de Brasília em quatro números (recebido, MRR, custo de IA e margem), os
// assinantes por plano, os cancelamentos por motivo e os alertas, cada um levando pra aba que resolve.
// * Os números chegam prontos do servidor (?action=overview). Valor que falta aparece como
//   `sem dado`, nunca como 0, e resposta fora do formato mostra a frase pronta com Tentar de novo
//   (Ruling ADM-T7-forma).
// * Número que parece certo e está errado avisa (Review Focus 4): trabalho sem custo fica fora da
//   soma e é contado à parte no custo e na margem; assinatura antiga sem registro fica fora do MRR e
//   a tela diz; câmbio com mais de 4 dias, ou sem câmbio, acende o alerta e a linha do câmbio em
//   âmbar, sempre com a data.
// * O total de Pendências e o Led da aba ficam na casca (AdminShell); aqui só os alertas do mês.
import { useId } from 'react'
import type React from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Button, Led, Panel } from '../../components/ui'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { EMPTY, cancelSourceLabel, fmtBRL, fmtDay, fmtUSD, planLabel } from '../lib/fmt'
import { amountOf, countEntries, countOf, isOverview, type CountEntry, type Overview } from '../lib/overviewTypes'
import type { AdminTabId, TabProps } from '../lib/tabs'

const MSG_BAD_SHAPE = 'Não deu pra carregar a visão geral. Tente de novo.'
const MARGIN_NOTE = 'receita líquida menos IA; sem R2, Supabase e Vercel'
// O MRR é feito pela tabela de preços, não pelo que o Asaas cobra (aviso do coordenador na T20).
const MRR_NOTE = 'Pela tabela de preços: assinaturas pagas que renovam, o anual dividido por 12.'
const MRR_DRIFT = 'Pode diferir do cobrado se o preço mudar ou se a assinatura for editada no painel do Asaas.'
// A linha mostra o câmbio guardado mais recente; cada trabalho usa o do próprio dia (D16 e aviso T20).
const FX_SOURCE = '(PTAX de venda do Banco Central, sem IOF nem spread).'
const FX_PER_JOB = 'Cada trabalho usa o câmbio do próprio dia.'

const ALERT_BOX = 'rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words'
const ALERT_BUTTON =
  'flex w-full min-h-ps-touch items-center gap-3 rounded-ps-lg bg-ps-alert-soft px-ps-pad-x py-2 text-left text-ps-base font-bold text-ps-alert inset-ring inset-ring-ps-alert-line hover:inset-ring-ps-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const LINK_BUTTON =
  'inline-flex max-w-full min-h-ps-touch items-center self-start rounded-ps-sm text-left text-ps-base text-ps-bone underline underline-offset-2 decoration-ps-line-3 break-words hover:text-ps-or focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const NOTE = 'text-ps-sm text-ps-mut break-words'
const NOTE_ALERT = 'text-ps-sm text-ps-alert break-words'

// Quantidade com ponto de milhar (1.234), como o dinheiro.
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const fmtInt = (n: number): string => INT.format(n)
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const sumOf = (entries: CountEntry[] | null): number | null => entries?.reduce((total, e) => total + e.count, 0) ?? null

function Num({ children }: { children: React.ReactNode }) {
  return <span className="ps-num">{children}</span>
}

/** Quantidade com o nome no singular ou no plural; sem a quantidade, `sem dado` (ou `Nome: sem dado`). */
function Counted({ n, one, many, missing }: { n: number | null; one: string; many: string; missing?: string }) {
  if (n === null) return <>{missing ? `${missing}: ${EMPTY}` : EMPTY}</>
  return (
    <>
      <Num>{fmtInt(n)}</Num> {plural(n, one, many)}
    </>
  )
}

type AlertItem = { key: string; to: AdminTabId; content: React.ReactNode }

/** Dia do câmbio em dd/mm/aaaa, ou null sem data válida. */
function fxDay(fx: Overview['fx']): string | null {
  const day = typeof fx.date === 'string' ? fmtDay(fx.date) : EMPTY
  return day === EMPTY ? null : day
}

function fxAlert(fx: Overview['fx']): React.ReactNode {
  const day = fxDay(fx)
  if (!day) return 'Câmbio sem dado'
  const age = countOf(fx.ageDays)
  return (
    <>
      Câmbio velho: de <Num>{day}</Num>
      {age !== null && (
        <>
          , há <Num>{fmtInt(age)}</Num> {plural(age, 'dia', 'dias')}
        </>
      )}
    </>
  )
}

/** Os alertas do mês, na ordem do que mais pede o dono. Os números já vêm conferidos (isOverview). */
function alertsOf(o: Overview): AlertItem[] {
  const a = o.alerts
  const items: AlertItem[] = []
  const counted = (key: string, n: number, to: AdminTabId, one: string, many: string) => {
    if (n > 0) items.push({ key, to, content: <Counted n={n} one={one} many={many} /> })
  }
  counted('manual', a.manual, 'review', 'pendência precisa de você', 'pendências precisam de você')
  counted('auto', a.auto, 'review', 'aviso do Asaas ou pendência tentando sozinho', 'avisos do Asaas e pendências tentando sozinhos')
  counted('blocked', a.blockedWithActiveSub, 'subscribers', 'bloqueado com assinatura ativa', 'bloqueados com assinatura ativa')
  // Só o que a varredura ainda completa (Ruling ADM-sem-custo-visao); o sem preço conhecido não pede ação.
  counted('withoutCost', a.withoutCostPending, 'aicost', 'trabalho ainda sem custo no mês', 'trabalhos ainda sem custo no mês')
  if (a.fxOld) items.push({ key: 'fx', to: 'aicost', content: fxAlert(o.fx) })
  return items
}

export function OverviewTab({ onNavigate }: TabProps) {
  const query = useAdminQuery<Overview>('overview')
  const { loading, error, refetch } = query
  // Resposta fora do formato (servidor antigo, corpo de outra ação) vale como erro, nunca quebra o render.
  const data = isOverview(query.data) ? query.data : null

  if (!data) {
    if (loading) {
      return (
        <p role="status" className="text-ps-base text-ps-mut">
          Carregando...
        </p>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-ps-gap">
        <p role="alert" className="text-ps-base text-ps-alert break-words">
          {error ?? MSG_BAD_SHAPE}
        </p>
        <Button onClick={() => void refetch()}>Tentar de novo</Button>
      </div>
    )
  }

  const label = data.month.label.trim()
  const title = label && label !== EMPTY ? `Visão geral de ${label}` : 'Visão geral'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-ps-md font-bold text-ps-bone break-words">{title}</h2>
        <Button
          className="ml-auto"
          onClick={() => void refetch()}
          disabled={loading}
          icon={<RefreshCw size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />}
        >
          Atualizar
        </Button>
      </div>

      {error && (
        <p role="alert" className={ALERT_BOX}>
          {error}
        </p>
      )}

      <div aria-busy={loading} className={loading ? 'flex flex-col gap-5 opacity-60' : 'flex flex-col gap-5'}>
        <Alerts items={alertsOf(data)} onNavigate={onNavigate} />
        <Numbers data={data} />
        <div className="grid gap-ps-gap lg:grid-cols-3">
          <Subscribers data={data} onNavigate={onNavigate} />
          <Cancellations data={data} />
        </div>
      </div>
    </div>
  )
}

function Alerts({ items, onNavigate }: { items: AlertItem[]; onNavigate: TabProps['onNavigate'] }) {
  const id = useId()
  if (items.length === 0) return <p className="text-ps-base text-ps-mut">Nada pedindo atenção agora.</p>
  return (
    <section className="flex flex-col gap-2">
      <h3 id={id} className="text-ps-md font-bold text-ps-bone">
        Pedindo atenção
      </h3>
      <ul aria-labelledby={id} className="flex flex-col gap-ps-gap">
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" className={ALERT_BUTTON} onClick={() => onNavigate(item.to)}>
              <Led state="alert" />
              <span className="min-w-0 flex-1 break-words">{item.content}</span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NumberPanel({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  const id = useId()
  return (
    <Panel role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1 p-4">
      <p id={id} className="ps-label">
        {label}
      </p>
      <p className="ps-num text-ps-lg font-bold text-ps-bone break-words">{value}</p>
      {children}
    </Panel>
  )
}

function Numbers({ data }: { data: Overview }) {
  const { revenue, aiCost, fx, alerts } = data
  const refunds = countOf(revenue.refunds)
  const jobs = countOf(aiCost.jobs)
  const legacy = countOf(data.subscribers.legacyPaid)
  // As notas contam o total sem custo (fora da soma); o âmbar só acende com pendentes, como o alerta.
  const withoutCost = countOf(aiCost.withoutCost) ?? 0
  const withoutCostNote = alerts.withoutCostPending > 0 ? NOTE_ALERT : NOTE
  const rate = amountOf(fx.rate)
  const day = fxDay(fx)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-ps-gap sm:grid-cols-2 lg:grid-cols-4">
        <NumberPanel label="Recebido no mês" value={fmtBRL(amountOf(revenue.grossBrl))}>
          <p className="text-ps-base text-ps-bone break-words">
            Líquido <Num>{fmtBRL(amountOf(revenue.netBrl))}</Num>
          </p>
          <p className={NOTE}>
            <Counted n={countOf(revenue.payments)} one="pagamento" many="pagamentos" missing="Pagamentos" />
          </p>
          {refunds !== 0 && (
            <p className={NOTE}>
              <Counted n={refunds} one="estorno" many="estornos" missing="Estornos" />
              {refunds !== null && (
                <>
                  , <Num>{fmtBRL(amountOf(revenue.refundedBrl))}</Num>
                </>
              )}
            </p>
          )}
        </NumberPanel>

        <NumberPanel label="MRR" value={fmtBRL(amountOf(data.mrrBrl))}>
          <p className={NOTE}>{MRR_NOTE}</p>
          <p className={NOTE}>{MRR_DRIFT}</p>
          {legacy !== null && legacy > 0 && (
            <p className={NOTE_ALERT}>
              Não inclui <Counted n={legacy} one="assinatura antiga sem registro" many="assinaturas antigas sem registro" />.
            </p>
          )}
        </NumberPanel>

        <NumberPanel label="Custo de IA no mês" value={fmtBRL(amountOf(aiCost.costBrl))}>
          <p className={NOTE}>
            <Num>{fmtUSD(amountOf(aiCost.costUsd))}</Num>
            {jobs !== null && (
              <>
                {' '}
                em <Counted n={jobs} one="trabalho" many="trabalhos" />
              </>
            )}
          </p>
          {withoutCost > 0 && (
            <p className={withoutCostNote}>
              <Counted n={withoutCost} one="trabalho sem custo" many="trabalhos sem custo" />, fora da soma
            </p>
          )}
        </NumberPanel>

        <NumberPanel label="Margem do mês" value={fmtBRL(amountOf(data.marginBrl))}>
          <p className={NOTE}>{MARGIN_NOTE}</p>
          {withoutCost > 0 && (
            <p className={withoutCostNote}>
              Não inclui <Counted n={withoutCost} one="trabalho sem custo" many="trabalhos sem custo" />.
            </p>
          )}
        </NumberPanel>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className={alerts.fxOld ? 'text-ps-base text-ps-alert break-words' : 'text-ps-base text-ps-mut break-words'}>
          Câmbio guardado mais recente:{' '}
          {rate !== null && day ? (
            <>
              <Num>{fmtBRL(rate)}</Num> por US$ em <Num>{day}</Num>
            </>
          ) : (
            EMPTY
          )}{' '}
          {FX_SOURCE}
        </p>
        <p className={NOTE}>{FX_PER_JOB}</p>
      </div>
    </div>
  )
}

function Subscribers({ data, onNavigate }: { data: Overview; onNavigate: TabProps['onNavigate'] }) {
  const id = useId()
  const s = data.subscribers
  const legacy = countOf(s.legacyPaid)

  return (
    <Panel role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-4 p-4 lg:col-span-2">
      <h3 id={id} className="text-ps-md font-bold text-ps-bone">
        Assinantes
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <PlanGroup label="Pagando" entries={countEntries(s.activeByPlan)} />
        <PlanGroup label="Até o fim do período" entries={countEntries(s.endingByPlan)} />
        <PlanGroup label="Cortesia" entries={countEntries(s.courtesyByPlan)} />
      </div>
      <p className="text-ps-base text-ps-bone">
        No vermelho: <Counted n={countOf(s.overdueAccounts)} one="conta" many="contas" />
      </p>
      {legacy === null && <p className={NOTE}>{`Assinaturas antigas sem registro: ${EMPTY}`}</p>}
      {legacy !== null && legacy > 0 && (
        <div className="flex flex-col">
          <button type="button" className={LINK_BUTTON} onClick={() => onNavigate('subscribers')}>
            <span>
              <Counted n={legacy} one="assinatura antiga sem registro" many="assinaturas antigas sem registro" />
            </span>
          </button>
          <p className={NOTE}>Plano pago de antes da cobrança nova. Em Assinantes, aparecem como Para conferir.</p>
        </div>
      )}
    </Panel>
  )
}

function PlanGroup({ label, entries }: { label: string; entries: CountEntry[] | null }) {
  const id = useId()
  const total = sumOf(entries)
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <p className="flex items-baseline justify-between gap-2">
        <span id={id} className="min-w-0 text-ps-base font-bold text-ps-bone break-words">
          {label}
        </span>
        {total === null ? <span className="text-ps-base text-ps-mut">{EMPTY}</span> : <span className="ps-num text-ps-md text-ps-bone">{fmtInt(total)}</span>}
      </p>
      {entries && entries.length > 0 && (
        <ul className="flex flex-col">
          {entries.map((e) => (
            <li key={e.key} className="flex items-baseline justify-between gap-2 text-ps-sm text-ps-mut">
              <span className="min-w-0 break-words">{planLabel(e.key)}</span>
              <span className="ps-num">{fmtInt(e.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Cancellations({ data }: { data: Overview }) {
  const id = useId()
  const total = countOf(data.cancellations.total)
  const bySource = countEntries(data.cancellations.bySource)

  let body: React.ReactNode
  if (total === 0) body = <p className="text-ps-base text-ps-mut">Nenhum cancelamento no mês.</p>
  else if (!bySource || bySource.length === 0) body = <p className={NOTE}>{`Por motivo: ${EMPTY}`}</p>
  else {
    body = (
      <ul className="flex flex-col">
        {bySource.map((e) => (
          <li key={e.key} className="flex items-baseline justify-between gap-2 text-ps-base text-ps-bone">
            <span className="min-w-0 break-words">{capitalize(cancelSourceLabel(e.key))}</span>
            <span className="ps-num">{fmtInt(e.count)}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Panel role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={id} className="min-w-0 text-ps-md font-bold text-ps-bone break-words">
          Cancelamentos do mês
        </h3>
        {total === null ? <span className="text-ps-base text-ps-mut">{EMPTY}</span> : <span className="ps-num text-ps-md text-ps-bone">{fmtInt(total)}</span>}
      </div>
      {body}
    </Panel>
  )
}
