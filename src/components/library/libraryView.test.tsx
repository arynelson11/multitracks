// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LibraryView } from './LibraryView'
import type { LibraryViewProps } from './LibraryView'
import { oldLanguageClasses } from '../../test/psLanguage'

const TRAVESSAO = String.fromCharCode(0x2014)

afterEach(cleanup)

function mount(over: Partial<LibraryViewProps> = {}) {
  const props: LibraryViewProps = {
    open: true, onClose: vi.fn(), onRefresh: vi.fn(), query: '', onQuery: vi.fn(), tab: 'platform', onTab: vi.fn(),
    loading: false, countText: '2 músicas exibidas', emptyText: null,
    children: <div data-row>linha</div>,
    ...over,
  }
  const r = render(<LibraryView {...props} />)
  return { ...r, props }
}

describe('Biblioteca: a casca (LibraryView)', () => {
  it('fechada não renderiza nada; aberta mostra o título e fecha no X', () => {
    const closed = mount({ open: false })
    expect(closed.container.innerHTML).toBe('')
    cleanup()
    const { props } = mount()
    const dialog = screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('Atualizar chama onRefresh; a busca chama onQuery e o Limpar só aparece com texto', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Atualizar/ }))
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    const search = screen.getByRole('searchbox', { name: 'Pesquisar' }) as HTMLInputElement
    expect(search.placeholder).toBe('Pesquisar por nome, artista ou tom...')
    expect(screen.queryByRole('button', { name: 'Limpar a busca' })).toBeNull()
    fireEvent.change(search, { target: { value: 'fé' } })
    expect(props.onQuery).toHaveBeenCalledWith('fé')
    rerender(<LibraryView {...props} query="fé" />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar a busca' }))
    expect(props.onQuery).toHaveBeenLastCalledWith('')
  })

  it('as abas Plataforma e Minhas Músicas trocam pelo onTab', () => {
    const { props } = mount()
    const platform = screen.getByRole('tab', { name: /Plataforma/i })
    expect(platform.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /Minhas Músicas/i }))
    expect(props.onTab).toHaveBeenCalledWith('personal')
    // As linhas ficam no painel da aba aberta.
    expect(within(screen.getByRole('tabpanel')).getByText('linha')).toBeTruthy()
  })

  it('carregando e vazio mostram as frases de hoje; o rodapé conta', () => {
    const { rerender, props } = mount({ loading: true })
    expect(screen.getByRole('status').textContent).toContain('Carregando a biblioteca...')
    expect(screen.queryByText('linha')).toBeNull()
    rerender(<LibraryView {...props} loading={false} emptyText="Plataforma vazia." countText="0 músicas exibidas" />)
    expect(screen.getByText('Plataforma vazia.')).toBeTruthy()
    expect(screen.queryByText('linha')).toBeNull()
    expect(screen.getByText('0 músicas exibidas')).toBeTruthy()
    rerender(<LibraryView {...props} loading={false} />)
    expect(screen.getByText('linha')).toBeTruthy()
    expect(screen.getByText('2 músicas exibidas')).toBeTruthy()
  })

  it('message aparece em alerta dentro da janela', () => {
    mount({ message: 'Erro ao salvar alterações na música.' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Erro ao salvar alterações na música.')
    expect(screen.getByRole('dialog').contains(alert)).toBe(true)
  })

  it('linguagem do palco e nenhum texto com travessão', () => {
    mount({ message: 'erro' })
    const dialog = screen.getByRole('dialog')
    expect(oldLanguageClasses(dialog)).toEqual([])
    expect(dialog.textContent).not.toContain(TRAVESSAO)
    for (const f of ['LibraryView.tsx', 'libraryRows.ts']) {
      expect(readFileSync(join(process.cwd(), 'src/components/library', f), 'utf8')).not.toContain(TRAVESSAO)
    }
  })
})
