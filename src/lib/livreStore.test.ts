// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O separationUsage puxa o cliente do Supabase; aqui só interessam as datas de Brasília.
vi.mock('./supabase', () => ({ supabase: null }))

import {
  bigAdShownThisSession,
  livreVersion,
  markBigAdShown,
  readHomeAdDay,
  readLiveLedger,
  readStageLedger,
  recordStageSong,
  subscribeLivre,
  writeHomeAdDay,
  writeLiveLedger,
} from './livreStore'
import { brtDay, brtMonth } from './separationUsage'

// Store do Livre no aparelho (localStorage, por conta): músicas do mês no palco, minutos do
// Ao Vivo do dia e o dia do último anúncio da tela inicial. O armazenamento pode faltar ou
// lançar (aba privada, cota cheia, app de computador): leitura vazia, escrita que não quebra.

const TRAVESSAO = String.fromCharCode(0x2014)
const U = 'u-livre'
const OUTRA = 'u-outra'

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('livreStore: músicas do mês no palco', () => {
  it('as chaves do aparelho são por conta', () => {
    recordStageSong(U, 'cloud:a', '2026-11')
    writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })
    writeHomeAdDay(U, '2026-11-19')
    expect(localStorage.getItem(`ps-livre-musicas:${U}`)).not.toBeNull()
    expect(localStorage.getItem(`ps-livre-aovivo:${U}`)).not.toBeNull()
    expect(localStorage.getItem(`ps-livre-anuncio-inicio:${U}`)).not.toBeNull()
  })

  it('recordStageSong grava e a leitura seguinte vê, sem duplicar a chave', () => {
    expect(readStageLedger(U, '2026-11')).toEqual({ month: '2026-11', keys: [] })
    expect(recordStageSong(U, 'cloud:a', '2026-11')).toEqual({ month: '2026-11', keys: ['cloud:a'] })
    expect(readStageLedger(U, '2026-11')).toEqual({ month: '2026-11', keys: ['cloud:a'] })
    recordStageSong(U, 'cloud:a', '2026-11')
    recordStageSong(U, 'song:b', '2026-11')
    expect(readStageLedger(U, '2026-11')).toEqual({ month: '2026-11', keys: ['cloud:a', 'song:b'] })
  })

  it('duas telas do app gravando juntas nunca se apagam (lê, junta e grava na hora)', () => {
    // Cada tela leu o registro antes de a outra gravar; a gravação parte do que está guardado agora.
    const primeira = readStageLedger(U, '2026-11')
    const segunda = readStageLedger(U, '2026-11')
    expect(primeira.keys).toEqual([])
    expect(segunda.keys).toEqual([])
    recordStageSong(U, 'cloud:a', '2026-11')
    recordStageSong(U, 'song:b', '2026-11')
    expect(readStageLedger(U, '2026-11').keys).toEqual(['cloud:a', 'song:b'])
  })

  it('outra conta no mesmo aparelho começa do zero', () => {
    recordStageSong(U, 'cloud:a', '2026-11')
    expect(readStageLedger(OUTRA, '2026-11').keys).toEqual([])
  })

  it('o mês virou: o registro do mês passado não conta e o novo começa do zero', () => {
    recordStageSong(U, 'cloud:a', '2026-11')
    expect(readStageLedger(U, '2026-12')).toEqual({ month: '2026-12', keys: [] })
    expect(recordStageSong(U, 'song:b', '2026-12')).toEqual({ month: '2026-12', keys: ['song:b'] })
  })

  it('música aberta às 23:30 de 30/11 em Brasília conta em novembro; à meia-noite começa dezembro', () => {
    const tarde = brtMonth(new Date('2026-12-01T02:30:00Z'))
    recordStageSong(U, 'cloud:a', tarde)
    expect(readStageLedger(U, brtMonth(new Date('2026-11-30T15:00:00Z'))).keys).toEqual(['cloud:a'])
    expect(readStageLedger(U, brtMonth(new Date('2026-12-01T03:00:00Z'))).keys).toEqual([])
  })

  it('registro estragado no aparelho vale como vazio e a próxima música grava por cima', () => {
    localStorage.setItem(`ps-livre-musicas:${U}`, '{nao e json')
    expect(readStageLedger(U, '2026-11').keys).toEqual([])
    expect(recordStageSong(U, 'cloud:a', '2026-11').keys).toEqual(['cloud:a'])
    expect(readStageLedger(U, '2026-11').keys).toEqual(['cloud:a'])
  })
})

describe('livreStore: minutos do Ao Vivo', () => {
  it('writeLiveLedger grava e readLiveLedger lê no mesmo dia', () => {
    writeLiveLedger(U, { day: '2026-11-19', usedMs: 120_000 })
    expect(readLiveLedger(U, '2026-11-19')).toEqual({ day: '2026-11-19', usedMs: 120_000 })
    expect(readLiveLedger(OUTRA, '2026-11-19')).toEqual({ day: '2026-11-19', usedMs: 0 })
  })

  it('a meia-noite de Brasília zera os minutos guardados', () => {
    writeLiveLedger(U, { day: brtDay(new Date('2026-12-01T02:30:00Z')), usedMs: 600_000 })
    expect(readLiveLedger(U, brtDay(new Date('2026-12-01T02:59:00Z'))).usedMs).toBe(600_000)
    expect(readLiveLedger(U, brtDay(new Date('2026-12-01T03:00:00Z')))).toEqual({ day: '2026-12-01', usedMs: 0 })
  })
})

describe('livreStore: anúncio da tela inicial', () => {
  it('guarda o dia do último anúncio por conta', () => {
    expect(readHomeAdDay(U)).toBeNull()
    writeHomeAdDay(U, '2026-11-19')
    expect(readHomeAdDay(U)).toBe('2026-11-19')
    expect(readHomeAdDay(OUTRA)).toBeNull()
  })

  it('dia guardado fora do formato vale como nunca mostrado', () => {
    localStorage.setItem(`ps-livre-anuncio-inicio:${U}`, 'ontem')
    expect(readHomeAdDay(U)).toBeNull()
  })

  it('markBigAdShown vale pra sessão inteira', async () => {
    vi.resetModules()
    const store = await import('./livreStore')
    expect(store.bigAdShownThisSession()).toBe(false)
    store.markBigAdShown()
    expect(store.bigAdShownThisSession()).toBe(true)
    // Outra parte do app consultando depois, sem recarregar: continua valendo.
    store.writeHomeAdDay(U, '2026-11-19')
    expect(store.bigAdShownThisSession()).toBe(true)
    // Recarregar o app (módulo novo) começa a sessão de novo.
    vi.resetModules()
    const recarregado = await import('./livreStore')
    expect(recarregado.bigAdShownThisSession()).toBe(false)
  })
})

describe('livreStore: aviso de mudança (useSyncExternalStore)', () => {
  it('subscribeLivre avisa depois de gravar e livreVersion sobe', () => {
    const cb = vi.fn()
    const off = subscribeLivre(cb)
    const v0 = livreVersion()
    recordStageSong(U, 'cloud:a', '2026-11')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(livreVersion()).toBeGreaterThan(v0)
    const v1 = livreVersion()
    writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })
    writeHomeAdDay(U, '2026-11-19')
    expect(cb).toHaveBeenCalledTimes(3)
    expect(livreVersion()).toBeGreaterThan(v1)
    off()
    recordStageSong(U, 'song:b', '2026-11')
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('gravar o que já está guardado não avisa (nada mudou)', () => {
    recordStageSong(U, 'cloud:a', '2026-11')
    writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })
    const cb = vi.fn()
    const off = subscribeLivre(cb)
    const v = livreVersion()
    recordStageSong(U, 'cloud:a', '2026-11')
    writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })
    expect(cb).not.toHaveBeenCalled()
    expect(livreVersion()).toBe(v)
    off()
  })

  it('markBigAdShown avisa uma vez', () => {
    const cb = vi.fn()
    const off = subscribeLivre(cb)
    const ja = bigAdShownThisSession()
    markBigAdShown()
    markBigAdShown()
    expect(bigAdShownThisSession()).toBe(true)
    expect(cb).toHaveBeenCalledTimes(ja ? 0 : 1)
    off()
  })

  it('o evento storage de outra janela sobe a versão só pras chaves do Livre', () => {
    const cb = vi.fn()
    const off = subscribeLivre(cb)
    const v = livreVersion()
    window.dispatchEvent(new StorageEvent('storage', { key: `ps-livre-musicas:${U}` }))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(livreVersion()).toBeGreaterThan(v)
    window.dispatchEvent(new StorageEvent('storage', { key: 'ps-plano-guardado' }))
    expect(cb).toHaveBeenCalledTimes(1)
    // localStorage.clear() em outra janela chega com a chave nula.
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    window.dispatchEvent(new StorageEvent('storage', { key: `ps-livre-aovivo:${U}` }))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('dois inscritos: sair um não cala o outro', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeLivre(a)
    const offB = subscribeLivre(b)
    offA()
    recordStageSong(U, 'cloud:z', '2026-11')
    window.dispatchEvent(new StorageEvent('storage', { key: `ps-livre-musicas:${U}` }))
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(2)
    // O último a sair tira o ouvinte da janela (nada fica escutando à toa).
    const remove = vi.spyOn(window, 'removeEventListener')
    offB()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
    // Sair duas vezes não quebra.
    expect(() => offB()).not.toThrow()
  })
})

describe('livreStore: armazenamento que falta ou lança', () => {
  it('localStorage que lança: leitura vazia e escrita não quebra', () => {
    const boom = () => { throw new Error('armazenamento indisponível') }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, clear: boom })
    const cb = vi.fn()
    const off = subscribeLivre(cb)
    const v = livreVersion()
    expect(readStageLedger(U, '2026-11')).toEqual({ month: '2026-11', keys: [] })
    expect(() => recordStageSong(U, 'cloud:a', '2026-11')).not.toThrow()
    expect(readLiveLedger(U, '2026-11-19')).toEqual({ day: '2026-11-19', usedMs: 0 })
    expect(() => writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })).not.toThrow()
    expect(readHomeAdDay(U)).toBeNull()
    expect(() => writeHomeAdDay(U, '2026-11-19')).not.toThrow()
    // Escrita que falha não faz nada: ninguém é avisado de mudança que não houve.
    expect(cb).not.toHaveBeenCalled()
    expect(livreVersion()).toBe(v)
    off()
  })

  it('sem localStorage nenhum: leitura vazia e escrita não quebra', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readStageLedger(U, '2026-11').keys).toEqual([])
    expect(() => recordStageSong(U, 'cloud:a', '2026-11')).not.toThrow()
    expect(readLiveLedger(U, '2026-11-19').usedMs).toBe(0)
    expect(() => writeLiveLedger(U, { day: '2026-11-19', usedMs: 1000 })).not.toThrow()
    expect(readHomeAdDay(U)).toBeNull()
    expect(() => writeHomeAdDay(U, '2026-11-19')).not.toThrow()
  })

  it('cota cheia (só a escrita lança): a leitura segue com o que já estava guardado', () => {
    recordStageSong(U, 'cloud:a', '2026-11')
    const real = localStorage
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => real.getItem(k),
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
    })
    expect(() => recordStageSong(U, 'song:b', '2026-11')).not.toThrow()
    expect(readStageLedger(U, '2026-11').keys).toEqual(['cloud:a'])
  })
})

describe('livreStore: texto do arquivo', () => {
  it('nenhum travessão no código', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/livreStore.ts'), 'utf8')
    expect(src.includes(TRAVESSAO)).toBe(false)
  })
})
