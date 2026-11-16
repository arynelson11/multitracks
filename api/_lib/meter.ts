// BPM com decimais e compasso na nuvem, lado do servidor.
//
// Mesma regra de src/lib/cloudBpm.ts (bpmColumns, sanitizeTimeSignature,
// isMissingMeterColumn, withoutMeterColumns). O api/ compila separado do app e
// não importa de src/, então a regra fica repetida aqui, pura e sem imports.
// O teste de paridade em src/lib/cloudBpm.test.ts compara as duas cópias nos
// mesmos casos: mudou lá, muda aqui. O banco tem a mesma regra nas checks de
// db/supabase-bpm-exact-migration.sql.

const TIME_SIGNATURES: readonly string[] = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

const BPM_MAX = 400;

/** Colunas que só existem depois da migration do BPM exato. */
export const SONG_METER_COLUMNS = ['bpm_exact', 'time_signature'] as const;

/**
 * Colunas pra gravar um BPM: o exato com 2 casas e o inteiro dele arredondado.
 * Fora de (0, 400) devolve null (a regra do banco recusaria).
 */
export function bpmColumns(value: number): { bpm: number; bpm_exact: number } | null {
    if (!Number.isFinite(value)) return null;
    const exact = Math.round(value * 100) / 100;
    if (exact <= 0 || exact >= BPM_MAX) return null;
    return { bpm: Math.round(exact), bpm_exact: exact };
}

/** Compasso aceito pelo banco, ou null. */
export function sanitizeTimeSignature(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const ts = raw.trim();
    return TIME_SIGNATURES.includes(ts) ? ts : null;
}

/**
 * O banco ainda não tem uma das colunas novas? (migration não rodou). PostgREST
 * responde PGRST204; o Postgres direto, 42703.
 */
export function isMissingMeterColumn(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (code !== 'PGRST204' && code !== '42703') return false;
    const text = typeof message === 'string' ? message : '';
    return SONG_METER_COLUMNS.some(col => text.includes(col));
}

/** Cópia da linha sem as colunas novas, pra regravar num banco sem a migration. */
export function withoutMeterColumns<T extends object>(row: T): Omit<T, (typeof SONG_METER_COLUMNS)[number]> {
    const rest = { ...row } as Record<string, unknown>;
    for (const col of SONG_METER_COLUMNS) delete rest[col];
    return rest as Omit<T, (typeof SONG_METER_COLUMNS)[number]>;
}
