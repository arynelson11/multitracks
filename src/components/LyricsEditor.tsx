import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import type { Song } from '../types';
import { searchLyrics } from '../lib/supabase';
import type { LyricsData, LyricsSaveResult } from '../lib/lyricsSave';
import { Button, Notice, TabPanel, Tabs, TextArea, TextField } from './ui';
import { StageDialog } from './stage/StageDialog';

type EditorTab = 'lyrics' | 'chords';
const TABS: { value: EditorTab; label: string }[] = [{ value: 'lyrics', label: 'Letra' }, { value: 'chords', label: 'Cifra' }];

interface LyricsEditorProps {
  // A música ativa quando o editor abriu. O editor guarda essa música (a id, o nome e a duração da
  // busca) e grava sempre nela, mesmo que a música ativa mude com ele aberto (manutenção 2026-11-27).
  song: Song;
  // A música do editor ainda está no repertório? Fora dele, o Salvar desliga e a janela avisa.
  songInPlaylist?: boolean;
  // Persiste na música da id: atualiza o estado local e tenta salvar na nuvem. true: salvou na
  // nuvem; false: só no aparelho; 'missing': a música saiu do repertório e nada foi gravado.
  onSave: (songId: string, data: LyricsData) => Promise<LyricsSaveResult>;
  onClose: () => void;
}

const MISSING_TEXT = 'Esta música saiu do repertório, então a letra e a cifra não podem ser salvas nela. O texto continua aqui pra você copiar.';

export function LyricsEditor({ song: songProp, songInPlaylist = true, onSave, onClose }: LyricsEditorProps) {
  // A música de quando abriu: a prop pode passar a ser a nova música ativa, o editor não segue.
  const [song] = useState(songProp);
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
  // O App disse, na hora de gravar, que a música tinha saído do repertório.
  const [missingOnSave, setMissingOnSave] = useState(false);
  const missing = !songInPlaylist || missingOnSave;
  // O último texto salvo (o da música, até o primeiro Salvar que deu certo). Com alteração, o Esc e
  // o toque fora não fecham (só o X), pra não jogar fora a letra e a cifra digitadas.
  const [saved, setSaved] = useState({ lyrics: song.lyrics || '', lyricsSynced: song.lyricsSynced || null, chords: song.chords || '' });
  const dirty = lyrics !== saved.lyrics || chords !== saved.chords || lyricsSynced !== saved.lyricsSynced;

  // O foco nos botões que desligam (revisão das telas, I1 na letra): no Chromium o botão focado que
  // desliga (Salvar salvando ou com a música fora do repertório, Buscar letra buscando) perde o foco
  // pro body, e aí o Tab sai pra trás da janela e as teclas chegam ao palco antigo. O foco vai pra
  // janela enquanto o botão está desligado e volta pra ele no fim, se ele religar.
  const contentRef = useRef<HTMLDivElement>(null);
  const focusBack = useRef<'save' | 'search' | null>(null);
  const dialogEl = () => contentRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
  const buttonEl = (which: 'save' | 'search') => dialogEl()?.querySelector<HTMLButtonElement>(`[data-send="${which}"]`) ?? null;
  const holdFocus = (which: 'save' | 'search') => {
    const button = buttonEl(which);
    if (!button || document.activeElement !== button) return;
    focusBack.current = which;
    dialogEl()?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const which = focusBack.current;
    if (saving || searching || !which) return;
    focusBack.current = null;
    // Quem levou o foco pra outro lugar no meio (o campo do texto) fica onde está.
    const dialog = dialogEl();
    if (document.activeElement !== document.body && document.activeElement !== dialog) return;
    const button = buttonEl(which);
    if (button && !button.disabled) button.focus({ preventScroll: true });
    else dialog?.focus({ preventScroll: true });
  }, [saving, searching]);
  // A música saiu do repertório com o foco no Salvar: ele desliga e o foco vai pra janela.
  useEffect(() => {
    if (!missing) return;
    if (document.activeElement === buttonEl('save') || document.activeElement === document.body) dialogEl()?.focus({ preventScroll: true });
  }, [missing]);

  const handleSearch = async () => {
    setSearching(true);
    setSearchMsg(null);
    holdFocus('search');
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
    if (!songInPlaylist) return;
    setSaving(true);
    setSaveMsg(null);
    holdFocus('save');
    try {
      const cloud = await onSave(song.id, {
        lyrics: lyrics.trim() || null,
        lyricsSynced: lyricsSynced,
        chords: chords.trim() || null,
      });
      if (cloud === 'missing') { setMissingOnSave(true); return; }
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
            tone="primary" data-send="save"
            icon={saving ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Save size={16} />}
            disabled={saving || missing}
            onClick={handleSave}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div ref={contentRef} className="flex flex-col gap-4">
        <p className="text-ps-mut break-words">{song.name}</p>
        {missing && <Notice tone="alert" role="alert">{MISSING_TEXT}</Notice>}

        {/* Busca automática da letra pelo artista e pelo nome da música */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="Artista (para a busca)" value={artist} onChange={(e) => setArtist(e.target.value)}
              placeholder="Ex.: Aline Barros" className="min-w-48 flex-1"
            />
            <Button
              data-send="search"
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
