// Fluxo único do click automático (M7): faixas pela regra central, grade pelo
// detectSongGrid com o BPM da música, porteiro de confiança, marcas de dúvida e o click
// gerado da biblioteca. Nunca o caminho antigo (analyzeBufferAndGenerateClick).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeBufferAndGenerateClick, generateManualClickTrackFromSample } from './AudioAnalyzer'
import {
  AUTO_CLICK_MIN_CONFIDENCE, DOWNBEAT_MIN_MARGIN, SEPARATOR_MIN_CONFIDENCE, adjustAutoClick, autoClickChecks, planAutoClick, renderAutoClick,
  separatorGridUsable, toTempoTracks, type AutoClickChannel, type AutoClickOkPlan,
} from './autoClick'
import { detectBeatGrid, detectSongGrid, type SongGridDetection } from './beatGrid'
import type { TimeSignature } from './stageContracts'
import { pickTempoSources } from './tempoSources'
import { FakeAudioBuffer } from '../test/fakeAudio'
import { tempoCase } from '../test/tempoCases'
import type { StereoTrack } from '../test/synthMusic'

vi.mock('./beatGrid', async (importOriginal) => {
  const real = await importOriginal<typeof import('./beatGrid')>()
  return { ...real, detectSongGrid: vi.fn(real.detectSongGrid) }
})
vi.mock('./AudioAnalyzer', async (importOriginal) => {
  const real = await importOriginal<typeof import('./AudioAnalyzer')>()
  return {
    ...real,
    analyzeBufferAndGenerateClick: vi.fn(),
    generateManualClickTrackFromSample: vi.fn(async () => ({ clickTrackUrl: 'blob:click-auto' })),
  }
})

const detect = vi.mocked(detectSongGrid)
const generate = vi.mocked(generateManualClickTrackFromSample)
const SR = 48000
// Detectar 30 s com bateria, baixo e pad leva ~2 s; folga pra máquina carregada.
const LENTO = 30_000

function buffer(channels: readonly Float32Array[], sampleRate = SR): AudioBuffer {
  const b = new FakeAudioBuffer(channels.length, channels[0].length, sampleRate)
  channels.forEach((c, i) => b.copyToChannel(c, i))
  return b as unknown as AudioBuffer
}

const silence = (seconds = 1, sampleRate = SR): StereoTrack => {
  const n = Math.round(seconds * sampleRate)
  return [new Float32Array(n), new Float32Array(n)]
}

function channel(id: string, name: string, data: readonly Float32Array[] = silence(), extra: Partial<AutoClickChannel> = {}): AutoClickChannel {
  return { id, name, buffer: buffer(data), ...extra }
}

/** Detecção montada à mão (o detector mockado devolve esta). */
function detection(over: Partial<SongGridDetection> = {}): SongGridDetection {
  return {
    bpm: 120, pulseBpm: 120, firstBeat: 0.1, downbeat: 0, confidence: 1, offbeatRisk: false, preferConflict: false,
    downbeatFrom: 'baixo', downbeatMargin: 2, alternatives: [60, 240], tracksUsed: ['bat'], ...over,
  }
}

function okPlan(over: Partial<SongGridDetection> = {}, signature: TimeSignature = '4/4'): AutoClickOkPlan {
  return { ok: true, detection: detection(over), signature, label: 'Bateria' }
}

beforeEach(() => {
  detect.mockClear()
  generate.mockClear()
  vi.mocked(analyzeBufferAndGenerateClick).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toTempoTracks', () => {
  it('pulso, baixo e harmonia com o papel de cada um e os canais do buffer', () => {
    const [l, r] = silence(0.5)
    const chs = [channel('k', 'Drums', [l, r]), channel('b', 'Bass'), channel('p', 'Pad'), channel('v', 'Vocal')]
    const tracks = toTempoTracks(pickTempoSources(chs))
    expect(tracks.map(t => [t.id, t.use])).toEqual([['k', 'pulse'], ['b', 'bass'], ['p', 'harmony']])
    expect(tracks[0].channels).toHaveLength(2)
    expect(tracks[0].channels[0]).toBe(chs[0].buffer.getChannelData(0))
    expect(tracks.map(t => t.label)).toEqual(['Bateria', 'Baixo', 'Pad'])
  })

  it('sem bateria nem percussão, o baixo é o pulso e continua votando no 1 como baixo', () => {
    const tracks = toTempoTracks(pickTempoSources([channel('b', 'Bass'), channel('t', 'Keys')]))
    expect(tracks.map(t => [t.id, t.use])).toEqual([['b', 'pulse'], ['b', 'bass'], ['t', 'harmony']])
  })
})

describe('planAutoClick', () => {
  it('ja-tem-click: a música tem click (papel manual vale) e nada é analisado', () => {
    const plan = planAutoClick([channel('c', 'Click'), channel('k', 'Drums')], { songBpm: 120 })
    expect(plan).toEqual({ ok: false, reason: 'ja-tem-click', label: 'Click' })
    const manual = planAutoClick([channel('x', 'Pad', silence(), { role: 'click', customName: 'Metrô' }), channel('k', 'Drums')], {})
    expect(manual).toEqual({ ok: false, reason: 'ja-tem-click', label: 'Metrô' })
    expect(detect).not.toHaveBeenCalled()
  })

  it('sem-faixa: nenhuma bateria, percussão ou baixo pra analisar', () => {
    expect(planAutoClick([channel('p', 'Pad'), channel('v', 'Vocal'), channel('g', 'Guia')], {}))
      .toEqual({ ok: false, reason: 'sem-faixa', label: '' })
    expect(detect).not.toHaveBeenCalled()
  })

  it('confianca-baixa abaixo do porteiro de 0,5 (detector mockado), com a detecção pra mostrar', () => {
    expect(AUTO_CLICK_MIN_CONFIDENCE).toBe(0.5)
    detect.mockReturnValueOnce(detection({ confidence: 0.49 }))
    const baixa = planAutoClick([channel('k', 'Drums'), channel('b', 'Bass')], { songBpm: 120 })
    expect(baixa).toMatchObject({ ok: false, reason: 'confianca-baixa', label: 'Bateria e Baixo', detection: { confidence: 0.49 } })
    detect.mockReturnValueOnce(detection({ confidence: 0.5 }))
    expect(planAutoClick([channel('k', 'Drums')], {}).ok).toBe(true)
  })

  it('passa o BPM da música como preferBpm, o compasso e o BPM escolhido (nearBpm); BPM salvo inválido não vai', () => {
    detect.mockReturnValueOnce(detection()).mockReturnValueOnce(detection()).mockReturnValueOnce(detection())
    planAutoClick([channel('k', 'Drums')], { songBpm: 72, signature: '6/8' })
    expect(detect.mock.calls[0][2]).toEqual({ preferBpm: 72, signature: '6/8', nearBpm: undefined })
    planAutoClick([channel('k', 'Drums')], { songBpm: 72, nearBpm: 144 })
    expect(detect.mock.calls[1][2]).toEqual({ preferBpm: 72, signature: '4/4', nearBpm: 144 })
    planAutoClick([channel('k', 'Drums')], { songBpm: Number.NaN })
    expect(detect.mock.calls[2][2]).toEqual({ preferBpm: undefined, signature: '4/4', nearBpm: undefined })
    expect(detect.mock.calls[0][1]).toBe(SR)
  })

  it('allowExistingClick analisa as outras faixas, nunca o click', () => {
    detect.mockReturnValueOnce(detection())
    const plan = planAutoClick([channel('c', 'Click'), channel('k', 'Drums')], { allowExistingClick: true })
    expect(plan.ok).toBe(true)
    expect(detect.mock.calls[0][0].map(t => t.id)).toEqual(['k'])
  })

  it('faixa com outra taxa de amostragem fica de fora (a conta é numa taxa só)', () => {
    detect.mockReturnValueOnce(detection())
    const baixo44 = { id: 'b', name: 'Bass', buffer: buffer(silence(1, 44100), 44100) }
    planAutoClick([channel('k', 'Drums'), baixo44], {})
    expect(detect.mock.calls[0][0].map(t => t.id)).toEqual(['k'])
  })

  it('ok no caso b sintético (120 BPM, 1º tempo em 1,37 s, bateria + baixo + pad): grade e 1 certos', () => {
    const song = tempoCase('b').song({ duration: 30 })
    const chs = [
      channel('k', 'Drums', song.tracks.drums), channel('b', 'Bass', song.tracks.bass), channel('p', 'Pad', song.tracks.pad),
    ]
    const plan = planAutoClick(chs, { songBpm: 120 })
    if (!plan.ok) throw new Error(`esperava ok, veio ${plan.reason}`)
    const d = plan.detection
    expect(plan.signature).toBe('4/4')
    expect(plan.label).toBe('Bateria e Baixo')
    expect(Math.abs(d.bpm - 120)).toBeLessThan(0.05)
    const P = 60 / d.pulseBpm
    const um = d.firstBeat + d.downbeat * P
    expect(Math.abs(um - 1.37)).toBeLessThan(0.01)
    expect(d.confidence).toBeGreaterThanOrEqual(AUTO_CLICK_MIN_CONFIDENCE)
    expect(d.downbeatFrom).toBe('baixo')
    expect(autoClickChecks(d)).toEqual([])
  }, LENTO)
})

describe('autoClickChecks (o que o modal e a T27 pedem pra conferir)', () => {
  it('todo bumbo-lidera, empate desfeito pelo começo da bateria, reserva e origem ausente pedem pra conferir o 1', () => {
    for (const downbeatFrom of ['bumbo-lidera', 'inicio-da-bateria', 'reserva'] as const) {
      expect(autoClickChecks(detection({ downbeatFrom, downbeatMargin: 3 }))).toEqual(['um'])
    }
    expect(autoClickChecks(detection({ downbeatFrom: undefined, downbeatMargin: undefined }))).toEqual(['um'])
  })

  it(`baixo, harmonia e bumbo pedem pra conferir com folga abaixo de ${DOWNBEAT_MIN_MARGIN} (o bumbo do 3 a +1,3 dB sai com 0,56)`, () => {
    expect(DOWNBEAT_MIN_MARGIN).toBe(0.76)
    for (const downbeatFrom of ['baixo', 'harmonia', 'bumbo'] as const) {
      expect(autoClickChecks(detection({ downbeatFrom, downbeatMargin: 0.75 }))).toEqual(['um'])
      expect(autoClickChecks(detection({ downbeatFrom, downbeatMargin: 0.76 }))).toEqual([])
    }
    expect(autoClickChecks(detection({ downbeatFrom: 'bumbo', downbeatMargin: 0.561 }))).toEqual(['um'])
  })

  it('contratempo, BPM salvo que não bate e família escolhida pelo salvo', () => {
    expect(autoClickChecks(detection({ offbeatRisk: true, preferConflict: true, preferChoseFamily: true, downbeatFrom: 'bumbo-lidera' })))
      .toEqual(['um', 'contratempo', 'bpm-salvo', 'andamento'])
  })
})

describe('adjustAutoClick (Mover o 1 e Deslocar meio tempo)', () => {
  const um = (d: SongGridDetection) => d.firstBeat + d.downbeat * (60 / d.pulseBpm)

  it('Mover o 1 anda de tempo em tempo e dá a volta no compasso', () => {
    const plan = okPlan({ firstBeat: 0.1, downbeat: 0 })
    expect(adjustAutoClick(plan, { moveOne: 1, halfBeat: false }).detection.downbeat).toBe(1)
    expect(adjustAutoClick(plan, { moveOne: -1, halfBeat: false }).detection.downbeat).toBe(3)
    expect(adjustAutoClick(plan, { moveOne: 5, halfBeat: false }).detection.downbeat).toBe(1)
    expect(adjustAutoClick(okPlan({ downbeat: 2 }, '3/4'), { moveOne: 1, halfBeat: false }).detection.downbeat).toBe(0)
    expect(adjustAutoClick(plan, { moveOne: 0, halfBeat: false })).toEqual(plan)
  })

  it('Deslocar meio tempo leva a grade e o 1 meio pulso pra frente, com o 1º pulso dentro do primeiro pulso', () => {
    for (const firstBeat of [0.1, 0.3, 0.49]) {
      const plan = okPlan({ firstBeat, downbeat: 1 })
      const d = adjustAutoClick(plan, { moveOne: 0, halfBeat: true }).detection
      expect(um(d) - um(plan.detection)).toBeCloseTo(0.25, 9)
      expect(d.firstBeat).toBeGreaterThanOrEqual(0)
      expect(d.firstBeat).toBeLessThan(0.5)
      expect(d.bpm).toBe(120)
    }
  })
})

describe('renderAutoClick', () => {
  function stubFetch() {
    const blob = new Blob(['wav'], { type: 'audio/wav' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => blob })))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { blob, revoke }
  }

  it('gera o click da biblioteca com acento no 1, na grade e no compasso do plano', async () => {
    const { blob, revoke } = stubFetch()
    const plan = okPlan({ bpm: 100.5, pulseBpm: 100.5, firstBeat: 0.21, downbeat: 2 })
    expect(await renderAutoClick(plan, 180, { type: 'Woodblock', subdivision: 'eighth' })).toBe(blob)
    expect(generate).toHaveBeenCalledWith('Woodblock', 'eighth', 100.5, 180, true, '4/4', { firstBeat: 0.21, downbeat: 2 })
    expect(revoke).toHaveBeenCalledWith('blob:click-auto')
  })

  it('no x/8 o click anda na colcheia (pulseBpm), nunca na semínima mostrada', async () => {
    stubFetch()
    await renderAutoClick(okPlan({ bpm: 70, pulseBpm: 140, firstBeat: 0.05, downbeat: 3 }, '6/8'), 60, { type: 'Classic', subdivision: 'quarter' })
    expect(generate).toHaveBeenCalledWith('Classic', 'quarter', 140, 60, true, '6/8', { firstBeat: 0.05, downbeat: 3 })
  })

  it('o fluxo inteiro nunca chama o caminho antigo (analyzeBufferAndGenerateClick)', async () => {
    stubFetch()
    detect.mockReturnValueOnce(detection())
    const plan = planAutoClick([channel('k', 'Drums'), channel('b', 'Bass')], { songBpm: 120 })
    if (!plan.ok) throw new Error('esperava ok')
    await renderAutoClick(plan, 30, { type: 'Classic', subdivision: 'quarter' })
    detect.mockReturnValueOnce(detection({ confidence: 0.1 }))
    planAutoClick([channel('k', 'Drums')], {})
    planAutoClick([channel('p', 'Pad')], {})
    expect(analyzeBufferAndGenerateClick).not.toHaveBeenCalled()
  })
})

// Click sincronizado do Separador (Rulings M2-5, M2-7, M2b-2 e M7-arquivos): corte próprio na
// escala nova da confiança, medido com áudio real (relatório da M7), nunca o CONFIDENCE_CUT.
describe('Separador: corte próprio da grade do click', () => {
  it('abaixo do corte (ou sem grade) o click sai no BPM digitado a partir de 0:00; no corte, alinhado', () => {
    expect(SEPARATOR_MIN_CONFIDENCE).toBe(0.14)
    expect(separatorGridUsable(null)).toBe(false)
    expect(separatorGridUsable(undefined)).toBe(false)
    expect(separatorGridUsable({ confidence: SEPARATOR_MIN_CONFIDENCE - 0.001 })).toBe(false)
    expect(separatorGridUsable({ confidence: SEPARATOR_MIN_CONFIDENCE })).toBe(true)
    expect(separatorGridUsable({ confidence: Number.NaN })).toBe(false)
  })

  it('com o BPM digitado (nearBpm): bateria sintética alinha; ruído e voz não', () => {
    const b = tempoCase('b').song({ votes: false, duration: 30 })
    expect(separatorGridUsable(detectBeatGrid(b.tracks.drums, b.sr, { nearBpm: 120, beatsPerBar: 4 }))).toBe(true)
    for (const id of ['ruido-branco', 'voz-glissando']) {
      const song = tempoCase(id).song({ duration: 30 })
      const grid = detectBeatGrid(song.tracks.drums, song.sr, { nearBpm: 120, beatsPerBar: 4 })
      expect({ id, usable: separatorGridUsable(grid) }).toEqual({ id, usable: false })
    }
  }, LENTO)

  // Parte 3: as contas do click do Separador moram em src/lib/separation/separatorClick.ts (o
  // Separador de reserva e o painel SEPARAÇÃO do palco usam as duas); nenhuma ficou na tela.
  it('o click do Separador decide pelo corte próprio nos dois lugares, sem número solto', () => {
    const src = readFileSync(fileURLToPath(new URL('./separation/separatorClick.ts', import.meta.url)), 'utf8')
    const sep = readFileSync(fileURLToPath(new URL('../components/SeparatorStudio.tsx', import.meta.url)), 'utf8')
    for (const s of [src, sep]) {
      expect(s).not.toMatch(/confidence\s*(>=|<)\s*0?\.\d/)
      expect(s).not.toMatch(/CONFIDENCE_CUT|AUTO_CLICK_MIN_CONFIDENCE/)
    }
    expect(src.match(/separatorGridUsable\(/g) ?? []).toHaveLength(2)
    expect(sep.match(/separatorGridUsable\(/g) ?? []).toHaveLength(0)
  })
})
