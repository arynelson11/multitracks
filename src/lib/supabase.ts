import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Safe initialization to prevent crashing the whole app if env vars are missing
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
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
    created_at: string;
}

export interface CloudStem {
    id: string;
    song_id: string;
    name: string;
    file_url: string;
    order: number;
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

// Search songs by name, artist, or key
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

// Download a file from URL and return as File object
export async function downloadFileAsBlob(url: string, filename: string): Promise<File | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
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
export async function insertSong(song: Omit<CloudSong, 'id' | 'created_at'>): Promise<string | null> {
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
