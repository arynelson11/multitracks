import { useState, useMemo, useRef, useEffect } from 'react';
import { Repeat, Infinity as InfinityIcon, CornerUpLeft, Plus, X, Minus, Lock } from 'lucide-react';
import type { Marker } from '../types';

interface SectionBarProps {
  markers: Marker[];
  currentMarkerId: string | null;
  currentTime: number;
  duration: number;
  waveBuffer: AudioBuffer | null;
  bpm?: number;
  activeLoop: { index: number; remaining: number | 'infinite' } | null;
  pendingJump: number | null;
  canEdit: boolean;
  infiniteAllowed: boolean; // loop infinito é exclusivo de plano pago
  maxRepeats: number;       // teto de repetições do seletor (grátis = 4)
  onUpgrade: () => void;    // abre o pricing quando esbarra num limite de plano
  onSeek: (time: number) => void;
  onArmLoop: (index: number, repeats: number | 'infinite') => void;
  onCancelLoop: () => void;
  onArmJump: (index: number) => void;
  onCancelJump: () => void;
  onAddMarker: (label: string) => void;
  onRemoveMarker: (id: string) => void;
}

// Atalhos pra marcar uma seção no calor do ao vivo: a tecla cria a seção no
// ponto atual já com o nome e a cor do tipo. `code` usa a tecla física
// (independe de layout). Pré e Ponte colidem em "P", então Ponte usa "B".
export const SECTION_SHORTCUTS: { name: string; key: string; code: string; color: string }[] = [
  { name: 'Intro', key: 'I', code: 'KeyI', color: '#3b82f6' },
  { name: 'Verso', key: 'V', code: 'KeyV', color: '#10b981' },
  { name: 'Pré', key: 'P', code: 'KeyP', color: '#f59e0b' },
  { name: 'Refrão', key: 'R', code: 'KeyR', color: '#FF6B35' },
  { name: 'Ponte', key: 'B', code: 'KeyB', color: '#8b5cf6' },
  { name: 'Final', key: 'F', code: 'KeyF', color: '#ec4899' },
];

// Cor de um tipo de seção pelo nome (fallback laranja pra nomes customizados).
export const colorForSection = (label: string): string =>
  SECTION_SHORTCUTS.find((s) => s.name.toLowerCase() === label.trim().toLowerCase())?.color || '#FF6B35';

const WAVE_BUCKETS = 1100; // resolução horizontal da forma de onda

// Reduz o AudioBuffer a um array de picos (0..1) pra desenhar a waveform.
// Pega o maior valor absoluto de cada balde — leitura visual fiel e barata.
function computePeaks(buffer: AudioBuffer, buckets: number): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / buckets) || 1;
  const peaks: number[] = [];
  let max = 0.0001;
  for (let i = 0; i < buckets; i++) {
    let peak = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[start + j] || 0);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  // Normaliza pra usar toda a altura.
  return peaks.map((p) => p / max);
}

export function SectionBar({
  markers,
  currentMarkerId,
  currentTime,
  duration,
  waveBuffer,
  bpm,
  activeLoop,
  pendingJump,
  canEdit,
  infiniteAllowed,
  maxRepeats,
  onUpgrade,
  onSeek,
  onArmLoop,
  onCancelLoop,
  onArmJump,
  onCancelJump,
  onAddMarker,
  onRemoveMarker,
}: SectionBarProps) {
  const [repeatCount, setRepeatCount] = useState(2);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const currentIdx = currentMarkerId ? markers.findIndex((m) => m.id === currentMarkerId) : -1;
  const dur = duration || 1;

  // Picos da waveform: recalcula só quando a música (buffer) muda.
  const peaks = useMemo(() => (waveBuffer ? computePeaks(waveBuffer, WAVE_BUCKETS) : null), [waveBuffer]);

  // Blocos: cada seção vai do seu marcador ao próximo (ou ao fim da música).
  const blocks = markers.map((m, i) => {
    const start = m.time;
    const end = i < markers.length - 1 ? markers[i + 1].time : dur;
    return { marker: m, index: i, start, end, left: (start / dur) * 100, width: (Math.max(0, end - start) / dur) * 100 };
  });

  // Desenha waveform + grid no canvas. Redesenha só quando muda peaks, bpm,
  // duração ou o tamanho — não a cada frame (o playhead é um elemento à parte).
  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = track.clientWidth;
      const h = track.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Grid: linhas por batida (compasso 4/4) quando há BPM; senão, uniforme.
      const mid = h / 2;
      if (bpm && bpm > 0 && duration > 0) {
        const beatDur = 60 / bpm;
        const totalBeats = Math.floor(duration / beatDur);
        for (let b = 0; b <= totalBeats; b++) {
          const x = ((b * beatDur) / duration) * w;
          const isBar = b % 4 === 0; // primeira batida do compasso = linha mais forte
          ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
          ctx.stroke();
        }
      }

      // Waveform centralizada.
      if (peaks) {
        ctx.fillStyle = 'rgba(255,255,255,0.32)';
        const n = peaks.length;
        for (let i = 0; i < n; i++) {
          const x = (i / n) * w;
          const bw = Math.max(1, w / n);
          const amp = peaks[i] * (h / 2) * 0.92;
          ctx.fillRect(x, mid - amp, bw, amp * 2);
        }
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(track);
    return () => ro.disconnect();
  }, [peaks, bpm, duration]);

  return (
    <div className="mt-1.5 rounded-lg border border-white/10 bg-black/30 p-2">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Seções</span>
        {canEdit && (
          <div className="flex items-center gap-1">
            {markers.length > 0 && (
              <button
                onClick={() => setEditMode((v) => !v)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider cursor-pointer transition-all ${editMode ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white'}`}
              >
                {editMode ? 'Pronto' : 'Editar'}
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setShowAddMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/30 hover:bg-primary/10 cursor-pointer active:scale-95 transition-all"
              >
                <Plus size={11} /> Marcar
              </button>
              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute top-full right-0 mt-1 z-50 w-40 daw-panel rounded-lg p-1.5 shadow-xl">
                    <p className="text-[8px] text-text-muted uppercase tracking-wider px-1 pb-1 font-mono">Marcar aqui como (ou tecle a letra)</p>
                    <div className="grid grid-cols-2 gap-1">
                      {SECTION_SHORTCUTS.map(({ name, key, color }) => (
                        <button
                          key={name}
                          onClick={() => { onAddMarker(name); setShowAddMenu(false); }}
                          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold text-white bg-white/5 hover:bg-white/10 cursor-pointer active:scale-95 transition-all"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          {name}
                          <span className="ml-auto px-1 rounded bg-black/40 text-text-muted text-[9px] font-mono">{key}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {markers.length === 0 ? (
        <p className="text-[10px] text-text-muted/60 font-mono py-2 text-center">
          {canEdit ? 'Toque em "Marcar" pra criar seções (Refrão, Verso...) e repetir trechos ao vivo.' : 'Sem seções nesta música.'}
        </p>
      ) : (
        <>
          {/* Régua com waveform + grid + blocos de seção */}
          <div ref={trackRef} className="relative w-full h-16 rounded-md bg-black/50 border border-white/5 overflow-hidden">
            {/* Fundo: forma de onda e grid */}
            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

            {/* Blocos de seção (semi-transparentes, deixam a waveform aparecer) */}
            {blocks.map(({ marker, index, start, left, width }) => {
              const isActive = index === currentIdx;
              const isLoopHere = activeLoop?.index === index;
              const isJumpHere = pendingJump === index;
              const color = marker.color || '#FF6B35';
              return (
                <button
                  key={marker.id}
                  onClick={() => onSeek(start)}
                  title={marker.label}
                  className="absolute top-1 bottom-1 flex flex-col items-start justify-between px-1.5 py-1 cursor-pointer transition-all overflow-hidden text-left rounded-lg"
                  style={{
                    left: `calc(${left}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    border: `1.5px solid ${isActive || isLoopHere ? color : `${color}66`}`,
                    backgroundColor: isActive ? `${color}33` : `${color}1a`,
                    boxShadow: isLoopHere ? `0 0 0 1.5px ${color}, 0 0 12px ${color}55` : 'none',
                  }}
                >
                  {/* Etiqueta da seção */}
                  <span
                    className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-black uppercase tracking-wide font-mono truncate max-w-full shadow-sm"
                    style={{ color: '#000', backgroundColor: color }}
                  >
                    {marker.label}
                  </span>
                  {/* Ações da seção */}
                  <div className="flex items-center gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); isLoopHere ? onCancelLoop() : onArmLoop(index, repeatCount); }}
                      title={isLoopHere ? 'Cancelar repetição' : `Repetir esta seção ${repeatCount}x`}
                      className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-all backdrop-blur-sm ${isLoopHere ? 'bg-primary text-black' : 'bg-black/50 text-white/80 hover:text-white'}`}
                    >
                      <Repeat size={10} />
                      {isLoopHere && (activeLoop!.remaining === 'infinite' ? '∞' : activeLoop!.remaining)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); isJumpHere ? onCancelJump() : onArmJump(index); }}
                      title={isJumpHere ? 'Cancelar volta' : `Voltar pra ${marker.label} no fim da seção atual`}
                      className={`px-1 py-0.5 rounded cursor-pointer transition-all backdrop-blur-sm ${isJumpHere ? 'bg-primary text-black' : 'bg-black/50 text-white/80 hover:text-white'}`}
                    >
                      <CornerUpLeft size={10} />
                    </span>
                    {editMode && canEdit && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onRemoveMarker(marker.id); }}
                        className="px-1 py-0.5 rounded bg-red-500/40 text-red-100 hover:bg-red-500/60 cursor-pointer backdrop-blur-sm"
                        title="Remover seção"
                      >
                        <X size={10} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none shadow-[0_0_6px_rgba(255,255,255,0.8)] z-10"
              style={{ left: `${Math.min(100, (currentTime / dur) * 100)}%` }}
            />
          </div>

          {/* Painel de controle */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {activeLoop ? (
              <>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider">
                  <Repeat size={12} />
                  {activeLoop.remaining === 'infinite'
                    ? `Repetindo ${markers[activeLoop.index]?.label ?? ''} · ∞`
                    : `Repetindo ${markers[activeLoop.index]?.label ?? ''} · faltam ${activeLoop.remaining}`}
                </span>
                <button
                  onClick={onCancelLoop}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/15 text-text-muted hover:text-white hover:bg-white/5 text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
                >
                  <X size={11} /> Sair
                </button>
              </>
            ) : (
              <>
                {/* Seletor de repetições */}
                <div className="flex items-center gap-1 bg-white/5 rounded-md border border-white/10 px-1 py-0.5">
                  <button onClick={() => setRepeatCount((n) => Math.max(1, n - 1))} disabled={repeatCount <= 1}
                    className="p-0.5 text-text-muted hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default">
                    <Minus size={12} />
                  </button>
                  <span className="text-[11px] font-bold text-white font-mono w-8 text-center">{repeatCount}x</span>
                  <button
                    onClick={() => { if (repeatCount >= maxRepeats) { onUpgrade(); return; } setRepeatCount((n) => Math.min(maxRepeats, n + 1)); }}
                    className="p-0.5 text-text-muted hover:text-white cursor-pointer">
                    <Plus size={12} />
                  </button>
                </div>
                <button
                  onClick={() => currentIdx >= 0 && onArmLoop(currentIdx, repeatCount)}
                  disabled={currentIdx < 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all disabled:opacity-30 disabled:cursor-default"
                  title="Repetir a seção que está tocando"
                >
                  <Repeat size={12} /> Repetir atual
                </button>
                <button
                  onClick={() => { if (!infiniteAllowed) { onUpgrade(); return; } if (currentIdx >= 0) onArmLoop(currentIdx, 'infinite'); }}
                  disabled={infiniteAllowed && currentIdx < 0}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-text-muted hover:text-white hover:bg-white/5 text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all disabled:opacity-30 disabled:cursor-default"
                  title={infiniteAllowed ? 'Repetir até mandar sair' : 'Loop infinito é dos planos pagos'}
                >
                  {infiniteAllowed ? <InfinityIcon size={13} /> : <Lock size={12} />}
                </button>
                <span className="text-[9px] text-text-muted/70 font-mono">Defina as vezes e toque no ↻ da seção</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
