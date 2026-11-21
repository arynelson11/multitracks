// Tirar música do repertório (D4: vale pra todos) e o portão do Livre na troca que isso faz
// (ajuste do coordenador na T17): a conta de quem vira a atual e a recusa, com a regra de verdade
// das músicas do mês (livreRules), sem o App.
import { describe, expect, it } from 'vitest'
import { NO_CURRENT_SONG, nextSongAfter, removalOpensRefusedSong, songOpenedByRemoval } from './songRemoval'
import { decideOpen, stageLedgerFor, stageSongKey } from './livreRules'

type S = { id: string; sourceId?: string; duration: number; channels: { name: string }[] }
const song = (id: string, sourceId?: string): S => ({ id, sourceId, duration: 200, channels: [{ name: 'Bateria' }, { name: 'Baixo' }] })
const A = song('a')
const B = song('b')
const C = song('c')

const MONTH = '2026-11'
// O portão do Livre como o useLivre faz (canOpenSong): a regra decideOpen sobre o registro do mês.
const livreGate = (keys: string[], limit = 3) => {
  const ledger = stageLedgerFor({ month: MONTH, keys }, MONTH)
  return (s: S) => {
    const key = stageSongKey(s)
    return key === null || decideOpen(ledger, key, limit).allowed
  }
}
const paid = () => true

describe('songOpenedByRemoval: quem vira a atual quando uma música sai', () => {
  it('tirando a atual, a que vinha depois vira a atual (índice no repertório sem ela)', () => {
    expect(songOpenedByRemoval([A, B, C], 0, 'a')).toEqual({ index: 0, song: B })
    expect(songOpenedByRemoval([A, B, C], 1, 'b')).toEqual({ index: 1, song: C })
  })

  it('tirando a atual que era a última, a anterior vira a atual', () => {
    expect(songOpenedByRemoval([A, B, C], 2, 'c')).toEqual({ index: 1, song: B })
  })

  it('tirando outra música, nenhuma vira a atual por isso', () => {
    expect(songOpenedByRemoval([A, B, C], 0, 'b')).toBeNull()
    expect(songOpenedByRemoval([A, B, C], 2, 'a')).toBeNull()
  })

  it('tirando a única música, ou uma que não está no repertório, nenhuma vira a atual', () => {
    expect(songOpenedByRemoval([A], 0, 'a')).toBeNull()
    expect(songOpenedByRemoval([A, B], 0, 'z')).toBeNull()
  })

  it('sem música atual (NO_CURRENT_SONG), tirar qualquer uma não abre nada', () => {
    expect(songOpenedByRemoval([A, B], NO_CURRENT_SONG, 'a')).toBeNull()
  })
})

describe('removalOpensRefusedSong: o portão do Livre na troca que tirar a atual faz', () => {
  it('Livre com o mês cheio: apagar a contada não deixa a nova como atual', () => {
    // A já conta no mês (com outras duas); B é nova. Tirar A abriria B: recusado.
    expect(removalOpensRefusedSong([A, B], 0, 'a', livreGate(['song:a', 'cloud:x', 'song:y']))).toBe(true)
  })

  it('Livre com o mês cheio: a seguinte já contada no mês abre', () => {
    expect(removalOpensRefusedSong([A, B], 0, 'a', livreGate(['song:a', 'song:b', 'song:y']))).toBe(false)
  })

  it('Livre com o mês cheio: a seguinte do catálogo conta pela chave da nuvem', () => {
    const cloud = song('b2', 'nuvem-7')
    expect(removalOpensRefusedSong([A, cloud], 0, 'a', livreGate(['song:a', 'cloud:nuvem-7', 'song:y']))).toBe(false)
    expect(removalOpensRefusedSong([A, cloud], 0, 'a', livreGate(['song:a', 'cloud:outra', 'song:y']))).toBe(true)
  })

  it('Livre com vaga no mês: a nova abre (e conta quando virar a atual)', () => {
    expect(removalOpensRefusedSong([A, B], 0, 'a', livreGate(['song:a', 'song:y']))).toBe(false)
  })

  it('Livre com o mês cheio: tirar outra música (não a atual) nunca é recusado', () => {
    expect(removalOpensRefusedSong([A, B, C], 0, 'b', livreGate(['song:a', 'song:x', 'song:y']))).toBe(false)
  })

  it('o metrônomo infinito não conta: abre mesmo com o mês cheio', () => {
    const metronome: S = { id: 'm', duration: 36000, channels: [{ name: 'Metronomo Loop' }] }
    expect(removalOpensRefusedSong([A, metronome], 0, 'a', livreGate(['song:a', 'song:x', 'song:y']))).toBe(false)
  })

  it('quem paga (o portão sempre abre) nunca é recusado', () => {
    expect(removalOpensRefusedSong([A, B], 0, 'a', paid)).toBe(false)
    expect(removalOpensRefusedSong([A, B, C], 2, 'c', paid)).toBe(false)
  })
})

// Revisão macro 1b (parte 2, M3): sem música atual não há "próxima" pro celular da banda; antes
// o índice -1 + 1 mostrava a primeira do repertório como a próxima.
describe('nextSongAfter', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('a que vem depois da atual; na última, nenhuma', () => {
    expect(nextSongAfter(list, 0)).toEqual({ id: 'b' })
    expect(nextSongAfter(list, 1)).toEqual({ id: 'c' })
    expect(nextSongAfter(list, 2)).toBeNull()
  })
  it('sem música atual (ou com índice fora do repertório), nenhuma', () => {
    expect(nextSongAfter(list, NO_CURRENT_SONG)).toBeNull()
    expect(nextSongAfter(list, -5)).toBeNull()
    expect(nextSongAfter(list, 7)).toBeNull()
    expect(nextSongAfter([], 0)).toBeNull()
  })
})
