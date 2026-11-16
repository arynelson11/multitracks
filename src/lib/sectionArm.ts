// Regra única da intenção armada do palco novo: armar, repetir, loop e cancelar. Botoeira,
// onda, REPETIR, LOOP, atalhos e banda passam por aqui; o motor (T28) só executa o
// resultado. Funções puras: nunca mudam a intenção recebida. Quando nada muda, devolvem a
// mesma intenção que receberam.
import type { ArmIntent, Plays, StageGates } from './stageContracts'

export interface ArmContext { current: number; isPlaying: boolean; sectionCount: number; gates: StageGates }
/** `seekToSection`: parado, levar a VS pro início desta seção. `upgrade`: abrir os Planos. */
export interface ArmResult { intent: ArmIntent | null; seekToSection: number | null; upgrade: boolean }

const withIntent = (intent: ArmIntent | null): ArmResult => ({ intent, seekToSection: null, upgrade: false })
const askUpgrade = (intent: ArmIntent | null): ArmResult => ({ intent, seekToSection: null, upgrade: true })
const seekTo = (index: number): ArmResult => ({ intent: null, seekToSection: index, upgrade: false })

const inList = (index: number, c: ArmContext) => Number.isInteger(index) && index >= 0 && index < c.sectionCount

/**
 * Número de passagens dentro do plano: acima do teto vira o teto, abaixo de 1 (ou NaN) vira 1,
 * quebrado desce pro inteiro. Número nunca vira loop sem fim (isso é só o `'infinite'`, que
 * tem portão próprio).
 */
function clampPlays(plays: number, maxRepeats: number): number {
  const cap = maxRepeats >= 1 ? Math.floor(maxRepeats) : 1
  if (!(plays >= 1)) return 1
  const n = Math.min(Math.floor(plays), cap)
  return Number.isFinite(n) ? n : 1
}

/**
 * Tocar numa seção. Tocando: na armada cancela (inclusive REPETIR e loop infinito); em outra,
 * ou na atual (REPETE), arma com 1 passagem. Parado: leva pro início dela e desarma. Sem o
 * portão de seções pede upgrade sem mudar nada; cancelar nunca pede plano.
 */
export function tapSection(intent: ArmIntent | null, index: number, c: ArmContext): ArmResult {
  if (!inList(index, c)) return withIntent(intent)
  if (c.isPlaying && intent !== null && intent.target === index) return withIntent(null)
  if (!c.gates.sections) return askUpgrade(intent)
  if (!c.isPlaying) return seekTo(index)
  return withIntent({ target: index, plays: 1 })
}

/**
 * Seta de seção: anda um a partir do alvo armado (ou da atual), presa na lista. Presa na
 * ponta, nada muda (nunca cancela a armada). Tocando arma com 1 passagem; parado leva pro
 * início e desarma.
 */
export function stepSection(intent: ArmIntent | null, dir: -1 | 1, c: ArmContext): ArmResult {
  if (c.sectionCount < 1) return withIntent(intent)
  const from = intent !== null ? intent.target : c.current
  const target = Math.min(c.sectionCount - 1, Math.max(0, from + dir))
  if (target === from) return withIntent(intent)
  if (!c.gates.sections) return askUpgrade(intent)
  if (!c.isPlaying) return seekTo(target)
  return withIntent({ target, plays: 1 })
}

/**
 * Arma `plays` passagens na seção `index` (REPETIR, ∞ e banda). Nunca cancela: armar de novo o
 * mesmo deixa igual. Vale tocando ou parado (parado fica armado pra quando tocar).
 */
export function armAt(intent: ArmIntent | null, index: number, plays: Plays, c: ArmContext): ArmResult {
  if (!inList(index, c)) return withIntent(intent)
  if (!c.gates.sections) return askUpgrade(intent)
  if (plays === 'infinite') return c.gates.infinite ? withIntent({ target: index, plays }) : askUpgrade(intent)
  return withIntent({ target: index, plays: clampPlays(plays, c.gates.maxRepeats) })
}

/** REPETIR na seção atual: `{ atual, N }` (ou infinito). Mudar N com REPETIR armado re-arma. */
export function armRepeat(intent: ArmIntent | null, plays: Plays, c: ArmContext): ArmResult {
  return armAt(intent, c.current, plays, c)
}

/** LOOP: liga o loop infinito da atual; se ele já está armado, cancela (sem pedir plano). */
export function toggleLoop(intent: ArmIntent | null, c: ArmContext): ArmResult {
  if (!inList(c.current, c)) return withIntent(intent)
  if (isSelfLoop(intent, c.current)) return withIntent(null)
  return armAt(intent, c.current, 'infinite', c)
}

/**
 * "Repetir N" da banda pelo celular, no sentido antigo: em outra seção ela ia pra lá e
 * repetia N vezes (N + 1 passagens); na atual, N passagens. Infinito continua infinito. O
 * teto do plano vem depois, no `armAt`.
 */
export function bandRepeat(index: number, times: Plays, current: number): { target: number; plays: Plays } {
  if (times === 'infinite' || index === current) return { target: index, plays: times }
  return { target: index, plays: times + 1 }
}

/** Ao pousar na seção armada: infinito continua, N maior que 1 desce 1, senão desarma. */
export function afterLanding(intent: ArmIntent): ArmIntent | null {
  if (intent.plays === 'infinite') return intent
  return intent.plays > 1 ? { target: intent.target, plays: intent.plays - 1 } : null
}

/** O que o aviso mostra: REPETE quando o alvo é a seção atual, PRÓXIMA nos outros casos. */
export function armLabel(intent: ArmIntent | null, current: number): { kind: 'proxima' | 'repete'; plays: Plays } | null {
  if (intent === null) return null
  return { kind: intent.target === current ? 'repete' : 'proxima', plays: intent.plays }
}

/** Loop infinito da própria seção `from` (sem contagem e sem calar a guia). */
export function isSelfLoop(intent: ArmIntent | null, from: number): boolean {
  return intent !== null && intent.target === from && intent.plays === 'infinite'
}
