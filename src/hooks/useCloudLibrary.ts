import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSongs, searchSongs, fetchStems, downloadFileAsBlobWithProgress, deleteSongFromCloud, type CloudSong, type CloudStem } from '../lib/supabase';
import { cacheSongsList, getCachedSongsList, cacheSong, getCachedSong, removeCachedSong, getCachedSongIds } from '../lib/offlineCache';
import { useNetworkStatus } from './useNetworkStatus';
import { pbTrace, pbTraceReset } from '../lib/pbTrace';
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

    const abortControllersRef = useRef<Record<string, AbortController>>({});

    const cancelDownload = useCallback((songId: string) => {
        const controller = abortControllersRef.current[songId];
        if (controller) {
            controller.abort();
            delete abortControllersRef.current[songId];
        }
    }, []);

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
    const downloadSong = useCallback(async (songId: string): Promise<{ files: File[], coverUrl: string | null, markers: Marker[] | null, originalKey: string | null, artist?: string, bpm?: number, lyrics?: string | null, lyricsSynced?: string | null, chords?: string | null } | null> => {
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

        // Check storage quota
        if (isOnline && !isCached && navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usage = estimate.usage || 0;
                const quota = estimate.quota || 0;
                const freeSpace = quota - usage;
                const MIN_FREE_SPACE = 150 * 1024 * 1024; // 150 MB
                if (freeSpace < MIN_FREE_SPACE) {
                    alert('Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.');
                    setDownloadingSongId(null);
                    return null;
                }
            } catch (err) {
                console.warn('Failed to estimate storage:', err);
            }
        }

        // Initialize AbortController
        const controller = new AbortController();
        abortControllersRef.current[songId] = controller;

        setDownloadProgress('Buscando stems...');
        pbTraceReset(`build=diag-4 | DL start ${songId}`);
        try {
            const stems: CloudStem[] = await fetchStems(songId);
            pbTrace(`DL stems encontrados: ${stems.length}`);
            if (stems.length === 0) {
                setDownloadProgress('Nenhum stem encontrado.');
                setDownloadingSongId(null);
                return null;
            }

            let completed = 0;
            const loadedBytesPerStem: Record<string, number> = {};

            const updateGlobalProgress = () => {
                if (controller.signal.aborted) return;
                const totalLoaded = Object.values(loadedBytesPerStem).reduce((a, b) => a + b, 0);
                const mbTotal = (totalLoaded / (1024 * 1024)).toFixed(1);
                setDownloadProgress(`Rede: ${mbTotal} MB lidos (${completed}/${stems.length} concluídos)`);
            };

            const downloadTask = async (stem: CloudStem) => {
                if (controller.signal.aborted) return null;
                updateGlobalProgress();
                const ext = stem.file_url.split('.').pop() || 'wav';
                const file = await downloadFileAsBlobWithProgress(
                    stem.file_url,
                    `${stem.name}.${ext}`,
                    (loaded: number) => {
                        loadedBytesPerStem[stem.id] = loaded;
                        updateGlobalProgress();
                    },
                    controller.signal
                );
                if (controller.signal.aborted) return null;
                completed++;
                updateGlobalProgress();
                return file;
            };

            const filesResults: (File | null)[] = [];
            const BATCH_SIZE = 4;
            for (let i = 0; i < stems.length; i += BATCH_SIZE) {
                if (controller.signal.aborted) {
                    throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
                }
                const batch = stems.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(downloadTask));
                if (controller.signal.aborted) {
                    throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
                }
                filesResults.push(...batchResults);
            }

            if (filesResults.some((f) => f === null)) {
                throw new Error('Falha ao baixar um ou mais stems da música.');
            }

            const files: File[] = filesResults.filter((f): f is File => f !== null);
            pbTrace(`DL baixou todos os stems: ${files.length}`);

            // Get cover URL from current song list
            const song = songs.find(s => s.id === songId);
            const coverUrl = song?.cover_url || null;

            // Cache for offline play. Só marca como OFFLINE se a gravação deu certo
            // de verdade (cacheSong agora verifica e retorna boolean). Antes o erro
            // era engolido e a música virava "offline" falsa — abria vazia depois.
            if (song && files.length > 0) {
                setDownloadProgress('Salvando no cache...');
                pbTrace('DL cacheando offline...');
                const cached = await cacheSong(songId, song, files);
                pbTrace(`DL cache offline resultado: ${cached}`);
                if (cached) {
                    setCachedSongIds(prev => new Set(prev).add(songId));
                } else {
                    // Não coube no cache (ex.: multitrack grande demais p/ a quota).
                    // A música ainda toca agora (online); só não fica offline — melhor
                    // que um selo "offline" mentiroso que abre repertório vazio.
                    setDownloadProgress('Grande demais para salvar offline.');
                }
            }

            setDownloadProgress('');
            setDownloadingSongId(null);
            
            const markers = song?.markers || null;
            const originalKey = song?.key || null;
            const artist = song?.artist || undefined;
            const bpm = song?.bpm || undefined;
            const lyrics = song?.lyrics ?? null;
            const lyricsSynced = song?.lyrics_synced ?? null;
            const chords = song?.chords ?? null;
            pbTrace('DL retornando p/ loadFiles (vai carregar no repertório)');
            return { files, coverUrl, markers, originalKey, artist, bpm, lyrics, lyricsSynced, chords };
        } catch (e) {
            const err = e as Error;
            console.error('Error downloading song:', err);
            if (err.name === 'AbortError') {
                setDownloadProgress('Cancelado.');
            } else {
                setDownloadProgress('Erro ao baixar.');
            }
            setDownloadingSongId(null);
            return null;
        } finally {
            delete abortControllersRef.current[songId];
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
        cancelDownload,
        cachedSongIds,
        isOnline
    };
}
