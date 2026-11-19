import { describe, expect, it } from 'vitest'
import type { ChannelIdentity } from './channelNames'
import { pickTempoSources } from './tempoSources'

const mk = (names: string[]): ChannelIdentity[] => names.map((name, i) => ({ id: `c${i}`, name }))
const shown = (ch: ChannelIdentity | null) => (ch ? (ch.customName?.trim() ? ch.customName : ch.name) : null)

function pick(channels: ChannelIdentity[]) {
  const s = pickTempoSources(channels)
  return {
    click: shown(s.click),
    pulse: s.pulse.map(shown),
    bass: shown(s.bass),
    harmony: s.harmony.map(shown),
    label: s.label,
  }
}

// Tabela da seção 4 do relatório do metrônomo (refs/metronomo-auto-investigacao.md):
// os 13 pacotes reais. Onde a tabela tem "...", o resto vem de names.mjs da medição.
describe('pacotes da seção 4 do relatório', () => {
  it.each([
    ['BR completo', ['Click', 'Guia', 'Bateria', 'Baixo', 'Guitarra 1', 'Teclado', 'Pad', 'Vocal'],
      { click: 'Click', pulse: ['Bateria'], bass: 'Baixo', harmony: ['Teclado', 'Pad'], label: 'Bateria e Baixo' }],
    ['EN completo', ['CLICK', 'GUIDE', 'DRUMS', 'BASS', 'EG1', 'KEYS', 'PAD', 'VOX'],
      { click: 'CLICK', pulse: ['DRUMS'], bass: 'BASS', harmony: ['KEYS', 'PAD'], label: 'Bateria e Baixo' }],
    ['kit separado EN', ['Click', 'Cues', 'KICK', 'SNARE', 'HIHAT', 'OH', 'PERC', 'LOOP', 'BASS'],
      { click: 'Click', pulse: ['KICK', 'SNARE', 'HIHAT', 'OH', 'PERC'], bass: 'BASS', harmony: [],
        label: 'Bateria, Percussão e Baixo' }],
    ['kit separado BR', ['Click', 'Guia', 'BUMBO', 'CAIXA', 'CHIMBAL', 'LOOP', 'PERCUSSÃO', 'BAIXO'],
      { click: 'Click', pulse: ['BUMBO', 'CAIXA', 'CHIMBAL', 'PERCUSSÃO'], bass: 'BAIXO', harmony: [],
        label: 'Bateria, Percussão e Baixo' }],
    ['kit separado BR sem baixo, violão antes', ['Click', 'Guia', 'VIOLÃO', 'LOOP', 'BUMBO', 'CAIXA'],
      { click: 'Click', pulse: ['BUMBO', 'CAIXA'], bass: null, harmony: ['VIOLÃO'], label: 'Bateria' }],
    ['Drum Loop antes de Drums', ['Click', 'Drum Loop', 'Drums'],
      { click: 'Click', pulse: ['Drums'], bass: null, harmony: [], label: 'Bateria' }],
    ['só viradas antes de Drums', ['Click', 'Drum Fills', 'Drums'],
      { click: 'Click', pulse: ['Drums'], bass: null, harmony: [], label: 'Bateria' }],
    ['só loop e percussão', ['Click', 'Guia', 'Loop', 'Perc', 'Pad'],
      { click: 'Click', pulse: ['Loop', 'Perc'], bass: null, harmony: ['Pad'], label: 'Percussão' }],
    ['só Pad e Loop', ['Click', 'Guia', 'Pad', 'Loop'],
      { click: 'Click', pulse: ['Loop'], bass: null, harmony: ['Pad'], label: 'Percussão' }],
    ['espanhol', ['Click', 'Guía', 'Batería', 'Bajo'],
      { click: 'Click', pulse: ['Batería'], bass: 'Bajo', harmony: [], label: 'Bateria e Baixo' }],
    ['metrônomo com acento', ['Metrônomo', 'Pad', 'Vocal'],
      { click: 'Metrônomo', pulse: [], bass: null, harmony: ['Pad'], label: '' }],
    ['Batera e Bx', ['Click', 'Batera', 'Bx'],
      { click: 'Click', pulse: ['Batera'], bass: 'Bx', harmony: [], label: 'Bateria e Baixo' }],
    ['Separador (nomes do app)', ['Metrônomo', 'Vocais', 'Bateria', 'Baixo', 'Outros'],
      { click: 'Metrônomo', pulse: ['Bateria'], bass: 'Baixo', harmony: [], label: 'Bateria e Baixo' }],
  ] as const)('%s', (_, names, expected) => {
    expect(pick(mk([...names]))).toEqual(expected)
  })
})

describe('pulso', () => {
  it('kit separado entra inteiro e o baixo fica em bass', () => {
    const s = pick(mk(['KICK', 'SNARE', 'HIHAT', 'OH', 'PERC', 'BASS']))
    expect([s.pulse, s.bass]).toEqual([['KICK', 'SNARE', 'HIHAT', 'OH', 'PERC'], 'BASS'])
  })
  it('BUMBO, CAIXA e CHIMBAL são peças da bateria e entram no pulso', () => {
    expect(pick(mk(['BUMBO', 'CAIXA', 'CHIMBAL', 'Pad'])).pulse).toEqual(['BUMBO', 'CAIXA', 'CHIMBAL'])
  })
  it('kit inteiro só tira loop e virada; sem loop nem virada a percussão continua', () => {
    expect(pick(mk(['DRUMS', 'PERC', 'SHAKER'])).pulse).toEqual(['DRUMS', 'PERC', 'SHAKER'])
    expect(pick(mk(['DRUMS', 'PERC', 'LOOP'])).pulse).toEqual(['DRUMS'])
    expect(pick(mk(['Bateria', 'Loops'])).pulse).toEqual(['Bateria'])
  })
  it('sem kit inteiro nem peças, loop e virada ficam no pulso', () => {
    expect(pick(mk(['Drum Loop', 'Drum Fills', 'PERC'])).pulse).toEqual(['Drum Loop', 'Drum Fills', 'PERC'])
  })
  // Decisão do coordenador na rodada 1 (opção b): com kit separado, saem só loop e virada.
  it('com kit separado (peças sem kit inteiro), saem só loop e virada; peças e percussão ficam', () => {
    expect(pick(mk(['Drum Loop', 'Drum Fills', 'KICK'])).pulse).toEqual(['KICK'])
    expect(pick(mk(['KICK', 'SNARE', 'LOOP', 'PERC', 'SHAKER', 'Loop L'])).pulse).toEqual(['KICK', 'SNARE', 'PERC', 'SHAKER'])
  })
  it('peça com loop no nome não conta como kit separado pra ligar o filtro', () => {
    expect(pick(mk(['Kick Loop', 'PERC'])).pulse).toEqual(['Kick Loop', 'PERC'])
  })
  // Rodada 1, item 4: loop em par estéreo não pode deixar o pacote sem pulso.
  it('loop em par estéreo entra no pulso', () => {
    expect(pick(mk(['Click', 'Loop L', 'Loop R', 'Pad']))).toEqual({
      click: 'Click', pulse: ['Loop L', 'Loop R'], bass: null, harmony: ['Pad'], label: 'Percussão',
    })
  })
  it('palavra inteira, nunca pedaço de nome: "Fillmore" não é virada', () => {
    expect(pick(mk(['DRUMS', 'Fillmore Perc'])).pulse).toEqual(['DRUMS', 'Fillmore Perc'])
  })
  it('o nome do usuário conta pro kit e pra família', () => {
    expect(pick([{ id: 'a', name: 'Track 1', customName: 'Drums' }, { id: 'b', name: 'Drum Loop' }]).pulse)
      .toEqual(['Drums'])
    expect(pick([{ id: 'a', name: 'Track 3', customName: 'Bateria' }, { id: 'b', name: 'Pad' }]).pulse)
      .toEqual(['Bateria'])
  })
  // Rodada 1, item 2: manual vence automático; com nome do usuário reconhecido, só as palavras dele contam.
  it('com nome do usuário reconhecido, as palavras dele decidem o kit, sem somar as do arquivo', () => {
    expect(pick([{ id: 'a', name: 'Drum Loop', customName: 'Bateria' }, { id: 'b', name: 'LOOP' }]).pulse)
      .toEqual(['Bateria'])
    expect(pick([{ id: 'a', name: 'DRUMS', customName: 'Loop 2' }, { id: 'b', name: 'Bateria' }]).pulse)
      .toEqual(['Bateria'])
  })
  // Rodada 2, item 2: mesma regra do channelFamily; nome do usuário não reconhecido volta pro arquivo.
  it('nome do usuário não reconhecido não decide: valem as palavras do arquivo', () => {
    expect(pick([{ id: 'a', name: 'DRUMS' }, { id: 'b', name: 'Drum Loop', customName: 'Batida' }]).pulse)
      .toEqual(['DRUMS'])
    expect(pick([{ id: 'a', name: 'DRUMS', customName: 'Pulso' }, { id: 'b', name: 'Drum Loop' }]).pulse)
      .toEqual(['Pulso'])
  })
  it('nome do usuário só com espaço não conta: valem as palavras do arquivo', () => {
    expect(pick([{ id: 'a', name: 'DRUMS', customName: '   ' }, { id: 'b', name: 'Drum Loop' }]).pulse)
      .toEqual(['DRUMS'])
  })
  it('sem bateria nem percussão, o pulso é o primeiro baixo', () => {
    expect(pick(mk(['Click', 'Guia', 'Pad', 'BASS', 'Baixo 2', 'Vocal']))).toEqual({
      click: 'Click', pulse: ['BASS'], bass: 'BASS', harmony: ['Pad'], label: 'Baixo',
    })
  })
  // Rodada 1, item 1: peça com "Drum" no nome é peça, nunca kit inteiro.
  it('peça com "Drum" no nome não derruba o resto do kit separado', () => {
    expect(pick(mk(['Snare Drum', 'Kick', 'HH', 'OH', 'Drum Loop'])).pulse).toEqual(['Snare Drum', 'Kick', 'HH', 'OH'])
    expect(pick(mk(['Click', 'Kick Drum', 'Snare Drum', 'Hi Hat', 'OH', 'Drum Loop', 'Bass']))).toEqual({
      click: 'Click', pulse: ['Kick Drum', 'Snare Drum', 'Hi Hat', 'OH'], bass: 'Bass', harmony: [],
      label: 'Bateria e Baixo',
    })
    expect(pick(mk(['Tom Drum', 'Bass Drum', 'Drum Fills'])).pulse).toEqual(['Tom Drum', 'Bass Drum'])
  })
  it('com kit inteiro, peça com "Drum" no nome não é kit e sai junto com o loop', () => {
    expect(pick(mk(['DRUMS', 'Snare Drum', 'Drum Loop'])).pulse).toEqual(['DRUMS'])
  })
  // Ajuste do coordenador: pacote só com Synth Bass não pode cair em sem-faixa.
  it('sem Baixo, o pulso tirado do baixo usa o primeiro Synth Bass', () => {
    expect(pick(mk(['SYNTH BASS', 'Pad']))).toEqual({
      click: null, pulse: ['SYNTH BASS'], bass: 'SYNTH BASS', harmony: ['Pad'], label: 'Synth Bass',
    })
  })
  it('com Baixo presente, o pulso tirado do baixo continua preferindo o Baixo', () => {
    expect(pick(mk(['Pad', 'SUB', 'BASS']))).toEqual({
      click: null, pulse: ['BASS'], bass: 'BASS', harmony: ['Pad'], label: 'Baixo',
    })
  })
  // Ajuste do coordenador: "drum" no singular também é kit inteiro; "Kit" e "Bat" sozinhos não.
  it('"drum" no singular conta como kit inteiro', () => {
    expect(pick(mk(['Drum', 'Drum Loop'])).pulse).toEqual(['Drum'])
    expect(pick(mk(['Drum L', 'Drum R', 'Drum Fills'])).pulse).toEqual(['Drum L', 'Drum R'])
    expect(pick(mk(['DRUM KIT', 'LOOP', 'PERC'])).pulse).toEqual(['DRUM KIT'])
  })
  it('"Kit" e "Bat" sozinhos não contam como kit inteiro (ambíguos)', () => {
    expect(pick(mk(['KIT', 'Drum Loop'])).pulse).toEqual(['KIT', 'Drum Loop'])
    expect(pick(mk(['Bat', 'Drum Fills'])).pulse).toEqual(['Bat', 'Drum Fills'])
  })
})

// Rodada 3: pacotes reais da calibração da M2b.
describe('pacotes da calibração com multitracks reais', () => {
  it('Toda Sorte de Bençãos: "DRUMM LR" é kit inteiro', () => {
    expect(pick(mk(['Click', 'DRUMM LR', 'BASS']))).toEqual({
      click: 'Click', pulse: ['DRUMM LR'], bass: 'BASS', harmony: [], label: 'Bateria e Baixo',
    })
    expect(pick(mk(['DRUMM', 'Drum Loop'])).pulse).toEqual(['DRUMM'])
  })
  it('Me Derramar: "PANDEIROLA" é percussão', () => {
    expect(pick(mk(['Click', 'PANDEIROLA', 'BASS']))).toEqual({
      click: 'Click', pulse: ['PANDEIROLA'], bass: 'BASS', harmony: [], label: 'Percussão e Baixo',
    })
  })
  it('VS Videira: loops de axé entram no pulso', () => {
    expect(pick(mk(['MET', 'LOOP AXÉ - GRAVE', 'LOOP AXÉ - AGUDO', 'LOOP AXÉ - REFRÃO', 'BASS'])).pulse)
      .toEqual(['LOOP AXÉ - GRAVE', 'LOOP AXÉ - AGUDO', 'LOOP AXÉ - REFRÃO'])
  })
  it('VS Cruz: peça com FX é efeito e não entra no pulso', () => {
    expect(pick(mk(['Click', 'KICK FX_01-01', 'SINTH BASS_01-01', 'KEY_01-01', 'PAD_01-01']))).toEqual({
      click: 'Click', pulse: ['SINTH BASS_01-01'], bass: 'SINTH BASS_01-01', harmony: ['KEY_01-01', 'PAD_01-01'], label: 'Baixo',
    })
    expect(pick(mk(['KICK', 'SNARE FX', 'BUMBO FX', 'HH'])).pulse).toEqual(['KICK', 'HH'])
  })
  it('peça com FX não liga o filtro do kit separado', () => {
    expect(pick(mk(['KICK FX', 'Drum Loop'])).pulse).toEqual(['Drum Loop'])
  })
})

describe('baixo e harmonia', () => {
  it('bass é o primeiro Baixo; sem Baixo, o primeiro Synth Bass', () => {
    expect(pick(mk(['SUB', 'DRUMS', 'BASS'])).bass).toBe('BASS')
    expect(pick(mk(['Click', 'Kick', 'Snare', 'Synth Bass', 'Pad']))).toEqual({
      click: 'Click', pulse: ['Kick', 'Snare'], bass: 'Synth Bass', harmony: ['Pad'], label: 'Bateria e Synth Bass',
    })
  })
  it('harmonia: até 2 entre Pad, Teclado, Piano e Violão, na ordem da lista; guitarra não entra', () => {
    expect(pick(mk(['GTR', 'DRUMS', 'AG', 'KEYS', 'PIANO', 'PAD'])).harmony).toEqual(['AG', 'KEYS'])
    expect(pick(mk(['GTR', 'PIANO'])).harmony).toEqual(['PIANO'])
  })
})

describe('Guia, Vocal, Backing e Click nunca entram na análise', () => {
  // Rodada 2, item 1: "tom" em canal de voz não puxa a voz pra bateria.
  it('voz com "tom" no nome nunca vira pulso', () => {
    expect(pick(mk(['Click', 'Pad', 'Voz Tom', 'Bass']))).toEqual({
      click: 'Click', pulse: ['Bass'], bass: 'Bass', harmony: ['Pad'], label: 'Baixo',
    })
  })
  it('pelo nome', () => {
    expect(pick(mk(['Guía', 'Voz Guia', 'Cues', 'VOX', 'Vocais', 'BV', 'Coro', 'Click', 'Metrônomo']))).toEqual({
      click: 'Click', pulse: [], bass: null, harmony: [], label: '',
    })
  })
  it('papel manual vence: canal marcado como Click ou Guia sai, e vira o click quando é Click', () => {
    const s = pick([
      { id: 'd', name: 'DRUMS', role: 'click' }, { id: 'b', name: 'BASS', role: 'guide' },
      { id: 'p', name: 'PAD', role: 'guide' }, { id: 'k', name: 'KICK' },
    ])
    expect(s).toEqual({ click: 'DRUMS', pulse: ['KICK'], bass: null, harmony: [], label: 'Bateria' })
  })
  it('"vozguia bass" é Guia pelo teste antigo e não vira baixo', () => {
    expect(pick(mk(['vozguia bass', 'DRUMS'])).bass).toBeNull()
  })
  it('Click com papel Normal manual não é o click', () => {
    expect(pick([{ id: 'c', name: 'CLICK', role: 'normal' }, { id: 'd', name: 'DRUMS' }]).click).toBeNull()
  })
})

describe('contrato', () => {
  it('lista vazia', () => {
    expect(pickTempoSources([])).toEqual({ click: null, pulse: [], bass: null, harmony: [], label: '' })
  })
  it('devolve os mesmos objetos da entrada e não muta a lista', () => {
    const list = [{ id: 'c', name: 'Click', extra: 1 }, { id: 'd', name: 'DRUMS', extra: 2 }, { id: 'b', name: 'BASS', extra: 3 },
      { id: 'p', name: 'PAD', extra: 4 }]
    const copy = list.map((ch) => ({ ...ch }))
    const s = pickTempoSources(list)
    expect(s.click).toBe(list[0])
    expect(s.pulse[0]).toBe(list[1])
    expect(s.bass).toBe(list[2])
    expect(s.harmony[0]).toBe(list[3])
    expect(s.pulse[0].extra).toBe(2)
    expect(list).toEqual(copy)
  })
  it('rótulo em português, sem travessão', () => {
    const TRAVESSAO = String.fromCharCode(0x2014)
    const { label } = pickTempoSources(mk(['KICK', 'PERC', 'BASS', 'PAD']))
    expect(label).toBe('Bateria, Percussão e Baixo')
    expect(label).not.toContain(TRAVESSAO)
  })
})

// Hotfix 2026-11-19: FX sozinho virou Teclado no mixer, mas é efeito, não acorde:
// fica fora da harmonia, como a peça com FX fica fora do pulso. Strings entra.
describe('FX sozinho fica fora da harmonia (hotfix 2026-11-19)', () => {
  it('FX e SFX não entram; Strings, Strings FX e Keys FX entram', () => {
    expect(pick(mk(['Click', 'DRUMS', 'BASS', 'FX', 'SFX 2', 'KEYS', 'Strings'])).harmony).toEqual(['KEYS', 'Strings'])
    expect(pick(mk(['FX L', 'Strings FX', 'Keys FX'])).harmony).toEqual(['Strings FX', 'Keys FX'])
  })
  it('vozes do coro nunca entram na análise', () => {
    expect(pick(mk(['Click', 'Soprano', 'Contralto', 'Tenor', 'Pad', 'Bass']))).toEqual({
      click: 'Click', pulse: ['Bass'], bass: 'Bass', harmony: ['Pad'], label: 'Baixo',
    })
  })
})
