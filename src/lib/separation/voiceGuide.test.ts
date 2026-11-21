import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GUIDE_DYNAMICS, GUIDE_SECTIONS, detectVoiceCues, float32ToWav, formatCueTime, guideUrl, parseCueTime,
  renderVoiceGuideWav, stemColor, voiceSourceTrack, type MonoSource,
} from './voiceGuide'
import { FAMILY_COLOR } from '../channelNames'

const TRAVESSAO = String.fromCharCode(0x2014)

/** Áudio mono falso: cada degrau é um trecho de `secs` segundos com a amplitude dada. */
function steppedSource(steps: { secs: number; amp: number }[], sampleRate = 1000): MonoSource {
  const total = steps.reduce((a, s) => a + s.secs, 0)
  const data = new Float32Array(total * sampleRate)
  let at = 0
  for (const s of steps) {
    for (let i = 0; i < s.secs * sampleRate; i++) data[at + i] = s.amp * (i % 2 === 0 ? 1 : -1)
    at += s.secs * sampleRate
  }
  return { numberOfChannels: 1, length: data.length, sampleRate, duration: total, getChannelData: () => data }
}

describe('voiceGuide', () => {
  // Revisão sep-2 I4 (Ruling SEP-cor-guia): âmbar é só alerta; a voz guia é da família Guia.
  it('stemColor mostra a voz guia antiga (âmbar) na cor da família Guia e deixa o resto como veio', () => {
    expect(stemColor({ id: 'voiceguide', color: '#fbbf24' })).toBe(FAMILY_COLOR.guia)
    expect(stemColor({ id: 'voiceguide', color: '#FBBF24' })).toBe(FAMILY_COLOR.guia)
    expect(stemColor({ id: 'voiceguide', color: FAMILY_COLOR.guia })).toBe(FAMILY_COLOR.guia)
    expect(stemColor({ id: 'drums', color: '#f59e0b' })).toBe('#f59e0b')
    expect(stemColor({ id: 'other', color: '#fbbf24' })).toBe('#fbbf24')
  })

  it('o Separador gera a voz guia na cor da família Guia (nenhum âmbar fixo no código)', () => {
    const studio = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(studio).not.toMatch(/#fbbf24/i)
    expect(studio).toMatch(/id: 'voiceguide', name: 'Voz Guia', url, color: FAMILY_COLOR\.guia/)
  })

  it('formatCueTime e parseCueTime', () => {
    expect(formatCueTime(65)).toBe('1:05')
    expect(formatCueTime(0)).toBe('0:00')
    expect(parseCueTime('1:05')).toBe(65)
    expect(parseCueTime('2:3.5')).toBe(123.5)
    expect(parseCueTime('abc')).toBe(0)
    expect(parseCueTime('-1:00')).toBe(0)
  })

  it('guideUrl usa o BASE_URL e codifica cada parte (nunca "/" absoluto no desktop)', () => {
    expect(guideUrl('Song Sections/Portugese - Intro.wav')).toBe(`${import.meta.env.BASE_URL}Portugese%20Guides/Song%20Sections/Portugese%20-%20Intro.wav`)
  })

  it('o catálogo continua com as seções e as dinâmicas de hoje, na mesma ordem', () => {
    expect(GUIDE_SECTIONS).toHaveLength(43)
    expect(GUIDE_SECTIONS[0]).toEqual({ label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' })
    expect(GUIDE_SECTIONS.at(-1)).toEqual({ label: '6', file: 'Song Sections/Portugese - 6.wav' })
    expect(GUIDE_DYNAMICS).toHaveLength(22)
    expect(GUIDE_DYNAMICS[0]).toEqual({ label: 'All In', file: 'Dynamic Cues/Portugese - All In.wav' })
    expect(GUIDE_DYNAMICS.at(-1)).toEqual({ label: 'Swell', file: 'Dynamic Cues/Portugese - Swell.wav' })
  })

  it('float32ToWav escreve o cabeçalho RIFF/WAVE de 16 bits mono', async () => {
    const blob = float32ToWav(new Float32Array(10), 44100)
    expect(blob.size).toBe(44 + 20)
    expect(blob.type).toBe('audio/wav')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const head = new TextDecoder().decode(bytes.slice(0, 12))
    expect(head.startsWith('RIFF')).toBe(true)
    expect(head.endsWith('WAVE')).toBe(true)
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it('renderVoiceGuideWav põe cada marcação no seu tempo e pula a que não decodifica', async () => {
    const decoded: string[] = []
    const decode = async (url: string) => {
      decoded.push(url)
      if (url.includes('Intro')) {
        const d = new Float32Array([0.5])
        return { numberOfChannels: 1, length: 1, getChannelData: () => d } as unknown as AudioBuffer
      }
      return null
    }
    const blob = await renderVoiceGuideWav([
      { id: 'a', time: 1, label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' },
      { id: 'b', time: 0.5, label: 'Verso', file: 'Song Sections/Portugese - Verse.wav' },
    ], 2, decode)
    expect(blob).not.toBeNull()
    expect(decoded).toHaveLength(2)
    expect(decoded[0]).toBe(guideUrl('Song Sections/Portugese - Intro.wav'))
    const view = new DataView(await blob!.arrayBuffer())
    // 2 s a 44100 Hz, 16 bits.
    expect(view.getUint32(40, true)).toBe(2 * 44100 * 2)
    // A amostra da Intro cai em 1 s (44100); a do verso não entra.
    expect(view.getInt16(44 + 44100 * 2, true)).toBe(Math.trunc(0.5 * 32767))
    expect(view.getInt16(44 + 22050 * 2, true)).toBe(0)
  })

  it('renderVoiceGuideWav sem marcações devolve null', async () => {
    expect(await renderVoiceGuideWav([], 10, async () => null)).toBeNull()
  })

  it('detectVoiceCues: Intro no 0, Final no fim, refrão no trecho forte, e tudo em ordem', () => {
    const src = steppedSource([
      { secs: 30, amp: 0.1 }, { secs: 30, amp: 0.3 }, { secs: 30, amp: 0.9 }, { secs: 30, amp: 0.2 },
    ])
    const cues = detectVoiceCues(src, '120', () => 1000)
    expect(cues[0].label).toBe('Intro')
    expect(cues[0].time).toBe(0)
    expect(cues.at(-1)!.label).toBe('Final')
    expect(cues.some((c) => c.label.startsWith('Refrão'))).toBe(true)
    for (let i = 1; i < cues.length; i++) expect(cues[i].time).toBeGreaterThanOrEqual(cues[i - 1].time)
    for (const c of cues) {
      expect(c.label).not.toContain(TRAVESSAO)
      expect(c.file.startsWith('Song Sections/')).toBe(true)
    }
  })

  it('detectVoiceCues: com a Intro no 0 a contagem 1 a 4 não entra (como hoje)', () => {
    // A contagem só entra quando a Intro tem espaço antes dela; o algoritmo de hoje sempre põe
    // a Intro no 0, então ela não aparece. O código foi movido sem mudar nenhuma conta.
    const src = steppedSource([{ secs: 40, amp: 0.2 }, { secs: 40, amp: 0.9 }])
    const cues = detectVoiceCues(src, '90', () => 5)
    expect(cues.filter((c) => /^[1-4]$/.test(c.label))).toHaveLength(0)
  })

  it('detectVoiceCues nunca passa de 12 seções (mais a contagem)', () => {
    const steps = Array.from({ length: 40 }, (_, i) => ({ secs: 16, amp: i % 2 === 0 ? 0.1 : 0.9 }))
    const cues = detectVoiceCues(steppedSource(steps), '120', () => 7)
    expect(cues.filter((c) => !/^[1-4]$/.test(c.label)).length).toBeLessThanOrEqual(12)
  })

  it('voiceSourceTrack acha o vocal pela família nos dois formatos e nunca pega a Voz Guia', () => {
    expect(voiceSourceTrack([{ id: 'voiceguide', name: 'Voz Guia' }, { id: 'vocals', name: 'Vocais' }])?.id).toBe('vocals')
    expect(voiceSourceTrack([{ id: 'u1', name: 'Voz Guia' }, { id: 'u2', name: 'Bateria' }])?.id).toBe('u2')
    expect(voiceSourceTrack([{ id: 'metronome', name: 'Metrônomo' }, { id: 'x', name: 'Click gerado' }])).toBeUndefined()
  })

  it('o SeparatorStudio não define mais o catálogo nem o WAV (importa de voiceGuide.ts)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(src).not.toMatch(/const GUIDE_SECTIONS|const GUIDE_DYNAMICS|function float32ToWav|function guideUrl|function formatCueTime/)
    expect(src).toMatch(/from '\.\.\/lib\/separation\/voiceGuide'/)
  })
})
