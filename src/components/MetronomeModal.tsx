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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Gerador de Click</h2>
              <p className="text-xs text-text-muted">Adicione um metrônomo instantaneamente</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSynthesizing} className="text-text-muted hover:text-white transition-colors cursor-pointer">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5 bg-black/10">
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-3 text-sm font-semibold tracking-wide transition-all ${activeTab === 'manual' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:bg-white/5'}`}>
            <div className="flex justify-center items-center gap-2"><Keyboard size={16} /> Manual</div>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 py-3 text-sm font-semibold tracking-wide transition-all ${activeTab === 'ai' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-text-muted hover:bg-white/5'}`}>
            <div className="flex justify-center items-center gap-2"><Cpu size={16} /> Detectar BPM</div>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {activeTab === 'manual' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-3">BPM (Batidas por Minuto)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="40"
                    max="300"
                    value={bpm}
                    onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                    className="flex-1 accent-primary h-2"
                  />
                  <input
                    type="number"
                    min="40"
                    max="300"
                    value={bpmInput}
                    onChange={(e) => handleBpmInputChange(e.target.value)}
                    onBlur={handleBpmInputBlur}
                    className="w-20 h-10 text-center bg-black/40 border border-white/20 rounded-xl font-mono text-white font-bold text-lg focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-all"
                  />
                </div>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex gap-3 text-sm text-primary">
                <Settings size={16} className="shrink-0 mt-0.5" />
                <p>Duração da música: <span className="font-bold">{songDurationStr}</span></p>
              </div>

              <button
                onClick={handleManualGenerate}
                disabled={isSynthesizing || !playlistCurrentSong}
                className="w-full bg-primary hover:bg-emerald-400 text-black py-4 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
              >
                {isSynthesizing ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
                Gerar Metrônomo
              </button>
            </>
          ) : (
            <>
              <div className="bg-black/30 border border-white/10 rounded-xl p-4 text-sm text-text-muted space-y-2">
                <div className="flex items-center gap-2 text-purple-300 font-semibold">
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Análise automática
                </div>
                <p>A IA analisa o ritmo das faixas de <span className="text-white font-medium">Bateria</span> ou <span className="text-white font-medium">Baixo</span> para detectar o BPM exato e sincronizar o click com a música.</p>
              </div>

              {detectedBpm && (
                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl p-3">
                  <CheckCircle size={18} className="text-green-400 shrink-0" />
                  <span className="text-green-300 font-semibold">BPM detectado: <span className="text-white">{detectedBpm}</span></span>
                </div>
              )}

              <button
                onClick={handleAIGenerate}
                disabled={isSynthesizing || !playlistCurrentSong}
                className="w-full bg-purple-500 hover:bg-purple-400 text-white py-4 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                {isSynthesizing ? <Loader2 size={20} className="animate-spin" /> : <Cpu size={20} />}
                Detectar BPM & Gerar Click
              </button>
            </>
          )}

          {isSynthesizing && statusMsg && (
            <div className="text-center text-xs font-medium text-purple-300 animate-pulse">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
