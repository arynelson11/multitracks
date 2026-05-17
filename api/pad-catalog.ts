import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { verifyAdmin } from './_lib/auth';
import { applyCors } from './_lib/cors';

const R2_ACCOUNT_ID        = process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME       = process.env.VITE_R2_BUCKET_NAME || 'multitracks-bucket';

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId:     R2_ACCESS_KEY_ID     || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

const CATALOG_KEY    = 'pad_catalog.json';
const BASE_PATH_RE   = /^pad_sets\/[a-z0-9_]+$/;
const ID_RE          = /^[a-z0-9_]{1,128}$/;
const MAX_NAME_LEN   = 120;
const MAX_DESC_LEN   = 500;

interface PadSetEntry {
    id: string;
    name: string;
    description: string | null;
    base_path: string;
    created_at: string;
    note_urls?: Record<string, string>;
}

interface PadCatalog { sets: PadSetEntry[] }

function clampStr(v: unknown, max: number): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t) return null;
    return t.slice(0, max);
}

async function readCatalog(): Promise<PadCatalog> {
    try {
        const cmd = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: CATALOG_KEY });
        const r = await S3.send(cmd);
        const body = await r.Body?.transformToString();
        if (body) return JSON.parse(body);
    } catch { /* arquivo ainda não existe */ }
    return { sets: [] };
}

async function writeCatalog(catalog: PadCatalog): Promise<void> {
    await S3.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: CATALOG_KEY,
        Body: JSON.stringify(catalog, null, 2),
        ContentType: 'application/json',
        ACL: 'public-read' as any,
    }));
}

export default async function handler(req: any, res: any) {
    applyCors(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    // Leitura pública do catálogo (mesma intenção de antes).
    if (req.method === 'GET') {
        try {
            return res.status(200).json(await readCatalog());
        } catch (e: any) {
            console.error('[pad-catalog] read failed:', e?.message);
            return res.status(500).json({ error: 'Failed to read catalog' });
        }
    }

    // Mutações exigem admin.
    const auth = await verifyAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    if (req.method === 'POST') {
        const { id, name, description, base_path } = (req.body ?? {}) as Partial<PadSetEntry>;
        const cleanId   = clampStr(id, 128);
        const cleanName = clampStr(name, MAX_NAME_LEN);
        const cleanBase = clampStr(base_path, 256);
        if (!cleanId || !ID_RE.test(cleanId))         return res.status(400).json({ error: 'Invalid id' });
        if (!cleanName)                                return res.status(400).json({ error: 'Invalid name' });
        if (!cleanBase || !BASE_PATH_RE.test(cleanBase)) return res.status(400).json({ error: 'Invalid base_path' });

        try {
            const catalog = await readCatalog();
            const entry: PadSetEntry = {
                id: cleanId,
                name: cleanName,
                description: clampStr(description, MAX_DESC_LEN),
                base_path: cleanBase,
                created_at: new Date().toISOString(),
            };
            const idx = catalog.sets.findIndex(s => s.id === cleanId);
            if (idx >= 0) catalog.sets[idx] = entry;
            else          catalog.sets.unshift(entry);
            await writeCatalog(catalog);
            return res.status(200).json({ success: true, catalog });
        } catch (e: any) {
            console.error('[pad-catalog] POST failed:', e?.message);
            return res.status(500).json({ error: 'Failed to update catalog' });
        }
    }

    if (req.method === 'PATCH') {
        const { id, name, description } = (req.body ?? {}) as Partial<PadSetEntry>;
        const cleanId = clampStr(id, 128);
        if (!cleanId || !ID_RE.test(cleanId)) return res.status(400).json({ error: 'Invalid id' });

        try {
            const catalog = await readCatalog();
            const idx = catalog.sets.findIndex(s => s.id === cleanId);
            if (idx < 0) return res.status(404).json({ error: 'Pad set not found' });
            if (name !== undefined) {
                const cleanName = clampStr(name, MAX_NAME_LEN);
                if (!cleanName) return res.status(400).json({ error: 'Invalid name' });
                catalog.sets[idx].name = cleanName;
            }
            if (description !== undefined) {
                catalog.sets[idx].description = clampStr(description, MAX_DESC_LEN);
            }
            await writeCatalog(catalog);
            return res.status(200).json({ success: true, catalog });
        } catch (e: any) {
            console.error('[pad-catalog] PATCH failed:', e?.message);
            return res.status(500).json({ error: 'Failed to update catalog' });
        }
    }

    if (req.method === 'DELETE') {
        const id = typeof req.query?.id === 'string' ? req.query.id : '';
        if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });

        try {
            const catalog = await readCatalog();
            catalog.sets = catalog.sets.filter(s => s.id !== id);
            await writeCatalog(catalog);
            return res.status(200).json({ success: true, catalog });
        } catch (e: any) {
            console.error('[pad-catalog] DELETE failed:', e?.message);
            return res.status(500).json({ error: 'Failed to delete from catalog' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
