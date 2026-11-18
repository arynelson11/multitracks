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
const pill = () => document.querySelector('[data-next-pill]') as HTMLElement
const dots = () => [...pill().querySelectorAll('[data-dot]')].map((d) => d.getAttribute('data-on'))
const waitText = () => pill().querySelector('[data-wait]') as HTMLElement
const pillName = () => pill().querySelector('[data-pill-name]') as HTMLElement
const announcer = () => screen.getByRole('status')
// Contagem de n pulsos no último compasso (passo 0,5 s), troca em 22 s.
const counting = (n: number): TransitionView => {
  const times = Array.from({ length: n }, (_, i) => 22 - (n - i) * 0.5)
  return { ...T, countTimes: times, countLabels: times.map((_, i) => i + 1), countTotal: n }
}

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
    // Esperando, as bolinhas ficam invisíveis mas no lugar (não somem do layout).
    expect(pill().querySelector('[data-dots]')!.className).toContain('group-data-[waiting=true]:invisible')
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
    // Ao lado do rótulo (mesma linha, como no v5), não embaixo do nome.
    expect(w.parentElement).toBe(screen.getByText('PRÓXIMA').parentElement)
    expect(w.parentElement!.compareDocumentPosition(pillName()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A explicação não fica só no title: o X (único foco do aviso) é descrito por ela.
    const desc = document.getElementById(btn('Cancelar pulo').getAttribute('aria-describedby')!)
    expect(desc!.textContent).toBe(GRID_WARNING_TEXT['sem-click-lido'].title)
    cleanup()
    renderPill({ gridWarning: 'compasso-assumido' })
    expect(screen.getByText('COMPASSO ASSUMIDO').getAttribute('title')).toBe(GRID_WARNING_TEXT['compasso-assumido'].title)
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
  it('abaixo de 1440 o aviso da grade vira uma luz âmbar ao lado do rótulo (o nome continua em até 2 linhas)', () => {
    renderPill({ gridWarning: 'compasso-assumido' })
    const w = screen.getByText('COMPASSO ASSUMIDO')
    expect(w.className).toContain('max-[1440px]:hidden')
    const led = w.parentElement!.querySelector('[data-grid-warning-led]') as HTMLElement
    expect(led).not.toBeNull()
    expect(led.className).toContain('min-[1440px]:hidden')
    expect(led.getAttribute('title')).toBe(GRID_WARNING_TEXT['compasso-assumido'].title)
    expect(led.querySelector('.bg-ps-alert')).not.toBeNull()
    // O leitor de tela continua ouvindo o aviso inteiro (região viva e descrição do X).
    expect(announcer().textContent).toContain('COMPASSO ASSUMIDO')
  })
  it('região viva fora do aviso: anuncia armou e desarmou uma vez, nunca por bipe', () => {
    heard = 10
    const { rerender } = renderPill({ intent: null, transition: null, gridWarning: 'sem-click-lido' })
    expect(announcer().getAttribute('aria-hidden')).toBeNull()
    expect(announcer().contains(pill())).toBe(false)
    expect(announcer().textContent).toBe('Nenhum pulo armado')
    const props = { sections: SECTIONS, currentSection: 1, gridWarning: 'sem-click-lido' as const, clock, onCancel: () => {} }
    rerender(<NextPill {...props} transition={T} intent={{ target: 2, plays: 1 }} />)
    const armed = announcer().textContent
    expect(armed).toBe(`PRÓXIMA Refrão. SEM CLICK LIDO: ${GRID_WARNING_TEXT['sem-click-lido'].title}`)
    for (const h of [20.01, 20.51, 21.01, 21.51]) { heard = h; frame() }
    expect(announcer().textContent).toBe(armed)
    rerender(<NextPill {...props} transition={null} intent={null} />)
    expect(announcer().textContent).toBe('Nenhum pulo armado')
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
  it('uma bolinha por TEMPO do compasso: 12/8 conta 4, 6/8 conta 2, no máximo 7; até 4 numa linha', () => {
    const shape = (n: number) => {
      renderPill({ transition: counting(n) })
      const d = dots().length
      const c = Number(pill().querySelector('[data-dots]')!.className.match(/grid-cols-(\d+)/)![1])
      cleanup()
      return [d, c]
    }
    // 2 (6/8 de 3 em 3), 3/4, 4/4, 5/4, 6/8 pulso a pulso, 7/8, 12/8 pulso a pulso.
    expect([2, 3, 4, 5, 6, 7, 12].map(shape)).toEqual([[2, 2], [3, 3], [4, 4], [5, 3], [2, 2], [7, 4], [4, 4]])
  })
  it('12/8 contado pulso a pulso acende a bolinha do tempo quando o pulso dele soa', () => {
    heard = 22 - 12 * 0.5 + 0.01 // primeiro pulso
    renderPill({ transition: counting(12) })
    expect(dots()).toEqual(['true', 'false', 'false', 'false'])
    heard = 22 - 6 * 0.5 + 0.01 // sétimo pulso: começo do terceiro tempo
    frame()
    expect(dots()).toEqual(['true', 'true', 'true', 'false'])
  })
  it('lugar das bolinhas e do texto de espera reservado com a mesma largura fixa desde o primeiro quadro', () => {
    heard = 10
    renderPill({ transition: { ...counting(7), barsLeft: 3 } })
    const slot = pill().querySelector('[data-count-slot]') as HTMLElement
    expect(slot.className).toMatch(/(^|\s)w-\[76px\]/)
    expect(slot.contains(waitText())).toBe(true)
    expect(slot.contains(pill().querySelector('[data-dots]'))).toBe(true)
    // Os dois na mesma célula e nenhum sai do layout ao trocar (invisible, nunca hidden).
    for (const el of [waitText(), pill().querySelector('[data-dots]') as HTMLElement]) {
      expect(el.className).toContain('[grid-area:1/1]')
      expect(el.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    }
    heard = 22 - 7 * 0.5 + 0.01
    frame()
    expect(pill().getAttribute('data-waiting')).toBe('false')
    expect(pill().querySelector('[data-count-slot]')).toBe(slot)
  })
  it('nome em 16 px até 2 linhas, sem reticências; mais que isso desce pra 14 px, sem cortar', () => {
    // O jsdom não mede: a altura do nome vem de uma régua falsa (14 caracteres por linha a 16 px, 20 a 14 px).
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-pill-name')) return 0
        const small = this.dataset.fit === 'small'
        const perLine = small ? 20 : 14
        return Math.ceil((this.textContent ?? '').length / perLine) * (small ? 14 : 16) * 1.1
      },
    })
    try {
      renderPill()
      expect(pillName().className).toContain('text-ps-md')
      expect(pillName().className).not.toMatch(/whitespace-nowrap|truncate|text-ellipsis/)
      expect(pillName().dataset.fit).toBeUndefined()
      cleanup()
      const longo = [...SECTIONS.slice(0, 2), { ...SECTIONS[2], label: 'Ponte Instrumental Final de Novo' }] // 32 car.: 3 linhas a 16 px, 2 a 14 px
      render(<NextPill transition={T} intent={{ target: 2, plays: 1 }} sections={longo} currentSection={1} gridWarning={null} clock={clock} onCancel={() => {}} />)
      expect(pillName().dataset.fit).toBe('small')
      expect(pillName().className).toContain('data-[fit=small]:text-[14px]')
      expect(pillName().textContent).toBe('Ponte Instrumental Final de Novo')
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc)
    }
  })
  it('o aviso encolhe dentro da coluna: max-w-full e min-w-0, sem shrink-0', () => {
    renderPill()
    for (const c of ['max-w-full', 'min-w-0']) expect(pill().className).toContain(c)
    expect(pill().className).not.toContain('shrink-0')
    expect((pillName().parentElement as HTMLElement).className).toContain('min-w-0')
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
    fireEvent.click(btn('Pré-contagem'))
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
  it('COMEÇO parado volta direto pro 0:00 com um toque (Ruling I3-comeco)', () => {
    const a = actions()
    render(<TransportBar view={view({ isPlaying: false })} actions={a} clock={clock} pulse={null} />)
    expect(btn('COMEÇO').getAttribute('title')).toBe('Volta a VS pro 0:00')
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).toHaveBeenCalledTimes(1)
  })

  it('COMEÇO tocando com seções arma o começo como um pulo: um toque, cancelável como uma seção armada', () => {
    const a = actions()
    render(<TransportBar view={view({ isPlaying: true })} actions={a} clock={clock} pulse={null} />)
    expect(btn('COMEÇO').getAttribute('title')).toBe('Arma a volta pro começo: a seção termina, conta e entra no 1 da primeira seção. Toque de novo, no X do aviso ou Esc cancela.')
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).toHaveBeenCalledTimes(1)
  })

  it('COMEÇO tocando sem seções (ou no Livre) pede o segundo toque pra voltar pro 0:00', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const a = actions()
    const { rerender } = render(<TransportBar view={view({ sections: [], currentSection: -1 })} actions={a} clock={clock} pulse={null} />)
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).not.toHaveBeenCalled()
    const armed = btn('Toque de novo pra voltar a VS pro 0:00')
    expect(armed.getAttribute('data-armed')).toBe('true')
    fireEvent.click(armed) // toque que quica (menos de 350 ms): não confirma
    expect(a.goToStart).not.toHaveBeenCalled()
    now.mockReturnValue(1500)
    fireEvent.click(armed)
    expect(a.goToStart).toHaveBeenCalledTimes(1)
    expect(btn('COMEÇO').getAttribute('data-armed')).toBe('false')
    // No Livre a música tem seções mas o plano não arma: também pede o segundo toque.
    const livre = { sections: false, infinite: false, maxRepeats: 1, bandSections: false }
    rerender(<TransportBar view={view({ gates: livre })} actions={a} clock={clock} pulse={null} />)
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).toHaveBeenCalledTimes(1)
    expect(btn('Toque de novo pra voltar a VS pro 0:00')).toBeTruthy()
    // A música parou com o COMEÇO armado: desarma, e o toque parado volta direto.
    rerender(<TransportBar view={view({ gates: livre, isPlaying: false })} actions={a} clock={clock} pulse={null} />)
    fireEvent.click(btn('COMEÇO'))
    expect(a.goToStart).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('COMEÇO armado não muda de largura (o Play ao lado não anda): os dois rótulos ocupam o mesmo lugar', () => {
    render(<TransportBar view={view({ sections: [], currentSection: -1 })} actions={actions()} clock={clock} pulse={null} />)
    const b = btn('COMEÇO')
    const labels = [...b.querySelectorAll('[data-start-label]')]
    expect(labels.map((l) => l.textContent)).toEqual(['COMEÇO', 'VOLTAR?'])
    expect(labels.map((l) => l.getAttribute('aria-hidden'))).toEqual([null, 'true'])
    expect(labels.every((l) => l.className.includes('[grid-area:1/1]'))).toBe(true)
    fireEvent.click(b)
    expect(labels.map((l) => l.getAttribute('aria-hidden'))).toEqual(['true', null])
  })

  it('pontos do tour no palco novo', () => {
    const { container } = render(<TransportBar view={view()} actions={actions()} clock={clock} pulse={null} />)
    const tour = (k: string) => container.querySelector(`[data-tour="${k}"]`)
    expect(tour('play')).toBe(btn('Pausar'))
    expect(tour('metronomo')).toBe(btn('Metrônomo'))
    expect(tour('modos')!.contains(screen.getByRole('radiogroup', { name: 'Fim da música' }))).toBe(true)
    expect(tour('precontagem')!.contains(btn('Pré-contagem'))).toBe(true)
    expect(tour('precontagem')!.contains(btn(/Tempos da pré-contagem/))).toBe(true)
  })
  it('LOOP aceso com o loop infinito da atual; CLICK e PRÉ-CONT. acesos pelo estado', () => {
    const { rerender } = render(<TransportBar view={view({ intent: { target: 1, plays: 'infinite' }, transition: SELF_LOOP })} actions={actions()} clock={clock} pulse={null} />)
    expect(btn('LOOP').getAttribute('aria-pressed')).toBe('true')
    expect(btn('LOOP').className).toContain('text-ps-or')
    expect(btn('CLICK').getAttribute('aria-pressed')).toBe('true')
    expect(btn('Pré-contagem').getAttribute('aria-pressed')).toBe('true')
    expect(btn(/Tempos da pré-contagem/).textContent).toBe('4')
    rerender(<TransportBar view={view({ intent: { target: 1, plays: 3 }, click: { channelId: 'c1', on: false }, precount: { enabled: false, beats: 2, times: [] } })} actions={actions()} clock={clock} pulse={null} />)
    expect(btn('LOOP').getAttribute('aria-pressed')).toBe('false')
    expect(btn('LOOP').className).not.toContain('text-ps-or')
    expect(btn('CLICK').getAttribute('aria-pressed')).toBe('false')
    expect(btn('Pré-contagem').getAttribute('aria-pressed')).toBe('false')
    expect(btn(/Tempos da pré-contagem/).textContent).toBe('2')
    expect(btn(/Tempos da pré-contagem/).className).toContain('text-ps-dim')
  })
  it('ao cancelar o pulo o foco vai pro Play, nunca pro body', () => {
    const a = actions()
    const armed = view({ intent: { target: 2, plays: 1 }, transition: T })
    const { rerender } = render(<TransportBar view={armed} actions={a} clock={clock} pulse={null} />)
    const x = btn('Cancelar pulo')
    x.focus()
    expect(document.activeElement).toBe(x)
    fireEvent.click(x)
    expect(a.cancelArm).toHaveBeenCalledTimes(1)
    rerender(<TransportBar view={view()} actions={a} clock={clock} pulse={null} />)
    expect(document.activeElement).toBe(btn('Pausar'))
    // Pousou com o foco no X (o pulo aconteceu): mesma coisa.
    rerender(<TransportBar view={armed} actions={a} clock={clock} pulse={null} />)
    btn('Cancelar pulo').focus()
    rerender(<TransportBar view={view({ currentSection: 2 })} actions={a} clock={clock} pulse={null} />)
    expect(document.activeElement).toBe(btn('Pausar'))
  })
  it('coluna do aviso com largura própria a partir de 1280 e linha da altura do transporte (o centro não anda)', () => {
    render(<TransportBar view={view()} actions={actions()} clock={clock} pulse={null} />)
    const bar = screen.getByRole('region', { name: 'Transporte' })
    // Mínimo fixo (não depende do conteúdo do aviso): o centro fica no mesmo lugar o tempo todo.
    expect(bar.className).toContain('xl:grid-cols-[minmax(0,1fr)_auto_minmax(328px,1fr)]')
    // Nada mais alto que o transporte aumenta a linha da grade e empurra o centro pra baixo.
    expect(bar.className).toContain('grid-rows-[minmax(0,1fr)]')
  })
  // Ruling T18-1024: em 1024 o FADE não fica atrás do COMEÇO e o PRÓXIMA armado tem largura de verdade.
  it('abaixo de 1280: fim da música e centro com a largura do conteúdo, e o aviso fica com o resto (nada se cobre)', () => {
    render(<TransportBar view={view({ intent: { target: 2, plays: 1 }, transition: T })} actions={actions()} clock={clock} pulse={null} />)
    const bar = screen.getByRole('region', { name: 'Transporte' })
    // As duas primeiras colunas não encolhem abaixo do conteúdo; a do aviso não depende dele (o centro não anda).
    expect(bar.className).toContain('max-xl:grid-cols-[auto_auto_minmax(0,1fr)]')
    expect(bar.className).toContain('max-xl:gap-x-2.5')
    // Centro mais justo: botões pelo texto com 8 px de folga (piso de 56), SEÇÃO com dois alvos de 48.
    for (const n of ['COMEÇO', 'LOOP', 'CLICK', 'Pré-contagem']) {
      expect(btn(n).className).toContain('max-xl:min-w-[56px]')
      expect(btn(n).className).toContain('max-xl:px-2')
    }
    for (const n of ['Armar seção anterior', 'Armar seção seguinte']) expect(btn(n).className).toContain('max-xl:min-w-[48px]')
    expect(btn('COMEÇO').parentElement!.className).toContain('max-xl:gap-1.5')
    // Fim da música: opções com 8 px de folga e alvo de 44.
    const seg = screen.getByRole('radiogroup', { name: 'Fim da música' })
    expect(seg.className).toContain('max-xl:[&>button]:min-w-ps-touch')
    expect(seg.className).toContain('max-xl:[&>button]:px-2')
  })
  it('rótulo "Fim da música" sem altura de linha sobrando (não encosta na borda de baixo)', () => {
    render(<TransportBar view={view()} actions={actions()} clock={clock} pulse={null} />)
    expect(screen.getByText('Fim da música').className).toContain('leading-none')
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
