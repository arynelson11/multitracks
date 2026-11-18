// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { OUTPUT_WARNING_TEXT } from '../../lib/outputPlan'
import type { OutputWarning } from '../../lib/outputPlan'
import type {
  OutputPlan, SongGrid, StageChannel, StageClock, StageSection, StageSong, StageView,
} from '../../lib/stageContracts'
import type { PadPanelProps } from './PadPanel'
import { StageShell } from './StageShell'
import type { StageShellActions, StageShellProps } from './StageShell'
import { useStageViewport } from './useStageViewport'

// Props que a casca entrega às peças, guardadas a cada renderização (a peça de verdade continua desenhando).
const seen = vi.hoisted(() => ({ wave: [] as Record<string, unknown>[], pads: [] as Record<string, unknown>[], play: [] as Record<string, unknown>[] }))
vi.mock('./WaveformSections', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./WaveformSections')>()
  const { createElement } = await import('react')
  type P = Parameters<typeof mod.WaveformSections>[0]
  return { ...mod, WaveformSections: (p: P) => { seen.wave.push(p as unknown as Record<string, unknown>); return createElement(mod.WaveformSections, p) } }
})
vi.mock('./SectionPads', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./SectionPads')>()
  const { createElement } = await import('react')
  type P = Parameters<typeof mod.SectionPads>[0]
  return { ...mod, SectionPads: (p: P) => { seen.pads.push(p as unknown as Record<string, unknown>); return createElement(mod.SectionPads, p) } }
})
vi.mock('./PlayButton', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./PlayButton')>()
  const { createElement } = await import('react')
  type P = Parameters<typeof mod.PlayButton>[0]
  return { ...mod, PlayButton: (p: P) => { seen.play.push(p as unknown as Record<string, unknown>); return createElement(mod.PlayButton, p) } }
})

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
beforeEach(() => {
  pending = new Map()
  nextId = 1
  seen.wave.length = 0
  seen.pads.length = 0
  seen.play.length = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
  // O jsdom não tem canvas: getContext nulo (a onda fica sem desenho, sem aviso no console).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 8, end: 24, bars: 8 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 24, end: 40, bars: 8 },
]
const GRID: SongGrid = { bpm: 120, firstDownbeat: 0.5, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const SONG: StageSong = {
  id: 's1', name: 'Grande É o Senhor', artist: 'Adhemar de Campos', originalKey: 'G', pitch: 0, bpm: 120, signature: '4/4',
  duration: 40, position: 1, total: 3, prevName: null, nextName: 'Lugar Secreto', repertoireName: 'Culto de domingo',
}
const CHANNELS: StageChannel[] = [
  { id: 'c1', label: 'Click', color: '#94a3b8', role: 'click', volume: 1, muted: false, soloed: false, pan: 0, silenced: false },
  { id: 'c2', label: 'Bateria', color: '#d4a373', role: 'normal', volume: 0.8, muted: false, soloed: false, pan: 0, silenced: false },
]
const SPLIT: OutputPlan = { mode: 'split2', channels: 2, vs: [1], click: [0], guide: [0], panByRole: true, fellBackFrom: null }
const MONO: OutputPlan = { mode: 'stereo', channels: 1, vs: [0], click: [0], guide: [0], panByRole: false, fellBackFrom: 'split2' }
const MULTI8: OutputPlan = { mode: 'multi', channels: 8, vs: [0, 1], click: [2], guide: [3], panByRole: true, fellBackFrom: null }
const VIEW: StageView = {
  song: SONG, sections: SECTIONS, currentSection: 1, intent: null, transition: null, landed: null, grid: GRID, gridWarning: null,
  isReadingGrid: false, isPlaying: true, isCountingIn: false, precount: { enabled: false, beats: 4, times: [] }, endMode: 'continue',
  click: { channelId: 'c1', on: true }, channels: CHANNELS, master: { volume: 1, muted: false }, outputs: SPLIT,
  gates: { sections: true, infinite: true, maxRepeats: 8, bandSections: true }, editMode: false, channelEditMode: false,
  padPanelOpen: false, activePad: null, app: { online: true, isDesktop: false, isAdmin: false, userName: 'Ary', hostActive: false },
}
const clock: StageClock = { heardNow: () => 10, position: () => 10, level: () => 0, masterLevels: () => ({ l: 0, r: 0 }) }

const makeActions = (): StageShellActions => ({
  togglePlay: vi.fn(), goToStart: vi.fn(), setEndMode: vi.fn(), togglePrecount: vi.fn(), cyclePrecountBeats: vi.fn(),
  toggleClick: vi.fn(), openMetronome: vi.fn(), tapSection: vi.fn(), stepSection: vi.fn(), cancelArm: vi.fn(),
  armRepeat: vi.fn(), toggleLoop: vi.fn(), seek: vi.fn(), seekBy: vi.fn(), changePitch: vi.fn(),
  prevSong: vi.fn(), nextSong: vi.fn(), setVolume: vi.fn(), toggleMute: vi.fn(), toggleSolo: vi.fn(),
  setPan: vi.fn(), setMasterVolume: vi.fn(), toggleMasterMute: vi.fn(), togglePadPanel: vi.fn(), openLyrics: vi.fn(),
  openRepertoires: vi.fn(), openTracks: vi.fn(), openLibrary: vi.fn(), toggleEditMode: vi.fn(), toggleChannelEditMode: vi.fn(), openHost: vi.fn(),
  openSettings: vi.fn(), goHome: vi.fn(), signOut: vi.fn(), openUpgrade: vi.fn(), openChannelEdit: vi.fn(),
  reorderChannel: vi.fn(), removeChannel: vi.fn(),
  markSection: vi.fn(), nudgeSection: vi.fn(), removeSection: vi.fn(),
  setMeter: vi.fn(), redetectMeter: vi.fn(), openOutputSettings: vi.fn(),
})
const PADS: Omit<PadPanelProps, 'open' | 'onClose'> = {
  view: 'pads', onViewChange: vi.fn(), notes: NOTES, activeNote: null, songKeyIndex: 7, volume: 0.5, setName: 'Holy',
  onPlayNote: vi.fn(), onVolume: vi.fn(), onOpenSets: vi.fn(), onEditPads: vi.fn(),
}

type ViewPatch = Partial<StageView>
const shellProps = (view: ViewPatch = {}, extra: Partial<StageShellProps> = {}, actions = makeActions()): StageShellProps => ({
  view: { ...VIEW, ...view }, actions, clock, peaks: null, pads: PADS, slots: { repertoire: null }, keyboardEnabled: true, outputWarning: null, ...extra,
})
const renderShell = (view: ViewPatch = {}, extra: Partial<StageShellProps> = {}) => {
  const actions = makeActions()
  const props = shellProps(view, extra, actions)
  const r = render(<StageShell {...props} />)
  const rerender = (v: ViewPatch = {}, e: Partial<StageShellProps> = {}) => r.rerender(<StageShell {...shellProps({ ...view, ...v }, { ...extra, ...e }, actions)} />)
  return { ...r, actions, rerender }
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
const press = (target: Element, init: KeyboardEventInit) => {
  const ev = createEvent.keyDown(target, init)
  fireEvent(target, ev)
  return ev
}
const last = <T,>(xs: T[]): T => xs[xs.length - 1]
/**
 * Toque ou clique como no Chrome: o mousedown põe o foco no botão, a não ser que alguém marque
 * `preventDefault` (o jsdom não faz isso sozinho); depois o click, com detail 1 (veio do ponteiro).
 */
const tap = (el: HTMLElement) => {
  const down = createEvent.mouseDown(el)
  fireEvent(el, down)
  if (!down.defaultPrevented) el.focus()
  fireEvent.click(el, { detail: 1 })
  return down
}

describe('casca do palco', () => {
  it('monta as faixas na ordem do mockup', () => {
    renderShell()
    const bar = screen.getByRole('navigation', { name: 'Navegação do app' })
    const transport = screen.getByRole('region', { name: 'Transporte' })
    const wave = q('[data-stage-wave]')!
    const pads = q('[data-tour="secoes"]')!
    const mid = screen.getByRole('region', { name: 'Música atual' })
    const mixer = screen.getByRole('region', { name: 'Mixer' })
    for (const el of [wave, pads]) expect(el).not.toBeNull()
    const order = [bar, transport, wave, pads, mid, mixer]
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i])).toBe(true)
    // Onda com os blocos das seções, botoeira com um botão por seção e o PRINCIPAL ao lado do mixer.
    expect(within(wave).getByRole('group', { name: 'Seções na onda' })).toBeTruthy()
    expect(document.querySelectorAll('[data-section-pad]')).toHaveLength(3)
    expect(mixer.querySelector('[data-master-strip]')).not.toBeNull()
    // Painéis fechados não aparecem.
    expect(screen.queryByRole('dialog', { name: 'Pads' })).toBeNull()
    expect(q('[data-output-alert]')).toBeNull()
  })

  it('abaixo de 1024 px (tocando, com a trava segurando o palco novo) a casca rola de lado e nada fica fora de alcance (Ruling I2-estreito)', () => {
    renderShell()
    const shell = q('[data-stage-shell]')!
    const hscroll = q('[data-stage-hscroll]')!
    const content = hscroll.firstElementChild as HTMLElement
    // A casca não corta: a rolagem de lado é dela, e o conteúdo tem no mínimo os 1024 px do palco novo.
    expect(hscroll.parentElement).toBe(shell)
    expect(hscroll.className).toMatch(/(^| )overflow-x-auto( |$)/)
    expect(hscroll.hasAttribute('data-scroll-reach')).toBe(true)
    expect(content.className).toContain('min-w-[1024px]')
    // A barra do app (com SAIR) e a área do palco (com PAD, LETRA e o aviso PRÓXIMA) rolam juntas.
    expect(content.contains(q('header')!)).toBe(true)
    expect(content.contains(q('[data-stage-scroll]')!)).toBe(true)
    expect(content.contains(screen.getByRole('button', { name: 'Sair' }))).toBe(true)
    // A gaveta REPERTÓRIOS fica fora da rolagem (abre na borda da tela, não no começo do conteúdo).
    expect(hscroll.contains(q('[data-stage-drawer]')!)).toBe(false)
  })

  it('modo EDITAR troca a botoeira pela barra de edição', () => {
    const tools = <p data-admin-tool="">Editor de marcadores</p>
    const { rerender, actions } = renderShell({}, { slots: { repertoire: null, adminTools: tools } })
    expect(q('[data-tour="secoes"]')).not.toBeNull()
    expect(screen.queryByRole('group', { name: 'Marcar seção' })).toBeNull()
    // Ferramentas do admin só no EDITAR e só pra admin.
    expect(q('[data-admin-tool]')).toBeNull()

    rerender({ editMode: true })
    expect(q('[data-tour="secoes"]')).toBeNull()
    expect(document.querySelectorAll('[data-section-pad]')).toHaveLength(0)
    const marcar = screen.getByRole('group', { name: 'Marcar seção' })
    // A barra fica no lugar da botoeira: depois da onda e antes da faixa do meio.
    expect(before(q('[data-stage-wave]')!, marcar)).toBe(true)
    expect(before(marcar, screen.getByRole('region', { name: 'Música atual' }))).toBe(true)
    expect(q('[data-admin-tool]')).toBeNull()

    rerender({ editMode: true, app: { ...VIEW.app, isAdmin: true } })
    const tool = q('[data-admin-tool]')!
    expect(tool).not.toBeNull()
    expect(before(marcar, tool)).toBe(true)
    expect(before(tool, screen.getByRole('region', { name: 'Música atual' }))).toBe(true)

    // MARCAR, selecionar e ajustar vão pras ações; com a grade com fase o ajuste é de 1 compasso.
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Intro' }))
    expect(actions.markSection).toHaveBeenCalledWith('Intro')
    fireEvent.click(within(screen.getByRole('group', { name: 'Seções da música' })).getByRole('button', { name: 'Verso' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mover Verso 1 compasso pra frente' }))
    expect(actions.nudgeSection).toHaveBeenCalledWith(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Mover Verso 1 compasso pra trás' }))
    expect(actions.nudgeSection).toHaveBeenLastCalledWith(1, -1)

    // Só com o BPM salvo (sem fase) o ajuste é de 1 s, mesmo com a grade existindo.
    rerender({ editMode: true, app: { ...VIEW.app, isAdmin: true }, grid: { ...GRID, source: 'bpm' } })
    expect(screen.getByRole('button', { name: 'Mover Verso 1 segundo pra frente' })).toBeTruthy()

    // Outra música: a seleção não passa pra ela.
    rerender({ editMode: true, song: { ...SONG, id: 's2' } })
    expect(screen.queryByRole('group', { name: /^Ajustar/ })).toBeNull()
    // Sair do EDITAR e voltar: começa sem seleção.
    rerender({ editMode: true })
    fireEvent.click(within(screen.getByRole('group', { name: 'Seções da música' })).getByRole('button', { name: 'Refrão' }))
    expect(screen.getByRole('group', { name: 'Ajustar Refrão' })).toBeTruthy()
    rerender({ editMode: false })
    rerender({ editMode: true })
    expect(screen.queryByRole('group', { name: /^Ajustar/ })).toBeNull()
  })

  // M3: a seleção do EDITAR é da seção, não da posição na lista.
  it('EDITAR: marcar uma seção antes da selecionada não passa a seleção (nem o ajuste) pra outra seção', () => {
    const { rerender, actions } = renderShell({ editMode: true })
    const pick = (name: string) => fireEvent.click(within(screen.getByRole('group', { name: 'Seções da música' })).getByRole('button', { name }))
    pick('Refrão')
    expect(screen.getByRole('group', { name: 'Ajustar Refrão' })).toBeTruthy()

    // MARCAR uma Ponte em 16 s, antes do Refrão: os índices de depois andam um.
    const marked: StageSection[] = [
      SECTIONS[0], { ...SECTIONS[1], end: 16 }, { index: 2, label: 'Ponte', color: '#8b5cf6', start: 16, end: 24, bars: 4 }, { ...SECTIONS[2], index: 3 },
    ]
    rerender({ editMode: true, sections: marked })
    expect(screen.getByRole('group', { name: 'Ajustar Refrão' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mover Refrão 1 compasso pra frente' }))
    expect(actions.nudgeSection).toHaveBeenLastCalledWith(3, 1)

    // O ajuste anda o início da selecionada (mesma quantidade de seções): a seleção continua nela.
    const nudged = marked.map((x) => (x.index === 3 ? { ...x, start: 26 } : x.index === 2 ? { ...x, end: 26 } : x))
    rerender({ editMode: true, sections: nudged })
    expect(screen.getByRole('group', { name: 'Ajustar Refrão' })).toBeTruthy()

    // Uma segunda marca no mesmo ponto e com o mesmo nome: não dá pra saber qual era; a seleção sai.
    const twin: StageSection[] = [...nudged.slice(0, 3), { ...nudged[3] }, { ...nudged[3], index: 4 }]
    rerender({ editMode: true, sections: twin })
    expect(screen.queryByRole('group', { name: /^Ajustar/ })).toBeNull()

    // A selecionada some da lista por outro caminho: a seleção sai, nunca vai pra vizinha.
    pick('Ponte')
    expect(screen.getByRole('group', { name: 'Ajustar Ponte' })).toBeTruthy()
    rerender({ editMode: true, sections: [SECTIONS[0], { ...SECTIONS[1], end: 26 }, { ...SECTIONS[2], index: 2, start: 26 }] })
    expect(screen.queryByRole('group', { name: /^Ajustar/ })).toBeNull()
  })

  it('Esc com a grade de tom aberta fecha a grade e não cancela o pulo', () => {
    const { actions } = renderShell({ intent: { target: 2, plays: 1 } })
    const grid = q('[role="dialog"][aria-label="Escolher tom"]')!
    expect(grid.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Escolher o tom/ }))
    expect(grid.hidden).toBe(false)
    const first = press(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
    expect(first.defaultPrevented).toBe(true)
    expect(grid.hidden).toBe(true)
    expect(actions.cancelArm).not.toHaveBeenCalled()
    // Grade fechada: o Esc seguinte cancela o pulo armado.
    press(document.body, { key: 'Escape', code: 'Escape' })
    expect(actions.cancelArm).toHaveBeenCalledTimes(1)
  })

  it('painel de pads não cobre o PRINCIPAL', () => {
    renderShell({ padPanelOpen: true })
    const panel = screen.getByRole('dialog', { name: 'Pads' })
    const layer = panel.parentElement!
    const mixerBox = q('[data-stage-mixer]')!
    const master = q('[data-master-strip]')!
    // Por cima do mixer, encostado à esquerda do PRINCIPAL: right = largura do PRINCIPAL (116) + o vão (10).
    expect(mixerBox.contains(layer)).toBe(true)
    expect(layer.contains(master)).toBe(false)
    expect(layer.style.right).toBe('126px')
    expect(master.className).toContain('w-[116px]')
    expect(screen.getByRole('region', { name: 'Mixer' }).className).toContain('gap-2.5')
    expect(layer.className).toMatch(/\binset-y-0\b/)
  })

  it('o X e o Esc do painel de pads fecham pelo togglePadPanel, sem cancelar o pulo', () => {
    const { actions } = renderShell({ padPanelOpen: true, intent: { target: 0, plays: 1 } })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Pads' })).getByRole('button', { name: /Fechar/ }))
    expect(actions.togglePadPanel).toHaveBeenCalledTimes(1)
    press(document.body, { key: 'Escape', code: 'Escape' })
    expect(actions.togglePadPanel).toHaveBeenCalledTimes(2)
    expect(actions.cancelArm).not.toHaveBeenCalled()
  })

  it('liga cada peça no que ela pede (songId, hasGrid, linhas de compasso, pulso do Play)', () => {
    const { rerender, actions } = renderShell()
    const pads = last(seen.pads)
    expect(pads.songId).toBe('s1')
    expect(pads.hasGrid).toBe(true)
    const wave = last(seen.wave)
    expect(wave.duration).toBe(40)
    expect(wave.sectionsAllowed).toBe(true)
    // 4/4 a 120: um compasso a cada 2 s a partir do primeiro 1 (0,5 s), até o fim da música.
    const lines = wave.barLines as number[]
    expect(lines).toHaveLength(20)
    expect(lines[0]).toBeCloseTo(0.5)
    expect(lines[19]).toBeCloseTo(38.5)
    for (let i = 1; i < lines.length; i++) expect(lines[i] - lines[i - 1]).toBeCloseTo(2)
    expect(last(seen.play).pulse).toEqual({ seconds: 0.5, firstDownbeat: 0.5 })
    ;(wave.onSeek as (t: number) => void)(12)
    expect(actions.seek).toHaveBeenCalledWith(12)
    ;(wave.onTapSection as (i: number) => void)(2)
    expect(actions.tapSection).toHaveBeenCalledWith(2)

    // Mesma grade numa renderização nova (a casca renderiza a cada quadro): a lista não é refeita.
    rerender({ currentSection: 2 })
    expect(last(seen.wave).barLines).toBe(lines)

    // Primeiro 1 depois de um compasso: a linha antes dele também aparece (a grade continua pra trás).
    rerender({ grid: { ...GRID, firstDownbeat: 3.1 } })
    expect((last(seen.wave).barLines as number[])[0]).toBeCloseTo(1.1)

    // Só o BPM salvo: tem grade (a botoeira reserva certo), mas não fase (sem linhas e sem pulso).
    rerender({ grid: { ...GRID, source: 'bpm' } })
    expect(last(seen.pads).hasGrid).toBe(true)
    expect(last(seen.wave).barLines).toBeNull()
    expect(last(seen.play).pulse).toBeNull()

    rerender({ grid: null, song: null })
    expect(last(seen.pads).hasGrid).toBe(false)
    expect(last(seen.pads).songId).toBeNull()
    expect(last(seen.wave).barLines).toBeNull()

    // Plano Livre: a onda fica sem os blocos.
    rerender({ gates: { sections: false, infinite: false, maxRepeats: 4, bandSections: false } })
    expect(last(seen.wave).sectionsAllowed).toBe(false)
  })

  it('Compasso do EDITAR abre o editor, com "Lendo o click..." enquanto o click é lido', () => {
    const { rerender, actions } = renderShell({ editMode: true, intent: { target: 2, plays: 1 } })
    expect(screen.queryByRole('dialog', { name: 'Compasso da música' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Compasso/ }))
    const dialog = screen.getByRole('dialog', { name: 'Compasso da música' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '3/4' }))
    expect(actions.setMeter).toHaveBeenCalledWith('3/4', 1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ler o click de novo' }))
    expect(actions.redetectMeter).toHaveBeenCalledTimes(1)

    rerender({ editMode: true, intent: { target: 2, plays: 1 }, isReadingGrid: true })
    expect(within(screen.getByRole('dialog', { name: 'Compasso da música' })).getByRole('button', { name: 'Lendo o click...' })).toBeTruthy()

    // Esc fecha o editor e não cancela o pulo.
    press(document.body, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Compasso da música' })).toBeNull()
    expect(actions.cancelArm).not.toHaveBeenCalled()

    // Sair do EDITAR fecha o editor.
    fireEvent.click(screen.getByRole('button', { name: /^Compasso/ }))
    rerender({ editMode: false })
    expect(screen.queryByRole('dialog', { name: 'Compasso da música' })).toBeNull()
  })

  it('aviso âmbar das saídas na barra do app, sem faixa nova, e o toque abre as Configurações na seção de saídas', () => {
    const { rerender, actions } = renderShell()
    expect(q('[data-output-alert]')).toBeNull()
    const below = q('[data-stage-scroll]')!.innerHTML

    rerender({ outputs: { ...SPLIT, fellBackFrom: 'multi' } }, { outputWarning: 'poucos-canais' })
    const alert = q('[data-output-alert]')!
    const text = `${OUTPUT_WARNING_TEXT['poucos-canais']} Agora: Click e Guia na saída 1 · VS na saída 2.`
    expect(alert.tagName).toBe('BUTTON')
    expect(alert.textContent).toBe('SAÍDAS')
    expect(alert.getAttribute('title')).toBe(text)
    expect(alert.getAttribute('aria-label')).toContain(text)
    expect(alert.getAttribute('aria-label')).toContain('saídas')
    expect(alert.querySelector('.text-ps-alert')).not.toBeNull()
    // Fica na barra do app, fora do palco: aparecer com a música tocando não muda nada embaixo.
    expect(q('[data-stage-scroll]')!.contains(alert)).toBe(false)
    expect(q('[data-stage-scroll]')!.innerHTML).toBe(below)
    expect(alert.className).toContain('h-11')
    expect(alert.className).toContain('min-w-ps-touch')
    // Ruling T18-saidas: direto na seção de saídas, não na aba Perfil.
    fireEvent.click(alert)
    expect(actions.openOutputSettings).toHaveBeenCalledTimes(1)
    expect(actions.openSettings).not.toHaveBeenCalled()

    // Tudo junto escolhido de propósito: o plano não tem aviso, o palco também não.
    rerender({ outputs: { mode: 'stereo', channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false, fellBackFrom: null } }, { outputWarning: null })
    expect(q('[data-output-alert]')).toBeNull()
  })

  // I1: o selo mostra o aviso do plano (PlannedOutputs.warning), o mesmo das Configurações, com o texto de OUTPUT_WARNING_TEXT.
  it.each<[OutputWarning, OutputPlan, string]>([
    ['mono', MONO, OUTPUT_WARNING_TEXT.mono],
    ['poucos-canais', { ...SPLIT, fellBackFrom: 'multi' }, `${OUTPUT_WARNING_TEXT['poucos-canais']} Agora: Click e Guia na saída 1 · VS na saída 2.`],
    ['poucos-canais', { mode: 'multi', channels: 3, vs: [0, 1], click: [2], guide: [2], panByRole: true, fellBackFrom: 'multi' }, `${OUTPUT_WARNING_TEXT['poucos-canais']} Agora: VS nas saídas 1 e 2 · Click e Guia na 3.`],
    ['sem-saida-ouvido', { ...MULTI8, click: [], guide: [] }, OUTPUT_WARNING_TEXT['sem-saida-ouvido']],
    ['mapa-ajustado', MULTI8, OUTPUT_WARNING_TEXT['mapa-ajustado']],
    ['sink-timeout', SPLIT, OUTPUT_WARNING_TEXT['sink-timeout']],
  ])('aviso do plano "%s" aparece no selo SAÍDAS com o texto das Configurações', (warning, outputs, text) => {
    const { actions } = renderShell({ outputs }, { outputWarning: warning })
    const alert = q('[data-output-alert]')!
    expect(alert).not.toBeNull()
    expect(alert.textContent).toBe('SAÍDAS')
    expect(alert.getAttribute('title')).toBe(text)
    expect(alert.getAttribute('aria-label')).toBe(`Saídas: ${text} Abre as saídas nas Configurações.`)
    expect(text).not.toContain(TRAVESSAO)
    fireEvent.click(alert)
    expect(actions.openOutputSettings).toHaveBeenCalledTimes(1)
  })

  it('sem aviso no plano não há selo: o palco não refaz a conta do plano pelos campos', () => {
    const { rerender } = renderShell({ outputs: { ...SPLIT, fellBackFrom: 'multi' } }, { outputWarning: null })
    expect(q('[data-output-alert]')).toBeNull()
    rerender({ outputs: { ...MULTI8, click: [], guide: [] } })
    expect(q('[data-output-alert]')).toBeNull()
    rerender({ outputs: MONO })
    expect(q('[data-output-alert]')).toBeNull()
  })

  // M2: OFFLINE é mais largo que ONLINE; o selo anda junto e, se não couber até o menu, fica só a luz.
  it('o selo SAÍDAS acompanha o ONLINE virando OFFLINE (posição e "só a luz")', () => {
    const box = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 22, height: 22, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('[data-online]')) return box(140, this.getAttribute('data-online') === 'true' ? 60 : 68)
      if (this.tagName === 'NAV') return box(300, 700)
      if (this.matches('[data-output-alert]')) return box(0, 70)
      return box(0, 0)
    })
    const { rerender } = renderShell({}, { outputWarning: 'mapa-ajustado' })
    const chip = q('[data-output-alert]')!
    // ONLINE termina em 200: o selo começa 12 px depois e cabe até o menu (300 - 12 - 212 = 76 >= 70).
    expect(chip.style.left).toBe('212px')
    expect(chip.dataset.fit).toBeUndefined()
    rerender({ app: { ...VIEW.app, online: false } })
    // OFFLINE termina em 208: o selo anda 8 px e sobra 68 px, menos que os 70 dele: só a luz.
    expect(chip.style.left).toBe('220px')
    expect(chip.dataset.fit).toBe('luz')
    rerender({ app: { ...VIEW.app, online: true } })
    expect(chip.style.left).toBe('212px')
    expect(chip.dataset.fit).toBeUndefined()
  })

  it('no EDITAR a onda encaixa ao entrar e fica parada; a barra reserva a maior altura que já teve', () => {
    // ResizeObserver de teste: cada elemento observado guarda quem avisar; `resize(el, h)` muda a altura e avisa.
    const watchers = new Map<Element, Set<ResizeObserverCallback>>()
    const heights = new Map<Element, number>()
    vi.stubGlobal('ResizeObserver', class {
      private readonly cb: ResizeObserverCallback
      private readonly mine = new Set<Element>()
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        this.mine.add(el)
        if (!watchers.has(el)) watchers.set(el, new Set())
        watchers.get(el)!.add(this.cb)
      }
      unobserve() {}
      disconnect() { for (const el of this.mine) watchers.get(el)?.delete(this.cb) }
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const h = heights.get(this) ?? 0
      return { top: 0, left: 0, right: 100, bottom: h, width: 100, height: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    const resize = (el: Element, h: number) => {
      heights.set(el, h)
      act(() => { for (const cb of [...(watchers.get(el) ?? [])]) cb([], {} as ResizeObserver) })
    }
    const { rerender } = renderShell()
    const wave = q('[data-stage-wave]')!
    resize(wave, 160)
    expect(wave.style.height).toBe('')

    // Entra no EDITAR: no máximo a altura de fora, podendo encolher pra caber; encaixou, fica parada.
    rerender({ editMode: true })
    expect(wave.style.height).toBe('160px')
    expect(wave.style.flex).toBe('0 1 auto')
    resize(wave, 132)
    expect(wave.style.height).toBe('132px')
    expect(['none', '0 0 auto']).toContain(wave.style.flex)
    resize(wave, 120)
    expect(wave.style.height).toBe('132px')

    // A barra cresce com uma linha nova e não volta quando a seção sai (o que está embaixo não sobe).
    const area = q('[data-stage-sections]')!
    const box = area.firstElementChild!
    resize(box, 112)
    expect(area.style.minHeight).toBe('122px')
    resize(box, 164)
    expect(area.style.minHeight).toBe('174px')
    resize(box, 112)
    expect(area.style.minHeight).toBe('174px')

    // Janela redimensionada: encaixa de novo (a barra pela altura de agora, a onda pela de fora).
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(area.style.minHeight).toBe('122px')
    expect(wave.style.height).toBe('160px')
    expect(wave.style.flex).toBe('0 1 auto')

    // Sair do EDITAR: a onda volta a dividir com o mixer.
    rerender({ editMode: false })
    expect(wave.style.height).toBe('')
  })

  it('REPERTÓRIOS, menu FAIXAS e Editar canal entram pelos slots', () => {
    const slots: StageShellProps['slots'] = {
      repertoire: <div role="dialog" aria-label="Repertório">lista</div>,
      tracksMenu: <div data-menu-faixas="">Importar do dispositivo</div>,
      channelEditPanel: <div data-editar-canal="">Editar canal</div>,
    }
    renderShell({}, { slots })
    const drawer = q('[data-stage-drawer]')!
    expect(within(drawer).getByRole('dialog', { name: 'Repertório' })).toBeTruthy()
    // A gaveta fica fora da área que rola: não anda com o palco.
    expect(q('[data-stage-scroll]')!.contains(drawer)).toBe(false)
    expect(q('[data-stage-tracks-menu]')!.contains(q('[data-menu-faixas]'))).toBe(true)
    expect(q('[data-editar-canal]')).not.toBeNull()
  })

  it('texto da casca em português e sem travessão', () => {
    const { container } = renderShell({ editMode: true, outputs: { ...SPLIT, fellBackFrom: 'multi' }, padPanelOpen: true }, { outputWarning: 'poucos-canais' })
    fireEvent.click(screen.getByRole('button', { name: /^Compasso/ }))
    expect(container.textContent).not.toContain(TRAVESSAO)
    expect(container.textContent).not.toMatch(PROIBIDAS)
    for (const el of container.querySelectorAll('[aria-label],[title]')) {
      for (const attr of ['aria-label', 'title']) {
        expect(el.getAttribute(attr) ?? '').not.toContain(TRAVESSAO)
        expect(el.getAttribute(attr) ?? '').not.toMatch(PROIBIDAS)
      }
    }
  })
})

describe('atalhos de teclado na casca', () => {
  it('Espaço, números, setas e L chamam as ações e seguram a tecla', () => {
    const { actions } = renderShell()
    expect(press(document.body, { key: ' ', code: 'Space' }).defaultPrevented).toBe(true)
    expect(actions.togglePlay).toHaveBeenCalledTimes(1)
    press(document.body, { key: '2', code: 'Digit2' })
    expect(actions.tapSection).toHaveBeenCalledWith(1)
    press(document.body, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(actions.stepSection).toHaveBeenCalledWith(1)
    press(document.body, { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })
    expect(actions.seekBy).toHaveBeenCalledWith(-5)
    press(document.body, { key: 'l', code: 'KeyL' })
    expect(actions.toggleLoop).toHaveBeenCalledTimes(1)
    // Número de uma seção que não existe: nada, e a tecla segue pro resto.
    expect(press(document.body, { key: '7', code: 'Digit7' }).defaultPrevented).toBe(false)
    expect(actions.tapSection).toHaveBeenCalledTimes(1)
    // Tecla segurada não repete o Play.
    press(document.body, { key: ' ', code: 'Space', repeat: true })
    expect(actions.togglePlay).toHaveBeenCalledTimes(1)
  })

  it('Esc sem nada armado não faz nada; com algo armado cancela', () => {
    const { rerender, actions } = renderShell()
    expect(press(document.body, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(false)
    expect(actions.cancelArm).not.toHaveBeenCalled()
    rerender({ intent: { target: 2, plays: 1 } })
    expect(press(document.body, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
    expect(actions.cancelArm).toHaveBeenCalledTimes(1)
  })

  it('marcar pela letra só no modo EDITAR', () => {
    const { rerender, actions } = renderShell()
    press(document.body, { key: 'r', code: 'KeyR' })
    expect(actions.markSection).not.toHaveBeenCalled()
    rerender({ editMode: true })
    press(document.body, { key: 'r', code: 'KeyR' })
    expect(actions.markSection).toHaveBeenCalledWith('Refrão')
  })

  it('desligado (modal aberto) ou sem música, o teclado não mexe no palco', () => {
    const { rerender, actions } = renderShell({}, { keyboardEnabled: false })
    press(document.body, { key: ' ', code: 'Space' })
    press(document.body, { key: '1', code: 'Digit1' })
    rerender({}, { keyboardEnabled: true })
    rerender({ song: null }, { keyboardEnabled: true })
    press(document.body, { key: ' ', code: 'Space' })
    expect(actions.togglePlay).not.toHaveBeenCalled()
    expect(actions.tapSection).not.toHaveBeenCalled()
  })

  // Ruling T18-atalho.
  it('setas no volume e nas abas dos pads ficam no painel: a música não anda', () => {
    const { actions } = renderShell({ padPanelOpen: true })
    const panel = screen.getByRole('dialog', { name: 'Pads' })
    const volume = within(panel).getByRole('slider')
    volume.focus()
    press(volume, { key: 'ArrowRight', code: 'ArrowRight' })
    press(volume, { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })
    const tab = within(panel).getByRole('tab', { name: 'SAMPLES' })
    tab.focus()
    press(tab, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(PADS.onVolume).toHaveBeenCalled()
    expect(actions.stepSection).not.toHaveBeenCalled()
    expect(actions.seekBy).not.toHaveBeenCalled()
  })

  it('controle que não trata a seta sozinho também fica com ela; campo de texto fica com tudo', () => {
    const tools: ReactNode = (
      <>
        <div role="slider" tabIndex={0} aria-label="Ganho de teste" aria-valuenow={0} data-fake-slider="" />
        <input aria-label="Nome de teste" data-fake-input="" />
      </>
    )
    const { actions } = renderShell({ editMode: true, app: { ...VIEW.app, isAdmin: true } }, { slots: { repertoire: null, adminTools: tools } })
    const slider = q('[data-fake-slider]')!
    slider.focus()
    expect(press(slider, { key: 'ArrowRight', code: 'ArrowRight' }).defaultPrevented).toBe(false)
    press(slider, { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })
    expect(actions.stepSection).not.toHaveBeenCalled()
    expect(actions.seekBy).not.toHaveBeenCalled()
    // Os números e o Espaço não são do controle deslizante: continuam valendo.
    press(slider, { key: '1', code: 'Digit1' })
    expect(actions.tapSection).toHaveBeenCalledWith(0)

    const input = q('[data-fake-input]')!
    input.focus()
    for (const [key, code] of [[' ', 'Space'], ['2', 'Digit2'], ['l', 'KeyL'], ['r', 'KeyR'], ['ArrowRight', 'ArrowRight']]) press(input, { key, code })
    expect(actions.togglePlay).not.toHaveBeenCalled()
    expect(actions.tapSection).toHaveBeenCalledTimes(1)
    expect(actions.toggleLoop).not.toHaveBeenCalled()
    expect(actions.markSection).not.toHaveBeenCalled()
    expect(actions.stepSection).not.toHaveBeenCalled()
  })

  it('com o foco num botão da botoeira, os números e as setas continuam; o Espaço fica com o botão', () => {
    const { actions } = renderShell()
    const pad = q('[data-section-pad="0"]')!
    pad.focus()
    press(pad, { key: '3', code: 'Digit3' })
    expect(actions.tapSection).toHaveBeenCalledWith(2)
    press(pad, { key: 'ArrowLeft', code: 'ArrowLeft' })
    expect(actions.stepSection).toHaveBeenCalledWith(-1)
    expect(press(pad, { key: ' ', code: 'Space' }).defaultPrevented).toBe(false)
    expect(actions.togglePlay).not.toHaveBeenCalled()
  })

  it('o mixer segura as teclas dele (fader e pan)', () => {
    const { actions } = renderShell()
    const fader = screen.getByRole('slider', { name: 'Volume Bateria' })
    fader.focus()
    press(fader, { key: 'ArrowUp', code: 'ArrowUp' })
    press(fader, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(actions.stepSection).not.toHaveBeenCalled()
  })
})

// Ruling T18-foco (segurança ao vivo): toque e clique não deixam o foco em botão nem em controle do
// palco; o foco só chega pelo Tab. Assim o Espaço depois de tocar numa seção toca ou pausa.
describe('foco: só pelo Tab', () => {
  it('tocar numa seção e dar Espaço aciona tocar/pausar e não cancela o pulo', () => {
    const { actions } = renderShell({ intent: { target: 2, plays: 1 } })
    const pad = q('[data-section-pad="2"]')!
    expect(tap(pad).defaultPrevented).toBe(true)
    expect(actions.tapSection).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.body)
    const space = press(document.activeElement!, { key: ' ', code: 'Space' })
    expect(space.defaultPrevented).toBe(true) // o navegador não aperta botão nenhum
    expect(actions.togglePlay).toHaveBeenCalledTimes(1)
    expect(actions.tapSection).toHaveBeenCalledTimes(1)
    expect(actions.cancelArm).not.toHaveBeenCalled()
  })

  it('com foco vindo do Tab, Espaço e Enter ficam com o botão', () => {
    const { actions } = renderShell({ intent: { target: 2, plays: 1 } })
    const pad = q('[data-section-pad="2"]')!
    pad.focus() // como o Tab
    expect(document.activeElement).toBe(pad)
    expect(press(pad, { key: ' ', code: 'Space' }).defaultPrevented).toBe(false)
    expect(press(pad, { key: 'Enter', code: 'Enter' }).defaultPrevented).toBe(false)
    expect(actions.togglePlay).not.toHaveBeenCalled()
    // Os outros atalhos continuam com o foco no botão.
    press(pad, { key: '1', code: 'Digit1' })
    expect(actions.tapSection).toHaveBeenCalledWith(0)
  })

  it('o toque tira o foco que o Tab tinha deixado em outro botão', () => {
    const { actions } = renderShell()
    const play = screen.getByRole('button', { name: 'Pausar' })
    play.focus()
    tap(q('[data-section-pad="0"]')!)
    expect(document.activeElement).toBe(document.body)
    press(document.activeElement!, { key: ' ', code: 'Space' })
    expect(actions.togglePlay).toHaveBeenCalledTimes(1)
  })

  it('controles do palco também não pegam foco no toque (fader, LOOP, seletor do fim da música)', () => {
    const { actions } = renderShell()
    for (const el of [
      screen.getByRole('slider', { name: 'Volume Bateria' }), screen.getByRole('button', { name: /LOOP/ }),
      screen.getByRole('radio', { name: 'PARAR' }), screen.getByRole('button', { name: 'Armar seção seguinte' }),
    ]) {
      expect(tap(el).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(document.body)
    }
    // Depois de mexer no fader com o mouse, a seta do pedal troca de seção (não mexe no volume).
    press(document.activeElement!, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(actions.stepSection).toHaveBeenCalledWith(1)
  })

  it('campo de texto continua pegando foco no toque', () => {
    const tools: ReactNode = <input aria-label="Nome de teste" data-fake-input="" />
    renderShell({ editMode: true, app: { ...VIEW.app, isAdmin: true } }, { slots: { repertoire: null, adminTools: tools } })
    const input = q('[data-fake-input]')!
    expect(tap(input).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('TOM aberto pelo toque não põe o foco na grade; aberto pelo teclado, põe no tom atual', () => {
    const { actions } = renderShell()
    const trigger = screen.getByRole('button', { name: /Escolher o tom/ })
    const grid = q('[role="dialog"][aria-label="Escolher tom"]')!
    tap(trigger)
    expect(grid.hidden).toBe(false)
    expect(document.activeElement).toBe(document.body)
    press(document.activeElement!, { key: ' ', code: 'Space' })
    expect(actions.togglePlay).toHaveBeenCalledTimes(1)
    // Escolher um tom pelo toque fecha a grade e o foco não vai pro botão do tom.
    tap(within(grid).getByRole('button', { name: 'A' }))
    expect(grid.hidden).toBe(true)
    expect(document.activeElement).toBe(document.body)
    // Pelo teclado (Enter ou Espaço no botão do tom com foco do Tab: click com detail 0).
    trigger.focus()
    fireEvent.click(trigger, { detail: 0 })
    expect(grid.hidden).toBe(false)
    expect(grid.contains(document.activeElement)).toBe(true)
  })

  // M5: a grade de tons entra na pilha do Esc sem o painel ligado (keyGridRef nulo) de propósito:
  // com o painel ligado, a pilha poria o foco no diálogo ao abrir (pelo toque, contra a Ruling T18-foco;
  // pelo teclado, tirando o foco do tom atual).
  it('grade de tons: pelo toque o foco fica no corpo ao abrir e ao fechar; pelo teclado fica no tom atual e o Esc devolve pro botão do tom', () => {
    const { actions } = renderShell({ intent: { target: 2, plays: 1 } })
    const trigger = screen.getByRole('button', { name: /Escolher o tom/ })
    const grid = q('[role="dialog"][aria-label="Escolher tom"]')!
    tap(trigger)
    expect(grid.hidden).toBe(false)
    expect(document.activeElement).toBe(document.body)
    expect(press(document.body, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
    expect(grid.hidden).toBe(true)
    expect(document.activeElement).toBe(document.body)

    trigger.focus() // como o Tab
    fireEvent.click(trigger, { detail: 0 })
    expect(grid.hidden).toBe(false)
    expect(document.activeElement).toBe(grid.querySelector('button[aria-pressed="true"]'))
    expect(press(document.activeElement!, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
    expect(grid.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
    // Nenhum dos dois Esc chegou no pulo armado.
    expect(actions.cancelArm).not.toHaveBeenCalled()
  })
})

// Ruling T18-altura: o palco novo vale a partir de 1024 x 740.
describe('regra de tela', () => {
  const setSize = (w: number, h: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
  }
  afterEach(() => setSize(1024, 768))
  it('739 de altura fica no palco antigo; 740 liga o novo; muda ao redimensionar', () => {
    setSize(1280, 739)
    const { result } = renderHook(() => useStageViewport())
    expect(result.current.wide).toBe(false)
    act(() => { setSize(1280, 740); window.dispatchEvent(new Event('resize')) })
    expect(result.current.wide).toBe(true)
    act(() => { setSize(1023, 900); window.dispatchEvent(new Event('resize')) })
    expect(result.current.wide).toBe(false)
  })
})
