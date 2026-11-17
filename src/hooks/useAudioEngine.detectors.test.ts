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

  // Junção com os ajustes do tom: o filtro de quem ainda precisa de worklet, o
  // viaPitch (que decide também o atraso de latência), o ganho do scheduleAll e o
  // pan do arquivo novo saem da regra central, não do nome.
  it('worklet que falta, viaPitch, ganho do scheduleAll e pan do arquivo novo pela regra central', () => {
    expect(src).toMatch(/const\s+missing\s*=\s*channels\.filter\(\s*ch\s*=>\s*!isPitchExempt\(ch\)/)
    expect(src).toMatch(/const\s+viaPitch\s*=\s*\(ch: Channel\)\s*=>\s*playPitch\s*!==\s*0\s*&&\s*!isPitchExempt\(ch\)/)
    const schedule = bodyOf('scheduleAll')
    expect(schedule, 'corpo de scheduleAll não encontrado').not.toBe('')
    expect(schedule).toMatch(/\bchannelGain\(\s*ch\s*,\s*channels\s*\)/)
    expect(schedule).not.toMatch(/anySoloed|\.soloed/)
    expect(src).toMatch(/const\s+routingFor\s*=[\s\S]{0,160}?=>\s*autoPanFor\(/)
  })

  // Formantes pela família da regra central (Vocal ou Backing, com o nome do usuário e
  // o papel manual), recebendo o canal inteiro: nunca o pedaço do nome do arquivo.
  it('formantes seguem a família da regra central (papel e nome do usuário valem)', () => {
    expect(bodyOf('applyPitchToChannel')).toMatch(/\bwantsFormantCompensation\(\s*ch\s*\)/)
    expect(src).toMatch(/import\s*\{[^}]*\bwantsFormantCompensation\b[^}]*\}\s*from\s*['"]\.\.\/lib\/channelRoles['"]/)
    expect(src).not.toMatch(/import\s*\{[^}]*\bwantsFormantCompensation\b[^}]*\}\s*from\s*['"]\.\.\/lib\/pitchRules['"]/)
    expect(src).not.toMatch(/wantsFormantCompensation\(\s*ch\.name/)
  })

  it('importa os helpers da regra central', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/channelRoles['"]/)
    for (const fn of ['isPitchExempt', 'autoPanFor', 'pickMainChannel', 'channelGain']) {
      expect(src).toMatch(new RegExp(`\\b${fn}\\s*\\(`))
    }
  })
})
