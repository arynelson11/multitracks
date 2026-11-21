import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSongs, searchSongs, fetchStems, downloadFileAsBlobWithProgress, deleteSongFromCloud, type CloudSong, type CloudStem } from '../lib/supabase';
import { cacheSongsList, getCachedSongsList, cacheSong, isSongCached, removeCachedSong, getCachedSongIds } from '../lib/offlineCache';
import { useNetworkStatus } from './useNetworkStatus';
import { type Marker } from '../types';
import type { TimeSignatureType } from '../lib/AudioAnalyzer';
import { preciseBpm, sanitizeTimeSignature } from '../lib/cloudBpm';

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');

/** As frases do baixar, na linha da música (inicio-1 I2, Ruling textos-biblioteca): pro usuário,
 *  sem termo técnico, com "multitracks" e o número com vírgula. */
export const LIBRARY_PROGRESS = {
    offline: 'Carregando offline...',
    offlineMissing: 'Erro: Indisponível offline',
    fetching: 'Buscando as multitracks...',
    empty: 'Nenhuma multitrack encontrada.',
    downloading: (bytes: number, done: number, total: number) => `Baixando as multitracks: ${mb(bytes)} MB (${done} de ${total})`,
    saving: 'Guardando no aparelho...',
    tooBig: 'Grande demais pra guardar no aparelho.',
    cancelled: 'Cancelado.',
    failed: 'Erro ao baixar.',
    /** Sem espaço: vira frase na janela da Biblioteca (inicio-1 M2), não o aviso do navegador. */
    lowSpace: 'Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.',
} as const;

export type CloudDownload = { files: File[], coverUrl: string | null, markers: Marker[] | null, originalKey: string | null, artist?: string, bpm?: number, timeSignature: TimeSignatureType | null, lyrics?: string | null, lyricsSynced?: string | null, chords?: string | null, cachedSourceId?: string };
/** O baixar que nem começou, com a frase pra janela mostrar. */
export type CloudDownloadRefused = { refused: string };

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
    const downloadSong = useCallback(async (songId: string): Promise<CloudDownload | CloudDownloadRefused | null> => {
        setDownloadingSongId(songId);

        // Check cache first
        const isCached = cachedSongIds.has(songId);
        if (!isOnline || isCached) {
            setDownloadProgress(LIBRARY_PROGRESS.offline);
            try {
                // Música no cache: NÃO carrega os blobs na memória aqui. Devolve só
                // a meta + cachedSourceId; o engine decodifica lendo do cache 1 stem
                // por vez (sem segurar todos os blobs + buffers = OOM no iPhone).
                if (await isSongCached(songId)) {
                    const s = songs.find(x => x.id === songId);
                    setDownloadProgress('');
                    setDownloadingSongId(null);
                    return {
                        files: [],
                        cachedSourceId: songId,
                        coverUrl: s?.cover_url ?? null,
                        markers: s?.markers ?? null,
                        originalKey: s?.key ?? null,
                        artist: s?.artist ?? undefined,
                        bpm: s ? preciseBpm(s) : undefined,
                        timeSignature: sanitizeTimeSignature(s?.time_signature),
                        lyrics: s?.lyrics ?? null,
                        lyricsSynced: s?.lyrics_synced ?? null,
                        chords: s?.chords ?? null
                    };
                }
                if (!isOnline) {
                    throw new Error('Música não encontrada no cache offline.');
                }
            } catch (e) {
                console.error('Failed to retrieve cached song:', e);
                if (!isOnline) {
                    setDownloadProgress(LIBRARY_PROGRESS.offlineMissing);
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
                    setDownloadingSongId(null);
                    return { refused: LIBRARY_PROGRESS.lowSpace };
                }
            } catch (err) {
                console.warn('Failed to estimate storage:', err);
            }
        }

        // Initialize AbortController
        const controller = new AbortController();
        abortControllersRef.current[songId] = controller;

        setDownloadProgress(LIBRARY_PROGRESS.fetching);
        try {
            const stems: CloudStem[] = await fetchStems(songId);
            if (stems.length === 0) {
                setDownloadProgress(LIBRARY_PROGRESS.empty);
                setDownloadingSongId(null);
                return null;
            }

            let completed = 0;
            const loadedBytesPerStem: Record<string, number> = {};

            const updateGlobalProgress = () => {
                if (controller.signal.aborted) return;
                const totalLoaded = Object.values(loadedBytesPerStem).reduce((a, b) => a + b, 0);
                setDownloadProgress(LIBRARY_PROGRESS.downloading(totalLoaded, completed, stems.length));
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

            // Get cover URL from current song list
            const song = songs.find(s => s.id === songId);
            const coverUrl = song?.cover_url || null;

            // Cache for offline play. Só marca como OFFLINE se a gravação deu certo
            // de verdade (cacheSong agora verifica e retorna boolean). Antes o erro
            // era engolido e a música virava "offline" falsa e abria vazia depois.
            let cachedOk = false;
            if (song && files.length > 0) {
                setDownloadProgress(LIBRARY_PROGRESS.saving);
                cachedOk = await cacheSong(songId, song, files);
                if (cachedOk) {
                    setCachedSongIds(prev => new Set(prev).add(songId));
                } else {
                    // Não coube no cache (ex.: multitrack grande demais p/ a quota).
                    // A música ainda toca agora (online); só não fica offline, o que é melhor
                    // que um selo "offline" mentiroso que abre repertório vazio.
                    setDownloadProgress(LIBRARY_PROGRESS.tooBig);
                }
            }

            setDownloadProgress('');
            setDownloadingSongId(null);

            const markers = song?.markers || null;
            const originalKey = song?.key || null;
            const artist = song?.artist || undefined;
            // BPM exato (com decimais) quando a nuvem tem; senão o inteiro.
            const bpm = song ? preciseBpm(song) : undefined;
            const timeSignature = sanitizeTimeSignature(song?.time_signature);
            const lyrics = song?.lyrics ?? null;
            const lyricsSynced = song?.lyrics_synced ?? null;
            const chords = song?.chords ?? null;

            // Cacheou com sucesso? Então NÃO devolve os blobs na memória: o engine
            // lê do cache 1 stem por vez (cachedSourceId). Segurar todos os blobs +
            // os buffers decodificados estourava a aba no iPhone. Os `files` locais
            // viram lixo coletável assim que esta função retorna.
            if (cachedOk) {
                return { files: [], cachedSourceId: songId, coverUrl, markers, originalKey, artist, bpm, timeSignature, lyrics, lyricsSynced, chords };
            }

            // Sem cache (offline grande demais): cai no carregamento em memória.
            return { files, coverUrl, markers, originalKey, artist, bpm, timeSignature, lyrics, lyricsSynced, chords };
        } catch (e) {
            const err = e as Error;
            console.error('Error downloading song:', err);
            if (err.name === 'AbortError') {
                setDownloadProgress(LIBRARY_PROGRESS.cancelled);
            } else {
                setDownloadProgress(LIBRARY_PROGRESS.failed);
            }
            setDownloadingSongId(null);
            return null;
        } finally {
            delete abortControllersRef.current[songId];
        }
    }, [songs, isOnline, cachedSongIds]);

    // `scope`: 'cloud' exclui da nuvem (com internet, só o admin consegue) e do aparelho; 'device'
    // tira só deste aparelho, e com internet a música continua na lista (inicio-1 M5).
    const removeSong = useCallback(async (songId: string, scope: 'cloud' | 'device' = 'cloud') => {
        setDeletingSongId(songId);
        const fromCloud = isOnline && scope === 'cloud';

        let success = false;
        if (fromCloud) {
            // Online: delete from database (if allowed/admin)
            success = await deleteSongFromCloud(songId);
        } else {
            // Offline, ou só deste aparelho: only delete from local cache
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

            // Update current list state (só deste aparelho com internet: continua na lista da nuvem)
            if (fromCloud) {
                setSongs(prev => prev.filter(s => s.id !== songId));
            } else if (!isOnline) {
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
