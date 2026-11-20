// @vitest-environment jsdom
// Configurações (Parte 3, faixa B): tudo que a janela faz hoje continua lá depois do restyle, e a
// casca, as abas e o conteúdo usam as peças do kit e os tokens ps-*.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { OutputSettings } from '../lib/stageContracts'
import type { Channel } from '../types'

const { authState, settingsState } = vi.hoisted(() => ({
  authState: {
    user: { id: 'u1', email: 'pessoa@exemplo.com', user_metadata: {}, created_at: '2026-07-01T00:00:00Z' } as Record<string, unknown> | null,
    userPlan: 'free',
    isAdmin: false,
    refreshPlan: vi.fn(async () => {}),
    updateProfile: vi.fn(async () => ({})),
    updatePassword: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
  },
  settingsState: {
    settings: {
      autoPan: false,
      audioDeviceId: 'default',
      outputs: { mode: 'stereo', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } } as OutputSettings,
      stageVersion: 'novo' as 'novo' | 'antigo',
      stageVersionChosen: false,
      legacyPanReset: false,
    },
    updateSetting: vi.fn(),
    availableAudioDevices: [] as MediaDeviceInfo[],
    refreshAudioDevices: vi.fn(async () => {}),
    canPickOutput: true,
    outputLoadWarnings: [] as readonly string[],
  },
}))

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settingsState }))
vi.mock('./SeparationUsageMeter', () => ({
  SeparationUsageMeter: ({ plan, isAdmin }: { plan: string; isAdmin?: boolean }) => <div data-testid="usage">{`uso ${plan} ${String(isAdmin)}`}</div>,
}))
vi.mock('./SubscriptionPanel', () => ({
  SubscriptionPanel: ({ plan, onChanged, onOpenPricing }: { plan: string; onChanged(): void; onOpenPricing(): void }) => (
    <div data-testid="subscription">
      {`assinatura ${plan}`}
      <button type="button" onClick={onChanged}>mudou</button>
      <button type="button" onClick={onOpenPricing}>planos do painel</button>
    </div>
  ),
}))
vi.mock('./PricingModal', () => ({
  PricingModal: ({ isOpen, onClose }: { isOpen: boolean; onClose(): void }) => (isOpen ? <div data-testid="pricing"><button type="button" onClick={onClose}>fechar planos</button></div> : null),
}))
vi.mock('./ProfileTab', () => ({
  ProfileTab: (p: { userPlan: string; onUpgrade(): void; onClose(): void }) => (
    <div data-testid="profile">
      {`perfil ${p.userPlan}`}
      <button type="button" onClick={p.onUpgrade}>upgrade do perfil</button>
      <button type="button" onClick={p.onClose}>fechar do perfil</button>
    </div>
  ),
}))

import { SettingsModal } from './SettingsModal'
import { CHANGELOG } from '../lib/changelog'

type Props = Parameters<typeof SettingsModal>[0]
const STEREO: OutputSettings = { mode: 'stereo', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }
const SPLIT: OutputSettings = { ...STEREO, mode: 'split2' }
const CHANNELS = [
  { id: 'c1', name: 'click.wav', bus: '1' },
  { id: 'c2', name: 'BATERIA_01.wav', bus: '1/2' },
] as unknown as Channel[]

function props(patch: Partial<Props> = {}): Props {
  return {
    isOpen: true,
    onClose: vi.fn(),
    channels: [],
    onSetChannelBus: vi.fn(),
    onOpenAdmin: vi.fn(),
    onReplayTour: vi.fn(),
    ...patch,
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => {
  settingsState.settings = { ...settingsState.settings, outputs: STEREO, autoPan: false, stageVersion: 'novo' }
  settingsState.canPickOutput = true
  authState.userPlan = 'free'
  authState.isAdmin = false
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const text = () => document.body.textContent ?? ''
/** Aba pelo texto (antes do restyle era um botão comum; depois, role tab). */
const tab = (name: string) => screen.getByText(name, { selector: 'button' })
const tabNames = () => Array.from(document.querySelectorAll('button')).map((b) => b.textContent).filter((t) => ['Perfil', 'Geral', 'Buses', 'Novidades', 'Assinatura', 'Sobre'].includes(t ?? ''))
const closeButton = () => Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Fechar' || b.querySelector('.lucide-x'))!

describe('SettingsModal: nada some (casca e abas)', () => {
  it('fechada não renderiza nada', () => {
    const { container } = render(<SettingsModal {...props({ isOpen: false })} />)
    expect(container.firstChild).toBeNull()
  })

  it('abas: com Tudo junto tem Buses; fora dele, não', () => {
    render(<SettingsModal {...props()} />)
    expect(tabNames()).toEqual(['Perfil', 'Geral', 'Buses', 'Novidades', 'Assinatura', 'Sobre'])
    cleanup()
    settingsState.settings = { ...settingsState.settings, outputs: SPLIT }
    render(<SettingsModal {...props()} />)
    expect(tabNames()).toEqual(['Perfil', 'Geral', 'Novidades', 'Assinatura', 'Sobre'])
  })

  it('abre no Perfil e cada aba mostra o seu conteúdo', () => {
    render(<SettingsModal {...props()} />)
    expect(screen.getByTestId('profile').textContent).toContain('perfil free')
    fireEvent.click(tab('Geral'))
    expect(text()).toContain('Palco')
    expect(text()).toContain('Saídas de áudio')
    fireEvent.click(tab('Buses'))
    expect(text()).toContain('Carregue uma música primeiro para ver os canais.')
    fireEvent.click(tab('Novidades'))
    expect(text()).toContain(CHANGELOG[0].title)
    fireEvent.click(tab('Assinatura'))
    expect(text()).toContain('Seu Plano Atual')
    fireEvent.click(tab('Sobre'))
    expect(text()).toContain(`A plataforma do domingo · v${CHANGELOG[0].version}`)
  })

  it('sem login o Perfil fica vazio (como hoje)', () => {
    const saved = authState.user
    authState.user = null
    render(<SettingsModal {...props()} />)
    expect(screen.queryByTestId('profile')).toBeNull()
    authState.user = saved
  })

  it('X e toque fora fecham; toque dentro não', () => {
    const p = props()
    const { container } = render(<SettingsModal {...p} />)
    fireEvent.click(screen.getByTestId('profile'))
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.click(closeButton())
    expect(p.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.firstElementChild!)
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })

  it('aberta pelo aviso SAÍDAS vai pra Geral e rola até as saídas', () => {
    render(<SettingsModal {...props({ focusSection: 'outputs' })} />)
    expect(text()).toContain('Saídas de áudio')
    expect(document.querySelector('[data-settings-outputs]')).not.toBeNull()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('na aba Buses, sair de Tudo junto volta pra Geral', () => {
    const p = props()
    const { rerender } = render(<SettingsModal {...p} />)
    fireEvent.click(tab('Buses'))
    settingsState.settings = { ...settingsState.settings, outputs: SPLIT }
    rerender(<SettingsModal {...p} />)
    expect(text()).toContain('Saídas de áudio')
    expect(text()).not.toContain('Carregue uma música primeiro')
  })

  it('Perfil: upgrade abre os Planos e fechar do perfil chama onClose', () => {
    const p = props()
    render(<SettingsModal {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'upgrade do perfil' }))
    expect(screen.getByTestId('pricing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'fechar planos' }))
    expect(screen.queryByTestId('pricing')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'fechar do perfil' }))
    expect(p.onClose).toHaveBeenCalled()
  })
})

describe('SettingsModal: nada some (aba Geral e Buses)', () => {
  it('chave do Palco grava stageVersion; tutorial fecha e reabre o tour', () => {
    const p = props()
    render(<SettingsModal {...p} />)
    fireEvent.click(tab('Geral'))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Palco' })).getByRole('radio', { name: 'Antigo' }))
    expect(settingsState.updateSetting).toHaveBeenCalledWith('stageVersion', 'antigo')
    expect(text()).toContain('Tutorial')
    expect(text()).toContain('Rever o guia de uso do app')
    fireEvent.click(screen.getByRole('button', { name: 'Ver tutorial' }))
    expect(p.onClose).toHaveBeenCalled()
    expect(p.onReplayTour).toHaveBeenCalled()
  })

  it('seletor do aparelho junto das saídas; trocar o aparelho grava audioDeviceId; atualizar a lista', () => {
    settingsState.availableAudioDevices = [{ deviceId: 'placa-1', label: 'Focusrite 2i2', kind: 'audiooutput' } as MediaDeviceInfo]
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Geral'))
    const outputs = document.querySelector('[data-settings-outputs]')!
    expect(outputs.textContent).toContain('Dispositivo de Áudio')
    expect(outputs.textContent).toContain('Selecionar dispositivo de saída principal')
    expect(outputs.textContent).toContain('Pra mostrar o nome das saídas, o navegador pede acesso ao microfone. Nada é gravado.')
    const select = within(outputs as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Padrão do Sistema', 'Focusrite 2i2'])
    fireEvent.change(select, { target: { value: 'placa-1' } })
    expect(settingsState.updateSetting).toHaveBeenCalledWith('audioDeviceId', 'placa-1')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar a lista de dispositivos' }))
    expect(settingsState.refreshAudioDevices).toHaveBeenCalled()
    settingsState.availableAudioDevices = []
  })

  it('navegador que não troca a saída: só o aviso, sem seletor do aparelho nem atualizar', () => {
    settingsState.canPickOutput = false
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Geral'))
    expect(text()).toContain('Este navegador não deixa escolher a saída de áudio')
    expect(screen.queryByRole('button', { name: 'Atualizar a lista de dispositivos' })).toBeNull()
  })

  it('trocar as saídas grava outputs', () => {
    render(<SettingsModal {...props({ maxOutputChannels: 2 })} />)
    fireEvent.click(tab('Geral'))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Saídas de áudio' })).getByRole('radio', { name: 'Click e Guia separados' }))
    expect(settingsState.updateSetting).toHaveBeenCalledWith('outputs', expect.objectContaining({ mode: 'split2' }))
  })

  it('pan automático só em Tudo junto; liga e desliga gravando autoPan', () => {
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Geral'))
    expect(text()).toContain('Pan Estéreo Automático')
    expect(text()).toContain('Click e Guia no canal L, faixas no canal R')
    const autoPan = document.querySelector('[data-setting="autopan"] input, [data-setting="autopan"] [role="switch"]') ?? screen.getByText('Pan Estéreo Automático').closest('div')!.parentElement!.querySelector('input, [role="switch"]')!
    fireEvent.click(autoPan)
    expect(settingsState.updateSetting).toHaveBeenCalledWith('autoPan', true)
    cleanup()
    settingsState.settings = { ...settingsState.settings, outputs: SPLIT }
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Geral'))
    expect(text()).not.toContain('Pan Estéreo Automático')
  })

  it('pan automático tocando, mandando o click pro PA, passa pela confirmação', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsModal {...props({ isPlaying: true, maxOutputChannels: 2 })} />)
    fireEvent.click(tab('Geral'))
    const autoPan = screen.getByText('Pan Estéreo Automático').closest('div')!.parentElement!.querySelector('input, [role="switch"]')!
    fireEvent.click(autoPan)
    // Ligar o pan automático em Tudo junto tira o click do PA: nada a confirmar, grava.
    expect(confirm).not.toHaveBeenCalled()
    expect(settingsState.updateSetting).toHaveBeenCalledWith('autoPan', true)
    // Desligar (com ele ligado) manda o click pro PA tocando: pergunta e, recusado, não grava.
    cleanup()
    vi.clearAllMocks()
    settingsState.settings = { ...settingsState.settings, autoPan: true }
    render(<SettingsModal {...props({ isPlaying: true, maxOutputChannels: 2 })} />)
    fireEvent.click(tab('Geral'))
    fireEvent.click(screen.getByText('Pan Estéreo Automático').closest('div')!.parentElement!.querySelector('input, [role="switch"]')!)
    expect(confirm).toHaveBeenCalled()
    expect(settingsState.updateSetting).not.toHaveBeenCalledWith('autoPan', false)
    confirm.mockRestore()
  })

  it('Grade de Compasso continua em breve (ligada e sem ação)', () => {
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Geral'))
    expect(text()).toContain('Grade de Compasso')
    expect(text()).toContain('Grade de beats na forma de onda (Em breve)')
  })

  it('Painel de Upload só pra admin: fecha e abre o admin', () => {
    const p = props()
    render(<SettingsModal {...p} />)
    fireEvent.click(tab('Geral'))
    expect(screen.queryByRole('button', { name: 'Abrir Painel' })).toBeNull()
    cleanup()
    authState.isAdmin = true
    render(<SettingsModal {...p} />)
    fireEvent.click(tab('Geral'))
    expect(text()).toContain('Painel de Upload')
    expect(text()).toContain('Publicar músicas na biblioteca da nuvem')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Painel' }))
    expect(p.onClose).toHaveBeenCalled()
    expect(p.onOpenAdmin).toHaveBeenCalled()
  })

  it('Buses: explicação e um seletor por canal com o nome organizado; trocar chama onSetChannelBus', () => {
    const p = props({ channels: CHANNELS })
    render(<SettingsModal {...p} />)
    fireEvent.click(tab('Buses'))
    expect(text()).toContain('Define para qual bus estéreo cada canal é roteado. Bus 1 = L, Bus 2 = R, 1/2 = Estéreo.')
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    expect(Array.from(selects[0].options).map((o) => o.textContent)).toEqual(['1 (L)', '2 (R)', '1/2 (Stereo)'])
    expect(selects[1].value).toBe('1/2')
    expect(text()).toContain('Click')
    expect(screen.getByTitle('BATERIA_01.wav')).toBeTruthy()
    fireEvent.change(selects[1], { target: { value: '2' } })
    expect(p.onSetChannelBus).toHaveBeenCalledWith('c2', '2')
  })
})

describe('SettingsModal: nada some (Novidades, Assinatura e Sobre)', () => {
  it('Novidades: atualização do computador com Baixar e todas as entradas do histórico', () => {
    const onInstallUpdate = vi.fn()
    render(<SettingsModal {...props({ desktopUpdate: { latestVersion: '9.9.9', url: 'https://exemplo/app' }, onInstallUpdate })} />)
    fireEvent.click(tab('Novidades'))
    expect(text()).toContain('Atualização disponível')
    expect(text()).toContain('A versão 9.9.9 já saiu. Baixe para atualizar o app.')
    fireEvent.click(screen.getByRole('button', { name: /Baixar/ }))
    expect(onInstallUpdate).toHaveBeenCalled()
    for (const entry of CHANGELOG.slice(0, 5)) {
      expect(text()).toContain(entry.title)
      expect(text()).toContain(`v${entry.version}`)
      for (const item of entry.items) expect(text()).toContain(item)
    }
    cleanup()
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Novidades'))
    expect(text()).not.toContain('Atualização disponível')
  })

  it('Assinatura no Livre: plano, frase, medidor, painel e Ver Planos & Assinar', () => {
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Assinatura'))
    expect(text()).toContain('Livre')
    expect(text()).toContain('Você está no plano Livre. Faça upgrade para liberar todas as funcionalidades.')
    expect(screen.getByTestId('usage').textContent).toBe('uso free false')
    expect(screen.getByTestId('subscription').textContent).toContain('assinatura free')
    fireEvent.click(screen.getByRole('button', { name: 'mudou' }))
    expect(authState.refreshPlan).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'planos do painel' }))
    expect(screen.getByTestId('pricing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'fechar planos' }))
    fireEvent.click(screen.getByRole('button', { name: /Ver Planos & Assinar/i }))
    expect(screen.getByTestId('pricing')).toBeTruthy()
  })

  it('Assinatura paga: agradecimento e Alterar Plano; o medidor recebe o admin', () => {
    authState.userPlan = 'pro_mensal'
    authState.isAdmin = true
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Assinatura'))
    expect(text()).toContain('Obrigado por apoiar o Playback Studio. Aproveite tudo do seu plano.')
    expect(screen.getByTestId('usage').textContent).toBe('uso pro_mensal true')
    fireEvent.click(screen.getByRole('button', { name: /Alterar Plano/i }))
    expect(screen.getByTestId('pricing')).toBeTruthy()
  })

  it('Sobre: marca, versão e a frase', () => {
    render(<SettingsModal {...props()} />)
    fireEvent.click(tab('Sobre'))
    expect(text()).toContain(`A plataforma do domingo · v${CHANGELOG[0].version}`)
    expect(text()).toContain('Multitracks pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.')
  })
})

// ---------------------------------------------------------------------------------------------
// Visual do palco
// ---------------------------------------------------------------------------------------------

const OLD = /^(?:[a-z-]+:)*(?:bg|text|border|from|to|shadow|ring|placeholder)-(?:primary|secondary|laranja|tinta|warm-\d+|zinc-\d+|text-muted|white|black(?!\/)|border|error|success|red-\d+)(?:[-/].*)?$|^(?:daw-panel|daw-input|lcd-display|font-mono|font-display)$|^bg-\[#|^text-\[#/
/** Classes dos elementos da janela, sem as marcas e sem as peças simuladas. */
function windowClasses(root: Element): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[class]')) {
    if (el.closest('span.font-display.inline-flex') || el.closest('[data-testid]')) continue
    out.push(...el.className.toString().split(/\s+/).filter(Boolean))
  }
  return out
}

describe('SettingsModal: casca do palco', () => {
  it('janela com nome, Panel pop por cima de fundo escuro, X de 44 px', () => {
    const { container } = render(<SettingsModal {...props()} />)
    const overlay = container.firstElementChild as HTMLElement
    for (const c of ['fixed', 'inset-0', 'z-[100]', 'bg-black/60', 'p-ps-gutter']) expect(overlay.className.split(' ')).toContain(c)
    const dialog = screen.getByRole('dialog', { name: 'Configurações' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    for (const c of ['bg-ps-pop', 'shadow-ps-pop', 'max-w-2xl']) expect(dialog.className.split(' ')).toContain(c)
    const close = screen.getByRole('button', { name: 'Fechar' })
    expect(close.className).toContain('min-h-ps-touch')
  })

  it('abas do kit: tablist com nome, a atual marcada e o painel ligado a ela', () => {
    render(<SettingsModal {...props()} />)
    const list = screen.getByRole('tablist', { name: 'Abas das Configurações' })
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Perfil', 'Geral', 'Buses', 'Novidades', 'Assinatura', 'Sobre'])
    const perfil = within(list).getByRole('tab', { name: 'Perfil' })
    expect(perfil.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Perfil' })).toBeTruthy()
    fireEvent.click(within(list).getByRole('tab', { name: 'Geral' }))
    expect(screen.getByRole('tabpanel', { name: 'Geral' })).toBeTruthy()
    act(() => { within(list).getByRole('tab', { name: 'Geral' }).focus() })
    fireEvent.keyDown(within(list).getByRole('tab', { name: 'Geral' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tabpanel', { name: 'Buses' })).toBeTruthy()
  })

  it('casca sem classes da paleta antiga', () => {
    render(<SettingsModal {...props()} />)
    const dialog = screen.getByRole('dialog')
    const shell = [dialog, ...dialog.querySelectorAll('[role="tablist"], [role="tab"], [role="tabpanel"]')]
    const own = shell.flatMap((el) => el.className.toString().split(/\s+/).filter(Boolean))
    expect(own.filter((c) => OLD.test(c))).toEqual([])
  })
})

void windowClasses
