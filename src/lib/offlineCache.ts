import { get, set, del, keys } from 'idb-keyval';
import { type CloudSong } from './supabase';

import { type Marker } from '../types';

const SONGS_LIST_KEY = 'playback-studio:songs-list';
const SONG_CACHE_PREFIX = 'playback-studio:song:';

// Chave do índice da música (metadados leves) e chave de cada stem.
// IMPORTANTE: cada stem fica numa chave própria. Guardar os 24 stems (240MB+)
// num único registro estourava o limite de structured-clone/quota num write só;
// o erro era engolido e a música era marcada como offline sem ter cacheado de
// fato (vinha vazia ao abrir). Por stem, cada write é pequeno e verificável.
const indexKey = (songId: string) => `${SONG_CACHE_PREFIX}${songId}`;
const stemKey = (songId: string, i: number) => `${SONG_CACHE_PREFIX}${songId}:stem:${i}`;

// Formato novo: índice leve + N chaves de stem.
interface CachedSongIndex {
    songId: string;
    song: CloudSong;
    stemNames: string[];
    coverBlob: Blob | null;
}

// Formato antigo (compat de leitura): tudo num registro só.
interface LegacyCachedSongData {
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

// Pede armazenamento PERSISTENTE: quota maior e dados não-evictáveis pelo
// navegador/Electron. Crucial pra multitracks grandes (centenas de MB).
async function requestPersistentStorage(): Promise<void> {
    try {
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
            const already = await navigator.storage.persisted?.();
            if (!already) await navigator.storage.persist();
        }
    } catch { /* opcional: segue sem persistência garantida */ }
}

// Apaga TODAS as chaves de uma música (índice + stems), nos dois formatos.
export async function removeCachedSong(songId: string): Promise<void> {
    try {
        const allKeys = await keys();
        const idx = indexKey(songId);
        const stemPrefix = `${idx}:stem:`;
        const toDelete = allKeys.filter(
            (k): k is string => typeof k === 'string' && (k === idx || k.startsWith(stemPrefix))
        );
        await Promise.all(toDelete.map((k) => del(k)));
        console.log(`Cached song ${songId} removed (${toDelete.length} chaves).`);
    } catch (e) {
        console.error(`Failed to delete cached song ${songId}:`, e);
    }
}

// Confere que o índice e TODOS os stems existem e têm conteúdo (size > 0).
async function verifyCached(songId: string, expectedStems: number): Promise<boolean> {
    const idx = await get<CachedSongIndex>(indexKey(songId));
    if (!idx) return false;
    for (let i = 0; i < expectedStems; i++) {
        const blob = await get<Blob>(stemKey(songId, i));
        if (!blob || (blob instanceof Blob && blob.size === 0)) return false;
    }
    return true;
}

// Save a song, its stems files, and its cover image to cache.
// Retorna TRUE só se gravou e verificou tudo. Em falha, reverte o que escreveu
// e retorna FALSE — o chamador NÃO deve marcar a música como offline.
export async function cacheSong(
    songId: string,
    song: CloudSong,
    files: File[]
): Promise<boolean> {
    try {
        if (files.length === 0) return false;
        await requestPersistentStorage();

        // Grava cada stem numa chave própria (writes pequenos e independentes).
        const stemNames: string[] = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const buffer = await f.arrayBuffer();
            const blob = new Blob([buffer], { type: f.type || 'audio/wav' });
            await set(stemKey(songId, i), blob);
            stemNames.push(f.name);
        }

        // Capa (opcional).
        let coverBlob: Blob | null = null;
        if (song.cover_url) {
            coverBlob = await downloadCoverAsBlob(song.cover_url);
        }

        const index: CachedSongIndex = { songId, song, stemNames, coverBlob };
        await set(indexKey(songId), index);

        // Verificação de integridade: se algo não persistiu, reverte e falha.
        const ok = await verifyCached(songId, files.length);
        if (!ok) {
            await removeCachedSong(songId);
            console.error(`Cache de "${song.name}" incompleto após gravar; revertido.`);
            return false;
        }

        console.log(`Song ${song.name} (${songId}) cached offline (${files.length} stems).`);
        return true;
    } catch (e) {
        // Quota estourada / clone grande demais / disco cheio: limpa o parcial.
        console.error(`Failed to cache song ${songId}:`, e);
        await removeCachedSong(songId).catch(() => { /* noop */ });
        return false;
    }
}

// Atualiza só os metadados (nome, artista, tom, bpm, capa) do snapshot guardado
// no índice offline quando a música é editada na biblioteca. Sem isso, reabrir
// uma música já baixada mostrava os dados de quando ela foi baixada. Os stems
// não mudam — reescrevemos apenas o índice leve. Se a capa mudou, rebaixa o blob
// durável (mantém o anterior se o download falhar). No-op se não há cache.
export async function updateCachedSongMeta(
    songId: string,
    patch: Partial<CloudSong>
): Promise<void> {
    try {
        const data = await get<CachedSongIndex | LegacyCachedSongData>(indexKey(songId));
        if (!data) return; // música não baixada: nada a sincronizar

        const coverChanged = patch.cover_url !== undefined && patch.cover_url !== data.song.cover_url;
        data.song = { ...data.song, ...patch };

        if (coverChanged && patch.cover_url) {
            const newCover = await downloadCoverAsBlob(patch.cover_url);
            if (newCover) data.coverBlob = newCover;
        }

        await set(indexKey(songId), data);
        console.log(`Cached meta de ${songId} atualizada (offline).`);
    } catch (e) {
        console.error(`Failed to update cached meta for ${songId}:`, e);
    }
}

// Check if a song is cached offline (índice presente)
export async function isSongCached(songId: string): Promise<boolean> {
    try {
        const idx = await get<CachedSongIndex>(indexKey(songId));
        return !!idx;
    } catch (e) {
        console.error('Failed to check if song is cached:', e);
        return false;
    }
}

// Retrieve cached song data and convert blobs back to File objects.
// Lê o formato novo (por stem) e o antigo (registro único). Se qualquer stem
// estiver faltando/vazio, limpa o cache corrompido e retorna null (a UI volta a
// tratar a música como NÃO baixada, em vez de abrir um repertório vazio).
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
        const data = await get<CachedSongIndex | LegacyCachedSongData>(indexKey(songId));
        if (!data) return null;

        let files: File[];

        if ('files' in data && Array.isArray(data.files)) {
            // Formato antigo: blobs embutidos no registro único.
            files = data.files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
        } else if ('stemNames' in data && Array.isArray(data.stemNames)) {
            // Formato novo: 1 chave por stem.
            const out: File[] = [];
            for (let i = 0; i < data.stemNames.length; i++) {
                const blob = await get<Blob>(stemKey(songId, i));
                if (!blob || blob.size === 0) {
                    await removeCachedSong(songId).catch(() => { /* noop */ });
                    console.error(`Cache de ${songId} corrompido (stem ${i} ausente); limpo.`);
                    return null;
                }
                out.push(new File([blob], data.stemNames[i], { type: blob.type }));
            }
            files = out;
        } else {
            return null;
        }

        if (files.length === 0) {
            await removeCachedSong(songId).catch(() => { /* noop */ });
            return null;
        }

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

// Get all cached song IDs (só índices; exclui as chaves de stem).
export async function getCachedSongIds(): Promise<Set<string>> {
    try {
        const allKeys = await keys();
        const songKeys = allKeys.filter(
            (k): k is string =>
                typeof k === 'string' &&
                k.startsWith(SONG_CACHE_PREFIX) &&
                !k.includes(':stem:')
        );
        const ids = songKeys.map((k) => k.substring(SONG_CACHE_PREFIX.length));
        return new Set(ids);
    } catch (e) {
        console.error('Failed to list cached song IDs:', e);
        return new Set();
    }
}
