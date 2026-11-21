// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { TWO_TAP_MIN_GAP_MS, TWO_TAP_WINDOW_MS } from '../../hooks/useTwoTapConfirm'
import type { StageView } from '../../lib/stageContracts'
import { PadPanel } from './PadPanel'
import type { PadPanelProps } from './PadPanel'
import { RepertoirePanel } from './RepertoirePanel'
import type { RepertoirePanelProps, RepertoireSongItem } from './RepertoirePanel'
import { HouseAdCard } from '../livre/HouseAdCard'
import { StageAppBar } from './StageAppBar'
import type { StageAppBarProps } from './StageAppBar'
import { TwoTapTrashButton } from './TwoTapTrashButton'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// O jsdom não faz layout: posição falsa de cada elemento.
const rect = (top: number, height: number, left = 0, width = 200) =>
  ({ top, height, left, width, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
// Ponteiro como na onda: MouseEvent com o nome do evento de ponteiro (o React ouve pelo nome).
const pointer = (el: Element, type: string, at: { clientX?: number; clientY?: number }) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, ...at }))
// Alvo de 44 px e largura pelo texto: piso de 44 sem largura fixa.
const expectTouch = (el: Element) => {
  const classes = el.className.split(/\s+/)
  expect(classes).toEqual(expect.arrayContaining(['min-h-ps-touch', 'min-w-ps-touch']))
  expect(classes.some((c) => /^w-\d|^w-\[/.test(c))).toBe(false)
}
/** Texto visível, nomes acessíveis, dicas e exemplos: tudo em português e sem travessão. */
const expectPortuguese = (root: HTMLElement) => {
  expect(root.textContent).not.toContain(TRAVESSAO)
  expect(root.textContent).not.toMatch(PROIBIDAS)
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder]')) {
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(attr) ?? ''
      expect(v).not.toContain(TRAVESSAO)
      expect(v).not.toMatch(PROIBIDAS)
    }
  }
}

// ---------- Barra do app ----------

const APP: StageView['app'] = { online: true, isDesktop: false, isAdmin: false, userName: 'Ary Nelson', hostActive: false, livre: null }
const appActions = () => ({
  openRepertoires: vi.fn(), openTracks: vi.fn(), openLibrary: vi.fn(), toggleEditMode: vi.fn(),
  openHost: vi.fn(), openSettings: vi.fn(), goHome: vi.fn(), signOut: vi.fn(), openLivreBadge: vi.fn(),
}) satisfies StageAppBarProps['actions']
const renderBar = (app: Partial<StageView['app']> = {}, editMode = false) => {
  const actions = appActions()
  const r = render(<StageAppBar app={{ ...APP, ...app }} editMode={editMode} actions={actions} />)
  return { ...r, actions }
}
const tour = (name: string) => document.querySelector(`[data-tour="${name}"]`) as HTMLElement | null
const badge = () => document.querySelector('[data-online]') as HTMLElement
const livreBadge = () => document.querySelector('[data-livre-badge]') as HTMLElement | null

describe('barra do app', () => {
  it('HOST só no desktop e EDITAR aceso no modo editar', () => {
    const { rerender, actions } = renderBar()
    expect(tour('host')).toBeNull()
    expect(screen.queryByRole('button', { name: /host/i })).toBeNull()
    expect(tour('editar')!.getAttribute('aria-pressed')).toBe('false')
    expect(tour('editar')!.dataset.on).toBe('false')

    rerender(<StageAppBar app={{ ...APP, isDesktop: true }} editMode actions={actions} />)
    expect(tour('host')).not.toBeNull()
    expect(tour('host')!.dataset.on).toBe('false')
    expect(tour('editar')!.getAttribute('aria-pressed')).toBe('true')
    expect(tour('editar')!.dataset.on).toBe('true')

    // Host ligado acende o HOST (laranja = ligado).
    rerender(<StageAppBar app={{ ...APP, isDesktop: true, hostActive: true }} editMode={false} actions={actions} />)
    expect(tour('host')!.dataset.on).toBe('true')
    expect(tour('host')!.innerHTML).toContain('ps-or')
    expect(tour('editar')!.dataset.on).toBe('false')
  })

  it('cada botão chama a ação dele, com o data-tour de antes e alvo de 44 px', () => {
    const { actions } = renderBar({ isDesktop: true })
    const pairs: Array<[string, keyof typeof actions]> = [
      ['repertorios', 'openRepertoires'], ['faixas', 'openTracks'], ['biblioteca', 'openLibrary'], ['editar', 'toggleEditMode'],
      ['host', 'openHost'], ['config', 'openSettings'], ['inicio', 'goHome'],
    ]
    for (const [name, action] of pairs) {
      const btn = tour(name)!
      expect(btn.tagName).toBe('BUTTON')
      expectTouch(btn)
      fireEvent.click(btn)
      expect(actions[action]).toHaveBeenCalledTimes(1)
    }
    const sair = screen.getByRole('button', { name: 'Sair' })
    expectTouch(sair)
    fireEvent.click(sair)
    expect(actions.signOut).toHaveBeenCalledTimes(1)
    // Ordem do mockup v5.
    const nav = screen.getByRole('navigation', { name: 'Navegação do app' })
    const texts = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(texts).toEqual(['REPERTÓRIOS', 'FAIXAS', 'BIBLIOTECA', 'EDITAR', 'HOST', 'CONFIG', 'INÍCIO', 'SAIR'])
    expect(screen.getByRole('banner').textContent).toContain('Playback Studio')
    expect(screen.getByRole('img', { name: 'Ary Nelson' }).textContent).toBe('A')
  })

  it('OFFLINE não usa cor de alerta', () => {
    const { rerender, actions } = renderBar()
    expect(badge().textContent).toBe('ONLINE')
    expect(badge().outerHTML).toContain('ps-moss')
    rerender(<StageAppBar app={{ ...APP, online: false }} editMode={false} actions={actions} />)
    expect(badge().textContent).toBe('OFFLINE')
    // Neutro: nem o âmbar do alerta, nem vermelho, nem o musgo do ONLINE.
    expect(badge().outerHTML).not.toMatch(/alert|red|mute|moss|#/)
    expect(badge().title).not.toBe('')
  })

  it('a barra do app mostra o selo com app.livre e o toque chama openLivreBadge', () => {
    const { actions } = renderBar({ isDesktop: true, online: false, hostActive: true, livre: { used: 2, limit: 3 } })
    const selo = screen.getByRole('button', { name: 'LIVRE · 2 de 3 músicas este mês' })
    expect(selo).toBe(livreBadge())
    expect(selo.title).toBe('Ver os planos')
    expectTouch(selo)
    // Ao lado do selo ONLINE/OFFLINE, fora do menu.
    expect(badge().nextElementSibling).toBe(selo)
    expect(within(screen.getByRole('navigation', { name: 'Navegação do app' })).queryByText(/LIVRE/)).toBeNull()
    fireEvent.click(selo)
    expect(actions.openLivreBadge).toHaveBeenCalledTimes(1)
    for (const other of ['openRepertoires', 'openTracks', 'openLibrary', 'toggleEditMode', 'openHost', 'openSettings', 'goHome', 'signOut'] as const) {
      expect(actions[other]).not.toHaveBeenCalled()
    }
  })

  it('com a sessão do Ao Vivo ligada a barra mostra o tempo no selo; tocando (tappable falso) sem toque', () => {
    const { rerender, actions } = renderBar({ isDesktop: true, hostActive: true, livre: { used: 2, limit: 3, liveLeftMs: 432_000 } })
    expect(livreBadge()!.textContent).toBe('LIVRE · 07:12 com a banda hoje')
    fireEvent.click(livreBadge()!)
    expect(actions.openLivreBadge).toHaveBeenCalledTimes(1)
    rerender(<StageAppBar app={{ ...APP, isDesktop: true, hostActive: true, livre: { used: 2, limit: 3, liveLeftMs: 431_000, tappable: false } }} editMode={false} actions={actions} />)
    expect(livreBadge()!.tagName).toBe('SPAN')
    expect(livreBadge()!.textContent).toBe('LIVRE · 07:11 com a banda hoje')
    fireEvent.click(livreBadge()!)
    expect(actions.openLivreBadge).toHaveBeenCalledTimes(1)
  })

  it('sem app.livre a barra não mostra o selo', () => {
    const { rerender, actions } = renderBar({ livre: null })
    expect(livreBadge()).toBeNull()
    expect(screen.getByRole('banner').textContent).not.toMatch(/LIVRE|músicas este mês/)
    // Sem o selo a marca fica sempre; com ele, abaixo de 1280 px fica só o PlayMark (a barra cabe em 1024 px).
    const wordmark = () => document.querySelector('[data-wordmark]') as HTMLElement
    expect(wordmark().textContent).toBe('Playback Studio')
    expect(wordmark().className).not.toContain('hidden')
    rerender(<StageAppBar app={{ ...APP, livre: { used: 0, limit: 3 } }} editMode={false} actions={actions} />)
    expect(livreBadge()!.textContent).toBe('LIVRE · 0 de 3 músicas este mês')
    expect(wordmark().className.split(/\s+/)).toEqual(['hidden', 'xl:inline'])
    rerender(<StageAppBar app={{ ...APP, livre: null }} editMode={false} actions={actions} />)
    expect(livreBadge()).toBeNull()
    expect(wordmark().className).not.toContain('hidden')
  })
})

// ---------- Lixeira genérica de dois toques ----------

const trash = (name: RegExp) => screen.getByRole('button', { name })
const armedText = (el: HTMLElement) => el.textContent

describe('lixeira de dois toques', () => {
  it('lixeira genérica anuncia o rótulo recebido, não "canal"', () => {
    const onConfirm = vi.fn()
    render(<TwoTapTrashButton label="Tirar Fé do repertório" confirmLabel="Toque de novo para tirar Fé do repertório" onConfirm={onConfirm} />)
    const btn = trash(/Fé/)
    expect(btn.getAttribute('aria-label')).toBe('Tirar Fé do repertório')
    expect(btn.title).toBe('Tirar Fé do repertório')
    expect(btn.outerHTML).not.toMatch(/canal/i)
    expectTouch(btn)
    expect(btn.className).toContain('whitespace-nowrap')

    fireEvent.click(btn)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(btn.getAttribute('aria-label')).toBe('Toque de novo para tirar Fé do repertório')
    expect(armedText(btn)).toBe('Apagar?')
    // Armada: âmbar do token de alerta, com padding pro texto (sem largura fixa).
    expect(btn.className).toContain('bg-ps-alert')
    expect(btn.className).not.toContain('#')
    expectTouch(btn)

    // Segundo toque cedo demais (duplo clique) não confirma; depois de 350 ms confirma uma vez.
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS - 1) })
    fireEvent.click(btn)
    expect(onConfirm).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    fireEvent.click(btn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(btn.getAttribute('aria-label')).toBe('Tirar Fé do repertório')
  })

  it('desarma sozinha em 3000 ms, com Esc e ao armar outra lixeira', () => {
    const a = vi.fn()
    const b = vi.fn()
    render(
      <>
        <TwoTapTrashButton label="Tirar Fé do repertório" confirmLabel="Toque de novo para tirar Fé do repertório" onConfirm={a} />
        <TwoTapTrashButton label="Tirar Morada do repertório" confirmLabel="Toque de novo para tirar Morada do repertório" onConfirm={b} />
      </>,
    )
    const fe = () => trash(/Fé/)
    const morada = () => trash(/Morada/)
    fireEvent.click(fe())
    act(() => { vi.advanceTimersByTime(TWO_TAP_WINDOW_MS) })
    expect(armedText(fe())).toBe('')
    fireEvent.click(fe())
    expect(a).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(armedText(fe())).toBe('')

    // Uma armada por vez: armar a outra desarma a primeira.
    fireEvent.click(fe())
    fireEvent.click(morada())
    expect([armedText(fe()), armedText(morada())]).toEqual(['', 'Apagar?'])
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS) })
    fireEvent.click(fe())
    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  it('Enter segurado não aciona a lixeira; o primeiro Enter sim', () => {
    render(<TwoTapTrashButton label="Tirar Fé do repertório" confirmLabel="Toque de novo para tirar Fé do repertório" onConfirm={() => {}} />)
    const first = createEvent.keyDown(trash(/Fé/), { key: 'Enter' })
    fireEvent(trash(/Fé/), first)
    expect(first.defaultPrevented).toBe(false)
    for (const key of ['Enter', ' ']) {
      const held = createEvent.keyDown(trash(/Fé/), { key, repeat: true })
      fireEvent(trash(/Fé/), held)
      expect(held.defaultPrevented).toBe(true)
    }
  })
})

// ---------- Painel REPERTÓRIOS ----------

const SONGS: RepertoireSongItem[] = [
  { id: 's1', name: 'Fé', artist: 'Morada', coverImage: 'data:image/png;base64,AAAA', originalKey: 'G', bpm: 78 },
  { id: 's2', name: 'Eu era Órfão', artist: 'Ministério Zoe', originalKey: 'D', bpm: 136.5 },
  { id: 's3', name: 'Ousado Amor', originalKey: null, bpm: null },
]
const repProps = (patch: Partial<RepertoirePanelProps> = {}): RepertoirePanelProps => ({
  open: true, songs: SONGS, activeIndex: 0, isPlaying: true, notes: '',
  onNotesChange: vi.fn(), onSelect: vi.fn(), onReorder: vi.fn(), onRemove: vi.fn(),
  onNew: vi.fn(), onExport: vi.fn(), onImport: vi.fn(), onClose: vi.fn(), ...patch,
})
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-row]')]
const songButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const grip = (name: string) => screen.getByRole('button', { name: `Mover ${name}` })

describe('painel REPERTÓRIOS', () => {
  it('repertório: escolher, reordenar, tirar música com 2 toques e anotar', () => {
    const p = repProps()
    const { rerender } = render(<RepertoirePanel {...p} />)
    const dialog = screen.getByRole('dialog', { name: 'Repertório' })
    expect(dialog).toBeTruthy()
    expect(tour('setlist-area')!.tagName).toBe('OL')
    expect(within(tour('setlist-area')!).getAllByRole('listitem')).toHaveLength(3)

    // Capa, nome, artista, tom e BPM (com decimais).
    expect(rows()[0].querySelector('img')!.getAttribute('src')).toBe(SONGS[0].coverImage)
    expect(rows()[0].textContent).toContain('Morada')
    expect(rows()[0].textContent).toContain('Tom G')
    expect(rows()[0].textContent).toContain('78 BPM')
    expect(rows()[1].textContent).toContain('136.5 BPM')
    expect(rows()[2].textContent).not.toMatch(/Tom|BPM/)

    // A ativa marcada "tocando"; parada, "atual".
    expect(songButton('Fé').getAttribute('aria-current')).toBe('true')
    expect(rows()[0].textContent).toContain('TOCANDO')
    expect(songButton('Eu era Órfão').getAttribute('aria-current')).toBeNull()
    rerender(<RepertoirePanel {...p} isPlaying={false} />)
    expect(rows()[0].textContent).not.toContain('TOCANDO')
    expect(rows()[0].textContent).toContain('ATUAL')

    // Laranja (ligado) só tocando: parada, a atual fica com o anel neutro.
    expect(rows()[0].className).toContain('inset-ring-ps-line-3')
    expect(rows()[0].className).not.toContain('ps-or')
    rerender(<RepertoirePanel {...p} />)
    expect(rows()[0].className).toContain('inset-ring-ps-or-line')

    // Toque escolhe.
    fireEvent.click(songButton('Eu era Órfão'))
    expect(p.onSelect).toHaveBeenCalledWith(1)

    // Reordenar pelas setas na alça.
    fireEvent.keyDown(grip('Fé'), { key: 'ArrowDown' })
    expect(p.onReorder).toHaveBeenLastCalledWith(0, 1)
    fireEvent.keyDown(grip('Fé'), { key: 'ArrowUp' }) // já é a primeira
    expect(p.onReorder).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(grip('Ousado Amor'), { key: 'ArrowUp' })
    expect(p.onReorder).toHaveBeenLastCalledWith(2, 1)

    // Reordenar arrastando a alça com o dedo: as linhas têm 60 px, a partir de y = 100.
    rows().forEach((r, i) => vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(100 + i * 60, 60)))
    const g = grip('Fé')
    expect(g.className).toContain('touch-none')
    pointer(g, 'pointerdown', { clientY: 130 })
    pointer(g, 'pointermove', { clientY: 250 }) // em cima da terceira
    expect(rows()[0].dataset.dragging).toBe('true')
    expect(rows()[2].dataset.dropTarget).toBe('true')
    pointer(g, 'pointerup', { clientY: 250 })
    expect(p.onReorder).toHaveBeenLastCalledWith(0, 2)
    expect(rows()[0].dataset.dragging).toBe('false')
    // Arrastando perto da borda de baixo da lista, ela rola pra levar a música até o lugar.
    const box = tour('setlist-area')!.parentElement!
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(100, 150))
    const scrolled = vi.spyOn(box, 'scrollTop', 'set')
    pointer(g, 'pointerdown', { clientY: 130 })
    pointer(g, 'pointermove', { clientY: 240 }) // a 10 px da borda de baixo
    expect(scrolled).toHaveBeenCalled()
    pointer(g, 'pointercancel', { clientY: 240 })
    expect(rows()[0].dataset.dragging).toBe('false')
    // Soltar no mesmo lugar não reordena.
    const calls = vi.mocked(p.onReorder).mock.calls.length
    pointer(g, 'pointerdown', { clientY: 130 })
    pointer(g, 'pointerup', { clientY: 140 })
    expect(vi.mocked(p.onReorder).mock.calls.length).toBe(calls)

    // Tirar música: lixeira genérica com o nome da música, dois toques.
    const lixeira = screen.getByRole('button', { name: 'Tirar Eu era Órfão do repertório' })
    fireEvent.click(lixeira)
    expect(p.onRemove).not.toHaveBeenCalled()
    expect(lixeira.getAttribute('aria-label')).toBe('Toque de novo para tirar Eu era Órfão do repertório')
    // A música não some do aparelho, só sai da lista: "Tirar?", que está dentro do nome acessível (WCAG 2.5.3).
    expect(lixeira.textContent).toBe('Tirar?')
    expect(lixeira.getAttribute('aria-label')!.toLowerCase()).toContain('tirar')
    expect(lixeira.dataset.armed).toBe('true')
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS) })
    fireEvent.click(lixeira)
    expect(p.onRemove).toHaveBeenCalledTimes(1)
    expect(p.onRemove).toHaveBeenCalledWith('s2')

    // Anotações: textarea de 16 px (o iPad não dá zoom), com o data-tour de antes.
    const notes = screen.getByRole('textbox', { name: 'Anotações' }) as HTMLTextAreaElement
    expect(notes.tagName).toBe('TEXTAREA')
    expect(notes.className).toContain('text-ps-md')
    expect(tour('anotacoes')!.contains(notes)).toBe(true)
    fireEvent.change(notes, { target: { value: '1. Abertura (Tom: C)' } })
    expect(p.onNotesChange).toHaveBeenCalledWith('1. Abertura (Tom: C)')
  })

  it('Novo pede o segundo toque antes de limpar', () => {
    const p = repProps()
    render(<RepertoirePanel {...p} />)
    const novo = screen.getByRole('button', { name: 'Novo repertório' })
    expectTouch(novo)
    fireEvent.click(novo)
    expect(p.onNew).not.toHaveBeenCalled()
    expect(novo.textContent).toBe('Limpar o repertório?')
    expect(novo.getAttribute('aria-label')).toBe('Toque de novo para limpar o repertório')
    expect(novo.className).toContain('bg-ps-alert')
    fireEvent.click(novo) // duplo clique não limpa
    expect(p.onNew).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(TWO_TAP_WINDOW_MS) }) // desarmou sozinho
    expect(novo.textContent).toBe('NOVO')
    fireEvent.click(novo)
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS) })
    fireEvent.click(novo)
    expect(p.onNew).toHaveBeenCalledTimes(1)

    // Armar uma lixeira desarma o Novo, e armar o Novo desarma a lixeira.
    fireEvent.click(novo)
    const lixeira = screen.getByRole('button', { name: 'Tirar Fé do repertório' })
    fireEvent.click(lixeira)
    expect(novo.textContent).toBe('NOVO')
    expect(lixeira.textContent).toBe('Tirar?')
    fireEvent.click(novo)
    expect(lixeira.textContent).toBe('')
    expect(p.onRemove).not.toHaveBeenCalled()
  })

  it('Salvar e Carregar .zip; lista vazia não salva e explica', () => {
    const p = repProps()
    const { rerender } = render(<RepertoirePanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar .zip' }))
    expect(p.onExport).toHaveBeenCalledTimes(1)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.zip')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Carregar .zip' }))
    expect(click).toHaveBeenCalledTimes(1)
    const file = new File(['zip'], 'domingo.zip', { type: 'application/zip' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(p.onImport).toHaveBeenCalledWith(file)

    rerender(<RepertoirePanel {...p} songs={[]} />)
    expect((screen.getByRole('button', { name: 'Salvar .zip' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('dialog').textContent).toContain('Nenhuma música no repertório')
  })

  it('fechado não mostra nada; o X fecha', () => {
    const p = repProps()
    const { rerender } = render(<RepertoirePanel {...p} open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<RepertoirePanel {...p} />)
    const x = screen.getByRole('button', { name: 'Fechar repertório' })
    expectTouch(x)
    fireEvent.click(x)
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })
})

// ---------- Painel de pads ----------

const padProps = (patch: Partial<PadPanelProps> = {}): PadPanelProps => ({
  open: true, onClose: vi.fn(), view: 'pads', onViewChange: vi.fn(), notes: NOTES, activeNote: 'D', songKeyIndex: 7,
  volume: 0.55, setName: 'Holy', onPlayNote: vi.fn(), onVolume: vi.fn(), onOpenSets: vi.fn(), onEditPads: vi.fn(), ...patch,
})
const key = (note: string) => document.querySelector(`[data-note="${note}"]`) as HTMLButtonElement

describe('painel de pads', () => {
  it('pads: toca a nota, marca o tom da música', () => {
    const p = padProps()
    const { rerender } = render(<PadPanel {...p} />)
    expect(screen.getByRole('dialog', { name: 'Pads' })).toBeTruthy()
    // Grade 4x3 de C a B.
    const keys = [...document.querySelectorAll<HTMLButtonElement>('[data-note]')]
    expect(keys.map((k) => k.dataset.note)).toEqual([...NOTES])
    expect(keys[0].parentElement!.className).toContain('grid-cols-4')
    expect(keys[0].parentElement!.className).toContain('grid-rows-3')
    for (const k of keys) expect(k.className).toContain('min-h-ps-touch')

    // TOM só no tom da música (G); equalizador e "ligado" só no pad tocando (D).
    expect(key('G').textContent).toContain('TOM')
    expect(keys.filter((k) => k.textContent!.includes('TOM'))).toHaveLength(1)
    expect(key('G').getAttribute('aria-label')).toBe('Pad G, tom da música')
    expect(key('D').getAttribute('aria-pressed')).toBe('true')
    expect(key('D').querySelector('[data-eq]')).not.toBeNull()
    expect(keys.filter((k) => k.querySelector('[data-eq]'))).toHaveLength(1)
    expect(key('A').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(key('A'))
    expect(p.onPlayNote).toHaveBeenCalledWith('A')

    // Tom desconhecido: nenhum TOM.
    rerender(<PadPanel {...p} songKeyIndex={null} activeNote={null} />)
    expect(document.querySelectorAll('[data-eq]')).toHaveLength(0)
    expect(screen.getByRole('dialog').textContent).not.toContain('TOM')
  })

  it('CONJUNTO, Volume (arrastar, tocar no trilho e setas) e EDITAR', () => {
    const p = padProps()
    const { rerender } = render(<PadPanel {...p} />)
    const conjunto = screen.getByRole('button', { name: /^Conjunto de pads/ })
    expect(conjunto.textContent).toContain('Holy')
    fireEvent.click(conjunto)
    expect(p.onOpenSets).toHaveBeenCalledTimes(1)
    rerender(<PadPanel {...p} setName={null} />)
    expect(conjunto.textContent).toContain('Padrão')

    const vol = screen.getByRole('slider', { name: 'Volume dos pads' })
    expect(vol.getAttribute('aria-valuenow')).toBe('55')
    expect(vol.getAttribute('aria-valuetext')).toBe('55%')
    expect(vol.className).toContain('min-h-ps-touch')
    expect(vol.className).toContain('touch-none')
    vi.spyOn(vol, 'getBoundingClientRect').mockReturnValue(rect(0, 44, 100, 200))
    pointer(vol, 'pointerdown', { clientX: 150 }) // tocar no trilho: 25%
    expect(p.onVolume).toHaveBeenLastCalledWith(0.25)
    pointer(vol, 'pointermove', { clientX: 400 }) // arrastar pra além do fim: 100%
    expect(p.onVolume).toHaveBeenLastCalledWith(1)
    pointer(vol, 'pointerup', { clientX: 400 })
    const calls = vi.mocked(p.onVolume).mock.calls.length
    pointer(vol, 'pointermove', { clientX: 120 })
    expect(vi.mocked(p.onVolume).mock.calls.length).toBe(calls) // soltou: mexer não muda
    fireEvent.keyDown(vol, { key: 'ArrowRight' })
    expect(p.onVolume).toHaveBeenLastCalledWith(0.6)
    fireEvent.keyDown(vol, { key: 'ArrowLeft' })
    expect(p.onVolume).toHaveBeenLastCalledWith(0.5)
    fireEvent.keyDown(vol, { key: 'Home' })
    expect(p.onVolume).toHaveBeenLastCalledWith(0)

    fireEvent.click(screen.getByRole('button', { name: 'Editar pads' }))
    expect(p.onEditPads).toHaveBeenCalledTimes(1)
  })

  it('EDITAR mora na fileira das abas: CONJUNTO longo não empurra nada pra fora do painel', () => {
    const p = padProps({ setName: 'Ambient Worship Pads Volume Dois Extendido Ao Vivo' })
    const { rerender } = render(<PadPanel {...p} />)
    const editar = screen.getByRole('button', { name: 'Editar pads' })
    expectTouch(editar)
    const row = screen.getByRole('tablist').parentElement!
    expect(row.contains(editar)).toBe(true)
    expect(row.contains(screen.getByRole('button', { name: 'Fechar pads' }))).toBe(true)
    // A coluna do lado fica com CONJUNTO e Volume; a lista de PADS cresce com o conteúdo (sem min-h-0).
    const side = screen.getByRole('button', { name: /^Conjunto de pads/ }).parentElement!
    expect(side.contains(screen.getByRole('slider', { name: 'Volume dos pads' }))).toBe(true)
    expect(side.contains(editar)).toBe(false)
    expect(screen.getByRole('tabpanel').className.split(/\s+/)).not.toContain('min-h-0')

    // SAMPLES e LOOPS: o EDITAR (só dos pads) some sem mudar a largura das abas; a lista rola por dentro.
    for (const view of ['samples', 'loops'] as const) {
      rerender(<PadPanel {...p} view={view} samples={<p>samples</p>} loops={<p>loops</p>} />)
      expect(screen.queryByRole('button', { name: 'Editar pads' })).toBeNull()
      const hidden = document.querySelector('[data-pad-edit]') as HTMLButtonElement
      expect(hidden.className).toContain('invisible')
      expect(hidden.disabled).toBe(true)
      expect(screen.getByRole('tabpanel').className.split(/\s+/)).toContain('min-h-0')
    }
  })

  it('abas PADS, SAMPLES e LOOPS; SAMPLES e LOOPS mostram o que vier do app', () => {
    const p = padProps({ samples: <p>lista de samples</p>, loops: <p>lista de loops</p> })
    const { rerender } = render(<PadPanel {...p} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['PADS', 'SAMPLES', 'LOOPS'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    for (const t of tabs) expect(t.className).toContain('min-h-ps-touch')
    fireEvent.click(tabs[1])
    expect(p.onViewChange).toHaveBeenLastCalledWith('samples')
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' }) // setas andam com volta
    expect(p.onViewChange).toHaveBeenLastCalledWith('loops')

    rerender(<PadPanel {...p} view="samples" />)
    expect(screen.getByRole('tabpanel').textContent).toBe('lista de samples')
    expect(document.querySelector('[data-note]')).toBeNull()
    rerender(<PadPanel {...p} view="loops" />)
    expect(screen.getByRole('tabpanel').textContent).toBe('lista de loops')

    const x = screen.getByRole('button', { name: 'Fechar pads' })
    expectTouch(x)
    fireEvent.click(x)
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })
})

// ---------- Esc e textos ----------

describe('Esc e textos', () => {
  it('Esc fecha o painel e marca o evento como tratado', () => {
    const pad = padProps()
    const rep = repProps()
    const { rerender } = render(<PadPanel {...pad} />)
    const ev = createEvent.keyDown(document, { key: 'Escape' })
    fireEvent(document, ev)
    expect(pad.onClose).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)

    // Na captura: vale mesmo se quem tem o foco parar a propagação (ex.: dentro da textarea).
    rerender(<RepertoirePanel {...rep} />)
    const notes = screen.getByRole('textbox', { name: 'Anotações' })
    notes.addEventListener('keydown', (e) => e.stopPropagation())
    const ev2 = createEvent.keyDown(notes, { key: 'Escape' })
    fireEvent(notes, ev2)
    expect(rep.onClose).toHaveBeenCalledTimes(1)
    expect(ev2.defaultPrevented).toBe(true)

    // Outra tecla não fecha; evento já tratado (outro diálogo) também não.
    fireEvent.keyDown(document, { key: 'Enter' })
    const handled = createEvent.keyDown(document, { key: 'Escape' })
    handled.preventDefault()
    fireEvent(document, handled)
    expect(rep.onClose).toHaveBeenCalledTimes(1)

    // Fechado não escuta: o Esc segue pro atalho global.
    rerender(<RepertoirePanel {...rep} open={false} />)
    const free = createEvent.keyDown(document, { key: 'Escape' })
    fireEvent(document, free)
    expect(free.defaultPrevented).toBe(false)
    expect(rep.onClose).toHaveBeenCalledTimes(1)
  })

  it('abrir põe o foco no painel e fechar devolve pra quem abriu, nos dois painéis', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    // No StrictMode (o app em desenvolvimento) o efeito de abrir roda duas vezes: quem abriu continua o mesmo.
    const cases = [
      (open: boolean) => <RepertoirePanel {...repProps()} open={open} />,
      (open: boolean) => <PadPanel {...padProps()} open={open} />,
      (open: boolean) => <StrictMode><RepertoirePanel {...repProps()} open={open} /></StrictMode>,
      (open: boolean) => <StrictMode><PadPanel {...padProps()} open={open} /></StrictMode>,
    ]
    for (const panel of cases) {
      opener.focus()
      const { rerender, unmount } = render(panel(true))
      expect(document.activeElement).toBe(screen.getByRole('dialog'))
      rerender(panel(false))
      expect(document.activeElement).toBe(opener)
      unmount()
    }
    opener.remove()
  })

  // Os dois painéis na mesma tela, como na casca: abrir e fechar por estado, onClose em arrow inline.
  function Stage() {
    const [rep, setRep] = useState(false)
    const [pads, setPads] = useState(false)
    const [, setTick] = useState(0)
    return (
      <>
        <button type="button" onClick={() => setRep(true)}>abre repertório</button>
        <button type="button" onClick={() => setPads(true)}>abre pads</button>
        <button type="button" onClick={() => setTick((t) => t + 1)}>renderiza de novo</button>
        <RepertoirePanel {...repProps()} open={rep} onClose={() => setRep(false)} />
        <PadPanel {...padProps()} open={pads} onClose={() => setPads(false)} />
      </>
    )
  }
  const esc = () => fireEvent.keyDown(document, { key: 'Escape' })
  const openNames = () => screen.queryAllByRole('dialog').map((d) => d.getAttribute('aria-label'))

  it('Esc fecha sempre o painel aberto por último, com onClose inline, e o foco volta pela ordem', () => {
    for (const [first, second] of [['pads', 'repertório'], ['repertório', 'pads']] as const) {
      const { unmount } = render(<Stage />)
      const opener = screen.getByRole('button', { name: `abre ${first}` })
      opener.focus()
      fireEvent.click(opener)
      const firstDialog = screen.getByRole('dialog')
      expect(document.activeElement).toBe(firstDialog)
      fireEvent.click(screen.getByRole('button', { name: `abre ${second}` })) // o foco está no primeiro painel
      // Renderizações da casca trocam a identidade dos onClose: a ordem não pode mudar com isso.
      fireEvent.click(screen.getByRole('button', { name: 'renderiza de novo' }))
      fireEvent.click(screen.getByRole('button', { name: 'renderiza de novo' }))
      expect(openNames()).toHaveLength(2)

      esc()
      const left = first === 'pads' ? 'Pads' : 'Repertório'
      expect(openNames()).toEqual([left])
      expect(document.activeElement).toBe(firstDialog) // quem abriu o segundo foi o primeiro painel
      esc()
      expect(openNames()).toEqual([])
      expect(document.activeElement).toBe(opener)
      unmount()
    }
  })

  it('Esc fecha o último aberto também com onClose estável', () => {
    const rep = repProps()
    const pad = padProps()
    const both = (r: boolean, p: boolean) => <><RepertoirePanel {...rep} open={r} /><PadPanel {...pad} open={p} /></>
    const { rerender } = render(both(false, true))
    rerender(both(true, true)) // o repertório abriu depois, embora venha antes na árvore
    esc()
    expect(rep.onClose).toHaveBeenCalledTimes(1)
    expect(pad.onClose).not.toHaveBeenCalled()
    rerender(both(false, true))
    esc()
    expect(pad.onClose).toHaveBeenCalledTimes(1)
    rerender(both(false, false))
    const free = createEvent.keyDown(document, { key: 'Escape' })
    fireEvent(document, free)
    expect(free.defaultPrevented).toBe(false) // nada aberto: o Esc segue pro atalho global
  })

  it('Esc com lixeira ou Novo armado só desarma (e não chega ao atalho global); o seguinte fecha', () => {
    const p = repProps()
    render(<RepertoirePanel {...p} />)
    for (const name of ['Tirar Fé do repertório', 'Novo repertório']) {
      const btn = screen.getByRole('button', { name })
      fireEvent.click(btn)
      expect(btn.dataset.armed).toBe('true')
      const ev = createEvent.keyDown(document, { key: 'Escape' })
      fireEvent(document, ev)
      expect(ev.defaultPrevented).toBe(true)
      expect(p.onClose).not.toHaveBeenCalled()
      expect(btn.dataset.armed).toBe('false')
    }
    esc()
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('nenhum travessão nos textos do anúncio e do selo', () => {
    const { container } = render(
      <>
        <StageAppBar app={{ ...APP, isDesktop: true, online: false, livre: { used: 3, limit: 3 } }} editMode={false} actions={appActions()} />
        <HouseAdCard placement="home" onCta={() => {}} onDismiss={() => {}} />
        <HouseAdCard placement="separation-done" onCta={() => {}} onDismiss={() => {}} />
      </>,
    )
    expect(livreBadge()).not.toBeNull()
    expect(container.querySelectorAll('[data-house-ad]')).toHaveLength(2)
    expectPortuguese(container)
  })

  it('textos em português, sem travessão', () => {
    const { container } = render(
      <>
        <StageAppBar app={{ ...APP, isDesktop: true, online: false, livre: { used: 2, limit: 3 } }} editMode actions={appActions()} />
        <RepertoirePanel {...repProps()} />
        <PadPanel {...padProps()} />
      </>,
    )
    expectPortuguese(container)
    // Armados também.
    fireEvent.click(screen.getByRole('button', { name: 'Novo repertório' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tirar Fé do repertório' }))
    expectPortuguese(container)
  })
})
