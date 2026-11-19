import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { verifyActiveUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { PLAN_LIMITS, getQuotaBonus, getUserPlan } from './_lib/plan.js';
import { DEMUCS_VERSION } from './_lib/aiCost.js';

// Todo plano separa em 2, 4 ou 6 faixas. O app novo oferece só 4 e 6 ao Livre;
// o servidor aceita 2 também, pra o app de computador antigo seguir separando
// (decisão D2 da Parte 3). O que segura o custo é a cota do mês (PLAN_LIMITS).
const VALID_STEM_COUNTS = new Set([2, 4, 6]);

// Coluna que não existe: 42703 no Postgres, PGRST204 no PostgREST (cache do schema).
// Quer dizer que db/supabase_admin_custos.sql ainda não rodou.
function isMissingColumn(e: { code?: string } | null): boolean {
    return !!e && (e.code === '42703' || e.code === 'PGRST204');
}

function getAllowedAudioPrefix(): string | null {
    const raw = process.env.VITE_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL;
    if (!raw) return null;
    return raw.replace(/\/+$/, '') + '/';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const supabaseUrl    = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    const allowedPrefix  = getAllowedAudioPrefix();
    if (!supabaseUrl || !serviceRoleKey || !replicateToken || !allowedPrefix) {
        res.status(500).json({ error: 'Server misconfigured' });
        return;
    }

    // Conta bloqueada pelo admin não separa (403 com a frase de BLOCKED_MESSAGE).
    const auth = await verifyActiveUser(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const audioUrl: unknown = req.body?.audioUrl;
    const stemCount: unknown = req.body?.stemCount ?? 4;
    if (typeof audioUrl !== 'string' || !audioUrl.startsWith(allowedPrefix)) {
        res.status(400).json({ error: 'audioUrl must be hosted on our storage' });
        return;
    }
    const requestedStems = typeof stemCount === 'number' ? stemCount : 4;
    if (!VALID_STEM_COUNTS.has(requestedStems)) {
        res.status(400).json({ error: 'stemCount must be 2, 4 or 6' });
        return;
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Admin não tem cota.
    if (!auth.isAdmin) {
        // Plano efetivo: cancelado vale até plan_expires_at, depois é Livre.
        let plan: string;
        try {
            plan = await getUserPlan(supabase, auth.userId);
        } catch (e) {
            console.error('[separate-audio] profile lookup failed:', e instanceof Error ? e.message : 'erro');
            res.status(500).json({ error: 'Profile lookup failed' });
            return;
        }

        // Cota extra do mês dada pelo admin soma no limite. Se a leitura falhar,
        // separa com o limite do plano: a leitura nova nunca derruba a separação.
        let bonus = 0;
        try {
            bonus = await getQuotaBonus(supabase, auth.userId);
        } catch (e) {
            console.warn('[separate-audio] cota extra nao lida, segue com o limite do plano:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
        }
        const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free) + bonus;

        const { data: consumed, error: rpcErr } = await supabase
            .rpc('consume_separation_token', { p_user_id: auth.userId, p_limit: limit });

        if (rpcErr) {
            console.error('[separate-audio] consume_token rpc failed:', rpcErr.message);
            res.status(500).json({ error: 'Quota check failed' });
            return;
        }
        if (consumed !== true) {
            // A cota é por mês civil (horário de Brasília): o RPC zera o contador
            // sozinho na primeira separação do mês (db/supabase_cota_mensal.sql).
            res.status(402).json({
                error: `Você já usou as ${limit} separações deste mês. O contador volta a zero no dia 1º.`,
                plan,
                limit,
            });
            return;
        }
    }

    try {
        let model_name = 'htdemucs';
        if (requestedStems >= 6) {
            model_name = 'htdemucs_6s';
        }

        const inputOptions: any = { audio: audioUrl, model_name };
        if (requestedStems === 2) {
            inputOptions.two_stems = 'vocals';
        }

        const replicate = new Replicate({ auth: replicateToken });
        const prediction = await replicate.predictions.create({
            version: DEMUCS_VERSION,
            input: inputOptions,
        });

        // Registra ownership da prediction para o check-separation validar depois
        // (impede que outro usuário consulte esta separação por ID), junto com o
        // modelo do demucs, a versão, as faixas e o status pro custo de IA.
        // Best-effort: falha aqui não deve derrubar a resposta, mas é logada.
        if (prediction?.id) {
            const owner = { replicate_id: prediction.id, user_id: auth.userId };
            let { error: ownErr } = await supabase
                .from('predictions')
                .insert({ ...owner, model: model_name, version: DEMUCS_VERSION, stem_count: requestedStems, status: 'starting' });
            if (isMissingColumn(ownErr)) {
                // Sem as colunas do custo, grava só o dono: a consulta da separação segue funcionando.
                console.warn('[separate-audio] colunas do custo de IA ausentes, grava so o dono:', ownErr?.code);
                ({ error: ownErr } = await supabase.from('predictions').insert(owner));
            }
            if (ownErr) {
                console.error('[separate-audio] ownership insert failed:', ownErr.message);
            }
        }

        res.status(200).json({ success: true, prediction, model_name });
    } catch (error: any) {
        console.error('[separate-audio] replicate error:', error?.message);
        if (!auth.isAdmin) {
            await supabase.rpc('refund_separation_token', { p_user_id: auth.userId });
        }
        res.status(502).json({ error: 'Separation service unavailable' });
    }
}
