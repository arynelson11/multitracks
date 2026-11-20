// Separador no Livre (Parte 3), conferido no texto do código como no appWiring.test.ts: o
// SeparatorStudio inteiro não monta no teste. A T14 põe as opções de faixas pelo plano
// (Ruling R7: o teste saiu da T19); a T19 acrescenta aqui o resto do Separador no Livre.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const sep = read('./SeparatorStudio.tsx')
const TRAVESSAO = String.fromCharCode(0x2014)

// A tela de opções: do `if` dela até o `if` da tela de envio, logo abaixo.
const start = sep.indexOf("if (separationStep === 'options' && pendingFile)")
const end = sep.indexOf("if (separationStep === 'upload' && !file && stems.length === 0)")
const optionsScreen = sep.slice(start, end)

describe('Separador no Livre', () => {
  it('as opções de faixas vêm de separationStemOptions', () => {
    expect(sep).toMatch(/separationStemOptions\(userPlan\)/)
  })

  it('a tela de opções não decide o plano sozinha: nenhum 2, 4 ou 6 fixo, sem cadeado e sem selo PRO', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(optionsScreen).toMatch(/stemOptions[\s\S]*?\.map\(/)
    expect(optionsScreen).not.toMatch(/handleSelectOption\(\s*[246]/)
    expect(optionsScreen).not.toMatch(/<Lock\b/)
    expect(optionsScreen).not.toMatch(/canUsePro|canUseStudio|planTier\(/)
    expect(optionsScreen).not.toMatch(/>PRO</)
    expect(optionsScreen).not.toContain(TRAVESSAO)
  })

  it('admin nunca tem a trava do Livre: vê as opções de quem paga', () => {
    expect(optionsScreen).toMatch(/isAdmin\s*\?\s*ALL_STEM_COUNTS\s*:\s*separationStemOptions\(userPlan\)/)
  })
})
