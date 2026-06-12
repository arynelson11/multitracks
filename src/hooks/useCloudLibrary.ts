import { useState, useEffect, useCallback } from 'react';
import { fetchSongs, searchSongs, fetchStems, downloadFileAsBlobWithProgress, deleteSongFromCloud, type CloudSong, type CloudStem } from '../lib/supabase';
import { cacheSongsList, getCachedSongsList, cacheSong, getCachedSong, removeCachedSong, getCachedSongIds } from '../lib/offlineCache';
import { useNetworkStatus } from './useNetworkStatus';
import { type Marker } from '../types';

export function useCloudLibrary() {
    const [songs, setSongs] = useState<CloudSong[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoadingList, setIsLoadingList] = useState(false);
    const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState('');
    const [deletingSongId, setDeletingSongId] = useState<string | null>(null);
    const [cachedSongIds, setCachedSongIds] = useState<Set<string>>(new Set());
    const isOnline = useNetworkStatus();

    // Load songs list and cached list
    useEffect(() => {
        loadSongs();
        getCachedSongIds().then(setCachedSongIds);
    }, [isOnline]);

    const loadSongs = async () => {
        setIsLoadingList(true);
        if (!isOnline) {
            const cachedData = await getCachedSongsList();
            setSongs(cachedData);
            setIsLoadingList(false);
            return;
        }

        try {
            const data = await fetchSongs();
            setSongs(data);
            await cacheSongsList(data);
        } catch (e) {
            console.error('Failed to load songs from cloud, reading offline cache...', e);
            const cachedData = await getCachedSongsList();
            setSongs(cachedData);
        } finally {
            setIsLoadingList(false);
        }
    };

    // Debounced search (respects online/offline)
    useEffect(() => {
        const timer = setTimeout(async () => {
            setIsLoadingList(true);
            const query = searchQuery.trim().toLowerCase();

            if (!isOnline) {
                const cachedSongs = await getCachedSongsList();
                if (!query) {
                    setSongs(cachedSongs);
                } else {
                    const filtered = cachedSongs.filter(s => 
                        s.name.toLowerCase().includes(query) ||
                        (s.artist && s.artist.toLowerCase().includes(query)) ||
                        (s.key && s.key.toLowerCase().includes(query))
                    );
                    setSongs(filtered);
                }
            } else {
                try {
                    const data = query ? await searchSongs(searchQuery) : await fetchSongs();
                    setSongs(data);
                } catch (e) {
                    console.error('Error searching songs online:', e);
                }
            }
            setIsLoadingList(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, isOnline]);

    // Download a song (or load from local cache if offline/cached)
    const downloadSong = useCallback(async (songId: string): Promise<{ files: File[], coverUrl: string | null, markers: Marker[] | null, originalKey: string | null, artist?: string, bpm?: number } | null> => {
        setDownloadingSongId(songId);

        // Check cache first
        const isCached = cachedSongIds.has(songId);
        if (!isOnline || isCached) {
            setDownloadProgress('Carregando offline...');
            try {
                const cachedData = await getCachedSong(songId);
                if (cachedData) {
                    setDownloadProgress('');
                    setDownloadingSongId(null);
                    return cachedData;
                }
                if (!isOnline) {
                    throw new Error('Música não encontrada no cache offline.');
                }
            } catch (e) {
                console.error('Failed to retrieve cached song:', e);
                if (!isOnline) {
                    setDownloadProgress('Erro: Indisponível offline');
                    setDownloadingSongId(null);
                    return null;
                }
            }
        }

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
                setDownloadProgress(`Rede: ${mbTotal} MB lidos (${completed}/${stems.length} concluídos)`);
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

            // Get cover URL from current song list
            const song = songs.find(s => s.id === songId);
            const coverUrl = song?.cover_url || null;

            // Cache for offline play
            if (song && files.length > 0) {
                setDownloadProgress('Salvando no cache...');
                await cacheSong(songId, song, files);
                setCachedSongIds(prev => new Set(prev).add(songId));
            }

            setDownloadProgress('');
            setDownloadingSongId(null);
            
            const markers = song?.markers || null;
            const originalKey = song?.key || null;
            const artist = song?.artist || undefined;
            const bpm = song?.bpm || undefined;
            return { files, coverUrl, markers, originalKey, artist, bpm };
        } catch (e) {
            console.error('Error downloading song:', e);
            setDownloadProgress('Erro ao baixar.');
            setDownloadingSongId(null);
            return null;
        }
    }, [songs, isOnline, cachedSongIds]);

    const removeSong = useCallback(async (songId: string) => {
        setDeletingSongId(songId);
        
        let success = false;
        if (isOnline) {
            // Online: delete from database (if allowed/admin)
            success = await deleteSongFromCloud(songId);
        } else {
            // Offline: only delete from local cache
            success = true;
        }

        if (success) {
            // Always clean up local offline cache
            await removeCachedSong(songId);
            setCachedSongIds(prev => {
                const next = new Set(prev);
                next.delete(songId);
                return next;
            });

            // Update current list state
            if (isOnline) {
                setSongs(prev => prev.filter(s => s.id !== songId));
            } else {
                const cachedSongs = await getCachedSongsList();
                setSongs(cachedSongs.filter(s => s.id !== songId));
                await cacheSongsList(cachedSongs.filter(s => s.id !== songId));
            }
        }
        setDeletingSongId(null);
        return success;
    }, [isOnline]);

    return {
        songs,
        searchQuery,
        setSearchQuery,
        isLoadingList,
        downloadingSongId,
        downloadProgress,
        deletingSongId,
        downloadSong,
        refreshSongs: loadSongs,
        removeSong,
        cachedSongIds,
        isOnline
    };
}
