import { useId, useRef, useState } from 'react'
import type React from 'react'
import { Button } from './Button'
import type { ButtonTone } from './Button'
import { cx } from './cx'

export interface FilePickerProps {
  /** Texto do botão (ex.: "Carregar áudio"). */
  label: string
  /** Arquivos escolhidos no seletor ou soltos na área (só os que o `accept` aceita; um só sem `multiple`). */
  onFiles(files: File[]): void
  accept?: string
  multiple?: boolean
  /** Nome do que foi escolhido, de quem chama (fica ao lado do botão). */
  fileName?: string | null
  /** Com ele e com `fileName`, aparece o botão de tirar. */
  onClear?(): void
  clearLabel?: string
  /** Arquivos soltos que o `accept` recusou (pra tela avisar). */
  onReject?(files: File[]): void
  help?: React.ReactNode
  /** Área de soltar em volta (padrão: ligada). */
  droppable?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  tone?: ButtonTone
  id?: string
  className?: string
}

/** O arquivo passa no `accept` (extensões como ".mp3", tipos como "audio/*" ou "image/png")? */
function accepts(accept: string | undefined, file: File): boolean {
  const rules = (accept ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  if (rules.length === 0) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return rules.some((r) => (r.startsWith('.') ? name.endsWith(r) : r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r))
}

// A borda tracejada e o fundo saem do estado (parado x arrastando por cima), pra variação não disputar com a base.
const ZONE = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-ps-lg transition-colors duration-150 motion-reduce:transition-none'
const ZONE_IDLE = 'border border-dashed border-ps-line-2 p-3'
const ZONE_OVER = 'border border-dashed border-ps-or-line bg-ps-or-soft p-3'

/** Escolher arquivo: botão do kit que abre o seletor do sistema, o nome escolhido ao lado, Tirar e arrastar e soltar. */
export function FilePicker({
  label, onFiles, accept, multiple = false, fileName, onClear, clearLabel = 'Tirar', onReject, help,
  droppable = true, disabled = false, icon, tone = 'default', id, className,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const helpId = useId()

  const take = (all: File[]) => {
    const ok = all.filter((f) => accepts(accept, f))
    const rejected = all.filter((f) => !accepts(accept, f))
    const chosen = multiple ? ok : ok.slice(0, 1)
    if (chosen.length > 0) onFiles(chosen)
    if (rejected.length > 0) onReject?.(rejected)
  }

  const zoneEvents = droppable
    ? {
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
          if (disabled) return
          e.preventDefault()
          if (!over) setOver(true)
        },
        onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        },
        onDrop: (e: React.DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          setOver(false)
          if (disabled) return
          take(Array.from(e.dataTransfer?.files ?? []))
        },
      }
    : {}

  return (
    <div {...zoneEvents} className={cx(ZONE, droppable && (over ? ZONE_OVER : ZONE_IDLE), className)}>
      <Button tone={tone} icon={icon} disabled={disabled} onClick={() => inputRef.current?.click()} aria-describedby={help != null ? helpId : undefined}>
        {label}
      </Button>
      <input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        tabIndex={-1}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) take(files)
          // Limpa pra poder escolher o mesmo arquivo de novo.
          e.target.value = ''
        }}
      />
      <span aria-live="polite" className="min-w-0 flex-1 basis-40 break-all text-ps-base leading-snug">
        {fileName ? (
          <span className="font-semibold text-ps-bone">{fileName}</span>
        ) : droppable ? (
          <span className="text-ps-mut pointer-coarse:hidden">{multiple ? 'ou arraste os arquivos aqui' : 'ou arraste o arquivo aqui'}</span>
        ) : null}
      </span>
      {fileName && onClear && (
        <Button tone="ghost" onClick={onClear} disabled={disabled}>
          {clearLabel}
        </Button>
      )}
      {help != null && <p id={helpId} className="basis-full text-ps-base leading-snug text-pretty text-ps-mut">{help}</p>}
    </div>
  )
}
