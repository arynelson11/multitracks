// Nomes dos 12 tons do palco, fonte única (a T29 troca as cópias do App.tsx por esta).
// Quem lê o tom escrito ("Bb", "F#m", "Lá m", "Sib") é o parseKey do motor de tom
// (pitchRules.ts): aqui só se escolhe o nome que aparece, sempre com sustenido.
import { parseKey } from './pitchRules'

/** C a B com sustenido; a posição é o semitom (0 = C). */
export const KEY_NAMES: readonly string[] = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])

/** Posição do tom em KEY_NAMES (o semitom da tônica); nula quando o tom não é reconhecido. */
export function keyIndex(key: string | null): number | null {
  return parseKey(key)?.semitone ?? null
}

/**
 * Nome do tom `key` transposto `semitones` semitons, com sustenido e com o "m" quando o tom é
 * menor ("Am" + 2 = "Bm", "Bb" + 1 = "B", "Lá m" + 2 = "Bm"). Semitom quebrado vai pro inteiro
 * mais perto; inválido (NaN, infinito) não transpõe. Tom não reconhecido: nulo.
 */
export function transposeKeyName(key: string | null, semitones: number): string | null {
  const k = parseKey(key)
  if (!k) return null
  const shift = Number.isFinite(semitones) ? Math.round(semitones) : 0
  return KEY_NAMES[(((k.semitone + shift) % 12) + 12) % 12] + (k.minor ? 'm' : '')
}
