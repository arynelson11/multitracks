import type React from 'react'
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'
import { AUDIO_FILE_ACCEPT } from '../../lib/uploadContentType'
import { PlayMark } from '../brand/PlayMark'
import { Icon } from '../stage/icons'
import { TwoTapTrashButton } from '../stage/TwoTapTrashButton'
import { Button, FilePicker, Panel, Tag } from '../ui'
import { HOME_COPY, savedCount, separationDate, separationMeta } from './separatorCopy'
import { stemColor } from '../../lib/separation/voiceGuide'

export interface SeparatorHomeProps {
  separations: readonly SavedSeparation[]
  loading: boolean
  onBack(): void
  onPickFile(file: File): void
  onOpen(sep: SavedSeparation): void
  onDelete(id: string): void
  /** O GuidedTour, quando é a primeira vez. */
  tour?: React.ReactNode
  /** Frase de erro no topo (falha no processamento, falha ao abrir no palco). */
  notice?: React.ReactNode
}

/** Entrada do Separador: carregar o áudio e "Minhas separações", na linguagem do palco. */
export function SeparatorHome({ separations, loading, onBack, onPickFile, onOpen, onDelete, tour, notice }: SeparatorHomeProps) {
  return (
    <div data-separator-home className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone">
      {tour}
      <header className="flex shrink-0 items-center border-b border-ps-line bg-ps-ink-0 px-ps-gutter py-1">
        <Button tone="ghost" icon={<Icon name="chl" />} onClick={onBack}>{HOME_COPY.back}</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-ps-gutter py-8">
          {notice}
          <div className="flex min-w-0 items-center gap-3">
            <PlayMark size="md" />
            <div className="min-w-0">
              <h1 className="text-ps-lg font-extrabold leading-tight text-ps-bone">{HOME_COPY.title}</h1>
              <p className="text-ps-base leading-snug text-ps-mut">{HOME_COPY.subtitle}</p>
            </div>
          </div>

          <Panel variant="raised" data-tour="sep-upload" className="flex flex-col gap-3 p-5">
            <FilePicker
              label={HOME_COPY.upload}
              tone="primary"
              accept={AUDIO_FILE_ACCEPT}
              help={HOME_COPY.uploadHelp}
              onFiles={([f]) => { if (f) onPickFile(f) }}
            />
          </Panel>

          <section data-tour="sep-biblioteca" aria-labelledby="sep-biblioteca-titulo" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="sep-biblioteca-titulo" className="text-ps-md font-bold text-ps-bone">{HOME_COPY.library}</h2>
              <span className="ps-num text-ps-sm text-ps-mut">{savedCount(separations.length)}</span>
            </div>

            {loading ? (
              <p role="status" className="py-8 text-center text-ps-base text-ps-mut">{HOME_COPY.loading}</p>
            ) : separations.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-8 text-center">
                <p className="text-ps-base text-ps-mut">{HOME_COPY.emptyTitle}</p>
                <p className="text-ps-base text-ps-dim">{HOME_COPY.emptyBody}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {separations.map((sep) => {
                  const name = sep.songName || HOME_COPY.untitled
                  return (
                    <li key={sep.id}>
                      <Panel
                        data-separation-id={sep.id}
                        onClick={() => onOpen(sep)}
                        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 p-3 hover:inset-ring-ps-line-2"
                      >
                        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
                          <span className="break-words text-ps-base font-bold leading-snug text-ps-bone">{name}</span>
                          {sep.artist && <span className="break-words text-ps-sm text-ps-mut">{sep.artist}</span>}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {separationMeta(sep).map((m) => <Tag key={m} num>{m}</Tag>)}
                            <span className="flex items-center gap-1" aria-hidden="true">
                              {sep.stems.slice(0, 6).map((s, i) => (
                                <span key={i} className="size-2.5 rounded-full" style={{ backgroundColor: stemColor(s) }} title={s.name} />
                              ))}
                              {sep.stems.length > 6 && <span className="ps-num text-ps-micro text-ps-dim">+{sep.stems.length - 6}</span>}
                            </span>
                            <span className="ps-num text-ps-sm text-ps-dim">{separationDate(sep.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button onClick={(e) => { e.stopPropagation(); onOpen(sep) }}>{HOME_COPY.open}</Button>
                          {/* A lixeira nunca abre o cartão. */}
                          <span onClick={(e) => e.stopPropagation()}>
                            <TwoTapTrashButton
                              label={`Excluir ${name}`}
                              confirmLabel={`Toque de novo para excluir ${name}`}
                              armedText="Excluir?"
                              onConfirm={() => onDelete(sep.id)}
                            />
                          </span>
                        </div>
                      </Panel>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
