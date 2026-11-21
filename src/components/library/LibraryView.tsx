// Biblioteca na Nuvem na linguagem do palco (Parte 3): a janela do palco (StageDialog lg) com a
// busca, as abas, os estados de carregando e vazio e o rodapé. Só props: o LibraryModal guarda os
// hooks e a lógica de antes (buscar, baixar, editar, excluir).
import { useId } from 'react'
import type React from 'react'
import { Cloud, Loader2, RefreshCcw } from 'lucide-react'
import { StageDialog } from '../stage/StageDialog'
import { Button, Notice, SearchField, TabPanel, Tabs } from '../ui'
import { LIBRARY_COPY } from './libraryRows'
import type { LibraryTab } from './libraryRows'

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
  /** Erro da última ação (salvar a edição), em alerta dentro da janela. */
  message?: string | null
  /** As músicas da aba. */
  children?: React.ReactNode
}

const TABS: { value: LibraryTab; label: string }[] = [
  { value: 'platform', label: LIBRARY_COPY.platform },
  { value: 'personal', label: LIBRARY_COPY.personal },
]

export function LibraryView({ open, onClose, onRefresh, query, onQuery, tab, onTab, loading, countText, emptyText, message, children }: LibraryViewProps) {
  const tabsId = useId()
  return (
    <StageDialog
      open={open}
      title={LIBRARY_COPY.title}
      onClose={onClose}
      size="lg"
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
        </div>
        {message ? <Notice tone="alert" role="alert">{message}</Notice> : null}
        <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-2">
          {loading ? (
            <div role="status" className="flex flex-col items-center gap-3 py-10 text-ps-mut">
              <Loader2 size={24} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              <span>{LIBRARY_COPY.loading}</span>
            </div>
          ) : emptyText !== null ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-ps-mut">
              <Cloud size={36} aria-hidden="true" className="text-ps-dim" />
              <p>{emptyText}</p>
            </div>
          ) : (
            children
          )}
        </TabPanel>
      </div>
    </StageDialog>
  )
}
