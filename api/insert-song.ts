import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth';
import { applyCors } from './_lib/cors';

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

export default async function handler(req: any, res: any) {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const body = req.body ?? {};
    const name = clampStr(body.name, MAX_NAME_LEN);
    if (!name) return res.status(400).json({ error: 'name is required' });

    // user_id é forçado pelo JWT — nunca confiamos no body.
    // is_global só pode ser ativado por admin; user comum sempre insere música privada.
    const insertPayload: Record<string, any> = {
        name,
        artist:    clampStr(body.artist, MAX_ARTIST_LEN) ?? '',
        key:       clampStr(body.key,    MAX_KEY_LEN)    ?? '',
        bpm:       Number.isFinite(Number(body.bpm)) ? Math.max(0, Math.min(999, Math.trunc(Number(body.bpm)))) : 0,
        cover_url: clampUrl(body.cover_url),
        user_id:   auth.userId,
        is_global: auth.isAdmin && body.is_global === true,
    };

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
        .from('songs')
        .insert(insertPayload)
        .select('id')
        .single();

    if (error) {
        console.error('[insert-song] supabase error:', error.message);
        return res.status(500).json({ error: 'Failed to insert song' });
    }

    return res.status(200).json({ id: data.id });
}
