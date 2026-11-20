// @vitest-environment jsdom
// Guia de instalar na tela de início (parte da página de download), no layout do palco (Parte 3,
// faixa C): cada aparelho continua com o caminho dele.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InstallAppGuide } from './InstallAppGuide'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { oldLanguageClasses } from '../test/psLanguage'

vi.mock('../hooks/usePWAInstall', () => ({ usePWAInstall: vi.fn() }))

type Estado = ReturnType<typeof usePWAInstall>
function como(over: Partial<Estado>) {
  vi.mocked(usePWAInstall).mockReturnValue({
    platform: 'desktop', isInstalled: false, isDesktopApp: false, canPrompt: false, promptInstall: vi.fn(async () => false), ...over,
  } as Estado)
}

const texto = () => document.body.textContent ?? ''
afterEach(cleanup)

describe('Guia de instalar: nada some', () => {
  it('já instalado avisa', () => {
    como({ isInstalled: true })
    render(<InstallAppGuide />)
    expect(texto()).toContain('Você já está usando o app instalado.')
    // Revisão macro BC (BC3-3): musgo é "ao vivo"; o instalado fica no texto neutro.
    const frase = screen.getByText('Você já está usando o app instalado.')
    expect(frase.className).not.toMatch(/moss/)
    expect(frase.className).toContain('text-ps-mut')
  })

  it('Android com o botão do navegador: Instalar app chama a instalação e avisa quem pediu', async () => {
    const promptInstall = vi.fn(async () => true)
    const onInstalled = vi.fn()
    como({ platform: 'android', canPrompt: true, promptInstall })
    render(<InstallAppGuide onInstalled={onInstalled} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Instalar app' })) })
    expect(promptInstall).toHaveBeenCalled()
    expect(onInstalled).toHaveBeenCalled()
  })

  it('Android sem o botão, iPhone e computador mostram os passos (o computador com o QR code)', () => {
    como({ platform: 'android' })
    render(<InstallAppGuide />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    cleanup()
    como({ platform: 'ios' })
    render(<InstallAppGuide />)
    expect(texto()).toContain('Adicionar à Tela de Início')
    expect(texto()).toContain('o iPhone guarda o login separado do Safari')
    cleanup()
    como({ platform: 'desktop' })
    render(<InstallAppGuide />)
    expect(screen.getByTitle('QR code com o endereço do Playback Studio')).toBeTruthy()
  })

  it('no app de computador não mostra nada', () => {
    como({ isDesktopApp: true })
    const { container } = render(<InstallAppGuide />)
    expect(container.innerHTML).toBe('')
  })
})

describe('Guia de instalar: linguagem do palco', () => {
  it.each(['android', 'ios', 'desktop'] as const)('só classes da linguagem nova (%s)', (platform) => {
    como({ platform, canPrompt: platform === 'android' })
    render(<InstallAppGuide />)
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})
