import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// O separationUsage puxa o cliente do Supabase; aqui só interessam as datas de Brasília.
vi.mock('./supabase', () => ({ supabase: null }))

import {
  LIMIT_KINDS,
  LIMIT_SCREEN_KINDS,
  LIVE_TICK_CAP_MS,
  addLiveTime,
  decideOpen,
  isQuiet,
  liveLedgerFor,
  liveRemainingMs,
  offerTriggerFor,
  queueDismiss,
  queueRequest,
  queueSettle,
  separationIsThisMonth,
  separationKey,
  shouldShowHomeAd,
  shouldShowSeparationAd,
  stageLedgerFor,
  stageSongKey,
  stageUsed,
  withOpened,
  type LiveLedger,
  type QuietQueue,
  type StageLedger,
} from './livreRules'
import { brtDay, brtMonth } from './separationUsage'

// Regras puras do Livre no aparelho (spec 5 e 6): até 3 músicas diferentes por mês no palco,
// 10 minutos de Ao Vivo por dia, anúncio da casa com a música parada e a fila que só mostra
// tela por cima com o motor parado. Mês e dia sempre os de Brasília.

const TRAVESSAO = String.fromCharCode(0x2014)
const EMPTY: QuietQueue<string> = { pending: null, shown: null }
const l2: StageLedger = { month: '2026-11', keys: ['cloud:a', 'song:b'] }
const l3: StageLedger = { month: '2026-11', keys: ['cloud:a', 'song:b', 'sep:c'] }
const l0: LiveLedger = { day: '2026-11-19', usedMs: 0 }

describe('livreRules: o motor parado', () => {
  it('isQuiet só com a música parada e fora da pré-contagem', () => {
    expect(isQuiet({ isPlaying: false, isCountingIn: false })).toBe(true)
    expect(isQuiet({ isPlaying: true, isCountingIn: false })).toBe(false)
    expect(isQuiet({ isPlaying: false, isCountingIn: true })).toBe(false)
    expect(isQuiet({ isPlaying: true, isCountingIn: true })).toBe(false)
  })

  it('LIMIT_KINDS tem os 5 limites do contrato, sem repetir', () => {
    expect([...LIMIT_KINDS]).toEqual(['separations', 'stage-songs', 'live', 'repertoire', 'download'])
    expect(new Set(LIMIT_KINDS).size).toBe(LIMIT_KINDS.length)
  })

  it('o celular a mais no Ao Vivo do Livre é uma tela própria e abre a oferta como o Ao Vivo (o servidor só aceita os 5)', () => {
    expect([...LIMIT_SCREEN_KINDS]).toEqual([...LIMIT_KINDS, 'live-devices'])
    expect(new Set(LIMIT_SCREEN_KINDS).size).toBe(LIMIT_SCREEN_KINDS.length)
    expect(offerTriggerFor('live-devices')).toBe('live')
    for (const k of LIMIT_KINDS) expect(offerTriggerFor(k)).toBe(k)
  })
})

describe('livreRules: músicas diferentes do mês no palco', () => {
  it('música já contada no mês abre sem contar de novo', () => {
    expect(decideOpen({ month: '2026-11', keys: ['cloud:a'] }, 'cloud:a', 3)).toEqual({ allowed: true, counts: false })
  })

  it('música já contada abre mesmo com o mês cheio', () => {
    expect(decideOpen(l3, 'song:b', 3)).toEqual({ allowed: true, counts: false })
  })

  it('com 2 de 3 abre uma nova e conta; com 3 de 3 a nova é barrada', () => {
    expect(decideOpen(l2, 'song:x', 3)).toEqual({ allowed: true, counts: true })
    expect(decideOpen(l3, 'song:x', 3)).toEqual({ allowed: false })
  })

  it('mês vazio abre a primeira e conta', () => {
    expect(decideOpen({ month: '2026-11', keys: [] }, 'cloud:a', 3)).toEqual({ allowed: true, counts: true })
  })

  it('separação do mês abre com 3 de 3 e não conta', () => {
    expect(decideOpen(l3, 'sep:s1', 3, { freeThisMonth: true })).toEqual({ allowed: true, counts: false })
    expect(decideOpen(l2, 'sep:s1', 3, { freeThisMonth: true })).toEqual({ allowed: true, counts: false })
  })

  it('freeThisMonth falso segue a regra normal', () => {
    expect(decideOpen(l3, 'sep:s1', 3, { freeThisMonth: false })).toEqual({ allowed: false })
  })

  it('withOpened junta a chave uma vez só e não mexe no registro de entrada', () => {
    const next = withOpened(l2, 'song:x')
    expect(next).toEqual({ month: '2026-11', keys: ['cloud:a', 'song:b', 'song:x'] })
    expect(l2.keys).toEqual(['cloud:a', 'song:b'])
    expect(withOpened(next, 'song:x')).toBe(next)
    expect(withOpened(withOpened(next, 'song:x'), 'song:x').keys).toHaveLength(3)
  })

  it('stageUsed conta as músicas do mês com teto no limite', () => {
    expect(stageUsed({ month: '2026-11', keys: [] }, 3)).toBe(0)
    expect(stageUsed(l2, 3)).toBe(2)
    expect(stageUsed(l3, 3)).toBe(3)
    // A música restaurada ao abrir o app conta, mas nunca é barrada: a lista pode passar de 3.
    expect(stageUsed({ month: '2026-11', keys: ['a', 'b', 'c', 'd'] }, 3)).toBe(3)
  })

  it('stageLedgerFor do mesmo mês devolve as chaves guardadas', () => {
    expect(stageLedgerFor({ month: '2026-11', keys: ['cloud:a', 'song:b'] }, '2026-11')).toEqual(l2)
  })

  it('stageLedgerFor de outro mês volta vazio (o mês virou)', () => {
    expect(stageLedgerFor({ month: '2026-11', keys: ['a'] }, '2026-12').keys).toEqual([])
    expect(stageLedgerFor({ month: '2026-11', keys: ['a'] }, '2026-12').month).toBe('2026-12')
  })

  it('stageLedgerFor com formato errado ou nulo volta vazio no mês pedido', () => {
    const vazio = { month: '2026-11', keys: [] }
    expect(stageLedgerFor(null, '2026-11')).toEqual(vazio)
    expect(stageLedgerFor(undefined, '2026-11')).toEqual(vazio)
    expect(stageLedgerFor('2026-11', '2026-11')).toEqual(vazio)
    expect(stageLedgerFor([], '2026-11')).toEqual(vazio)
    expect(stageLedgerFor({ month: '2026-11' }, '2026-11')).toEqual(vazio)
    expect(stageLedgerFor({ month: '2026-11', keys: 'cloud:a' }, '2026-11')).toEqual(vazio)
    expect(stageLedgerFor({ month: '2026-11', keys: ['cloud:a', 7] }, '2026-11')).toEqual(vazio)
  })

  it('stageLedgerFor não deixa chave repetida contar duas vezes', () => {
    expect(stageLedgerFor({ month: '2026-11', keys: ['cloud:a', 'cloud:a', 'song:b'] }, '2026-11')).toEqual(l2)
  })
})

describe('livreRules: chave de cada música', () => {
  const canal = (name: string) => ({ name })

  it('stageSongKey: nuvem usa o sourceId, importada usa o id e o metrônomo infinito devolve null', () => {
    expect(stageSongKey({ id: 'r1', sourceId: 'n9', duration: 240, channels: [canal('Click'), canal('Baixo')] })).toBe('cloud:n9')
    expect(stageSongKey({ id: 'r1', duration: 240, channels: [canal('Click'), canal('Baixo')] })).toBe('song:r1')
    expect(stageSongKey({ id: 'r1', sourceId: '', duration: 240, channels: [canal('Baixo')] })).toBe('song:r1')
    expect(stageSongKey({ id: 'm1', duration: 36000, channels: [canal('Metronomo Loop')] })).toBeNull()
  })

  it('só o metrônomo infinito de verdade fica fora da conta', () => {
    // Música de 10 horas com outro canal, ou o canal do loop numa música de duração normal: conta.
    expect(stageSongKey({ id: 'm1', duration: 36000, channels: [canal('Baixo')] })).toBe('song:m1')
    expect(stageSongKey({ id: 'm1', duration: 240, channels: [canal('Metronomo Loop')] })).toBe('song:m1')
    expect(stageSongKey({ id: 'm1', duration: 36000, channels: [canal('Metronomo Loop'), canal('Baixo')] })).toBe('song:m1')
  })

  it('separationKey prefixa a id da separação', () => {
    expect(separationKey('s1')).toBe('sep:s1')
  })

  it('separação de 30/11 23:30 de Brasília é de novembro', () => {
    expect(separationIsThisMonth(Date.parse('2026-12-01T02:30:00Z'), new Date('2026-11-15T12:00:00Z'))).toBe(true)
    expect(separationIsThisMonth(Date.parse('2026-12-01T03:00:00Z'), new Date('2026-11-15T12:00:00Z'))).toBe(false)
  })

  it('separação do mês passado não é do mês; data estragada também não', () => {
    expect(separationIsThisMonth(Date.parse('2026-10-31T12:00:00Z'), new Date('2026-11-15T12:00:00Z'))).toBe(false)
    expect(separationIsThisMonth(Date.parse('2026-11-01T03:00:00Z'), new Date('2026-11-30T23:00:00Z'))).toBe(true)
    expect(separationIsThisMonth(Number.NaN, new Date('2026-11-15T12:00:00Z'))).toBe(false)
  })
})

describe('livreRules: mês e dia de Brasília', () => {
  it('às 23:30 de 30/11 em Brasília ainda é novembro', () => {
    expect(brtMonth(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11')
    expect(brtMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12')
  })

  it('brtDay: 23:30 de 30/11 em Brasília ainda é 30/11; à meia-noite vira 01/12', () => {
    expect(brtDay(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30')
    expect(brtDay(new Date('2026-12-01T02:59:59Z'))).toBe('2026-11-30')
    expect(brtDay(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01')
  })

  it('brtDay aceita texto ISO e vira o ano no fuso de Brasília', () => {
    expect(brtDay('2027-01-01T02:30:00Z')).toBe('2026-12-31')
    expect(brtDay('2027-01-01T03:00:00Z')).toBe('2027-01-01')
    expect(brtDay(new Date('2026-11-19T15:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('livreRules: minutos do Ao Vivo', () => {
  it('addLiveTime soma e limita o passo a 5 s; delta negativo não soma', () => {
    expect(LIVE_TICK_CAP_MS).toBe(5000)
    expect(addLiveTime(l0, 1000).usedMs).toBe(1000)
    expect(addLiveTime(l0, 60_000).usedMs).toBe(5000)
    expect(addLiveTime(l0, -10).usedMs).toBe(0)
  })

  it('addLiveTime ignora NaN e infinito e guarda o dia', () => {
    expect(addLiveTime(l0, Number.NaN).usedMs).toBe(0)
    expect(addLiveTime(l0, Number.POSITIVE_INFINITY).usedMs).toBe(0)
    expect(addLiveTime(l0, Number.NEGATIVE_INFINITY).usedMs).toBe(0)
    expect(addLiveTime({ day: '2026-11-19', usedMs: 4000 }, 1000)).toEqual({ day: '2026-11-19', usedMs: 5000 })
  })

  it('o computador dormindo uma hora gasta só um passo de 5 s', () => {
    let l = l0
    l = addLiveTime(l, 1000)
    l = addLiveTime(l, 3_600_000)
    l = addLiveTime(l, 1000)
    expect(l.usedMs).toBe(7000)
  })

  it('liveRemainingMs: 600000 de limite e 599000 usados sobra 1000; nunca negativo', () => {
    expect(liveRemainingMs({ day: '2026-11-19', usedMs: 599_000 }, 600_000)).toBe(1000)
    expect(liveRemainingMs({ day: '2026-11-19', usedMs: 600_000 }, 600_000)).toBe(0)
    expect(liveRemainingMs({ day: '2026-11-19', usedMs: 700_000 }, 600_000)).toBe(0)
    expect(liveRemainingMs(l0, 600_000)).toBe(600_000)
  })

  it('liveLedgerFor do mesmo dia devolve o tempo guardado', () => {
    expect(liveLedgerFor({ day: '2026-11-19', usedMs: 120_000 }, '2026-11-19')).toEqual({ day: '2026-11-19', usedMs: 120_000 })
  })

  it('liveLedgerFor de outro dia de Brasília volta zerado', () => {
    expect(liveLedgerFor({ day: '2026-11-18', usedMs: 600000 }, '2026-11-19').usedMs).toBe(0)
    expect(liveLedgerFor({ day: '2026-11-18', usedMs: 600000 }, '2026-11-19').day).toBe('2026-11-19')
  })

  it('a meia-noite de Brasília zera os minutos (03:00 UTC)', () => {
    const guardado = { day: brtDay(new Date('2026-12-01T02:30:00Z')), usedMs: 600_000 }
    expect(liveLedgerFor(guardado, brtDay(new Date('2026-12-01T02:59:00Z'))).usedMs).toBe(600_000)
    expect(liveLedgerFor(guardado, brtDay(new Date('2026-12-01T03:00:00Z'))).usedMs).toBe(0)
  })

  it('liveLedgerFor com formato errado ou nulo volta zerado', () => {
    const zerado = { day: '2026-11-19', usedMs: 0 }
    expect(liveLedgerFor(null, '2026-11-19')).toEqual(zerado)
    expect(liveLedgerFor('x', '2026-11-19')).toEqual(zerado)
    expect(liveLedgerFor({ day: '2026-11-19' }, '2026-11-19')).toEqual(zerado)
    expect(liveLedgerFor({ day: '2026-11-19', usedMs: 'muito' }, '2026-11-19')).toEqual(zerado)
    expect(liveLedgerFor({ day: '2026-11-19', usedMs: -5 }, '2026-11-19')).toEqual(zerado)
    expect(liveLedgerFor({ day: '2026-11-19', usedMs: Number.NaN }, '2026-11-19')).toEqual(zerado)
  })
})

describe('livreRules: anúncio da casa', () => {
  const home = { isLivre: true, quiet: true, lastHomeDay: '2026-11-18', today: '2026-11-19', bigAdThisSession: false }

  it('anúncio da tela inicial: uma vez por dia, só no Livre, só parado e sem outro anúncio grande na sessão', () => {
    expect(shouldShowHomeAd(home)).toBe(true)
    expect(shouldShowHomeAd({ ...home, lastHomeDay: null })).toBe(true)
    expect(shouldShowHomeAd({ ...home, lastHomeDay: '2026-11-19' })).toBe(false)
    expect(shouldShowHomeAd({ ...home, isLivre: false })).toBe(false)
    expect(shouldShowHomeAd({ ...home, quiet: false })).toBe(false)
    expect(shouldShowHomeAd({ ...home, bigAdThisSession: true })).toBe(false)
  })

  it('anúncio do fim da separação: só logo depois de separar, parado e sem outro anúncio grande na sessão', () => {
    const sep = { isLivre: true, quiet: true, justSeparated: true, bigAdThisSession: false }
    expect(shouldShowSeparationAd(sep)).toBe(true)
    expect(shouldShowSeparationAd({ ...sep, justSeparated: false })).toBe(false)
    expect(shouldShowSeparationAd({ ...sep, quiet: false })).toBe(false)
    expect(shouldShowSeparationAd({ ...sep, bigAdThisSession: true })).toBe(false)
    expect(shouldShowSeparationAd({ ...sep, isLivre: false })).toBe(false)
  })
})

describe('livreRules: fila que só mostra tela com a música parada', () => {
  it('queueRequest com a música tocando guarda e só mostra quando para', () => {
    const q = queueRequest(EMPTY, 'live', false)
    expect(q.shown).toBeNull()
    expect(queueSettle(q, true).shown).toBe('live')
    expect(queueSettle(q, true).pending).toBeNull()
  })

  it('tocando, o pedido mais novo vence e só ele aparece quando para', () => {
    const q = queueRequest(queueRequest(EMPTY, 'live', false), 'repertoire', false)
    expect(q).toEqual({ pending: 'repertoire', shown: null })
    expect(queueSettle(q, true)).toEqual({ pending: null, shown: 'repertoire' })
  })

  it('tocando com a tela aberta, a tela sai e não volta sozinha', () => {
    const q = queueSettle({ pending: null, shown: 'live' }, false)
    expect(q.shown).toBeNull()
    expect(queueSettle(q, true).shown).toBeNull()
  })

  it('pedido com a tela aberta e a música tocando: nada aparece tocando', () => {
    const q = queueRequest({ pending: null, shown: 'live' }, 'repertoire', false)
    expect(q.shown).toBeNull()
    expect(queueSettle(q, true).shown).toBe('repertoire')
  })

  it('queueRequest parado mostra na hora', () => {
    expect(queueRequest(EMPTY, 'repertoire', true).shown).toBe('repertoire')
    expect(queueRequest({ pending: null, shown: 'live' }, 'repertoire', true)).toEqual({ pending: null, shown: 'repertoire' })
  })

  it('queueSettle sem nada pra mudar devolve a mesma fila (o React não renderiza à toa)', () => {
    const parada: QuietQueue<string> = { pending: null, shown: 'live' }
    expect(queueSettle(parada, true)).toBe(parada)
    const tocando: QuietQueue<string> = { pending: 'live', shown: null }
    expect(queueSettle(tocando, false)).toBe(tocando)
    expect(queueSettle(EMPTY, true)).toBe(EMPTY)
    expect(queueSettle(EMPTY, false)).toBe(EMPTY)
  })

  it('queueDismiss fecha a tela aberta', () => {
    expect(queueDismiss({ pending: null, shown: 'live' })).toEqual({ pending: null, shown: null })
    expect(queueDismiss(EMPTY)).toBe(EMPTY)
  })
})

describe('livreRules: texto do arquivo', () => {
  it('nenhum travessão no código', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/livreRules.ts'), 'utf8')
    expect(src.includes(TRAVESSAO)).toBe(false)
  })
})
