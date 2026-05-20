import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const PREDICTION_ID_RE = /^[a-z0-9]{20,}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    applyCors(req, res, 'GET,OPTIONS');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'GET')     { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) { res.status(500).json({ error: 'Server misconfigured' }); return; }

    const auth = await verifyUser(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const predictionId = req.query?.predictionId;
    if (typeof predictionId !== 'string' || !PREDICTION_ID_RE.test(predictionId)) {
        res.status(400).json({ error: 'Invalid predictionId' });
        return;
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
