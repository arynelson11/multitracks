export const uploadToR2 = async (bucketFolder: string, fileName: string, file: File) => {
    try {
        const type = file.type || 'application/octet-stream';
        const res = await fetch(`/api/get-upload-url?filename=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(type)}&bucketFolder=${encodeURIComponent(bucketFolder)}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(`[API Error ${res.status}] ${data.error || 'Falha ao conectar com Vercel API'}`);
        }
        const { uploadUrl, key } = await res.json();

        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Content-Type': type
            }
        });
        if (!uploadRes.ok) throw new Error(`[R2 PUT Error ${uploadRes.status}] Falha no upload para Cloudflare`);

        const publicUrlBase = import.meta.env.VITE_R2_PUBLIC_URL;
        if (!publicUrlBase) throw new Error('Variável VITE_R2_PUBLIC_URL não configurada no ambiente (.env/Vercel)');

        const baseUrl = publicUrlBase.replace(/\/$/, "");
        const cleanKey = key.replace(/^\//, "");

        return { url: `${baseUrl}/${cleanKey}`, error: null };
    } catch (e: any) {
        return { url: null, error: e.message };
    }
}
