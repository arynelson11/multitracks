import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Safe initialization to prevent crashing the whole app if env vars are missing
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
        },
    })
    : null;

if (!supabase) {
    console.warn('Supabase credentials missing. Cloud Library and Admin Upload features will be disabled. Please check your .env file or Vercel environment variables.');
}

export interface CloudSong {
    id: string;
    name: string;
    artist: string;
    key: string;
    bpm: number;
    cover_url: string | null;
    markers: any[] | null;
    created_at: string;
    user_id?: string;
    is_global?: boolean;
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
    onProgress?: (loaded: number, total: number) => void
): Promise<File | null> {
    try {
        const response = await fetch(url);
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

// Admin: Insert song metadata
export async function insertSong(song: Omit<CloudSong, 'id' | 'created_at' | 'markers'>): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('songs')
        .insert(song)
        .select('id')
        .single();

    if (error) {
        console.error('Error inserting song:', error);
        return null;
    }
    return data?.id || null;
}

// Admin: Update song metadata
export async function updateSong(songId: string, updates: Partial<Omit<CloudSong, 'id' | 'created_at'>>): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
        .from('songs')
        .update(updates)
        .eq('id', songId);

    if (error) {
        console.error('Error updating song:', error);
        return false;
    }
    return true;
}

// Admin: Insert multiple stems
export async function insertStems(stems: Omit<CloudStem, 'id'>[]): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
        .from('stems')
        .insert(stems);

    if (error) {
        console.error('Error inserting stems:', error);
        return false;
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
