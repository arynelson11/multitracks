import { describe, expect, it } from 'vitest'
import type { TimelineSegment } from './stageContracts'
import { ctxTimeOf, dropFrom, heardTime, positionAt, pruneBefore, segmentAt, withSegment } from './playTimeline'

// Linha do tempo de referência: tocando desde 10 s do contexto a partir de 0:30 da música,
// com o pulo agendado pra 0:08 no instante 14 s do contexto. Congelada: nenhuma função mexe nela.
const frozen = (list: TimelineSegment[]): readonly TimelineSegment[] => Object.freeze(list.map((s) => Object.freeze({ ...s })))
const SEGS = frozen([{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }])

it('posição pela linha do tempo, com o pulo agendado', () => {
  const segs = [{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }]
  expect(positionAt(segs, 9)).toBe(30); expect(positionAt(segs, 12)).toBe(32); expect(positionAt(segs, 14)).toBe(8); expect(positionAt(segs, 15.5)).toBe(9.5)
  expect(dropFrom(segs, 13)).toEqual(segs.slice(0, 1)); expect(pruneBefore(segs, 15)).toEqual(segs.slice(1))
})
it('conversão pro contexto usa o segmento vigente, não o futuro', () => {
  const segs = [{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }]
  expect(ctxTimeOf(segs, 33, 12)).toBe(13)   // vigente em 12: o primeiro
  expect(ctxTimeOf(segs, 10, 14.5)).toBe(16) // vigente em 14,5: o segundo
})
it('tempo ouvido', () => expect(heardTime(10, 0.02, NaN)).toBeCloseTo(9.98))

describe('segmentAt', () => {
  it('o último que já começou; antes do primeiro, o primeiro; sem segmento, nulo', () => {
    expect(segmentAt([], 5)).toBeNull()
    expect(segmentAt(SEGS, 9)).toBe(SEGS[0])
    expect(segmentAt(SEGS, 10)).toBe(SEGS[0])
    expect(segmentAt(SEGS, 13.999)).toBe(SEGS[0])
    expect(segmentAt(SEGS, 14)).toBe(SEGS[1])
    expect(segmentAt(SEGS, 99)).toBe(SEGS[1])
  })
})

describe('positionAt', () => {
  it('anda na velocidade pedida e não volta antes do primeiro segmento', () => {
    const one = frozen([{ ctxStart: 10, songStart: 30 }])
    expect(positionAt(one, 12, 1.25)).toBe(32.5)
    expect(positionAt(one, 9, 1.25)).toBe(30)
    expect(positionAt(one, 12, 0.5)).toBe(31)
  })
  it('sem segmento a posição é 0:00', () => expect(positionAt([], 12)).toBe(0))
})

describe('ctxTimeOf', () => {
  it('REPETIR: com o pulo pra 0:08 já agendado em 14, o fim da volta atual (0:34) cai em 14, não em 40', () => {
    // Antes do pulo o vigente é o primeiro: 0:34 da música toca em 14 s do contexto.
    // (O segmento futuro daria 14 + (34 - 8) = 40: a segunda volta seria agendada uma seção depois.)
    expect(ctxTimeOf(SEGS, 34, 13.5)).toBe(14)
    // Depois de pousar, a próxima volta (fim em 0:12) é convertida pelo segmento novo.
    expect(ctxTimeOf(SEGS, 12, 14.2)).toBe(18)
  })
  it('no instante exato do pulo o vigente já é o novo', () => expect(ctxTimeOf(SEGS, 9, 14)).toBe(15))
  it('antes do primeiro segmento (play agendado e ainda não começou) usa o primeiro', () => expect(ctxTimeOf(SEGS, 31, 9)).toBe(11))
  it('divide pela velocidade e é o inverso de positionAt', () => {
    const one = frozen([{ ctxStart: 10, songStart: 30 }])
    expect(ctxTimeOf(one, 32.5, 11, 1.25)).toBe(12)
    for (const t of [10, 11.3, 13.99]) expect(ctxTimeOf(SEGS, positionAt(SEGS, t, 0.8), t, 0.8)).toBeCloseTo(t, 9)
    for (const t of [14, 14.7, 20]) expect(ctxTimeOf(SEGS, positionAt(SEGS, t, 1.1), t, 1.1)).toBeCloseTo(t, 9)
  })
  it('sem segmento não há conversão: NaN (o Web Audio recusa, não agenda em lugar errado)', () => expect(ctxTimeOf([], 30, 10)).toBeNaN())
})

describe('withSegment, dropFrom e pruneBefore', () => {
  it('withSegment troca o segmento que começa no mesmo instante ou depois e acrescenta no fim', () => {
    const novo = { ctxStart: 14, songStart: 50 }
    expect(withSegment(SEGS, novo)).toEqual([SEGS[0], novo])
    const antes = { ctxStart: 12, songStart: 0 }
    expect(withSegment(SEGS, antes)).toEqual([SEGS[0], antes])
    const depois = { ctxStart: 20, songStart: 40 }
    expect(withSegment(SEGS, depois)).toEqual([...SEGS, depois])
    expect(withSegment([], novo)).toEqual([novo])
    expect(SEGS).toEqual([{ ctxStart: 10, songStart: 30 }, { ctxStart: 14, songStart: 8 }])
  })
  it('dropFrom tira o que começa no instante pedido ou depois (cancelar o pulo agendado)', () => {
    expect(dropFrom(SEGS, 14)).toEqual([SEGS[0]])
    expect(dropFrom(SEGS, 14.0001)).toEqual([...SEGS])
    expect(dropFrom(SEGS, 9)).toEqual([])
    expect(dropFrom([], 9)).toEqual([])
    // Cancelar devolve a posição de antes do pulo.
    expect(positionAt(dropFrom(SEGS, 14), 15)).toBe(35)
  })
  it('pruneBefore guarda o segmento vigente e tudo o que vem depois', () => {
    expect(pruneBefore(SEGS, 14)).toEqual([SEGS[1]])
    expect(pruneBefore(SEGS, 13.9)).toEqual([...SEGS])
    expect(pruneBefore(SEGS, 5)).toEqual([...SEGS])
    expect(pruneBefore([], 5)).toEqual([])
  })
  it('pruneBefore não muda nenhuma posição dali pra frente', () => {
    for (const cut of [5, 11, 14, 16]) {
      const pruned = pruneBefore(SEGS, cut)
      for (const t of [cut, cut + 0.5, cut + 3]) expect(positionAt(pruned, t)).toBe(positionAt(SEGS, t))
    }
  })
})

describe('heardTime', () => {
  it('desconta a latência da saída e a da entrada do canal', () => expect(heardTime(10, 0.02, 0.005)).toBeCloseTo(9.975, 9))
  it('latência não finita conta 0', () => {
    expect(heardTime(10, Infinity, 0.01)).toBeCloseTo(9.99, 9)
    expect(heardTime(10, NaN, -Infinity)).toBe(10)
  })
})
