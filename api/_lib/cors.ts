// CORS centralizado.
// Configure ALLOWED_ORIGINS no Vercel como CSV: "https://app.com,https://www.app.com"
// Se vazio em produção, default seguro = nega CORS cross-origin (mesma-origem segue funcionando).
// Em desenvolvimento (NODE_ENV !== 'production'), libera localhost para DX.

function parseAllowed(): string[] {
    const csv = process.env.ALLOWED_ORIGINS || '';
    return csv.split(',').map(s => s.trim()).filter(Boolean);
}

export function applyCors(req: any, res: any, methods: string): void {
    const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
    const allowed = parseAllowed();
    const isDev = process.env.NODE_ENV !== 'production';

    let allowOrigin: string | null = null;
    if (allowed.includes(origin)) {
        allowOrigin = origin;
    } else if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        allowOrigin = origin;
    }

    if (allowOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
