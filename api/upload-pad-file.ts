import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCOUNT_ID = process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.VITE_R2_BUCKET_NAME || 'multitracks-bucket';

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

// Dedicated pad upload — no timestamp prefix so URLs are predictable
export default async function handler(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'R2 credentials not configured' });
    }

    const { basePath, note, contentType = 'audio/mpeg' } = req.query;

    if (!basePath || !note) {
        return res.status(400).json({ error: 'basePath and note are required' });
    }

    // Key is exactly basePath/note — no timestamp, fully predictable
    const key = `${basePath}/${note}`;

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: String(contentType),
    });

    const uploadUrl = await getSignedUrl(S3, command, { expiresIn: 900 });
    const publicUrlBase = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');

    return res.status(200).json({
        uploadUrl,
        key,
        publicUrl: `${publicUrlBase}/${key}`,
    });
}
