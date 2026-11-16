import { createClient } from '@supabase/supabase-js';

// Quem é a pessoa vem do token (chave anônima, auth.getUser). O papel de admin
// e o bloqueio vêm do perfil (profiles.is_admin e profiles.blocked_at), lidos
// aqui no servidor com a chave de serviço. Nenhum e-mail decide papel.
// Falha fechada: sem chave, sem linha, coluna ausente ou qualquer erro de
// banco, a pessoa não é admin e não fica bloqueada.

export type AuthOk    = { ok: true;  userId: string; email: string; isAdmin: boolean; blocked: boolean };
export type AuthFail  = { ok: false; status: number; error: string };
export type AuthResult = AuthOk | AuthFail;

// Só o que a verificação lê do pedido; serve pro VercelRequest e pro req dos testes.
export type AuthRequest = { headers?: { authorization?: string } };

export const BLOCKED_MESSAGE = 'Sua conta está bloqueada. Fale com a gente pelo WhatsApp.';

type ProfileFlags = { isAdmin: boolean; blocked: boolean };

const CLOSED: ProfileFlags = { isAdmin: false, blocked: false };

// O aviso nunca leva token nem e-mail: só o motivo e o erro do banco, que não
// tem como citar nenhum dos dois (a consulta usa só o id e a chave de serviço).
function warnClosed(reason: string): ProfileFlags {
    console.warn('[auth] papel e bloqueio nao lidos, segue sem admin e sem bloqueio:', reason);
    return { ...CLOSED };
}

// Teto da leitura do perfil: banco pendurado não segura o pedido até o limite
// da função na Vercel. Estourou, fecha como nos outros erros.
const PROFILE_READ_TIMEOUT_MS = 3000;
const TIMED_OUT = Symbol('tempo esgotado');

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
    });
    return Promise.race([Promise.resolve(work), limit]).finally(() => clearTimeout(timer));
}

export async function readProfileFlags(userId: string): Promise<ProfileFlags> {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return warnClosed('sem chave de servico');

    try {
        const db = createClient(supabaseUrl, serviceKey);
        const query = db
            .from('profiles')
            .select('is_admin, blocked_at')
            .eq('id', userId)
            .maybeSingle();
        const out = await withTimeout(query, PROFILE_READ_TIMEOUT_MS);
        // Aviso sem nenhum dado pessoal: sem token, e-mail, chave ou id.
        if (out === TIMED_OUT) return warnClosed('tempo esgotado na leitura do perfil (3 s)');
        const { data, error } = out;
        if (error) return warnClosed(`erro de banco ${error.code || 'sem codigo'}: ${String(error.message ?? '').slice(0, 200)}`);
        if (!data) return warnClosed('perfil nao encontrado');
        return { isAdmin: data.is_admin === true, blocked: data.blocked_at != null };
    } catch (e) {
        return warnClosed(e instanceof Error ? e.message.slice(0, 200) : 'erro');
    }
}

export async function verifyUser(req: AuthRequest): Promise<AuthResult> {
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

    // Só depois do token validado: token inválido nunca lê o perfil.
    const flags = await readProfileFlags(data.user.id);
    return {
        ok: true,
        userId: data.user.id,
        email: data.user.email,
        isAdmin: flags.isAdmin,
        blocked: flags.blocked,
    };
}

export async function verifyAdmin(req: AuthRequest): Promise<AuthResult> {
    const result = await verifyUser(req);
    if (!result.ok) return result;
    if (!result.isAdmin) {
        return { ok: false, status: 403, error: 'Forbidden: admin required' };
    }
    return result;
}

// Pra quem separa, consulta separação, envia arquivo, salva na nuvem ou assina.
// Cancelar a assinatura e excluir a conta continuam com verifyUser (D10).
export async function verifyActiveUser(req: AuthRequest): Promise<AuthResult> {
    const result = await verifyUser(req);
    if (!result.ok) return result;
    if (result.blocked) {
        return { ok: false, status: 403, error: BLOCKED_MESSAGE };
    }
    return result;
}
