import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAILS = ['arynelson11@gmail.com', 'arynel11@gmail.com'];

export type AuthOk    = { ok: true;  userId: string; email: string; isAdmin: boolean };
export type AuthFail  = { ok: false; status: number; error: string };
export type AuthResult = AuthOk | AuthFail;

export async function verifyUser(req: any): Promise<AuthResult> {
    const authHeader: string | undefined = req.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return { ok: false, status: 401, error: 'Missing Bearer token' };
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
        return { ok: false, status: 401, error: 'Empty Bearer token' };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        return { ok: false, status: 500, error: 'Auth backend misconfigured' };
    }

    const client = createClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id || !data.user.email) {
        return { ok: false, status: 401, error: 'Invalid or expired token' };
    }

    return {
        ok: true,
        userId: data.user.id,
        email: data.user.email,
        isAdmin: ADMIN_EMAILS.includes(data.user.email),
    };
}

export async function verifyAdmin(req: any): Promise<AuthResult> {
    const result = await verifyUser(req);
    if (!result.ok) return result;
    if (!result.isAdmin) {
        return { ok: false, status: 403, error: 'Forbidden: admin required' };
    }
    return result;
}
