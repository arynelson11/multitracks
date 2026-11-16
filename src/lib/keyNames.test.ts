import { describe, expect, it } from 'vitest'
import { KEY_NAMES, keyIndex, transposeKeyName } from './keyNames'
import { keyToSemitone, normalizeChannelName, parseKey } from './pitchRules'

// Cópia literal do keyToSemitone de antes do parseKey (v1.4.16, motor de tom validado pelo dono).
// É a referência do "resultado igual": o keyToSemitone novo tem de dar exatamente isto em toda grafia.
const LEGACY_NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const LEGACY_SOLFEGE: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 }
const LEGACY_QUALITY = /^(m|min|minor|menor|maj|major|maior)?$/i
const legacyAccidental = (semitone: number, accidental: string): number =>
  (semitone + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12
const legacyKeyToSemitone = (key: string | null | undefined): number | null => {
  if (typeof key !== 'string') return null
  const k = key.trim().replace(/♯/g, '#').replace(/♭/g, 'b')
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(k)
  if (m && LEGACY_QUALITY.test(m[3].trim())) return legacyAccidental(LEGACY_NOTE[m[1].toLowerCase()], m[2])
  const s = /^(do|re|mi|fa|sol|la|si)\s*([#b]?)(.*)$/.exec(normalizeChannelName(k))
  if (s && LEGACY_QUALITY.test(s[3].trim())) return legacyAccidental(LEGACY_SOLFEGE[s[1]], s[2])
  return null
}

// Todas as grafias que o motor de tom já recebia (as do scripts/verify-pitch/unit.mjs) e o
// produto cruzado de tônica x acidente x espaço x qualidade x espaço em volta.
const UNIT_CASES = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'c', 'bb', 'f#', 'Am', 'F#m', 'Ebm',
  'C#m', 'C♯', 'B♭', ' G ', 'Cb', 'E#', 'B#', 'Xyz', 'H', '', '#', 'Cm7b5x', 'Dó', 'Do', 'dó', 'DO', 'Ré', 'Re', 'Mi', 'Fá', 'Fa',
  'Sol', 'SOL', 'Lá', 'La', 'Si', 'Lá m', 'Rém', 'Sol#', 'Sib', 'Si b', 'Mib', 'Fá#m', 'Dó#', 'Ré♭', 'Dó maior', 'Lá menor', 'Mi m',
  'Dob', 'Si#', ' Sol ', 'Sole', 'Lam7', 'Dó#x', 'Ut', 'Sold', '123', 'c#', 'Lá m', 'RÉ',
]
const TONICS = [
  ...'ABCDEFGabcdefg'.split(''),
  'do', 'Do', 'DO', 'dó', 'Dó', 'DÓ', 're', 'Re', 'RE', 'ré', 'Ré', 'RÉ', 'mi', 'Mi', 'MI', 'fa', 'Fa', 'FA', 'fá', 'Fá', 'FÁ',
  'sol', 'Sol', 'SOL', 'la', 'La', 'LA', 'lá', 'Lá', 'LÁ', 'si', 'Si', 'SI', 'H', 'X', 'Ut',
]
const ACCIDENTALS = ['', '#', 'b', '♯', '♭', 'B', '##', 'bb', 'x']
const GAPS = ['', ' ', '  ']
const QUALITIES = ['', 'm', 'M', 'min', 'MIN', 'Min', 'minor', 'Minor', 'menor', 'Menor', 'maj', 'MAJ', 'major', 'maior', 'Maior', 'm7', 'dim', 'sus4', 'mm', 'x']
const crossProduct = (): string[] => {
  const out: string[] = []
  for (const t of TONICS) for (const a of ACCIDENTALS) for (const g of GAPS) for (const q of QUALITIES) {
    const k = `${t}${a}${g}${q}`
    out.push(k, ` ${k} `, `\t${k}`)
  }
  return out
}

describe('KEY_NAMES', () => {
  it('os 12 nomes com sustenido, a partir de C', () => {
    expect([...KEY_NAMES]).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])
  })
  it('lista congelada (fonte única, ninguém muda por engano)', () => {
    expect(Object.isFrozen(KEY_NAMES)).toBe(true)
  })
  it('o nome de cada posição volta pra mesma posição', () => {
    KEY_NAMES.forEach((name, i) => expect(keyIndex(name)).toBe(i))
  })
})

describe('transposeKeyName', () => {
  it.each([['G', -1, 'F#'], ['Am', 2, 'Bm'], ['Bb', 1, 'B'], ['Lá m', 2, 'Bm'], ['X', 1, null], [null, 0, null]] as const)(
    'transpõe %s',
    (k, s, out) => expect(transposeKeyName(k, s)).toBe(out),
  )
  it.each([
    ['C', 12, 'C'], ['C', -1, 'B'], ['B', 1, 'C'], ['G', -12, 'G'], ['F#m', 0, 'F#m'], ['Ebm', 0, 'D#m'], ['Sib', 2, 'C'],
    ['Dó maior', 0, 'C'], ['Lá menor', 0, 'Am'], ['Rém', -2, 'Cm'], ['c#', 1, 'D'], ['Amaj', 0, 'A'], ['Cmin', 3, 'D#m'],
  ] as const)('%s com %s semitons vira %s', (k, s, out) => expect(transposeKeyName(k, s)).toBe(out))
  it('semitom inválido não transpõe e nunca devolve NaN', () => {
    expect(transposeKeyName('G', Number.NaN)).toBe('G')
    expect(transposeKeyName('G', Number.POSITIVE_INFINITY)).toBe('G')
    expect(transposeKeyName('Am', 1.4)).toBe('A#m')
  })
})

describe('keyIndex', () => {
  it.each([['C', 0], ['Db', 1], ['Sib', 10], ['Lá m', 9], ['B♭', 10], ['Xyz', null], ['', null], [null, null]] as const)(
    '%s é a posição %s',
    (k, i) => expect(keyIndex(k)).toBe(i),
  )
})

describe('parseKey', () => {
  it('parseKey e keyToSemitone concordam', () => {
    for (const k of ['C', 'F#m', 'Ebm', 'Sib', 'Rém', 'Lá m']) expect(parseKey(k)!.semitone).toBe(keyToSemitone(k))
  })
  it.each([
    ['Am', 9, true], ['F#m', 6, true], ['Ebmin', 3, true], ['C minor', 0, true], ['Dó menor', 0, true], ['Lá m', 9, true],
    ['Rém', 2, true], ['A', 9, false], ['Cmaj', 0, false], ['Sol maior', 7, false], ['Sib', 10, false], ['bb', 10, false],
  ] as const)('%s: semitom %s, menor %s', (k, semitone, minor) => expect(parseKey(k)).toEqual({ semitone, minor }))
  it('o que keyToSemitone não reconhece, parseKey também não', () => {
    for (const k of ['Xyz', 'H', '', '#', 'Cm7b5x', 'Sole', 'Lam7', 'Ut']) expect(parseKey(k)).toBeNull()
    expect(parseKey(null)).toBeNull()
    expect(parseKey(undefined)).toBeNull()
  })
  it('keyToSemitone igual ao de antes em todo tom e grafia que já aceitava (e no que recusava)', () => {
    const keys = [...UNIT_CASES, ...crossProduct()]
    let accepted = 0
    for (const k of keys) {
      const before = legacyKeyToSemitone(k)
      if (before !== null) accepted++
      expect(keyToSemitone(k), JSON.stringify(k)).toBe(before)
      expect(parseKey(k)?.semitone ?? null, JSON.stringify(k)).toBe(before)
    }
    // A comparação cobre de verdade os dois lados: milhares de grafias aceitas e outras tantas recusadas.
    expect(accepted).toBeGreaterThan(5000)
    expect(keys.length - accepted).toBeGreaterThan(5000)
    for (const odd of [null, undefined, 7, {}, ['C']]) {
      const k = odd as unknown as string | null
      expect(keyToSemitone(k)).toBe(legacyKeyToSemitone(k))
    }
  })
})
