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
  it('sem atualização não mostra nada', () => {
    desktopFalso()
    const { container } = render(<UpdateBanner />)
    expect(container.innerHTML).toBe('')
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
})
