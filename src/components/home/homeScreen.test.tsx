// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HomeScreen } from './HomeScreen'
import { HOME_COPY } from './homeCopy'
import { oldLanguageClasses } from '../../test/psLanguage'

const TRAVESSAO = String.fromCharCode(0x2014)

afterEach(cleanup)

function mount(over: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const onMultitracks = vi.fn()
  const onSeparator = vi.fn()
  const r = render(<HomeScreen restoring={false} onMultitracks={onMultitracks} onSeparator={onSeparator} {...over} />)
  return { ...r, onMultitracks, onSeparator }
}

describe('tela inicial (HomeScreen)', () => {
  it('Multitracks e Separação de Faixas com as linhas de hoje chamam as ações', () => {
    const { onMultitracks, onSeparator } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Multitracks/ }))
    expect(onMultitracks).toHaveBeenCalledTimes(1)
    expect(onSeparator).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Separação de Faixas/ }))
    expect(onSeparator).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Motor de playback profissional')).toBeTruthy()
    expect(screen.getByText('Separar instrumentos com IA')).toBeTruthy()
    // Os dois nomes ficam no nome do botão, com a linha de baixo.
    expect(screen.getByRole('button', { name: /Multitracks.*Motor de playback profissional/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Separação de Faixas.*Separar instrumentos com IA/ })).toBeTruthy()
  })

  it('restaurando, o Multitracks mostra o spinner e fica aria-busy; parado, o play', () => {
    const { container, rerender, onMultitracks, onSeparator } = mount({ restoring: true })
    const multi = screen.getByRole('button', { name: /Multitracks/ })
    expect(multi.getAttribute('aria-busy')).toBe('true')
    expect(multi.querySelector('[data-home-icon="restoring"]')).toBeTruthy()
    // Restaurando, o toque continua valendo (como hoje).
    fireEvent.click(multi)
    expect(onMultitracks).toHaveBeenCalledTimes(1)
    rerender(<HomeScreen restoring={false} onMultitracks={onMultitracks} onSeparator={onSeparator} />)
    const again = screen.getByRole('button', { name: /Multitracks/ })
    expect(again.getAttribute('aria-busy')).toBeNull()
    expect(container.querySelector('[data-home-icon="restoring"]')).toBeNull()
    expect(again.querySelector('[data-home-icon="play"]')).toBeTruthy()
  })

  it('marca e frase de hoje: Playback Studio e A plataforma do domingo', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Playback Studio')
    expect(screen.getByText('A plataforma do domingo')).toBeTruthy()
    expect(HOME_COPY.tagline).toBe('A plataforma do domingo')
  })

  it('o anúncio entra embaixo dos dois botões quando vem; sem ad, nenhum anúncio', () => {
    const { container } = mount({ ad: <div data-house-ad="home">anúncio</div> })
    const ad = container.querySelector('[data-house-ad="home"]')!
    expect(ad).toBeTruthy()
    const separator = screen.getByRole('button', { name: /Separação de Faixas/ })
    // Depois dos dois botões na ordem da página.
    expect(separator.compareDocumentPosition(ad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    const none = mount()
    expect(none.container.querySelector('[data-house-ad]')).toBeNull()
    expect(none.container.querySelector('[data-home-ad]')).toBeNull()
  })

  it('o lugar do anúncio some quando o AdSlot não mostra nada (empty:hidden)', () => {
    const Nothing = () => null
    const { container } = mount({ ad: <Nothing /> })
    const slot = container.querySelector('[data-home-ad]')!
    expect(slot.childElementCount).toBe(0)
    expect(slot.className).toMatch(/\bempty:hidden\b/)
  })

  it('linguagem do palco: nada do visual antigo, sem a luz laranja piscando no logo', () => {
    const { container } = mount({ restoring: true })
    expect(oldLanguageClasses(container)).toEqual([])
    expect(container.querySelector('.animate-led, .animate-ps-blink')).toBeNull()
    expect(container.querySelector('[data-home-screen]')).toBeTruthy()
  })

  it('nenhum texto com travessão', () => {
    const { container } = mount({ ad: <div data-house-ad="home" /> })
    expect(container.textContent).not.toContain(TRAVESSAO)
    for (const f of ['HomeScreen.tsx', 'homeCopy.ts']) {
      expect(readFileSync(join(process.cwd(), 'src/components/home', f), 'utf8')).not.toContain(TRAVESSAO)
    }
  })
})
