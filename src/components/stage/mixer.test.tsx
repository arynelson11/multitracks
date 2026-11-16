// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FAMILY_COLOR, channelFamily, resolveChannelRole } from '../../lib/channelNames'
import { channelFaderFill } from '../../lib/channelRoles'
import { FADER_MAX_GAIN, dragPan, faderToGain } from '../../lib/faderScale'
import type { OutputMode, OutputPlan, StageActions, StageChannel, StageClock, TransitionView } from '../../lib/stageContracts'
import { StageMixer } from './StageMixer'
import type { StageMixerProps } from './StageMixer'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i
const NO_PAN = 'Com Click e Guia separados o pan não decide a saída'

// requestAnimationFrame falso: guarda os pedidos e solta um quadro por vez.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
const frame = (t: number) => {
  const due = [...pending.values()]
  pending = new Map()
  act(() => { for (const cb of due) cb(t) })
}

let heard = 0
let levels: Record<string, number> = {}
let masterLv = { l: 0, r: 0 }
const clock: StageClock = { heardNow: () => heard, position: () => 0, level: (id) => levels[id] ?? 0, masterLevels: () => masterLv }

beforeEach(() => {
  pending = new Map()
  nextId = 1
  heard = 0
  levels = {}
  masterLv = { l: 0, r: 0 }
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
  vi.useRealTimers()
})

// Canal como o App monta: rótulo e papel pela regra central, cor do grupo pela FAMILY_COLOR.
function stageChannel(id: string, name: string, patch: Partial<StageChannel> = {}): StageChannel {
  const identity = { id, name }
  return {
    id, label: name, color: FAMILY_COLOR[channelFamily(identity)], role: resolveChannelRole(identity),
    volume: 1, muted: false, soloed: false, pan: 0, silenced: false, ...patch,
  }
}
const CHANNELS: StageChannel[] = [
  stageChannel('c1', 'Click'),
  stageChannel('g1', 'Guia'),
  stageChannel('d1', 'Bateria'),
  stageChannel('b1', 'Baixo'),
  stageChannel('v1', 'Violão Base Esquerdo 2'),
]

const plan = (mode: OutputMode): OutputPlan => ({
  mode, channels: mode === 'multi' ? 4 : 2, vs: [0, 1], click: mode === 'multi' ? [2] : [0], guide: mode === 'multi' ? [3] : [0],
  panByRole: mode !== 'stereo', fellBackFrom: null,
})
const view = (patch: Partial<StageMixerProps['view']> = {}): StageMixerProps['view'] => ({
  channels: CHANNELS, channelEditMode: false, outputs: plan('stereo'), click: { channelId: 'c1', on: true },
  transition: null, master: { volume: 1, muted: false }, ...patch,
})

// Todas as ações viram vi.fn() na primeira leitura.
function makeActions(): StageActions {
  const fns = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  return new Proxy({}, {
    get: (_t, key) => {
      let fn = fns.get(key)
      if (!fn) {
        fn = vi.fn()
        fns.set(key, fn)
      }
      return fn
    },
  }) as StageActions
}

function renderMixer(v: StageMixerProps['view'] = view(), actions: StageActions = makeActions()) {
  const r = render(<StageMixer view={v} actions={actions} clock={clock} />)
  return { ...r, actions, rerenderWith: (next: StageMixerProps['view']) => r.rerender(<StageMixer view={next} actions={actions} clock={clock} />) }
}

const pointer = (el: Element, type: string, init: MouseEventInit = {}) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
// O jsdom não tem PointerEvent: MouseEvent com o pointerId posto à mão (dois dedos).
const finger = (el: Element, type: string, pointerId: number, init: MouseEventInit = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(ev, 'pointerId', { value: pointerId })
  return fireEvent(el, ev)
}
const dbOf = (g: number) => 20 * Math.log10(g)
const strip = (label: string) => screen.getByRole('group', { name: `Canal ${label}` })
const fader = (label: string) => screen.getByRole('slider', { name: `Volume ${label}` })
const panOf = (label: string) => screen.getByRole('slider', { name: `Pan ${label}` })
const masterStrip = () => screen.getByRole('group', { name: 'PRINCIPAL' })
const balloonOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-db]')!
const rect = (left: number, width: number) => ({ left, width, top: 0, height: 200, right: left + width, bottom: 200, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

// Pulo armado com contagem de 4 no último compasso (passo 0,5 s), troca em 22 s.
const COUNT: TransitionView = {
  from: 1, to: 2, kind: 'proxima', plays: 1, switchAt: 22, countTimes: [20, 20.5, 21, 21.5], countLabels: [1, 2, 3, 4],
  countTotal: 4, barsLeft: 1, committed: true, clickAudible: true, hasGrid: true,
}

describe('fader', () => {
  it('toque no fader não muda o volume; arrastar muda; duplo clique volta a 0 dB', () => {
    const { actions } = renderMixer()
    const fd = fader('Bateria')
    expect(fd.getAttribute('aria-valuetext')).toBe('0.0 dB')

    // Toque e toque com o dedo tremendo (2 px): nada muda.
    pointer(fd, 'pointerdown', { clientY: 200 })
    pointer(fd, 'pointerup', { clientY: 200 })
    fireEvent.click(fd)
    pointer(fd, 'pointerdown', { clientY: 200 })
    pointer(fd, 'pointermove', { clientY: 198 })
    pointer(fd, 'pointerup', { clientY: 198 })
    expect(actions.setVolume).not.toHaveBeenCalled()
    expect(fd.dataset.dragging).toBe('false')

    // Arrastar 10 px pra cima: sem medida no jsdom o curso vale 40 px, então +0,25 no fader (0 dB até +6 dB).
    pointer(fd, 'pointerdown', { clientY: 200 })
    pointer(fd, 'pointermove', { clientY: 190 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', faderToGain(1))
    expect(fd.dataset.dragging).toBe('true')
    expect(balloonOf(fd).textContent).toBe('+6.0 dB')
    pointer(fd, 'pointermove', { clientY: 210 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', faderToGain(0.5))
    expect(balloonOf(fd).textContent).toBe('−7.0 dB') // fader em 0,5: 40 x log10(0,5 / 0,75)
    pointer(fd, 'pointerup', { clientY: 210 })
    expect(fd.dataset.dragging).toBe('false')
    const calls = vi.mocked(actions.setVolume).mock.calls.length
    pointer(fd, 'pointermove', { clientY: 100 }) // depois de soltar não arrasta mais
    expect(actions.setVolume).toHaveBeenCalledTimes(calls)

    fireEvent.doubleClick(fd)
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', 1)
  })

  it('arrasto cancelado pelo navegador (rolagem de lado no toque) para de mexer', () => {
    const { actions } = renderMixer()
    const fd = fader('Baixo')
    pointer(fd, 'pointerdown', { clientY: 200 })
    pointer(fd, 'pointercancel', { clientY: 200 })
    pointer(fd, 'pointermove', { clientY: 150 })
    expect(actions.setVolume).not.toHaveBeenCalled()
    expect(fd.className).toContain('touch-pan-x')
  })

  it('a tampa e o valor acessível seguem o ganho do canal', () => {
    renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { volume: 0.5 })] }))
    const fd = fader('Bateria')
    expect(fd.getAttribute('aria-valuetext')).toBe('−6.0 dB')
    expect(Number(fd.style.getPropertyValue('--f'))).toBeCloseTo(0.75 * 10 ** (20 * Math.log10(0.5) / 40), 3)
  })
})

describe('pan', () => {
  it('duplo clique no pan centraliza', () => {
    const { actions } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0.5 })] }))
    const pan = panOf('Bateria')
    expect(pan.getAttribute('aria-valuetext')).toBe('R50')
    expect(pan.textContent).toBe('R50')
    fireEvent.doubleClick(pan)
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', 0)
  })

  it('arrasta na vertical; toque sem arrastar não mexe', () => {
    const { actions } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0.5 })] }))
    const pan = panOf('Bateria')
    pointer(pan, 'pointerdown', { clientY: 100 })
    pointer(pan, 'pointermove', { clientY: 99 })
    pointer(pan, 'pointerup', { clientY: 99 })
    expect(actions.setPan).not.toHaveBeenCalled()
    pointer(pan, 'pointerdown', { clientY: 100 })
    pointer(pan, 'pointermove', { clientY: 90 })
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', dragPan(0.5, 10))
    expect(pan.textContent).toBe('R64')
    pointer(pan, 'pointerup', { clientY: 90 })
  })

  it('arco na cor do grupo e centro marcado', () => {
    renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: -0.5 })] }))
    const pan = panOf('Bateria')
    expect(pan.querySelector('[data-knob-value]')).not.toBeNull()
    expect(pan.querySelector('[data-knob-center]')).not.toBeNull()
    expect(strip('Bateria').style.getPropertyValue('--c')).toBe(FAMILY_COLOR.bateria)
    // No centro não há arco de valor.
    cleanup()
    renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0 })] }))
    expect(panOf('Bateria').querySelector('[data-knob-value]')).toBeNull()
    expect(panOf('Bateria').textContent).toBe('C')
  })

  it('pan travado com Click e Guia separados', () => {
    const { actions, rerenderWith } = renderMixer(view({ outputs: plan('split2') }))
    for (const ch of CHANNELS) {
      const pan = panOf(ch.label)
      expect(pan.getAttribute('aria-disabled')).toBe('true')
      expect(pan.getAttribute('title')).toBe(NO_PAN)
      pointer(pan, 'pointerdown', { clientY: 100 })
      pointer(pan, 'pointermove', { clientY: 50 })
      pointer(pan, 'pointerup', { clientY: 50 })
      fireEvent.doubleClick(pan)
    }
    expect(actions.setPan).not.toHaveBeenCalled()

    // 4 ou mais saídas: só Click e Guia ficam travados.
    rerenderWith(view({ outputs: plan('multi') }))
    expect(panOf('Click').getAttribute('aria-disabled')).toBe('true')
    expect(panOf('Guia').getAttribute('aria-disabled')).toBe('true')
    expect(panOf('Guia').getAttribute('title')).toBe(NO_PAN)
    for (const label of ['Bateria', 'Baixo', 'Violão Base Esquerdo 2']) {
      expect(panOf(label).getAttribute('aria-disabled')).toBeNull()
      expect(panOf(label).getAttribute('title')).not.toBe(NO_PAN)
    }
    fireEvent.doubleClick(panOf('Bateria'))
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', 0)

    rerenderWith(view({ outputs: plan('stereo') }))
    for (const ch of CHANNELS) expect(panOf(ch.label).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('gesto (Ruling T14-gesto)', () => {
  it('arrasto de lado não muda o volume nem o pan: o gesto fica com a rolagem', () => {
    const { actions } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0.5 })] }))
    for (const el of [fader('Bateria'), panOf('Bateria')]) {
      pointer(el, 'pointerdown', { clientX: 100, clientY: 200 })
      pointer(el, 'pointermove', { clientX: 120, clientY: 196 }) // 20 px de lado, 4 na vertical: rolagem
      pointer(el, 'pointermove', { clientX: 122, clientY: 150 }) // depois disso nem a vertical vale
      pointer(el, 'pointerup', { clientX: 122, clientY: 150 })
      expect(el.className).toContain('touch-pan-x')
    }
    // Empate (5 de cada lado) também fica com a rolagem.
    pointer(fader('Bateria'), 'pointerdown', { clientX: 100, clientY: 200 })
    pointer(fader('Bateria'), 'pointermove', { clientX: 105, clientY: 195 })
    pointer(fader('Bateria'), 'pointermove', { clientX: 105, clientY: 150 })
    expect(actions.setVolume).not.toHaveBeenCalled()
    expect(actions.setPan).not.toHaveBeenCalled()
  })

  it('arrasto vertical com um pouco de lado muda', () => {
    const { actions } = renderMixer()
    const fd = fader('Bateria')
    pointer(fd, 'pointerdown', { clientX: 100, clientY: 200 })
    pointer(fd, 'pointermove', { clientX: 102, clientY: 190 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', faderToGain(1))
    pointer(fd, 'pointermove', { clientX: 140, clientY: 190 }) // já arrastando: o lado não interrompe
    pointer(fd, 'pointermove', { clientX: 140, clientY: 210 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', faderToGain(0.5))
  })

  it('cancelamento do navegador devolve o valor de antes do gesto', () => {
    const before = view({ channels: [stageChannel('d1', 'Bateria', { volume: 0.5, pan: 0.5 })] })
    const { actions, rerenderWith } = renderMixer(before)
    pointer(fader('Bateria'), 'pointerdown', { clientX: 100, clientY: 200 })
    pointer(fader('Bateria'), 'pointermove', { clientX: 100, clientY: 190 })
    expect(actions.setVolume).toHaveBeenCalledTimes(1)
    // O App já aplicou o valor do arrasto (o ganho do canal mudou na view) antes do cancelamento.
    const moved = vi.mocked(actions.setVolume).mock.lastCall![1]
    rerenderWith(view({ channels: [stageChannel('d1', 'Bateria', { volume: moved, pan: 0.5 })] }))
    pointer(fader('Bateria'), 'pointercancel', { clientX: 100, clientY: 190 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', 0.5)
    expect(fader('Bateria').dataset.dragging).toBe('false')
    pointer(fader('Bateria'), 'lostpointercapture')
    expect(actions.setVolume).toHaveBeenCalledTimes(2) // a captura perdida depois do cancelamento não devolve de novo

    rerenderWith(before)
    pointer(panOf('Bateria'), 'pointerdown', { clientX: 100, clientY: 100 })
    pointer(panOf('Bateria'), 'pointermove', { clientX: 100, clientY: 90 })
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', dragPan(0.5, 10))
    rerenderWith(view({ channels: [stageChannel('d1', 'Bateria', { volume: 0.5, pan: dragPan(0.5, 10) })] }))
    pointer(panOf('Bateria'), 'pointercancel', { clientX: 100, clientY: 90 })
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', 0.5)
    expect(actions.setPan).toHaveBeenCalledTimes(2)
  })

  it('dois dedos: soltar um não encerra o arrasto do outro; dois faders andam juntos', () => {
    const { actions } = renderMixer()
    const fd = fader('Bateria')
    finger(fd, 'pointerdown', 1, { clientY: 200 })
    finger(fd, 'pointerdown', 2, { clientY: 200 }) // o segundo dedo assume o fader
    finger(fd, 'pointerup', 1, { clientY: 200 })
    finger(fd, 'pointermove', 2, { clientY: 190 })
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', faderToGain(1))
    finger(fd, 'pointerup', 2, { clientY: 190 })

    finger(fader('Baixo'), 'pointerdown', 3, { clientY: 200 })
    finger(fader('Guia'), 'pointerdown', 4, { clientY: 200 })
    finger(fader('Baixo'), 'pointermove', 3, { clientY: 190 })
    finger(fader('Guia'), 'pointermove', 4, { clientY: 210 })
    expect(actions.setVolume).toHaveBeenCalledWith('b1', faderToGain(1))
    expect(actions.setVolume).toHaveBeenCalledWith('g1', faderToGain(0.5))
  })
})

describe('teclado (Ruling T14-teclado)', () => {
  it('fader, PRINCIPAL e pan pegam foco pelo Tab; pan travado não', () => {
    const { rerenderWith } = renderMixer()
    for (const el of [fader('Bateria'), fader('principal'), panOf('Bateria')]) {
      expect(el.tabIndex).toBe(0)
      el.focus()
      expect(document.activeElement).toBe(el)
      expect(el.className).toContain('focus-visible:outline-ps-or')
    }
    // Ordem do Tab dentro do canal: pan, fader, M, S.
    const s = strip('Bateria')
    const order = [...s.querySelectorAll<HTMLElement>('[tabindex="0"], button')]
    expect(order.map((e) => e.getAttribute('aria-label') ?? e.textContent)).toEqual(['Pan Bateria', 'Volume Bateria', 'M', 'S'])
    rerenderWith(view({ outputs: plan('split2') }))
    expect(panOf('Bateria').hasAttribute('tabindex')).toBe(false)
  })

  it('setas ±1 dB, PageUp e PageDown ±6 dB, Home e End no mínimo e no máximo', () => {
    const { actions } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria'), stageChannel('b1', 'Baixo', { volume: 0.5 })] }))
    const fd = fader('Bateria')
    const press = (key: string) => fireEvent.keyDown(fd, { key })
    press('ArrowUp')
    expect(dbOf(vi.mocked(actions.setVolume).mock.lastCall![1])).toBeCloseTo(1, 9)
    press('ArrowDown')
    expect(dbOf(vi.mocked(actions.setVolume).mock.lastCall![1])).toBeCloseTo(-1, 9)
    press('PageUp')
    expect(dbOf(vi.mocked(actions.setVolume).mock.lastCall![1])).toBeCloseTo(6, 9)
    press('PageDown')
    expect(dbOf(vi.mocked(actions.setVolume).mock.lastCall![1])).toBeCloseTo(-6, 9)
    press('Home')
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', 0)
    press('End')
    expect(actions.setVolume).toHaveBeenLastCalledWith('d1', FADER_MAX_GAIN)
    expect(vi.mocked(actions.setVolume).mock.calls.every(([id]) => id === 'd1')).toBe(true)
    // Do -6,02 dB do Baixo, a seta pra cima dá -5,0 dB.
    fireEvent.keyDown(fader('Baixo'), { key: 'ArrowUp' })
    expect(vi.mocked(actions.setVolume).mock.lastCall![0]).toBe('b1')
    expect(dbOf(vi.mocked(actions.setVolume).mock.lastCall![1])).toBeCloseTo(-5, 9)

    fireEvent.keyDown(fader('principal'), { key: 'ArrowUp' })
    expect(dbOf(vi.mocked(actions.setMasterVolume).mock.lastCall![0])).toBeCloseTo(1, 9)
    fireEvent.keyDown(fader('principal'), { key: 'Home' })
    expect(actions.setMasterVolume).toHaveBeenLastCalledWith(0)
  })

  it('valor acessível em dB (valuenow, valuetext, mínimo e máximo)', () => {
    renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { volume: 0.5 }), stageChannel('b1', 'Baixo', { volume: 0 })] }))
    const fd = fader('Bateria')
    expect(fd.getAttribute('aria-valuemin')).toBe('-63')
    expect(fd.getAttribute('aria-valuemax')).toBe('6')
    expect(fd.getAttribute('aria-valuenow')).toBe('-6')
    expect(fd.getAttribute('aria-valuetext')).toBe('−6.0 dB')
    expect(fader('Baixo').getAttribute('aria-valuenow')).toBe('-63')
    expect(fader('Baixo').getAttribute('aria-valuetext')).toBe('−∞ dB')
    expect(fader('principal').getAttribute('aria-valuenow')).toBe('0')
  })

  it('pan: setas pra esquerda e pra direita; travado ignora', () => {
    const { actions, rerenderWith } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0.5 })] }))
    fireEvent.keyDown(panOf('Bateria'), { key: 'ArrowRight' })
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', 0.55)
    fireEvent.keyDown(panOf('Bateria'), { key: 'ArrowLeft' })
    expect(actions.setPan).toHaveBeenLastCalledWith('d1', 0.45)
    rerenderWith(view({ channels: [stageChannel('d1', 'Bateria', { pan: 0.5 })], outputs: plan('split2') }))
    fireEvent.keyDown(panOf('Bateria'), { key: 'ArrowRight' })
    expect(actions.setPan).toHaveBeenCalledTimes(2)
  })

  it('a seta com foco no fader ou no pan não chega no atalho global de buscar na música', () => {
    renderMixer()
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    try {
      for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
        const ev = fireEvent.keyDown(fader('Bateria'), { key })
        expect(ev, key).toBe(false) // preventDefault: a página não rola
        fireEvent.keyDown(fader('principal'), { key })
      }
      fireEvent.keyDown(panOf('Bateria'), { key: 'ArrowLeft', code: 'ArrowLeft' })
      fireEvent.keyDown(panOf('Bateria'), { key: 'ArrowRight', code: 'ArrowRight' })
      expect(onWindowKey).not.toHaveBeenCalled()
      // Tecla que o controle não trata (Espaço = tocar) continua chegando no atalho.
      fireEvent.keyDown(fader('Bateria'), { key: ' ', code: 'Space' })
      expect(onWindowKey).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })
})

describe('M e S', () => {
  it('M e S marcados como exceção de toque', () => {
    renderMixer()
    const ms = screen.getAllByRole('button', { name: /^(M|S)$/ })
    expect(ms).toHaveLength(CHANNELS.length * 2)
    for (const b of ms) expect(b.dataset.touchException).toBe('ms')
  })

  it('M e S chamam o canal certo e acendem pelo estado', () => {
    const { actions } = renderMixer(view({ channels: [stageChannel('d1', 'Bateria', { muted: true }), stageChannel('b1', 'Baixo', { soloed: true })] }))
    const m = within(strip('Bateria')).getByRole('button', { name: 'M' })
    const s = within(strip('Baixo')).getByRole('button', { name: 'S' })
    expect(m.getAttribute('aria-pressed')).toBe('true')
    expect(s.getAttribute('aria-pressed')).toBe('true')
    expect(within(strip('Baixo')).getByRole('button', { name: 'M' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(m)
    expect(actions.toggleMute).toHaveBeenCalledWith('d1')
    fireEvent.click(s)
    expect(actions.toggleSolo).toHaveBeenCalledWith('b1')
    expect(m.getAttribute('title')).toBe('Mudo')
    expect(s.getAttribute('title')).toBe('Solo')
  })

  it('cor do grupo na tampa e na faixa; calado (M ou Solo de outro) fica cinza e apagado, nunca vermelho', () => {
    renderMixer(view({
      channels: [
        stageChannel('d1', 'Bateria', { muted: true }),
        stageChannel('b1', 'Baixo', { silenced: true }),
        stageChannel('v1', 'Violão', { soloed: true }),
      ],
    }))
    // Cinza neutro da Parte 1, o mesmo pra todo grupo: nem vermelho nem a cor do grupo.
    const gray = channelFaderFill(FAMILY_COLOR.bateria, true)
    expect(gray).toBe('linear-gradient(to top, rgba(255,255,255,0.12), rgba(255,255,255,0.04))')
    for (const label of ['Bateria', 'Baixo']) {
      const fd = fader(label)
      expect(fd.style.getPropertyValue('--fill')).toBe(gray)
      expect(fd.dataset.quiet).toBe('true')
      expect(strip(label).dataset.quiet).toBe('true')
    }
    const violao = fader('Violão')
    expect(violao.style.getPropertyValue('--fill')).toBe(channelFaderFill(FAMILY_COLOR.violao, false))
    expect(violao.dataset.quiet).toBe('false')
    expect(strip('Violão').style.getPropertyValue('--c')).toBe(FAMILY_COLOR.violao)
  })
})

describe('nível no trilho', () => {
  it('acende dentro do trilho pelo relógio, com marca de pico que segura e desce', () => {
    levels = { d1: 0.5 }
    renderMixer()
    const fd = fader('Bateria')
    const vu = fd.querySelector<HTMLElement>('[data-vu]')!
    const pk = fd.querySelector<HTMLElement>('[data-peak]')!
    expect(fd.querySelector('[data-rail]')!.contains(vu)).toBe(true)
    frame(100)
    const v1 = 0.5 * 0.85
    expect(vu.style.getPropertyValue('--v')).toBe(v1.toFixed(3))
    expect(pk.style.getPropertyValue('--pk')).toBe(v1.toFixed(3))
    levels.d1 = 0
    frame(200)
    const v2 = v1 + (0 - v1) * 0.25
    expect(vu.style.getPropertyValue('--v')).toBe(v2.toFixed(3))
    expect(pk.style.getPropertyValue('--pk')).toBe(v1.toFixed(3)) // o pico segura
    frame(220) // menos de 45 ms: não mexe
    expect(vu.style.getPropertyValue('--v')).toBe(v2.toFixed(3))
    frame(1000) // passou de 700 ms: o pico desce 0,02 por passo
    const v3 = v2 + (0 - v2) * 0.25
    expect(vu.style.getPropertyValue('--v')).toBe(v3.toFixed(3))
    expect(pk.style.getPropertyValue('--pk')).toBe((v1 - 0.02).toFixed(3))
  })

  it('PRINCIPAL mede L e R separados', () => {
    masterLv = { l: 0.8, r: 0.2 }
    renderMixer()
    const fd = fader('principal')
    const [l, r] = [...fd.querySelectorAll<HTMLElement>('[data-vu]')]
    frame(100)
    expect(l.dataset.vu).toBe('l')
    expect(r.dataset.vu).toBe('r')
    expect(l.style.getPropertyValue('--v')).toBe((0.8 * 0.85).toFixed(3))
    expect(r.style.getPropertyValue('--v')).toBe((0.2 * 0.85).toFixed(3))
    expect(fd.querySelectorAll('[data-peak]')).toHaveLength(2)
  })

  it('marca de 0 dB em 3/4 do curso', () => {
    renderMixer()
    expect(fader('Bateria').querySelector('[data-zero]')).not.toBeNull()
    expect(fader('principal').querySelector('[data-zero]')).not.toBeNull()
  })
})

describe('balão da contagem', () => {
  it('balão da contagem só no canal de click', () => {
    heard = 20.6
    const { rerenderWith } = renderMixer(view({ transition: COUNT }))
    const balloon = strip('Click').querySelector<HTMLElement>('[data-count]')!
    expect(balloon.getAttribute('aria-hidden')).toBe('true')
    expect(balloon.dataset.on).toBe('true')
    expect(balloon.textContent).toBe('2')
    for (const label of ['Guia', 'Bateria', 'Baixo', 'Violão Base Esquerdo 2']) expect(strip(label).querySelector('[data-count]')).toBeNull()

    heard = 21.2
    frame(16)
    expect(balloon.textContent).toBe('3')
    heard = 22 // o 1 do destino: a contagem acabou
    frame(32)
    expect(balloon.dataset.on).toBe('false')
    expect(balloon.textContent).toBe('')

    // Click mudo ou contagem que não vai ser ouvida: sem balão.
    heard = 21.2
    rerenderWith(view({ transition: COUNT, channels: CHANNELS.map((c) => (c.id === 'c1' ? { ...c, muted: true } : c)) }))
    expect(strip('Click').querySelector<HTMLElement>('[data-count]')!.dataset.on).toBe('false')
    rerenderWith(view({ transition: { ...COUNT, clickAudible: false } }))
    expect(strip('Click').querySelector<HTMLElement>('[data-count]')!.dataset.on).toBe('false')
    rerenderWith(view({ transition: COUNT, click: { channelId: 'd1', on: true } }))
    expect(strip('Click').querySelector('[data-count]')).toBeNull()
    expect(strip('Bateria').querySelector<HTMLElement>('[data-count]')!.textContent).toBe('3')
  })
})

describe('EDITAR CANAIS', () => {
  it('modo EDITAR CANAIS mostra lápis, alça e lixeira de 2 toques', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { actions, rerenderWith } = renderMixer()
    expect(screen.queryByRole('button', { name: /^Renomear/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Mover/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Apagar o canal/ })).toBeNull()

    rerenderWith(view({ channelEditMode: true }))
    for (const ch of CHANNELS) {
      const s = strip(ch.label)
      within(s).getByRole('button', { name: `Renomear e escolher papel de ${ch.label}` })
      within(s).getByRole('button', { name: `Mover ${ch.label}` })
      within(s).getByRole('button', { name: `Apagar o canal ${ch.label}` })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Renomear e escolher papel de Baixo' }))
    expect(actions.openChannelEdit).toHaveBeenCalledWith('b1')

    const trash = (label: string) => within(strip(label)).getByRole('button', { name: new RegExp(`canal ${label}$`) })
    fireEvent.click(trash('Bateria'))
    expect(actions.removeChannel).not.toHaveBeenCalled()
    expect(trash('Bateria').textContent).toBe('Apagar?')
    // Armar outra desarma a primeira: uma lixeira armada por vez.
    fireEvent.click(trash('Baixo'))
    expect(trash('Bateria').textContent).toBe('')
    expect(trash('Baixo').textContent).toBe('Apagar?')
    act(() => { vi.advanceTimersByTime(400) })
    fireEvent.click(trash('Baixo'))
    expect(actions.removeChannel).toHaveBeenCalledTimes(1)
    expect(actions.removeChannel).toHaveBeenCalledWith('b1')

    // Sair do EDITAR CANAIS desarma.
    fireEvent.click(trash('Bateria'))
    rerenderWith(view({ channelEditMode: false }))
    rerenderWith(view({ channelEditMode: true }))
    expect(trash('Bateria').textContent).toBe('')
  })

  it('alça arrasta o canal pra outra posição pelo ponteiro (vale no toque); as setas também movem', () => {
    const { actions } = renderMixer(view({ channelEditMode: true }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const slot = this.dataset.stripSlot
      return slot === undefined ? rect(0, 0) : rect(Number(slot) * 80, 80)
    })
    const grip = (label: string) => within(strip(label)).getByRole('button', { name: `Mover ${label}` })
    const slot = (i: number) => document.querySelector<HTMLElement>(`[data-strip-slot="${i}"]`)!
    expect(grip('Click').className).toContain('touch-none')

    pointer(grip('Click'), 'pointerdown', { clientX: 40 })
    expect(slot(0).dataset.dragging).toBe('true')
    pointer(grip('Click'), 'pointermove', { clientX: 200 })
    expect(slot(2).dataset.dropTarget).toBe('true')
    pointer(grip('Click'), 'pointerup', { clientX: 200 })
    expect(actions.reorderChannel).toHaveBeenCalledWith(0, 2)
    expect(slot(0).dataset.dragging).toBe('false')
    expect(slot(2).dataset.dropTarget).toBe('false')

    // Soltar no mesmo lugar ou cancelar não reordena; além da ponta vai pro último.
    pointer(grip('Baixo'), 'pointerdown', { clientX: 250 })
    pointer(grip('Baixo'), 'pointerup', { clientX: 250 })
    pointer(grip('Baixo'), 'pointerdown', { clientX: 250 })
    pointer(grip('Baixo'), 'pointermove', { clientX: 20 })
    pointer(grip('Baixo'), 'pointercancel', { clientX: 20 })
    expect(actions.reorderChannel).toHaveBeenCalledTimes(1)
    pointer(grip('Guia'), 'pointerdown', { clientX: 120 })
    pointer(grip('Guia'), 'pointermove', { clientX: 5000 })
    pointer(grip('Guia'), 'pointerup', { clientX: 5000 })
    expect(actions.reorderChannel).toHaveBeenLastCalledWith(1, CHANNELS.length - 1)

    fireEvent.keyDown(grip('Guia'), { key: 'ArrowRight' })
    expect(actions.reorderChannel).toHaveBeenLastCalledWith(1, 2)
    fireEvent.keyDown(grip('Guia'), { key: 'ArrowLeft' })
    expect(actions.reorderChannel).toHaveBeenLastCalledWith(1, 0)
    const before = vi.mocked(actions.reorderChannel).mock.calls.length
    fireEvent.keyDown(grip('Click'), { key: 'ArrowLeft' })
    fireEvent.keyDown(grip('Violão Base Esquerdo 2'), { key: 'ArrowRight' })
    expect(actions.reorderChannel).toHaveBeenCalledTimes(before)
  })
})

describe('nome do canal', () => {
  it('nome do canal nunca é cortado', () => {
    // O jsdom não mede: régua falsa de altura (11 caracteres por linha a 11 px, 13 a 10 px; linha de 14 px).
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-channel-name')) return 0
        return Math.ceil((this.textContent ?? '').length / (this.dataset.fit === 'small' ? 13 : 11)) * 14
      },
    })
    try {
      const names = ['Baixo', 'Violão Base Esquerdo 2', 'Guitarra Base Direita 12']
      renderMixer(view({ channels: names.map((n, i) => stageChannel(`n${i}`, n)) }))
      for (const n of names) {
        const name = strip(n).querySelector<HTMLElement>('[data-channel-name]')!
        expect(name.textContent).toBe(n)
        expect(name.className).not.toMatch(/truncate|text-ellipsis|line-clamp|whitespace-nowrap|overflow-hidden|overflow-clip/)
        expect(name.className).toContain('wrap-anywhere')
        // Ruling T14: sempre 2 linhas reservadas (28 px), com nome curto ou longo.
        expect(name.className).toContain('min-h-[28px]')
        expect(name.className).toContain('leading-[14px]')
      }
      const fit = (n: string) => strip(n).querySelector<HTMLElement>('[data-channel-name]')!.dataset.fit
      expect(fit('Baixo')).toBeUndefined()
      expect(fit('Violão Base Esquerdo 2')).toBeUndefined() // 2 linhas a 11 px: fica
      expect(fit('Guitarra Base Direita 12')).toBe('small') // 3 linhas a 11 px: desce pra 10 px
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc)
    }
  })
})

describe('PRINCIPAL', () => {
  it('EDITAR CANAIS, fader com L/R e escala, mudo geral e o nome', () => {
    const { actions, rerenderWith } = renderMixer()
    const m = masterStrip()
    expect(m.className).toContain('w-[116px]')
    expect(m.textContent).toContain('PRINCIPAL')
    expect([...m.querySelectorAll('[data-scale] span')].map((s) => s.textContent)).toEqual(['+6', '0', '−12', '−24', '−∞'])

    const edit = within(m).getByRole('button', { name: 'EDITAR CANAIS' })
    expect(edit.dataset.on).toBe('false')
    fireEvent.click(edit)
    expect(actions.toggleChannelEditMode).toHaveBeenCalledTimes(1)
    const mute = within(m).getByRole('button', { name: 'Mudo geral' })
    expect(mute.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(mute)
    expect(actions.toggleMasterMute).toHaveBeenCalledTimes(1)
    rerenderWith(view({ channelEditMode: true, master: { volume: 1, muted: true } }))
    // Ruling T14-pronto: ligado, o botão diz PRONTO em laranja, como na Parte 1 (o texto muda, então sem aria-pressed).
    expect(within(m).queryByRole('button', { name: 'EDITAR CANAIS' })).toBeNull()
    const done = within(m).getByRole('button', { name: 'PRONTO' })
    expect(done.dataset.on).toBe('true')
    expect(done.className).toContain('text-ps-or')
    expect(done.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(done)
    expect(actions.toggleChannelEditMode).toHaveBeenCalledTimes(2)
    expect(within(m).getByRole('button', { name: 'Mudo geral' }).getAttribute('aria-pressed')).toBe('true')
    expect(fader('principal').dataset.quiet).toBe('true')

    const fd = fader('principal')
    pointer(fd, 'pointerdown', { clientY: 300 })
    pointer(fd, 'pointerup', { clientY: 300 })
    expect(actions.setMasterVolume).not.toHaveBeenCalled()
    pointer(fd, 'pointerdown', { clientY: 300 })
    pointer(fd, 'pointermove', { clientY: 290 })
    pointer(fd, 'pointerup', { clientY: 290 })
    expect(actions.setMasterVolume).toHaveBeenLastCalledWith(faderToGain(1))
    fireEvent.doubleClick(fd)
    expect(actions.setMasterVolume).toHaveBeenLastCalledWith(1)
  })
})

describe('mixer inteiro', () => {
  it('ponto do tour e nome da região', () => {
    const { container } = renderMixer()
    const root = container.querySelector<HTMLElement>('[data-tour="mixer"]')!
    expect(root.getAttribute('aria-label')).toBe('Mixer')
    expect(root.contains(masterStrip())).toBe(true)
    expect(root.contains(strip('Bateria'))).toBe(true)
  })

  it('largura: 14 canais em 1280 px cabem inteiros; com mais, cada um fica com a largura de um inteiro e a fileira rola', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { observers.push(() => cb([], this as unknown as ResizeObserver)) }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    // 1280 px: 1280 - 2 x 16 de margem - 10 de vão - 116 do PRINCIPAL = 1122 px de caixa; menos 4 px de folga
    // de cada lado da caixa (parada) = 1114 px de área que rola.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.mixerScroll !== undefined ? 1114 : 0
    })
    const many = (n: number) => Array.from({ length: n }, (_, i) => stageChannel(`k${i}`, `Teclado ${i + 1}`))
    const { rerenderWith, container } = renderMixer(view({ channels: many(14) }))
    act(() => { for (const o of observers) o() })
    const slots = () => [...container.querySelectorAll<HTMLElement>('[data-strip-slot]')]
    expect(slots()).toHaveLength(14)
    for (const s of slots()) {
      expect(s.style.width).toBe('')
      expect(s.className).toContain('flex-1')
      expect(s.className).toContain('min-w-[76px]')
    }

    rerenderWith(view({ channels: many(16) }))
    for (const s of slots()) {
      expect(parseFloat(s.style.width)).toBeCloseTo(1114 / 14, 3)
      expect(s.className).not.toContain('flex-1')
      expect(s.className).toContain('snap-start')
    }
    const scroller = container.querySelector<HTMLElement>('[data-mixer-scroll]')!
    expect(scroller.className).toContain('overflow-x-auto')
    expect(scroller.className).toContain('snap-x')
    expect(scroller.className).toContain('snap-mandatory')
    // A folga de 4 px dos lados fica na caixa, que não rola: a área que rola mostra só canais inteiros.
    const box = container.querySelector<HTMLElement>('[data-mixer-box]')!
    expect(box.contains(scroller)).toBe(true)
    expect(box.className).toContain('px-1')
    expect(scroller.className).not.toMatch(/\bp[xl]?-|\bpr-/)

    // EDITAR CANAIS: mínimo de 88 px pra lixeira armada caber; em 1280 px ficam 12 inteiros e o resto rola.
    rerenderWith(view({ channels: many(14), channelEditMode: true }))
    for (const s of slots()) expect(parseFloat(s.style.width)).toBeCloseTo(1114 / 12, 3)
    rerenderWith(view({ channels: many(12), channelEditMode: true }))
    for (const s of slots()) {
      expect(s.style.width).toBe('')
      expect(s.className).toContain('min-w-[88px]')
    }
  })

  it('a barra de rolagem de lado entra na folga de baixo: os faders ficam na linha do PRINCIPAL', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { observers.push(() => cb([], this as unknown as ResizeObserver)) }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    let bar = 0
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.mixerScroll !== undefined ? 220 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.mixerScroll !== undefined ? 220 - bar : 0
    })
    const { container } = renderMixer()
    const box = container.querySelector<HTMLElement>('[data-mixer-box]')!
    act(() => { for (const o of observers) o() })
    expect(box.style.paddingBottom).toBe('') // sem barra: a folga de 8 px da classe
    expect(box.className).toContain('pb-2')
    bar = 5 // barra de 5 px do index.css (Chrome e app)
    act(() => { for (const o of observers) o() })
    expect(box.style.paddingBottom).toBe('3px')
    bar = 12 // barra mais grossa que a folga: folga zero, nunca negativa
    act(() => { for (const o of observers) o() })
    expect(box.style.paddingBottom).toBe('0px')
  })

  it('alvos de toque: pan, lápis, alça, lixeira, PRONTO (EDITAR CANAIS ligado) e mudo geral com 44 px', () => {
    renderMixer(view({ channelEditMode: true }))
    expect(panOf('Bateria').className).toContain('min-h-ps-touch')
    for (const name of ['Renomear e escolher papel de Bateria', 'Mover Bateria', 'Apagar o canal Bateria', 'PRONTO', 'Mudo geral']) {
      const b = screen.getByRole('button', { name })
      expect(b.className, name).toMatch(/min-h-ps-touch|size-ps-touch/)
      expect(b.dataset.touchException, name).toBeUndefined()
    }
  })

  it('números em fonte de largura fixa', () => {
    renderMixer()
    expect(panOf('Bateria').querySelector('[data-pan-value]')!.className).toContain('ps-num')
    expect(balloonOf(fader('Bateria')).className).toContain('ps-num')
    expect(masterStrip().querySelector('[data-scale]')!.className).toContain('ps-num')
  })

  it('sem inglês e sem travessão (texto, aria-label e title), também no EDITAR CANAIS, com pan travado e contando', () => {
    heard = 20.6
    for (const v of [view(), view({ channelEditMode: true }), view({ outputs: plan('split2'), transition: COUNT })]) {
      const { container, unmount } = renderMixer(v)
      const texts = [container.textContent ?? '']
      for (const el of container.querySelectorAll('[aria-label], [title], [aria-valuetext]')) {
        texts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('aria-valuetext') ?? '')
      }
      for (const t of texts) {
        expect(t).not.toMatch(PROIBIDAS)
        expect(t).not.toContain(TRAVESSAO)
      }
      unmount()
    }
  })

  it('só tokens ps-*: nenhuma cor literal nos arquivos do mixer (a cor do grupo vem do dado)', () => {
    const files = ['StageMixer.tsx', 'ChannelStrip.tsx', 'PanKnob.tsx', 'FaderVU.tsx', 'MasterStrip.tsx']
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), 'src/components/stage', f), 'utf8')
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(src, f).not.toMatch(/rgba?\(|hsla?\(/)
      expect(src, f).not.toContain(TRAVESSAO)
    }
    expect(readFileSync(resolve(process.cwd(), 'src/lib/faderScale.ts'), 'utf8')).not.toContain(TRAVESSAO)
  })
})
