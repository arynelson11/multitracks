// Biblioteca na Nuvem na linguagem do palco (Parte 3): a janela do palco (StageDialog lg) com a
// busca, as abas, as músicas (baixar, editar e excluir), os estados de carregando e vazio e o
// rodapé, e a confirmação de excluir numa segunda janela por cima. Só props: o LibraryModal guarda
// os hooks e a lógica de antes (buscar, baixar, editar, excluir).
import { useId } from 'react'
import type React from 'react'
import { Cloud, Download, Loader2, Music, RefreshCcw, Save } from 'lucide-react'
import { Icon } from '../stage/icons'
import { StageDialog } from '../stage/StageDialog'
import { Button, FilePicker, IconButton, Notice, Panel, SearchField, TabPanel, Tabs, Tag, TextField } from '../ui'
import { DELETE_COPY, EDIT_COPY, LIBRARY_COPY, ROW_COPY } from './libraryRows'
import type { LibraryEdit, LibraryRow, LibraryTab, RemoveScope } from './libraryRows'

export interface LibraryViewProps {
  open: boolean
  onClose(): void
  onRefresh(): void
  query: string
  onQuery(q: string): void
  tab: LibraryTab
  onTab(t: LibraryTab): void
  loading: boolean
  countText: string
  /** Frase da lista vazia (nulo: há músicas na aba). */
  emptyText: string | null
  /** Erro da última ação (salvar a edição), em alerta dentro da janela (no formulário, quando ele está aberto). */
  message?: string | null
  /** A frase do baixar que nem começou (sem espaço no aparelho): sempre no alto, presa com a busca e
   *  as abas, mesmo com uma edição aberta, e separada do erro da edição (Ruling INICIO-residuais). */
  downloadNotice?: string | null
  /** As músicas da aba. */
  rows: readonly LibraryRow[]
  /** Alguma música baixando: o Importar e o Abrir das outras esperam. */
  anyDownloading: boolean
  /** A edição aberta (nulo: nenhuma). */
  edit: LibraryEdit | null
  savingEdit: boolean
  onImport(id: string, name: string): void
  onCancel(id: string): void
  onEdit(id: string): void
  onEditChange(p: Partial<LibraryEdit>): void
  onEditSave(): void
  onEditClose(): void
  onAskDelete(id: string): void
  /** A confirmação da lixeira aberta (nulo: fechada): da nuvem ou deste aparelho. */
  confirmDelete: { name: string; scope: RemoveScope; busy: boolean } | null
  onConfirmDelete(): void
  onCancelDelete(): void
}

const TABS: { value: LibraryTab; label: string }[] = [
  { value: 'platform', label: LIBRARY_COPY.platform },
  { value: 'personal', label: LIBRARY_COPY.personal },
]

const spinner = (size: number, label?: string) => (
  <Loader2 size={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0 animate-spin motion-reduce:animate-none" />
)

function Cover({ url, name }: { url: string | null; name: string }) {
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-ps-md bg-ps-s2 inset-ring inset-ring-ps-line">
      {url ? <img src={url} alt={name} loading="lazy" className="size-full object-cover" /> : <Music size={16} aria-hidden="true" className="text-ps-dim" />}
    </div>
  )
}

/** O botão de baixar da música, pelo estado (a ordem é a de antes, em downloadStateOf). */
function DownloadAction({ row, anyDownloading, onImport, onCancel }: { row: LibraryRow; anyDownloading: boolean; onImport(id: string, name: string): void; onCancel(id: string): void }) {
  switch (row.state) {
    case 'downloading':
      return (
        <div role="status" className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-ps-mut">
          {spinner(16, ROW_COPY.downloading)}
          {row.progress ? <span className="ps-num min-w-0 text-ps-sm break-words">{row.progress}</span> : null}
          <Button tone="ghost" title={ROW_COPY.cancelTitle} onClick={() => onCancel(row.id)}>{ROW_COPY.cancel}</Button>
        </div>
      )
    case 'added':
      return <Tag data-added=""><Icon name="check" className="size-3" />{ROW_COPY.added}</Tag>
    case 'offline':
      // O botão desligado não mostra a dica do mouse: ela fica na volta dele.
      return <span title={ROW_COPY.offlineTitle} className="inline-flex cursor-not-allowed"><Button disabled>{ROW_COPY.offline}</Button></span>
    case 'open':
      return <Button icon={<Icon name="cloud" className="size-4" />} title={ROW_COPY.openTitle} disabled={anyDownloading} onClick={() => onImport(row.id, row.name)}>{ROW_COPY.open}</Button>
    case 'import':
      return <Button tone="primary" icon={<Download size={16} />} title={ROW_COPY.importTitle} disabled={anyDownloading} onClick={() => onImport(row.id, row.name)}>{ROW_COPY.import}</Button>
  }
}

function Row({ row, p }: { row: LibraryRow; p: LibraryViewProps }) {
  const deleteLabel = row.remove === 'cloud' ? ROW_COPY.deleteCloud : ROW_COPY.deleteDevice
  return (
    <Panel data-library-row={row.id} className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        <Cover url={row.coverUrl} name={row.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-ps-md leading-snug font-bold break-words text-ps-bone">{row.name}</p>
          <p className="text-ps-base leading-snug break-words text-ps-mut">{row.artist || ROW_COPY.unknownArtist}</p>
          {(row.key || row.bpm !== undefined || row.cached) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {row.key ? <Tag>{ROW_COPY.key(row.key)}</Tag> : null}
              {row.bpm !== undefined ? <Tag num>{ROW_COPY.bpm(row.bpm)}</Tag> : null}
              {row.cached ? <Tag dot data-cached="">{ROW_COPY.cached}</Tag> : null}
            </div>
          )}
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {row.canEdit && <IconButton icon={<Icon name="edit" className="size-4" />} aria-label={ROW_COPY.edit} onClick={() => p.onEdit(row.id)} />}
        {row.remove !== null && (
          <IconButton
            icon={row.deleting ? spinner(16) : <Icon name="trash" className="size-4" />}
            aria-label={deleteLabel}
            aria-busy={row.deleting || undefined}
            disabled={row.deleting}
            onClick={() => p.onAskDelete(row.id)}
          />
        )}
        <DownloadAction row={row} anyDownloading={p.anyDownloading} onImport={p.onImport} onCancel={p.onCancel} />
      </div>
    </Panel>
  )
}

/** A edição na própria linha: Nome, Artista, BPM (aceita "72,5"), Tom e a capa nova. Esc fecha sem salvar. */
function EditForm({ edit, p }: { edit: LibraryEdit; p: LibraryViewProps }) {
  const titleId = useId()
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || p.savingEdit) return
    e.preventDefault()
    p.onEditClose()
  }
  return (
    <Panel variant="raised" role="group" aria-labelledby={titleId} data-library-edit={edit.id} onKeyDown={onKeyDown} className="flex flex-col gap-3 p-3 inset-ring-ps-line-2">
      <div className="flex items-center gap-2">
        <h3 id={titleId} className="min-w-0 flex-1 text-ps-md font-bold break-words text-ps-bone">{EDIT_COPY.title}</h3>
        <IconButton tone="ghost" icon={<Icon name="x" className="size-4" />} aria-label={EDIT_COPY.close} disabled={p.savingEdit} onClick={p.onEditClose} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={EDIT_COPY.name} value={edit.name} onChange={(e) => p.onEditChange({ name: e.target.value })} />
        <TextField label={EDIT_COPY.artist} value={edit.artist} onChange={(e) => p.onEditChange({ artist: e.target.value })} />
        <TextField label={EDIT_COPY.bpm} type="text" inputMode="decimal" autoComplete="off" inputClassName="ps-num" value={edit.bpmText} onChange={(e) => p.onEditChange({ bpmText: e.target.value })} />
        <TextField label={EDIT_COPY.key} value={edit.key} onChange={(e) => p.onEditChange({ key: e.target.value })} />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-ps-sm font-bold text-ps-mut">{EDIT_COPY.cover}</span>
          <FilePicker
            label={EDIT_COPY.coverPick} accept="image/*" fileName={edit.file?.name ?? null}
            onFiles={([f]) => p.onEditChange({ file: f ?? null })} onClear={() => p.onEditChange({ file: null })}
          />
        </div>
      </div>
      {p.message ? <Notice tone="alert" role="alert">{p.message}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="primary" icon={p.savingEdit ? spinner(16) : <Save size={16} />} aria-busy={p.savingEdit || undefined} disabled={p.savingEdit} onClick={p.onEditSave}>
          {EDIT_COPY.save}
        </Button>
      </div>
    </Panel>
  )
}

export function LibraryView(p: LibraryViewProps) {
  const { open, onClose, onRefresh, query, onQuery, tab, onTab, loading, countText, emptyText, message, downloadNotice, rows, edit, confirmDelete } = p
  const tabsId = useId()
  return (
    <>
      <StageDialog
        open={open}
        title={LIBRARY_COPY.title}
        onClose={onClose}
        size="lg"
        // Editando, Esc e toque fora não jogam fora o que foi digitado: o Esc fecha só a edição.
        dismissible={edit === null}
        footer={<span data-library-count className="ps-num mr-auto self-center text-ps-sm text-ps-mut">{countText}</span>}
      >
        <div data-library className="flex flex-col gap-3">
          {/* Busca e abas ficam no alto enquanto a lista rola. */}
          <div className="sticky -top-1 z-10 -mx-1 flex flex-col gap-3 bg-ps-pop px-1 pt-1 pb-2">
            <div className="flex flex-wrap items-end gap-2">
              <SearchField
                label={LIBRARY_COPY.search}
                placeholder={LIBRARY_COPY.searchPlaceholder}
                value={query}
                onChange={onQuery}
                className="min-w-0 flex-1 basis-56"
              />
              <Button icon={<RefreshCcw size={14} />} title={LIBRARY_COPY.refreshTitle} onClick={onRefresh}>{LIBRARY_COPY.refresh}</Button>
            </div>
            <Tabs id={tabsId} aria-label={LIBRARY_COPY.tabs} tabs={TABS} value={tab} onChange={onTab} />
            {downloadNotice ? <Notice tone="alert" role="alert">{downloadNotice}</Notice> : null}
          </div>
          {message && edit === null ? <Notice tone="alert" role="alert">{message}</Notice> : null}
          <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-2">
            {loading ? (
              <div role="status" className="flex flex-col items-center gap-3 py-10 text-ps-mut">
                {spinner(24)}
                <span>{LIBRARY_COPY.loading}</span>
              </div>
            ) : emptyText !== null ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center text-ps-mut">
                <Cloud size={36} aria-hidden="true" className="text-ps-dim" />
                <p>{emptyText}</p>
              </div>
            ) : (
              rows.map((row) => (edit?.id === row.id ? <EditForm key={row.id} edit={edit} p={p} /> : <Row key={row.id} row={row} p={p} />))
            )}
          </TabPanel>
        </div>
      </StageDialog>
      {/* A lixeira: uma segunda janela por cima (pilha do palco), com o aviso escrito. */}
      <StageDialog
        open={open && confirmDelete !== null}
        title={DELETE_COPY.title(confirmDelete?.scope ?? 'cloud')}
        onClose={p.onCancelDelete}
        size="sm"
        closeDisabled={confirmDelete?.busy ?? false}
        footer={(
          <>
            <Button tone="ghost" disabled={confirmDelete?.busy} onClick={p.onCancelDelete}>{DELETE_COPY.cancel}</Button>
            <Button
              tone="alert"
              icon={confirmDelete?.busy ? spinner(16) : <Icon name="trash" className="size-4" />}
              aria-busy={confirmDelete?.busy || undefined}
              disabled={confirmDelete?.busy}
              onClick={p.onConfirmDelete}
            >
              {DELETE_COPY.confirmLabel(confirmDelete?.scope ?? 'cloud')}
            </Button>
          </>
        )}
      >
        {confirmDelete ? <p className="leading-relaxed text-ps-bone">{DELETE_COPY.body(confirmDelete.name, confirmDelete.scope)}</p> : null}
      </StageDialog>
    </>
  )
}
