// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdminEntryButton } from './AdminEntryButton'

afterEach(cleanup)

const VARIANTS = ['toolbar', 'drawer'] as const

// O ambiente jsdom do Vitest deixa a instância em globalThis.jsdom.
type JsdomConsole = {
  on(event: 'jsdomError', cb: (err: Error) => void): void
  off(event: 'jsdomError', cb: (err: Error) => void): void
}
const jsdomConsole = () => (globalThis as unknown as { jsdom: { virtualConsole: JsdomConsole } }).jsdom.virtualConsole

describe('AdminEntryButton', () => {
  it('AdminEntryButton não aparece pra quem não é admin', () => {
    for (const variant of VARIANTS) {
      const { container } = render(<AdminEntryButton isAdmin={false} variant={variant} onOpen={() => {}} />)
      expect(container.innerHTML).toBe('')
      expect(screen.queryByRole('button')).toBeNull()
      cleanup()
    }
  })

  it('o clique chama onOpen e não mexe no endereço', () => {
    // O jsdom não troca de página: quem tenta (location.href = '/admin') só gera um aviso
    // no console virtual dele. O href igual pega a troca por hash; o aviso pega o resto.
    const navigations: string[] = []
    const onJsdomError = (err: Error) => { navigations.push(err.message) }
    jsdomConsole().on('jsdomError', onJsdomError)
    try {
      for (const variant of VARIANTS) {
        const onOpen = vi.fn()
        const before = window.location.href
        render(<AdminEntryButton isAdmin variant={variant} onOpen={onOpen} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(window.location.href).toBe(before)
        cleanup()
      }
    } finally {
      jsdomConsole().off('jsdomError', onJsdomError)
    }
    expect(navigations).toEqual([])
  })

  it('na barra mostra ADMIN e no menu mostra Admin', () => {
    render(<AdminEntryButton isAdmin variant="toolbar" onOpen={() => {}} />)
    const toolbar = screen.getByRole('button')
    expect(toolbar.textContent).toBe('ADMIN')
    // O texto some em tela estreita: o nome acessível não depende dele.
    expect(toolbar.getAttribute('aria-label')).toBe('Admin')
    expect(toolbar.querySelector('svg')).not.toBeNull()
    cleanup()

    render(<AdminEntryButton isAdmin variant="drawer" onOpen={() => {}} />)
    const drawer = screen.getByRole('button')
    expect(drawer.textContent).toBe('Admin')
    expect(drawer.querySelectorAll('svg').length).toBe(2)
  })
})
