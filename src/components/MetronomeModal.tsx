import { useState, useEffect } from 'react';
import { Play, Loader2, X, CheckCircle, Minus, Plus, Wand2 } from 'lucide-react';
import { analyzeBufferAndGenerateClick, generateManualClickTrack } from '../lib/AudioAnalyzer';
import type { Channel } from '../types';

interface MetronomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistCurrentSong: { name: string, duration: number, channels: Channel[] } | null;
  onAddClick: (file: File) => void;
}

export function MetronomeModal({ isOpen, onClose, playlistCurrentSong, onAddClick }: MetronomeModalProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual');
  const [bpm, setBpm] = useState<number>(120);
  const [bpmInput, setBpmInput] = useState<string>('120');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);

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

  const songDuration = playlistCurrentSong?.duration ?? 300;

  const handleManualGenerate = async () => {
    if (!playlistCurrentSong) return;
    setIsSynthesizing(true);
    try {
      const { clickTrackUrl } = await generateManualClickTrack(bpm, songDuration, setStatusMsg);
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div 
        className="bg-[#1c1c1e] w-full max-w-[340px] rounded-2xl p-5 shadow-2xl border border-white/5 flex flex-col"
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
        <div className="text-white/60 text-sm font-medium mb-4">{getTempoName(bpm)}</div>

        {/* Big BPM Row */}
        <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2 mb-6">
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
