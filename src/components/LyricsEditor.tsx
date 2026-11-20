import { useId, useState } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import type { Song } from '../types';
import { searchLyrics } from '../lib/supabase';
import { Button, Notice, TabPanel, Tabs, TextArea, TextField } from './ui';
import { StageDialog } from './stage/StageDialog';

type EditorTab = 'lyrics' | 'chords';
const TABS: { value: EditorTab; label: string }[] = [{ value: 'lyrics', label: 'Letra' }, { value: 'chords', label: 'Cifra' }];

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
  const [tab, setTab] = useState<EditorTab>('lyrics');
  const tabsId = useId();

  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // O último texto salvo (o da música, até o primeiro Salvar que deu certo). Com alteração, o Esc e
  // o toque fora não fecham (só o X), pra não jogar fora a letra e a cifra digitadas.
  const [saved, setSaved] = useState({ lyrics: song.lyrics || '', lyricsSynced: song.lyricsSynced || null, chords: song.chords || '' });
  const dirty = lyrics !== saved.lyrics || chords !== saved.chords || lyricsSynced !== saved.lyricsSynced;

  const handleSearch = async () => {
    setSearching(true);
    setSearchMsg(null);
    try {
      const result = await searchLyrics(artist, song.name, song.duration);
      if (result && (result.plain || result.synced)) {
        if (result.plain) setLyrics(result.plain);
        setLyricsSynced(result.synced);
        setSearchMsg(`Letra encontrada via ${result.source}${result.synced ? ' (sincronizada)' : ''}.`);
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
      setSaved({ lyrics, lyricsSynced, chords });
      setSaveMsg(cloud ? 'Salvo na nuvem e no aparelho.' : 'Salvo só no aparelho (a música não está na biblioteca da nuvem).');
    } catch {
      setSaveMsg('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <StageDialog
      open
      title="Letra e cifra"
      size="lg"
      onClose={onClose}
      dismissible={!dirty}
      footer={
        <>
          {saveMsg && <p role="status" className="mr-auto self-center text-ps-sm text-ps-mut break-words">{saveMsg}</p>}
          <Button
            tone="primary"
            icon={saving ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Save size={16} />}
            disabled={saving}
            onClick={handleSave}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ps-mut break-words">{song.name}</p>

        {/* Busca automática da letra pelo artista e pelo nome da música */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="Artista (para a busca)" value={artist} onChange={(e) => setArtist(e.target.value)}
              placeholder="Ex.: Aline Barros" className="min-w-48 flex-1"
            />
            <Button
              icon={searching ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Sparkles size={16} />}
              disabled={searching}
              onClick={handleSearch}
            >
              Buscar letra
            </Button>
          </div>
          {searchMsg && <Notice role="status">{searchMsg}</Notice>}
        </div>

        <div className="flex flex-col gap-3">
          <Tabs id={tabsId} aria-label="Letra ou cifra" tabs={TABS} value={tab} onChange={setTab} />
          <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-2">
            {tab === 'lyrics' ? (
              <>
                {lyricsSynced && (
                  <p className="flex items-center gap-1.5 text-ps-sm text-ps-mut">
                    <Sparkles size={14} aria-hidden="true" className="shrink-0" />
                    Versão sincronizada disponível: a letra rola sozinha no palco.
                  </p>
                )}
                <TextArea
                  label="Letra" hideLabel rows={12} value={lyrics} onChange={(e) => setLyrics(e.target.value)}
                  placeholder="A letra aparece aqui depois da busca, ou cole e edite aqui."
                />
              </>
            ) : (
              <>
                <p className="text-ps-sm text-ps-mut">
                  Cole a cifra (acordes em cima da letra). Dica: copie do Cifra Club e cole aqui, os espaços ficam como estão.
                </p>
                <TextArea
                  label="Cifra" hideLabel rows={12} value={chords} onChange={(e) => setChords(e.target.value)} wrap="off"
                  placeholder={'E              B\nGrande é o Senhor\nC#m       A\ne mui digno de louvor'}
                  textareaClassName="whitespace-pre" style={{ fontFamily: 'var(--font-ps-mono)' }}
                />
              </>
            )}
          </TabPanel>
        </div>
      </div>
    </StageDialog>
  );
}
