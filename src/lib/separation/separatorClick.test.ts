import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BeatGrid } from '../beatGrid'
import { SEPARATOR_MIN_CONFIDENCE } from '../autoClick'

const gen = vi.hoisted(() => ({ generateManualClickTrackFromSample: vi.fn() }))
vi.mock('../AudioAnalyzer', () => gen)

import {
  BEATS_PER_BAR, SEPARATOR_METERS, bpmReport, clickPlan, generateSeparatorClick, normalizeBpm, nudgeOffset,
  pickGridSource, scaleBpm, stepBpm, tapTempo, tempoName,
} from './separatorClick'

const TRAVESSAO = String.fromCharCode(0x2014)
const grid = (over: Partial<BeatGrid> = {}): BeatGrid => ({
  bpm: 119.87, firstBeat: 0.42, downbeat: 1, confidence: SEPARATOR_MIN_CONFIDENCE + 0.2, ...over,
} as BeatGrid)

beforeEach(() => { gen.generateManualClickTrackFromSample.mockReset() })

describe('separatorClick', () => {
  it('compassos e tempos por compasso de hoje', () => {
    expect(SEPARATOR_METERS).toEqual(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'])
    expect(BEATS_PER_BAR).toEqual({ '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '7/8': 7, '12/8': 12 })
  })

  it('pickGridSource: bateria primeiro, nos dois formatos', () => {
    expect(pickGridSource([{ id: 'bass', name: 'Baixo' }, { id: 'drums', name: 'Bateria' }])?.id).toBe('drums')
    expect(pickGridSource([{ id: 'a1', name: 'Baixo' }, { id: 'a2', name: 'Bateria' }])?.id).toBe('a2')
  })

  it('pickGridSource: instrumental antes do baixo e nunca Metrônomo, Voz Guia, Click gerado nem vocal', () => {
    expect(pickGridSource([{ id: 'bass', name: 'Baixo' }, { id: 'no_vocals', name: 'Instrumental' }])?.id).toBe('no_vocals')
    expect(pickGridSource([{ id: 'b1', name: 'Baixo' }, { id: 'i1', name: 'Instrumental' }])?.id).toBe('i1')
    expect(pickGridSource([{ id: 'v', name: 'Vocais' }, { id: 'b1', name: 'Baixo' }])?.id).toBe('b1')
    expect(pickGridSource([
      { id: 'metronome', name: 'Metrônomo' }, { id: 'x1', name: 'Voz Guia' }, { id: 'x2', name: 'Click gerado' },
      { id: 'vocals', name: 'Vocais' }, { id: 'x3', name: 'Vocal' }, { id: 'other', name: 'Outros/Fx' },
    ])?.id).toBe('other')
    expect(pickGridSource([{ id: 'metronome', name: 'Metrônomo' }, { id: 'vocals', name: 'Vocais' }])).toBeUndefined()
  })

  it('clickPlan com grade boa usa o BPM e a fase dela mais o SYNC; sem grade, o BPM digitado a partir do deslocamento', () => {
    expect(clickPlan({ typedBpm: '120', offsetMs: 20, downbeatShift: 1, grid: grid() })).toEqual({ bpm: 119.87, firstBeat: 0.42 + 0.02, downbeat: 2 })
    expect(clickPlan({ typedBpm: '96', offsetMs: -30, downbeatShift: -1, grid: null })).toEqual({ bpm: 96, firstBeat: -0.03, downbeat: -1 })
    // Grade de pulso pouco claro vale como sem grade.
    expect(clickPlan({ typedBpm: '96', offsetMs: 0, downbeatShift: 0, grid: grid({ confidence: 0 }) })).toEqual({ bpm: 96, firstBeat: 0, downbeat: 0 })
  })

  it('clickPlan com BPM digitado abaixo de 20 ou vazio usa 120', () => {
    expect(clickPlan({ typedBpm: '10', offsetMs: 0, downbeatShift: 0, grid: null }).bpm).toBe(120)
    expect(clickPlan({ typedBpm: '', offsetMs: 0, downbeatShift: 0, grid: null }).bpm).toBe(120)
    expect(clickPlan({ typedBpm: 'abc', offsetMs: 0, downbeatShift: 0, grid: null }).bpm).toBe(120)
  })

  it('generateSeparatorClick chama o gerador com prazo e a grade; sem URL lança', async () => {
    gen.generateManualClickTrackFromSample.mockResolvedValueOnce({ clickTrackUrl: 'blob:click' })
    const url = await generateSeparatorClick({
      plan: { bpm: 100, firstBeat: 0.5, downbeat: 2 }, durationSec: 180,
      sel: { type: 'Woodblock', subdivision: 'eighth' }, accentBeat1: false, meter: '6/8',
    })
    expect(url).toBe('blob:click')
    expect(gen.generateManualClickTrackFromSample).toHaveBeenCalledWith('Woodblock', 'eighth', 100, 180, false, '6/8', { firstBeat: 0.5, downbeat: 2 })
    gen.generateManualClickTrackFromSample.mockResolvedValueOnce({ clickTrackUrl: '' })
    await expect(generateSeparatorClick({
      plan: { bpm: 100, firstBeat: 0, downbeat: 0 }, durationSec: 10, sel: { type: 'Classic', subdivision: 'quarter' }, accentBeat1: true, meter: '4/4',
    })).rejects.toThrow('Falha ao gerar metrônomo')
  })

  it('nudgeOffset para em 500 e em -500', () => {
    expect(nudgeOffset(0, 10)).toBe(10)
    expect(nudgeOffset(495, 10)).toBe(500)
    expect(nudgeOffset(-495, -10)).toBe(-500)
  })

  it('tapTempo guarda as 8 últimas batidas e calcula pela média', () => {
    let taps: number[] = []
    let bpm: string | null = null
    for (let i = 0; i < 4; i++) ({ taps, bpm } = tapTempo(taps, 1000 + i * 500))
    expect(bpm).toBe('120')
    expect(tapTempo([], 5).bpm).toBeNull()
    let many: number[] = []
    for (let i = 0; i < 12; i++) many = tapTempo(many, i * 1000).taps
    expect(many).toHaveLength(8)
    expect(many[0]).toBe(4000)
  })

  it('stepBpm e scaleBpm respeitam 40 e 300', () => {
    expect(stepBpm('120', 1)).toBe('121')
    expect(stepBpm('120.6', -1)).toBe('120')
    expect(stepBpm('', 1)).toBe('121')
    expect(stepBpm('300', 1)).toBe('300')
    expect(stepBpm('40', -1)).toBe('40')
    expect(scaleBpm('200', 2)).toBe('300')
    expect(scaleBpm('60', 0.5)).toBe('40')
    expect(scaleBpm('72.5', 2)).toBe('145')
  })

  it('normalizeBpm: inválido vira 120 e o resto encaixa entre 40 e 300', () => {
    expect(normalizeBpm('abc')).toBe('120')
    expect(normalizeBpm('20')).toBe('40')
    expect(normalizeBpm('999')).toBe('300')
  })

  it('tempoName: os nomes de andamento de hoje', () => {
    expect(tempoName(50)).toBe('Largo')
    expect(tempoName(70)).toBe('Adagio')
    expect(tempoName(100)).toBe('Andante')
    expect(tempoName(110)).toBe('Moderato')
    expect(tempoName(115)).toBe('Allegretto')
    expect(tempoName(130)).toBe('Allegro')
    expect(tempoName(170)).toBe('Vivace')
    expect(tempoName(200)).toBe('Presto')
  })

  it('bpmReport: pulso claro e pouco claro, sem travessão', () => {
    const good = bpmReport(grid(), 'Bateria')
    expect(good).toEqual({ bpm: '119.9', info: '119.87 BPM medido na faixa Bateria.' })
    const bad = bpmReport(grid({ confidence: 0 }), 'Baixo')
    expect(bad.info).toBe('Pulso pouco claro nessa música (Baixo). Confira o BPM no TAP.')
    expect(good.info + bad.info).not.toContain(TRAVESSAO)
  })

  it('o Separador não decide a grade sozinho (as contas moram aqui)', () => {
    const sep = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(sep).not.toMatch(/separatorGridUsable\(|const BEATS_PER_BAR|const getTempoName|s\.id === 'drums'|Math\.max\(-500/)
    expect(sep).toMatch(/from '\.\.\/lib\/separation\/separatorClick'/)
  })
})
