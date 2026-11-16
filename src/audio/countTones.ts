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
// Cancelar com um bipe soando: o envelope desce em curva exponencial (setTargetAtTime) com esta
// constante de tempo e os osciladores param 20 ms depois do cancel, já em silêncio (o envelope
// fica abaixo de 0,0001). Cortar no meio do bipe estalaria no ouvido da banda. Medido no Chrome
// real por scripts/verify-audio/count-cancel.mjs: degrau por amostra <= 0,01 em todo instante
// do bipe, no acento e no tempo comum, a 48 e a 44,1 kHz. Com 0,0015 o acento passava (0,0117).
const CANCEL_TC = 0.002
const CANCEL_STOP = 0.02

/** Um tempo da contagem: instante (tempo do contexto) e o número do tempo no compasso (1 = acento). */
export interface CountBeat { at: number; label: number }
/** Contagem agendada: `beats` são os bipes que de fato entraram (sem os que já tinham passado). */
export interface ScheduledCount { readonly beats: readonly CountBeat[]; cancel(now: number): void }

interface Beep { at: number; peak: number; end: number; env: GainNode; oscs: OscillatorNode[]; nodes: AudioNode[] }

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

  const beep: Beep = { at, peak, end, env, oscs: [tri, square], nodes: [tri, square, squareGain, env, lowpass] }
  // Os dois osciladores param juntos: o fim do triângulo solta o bipe inteiro.
  tri.addEventListener('ended', () => disconnectAll(beep), { once: true })
  for (const osc of beep.oscs) { osc.start(at); osc.stop(end) }
  return beep
}

function disconnectAll(beep: Beep): void {
  for (const node of beep.nodes) node.disconnect()
}

function stopAll(beep: Beep, at: number): void {
  for (const osc of beep.oscs) {
    try { osc.stop(at) } catch { /* o navegador recusou: quem desliga é o chamador ou o ended */ }
  }
}

/** Ganho do envelope do bipe no instante `t`, pela própria receita (o que o navegador está tocando). */
function envelopeAt(beep: Beep, t: number): number {
  const dt = t - beep.at
  if (dt <= 0) return 0
  if (dt < COUNT_TONE.attack) return (beep.peak * dt) / COUNT_TONE.attack
  if (dt < COUNT_TONE.hold) return beep.peak
  if (dt < COUNT_TONE.release) return beep.peak * Math.pow(RELEASE_FLOOR / beep.peak, (dt - COUNT_TONE.hold) / (COUNT_TONE.release - COUNT_TONE.hold))
  return RELEASE_FLOOR
}

/**
 * O cancelAndHoldAtTime feito à mão, pro navegador sem ele (Firefox), com o valor de `now` pela
 * receita do bipe (não pelo getter). Rampa em curso (ataque ou queda) volta a terminar em `now`
 * com esse valor; fora de rampa, um set em `now`. Um set no meio da rampa não serve: o
 * cancelScheduledValues tira a rampa em curso e, quando o set cai uma amostra depois do início
 * do bloco, essa amostra toca o valor de antes da rampa (pico de até 0,85 medido no Chrome).
 */
function holdByRecipe(beep: Beep, now: number): void {
  const gain = beep.env.gain
  const value = envelopeAt(beep, now)
  const dt = now - beep.at
  gain.cancelScheduledValues(now)
  if (dt < COUNT_TONE.attack) gain.linearRampToValueAtTime(value, now)
  else if (dt >= COUNT_TONE.hold && dt < COUNT_TONE.release) gain.exponentialRampToValueAtTime(value, now)
  else gain.setValueAtTime(value, now)
}

/**
 * Cancela um bipe em `now` sem degrau no som. Com o bipe soando, o envelope desce por
 * setTargetAtTime a partir do valor de `now`. Não pode ser rampa: pela especificação, o
 * cancelAndHoldAtTime só insere um evento em `now` quando uma rampa cruza `now`; na sustentação
 * (próximo evento é setValueAtTime) ele só apaga, e uma rampa pedida depois partiria do fim do
 * ataque (degrau de até 0,64 medido no Chrome). O setTargetAtTime parte do valor que o
 * parâmetro tem em `now`, com ou sem evento inserido.
 */
function cancelBeep(beep: Beep, now: number): void {
  if (beep.at > now) {
    // Ainda não começou: não há som pra descer, para e desliga já.
    stopAll(beep, now)
    disconnectAll(beep)
  } else if (now < beep.end) {
    // Soando: desce de onde está e só depois para; o ended desliga.
    const gain = beep.env.gain
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now)
    else holdByRecipe(beep, now)
    gain.setTargetAtTime(0, now, CANCEL_TC)
    stopAll(beep, now + CANCEL_STOP)
  } else {
    // Já acabou (o ended desliga ou já desligou): só garante.
    disconnectAll(beep)
  }
}

/**
 * Agenda um bipe por tempo em `dest` (acento no tempo 1). Bipe com `at` antes do
 * `ctx.currentTime` é pulado: armou tarde, sai só o que resta, com o número real do tempo.
 * `cancel(now)`, com `now` = `ctx.currentTime`: bipe que ainda não começou para em `now` e
 * desliga na hora; bipe soando desce em curva exponencial a partir do ganho de `now`, para em
 * `now + 0,02` (já em silêncio) e se desliga no fim; bipe que já acabou só desliga. A segunda
 * chamada não faz nada.
 */
export function scheduleCount(ctx: BaseAudioContext, dest: AudioNode, beats: readonly CountBeat[]): ScheduledCount {
  const kept = beats.filter((b) => b.at >= ctx.currentTime)
  const beeps = kept.map((b) => scheduleBeep(ctx, dest, b))
  let cancelled = false
  return {
    beats: kept,
    cancel(now: number) {
      if (cancelled) return
      cancelled = true
      for (const beep of beeps) cancelBeep(beep, now)
    },
  }
}
