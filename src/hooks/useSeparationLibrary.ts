import { useState, useEffect, useCallback } from 'react';
import { get, set } from 'idb-keyval';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SavedStem {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface SavedVoiceCue {
  id: string;
  time: number;
  label: string;
  file: string;
}

export interface SavedSeparation {
  id: string;
  songName: string;
  artist: string;
  bpm: string;
  songKey: string;
  stems: SavedStem[];
  voiceCues: SavedVoiceCue[];
  createdAt: number; // Date.now()
}

// ─── Constants ─────────────────────────────────────────────────────────────

const INDEX_KEY    = 'sep__index';
const MAX_SAVED    = 50;

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSeparationLibrary() {
  const [separations, setSeparations] = useState<SavedSeparation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load index on mount
  useEffect(() => {
    loadIndex();
  }, []);

  const loadIndex = async () => {
    setIsLoading(true);
    try {
      const index: SavedSeparation[] | undefined = await get(INDEX_KEY);
      if (index && Array.isArray(index)) {
        // Sort newest first
        setSeparations(index.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (e) {
      console.error('[SepLib] Failed to load index:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const persistIndex = async (newIndex: SavedSeparation[]) => {
    const sorted = [...newIndex].sort((a, b) => b.createdAt - a.createdAt);
    setSeparations(sorted);
    await set(INDEX_KEY, sorted);
  };

  // Save or update a separation
  const saveSeparation = useCallback(async (data: Omit<SavedSeparation, 'id' | 'createdAt'> & { id?: string }) => {
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];

      // If updating an existing one
      if (data.id) {
        const updated = existing.map(s =>
          s.id === data.id ? { ...s, ...data, id: s.id } : s
        );
        await persistIndex(updated);
        return data.id;
      }

      // New separation
      const id = `sep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry: SavedSeparation = {
        id,
        songName: data.songName,
        artist: data.artist,
        bpm: data.bpm,
        songKey: data.songKey,
        stems: data.stems,
        voiceCues: data.voiceCues,
        createdAt: Date.now(),
      };

      let newIndex = [entry, ...existing];

      // Enforce max limit — remove oldest entries
      if (newIndex.length > MAX_SAVED) {
        newIndex = newIndex
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, MAX_SAVED);
      }

      await persistIndex(newIndex);
      return id;
    } catch (e) {
      console.error('[SepLib] Failed to save separation:', e);
      return null;
    }
  }, []);

  // Delete a separation
  const deleteSeparation = useCallback(async (id: string) => {
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];
      const filtered = existing.filter(s => s.id !== id);
      await persistIndex(filtered);
    } catch (e) {
      console.error('[SepLib] Failed to delete separation:', e);
    }
  }, []);

  // Get a separation by id
  const getSeparation = useCallback(async (id: string): Promise<SavedSeparation | null> => {
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];
      return existing.find(s => s.id === id) || null;
    } catch (e) {
      console.error('[SepLib] Failed to get separation:', e);
      return null;
    }
  }, []);

  return {
    separations,
    isLoading,
    saveSeparation,
    deleteSeparation,
    getSeparation,
    refreshLibrary: loadIndex,
  };
}
