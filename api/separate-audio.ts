import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const DEMUCS_VERSION = '25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953';

// Ajuste aqui se mudar a estratégia comercial.
const PLAN_LIMITS: Record<string, number> = {
    free:              5,
    essencial_mensal:  50,
    essencial_anual:   50,
    pro_mensal:        150,
    pro_anual:         150,
};

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

    const auth = await verifyUser(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const audioUrl: unknown = req.body?.audioUrl;
    const stemCount: unknown = req.body?.stemCount || 4;
    if (typeof audioUrl !== 'string' || !audioUrl.startsWith(allowedPrefix)) {
        res.status(400).json({ error: 'audioUrl must be hosted on our storage' });
        return;
    }
    const requestedStems = typeof stemCount === 'number' ? stemCount : 4;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Admin não tem cota.
    if (!auth.isAdmin) {
        const { data: profile, error: profErr } = await supabase
            .from('profiles')
            .select('plan')
            .eq('id', auth.userId)
            .maybeSingle();

        if (profErr) {
            console.error('[separate-audio] profile lookup failed:', profErr.message);
            res.status(500).json({ error: 'Profile lookup failed' });
            return;
        }
        const plan  = profile?.plan ?? 'free';
        const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

        const { data: consumed, error: rpcErr } = await supabase
            .rpc('consume_separation_token', { p_user_id: auth.userId, p_limit: limit });

        if (rpcErr) {
            console.error('[separate-audio] consume_token rpc failed:', rpcErr.message);
            res.status(500).json({ error: 'Quota check failed' });
            return;
        }
        if (consumed !== true) {
            res.status(402).json({ error: 'Quota exceeded for your plan', plan, limit });
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
        res.status(200).json({ success: true, prediction, model_name });
    } catch (error: any) {
        console.error('[separate-audio] replicate error:', error?.message);
        if (!auth.isAdmin) {
            await supabase.rpc('refund_separation_token', { p_user_id: auth.userId });
        }
        res.status(502).json({ error: 'Separation service unavailable' });
    }
}
