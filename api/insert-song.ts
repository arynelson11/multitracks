import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { getUserPlan, isPaidPlan } from './_lib/plan.js';

const supabaseUrl     = process.env.VITE_SUPABASE_URL;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_NAME_LEN    = 200;
const MAX_ARTIST_LEN  = 200;
const MAX_KEY_LEN     = 16;
const MAX_URL_LEN     = 2048;

function clampStr(v: unknown, max: number): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t) return null;
    return t.slice(0, max);
}

function clampUrl(v: unknown): string | null {
    const s = clampStr(v, MAX_URL_LEN);
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
}

// BPM com decimais e compasso: mesma regra de src/lib/cloudBpm.ts (bpmColumns,
// sanitizeTimeSignature, isMissingMeterColumn). O api/ compila separado do app,
// então a regra fica repetida aqui; mudou lá, muda aqui. O banco tem a mesma
// regra nas checks de db/supabase-bpm-exact-migration.sql.
const TIME_SIGNATURES = new Set(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']);
const BPM_MAX = 400;
const METER_COLUMNS = ['bpm_exact', 'time_signature'] as const;

function bpmColumns(value: number): { bpm: number; bpm_exact: number } | null {
    if (!Number.isFinite(value)) return null;
    const exact = Math.round(value * 100) / 100;
    if (exact <= 0 || exact >= BPM_MAX) return null;
    return { bpm: Math.round(exact), bpm_exact: exact };
}

function sanitizeTimeSignature(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const ts = raw.trim();
    return TIME_SIGNATURES.has(ts) ? ts : null;
}

// Banco ainda sem a migration: PostgREST responde PGRST204 (Postgres, 42703).
function isMissingMeterColumn(error: { code?: string; message?: string } | null): boolean {
    if (!error || (error.code !== 'PGRST204' && error.code !== '42703')) return false;
    const text = error.message ?? '';
    return METER_COLUMNS.some(col => text.includes(col));
}

export default async function handler(req: any, res: any) {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Salvar/publicar na nuvem (songs/stems + WAVs no R2) é recurso pago. Admin passa.
    if (!auth.isAdmin) {
        let plan: string;
        try { plan = await getUserPlan(supabase, auth.userId); }
        catch (e: any) {
            console.error('[insert-song] plan lookup failed:', e?.message);
            return res.status(500).json({ error: 'Plan lookup failed' });
        }
        if (!isPaidPlan(plan)) {
            return res.status(403).json({ error: 'Salvar na nuvem é um recurso dos planos pagos. Assine o Pro.', plan });
        }
    }

    const body = req.body ?? {};
    const name = clampStr(body.name, MAX_NAME_LEN);
    if (!name) return res.status(400).json({ error: 'name is required' });

    // user_id é forçado pelo JWT — nunca confiamos no body.
    // is_global só pode ser ativado por admin; user comum sempre insere música privada.
    // bpm é inteiro (apps antigos leem ele) e vem do exato arredondado, pra os
    // dois baterem. Fora de (0, 400) não há exato e o inteiro segue a regra antiga.
    const rawBpm = Number(body.bpm);
    const bpmCols = bpmColumns(rawBpm);
    const timeSignature = sanitizeTimeSignature(body.time_signature);
    const insertPayload: Record<string, unknown> = {
        name,
        artist:    clampStr(body.artist, MAX_ARTIST_LEN) ?? '',
        key:       clampStr(body.key,    MAX_KEY_LEN)    ?? '',
        bpm:       bpmCols ? bpmCols.bpm : (Number.isFinite(rawBpm) ? Math.max(0, Math.min(999, Math.round(rawBpm))) : 0),
        cover_url: clampUrl(body.cover_url),
        user_id:   auth.userId,
        is_global: auth.isAdmin && body.is_global === true,
    };
    // Colunas novas só vão quando têm valor: vazio já é o padrão do banco.
    if (bpmCols) insertPayload.bpm_exact = bpmCols.bpm_exact;
    if (timeSignature) insertPayload.time_signature = timeSignature;

    const insert = (row: Record<string, unknown>) => supabase
        .from('songs')
        .insert(row)
        .select('id')
        .single();

    let result = await insert(insertPayload);
    if (result.error && isMissingMeterColumn(result.error)) {
        // Migration ainda não rodou: salva a música com o bpm inteiro e avisa.
        console.warn('[insert-song] bpm_exact/time_signature ainda não existem (rodar db/supabase-bpm-exact-migration.sql); gravando sem elas.');
        const rest = { ...insertPayload };
        for (const col of METER_COLUMNS) delete rest[col];
        result = await insert(rest);
    }
    const { data, error } = result;

    if (error) {
        console.error('[insert-song] supabase error:', error.message);
        return res.status(500).json({ error: 'Failed to insert song' });
    }

    return res.status(200).json({ id: data.id });
}
