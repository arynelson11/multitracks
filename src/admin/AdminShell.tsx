// Casca do admin na linguagem nova: topo com a marca, o e-mail e a saída, e as abas.
// Dentro do app (com onClose) a saída é "Voltar ao app"; na web em /admin, "Sair".
import { useId, useRef } from 'react'
import type React from 'react'
import { PlaybackStudioWordmark } from '../components/brand/PlaybackStudioWordmark'
import { Button, Chip, Led } from '../components/ui'
import type { AdminTabId } from './lib/tabs'
import type { ReviewQueue } from './lib/reviewTypes'

type ShellTab = { id: AdminTabId; label: string }

type AdminShellProps = {
  email: string | null
  tabs: ShellTab[]
  active: AdminTabId
  onSelect: (id: AdminTabId) => void
  onClose?: () => void
  onSignOut: () => void
  reviewCount: ReviewQueue['counts'] | null
  children?: React.ReactNode
}

export function AdminShell({ email, tabs, active, onSelect, onClose, onSignOut, reviewCount, children }: AdminShellProps) {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const tabId = (id: AdminTabId) => `${baseId}-tab-${id}`
  const panelId = `${baseId}-panel`

  // Setas, Home e End andam entre as abas e já abrem a escolhida (padrão de abas do WAI-ARIA).
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1
    let next: number
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else return
    e.preventDefault()
    onSelect(tabs[next].id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="min-h-screen bg-ps-ink text-ps-bone font-ps-sans">
      <header className="sticky top-0 z-10 bg-ps-ink border-b border-ps-line">
        {/* Mesma largura do conteúdo, pra marca, abas e tela começarem na mesma coluna. */}
        <div className="mx-auto max-w-6xl">
          {/* Marca e saída numa linha; o e-mail, que pode ser comprido, ganha a linha de baixo inteira.
              O pt-1 das abas deixa espaço pro anel de foco, que a rolagem cortaria. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 px-ps-gutter pt-1">
            <div className="flex min-h-ps-touch items-center gap-2">
              <PlaybackStudioWordmark size="sm" />
              <span className="ps-label">Admin</span>
            </div>
            {onClose ? (
              <Button tone="ghost" onClick={onClose}>
                Voltar ao app
              </Button>
            ) : (
              <Button tone="ghost" onClick={onSignOut}>
                Sair
              </Button>
            )}
          </div>
          {email && <p className="px-ps-gutter pb-2 text-ps-sm text-ps-mut break-all">{email}</p>}
          <div ref={listRef} role="tablist" aria-label="Áreas do admin" className="flex gap-ps-gap overflow-x-auto px-ps-gutter pt-1 pb-3">
            {tabs.map((t, i) => {
              const selected = t.id === active
              const isReview = t.id === 'review'
              return (
                <Chip
                  key={t.id}
                  id={tabId(t.id)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  on={selected}
                  onClick={() => onSelect(t.id)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                >
                  {t.label}
                  {isReview && reviewCount && reviewCount.total > 0 && <span className="ps-num">{reviewCount.total}</span>}
                  {isReview && reviewCount && reviewCount.manual > 0 && <Led state="alert" size="sm" label="Precisa de você" />}
                </Chip>
              )
            })}
          </div>
        </div>
      </header>
      <main id={panelId} role="tabpanel" aria-labelledby={tabId(active)} className="mx-auto max-w-6xl px-ps-gutter py-4">
        {children}
      </main>
    </div>
  )
}
