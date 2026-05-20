/// <reference types="node" />
import { applyCors } from './_lib/cors';

/**
 * GET /api/debug-env
 * Retorna quais variáveis de ambiente essenciais estão configuradas (sem expor valores).
 * REMOVA ESTE ENDPOINT após resolver os problemas de configuração!
 */
export default async function handler(req: any, res: any) {
    applyCors(req, res, 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const check = (key: string) => ({
        key,
        set: !!(process.env[key] && process.env[key]!.trim().length > 0),
        preview: process.env[key] ? `${process.env[key]!.slice(0, 6)}...` : null,
    });

    const envChecks = [
        check('ABACATEPAY_ACCESS_TOKEN'),
        check('R2_ACCESS_KEY_ID'),
        check('R2_SECRET_ACCESS_KEY'),
        check('R2_ACCOUNT_ID'),
        check('VITE_R2_ACCOUNT_ID'),
        check('VITE_R2_BUCKET_NAME'),
        check('VITE_R2_PUBLIC_URL'),
        check('VITE_SUPABASE_URL'),
        check('VITE_SUPABASE_ANON_KEY'),
        check('SUPABASE_SERVICE_ROLE_KEY'),
    ];

    const missing = envChecks.filter(e => !e.set).map(e => e.key);
    const present = envChecks.filter(e => e.set).map(e => e.key);

    return res.status(200).json({
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL_ENV || 'local',
        present,
        missing,
        details: envChecks,
    });
}
