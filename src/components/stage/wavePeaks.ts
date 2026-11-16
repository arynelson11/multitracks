// Contas da onda grande do palco (T9), sem React e sem canvas: picos, seta do armado,
// linhas dos selos e o tom mais claro da parte tocada. O SectionBar do palco antigo usa o
// mesmo computePeaks.

/**
 * Picos da forma de onda: o maior |x| de cada balde, normalizado pelo maior de todos (0 a 1).
 * Mesma regra do SectionBar: balde de `floor(n / buckets)` amostras (no mínimo 1), amostra que
 * falta conta 0, o resto da divisão fica de fora e dado vazio dá zeros.
 */
export function computePeaks(data: Float32Array, buckets: number): Float32Array {
  const count = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : 0
  const peaks = new Float32Array(count)
  const block = Math.floor(data.length / count) || 1
  let max = 0.0001
  for (let i = 0; i < count; i++) {
    let peak = 0
    const start = i * block
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[start + j] || 0)
      if (v > peak) peak = v
    }
    peaks[i] = peak
    if (peak > max) max = peak
  }
  for (let i = 0; i < count; i++) peaks[i] = peaks[i] / max
  return peaks
}

/** A curva termina 7 px acima da base, onde fica a ponta da seta. */
const ARC_END = 7

/**
 * Curva da seta do pulo (v6 `drawArc`): sai de `x1` (fim da seção atual) na altura `baseY`,
 * sobe `lift` e desce no começo da armada (`x2`), 7 px acima da base, onde fica a ponta.
 * `lift` = 24 + 22% da distância, no mínimo 26 (v6), e nunca acima de `maxLift`: com selo no
 * caminho quem chama baixa o teto e a curva achata abaixo de 26 (o v6 usa `max(30, altura - 60)`).
 * Perto demais (até 6 px) não tem curva: devolve texto vazio e fica só a bolinha e a ponta.
 */
export function arcPath(x1: number, x2: number, baseY: number, maxLift: number): string {
  const dx = x2 - x1
  if (!(Math.abs(dx) > 6)) return ''
  const cap = Number.isNaN(maxLift) ? 0 : Math.max(0, maxLift)
  const lift = Math.min(cap, Math.max(26, 24 + Math.abs(dx) * 0.22))
  const f = (n: number) => n.toFixed(1)
  return `M${f(x1)} ${f(baseY)} C${f(x1)} ${f(baseY - lift)} ${f(x2)} ${f(baseY - lift)} ${f(x2)} ${f(baseY - ARC_END)}`
}

/**
 * Quanto a curva do `arcPath` sobe acima da base, no ponto mais alto, com subida `lift`.
 * A altura em t é 3t(1-t)·lift + 7t³; até lift 7 o ponto mais alto é a ponta (7 px).
 */
export function arcRise(lift: number): number {
  const L = Math.max(0, lift)
  if (L <= ARC_END) return ARC_END
  const t = (6 * L - Math.sqrt(36 * L * L - 252 * L)) / 42 // derivada zero: 21t² - 6Lt + 3L = 0
  return Math.max(ARC_END, 3 * t * (1 - t) * L + ARC_END * t ** 3)
}

/** Maior subida cuja curva fica até `rise` px acima da base. Abaixo de 7 nem a ponta cabe: 0 (sem curva). Sem limite: sem limite. */
export function liftForRise(rise: number): number {
  if (!(rise >= ARC_END)) return 0
  if (rise === Infinity) return Infinity
  let lo = 0
  let hi = Math.max(ARC_END, rise * 2)
  while (arcRise(hi) <= rise) hi *= 2
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (arcRise(mid) <= rise) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Selo de uma seção na onda: quer começar em `x` (px) e tem `width` px. Com `tagWidth`, tem
 * a etiqueta PRÓXIMA, REPETE ou LOOP, que vai embaixo do selo (v5) ou, sem lugar, ao lado
 * dele na mesma linha. `priority`: 0 com etiqueta, 1 a seção atual, 2 as outras; 0 e 1 são
 * as últimas a ficar de fora.
 */
export interface LabelBox { x: number; width: number; tagWidth?: number; priority: number }
/** Onde o selo ficou: linha (0 em cima), começo em px e se a etiqueta está ao lado (`inline`) em vez de embaixo. */
export interface LabelSpot { row: number; x: number; inline: boolean }

/** Folga entre o selo e a etiqueta quando ela fica ao lado. */
export const INLINE_TAG_GAP = 4
/** Abaixo desta prioridade o selo é importante (com etiqueta ou o da seção atual). */
const IMPORTANT = 2

/**
 * Linha de cada selo, de cima pra baixo, sem nenhum encostar no outro: cada um fica na
 * primeira linha livre de `x - gap` a `x + largura + gap` (a etiqueta embaixo ocupa a linha
 * de baixo só na largura dela). Perto da borda direita (`right`) o selo recua pra caber
 * inteiro, sem passar de `left`. Tenta quatro jeitos (importantes primeiro ou da esquerda pra
 * direita; etiqueta embaixo ou ao lado) e fica com o que deixa menos importantes de fora,
 * depois menos selos de fora; no empate, o primeiro (importantes primeiro e etiqueta
 * embaixo, como no v5). Sem lugar nas `rows` linhas: `null` (o selo não aparece; nunca fica
 * por cima de outro nem cortado).
 */
export function placeLabels(boxes: readonly LabelBox[], rows: number, gap: number, left = -Infinity, right = Infinity): (LabelSpot | null)[] {
  const hasTag = boxes.some((b) => b.tagWidth !== undefined)
  let best: (LabelSpot | null)[] = []
  let bestScore: [number, number] = [Infinity, Infinity]
  for (const importantFirst of [true, false]) {
    for (const tagBeside of hasTag ? [false, true] : [false]) {
      const spots = place(boxes, rows, gap, left, right, importantFirst, tagBeside)
      const missing = spots.filter((s) => s === null).length
      if (missing === 0) return spots
      const score: [number, number] = [spots.filter((s, i) => s === null && boxes[i].priority < IMPORTANT).length, missing]
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        best = spots
        bestScore = score
      }
    }
  }
  return best
}

function place(
  boxes: readonly LabelBox[], rows: number, gap: number, left: number, right: number, importantFirst: boolean, tagBeside: boolean,
): (LabelSpot | null)[] {
  const taken: Array<Array<[number, number]>> = Array.from({ length: Math.max(0, Math.floor(rows)) }, () => [])
  const rank = (i: number) => (importantFirst ? boxes[i].priority : 0)
  const order = boxes.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || boxes[a].x - boxes[b].x || a - b)
  const result: (LabelSpot | null)[] = boxes.map(() => null)
  const free = (row: number, a: number, b: number) => taken[row].every(([l, r]) => b + gap <= l || r + gap <= a)
  // Peças do selo em cada tentativa: [linha relativa, largura].
  const tries = (box: LabelBox): Array<{ inline: boolean; parts: Array<[number, number]> }> => {
    const w = Math.max(0, box.width)
    if (box.tagWidth === undefined) return [{ inline: false, parts: [[0, w]] }]
    const t = Math.max(0, box.tagWidth)
    const stacked = { inline: false, parts: [[0, w], [1, t]] as Array<[number, number]> }
    const inline = { inline: true, parts: [[0, w + INLINE_TAG_GAP + t]] as Array<[number, number]> }
    return tagBeside ? [inline] : [stacked, inline]
  }
  for (const i of order) {
    const box = boxes[i]
    search: for (const attempt of tries(box)) {
      const span = Math.max(...attempt.parts.map(([k]) => k)) + 1
      const widest = Math.max(...attempt.parts.map(([, w]) => w))
      const x = Math.max(left, Math.min(box.x, right - widest))
      for (let row = 0; row + span <= taken.length; row++) {
        if (!attempt.parts.every(([k, w]) => free(row + k, x, x + w))) continue
        for (const [k, w] of attempt.parts) taken[row + k].push([x, x + w])
        result[i] = { row, x, inline: attempt.inline }
        break search
      }
    }
  }
  return result
}

/** Cor `#rgb`, `#rrggbb` ou `rgb(a)` misturada com `k` de branco (v5 `lighter`, 28%). Formato desconhecido volta igual. */
export function lighter(color: string, k = 0.28): string {
  const rgb = parseRgb(color)
  if (!rgb) return color
  const [r, g, b] = rgb.map((v) => Math.round(v + (255 - v) * k))
  return `rgb(${r},${g},${b})`
}

function parseRgb(color: string): [number, number, number] | null {
  const c = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c)
  if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)]
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c)
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)]
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  return null
}
