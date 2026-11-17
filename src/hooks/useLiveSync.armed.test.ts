// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { WsMessage } from '../types'
import { buildPayload, INITIAL_STATE, readHostState, useLiveSync, type FollowerState } from './useLiveSync'

type HostStatePayload = Extract<WsMessage, { type: 'HOST_STATE' }>['payload']

// Nuvem falsa: guarda quem escuta o canal e o que o líder manda.
const cloud = vi.hoisted(() => {
  const listeners: ((msg: { payload: unknown }) => void)[] = []
  const sent: { event: string; payload: unknown }[] = []
  const channel = {
    on(_type: string, _filter: unknown, cb: (msg: { payload: unknown }) => void) { listeners.push(cb) },
    subscribe() {},
    send(msg: { event: string; payload: unknown }) { sent.push(msg) },
  }
  return { listeners, sent, supabase: { channel: () => channel, removeChannel: () => {} } }
})
vi.mock('../lib/supabase', () => ({ supabase: cloud.supabase }))

// WebSocket falso da rede local: o teste entrega as mensagens do líder na mão.
class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((err: unknown) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send() {}
  close() {}
}

const ARMED = { index: 2, label: 'Refrão', color: '#FF6B35', kind: 'proxima' as const, plays: 1 }

// Exatamente o que um host da versão anterior manda: sem armed, countBeat e countTotal.
function oldHostPayload(): HostStatePayload {
  return {
    isPlaying: true,
    currentTime: 42,
    songName: 'Grande é o Senhor',
    currentMarker: { id: 'm1', time: 30, label: 'Verso', color: '#10b981' },
    nextMarkerLabel: 'Refrão',
    nextSong: null,
    lyrics: null,
    lyricsSynced: null,
    chords: null,
    controlEnabled: false,
    approvedIps: ['192.168.0.20'],
    setlist: ['Grande é o Senhor'],
    activeIndex: 0,
    channels: [],
    activePad: null,
    padVolume: 1,
    pitch: 0,
    originalKey: 'G',
    sections: [{ label: 'Verso', color: '#10b981' }, { label: 'Refrão', color: '#FF6B35' }],
    activeLoop: null,
    bandSectionsEnabled: true,
  }
}

const leaderWithJump = (): FollowerState => ({ ...INITIAL_STATE, songName: 'Teste', armed: ARMED, countBeat: 2, countTotal: 4 })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWebSocket.instances = []
  cloud.listeners.length = 0
  cloud.sent.length = 0
  delete window.playbackDesktop
  window.history.replaceState(null, '', '/')
})

describe('protocolo do pulo armado e da contagem', () => {
  it('INITIAL_STATE começa sem pulo armado e sem contagem', () => {
    expect(INITIAL_STATE.armed).toBeNull()
    expect(INITIAL_STATE.countBeat).toBeNull()
    expect(INITIAL_STATE.countTotal).toBeNull()
  })

  it('buildPayload leva armed e a contagem', () => {
    const payload = buildPayload(leaderWithJump())
    expect(payload.armed).toEqual(ARMED)
    expect(payload.countBeat).toBe(2)
    expect(payload.countTotal).toBe(4)
  })

  it('buildPayload manda null (não some do JSON) quando o líder não tem pulo armado', () => {
    // O líder sempre informa os três campos (Ruling T24-1): sem pulo, null.
    const wire = JSON.parse(JSON.stringify(buildPayload({ ...oldHostPayload(), armed: null, countBeat: null, countTotal: null })))
    expect(wire.armed).toBeNull()
    expect(wire.countBeat).toBeNull()
    expect(wire.countTotal).toBeNull()
  })

  it('celular da versão anterior: o payload novo mantém todo campo antigo com o mesmo valor', () => {
    const antigo = oldHostPayload()
    const novo = buildPayload({ ...antigo, armed: ARMED, countBeat: 1, countTotal: 4 })
    for (const [campo, valor] of Object.entries(antigo)) {
      expect(novo[campo as keyof typeof novo], campo).toEqual(valor)
    }
  })

  it('host antigo sem os campos vira null na leitura', () => {
    const lido = readHostState(oldHostPayload(), true)
    expect(lido.armed).toBeNull()
    expect(lido.countBeat).toBeNull()
    expect(lido.countTotal).toBeNull()
    expect(lido.controlEnabled).toBe(true)
    expect(lido.nextMarkerLabel).toBe('Refrão')
  })

  it('leitura descarta pulo armado malformado em vez de quebrar a tela', () => {
    const lido = readHostState({
      ...oldHostPayload(),
      armed: { index: 1, label: 'Ponte', kind: 'outro' } as unknown as typeof ARMED,
      countBeat: Number.NaN,
      countTotal: '4' as unknown as number,
    }, false)
    expect(lido.armed).toBeNull()
    expect(lido.countBeat).toBeNull()
    expect(lido.countTotal).toBeNull()
  })

  it('leitura descarta pulo armado com kind desconhecido (o resto certo)', () => {
    const armed = { ...ARMED, kind: 'outro' } as unknown as typeof ARMED
    expect(readHostState({ ...oldHostPayload(), armed }, false).armed).toBeNull()
  })

  it('leitura descarta pulo armado com plays inválido (o resto certo)', () => {
    const armed = { ...ARMED, plays: '2' } as unknown as typeof ARMED
    expect(readHostState({ ...oldHostPayload(), armed }, false).armed).toBeNull()
    // Controle: os mesmos campos com plays válido passam.
    expect(readHostState({ ...oldHostPayload(), armed: { ...ARMED, plays: 'infinite' } }, false).armed).toEqual({ ...ARMED, plays: 'infinite' })
  })

  it('host antigo sem os campos vira null pela rede local', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { result } = renderHook(() => useLiveSync(INITIAL_STATE))
    expect(result.current.isFollowerMode).toBe(true)
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'HOST_STATE', payload: oldHostPayload() }) }))
    expect(result.current.followerState.songName).toBe('Grande é o Senhor')
    expect(result.current.followerState.armed).toBeNull()
    expect(result.current.followerState.countBeat).toBeNull()
    expect(result.current.followerState.countTotal).toBeNull()
  })

  it('pela rede local o celular recebe o pulo armado e a contagem', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { result } = renderHook(() => useLiveSync(INITIAL_STATE))
    const ws = FakeWebSocket.instances[0]
    const message: WsMessage = { type: 'HOST_STATE', payload: buildPayload(leaderWithJump()) }
    act(() => ws.onmessage?.({ data: JSON.stringify(message) }))
    expect(result.current.followerState.armed).toEqual(ARMED)
    expect(result.current.followerState.countBeat).toBe(2)
    expect(result.current.followerState.countTotal).toBe(4)
  })

  it('host antigo sem os campos vira null pela nuvem', () => {
    window.history.replaceState(null, '', '/?s=ABC123')
    const { result } = renderHook(() => useLiveSync(INITIAL_STATE))
    expect(result.current.isFollowerMode).toBe(true)
    act(() => cloud.listeners.forEach((cb) => cb({ payload: oldHostPayload() })))
    expect(result.current.isConnected).toBe(true)
    expect(result.current.followerState.songName).toBe('Grande é o Senhor')
    expect(result.current.followerState.armed).toBeNull()
    expect(result.current.followerState.countBeat).toBeNull()
    expect(result.current.followerState.countTotal).toBeNull()
    expect(result.current.followerState.controlEnabled).toBe(false)
  })

  it('pela nuvem o celular recebe o pulo armado e a contagem', () => {
    window.history.replaceState(null, '', '/?s=ABC123')
    const { result } = renderHook(() => useLiveSync(INITIAL_STATE))
    act(() => cloud.listeners.forEach((cb) => cb({ payload: buildPayload(leaderWithJump()) })))
    expect(result.current.followerState.armed).toEqual(ARMED)
    expect(result.current.followerState.countBeat).toBe(2)
    expect(result.current.followerState.countTotal).toBe(4)
  })

  it('o líder manda o pulo armado e a contagem nos dois caminhos (rede local e nuvem)', () => {
    vi.useFakeTimers()
    const broadcastState = vi.fn()
    window.playbackDesktop = { isElectron: true, broadcastState } as unknown as NonNullable<Window['playbackDesktop']>
    renderHook(() => useLiveSync(leaderWithJump(), 'ABC123'))
    act(() => { vi.advanceTimersByTime(600) })
    const lan = broadcastState.mock.calls.at(-1)?.[0] as WsMessage
    expect(lan.type).toBe('HOST_STATE')
    if (lan.type !== 'HOST_STATE') return
    expect(lan.payload.armed).toEqual(ARMED)
    expect(lan.payload.countBeat).toBe(2)
    expect(lan.payload.countTotal).toBe(4)
    const nuvem = cloud.sent.at(-1)
    expect(nuvem?.event).toBe('host-state')
    expect(nuvem?.payload).toMatchObject({ armed: ARMED, countBeat: 2, countTotal: 4 })
  })
})
