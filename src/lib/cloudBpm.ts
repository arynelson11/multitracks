// BPM com decimais e compasso na nuvem (tabela songs).
//
// A coluna `songs.bpm` é inteira e continua sendo a que os apps antigos leem.
// O valor exato fica em `songs.bpm_exact` (numeric 6,2) e o compasso em
// `songs.time_signature` (db/supabase-bpm-exact-migration.sql). Quem grava BPM
// grava os dois juntos por `bpmColumns`, então o inteiro é sempre o exato
// arredondado. Um app antigo que mude só o inteiro quebra esse par; aí o exato
// está velho e `preciseBpm` volta pro inteiro.
//
// O servidor repete `bpmColumns`, `sanitizeTimeSignature`, `isMissingMeterColumn`
// e `withoutMeterColumns` em api/_lib/meter.ts, porque o api/ compila separado
// do app e não importa de src/. O teste de paridade em cloudBpm.test.ts compara
// as duas cópias: mudou aqui, muda lá.
import type { TimeSignatureType } from './AudioAnalyzer'

const TIME_SIGNATURES: readonly TimeSignatureType[] = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']

const BPM_MAX = 400

/**
 * BPM mais preciso que a música tem: o exato quando existe e bate com o
 * inteiro (ou não há inteiro), senão o inteiro; `undefined` quando não há BPM
 * (0 ou vazio).
 */
export function preciseBpm(s: { bpm?: number | null; bpm_exact?: number | null }): number | undefined {
  const hasWhole = s.bpm !== undefined && s.bpm !== null
  const whole = Number(s.bpm)
  const exact = Number(s.bpm_exact)
  if (Number.isFinite(exact) && exact > 0 && (!hasWhole || Math.round(exact) === whole)) return exact
  if (Number.isFinite(whole) && whole > 0) return whole
  return undefined
}

/**
 * Colunas pra gravar um BPM: o exato com 2 casas e o inteiro dele arredondado.
 * Fora de (0, 400) devolve null (a regra do banco recusaria).
 */
export function bpmColumns(value: number): { bpm: number; bpm_exact: number } | null {
  if (!Number.isFinite(value)) return null
  const exact = Math.round(value * 100) / 100
  if (exact <= 0 || exact >= BPM_MAX) return null
  return { bpm: Math.round(exact), bpm_exact: exact }
}

/** Compasso aceito pelo banco, ou null. */
export function sanitizeTimeSignature(raw: unknown): TimeSignatureType | null {
  if (typeof raw !== 'string') return null
  const ts = raw.trim()
  return (TIME_SIGNATURES as readonly string[]).includes(ts) ? (ts as TimeSignatureType) : null
}

/** Colunas que só existem depois da migration do BPM exato. */
export const SONG_METER_COLUMNS = ['bpm_exact', 'time_signature'] as const

/**
 * O banco ainda não tem uma das colunas novas? (migration não rodou). PostgREST
 * responde PGRST204; o Postgres direto, 42703.
 */
export function isMissingMeterColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== 'PGRST204' && code !== '42703') return false
  const text = typeof message === 'string' ? message : ''
  return SONG_METER_COLUMNS.some(col => text.includes(col))
}

/** Cópia da linha sem as colunas novas, pra regravar num banco sem a migration. */
export function withoutMeterColumns<T extends object>(row: T): Omit<T, (typeof SONG_METER_COLUMNS)[number]> {
  const rest = { ...row } as Record<string, unknown>
  for (const col of SONG_METER_COLUMNS) delete rest[col]
  return rest as Omit<T, (typeof SONG_METER_COLUMNS)[number]>
}
