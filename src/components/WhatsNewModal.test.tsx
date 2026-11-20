// @vitest-environment jsdom
// Novidades na linguagem do palco (Parte 3, faixa C): a janela do palco com a entrada mais nova do
// changelog, e nada some (versão, título, itens, Entendi e Fechar; sem entrada, nada).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WhatsNewModal } from './WhatsNewModal'
import { oldLanguageClasses } from '../test/psLanguage'

const log = vi.hoisted(() => ({
  CHANGELOG: [] as { version: string; date: string; title: string; items: string[] }[],
}))
vi.mock('../lib/changelog', () => log)

const ENTRADA = {
  version: '1.4.30', date: '2026-11-20', title: 'Telas novas no layout do palco',
  items: ['O Metrônomo ficou com a cara do palco.', 'Os pads da nuvem também.'],
}

afterEach(() => {
  cleanup()
  log.CHANGELOG.length = 0
})

describe('Novidades: nada some', () => {
  it('mostra a entrada mais nova: versão, título e itens; Entendi e Fechar fecham', () => {
    log.CHANGELOG.push(ENTRADA, { ...ENTRADA, version: '1.4.29', title: 'Antiga' })
    const onClose = vi.fn()
    render(<WhatsNewModal onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Telas novas no layout do palco' })).toBeTruthy()
    expect(screen.getByText('Novidades · v1.4.30')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(ENTRADA.items)
    expect(document.body.textContent).not.toContain('Antiga')
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('sem entrada no changelog não mostra nada', () => {
    const { container } = render(<WhatsNewModal onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Novidades: linguagem do palco', () => {
  it('só classes da linguagem nova; Entendi é a ação principal', () => {
    log.CHANGELOG.push(ENTRADA)
    render(<WhatsNewModal onClose={vi.fn()} />)
    expect(oldLanguageClasses(document.body)).toEqual([])
    expect(screen.getByRole('button', { name: 'Entendi' }).className).toContain('bg-ps-or')
  })
})
