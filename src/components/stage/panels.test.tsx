// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { TWO_TAP_MIN_GAP_MS, TWO_TAP_WINDOW_MS } from '../../hooks/useTwoTapConfirm'
import type { StageView } from '../../lib/stageContracts'
import { PadPanel } from './PadPanel'
import type { PadPanelProps } from './PadPanel'
import { RepertoirePanel } from './RepertoirePanel'
import type { RepertoirePanelProps, RepertoireSongItem } from './RepertoirePanel'
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

const APP: StageView['app'] = { online: true, isDesktop: false, isAdmin: false, userName: 'Ary Nelson', hostActive: false }
const appActions = () => ({
  openRepertoires: vi.fn(), openTracks: vi.fn(), openLibrary: vi.fn(), toggleEditMode: vi.fn(),
  openHost: vi.fn(), openSettings: vi.fn(), goHome: vi.fn(), signOut: vi.fn(),
}) satisfies StageAppBarProps['actions']
const renderBar = (app: Partial<StageView['app']> = {}, editMode = false) => {
  const actions = appActions()
  const r = render(<StageAppBar app={{ ...APP, ...app }} editMode={editMode} actions={actions} />)
  return { ...r, actions }
}
const tour = (name: string) => document.querySelector(`[data-tour="${name}"]`) as HTMLElement | null
const badge = () => document.querySelector('[data-online]') as HTMLElement

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
    expect(lixeira.textContent).toBe('Apagar?')
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

  it('abrir põe o foco no painel e fechar devolve pra quem abriu', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const p = repProps()
    const { rerender } = render(<RepertoirePanel {...p} />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    rerender(<RepertoirePanel {...p} open={false} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('textos em português, sem travessão', () => {
    const { container } = render(
      <>
        <StageAppBar app={{ ...APP, isDesktop: true, online: false }} editMode actions={appActions()} />
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
