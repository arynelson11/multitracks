// Confirmação de uma ação do admin: o que vai acontecer, uma nota (quando a ação pede) e o
// erro do servidor dentro do próprio diálogo. Uma trava interna segura o segundo clique em
// Confirmar até `busy` voltar a falso, chegar um erro novo ou o diálogo reabrir, pra ação não
// sair duas vezes.
import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Panel } from '../../components/ui'

type ConfirmNote = {
  label: string
  required: boolean
  minLength?: number
  /** Teto do campo; o servidor confere de novo. Padrão 500. */
  maxLength?: number
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  children?: React.ReactNode
  confirmLabel: string
  tone?: 'primary' | 'alert'
  note?: ConfirmNote
  busy?: boolean
  error?: string | null
  onConfirm: (note: string) => void
  onCancel: () => void
}

// 16px (text-ps-md): abaixo disso o Safari do iPhone e do iPad amplia a tela ao focar o campo.
const FIELD =
  'w-full min-h-[88px] px-3 py-2.5 rounded-ps-md bg-ps-s2 text-ps-bone text-ps-md inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none resize-y placeholder:text-ps-mut'

// O que pode receber foco dentro do diálogo, inclusive campos que quem chama põe no texto.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

function noteIsValid(note: ConfirmNote | undefined, text: string): boolean {
  if (!note) return true
  const size = text.trim().length
  const min = note.minLength ?? (note.required ? 1 : 0)
  if (!note.required && size === 0) return true
  return size >= min
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Montar só aberto: reabrir começa do zero (nota vazia e trava solta).
  if (!props.open) return null
  return <OpenDialog {...props} />
}

function OpenDialog({
  title,
  children,
  confirmLabel,
  tone = 'primary',
  note,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [text, setText] = useState('')
  const locked = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const fieldId = useId()
  const hintId = useId()

  // A ação terminou (busy voltou a falso): libera Confirmar pra tentar de novo depois de um erro.
  useEffect(() => {
    if (!busy) locked.current = false
  }, [busy])

  // Chegou um erro novo: o pedido já terminou, então solta também. Assim quem chama sem ligar
  // `busy` não deixa Confirmar com cara de ligado e sem fazer nada.
  useEffect(() => {
    if (error) locked.current = false
  }, [error])

  // Abre com o foco na nota (sem nota, no próprio diálogo, pra um Enter solto não confirmar)
  // e, ao fechar, devolve o foco a quem abriu.
  useEffect(() => {
    const opener = document.activeElement
    ;(fieldRef.current ?? overlayRef.current?.querySelector<HTMLElement>('[role="dialog"]'))?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  const valid = noteIsValid(note, text)
  const confirm = () => {
    if (busy || !valid || locked.current) return
    locked.current = true
    onConfirm(text.trim())
  }

  // Modal: Esc cancela (menos com a ação em andamento), o Tab não sai do painel e
  // nenhuma tecla chega aos atalhos do app por trás.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!busy) onCancel()
    } else if (e.key === 'Tab') {
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof HTMLElement) || !items.includes(active)
      if (e.shiftKey ? active === first || outside : active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
  }

  const minHint = note?.minLength ? `Pelo menos ${note.minLength} caracteres.` : null

  return (
    // tabIndex -1: um clique fora dos controles deixa o foco aqui, e o Esc continua valendo.
    <div
      ref={overlayRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[90] flex items-center justify-center p-ps-gutter bg-black/70 outline-none"
    >
      <Panel
        variant="pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="flex flex-col gap-4 w-full max-w-[460px] max-h-full overflow-y-auto p-5 font-ps-sans text-ps-bone outline-none"
      >
        <h2 id={titleId} className="text-ps-md font-bold break-words">
          {title}
        </h2>

        {children != null && <div className="flex flex-col gap-2 text-ps-base text-ps-bone break-words">{children}</div>}

        {note && (
          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="ps-label">
              {note.label}
            </label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              value={text}
              rows={3}
              maxLength={note.maxLength ?? 500}
              required={note.required}
              disabled={busy}
              aria-describedby={minHint ? hintId : undefined}
              onChange={(e) => setText(e.target.value)}
              className={FIELD}
            />
            {minHint && (
              <p id={hintId} className="text-ps-sm text-ps-mut">
                {minHint}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button tone="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          {/* O Button não quebra texto: um rótulo comprido (Cancelar a assinatura agora sem estorno)
              estouraria o diálogo a 320 px. Aqui o botão vai no máximo até a largura do diálogo e o
              rótulo quebra linha dentro dele. */}
          <Button
            tone={tone}
            onClick={confirm}
            disabled={busy || !valid}
            icon={busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : undefined}
            className="max-w-full"
          >
            <span className="min-w-0 whitespace-normal text-center">{confirmLabel}</span>
          </Button>
        </div>
      </Panel>
    </div>
  )
}
