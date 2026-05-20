import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';

const R2_ACCOUNT_ID        = process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME       = process.env.VITE_R2_BUCKET_NAME || 'multitracks-bucket';

const ALLOWED_FOLDERS       = new Set(['covers', 'stems', 'temp']);
const ALLOWED_CONTENT_TYPES = /^(audio\/|image\/|application\/octet-stream$)/;
const MAX_FILENAME_LEN      = 200;

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId:     R2_ACCESS_KEY_ID     || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

export default async function handler(req: any, res: any) {
    applyCors(req, res, 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET')     return res.status(405).json({ error: 'Method Not Allowed' });

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { filename, contentType = 'application/octet-stream', bucketFolder = 'stems' } = req.query;
    const folder = String(bucketFolder);
    const ct     = String(contentType);

    if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'filename is required' });
    }
    if (!ALLOWED_FOLDERS.has(folder)) {
        return res.status(400).json({ error: 'Invalid bucketFolder' });
    }
    if (!ALLOWED_CONTENT_TYPES.test(ct)) {
        return res.status(400).json({ error: 'Invalid contentType' });
    }

    const cleanFilename = filename.slice(0, MAX_FILENAME_LEN).replace(/[^a-zA-Z0-9.-]/g, '_');
    // Path scoping: usuário só escreve dentro de seu próprio prefixo (admin idem por consistência).
    const key = `${folder}/${auth.userId}/${Date.now()}_${cleanFilename}`;

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: ct,
    });

    try {
        const uploadUrl = await getSignedUrl(S3, command, { expiresIn: 900 });
        return res.status(200).json({ uploadUrl, key });
    } catch (error: any) {
        console.error('[get-upload-url] presign failed:', error?.message);
        return res.status(500).json({ error: 'Failed to generate upload URL' });
    }
}
