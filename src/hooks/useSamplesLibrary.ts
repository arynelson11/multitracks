import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export interface SampleItem {
    name: string;
    fullPath: string;
    url: string;
    size: number;
    folder: string;
}

export function useSamplesLibrary() {
    const [samples, setSamples] = useState<SampleItem[]>([]);
    const [loops, setLoops] = useState<SampleItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingUrl, setPlayingUrl] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const fetchBucket = useCallback(async (bucket: 'samples' | 'loops') => {
        if (!supabase) return [];

        const items: SampleItem[] = [];

        // List top-level folders
        const { data: folders, error: foldersError } = await supabase.storage.from(bucket).list('', { limit: 100 });
        if (foldersError || !folders) return [];

        for (const folder of folders) {
            if (folder.id === null || folder.id === undefined) {
                // It's a directory — list its contents
                const { data: files, error: filesError } = await supabase.storage.from(bucket).list(folder.name, { limit: 100 });
                if (filesError || !files) continue;

                for (const file of files) {
                    if (!file.name || file.id === null || file.id === undefined) continue;
                    const fullPath = `${folder.name}/${file.name}`;
                    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fullPath);
                    items.push({
                        name: file.name.replace(/^\d+_/, '').replace(/\.[^/.]+$/, ''),
                        fullPath,
                        url: urlData.publicUrl,
                        size: file.metadata?.size || 0,
                        folder: folder.name.replace(/_/g, ' '),
                    });
                }
            } else {
                // It's a file at root level
                const fullPath = folder.name;
                const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fullPath);
                items.push({
                    name: folder.name.replace(/^\d+_/, '').replace(/\.[^/.]+$/, ''),
                    fullPath,
                    url: urlData.publicUrl,
                    size: folder.metadata?.size || 0,
                    folder: '',
                });
            }
        }

        return items;
    }, []);

    const loadLibrary = useCallback(async () => {
        setLoading(true);
        try {
            const [s, l] = await Promise.all([fetchBucket('samples'), fetchBucket('loops')]);
            setSamples(s);
            setLoops(l);
        } catch (e) {
            console.error('Failed to load samples library:', e);
        } finally {
            setLoading(false);
        }
    }, [fetchBucket]);

    useEffect(() => {
        loadLibrary();
    }, [loadLibrary]);

    const playSample = useCallback((url: string) => {
        // Stop current
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        if (playingUrl === url) {
            setPlayingUrl(null);
            return;
        }

        const audio = new Audio(url);
        audio.volume = 0.8;
        audio.onended = () => setPlayingUrl(null);
        audio.onerror = () => setPlayingUrl(null);
        audio.play().catch(() => setPlayingUrl(null));
        audioRef.current = audio;
        setPlayingUrl(url);
    }, [playingUrl]);

    const stopPlayback = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setPlayingUrl(null);
    }, []);

    return { samples, loops, loading, playingUrl, playSample, stopPlayback, refresh: loadLibrary };
}
