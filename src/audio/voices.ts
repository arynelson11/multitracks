// Vozes do palco novo (Parte 2, Arquitetura A). Uma voz é uma AudioBufferSourceNode com um
// envelope GainNode próprio, ligada na ENTRADA do canal: o worklet de tom (tom diferente de
// 0), o DelayNode de compensação (click e guia com a música transposta) ou o StereoPannerNode
// (tom 0). O resto da cadeia do canal (panner, fader, barramento) não muda: uma voz nunca cria
// worklet nem duplica cadeia, só nasce a fonte e o envelope.
// Todo instante aqui é tempo do AudioContext (o relógio do áudio manda); quem decide QUANDO
// chamar é o agendador.

export interface Voice { channelId: string; source: AudioBufferSourceNode; env: GainNode }
export interface VoiceSpec { channelId: string; buffer: AudioBuffer; entry: AudioNode; loop?: boolean }

/**
 * Começa uma voz em `at` (tempo do contexto) no ponto `offset` da faixa (segundos do buffer):
 * fonte, envelope em 1 e `spec.entry`. Offset negativo vira 0. `rate` é a velocidade
 * (playbackRate, 1 por padrão). Quando a fonte termina, fonte e envelope se desligam; vai por
 * addEventListener('ended') pra quem usa a voz (o motor) ainda poder pôr o próprio onended.
 */
export function startVoice(ctx: BaseAudioContext, spec: VoiceSpec, at: number, offset: number, rate = 1): Voice {
  const source = ctx.createBufferSource()
  const env = ctx.createGain()
  source.buffer = spec.buffer
  if (spec.loop) source.loop = true
  source.playbackRate.value = rate
  source.connect(env)
  env.connect(spec.entry)
  source.addEventListener('ended', () => {
    source.disconnect()
    env.disconnect()
  }, { once: true })
  source.start(at, Math.max(0, offset))
  return { channelId: spec.channelId, source, env }
}

/**
 * Vozes novas de um pulo que chega em `targetOffset` da música no instante `T`. Com pré-rolagem
 * (alvo a pelo menos um fade do começo) cada voz começa em `T - fade` e o envelope sobe de 0 a 1
 * em `[T - fade, T]`; com o alvo em 0:00 (ou a menos de um fade dele) começa em `T`, no próprio
 * alvo, com envelope 1. A pré-rolagem anda `fade * rate` na faixa: com velocidade diferente de 1
 * a voz ainda está no alvo em `T`, como a linha do tempo (`songStart + (ctx - ctxStart) * rate`).
 * Com `rate` 1 é o literal do plano: começa em `T - fade` com offset `targetOffset - fade`.
 */
export function startVoicesForSwitch(ctx: BaseAudioContext, specs: readonly VoiceSpec[], T: number, targetOffset: number, fade: number, rate = 1): Voice[] {
  const lead = fade * rate
  const preroll = targetOffset >= lead
  return specs.map((spec) => {
    if (!preroll) return startVoice(ctx, spec, T, targetOffset, rate)
    const voice = startVoice(ctx, spec, T - fade, targetOffset - lead, rate)
    voice.env.gain.setValueAtTime(0, T - fade)
    voice.env.gain.linearRampToValueAtTime(1, T)
    return voice
  })
}

/** Vozes que saem no pulo: envelope de 1 a 0 em `[T - fade, T]`. Ficam mudas tocando até o agendador soltá-las (`stopVoices`). */
export function fadeOutVoices(voices: readonly Voice[], T: number, fade: number): void {
  for (const v of voices) {
    v.env.gain.setValueAtTime(1, T - fade)
    v.env.gain.linearRampToValueAtTime(0, T)
  }
}

/** Pulo cancelado: apaga a descida agendada e devolve o envelope pra 1 em `now`. */
export function restoreVoices(voices: readonly Voice[], now: number): void {
  for (const v of voices) {
    v.env.gain.cancelScheduledValues(now)
    v.env.gain.setValueAtTime(1, now)
  }
}

/** Para as fontes em `at`. Fonte que nunca começou (ou que o navegador recusa parar) não impede as outras. */
export function stopVoices(voices: readonly Voice[], at: number): void {
  for (const v of voices) {
    try { v.source.stop(at) } catch { /* nunca começou: não há o que parar */ }
  }
}
