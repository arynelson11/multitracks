import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Guarda de forma do motor (Ruling 5): o motor não tem teste de comportamento
// barato, então aqui só se confere que ele passa pela regra central de canais.
// O comportamento em si (solo, mute, pan, tom) é testado em src/lib/channelRoles.test.ts.
const src = readFileSync(fileURLToPath(new URL('./useAudioEngine.ts', import.meta.url)), 'utf8')

// Corpo de `const <nome> = ... => { ... }`, achado por chaves balanceadas (não depende de formatação).
function bodyOf(name: string): string {
  const start = src.search(new RegExp(`\\bconst\\s+${name}\\s*=`))
  if (start === -1) return ''
  const open = src.indexOf('{', src.indexOf('=>', start))
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

describe('motor usa a regra central de canais', () => {
  it('sem detector de click/guia por pedaço de nome', () => {
    expect(src).not.toMatch(/includes\(\s*['"`](click|metronomo|metronom|metro|guia|guide)['"`]\s*\)/i)
    expect(src).not.toMatch(/isClickOrGuideName/)
  })

  it('solo e mute passam pelo channelGain (solo não cala Click e Guia)', () => {
    expect(src).not.toMatch(/anySoloed\s*&&\s*!\s*\w+\.soloed/)
    expect(src).not.toMatch(/some\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.soloed\s*\)\s*&&\s*!\s*\w+\.soloed/)
    expect(src).toMatch(/channelGain\(/)
  })

  it('restauração, play, fader, M e Solo calculam o ganho pelo channelGain', () => {
    for (const fn of ['initEngine', 'play', 'updateVolume', 'toggleMute', 'toggleSolo']) {
      const body = bodyOf(fn)
      expect(body, `corpo de ${fn} não encontrado`).not.toBe('')
      expect(body, `${fn} sem channelGain`).toMatch(/\bchannelGain\s*\(/)
    }
  })

  it('troca de tom ignora Click e Guia pela regra central', () => {
    for (const fn of ['applyPitchToChannel', 'play']) {
      expect(bodyOf(fn), `${fn} sem isPitchExempt`).toMatch(/\bisPitchExempt\s*\(/)
    }
  })

  it('formantes seguem o papel da regra central (papel manual vale)', () => {
    expect(bodyOf('applyPitchToChannel')).toMatch(/\bwantsFormantCompensation\(\s*ch\.name\s*,\s*exempt\s*\)/)
  })

  it('importa os helpers da regra central', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/channelRoles['"]/)
    for (const fn of ['isPitchExempt', 'autoPanFor', 'pickMainChannel', 'channelGain']) {
      expect(src).toMatch(new RegExp(`\\b${fn}\\s*\\(`))
    }
  })
})
