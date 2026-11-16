// Escala do fader do mixer novo (mockup v6: dbOf, dbGain, dbTxt, panTxt) e as contas do
// arrasto e da largura das faixas. Puro: sem React e sem Web Audio.
// Posição do fader `f` de 0 (pé) a 1 (topo); 0 dB fica em 3/4 do curso e o topo é +6 dB.
// Ganho `g` linear, o mesmo do motor (Channel.volume): 1 = 0 dB, perto de 2 = +6 dB.

/** Posição do fader em 0 dB. */
export const FADER_ZERO = 0.75
/** Fader e pan só mudam depois de o dedo andar isso na vertical: toque sem arrastar não muda nada. */
export const DRAG_START_PX = 3
/** Abaixo disso o fader é silêncio (−∞ dB). */
const FADER_FLOOR = 0.02
/** Topo do fader (+6 dB, decisão 11 do plano). Constante única: o celular da banda (T29) usa o mesmo teto. */
export const FADER_MAX_DB = 6
/** dB por década na parte de baixo do curso (40 x log10: −12 dB na metade do caminho até o 0). */
const LOW_SLOPE = 40
/** Curso mínimo do arrasto, pra um fader baixinho não ficar sensível demais. */
const MIN_TRAVEL_PX = 40
/** Pan por pixel arrastado na vertical. */
const PAN_PER_PX = 0.014
/** Pan tão perto do centro que vira centro. */
const PAN_SNAP = 0.04
// Sinal de menos tipográfico (U+2212), como no mockup.
const MINUS = '−'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Ganho linear do topo do fader (+6 dB, perto de 2). */
export const FADER_MAX_GAIN = 10 ** (FADER_MAX_DB / 20)
/** dB mais baixo que o fader ainda toca (o pé do curso, 0,02): perto de −63 dB. Abaixo disso é silêncio. */
export const FADER_MIN_DB = LOW_SLOPE * Math.log10(FADER_FLOOR / FADER_ZERO)

/** dB da posição do fader: abaixo de 0,02 é −∞; de 0,75 pra cima, linear até +6 dB; no meio, 40 x log10(f / 0,75). */
export function faderToDb(f: number): number {
  if (!(f >= FADER_FLOOR)) return -Infinity
  if (f >= FADER_ZERO) return ((Math.min(f, 1) - FADER_ZERO) / (1 - FADER_ZERO)) * FADER_MAX_DB
  return LOW_SLOPE * Math.log10(f / FADER_ZERO)
}

/** Ganho linear da posição do fader (0 no silêncio). */
export function faderToGain(f: number): number {
  const db = faderToDb(f)
  return db === -Infinity ? 0 : 10 ** (db / 20)
}

/** Posição do fader de um ganho: 0 ou inválido no pé, 1 em 0,75, teto no topo (+6 dB). */
export function gainToFader(g: number): number {
  if (!(g > 0)) return 0
  // No teto (ou acima) é o topo exato: a conta de ida e volta do log daria 0,9999999999999999.
  if (g >= FADER_MAX_GAIN) return 1
  const db = 20 * Math.log10(g)
  if (db >= 0) return Math.min(1, FADER_ZERO + (db / FADER_MAX_DB) * (1 - FADER_ZERO))
  return FADER_ZERO * 10 ** (db / LOW_SLOPE)
}

/** Texto do ganho em dB com uma casa: '0.0 dB', '+2.0 dB', '−3.5 dB', '−∞ dB'. */
export function dbText(g: number): string {
  if (!(g > 0)) return `${MINUS}∞ dB`
  const db = 20 * Math.log10(g)
  if (Math.abs(db) < 0.05) return '0.0 dB'
  return `${db > 0 ? '+' : MINUS}${Math.abs(db).toFixed(1)} dB`
}

/** Texto do pan (−1 a 1): 'L50', 'C', 'R30'. */
export function panText(pan: number): string {
  if (!Number.isFinite(pan)) return 'C'
  const v = Math.round(clamp(pan, -1, 1) * 100)
  if (v === 0) return 'C'
  return v < 0 ? `L${-v}` : `R${v}`
}

/**
 * Fader depois de arrastar `dyPx` pra CIMA (positivo sobe) a partir de `f0`, num curso de
 * `travelPx` (no mínimo 40 px). Preso entre 0 e 1.
 */
export function dragFader(f0: number, dyPx: number, travelPx: number): number {
  return clamp(f0 + dyPx / Math.max(MIN_TRAVEL_PX, travelPx), 0, 1)
}

/**
 * O que um gesto que começou em cima do fader ou do pan está virando, pelo deslocamento desde o
 * toque (`dxPx` pro lado, `dyPx` na vertical): 'arrasto' quando a vertical passou de
 * DRAG_START_PX e é maior que o lateral; 'rolagem' quando o lateral passou do limiar e não é
 * menor que a vertical (o gesto fica com a rolagem do mixer, e um empate também); senão 'espera'.
 * Rolar o mixer com o dedo em cima de um fader nunca muda o volume (Ruling T14-gesto).
 */
export function gestureIntent(dxPx: number, dyPx: number): 'arrasto' | 'rolagem' | 'espera' {
  const ax = Number.isFinite(dxPx) ? Math.abs(dxPx) : 0
  const ay = Number.isFinite(dyPx) ? Math.abs(dyPx) : 0
  if (ay >= DRAG_START_PX && ay > ax) return 'arrasto'
  if (ax >= DRAG_START_PX) return 'rolagem'
  return 'espera'
}

/**
 * Pan depois de arrastar `dyPx` pra cima (sobe = direita): 0,014 por px, preso entre −1 e 1,
 * em passos de 0,01 (o que o knob mostra); |p| < 0,04 vira 0.
 */
export function dragPan(p0: number, dyPx: number): number {
  return snapPan(p0 + dyPx * PAN_PER_PX)
}

/** Pan preso entre −1 e 1, em passos de 0,01, com o centro que gruda (|p| < 0,04 vira 0). */
function snapPan(p: number): number {
  const v = Math.round(clamp(p, -1, 1) * 100) / 100
  return Math.abs(v) < PAN_SNAP ? 0 : v
}

/** Pan depois de um passo do teclado (seta pra direita soma, pra esquerda subtrai). Inválido conta como centro. */
export function stepPan(p0: number, delta: number): number {
  return snapPan((Number.isFinite(p0) ? p0 : 0) + delta)
}

/**
 * Ganho depois de somar `deltaDb` ao ganho `g` (teclado do fader: setas ±1 dB, PageUp e
 * PageDown ±6 dB). Arredonda em 0,1 dB; teto em +6 dB; abaixo do pé (−63 dB) vira silêncio;
 * do silêncio, subir parte do pé. Ganho inválido conta como silêncio.
 */
export function stepGainDb(g: number, deltaDb: number): number {
  const db = g > 0 ? 20 * Math.log10(g) : deltaDb > 0 ? FADER_MIN_DB : -Infinity
  const next = Math.round((db + deltaDb) * 10) / 10
  if (!(next >= FADER_MIN_DB)) return 0
  if (next >= FADER_MAX_DB) return FADER_MAX_GAIN
  return 10 ** (next / 20)
}

/**
 * Quantos canais cabem inteiros em `innerWidth` (com `gap` entre eles, cada um com no mínimo
 * `minWidth`) e a largura de cada um pra esses canais encherem a linha. Com mais canais que
 * isso a fileira rola de lado e cada canal fica com `width`, então sempre aparecem canais
 * inteiros. Nunca menos de 1 canal nem mais estreito que `minWidth`.
 */
export function fitStrips(innerWidth: number, gap: number, minWidth: number): { count: number; width: number } {
  if (!(innerWidth > 0)) return { count: 1, width: minWidth }
  const g = Math.max(0, gap)
  const count = Math.max(1, Math.floor((innerWidth + g) / (minWidth + g)))
  return { count, width: Math.max(minWidth, (innerWidth - g * (count - 1)) / count) }
}
