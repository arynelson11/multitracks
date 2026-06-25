import { get, set, del, keys } from 'idb-keyval';
import { type CloudSong } from './supabase';

import { type Marker } from '../types';

const SONGS_LIST_KEY = 'playback-studio:songs-list';
const SONG_CACHE_PREFIX = 'playback-studio:song:';

export interface CachedSongData {
    songId: string;
    song: CloudSong;
    files: { name: string; blob: Blob }[];
    coverBlob: Blob | null;
}

// Save songs list to cache
export async function cacheSongsList(songs: CloudSong[]): Promise<void> {
    try {
        await set(SONGS_LIST_KEY, songs);
    } catch (e) {
        console.error('Failed to cache songs list:', e);
    }
}

// Get songs list from cache
export async function getCachedSongsList(): Promise<CloudSong[]> {
    try {
        const list = await get<CloudSong[]>(SONGS_LIST_KEY);
        return list || [];
    } catch (e) {
        console.error('Failed to retrieve cached songs list:', e);
        return [];
    }
}

// Converte um blob de capa em data: URL. Diferente de URL.createObjectURL
// (blob:), o data: URL é DURÁVEL: sobrevive ao restart do app, funciona offline
// e sob file:// (desktop). Persistir um blob: na meta do repertório deixava a
// capa quebrada ao reabrir — no desktop o blob morto virava ERR_FILE_NOT_FOUND.
// Capas definidas pelo usuário já usam readAsDataURL (App.tsx); aqui seguimos o
// mesmo padrão pras capas vindas do cache offline.
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Download cover image as a blob
async function downloadCoverAsBlob(url: string): Promise<Blob | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.blob();
    } catch (e) {
        console.warn('Failed to download cover image, caching without cover:', e);
        return null;
    }
}

// Save a song, its stems files, and its cover image to cache
export async function cacheSong(
    songId: string,
    song: CloudSong,
    files: File[]
): Promise<void> {
    try {
        // Prepare stems files by reading their array buffers to ensure structured clone compatibility
        const stemsData = await Promise.all(
            files.map(async (f) => {
                const buffer = await f.arrayBuffer();
                return {
                    name: f.name,
                    blob: new Blob([buffer], { type: f.type || 'audio/wav' })
                };
            })
        );

        // Download cover image if it exists
        let coverBlob: Blob | null = null;
        if (song.cover_url) {
            coverBlob = await downloadCoverAsBlob(song.cover_url);
        }

        const cacheData: CachedSongData = {
            songId,
            song,
            files: stemsData,
            coverBlob
        };

        await set(`${SONG_CACHE_PREFIX}${songId}`, cacheData);
        console.log(`Song ${song.name} (${songId}) cached offline successfully.`);
    } catch (e) {
        console.error(`Failed to cache song ${songId}:`, e);
    }
}

// Check if a song is cached offline
export async function isSongCached(songId: string): Promise<boolean> {
    try {
        const cachedKeys = await keys();
        return cachedKeys.includes(`${SONG_CACHE_PREFIX}${songId}`);
    } catch (e) {
        console.error('Failed to check if song is cached:', e);
        return false;
    }
}

// Retrieve cached song data and convert blobs back to File objects
export async function getCachedSong(songId: string): Promise<{
    files: File[];
    coverUrl: string | null;
    markers: Marker[] | null;
    originalKey: string | null;
    artist?: string;
    bpm?: number;
    lyrics?: string | null;
    lyricsSynced?: string | null;
    chords?: string | null;
} | null> {
    try {
        const data = await get<CachedSongData>(`${SONG_CACHE_PREFIX}${songId}`);
        if (!data) return null;

        // Reconstruct File objects
        const files = data.files.map((f) => {
            return new File([f.blob], f.name, { type: f.blob.type });
        });

        // Reconstrói a capa como data: URL (durável) quando há blob em cache;
        // senão cai na cover_url remota (https). Nunca um blob: de sessão, que
        // morre ao reabrir o app e quebra a imagem no desktop (file://).
        let coverUrl: string | null = null;
        if (data.coverBlob) {
            coverUrl = await blobToDataUrl(data.coverBlob);
        } else if (data.song.cover_url) {
            coverUrl = data.song.cover_url;
        }

        return {
            files,
            coverUrl,
            markers: data.song.markers || null,
            originalKey: data.song.key || null,
            artist: data.song.artist || undefined,
            bpm: data.song.bpm || undefined,
            lyrics: data.song.lyrics ?? null,
            lyricsSynced: data.song.lyrics_synced ?? null,
            chords: data.song.chords ?? null
        };
    } catch (e) {
        console.error(`Failed to get cached song ${songId}:`, e);
        return null;
    }
}

// Remove cached song
export async function removeCachedSong(songId: string): Promise<void> {
    try {
        const cacheKey = `${SONG_CACHE_PREFIX}${songId}`;
        await del(cacheKey);
        console.log(`Cached song ${songId} removed.`);
    } catch (e) {
        console.error(`Failed to delete cached song ${songId}:`, e);
    }
}

// Get all cached song IDs
export async function getCachedSongIds(): Promise<Set<string>> {
    try {
        const allKeys = await keys();
        const songKeys = allKeys.filter(
            (k): k is string => typeof k === 'string' && k.startsWith(SONG_CACHE_PREFIX)
        );
        const ids = songKeys.map((k) => k.substring(SONG_CACHE_PREFIX.length));
        return new Set(ids);
    } catch (e) {
        console.error('Failed to list cached song IDs:', e);
        return new Set();
    }
}
