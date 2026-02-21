import { useState, useCallback } from 'react';
import { uploadFile, insertSong, insertStems, type CloudStem } from '../lib/supabase';

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
                cover_url = await uploadFile('covers', fileName, coverFile);
                if (!cover_url) throw new Error('Falha no upload da capa');
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
            if (!songId) throw new Error('Falha ao gravar música no banco');
            setProgress(20);

            // 3. Upload Stems
            const stemsData: Omit<CloudStem, 'id'>[] = [];
            const totalSteps = stemFiles.length;

            for (let i = 0; i < stemFiles.length; i++) {
                const file = stemFiles[i];
                const stepProgress = 20 + Math.floor(((i + 1) / totalSteps) * 70);

                setStatus(`Subindo stem ${i + 1} de ${totalSteps}: ${file.name}...`);

                const fileName = `${songId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
                const file_url = await uploadFile('stems', fileName, file);

                if (!file_url) {
                    console.warn(`Falha no upload do stem: ${file.name}`);
                    continue;
                }

                stemsData.push({
                    song_id: songId,
                    name: file.name.replace(/\.[^/.]+$/, ""), // remove ext
                    file_url,
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

    return {
        isUploading,
        progress,
        status,
        error,
        uploadProject,
        resetState: () => {
            setProgress(0);
            setStatus('');
            setError(null);
        }
    };
}
