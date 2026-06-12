import { useState, useMemo, useRef, useEffect } from 'react';
import { Wifi, WifiOff, FastForward, Music, FileText, Music2 } from 'lucide-react';
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

export function FollowerView({ state, isConnected }: FollowerViewProps) {
  const sectionColor = state.currentMarker?.color || '#6366f1';

  const hasLyrics = !!state.lyrics?.trim();
  const hasChords = !!state.chords?.trim();
  const [view, setView] = useState<'lyrics' | 'chords'>('lyrics');
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
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col font-sans relative overflow-hidden">
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

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-500/70">Tom</span>
            <span className="text-emerald-300 font-bold text-xl leading-none">{displayKey(state.originalKey, state.pitch)}</span>
            {pitchDelta(state.pitch) && (
              <span className="text-emerald-500/70 text-[11px] font-mono">{pitchDelta(state.pitch)}</span>
            )}
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

      {/* ───── Toggle Cifra / Letra (só quando há os dois) ───── */}
      {hasLyrics && hasChords && (
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
      <main className="flex-1 z-10 overflow-auto px-5 sm:px-12">
        {useSynced ? (
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

      {/* ───── Rodapé: status de reprodução · tempo · próxima música ───── */}
      <footer className="shrink-0 z-10 px-5 sm:px-8 py-4 border-t border-white/10 backdrop-blur-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`text-base sm:text-lg font-semibold ${state.isPlaying ? 'text-emerald-400' : 'text-amber-400'}`}>
            {state.isPlaying ? '▶ Tocando' : '⏸ Pausado'}
          </span>
          <span className="font-mono text-zinc-400 text-lg tabular-nums">{formatTime(state.currentTime)}</span>
        </div>

        {state.nextSong && (
          <div className="flex items-center gap-3 text-zinc-500 min-w-0">
            <FastForward className="w-4 h-4 shrink-0 text-indigo-400" />
            <div className="flex flex-col items-end leading-tight min-w-0">
              <span className="uppercase tracking-widest text-[9px] font-semibold text-indigo-400/80">Próxima música</span>
              <span className="font-medium text-zinc-200 truncate max-w-[50vw]">{state.nextSong.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 pl-3 border-l border-white/10">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold text-sm">
                {displayKey(state.nextSong.originalKey, state.nextSong.pitch)}
              </span>
              {state.nextSong.bpm != null && (
                <span className="text-zinc-400 text-xs font-mono whitespace-nowrap">{Math.round(state.nextSong.bpm)} BPM</span>
              )}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
