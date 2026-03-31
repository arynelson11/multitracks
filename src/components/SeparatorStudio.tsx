import React, { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, X, Loader2, UploadCloud, ChevronLeft, Volume2, VolumeX } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface StemData {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface SeparatorStudioProps {
  onClose: () => void;
  onImportToLibrary: (stems: any) => void;
}

export const SeparatorStudio: React.FC<SeparatorStudioProps> = ({ onClose, onImportToLibrary }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState<StemData[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Stem State (Mute, Solo, Volume)
  const [stemStates, setStemStates] = useState<Record<string, { muted: boolean, soloed: boolean, volume: number }>>({});

  const wavesurfers = useRef<Record<string, WaveSurfer>>({});
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 1. Upload File & Request Separation
  const handleUpload = async () => {
    if (!file) return;
    setIsProcessing(true);
    setProgress(5);

    try {
      // a. Upload local file to Supabase Temp Bucket (ensure a bucket named 'temp_audio' exists or use existing)
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase!.storage.from('stems').upload(`temp/${fileName}`, file);
      
      if (error) throw new Error('Erro no upload: ' + error.message);
      
      setProgress(20);

      // Get public URL
      const { data: { publicUrl } } = supabase!.storage.from('stems').getPublicUrl(`temp/${fileName}`);
      
      setProgress(40);

      // b. Call Vercel API to Replicate (Async job creation)
      const res = await fetch('/api/separate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: publicUrl })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao iniciar IA.');
      }

      const { prediction } = await res.json();
      setProgress(50);
      
      // c. Polling loop
      let status = prediction.status;
      let finalOutput = null;
      
      while (status !== 'succeeded' && status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 3000)); // wait 3s
        // Update progress visually to show it's working
        setProgress(p => (p < 90 ? p + 2 : p)); 
        
        const checkRes = await fetch(`/api/check-separation?predictionId=${prediction.id}`);
        const checkData = await checkRes.json();
        if (checkData.error) throw new Error(checkData.error);
        
        status = checkData.prediction.status;
        if (status === 'succeeded') {
          finalOutput = checkData.prediction.output;
        } else if (status === 'failed') {
          throw new Error('Processamento na IA falhou.');
        }
      }

      if (!finalOutput) throw new Error("Sem saída da IA.");

      setProgress(95);

      const colors: Record<string, string> = {
        vocals: '#06b6d4',
        drums: '#f59e0b',
        bass: '#8b5cf6',
        guitar: '#ef4444',
        piano: '#10b981',
        other: '#ec4899',
      };

      const translateNames: Record<string, string> = {
        vocals: 'Vocais',
        drums: 'Bateria',
        bass: 'Baixo',
        guitar: 'Guitarra',
        piano: 'Piano/Teclado',
        other: 'Outros Snt/Fx',
      };

      let stemsArray: StemData[] = [];
      Object.entries(finalOutput).forEach(([key, url]) => {
        if (typeof url === 'string') {
          stemsArray.push({
            id: key,
            name: translateNames[key] || key.toUpperCase(),
            url: url,
            color: colors[key] || '#ffffff'
          });
        }
      });

      // Initialize states
      const initialStates: any = {};
      stemsArray.forEach(s => {
        initialStates[s.id] = { muted: false, soloed: false, volume: 1 };
      });
      setStemStates(initialStates);
      setStems(stemsArray);
      setProgress(100);
      setIsProcessing(false);

    } catch (error: any) {
      console.error(error);
      alert('Erro: ' + error.message);
      setIsProcessing(false);
      setProgress(0);
    }
  };

  // 2. Initialize Wavesurfers when stems are loaded
  useEffect(() => {
    if (stems.length === 0) return;

    stems.forEach((stem) => {
      if (containerRefs.current[stem.id] && !wavesurfers.current[stem.id]) {
        const ws = WaveSurfer.create({
          container: containerRefs.current[stem.id]!,
          waveColor: `${stem.color}60`,
          progressColor: stem.color,
          cursorColor: '#ffffff',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 80,
          normalize: true,
          hideScrollbar: true,
          interact: true, // Only master or all interactive (we sync them later)
        });

        ws.load(stem.url);
        wavesurfers.current[stem.id] = ws;

        // Syncing interactions: when any wavesurfer changes position, update others
        ws.on('interaction', (newTime) => {
          Object.values(wavesurfers.current).forEach(otherWs => {
            if (otherWs !== ws) {
              otherWs.setTime(newTime);
            }
          });
        });

        ws.on('finish', () => {
          setIsPlaying(false);
        });
      }
    });

    return () => {
      Object.values(wavesurfers.current).forEach(ws => ws.destroy());
      wavesurfers.current = {};
    };
  }, [stems]);

  // Sync states whenever stems UI changes
  useEffect(() => {
    if (stems.length === 0) return;

    const anySoloed = Object.values(stemStates).some(s => s.soloed);

    stems.forEach(stem => {
      const ws = wavesurfers.current[stem.id];
      const state = stemStates[stem.id];
      if (ws && state) {
        // Mute logic
        const shouldMute = state.muted || (anySoloed && !state.soloed);
        ws.setVolume(shouldMute ? 0 : state.volume);
      }
    });
  }, [stemStates, stems]);

  const togglePlay = () => {
    if (!isPlaying) {
      Object.values(wavesurfers.current).forEach(ws => ws.play());
      setIsPlaying(true);
    } else {
      Object.values(wavesurfers.current).forEach(ws => ws.pause());
      setIsPlaying(false);
    }
  };

  // UI Handlers
  const toggleMute = (id: string) => setStemStates(p => ({ ...p, [id]: { ...p[id], muted: !p[id].muted } }));
  const toggleSolo = (id: string) => setStemStates(p => ({ ...p, [id]: { ...p[id], soloed: !p[id].soloed } }));
  const setVolume = (id: string, vol: number) => setStemStates(p => ({ ...p, [id]: { ...p[id], volume: vol } }));

  // Render Initial View (Upload)
  if (stems.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col pt-14">
        <header className="absolute top-0 w-full h-14 border-b border-white/5 bg-surface flex items-center px-4 justify-between">
          <div className="flex items-center gap-2 text-white font-bold">
             <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors"><ChevronLeft size={20}/></button>
             Studio Inteligente (IA)
          </div>
          <button onClick={onClose} className="p-2 text-text-muted hover:text-white transition-colors cursor-pointer"><X size={20}/></button>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface border border-white/10 rounded-2xl p-8 flex flex-col items-center shadow-2xl">
            <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mb-6 text-primary shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <SparklesIcon />
            </div>
            <h2 className="text-xl font-bold text-white mb-2text-center text-center">Separação de Áudio (Demucs)</h2>
            <p className="text-text-muted text-sm text-center mb-8">
              Nossa IA de ponta consegue isolar perfeitamente Bateria, Baixo, Guitarra, Piano, Vocais e mais de qualquer música.
            </p>

            {!isProcessing ? (
              <>
                <label className="w-full flex-1 border-2 border-dashed border-white/20 hover:border-primary/50 bg-black/40 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-white/5">
                  <UploadCloud size={32} className="text-text-muted mb-3" />
                  <span className="text-white font-medium mb-1">
                    {file ? file.name : "Clique para selecionar um áudio"}
                  </span>
                  <span className="text-xs text-text-muted">.MP3, .WAV (max 20MB)</span>
                  <input type="file" accept="audio/*" className="hidden" onChange={e => e.target.files && setFile(e.target.files[0])} />
                </label>
                
                <button 
                  onClick={handleUpload}
                  disabled={!file}
                  className="w-full mt-6 py-3 bg-primary text-black font-bold rounded-xl disabled:opacity-50 hover:bg-emerald-400 transition-colors cursor-pointer"
                >
                  Processar com Inteligência Artificial
                </button>
              </>
            ) : (
              <div className="w-full flex flex-col items-center gap-4 py-8">
                <Loader2 size={32} className="text-primary animate-spin" />
                <div className="text-primary font-bold tracking-widest text-sm uppercase animate-pulse">
                  Processando Música
                </div>
                <div className="w-full bg-black/60 rounded-full h-2 mt-2 border border-white/10 overflow-hidden">
                  <div className="bg-primary h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
                <p className="text-xs text-text-muted text-center mt-2 max-w-[200px]">
                  Isso pode levar até 2 minutos dependendo do tamanho da música e disponibilidade da GPU.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render Studio View (Moises Clone)
  return (
    <div className="fixed inset-0 z-50 bg-[#121212] flex flex-col text-white">
      {/* HEADER */}
      <header className="h-16 border-b border-white/5 bg-[#18181b] flex items-center justify-between px-6 shrink-0 shadow-lg relative z-10">
        <div className="flex items-center gap-4">
           <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors text-text-muted hover:text-white cursor-pointer"><ChevronLeft size={24}/></button>
           <h1 className="text-lg font-bold truncate max-w-[200px] sm:max-w-md">{file?.name || "Música em Processo"}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              // Extract to library action
              const libraryStems = stems.map(s => ({
                 name: s.name,
                 url: s.url,
                 bus: s.id === 'vocals' ? '1' : s.id === 'drums' ? '2' : '0' // Default mapping
              }));
              onImportToLibrary(libraryStems);
              onClose();
            }}
            className="flex items-center gap-2 bg-transparent border border-white/20 hover:bg-white/5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer">
            Exportar Stems
          </button>
        </div>
      </header>

      {/* TRACKS LIST */}
      <main className="flex-1 overflow-y-auto px-6 py-6 pb-32">
        <div className="flex flex-col gap-4 max-w-7xl mx-auto">
          {stems.map((stem) => {
             const state = stemStates[stem.id] || { muted: false, soloed: false, volume: 1 };
             return (
               <div key={stem.id} className="flex flex-col sm:flex-row items-stretch gap-4 bg-[#1e1e21] rounded-xl border border-white/5 overflow-hidden shadow-md">
                 
                 {/* Left Controls (Similar to Moises) */}
                 <div className="w-full sm:w-64 bg-[#1e1e21] border-b sm:border-b-0 sm:border-r border-white/5 flex flex-col p-4 shrink-0 justify-between">
                   <div className="flex items-center justify-between mb-4">
                     <span className="font-bold text-sm" style={{ color: stem.color }}>{stem.name}</span>
                     <div className="flex bg-black/40 rounded-lg overflow-hidden border border-white/5">
                        <button 
                          onClick={() => toggleMute(stem.id)}
                          className={`px-3 py-1 text-xs font-bold transition-colors cursor-pointer border-r border-white/5 ${state.muted ? 'bg-white/20 text-white' : 'text-text-muted hover:bg-white/10'}`}>M</button>
                        <button 
                          onClick={() => toggleSolo(stem.id)}
                          className={`px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${state.soloed ? 'bg-yellow-500/20 text-yellow-500' : 'text-text-muted hover:bg-white/10'}`}>S</button>
                     </div>
                   </div>
                   
                   <div className="flex items-center gap-3">
                     {state.volume === 0 || state.muted ? <VolumeX size={16} className="text-text-muted shrink-0"/> : <Volume2 size={16} className="text-text-muted shrink-0"/>}
                     <input 
                       type="range" min="0" max="1" step="0.01" 
                       value={state.volume} 
                       onChange={(e) => setVolume(stem.id, parseFloat(e.target.value))}
                       className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full"
                       style={{ accentColor: stem.color }}
                     />
                   </div>
                 </div>

                 {/* Waveform Visualization */}
                 <div className="flex-1 relative h-20 sm:h-auto bg-[#1a1a1c] p-2 flex items-center">
                    <div className="absolute inset-0 z-0 h-full w-full pointer-events-auto" ref={(el) => { containerRefs.current[stem.id] = el; }}></div>
                 </div>
               </div>
             );
          })}
        </div>
      </main>

      {/* BOTTOM TRANSPORT */}
      <footer className="h-20 border-t border-white/5 bg-[#18181b] fixed bottom-0 w-full flex items-center justify-center shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20">
         <div className="flex items-center gap-6">
            <button className="text-text-muted hover:text-white transition-colors cursor-pointer"><ChevronLeft size={24} className="opacity-50"/></button>
            <button 
               onClick={togglePlay}
               className="w-14 h-14 bg-white hover:bg-gray-200 text-black rounded-full flex items-center justify-center transition-transform active:scale-95 shadow-xl cursor-pointer">
               {isPlaying ? <Pause size={28} fill="currentColor"/> : <Play size={28} fill="currentColor" className="ml-1"/>}
            </button>
            <button className="text-text-muted hover:text-white transition-colors cursor-pointer"><ChevronLeft size={24} className="opacity-50 rotate-180"/></button>
         </div>
      </footer>
    </div>
  );
};

// Utility Icon
const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
  </svg>
);
