import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const supabaseUrl    = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STEMS      = 32;
const MAX_NAME_LEN   = 100;
const MAX_URL_LEN    = 2048;

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
    const raw = Array.isArray(body.stems) ? body.stems : null;
    if (!raw || raw.length === 0) {
        return res.status(400).json({ error: 'stems array is required' });
    }
    if (raw.length > MAX_STEMS) {
        return res.status(413).json({ error: `Too many stems (max ${MAX_STEMS})` });
    }

    // Whitelist + valida cada stem antes de tocar no banco.
    const songIds = new Set<string>();
    const cleaned: Array<{ song_id: string; name: string; file_url: string; order: number }> = [];
    for (const s of raw) {
        const song_id  = typeof s?.song_id === 'string' ? s.song_id : '';
        if (!UUID_RE.test(song_id)) {
            return res.status(400).json({ error: 'Invalid song_id (must be UUID)' });
        }
        const name     = clampStr(s?.name, MAX_NAME_LEN);
        const file_url = clampUrl(s?.file_url);
        if (!name || !file_url) {
            return res.status(400).json({ error: 'Each stem requires name and http(s) file_url' });
        }
        const order = Number.isFinite(Number(s?.order)) ? Math.max(0, Math.trunc(Number(s.order))) : 0;
        songIds.add(song_id);
        cleaned.push({ song_id, name, file_url, order });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verifica ownership: usuário comum só insere stems em músicas próprias.
    // Admin pode inserir em qualquer música (catálogo global).
    if (!auth.isAdmin) {
        const { data: owned, error: ownErr } = await supabase
            .from('songs')
            .select('id, user_id')
            .in('id', [...songIds]);

        if (ownErr) {
            console.error('[insert-stems] ownership check failed:', ownErr.message);
            return res.status(500).json({ error: 'Ownership check failed' });
        }
        const ownedSet = new Set(
            (owned ?? []).filter(s => s.user_id === auth.userId).map(s => s.id)
        );
        for (const id of songIds) {
            if (!ownedSet.has(id)) {
                return res.status(403).json({ error: 'Forbidden: not the owner of one or more songs' });
            }
        }
    }

    const { error } = await supabase.from('stems').insert(cleaned);
    if (error) {
        console.error('[insert-stems] supabase error:', error.message);
        return res.status(500).json({ error: 'Failed to insert stems' });
    }

    return res.status(200).json({ success: true, count: cleaned.length });
}
