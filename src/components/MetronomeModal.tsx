import { useState } from 'react';
import { Settings, Play, Cpu, Keyboard, Loader2, X, CheckCircle } from 'lucide-react';
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

  const handleBpmInputChange = (raw: string) => {
    setBpmInput(raw);
    const parsed = parseInt(raw);
    if (!isNaN(parsed) && parsed >= 40 && parsed <= 300) {
      setBpm(parsed);
    }
  };

  const handleBpmInputBlur = () => {
    const parsed = parseInt(bpmInput);
    if (isNaN(parsed) || parsed < 40) handleBpmChange(40);
    else if (parsed > 300) handleBpmChange(300);
    else handleBpmChange(parsed);
  };

  const songDuration = playlistCurrentSong?.duration ?? 300;
  const songDurationStr = `${Math.floor(songDuration / 60)}:${Math.floor(songDuration % 60).toString().padStart(2, '0')}`;

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="daw-panel w-full max-w-md overflow-hidden flex flex-col rounded-lg">

        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Settings size={16} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-wider uppercase">Click Generator</h2>
              <p className="text-[9px] text-text-muted font-mono">Add metronome instantly</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSynthesizing} className="text-text-muted hover:text-white transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-black/20">
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-2.5 text-[10px] font-bold tracking-wider uppercase font-mono transition-all ${activeTab === 'manual' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:bg-white/5'}`}>
            <div className="flex justify-center items-center gap-2"><Keyboard size={14} /> MANUAL</div>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 py-2.5 text-[10px] font-bold tracking-wider uppercase font-mono transition-all ${activeTab === 'ai' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-text-muted hover:bg-white/5'}`}>
            <div className="flex justify-center items-center gap-2"><Cpu size={14} /> DETECT BPM</div>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 bg-[#0e0e10]">
          {activeTab === 'manual' ? (
            <>
              <div>
                <label className="block text-[10px] font-bold text-text-muted mb-3 uppercase tracking-wider font-mono">BPM (Beats Per Minute)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="40"
                    max="300"
                    value={bpm}
                    onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                    className="flex-1 accent-primary h-1.5 rounded"
                  />
                  <input
                    type="number"
                    min="40"
                    max="300"
                    value={bpmInput}
                    onChange={(e) => handleBpmInputChange(e.target.value)}
                    onBlur={handleBpmInputBlur}
                    className="w-20 h-10 text-center lcd-display rounded-md font-mono text-primary font-bold text-lg"
                  />
                </div>
              </div>

              <div className="lcd-display rounded-md p-3 flex gap-3 text-[10px] text-primary font-mono">
                <Settings size={14} className="shrink-0 mt-0.5" />
                <p>Duration: <span className="font-bold">{songDurationStr}</span></p>
              </div>

              <button
                onClick={handleManualGenerate}
                disabled={isSynthesizing || !playlistCurrentSong}
                className="w-full bg-primary hover:bg-primary-dim text-black py-3 rounded-md font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase tracking-wider text-xs shadow-[0_0_15px_rgba(212,168,67,0.15)]"
              >
                {isSynthesizing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                GENERATE CLICK
              </button>
            </>
          ) : (
            <>
              <div className="lcd-display rounded-md p-3 text-[10px] text-text-muted space-y-2 font-mono">
                <div className="flex items-center gap-2 text-purple-300 font-bold uppercase tracking-wider">
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Auto Analysis
                </div>
                <p>AI analyzes <span className="text-white font-bold">Drums</span> or <span className="text-white font-bold">Bass</span> tracks to detect exact BPM and sync click with the song.</p>
              </div>

              {detectedBpm && (
                <div className="flex items-center gap-3 bg-accent-green/5 border border-accent-green/20 rounded-md p-3">
                  <CheckCircle size={16} className="text-accent-green shrink-0" />
                  <span className="text-accent-green font-bold text-xs font-mono uppercase">BPM Detected: <span className="text-white">{detectedBpm}</span></span>
                </div>
              )}

              <button
                onClick={handleAIGenerate}
                disabled={isSynthesizing || !playlistCurrentSong}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-md font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase tracking-wider text-xs shadow-[0_0_15px_rgba(168,85,247,0.2)]"
              >
                {isSynthesizing ? <Loader2 size={18} className="animate-spin" /> : <Cpu size={18} />}
                DETECT BPM & GENERATE
              </button>
            </>
          )}

          {isSynthesizing && statusMsg && (
            <div className="text-center text-[10px] font-bold text-purple-300 animate-pulse font-mono uppercase tracking-wider">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
