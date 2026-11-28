// Manutenção (2026-11-27, Ruling SEP-memoria): as faixas da separação descem direto pro aparelho,
// nas chaves por faixa do repertório, antes de a música entrar nele. Uma lista guarda quem gravou
// (a sessão) pra que o que sobrar de uma sessão que caiu no meio saia na restauração seguinte.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  get: async (k: string) => db.get(k),
  set: async (k: string, v: unknown) => { db.set(k, v) },
  del: async (k: string) => { db.delete(k) },
}))

import { STAGED_STALE_MS, discardStagedStems, putStagedStem, stagedRegistryKey, sweepStagedStems } from './stagedStems'

const FILES = 'mt_files_u1'
const fileKey = (id: string) => `${FILES}:ch:${id}`
const wav = (n: string) => new File([n], `${n}.wav`, { type: 'audio/wav' })
const registry = () => (db.get(stagedRegistryKey(FILES)) ?? []) as { id: string; session: string; at: number }[]

beforeEach(() => db.clear())

describe('faixas gravadas antes de entrar no repertório', () => {
  it('putStagedStem grava o arquivo na chave da faixa e anota na lista; discard tira os dois', async () => {
    const a = await putStagedStem(FILES, fileKey, wav('Vocais'))
    const b = await putStagedStem(FILES, fileKey, wav('Bateria'))
    expect(a).not.toBe(b)
    expect((db.get(fileKey(a)) as File).name).toBe('Vocais.wav')
    expect((db.get(fileKey(b)) as File).name).toBe('Bateria.wav')
    expect(registry().map((e) => e.id)).toEqual([a, b])
    await discardStagedStems(FILES, fileKey, [a, b])
    expect(db.has(fileKey(a))).toBe(false)
    expect(db.has(fileKey(b))).toBe(false)
    expect(registry()).toEqual([])
  })

  it('gravações juntas não perdem ninguém da lista', async () => {
    const ids = await Promise.all(['a', 'b', 'c', 'd'].map((n) => putStagedStem(FILES, fileKey, wav(n))))
    expect(registry().map((e) => e.id).sort()).toEqual([...ids].sort())
  })

  it('a restauração tira o que outra sessão deixou e nenhuma música usa; o que uma música usa fica', async () => {
    const velho = Date.now() - STAGED_STALE_MS - 1000
    db.set(fileKey('orfa'), wav('orfa'))
    db.set(fileKey('usada'), wav('usada'))
    db.set(stagedRegistryKey(FILES), [{ id: 'orfa', session: 'outra', at: velho }, { id: 'usada', session: 'outra', at: velho }])
    const minha = await putStagedStem(FILES, fileKey, wav('baixando agora'))
    await sweepStagedStems(FILES, fileKey, new Set(['usada']))
    expect(db.has(fileKey('orfa'))).toBe(false)
    expect(db.has(fileKey('usada'))).toBe(true)
    // A que esta sessão está baixando (a separação a caminho do palco) não sai.
    expect(db.has(fileKey(minha))).toBe(true)
    expect(registry().map((e) => e.id)).toEqual([minha])
  })

  it('outra sessão recente (outra aba baixando agora) fica pra uma restauração depois', async () => {
    db.set(fileKey('outra-aba'), wav('x'))
    db.set(stagedRegistryKey(FILES), [{ id: 'outra-aba', session: 'outra', at: Date.now() }])
    await sweepStagedStems(FILES, fileKey, new Set())
    expect(db.has(fileKey('outra-aba'))).toBe(true)
    expect(registry().map((e) => e.id)).toEqual(['outra-aba'])
  })

  it('lista estragada no aparelho não quebra nada', async () => {
    db.set(stagedRegistryKey(FILES), 'lixo')
    await sweepStagedStems(FILES, fileKey, new Set())
    const id = await putStagedStem(FILES, fileKey, wav('a'))
    expect(registry().map((e) => e.id)).toEqual([id])
  })
})

// Revisão do item 4 (C1): fora de contexto seguro (o celular da banda abre http://<IP da rede local>)
// não existe crypto.randomUUID. O módulo entra no pacote principal pelo motor: carregar não pode
// lançar, senão o app inteiro não abre e a tela da banda fica em branco.
describe('fora de contexto seguro (sem crypto.randomUUID)', () => {
  it('o módulo carrega sem lançar, e gravar e limpar continuam funcionando', async () => {
    vi.resetModules()
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as unknown as Uint8Array) as unknown as T })
    try {
      expect(typeof (globalThis.crypto as Crypto & { randomUUID?: unknown }).randomUUID).toBe('undefined')
      const mod = await import('./stagedStems')
      const a = await mod.putStagedStem(FILES, fileKey, wav('Vocais'))
      const b = await mod.putStagedStem(FILES, fileKey, wav('Bateria'))
      expect(a).toMatch(/^[0-9a-f]{32}$|^[0-9a-f-]{36}$/)
      expect(a).not.toBe(b)
      expect((db.get(fileKey(a)) as File).name).toBe('Vocais.wav')
      // A limpeza de outra sessão também funciona (a sessão desta nasce sob demanda).
      db.set(fileKey('orfa'), wav('orfa'))
      db.set(mod.stagedRegistryKey(FILES), [...registry(), { id: 'orfa', session: 'outra', at: 0 }])
      await mod.sweepStagedStems(FILES, fileKey, new Set())
      expect(db.has(fileKey('orfa'))).toBe(false)
      expect(db.has(fileKey(a))).toBe(true)
      await mod.discardStagedStems(FILES, fileKey, [a, b])
      expect(registry()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
