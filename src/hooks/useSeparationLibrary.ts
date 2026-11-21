import { useState, useEffect, useCallback, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { planTier } from '../lib/plans';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SavedStem {
  id: string;
  name: string;
  url: string;
  color: string;
  // Estado do mixer persistido junto (jsonb aceita campos extras, sem migração).
  state?: { muted: boolean; soloed: boolean; volume: number; pan: number };
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
const MIGRATED_KEY = 'sep__migrated_to_cloud_for_user';
const MAX_SAVED    = 50;

// ─── Row mapping (Supabase row ↔ SavedSeparation) ─────────────────────────

interface SeparationRow {
  id: string;
  user_id: string;
  song_name: string;
  artist: string | null;
  bpm: string | null;
  song_key: string | null;
  stems: SavedStem[] | null;
  voice_cues: SavedVoiceCue[] | null;
  created_at: string;
}

function rowToSeparation(row: SeparationRow): SavedSeparation {
  return {
    id: row.id,
    songName: row.song_name,
    artist: row.artist ?? '',
    bpm: row.bpm ?? '120',
    songKey: row.song_key ?? 'C',
    stems: Array.isArray(row.stems) ? row.stems : [],
    voiceCues: Array.isArray(row.voice_cues) ? row.voice_cues : [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

function separationToRow(sep: SavedSeparation, userId: string) {
  return {
    id: sep.id,
    user_id: userId,
    song_name: sep.songName,
    artist: sep.artist,
    bpm: sep.bpm,
    song_key: sep.songKey,
    stems: sep.stems,
    voice_cues: sep.voiceCues,
    created_at: new Date(sep.createdAt).toISOString(),
  };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

// `loadList: false` (Parte 3, o App): só ler e gravar uma separação pelo id, sem buscar a lista
// inteira ao abrir o app (o palco lê a separação da música atual quando precisa).
export function useSeparationLibrary(opts: { loadList?: boolean } = {}) {
  const loadList = opts.loadList ?? true;
  const { user, userPlan, isAdmin } = useAuth();
  const userId = user?.id ?? null;
  // Biblioteca em nuvem é recurso pago. O Livre usa só o local (IndexedDB).
  // A trava real está na RLS de user_separations; aqui roteamos o Livre pro local
  // para ele NÃO perder a biblioteca quando o insert na nuvem for negado pela RLS.
  const hasCloud = isAdmin || planTier(userPlan) !== 'free';
  const useCloud = !!(userId && supabase && hasCloud);

  const [separations, setSeparations] = useState<SavedSeparation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const migrationRanFor = useRef<string | null>(null);

  const loadFromCloud = useCallback(async (uid: string): Promise<SavedSeparation[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('user_separations')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SepLib] Failed to fetch from Supabase:', error.message);
      return [];
    }
    return (data as SeparationRow[] | null ?? []).map(rowToSeparation);
  }, []);

  const loadFromLocal = useCallback(async (): Promise<SavedSeparation[]> => {
    try {
      const index: SavedSeparation[] | undefined = await get(INDEX_KEY);
      if (index && Array.isArray(index)) {
        return [...index].sort((a, b) => b.createdAt - a.createdAt);
      }
    } catch (e) {
      console.error('[SepLib] Failed to load IDB:', e);
    }
    return [];
  }, []);

  // One-shot: empurra qualquer separação local pra cloud (idempotente via ON CONFLICT no PK)
  const migrateLocalToCloud = useCallback(async (uid: string): Promise<void> => {
    if (!supabase) return;
    const flagKey = `${MIGRATED_KEY}:${uid}`;
    try {
      const already = await get<string>(flagKey);
      if (already) return;
      const local = await loadFromLocal();
      if (local.length === 0) {
        await set(flagKey, '1');
        return;
      }
      const rows = local.map(s => separationToRow(s, uid));
      const { error } = await supabase.from('user_separations').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.warn('[SepLib] Local → cloud migration failed, retrying next load:', error.message);
        return; // não marca flag, tenta de novo na próxima
      }
      await set(flagKey, '1');
      console.log(`[SepLib] Migrated ${rows.length} local separations to cloud.`);
    } catch (e) {
      console.error('[SepLib] Migration error:', e);
    }
  }, [loadFromLocal]);

  const refreshLibrary = useCallback(async () => {
    setIsLoading(true);
    try {
      if (useCloud && userId) {
        if (migrationRanFor.current !== userId) {
          await migrateLocalToCloud(userId);
          migrationRanFor.current = userId;
        }
        const cloud = await loadFromCloud(userId);
        setSeparations(cloud);
      } else {
        setSeparations(await loadFromLocal());
      }
    } finally {
      setIsLoading(false);
    }
  }, [useCloud, userId, loadFromCloud, loadFromLocal, migrateLocalToCloud]);

  useEffect(() => {
    if (loadList) refreshLibrary();
  }, [refreshLibrary, loadList]);

  // A data da separação nunca muda ao gravar de novo: no Livre ela decide se a separação é do mês
  // (abre de graça) ou de um mês anterior (conta nas 3). Quem grava passa a data que tem
  // (`createdAt`); sem ela vale a da lista desta instância e, só pra separação que não está na
  // lista, agora. A lista sozinha não basta: ela troca quando o plano muda (nuvem e aparelho).
  const saveSeparation = useCallback(async (
    data: Omit<SavedSeparation, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): Promise<string | null> => {
    const id = data.id || `sep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const given = typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : undefined;
    const entry: SavedSeparation = {
      id,
      songName: data.songName,
      artist: data.artist,
      bpm: data.bpm,
      songKey: data.songKey,
      stems: data.stems,
      voiceCues: data.voiceCues,
      createdAt: given
        ?? (data.id ? separations.find(s => s.id === data.id)?.createdAt : undefined)
        ?? Date.now(),
    };

    if (useCloud && userId && supabase) {
      try {
        const { error } = await supabase
          .from('user_separations')
          .upsert(separationToRow(entry, userId), { onConflict: 'id' });
        if (error) throw error;
        setSeparations(prev => {
          const without = prev.filter(s => s.id !== id);
          return [entry, ...without].sort((a, b) => b.createdAt - a.createdAt);
        });
        return id;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[SepLib] Cloud save failed:', msg);
        return null;
      }
    }

    // Fallback IDB
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];
      const filtered = existing.filter(s => s.id !== id);
      let newIndex = [entry, ...filtered].sort((a, b) => b.createdAt - a.createdAt);
      if (newIndex.length > MAX_SAVED) newIndex = newIndex.slice(0, MAX_SAVED);
      await set(INDEX_KEY, newIndex);
      setSeparations(newIndex);
      return id;
    } catch (e) {
      console.error('[SepLib] Local save failed:', e);
      return null;
    }
  }, [useCloud, userId, separations]);

  const deleteSeparation = useCallback(async (id: string): Promise<void> => {
    if (useCloud && userId && supabase) {
      const { error } = await supabase
        .from('user_separations')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) {
        console.error('[SepLib] Cloud delete failed:', error.message);
        return;
      }
      setSeparations(prev => prev.filter(s => s.id !== id));
      return;
    }
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];
      const filtered = existing.filter(s => s.id !== id);
      await set(INDEX_KEY, filtered);
      setSeparations(filtered);
    } catch (e) {
      console.error('[SepLib] Local delete failed:', e);
    }
  }, [useCloud, userId]);

  const getSeparation = useCallback(async (id: string): Promise<SavedSeparation | null> => {
    if (useCloud && userId && supabase) {
      const client = supabase;
      const fetchOne = () => client
        .from('user_separations')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      let { data, error } = await fetchOne();
      // Não achou na nuvem: quem acabou de virar pago ainda tem as separações só no aparelho, e a
      // migração só rodava com a lista (o palco lê sem ela). Migra uma vez e lê de novo (sep-1 M7).
      if (!error && !data && migrationRanFor.current !== userId) {
        await migrateLocalToCloud(userId);
        migrationRanFor.current = userId;
        ({ data, error } = await fetchOne());
      }
      if (error) {
        console.error('[SepLib] Cloud get failed:', error.message);
        return null;
      }
      return data ? rowToSeparation(data as SeparationRow) : null;
    }
    try {
      const existing: SavedSeparation[] = (await get(INDEX_KEY)) || [];
      return existing.find(s => s.id === id) || null;
    } catch (e) {
      console.error('[SepLib] Local get failed:', e);
      return null;
    }
  }, [useCloud, userId, migrateLocalToCloud]);

  return {
    separations,
    isLoading,
    saveSeparation,
    deleteSeparation,
    getSeparation,
    refreshLibrary,
  };
}
