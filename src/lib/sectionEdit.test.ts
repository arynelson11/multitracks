import { describe, expect, it } from 'vitest'
import type { Marker } from '../types'
import { FAMILY_COLOR } from './channelNames'
import { addSectionAt, nudgeSection, removeSection } from './sectionEdit'
import { SECTION_NAME_MAX, SECTION_SHORTCUTS, colorForSection, defaultSectionName, normalizeSectionName } from './sectionTypes'
import { barSeconds, markerIdForSpan, sectionSpans } from './songGrid'
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
    expect(defaultSectionName('Verso')).toEqual({ type: 'Verso', number: null })
    expect(defaultSectionName(' refrão  2 ')).toEqual({ type: 'Refrão', number: '2' })
    expect(defaultSectionName('Pré-refrão 1')).toBeNull()
    expect(defaultSectionName('Ministração')).toBeNull()
    expect(defaultSectionName('Verso2')).toBeNull()
    // Acento decomposto (NFD, comum em nome vindo do Mac) conta como uma letra só.
    expect(normalizeSectionName('Pre\u0301-refra\u0303o final 2')).toBe('Pré-refrão fin')
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

  it('MARCAR perto de seção com nome próprio troca o tipo e mantém o nome (Ruling T16-nome-proprio)', () => {
    const ministracao: Marker = { id: 'a', time: 8, label: 'Ministração da Palavra', color: VERSO, lyrics: 'letra' }
    expect(addSectionAt(freeze([ministracao]), 8.4, 'Refrão', grid, () => 'n'))
      .toEqual([{ id: 'a', time: 8, label: 'Ministração da Palavra', color: REFRAO, lyrics: 'letra' }])
    // Nome que parece tipo mas não é o nome padrão de nenhum também é próprio.
    expect(addSectionAt(freeze([mk('a', 8, 'Pré-refrão 1', '#f59e0b')]), 8.4, 'Ponte', grid, () => 'n'))
      .toEqual([{ id: 'a', time: 8, label: 'Pré-refrão 1', color: '#8b5cf6' }])
    expect(addSectionAt(freeze([mk('a', 8, 'Coro', '#123456')]), 8.4, 'Final', grid, () => 'n'))
      .toEqual([{ id: 'a', time: 8, label: 'Coro', color: '#ec4899' }])
  })

  it('nome padrão acompanha o tipo novo, com o número que tinha', () => {
    const marca = (label: string, tipo: string) => addSectionAt(freeze([mk('a', 8, label)]), 8.4, tipo, grid, () => 'n')[0]
    expect(marca('Verso', 'Refrão')).toEqual({ id: 'a', time: 8, label: 'Refrão', color: REFRAO })
    expect(marca('Verso 2', 'Refrão')).toEqual({ id: 'a', time: 8, label: 'Refrão 2', color: REFRAO })
    // Caixa, espaços e acento decomposto do nome antigo não impedem de reconhecer o padrão.
    expect(marca('  refrão   3 ', 'Final')).toEqual({ id: 'a', time: 8, label: 'Final 3', color: '#ec4899' })
    expect(marca('PRE\u0301 12', 'Intro')).toEqual({ id: 'a', time: 8, label: 'Intro 12', color: '#3b82f6' })
    expect(marca('Intro', 'Intro')).toEqual({ id: 'a', time: 8, label: 'Intro', color: '#3b82f6' })
  })

  it('marca sem nome ganha o nome do tipo no MARCAR (não continua sem nome)', () => {
    expect(addSectionAt(freeze([mk('a', 8, '')]), 8.4, 'Refrão', grid, () => 'n')).toEqual([{ id: 'a', time: 8, label: 'Refrão', color: REFRAO }])
    expect(addSectionAt(freeze([mk('a', 8, '   ')]), 8.4, 'Ponte', grid, () => 'n')).toEqual([{ id: 'a', time: 8, label: 'Ponte', color: '#8b5cf6' }])
  })

  it('nome dado pelo chamador (não é um tipo) continua trocando o nome', () => {
    expect(addSectionAt(freeze([mk('a', 8, 'Ministração da Palavra')]), 8.4, 'Oferta', grid, () => 'n'))
      .toEqual([{ id: 'a', time: 8, label: 'Oferta', color: '#FF6B35' }])
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
  // Música de 60 s (Ruling T16-fim: a duração entra pra última seção não passar do fim).
  const DUR = 60
  const tres = () => freeze([mk('i', 0, 'Intro'), mk('v', 8), mk('r', 12, 'Refrão', REFRAO)])
  const timeOf = (list: readonly Marker[], id: string) => list.find((m) => m.id === id)?.time
  const starts = (list: readonly Marker[], g: SongGrid | null, dur = DUR) => sectionSpans(list, dur, g).map((s) => s.start)

  it('ajustar 1 compasso respeita as vizinhas', () => {
    expect(timeOf(nudgeSection(tres(), 'v', 1, grid, DUR), 'v')).toBe(10)
    expect(timeOf(nudgeSection(tres(), 'v', -1, grid, DUR), 'v')).toBe(6)
    // 2 compassos pra frente cairia em cima do Refrão (12): anda só o que cabe, de compasso inteiro.
    expect(timeOf(nudgeSection(tres(), 'v', 2, grid, DUR), 'v')).toBe(10)
    // 4 pra trás cairia em cima da Intro (0): para a 1 compasso dela.
    expect(timeOf(nudgeSection(tres(), 'v', -4, grid, DUR), 'v')).toBe(2)
    // Vizinha a menos de 1 compasso: não anda.
    const colada = freeze([mk('v', 8), mk('r', 9.5, 'Refrão', REFRAO)])
    expect(nudgeSection(colada, 'v', 1, grid, DUR)).toEqual(colada)
    // A última anda até 1 compasso antes do fim; a primeira não passa de 0:00.
    expect(timeOf(nudgeSection(tres(), 'r', 3, grid, DUR), 'r')).toBe(18)
    expect(timeOf(nudgeSection(tres(), 'i', -1, grid, DUR), 'i')).toBe(0)
  })

  it('com fase vai pra barra seguinte (ou anterior) e a vizinha antiga conta onde ela encaixa', () => {
    // Marca antiga perto da barra (8,3 aparece em 8) anda 1 compasso e cai na barra de 10.
    expect(timeOf(nudgeSection(freeze([mk('v', 8.3)]), 'v', 1, grid, DUR), 'v')).toBe(10)
    // Marca antiga no pulso (9,1 aparece em 9): o ajuste leva pra barra seguinte (10) ou anterior (8).
    expect(timeOf(nudgeSection(freeze([mk('v', 9.1)]), 'v', 1, grid, DUR), 'v')).toBe(10)
    expect(timeOf(nudgeSection(freeze([mk('v', 9.1)]), 'v', -1, grid, DUR), 'v')).toBe(8)
    expect(timeOf(nudgeSection(freeze([mk('v', 9.1)]), 'v', 2, grid, DUR), 'v')).toBe(12)
    // Vizinha antiga em 10,3 aparece em 10 no palco: ir pra 10 juntaria as duas, então não anda.
    const antiga = freeze([mk('v', 8), mk('r', 10.3, 'Refrão', REFRAO)])
    expect(nudgeSection(antiga, 'v', 1, grid, DUR)).toEqual(antiga)
    // Primeiro 1 em 0,5 s: 1 compasso pra trás de 0,5 cai antes de 0:00 e para em 0:00.
    const anacruse: SongGrid = { ...grid, firstDownbeat: 0.5 }
    expect(timeOf(nudgeSection(freeze([mk('i', 0.5, 'Intro')]), 'i', -1, anacruse, DUR), 'i')).toBe(0)
  })

  it('nunca junta duas seções no mesmo ponto do palco (casos da revisão, Ruling T16-encaixe)', () => {
    // Pra frente: 0, 5,25 e 7,45 aparecem em 0, 5,5 e 7,5 (pulso). O Verso vai pra barra de 6, não pra 7,25.
    const frente = freeze([mk('i', 0, 'Intro'), mk('v', 5.25), mk('r', 7.45, 'Refrão', REFRAO)])
    expect(starts(frente, grid)).toEqual([0, 5.5, 7.5])
    const andou = nudgeSection(frente, 'v', 1, grid, DUR)
    expect(timeOf(andou, 'v')).toBe(6)
    expect(starts(andou, grid)).toEqual([0, 6, 7.5])
    // A barra seguinte (8) passaria do Refrão (7,5): não anda mais.
    expect(nudgeSection(andou, 'v', 1, grid, DUR)).toEqual(andou)
    // Pra trás: 0, 6,9 e 9,2 aparecem em 0, 7 e 9. O Verso (9,2) vai pra barra de 8, não pra 7,2.
    const tras = freeze([mk('i', 0, 'Intro'), mk('p', 6.9, 'Pré'), mk('v', 9.2)])
    expect(starts(tras, grid)).toEqual([0, 7, 9])
    const voltou = nudgeSection(tras, 'v', -1, grid, DUR)
    expect(timeOf(voltou, 'v')).toBe(8)
    expect(starts(voltou, grid)).toEqual([0, 7, 8])
    expect(nudgeSection(voltou, 'v', -1, grid, DUR)).toEqual(voltou)
  })

  it('a última seção fica com pelo menos 1 compasso (sem fase, 1 s) antes do fim (Ruling T16-fim)', () => {
    // 59 s com o Final em 58: 1 compasso pra frente (60) passaria do fim e a seção sumiria.
    const fim = freeze([mk('i', 0, 'Intro'), mk('f', 58, 'Final', '#ec4899')])
    expect(nudgeSection(fim, 'f', 1, grid, 59)).toEqual(fim)
    expect(starts(nudgeSection(fim, 'f', 1, grid, 59), grid, 59)).toEqual([0, 58])
    // De 54: vai pra 56, e de 56 não vai pra 58 (faltaria 1 s, menos que 1 compasso de 2 s).
    const antes = freeze([mk('i', 0, 'Intro'), mk('f', 54, 'Final', '#ec4899')])
    const andou = nudgeSection(antes, 'f', 1, grid, 59)
    expect(timeOf(andou, 'f')).toBe(56)
    expect(nudgeSection(andou, 'f', 1, grid, 59)).toEqual(andou)
    for (const g of [semFase, null]) {
      expect(nudgeSection(fim, 'f', 1, g, 59)).toEqual(fim)
      expect(timeOf(nudgeSection(freeze([mk('f', 57.5, 'Final')]), 'f', 1, g, 59), 'f')).toBe(58)
      // Pra trás continua livre.
      expect(timeOf(nudgeSection(fim, 'f', -1, g, 59), 'f')).toBe(57)
    }
    expect(timeOf(nudgeSection(fim, 'f', -1, grid, 59), 'f')).toBe(56)
  })

  it('sem duração válida não anda', () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(nudgeSection(tres(), 'v', 1, grid, d)).toEqual(tres())
  })

  it('sem fase ajusta em segundos e não encaixa', () => {
    for (const g of [semFase, null]) {
      expect(timeOf(nudgeSection(tres(), 'v', 1, g, DUR), 'v')).toBe(9)
      expect(timeOf(nudgeSection(freeze([mk('v', 8.3)]), 'v', -1, g, DUR), 'v')).toBeCloseTo(7.3, 9)
      // Encosta na vizinha com folga de 0,1 s.
      const perto = freeze([mk('v', 8), mk('r', 8.5, 'Refrão', REFRAO)])
      expect(timeOf(nudgeSection(perto, 'v', 1, g, DUR), 'v')).toBeCloseTo(8.4, 9)
      expect(timeOf(nudgeSection(freeze([mk('p', 7.7, 'Pré'), mk('v', 8)]), 'v', -1, g, DUR), 'v')).toBeCloseTo(7.8, 9)
      // Nem de 0:00.
      expect(timeOf(nudgeSection(freeze([mk('i', 0.4, 'Intro')]), 'i', -1, g, DUR), 'i')).toBe(0)
      // Já colada (a menos de 0,1 s): nunca anda pro lado contrário do pedido.
      const colada = freeze([mk('p', 7.95, 'Pré'), mk('v', 8)])
      expect(nudgeSection(colada, 'v', -1, g, DUR)).toEqual(colada)
    }
  })

  it('devolve lista nova, ordenada, e ignora marca que não existe ou que não aparece no palco', () => {
    const lista = freeze([mk('r', 12, 'Refrão', REFRAO), mk('v', 8)])
    const out = nudgeSection(lista, 'v', 1, grid, DUR)
    expect(out.map((m) => [m.id, m.time])).toEqual([['v', 10], ['r', 12]])
    expect(lista.map((m) => [m.id, m.time])).toEqual([['r', 12], ['v', 8]])
    expect(nudgeSection(lista, 'nao-existe', 1, grid, DUR)).toEqual([mk('v', 8), mk('r', 12, 'Refrão', REFRAO)])
    expect(nudgeSection(lista, 'v', 0, grid, DUR)).not.toBe(lista)
    // Marca depois do fim do áudio não aparece no palco: fica onde está.
    expect(nudgeSection(freeze([mk('v', 8), mk('f', 61, 'Final')]), 'f', -1, grid, DUR)).toEqual([mk('v', 8), mk('f', 61, 'Final')])
  })

  it('mexe só no tempo da marca (nome, cor e letra ficam)', () => {
    const antiga: Marker = { id: 'v', time: 8, label: 'Ministração da palavra', color: '#123456', lyrics: 'letra' }
    expect(nudgeSection(freeze([antiga]), 'v', 1, grid, DUR)).toEqual([{ ...antiga, time: 10 }])
  })

  it('varredura: nenhum ajuste some com seção, troca a ordem, anda ao contrário ou passa do fim', () => {
    // Gerador fixo (LCG): o mesmo sorteio em toda rodada.
    let seed = 20261116
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
    const grades: (SongGrid | null)[] = [
      grid, { ...grid, firstDownbeat: 0.7 },
      { bpm: 156, firstDownbeat: 0.3, signature: '6/8', countEvery: 3, source: 'click', meterSource: 'salvo' },
      { bpm: 90, firstDownbeat: 1.1, signature: '3/4', countEvery: 1, source: 'click', meterSource: 'acento' },
      { bpm: 140, firstDownbeat: 0.2, signature: '7/8', countEvery: 1, source: 'click', meterSource: 'manual' },
      { bpm: 72.5, firstDownbeat: 0.05, signature: '12/8', countEvery: 3, source: 'click', meterSource: 'salvo' },
      semFase, null,
    ]
    const ids = (list: readonly Marker[], g: SongGrid | null, dur: number) =>
      sectionSpans(list, dur, g).map((_, i) => markerIdForSpan(list, dur, g, i))
    let andaram = 0
    for (let n = 0; n < 4000; n++) {
      const g = grades[Math.floor(rnd() * grades.length)]
      const dur = 20 + rnd() * 220
      const count = 1 + Math.floor(rnd() * 9)
      const list = freeze(Array.from({ length: count }, (_, i) => mk(`m${i}`, i === 0 && rnd() < 0.5 ? 0 : rnd() * dur)))
      const antes = ids(list, g, dur)
      const alvo = antes[Math.floor(rnd() * antes.length)]
      if (!alvo) continue
      const bars = [-3, -2, -1, 1, 2, 3][Math.floor(rnd() * 6)]
      const out = nudgeSection(list, alvo, bars, g, dur)
      const depois = ids(out, g, dur)
      const caso = JSON.stringify({ g, dur, list, alvo, bars })
      // Nenhuma seção some e a que andou continua no palco.
      expect(depois.length, caso).toBeGreaterThanOrEqual(antes.length)
      expect(depois, caso).toContain(alvo)
      // A ordem em volta dela não muda.
      const i0 = antes.indexOf(alvo)
      const i1 = depois.indexOf(alvo)
      for (const id of antes.slice(0, i0)) expect(depois.indexOf(id), caso).toBeLessThan(i1)
      for (const id of antes.slice(i0 + 1)) expect(depois.indexOf(id), caso).toBeGreaterThan(i1)
      // Nunca anda pro lado contrário; a última nunca chega a menos de 1 compasso (1 s) do fim.
      const de = sectionSpans(list, dur, g)[i0].start
      const para = sectionSpans(out, dur, g)[i1].start
      if (bars > 0) expect(para, caso).toBeGreaterThanOrEqual(de)
      else expect(para, caso).toBeLessThanOrEqual(de)
      if (para !== de) andaram++
      // Pra frente, a última nunca fica a menos de 1 compasso (sem fase, 1 s) do fim. Pra trás ela sempre pode voltar.
      if (bars > 0 && para !== de && i1 === depois.length - 1) {
        const comFase = g !== null && g.source === 'click'
        expect(para, caso).toBeLessThanOrEqual(dur - (comFase ? barSeconds(g) : 1) + 1e-9)
      }
    }
    expect(andaram).toBeGreaterThan(1500)
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
    expect(nudgeSection(lista, 'v', 1, grid, 60).map((m) => [m.id, m.time])).toEqual([['v', 10], ['q', Number.NaN]])
    expect(nudgeSection(lista, 'q', 1, grid, 60).map((m) => m.id)).toEqual(['v', 'q'])
  })
})
