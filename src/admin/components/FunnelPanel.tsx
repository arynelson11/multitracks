// Funil do Livre na Visão geral (Parte 3): por mês, quantos se cadastraram, quantos fizeram a
// primeira separação, quantos viraram pagantes e em quantos dias, e as ofertas e os anúncios,
// do mais novo pro mais antigo (?action=funnel, últimos 6 meses).
// * A tabela rola de lado dentro da própria caixa: a página do admin nunca rola de lado.
// * Valor que falta (porcentagem de mês sem cadastro, mediana de mês sem pagante) aparece como
//   `sem dado`; resposta fora do formato mostra a frase pronta com Tentar de novo.
// * O painel pede o funil sozinho: um erro nele não derruba os números do mês.
import { useId } from 'react'
import type React from 'react'
import { Button, Panel } from '../../components/ui'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { EMPTY } from '../lib/fmt'
import { isFunnel, pctOf, type Funnel, type FunnelMonth } from '../lib/funnelTypes'

const TITLE = 'Funil do Livre'
const NOTE = 'Cadastros, primeira separação e pagantes contam pelo mês do cadastro; ofertas e anúncios, pelo mês em que aconteceram.'
const MSG_BAD_SHAPE = 'Não deu pra carregar o funil. Tente de novo.'
const PARAMS = { months: 6 }
const COLUMNS = ['Mês', 'Cadastros', '1ª separação', 'Pagantes', 'Dias até pagar', 'Ofertas vistas e usadas', 'Anúncios vistos e clicados']

// Primeira coluna encostada no título do painel e a última na borda de dentro; números à direita.
const CELL = 'px-3 py-2 first:pl-0 last:pr-0 whitespace-nowrap'
const HEAD = `${CELL} align-bottom text-right text-ps-sm font-bold text-ps-mut first:text-left`
const ROW_HEAD = `${CELL} text-left text-ps-base font-bold text-ps-bone`
const DATA = `${CELL} text-right text-ps-base text-ps-bone`

// Quantidade com ponto de milhar (1.234); dias com uma casa (2,5), como vem do servidor.
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const DAYS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function Num({ children }: { children: React.ReactNode }) {
  return <span className="ps-num">{children}</span>
}

function Missing() {
  return <span className="text-ps-mut">{EMPTY}</span>
}

/** Quantidade com o nome no singular ou no plural ("3 vistas"). */
function Counted({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <>
      <Num>{INT.format(n)}</Num> {plural(n, one, many)}
    </>
  )
}

/** Parte dos cadastros do mês com a porcentagem ("2 (67%)"); sem cadastro, "(sem dado)". */
function Part({ n, of }: { n: number; of: number }) {
  const pct = pctOf(n, of)
  return (
    <>
      <Num>{INT.format(n)}</Num> <span className="text-ps-mut">({pct === null ? EMPTY : <Num>{pct}</Num>})</span>
    </>
  )
}

function Days({ n }: { n: number | null }) {
  if (n === null) return <Missing />
  return (
    <>
      <Num>{DAYS.format(n)}</Num> {plural(n, 'dia', 'dias')}
    </>
  )
}

function MonthRow({ m }: { m: FunnelMonth }) {
  const label = m.label.trim()
  return (
    <tr className="border-t border-ps-line">
      <th scope="row" className={ROW_HEAD}>
        {label ? capitalize(label) : m.month}
      </th>
      <td className={DATA}>
        <Num>{INT.format(m.signups)}</Num>
      </td>
      <td className={DATA}>
        <Part n={m.firstSeparation} of={m.signups} />
      </td>
      <td className={DATA}>
        <Part n={m.paying} of={m.signups} />
      </td>
      <td className={DATA}>
        <Days n={m.medianDaysToPay} />
      </td>
      <td className={DATA}>
        <Counted n={m.offersShown} one="vista" many="vistas" />, <Counted n={m.offersUsed} one="usada" many="usadas" />
      </td>
      <td className={DATA}>
        <Counted n={m.adsShown} one="visto" many="vistos" />, <Counted n={m.adsClicked} one="clicado" many="clicados" />
      </td>
    </tr>
  )
}

function FunnelTable({ months, titleId }: { months: FunnelMonth[]; titleId: string }) {
  if (months.length === 0) return <p className="text-ps-base text-ps-mut">Nenhum mês pra mostrar.</p>
  return (
    <div className="overflow-x-auto">
      <table aria-labelledby={titleId} className="min-w-full border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((name) => (
              <th key={name} scope="col" className={HEAD}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <MonthRow key={m.month} m={m} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FunnelPanel() {
  const titleId = useId()
  const query = useAdminQuery<Funnel>('funnel', PARAMS)
  const { loading, error, refetch } = query
  // Resposta fora do formato (servidor antigo, corpo de outra ação) vale como erro, nunca quebra o render.
  const data = isFunnel(query.data) ? query.data : null

  let body: React.ReactNode
  if (data) body = <FunnelTable months={data.months} titleId={titleId} />
  else if (loading) {
    body = (
      <p role="status" className="text-ps-base text-ps-mut">
        Carregando...
      </p>
    )
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-ps-gap">
        <p role="alert" className="text-ps-base text-ps-alert break-words">
          {error ?? MSG_BAD_SHAPE}
        </p>
        <Button onClick={() => void refetch()}>Tentar de novo</Button>
      </div>
    )
  }

  return (
    <Panel role="group" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2 p-4">
      <h3 id={titleId} className="text-ps-md font-bold text-ps-bone break-words">
        {TITLE}
      </h3>
      <p className="text-ps-sm text-ps-mut break-words">{NOTE}</p>
      {body}
    </Panel>
  )
}
