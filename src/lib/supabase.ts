import { createClient } from '@supabase/supabase-js';
import type { TimeSignatureType } from './AudioAnalyzer';
import { isMissingMeterColumn, withoutMeterColumns } from './cloudBpm';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Safe initialization to prevent crashing the whole app if env vars are missing
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

if (!supabase) {
    console.warn('Supabase credentials missing. Cloud Library and Admin Upload features will be disabled. Please check your .env file or Vercel environment variables.');
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!supabase) return headers;
    let session = (await supabase.auth.getSession()).data.session;
    // Renova o token se já expirou ou expira em menos de 60s, antes de usar.
    // Evita o 401 "Invalid or expired token" quando o app ficou aberto tempo
    // demais e o auto-refresh não disparou (comum no Electron com janela
    // inativa). Se o refresh falhar (refresh token morto), mantém o token atual
    // e o servidor responde 401 — aí o usuário precisa relogar mesmo.
    const expiresAtMs = (session?.expires_at ?? 0) * 1000;
    if (session && expiresAtMs < Date.now() + 60_000) {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.data.session) session = refreshed.data.session;
    }
    if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
    }
    return headers;
}

export interface CloudSong {
    id: string;
    name: string;
    artist: string;
    key: string;
    // Inteiro, lido pelos apps antigos. O BPM de verdade sai de preciseBpm (cloudBpm.ts).
    bpm: number;
    // Só existem depois de db/supabase-bpm-exact-migration.sql; antes vêm ausentes.
    bpm_exact?: number | null;
    time_signature?: TimeSignatureType | null;
    cover_url: string | null;
    markers: any[] | null;
    lyrics?: string | null;
    lyrics_synced?: string | null;
    chords?: string | null;
    created_at: string;
    user_id?: string;
    is_global?: boolean;
}

export interface LyricsResult {
    plain: string | null;
    synced: string | null; // LRC format ([mm:ss.xx] linha)
    source: string;
}

// Limpa o título da música pra melhorar a busca: remove extensão de arquivo,
// trechos entre parênteses/colchetes e termos comuns que poluem o match.
function cleanTrackTitle(raw: string): string {
    return raw
        .replace(/\.[a-z0-9]{2,4}$/i, '')                 // extensão (.mp3, .wav...)
        .replace(/^\s*\d{1,2}\s*[-.)]\s*/, '')             // número de faixa no início (01 - , 3. ...)
        .replace(/\([^)]*\)/g, ' ')                        // (Ao Vivo), (Cover)...
        .replace(/\[[^\]]*\]/g, ' ')                       // [Lyric Video]...
        .replace(/\b(playback|ao vivo|acústico|acustico|cover|lyric video|lyric|letra|clipe|oficial|official|audio|áudio|hd|4k|remix|versão|version|feat\.?|ft\.?)\b/gi, ' ')
        .replace(/[_]+/g, ' ')
        .replace(/\s*[-–|]\s*$/, '')                       // separador solto no fim
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function pickBest(arr: any[], artist: string): any | null {
    const withLyrics = arr.filter((x) => x.plainLyrics || x.syncedLyrics);
    if (withLyrics.length === 0) return null;
    const an = artist.trim().toLowerCase();
    if (an) {
        const byArtist = withLyrics.filter((x) => (x.artistName || '').toLowerCase().includes(an));
        if (byArtist.length) return byArtist.find((x) => x.syncedLyrics) || byArtist[0];
    }
    return withLyrics.find((x) => x.syncedLyrics) || withLyrics[0];
}

// Busca letra por nome (+ artista, se houver) em APIs abertas (sem chave).
// LRCLIB é a fonte principal (cobertura boa, inclui gospel BR e letra sincronizada);
// lyrics.ovh é fallback (só letra pura). Tolerante a título sem artista.
export async function searchLyrics(artist: string, title: string, durationSec?: number): Promise<LyricsResult | null> {
    const a = artist.trim();
    const t = cleanTrackTitle(title);
    if (!t) return null;

    // 1) LRCLIB /get — match exato por assinatura (só quando há artista + duração)
    if (a && durationSec && durationSec > 0) {
        try {
            const params = new URLSearchParams({ artist_name: a, track_name: t, duration: String(Math.round(durationSec)) });
            const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
            if (res.ok) {
                const d = await res.json();
                if (d && (d.plainLyrics || d.syncedLyrics)) {
                    return { plain: d.plainLyrics || null, synced: d.syncedLyrics || null, source: 'LRCLIB' };
                }
            }
        } catch (e) {
            console.warn('LRCLIB (get) falhou:', e);
        }
    }

    // 2) LRCLIB /search?q= — busca livre, tolerante (funciona mesmo sem artista)
    try {
        const q = [a, t].filter(Boolean).join(' ');
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
            const arr = await res.json();
            if (Array.isArray(arr)) {
                const best = pickBest(arr, a);
                if (best) return { plain: best.plainLyrics || null, synced: best.syncedLyrics || null, source: 'LRCLIB' };
            }
        }
    } catch (e) {
        console.warn('LRCLIB (search) falhou:', e);
    }

    // 3) Fallback lyrics.ovh — só letra pura (exige artista)
    if (a) {
        try {
            const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`);
            if (res.ok) {
                const d = await res.json();
                if (d?.lyrics) return { plain: String(d.lyrics).trim(), synced: null, source: 'lyrics.ovh' };
            }
        } catch (e) {
            console.warn('lyrics.ovh falhou:', e);
        }
    }

    return null;
}

export interface CloudStem {
    id: string;
    song_id: string;
    name: string;
    file_url: string;
    order: number;
}

export interface CloudPadSet {
    id: string;
    name: string;
    description: string | null;
    base_path: string;
    created_at: string;
}

export async function fetchPadSets(): Promise<CloudPadSet[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('pad_sets')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { console.error('Error fetching pad sets:', error); return []; }
    return data || [];
}

export async function insertPadSet(padSet: Omit<CloudPadSet, 'id' | 'created_at'>): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('pad_sets')
        .insert(padSet)
        .select('id')
        .single();
    if (error) { console.error('Error inserting pad set:', error); return null; }
    return data?.id || null;
}

// Fetch all songs
export async function fetchSongs(): Promise<CloudSong[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('songs')
        .select('*')
        .order('name', { ascending: true });

    if (error) { console.error('Error fetching songs:', error); return []; }
    return data || [];
}

// Search songs by name, artista, or tom
export async function searchSongs(query: string): Promise<CloudSong[]> {
    if (!supabase) return [];
    const q = query.trim().toLowerCase();
    if (!q) return fetchSongs();

    const { data, error } = await supabase
        .from('songs')
        .select('*')
        .or(`name.ilike.%${q}%,artist.ilike.%${q}%,key.ilike.%${q}%`)
        .order('name', { ascending: true });

    if (error) { console.error('Error searching songs:', error); return []; }
    return data || [];
}

// Fetch stems for a song
export async function fetchStems(songId: string): Promise<CloudStem[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('stems')
        .select('*')
        .eq('song_id', songId)
        .order('order', { ascending: true });

    if (error) { console.error('Error fetching stems:', error); return []; }
    return data || [];
}

// Download a file from URL, track bytes downloaded, and return as File object
export async function downloadFileAsBlobWithProgress(
    url: string,
    filename: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal
): Promise<File | null> {
    try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body?.getReader();
        if (!reader) {
            // Fallback if ReadableStream is not supported
            const blob = await response.blob();
            if (onProgress) onProgress(blob.size, blob.size);
            return new File([blob], filename, { type: blob.type });
        }

        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                loaded += value.length;
                if (onProgress) onProgress(loaded, total);
            }
        }

        // Unify chunks into a single ArrayBuffer to prevent IndexedDB serialization silently failing
        // on some browsers with Blobs built from numerous Uint8Array memory slices.
        const unified = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
            unified.set(chunk, offset);
            offset += chunk.length;
        }

        const blob = new Blob([unified.buffer], { type: response.headers.get('content-type') || 'audio/wav' });
        return new File([blob], filename, { type: blob.type });
    } catch (e) {
        console.error('Error downloading file:', e);
        return null;
    }
}

// Get public URL for a storage path
export function getStorageUrl(bucket: string, path: string): string {
    if (!supabase) return '';
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}

// Admin: Upload a file to storage
export async function uploadFile(bucket: string, path: string, file: File): Promise<{ url: string | null; error: string | null }> {
    if (!supabase) return { url: null, error: 'Supabase não inicializado' };
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
        upsert: true
    });

    if (error) {
        console.error(`Error uploading to ${bucket}:`, error);
        return { url: null, error: error.message };
    }
    return { url: getStorageUrl(bucket, data.path), error: null };
}

// Banco sem db/supabase-bpm-exact-migration.sql: grava o resto (o bpm inteiro
// incluso) e avisa. O BPM decimal e o compasso só sobem depois da migration.
function warnMissingMeterColumns() {
    console.warn('[songs] Colunas bpm_exact/time_signature ainda não existem no banco (rodar db/supabase-bpm-exact-migration.sql). Gravando sem elas.');
}

// Admin: Insert song metadata
export async function insertSong(song: Omit<CloudSong, 'id' | 'created_at' | 'markers'>): Promise<string | null> {
    if (!supabase) throw new Error('Supabase não inicializado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
    const db = supabase;
    const insert = (row: object) => db.from('songs').insert(row).select('id').single();
    let result = await insert(song);
    if (result.error && isMissingMeterColumn(result.error)) {
        warnMissingMeterColumns();
        result = await insert(withoutMeterColumns(song));
    }
    const { data, error } = result;

    if (error) {
        console.error('Error inserting song:', error);
        throw new Error(`Supabase (songs): ${error.message}`);
    }
    return data?.id || null;
}

// Admin: Update song metadata
export async function updateSong(songId: string, updates: Partial<Omit<CloudSong, 'id' | 'created_at'>>): Promise<boolean> {
    if (!supabase) return false;
    const db = supabase;
    const update = (row: object) => db.from('songs').update(row).eq('id', songId);
    let { error } = await update(updates);
    if (error && isMissingMeterColumn(error)) {
        warnMissingMeterColumns();
        const rest = withoutMeterColumns(updates);
        // Só havia coluna nova pra gravar: nada foi salvo, não finge sucesso.
        if (Object.keys(rest).length === 0) return false;
        ({ error } = await update(rest));
    }

    if (error) {
        console.error('Error updating song:', error);
        return false;
    }
    return true;
}

// Admin: Insert multiple stems
export async function insertStems(stems: Omit<CloudStem, 'id'>[]): Promise<boolean> {
    if (!supabase) throw new Error('Supabase não inicializado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
    const { error } = await supabase
        .from('stems')
        .insert(stems);

    if (error) {
        console.error('Error inserting stems:', error);
        throw new Error(`Supabase (stems): ${error.message}`);
    }
    return true;
}
// Delete a song and all its stems from DB
export async function deleteSongFromCloud(songId: string): Promise<boolean> {
    if (!supabase) return false;

    // Deleting stems exactly
    const { error: stemsError } = await supabase
        .from('stems')
        .delete()
        .eq('song_id', songId);

    if (stemsError) {
        console.error('Error deleting stems:', stemsError);
        return false;
    }

    // Now parent song
    const { error: songError } = await supabase
        .from('songs')
        .delete()
        .eq('id', songId);

    if (songError) {
        console.error('Error deleting song:', songError);
        return false;
    }

    return true;
}

// Fetch markers for a song
export async function fetchSongMarkers(songId: string): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('songs')
        .select('markers')
        .eq('id', songId)
        .single();
    if (error) { console.error('Error fetching markers:', error); return []; }
    return data?.markers || [];
}

// Update markers for a song
export async function updateSongMarkers(songId: string, markers: any[]): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
        .from('songs')
        .update({ markers })
        .eq('id', songId);
    if (error) {
        console.error('Error updating markers:', error);
        return false;
    }
    return true;
}
