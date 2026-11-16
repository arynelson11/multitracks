import { describe, expect, it } from 'vitest'
import type { Marker } from '../types'
import { FAMILY_COLOR } from './channelNames'
import { addSectionAt, nudgeSection, removeSection } from './sectionEdit'
import { SECTION_NAME_MAX, SECTION_SHORTCUTS, colorForSection, normalizeSectionName } from './sectionTypes'
import * as fromSectionBar from '../components/SectionBar'
import type { SongGrid } from './stageContracts'

// 120 BPM em 4/4 com o 1 em 0:00: compasso de 2 s, meio compasso de 1 s, 1/4 de compasso de 0,5 s.
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
// Mesmo BPM sem fase (só o BPM salvo): não encaixa e a vizinhança é de 0,5 s.
const semFase: SongGrid = { ...grid, source: 'bpm', meterSource: 'padrao' }

const VERSO = '#10b981'
const REFRAO = '#FF6B35'
const mk = (id: string, time: number, label = 'Verso', color = VERSO): Marker => ({ id, time, label, color })
const freeze = (list: Marker[]): readonly Marker[] => Object.freeze(list.map((m) => Object.freeze({ ...m })))
const idGen = (...ids: string[]) => { let i = 0; return () => ids[i++] ?? `x${i}` }

describe('sectionTypes', () => {
  // Cópia literal do que o SectionBar exportava antes da T16.
  const ANTES = [
    { name: 'Intro', key: 'I', code: 'KeyI', color: '#3b82f6' },
    { name: 'Verso', key: 'V', code: 'KeyV', color: '#10b981' },
    { name: 'Pré', key: 'P', code: 'KeyP', color: '#f59e0b' },
    { name: 'Refrão', key: 'R', code: 'KeyR', color: '#FF6B35' },
    { name: 'Ponte', key: 'B', code: 'KeyB', color: '#8b5cf6' },
    { name: 'Final', key: 'F', code: 'KeyF', color: '#ec4899' },
  ]
  const antesColor = (label: string): string =>
    ANTES.find((s) => s.name.toLowerCase() === label.trim().toLowerCase())?.color || '#FF6B35'

  it('sectionTypes é igual ao que o SectionBar exportava', () => {
    expect(SECTION_SHORTCUTS).toEqual(ANTES)
    // Quem importa do SectionBar recebe o mesmo objeto e a mesma função.
    expect(fromSectionBar.SECTION_SHORTCUTS).toBe(SECTION_SHORTCUTS)
    expect(fromSectionBar.colorForSection).toBe(colorForSection)
    for (const label of ['Intro', 'verso', '  PRÉ ', 'Refrão', 'ponte', 'Final', 'Coro 1', '', 'Ministração']) {
      expect(colorForSection(label), label).toBe(antesColor(label))
    }
  })

  it('nenhum tipo de seção repete cor de família de canal (Ruling T21)', () => {
    const familias = new Set(Object.values(FAMILY_COLOR).map((c) => c.toLowerCase()))
    for (const s of SECTION_SHORTCUTS) expect(familias.has(s.color.toLowerCase()), s.name).toBe(false)
    expect(familias.has(colorForSection('nome do usuário').toLowerCase())).toBe(false)
  })

  it('nome de seção tem até 14 caracteres (Ruling T8-4)', () => {
    expect(SECTION_NAME_MAX).toBe(14)
    expect(normalizeSectionName('  Refrão   final ')).toBe('Refrão final')
    expect(normalizeSectionName('Ministração final especial')).toBe('Ministração fi')
    expect(normalizeSectionName('Ministração final especial')).toHaveLength(14)
    // Corte que cairia no espaço não deixa espaço sobrando; nem parte um emoji ao meio.
    expect(normalizeSectionName('Ponte da cruz aberta')).toBe('Ponte da cruz')
    expect(normalizeSectionName('Abertura gera\u{1F525}l')).toBe('Abertura gera')
    expect(normalizeSectionName('   ')).toBe('')
  })
})

describe('addSectionAt', () => {
  it('marca nova nasce encaixada e colorida', () =>
    expect(addSectionAt([], 8.3, 'Refrão', grid, () => 'n')).toEqual([{ id: 'n', time: 8, label: 'Refrão', color: '#FF6B35' }]))

  it('marca perto de outra troca o rótulo em vez de duplicar', () => {
    const verso: Marker = { id: 'a', time: 8, label: 'Verso', color: VERSO, lyrics: 'Santo, santo' }
    // 8,9 não encaixa (a barra de 8 está a 0,9 s, mais que 1/4 de compasso), mas fica a menos de meio compasso da marca.
    expect(addSectionAt(freeze([verso]), 8.9, 'Refrão', grid, () => 'n'))
      .toEqual([{ id: 'a', time: 8, label: 'Refrão', color: REFRAO, lyrics: 'Santo, santo' }])
    // A meio compasso ou mais nasce outra.
    expect(addSectionAt(freeze([verso]), 9, 'Refrão', grid, () => 'n').map((m) => [m.id, m.time])).toEqual([['a', 8], ['n', 9]])
    expect(addSectionAt(freeze([verso]), 10.2, 'Refrão', grid, () => 'n').map((m) => [m.id, m.time])).toEqual([['a', 8], ['n', 10]])
    // Com duas por perto, troca a mais perto.
    const duas = freeze([mk('a', 8), mk('b', 8.6, 'Pré')])
    expect(addSectionAt(duas, 8.7, 'Ponte', semFase, () => 'n').map((m) => [m.id, m.label])).toEqual([['a', 'Verso'], ['b', 'Ponte']])
  })

  it('sem fase não encaixa e a vizinhança é de 0,5 s', () => {
    const verso = freeze([mk('a', 8)])
    for (const g of [semFase, null]) {
      expect(addSectionAt(verso, 8.4, 'Refrão', g, () => 'n')).toEqual([{ id: 'a', time: 8, label: 'Refrão', color: REFRAO }])
      expect(addSectionAt(verso, 8.6, 'Refrão', g, () => 'n')).toEqual([mk('a', 8), { id: 'n', time: 8.6, label: 'Refrão', color: REFRAO }])
    }
  })

  it('devolve a lista ordenada e nunca muta a recebida', () => {
    const lista = freeze([mk('r', 20, 'Refrão', REFRAO), mk('i', 0, 'Intro', '#3b82f6')])
    const out = addSectionAt(lista, 10.1, 'Verso', grid, idGen('v'))
    expect(out.map((m) => [m.id, m.time])).toEqual([['i', 0], ['v', 10], ['r', 20]])
    expect(out).not.toBe(lista)
    expect(lista.map((m) => m.id)).toEqual(['r', 'i'])
    // A marca trocada é um objeto novo; a antiga fica como estava.
    const trocada = addSectionAt(lista, 20.2, 'Final', grid, () => 'n')
    expect(trocada.find((m) => m.id === 'r')).toEqual(mk('r', 20, 'Final', '#ec4899'))
    expect(lista[0]).toEqual(mk('r', 20, 'Refrão', REFRAO))
  })

  it('cor pelo tipo, nome limitado a 14 caracteres e nome vazio não cria', () => {
    expect(addSectionAt([], 4, 'ponte', grid, () => 'n')[0].color).toBe('#8b5cf6')
    expect(addSectionAt([], 4, 'Ministração final especial', grid, () => 'n'))
      .toEqual([{ id: 'n', time: 4, label: 'Ministração fi', color: '#FF6B35' }])
    const lista = freeze([mk('a', 8)])
    expect(addSectionAt(lista, 2, '   ', grid, () => 'n')).toEqual([mk('a', 8)])
  })

  it('0:00 e tempo antes dele viram 0:00; tempo que não é número não cria', () => {
    expect(addSectionAt([], -1, 'Intro', grid, () => 'n')[0].time).toBe(0)
    expect(addSectionAt([], 0.2, 'Intro', null, () => 'n')[0].time).toBe(0.2)
    expect(addSectionAt(freeze([mk('a', 8)]), Number.NaN, 'Intro', grid, () => 'n')).toEqual([mk('a', 8)])
  })

  it('grade sem fase usável (BPM fora da faixa) não encaixa', () => {
    const quebrada: SongGrid = { ...grid, bpm: 1000 }
    expect(addSectionAt([], 8.3, 'Verso', quebrada, () => 'n')[0].time).toBe(8.3)
  })
})

describe('nudgeSection', () => {
  const tres = () => freeze([mk('i', 0, 'Intro'), mk('v', 8), mk('r', 12, 'Refrão', REFRAO)])
  const timeOf = (list: readonly Marker[], id: string) => list.find((m) => m.id === id)?.time

  it('ajustar 1 compasso respeita as vizinhas', () => {
    expect(timeOf(nudgeSection(tres(), 'v', 1, grid), 'v')).toBe(10)
    expect(timeOf(nudgeSection(tres(), 'v', -1, grid), 'v')).toBe(6)
    // 2 compassos pra frente cairia em cima do Refrão (12): anda só o que cabe, de compasso inteiro.
    expect(timeOf(nudgeSection(tres(), 'v', 2, grid), 'v')).toBe(10)
    // 4 pra trás cairia em cima da Intro (0): para a 1 compasso dela.
    expect(timeOf(nudgeSection(tres(), 'v', -4, grid), 'v')).toBe(2)
    // Vizinha a menos de 1 compasso: não anda.
    const colada = freeze([mk('v', 8), mk('r', 9.5, 'Refrão', REFRAO)])
    expect(nudgeSection(colada, 'v', 1, grid)).toEqual(colada)
    // A última anda sem limite à frente; a primeira não passa de 0:00.
    expect(timeOf(nudgeSection(tres(), 'r', 3, grid), 'r')).toBe(18)
    expect(timeOf(nudgeSection(tres(), 'i', -1, grid), 'i')).toBe(0)
  })

  it('com fase encaixa na barra e a vizinha antiga conta onde ela encaixa', () => {
    // Marca antiga fora da barra (8,3) anda 1 compasso e cai na barra de 10.
    expect(timeOf(nudgeSection(freeze([mk('v', 8.3)]), 'v', 1, grid), 'v')).toBe(10)
    // Vizinha antiga em 10,3 encaixa em 10 no palco: ir pra 10 juntaria as duas, então não anda.
    const antiga = freeze([mk('v', 8), mk('r', 10.3, 'Refrão', REFRAO)])
    expect(nudgeSection(antiga, 'v', 1, grid)).toEqual(antiga)
    // Primeiro 1 em 0,5 s: 1 compasso pra trás de 0,5 cai antes de 0:00 e para em 0:00.
    const anacruse: SongGrid = { ...grid, firstDownbeat: 0.5 }
    expect(timeOf(nudgeSection(freeze([mk('i', 0.5, 'Intro')]), 'i', -1, anacruse), 'i')).toBe(0)
  })

  it('sem fase ajusta em segundos e não encaixa', () => {
    for (const g of [semFase, null]) {
      expect(timeOf(nudgeSection(tres(), 'v', 1, g), 'v')).toBe(9)
      expect(timeOf(nudgeSection(freeze([mk('v', 8.3)]), 'v', -1, g), 'v')).toBeCloseTo(7.3, 9)
      // Encosta na vizinha com folga de 0,1 s.
      const perto = freeze([mk('v', 8), mk('r', 8.5, 'Refrão', REFRAO)])
      expect(timeOf(nudgeSection(perto, 'v', 1, g), 'v')).toBeCloseTo(8.4, 9)
      expect(timeOf(nudgeSection(freeze([mk('p', 7.7, 'Pré'), mk('v', 8)]), 'v', -1, g), 'v')).toBeCloseTo(7.8, 9)
      // Nem de 0:00.
      expect(timeOf(nudgeSection(freeze([mk('i', 0.4, 'Intro')]), 'i', -1, g), 'i')).toBe(0)
      // Já colada (a menos de 0,1 s): nunca anda pro lado contrário do pedido.
      const colada = freeze([mk('p', 7.95, 'Pré'), mk('v', 8)])
      expect(nudgeSection(colada, 'v', -1, g)).toEqual(colada)
    }
  })

  it('devolve lista nova, ordenada, e ignora marca que não existe', () => {
    const lista = freeze([mk('r', 12, 'Refrão', REFRAO), mk('v', 8)])
    const out = nudgeSection(lista, 'v', 1, grid)
    expect(out.map((m) => [m.id, m.time])).toEqual([['v', 10], ['r', 12]])
    expect(lista.map((m) => [m.id, m.time])).toEqual([['r', 12], ['v', 8]])
    expect(nudgeSection(lista, 'nao-existe', 1, grid)).toEqual([mk('v', 8), mk('r', 12, 'Refrão', REFRAO)])
    expect(nudgeSection(lista, 'v', 0, grid)).not.toBe(lista)
  })

  it('mexe só no tempo da marca (nome, cor e letra ficam)', () => {
    const antiga: Marker = { id: 'v', time: 8, label: 'Ministração da palavra', color: '#123456', lyrics: 'letra' }
    expect(nudgeSection(freeze([antiga]), 'v', 1, grid)).toEqual([{ ...antiga, time: 10 }])
  })
})

describe('removeSection', () => {
  it('tira só a marca pedida, sem mutar a recebida', () => {
    const lista = freeze([mk('i', 0, 'Intro'), mk('v', 8), mk('r', 12, 'Refrão', REFRAO)])
    expect(removeSection(lista, 'v').map((m) => m.id)).toEqual(['i', 'r'])
    expect(lista.map((m) => m.id)).toEqual(['i', 'v', 'r'])
    const igual = removeSection(lista, 'nao-existe')
    expect(igual).toEqual(lista)
    expect(igual).not.toBe(lista)
  })
})

describe('marcas que chegam sem limpeza da nuvem', () => {
  it('marca sem tempo numérico fica no fim, nunca vira vizinha nem é trocada', () => {
    const quebrada = { id: 'q', time: Number.NaN, label: 'Quebrada', color: VERSO } as Marker
    const lista = freeze([quebrada, mk('v', 8)])
    expect(addSectionAt(lista, 2, 'Intro', grid, () => 'n').map((m) => m.id)).toEqual(['n', 'v', 'q'])
    expect(nudgeSection(lista, 'v', 1, grid).map((m) => [m.id, m.time])).toEqual([['v', 10], ['q', Number.NaN]])
    expect(nudgeSection(lista, 'q', 1, grid).map((m) => m.id)).toEqual(['v', 'q'])
  })
})
