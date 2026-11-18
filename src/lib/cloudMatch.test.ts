import { describe, expect, it } from 'vitest'
import { cloudSongOf } from './cloudMatch'

const nuvem = [
  { id: 'n1', name: 'Santo' },
  { id: 'n2', name: 'Santo Espírito' },
  { id: 'n3', name: 'Aleluia' },
]

describe('cloudSongOf (marcadores e letra na música certa)', () => {
  it('acha pela id da nuvem (sourceId), nunca pelo nome', () => {
    expect(cloudSongOf(nuvem, { name: 'Artista - Santo Espírito', sourceId: 'n2' })).toBe(nuvem[1])
    // O nome que "contém" outro não manda: a id manda.
    expect(cloudSongOf(nuvem, { name: 'Santo', sourceId: 'n3' })).toBe(nuvem[2])
  })
  it('sem sourceId não acha nada (fica só no aparelho), mesmo com o nome igual', () => {
    expect(cloudSongOf(nuvem, { name: 'Santo' })).toBeNull()
    expect(cloudSongOf(nuvem, { name: 'Artista - Santo Espírito', sourceId: '' })).toBeNull()
  })
  it('sourceId que não está mais na nuvem: nulo', () => {
    expect(cloudSongOf(nuvem, { name: 'Santo', sourceId: 'apagada' })).toBeNull()
  })
})
