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

/**
 * Curva da seta do pulo (v6 `drawArc`): sai de `x1` (fim da seção atual) na altura `baseY`,
 * sobe `lift` e desce no começo da armada (`x2`), 7 px acima da base, onde fica a ponta.
 * `lift` = 24 + 22% da distância, entre 26 e `max(30, maxLift)`. Perto demais (até 6 px)
 * não tem curva: devolve texto vazio e fica só a bolinha e a ponta.
 */
export function arcPath(x1: number, x2: number, baseY: number, maxLift: number): string {
  const dx = x2 - x1
  if (!(Math.abs(dx) > 6)) return ''
  const top = Math.max(30, Number.isFinite(maxLift) ? maxLift : 30)
  const lift = Math.min(top, Math.max(26, 24 + Math.abs(dx) * 0.22))
  const f = (n: number) => n.toFixed(1)
  return `M${f(x1)} ${f(baseY)} C${f(x1)} ${f(baseY - lift)} ${f(x2)} ${f(baseY - lift)} ${f(x2)} ${f(baseY - 7)}`
}

/**
 * Selo de uma seção na onda: começa em `x` (px), tem `width` px e ocupa `span` linhas (2 com
 * a etiqueta PRÓXIMA, REPETE ou LOOP embaixo). Menor `priority` é posto primeiro.
 */
export interface LabelBox { x: number; width: number; span: 1 | 2; priority: number }

/**
 * Linha de cada selo, de cima pra baixo, sem nenhum encostar no outro: cada um fica na
 * primeira linha em que as `span` linhas estão livres de `x - gap` a `x + width + gap`.
 * Vai primeiro quem tem menor prioridade (etiqueta, depois a atual), e entre iguais da
 * esquerda pra direita. Sem lugar nas `rows` linhas: `null` (o selo não aparece; nunca
 * fica por cima de outro nem cortado).
 */
export function placeLabels(boxes: readonly LabelBox[], rows: number, gap: number): (number | null)[] {
  const taken: Array<Array<[number, number]>> = Array.from({ length: Math.max(0, Math.floor(rows)) }, () => [])
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].priority - boxes[b].priority || boxes[a].x - boxes[b].x || a - b)
  const result: (number | null)[] = boxes.map(() => null)
  const free = (row: number, a: number, b: number) => taken[row].every(([l, r]) => b + gap <= l || r + gap <= a)
  for (const i of order) {
    const { x, width, span } = boxes[i]
    const a = x
    const b = x + Math.max(0, width)
    for (let row = 0; row + span <= taken.length; row++) {
      let ok = true
      for (let k = row; k < row + span && ok; k++) ok = free(k, a, b)
      if (!ok) continue
      for (let k = row; k < row + span; k++) taken[k].push([a, b])
      result[i] = row
      break
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
