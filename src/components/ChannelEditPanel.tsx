// Painel "Editar canal": renomear e escolher o papel (Click, Guia, Normal) de um canal.
// Só monta o valor; quem chama grava no repertório do usuário. `null` volta ao automático.
import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import { flushSync } from 'react-dom'
import { Info } from 'lucide-react'
import { Button, Panel, Segmented, type SegmentedOption } from './ui'
import { resolveChannelRole, type ChannelIdentity } from '../lib/channelNames'
import { CUSTOM_NAME_MAX } from '../lib/channelRoles'
import type { ChannelRole } from '../types'

export interface ChannelEditPanelProps {
  channel: ChannelIdentity
  // Rótulo que aparece quando o campo de nome fica vazio (vai de placeholder).
  autoLabel: string
  // Cabe em `ChannelMetaPatch`: manda sempre os dois campos.
  onSave: (value: { customName: string | null; role: ChannelRole | null }) => void
  onClose: () => void
}

const ROLE_OPTIONS: SegmentedOption<ChannelRole>[] = [
  { value: 'click', label: 'Click' },
  { value: 'guide', label: 'Guia' },
  { value: 'normal', label: 'Normal' },
]

const ROLE_HELP: Record<ChannelRole, string> = {
  click:
    'Canal do click: vai pro ouvido da banda no pan automático e não muda com a troca de tom. Continua tocando mesmo quando outro canal está em Solo.',
  guide:
    'Canal da voz guia: vai pro ouvido da banda no pan automático e não muda com a troca de tom. Continua tocando mesmo quando outro canal está em Solo.',
  normal: 'Canal da música: vai pra PA no pan automático e acompanha a troca de tom.',
}

// 16px (text-ps-md): abaixo disso o Safari do iPhone e do iPad amplia a tela ao focar o campo.
const INPUT =
  'w-full min-h-ps-touch px-3 rounded-ps-md bg-ps-s2 text-ps-bone text-ps-md inset-ring inset-ring-ps-line focus:inset-ring-ps-or-line outline-none placeholder:text-ps-mut'

// Linha de texto + botão: quebra em vez de estourar, e já reserva a altura do botão
// pra nada pular quando ele aparece ou some.
const ROW = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-ps-touch'

// Ghost não tem fundo: a margem negativa igual ao padding alinha o texto com o resto do painel.
const GHOST_ALIGN = '-mx-ps-pad-x'

const AUTO_BADGE = 'inline-flex items-center rounded-ps-pill px-2.5 py-1 bg-ps-s2 inset-ring inset-ring-ps-line ps-label'

export function ChannelEditPanel({ channel, autoLabel, onSave, onClose }: ChannelEditPanelProps) {
  const [name, setName] = useState(channel.customName ?? '')
  const [manualRole, setManualRole] = useState<ChannelRole | null>(channel.role ?? null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const hintId = useId()

  // Sem escolha manual, o papel mostrado acompanha o nome que está sendo digitado.
  const shownRole = manualRole ?? resolveChannelRole({ ...channel, role: undefined, customName: name || undefined })

  // Abre com o nome selecionado (digitar já substitui) e, ao fechar, devolve o foco a quem abriu.
  useEffect(() => {
    const opener = document.activeElement
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  const save = () => onSave({ customName: name.trim() || null, role: manualRole })

  // Os botões "Usar ... automático" somem ao clicar; o foco vai pro campo que eles controlam.
  const resetName = () => {
    setName('')
    inputRef.current?.focus()
  }
  const resetRole = () => {
    // Renderiza já, pra o rádio do papel automático estar marcado quando receber o foco.
    flushSync(() => setManualRole(null))
    overlayRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
  }

  const onNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
  }

  // Diálogo modal: Esc fecha, o Tab não sai do painel e nenhuma tecla chega aos atalhos
  // do palco (Espaço toca, setas pulam a música).
  const onOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      const overlay = e.currentTarget
      const items = Array.from(overlay.querySelectorAll<HTMLElement>('input, button')).filter(
        (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey ? active === first || active === overlay : active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
  }

  return (
    // tabIndex -1: um clique fora dos controles deixa o foco aqui, e o Esc continua valendo.
    <div
      ref={overlayRef}
      tabIndex={-1}
      onKeyDown={onOverlayKeyDown}
      className="fixed inset-0 z-[90] flex items-center justify-center p-ps-gutter bg-black/70 outline-none"
    >
      <Panel
        variant="pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex flex-col gap-4 w-full max-w-[420px] max-h-full overflow-y-auto p-5 font-ps-sans text-ps-bone"
      >
        <h2 id={titleId} className="text-ps-md font-bold">
          Editar canal
        </h2>

        <div className="flex flex-col gap-2">
          <label htmlFor="channel-edit-name" className="ps-label">
            Nome
          </label>
          <input
            ref={inputRef}
            id="channel-edit-name"
            type="text"
            value={name}
            maxLength={CUSTOM_NAME_MAX}
            placeholder={autoLabel}
            autoComplete="off"
            enterKeyHint="done"
            aria-describedby={hintId}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onNameKeyDown}
            className={INPUT}
          />
          <p id={hintId} className="text-ps-sm text-ps-mut">
            O nome que você der aparece no lugar do automático.
          </p>
          <div className={ROW}>
            <p className="min-w-0 text-ps-sm text-ps-mut break-words">Arquivo: {channel.name}</p>
            {name !== '' && (
              <Button tone="ghost" onClick={resetName} className={GHOST_ALIGN}>
                Usar nome automático
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className={ROW}>
            <span className="ps-label">Papel do canal</span>
            {manualRole === null ? (
              <span className={AUTO_BADGE}>Automático</span>
            ) : (
              <Button tone="ghost" onClick={resetRole} className={GHOST_ALIGN}>
                Usar papel automático
              </Button>
            )}
          </div>
          <Segmented
            aria-label="Papel do canal"
            options={ROLE_OPTIONS}
            value={shownRole}
            onChange={setManualRole}
            className="self-start"
          />
          <p className="text-ps-base text-ps-mut">{ROLE_HELP[shownRole]}</p>
        </div>

        <p className="flex items-start gap-2 rounded-ps-md bg-ps-s1 px-3 py-2.5 text-ps-sm text-ps-mut">
          <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
          <span className="min-w-0">Vale só pro seu repertório. A música da biblioteca não muda.</span>
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button tone="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button tone="primary" onClick={save}>
            Salvar
          </Button>
        </div>
      </Panel>
    </div>
  )
}
