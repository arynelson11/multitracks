import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

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
    const { data, error } = await supabase
        .from('songs')
        .select('*')
        .order('name', { ascending: true });

    if (error) { console.error('Error fetching songs:', error); return []; }
    return data || [];
}

// Search songs by name, artist, or key
export async function searchSongs(query: string): Promise<CloudSong[]> {
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
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}
