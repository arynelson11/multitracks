import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

// Server-side stem copy: fetches from sourceUrl and uploads to R2 directly.
// Avoids browser→R2 PUT issues (CORS, 502, large file timeouts).
export const config = {
  maxDuration: 300,
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { sourceUrl, key, contentType = 'audio/wav' } = req.body || {};

  if (!sourceUrl || !key) {
    return res.status(400).json({ error: 'sourceUrl and key are required' });
  }
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return res.status(500).json({ error: 'R2 credentials not configured on server' });
  }

  try {
    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok) {
      throw new Error(`Falha ao baixar stem: HTTP ${sourceResponse.status}`);
    }

    const arrayBuffer = await sourceResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await S3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.byteLength,
    }));

    const publicUrlBase = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');
    return res.status(200).json({ url: `${publicUrlBase}/${key}`, key });
  } catch (error: any) {
    console.error('upload-stem-from-url error:', error);
    return res.status(500).json({ error: error.message || String(error) });
  }
}
