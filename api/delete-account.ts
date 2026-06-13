import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const supabaseUrl    = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Exclui a conta do PRÓPRIO usuário autenticado. O id vem sempre do JWT
// (verifyUser), nunca do body — o usuário só pode apagar a si mesmo.
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

    // Remove o perfil (dados próprios). Stems/músicas com user_id ficam órfãos
    // mas inacessíveis; a conta de auth é o que importa apagar.
    await supabase.from('profiles').delete().eq('id', auth.userId);

    const { error } = await supabase.auth.admin.deleteUser(auth.userId);
    if (error) {
        console.error('delete-account error:', error);
        return res.status(500).json({ error: 'Não foi possível excluir a conta.' });
    }

    return res.status(200).json({ ok: true });
}
