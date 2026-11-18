// Pergunta de uma linha do próprio app (campo de texto + Salvar/Cancelar), no lugar do
// window.prompt: o app de computador (Electron) não tem prompt() e lança "prompt() is not
// supported", então renomear e criar o metrônomo infinito não faziam nada no Mac e no Windows.
import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import { Button } from './ui'

export interface TextPromptDialogProps {
  title: string
  /** Rótulo do campo (o que digitar). */
  label: string
  initialValue: string
  submitLabel?: string
  /** Teclado do celular e do tablet: 'numeric' pro BPM. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  /** Erro em português pro valor digitado (sem espaços nas pontas), ou nulo quando vale. */
  validate(value: string): string | null
  /** Valor sem espaços nas pontas, já validado. */
  onSubmit(value: string): void
  onCancel(): void
}

// Mesmos alvos de 44 px e tokens do palco novo; vale nos dois palcos (é um diálogo por cima de tudo).
const INPUT =
  'min-h-ps-touch w-full rounded-ps-md bg-ps-s1 px-3 text-ps-base text-ps-bone inset-ring inset-ring-ps-line-2 placeholder:text-ps-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/**
 * Diálogo com um campo: abre com o texto selecionado, Enter salva, Esc e o toque fora cancelam.
 * Valor inválido mostra o erro embaixo do campo e não fecha. O foco volta pra quem abriu ao fechar.
 */
export function TextPromptDialog({ title, label, initialValue, submitLabel = 'Salvar', inputMode, validate, onSubmit, onCancel }: TextPromptDialogProps) {
  const titleId = useId()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])

  const submit = () => {
    const v = value.trim()
    const problem = validate(v)
    if (problem) { setError(problem); return }
    onSubmit(v)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <form
        role="dialog" aria-modal="true" aria-labelledby={titleId} noValidate
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit() }}
        // Esc cancela aqui e não chega aos atalhos do palco (o pulo armado não é cancelado por baixo).
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-ps-xl bg-ps-pop p-4 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-line-2"
      >
        <h2 id={titleId} className="text-ps-md font-bold">{title}</h2>
        <label htmlFor={inputId} className="text-ps-sm text-ps-mut">{label}</label>
        <input
          ref={inputRef} id={inputId} type="text" value={value} inputMode={inputMode}
          aria-invalid={error ? 'true' : undefined} aria-describedby={error ? errorId : undefined}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          className={INPUT}
        />
        {error && <p id={errorId} role="alert" className="text-ps-sm text-ps-alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button tone="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" tone="primary">{submitLabel}</Button>
        </div>
      </form>
    </div>
  )
}

/** BPM do metrônomo infinito: inteiro de 40 a 300 (as mesmas regras do prompt de antes). */
export function endlessMetronomeBpmError(value: string): string | null {
  const bpm = Number(value)
  return /^\d+$/.test(value) && bpm >= 40 && bpm <= 300 ? null : 'BPM inválido. Digite um número entre 40 e 300.'
}

/** Nome de música: não pode ficar vazio. */
export function songNameError(value: string): string | null {
  return value ? null : 'Digite um nome pra música.'
}
