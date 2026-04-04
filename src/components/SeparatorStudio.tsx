import React, { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, X, Loader2, UploadCloud, ChevronLeft, Volume2, Save, Disc3 } from 'lucide-react';
import { insertSong, insertStems, type CloudStem } from '../lib/supabase';
import { analyzeAudioAndGenerateClick } from '../lib/AudioAnalyzer';
import { uploadToR2 } from '../lib/r2';

interface StemData {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface SeparatorStudioProps {
  onClose: () => void;
}

let globalAudioCtx: AudioContext | null = null;
function getAudioContext() {
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return globalAudioCtx;
}

export const SeparatorStudio: React.FC<SeparatorStudioProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState<StemData[]>([]);
  
  // Áudio Core
  const [isPlaying, setIsPlaying] = useState(false);
  const wavesurfers = useRef<Record<string, WaveSurfer>>({});
  const panners = useRef<Record<string, StereoPannerNode>>({});
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [progressPlayback, setProgressPlayback] = useState(0);
  
  // Estado das Trilhas
  const [stemStates, setStemStates] = useState<Record<string, { muted: boolean, soloed: boolean, volume: number, pan: number }>>({});

  // Salvamento
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveStatus, setSaveStatus] = useState('');
  
  const [songName, setSongName] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState('120');
  const [songKey, setSongKey] = useState('C');
  const [coverFile, setCoverFile] = useState<File | null>(null);

  // Controle de Master e Mute/Solo
  useEffect(() => {
    const hasSolo = Object.values(stemStates).some(s => s.soloed);
    
    stems.forEach(stem => {
      const state = stemStates[stem.id];
      const ws = wavesurfers.current[stem.id];
      const panner = panners.current[stem.id];
      
      if (ws && state) {
        let finalVol = state.volume * masterVolume;
        if (state.muted) finalVol = 0;
        else if (hasSolo && !state.soloed) finalVol = 0;
        
        ws.setVolume(finalVol);
      }
      
      if (panner && state) {
        panner.pan.value = state.pan;
      }
    });
  }, [stemStates, masterVolume, stems]);

  // Handle Drag & Drop e Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let selected;
    if ('dataTransfer' in e) {
      e.preventDefault();
      selected = e.dataTransfer.files[0];
    } else {
      selected = e.target.files?.[0];
    }
    
    if (selected) {
      setFile(selected);
      setSongName(selected.name.replace(/\.[^/.]+$/, ""));
      await processAudio(selected);
    }
  };

  const processAudio = async (audioFile: File) => {
    setIsProcessing(true);
    setProgress(0);
    setProgressMsg('Iniciando Inteligência Artificial Replicate...');

    try {
      // 1. O Cloudflare tem upload muito mais rápido
      setProgressMsg('Preparando roteamento e enviando arquivo para Nuvem R2...');
      const uploadRes = await uploadToR2('temp', `${Date.now()}_${audioFile.name}`, audioFile);
      if (uploadRes.error) throw new Error(uploadRes.error);
      const publicUrl = uploadRes.url!;
      setProgress(10);

      // 2. Chamar IA
      setProgressMsg('Processando modelo de Separação de Stems em GPU...');
      const res = await fetch('/api/separate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: publicUrl })
      });

      if (!res.ok) throw new Error('Falha ao iniciar IA.');
      const { prediction } = await res.json();
      setProgress(30);
      
      // 3. Polling do Replicate
      let status = prediction.status;
      let finalOutput = null;
      let checkCount = 0;
      
      while (status !== 'succeeded' && status !== 'failed') {
        setProgressMsg(`Extraindo instrumentos (Aguarde o aquecimento das GPUs)... Tentativa ${checkCount}`);
        await new Promise(resolve => setTimeout(resolve, 4000));
        setProgress(p => Math.min(85, p + 2)); 
        checkCount++;
        
        const checkRes = await fetch(`/api/check-separation?predictionId=${prediction.id}`);
        const checkData = await checkRes.json();
        if (checkData.error) throw new Error(checkData.error);
        status = checkData.prediction.status;
        
        if (status === 'succeeded') finalOutput = checkData.prediction.output;
        else if (status === 'failed') throw new Error('Falha no motor de IA.');
      }

      if (!finalOutput) throw new Error("Sem saída da IA.");
      setProgress(90);

      // 4. Detecção de BPM e Sintetização de Metrônomo via Browser!
      // Achamos a track da bateria para melhor precisão
      const drumsUrl = finalOutput.drums || finalOutput.other || finalOutput.base;
      let metronomeUrl = '';
      
      if (drumsUrl) {
         setProgressMsg('Calculando BPM da música no navegador e criando Click Track...');
         const { bpm, clickTrackUrl } = await analyzeAudioAndGenerateClick(drumsUrl, setProgressMsg);
         setBpm(bpm.toString());
         metronomeUrl = clickTrackUrl;
      }

      // Preparando as faixas finais
      const colors: Record<string, string> = {
        vocals: '#06b6d4', drums: '#f59e0b', bass: '#8b5cf6',
        guitar: '#ef4444', piano: '#10b981', other: '#ec4899', click: '#ffffff'
      };
      const translateNames: Record<string, string> = {
        vocals: 'Vocais', drums: 'Bateria', bass: 'Baixo',
        guitar: 'Guitarra', piano: 'Piano/TeCL', other: 'Outros/Fx'
      };

      let stemsArray: StemData[] = [];
      Object.entries(finalOutput).forEach(([key, url]) => {
        if (typeof url === 'string') {
          stemsArray.push({
            id: key, name: translateNames[key] || key.toUpperCase(),
            url: url, color: colors[key] || '#ffffff'
          });
        }
      });
      
      if (metronomeUrl) {
         stemsArray.push({
            id: 'click', name: 'Metrônomo IA',
            url: metronomeUrl, color: '#e2e8f0'
         });
      }

      // Start initial States
      const initialStates: any = {};
      stemsArray.forEach(s => {
        initialStates[s.id] = { muted: false, soloed: false, volume: 1, pan: 0 };
      });
      
      setStemStates(initialStates);
      setStems(stemsArray);
      setProgress(100);
      setIsProcessing(false);

    } catch (e: any) {
      console.error(e);
      alert('⚠️ Erro no processamento: ' + e.message);
      setIsProcessing(false);
      setFile(null);
    }
  };

  // Desenhando UI das formas de onda
  useEffect(() => {
    if (stems.length === 0) return;

    stems.forEach((stem) => {
      const container = document.getElementById(`waveform-${stem.id}`);
      if (!container) return;
      container.innerHTML = '';

      const ws = WaveSurfer.create({
        container,
        waveColor: stem.color + '66', // Com transparência
        progressColor: stem.color,
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 1,
        height: 70,
        normalize: true,
        url: stem.url,
      });

      // Roteamento Web Audio para Panning
      ws.on('ready', () => {
         try {
           const media = ws.getMediaElement();
           // Evitar rotear 2 vezes na mesma tag
           if (!media.dataset.routed) {
             media.dataset.routed = "true";
             const ctx = getAudioContext();
             const source = ctx.createMediaElementSource(media);
             const panner = ctx.createStereoPanner();
             source.connect(panner);
             panner.connect(ctx.destination);
             panners.current[stem.id] = panner;
           }
         } catch (e) { console.warn("Panner error", e) }
      });

      if (stem.id === stems[0].id) {
        ws.on('audioprocess', (time) => {
          setProgressPlayback((time / ws.getDuration()) * 100);
        });
        ws.on('finish', () => {
          setIsPlaying(false);
          setProgressPlayback(0);
        });
      }

      // Sync seeks
      ws.on('interaction', () => {
        const time = ws.getCurrentTime();
        Object.values(wavesurfers.current).forEach(otherWs => {
          if (otherWs !== ws) otherWs.setTime(time);
        });
      });

      wavesurfers.current[stem.id] = ws;
    });

    return () => {
      Object.values(wavesurfers.current).forEach(ws => ws.destroy());
      wavesurfers.current = {};
      panners.current = {};
    };
  }, [stems]);

  // Controles
  const togglePlay = () => {
    // Retomar contexto de áudio suspendido pelo navegador
    if (getAudioContext().state === 'suspended') {
       getAudioContext().resume();
    }
    const action = isPlaying ? 'pause' : 'play';
    Object.values(wavesurfers.current).forEach(ws => ws[action]());
    setIsPlaying(!isPlaying);
  };

  const handleSaveToDatabase = async () => {
    if (!songName) return alert("Preencha o Nome da Música.");

    setIsSaving(true);
    setSaveProgress(0);
    setSaveStatus('Gravando banco de dados...');

    let cover_url = null;
    try {
      if (coverFile) {
         setSaveStatus('Subindo imagem de capa...');
         const cName = `${Date.now()}_${coverFile.name.replace(/\\s+/g, '_')}`;
         const rRes = await uploadToR2('covers', cName, coverFile);
         if (!rRes.error) cover_url = rRes.url;
      }

      const songId = await insertSong({
        name: songName, artist: artist || 'Desconhecido',
        key: songKey, bpm: Number(bpm), cover_url: cover_url
      });

      if (!songId) throw new Error("Falha ao criar música");
      setSaveProgress(10);
      
      const stemsData: Omit<CloudStem, 'id'>[] = [];
      const total = stems.length;

      for (let i = 0; i < stems.length; i++) {
        const stem = stems[i];
        setSaveStatus(`Implantando Nuvem ☁️: ${stem.name} (${i+1}/${total})...`);
        
        const response = await fetch(stem.url);
        const blob = await response.blob();
        const stemFile = new File([blob], `${stem.id}.wav`, { type: blob.type || 'audio/wav' });

        const uploadResult = await uploadToR2('stems', `${songId}/IA_${Date.now()}_${stem.id}.wav`, stemFile);
        if (uploadResult.error || !uploadResult.url) throw new Error(uploadResult.error!);

        stemsData.push({
          song_id: songId, name: stem.id, 
          file_url: uploadResult.url, order: i + 1
        });

        setSaveProgress(10 + Math.floor(((i + 1) / total) * 80));
      }

      setSaveStatus('Sucesso!');
      await insertStems(stemsData);
      setSaveProgress(100);

      setTimeout(() => {
         setIsSaving(false);
         setShowSaveForm(false);
         onClose(); 
      }, 2000);

    } catch (e: any) {
      alert("Erro ao salvar: " + e.message);
      setIsSaving(false);
    }
  };

  if (!file && stems.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-5 left-5 text-text-muted hover:text-white flex items-center gap-1.5 cursor-pointer text-xs font-mono uppercase tracking-wider">
          <ChevronLeft size={18}/> BACK
        </button>
        <div className="max-w-xl w-full text-center">
           <Disc3 size={60} className="mx-auto text-primary mb-5 animate-[spin_10s_linear_infinite]" />
           <h1 className="text-2xl font-black text-white mb-3 uppercase tracking-wider">AI Stem Separator</h1>
           <p className="text-text-muted mb-8 text-xs font-mono leading-relaxed max-w-md mx-auto">Upload your audio. AI will separate and mix all instruments, detect exact BPM, and generate a professional multi-channel rehearsal project.</p>
           
           <label className="border-2 border-dashed border-primary/30 bg-primary/3 hover:bg-primary/5 rounded-lg p-12 flex flex-col items-center justify-center cursor-pointer transition-colors shadow-[0_0_40px_rgba(16,185,129,0.05)]">
             <UploadCloud size={40} className="text-primary mb-3" />
             <span className="text-sm font-black text-white uppercase tracking-wider">Load Audio & Start</span>
             <span className="text-[10px] text-text-muted/50 mt-1.5 font-mono">MP3, WAV, or AAC</span>
             <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
           </label>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col items-center justify-center p-6">
        <Loader2 size={48} className="text-primary animate-spin mb-6" />
        <h2 className="text-xl font-black text-white tracking-widest uppercase mb-3 text-transparent bg-clip-text bg-gradient-to-r from-primary to-[#059669]">
           Analyzing Frequencies
        </h2>
        <div className="text-xs text-text-muted max-w-lg text-center font-mono h-16">{progressMsg}</div>
        <div className="w-full max-w-md bg-surface rounded-full h-1.5 mt-6 overflow-hidden border border-border">
          <div className="bg-primary h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="text-text-muted/50 text-[10px] mt-3 font-mono uppercase tracking-widest">{progress}% COMPLETED</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col font-sans select-none overflow-hidden text-gray-200">
      
      {/* HEADER DAW */}
      <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-md transition-colors cursor-pointer text-text-muted">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
             <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Disc3 size={14} className="text-primary" />
             </div>
             <div>
                <h1 className="font-black text-white text-xs uppercase tracking-wider leading-tight">Stem Separator (DAW)</h1>
                <h2 className="text-[9px] font-mono text-text-muted truncate max-w-xs">{songName}</h2>
             </div>
          </div>
        </div>
        <button 
          onClick={() => setShowSaveForm(true)}
          className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/15 hover:bg-primary/15 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer uppercase tracking-wider">
          <Save size={14} /> EXPORT
        </button>
      </header>

      {/* CORE WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
         {/* TRACK CONTROLS: LEFT FIXED */}
         <div className="w-[280px] bg-surface border-r border-border flex flex-col overflow-y-auto overflow-x-hidden pt-7 shrink-0 z-10 custom-scrollbar">
            {stems.map((stem) => {
               const state = stemStates[stem.id];
               if(!state) return null;
               
               return (
                  <div key={`ctrl-${stem.id}`} className="flex flex-col h-[70px] border-b border-border px-3 justify-center bg-surface relative group">
                     {/* Color indicator border */}
                     <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ backgroundColor: stem.color }}></div>
                     
                     <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider pl-2 font-mono" style={{ color: stem.color }}>{stem.name}</span>
                        <div className="flex gap-0.5">
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], muted: !p[stem.id].muted } }))}
                              className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black cursor-pointer transition-colors ${state.muted ? 'bg-accent-red text-white' : 'bg-black/30 text-text-muted hover:bg-white/10'}`}>M</button>
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], soloed: !p[stem.id].soloed } }))}
                              className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black cursor-pointer transition-colors ${state.soloed ? 'bg-secondary text-black' : 'bg-black/30 text-text-muted hover:bg-white/10'}`}>S</button>
                        </div>
                     </div>
                     <div className="flex items-center gap-2 pl-2">
                        {/* PAN KNOB */}
                        <div className="w-5 h-5 rounded-full border-2 border-border flex items-center justify-center relative bg-black/50 shrink-0" 
                             style={{ cursor: 'ew-resize' }}
                             title="Pan L/R"
                             onWheel={(e) => {
                                const newPan = Math.max(-1, Math.min(1, state.pan + (e.deltaY > 0 ? -0.1 : 0.1)));
                                setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: newPan } }));
                             }}
                             onClick={() => {
                               setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: 0 } }));
                             }}>
                             <div className="w-0.5 h-2.5 bg-text-muted rounded-full origin-bottom absolute top-0.5" 
                                  style={{ transform: `rotate(${state.pan * 45}deg)` }}></div>
                        </div>
                        {/* VOLUME FADER */}
                        <input 
                           type="range" min="0" max="1" step="0.01"
                           value={state.volume}
                           onChange={(e) => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], volume: parseFloat(e.target.value) } }))}
                           className="w-full h-0.5 bg-border rounded-lg appearance-none cursor-pointer accent-[#a1a1aa] hover:accent-white transition-all outline-none" 
                        />
                     </div>
                  </div>
               );
            })}
         </div>

         {/* WAVEFORMS: RIGHT */}
         <div className="flex-1 bg-[#0a0a0c] relative overflow-y-auto overflow-x-hidden pt-7">
            {/* Playhead Sync Line */}
            <div className="absolute top-7 bottom-0 w-px bg-white/60 z-10 pointer-events-none drop-shadow-[0_0_3px_rgba(255,255,255,0.6)]" 
                 style={{ left: `${progressPlayback}%` }}>
                 <div className="absolute -top-1.5 left-[-4px] w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-transparent border-t-white"></div>
            </div>

            {stems.map((stem) => (
               <div key={`wavewrap-${stem.id}`} className="h-[70px] border-b border-border relative hover:bg-white/3 transition-colors">
                  <div id={`waveform-${stem.id}`} className="absolute w-full top-0 h-full" />
               </div>
            ))}
         </div>
      </div>

      {/* TRANSPORT BAR */}
      <footer className="h-16 bg-surface border-t border-border shrink-0 px-6 flex items-center justify-between z-20">
         <div className="flex-1">
            <span className="text-[10px] font-mono font-black text-text-muted uppercase tracking-widest">{bpm} BPM <span className="mx-1.5 text-border">|</span> {songKey}</span>
         </div>
         <div className="flex gap-4 items-center flex-1 justify-center">
            <button 
               onClick={() => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(0)) }}
               className="text-text-muted hover:text-white transition-colors cursor-pointer"><ChevronLeft size={20}/></button>
            <button 
               onClick={togglePlay}
               className="w-12 h-12 bg-primary text-black rounded-md flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.2)] cursor-pointer">
               {isPlaying ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor" className="ml-0.5"/>}
            </button>
            <button className="text-text-muted/30 transition-colors pointer-events-none"><ChevronLeft size={20} className="rotate-180"/></button>
         </div>
         <div className="flex-1 flex items-center justify-end gap-2 px-3">
            <span className="text-text-muted"><Volume2 size={14}/></span>
            <input 
               type="range" min="0" max="1" step="0.01"
               value={masterVolume}
               onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
               className="w-28 h-0.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary" 
               title="Master Volume"
            />
         </div>
      </footer>

      {/* SAVE MODAL */}
      {showSaveForm && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="daw-panel w-full max-w-md p-6 rounded-lg relative">
             {!isSaving && <button onClick={() => setShowSaveForm(false)} className="absolute top-3 right-3 text-text-muted hover:text-white cursor-pointer"><X size={16}/></button>}
             
             <h2 className="text-lg font-black text-white mb-1.5 uppercase tracking-wider">Publish to Cloud</h2>
             <p className="text-text-muted text-[10px] mb-5 font-mono">Saving {stems.length}-track multitrack project to your library.</p>
             
             {!isSaving ? (
               <div className="flex flex-col gap-4">
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Song *</label>
                     <input value={songName} onChange={e => setSongName(e.target.value)} 
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                       placeholder="e.g. Beautiful"
                     />
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Artist</label>
                     <input value={artist} onChange={e => setArtist(e.target.value)} 
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                       placeholder="e.g. Hillsong"
                     />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">BPM (AI)</label>
                     <input type="number" value={bpm} onChange={e => setBpm(e.target.value)} 
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                     />
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Key</label>
                     <select value={songKey} onChange={e => setSongKey(e.target.value)}
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono appearance-none">
                       {['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].map(k => <option key={k} value={k}>{k}</option>)}
                     </select>
                   </div>
                 </div>
                  <div className="mt-1">
                    <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Cover Image (Optional)</label>
                    <div className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 daw-input rounded-md px-3 py-2 cursor-pointer text-text-muted text-xs font-mono overflow-hidden">
                        <UploadCloud size={14} className="text-primary flex-shrink-0" />
                        <span className="truncate">{coverFile ? coverFile.name : 'Select image...'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                      </label>
                      {coverFile && (
                        <button onClick={() => setCoverFile(null)} className="p-2 text-text-muted hover:text-accent-red daw-input rounded-md transition-colors shrink-0">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                 <button onClick={handleSaveToDatabase} className="w-full bg-primary text-black font-black py-3 rounded-md mt-3 uppercase tracking-wider text-xs active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)] cursor-pointer">
                   SAVE & PUBLISH
                 </button>
               </div>
             ) : (
               <div className="flex flex-col items-center py-8">
                  <UploadCloud size={36} className="text-primary animate-pulse mb-4" />
                  <div className="text-white font-black text-sm uppercase tracking-wider mb-1">{saveProgress >= 100 ? 'DONE!' : 'PUBLISHING...'}</div>
                  <div className="text-text-muted text-[10px] text-center mb-6 h-5 font-mono">{saveStatus}</div>
                  
                  <div className="w-full lcd-display rounded-md h-1.5 overflow-hidden">
                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${saveProgress}%` }}></div>
                  </div>
               </div>
             )}
          </div>
        </div>
      )}
    </div>
  );
};
