import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyActiveUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { brtToday } from './_lib/billing.js';
import { isTerminal, recordPredictionResult, type ReplicatePredictionLike } from './_lib/aiCost.js';
import { getUsdBrlOn } from './_lib/fx.js';

const PREDICTION_ID_RE = /^[a-z0-9]{20,}$/i;

// ── Custo de IA gravado quando o trabalho termina (T23) ──
//
// A gravação nunca muda, derruba nem segura a resposta do usuário: erro vira
// log (sem dado pessoal) e, passado o teto, a resposta sai sem esperar. O que
// ficar sem custo a varredura de Custos de IA completa depois.

const COST_RECORD_TIMEOUT_MS = 2000;

// O R$ usa só o câmbio já guardado do dia de Brasília do trabalho (Ruling
// ADM-T23-fx): o getUsdBrlOn lê fx_rates primeiro e, sem a cotação daquele dia,
// cai neste fetch, que recusa na hora. Resultado: grava sem R$ e a varredura
// completa. A consulta do usuário nunca espera o Banco Central.
const storedRateOnly: typeof fetch = () =>
    Promise.reject(new Error('a consulta da separacao usa so o cambio ja guardado'));

// O que o Replicate devolve na consulta, com o começo do trabalho.
type ConsultedPrediction = ReplicatePredictionLike & { created_at?: string | null };

// Dia de Brasília do trabalho: o fim (completed_at), senão o começo (created_at).
function jobDay(p: ConsultedPrediction, now: Date): string {
    for (const v of [p.completed_at, p.created_at]) {
        if (typeof v !== 'string') continue;
        const t = Date.parse(v);
        if (Number.isFinite(t)) return brtToday(new Date(t));
    }
    return brtToday(now);
}

async function recordCost(db: SupabaseClient, id: string, prediction: ConsultedPrediction, now: Date): Promise<void> {
    const fx = await getUsdBrlOn(db, jobDay(prediction, now), { now, fetchFn: storedRateOnly });
    await recordPredictionResult(db, { ...prediction, id }, fx, now);
}

function logCostFailure(e: unknown): void {
    // A mensagem do aiCost cita só o id do trabalho e o erro do banco; nunca o usuário.
    console.error('[check-separation] custo do trabalho nao gravado, a varredura completa depois:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
}

async function recordCostQuietly(db: SupabaseClient, id: string, prediction: ConsultedPrediction, now: Date): Promise<void> {
    // O catch fica preso à gravação: um erro que chega depois do teto também vai pro log.
    const work = recordCost(db, id, prediction, now).then(() => 'done' as const, (e: unknown) => {
        logCostFailure(e);
        return 'failed' as const;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), COST_RECORD_TIMEOUT_MS);
    });
    try {
        if ((await Promise.race([work, limit])) === 'timeout') {
            console.warn('[check-separation] gravacao do custo passou de 2 s, a resposta sai sem esperar');
        }
    } finally {
        clearTimeout(timer);
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    applyCors(req, res, 'GET,OPTIONS');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'GET')     { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const replicateToken = process.env.REPLICATE_API_TOKEN;
    const supabaseUrl    = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!replicateToken || !supabaseUrl || !serviceRoleKey) {
        res.status(500).json({ error: 'Server misconfigured' });
        return;
    }

    // Conta bloqueada pelo admin não consulta separação.
    const auth = await verifyActiveUser(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const predictionId = req.query?.predictionId;
    if (typeof predictionId !== 'string' || !PREDICTION_ID_RE.test(predictionId)) {
        res.status(400).json({ error: 'Invalid predictionId' });
        return;
    }

    // Cliente de serviço pra todo mundo: o dono e o custo de IA (o admin também grava).
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Ownership: usuário comum só consulta prediction que ele mesmo criou.
    // Admin pode consultar qualquer uma. Fecha o IDOR (consultar separação alheia por ID).
    if (!auth.isAdmin) {
        const { data: owned, error: ownErr } = await supabase
            .from('predictions')
            .select('user_id')
            .eq('replicate_id', predictionId)
            .maybeSingle();

        if (ownErr) {
            console.error('[check-separation] ownership lookup failed:', ownErr.message);
            res.status(500).json({ error: 'Ownership check failed' });
            return;
        }
        if (!owned || owned.user_id !== auth.userId) {
            res.status(403).json({ error: 'Forbidden: not the owner of this prediction' });
            return;
        }
    }

    let prediction: Awaited<ReturnType<Replicate['predictions']['get']>>;
    try {
        const replicate = new Replicate({ auth: replicateToken });
        prediction = await replicate.predictions.get(predictionId);
    } catch (error: unknown) {
        console.error('[check-separation] replicate error:', error instanceof Error ? error.message : undefined);
        res.status(502).json({ error: 'Separation service unavailable' });
        return;
    }

    if (prediction && isTerminal(prediction.status)) {
        await recordCostQuietly(supabase, predictionId, prediction, new Date());
    }
    res.status(200).json({ prediction });
}
