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
      <div className="fixed inset-0 z-50 bg-[#0f0f11] flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-6 left-6 text-gray-400 hover:text-white flex items-center gap-2 cursor-pointer">
          <ChevronLeft size={24}/> Voltar
        </button>
        <div className="max-w-xl w-full text-center">
           <Disc3 size={80} className="mx-auto text-primary mb-6 animate-[spin_10s_linear_infinite]" />
           <h1 className="text-4xl font-black text-white mb-4">DAW Inteligente</h1>
           <p className="text-gray-400 mb-10 text-lg">Envie seu MP3. A Inteligência Artificial separará e mixará todos os instrumentos, descobrirá o Click exato, e gerará um Repertório Profissional de ensaio Muti-canal.</p>
           
           <label className="border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 rounded-3xl p-16 flex flex-col items-center justify-center cursor-pointer transition-colors shadow-[0_0_50px_rgba(16,185,129,0.1)]">
             <UploadCloud size={48} className="text-primary mb-4" />
             <span className="text-xl font-bold text-white">Carregar Áudio e Iniciar</span>
             <span className="text-sm text-gray-500 mt-2">MP3, WAV ou AAC</span>
             <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
           </label>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f0f11] flex flex-col items-center justify-center p-6">
        <Loader2 size={64} className="text-primary animate-spin mb-8" />
        <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-4 text-transparent bg-clip-text bg-gradient-to-r from-primary to-[#059669]">
           Analisando Frequências
        </h2>
        <div className="text-xl text-gray-400 max-w-lg text-center font-medium h-20">{progressMsg}</div>
        <div className="w-full max-w-md bg-gray-900 rounded-full h-3 mt-8 overflow-hidden border border-white/5 shadow-inner">
          <div className="bg-primary h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="text-gray-500 text-sm mt-4 font-mono">{progress}% COMPLETED</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#121214] flex flex-col font-sans select-none overflow-hidden text-gray-200">
      
      {/* HEADER DAW */}
      <header className="h-16 bg-[#09090b] border-b border-white/5 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer text-gray-400">
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <Disc3 size={16} className="text-white" />
             </div>
             <div>
                <h1 className="font-bold text-white text-base leading-tight">Painel Moises (DAW Mode)</h1>
                <h2 className="text-xs font-mono text-gray-500 truncate max-w-xs">{songName}</h2>
             </div>
          </div>
        </div>
        <button 
          onClick={() => setShowSaveForm(true)}
          className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer">
          <Save size={16} /> Exportar
        </button>
      </header>

      {/* CORE WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
         {/* TRACK CONTROLS: ESQUERDA FIXA */}
         <div className="w-[300px] bg-[#18181b] border-r border-[#27272a] flex flex-col overflow-y-auto overflow-x-hidden pt-8 shrink-0 z-10 custom-scrollbar shadow-2xl">
            {stems.map((stem) => {
               const state = stemStates[stem.id];
               if(!state) return null;
               
               return (
                  <div key={`ctrl-${stem.id}`} className="flex flex-col h-[70px] border-b border-[#27272a] px-4 justify-center bg-[#18181b] relative group">
                     {/* Borda indicadora da cor */}
                     <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: stem.color }}></div>
                     
                     <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider pl-2" style={{ color: stem.color }}>{stem.name}</span>
                        <div className="flex gap-1">
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], muted: !p[stem.id].muted } }))}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black cursor-pointer transition-colors ${state.muted ? 'bg-red-500 text-white' : 'bg-[#27272a] text-gray-400 hover:bg-gray-700'}`}>M</button>
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], soloed: !p[stem.id].soloed } }))}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black cursor-pointer transition-colors ${state.soloed ? 'bg-[#f59e0b] text-white' : 'bg-[#27272a] text-gray-400 hover:bg-gray-700'}`}>S</button>
                        </div>
                     </div>
                     <div className="flex items-center gap-3 pl-2">
                        {/* PAN KNOB ALGORITHM VISUAL */}
                        <div className="w-6 h-6 rounded-full border-2 border-[#27272a] flex items-center justify-center relative bg-black shrink-0" 
                             style={{ cursor: 'ew-resize' }}
                             title="Deslize o mouse (L/R) ou clique"
                             onWheel={(e) => {
                                const newPan = Math.max(-1, Math.min(1, state.pan + (e.deltaY > 0 ? -0.1 : 0.1)));
                                setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: newPan } }));
                             }}
                             onClick={() => {
                               // Reset on click
                               setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: 0 } }));
                             }}>
                             {/* Knob pointer */}
                             <div className="w-1 h-3 bg-gray-400 rounded-full origin-bottom absolute top-0.5" 
                                  style={{ transform: `rotate(${state.pan * 45}deg)` }}></div>
                        </div>
                        {/* VOLUME FADER */}
                        <input 
                           type="range" min="0" max="1" step="0.01"
                           value={state.volume}
                           onChange={(e) => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], volume: parseFloat(e.target.value) } }))}
                           className="w-full h-1 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-[#a1a1aa] hover:accent-white transition-all outline-none" 
                        />
                     </div>
                  </div>
               );
            })}
         </div>

         {/* WAVEFORMS: DIREITA */}
         <div className="flex-1 bg-[#09090b] relative overflow-y-auto overflow-x-hidden pt-8">
            {/* Linha Playhead Sync */}
            <div className="absolute top-8 bottom-0 w-px bg-white/70 z-10 pointer-events-none drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]" 
                 style={{ left: `${progressPlayback}%` }}>
                 {/* Traingle na ponta */}
                 <div className="absolute -top-2 left-[-5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-transparent border-t-white"></div>
            </div>

            {stems.map((stem) => (
               <div key={`wavewrap-${stem.id}`} className="h-[70px] border-b border-[#27272a] relative hover:bg-white/5 transition-colors">
                  <div id={`waveform-${stem.id}`} className="absolute w-full top-0 h-full" />
               </div>
            ))}
         </div>
      </div>

      {/* TRANSPORT BAR */}
      <footer className="h-20 bg-[#18181b] border-t border-[#27272a] shrink-0 px-8 flex items-center justify-between z-20 shadow-[0_-5px_30px_rgba(0,0,0,0.5)]">
         <div className="flex-1">
            <span className="text-xs font-mono font-bold text-gray-500 uppercase tracking-widest">{bpm} BPM <span className="mx-2">•</span> {songKey}</span>
         </div>
         <div className="flex gap-6 items-center flex-1 justify-center">
            <button 
               onClick={() => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(0)) }}
               className="text-gray-500 hover:text-white transition-colors cursor-pointer"><ChevronLeft size={24}/></button>
            <button 
               onClick={togglePlay}
               className="w-14 h-14 bg-primary text-black rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.3)] cursor-pointer">
               {isPlaying ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" className="ml-1"/>}
            </button>
            <button className="text-gray-500 transition-colors pointer-events-none opacity-50"><ChevronLeft size={24} className="rotate-180"/></button>
         </div>
         <div className="flex-1 flex items-center justify-end gap-3 px-4">
            <span className="text-gray-500"><Volume2 size={16}/></span>
            <input 
               type="range" min="0" max="1" step="0.01"
               value={masterVolume}
               onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
               className="w-32 h-1 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-primary" 
               title="Master Volume"
            />
         </div>
      </footer>

      {/* SAVE MODAL */}
      {showSaveForm && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl w-full max-w-md p-8 shadow-2xl relative">
             {!isSaving && <button onClick={() => setShowSaveForm(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white cursor-pointer"><X size={20}/></button>}
             
             <h2 className="text-2xl font-black text-white mb-2 tracking-tight">Publicar no Banco</h2>
             <p className="text-gray-400 text-sm mb-6 leading-relaxed">Você está guardando o multitrack de {stems.length} trilhas para sempre na sua Central.</p>
             
             {!isSaving ? (
               <div className="flex flex-col gap-5">
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Música *</label>
                     <input value={songName} onChange={e => setSongName(e.target.value)} 
                       className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                       placeholder="Ex: Lindo És"
                     />
                   </div>
                   <div>
                     <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Artista</label>
                     <input value={artist} onChange={e => setArtist(e.target.value)} 
                       className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                       placeholder="Ex: Livres"
                     />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">BPM I.A.</label>
                     <input type="number" value={bpm} onChange={e => setBpm(e.target.value)} 
                       className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors font-mono"
                     />
                   </div>
                   <div>
                     <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Tom (Chute)</label>
                     <select value={songKey} onChange={e => setSongKey(e.target.value)}
                       className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors appearance-none font-mono">
                       {['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].map(k => <option key={k} value={k}>{k}</option>)}
                     </select>
                   </div>
                 </div>
                  <div className="mt-4">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Imagem de Capa (Opcional)</label>
                    <div className="flex items-center gap-3">
                      <label className="flex flex-1 items-center gap-2 bg-[#09090b] border border-[#27272a] hover:border-primary/50 cursor-pointer rounded-xl px-4 py-3 text-gray-400 text-sm transition-colors overflow-hidden">
                        <UploadCloud size={16} className="text-primary flex-shrink-0" />
                        <span className="truncate">{coverFile ? coverFile.name : 'Selecionar imagem do computador...'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                      </label>
                      {coverFile && (
                        <button onClick={() => setCoverFile(null)} className="p-3 text-gray-500 hover:text-red-400 bg-[#09090b] border border-[#27272a] rounded-xl transition-colors shrink-0">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                 <button onClick={handleSaveToDatabase} className="w-full bg-primary text-black font-bold py-4 rounded-xl mt-4 hover:bg-emerald-400 transition-colors shadow-[0_0_20px_rgba(16,185,129,0.2)] cursor-pointer">
                   Salvar e Oficializar
                 </button>
               </div>
             ) : (
               <div className="flex flex-col items-center py-10">
                  <UploadCloud size={48} className="text-primary animate-pulse mb-6" />
                  <div className="text-white font-bold text-xl mb-2">{saveProgress >= 100 ? 'Feito!' : 'Publicando...'}</div>
                  <div className="text-gray-400 text-sm text-center mb-8 h-6 font-mono">{saveStatus}</div>
                  
                  <div className="w-full bg-[#09090b] rounded-full h-2 overflow-hidden border border-[#27272a]">
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
