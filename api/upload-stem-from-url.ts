import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const R2_ACCOUNT_ID        = process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME       = process.env.VITE_R2_BUCKET_NAME || 'multitracks-bucket';

// Hostnames de origem permitidos para fetch server-side (anti-SSRF).
// Mantenha curto — adicionar requer revisão de segurança.
const ALLOWED_SOURCE_HOSTS = [
    'replicate.delivery',
    'pbxt.replicate.delivery',
    'tjzk.replicate.delivery',
];

const MAX_KEY_LEN          = 512;
const MAX_DOWNLOAD_BYTES   = 200 * 1024 * 1024; // 200 MB
const FETCH_TIMEOUT_MS     = 60_000;

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId:     R2_ACCESS_KEY_ID     || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

export const config = { maxDuration: 300 };

function isAllowedSource(rawUrl: string, ownPublicPrefix: string | null): boolean {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return false; }
    if (url.protocol !== 'https:') return false;
    if (ownPublicPrefix && rawUrl.startsWith(ownPublicPrefix)) return true;
    return ALLOWED_SOURCE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

function isValidKey(key: string, userId: string, isAdmin: boolean): boolean {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LEN) return false;
    if (key.includes('..') || key.startsWith('/')) return false;
    if (isAdmin) return true;
    // Usuário comum só escreve dentro de stems/{userId}/...
    return key.startsWith(`stems/${userId}/`);
}

export default async function handler(req: any, res: any) {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { sourceUrl, key, contentType = 'audio/wav' } = req.body || {};
    if (typeof sourceUrl !== 'string' || typeof key !== 'string') {
        return res.status(400).json({ error: 'sourceUrl and key are required' });
    }

    const ownPrefix = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/+$/, '') + '/';
    if (!isAllowedSource(sourceUrl, ownPrefix.length > 1 ? ownPrefix : null)) {
        return res.status(400).json({ error: 'sourceUrl host not allowed' });
    }
    if (!isValidKey(key, auth.userId, auth.isAdmin)) {
        return res.status(403).json({ error: 'Forbidden key path' });
    }
    if (typeof contentType !== 'string' || !/^(audio\/|application\/octet-stream$)/.test(contentType)) {
        return res.status(400).json({ error: 'Invalid contentType' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const sourceResponse = await fetch(sourceUrl, { signal: controller.signal });
        if (!sourceResponse.ok) {
            return res.status(502).json({ error: `Failed to fetch source: HTTP ${sourceResponse.status}` });
        }
        // Streaming com cap de tamanho para evitar fileira de bytes ilimitada.
        const reader = sourceResponse.body?.getReader();
        if (!reader) return res.status(502).json({ error: 'No response body' });

        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                total += value.byteLength;
                if (total > MAX_DOWNLOAD_BYTES) {
                    return res.status(413).json({ error: 'Source file too large' });
                }
                chunks.push(value);
            }
        }
        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));

        await S3.send(new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            ContentLength: buffer.byteLength,
        }));

        const publicUrlBase = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/+$/, '');
        return res.status(200).json({ url: `${publicUrlBase}/${key}`, key });
    } catch (error: any) {
        console.error('[upload-stem-from-url] error:', error?.message);
        return res.status(500).json({ error: 'Upload failed' });
    } finally {
        clearTimeout(timer);
    }
}
