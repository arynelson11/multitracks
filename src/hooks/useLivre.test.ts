// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O separationUsage (brtMonth, brtDay) puxa o cliente do Supabase; aqui só interessam as datas.
vi.mock('../lib/supabase', () => ({ supabase: null }))

import type { EngineBusy } from '../lib/livreRules'
import { readLiveLedger, readStageLedger, writeLiveLedger } from '../lib/livreStore'
import { brtDay, brtMonth } from '../lib/separationUsage'
import { useLivre } from './useLivre'

// Hook do Livre: as músicas do mês no palco, os 10 minutos do Ao Vivo do dia (só com celular
// conectado, Ruling R16-mudada: quem chama passa `liveActive` verdadeiro só assim) e a fila da
// tela de limite, que só aparece com o motor parado. O hook não recebe nada do motor além de
// `busy`: não tem como parar o som.

const TRAVESSAO = String.fromCharCode(0x2014)
const U = 'u-livre'
const PARADO: EngineBusy = { isPlaying: false, isCountingIn: false }
const TOCANDO: EngineBusy = { isPlaying: true, isCountingIn: false }
const CONTANDO: EngineBusy = { isPlaying: false, isCountingIn: true }

type Props = Parameters<typeof useLivre>[0]

function setup(over: Partial<Props> = {}) {
  const onLiveExpired = vi.fn()
  let props: Props = { userId: U, plan: 'free', isAdmin: false, busy: PARADO, liveActive: false, onLiveExpired, ...over }
  const h = renderHook((p: Props) => useLivre(p), { initialProps: props })
  return {
    onLiveExpired,
    r: () => h.result.current,
    set(patch: Partial<Props>) {
      props = { ...props, ...patch }
      h.rerender(props)
    },
    rerender: h.rerender,
  }
}

const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-19T15:00:00Z')) // 12:00 de 19/11 em Brasília
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

describe('quem não é Livre', () => {
  it('conta paga nunca vê limite nem selo', () => {
    for (const plan of ['essencial_mensal', 'pro_anual']) {
      const h = setup({ plan, liveActive: true })
      expect(h.r().isLivre).toBe(false)
      act(() => { for (const k of ['song:1', 'song:2', 'song:3', 'song:4']) h.r().noteSongOpened(k) })
      expect(h.r().canOpenSong('song:9')).toBe(true)
      expect(h.r().canOpenNewSong()).toBe(true)
      expect(h.r().stage).toEqual({ used: 0, limit: Infinity })
      expect(h.r().live).toEqual({ remainingMs: Infinity, limitMs: null })
      expect(h.r().canStartLive()).toBe(true)
      act(() => h.r().requestLimit('stage-songs'))
      expect(h.r().limit).toBeNull()
      // Nenhum timer, nada gravado no aparelho, mesmo com a sessão ligada por uma hora.
      expect(vi.getTimerCount()).toBe(0)
      passar(3_600_000)
      expect(h.onLiveExpired).not.toHaveBeenCalled()
      expect(localStorage.length).toBe(0)
      cleanup()
    }
  })

  it('admin no Livre não tem limite', () => {
    const h = setup({ plan: 'free', isAdmin: true, liveActive: true })
    expect(h.r().isLivre).toBe(false)
    act(() => { for (const k of ['song:1', 'song:2', 'song:3', 'song:4']) h.r().noteSongOpened(k) })
    expect(h.r().canOpenSong('song:5')).toBe(true)
    expect(h.r().canOpenNewSong()).toBe(true)
    expect(h.r().stage).toEqual({ used: 0, limit: Infinity })
    expect(h.r().live.limitMs).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    passar(3_600_000)
    expect(h.onLiveExpired).not.toHaveBeenCalled()
    expect(h.r().canStartLive()).toBe(true)
    act(() => h.r().requestLimit('live'))
    expect(h.r().limit).toBeNull()
  })

  it('virou pago ou trocou de conta com a tela aberta: a tela some', () => {
    const h = setup()
    act(() => h.r().requestLimit('stage-songs'))
    expect(h.r().limit).toBe('stage-songs')
    h.set({ plan: 'essencial_mensal' })
    expect(h.r().limit).toBeNull()
    h.set({ plan: 'free' })
    expect(h.r().limit).toBeNull()
    act(() => h.r().requestLimit('repertoire'))
    expect(h.r().limit).toBe('repertoire')
    h.set({ userId: 'u-outra' })
    expect(h.r().limit).toBeNull()
  })
})

describe('músicas do mês no palco', () => {
  it('Livre: 3 músicas diferentes contam 3, a 4ª nova é barrada e a 1ª de novo abre', () => {
    const h = setup()
    expect(h.r().isLivre).toBe(true)
    expect(h.r().stage).toEqual({ used: 0, limit: 3 })
    act(() => h.r().noteSongOpened('song:a'))
    act(() => h.r().noteSongOpened('song:a'))
    expect(h.r().stage).toEqual({ used: 1, limit: 3 })
    for (const k of ['cloud:b', 'sep:c']) {
      expect(h.r().canOpenSong(k)).toBe(true)
      act(() => h.r().noteSongOpened(k))
    }
    expect(h.r().stage).toEqual({ used: 3, limit: 3 })
    expect(h.r().canOpenNewSong()).toBe(false)
    expect(h.r().canOpenSong('song:d')).toBe(false)
    expect(h.r().canOpenSong('song:a')).toBe(true)
    // Chave nula (metrônomo infinito) sempre abre.
    expect(h.r().canOpenSong(null)).toBe(true)
    act(() => h.r().noteSongOpened(null))
    expect(readStageLedger(U, brtMonth(new Date())).keys).toEqual(['song:a', 'cloud:b', 'sep:c'])
  })

  it('separação do mês abre com 3 de 3 e não conta', () => {
    const h = setup()
    act(() => h.r().noteSongOpened('song:a'))
    act(() => h.r().noteSongOpened('sep:nova', { freeThisMonth: true }))
    expect(h.r().stage.used).toBe(1)
    act(() => { for (const k of ['song:b', 'song:c']) h.r().noteSongOpened(k) })
    expect(h.r().stage).toEqual({ used: 3, limit: 3 })
    expect(h.r().canOpenSong('sep:s1', { freeThisMonth: true })).toBe(true)
    act(() => h.r().noteSongOpened('sep:s1', { freeThisMonth: true }))
    expect(h.r().stage).toEqual({ used: 3, limit: 3 })
    expect(readStageLedger(U, brtMonth(new Date())).keys).toEqual(['song:a', 'song:b', 'song:c'])
    // Separação de mês anterior conta como qualquer música: com o mês cheio, não abre.
    expect(h.r().canOpenSong('sep:velha')).toBe(false)
  })

  it('noteSongOpened nunca barra: a música restaurada com o mês cheio conta e o contador para em 3', () => {
    const h = setup()
    act(() => { for (const k of ['song:a', 'song:b', 'song:c']) h.r().noteSongOpened(k) })
    act(() => h.r().noteSongOpened('song:restaurada'))
    expect(readStageLedger(U, brtMonth(new Date())).keys).toContain('song:restaurada')
    expect(h.r().stage).toEqual({ used: 3, limit: 3 })
    expect(h.r().canOpenSong('song:restaurada')).toBe(true)
  })

  it('às 23:30 de 30/11 em Brasília ainda conta em novembro; à meia-noite de 01/12 o mês zera', () => {
    let agora = new Date('2026-12-01T02:30:00Z') // 23:30 de 30/11 em Brasília (UTC já é dia 1º)
    const h = setup({ now: () => agora })
    act(() => { for (const k of ['song:a', 'song:b', 'song:c']) h.r().noteSongOpened(k) })
    expect(readStageLedger(U, '2026-11').keys).toHaveLength(3)
    expect(h.r().canOpenSong('song:d')).toBe(false)
    agora = new Date('2026-12-01T03:00:00Z') // 00:00 de 01/12 em Brasília
    expect(h.r().canOpenSong('song:d')).toBe(true)
    expect(h.r().canOpenNewSong()).toBe(true)
    h.set({})
    expect(h.r().stage).toEqual({ used: 0, limit: 3 })
  })
})

describe('tela de limite só com o motor parado', () => {
  it('requestLimit com a música tocando só mostra quando para', () => {
    const h = setup({ busy: TOCANDO })
    act(() => h.r().requestLimit('stage-songs'))
    expect(h.r().limit).toBeNull()
    h.set({ busy: CONTANDO })
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBe('stage-songs')
    act(() => h.r().closeLimit())
    expect(h.r().limit).toBeNull()
    h.set({ busy: TOCANDO })
    h.set({ busy: PARADO })
    expect(h.r().limit).toBeNull()
  })

  it('a tela do celular a mais (live-devices) passa pela mesma fila', () => {
    const h = setup({ busy: TOCANDO })
    act(() => h.r().requestLimit('live-devices'))
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBe('live-devices')
  })

  it('na pré-contagem também espera', () => {
    const h = setup({ busy: CONTANDO })
    act(() => h.r().requestLimit('repertoire'))
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBe('repertoire')
  })

  it('pedido no mesmo instante em que a música começa espera e aparece quando ela para', () => {
    const h = setup()
    act(() => {
      h.r().requestLimit('repertoire')
      h.set({ busy: TOCANDO })
    })
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBe('repertoire')
  })

  it('tela aberta e a música começa (pela banda): a tela sai e não volta sozinha', () => {
    const h = setup()
    act(() => h.r().requestLimit('repertoire'))
    expect(h.r().limit).toBe('repertoire')
    h.set({ busy: TOCANDO })
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBeNull()
  })
})

describe('Ao Vivo do Livre', () => {
  it('Ao Vivo: 10 minutos com a sessão ligada chamam onLiveExpired uma vez e pedem a tela live', () => {
    const h = setup({ liveActive: true })
    expect(h.r().live).toEqual({ remainingMs: 600_000, limitMs: 600_000 })
    expect(h.r().canStartLive()).toBe(true)
    passar(599_000)
    expect(h.onLiveExpired).not.toHaveBeenCalled()
    expect(h.r().live.remainingMs).toBe(1000)
    expect(h.r().limit).toBeNull()
    passar(1000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
    expect(h.r().limit).toBe('live')
    expect(h.r().live.remainingMs).toBe(0)
    // A sessão ainda não desligou (o App para o servidor sem esperar): não chama de novo.
    passar(60_000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
    expect(h.r().canStartLive()).toBe(false)
  })

  it('os 10 minutos acabam com a música tocando: a banda sai na hora e a tela só aparece quando a música para', () => {
    const h = setup({ liveActive: true, busy: TOCANDO })
    passar(600_000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
    expect(h.r().limit).toBeNull()
    h.set({ liveActive: false })
    passar(30_000)
    expect(h.r().limit).toBeNull()
    h.set({ busy: CONTANDO })
    expect(h.r().limit).toBeNull()
    h.set({ busy: PARADO })
    expect(h.r().limit).toBe('live')
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
  })

  it('canStartLive falso com os 10 minutos gastos e verdadeiro no dia seguinte de Brasília', () => {
    vi.setSystemTime(new Date('2026-11-20T02:00:00Z')) // 23:00 de 19/11 em Brasília
    const h = setup({ liveActive: true })
    passar(600_000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
    h.set({ liveActive: false })
    expect(h.r().canStartLive()).toBe(false)
    vi.setSystemTime(new Date('2026-11-20T02:59:00Z')) // 23:59 de 19/11: UTC já virou, Brasília não
    expect(h.r().canStartLive()).toBe(false)
    vi.setSystemTime(new Date('2026-11-20T03:00:30Z')) // 00:00:30 de 20/11 em Brasília
    expect(h.r().canStartLive()).toBe(true)
    h.set({})
    expect(h.r().live.remainingMs).toBe(600_000)
  })

  it('sessão desligada não gasta minutos', () => {
    const h = setup({ liveActive: false })
    expect(vi.getTimerCount()).toBe(0)
    passar(3_600_000)
    expect(h.onLiveExpired).not.toHaveBeenCalled()
    expect(h.r().live.remainingMs).toBe(600_000)
    expect(readLiveLedger(U, brtDay(new Date())).usedMs).toBe(0)
  })

  it('o relógio só corre com liveActive (celular conectado): desligar e religar soma só o tempo ligado', () => {
    const h = setup({ liveActive: true })
    passar(300_000)
    expect(h.r().live.remainingMs).toBe(300_000)
    h.set({ liveActive: false }) // o celular saiu (ou o HOST está aberto sem celular)
    passar(1_800_000)
    expect(h.r().live.remainingMs).toBe(300_000)
    h.set({ liveActive: true })
    passar(299_000)
    expect(h.onLiveExpired).not.toHaveBeenCalled()
    passar(1000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
  })

  it('computador dormindo: um passo grande conta no máximo 5 s', () => {
    const h = setup({ liveActive: true })
    act(() => {
      vi.setSystemTime(Date.now() + 3_600_000)
      vi.advanceTimersByTime(1000)
    })
    expect(h.r().live.remainingMs).toBe(595_000)
    expect(h.onLiveExpired).not.toHaveBeenCalled()
  })

  it('sessão ligada já sem minutos (gastos em outra janela): esgota no primeiro segundo', () => {
    writeLiveLedger(U, { day: brtDay(new Date()), usedMs: 600_000 })
    const h = setup({ liveActive: true })
    expect(h.r().canStartLive()).toBe(false)
    expect(h.r().live.remainingMs).toBe(0)
    passar(1000)
    expect(h.onLiveExpired).toHaveBeenCalledTimes(1)
    expect(h.r().limit).toBe('live')
  })

  it('a versão mais nova do onLiveExpired é a chamada', () => {
    const velho = vi.fn()
    const novo = vi.fn()
    const h = setup({ liveActive: true, onLiveExpired: velho })
    passar(300_000)
    h.set({ onLiveExpired: novo })
    passar(300_000)
    expect(velho).not.toHaveBeenCalled()
    expect(novo).toHaveBeenCalledTimes(1)
  })
})

describe('várias telas e quem chama', () => {
  it('duas instâncias (palco e Separador) veem a mesma contagem', () => {
    const palco = setup({ liveActive: true })
    const separador = setup({ liveActive: false, onLiveExpired: () => {} })
    act(() => palco.r().noteSongOpened('song:a'))
    expect(separador.r().stage.used).toBe(1)
    act(() => separador.r().noteSongOpened('sep:velha'))
    expect(palco.r().stage.used).toBe(2)
    passar(60_000)
    expect(palco.r().live.remainingMs).toBe(540_000)
    expect(separador.r().live.remainingMs).toBe(540_000)
    // A tela de limite é de cada tela: pedir no Separador não abre no palco.
    act(() => separador.r().requestLimit('download'))
    expect(separador.r().limit).toBe('download')
    expect(palco.r().limit).toBeNull()
  })

  it('o Separador chama com busy, liveActive falso e onLiveExpired vazio (T19)', () => {
    const { result, rerender } = renderHook(
      (p: { isPlaying: boolean }) => useLivre({
        userId: U,
        plan: 'free',
        isAdmin: false,
        busy: { isPlaying: p.isPlaying, isCountingIn: false },
        liveActive: false,
        onLiveExpired: () => {},
      }),
      { initialProps: { isPlaying: true } },
    )
    expect(vi.getTimerCount()).toBe(0)
    expect(result.current.canOpenSong('sep:s1', { freeThisMonth: true })).toBe(true)
    act(() => result.current.requestLimit('separations'))
    expect(result.current.limit).toBeNull()
    rerender({ isPlaying: false })
    expect(result.current.limit).toBe('separations')
    passar(600_000)
    expect(result.current.live.remainingMs).toBe(600_000)
  })

  it('a mesma entrada devolve o mesmo objeto (o App renderiza a cada quadro tocando)', () => {
    const { result, rerender } = renderHook(
      (p: { isPlaying: boolean }) => useLivre({
        userId: U,
        plan: 'free',
        isAdmin: false,
        busy: { isPlaying: p.isPlaying, isCountingIn: false },
        liveActive: false,
        onLiveExpired: () => {},
      }),
      { initialProps: { isPlaying: true } },
    )
    const antes = result.current
    rerender({ isPlaying: true })
    rerender({ isPlaying: true })
    expect(result.current).toBe(antes)
  })

  it('o hook não mexe no motor e não tem travessão', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/useLivre.ts'), 'utf8')
    expect(src.includes(TRAVESSAO)).toBe(false)
    expect(src).not.toMatch(/useAudioEngine|\b(pause|stop\w*|cancelCountIn|playWithPrecount)\s*\(/)
  })
})
