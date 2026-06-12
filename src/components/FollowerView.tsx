import { useState, useMemo, useRef, useEffect } from 'react';
import { Wifi, WifiOff, FastForward, Music, FileText, Music2, Eye, EyeOff, Play, Pause, SkipBack, SkipForward, ListMusic, X, Check, SlidersHorizontal, LayoutGrid, Plus, Minus } from 'lucide-react';
import type { FollowerState } from '../hooks/useLiveSync';

interface SyncedLine { time: number; text: string }

const LRC_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

// Parseia letra sincronizada no formato LRC ([mm:ss.xx] texto) em linhas com tempo.
// Suporta múltiplos timestamps por linha; ignora tags de cabeçalho ([ar:], [ti:]...).
function parseLRC(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(LRC_TAG)];
    if (stamps.length === 0) continue;
    const text = raw.replace(LRC_TAG, '').trim();
    for (const m of stamps) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
      out.push({ time: min * 60 + sec + frac, text });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

interface FollowerViewProps {
  state: FollowerState;
  isConnected: boolean;
  sendCommand: (action: string, extra?: { index?: number; id?: string; value?: number }) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_SEMITONE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

// Tom real = nota original transposta por `pitch` semitons (ex: E +2 -> F#).
// Se o tom original for desconhecido, cai no deslocamento em semitons.
function displayKey(originalKey: string | null, pitch: number): string {
  if (originalKey && KEY_SEMITONE[originalKey] !== undefined) {
    return KEYS[((KEY_SEMITONE[originalKey] + pitch) % 12 + 12) % 12];
  }
  if (pitch === 0) return '—';
  return pitch > 0 ? `+${pitch}` : `${pitch}`;
}

function pitchDelta(pitch: number): string | null {
  if (pitch === 0) return null;
  return pitch > 0 ? `+${pitch}` : `${pitch}`;
}

export function FollowerView({ state, isConnected, sendCommand }: FollowerViewProps) {
  const sectionColor = state.currentMarker?.color || '#6366f1';

  const hasLyrics = !!state.lyrics?.trim();
  const hasChords = !!state.chords?.trim();
  const [view, setView] = useState<'lyrics' | 'chords'>('lyrics');
  // Preferência individual do músico: pode ocultar a letra/cifra na própria tela.
  const [showContent, setShowContent] = useState(true);
  const [showSetlist, setShowSetlist] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [showPads, setShowPads] = useState(false);
  const PAD_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Se a aba escolhida não tiver conteúdo, mostra a que tiver.
  const effective = view === 'chords' ? (hasChords ? 'chords' : 'lyrics') : (hasLyrics ? 'lyrics' : 'chords');
  const content = effective === 'chords' ? state.chords : state.lyrics;
  const hasAny = hasLyrics || hasChords;

  // Auto-scroll sincronizado: só na aba Letra e quando há LRC com timestamps.
  const synced = useMemo(() => (state.lyricsSynced ? parseLRC(state.lyricsSynced) : []), [state.lyricsSynced]);
  const useSynced = effective === 'lyrics' && synced.length > 0;
  let activeIndex = -1;
  if (useSynced) {
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= state.currentTime + 0.15) activeIndex = i;
      else break;
    }
  }
  const activeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (useSynced && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIndex, useSynced]);

  return (
    <div className="h-[100dvh] bg-zinc-950 text-white flex flex-col font-sans relative overflow-hidden">
      {/* Glow sutil com a cor da seção atual */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30 transition-colors duration-700"
        style={{ background: `radial-gradient(60% 50% at 50% 0%, ${sectionColor}33 0%, transparent 70%)` }}
      />

      {/* ───── Topo compacto: status · música · seção · tom ───── */}
      <header className="shrink-0 z-10 px-5 sm:px-8 pt-5 pb-4 border-b border-white/10 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 shrink-0">
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 text-xs font-medium tracking-wide hidden sm:inline">Sincronizado</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                <span className="text-red-400 text-xs font-medium tracking-wide hidden sm:inline">Reconectando</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 min-w-0 text-zinc-400 text-sm">
            <Music className="w-4 h-4 shrink-0 text-indigo-400" />
            <span className="truncate font-medium text-zinc-200">{state.songName || 'Aguardando líder...'}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {state.controlEnabled && (
              <button
                onClick={() => sendCommand('set-pitch', { value: Math.max(-12, state.pitch - 1) })}
                className="p-1.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 active:scale-90 transition-all cursor-pointer"
                title="Descer meio tom"
              ><Minus className="w-4 h-4" /></button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-500/70">Tom</span>
              <span className="text-emerald-300 font-bold text-xl leading-none">{displayKey(state.originalKey, state.pitch)}</span>
              {pitchDelta(state.pitch) && (
                <span className="text-emerald-500/70 text-[11px] font-mono">{pitchDelta(state.pitch)}</span>
              )}
            </div>
            {state.controlEnabled && (
              <button
                onClick={() => sendCommand('set-pitch', { value: Math.min(12, state.pitch + 1) })}
                className="p-1.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 active:scale-90 transition-all cursor-pointer"
                title="Subir meio tom"
              ><Plus className="w-4 h-4" /></button>
            )}
            <button
              onClick={() => setShowContent((v) => !v)}
              title={showContent ? 'Ocultar letra/cifra' : 'Mostrar letra/cifra'}
              className="p-2 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              {showContent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Seção atual + próxima seção */}
        <div className="flex items-center justify-between gap-3 mt-3">
          {state.currentMarker ? (
            <span
              className="px-4 py-1.5 rounded-lg text-lg sm:text-2xl font-bold tracking-tight shadow-inner"
              style={{ backgroundColor: `${sectionColor}26`, color: sectionColor, border: `1px solid ${sectionColor}55` }}
            >
              {state.currentMarker.label}
            </span>
          ) : (
            <span className="text-zinc-600 text-sm italic">Sem seção marcada</span>
          )}

          {state.nextMarkerLabel && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm shrink-0">
              <span className="uppercase tracking-widest text-[10px] font-semibold hidden sm:inline">Próxima</span>
              <FastForward className="w-4 h-4" />
              <span className="font-medium text-zinc-300 truncate max-w-[40vw]">{state.nextMarkerLabel}</span>
            </div>
          )}
        </div>
      </header>

      {/* ───── Toggle Cifra / Letra (só quando há os dois e conteúdo visível) ───── */}
      {showContent && hasLyrics && hasChords && (
        <div className="shrink-0 z-10 flex items-center justify-center gap-2 py-2 border-b border-white/5">
          <button
            onClick={() => setView('lyrics')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${effective === 'lyrics' ? 'bg-primary/20 text-primary border border-primary/40' : 'text-zinc-400 border border-white/10'}`}
          >
            <FileText className="w-3.5 h-3.5" /> Letra
          </button>
          <button
            onClick={() => setView('chords')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${effective === 'chords' ? 'bg-secondary/20 text-secondary border border-secondary/40' : 'text-zinc-400 border border-white/10'}`}
          >
            <Music2 className="w-3.5 h-3.5" /> Cifra
          </button>
        </div>
      )}

      {/* ───── Corpo: letra sincronizada (auto-scroll) ou documento corrido ───── */}
      <main className="flex-1 min-h-0 z-10 overflow-auto px-5 sm:px-12">
        {!showContent ? (
          // Letra/cifra ocultada pelo músico — mostra só a seção atual em destaque.
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            {state.currentMarker ? (
              <span
                className="px-8 py-4 rounded-2xl text-4xl sm:text-6xl font-black tracking-tight"
                style={{ backgroundColor: `${sectionColor}1f`, color: sectionColor, border: `1px solid ${sectionColor}55` }}
              >
                {state.currentMarker.label}
              </span>
            ) : (
              <span className="text-zinc-500 text-2xl sm:text-3xl font-medium">{state.songName || 'Aguardando...'}</span>
            )}
            <span className="text-zinc-600 text-xs uppercase tracking-widest flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5" /> Letra/cifra oculta
            </span>
          </div>
        ) : useSynced ? (
          // Letra que rola sozinha: linha atual destacada e centralizada.
          <div className="max-w-4xl mx-auto py-[40vh] space-y-4 text-center">
            {synced.map((line, i) => (
              <p
                key={i}
                ref={i === activeIndex ? activeRef : null}
                className={`font-bold leading-snug transition-all duration-500 ${
                  i === activeIndex
                    ? 'text-white text-3xl sm:text-5xl md:text-6xl drop-shadow-lg'
                    : i < activeIndex
                      ? 'text-zinc-700 text-xl sm:text-3xl'
                      : 'text-zinc-500 text-xl sm:text-3xl'
                }`}
              >
                {line.text || '♪'}
              </p>
            ))}
          </div>
        ) : hasAny && content ? (
          <div className="py-8">
            {effective === 'chords' ? (
              <pre className="w-fit min-w-full mx-auto whitespace-pre font-mono text-lg sm:text-2xl md:text-3xl leading-relaxed text-white/95">
                {content}
              </pre>
            ) : (
              <pre className="w-full max-w-4xl mx-auto whitespace-pre-wrap break-words font-sans text-2xl sm:text-4xl md:text-5xl font-bold leading-snug text-center text-white/95 drop-shadow-md">
                {content}
              </pre>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-zinc-600">
            <Music className="w-16 h-16 mb-4 opacity-40" />
            <p className="text-2xl sm:text-3xl font-medium">
              {state.songName ? 'Sem letra/cifra cadastrada' : 'Aguardando o líder iniciar...'}
            </p>
          </div>
        )}
      </main>

      {/* ───── Repertório (overlay): a banda escolhe a música ───── */}
      {showSetlist && state.controlEnabled && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex flex-col" onClick={() => setShowSetlist(false)}>
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-bold uppercase tracking-wider text-sm flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-primary" /> Repertório
            </h2>
            <button onClick={() => setShowSetlist(false)} className="p-2 text-zinc-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
            {(state.setlist ?? []).map((name, i) => (
              <button
                key={i}
                onClick={() => { sendCommand('select-song', { index: i }); setShowSetlist(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-colors cursor-pointer active:scale-[0.99] ${i === state.activeIndex ? 'bg-primary/15 border border-primary/40' : 'bg-white/5 border border-white/10 hover:bg-white/10'}`}
              >
                <span className={`text-xs font-mono w-6 shrink-0 ${i === state.activeIndex ? 'text-primary' : 'text-zinc-500'}`}>{i + 1}</span>
                <span className={`flex-1 font-medium truncate ${i === state.activeIndex ? 'text-primary' : 'text-zinc-200'}`}>{name}</span>
                {i === state.activeIndex && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ───── Mixer (overlay): a banda ajusta volume/mute/solo ───── */}
      {showMixer && state.controlEnabled && (
        <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex flex-col" onClick={() => setShowMixer(false)}>
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-bold uppercase tracking-wider text-sm flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" /> Mixer
            </h2>
            <button onClick={() => setShowMixer(false)} className="p-2 text-zinc-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
            {(state.channels ?? []).map((ch) => (
              <div key={ch.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-medium text-zinc-200 truncate">{ch.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => sendCommand('toggle-mute', { id: ch.id })}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors cursor-pointer ${ch.muted ? 'bg-red-500/80 text-white' : 'bg-white/10 text-zinc-400'}`}
                    >M</button>
                    <button
                      onClick={() => sendCommand('toggle-solo', { id: ch.id })}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors cursor-pointer ${ch.soloed ? 'bg-amber-400 text-black' : 'bg-white/10 text-zinc-400'}`}
                    >S</button>
                  </div>
                </div>
                <input
                  type="range" min={0} max={1.2} step={0.01} value={ch.volume}
                  onChange={(e) => sendCommand('set-volume', { id: ch.id, value: parseFloat(e.target.value) })}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───── Pads (overlay): a banda aciona os pads ───── */}
      {showPads && state.controlEnabled && (
        <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex flex-col" onClick={() => setShowPads(false)}>
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-bold uppercase tracking-wider text-sm flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-secondary" /> Pads
            </h2>
            <button onClick={() => setShowPads(false)} className="p-2 text-zinc-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3 content-center" onClick={(e) => e.stopPropagation()}>
            {PAD_NOTES.map((note) => (
              <button
                key={note}
                onClick={() => sendCommand('play-pad', { id: note })}
                className={`aspect-square rounded-2xl text-2xl font-black flex items-center justify-center transition-all active:scale-95 cursor-pointer border ${state.activePad === note ? 'bg-secondary text-black border-secondary shadow-lg shadow-secondary/30' : 'bg-white/5 text-zinc-200 border-white/10'}`}
              >
                {note}
              </button>
            ))}
          </div>
          <div className="shrink-0 px-5 pb-6 pt-3 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold shrink-0">Volume Pads</span>
              <input
                type="range" min={0} max={1} step={0.01} value={state.padVolume}
                onChange={(e) => sendCommand('set-pad-volume', { value: parseFloat(e.target.value) })}
                className="flex-1 accent-secondary cursor-pointer"
              />
              <span className="text-xs font-mono text-zinc-400 w-10 text-right shrink-0">{Math.round(state.padVolume * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ───── Barra de baixo FIXA: próxima música · status · controles ───── */}
      <footer className="shrink-0 z-10 border-t border-white/10 bg-zinc-950/95 backdrop-blur-sm">
        {/* Próxima música (linha compacta) */}
        {state.nextSong && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 text-xs min-w-0">
            <FastForward className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
            <span className="uppercase tracking-wider text-[9px] font-semibold text-indigo-400/80 shrink-0">Próxima</span>
            <span className="font-medium text-zinc-200 truncate flex-1 min-w-0">{state.nextSong.name}</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold shrink-0">
              {displayKey(state.nextSong.originalKey, state.nextSong.pitch)}
            </span>
            {state.nextSong.bpm != null && (
              <span className="text-zinc-500 font-mono text-[11px] whitespace-nowrap shrink-0">{Math.round(state.nextSong.bpm)} BPM</span>
            )}
          </div>
        )}

        {/* Status (sempre) */}
        <div className="flex items-center justify-center gap-2 pt-2.5">
          <span className={`text-sm font-semibold ${state.isPlaying ? 'text-emerald-400' : 'text-amber-400'}`}>
            {state.isPlaying ? '▶ Tocando' : '⏸ Pausado'}
          </span>
          <span className="font-mono text-zinc-400 text-sm tabular-nums">{formatTime(state.currentTime)}</span>
        </div>

        {/* Controles (só quando o líder libera) */}
        {state.controlEnabled && (
          <>
            {/* Linha 1: ferramentas */}
            <div className="flex items-center justify-center gap-8 pt-2.5">
              {(state.channels?.length ?? 0) > 0 && (
                <button
                  onClick={() => setShowMixer(true)}
                  className="p-2.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 active:scale-90 transition-all cursor-pointer"
                  title="Mixer"
                >
                  <SlidersHorizontal className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setShowPads(true)}
                className="p-2.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 active:scale-90 transition-all cursor-pointer"
                title="Pads"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              {(state.setlist?.length ?? 0) > 0 && (
                <button
                  onClick={() => setShowSetlist(true)}
                  className="p-2.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 active:scale-90 transition-all cursor-pointer"
                  title="Repertório"
                >
                  <ListMusic className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Linha 2: transporte centralizado */}
            <div className="flex items-center justify-center gap-7 pb-3 pt-2">
              <button
                onClick={() => sendCommand('prev')}
                className="p-3 rounded-full bg-white/5 border border-white/10 text-zinc-200 active:scale-90 transition-all cursor-pointer"
                title="Música anterior"
              >
                <SkipBack className="w-6 h-6" fill="currentColor" />
              </button>
              <button
                onClick={() => sendCommand('toggle-play')}
                className="p-5 rounded-full bg-primary text-black active:scale-95 transition-all cursor-pointer shadow-lg"
                title={state.isPlaying ? 'Pausar' : 'Tocar'}
              >
                {state.isPlaying ? <Pause className="w-8 h-8" fill="currentColor" /> : <Play className="w-8 h-8 ml-0.5" fill="currentColor" />}
              </button>
              <button
                onClick={() => sendCommand('next')}
                className="p-3 rounded-full bg-white/5 border border-white/10 text-zinc-200 active:scale-90 transition-all cursor-pointer"
                title="Próxima música"
              >
                <SkipForward className="w-6 h-6" fill="currentColor" />
              </button>
            </div>
          </>
        )}

        {/* Espaçamento inferior quando não há controles */}
        {!state.controlEnabled && <div className="h-2.5" />}
      </footer>
    </div>
  );
}
