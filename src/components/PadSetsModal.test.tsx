// @vitest-environment jsdom
// Conjuntos de pads da nuvem na linguagem do palco (Parte 3, faixa C): a janela do palco e tudo
// o que a tela fazia (buscar, escolher, renomear e apagar no admin, carregando, erro e vazio).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PadSetsModal } from './PadSetsModal'
import { oldLanguageClasses } from '../test/psLanguage'

vi.mock('../lib/supabase', () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })) }))

const DESC = 'Pads quentes pra ministração, gravados em estúdio com reverb longo e camadas de cordas'
const SETS = [
  { id: 'a/1', name: 'Pads Domingo', description: DESC, base_path: 'pads/a', created_at: '2026-11-01', note_urls: { C: 'c.mp3' } },
  { id: 'b', name: 'Ambiente', description: null, base_path: 'pads/b', created_at: '2026-11-02' },
]

type Resposta = { ok: boolean; status?: number; json: () => Promise<unknown> }
let fetchMock: ReturnType<typeof vi.fn>

function stubCatalog(get: () => Promise<Resposta>) {
  fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? Promise.resolve({ ok: true, json: async () => ({}) }) : get()))
  vi.stubGlobal('fetch', fetchMock)
}

const ok = (sets: unknown[]) => async () => ({ ok: true, json: async () => ({ sets }) })

function abrir(isAdmin = false) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const selected = { id: 'b', name: 'Ambiente', base_path: 'pads/b' }
  render(<PadSetsModal isOpen onClose={onClose} onSelect={onSelect} selectedPadSet={selected} isAdmin={isAdmin} />)
  return { onSelect, onClose }
}

const escolha = (nome: string) => screen.findByRole('button', { name: new RegExp(`^${nome}`) })
const pedidos = (metodo: string) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === metodo)

beforeEach(() => stubCatalog(ok(SETS)))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Pads da nuvem: nada some', () => {
  it('lista, marca o conjunto em uso e escolhe (e fecha)', async () => {
    const { onSelect, onClose } = abrir()
    expect(screen.getByRole('dialog', { name: 'Pads da nuvem' })).toBeTruthy()
    const domingo = await escolha('Pads Domingo')
    expect(domingo.textContent).toContain(DESC)
    expect((await escolha('Ambiente')).getAttribute('aria-current')).toBe('true')
    expect(domingo.getAttribute('aria-current')).toBeNull()
    fireEvent.click(domingo)
    expect(onSelect).toHaveBeenCalledWith({ id: 'a/1', name: 'Pads Domingo', base_path: 'pads/a', note_urls: { C: 'c.mp3' } })
    expect(onClose).toHaveBeenCalled()
  })

  it('carregando enquanto a busca não volta', () => {
    stubCatalog(() => new Promise(() => {}))
    abrir()
    expect(screen.getByRole('status').textContent).toContain('Carregando')
  })

  it('erro de carregar mostra o código em alerta', async () => {
    stubCatalog(async () => ({ ok: false, status: 500, json: async () => ({ code: 'erro' }) }))
    abrir()
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('Falha ao carregar o catálogo.')
    expect(alerta.textContent).toContain('500 erro')
  })

  it('catálogo vazio diz que não há conjunto e onde enviar', async () => {
    stubCatalog(ok([]))
    abrir()
    expect(await screen.findByText('Nenhum conjunto de pads disponível.')).toBeTruthy()
    expect(screen.getByText('Envie pads pelo painel Admin.')).toBeTruthy()
  })

  it('quem não é admin não vê renomear nem apagar', async () => {
    abrir()
    await escolha('Pads Domingo')
    expect(screen.queryByRole('button', { name: /^Renomear/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Apagar/ })).toBeNull()
  })

  it('admin renomeia: campos preenchidos, Salvar manda o PATCH e atualiza; nome vazio vira "Sem nome"', async () => {
    const { onSelect } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto') as HTMLInputElement
    expect(nome.value).toBe('Pads Domingo')
    expect((screen.getByLabelText('Descrição (opcional)') as HTMLInputElement).value).toBe(DESC)
    // Editando, tocar noutro conjunto não escolhe.
    fireEvent.click(await escolha('Ambiente'))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.change(nome, { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    const [url, init] = pedidos('PATCH')[0]
    expect(url).toBe('/api/pad-catalog')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ id: 'a/1', name: 'Sem nome', description: DESC })
    expect(await escolha('Sem nome')).toBeTruthy()
  })

  it('admin cancela a edição sem mandar nada', async () => {
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(pedidos('PATCH')).toHaveLength(0)
  })

  it('admin apaga com confirmação; cancelar não manda nada', async () => {
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect(screen.getByText('Apagar "Pads Domingo"?')).toBeTruthy()
    expect(screen.getByText('Esta ação não pode ser desfeita.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(pedidos('DELETE')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Apagar Pads Domingo' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apagar' })) })
    const [url] = pedidos('DELETE')[0]
    expect(url).toBe('/api/pad-catalog?id=a%2F1')
    expect(screen.queryByRole('button', { name: /^Pads Domingo/ })).toBeNull()
  })
})

// Revisão macro BC (BC2-M4, BC2-M8): o Esc e o toque fora novos dos pads, e o Esc na edição só cancela a edição.
describe('Pads da nuvem: Esc e toque fora', () => {
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const toqueFora = () => {
    const camada = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.pointerDown(camada)
    fireEvent.click(camada)
  }

  it('sem edição, Esc fecha e o toque fora também', async () => {
    const { onClose } = abrir(true)
    await escolha('Pads Domingo')
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    toqueFora()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renomeando, o Esc no campo cancela só a edição (a janela fica) e o toque fora não fecha', async () => {
    const { onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto') as HTMLInputElement
    fireEvent.change(nome, { target: { value: 'Pads de Domingo à Noite' } })
    toqueFora()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Nome do conjunto') as HTMLInputElement).value).toBe('Pads de Domingo à Noite')
    nome.focus()
    esc()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(pedidos('PATCH')).toHaveLength(0)
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirmando o apagar, o Esc cancela só a confirmação, com o foco no Cancelar dela', async () => {
    const { onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect(document.activeElement?.textContent).toBe('Cancelar')
    toqueFora()
    expect(onClose).not.toHaveBeenCalled()
    esc()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Apagar "Pads Domingo"?')).toBeNull()
    expect(pedidos('DELETE')).toHaveLength(0)
  })
})

describe('Pads da nuvem: linguagem do palco', () => {
  it('só classes da linguagem nova, com o admin aberto', async () => {
    abrir(true)
    await escolha('Pads Domingo')
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})
