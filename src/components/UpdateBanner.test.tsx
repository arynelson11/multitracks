// @vitest-environment jsdom
// Aviso de atualização na linguagem do palco (Parte 3, faixa C): os três casos (Windows pronto,
// Mac com versão pra baixar, site com versão nova) e o "Agora não" continuam iguais.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UpdateBanner } from './UpdateBanner'
import { oldLanguageClasses } from '../test/psLanguage'

type Desktop = NonNullable<Window['playbackDesktop']>

function desktopFalso() {
  const ouvintes: { ready?: (v: string) => void; avail?: (i: { version: string }) => void } = {}
  const installUpdate = vi.fn()
  window.playbackDesktop = {
    onUpdateReady: (cb: (v: string) => void) => { ouvintes.ready = cb; return () => {} },
    onUpdateAvailable: (cb: (i: { version: string }) => void) => { ouvintes.avail = cb; return () => {} },
    installUpdate,
  } as unknown as Desktop
  return { ouvintes, installUpdate }
}

afterEach(() => {
  cleanup()
  delete (window as { playbackDesktop?: Desktop }).playbackDesktop
  vi.unstubAllGlobals()
})

const texto = () => document.body.textContent ?? ''

describe('Aviso de atualização: nada some', () => {
  it('sem atualização não mostra nada (só a região status, vazia)', () => {
    desktopFalso()
    render(<UpdateBanner />)
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('Windows: atualização baixada, Reiniciar instala', () => {
    const { ouvintes, installUpdate } = desktopFalso()
    render(<UpdateBanner />)
    act(() => ouvintes.ready?.('1.4.30'))
    expect(texto()).toContain('Atualização pronta')
    expect(texto()).toContain('Versão 1.4.30 baixada. Reinicie para aplicar.')
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))
    expect(installUpdate).toHaveBeenCalledTimes(1)
  })

  it('Mac: versão nova pra baixar, Baixar chama a instalação; Agora não esconde', () => {
    const { ouvintes, installUpdate } = desktopFalso()
    render(<UpdateBanner />)
    act(() => ouvintes.avail?.({ version: '1.4.31' }))
    expect(texto()).toContain('Nova versão disponível')
    expect(texto()).toContain('Versão 1.4.31 já saiu. Baixe a nova versão.')
    fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
    expect(installUpdate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(texto()).not.toContain('Nova versão disponível')
  })

  it('site: versão nova esperando, Atualizar manda o SKIP_WAITING', async () => {
    const waiting = { postMessage: vi.fn() }
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: {
        controller: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getRegistration: async () => ({ waiting, addEventListener: vi.fn(), update: vi.fn(async () => {}) }),
      },
    })
    vi.useFakeTimers()
    render(<UpdateBanner />)
    await act(async () => { await Promise.resolve() })
    expect(texto()).toContain('Uma versão nova do Playback Studio está pronta. Atualize para usar.')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})

describe('Aviso de atualização: linguagem do palco', () => {
  it('é um aviso (status) que não puxa o foco, com a frase inteira e só classes novas', () => {
    const { ouvintes } = desktopFalso()
    render(<UpdateBanner />)
    act(() => ouvintes.avail?.({ version: '1.4.31' }))
    const aviso = screen.getByRole('status')
    expect(aviso.textContent).toContain('Nova versão disponível')
    expect(document.activeElement).toBe(document.body)
    expect(aviso.innerHTML).not.toContain('truncate')
    expect(oldLanguageClasses(document.body)).toEqual([])
  })

  // Revisão macro BC (BC3-2): a região status fica sempre na página e o aviso entra nela (região
  // que nasce já com o texto muitas vezes não é lida); dispensado, ela fica vazia de novo.
  it('o aviso entra na região status que já estava na página; Agora não a deixa vazia', () => {
    const { ouvintes } = desktopFalso()
    render(<UpdateBanner />)
    const regiao = screen.getByRole('status')
    expect(regiao.textContent).toBe('')
    act(() => ouvintes.avail?.({ version: '1.4.31' }))
    expect(screen.getByRole('status')).toBe(regiao)
    expect(regiao.textContent).toContain('Nova versão disponível')
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(screen.getByRole('status')).toBe(regiao)
    expect(regiao.textContent).toBe('')
  })

  // Revisão macro BC (BC3-3): laranja é ligado e a ação principal; o quadrado do ícone fica neutro.
  it('laranja só no botão da ação', () => {
    const { ouvintes } = desktopFalso()
    render(<UpdateBanner />)
    act(() => ouvintes.avail?.({ version: '1.4.31' }))
    const baixar = screen.getByRole('button', { name: 'Baixar' })
    const laranja = Array.from(screen.getByRole('status').querySelectorAll('[class]'))
      .filter((el) => el !== baixar && !baixar.contains(el))
      .flatMap((el) => el.getAttribute('class')!.split(/\s+/))
      // O anel de foco (focus-visible) é laranja em todo botão do kit: não conta.
      .filter((c) => /ps-or/.test(c) && !c.startsWith('focus-visible:'))
    expect(laranja).toEqual([])
  })
})
