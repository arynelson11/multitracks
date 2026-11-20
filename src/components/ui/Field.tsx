import { useId } from 'react'
import type React from 'react'
import { cx } from './cx'

/** O que todo campo tem: rótulo, ajuda e erro. O `className` vai no contêiner do campo inteiro. */
export interface FieldProps {
  label: React.ReactNode
  /** Esconde o rótulo da vista; o leitor de tela continua lendo. */
  hideLabel?: boolean
  help?: React.ReactNode
  /** Com erro, o anel fica âmbar, o campo ganha aria-invalid e o leitor de tela lê o texto. */
  error?: React.ReactNode
  className?: string
}

export type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> &
  FieldProps & {
    /** Ícone antes do texto, dentro da caixa (decorativo, escondido do leitor de tela). */
    icon?: React.ReactNode
    /** Texto curto ou botão depois do texto, dentro da caixa (ex.: "mín 6"). */
    trailing?: React.ReactNode
    inputClassName?: string
  }

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & { textareaClassName?: string }

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { selectClassName?: string }

const WRAP = 'flex min-w-0 flex-col gap-1.5'
// Rótulo no estilo ps-label, mas pode quebrar linha (o ps-label não quebra).
const LABEL = 'text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut'
const HELP = 'text-ps-base leading-snug text-pretty text-ps-mut'
const ERROR = 'text-ps-base leading-snug text-pretty font-semibold text-ps-alert'

// Caixa: o anel sai do estado (normal x erro) e o alinhamento sai da peça, pra variação não disputar com a base.
// O anel de foco laranja fica na caixa (focus-within), então o ícone e o "mín 6" ficam dentro dele.
const BOX =
  'relative flex min-h-ps-touch min-w-0 rounded-ps-md bg-ps-s2 inset-ring transition-[box-shadow] duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ps-or'
const BOX_IDLE = 'inset-ring-ps-line hover:inset-ring-ps-line-2'
const BOX_ERROR = 'inset-ring-ps-alert-line'
const BOX_DISABLED = 'opacity-35 cursor-not-allowed'

// Fonte de 16 px: no iPhone, campo com fonte menor dá zoom na página ao tocar. O input e o select
// também levam o alvo de 44 px (min-h-ps-touch), além da caixa, pra medida do toque valer neles.
const CONTROL =
  'min-w-0 flex-1 self-stretch bg-transparent font-ps-sans text-ps-md text-ps-bone placeholder:text-ps-mut outline-none disabled:cursor-not-allowed'

/** Liga rótulo, ajuda e erro ao controle (ids, aria-describedby, aria-invalid) e monta o contêiner. */
function useField(p: FieldProps & { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: React.AriaAttributes['aria-invalid'] }) {
  const auto = useId()
  const id = p.id ?? auto
  const helpId = `${id}-ajuda`
  const errorId = `${id}-erro`
  const hasError = p.error != null && p.error !== false && p.error !== ''
  const describedBy = [p['aria-describedby'], p.help != null ? helpId : null, hasError ? errorId : null].filter(Boolean).join(' ') || undefined
  const control = { id, 'aria-describedby': describedBy, 'aria-invalid': hasError ? true : p['aria-invalid'] }
  const wrap = (box: React.ReactNode) => (
    <div className={cx(WRAP, p.className)}>
      <label htmlFor={id} className={p.hideLabel ? 'sr-only' : LABEL}>{p.label}</label>
      {box}
      {p.help != null && <p id={helpId} className={HELP}>{p.help}</p>}
      {hasError && <p id={errorId} className={ERROR}>{p.error}</p>}
    </div>
  )
  return { control, hasError, wrap }
}

/** Campo de texto de uma linha: rótulo em cima, caixa de 44 px, ajuda e erro embaixo. */
export function TextField({ label, hideLabel, help, error, className, icon, trailing, inputClassName, ...rest }: TextFieldProps) {
  const { control, hasError, wrap } = useField({ label, hideLabel, help, error, className, id: rest.id, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] })
  return wrap(
    <div className={cx(BOX, 'items-center', hasError ? BOX_ERROR : BOX_IDLE, rest.disabled && BOX_DISABLED)}>
      {icon != null && <span aria-hidden="true" className="flex shrink-0 items-center pl-3 text-ps-mut">{icon}</span>}
      <input {...rest} {...control} className={cx(CONTROL, 'min-h-ps-touch py-2.5', icon != null ? 'pl-2' : 'pl-3', trailing != null ? 'pr-2' : 'pr-3', inputClassName)} />
      {trailing != null && <span className="flex shrink-0 items-center pr-3 text-ps-sm text-ps-mut">{trailing}</span>}
    </div>,
  )
}

/** Área de texto de várias linhas, com a mesma moldura do campo; cresce na vertical. */
export function TextArea({ label, hideLabel, help, error, className, textareaClassName, rows = 4, ...rest }: TextAreaProps) {
  const { control, hasError, wrap } = useField({ label, hideLabel, help, error, className, id: rest.id, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] })
  return wrap(
    <div className={cx(BOX, 'items-stretch', hasError ? BOX_ERROR : BOX_IDLE, rest.disabled && BOX_DISABLED)}>
      <textarea {...rest} {...control} rows={rows} className={cx(CONTROL, 'resize-y px-3 py-2.5 leading-snug', textareaClassName)} />
    </div>,
  )
}

/** Seletor nativo com a moldura do campo e a seta do palco; as opções vêm como filhos. */
export function Select({ label, hideLabel, help, error, className, selectClassName, children, ...rest }: SelectProps) {
  const { control, hasError, wrap } = useField({ label, hideLabel, help, error, className, id: rest.id, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] })
  return wrap(
    <div className={cx(BOX, 'items-center', hasError ? BOX_ERROR : BOX_IDLE, rest.disabled && BOX_DISABLED)}>
      <select
        {...rest}
        {...control}
        className={cx(CONTROL, 'min-h-ps-touch cursor-pointer appearance-none scheme-dark py-2 pl-3 pr-9 [&_option]:bg-ps-s2 [&_option]:text-ps-bone', selectClassName)}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute right-3 size-4 text-ps-mut" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>,
  )
}
