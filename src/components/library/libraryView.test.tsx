// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LibraryView } from './LibraryView'
import type { LibraryViewProps } from './LibraryView'
import type { LibraryRow } from './libraryRows'
import { oldLanguageClasses } from '../../test/psLanguage'

const TRAVESSAO = String.fromCharCode(0x2014)

afterEach(cleanup)

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'r1', name: 'Grande é o Senhor', artist: 'Ministério', coverUrl: null, key: 'G', bpm: 72.5, cached: false,
  state: 'import', progress: '', canEdit: false, canDelete: false, deleting: false, ...over,
})

function props(over: Partial<LibraryViewProps> = {}): LibraryViewProps {
  return {
    open: true, onClose: vi.fn(), onRefresh: vi.fn(), query: '', onQuery: vi.fn(), tab: 'platform', onTab: vi.fn(),
    loading: false, countText: '1 música exibida', emptyText: null,
    rows: [row()], anyDownloading: false, online: true, edit: null, savingEdit: false,
    onImport: vi.fn(), onCancel: vi.fn(), onEdit: vi.fn(), onEditChange: vi.fn(), onEditSave: vi.fn(), onEditClose: vi.fn(),
    onAskDelete: vi.fn(), confirmDelete: null, onConfirmDelete: vi.fn(), onCancelDelete: vi.fn(),
    ...over,
  }
}

function mount(over: Partial<LibraryViewProps> = {}) {
  const p = props(over)
  const r = render(<LibraryView {...p} />)
  return { ...r, p, rerenderWith: (more: Partial<LibraryViewProps>) => r.rerender(<LibraryView {...p} {...more} />) }
}

const rowEl = (id: string) => document.querySelector(`[data-library-row="${id}"]`) as HTMLElement

describe('Biblioteca: a casca (LibraryView)', () => {
  it('fechada não renderiza nada; aberta mostra o título e fecha no X', () => {
    const closed = mount({ open: false })
    expect(closed.container.innerHTML).toBe('')
    cleanup()
    const { p } = mount()
    const dialog = screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('Atualizar chama onRefresh; a busca chama onQuery e o Limpar só aparece com texto', () => {
    const { p, rerenderWith } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Atualizar/ }))
    expect(p.onRefresh).toHaveBeenCalledTimes(1)
    const search = screen.getByRole('searchbox', { name: 'Pesquisar' }) as HTMLInputElement
    expect(search.placeholder).toBe('Pesquisar por nome, artista ou tom...')
    expect(screen.queryByRole('button', { name: 'Limpar a busca' })).toBeNull()
    fireEvent.change(search, { target: { value: 'fé' } })
    expect(p.onQuery).toHaveBeenCalledWith('fé')
    rerenderWith({ query: 'fé' })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar a busca' }))
    expect(p.onQuery).toHaveBeenLastCalledWith('')
  })

  it('as abas Plataforma e Minhas Músicas trocam pelo onTab', () => {
    const { p } = mount()
    const platform = screen.getByRole('tab', { name: /Plataforma/i })
    expect(platform.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /Minhas Músicas/i }))
    expect(p.onTab).toHaveBeenCalledWith('personal')
    // As músicas ficam no painel da aba aberta.
    expect(within(screen.getByRole('tabpanel')).getByText('Grande é o Senhor')).toBeTruthy()
  })

  it('carregando e vazio mostram as frases de hoje; o rodapé conta', () => {
    const { rerenderWith } = mount({ loading: true })
    expect(screen.getByRole('status').textContent).toContain('Carregando a biblioteca...')
    expect(screen.queryByText('Grande é o Senhor')).toBeNull()
    rerenderWith({ loading: false, rows: [], emptyText: 'Plataforma vazia.', countText: '0 músicas exibidas' })
    expect(screen.getByText('Plataforma vazia.')).toBeTruthy()
    expect(screen.getByText('0 músicas exibidas')).toBeTruthy()
    rerenderWith({ loading: false })
    expect(screen.getByText('Grande é o Senhor')).toBeTruthy()
    expect(screen.getByText('1 música exibida')).toBeTruthy()
  })

  it('message aparece em alerta dentro da janela', () => {
    mount({ message: 'Erro ao salvar alterações na música.' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Erro ao salvar alterações na música.')
    expect(screen.getByRole('dialog').contains(alert)).toBe(true)
  })
})

describe('Biblioteca: as músicas, editar, excluir e baixar (LibraryView)', () => {
  it('linha: capa, nome, artista ou Artista Desconhecido, TOM, BPM e OFFLINE no cache', () => {
    mount({ rows: [row({ id: 'a', coverUrl: 'https://r2/capa.jpg', cached: true, state: 'open' }), row({ id: 'b', artist: null, key: null, bpm: undefined })] })
    const a = rowEl('a')
    expect(a.querySelector('img')!.getAttribute('src')).toBe('https://r2/capa.jpg')
    expect(within(a).getByText('Ministério')).toBeTruthy()
    expect(within(a).getByText('TOM: G')).toBeTruthy()
    expect(within(a).getByText('72.5 BPM')).toBeTruthy()
    expect(a.querySelector('[data-cached]')!.textContent).toBe('OFFLINE')
    const b = rowEl('b')
    expect(within(b).getByText('Artista Desconhecido')).toBeTruthy()
    expect(within(b).queryByText(/TOM:/)).toBeNull()
    expect(within(b).queryByText(/BPM/)).toBeNull()
    expect(b.querySelector('[data-cached]')).toBeNull()
    expect(b.querySelector('img')).toBeNull()
  })

  it('Importar chama onImport com id e nome; Abrir no cache; desligado enquanto outra baixa', () => {
    const { p, rerenderWith } = mount({ rows: [row({ id: 'a' }), row({ id: 'b', name: 'Santo', cached: true, state: 'open' })] })
    const importar = within(rowEl('a')).getByRole('button', { name: /IMPORTAR/ }) as HTMLButtonElement
    expect(importar.title).toBe('Baixar e importar da Nuvem')
    fireEvent.click(importar)
    expect(p.onImport).toHaveBeenCalledWith('a', 'Grande é o Senhor')
    const abrir = within(rowEl('b')).getByRole('button', { name: /ABRIR/ }) as HTMLButtonElement
    expect(abrir.title).toBe('Carregar do cache local offline')
    fireEvent.click(abrir)
    expect(p.onImport).toHaveBeenLastCalledWith('b', 'Santo')
    rerenderWith({ anyDownloading: true })
    expect((within(rowEl('a')).getByRole('button', { name: /IMPORTAR/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(rowEl('b')).getByRole('button', { name: /ABRIR/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('baixando mostra o progresso e Cancelar chama onCancel; ADICIONADA depois', () => {
    const { p, rerenderWith } = mount({ rows: [row({ state: 'downloading', progress: 'Baixando as multitracks: 12,3 MB (2 de 5)' })], anyDownloading: true })
    const status = within(rowEl('r1')).getByRole('status')
    expect(status.textContent).toContain('Baixando as multitracks: 12,3 MB (2 de 5)')
    const cancel = within(status).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement
    expect(cancel.title).toBe('Cancelar download')
    fireEvent.click(cancel)
    expect(p.onCancel).toHaveBeenCalledWith('r1')
    rerenderWith({ rows: [row({ state: 'added' })], anyDownloading: false })
    expect(rowEl('r1').querySelector('[data-added]')!.textContent).toBe('ADICIONADA')
    expect(within(rowEl('r1')).queryByRole('button', { name: /IMPORTAR/ })).toBeNull()
  })

  it('sem internet: ABRIR no cache, OFFLINE desligado fora dele e sem editar', () => {
    mount({ online: false, rows: [row({ id: 'a', cached: true, state: 'open', canDelete: true }), row({ id: 'b', state: 'offline' })] })
    expect(within(rowEl('a')).getByRole('button', { name: /ABRIR/ })).toBeTruthy()
    const off = within(rowEl('b')).getByRole('button', { name: 'OFFLINE' }) as HTMLButtonElement
    expect(off.disabled).toBe(true)
    expect(off.parentElement!.title).toBe('Conecte-se à internet para baixar esta música')
    expect(screen.queryByRole('button', { name: 'Editar metadados' })).toBeNull()
    // Sem internet o excluir só tira do aparelho.
    expect(within(rowEl('a')).getByRole('button', { name: 'Remover do Cache Local' })).toBeTruthy()
  })

  it('Editar abre o formulário com Nome, Artista, BPM, Tom e capa; Salvar chama onEditSave; fechar não salva', () => {
    const { p, rerenderWith } = mount({ rows: [row({ canEdit: true, canDelete: true })] })
    const editar = within(rowEl('r1')).getByRole('button', { name: 'Editar metadados' })
    expect(editar.title).toBe('Editar metadados')
    fireEvent.click(editar)
    expect(p.onEdit).toHaveBeenCalledWith('r1')
    rerenderWith({ edit: { id: 'r1', name: 'Grande é o Senhor', artist: 'Ministério', bpmText: '72.5', key: 'G', file: null } })
    const form = screen.getByRole('group', { name: 'Editar Música' })
    expect((within(form).getByLabelText('Nome') as HTMLInputElement).value).toBe('Grande é o Senhor')
    expect((within(form).getByLabelText('Artista') as HTMLInputElement).value).toBe('Ministério')
    const bpm = within(form).getByLabelText('BPM') as HTMLInputElement
    expect(bpm.value).toBe('72.5')
    expect(bpm.inputMode).toBe('decimal')
    expect((within(form).getByLabelText('Tom') as HTMLInputElement).value).toBe('G')
    expect(within(form).getByText('Nova Capa (Opcional)')).toBeTruthy()
    expect(within(form).getByRole('button', { name: 'Escolher imagem...' })).toBeTruthy()
    fireEvent.change(bpm, { target: { value: '72,5' } })
    expect(p.onEditChange).toHaveBeenCalledWith({ bpmText: '72,5' })
    fireEvent.click(within(form).getByRole('button', { name: /Salvar/i }))
    expect(p.onEditSave).toHaveBeenCalledTimes(1)
    fireEvent.click(within(form).getByRole('button', { name: 'Fechar a edição' }))
    expect(p.onEditClose).toHaveBeenCalledTimes(1)
    // Esc dentro da edição fecha a edição, não a Biblioteca.
    fireEvent.keyDown(within(form).getByLabelText('Nome'), { key: 'Escape' })
    expect(p.onEditClose).toHaveBeenCalledTimes(2)
    expect(p.onClose).not.toHaveBeenCalled()
    // A capa escolhida aparece e o Tirar volta pra nenhuma.
    rerenderWith({ edit: { id: 'r1', name: 'x', artist: '', bpmText: '', key: '', file: new File(['i'], 'capa.png', { type: 'image/png' }) } })
    expect(screen.getByText('capa.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tirar' }))
    expect(p.onEditChange).toHaveBeenLastCalledWith({ file: null })
  })

  it('salvando, o Salvar gira desligado; o erro aparece em alerta no formulário', () => {
    mount({ edit: { id: 'r1', name: 'a', artist: '', bpmText: 'setenta', key: '', file: null }, savingEdit: true, message: 'O BPM precisa ser um número.' })
    const form = screen.getByRole('group', { name: 'Editar Música' })
    const save = within(form).getByRole('button', { name: /Salvar/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(save.getAttribute('aria-busy')).toBe('true')
    expect(within(form).getByRole('alert').textContent).toBe('O BPM precisa ser um número.')
  })

  it('excluir sem internet pergunta "Remover do cache offline" e com internet avisa que some pra todos', () => {
    const { p, rerenderWith } = mount({ rows: [row({ canDelete: true })] })
    fireEvent.click(within(rowEl('r1')).getByRole('button', { name: 'Excluir da Nuvem' }))
    expect(p.onAskDelete).toHaveBeenCalledWith('r1')
    rerenderWith({ confirmDelete: { name: 'Grande é o Senhor', online: true, busy: false } })
    const online = screen.getByRole('dialog', { name: 'Excluir da nuvem?' })
    expect(online.textContent).toContain('Excluir "Grande é o Senhor" da Nuvem e do Cache Local? Isso removerá permanentemente para todos os usuários.')
    rerenderWith({ online: false, confirmDelete: { name: 'Grande é o Senhor', online: false, busy: false } })
    const offline = screen.getByRole('dialog', { name: 'Remover do aparelho?' })
    expect(offline.textContent).toContain('Remover "Grande é o Senhor" do Cache Offline local?')
  })

  it('a confirmação: Cancelar e Excluir chamam as ações; excluindo, nada fecha; a Biblioteca continua aberta', () => {
    const { p, rerenderWith } = mount({ rows: [row({ canDelete: true })], confirmDelete: { name: 'Grande é o Senhor', online: true, busy: false } })
    const confirm = screen.getByRole('dialog', { name: 'Excluir da nuvem?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }))
    expect(p.onCancelDelete).toHaveBeenCalledTimes(1)
    fireEvent.click(within(confirm).getByRole('button', { name: /Excluir/ }))
    expect(p.onConfirmDelete).toHaveBeenCalledTimes(1)
    // Esc fecha só a de cima (a confirmação).
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(p.onCancelDelete).toHaveBeenCalledTimes(2)
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })).toBeTruthy()
    rerenderWith({ confirmDelete: { name: 'Grande é o Senhor', online: true, busy: true }, rows: [row({ canDelete: true, deleting: true })] })
    const busy = screen.getByRole('dialog', { name: 'Excluir da nuvem?' })
    expect((within(busy).getByRole('button', { name: /Excluir/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(busy).getByRole('button', { name: 'Fechar' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(rowEl('r1')).getByRole('button', { name: 'Excluir da Nuvem' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('linguagem do palco e nenhum texto com travessão', () => {
    mount({
      message: 'erro',
      rows: [row({ id: 'a', canEdit: true, canDelete: true, cached: true, state: 'open' }), row({ id: 'b', state: 'downloading', progress: 'Buscando as multitracks...' }), row({ id: 'c', state: 'added' }), row({ id: 'd', state: 'offline' })],
      confirmDelete: { name: 'x', online: true, busy: false },
    })
    for (const dialog of screen.getAllByRole('dialog')) {
      expect(oldLanguageClasses(dialog)).toEqual([])
      expect(dialog.textContent).not.toContain(TRAVESSAO)
    }
    for (const f of ['LibraryView.tsx', 'libraryRows.ts']) {
      expect(readFileSync(join(process.cwd(), 'src/components/library', f), 'utf8')).not.toContain(TRAVESSAO)
    }
  })

  it('nenhum window.confirm nem alert sobrou na Biblioteca (o contêiner e o hook dele, inicio-1 M2)', () => {
    for (const f of ['src/components/LibraryModal.tsx', 'src/hooks/useCloudLibrary.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/\b(confirm|alert)\s*\(/)
      expect(src, f).not.toContain(TRAVESSAO)
    }
  })
})
