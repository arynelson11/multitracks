import { useState, useEffect, useCallback } from 'react';
import { fetchSongs, searchSongs, fetchStems, downloadFileAsBlob, type CloudSong, type CloudStem } from '../lib/supabase';

export function useCloudLibrary() {
    const [songs, setSongs] = useState<CloudSong[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoadingList, setIsLoadingList] = useState(false);
    const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState('');

    // Load songs on mount
    useEffect(() => {
        loadSongs();
    }, []);

    const loadSongs = async () => {
        setIsLoadingList(true);
        const data = await fetchSongs();
        setSongs(data);
        setIsLoadingList(false);
    };

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(async () => {
            setIsLoadingList(true);
            const data = searchQuery ? await searchSongs(searchQuery) : await fetchSongs();
            setSongs(data);
            setIsLoadingList(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Download a song's stems and return as File[]
    const downloadSong = useCallback(async (songId: string): Promise<{ files: File[], coverUrl: string | null } | null> => {
        setDownloadingSongId(songId);
        setDownloadProgress('Buscando stems...');

        try {
            const stems: CloudStem[] = await fetchStems(songId);
            if (stems.length === 0) {
                setDownloadProgress('Nenhum stem encontrado.');
                setDownloadingSongId(null);
                return null;
            }

            const files: File[] = [];
            for (let i = 0; i < stems.length; i++) {
                const stem = stems[i];
                setDownloadProgress(`Baixando ${stem.name} (${i + 1}/${stems.length})...`);

                const ext = stem.file_url.split('.').pop() || 'wav';
                const file = await downloadFileAsBlob(stem.file_url, `${stem.name}.${ext}`);
                if (file) {
                    files.push(file);
                }
            }

            // Get cover URL from the song
            const song = songs.find(s => s.id === songId);
            const coverUrl = song?.cover_url || null;

            setDownloadProgress('');
            setDownloadingSongId(null);
            return { files, coverUrl };
        } catch (e) {
            console.error('Error downloading song:', e);
            setDownloadProgress('Erro ao baixar.');
            setDownloadingSongId(null);
            return null;
        }
    }, [songs]);

    return {
        songs,
        searchQuery,
        setSearchQuery,
        isLoadingList,
        downloadingSongId,
        downloadProgress,
        downloadSong,
        refreshSongs: loadSongs
    };
}
