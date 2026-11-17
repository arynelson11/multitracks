// Aba Registro: quem fez o quê no admin, quando, em qual conta, o antes e o depois e o resultado,
// do mais novo pro mais antigo, em páginas de 50. Com userId mostra só o registro dessa conta.
import { useId, useState } from 'react'
import { Button, Chip, Panel } from '../../components/ui'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { fmtDateTimeBR } from '../lib/fmt'
import { accountLabel, actionLabel, displayResult, entryMessage, jsonText } from '../lib/auditText'
import type { AuditEntry, AuditPage } from '../lib/auditTypes'
import type { TabProps } from '../lib/tabs'

// Teto de página do servidor (?action=audit aceita de 1 a 1000).
const MAX_PAGE = 1000

export function AuditTab({ userId }: TabProps & { userId?: string }) {
  // Trocar de conta volta pra primeira página.
  const [view, setView] = useState({ userId, page: 1 })
  const page = view.userId === userId ? view.page : 1
  const goTo = (next: number) => setView({ userId, page: next })
  const { data, loading, error, refetch } = useAdminQuery<AuditPage>('audit', { page, userId })

  const errorBox = error && (
    <div className="flex flex-wrap items-center gap-ps-gap">
      <p role="alert" className="text-ps-base text-ps-alert">
        {error}
      </p>
      <Button onClick={() => void refetch()}>Tentar de novo</Button>
    </div>
  )

  if (!data) {
    return errorBox || <p role="status" className="text-ps-base text-ps-mut">Carregando...</p>
  }

  const lastPage = Math.min(MAX_PAGE, Math.max(1, Math.ceil(data.total / data.pageSize)))
  const showPages = page > 1 || lastPage > 1

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-ps-md font-bold text-ps-bone">{userId ? 'Registro desta conta' : 'Registro'}</h2>
        <p className="text-ps-sm text-ps-mut">
          <span className="ps-num">{data.total}</span> {data.total === 1 ? 'ação registrada' : 'ações registradas'}, do mais
          novo pro mais antigo.
        </p>
      </header>
      {errorBox}
      {data.rows.length === 0 ? (
        <p className="text-ps-base text-ps-mut">{data.total === 0 ? 'Nenhuma ação registrada ainda.' : 'Nada nesta página.'}</p>
      ) : (
        <ul aria-busy={loading} className={loading ? 'flex flex-col gap-ps-gap opacity-60' : 'flex flex-col gap-ps-gap'}>
          {data.rows.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {showPages && (
        <nav aria-label="Páginas do registro" className="flex flex-wrap items-center justify-between gap-ps-gap">
          <Button onClick={() => goTo(page - 1)} disabled={loading || page <= 1}>
            Mais novos
          </Button>
          <span className="ps-num text-ps-sm text-ps-mut">{`Página ${data.page} de ${lastPage}`}</span>
          <Button onClick={() => goTo(page + 1)} disabled={loading || page >= lastPage}>
            Anteriores
          </Button>
        </nav>
      )}
    </section>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const result = displayResult(entry)
  const message = entryMessage(entry)

  return (
    <li>
      <Panel className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-ps-base font-bold text-ps-bone">{actionLabel(entry.action)}</p>
            <p className="text-ps-sm text-ps-mut break-all">{accountLabel(entry)}</p>
          </div>
          {/* Só mostra o resultado: fora da ordem do Tab, nada acontece no clique. */}
          <Chip small on={result.tone === 'on'} tabIndex={-1}>
            <span className={result.tone === 'alert' ? 'text-ps-alert' : undefined}>{result.label}</span>
          </Chip>
        </div>
        <p className="flex flex-wrap gap-x-2 text-ps-sm text-ps-mut">
          <span className="ps-num">{fmtDateTimeBR(entry.createdAt)}</span>
          <span className="break-all">por {entry.adminEmail}</span>
        </p>
        {message && <p className="text-ps-sm text-ps-bone">{message}</p>}
        {entry.note && <p className="text-ps-sm text-ps-mut break-words">Nota: {entry.note}</p>}
        <Button
          tone="ghost"
          className="self-start"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Esconder antes e depois' : 'Ver antes e depois'}
        </Button>
        {open && (
          <div id={detailsId} className="grid gap-ps-gap md:grid-cols-2">
            <JsonBlock label="Antes" value={entry.before} />
            <JsonBlock label="Depois" value={entry.after} />
          </div>
        )}
      </Panel>
    </li>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="ps-label">{label}</span>
      <pre className="ps-num text-ps-sm text-ps-bone whitespace-pre-wrap break-all rounded-ps-md bg-ps-well p-2 inset-ring inset-ring-ps-line">
        {jsonText(value)}
      </pre>
    </div>
  )
}
