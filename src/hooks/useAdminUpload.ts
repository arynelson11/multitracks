import { useState, useCallback } from 'react';
import { insertSong, insertStems, insertPadSet, type CloudStem } from '../lib/supabase';
import { uploadToR2 } from '../lib/r2';

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
            if (!songId) throw new Error('Falha ao gravar música (ID não retornado).');
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
        padFiles: Map<string, File>,
        padSetName: string,
        padSetDescription?: string
    ) => {
        setIsUploading(true);
        setProgress(0);
        setStatus('Iniciando upload dos Pads...');
        setError(null);

        try {
            const name = padSetName.trim() || 'Pads do Sistema';
            const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const id = `${slug}_${Date.now()}`;
            const basePath = `pad_sets/${id}`;

            const totalSteps = padFiles.size;
            let i = 0;

            for (const [note, file] of padFiles.entries()) {
                const stepProgress = Math.floor(((i + 1) / totalSteps) * 88);
                setStatus(`Subindo Pad ${note} (${i + 1} de ${totalSteps})...`);

                const contentType = file.type || 'audio/mpeg';
                // Use dedicated pad upload endpoint — no timestamp, predictable path
                const urlRes = await fetch(
                    `/api/upload-pad-file?basePath=${encodeURIComponent(basePath)}&note=${encodeURIComponent(note)}&contentType=${encodeURIComponent(contentType)}`
                );
                if (!urlRes.ok) throw new Error(`Erro ao obter URL para Pad ${note}`);
                const { uploadUrl } = await urlRes.json();

                const putRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: file,
                    headers: { 'Content-Type': contentType },
                });
                if (!putRes.ok) throw new Error(`Erro no upload do Pad ${note}: status ${putRes.status}`);

                setProgress(stepProgress);
                i++;
            }

            // Register in R2-based catalog (no Supabase dependency)
            setStatus('Registrando banco de pads no catálogo...');
            const catalogRes = await fetch('/api/pad-catalog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, name, description: padSetDescription?.trim() || null, base_path: basePath }),
            });
            if (!catalogRes.ok) {
                console.warn('Catalog update failed:', await catalogRes.text());
            }

            // Also try Supabase as bonus
            try { await insertPadSet({ name, description: padSetDescription?.trim() || null, base_path: basePath }); } catch { /* ignore */ }

            setProgress(100);
            setStatus('Sucesso! Banco de Pads publicado.');
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

    const uploadSamples = useCallback(async (
        bucket: string,
        files: File[],
        collectionName: string
    ) => {
        setIsUploading(true);
        setProgress(0);
        setStatus(`Iniciando upload para ${bucket}...`);
        setError(null);

        try {
            const { supabase } = await import('../lib/supabase');
            if (!supabase) throw new Error('Erro de conexão com Supabase');

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = `${collectionName.trim().toLowerCase().replace(/\s+/g, '_')}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
                setStatus(`Subindo ${i + 1} de ${files.length}: ${file.name}`);
                const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, { contentType: file.type || 'audio/mpeg' });
                if (uploadError) throw new Error(`Erro: ${uploadError.message}`);
                setProgress(Math.floor(((i + 1) / files.length) * 100));
            }

            setProgress(100);
            setStatus('Sucesso! Arquivos publicados.');
            return true;
        } catch (e: any) {
            console.error('Sample Upload failed:', e);
            setError(e.message || 'Erro no upload');
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
        uploadSamples,
        resetState: () => {
            setProgress(0);
            setStatus('');
            setError(null);
        }
    };
}
