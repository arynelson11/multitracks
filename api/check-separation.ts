import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const PREDICTION_ID_RE = /^[a-z0-9]{20,}$/i;

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

    const auth = await verifyUser(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const predictionId = req.query?.predictionId;
    if (typeof predictionId !== 'string' || !PREDICTION_ID_RE.test(predictionId)) {
        res.status(400).json({ error: 'Invalid predictionId' });
        return;
    }

    // Ownership: usuário comum só consulta prediction que ele mesmo criou.
    // Admin pode consultar qualquer uma. Fecha o IDOR (consultar separação alheia por ID).
    if (!auth.isAdmin) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
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

    try {
        const replicate = new Replicate({ auth: replicateToken });
        const prediction = await replicate.predictions.get(predictionId);
        res.status(200).json({ prediction });
    } catch (error: any) {
        console.error('[check-separation] replicate error:', error?.message);
        res.status(502).json({ error: 'Separation service unavailable' });
    }
}
