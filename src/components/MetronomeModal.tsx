import { useState } from 'react';
import { Settings, Play, Cpu, Keyboard, Loader2, X } from 'lucide-react';
import { analyzeAudioAndGenerateClick, generateManualClickTrack } from '../lib/AudioAnalyzer';
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
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');

  if (!isOpen) return null;

  const handleManualGenerate = async () => {
    if (!playlistCurrentSong) return;
    setIsSynthesizing(true);
    setStatusMsg(`Sintetizando faixa de Metrônomo Manual (${bpm} BPM)...`);

    try {
      const { clickTrackUrl } = await generateManualClickTrack(
        bpm, 
        playlistCurrentSong.duration > 0 ? playlistCurrentSong.duration : 300, 
        setStatusMsg
      );
      
      if (clickTrackUrl) {
        setStatusMsg('Convertendo para inserção...');
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        const file = new File([blob], `Click_Metronomo_${bpm}bpm.wav`, { type: 'audio/wav' });
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
    if (!selectedChannelId) {
      alert("Selecione uma faixa para a IA analisar o BPM.");
      return;
    }

    const channel = playlistCurrentSong.channels.find(c => c.id === selectedChannelId);
    if (!channel || !channel.file) {
      alert("Arquivo de áudio não encontrado na faixa selecionada.");
      return;
    }

    setIsSynthesizing(true);
    setStatusMsg("Preparando arquivo para IA...");

    try {
      const audioUrl = URL.createObjectURL(channel.file);
      const { clickTrackUrl } = await analyzeAudioAndGenerateClick(audioUrl, setStatusMsg);
      
      if (clickTrackUrl) {
        setStatusMsg('Convertendo para inserção...');
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        const file = new File([blob], `Click_Metronomo_IA.wav`, { type: 'audio/wav' });
        onAddClick(file);
        URL.revokeObjectURL(clickTrackUrl);
      }
      URL.revokeObjectURL(audioUrl);
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar metrônomo pela IA.');
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
            <div className="flex justify-center items-center gap-2"><Cpu size={16} /> IA (Analisar)</div>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'manual' ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">BPM (Batidas por Minuto)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="40"
                    max="220"
                    value={bpm}
                    onChange={(e) => setBpm(parseInt(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <div className="w-16 h-10 flex items-center justify-center bg-black/40 border border-white/10 rounded-xl font-mono text-white font-bold">
                    {bpm}
                  </div>
                </div>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex gap-3 text-sm text-primary">
                <Settings size={18} className="shrink-0 mt-0.5" />
                <p>O click manual usa a duração ({playlistCurrentSong ? Math.floor(playlistCurrentSong.duration / 60) + ':' + Math.floor(playlistCurrentSong.duration % 60).toString().padStart(2, '0') : '0:00'}) da música atual.</p>
              </div>

              <button 
                onClick={handleManualGenerate}
                disabled={isSynthesizing || !playlistCurrentSong}
                className="w-full bg-primary hover:bg-emerald-400 text-black py-4 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
              >
                {isSynthesizing ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
                Gerar Metrônomo
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">Faixa Base para a IA analisar o BPM</label>
                <select 
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-colors"
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                >
                  <option value="" disabled>Selecione uma faixa da música...</option>
                  {playlistCurrentSong && playlistCurrentSong.channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-2 ml-1">Para melhores resultados, selecione a Bateria (Drums) ou o Baixo (Bass).</p>
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 flex gap-3 text-sm text-purple-400">
                <Cpu size={24} className="shrink-0 mt-0.5" />
                <p>A IA "music-tempo" tentará descobrir o andamento (BPM) e a primeira batida exata, gerando o click perfeitamente sincronizado.</p>
              </div>

              <button 
                onClick={handleAIGenerate}
                disabled={isSynthesizing || !playlistCurrentSong || !selectedChannelId}
                className="w-full bg-purple-500 hover:bg-purple-400 text-white py-4 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                {isSynthesizing ? <Loader2 size={20} className="animate-spin" /> : <Cpu size={20} />}
                Descobrir BPM & Gerar Click
              </button>
            </div>
          )}

          {isSynthesizing && statusMsg && (
             <div className="mt-4 text-center text-xs font-medium text-emerald-400 animate-pulse">
               {statusMsg}
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
