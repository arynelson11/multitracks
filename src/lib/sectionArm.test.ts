import { describe, expect, it } from 'vitest'
import type { ArmIntent, Plays, StageGates } from './stageContracts'
import {
  afterLanding, armAt, armLabel, armRepeat, bandRepeat, isSelfLoop, stepSection, tapSection, toggleLoop,
  type ArmContext, type ArmResult,
} from './sectionArm'

const gates: StageGates = { sections: true, infinite: true, maxRepeats: 9, bandSections: true }
const livre: StageGates = { ...gates, sections: false, infinite: false }
// Seis seções (0 a 5), tocando a 1.
const ctx = (p: Partial<ArmContext> = {}): ArmContext => ({ current: 1, isPlaying: true, sectionCount: 6, gates, ...p })
const parado = { isPlaying: false }

const armed = (intent: ArmIntent | null): ArmResult => ({ intent, seekToSection: null, upgrade: false })
const seek = (i: number, intent: ArmIntent | null = null): ArmResult => ({ intent, seekToSection: i, upgrade: false })
const upgrade = (intent: ArmIntent | null): ArmResult => ({ intent, seekToSection: null, upgrade: true })
const i = (target: number, plays: Plays): ArmIntent => ({ target, plays })

type Row = [string, ArmIntent | null, number, Partial<ArmContext>, ArmResult]

describe('tapSection', () => {
  const rows: Row[] = [
    ['tocando, outra seção arma a PRÓXIMA com 1 passagem', null, 3, {}, armed(i(3, 1))],
    ['tocando, a atual arma REPETE uma vez', null, 1, {}, armed(i(1, 1))],
    ['tocar na armada cancela', i(3, 1), 3, {}, armed(null)],
    ['tocar na armada cancela o loop infinito', i(1, 'infinite'), 1, {}, armed(null)],
    ['tocar na armada cancela o REPETIR N', i(1, 3), 1, {}, armed(null)],
    ['tocar em outra troca o alvo com 1 passagem', i(3, 4), 5, {}, armed(i(5, 1))],
    ['tocar em outra troca o loop infinito pela PRÓXIMA', i(1, 'infinite'), 4, {}, armed(i(4, 1))],
    ['tocar na atual com outra armada troca pra REPETE', i(4, 1), 1, {}, armed(i(1, 1))],
    ['parado sem armado leva pro início', null, 4, parado, seek(4)],
    ['parado com armado leva pro início e desarma', i(3, 2), 1, parado, seek(1)],
    ['parado tocar na armada só leva pro início dela', i(3, 1), 3, parado, seek(3)],
    ['Livre tocando pede upgrade sem mudar nada', null, 1, { gates: livre }, upgrade(null)],
    ['Livre parado também pede upgrade', null, 1, { gates: livre, ...parado }, upgrade(null)],
    ['cancelar nunca pede plano', i(3, 1), 3, { gates: livre }, armed(null)],
    ['Livre parado, tocar na armada que sobrou (troca de plano) desarma sem pedir plano nem buscar', i(3, 1), 3, { gates: livre, ...parado }, armed(null)],
    ['Livre parado, tocar em outra com a armada que sobrou pede upgrade sem mudar nada', i(3, 1), 1, { gates: livre, ...parado }, upgrade(i(3, 1))],
    ['índice depois do fim: nada muda', i(3, 1), 6, {}, armed(i(3, 1))],
    ['índice negativo: nada muda', i(3, 1), -1, {}, armed(i(3, 1))],
    ['índice quebrado: nada muda', null, 2.5, {}, armed(null)],
    ['índice NaN: nada muda', null, NaN, {}, armed(null)],
    ['fora da lista no Livre não pede upgrade', null, 9, { gates: livre }, armed(null)],
    ['sem seções nada muda', null, 0, { sectionCount: 0 }, armed(null)],
  ]
  it.each(rows)('%s', (_, intent, index, patch, out) => expect(tapSection(intent, index, ctx(patch))).toEqual(out))
})

describe('stepSection', () => {
  const rows: [string, ArmIntent | null, -1 | 1, Partial<ArmContext>, ArmResult][] = [
    ['tocando sem armado, a seta pra frente arma a seguinte', null, 1, {}, armed(i(2, 1))],
    ['tocando sem armado, a seta pra trás arma a anterior', null, -1, {}, armed(i(0, 1))],
    ['parte do alvo armado', i(3, 1), 1, {}, armed(i(4, 1))],
    ['parte do alvo armado e troca o loop infinito por 1 passagem', i(3, 'infinite'), -1, {}, armed(i(2, 1))],
    ['voltar do alvo pra atual vira REPETE', i(2, 1), -1, {}, armed(i(1, 1))],
    ['preso no fim sem armado: nada muda', null, 1, { current: 5 }, armed(null)],
    ['preso no fim com a última armada: nada muda (não cancela)', i(5, 1), 1, {}, armed(i(5, 1))],
    ['preso no começo: nada muda', null, -1, { current: 0 }, armed(null)],
    ['parado leva pro início da seguinte', null, 1, parado, seek(2)],
    ['parado parte do armado e desarma', i(3, 1), 1, parado, seek(4)],
    ['parado preso no fim: nada muda', null, 1, { ...parado, current: 5 }, armed(null)],
    ['alvo armado fora da lista (seções removidas): pra frente parte da atual', i(7, 1), 1, {}, armed(i(2, 1))],
    ['alvo armado fora da lista: pra trás parte da atual', i(7, 'infinite'), -1, {}, armed(i(0, 1))],
    ['alvo armado negativo: parte da atual', i(-1, 2), 1, {}, armed(i(2, 1))],
    ['parado, alvo armado fora da lista: parte da atual', i(9, 2), 1, parado, seek(2)],
    ['Livre pede upgrade', null, 1, { gates: livre }, upgrade(null)],
    ['sem seções nada muda, nem no Livre', null, 1, { sectionCount: 0, gates: livre }, armed(null)],
  ]
  it.each(rows)('%s', (_, intent, dir, patch, out) => expect(stepSection(intent, dir, ctx(patch))).toEqual(out))
})

describe('armAt (REPETIR e banda)', () => {
  const rows: [string, ArmIntent | null, number, Plays, Partial<ArmContext>, ArmResult][] = [
    ['arma N passagens', null, 4, 3, {}, armed(i(4, 3))],
    ['arma o loop infinito', null, 4, 'infinite', {}, armed(i(4, 'infinite'))],
    ['acima do teto vira o teto', null, 4, 12, {}, armed(i(4, 9))],
    ['infinito numérico vira o teto', null, 4, Infinity, {}, armed(i(4, 9))],
    ['zero vira 1', null, 4, 0, {}, armed(i(4, 1))],
    ['negativo vira 1', null, 4, -2, {}, armed(i(4, 1))],
    ['NaN vira 1', null, 4, NaN, {}, armed(i(4, 1))],
    ['quebrado desce pro inteiro', null, 4, 2.7, {}, armed(i(4, 2))],
    ['teto 0 ou quebrado nunca passa de 1', null, 4, 5, { gates: { ...gates, maxRepeats: 0 } }, armed(i(4, 1))],
    ['teto quebrado desce pro inteiro', null, 4, 12, { gates: { ...gates, maxRepeats: 9.5 } }, armed(i(4, 9))],
    ['sem teto (maxRepeats infinito), número grande fica', null, 4, 12, { gates: { ...gates, maxRepeats: Infinity } }, armed(i(4, 12))],
    ['sem teto, infinito numérico é o loop sem fim, que o portão do infinito permite', null, 4, Infinity, { gates: { ...gates, maxRepeats: Infinity } }, armed(i(4, 'infinite'))],
    ['sem teto e sem o portão do infinito, infinito numérico pede upgrade', i(2, 1), 4, Infinity, { gates: { ...gates, maxRepeats: Infinity, infinite: false } }, upgrade(i(2, 1))],
    ['troca o que estava armado', i(2, 1), 4, 2, {}, armed(i(4, 2))],
    ['armar de novo o mesmo não cancela', i(4, 2), 4, 2, {}, armed(i(4, 2))],
    ['parado, outra seção: leva pra lá e a chegada é a 1ª passagem', null, 4, 3, parado, seek(4, i(4, 2))],
    ['parado, outra seção com 1 passagem: só leva pra lá e desarma', i(2, 1), 4, 1, parado, seek(4)],
    ['parado, outra seção com infinito: leva pra lá e segue em loop', null, 4, 'infinite', parado, seek(4, i(4, 'infinite'))],
    ['parado, acima do teto: leva pra lá e conta a partir do teto', null, 4, 12, parado, seek(4, i(4, 8))],
    ['parado, na atual: arma sem buscar', null, 1, 2, parado, armed(i(1, 2))],
    ['parado no Livre pede upgrade sem buscar', i(2, 1), 4, 2, { gates: livre, ...parado }, upgrade(i(2, 1))],
    ['Livre pede upgrade sem mudar nada', i(2, 1), 4, 2, { gates: livre }, upgrade(i(2, 1))],
    ['infinito sem o portão pede upgrade sem mudar nada', i(2, 1), 4, 'infinite', { gates: { ...gates, infinite: false } }, upgrade(i(2, 1))],
    ['número sem o portão do infinito arma', null, 4, 3, { gates: { ...gates, infinite: false } }, armed(i(4, 3))],
    ['índice fora da lista: nada muda', i(2, 1), 6, 2, {}, armed(i(2, 1))],
  ]
  it.each(rows)('%s', (_, intent, index, plays, patch, out) => expect(armAt(intent, index, plays, ctx(patch))).toEqual(out))
})

describe('armRepeat (na seção atual)', () => {
  const rows: [string, ArmIntent | null, Plays, Partial<ArmContext>, ArmResult][] = [
    ['arma N na atual', null, 3, {}, armed(i(1, 3))],
    ['troca a PRÓXIMA armada pela repetição da atual', i(4, 1), 2, {}, armed(i(1, 2))],
    ['mudar N com REPETIR armado re-arma', i(1, 3), 5, {}, armed(i(1, 5))],
    ['infinito na atual', null, 'infinite', {}, armed(i(1, 'infinite'))],
    ['acima do teto vira o teto', null, 20, {}, armed(i(1, 9))],
    ['abaixo de 1 vira 1', null, 0, {}, armed(i(1, 1))],
    ['parado arma na atual sem buscar', null, 3, parado, armed(i(1, 3))],
    ['parado, infinito na atual arma sem buscar', null, 'infinite', parado, armed(i(1, 'infinite'))],
    ['Livre pede upgrade', null, 3, { gates: livre }, upgrade(null)],
    ['infinito sem o portão pede upgrade', i(4, 1), 'infinite', { gates: { ...gates, infinite: false } }, upgrade(i(4, 1))],
    ['atual fora da lista: nada muda', null, 3, { current: -1 }, armed(null)],
  ]
  it.each(rows)('%s', (_, intent, plays, patch, out) => expect(armRepeat(intent, plays, ctx(patch))).toEqual(out))
})

describe('toggleLoop', () => {
  const rows: [string, ArmIntent | null, Partial<ArmContext>, ArmResult][] = [
    ['sem armado liga o loop infinito na atual', null, {}, armed(i(1, 'infinite'))],
    ['com o loop da atual armado, cancela', i(1, 'infinite'), {}, armed(null)],
    ['REPETIR N na atual vira loop infinito', i(1, 3), {}, armed(i(1, 'infinite'))],
    ['loop infinito armado em outra seção vira loop da atual', i(4, 'infinite'), {}, armed(i(1, 'infinite'))],
    ['PRÓXIMA armada vira loop da atual', i(4, 1), {}, armed(i(1, 'infinite'))],
    ['parado também liga', null, parado, armed(i(1, 'infinite'))],
    ['Livre pede upgrade', null, { gates: livre }, upgrade(null)],
    ['sem o portão do infinito pede upgrade', i(4, 1), { gates: { ...gates, infinite: false } }, upgrade(i(4, 1))],
    ['cancelar o loop nunca pede plano', i(1, 'infinite'), { gates: livre }, armed(null)],
    ['atual fora da lista: nada muda', i(4, 1), { current: 6 }, armed(i(4, 1))],
  ]
  it.each(rows)('%s', (_, intent, patch, out) => expect(toggleLoop(intent, ctx(patch))).toEqual(out))
})

describe('bandRepeat (sentido antigo do celular)', () => {
  const rows: [string, number, Plays, number, { target: number; plays: Plays }][] = [
    ['outra seção: N repetições depois de chegar = N + 1 passagens', 4, 2, 1, { target: 4, plays: 3 }],
    ['outra seção, 1 repetição = 2 passagens', 0, 1, 3, { target: 0, plays: 2 }],
    ['na atual: N passagens', 1, 2, 1, { target: 1, plays: 2 }],
    ['infinito continua infinito na outra', 4, 'infinite', 1, { target: 4, plays: 'infinite' }],
    ['infinito continua infinito na atual', 1, 'infinite', 1, { target: 1, plays: 'infinite' }],
  ]
  it.each(rows)('%s', (_, index, times, current, out) => expect(bandRepeat(index, times, current)).toEqual(out))

  // A banda passa por bandRepeat e depois armAt (adaptadores da T28); arm-jump é armAt com 1.
  const band = (index: number, times: Plays, patch: Partial<ArmContext> = {}) => {
    const c = ctx(patch); const b = bandRepeat(index, times, c.current); return armAt(null, b.target, b.plays, c)
  }
  it('parado, arm-jump leva pra seção e não deixa nada armado', () => expect(armAt(null, 4, 1, ctx(parado))).toEqual(seek(4)))
  it('parado, arm-loop N em outra leva pra lá e repete N vezes (N + 1 passagens, como na v1.4.16)', () => {
    expect(band(4, 2, parado)).toEqual(seek(4, i(4, 2)))
    expect(band(4, 1, parado)).toEqual(seek(4, i(4, 1)))
  })
  it('parado, arm-loop infinito em outra leva pra lá e segue em loop', () => expect(band(4, 'infinite', parado)).toEqual(seek(4, i(4, 'infinite'))))
  it('parado, arm-loop N na atual arma sem buscar', () => expect(band(1, 2, parado)).toEqual(armed(i(1, 2))))
  it('tocando, arm-loop N em outra arma N + 1 pousos sem buscar', () => expect(band(4, 2)).toEqual(armed(i(4, 3))))

  // Número vindo da rede como texto: o App não confere o tipo do value do arm-loop.
  const net = (v: string) => v as unknown as Plays
  it('texto numérico da rede vira número antes de somar, nunca concatena', () => {
    expect(bandRepeat(4, net('2'), 1)).toEqual({ target: 4, plays: 3 })
    expect(bandRepeat(1, net('2'), 1)).toEqual({ target: 1, plays: 2 })
    expect(band(4, net('2'))).toEqual(armed(i(4, 3)))
    expect(armAt(null, 4, net('3'), ctx())).toEqual(armed(i(4, 3)))
  })
  it('texto que não é número vira 1 passagem', () => {
    expect(band(4, net('abc'))).toEqual(armed(i(4, 1)))
    expect(armAt(null, 4, net(''), ctx())).toEqual(armed(i(4, 1)))
  })

  it('número fora do JSON (1e309 vira Infinity) cai no teto finito', () => expect(band(4, JSON.parse('1e309') as number)).toEqual(armed(i(4, 9))))

  it('passa pelo armAt, que aplica o teto do plano', () => {
    const b = bandRepeat(4, 9, 1)
    expect(armAt(null, b.target, b.plays, ctx()).intent).toEqual(i(4, 9))
  })
})

describe('afterLanding', () => {
  const rows: [string, ArmIntent, ArmIntent | null][] = [
    ['infinito continua', i(2, 'infinite'), i(2, 'infinite')],
    ['3 desce pra 2', i(2, 3), i(2, 2)],
    ['2 desce pra 1', i(2, 2), i(2, 1)],
    ['1 desarma', i(2, 1), null],
    ['0 desarma', i(2, 0), null],
    ['NaN desarma', i(2, NaN), null],
  ]
  it.each(rows)('%s', (_, intent, out) => expect(afterLanding(intent)).toEqual(out))
})

describe('armLabel e isSelfLoop', () => {
  it('rótulo do armado', () => {
    expect(armLabel(null, 2)).toBeNull()
    expect(armLabel(i(2, 3), 2)).toEqual({ kind: 'repete', plays: 3 })
    expect(armLabel(i(4, 1), 2)).toEqual({ kind: 'proxima', plays: 1 })
    expect(armLabel(i(2, 'infinite'), 2)).toEqual({ kind: 'repete', plays: 'infinite' })
    expect(armLabel(i(0, 'infinite'), 2)).toEqual({ kind: 'proxima', plays: 'infinite' })
  })
  it('loop da própria seção só com alvo igual e infinito', () => {
    expect(isSelfLoop(null, 2)).toBe(false)
    expect(isSelfLoop(i(2, 'infinite'), 2)).toBe(true)
    expect(isSelfLoop(i(2, 3), 2)).toBe(false)
    expect(isSelfLoop(i(4, 'infinite'), 2)).toBe(false)
  })
})

describe('casos fechados', () => {
  it('REPETIR 3 na atual pousa 3 vezes e desarma', () => {
    let a = armRepeat(null, 3, ctx({ current: 2 })).intent!
    expect(a).toEqual({ target: 2, plays: 3 }); expect(armLabel(a, 2)).toEqual({ kind: 'repete', plays: 3 })
    a = afterLanding(a)!; a = afterLanding(a)!; expect(afterLanding(a)).toBeNull()
  })
  it('Livre não arma e pede upgrade', () => expect(tapSection(null, 1, ctx({ gates: { ...gates, sections: false } }))).toEqual({ intent: null, seekToSection: null, upgrade: true }))
  it('parado leva pro início e desarma', () => expect(tapSection({ target: 3, plays: 1 }, 1, ctx({ isPlaying: false }))).toEqual({ intent: null, seekToSection: 1, upgrade: false }))
  it('repetir 2 da banda numa outra seção vira 3 passagens; na atual, 2', () => { expect(bandRepeat(4, 2, 1)).toEqual({ target: 4, plays: 3 }); expect(bandRepeat(1, 2, 1)).toEqual({ target: 1, plays: 2 }); expect(bandRepeat(4, 'infinite', 1)).toEqual({ target: 4, plays: 'infinite' }) })
  it('LOOP liga e desliga a mesma intenção', () => {
    const on = toggleLoop(null, ctx()).intent
    expect(isSelfLoop(on, 1)).toBe(true)
    expect(toggleLoop(on, ctx()).intent).toBeNull()
  })
})

describe('nunca muta a intenção recebida', () => {
  it('todas as funções com intenção congelada', () => {
    const frozen = (t: number, p: Plays) => Object.freeze(i(t, p))
    const c = ctx()
    const intents = [frozen(3, 2), frozen(1, 'infinite'), frozen(1, 3)]
    for (const a of intents) {
      const copy = { ...a }
      tapSection(a, 3, c); tapSection(a, 1, c); tapSection(a, 4, ctx(parado))
      stepSection(a, 1, c); stepSection(a, -1, c)
      armAt(a, 4, 5, c); armRepeat(a, 2, c); toggleLoop(a, c)
      afterLanding(a); armLabel(a, 1); isSelfLoop(a, 1)
      expect(a).toEqual(copy)
    }
  })
  it('quando nada muda, devolve a mesma intenção (identidade)', () => {
    const a = i(3, 2)
    const last = i(5, 1)
    const loop = i(2, 'infinite')
    const sem = { gates: livre }
    const semInfinito = { gates: { ...gates, infinite: false } }
    const pairs: [ArmIntent | null, ArmIntent | null][] = [
      [tapSection(a, 6, ctx()).intent, a], [tapSection(a, 1, ctx(sem)).intent, a], [tapSection(a, 1, ctx({ ...sem, ...parado })).intent, a],
      [stepSection(last, 1, ctx()).intent, last], [stepSection(a, 1, ctx({ sectionCount: 0 })).intent, a], [stepSection(a, 1, ctx(sem)).intent, a],
      [armAt(a, 4, 2, ctx(sem)).intent, a], [armAt(a, 4, 'infinite', ctx(semInfinito)).intent, a], [armAt(a, 9, 2, ctx()).intent, a],
      [armRepeat(a, 2, ctx({ current: -1 })).intent, a], [armRepeat(a, 2, ctx(sem)).intent, a],
      [toggleLoop(a, ctx({ current: 6 })).intent, a], [toggleLoop(a, ctx(sem)).intent, a], [toggleLoop(a, ctx(semInfinito)).intent, a],
      [afterLanding(loop), loop],
    ]
    for (const [got, given] of pairs) expect(got).toBe(given)
  })
  it('o que volta nunca é o mesmo objeto quando a intenção muda', () => {
    const a = i(1, 3)
    const r = armRepeat(a, 5, ctx()).intent
    expect(r).not.toBe(a)
    const d = afterLanding(a)
    expect(d).not.toBe(a)
  })
})
