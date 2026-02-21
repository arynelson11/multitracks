import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCOUNT_ID = process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.VITE_R2_BUCKET_NAME || 'multitracks-bucket';

// Initialize the S3 client configured for Cloudflare R2
const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
});

export default async function handler(req: any, res: any) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { filename, contentType = 'application/octet-stream', bucketFolder = 'stems' } = req.query;

        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
            return res.status(500).json({ error: 'R2 credentials not properly configured on server' });
        }

        // Clean filename and create the full key path (e.g., stems/12345_song.mp3)
        const cleanFilename = String(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `${bucketFolder}/${Date.now()}_${cleanFilename}`;

        const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            ContentType: String(contentType),
        });

        // URL expires in 15 minutes (900 seconds)
        const uploadUrl = await getSignedUrl(S3, command, { expiresIn: 900 });

        return res.status(200).json({
            uploadUrl,
            key, // Optional: return the key so the frontend knows the path
        });
    } catch (error) {
        console.error('Error generating presigned URL:', error);
        return res.status(500).json({ error: 'Failed to generate upload URL', details: String(error) });
    }
}
