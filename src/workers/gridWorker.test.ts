import { describe, expect, it } from 'vitest'
import { planAutoClick, type AutoClickChannel } from '../lib/autoClick'
import { analyzeClickTrack } from '../lib/clickMeter'
import { FakeAudioBuffer } from '../test/fakeAudio'
import { tempoCase } from '../test/tempoCases'
import { handleGridRequest, tempoChannelsForPlan, type GridWorkerChannel } from './gridWorker'

// O Worker da grade (Ruling T27-worker) responde com as MESMAS funções que o motor chamava na
// thread principal: o resultado tem de ser idêntico, número por número. O registro do
// onmessage só existe dentro do Worker; aqui o pedido vai direto no handleGridRequest.

const SR = 48000
// Sintetizar e detectar 30 s de música leva ~1 s; folga pra máquina carregada.
const LENTO = 20_000

function synthClick(bpm: number, seconds: number, pulsesPerBar: number, firstPulse: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  const len = Math.round(0.025 * SR)
  for (let k = 0; ; k++) {
    const t = firstPulse + (k * 60) / bpm
    if (t >= seconds) break
    const amp = k % pulsesPerBar === 0 ? 0.72 : 0.4
    const start = Math.round(t * SR)
    for (let i = 0; i < len && start + i < out.length; i++) out[start + i] += amp * Math.exp(-i / SR / 0.008) * Math.sin((2 * Math.PI * 1200 * i) / SR)
  }
  return out
}

function buffer(channels: readonly Float32Array[]): AudioBuffer {
  const b = new FakeAudioBuffer(channels.length, channels[0].length, SR)
  channels.forEach((c, i) => b.copyToChannel(c, i))
  return b as unknown as AudioBuffer
}
const silence = (seconds = 30) => [new Float32Array(seconds * SR), new Float32Array(seconds * SR)]
/** O canal como o motor manda: identidade e uma CÓPIA de cada canal do áudio. */
const toWorker = (ch: AutoClickChannel): GridWorkerChannel => ({
  id: ch.id, name: ch.name, customName: ch.customName, role: ch.role, sampleRate: ch.buffer.sampleRate,
  data: Array.from({ length: ch.buffer.numberOfChannels }, (_, c) => ch.buffer.getChannelData(c).slice()),
})

describe('handleGridRequest: click', () => {
  it('dá a mesma leitura do analyzeClickTrack chamado direto (com e sem compasso e BPM)', () => {
    const x = synthClick(100, 20, 3, 0.5)
    for (const [known, bpm] of [[null, null], [null, 100], ['6/8', 50]] as const) {
      const direct = analyzeClickTrack(x, SR, known, bpm)
      expect(direct).not.toBeNull()
      expect(handleGridRequest({ id: 7, kind: 'click', samples: x.slice(), sampleRate: SR, known, bpm })).toEqual({ id: 7, kind: 'click', analysis: direct })
    }
  })

  it('sem pulso: leitura nula, sem erro', () => {
    expect(handleGridRequest({ id: 1, kind: 'click', samples: new Float32Array(10 * SR), sampleRate: SR, known: null, bpm: null }))
      .toEqual({ id: 1, kind: 'click', analysis: null })
  })
})

describe('handleGridRequest: plano do click que falta', () => {
  it('só com as faixas do tempo dá o mesmo plano que o planAutoClick com a música inteira', () => {
    const song = tempoCase('b').song({ duration: 30 })
    const all: AutoClickChannel[] = [
      { id: 'v', name: 'VOX LEAD', buffer: buffer(silence()) },
      { id: 'k', name: 'Drums', buffer: buffer(song.tracks.drums) },
      { id: 'g', name: 'Voz Guia', buffer: buffer(silence()) },
      { id: 'b', name: 'Bass', buffer: buffer(song.tracks.bass) },
      { id: 'p', name: 'Pad', buffer: buffer(song.tracks.pad) },
      { id: 'e', name: 'Piano', buffer: buffer(silence()) },
      { id: 't', name: 'Teclado', buffer: buffer(silence()) },
    ]
    const sent = tempoChannelsForPlan(all)
    // Voz, guia e o 3º harmônico não viajam.
    expect(sent.map((c) => c.id)).toEqual(['k', 'b', 'p', 'e'])
    const opts = { songBpm: 120, signature: '4/4' as const }
    const direct = planAutoClick(all, opts)
    expect(direct.ok).toBe(true)
    expect(handleGridRequest({ id: 3, kind: 'plano', channels: sent.map(toWorker), ...opts })).toEqual({ id: 3, kind: 'plano', plan: direct })
  }, LENTO)

  it('papel manual e nome do usuário valem na escolha das faixas', () => {
    const all: AutoClickChannel[] = [
      { id: 'x', name: 'Track 1', customName: 'Bateria', buffer: buffer(silence(1)) },
      { id: 'y', name: 'Drums', role: 'guide', buffer: buffer(silence(1)) },
      { id: 'z', name: 'Bass', buffer: buffer(silence(1)) },
    ]
    expect(tempoChannelsForPlan(all).map((c) => c.id)).toEqual(['x', 'z'])
  })

  it('sem faixa de tempo: o mesmo "sem-faixa" do planAutoClick', () => {
    const all: AutoClickChannel[] = [{ id: 'v', name: 'VOX', buffer: buffer(silence(1)) }]
    expect(handleGridRequest({ id: 4, kind: 'plano', channels: tempoChannelsForPlan(all).map(toWorker) }))
      .toEqual({ id: 4, kind: 'plano', plan: planAutoClick(all, {}) })
  })

  it('pedido desconhecido vira resposta de erro, sem derrubar o Worker', () => {
    const bad = { id: 9, kind: 'outro' } as unknown as Parameters<typeof handleGridRequest>[0]
    expect(handleGridRequest(bad)).toMatchObject({ id: 9, kind: 'erro' })
  })
})
