import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { shouldAutoAdvance } from './autoAdvance'

// T9 (Parte 3): o AUTO (passar sozinho pra próxima música no fim) só acontece quando o plano
// permite. A regra é pura; a ligação no motor é conferida no texto do código, no padrão do
// appWiring.test.ts (o motor inteiro não monta aqui).

const engine = readFileSync(fileURLToPath(new URL('../hooks/useAudioEngine.ts', import.meta.url)), 'utf8')
// O corpo do fim da música no motor (do checkSongEnd até a ref que o tique do Worker usa).
const songEnd = (() => {
  const start = engine.indexOf('const checkSongEnd')
  const end = engine.indexOf('const songEndRef', start)
  return start >= 0 && end > start ? engine.slice(start, end) : ''
})()
const TRAVESSAO = String.fromCharCode(0x2014)

describe('shouldAutoAdvance', () => {
  it('continue com próxima música e permitido avança', () => {
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 0, length: 2, allowed: true })).toBe(true)
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 1, length: 3, allowed: true })).toBe(true)
  })

  it('não permitido (Livre) não avança', () => {
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 0, length: 2, allowed: false })).toBe(false)
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 1, length: 3, allowed: false })).toBe(false)
  })

  it('stop e fade-out não avançam; a última música não avança', () => {
    expect(shouldAutoAdvance({ mode: 'stop', activeIndex: 0, length: 2, allowed: true })).toBe(false)
    expect(shouldAutoAdvance({ mode: 'fade-out', activeIndex: 0, length: 2, allowed: true })).toBe(false)
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 1, length: 2, allowed: true })).toBe(false)
    expect(shouldAutoAdvance({ mode: 'continue', activeIndex: 0, length: 1, allowed: true })).toBe(false)
    expect(shouldAutoAdvance({ mode: 'stop', activeIndex: 1, length: 2, allowed: false })).toBe(false)
  })
})

describe('AUTO no motor', () => {
  it('o fim da música no motor passa por shouldAutoAdvance com o autoNext', () => {
    expect(engine).toMatch(/shouldAutoAdvance\(\{[^}]*allowed:\s*autoNext/)
  })

  it('autoNext é opção do hook e nasce verdadeiro (quem paga segue igual à v1.4.22)', () => {
    expect(engine).toMatch(/export function useAudioEngine\(userId\?: string, opts\?: \{[^}]*autoNext\?: boolean/)
    expect(engine).toMatch(/const autoNext = opts\?\.autoNext \?\? true;/)
  })

  it('o timer da próxima só nasce dentro da regra: sem AUTO, o fim para como no stop', () => {
    expect(songEnd).not.toBe('')
    // Um timer só no fim da música, e ele fica dentro do if da regra.
    expect(songEnd.match(/setTimeout\(/g)).toHaveLength(1)
    expect(songEnd).toMatch(/if \(shouldAutoAdvance\(\{[^}]*\}\)\) \{\s*if \(autoNextTimeoutRef\.current\) clearTimeout\(autoNextTimeoutRef\.current\);\s*autoNextTimeoutRef\.current = window\.setTimeout\(/)
    // Antes da regra o fim é o mesmo pra todo modo: para a VS e cala os nós (o caminho do stop).
    const gate = songEnd.indexOf('shouldAutoAdvance(')
    expect(songEnd.slice(0, gate)).toMatch(/setIsPlaying\(false\);\s*stopAllNodes\(\);/)
  })

  it('nenhum travessão nos arquivos da T9', () => {
    const rule = readFileSync(fileURLToPath(new URL('./autoAdvance.ts', import.meta.url)), 'utf8')
    expect(rule.includes(TRAVESSAO)).toBe(false)
  })
})
