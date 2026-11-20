// Confirmação de uma ação do admin: o que vai acontecer, uma nota (quando a ação pede) e o
// erro do servidor dentro do próprio diálogo. Uma trava interna segura o segundo clique em
// Confirmar até `busy` voltar a falso, chegar um erro novo ou o diálogo reabrir, pra ação não
// sair duas vezes. Erro incerto (a resposta da ação não chegou) segura Confirmar até fechar e
// abrir de novo, pra pessoa conferir no Registro antes de repetir (Ruling ADM-T4-incerto).
import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Panel, TextArea } from '../../components/ui'
import { isUncertainError, type AdminApiError } from '../lib/adminApi'

type ConfirmNote = {
  label: string
  required: boolean
  minLength?: number
  /** Teto do campo; o servidor confere de novo. Padrão 500. */
  maxLength?: number
  /** Uma linha sob o campo, pra quem escreve saber quem vai ler (ex.: o motivo do bloqueio). */
  hint?: string
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  children?: React.ReactNode
  confirmLabel: string
  tone?: 'primary' | 'alert'
  note?: ConfirmNote
  busy?: boolean
  /** Confirmar desligado por uma condição de quem chama (uma caixa que precisa estar marcada). */
  confirmDisabled?: boolean
  /**
   * Erro da ação, mostrado dentro do diálogo. Passe o AdminApiError do adminPost (ou a frase dele):
   * com erro incerto, Confirmar fica desligado até fechar e abrir de novo.
   */
  error?: string | AdminApiError | null
  onConfirm: (note: string) => void
  onCancel: () => void
}

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
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [text, setText] = useState('')
  const locked = useRef(false)
  // Erro incerto que chegou com o diálogo aberto: o servidor pode ter feito a ação, então
  // Confirmar só volta ao fechar e abrir de novo (o diálogo nasce do zero). Um erro que já estava
  // aqui ao abrir (quem chama esqueceu de limpar) não segura quem acabou de reabrir.
  const [seenError, setSeenError] = useState(error)
  const [held, setHeld] = useState(false)
  if (error !== seenError) {
    setSeenError(error)
    if (isUncertainError(error)) setHeld(true)
  }
  const errorText = typeof error === 'string' ? error : (error?.message ?? null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const fieldId = useId()

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
    // A nota é o TextArea do kit (16 px, o Safari do iPhone não amplia ao focar), achado pelo id.
    ;(document.getElementById(fieldId) ?? overlayRef.current?.querySelector<HTMLElement>('[role="dialog"]'))?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
    // O id do useId não muda: o efeito roda uma vez, ao abrir.
  }, [fieldId])

  const valid = noteIsValid(note, text)
  const confirm = () => {
    if (busy || !valid || held || confirmDisabled || locked.current) return
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
  const hints = [minHint, note?.hint ?? null].filter((h): h is string => !!h)

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
          <TextArea
            id={fieldId}
            label={note.label}
            value={text}
            rows={3}
            maxLength={note.maxLength ?? 500}
            required={note.required}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            help={
              hints.length > 0
                ? hints.map((h) => (
                    <span key={h} className="block text-ps-sm break-words">
                      {h}
                    </span>
                  ))
                : undefined
            }
          />
        )}

        {errorText && (
          <p role="alert" className="rounded-ps-md bg-ps-alert-soft px-3 py-2.5 text-ps-base text-ps-alert break-words">
            {errorText}
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
            disabled={busy || !valid || held || confirmDisabled}
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
