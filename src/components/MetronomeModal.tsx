import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Loader2, X, CheckCircle, Minus, Plus, Wand2 } from 'lucide-react';
import { analyzeBufferAndGenerateClick, generateManualClickTrack } from '../lib/AudioAnalyzer';
import type { Channel } from '../types';

export type ClickSound = 'logic' | 'blip' | 'classic' | 'cowbell';
export type TimeSignature = '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8';

interface MetronomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistCurrentSong: { name: string, duration: number, channels: Channel[] } | null;
  onAddClick: (file: File) => void;
}

// ─── Click sound preview via Web Audio ───
const previewClickSound = (sound: ClickSound) => {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;

  if (sound === 'logic') {
    // Sine 1500Hz, sharp envelope
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, now);
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (sound === 'blip') {
    // Triangle wave, pitch drop
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.03);
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } else if (sound === 'classic') {
    // Square wave click
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, now);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } else if (sound === 'cowbell') {
    // Two detuned square oscillators for metallic character
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'square';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(545, now);
    osc2.frequency.setValueAtTime(815, now);
    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.13);
    osc2.stop(now + 0.13);
  }

  setTimeout(() => ctx.close(), 500);
};

export function MetronomeModal({ isOpen, onClose, playlistCurrentSong, onAddClick }: MetronomeModalProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual');
  const [bpm, setBpm] = useState<number>(120);
  const [bpmInput, setBpmInput] = useState<string>('120');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);

  // New features
  const [clickSound, setClickSound] = useState<ClickSound>('logic');
  const [accentBeat1, setAccentBeat1] = useState(true);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  
  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tapCount, setTapCount] = useState(0);

  if (!isOpen) return null;

  const handleBpmChange = (value: number) => {
    const clamped = Math.max(40, Math.min(300, value));
    setBpm(clamped);
    setBpmInput(String(clamped));
  };

  const handleBpmInputBlur = () => {
    const parsed = parseInt(bpmInput);
    if (isNaN(parsed) || parsed < 40) handleBpmChange(40);
    else if (parsed > 300) handleBpmChange(300);
    else handleBpmChange(parsed);
  };

  const handleDoubleTempo = () => {
    handleBpmChange(bpm * 2);
  };

  const handleTapTempo = useCallback(() => {
    const now = performance.now();
    
    // Clear old tap timeout
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    
    // Reset if last tap was more than 2.5 seconds ago
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2500) {
      tapTimesRef.current = [];
    }

    tapTimesRef.current.push(now);
    setTapCount(prev => prev + 1);
    
    // Need at least 2 taps to calculate BPM
    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      // Average the intervals (ms)
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avgInterval);
      handleBpmChange(newBpm);
    }
    
    // Keep only last 8 taps
    if (tapTimesRef.current.length > 8) {
      tapTimesRef.current = tapTimesRef.current.slice(-8);
    }

    // Auto-reset after 2.5s of no tapping
    tapTimeoutRef.current = setTimeout(() => {
      tapTimesRef.current = [];
      setTapCount(0);
    }, 2500);
  }, []);

  const songDuration = playlistCurrentSong?.duration ?? 300;

  const handleManualGenerate = async () => {
    if (!playlistCurrentSong) return;
    setIsSynthesizing(true);
    try {
      const { clickTrackUrl } = await generateManualClickTrack(
        bpm, songDuration, setStatusMsg, clickSound, accentBeat1, timeSignature
      );
      if (clickTrackUrl) {
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        const file = new File([blob], `Click_${bpm}bpm.wav`, { type: 'audio/wav' });
        onAddClick(file);
        URL.revokeObjectURL(clickTrackUrl);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar metrônomo manual.');
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
      onClose();
    }
  };

  const handleAIGenerate = async () => {
    if (!playlistCurrentSong) return;

    // Prefere Bateria → Baixo → qualquer canal que não seja click/guia
    let targetChannel: Channel | undefined = playlistCurrentSong.channels.find(c =>
      c.name.toLowerCase().includes('drum') || c.name.toLowerCase().includes('bateria')
    );
    if (!targetChannel) {
      targetChannel = playlistCurrentSong.channels.find(c =>
        c.name.toLowerCase().includes('bass') || c.name.toLowerCase().includes('baixo')
      );
    }
    if (!targetChannel) {
      targetChannel = playlistCurrentSong.channels.find(c => {
        const n = c.name.toLowerCase();
        return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide');
      });
    }
    if (!targetChannel) targetChannel = playlistCurrentSong.channels[0];

    if (!targetChannel?.buffer) {
      alert('Nenhuma faixa disponível para análise.');
      return;
    }

    setIsSynthesizing(true);
    setDetectedBpm(null);
    setStatusMsg(`Analisando faixa "${targetChannel.name}"...`);

    try {
      const { bpm: detected, clickTrackUrl } = await analyzeBufferAndGenerateClick(
        targetChannel.buffer,
        setStatusMsg
      );

      setDetectedBpm(detected);

      if (clickTrackUrl) {
        setStatusMsg('Inserindo canal de click...');
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        const file = new File([blob], `Click_IA_${detected}bpm.wav`, { type: 'audio/wav' });
        onAddClick(file);
        URL.revokeObjectURL(clickTrackUrl);
      } else {
        alert(`BPM detectado: ${detected}, mas não foi possível gerar o click. Tente o modo manual.`);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao analisar a música.');
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
      onClose();
    }
  };

  // Sync input string with bpm state
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  const getTempoName = (currentBpm: number) => {
    if (currentBpm < 60) return 'Largo';
    if (currentBpm < 76) return 'Adagio';
    if (currentBpm < 108) return 'Andante';
    if (currentBpm < 112) return 'Moderato';
    if (currentBpm < 120) return 'Allegretto';
    if (currentBpm < 156) return 'Allegro';
    if (currentBpm < 176) return 'Vivace';
    return 'Presto';
  };

  const clickSounds: { id: ClickSound; label: string }[] = [
    { id: 'logic', label: 'Logic' },
    { id: 'blip', label: 'Blip' },
    { id: 'classic', label: 'Classic' },
    { id: 'cowbell', label: 'Cowbell' },
  ];

  const timeSignatures: TimeSignature[] = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div 
        className="bg-[#1c1c1e] w-full max-w-[380px] rounded-2xl p-5 shadow-2xl border border-white/5 flex flex-col max-h-[90vh] overflow-y-auto scrollbar-hide"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-white text-sm font-bold tracking-wide">BPM</span>
          <button onClick={onClose} disabled={isSynthesizing} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        {/* Tempo Name */}
        <div className="text-white/60 text-sm font-medium mb-3">{getTempoName(bpm)}</div>

        {/* Big BPM Row */}
        <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2 mb-3">
          <button 
            onClick={() => handleBpmChange(bpm - 1)}
            disabled={isSynthesizing}
            className="w-12 h-12 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer disabled:opacity-50"
          >
            <Minus size={20} />
          </button>
          
          <input 
            type="number"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={handleBpmInputBlur}
            disabled={isSynthesizing}
            className="text-white font-black text-4xl w-24 text-center bg-transparent focus:outline-none"
          />
          
          <button 
            onClick={() => handleBpmChange(bpm + 1)}
            disabled={isSynthesizing}
            className="w-12 h-12 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer disabled:opacity-50"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Tap Tempo + 2x Row */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleTapTempo}
            disabled={isSynthesizing}
            className="flex-1 bg-[#2a2a2d] hover:bg-[#3a3a3e] border border-white/5 text-white py-3 rounded-xl font-bold transition-all text-xs tracking-wider cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span className="relative flex h-2.5 w-2.5">
              {tapCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tapCount > 0 ? 'bg-primary' : 'bg-white/30'}`}></span>
            </span>
            TAP TEMPO
          </button>
          <button
            onClick={handleDoubleTempo}
            disabled={isSynthesizing || bpm * 2 > 300}
            className="w-[72px] bg-[#2a2a2d] hover:bg-[#3a3a3e] border border-white/5 text-white py-3 rounded-xl font-black transition-all text-sm tracking-wider cursor-pointer active:scale-95 disabled:opacity-50"
          >
            2×
          </button>
        </div>

        {/* ─── Click Sound ─── */}
        <div className="mb-4">
          <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Som do Click</div>
          <div className="grid grid-cols-4 gap-1.5">
            {clickSounds.map(s => (
              <button
                key={s.id}
                onClick={() => { setClickSound(s.id); previewClickSound(s.id); }}
                disabled={isSynthesizing}
                className={`py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 border disabled:opacity-50 ${
                  clickSound === s.id
                    ? 'bg-primary/15 border-primary text-primary shadow-[0_0_12px_rgba(212,168,67,0.15)]'
                    : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438] hover:text-white/80'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Time Signature ─── */}
        <div className="mb-4">
          <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Compasso</div>
          <div className="grid grid-cols-6 gap-1.5">
            {timeSignatures.map(ts => (
              <button
                key={ts}
                onClick={() => setTimeSignature(ts)}
                disabled={isSynthesizing}
                className={`py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 border disabled:opacity-50 ${
                  timeSignature === ts
                    ? 'bg-primary/15 border-primary text-primary shadow-[0_0_12px_rgba(212,168,67,0.15)]'
                    : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438] hover:text-white/80'
                }`}
              >
                {ts}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Accent Toggle ─── */}
        <div className="mb-5 flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl px-4 py-3">
          <span className="text-white/70 text-xs font-bold tracking-wide">Acentuar beat 1</span>
          <button
            onClick={() => setAccentBeat1(!accentBeat1)}
            disabled={isSynthesizing}
            className={`relative w-11 h-6 rounded-full transition-all cursor-pointer disabled:opacity-50 ${
              accentBeat1 ? 'bg-primary' : 'bg-[#3a3a3e]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${
                accentBeat1 ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Status Loading/Text */}
        {isSynthesizing && statusMsg && (
          <div className="text-center text-[10px] font-bold text-primary animate-pulse uppercase tracking-wider mb-4">
            {statusMsg}
          </div>
        )}
        
        {detectedBpm && !isSynthesizing && (
          <div className="flex items-center justify-center gap-2 text-accent-green mb-4 text-xs font-bold uppercase tracking-wider">
            <CheckCircle size={14} /> Detectado: {detectedBpm} BPM
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 mt-auto">
          <button 
            onClick={handleManualGenerate}
            disabled={isSynthesizing || !playlistCurrentSong}
            className="w-full bg-[#2a2a2d] hover:bg-[#343438] text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider cursor-pointer border border-white/5 active:scale-95"
          >
            {isSynthesizing && activeTab === 'manual' ? <Loader2 size={16} className="animate-spin" /> : <Play fill="currentColor" size={14} />}
            GERAR CLICK MANUAL
          </button>

          <button 
            onClick={() => { setActiveTab('ai'); handleAIGenerate(); }}
            disabled={isSynthesizing || !playlistCurrentSong}
            className="w-full bg-primary hover:bg-primary-dim text-black py-3.5 rounded-xl font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider cursor-pointer shadow-[0_4px_15px_rgba(212,168,67,0.2)] active:scale-95"
          >
            {isSynthesizing && activeTab === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            AUTO-DETECTAR E GERAR CLICK
          </button>
        </div>
      </div>
    </div>
  );
}
