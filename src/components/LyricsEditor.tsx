import { useState } from 'react';
import { X, Loader2, FileText, Music2, Save, Sparkles } from 'lucide-react';
import type { Song } from '../types';
import { searchLyrics } from '../lib/supabase';

interface LyricsEditorProps {
  song: Song;
  // Persiste: atualiza estado local sempre e tenta salvar na nuvem.
  // Retorna true se conseguiu salvar na nuvem.
  onSave: (data: { lyrics: string | null; lyricsSynced: string | null; chords: string | null }) => Promise<boolean>;
  onClose: () => void;
}

export function LyricsEditor({ song, onSave, onClose }: LyricsEditorProps) {
  const [artist, setArtist] = useState(song.artist || '');
  const [lyrics, setLyrics] = useState(song.lyrics || '');
  const [lyricsSynced, setLyricsSynced] = useState<string | null>(song.lyricsSynced || null);
  const [chords, setChords] = useState(song.chords || '');
  const [tab, setTab] = useState<'lyrics' | 'chords'>('lyrics');

  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const handleSearch = async () => {
    setSearching(true);
    setSearchMsg(null);
    try {
      const result = await searchLyrics(artist, song.name, song.duration);
      if (result && (result.plain || result.synced)) {
        if (result.plain) setLyrics(result.plain);
        setLyricsSynced(result.synced);
        setSearchMsg(`Letra encontrada via ${result.source}${result.synced ? ' (sincronizada ✓)' : ''}.`);
      } else {
        setSearchMsg('Nenhuma letra encontrada. Confira o nome/artista ou cole manualmente.');
      }
    } catch {
      setSearchMsg('Falha na busca. Verifique a conexão ou cole manualmente.');
    } finally {
      setSearching(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const cloud = await onSave({
        lyrics: lyrics.trim() || null,
        lyricsSynced: lyricsSynced,
        chords: chords.trim() || null,
      });
      setSaveMsg(cloud ? 'Salvo na nuvem ☁️ e localmente.' : 'Salvo localmente (música não está na biblioteca da nuvem).');
    } catch {
      setSaveMsg('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#141416] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="text-white font-black text-sm uppercase tracking-wider flex items-center gap-2">
              <FileText size={16} className="text-primary" /> Letra & Cifra
            </h2>
            <p className="text-[10px] text-text-muted font-mono truncate mt-0.5">{song.name}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white cursor-pointer p-1"><X size={18} /></button>
        </div>

        {/* Busca automática de letra */}
        <div className="px-5 py-4 border-b border-white/10 space-y-2">
          <label className="text-[10px] text-text-muted uppercase tracking-widest font-semibold">Artista (para a busca)</label>
          <div className="flex gap-2">
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Ex: Aline Barros"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary/50 outline-none"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="shrink-0 bg-primary/20 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/30 cursor-pointer active:scale-95 transition-all border border-primary/30 flex items-center gap-2 disabled:opacity-50"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Buscar letra
            </button>
          </div>
          {searchMsg && <p className="text-[11px] text-text-muted">{searchMsg}</p>}
        </div>

        {/* Tabs Letra / Cifra */}
        <div className="flex border-b border-white/10 px-5">
          <button
            onClick={() => setTab('lyrics')}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${tab === 'lyrics' ? 'text-primary border-primary' : 'text-text-muted border-transparent hover:text-white'}`}
          >
            <FileText size={13} /> Letra
          </button>
          <button
            onClick={() => setTab('chords')}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${tab === 'chords' ? 'text-secondary border-secondary' : 'text-text-muted border-transparent hover:text-white'}`}
          >
            <Music2 size={13} /> Cifra
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'lyrics' ? (
            <div className="space-y-2">
              {lyricsSynced && (
                <p className="text-[10px] text-emerald-400/80 font-mono flex items-center gap-1.5">
                  <Sparkles size={11} /> Versão sincronizada disponível — habilitará o auto-scroll no palco.
                </p>
              )}
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="A letra aparece aqui após a busca, ou cole/edite manualmente..."
                className="w-full h-72 bg-black/40 border border-white/10 rounded-lg px-3 py-3 text-sm text-white/90 leading-relaxed placeholder:text-text-muted focus:border-primary/50 outline-none resize-none font-sans"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-text-muted">
                Cole a cifra (acordes sobre a letra). Dica: copie do CifraClub e cole aqui — a formatação de espaços é preservada.
              </p>
              <textarea
                value={chords}
                onChange={(e) => setChords(e.target.value)}
                placeholder={'E              B\nGrande é o Senhor\nC#m       A\ne mui digno de louvor'}
                className="w-full h-72 bg-black/40 border border-white/10 rounded-lg px-3 py-3 text-sm text-white/90 leading-relaxed placeholder:text-text-muted focus:border-secondary/50 outline-none resize-none font-mono whitespace-pre"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-muted truncate">{saveMsg}</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="shrink-0 bg-primary text-black px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider hover:bg-primary/90 cursor-pointer active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
