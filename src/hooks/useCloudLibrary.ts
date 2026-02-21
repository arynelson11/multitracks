import { useState, useEffect, useCallback } from 'react';
import { fetchSongs, searchSongs, fetchStems, downloadFileAsBlobWithProgress, type CloudSong, type CloudStem } from '../lib/supabase';

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

            let completed = 0;
            const loadedBytesPerStem: Record<string, number> = {};

            const updateGlobalProgress = () => {
                const totalLoaded = Object.values(loadedBytesPerStem).reduce((a, b) => a + b, 0);
                const mbTotal = (totalLoaded / (1024 * 1024)).toFixed(1);
                setDownloadProgress(`Baixando Rede: ${mbTotal} MB lidos (${completed}/${stems.length} concluídos)`);
            };

            const downloadTask = async (stem: CloudStem) => {
                updateGlobalProgress();
                const ext = stem.file_url.split('.').pop() || 'wav';
                const file = await downloadFileAsBlobWithProgress(
                    stem.file_url,
                    `${stem.name}.${ext}`,
                    (loaded: number) => {
                        loadedBytesPerStem[stem.id] = loaded;
                        updateGlobalProgress();
                    }
                );
                completed++;
                updateGlobalProgress();
                return file;
            };

            const filesResults: (File | null)[] = [];
            const BATCH_SIZE = 4;
            for (let i = 0; i < stems.length; i += BATCH_SIZE) {
                const batch = stems.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(downloadTask));
                filesResults.push(...batchResults);
            }

            const files: File[] = filesResults.filter((f): f is File => f !== null);

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
