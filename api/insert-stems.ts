import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ error: 'Supabase server credentials not configured' });
    }

    try {
        const { stems } = req.body;
        if (!Array.isArray(stems) || stems.length === 0) {
            return res.status(400).json({ error: 'stems array is required' });
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { error } = await supabase.from('stems').insert(stems);

        if (error) {
            console.error('Error inserting stems:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(200).json({ success: true });
    } catch (e: any) {
        console.error('insert-stems handler error:', e);
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
}
