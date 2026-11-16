// Textos da botoeira de seções (T10), puros: a linha de baixo de cada botão (início, compasso
// da atual ou espera da armada), o progresso da atual e a etiqueta AGORA / PRÓXIMA / REPETE.
// A regra do armado é a da T4 (armLabel, isSelfLoop) e a conta da contagem e da espera é a
// da T1 (countState, transitionWaitText); aqui só se escolhe o que cada botão mostra.
import { armLabel, isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, StageSection, TransitionView } from '../../lib/stageContracts'
import { countState, transitionWaitText } from '../../lib/transitionView'

export interface PadMetaContext { current: number; position: number; transition: TransitionView | null; heardNow: number }
export interface PadTag { kind: 'agora' | 'proxima' | 'repete'; text: string; loop: boolean }

/** "m:ss" sem arredondar pra cima (65,9 s é "1:05"); negativo ou inválido vira "0:00". */
function clockText(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Parte da seção já tocada na posição da música, de 0 a 1 (presa nas pontas; seção vazia é 0). */
export function padProgress(s: StageSection, position: number): number {
  const len = s.end - s.start
  if (!(len > 0) || !Number.isFinite(position)) return 0
  return Math.min(1, Math.max(0, (position - s.start) / len))
}

/** Seção tocando: "comp. N/M" quando ela sabe quantos compassos tem, senão "m:ss/m:ss" (dentro dela / duração). */
function progressText(s: StageSection, position: number): string {
  if (s.bars !== null && s.bars >= 1) {
    const bars = Math.floor(s.bars)
    const bar = Math.min(bars, Math.floor(padProgress(s, position) * bars) + 1)
    return `comp. ${bar}/${bars}`
  }
  return `${clockText(padProgress(s, position) * (s.end - s.start))}/${clockText(s.end - s.start)}`
}

/**
 * Linha de baixo do botão da seção `i` (o `index` dela, o mesmo de `current` e do alvo do pulo).
 * Na armada (alvo de um pulo que não é o loop infinito da própria seção): "em N comp." ou
 * "no fim da seção" (sem grade) pelo `transitionWaitText`, e "contagem" no último compasso. O
 * CLICK DESLIGADO não entra aqui: o alerta fica no aviso PRÓXIMA, e a botoeira só diz quando.
 * Do "1" ouvido em diante a armada já é a que toca: mostra o compasso dela, sem esperar o pouso.
 * Na atual: o compasso dentro dela. Nas outras: o início, "m:ss".
 */
export function padMeta(s: StageSection, i: number, ctx: PadMetaContext): string {
  const t = ctx.transition
  if (t !== null && t.to === i && !isSelfLoop({ target: t.to, plays: t.plays }, ctx.current)) {
    if (t.switchAt !== null && ctx.heardNow >= t.switchAt) return progressText(s, ctx.position)
    if (!t.hasGrid) return transitionWaitText(t, ctx.heardNow) ?? 'no fim da seção'
    const count = countState(t, ctx.heardNow)
    const wait = transitionWaitText({ ...t, clickAudible: true }, ctx.heardNow)
    if (count.inLastBar || count.counting || wait === null || wait === 'último comp.') return 'contagem'
    return wait
  }
  if (i === ctx.current) return progressText(s, ctx.position)
  return clockText(s.start)
}

/**
 * Etiqueta do canto do botão da seção `index`. No alvo armado: "PRÓXIMA", "REPETE" ou
 * "REPETE 3x" (regra da T4; REPETE fica no lugar do AGORA). Na atual: "AGORA", com o ícone de
 * loop quando o loop infinito dela está ligado (esse não é pulo: sem listras nem contagem).
 */
export function padTag(intent: ArmIntent | null, index: number, current: number): PadTag | null {
  const loop = isSelfLoop(intent, current)
  if (intent !== null && intent.target === index && !loop) {
    const l = armLabel(intent, current)
    if (l && l.kind === 'repete') {
      return { kind: 'repete', text: typeof l.plays === 'number' && l.plays > 1 ? `REPETE ${l.plays}x` : 'REPETE', loop: false }
    }
    return { kind: 'proxima', text: 'PRÓXIMA', loop: false }
  }
  if (index === current) return { kind: 'agora', text: 'AGORA', loop }
  return null
}
