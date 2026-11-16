// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GRID_WARNING_TEXT } from '../../lib/stageContracts'
import type { ArmIntent, GridWarning, StageSection, TransitionView } from '../../lib/stageContracts'
import { NextPill } from './NextPill'
import { PlayButton } from './PlayButton'
import { TransportBar } from './TransportBar'
import type { TransportBarProps } from './TransportBar'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i

// requestAnimationFrame falso: guarda os pedidos e solta um quadro por vez.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
const frame = (t = 16) => {
  const due = [...pending.values()]
  pending = new Map()
  for (const cb of due) cb(t)
}

beforeEach(() => {
  pending = new Map()
  nextId = 1
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

const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 8, end: 22, bars: 7 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 22, end: 38, bars: 8 },
]
// Pulo armado do Verso pro Refrão, contagem de 4 no último compasso (passo 0,5 s), troca em 22 s.
const T: TransitionView = {
  from: 1, to: 2, kind: 'proxima', plays: 1, switchAt: 22, countTimes: [20, 20.5, 21, 21.5], countLabels: [1, 2, 3, 4],
  countTotal: 4, barsLeft: 1, committed: true, clickAudible: true, hasGrid: true,
}
const SELF_LOOP: TransitionView = { ...T, to: 1, kind: 'repete', plays: 'infinite', countTimes: [], countLabels: [], barsLeft: 3 }

// Relógio de teste: o tempo ouvido e a posição mudam entre os quadros.
let heard = 0
let position = 0
const clock = { heardNow: () => heard, position: () => position }

interface PillOpts { transition?: TransitionView | null; intent?: ArmIntent | null; currentSection?: number; gridWarning?: GridWarning | null; onCancel?: () => void }
const renderPill = (o: PillOpts = {}) => render(
  <NextPill
    transition={o.transition === undefined ? T : o.transition} intent={o.intent === undefined ? { target: 2, plays: 1 } : o.intent}
    sections={SECTIONS} currentSection={o.currentSection ?? 1} gridWarning={o.gridWarning ?? null} clock={clock}
    onCancel={o.onCancel ?? (() => {})}
  />,
)
const pill = () => screen.getByRole('status', { hidden: true })
const dots = () => [...pill().querySelectorAll('[data-dot]')].map((d) => d.getAttribute('data-on'))
const waitText = () => pill().querySelector('[data-wait]') as HTMLElement

const view = (patch: Partial<TransportBarProps['view']> = {}): TransportBarProps['view'] => ({
  isPlaying: true, isCountingIn: false, precount: { enabled: true, beats: 4, times: [] }, endMode: 'continue',
  click: { channelId: 'c1', on: true }, intent: null, transition: null, sections: SECTIONS, currentSection: 1,
  gates: { sections: true, infinite: true, maxRepeats: 8, bandSections: true }, gridWarning: null, ...patch,
})
const actions = () => ({
  togglePlay: vi.fn(), goToStart: vi.fn(), setEndMode: vi.fn(), togglePrecount: vi.fn(), cyclePrecountBeats: vi.fn(),
  toggleClick: vi.fn(), openMetronome: vi.fn(), stepSection: vi.fn(), cancelArm: vi.fn(), toggleLoop: vi.fn(),
})
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => { heard = 0; position = 0 })

describe('aviso PRÓXIMA', () => {
  it('aviso REPETE 3x na seção atual, com X pra cancelar', () => {
    const onCancel = vi.fn()
    heard = 10
    renderPill({ transition: { ...T, to: 1, kind: 'repete', plays: 3 }, intent: { target: 1, plays: 3 }, onCancel })
    expect(pill().getAttribute('aria-hidden')).toBeNull()
    expect(pill().textContent).toContain('REPETE 3x')
    expect(pill().textContent).toContain('Verso')
    fireEvent.click(btn('Cancelar pulo'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
  it('REPETE sem número numa passada só; PRÓXIMA em outra seção, com o nome na cor da seção', () => {
    renderPill({ transition: { ...T, to: 1, kind: 'repete' }, intent: { target: 1, plays: 1 } })
    expect(pill().textContent).toContain('REPETE')
    expect(pill().textContent).not.toContain('1x')
    cleanup()
    renderPill()
    expect(pill().textContent).toContain('PRÓXIMA')
    const name = screen.getByText('Refrão')
    const probe = document.createElement('span')
    probe.style.color = '#FF6B35'
    expect(name.style.color).toBe(probe.style.color)
  })
  it('acende as bolinhas pelo tempo ouvido', () => {
    heard = 20.6
    renderPill()
    frame()
    expect(dots()).toEqual(['true', 'true', 'false', 'false'])
    heard = 21.6
    frame()
    expect(dots()).toEqual(['true', 'true', 'true', 'true'])
    // No "1" ouvido a contagem acabou: nada aceso.
    heard = 22.01
    frame()
    expect(dots()).toEqual(['false', 'false', 'false', 'false'])
  })
  it('texto de espera no lugar das bolinhas; CLICK DESLIGADO em âmbar', () => {
    heard = 10
    renderPill({ transition: { ...T, barsLeft: 3 } })
    expect(pill().getAttribute('data-waiting')).toBe('true')
    expect(waitText().textContent).toBe('em 3 comp.')
    expect(waitText().getAttribute('data-alert')).toBe('false')
    cleanup()
    renderPill({ transition: { ...T, clickAudible: false } })
    heard = 20.6
    frame()
    expect(waitText().textContent).toBe('CLICK DESLIGADO')
    expect(waitText().getAttribute('data-alert')).toBe('true')
    expect(waitText().className).toContain('data-[alert=true]:text-ps-alert')
    // Contando com o click ligado, as bolinhas aparecem no lugar do texto.
    cleanup()
    renderPill()
    frame()
    expect(pill().getAttribute('data-waiting')).toBe('false')
    expect(waitText().textContent).toBe('')
  })
  it('mostra o aviso âmbar da grade com pulo armado', () => {
    renderPill({ gridWarning: 'sem-click-lido' })
    const w = screen.getByText('SEM CLICK LIDO')
    expect(w.getAttribute('title')).toBe(GRID_WARNING_TEXT['sem-click-lido'].title)
    expect(w.className).toContain('text-ps-alert')
    cleanup()
    renderPill({ gridWarning: 'compasso-assumido' })
    expect(screen.getByText('4/4 ASSUMIDO').getAttribute('title')).toBe(GRID_WARNING_TEXT['compasso-assumido'].title)
    // Sem grade nenhuma o texto de espera já diz "no fim da seção": sem linha extra.
    cleanup()
    renderPill({ gridWarning: 'sem-grade', transition: { ...T, hasGrid: false, countTimes: [], countLabels: [], countTotal: 0 } })
    expect(screen.queryByText('SEM GRADE')).toBeNull()
    expect(waitText().textContent).toBe('no fim da seção')
    // Sem pulo armado o aviso não aparece.
    cleanup()
    renderPill({ gridWarning: 'sem-click-lido', intent: null, transition: null })
    expect(screen.queryByText('SEM CLICK LIDO')).toBeNull()
  })
  it('aviso escondido no loop infinito da própria seção', () => {
    renderPill({ transition: SELF_LOOP, intent: { target: 1, plays: 'infinite' } })
    expect(pill().getAttribute('aria-hidden')).toBe('true')
    expect(pill().hasAttribute('inert')).toBe(true)
    expect(pill().className).not.toContain('animate-ps-armglow')
    expect(pending.size).toBe(0) // nada roda por quadro escondido
    cleanup()
    renderPill({ intent: null, transition: null })
    expect(pill().getAttribute('aria-hidden')).toBe('true')
    expect(pill().className).not.toContain('animate-ps-armglow')
    // Loop infinito armado pra OUTRA seção aparece, pulsando, com a borda fixa pro movimento reduzido.
    cleanup()
    renderPill({ intent: { target: 2, plays: 'infinite' } })
    expect(pill().getAttribute('aria-hidden')).toBeNull()
    expect(pill().textContent).toContain('PRÓXIMA')
    for (const c of ['animate-ps-armglow', 'inset-ring-ps-arm']) expect(pill().className).toContain(c)
  })
  it('até 4 bolinhas numa linha; 5 a 12 quebram em duas (12/8 contando todos os pulsos: duas de 6)', () => {
    const cols = (n: number) => {
      const times = Array.from({ length: n }, (_, i) => 16 + i * 0.5)
      renderPill({ transition: { ...T, countTimes: times, countLabels: times.map((_, i) => i + 1), countTotal: n } })
      expect(dots()).toHaveLength(n)
      const c = pill().querySelector('[data-dot]')!.parentElement!.className.match(/grid-cols-(\d+)/)![1]
      cleanup()
      return Number(c)
    }
    expect([3, 4, 5, 6, 7, 12].map(cols)).toEqual([3, 4, 3, 3, 4, 6])
  })
})

describe('Play', () => {
  const renderPlay = (p: Partial<ComponentProps<typeof PlayButton>> = {}) => render(
    <PlayButton isPlaying={false} isCountingIn={false} precountTimes={[]} pulse={null} clock={clock} onToggle={() => {}} {...p} />,
  )
  it('Tocar parado, Pausar tocando e na pré-contagem', () => {
    renderPlay()
    expect(btn('Tocar').getAttribute('data-tour')).toBe('play')
    cleanup()
    renderPlay({ isPlaying: true })
    expect(btn('Pausar')).toBeTruthy()
    cleanup()
    renderPlay({ isCountingIn: true })
    expect(btn('Pausar')).toBeTruthy()
  })
  it('na pré-contagem mostra o número do bipe ouvido', () => {
    heard = 9.9
    renderPlay({ isCountingIn: true, precountTimes: [10, 10.5, 11, 11.5] })
    const b = btn('Pausar')
    expect(b.getAttribute('data-precount')).toBe('false')
    heard = 10.6
    frame()
    expect(b.getAttribute('data-precount')).toBe('true')
    expect(b.textContent).toBe('2')
    heard = 11.5
    frame()
    expect(b.textContent).toBe('4')
  })
  it('anel pulsa tocando quando a fase do pulso ouvido é menor que 0,14', () => {
    position = 1.25 // (1,25 - 0,2) / 0,5 = 2,1: fase 0,1
    renderPlay({ isPlaying: true, pulse: { seconds: 0.5, firstDownbeat: 0.2 } })
    const b = btn('Pausar')
    expect(b.getAttribute('data-pulse')).toBe('true')
    position = 1.3 // fase 0,2
    frame()
    expect(b.getAttribute('data-pulse')).toBe('false')
    position = 1.71 // fase 0,02
    frame()
    expect(b.getAttribute('data-pulse')).toBe('true')
    // Parado não pulsa e não roda nada por quadro.
    cleanup()
    pending = new Map()
    renderPlay({ isPlaying: false, pulse: { seconds: 0.5, firstDownbeat: 0.2 } })
    expect(btn('Tocar').getAttribute('data-pulse')).toBe('false')
    expect(pending.size).toBe(0)
  })
  it('sem pulso (grade sem fase) o anel não pulsa', () => {
    position = 1.25
    renderPlay({ isPlaying: true, pulse: null })
    expect(btn('Pausar').getAttribute('data-pulse')).toBe('false')
  })
})

describe('transporte', () => {
  it('botões do transporte chamam as ações certas', () => {
    const a = actions()
    render(<TransportBar view={view({ intent: { target: 2, plays: 1 }, transition: T })} actions={a} clock={clock} pulse={null} />)
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('Pausar'))
    expect(a.togglePlay).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('LOOP'))
    expect(a.toggleLoop).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('CLICK'))
    expect(a.toggleClick).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('Metrônomo'))
    expect(a.openMetronome).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('PRÉ-CONT.'))
    expect(a.togglePrecount).toHaveBeenCalledTimes(1)
    fireEvent.click(btn(/Tempos da pré-contagem/))
    expect(a.cyclePrecountBeats).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('Armar seção anterior'))
    fireEvent.click(btn('Armar seção seguinte'))
    expect(a.stepSection.mock.calls).toEqual([[-1], [1]])
    fireEvent.click(btn('Cancelar pulo'))
    expect(a.cancelArm).toHaveBeenCalledTimes(1)
    for (const [label, mode] of [['PARAR', 'stop'], ['FADE', 'fade-out'], ['AUTO', 'continue']] as const) {
      fireEvent.click(screen.getByRole('radio', { name: label }))
      expect(a.setEndMode).toHaveBeenLastCalledWith(mode)
    }
    expect(screen.getByRole('radiogroup', { name: 'Fim da música' })).toBeTruthy()
  })
  it('pontos do tour no palco novo', () => {
    const { container } = render(<TransportBar view={view()} actions={actions()} clock={clock} pulse={null} />)
    const tour = (k: string) => container.querySelector(`[data-tour="${k}"]`)
    expect(tour('play')).toBe(btn('Pausar'))
    expect(tour('metronomo')).toBe(btn('Metrônomo'))
    expect(tour('modos')!.contains(screen.getByRole('radiogroup', { name: 'Fim da música' }))).toBe(true)
    expect(tour('precontagem')!.contains(btn('PRÉ-CONT.'))).toBe(true)
    expect(tour('precontagem')!.contains(btn(/Tempos da pré-contagem/))).toBe(true)
  })
  it('LOOP aceso com o loop infinito da atual; CLICK e PRÉ-CONT. acesos pelo estado', () => {
    const { rerender } = render(<TransportBar view={view({ intent: { target: 1, plays: 'infinite' }, transition: SELF_LOOP })} actions={actions()} clock={clock} pulse={null} />)
    expect(btn('LOOP').getAttribute('aria-pressed')).toBe('true')
    expect(btn('LOOP').className).toContain('text-ps-or')
    expect(btn('CLICK').getAttribute('aria-pressed')).toBe('true')
    expect(btn('PRÉ-CONT.').getAttribute('aria-pressed')).toBe('true')
    expect(btn(/Tempos da pré-contagem/).textContent).toBe('4')
    rerender(<TransportBar view={view({ intent: { target: 1, plays: 3 }, click: { channelId: 'c1', on: false }, precount: { enabled: false, beats: 2, times: [] } })} actions={actions()} clock={clock} pulse={null} />)
    expect(btn('LOOP').getAttribute('aria-pressed')).toBe('false')
    expect(btn('LOOP').className).not.toContain('text-ps-or')
    expect(btn('CLICK').getAttribute('aria-pressed')).toBe('false')
    expect(btn('PRÉ-CONT.').getAttribute('aria-pressed')).toBe('false')
    expect(btn(/Tempos da pré-contagem/).textContent).toBe('2')
    expect(btn(/Tempos da pré-contagem/).className).toContain('text-ps-dim')
  })
  it('CLICK desabilitado sem canal de click', () => {
    const a = actions()
    render(<TransportBar view={view({ click: { channelId: null, on: false } })} actions={a} clock={clock} pulse={null} />)
    const c = btn('CLICK')
    expect(c.disabled).toBe(true)
    expect(c.getAttribute('title')).toBe('Esta música não tem canal de click')
    // O título também fica no grupo, pra aparecer no hover do botão desabilitado.
    expect(c.parentElement!.getAttribute('title')).toBe('Esta música não tem canal de click')
    fireEvent.click(c)
    expect(a.toggleClick).not.toHaveBeenCalled()
    expect(btn('Metrônomo').disabled).toBe(false)
  })
  it('música sem seções num plano pago: LOOP e SEÇÃO desabilitados; no Livre seguem pro convite', () => {
    const a = actions()
    const { rerender } = render(<TransportBar view={view({ sections: [], currentSection: -1 })} actions={a} clock={clock} pulse={null} />)
    for (const n of ['LOOP', 'Armar seção anterior', 'Armar seção seguinte']) {
      expect(btn(n).disabled).toBe(true)
      expect(btn(n).getAttribute('title')).toBe('Esta música ainda não tem seções. Marque no EDITAR.')
    }
    const livre = { sections: false, infinite: false, maxRepeats: 1, bandSections: false }
    rerender(<TransportBar view={view({ sections: [], currentSection: -1, gates: livre })} actions={a} clock={clock} pulse={null} />)
    fireEvent.click(btn('LOOP'))
    fireEvent.click(btn('Armar seção seguinte'))
    expect(a.toggleLoop).toHaveBeenCalledTimes(1)
    expect(a.stepSection).toHaveBeenCalledWith(1)
  })
  it('botões com largura pelo texto e alvos de toque de 44px', () => {
    const { container } = render(<TransportBar view={view({ intent: { target: 2, plays: 1 }, transition: T })} actions={actions()} clock={clock} pulse={null} />)
    const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$))/
    for (const b of container.querySelectorAll('button')) {
      expect(b.className).not.toMatch(FIXED_WIDTH)
      expect(b.className).toMatch(/min-w-(ps-touch|\[(4[4-9]|[5-9]\d)px\])|size-\[68px\]/)
      expect(b.className).toMatch(/min-h-ps-touch|h-14|size-\[68px\]/)
    }
  })
  it('sem palavra proibida em inglês e sem travessão', () => {
    heard = 20.6
    const { container } = render(
      <TransportBar
        view={view({ intent: { target: 1, plays: 3 }, transition: { ...T, to: 1, kind: 'repete', plays: 3, clickAudible: false }, gridWarning: 'compasso-assumido', isCountingIn: true, precount: { enabled: true, beats: 4, times: [20, 20.5] } })}
        actions={actions()} clock={clock} pulse={{ seconds: 0.5, firstDownbeat: 0 }}
      />,
    )
    frame()
    const t = container.textContent!
    expect(t).toContain('CLICK DESLIGADO')
    expect(t).not.toContain(TRAVESSAO)
    expect(t).not.toMatch(PROIBIDAS)
    // Nomes acessíveis e dicas também em português.
    for (const el of container.querySelectorAll('[aria-label],[title]')) {
      for (const attr of ['aria-label', 'title']) {
        const v = el.getAttribute(attr) ?? ''
        expect(v).not.toContain(TRAVESSAO)
        expect(v).not.toMatch(PROIBIDAS)
      }
    }
  })
})
