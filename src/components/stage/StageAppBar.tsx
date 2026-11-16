import type React from 'react'
import type { StageActions, StageView } from '../../lib/stageContracts'
import { cx } from '../ui'
import { Icon } from './icons'
import type { IconName } from './iconNames'

export interface StageAppBarProps {
  app: StageView['app']; editMode: boolean
  actions: Pick<StageActions, 'openRepertoires' | 'openTracks' | 'openLibrary' | 'toggleEditMode' | 'openHost' | 'openSettings' | 'goHome' | 'signOut'>
}

// v5 .online: selo de 22 px. ONLINE no musgo; OFFLINE neutro (sem internet o que está no
// aparelho continua tocando: não é alerta).
const BADGE = 'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-ps-pill px-[9px] text-ps-micro leading-none font-extrabold tracking-[0.14em] whitespace-nowrap'
const BADGE_ONLINE = 'bg-ps-moss/15 text-ps-moss-hi inset-ring inset-ring-ps-moss/80'
const BADGE_OFFLINE = 'bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line-2'
const DOT_ONLINE = 'bg-ps-moss-hi shadow-[0_0_6px_var(--color-ps-moss-hi)]'
const DOT_OFFLINE = 'bg-ps-dim'

// v5 .menu button: a pílula visível tem 32 px como no mockup; o botão em volta tem 44 px de
// altura e de largura mínima (alvo de toque). Largura pelo texto; padding menor abaixo de 1280 pra
// barra inteira caber em 1024.
const NAV_BTN =
  'group inline-flex shrink-0 items-center justify-center min-h-ps-touch min-w-ps-touch select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or rounded-ps-sm'
const NAV_PILL =
  'inline-flex h-8 items-center gap-1.5 px-2 xl:px-2.5 rounded-ps-sm text-ps-sm font-bold tracking-[0.1em] whitespace-nowrap transition-colors duration-150'
const PILL_IDLE = 'text-ps-mut group-hover:text-ps-bone group-hover:bg-ps-s1'
const PILL_ON = 'text-ps-or bg-ps-or-soft inset-ring inset-ring-ps-or-line'

interface NavButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  text: string
  icon?: IconName
  /** Aceso (laranja = ligado). */
  on?: boolean
}

function NavButton({ text, icon, on = false, ...rest }: NavButtonProps) {
  return (
    <button {...rest} type="button" data-on={on ? 'true' : 'false'} className={NAV_BTN}>
      <span className={cx(NAV_PILL, on ? PILL_ON : PILL_IDLE)}>
        {icon && <Icon name={icon} className="size-[15px]" />}
        {text}
      </span>
    </button>
  )
}

/** Inicial do nome pro avatar; sem nome, nada (o círculo fica só com o degradê). */
function initial(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() ?? ''
}

/**
 * Barra fina do app no palco novo (mockup v5): PlayMark e "Playback Studio", selo ONLINE ou
 * OFFLINE e o menu REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR (aceso no modo EDITAR), HOST (só no
 * app do computador; aceso com o host ligado), CONFIG, INÍCIO, avatar e SAIR. Os `data-tour`
 * são os mesmos do palco antigo, pro tour achar os botões.
 */
export function StageAppBar({ app, editMode, actions }: StageAppBarProps) {
  const user = app.userName?.trim() || 'Usuário'
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-ps-line bg-ps-ink-0 pr-3 pl-ps-gutter font-ps-sans">
      <div className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-ps-bone">
        <Icon name="mark" className="size-[22px] text-ps-or" />
        <span>Playback <i className="font-semibold text-ps-or">Studio</i></span>
      </div>
      <span
        data-online={app.online ? 'true' : 'false'}
        title={app.online ? 'Conectado à internet' : 'Sem internet. As músicas salvas no aparelho continuam tocando.'}
        className={cx(BADGE, app.online ? BADGE_ONLINE : BADGE_OFFLINE)}
      >
        <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', app.online ? DOT_ONLINE : DOT_OFFLINE)} />
        {app.online ? 'ONLINE' : 'OFFLINE'}
      </span>

      <nav aria-label="Navegação do app" className="ml-auto flex shrink-0 items-center gap-0.5">
        <NavButton data-tour="repertorios" text="REPERTÓRIOS" aria-label="Repertórios" title="Lista do repertório e Anotações" onClick={actions.openRepertoires} />
        <NavButton data-tour="faixas" text="FAIXAS" aria-label="Faixas" title="Importar faixas do aparelho ou criar um metrônomo" onClick={actions.openTracks} />
        <NavButton data-tour="biblioteca" text="BIBLIOTECA" aria-label="Biblioteca" title="Músicas da biblioteca na nuvem" onClick={actions.openLibrary} />
        <NavButton
          data-tour="editar" text="EDITAR" aria-label="Editar" aria-pressed={editMode} on={editMode}
          title={editMode ? 'Sair do modo EDITAR' : 'Modo EDITAR: marcar seções, compasso e canais'}
          onClick={actions.toggleEditMode}
        />
        {app.isDesktop && (
          <NavButton
            data-tour="host" text="HOST" aria-label={app.hostActive ? 'Host (ligado)' : 'Host'} on={app.hostActive}
            title={app.hostActive ? 'Modo Ao Vivo ligado' : 'Modo Ao Vivo: a banda acompanha pelo celular'}
            onClick={actions.openHost}
          />
        )}
        <NavButton data-tour="config" text="CONFIG" aria-label="Configurações" title="Configurações" onClick={actions.openSettings} />
        <NavButton data-tour="inicio" text="INÍCIO" icon="home" aria-label="Início" title="Volta pra tela inicial do app" onClick={actions.goHome} />
        <span aria-hidden="true" className="mx-1.5 h-5 w-px shrink-0 bg-ps-line" />
        <span
          role="img" aria-label={user} title={user}
          className="mx-1 grid size-7 shrink-0 place-items-center rounded-full bg-linear-135 from-ps-or to-ps-moss text-ps-sm font-extrabold leading-none text-ps-bone shadow-[0_0_0_2px_var(--color-ps-ink-0),0_0_0_3px_var(--color-ps-line-2)]"
        >
          {initial(app.userName)}
        </span>
        <NavButton text="SAIR" icon="out" aria-label="Sair" title="Sair da conta" onClick={actions.signOut} />
      </nav>
    </header>
  )
}
