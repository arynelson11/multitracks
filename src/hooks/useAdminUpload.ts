import { useState, useCallback } from 'react';
import { insertSong, insertStems, type CloudStem } from '../lib/supabase';

const uploadToR2 = async (bucketFolder: string, fileName: string, file: File) => {
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

export interface UploadMetadata {
    name: string;
    artist: string;
    key: string;
    bpm: number;
}

export function useAdminUpload() {
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('');
    const [error, setError] = useState<string | null>(null);

    const uploadProject = useCallback(async (
        metadata: UploadMetadata,
        coverFile: File | null,
        stemFiles: File[]
    ) => {
        setIsUploading(true);
        setProgress(0);
        setStatus('Iniciando upload...');
        setError(null);

        try {
            // 1. Upload Cover if exists
            let cover_url = null;
            if (coverFile) {
                setStatus('Subindo capa...');
                const fileName = `${Date.now()}_${coverFile.name.replace(/\s+/g, '_')}`;
                const uploadResult = await uploadToR2('covers', fileName, coverFile);

                if (uploadResult.error) {
                    throw new Error(`Erro na Capa: ${uploadResult.error}.`);
                }
                cover_url = uploadResult.url;
            }
            setProgress(10);

            // 2. Insert Song Metadata
            setStatus('Gravando metadados da música...');
            const songId = await insertSong({
                name: metadata.name,
                artist: metadata.artist,
                key: metadata.key,
                bpm: metadata.bpm,
                cover_url
            });
            if (!songId) throw new Error('Falha ao gravar música no banco de dados. Verifique a tabela "songs".');
            setProgress(20);

            // 3. Upload Stems
            const stemsData: Omit<CloudStem, 'id'>[] = [];
            const totalSteps = stemFiles.length;

            for (let i = 0; i < stemFiles.length; i++) {
                const file = stemFiles[i];
                const stepProgress = 20 + Math.floor(((i + 1) / totalSteps) * 70);

                setStatus(`Subindo stem ${i + 1} de ${totalSteps}: ${file.name}...`);

                const fileName = `${songId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
                const uploadResult = await uploadToR2('stems', fileName, file);

                if (uploadResult.error) {
                    throw new Error(`Erro no Stem ${file.name}: ${uploadResult.error}.`);
                }

                stemsData.push({
                    song_id: songId,
                    name: file.name.replace(/\.[^/.]+$/, ""), // remove ext
                    file_url: uploadResult.url!,
                    order: i + 1
                });

                setProgress(stepProgress);
            }

            // 4. Insert Stems Records
            if (stemsData.length > 0) {
                setStatus('Finalizando registros...');
                const success = await insertStems(stemsData);
                if (!success) throw new Error('Falha ao registrar stems no banco');
            }

            setProgress(100);
            setStatus('Sucesso! Música publicada.');
            return true;
        } catch (e: any) {
            console.error('Upload failed:', e);
            setError(e.message || 'Erro desconhecido durante o upload');
            setStatus('Erro no processo.');
            return false;
        } finally {
            setIsUploading(false);
        }
    }, []);

    const uploadSystemPads = useCallback(async (
        padFiles: Map<string, File>
    ) => {
        setIsUploading(true);
        setProgress(0);
        setStatus('Iniciando upload dos Pads do Sistema...');
        setError(null);

        try {
            const totalSteps = padFiles.size;
            let i = 0;

            for (const [note, file] of padFiles.entries()) {
                const stepProgress = Math.floor(((i + 1) / totalSteps) * 100);
                setStatus(`Subindo Pad ${note} (${i + 1} de ${totalSteps})...`);

                // To ensure consistent fetch URLs, we'll store the file without extension using the exact note name, e.g., 'C', 'Db'.
                // Supabase will serve it according to the uploaded content type. Note encoding avoids slash conflicts.
                const noteFileName = encodeURIComponent(note);
                const uploadResult = await uploadToR2('system_pads', noteFileName, file);

                if (uploadResult.error) {
                    throw new Error(`Erro no Pad ${note}: ${uploadResult.error}.`);
                }

                setProgress(stepProgress);
                i++;
            }

            setProgress(100);
            setStatus('Sucesso! Banco de Pads Global publicado.');
            return true;
        } catch (e: any) {
            console.error('Pad Upload failed:', e);
            setError(e.message || 'Erro desconhecido durante o upload dos pads');
            setStatus('Erro no processo.');
            return false;
        } finally {
            setIsUploading(false);
        }
    }, []);

    return {
        isUploading,
        progress,
        status,
        error,
        uploadProject,
        uploadSystemPads,
        resetState: () => {
            setProgress(0);
            setStatus('');
            setError(null);
        }
    };
}
