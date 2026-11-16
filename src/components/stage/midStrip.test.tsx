// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GRID_WARNING_TEXT } from '../../lib/stageContracts'
import type { GridWarning, StageActions, StageClock, StageGates, StageSection, StageSong, StageView } from '../../lib/stageContracts'
import { BigButton } from './BigButton'
import { CurrentSectionCell } from './CurrentSectionCell'
import type { CurrentSectionCellProps } from './CurrentSectionCell'
import { KeyCell } from './KeyCell'
import type { KeyCellProps } from './KeyCell'
import { MidStrip } from './MidStrip'
import { SongCell } from './SongCell'
import { TimeCell } from './TimeCell'
import type { TimeCellProps } from './TimeCell'

const TRAVESSAO = String.fromCharCode(0x2014)
const MENOS = String.fromCharCode(0x2212)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i

// requestAnimationFrame falso: guarda os pedidos e solta um quadro por vez.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
const frame = (t = 16) => {
  const due = [...pending.values()]
  pending = new Map()
  for (const cb of due) cb(t)
}

// Relógio de teste: a posição ouvida muda entre os quadros.
let position = 0
const clock: StageClock = { heardNow: () => position, position: () => position, level: () => 0, masterLevels: () => ({ l: 0, r: 0 }) }

beforeEach(() => {
  pending = new Map()
  nextId = 1
  position = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const q = (sel: string) => document.querySelector(sel) as HTMLElement

const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 8, end: 24, bars: 8 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 24, end: 40, bars: null },
]
const PAGO: StageGates = { sections: true, infinite: true, maxRepeats: 8, bandSections: true }
const LIVRE: StageGates = { sections: false, infinite: false, maxRepeats: 4, bandSections: false }
const SONG: StageSong = {
  id: 's1', name: 'Grande É o Senhor', artist: 'Adhemar de Campos', originalKey: 'G', pitch: -1, bpm: 72, signature: '4/4',
  duration: 232, position: 1, total: 6, prevName: null, nextName: 'Lugar Secreto', repertoireName: 'Culto de domingo',
}

// ---------- Tempo ----------

const timeProps = (p: Partial<TimeCellProps> = {}): TimeCellProps => ({
  duration: 232, bpm: 72, signature: '4/4', gridWarning: null, editMode: false, clock, onOpenMeter: () => {}, ...p,
})

describe('célula de tempo', () => {
  it('tempo ouvido, BPM com 1 casa e compasso', () => {
    position = 40.9
    render(<TimeCell {...timeProps()} />)
    expect(q('[data-time-now]').textContent).toBe('00:40')
    expect(q('[data-cell="tempo"]').textContent).toContain('/ 3:52')
    expect(q('[data-bpm]').textContent).toBe('72.0 BPM · 4/4')
    // O relógio anda: o quadro seguinte escreve o tempo novo direto no DOM.
    position = 605.2
    frame()
    expect(q('[data-time-now]').textContent).toBe('10:05')
    position = -3
    frame()
    expect(q('[data-time-now]').textContent).toBe('00:00')
  })
  it('BPM decimal com 1 casa, compasso composto e BPM desconhecido', () => {
    const { rerender } = render(<TimeCell {...timeProps({ bpm: 78.04, signature: '6/8' })} />)
    expect(q('[data-bpm]').textContent).toBe('78.0 BPM · 6/8')
    rerender(<TimeCell {...timeProps({ bpm: 120, signature: null })} />)
    expect(q('[data-bpm]').textContent).toBe('120.0 BPM')
    rerender(<TimeCell {...timeProps({ bpm: null })} />)
    expect(q('[data-bpm]').textContent).toBe('BPM não informado')
    rerender(<TimeCell {...timeProps({ bpm: Number.NaN })} />)
    expect(q('[data-bpm]').textContent).toBe('BPM não informado')
  })
  it('aviso âmbar quando o compasso foi assumido', () => {
    render(<TimeCell {...timeProps({ gridWarning: 'compasso-assumido' })} />)
    const chip = q('[data-grid-warning]')
    expect(chip.textContent).toBe(GRID_WARNING_TEXT['compasso-assumido'].label)
    expect(chip.getAttribute('title')).toBe(GRID_WARNING_TEXT['compasso-assumido'].title)
    expect(chip.className).toContain('text-ps-alert')
    // A explicação chega também ao leitor de tela (o title só aparece com o mouse).
    expect(q('[data-cell="tempo"]').textContent).toContain(GRID_WARNING_TEXT['compasso-assumido'].title)
  })
  it.each(['sem-grade', 'sem-click-lido'] as GridWarning[])('aviso %s com o texto da constante', (w) => {
    render(<TimeCell {...timeProps({ gridWarning: w })} />)
    expect(q('[data-grid-warning]').textContent).toBe(GRID_WARNING_TEXT[w].label)
    expect(q('[data-grid-warning]').getAttribute('title')).toBe(GRID_WARNING_TEXT[w].title)
  })
  it('sem aviso, sem chip', () => {
    render(<TimeCell {...timeProps()} />)
    expect(document.querySelector('[data-grid-warning]')).toBeNull()
  })
  it('no modo EDITAR a linha do BPM vira o botão Compasso', () => {
    const onOpenMeter = vi.fn()
    const { rerender } = render(<TimeCell {...timeProps({ onOpenMeter })} />)
    expect(screen.queryByRole('button', { name: /Compasso/ })).toBeNull()
    rerender(<TimeCell {...timeProps({ onOpenMeter, editMode: true, gridWarning: 'compasso-assumido' })} />)
    expect(document.querySelector('[data-bpm]')).toBeNull()
    fireEvent.click(btn(/Compasso/))
    expect(onOpenMeter).toHaveBeenCalledTimes(1)
    expect(btn(/Compasso/).textContent).toContain('4/4')
    expect(q('[data-grid-warning]')).toBeTruthy()
  })
  it('sem botão de andamento (Projeto 4)', () => {
    render(<TimeCell {...timeProps()} />)
    for (const t of ['+5', '+1', '-1', '-5', `${MENOS}1`, `${MENOS}5`]) expect(screen.queryByText(t)).toBeNull()
  })
})

// ---------- Tom ----------

const keyProps = (p: Partial<KeyCellProps> = {}): KeyCellProps => ({
  originalKey: 'G', pitch: 0, gridOpen: false, onGridOpenChange: () => {}, onChangePitch: () => {}, ...p,
})
const gridKey = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}(, |$)`) }) as HTMLButtonElement

describe('célula de tom', () => {
  it('tom atual, original e selo com o sinal de menos', () => {
    const { rerender } = render(<KeyCell {...keyProps({ pitch: -1 })} />)
    expect(q('[data-key-current]').textContent).toBe('F#')
    expect(q('[data-key-original]').textContent).toBe('original G')
    expect(q('[data-key-shift]').textContent).toBe(`${MENOS}1`)
    rerender(<KeyCell {...keyProps({ pitch: 2 })} />)
    expect(q('[data-key-current]').textContent).toBe('A')
    expect(q('[data-key-shift]').textContent).toBe('+2')
    rerender(<KeyCell {...keyProps({ pitch: 0 })} />)
    expect(document.querySelector('[data-key-shift]')).toBeNull()
  })
  it('tom menor mantém o m, inclusive em solfejo', () => {
    render(<KeyCell {...keyProps({ originalKey: 'Lá m', pitch: 2 })} />)
    expect(q('[data-key-current]').textContent).toBe('Bm')
    expect(q('[data-key-original]').textContent).toBe('original Am')
  })
  it('o botão do tom abre e fecha a grade pela casca', () => {
    const onGridOpenChange = vi.fn()
    const { rerender } = render(<KeyCell {...keyProps({ onGridOpenChange })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const open = btn(/Escolher o tom/)
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    expect(onGridOpenChange).toHaveBeenLastCalledWith(true)
    rerender(<KeyCell {...keyProps({ onGridOpenChange, gridOpen: true })} />)
    expect(screen.getByRole('dialog', { name: 'Escolher tom' })).toBeTruthy()
    expect(btn(/Escolher o tom/).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(btn(/Escolher o tom/))
    expect(onGridOpenChange).toHaveBeenLastCalledWith(false)
  })
  it('grade de tons escolhe pelo caminho mais curto', () => {
    const onChangePitch = vi.fn()
    const onGridOpenChange = vi.fn()
    render(<KeyCell {...keyProps({ gridOpen: true, onChangePitch, onGridOpenChange })} />)
    fireEvent.click(gridKey('E'))
    expect(onChangePitch).toHaveBeenLastCalledWith(-3)
    expect(onGridOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(gridKey('C#'))
    expect(onChangePitch).toHaveBeenLastCalledWith(-6)
    fireEvent.click(gridKey('A'))
    expect(onChangePitch).toHaveBeenLastCalledWith(2)
  })
  it('grade: 12 tons, o original marcado ORIGINAL e o atual em laranja', () => {
    render(<KeyCell {...keyProps({ gridOpen: true, pitch: -1 })} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelectorAll('button')).toHaveLength(12)
    const orig = gridKey('G')
    expect(orig.getAttribute('aria-label')).toBe('G, original')
    expect(orig.querySelector('[data-original-tag]')?.textContent).toBe('ORIGINAL')
    const cur = gridKey('F#')
    expect(cur.getAttribute('aria-pressed')).toBe('true')
    expect(cur.className).toContain('bg-ps-or')
    expect(orig.getAttribute('aria-pressed')).toBe('false')
  })
  it('Esc da grade é tratado pela casca (a célula só pede pra fechar)', () => {
    const onGridOpenChange = vi.fn()
    render(<><button type="button">fora</button><KeyCell {...keyProps({ gridOpen: true, onGridOpenChange })} /></>)
    const dialog = screen.getByRole('dialog')
    // Esc não é da célula: ela não fecha sozinha nem marca o evento (a casca fecha a grade e não cancela o pulo).
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.querySelector('button')!.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(false)
    expect(onGridOpenChange).not.toHaveBeenCalled()
    // Toque dentro da célula não fecha; toque fora pede pra fechar.
    fireEvent.pointerDown(dialog)
    expect(onGridOpenChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(btn('fora'))
    expect(onGridOpenChange).toHaveBeenLastCalledWith(false)
  })
  it('a grade aberta recebe o foco no tom atual e devolve pro botão ao fechar por dentro', () => {
    const { rerender } = render(<KeyCell {...keyProps({ gridOpen: true, pitch: 2 })} />)
    expect(document.activeElement).toBe(gridKey('A'))
    rerender(<KeyCell {...keyProps({ gridOpen: false, pitch: 2 })} />)
    expect(document.activeElement).toBe(btn(/Escolher o tom/))
  })
  it('−1, +1 e ORIG. mudam o tom pelo semitom seguro', () => {
    const onChangePitch = vi.fn()
    const { rerender } = render(<KeyCell {...keyProps({ pitch: 2, onChangePitch })} />)
    expect(btn('Descer meio tom').textContent).toBe(`${MENOS}1`)
    fireEvent.click(btn('Descer meio tom'))
    fireEvent.click(btn('Subir meio tom'))
    fireEvent.click(btn('Voltar ao tom original'))
    expect(onChangePitch.mock.calls.map((c) => c[0])).toEqual([1, 3, 0])
    expect(btn('Voltar ao tom original').textContent).toBe('ORIG.')
    rerender(<KeyCell {...keyProps({ pitch: 12, onChangePitch })} />)
    fireEvent.click(btn('Subir meio tom'))
    expect(onChangePitch).toHaveBeenLastCalledWith(12)
  })
  it('sem tom original: grade em semitons, habilitada (Ruling T13-semitom)', () => {
    const onChangePitch = vi.fn()
    const onGridOpenChange = vi.fn()
    render(<KeyCell {...keyProps({ originalKey: null, gridOpen: true, pitch: 3, onChangePitch, onGridOpenChange })} />)
    expect(q('[data-tour="tom"]').textContent).toContain('Tom original desconhecido')
    const dialog = screen.getByRole('dialog', { name: 'Escolher tom' })
    expect(dialog.textContent).toContain('Sem tom original: escolha em semitons')
    // De −6 a +6, a mesma distância que a grade de tons usa (o caminho mais curto); nada travado.
    const keys = [...dialog.querySelectorAll('button')]
    const unit = (n: number) => `${n > 0 ? '+' : n < 0 ? MENOS : ''}${Math.abs(n)} ${Math.abs(n) === 1 ? 'semitom' : 'semitons'}${n === 0 ? ', original' : ''}`
    expect(keys.map((k) => k.getAttribute('aria-label'))).toEqual([-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(unit))
    for (const k of keys) expect(k.disabled).toBe(false)
    const cur = btn('+3 semitons')
    expect(cur.getAttribute('aria-pressed')).toBe('true')
    expect(cur.className).toContain('bg-ps-or')
    expect(document.activeElement).toBe(cur)
    expect(btn('0 semitons, original').querySelector('[data-original-tag]')?.textContent).toBe('ORIGINAL')
    fireEvent.click(btn(`${MENOS}2 semitons`))
    expect(onChangePitch).toHaveBeenLastCalledWith(-2)
    expect(onGridOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(btn('0 semitons, original'))
    expect(onChangePitch).toHaveBeenLastCalledWith(0)
    // O selo e −1/+1/ORIG. continuam valendo; o motor recebe semitons, como hoje.
    expect(q('[data-key-shift]').textContent).toBe('+3')
    fireEvent.click(btn('Subir meio tom'))
    expect(onChangePitch).toHaveBeenLastCalledWith(4)
  })
})

// ---------- Seção atual ----------

const secProps = (p: Partial<CurrentSectionCellProps> = {}): CurrentSectionCellProps => ({
  sections: SECTIONS, currentSection: 1, intent: null, gates: PAGO, clock,
  onArmRepeat: () => {}, onToggleLoop: () => {}, onUpgrade: () => {}, ...p,
})

describe('célula da seção atual', () => {
  it('nome na cor da seção, compasso dela e progresso pelo relógio', () => {
    position = 12.5
    render(<CurrentSectionCell {...secProps()} />)
    const name = q('[data-section-name]')
    expect(name.textContent).toBe('Verso')
    const probe = document.createElement('span')
    probe.style.color = '#10b981'
    expect(name.style.color).toBe(probe.style.color)
    expect(q('[data-section-bar]').textContent).toBe('comp. 3 de 8')
    expect(q('[data-section-progress]').style.transform).toBe('scaleX(0.281)')
    position = 23.9
    frame()
    expect(q('[data-section-bar]').textContent).toBe('comp. 8 de 8')
  })
  it('seção sem compassos conta em m:ss', () => {
    position = 30.4
    render(<CurrentSectionCell {...secProps({ currentSection: 2 })} />)
    expect(q('[data-section-bar]').textContent).toBe('0:06 de 0:16')
  })
  it('REPETIR 3x arma a repetição da atual e o ∞ pede upgrade no Livre', () => {
    const onArmRepeat = vi.fn()
    const onToggleLoop = vi.fn()
    const onUpgrade = vi.fn()
    const { rerender } = render(<CurrentSectionCell {...secProps({ onArmRepeat, onToggleLoop, onUpgrade })} />)
    expect(q('[data-repeat-count]').textContent).toBe('1x')
    fireEvent.click(btn('Mais vezes'))
    fireEvent.click(btn('Mais vezes'))
    expect(q('[data-repeat-count]').textContent).toBe('3x')
    fireEvent.click(btn('REPETIR'))
    expect(onArmRepeat).toHaveBeenLastCalledWith(3)
    fireEvent.click(btn('Repetir sem parar'))
    expect(onToggleLoop).toHaveBeenCalledTimes(1)
    expect(onUpgrade).not.toHaveBeenCalled()
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, onToggleLoop, onUpgrade, gates: LIVRE })} />)
    fireEvent.click(btn('Repetir sem parar'))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onToggleLoop).toHaveBeenCalledTimes(1)
  })
  it('seletor de 1 até o teto do plano', () => {
    render(<CurrentSectionCell {...secProps({ gates: { ...PAGO, maxRepeats: 2 } })} />)
    expect(btn('Menos vezes').disabled).toBe(true)
    fireEvent.click(btn('Mais vezes'))
    expect(q('[data-repeat-count]').textContent).toBe('2x')
    expect(btn('Mais vezes').disabled).toBe(true)
    fireEvent.click(btn('Menos vezes'))
    expect(q('[data-repeat-count]').textContent).toBe('1x')
  })
  it('mudar N com REPETIR armado na atual re-arma; sem armar, só escolhe', () => {
    const onArmRepeat = vi.fn()
    const { rerender } = render(<CurrentSectionCell {...secProps({ onArmRepeat })} />)
    fireEvent.click(btn('Mais vezes'))
    expect(onArmRepeat).not.toHaveBeenCalled()
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, intent: { target: 1, plays: 5 } })} />)
    // Armado na atual, o seletor mostra o N armado (a banda pode ter armado outro número).
    expect(q('[data-repeat-count]').textContent).toBe('5x')
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, intent: { target: 1, plays: 2 } })} />)
    expect(q('[data-repeat-count]').textContent).toBe('2x')
    expect(btn('REPETIR').dataset.armed).toBe('true')
    expect(btn('REPETIR').className).toContain('bg-ps-arm')
    fireEvent.click(btn('Mais vezes'))
    expect(onArmRepeat).toHaveBeenLastCalledWith(3)
    // A casca devolve a intenção nova; o seletor acompanha.
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, intent: { target: 1, plays: 3 } })} />)
    expect(q('[data-repeat-count]').textContent).toBe('3x')
    fireEvent.click(btn('Menos vezes'))
    expect(onArmRepeat).toHaveBeenLastCalledWith(2)
    // Armado em outra seção (ou o loop da atual) não é o REPETIR: mudar N não arma nada.
    onArmRepeat.mockClear()
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, intent: { target: 2, plays: 1 } })} />)
    expect(btn('REPETIR').dataset.armed).toBe('false')
    fireEvent.click(btn('Mais vezes'))
    rerender(<CurrentSectionCell {...secProps({ onArmRepeat, intent: { target: 1, plays: 'infinite' } })} />)
    fireEvent.click(btn('Mais vezes'))
    expect(onArmRepeat).not.toHaveBeenCalled()
  })
  it('∞ aceso no loop da atual', () => {
    const { rerender } = render(<CurrentSectionCell {...secProps({ intent: { target: 1, plays: 'infinite' } })} />)
    expect(btn('Repetir sem parar').getAttribute('aria-pressed')).toBe('true')
    expect(btn('Repetir sem parar').className).toContain('text-ps-or')
    expect(btn('REPETIR').dataset.armed).toBe('false')
    rerender(<CurrentSectionCell {...secProps({ intent: { target: 0, plays: 'infinite' } })} />)
    expect(btn('Repetir sem parar').getAttribute('aria-pressed')).toBe('false')
  })
  it('sem seções: "Sem seções" e controles desabilitados', () => {
    const onArmRepeat = vi.fn()
    render(<CurrentSectionCell {...secProps({ sections: [], currentSection: -1, onArmRepeat })} />)
    expect(q('[data-section-name]').textContent).toBe('Sem seções')
    for (const name of ['REPETIR', 'Menos vezes', 'Mais vezes', 'Repetir sem parar']) expect(btn(name).disabled).toBe(true)
    fireEvent.click(btn('REPETIR'))
    expect(onArmRepeat).not.toHaveBeenCalled()
    expect(q('[data-section-bar]').textContent).toBe('')
  })
  it('antes da primeira seção mostra qual vem e não arma', () => {
    position = 1
    render(<CurrentSectionCell {...secProps({ sections: SECTIONS.slice(1), currentSection: -1 })} />)
    expect(q('[data-section-name]').textContent).toBe('Antes de Verso')
    expect(btn('REPETIR').disabled).toBe(true)
  })
})

// ---------- Música, PAD e LETRA ----------

describe('célula da música', () => {
  it('posição no repertório, título, artista e capa com o título', () => {
    render(<SongCell song={SONG} onPrev={() => {}} onNext={() => {}} />)
    const cell = q('[data-cell="musica"]')
    expect(cell.textContent).toContain('Música 1 de 6')
    expect(q('[data-repertoire-name]').textContent).toBe(' · Culto de domingo')
    expect(q('[data-repertoire-name]').className).toContain('min-[1700px]:inline')
    expect(screen.getByText('Grande É o Senhor', { selector: '[data-song-title]' })).toBeTruthy()
    expect(screen.getByText('Adhemar de Campos')).toBeTruthy()
    expect(q('[data-cover]').textContent).toBe('Grande É o Senhor')
  })
  it('capa da música quando existe', () => {
    const { container } = render(<SongCell song={{ ...SONG, coverImage: 'https://exemplo.test/capa.jpg' }} onPrev={() => {}} onNext={() => {}} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://exemplo.test/capa.jpg')
    expect(img.getAttribute('alt')).toBe('')
  })
  it('A SEGUIR mostra a próxima e fica desabilitado no fim', () => {
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const { rerender } = render(<SongCell song={SONG} onPrev={onPrev} onNext={onNext} />)
    const next = btn(/Próxima música/)
    expect(next.textContent).toContain('A SEGUIR')
    expect(next.textContent).toContain('Lugar Secreto')
    fireEvent.click(next)
    expect(onNext).toHaveBeenCalledTimes(1)
    // Na primeira música o anterior volta pro começo dela (como o motor faz), então continua ativo.
    fireEvent.click(btn('Música anterior'))
    expect(onPrev).toHaveBeenCalledTimes(1)
    rerender(<SongCell song={{ ...SONG, position: 6, prevName: 'Lugar Secreto', nextName: null }} onPrev={onPrev} onNext={onNext} />)
    const end = btn(/Fim do repertório/)
    expect(end.textContent).toContain('Fim do repertório')
    expect(end.disabled).toBe(true)
    fireEvent.click(end)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('sem música: nada pra navegar', () => {
    render(<SongCell song={null} onPrev={() => {}} onNext={() => {}} />)
    expect(q('[data-cell="musica"]').textContent).toContain('Nenhuma música')
    expect(btn('Música anterior').disabled).toBe(true)
    expect(btn(/Fim do repertório/).disabled).toBe(true)
  })
})

describe('PAD e LETRA', () => {
  it('PAD aceso com o painel aberto e LED musgo piscando com pad tocando', () => {
    const onPress = vi.fn()
    const { rerender } = render(<BigButton kind="pad" on={false} live={false} sub="parado" onPress={onPress} />)
    const pad = btn(/^PAD/)
    expect(pad.closest('[data-tour="pads"]') ?? pad.getAttribute('data-tour')).toBeTruthy()
    expect(pad.getAttribute('aria-pressed')).toBe('false')
    expect(pad.textContent).toContain('parado')
    expect(pad.querySelector('[data-led] > span')!.className).toContain('bg-ps-s3')
    fireEvent.click(pad)
    expect(onPress).toHaveBeenCalledTimes(1)
    rerender(<BigButton kind="pad" on live sub="tocando C" onPress={onPress} />)
    expect(btn(/^PAD/).getAttribute('aria-pressed')).toBe('true')
    expect(btn(/^PAD/).className).toContain('bg-ps-or')
    const led = btn(/^PAD/).querySelector('[data-led] > span')!
    expect(led.className).toContain('bg-ps-moss-hi')
    expect(led.className).toContain('animate-ps-blink')
    expect(btn(/^PAD/).textContent).toContain('tocando C')
  })
  it('abaixo de 1280 PAD fica em cima e LETRA embaixo, cada um com pelo menos 44 px', () => {
    render(<><BigButton kind="pad" on={false} live={false} sub="parado" onPress={() => {}} /><BigButton kind="letra" on={false} live={false} sub="teleprompter" onPress={() => {}} /></>)
    expect(q('[data-cell="pad"]').className).toContain('max-xl:pb-1')
    expect(q('[data-cell="letra"]').className).toContain('max-xl:pt-1')
    for (const b of [btn(/^PAD/), btn(/^LETRA/)]) expect(b.className).toContain('min-h-ps-touch')
  })
  it('LETRA abre o teleprompter', () => {
    const onPress = vi.fn()
    render(<BigButton kind="letra" on={false} live={false} sub="teleprompter" onPress={onPress} />)
    const lyr = btn(/^LETRA/)
    expect(lyr.getAttribute('aria-pressed')).toBeNull()
    expect(lyr.textContent).toContain('teleprompter')
    fireEvent.click(lyr)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

// ---------- Faixa inteira ----------

const VIEW: StageView = {
  song: SONG, sections: SECTIONS, currentSection: 1, intent: null, transition: null, landed: null, grid: null, gridWarning: null,
  isReadingGrid: false, isPlaying: true, isCountingIn: false, precount: { enabled: true, beats: 4, times: [] }, endMode: 'continue',
  click: { channelId: 'c1', on: true }, channels: [], master: { volume: 1, muted: false },
  outputs: { mode: 'stereo', channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false, fellBackFrom: null },
  gates: PAGO, editMode: false, channelEditMode: false, padPanelOpen: false, activePad: null,
  app: { online: true, isDesktop: false, isAdmin: false, userName: null, hostActive: false },
}
const ACTION_NAMES: (keyof StageActions)[] = [
  'togglePlay', 'goToStart', 'setEndMode', 'togglePrecount', 'cyclePrecountBeats', 'toggleClick', 'openMetronome', 'tapSection',
  'stepSection', 'cancelArm', 'armRepeat', 'toggleLoop', 'seek', 'seekBy', 'changePitch', 'prevSong', 'nextSong', 'setVolume',
  'toggleMute', 'toggleSolo', 'setPan', 'setMasterVolume', 'toggleMasterMute', 'togglePadPanel', 'openLyrics', 'openRepertoires',
  'openTracks', 'openLibrary', 'toggleEditMode', 'toggleChannelEditMode', 'openHost', 'openSettings', 'goHome', 'signOut',
  'openUpgrade', 'openChannelEdit', 'reorderChannel', 'removeChannel', 'markSection', 'nudgeSection', 'removeSection', 'setMeter',
  'redetectMeter',
]
const makeActions = () => Object.fromEntries(ACTION_NAMES.map((n) => [n, vi.fn()])) as unknown as Record<keyof StageActions, ReturnType<typeof vi.fn>> & StageActions

interface StripOpts { view?: Partial<StageView>; keyGridOpen?: boolean; onKeyGridOpenChange?: (open: boolean) => void; onOpenMeter?: () => void; actions?: StageActions }
const renderStrip = (o: StripOpts = {}) => render(
  <MidStrip
    view={{ ...VIEW, ...o.view }} actions={o.actions ?? makeActions()} clock={clock} keyGridOpen={o.keyGridOpen ?? false}
    onKeyGridOpenChange={o.onKeyGridOpenChange ?? (() => {})} onOpenMeter={o.onOpenMeter ?? (() => {})}
  />,
)

describe('faixa do meio', () => {
  it('seis células na ordem do mockup: colunas do v5 de 1280 pra cima, PAD e LETRA empilhados abaixo (Ruling T13-1024)', () => {
    const { container } = renderStrip()
    const strip = container.querySelector('section')!
    expect([...strip.children].map((c) => c.getAttribute('data-cell'))).toEqual(['tempo', 'tom', 'secao', 'musica', 'pad', 'letra'])
    expect(strip.className).toContain(
      'xl:grid-cols-[minmax(214px,1.1fr)_minmax(176px,.9fr)_minmax(280px,1.3fr)_minmax(316px,2fr)_minmax(120px,.75fr)_minmax(96px,.6fr)]',
    )
    expect(strip.className).toContain('h-(--ps-mid-h)')
    // Abaixo de 1280: cinco colunas, as quatro primeiras células nas duas linhas e PAD em cima de LETRA na última.
    const base = /(?:^|\s)grid-cols-\[([^\]]+)\]/.exec(strip.className)![1]
    const mins = [...base.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]))
    expect(mins).toHaveLength(5)
    // Em 1024 cabe tudo: 1024 menos os 16 px de cada lado, com folga de 4 px.
    expect(mins.reduce((x, y) => x + y)).toBeLessThanOrEqual(1024 - 32 - 4)
    expect(strip.className).toContain('max-xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]')
    expect(strip.className).toContain('max-xl:[&>:nth-child(-n+4)]:row-span-2')
  })
  it('liga cada toque na ação do palco', () => {
    const a = makeActions()
    const onKeyGridOpenChange = vi.fn()
    const { rerender } = renderStrip({ actions: a, onKeyGridOpenChange })
    fireEvent.click(btn(/Escolher o tom/))
    expect(onKeyGridOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(btn('Subir meio tom'))
    expect(a.changePitch).toHaveBeenLastCalledWith(0)
    fireEvent.click(btn('REPETIR'))
    expect(a.armRepeat).toHaveBeenLastCalledWith(1)
    fireEvent.click(btn('Repetir sem parar'))
    expect(a.toggleLoop).toHaveBeenCalledTimes(1)
    fireEvent.click(btn(/Próxima música/))
    expect(a.nextSong).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('Música anterior'))
    expect(a.prevSong).toHaveBeenCalledTimes(1)
    fireEvent.click(btn(/^PAD/))
    expect(a.togglePadPanel).toHaveBeenCalledTimes(1)
    fireEvent.click(btn(/^LETRA/))
    expect(a.openLyrics).toHaveBeenCalledTimes(1)
    rerender(
      <MidStrip view={{ ...VIEW, gates: LIVRE }} actions={a} clock={clock} keyGridOpen onKeyGridOpenChange={onKeyGridOpenChange} onOpenMeter={() => {}} />,
    )
    fireEvent.click(btn('Repetir sem parar'))
    expect(a.openUpgrade).toHaveBeenCalledTimes(1)
    fireEvent.click(gridKey('E'))
    expect(a.changePitch).toHaveBeenLastCalledWith(-3)
  })
  it('PAD mostra o pad tocando', () => {
    renderStrip({ view: { padPanelOpen: true, activePad: 'C#' } })
    expect(btn(/^PAD/).textContent).toContain('tocando C#')
    expect(btn(/^PAD/).getAttribute('aria-pressed')).toBe('true')
  })
  // Ruling T13-bpm: a grade guarda o BPM do PULSO (a colcheia no x/8); a tela mostra a semínima pela
  // conversão única do contrato. Sem grade, o BPM salvo da música, que já é a semínima.
  it.each([
    [156, '6/8', 3, '78.0 BPM · 6/8'],
    [120, '4/4', 1, '120.0 BPM · 4/4'],
    [140, '7/8', 1, '70.0 BPM · 7/8'],
    [144.6, '12/8', 3, '72.3 BPM · 12/8'],
  ] as const)('grade de %s pulsos por minuto em %s mostra a semínima', (pulse, sig, countEvery, shown) => {
    renderStrip({
      view: { grid: { bpm: pulse, firstDownbeat: 0, signature: sig, countEvery, source: 'click', meterSource: 'acento' }, song: { ...SONG, bpm: 99, signature: '4/4' } },
    })
    expect(q('[data-bpm]').textContent).toBe(shown)
  })
  it('sem grade (ou com grade quebrada) mostra o BPM salvo da música', () => {
    const { unmount } = renderStrip({ view: { grid: null, song: { ...SONG, bpm: 78, signature: '6/8' } } })
    expect(q('[data-bpm]').textContent).toBe('78.0 BPM · 6/8')
    unmount()
    renderStrip({ view: { grid: { bpm: Number.NaN, firstDownbeat: 0, signature: '6/8', countEvery: 3, source: 'bpm', meterSource: 'salvo' }, song: { ...SONG, bpm: 78, signature: '6/8' } } })
    expect(q('[data-bpm]').textContent).toBe('78.0 BPM · 6/8')
  })
  it('modo EDITAR: o Compasso abre o editor da casca', () => {
    const onOpenMeter = vi.fn()
    renderStrip({ view: { editMode: true }, onOpenMeter })
    fireEvent.click(btn(/Compasso/))
    expect(onOpenMeter).toHaveBeenCalledTimes(1)
  })
  it('o que não cabe desce a fonte aos poucos até 12 px e nunca corta (régua falsa, Ruling T13-texto)', () => {
    // Régua: linha de 20 px. Cada célula medida tem --ps-fit (1 = tamanho cheio, 0 = 12 px e capa de 48 px).
    // Nome de seção longo ocupa 3 linhas até --ps-fit 0,6; a música não cabe até 0,5 (título longo),
    // 0,25 (título e próxima longos) ou nunca (exagerado); o botão do tom passa da largura.
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, p) => {
      const cs = real(el, p)
      return new Proxy(cs, { get: (t, k) => (k === 'lineHeight' ? '20px' : ((v) => (typeof v === 'function' ? v.bind(t) : v))(Reflect.get(t, k, t))) })
    })
    const len = (el: Element | null) => (el?.textContent ?? '').length
    const fitOf = (el: Element) => {
      const v = (el.closest('[data-fit-height]') as HTMLElement | null)?.style.getPropertyValue('--ps-fit')
      return v ? Number(v) : 1
    }
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-section-name') && len(this) > 20 && fitOf(this) > 0.6 ? 60 : 40
    })
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-fit-height')) return rect(0, 168)
      const cell = this.closest('[data-cell="musica"]') as HTMLElement | null
      if (!cell) return rect(20, 100)
      const k = fitOf(this)
      // Título de enfeite na capa: cabe na capa grande, não na de 48 px.
      if (this.parentElement?.hasAttribute('data-cover')) return k <= 0.25 ? rect(10, 120) : rect(25, 60)
      const title = len(cell.querySelector('[data-song-title]'))
      const next = len(cell.querySelector('[aria-label^="Próxima"] b'))
      const dropped = cell.dataset.fit === 'drop'
      // 'y' x 71: não cabe nem no mínimo com a capa; sem ela, cabe em 0,75.
      const need = title > 70 && (cell.textContent ?? '').includes('yyy') ? (dropped ? 0.75 : -1) : title > 70 ? -1 : title > 20 ? (next > 20 ? 0.25 : 0.5) : 1
      return k > need ? rect(-10, 188) : rect(20, 100)
    })
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      return this.hasAttribute('data-fit-width') && (this.textContent ?? '').includes('m') ? 180 : 150
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => 152)
    const fit = (cell: string) => q(`[data-cell="${cell}"]`).style.getPropertyValue('--ps-fit')
    const a = makeActions()
    const strip = (v: Partial<StageView>) => <MidStrip view={{ ...VIEW, ...v }} actions={a} clock={clock} keyGridOpen={false} onKeyGridOpenChange={() => {}} onOpenMeter={() => {}} />
    const longSong = { ...SONG, name: 'Quão Grande És Tu (Ao Vivo no Ministério)', originalKey: 'F#m' }
    const { rerender } = render(strip({ sections: [SECTIONS[0], { ...SECTIONS[1], label: 'Refrão Final Estendido de Novo' }, SECTIONS[2]], song: longSong }))
    expect(fit('secao')).toBe('0.5')
    expect(fit('musica')).toBe('0.5')
    expect(fit('tempo')).toBe('1')
    expect(q('[data-cover]').dataset.fit).toBeUndefined()
    expect(q('[data-fit-width]').dataset.fit).toBe('small')
    // Título e próxima longos: desce mais, a capa encolhe e o título de enfeite dela some (nunca vaza).
    rerender(strip({ song: { ...longSong, nextName: 'Te Louvarei Por Toda a Minha Vida' } }))
    expect(fit('musica')).toBe('0.25')
    expect(fit('secao')).toBe('1')
    expect(q('[data-cover]').dataset.fit).toBe('hide')
    expect(q('[data-cover] > span').getAttribute('aria-hidden')).toBe('true')
    // Nada mais cabe: para no mínimo (12 px) e, por último, a capa sai pra o texto ganhar a largura.
    rerender(strip({ song: { ...longSong, name: 'x'.repeat(77) } }))
    expect(fit('musica')).toBe('0')
    expect(q('[data-cell="musica"]').dataset.fit).toBe('drop')
    // Sem a capa, mede de novo do tamanho cheio: se coube com ela fora, a fonte volta a crescer.
    rerender(strip({ song: { ...longSong, name: 'y'.repeat(71) } }))
    expect(q('[data-cell="musica"]').dataset.fit).toBe('drop')
    expect(fit('musica')).toBe('0.75')
    expect(q('[data-cover]').className).toContain('group-data-[fit=drop]/song:hidden')
    // Palavra do título de enfeite mais larga que a capa: some também.
    const width = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const before = width.getMockImplementation()!
    width.mockImplementation(function (this: Element) {
      if (this.parentElement?.hasAttribute('data-cover')) return { ...rect(25, 60), left: -5, right: 110, width: 115 } as DOMRect
      return before.call(this)
    })
    rerender(strip({ song: { ...SONG, name: 'Grandeeeeeeeeeeeeeza' } }))
    expect(q('[data-cover]').dataset.fit).toBe('hide')
    width.mockImplementation(before)
    // Voltou a caber: tamanho cheio.
    rerender(strip({}))
    expect(fit('musica')).toBe('1')
    expect(q('[data-cell="musica"]').dataset.fit).toBeUndefined()
    expect(q('[data-cover]').dataset.fit).toBeUndefined()
    expect(q('[data-fit-width]').dataset.fit).toBeUndefined()
  })
  it('os tamanhos que encolhem param em 12 px (texto) e 48 px (capa)', () => {
    renderStrip()
    const minOf = (el: Element, min: string) => expect(el.className).toMatch(new RegExp(`calc\\(${min}_\\+_.*var\\(--ps-fit,1\\)`))
    minOf(q('[data-section-name]'), '12px')
    minOf(q('[data-song-title]'), '12px')
    minOf(q('[aria-label^="Próxima"] b'), '12px')
    minOf(q('[data-cover]'), '48px')
    // Nenhuma fonte que encolhe passa de 12 px pra baixo (o tempo para em 24).
    let shrinking = 0
    for (const el of document.querySelectorAll('[data-fit-height] *')) {
      const m = /text-\[length:calc\((\d+)px_\+_/.exec(el.className.toString())
      if (!m) continue
      shrinking++
      expect(Number(m[1])).toBeGreaterThanOrEqual(12)
    }
    expect(shrinking).toBeGreaterThanOrEqual(5)
  })
  it('tour guiado acha TOM e PADS', () => {
    renderStrip()
    expect(document.querySelector('[data-tour="tom"]')).toBeTruthy()
    expect(document.querySelector('[data-tour="pads"]')).toBeTruthy()
  })
  it('sem botão de andamento (Projeto 4)', () => {
    renderStrip()
    expect(screen.queryByText('+5')).toBeNull()
    expect(screen.queryByText(`${MENOS}5`)).toBeNull()
  })
  it('botões com largura pelo texto e alvos de toque de 44px', () => {
    const { container } = renderStrip({ keyGridOpen: true, view: { editMode: true } })
    const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$)|full(\s|$))/
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(20)
    for (const b of buttons) {
      expect(b.className).not.toMatch(FIXED_WIDTH)
      expect(b.className).toMatch(/min-w-(ps-touch|max|auto)/)
      expect(b.className).toMatch(/min-h-(ps-touch|\[50px\]|14)|h-full/)
    }
  })
  it('sem travessão e sem palavra proibida em inglês', () => {
    position = 30
    const states: StripOpts[] = [
      {},
      { keyGridOpen: true, view: { editMode: true, gridWarning: 'compasso-assumido', intent: { target: 1, plays: 3 } } },
      { keyGridOpen: true, view: { song: { ...SONG, originalKey: null, nextName: null, coverImage: 'capa.jpg' }, sections: [], currentSection: -1, gates: LIVRE } },
      { view: { song: null, gridWarning: 'sem-grade', intent: { target: 1, plays: 'infinite' }, padPanelOpen: true, activePad: 'D' } },
      { view: { gridWarning: 'sem-click-lido', sections: SECTIONS.slice(1), currentSection: -1 } },
    ]
    for (const s of states) {
      const { container, unmount } = renderStrip(s)
      frame()
      const t = container.textContent!
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(PROIBIDAS)
      for (const el of container.querySelectorAll('[aria-label],[title],[alt]')) {
        for (const attr of ['aria-label', 'title', 'alt']) {
          const v = el.getAttribute(attr) ?? ''
          expect(v).not.toContain(TRAVESSAO)
          expect(v).not.toMatch(PROIBIDAS)
        }
      }
      unmount()
    }
  })
})
