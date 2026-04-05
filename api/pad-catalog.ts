import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

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

const CATALOG_KEY = 'pad_catalog.json';

interface PadSetEntry {
    id: string;
    name: string;
    description: string | null;
    base_path: string;
    created_at: string;
    note_urls?: Record<string, string>;
}

interface PadCatalog {
    sets: PadSetEntry[];
}

async function readCatalog(): Promise<PadCatalog> {
    try {
        const cmd = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: CATALOG_KEY });
        const res = await S3.send(cmd);
        const body = await res.Body?.transformToString();
        if (body) return JSON.parse(body);
    } catch {
        // File doesn't exist yet — return empty catalog
    }
    return { sets: [] };
}

async function writeCatalog(catalog: PadCatalog): Promise<void> {
    const cmd = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: CATALOG_KEY,
        Body: JSON.stringify(catalog, null, 2),
        ContentType: 'application/json',
        // Allow public reads
        ACL: 'public-read' as any,
    });
    await S3.send(cmd);
}

export default async function handler(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'R2 credentials not configured' });
    }

    // GET — return current catalog
    if (req.method === 'GET') {
        try {
            const catalog = await readCatalog();
            return res.status(200).json(catalog);
        } catch (e) {
            return res.status(500).json({ error: 'Failed to read catalog', details: String(e) });
        }
    }

    // POST — add or update a pad set entry
    if (req.method === 'POST') {
        try {
            const { id, name, description, base_path } = req.body as PadSetEntry;
            if (!id || !name || !base_path) {
                return res.status(400).json({ error: 'id, name and base_path are required' });
            }

            const catalog = await readCatalog();

            // Replace existing entry with same id, or add new one
            const idx = catalog.sets.findIndex(s => s.id === id);
            const entry: PadSetEntry = {
                id,
                name,
                description: description || null,
                base_path,
                created_at: new Date().toISOString(),
            };

            if (idx >= 0) {
                catalog.sets[idx] = entry;
            } else {
                catalog.sets.unshift(entry); // newest first
            }

            await writeCatalog(catalog);
            return res.status(200).json({ success: true, catalog });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to update catalog', details: String(e) });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
