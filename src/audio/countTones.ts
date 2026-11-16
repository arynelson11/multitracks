// Bipes da contagem do pulo (e da pré-contagem), sintetizados pela receita vCount do protótipo
// v6: triângulo na frequência mais quadrada no dobro (baixinha), envelope curto e passa-baixa.
// Mais longo, mais forte e com outro timbre que o click, pra ninguém confundir os dois.
// Tudo sai SÓ por `dest`: a entrada do canal de click (passa pelo pan, fader e M dele) ou, sem
// canal de click, o atraso próprio da contagem no barramento do Click (R-35). Nunca na PA.
// Instantes em tempo do AudioContext.

export const COUNT_TONE = { accentHz: 1319, beatHz: 988, accentPeak: 0.85, beatPeak: 0.68, attack: 0.004, hold: 0.075, release: 0.19, lowpassHz: 5200, squareMix: 0.1 } as const

// Também do vCount do v6: a queda exponencial mira 0,0005 (exponencial não chega em 0), os
// osciladores param 30 ms depois do fim da queda (t + 0,22) e o passa-baixa tem Q 0,7.
const RELEASE_FLOOR = 0.0005
const STOP_AFTER_RELEASE = 0.03
const LOWPASS_Q = 0.7

/** Um tempo da contagem: instante (tempo do contexto) e o número do tempo no compasso (1 = acento). */
export interface CountBeat { at: number; label: number }
/** Contagem agendada: `beats` são os bipes que de fato entraram (sem os que já tinham passado). */
export interface ScheduledCount { readonly beats: readonly CountBeat[]; cancel(now: number): void }

interface Beep { oscs: OscillatorNode[]; nodes: AudioNode[] }

function scheduleBeep(ctx: BaseAudioContext, dest: AudioNode, { at, label }: CountBeat): Beep {
  const accent = label === 1
  const hz = accent ? COUNT_TONE.accentHz : COUNT_TONE.beatHz
  const peak = accent ? COUNT_TONE.accentPeak : COUNT_TONE.beatPeak
  const end = at + COUNT_TONE.release + STOP_AFTER_RELEASE

  const tri = ctx.createOscillator()
  tri.type = 'triangle'
  tri.frequency.value = hz
  const square = ctx.createOscillator()
  square.type = 'square'
  square.frequency.value = hz * 2
  const squareGain = ctx.createGain()
  squareGain.gain.value = COUNT_TONE.squareMix
  const env = ctx.createGain()
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = COUNT_TONE.lowpassHz
  lowpass.Q.value = LOWPASS_Q

  tri.connect(env)
  square.connect(squareGain)
  squareGain.connect(env)
  env.connect(lowpass)
  lowpass.connect(dest)

  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(peak, at + COUNT_TONE.attack)
  env.gain.setValueAtTime(peak, at + COUNT_TONE.hold)
  env.gain.exponentialRampToValueAtTime(RELEASE_FLOOR, at + COUNT_TONE.release)

  const beep: Beep = { oscs: [tri, square], nodes: [tri, square, squareGain, env, lowpass] }
  // Os dois osciladores param juntos: o fim do triângulo solta o bipe inteiro.
  tri.addEventListener('ended', () => disconnectAll(beep), { once: true })
  for (const osc of beep.oscs) { osc.start(at); osc.stop(end) }
  return beep
}

function disconnectAll(beep: Beep): void {
  for (const node of beep.nodes) node.disconnect()
}

/**
 * Agenda um bipe por tempo em `dest` (acento no tempo 1). Bipe com `at` antes do
 * `ctx.currentTime` é pulado: armou tarde, sai só o que resta, com o número real do tempo.
 * `cancel(now)` para os osciladores em `now` e desliga os nós (pode ser chamado mais de uma vez).
 */
export function scheduleCount(ctx: BaseAudioContext, dest: AudioNode, beats: readonly CountBeat[]): ScheduledCount {
  const kept = beats.filter((b) => b.at >= ctx.currentTime)
  const beeps = kept.map((b) => scheduleBeep(ctx, dest, b))
  return {
    beats: kept,
    cancel(now: number) {
      for (const beep of beeps) {
        for (const osc of beep.oscs) {
          try { osc.stop(now) } catch { /* o navegador recusou: o bipe já está desligado abaixo */ }
        }
        disconnectAll(beep)
      }
    },
  }
}
