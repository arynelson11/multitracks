import React, { useState, useRef, useEffect, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, X, Loader2, UploadCloud, ChevronLeft, ChevronRight, Volume2, Save, Disc3, Minus, Plus, Mic } from 'lucide-react';
import { uploadToR2 } from '../lib/r2';
import { useAuth } from '../hooks/useAuth';
import { PricingModal } from './PricingModal';
import { generateManualClickTrackFromSample } from '../lib/AudioAnalyzer';
import { CLICK_TYPES, CLICK_SUBDIVISIONS, loadClickSelection, saveClickSelection, getClickSampleUrl } from '../lib/clickLibrary';

interface StemData {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface VoiceCue {
  id: string;
  time: number;
  label: string;
  file: string;
}

const GUIDE_SECTIONS: { label: string; file: string }[] = [
  { label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' },
  { label: 'Verso', file: 'Song Sections/Portugese - Verse.wav' },
  { label: 'Verso 1', file: 'Song Sections/Portugese - Verse 1.wav' },
  { label: 'Verso 2', file: 'Song Sections/Portugese - Verse 2.wav' },
  { label: 'Verso 3', file: 'Song Sections/Portugese - Verse 3.wav' },
  { label: 'Verso 4', file: 'Song Sections/Portugese - Verse 4.wav' },
  { label: 'Verso 5', file: 'Song Sections/Portugese - Verse 5.wav' },
  { label: 'Verso 6', file: 'Song Sections/Portugese - Verse 6.wav' },
  { label: 'Pré-Refrão', file: 'Song Sections/Portugese - Pre Chorus.wav' },
  { label: 'Pré-Refrão 1', file: 'Song Sections/Portugese - Pre Chorus 1.wav' },
  { label: 'Pré-Refrão 2', file: 'Song Sections/Portugese - Pre Chorus 2.wav' },
  { label: 'Pré-Refrão 3', file: 'Song Sections/Portugese - Pre Chorus 3.wav' },
  { label: 'Pré-Refrão 4', file: 'Song Sections/Portugese - Pre Chorus 4.wav' },
  { label: 'Refrão', file: 'Song Sections/Portugese - Chorus.wav' },
  { label: 'Refrão 1', file: 'Song Sections/Portugese - Chorus 1.wav' },
  { label: 'Refrão 2', file: 'Song Sections/Portugese - Chorus 2.wav' },
  { label: 'Refrão 3', file: 'Song Sections/Portugese - Chorus 3.wav' },
  { label: 'Refrão 4', file: 'Song Sections/Portugese - Chorus 4.wav' },
  { label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' },
  { label: 'Ponte 1', file: 'Song Sections/Portugese - Bridge 1.wav' },
  { label: 'Ponte 2', file: 'Song Sections/Portugese - Bridge 2.wav' },
  { label: 'Ponte 3', file: 'Song Sections/Portugese - Bridge 3.wav' },
  { label: 'Ponte 4', file: 'Song Sections/Portugese - Bridge 4.wav' },
  { label: 'Pós-Refrão', file: 'Song Sections/Portugese - Post Chorus.wav' },
  { label: 'Breakdown', file: 'Song Sections/Portugese - Breakdown.wav' },
  { label: 'Interlúdio', file: 'Song Sections/Portugese - Interlude.wav' },
  { label: 'Outro', file: 'Song Sections/Portugese - Outro.wav' },
  { label: 'Final', file: 'Song Sections/Portugese - Ending.wav' },
  { label: 'Acapella', file: 'Song Sections/Portugese - Acapella.wav' },
  { label: 'Solo', file: 'Song Sections/Portugese - Solo.wav' },
  { label: 'Refrain', file: 'Song Sections/Portugese - Refrain.wav' },
  { label: 'Rap', file: 'Song Sections/Portugese - Rap.wav' },
  { label: 'Tag', file: 'Song Sections/Portugese - Tag.wav' },
  { label: 'Virada', file: 'Song Sections/Portugese - Turnaround.wav' },
  { label: 'Vamp', file: 'Song Sections/Portugese - Vamp.wav' },
  { label: 'Exortação', file: 'Song Sections/Portugese - Exhortation.wav' },
  { label: 'Instrumental', file: 'Song Sections/Portugese - Instrumental.wav' },
  { label: '1', file: 'Song Sections/Portugese - 1.wav' },
  { label: '2', file: 'Song Sections/Portugese - 2.wav' },
  { label: '3', file: 'Song Sections/Portugese - 3.wav' },
  { label: '4', file: 'Song Sections/Portugese - 4.wav' },
  { label: '5', file: 'Song Sections/Portugese - 5.wav' },
  { label: '6', file: 'Song Sections/Portugese - 6.wav' },
];

const GUIDE_DYNAMICS: { label: string; file: string }[] = [
  { label: 'All In', file: 'Dynamic Cues/Portugese - All In.wav' },
  { label: 'Baixo', file: 'Dynamic Cues/Portugese - Bass.wav' },
  { label: 'Grande Final', file: 'Dynamic Cues/Portugese - Big Ending.wav' },
  { label: 'Break', file: 'Dynamic Cues/Portugese - Break.wav' },
  { label: 'Breakdown', file: 'Dynamic Cues/Portugese - Breakdown.wav' },
  { label: 'Build', file: 'Dynamic Cues/Portugese - Build.wav' },
  { label: 'Canal', file: 'Dynamic Cues/Portugese - Channel.wav' },
  { label: 'Click', file: 'Dynamic Cues/Portugese - Click.wav' },
  { label: 'Bateria Entra', file: 'Dynamic Cues/Portugese - Drums In.wav' },
  { label: 'Bateria', file: 'Dynamic Cues/Portugese - Drums.wav' },
  { label: 'Exortação', file: 'Dynamic Cues/Portugese - Exhortation.wav' },
  { label: 'Guitarra', file: 'Dynamic Cues/Portugese - Guitar.wav' },
  { label: 'Hits', file: 'Dynamic Cues/Portugese - Hits.wav' },
  { label: 'Hold', file: 'Dynamic Cues/Portugese - Hold.wav' },
  { label: 'Tom Abaixa', file: 'Dynamic Cues/Portugese - Key Change Down.wav' },
  { label: 'Tom Sobe', file: 'Dynamic Cues/Portugese - Key Change Up.wav' },
  { label: 'Teclado', file: 'Dynamic Cues/Portugese - Keys.wav' },
  { label: 'Última Vez', file: 'Dynamic Cues/Portugese - Last Time.wav' },
  { label: 'Pad', file: 'Dynamic Cues/Portugese - Pad.wav' },
  { label: 'Crescendo', file: 'Dynamic Cues/Portugese - Slowly Build.wav' },
  { label: 'Suave', file: 'Dynamic Cues/Portugese - Softly.wav' },
  { label: 'Swell', file: 'Dynamic Cues/Portugese - Swell.wav' },
];

function guideUrl(file: string): string {
  return `/Portugese Guides/${file}`.split('/').map(s => encodeURIComponent(s)).join('/');
}

function formatCueTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  const { user, userPlan } = useAuth();
  const isAdmin = user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com';
  const [publishGlobal, setPublishGlobal] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState<StemData[]>([]);
  
  // Áudio Core
  const [isPlaying, setIsPlaying] = useState(false);
  const wavesurfers = useRef<Record<string, WaveSurfer>>({});
  const panners = useRef<Record<string, StereoPannerNode>>({});
  const gainNodes = useRef<Record<string, GainNode>>({});
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

  const [showBpmModal, setShowBpmModal] = useState(false);
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false);
  const [isGeneratingClick, setIsGeneratingClick] = useState(false);
  const [clickSel, setClickSel] = useState(() => loadClickSelection());

  const updateClickSel = (partial: Partial<typeof clickSel>) => {
    const next = { ...clickSel, ...partial };
    setClickSel(next);
    saveClickSelection(next);
    // preview
    (async () => {
      try {
        const url = getClickSampleUrl(next.type, next.subdivision);
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const ab = await (await fetch(url)).arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start();
        setTimeout(() => ctx.close(), 2000);
      } catch { /* ignore */ }
    })();
  };

  // Voz Guia
  const [voiceCues, setVoiceCues] = useState<VoiceCue[]>([]);
  const [showVoiceGuide, setShowVoiceGuide] = useState(false);
  const [voiceGuideTab, setVoiceGuideTab] = useState<'sections' | 'dynamic'>('sections');
  const [songDuration, setSongDuration] = useState(0);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const voiceCuesRef = useRef<(VoiceCue & { fired: boolean })[]>([]);
  const guideBufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  const cueRafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const getTempoName = (b: number) => {
    if (b < 60) return 'Largo';
    if (b < 76) return 'Adagio';
    if (b < 108) return 'Andante';
    if (b < 112) return 'Moderato';
    if (b < 120) return 'Allegretto';
    if (b < 156) return 'Allegro';
    if (b < 176) return 'Vivace';
    return 'Presto';
  };

  // Metronome Sync Nudge
  const [clickOffsetMs, setClickOffsetMsState] = useState(0);
  const offsetRef = useRef(0);
  const setClickOffsetMs = (val: number | ((v: number) => number)) => {
     setClickOffsetMsState(prev => {
        const next = typeof val === 'function' ? val(prev) : val;
        offsetRef.current = next;
        
        // Apply immediately
        const clickWs = wavesurfers.current['click'];
        const masterWs = wavesurfers.current[stems.find(s => s.id !== 'click')?.id || ''];
        if (clickWs && masterWs) {
           const masterTime = masterWs.getCurrentTime();
           clickWs.setTime(Math.max(0, masterTime - (next / 1000)));
        }
        return next;
     });
  };

  const playGuideBuffer = useCallback(async (file: string) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const url = guideUrl(file);
    let buffer = guideBufferCache.current.get(url);
    if (!buffer) {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(ab);
        guideBufferCache.current.set(url, buffer);
      } catch (e) {
        console.error('Voz Guia: erro ao carregar áudio:', url, e);
        return;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  }, []);

  const addVoiceCue = (label: string, file: string) => {
    const firstWs = Object.values(wavesurfers.current)[0];
    const time = firstWs ? firstWs.getCurrentTime() : 0;
    const newCue: VoiceCue = { id: `${Date.now()}`, time, label, file };
    setVoiceCues(prev => [...prev, newCue].sort((a, b) => a.time - b.time));
  };

  const removeVoiceCue = (id: string) => {
    setVoiceCues(prev => prev.filter(c => c.id !== id));
    voiceCuesRef.current = voiceCuesRef.current.filter(c => c.id !== id);
  };

  const autoDetectVoiceGuide = async () => {
    setIsAutoDetecting(true);
    try {
      const ctx = getAudioContext();
      let buffer: AudioBuffer;

      if (file) {
        const ab = await file.arrayBuffer();
        buffer = await ctx.decodeAudioData(ab);
      } else {
        const mainStem = stems.find(s => s.id !== 'click' && s.id !== 'metronome');
        if (!mainStem) throw new Error('Sem faixas para analisar');
        const res = await fetch(mainStem.url);
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      }

      const CHUNK_SECS = 4;
      const chunkSamples = CHUNK_SECS * buffer.sampleRate;
      const numChunks = Math.floor(buffer.duration / CHUNK_SECS);

      // Mix to mono
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
      }

      // RMS per chunk
      const rms: number[] = [];
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSamples;
        const end = Math.min(start + chunkSamples, mono.length);
        let sum = 0;
        for (let s = start; s < end; s++) sum += mono[s] * mono[s];
        rms.push(Math.sqrt(sum / (end - start)));
      }

      const maxRms = Math.max(...rms, 0.001);
      const norm = rms.map(v => v / maxRms);

      // Smooth (±3 chunks = ±12s window)
      const SMOOTH = 3;
      const smoothed = norm.map((_, i) => {
        const sl = norm.slice(Math.max(0, i - SMOOTH), Math.min(norm.length, i + SMOOTH + 1));
        return sl.reduce((a, b) => a + b, 0) / sl.length;
      });

      // Detect boundaries: significant energy change between consecutive windows
      const MIN_GAP = Math.max(4, Math.floor(20 / CHUNK_SECS)); // min 20s between sections
      const THRESHOLD = 0.1;

      const chunkEnergy = (chunk: number) => {
        const sl = smoothed.slice(chunk, Math.min(numChunks, chunk + MIN_GAP));
        return sl.reduce((a, b) => a + b, 0) / sl.length;
      };

      const boundaries: { time: number; energy: number }[] = [{ time: 0, energy: chunkEnergy(0) }];

      for (let i = MIN_GAP; i < numChunks - 2; i++) {
        const lastChunk = Math.floor(boundaries[boundaries.length - 1].time / CHUNK_SECS);
        if (i - lastChunk < MIN_GAP) continue;
        const before = smoothed.slice(Math.max(0, i - MIN_GAP), i).reduce((a, b) => a + b, 0) / MIN_GAP;
        const after = smoothed.slice(i, Math.min(numChunks, i + MIN_GAP)).reduce((a, b) => a + b, 0) / MIN_GAP;
        if (Math.abs(after - before) > THRESHOLD) {
          boundaries.push({ time: i * CHUNK_SECS, energy: chunkEnergy(i) });
        }
      }

      // Cap at 10 sections — remove smallest transitions
      while (boundaries.length > 10) {
        let minIdx = 1;
        let minDiff = Infinity;
        for (let i = 1; i < boundaries.length - 1; i++) {
          const diff = Math.abs(boundaries[i].energy - boundaries[i - 1].energy)
                     + Math.abs(boundaries[i].energy - boundaries[i + 1].energy);
          if (diff < minDiff) { minDiff = diff; minIdx = i; }
        }
        boundaries.splice(minIdx, 1);
      }

      const allE = boundaries.map(b => b.energy);
      const minE = Math.min(...allE);
      const range = Math.max(...allE) - minE || 1;

      // Label by energy tier
      let verseCount = 0, chorusCount = 0, bridgeCount = 0;

      const detectedCues: VoiceCue[] = boundaries.map((b, idx) => {
        const normE = (b.energy - minE) / range;
        let label: string;
        let filePath: string;

        if (idx === 0) {
          label = 'Intro';
          filePath = 'Song Sections/Portugese - Intro.wav';
        } else if (idx === boundaries.length - 1) {
          label = 'Final';
          filePath = 'Song Sections/Portugese - Ending.wav';
        } else if (normE >= 0.65) {
          chorusCount++;
          const n = Math.min(chorusCount, 4);
          label = `Refrão ${chorusCount}`;
          filePath = `Song Sections/Portugese - Chorus ${n}.wav`;
        } else if (normE <= 0.25) {
          bridgeCount++;
          label = bridgeCount === 1 ? 'Ponte' : 'Breakdown';
          filePath = bridgeCount === 1 ? 'Song Sections/Portugese - Bridge.wav' : 'Song Sections/Portugese - Breakdown.wav';
        } else {
          verseCount++;
          const n = Math.min(verseCount, 6);
          label = `Verso ${verseCount}`;
          filePath = `Song Sections/Portugese - Verse ${n}.wav`;
        }

        return { id: `auto-${Date.now()}-${idx}`, time: b.time, label, file: filePath };
      });

      setVoiceCues(detectedCues);
    } catch (e: any) {
      console.error('Auto-detect erro:', e);
      alert('Não foi possível analisar a estrutura: ' + e.message);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const loadMockData = () => {
    setIsProcessing(true);
    setProgress(100);
    setSongName('Mock Test Track');
    setBpm('120');
    setSongKey('C');
    
    const mockAudio = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
    const clickAudio = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3';
    
    const stemsArray: StemData[] = [
      { id: 'drums', name: 'Bateria', url: mockAudio, color: '#f59e0b' },
      { id: 'bass', name: 'Baixo', url: mockAudio, color: '#8b5cf6' },
      { id: 'vocals', name: 'Vocais', url: mockAudio, color: '#06b6d4' },
      { id: 'other', name: 'Outros/Fx', url: mockAudio, color: '#ec4899' },
      { id: 'click', name: 'Metrônomo IA', url: clickAudio, color: '#e2e8f0' }
    ];

    const initialStates: any = {};
    stemsArray.forEach(s => {
      initialStates[s.id] = { muted: false, soloed: false, volume: 1, pan: 0 };
    });
    
    setStemStates(initialStates);
    setStems(stemsArray);
    setIsProcessing(false);
  };

  // Controle de Master e Mute/Solo via GainNode (garante funcionamento no Safari)
  useEffect(() => {
    const hasSolo = Object.values(stemStates).some(s => s.soloed);
    const ctx = getAudioContext();

    stems.forEach(stem => {
      const state = stemStates[stem.id];
      const gainNode = gainNodes.current[stem.id];
      const panner = panners.current[stem.id];

      if (gainNode && state) {
        let finalVol = state.volume * masterVolume;
        if (state.muted) finalVol = 0;
        else if (hasSolo && !state.soloed) finalVol = 0;

        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setValueAtTime(finalVol, ctx.currentTime);
      }

      if (panner && state) {
        panner.pan.value = state.pan;
      }
    });
  }, [stemStates, masterVolume, stems]);

  // Sincroniza voiceCuesRef com state preservando fired
  useEffect(() => {
    const currentMap = new Map(voiceCuesRef.current.map(c => [c.id, c.fired]));
    voiceCuesRef.current = voiceCues.map(c => ({ ...c, fired: currentMap.get(c.id) ?? false }));
  }, [voiceCues]);

  // Atualiza isPlayingRef
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Scheduler de cues — RAF loop
  useEffect(() => {
    if (!isPlaying) {
      if (cueRafRef.current !== null) { cancelAnimationFrame(cueRafRef.current); cueRafRef.current = null; }
      return;
    }
    const runScheduler = () => {
      const firstWs = Object.values(wavesurfers.current)[0];
      if (firstWs && isPlayingRef.current) {
        const t = firstWs.getCurrentTime();
        voiceCuesRef.current.forEach(cue => {
          if (!cue.fired && t >= cue.time) {
            cue.fired = true;
            playGuideBuffer(cue.file);
          }
        });
      }
      cueRafRef.current = requestAnimationFrame(runScheduler);
    };
    cueRafRef.current = requestAnimationFrame(runScheduler);
    return () => { if (cueRafRef.current !== null) { cancelAnimationFrame(cueRafRef.current); cueRafRef.current = null; } };
  }, [isPlaying, playGuideBuffer]);

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
    // ── Limit check based on Plan ──
    const LIMITS = { free: 5, essencial: 50, pro: 150, essencial_anual: 50, pro_anual: 150 };
    const userPlanKey = (userPlan || 'free').toLowerCase();
    const maxLimit = LIMITS[userPlanKey as keyof typeof LIMITS] || 5;
    
    const count = parseInt(localStorage.getItem('separator_usage') || '0');
    if (count >= maxLimit) {
      alert(`Você atingiu o limite de ${maxLimit} separações mensais do seu plano. Faça upgrade para continuar!`);
      setIsPricingOpen(true);
      return;
    }

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
      
      // Start initial States
      const initialStates: any = {};
      stemsArray.forEach(s => {
        initialStates[s.id] = { muted: false, soloed: false, volume: 1, pan: 0 };
      });
      
      setStemStates(initialStates);
      setStems(stemsArray);
      setProgress(100);
      setIsProcessing(false);

      // Increment count for all users
      const currentCount = parseInt(localStorage.getItem('separator_usage') || '0');
      localStorage.setItem('separator_usage', (currentCount + 1).toString());

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
        waveColor: stem.color + '40', // 25% opacity
        progressColor: stem.color,
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: 70,
        normalize: true,
        url: stem.url,
      });

      // Roteamento Web Audio: source → gain → panner → destination
      ws.on('ready', () => {
         try {
           const media = ws.getMediaElement();
           if (!media.dataset.routed) {
             media.dataset.routed = "true";
             const ctx = getAudioContext();
             const source = ctx.createMediaElementSource(media);
             const gainNode = ctx.createGain();
             const panner = ctx.createStereoPanner();
             source.connect(gainNode);
             gainNode.connect(panner);
             panner.connect(ctx.destination);
             gainNodes.current[stem.id] = gainNode;
             panners.current[stem.id] = panner;
           }
         } catch (e) { console.warn("Panner error", e) }
         if (stem.id === stems[0].id) setSongDuration(ws.getDuration());
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
        // Reset fired state para cues que estão após o novo ponto
        voiceCuesRef.current.forEach(cue => { cue.fired = time > cue.time + 0.3; });
        Object.values(wavesurfers.current).forEach(otherWs => {
          if (otherWs !== ws) {
            let targetTime = time;
            const offsetSec = offsetRef.current / 1000;
            const otherContainer = otherWs.options.container;
            const wsContainer = ws.options.container;
            const otherId = typeof otherContainer === 'string' ? otherContainer : otherContainer.id;
            const wsId = typeof wsContainer === 'string' ? wsContainer : wsContainer.id;
            if (otherId === 'waveform-click' || otherId === 'waveform-metronome') targetTime -= offsetSec;
            else if (wsId === 'waveform-click' || wsId === 'waveform-metronome') targetTime += offsetSec;
            otherWs.setTime(Math.max(0, targetTime));
          }
        });
      });

      wavesurfers.current[stem.id] = ws;
    });

    return () => {
      Object.values(wavesurfers.current).forEach(ws => ws.destroy());
      wavesurfers.current = {};
      panners.current = {};
      gainNodes.current = {};
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

      const songRes = await fetch('/api/insert-song', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: songName, artist: artist || 'Desconhecido',
          key: songKey, bpm: Number(bpm), cover_url,
          user_id: user?.id,
          is_global: isAdmin ? publishGlobal : false
        }),
      });
      if (!songRes.ok) {
        const b = await songRes.json().catch(() => ({ error: `HTTP ${songRes.status}` }));
        throw new Error(b.error || 'Falha ao criar música');
      }
      const { id: songId } = await songRes.json();
      if (!songId) throw new Error("Falha ao criar música");
      setSaveProgress(10);

      const stemsData: { song_id: string; name: string; file_url: string; order: number }[] = [];
      const total = stems.length;

      for (let i = 0; i < stems.length; i++) {
        const stem = stems[i];
        setSaveStatus(`Implantando Nuvem ☁️: ${stem.name} (${i+1}/${total})...`);

        let fileUrl: string;
        const isRemoteUrl = stem.url.startsWith('http://') || stem.url.startsWith('https://');
        if (isRemoteUrl) {
          const key = `stems/${songId}/${stem.id}_${Date.now()}.wav`;
          const copyRes = await fetch('/api/upload-stem-from-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceUrl: stem.url, key, contentType: 'audio/wav' }),
          });
          if (!copyRes.ok) {
            const err = await copyRes.json().catch(() => ({}));
            throw new Error((err as any).error || `Falha no upload server-side: HTTP ${copyRes.status}`);
          }
          const data = await copyRes.json();
          fileUrl = (data as any).url;
        } else {
          const response = await fetch(stem.url);
          const blob = await response.blob();
          const stemFile = new File([blob], `${stem.id}.wav`, { type: blob.type || 'audio/wav' });
          const uploadResult = await uploadToR2('stems', `${songId}/IA_${Date.now()}_${stem.id}.wav`, stemFile);
          if (uploadResult.error || !uploadResult.url) throw new Error(uploadResult.error!);
          fileUrl = uploadResult.url;
        }

        stemsData.push({ song_id: songId, name: stem.name || stem.id, file_url: fileUrl, order: i + 1 });
        setSaveProgress(10 + Math.floor(((i + 1) / total) * 80));
      }

      setSaveStatus('Finalizando registros...');
      const stemsRes = await fetch('/api/insert-stems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stems: stemsData }),
      });
      if (!stemsRes.ok) {
        const b = await stemsRes.json().catch(() => ({ error: `HTTP ${stemsRes.status}` }));
        throw new Error(b.error || 'Falha ao registrar stems');
      }

      setSaveProgress(100);
      setSaveStatus('Sucesso! Música publicada na nuvem.');
      setTimeout(() => {
        setIsSaving(false);
        setShowSaveForm(false);
        // Stay on page — user can continue working
      }, 2000);

    } catch (e: any) {
      alert("Erro ao salvar: " + e.message);
      setIsSaving(false);
    }
  };

  const addMetronomeChannel = async () => {
    const bpmNum = parseInt(bpm) || 120;
    setIsGeneratingClick(true);
    try {
      const firstWs = Object.values(wavesurfers.current)[0];
      const duration = (firstWs?.getDuration() > 0 ? firstWs.getDuration() : 0) || 600;

      const { clickTrackUrl } = await generateManualClickTrackFromSample(
        clickSel.type, clickSel.subdivision, bpmNum, duration, true, '4/4'
      );
      if (!clickTrackUrl) throw new Error('Falha ao gerar metrônomo');

      const metroStem: StemData = {
        id: 'metronome',
        name: 'Metrônomo',
        url: clickTrackUrl,
        color: '#e2e8f0'
      };
      setStemStates(p => ({ ...p, metronome: { muted: false, soloed: false, volume: 0.8, pan: 0 } }));
      setStems(prev => [...prev.filter(s => s.id !== 'metronome'), metroStem]);
      setShowBpmModal(false);
    } catch (e) {
      console.error('Erro ao gerar metrônomo', e);
    } finally {
      setIsGeneratingClick(false);
    }
  };

  if (!file && stems.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-5 left-5 text-text-muted hover:text-white flex items-center gap-1.5 cursor-pointer text-xs font-mono uppercase tracking-wider">
          <ChevronLeft size={18}/> VOLTAR
        </button>
        <div className="max-w-xl w-full text-center">
           <Disc3 size={60} className="mx-auto text-primary mb-5 animate-[spin_10s_linear_infinite]" />
           <h1 className="text-2xl font-black text-white mb-3 uppercase tracking-wider">Separador de Faixas IA</h1>
           <p className="text-text-muted mb-8 text-xs font-mono leading-relaxed max-w-md mx-auto">Envie seu áudio. A IA irá separar e mixar todos os instrumentos, detectar o BPM exato e gerar um projeto de ensaio multi-canal profissional.</p>

           <label className="border-2 border-dashed border-primary/30 bg-primary/3 hover:bg-primary/5 rounded-lg p-12 flex flex-col items-center justify-center cursor-pointer transition-colors shadow-[0_0_40px_rgba(16,185,129,0.05)]">
             <UploadCloud size={40} className="text-primary mb-3" />
             <span className="text-sm font-black text-white uppercase tracking-wider">Carregar Áudio & Iniciar</span>
             <span className="text-[10px] text-text-muted/50 mt-1.5 font-mono">MP3, WAV ou AAC</span>
             <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
           </label>

           <button onClick={loadMockData} className="mt-8 text-[10px] font-mono text-text-muted/50 hover:text-text-muted underline cursor-pointer transition-colors">
              [DEV] Carregar Dados Fictícios
           </button>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col items-center justify-center p-6">
        <Loader2 size={48} className="text-primary animate-spin mb-6" />
        <h2 className="text-xl font-black text-white tracking-widest uppercase mb-3 text-transparent bg-clip-text bg-gradient-to-r from-primary to-[#059669]">
           Analisando Frequências
        </h2>
        <div className="text-xs text-text-muted max-w-lg text-center font-mono h-16">{progressMsg}</div>
        <div className="w-full max-w-md bg-surface rounded-full h-1.5 mt-6 overflow-hidden border border-border">
          <div className="bg-primary h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="text-text-muted/50 text-[10px] mt-3 font-mono uppercase tracking-widest">{progress}% CONCLUÍDO</p>
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
                <h1 className="font-black text-white text-xs uppercase tracking-wider leading-tight">Separador de Faixas (DAW)</h1>
                <h2 className="text-[9px] font-mono text-text-muted truncate max-w-xs">{songName}</h2>
             </div>
          </div>
        </div>
        <button 
          onClick={() => setShowSaveForm(true)}
          className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/15 hover:bg-primary/15 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer uppercase tracking-wider">
          <Save size={14} /> EXPORTAR
        </button>
      </header>

      {/* CORE WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
         {/* TRACK CONTROLS: LEFT FIXED */}
         <div className="w-[280px] bg-[#0a0a0c]/40 backdrop-blur-xl border-r border-white/5 flex flex-col overflow-y-auto overflow-x-hidden pt-7 shrink-0 z-10 custom-scrollbar shadow-[4px_0_24px_rgba(0,0,0,0.5)]">
            {stems.map((stem) => {
               const state = stemStates[stem.id];
               if(!state) return null;
               
               return (
                  <div key={`ctrl-${stem.id}`} className="flex flex-col h-[70px] border-b border-white/[0.03] px-3 justify-center bg-white/[0.01] hover:bg-white/[0.03] transition-colors relative group">
                     {/* Color indicator border */}
                     <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: stem.color, boxShadow: `0 0 10px ${stem.color}66` }}></div>
                     
                     <div className="flex items-center justify-between mb-1.5 pl-3">
                        <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/90 drop-shadow-md">{stem.name}</span>
                        <div className="flex gap-1">
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], muted: !p[stem.id].muted } }))}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black cursor-pointer transition-all ${state.muted ? 'bg-accent-red/20 text-accent-red border border-accent-red/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-black/40 text-text-muted border border-white/5 hover:bg-white/10 hover:text-white'}`}>M</button>
                           <button 
                              onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], soloed: !p[stem.id].soloed } }))}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black cursor-pointer transition-all ${state.soloed ? 'bg-secondary/20 text-secondary border border-secondary/50 shadow-[0_0_10px_rgba(251,191,36,0.3)]' : 'bg-black/40 text-text-muted border border-white/5 hover:bg-white/10 hover:text-white'}`}>S</button>
                        </div>
                     </div>
                     <div className="flex items-center gap-3 pl-3 pr-1">
                        {/* PAN KNOB */}
                        <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center relative bg-black/60 shrink-0 shadow-inner" 
                             style={{ cursor: 'ew-resize' }}
                             title="Pan L/R"
                             onWheel={(e) => {
                                const newPan = Math.max(-1, Math.min(1, state.pan + (e.deltaY > 0 ? -0.1 : 0.1)));
                                setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: newPan } }));
                             }}
                             onClick={() => {
                               setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: 0 } }));
                             }}>
                             <div className="w-[1.5px] h-2.5 bg-white/70 rounded-full origin-bottom absolute top-[3px]" 
                                  style={{ transform: `rotate(${state.pan * 45}deg)` }}></div>
                        </div>
                        {/* VOLUME FADER */}
                        <input 
                           type="range" min="0" max="1" step="0.01"
                           value={state.volume}
                           onChange={(e) => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], volume: parseFloat(e.target.value) } }))}
                           className="w-full h-1 bg-black/50 border border-white/10 rounded-lg appearance-none cursor-pointer accent-white hover:accent-primary transition-all outline-none shadow-inner" 
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

            {/* Voice Cue Markers */}
            {songDuration > 0 && voiceCues.map(cue => (
              <div
                key={`marker-${cue.id}`}
                className="absolute top-0 bottom-0 z-20 pointer-events-none"
                style={{ left: `${(cue.time / songDuration) * 100}%` }}
              >
                <div className="w-px h-full bg-yellow-400/50" />
                <div className="absolute top-0 left-1 bg-yellow-400 text-black text-[7px] font-black px-1 py-0.5 rounded-sm whitespace-nowrap leading-tight">
                  {cue.label}
                </div>
              </div>
            ))}

            {stems.map((stem) => (
               <div key={`wavewrap-${stem.id}`} className="h-[70px] border-b border-border relative hover:bg-white/3 transition-colors">
                  <div id={`waveform-${stem.id}`} className="absolute w-full top-0 h-full" />
               </div>
            ))}
         </div>
      </div>

      {/* TRANSPORT BAR */}
      <footer className="h-16 bg-[#0a0a0c]/80 backdrop-blur-xl border-t border-white/10 shrink-0 px-6 flex items-center justify-between z-20">
         <div className="flex-1 flex items-center gap-3">
            {/* BPM Button → opens modal */}
            <button
               onClick={() => setShowBpmModal(true)}
               className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 hover:bg-white/5 transition-colors cursor-pointer"
            >
               <span className="text-[9px] text-text-muted uppercase tracking-widest font-bold">BPM</span>
               <span className="text-white text-xs font-mono font-black">{bpm}</span>
            </button>

            {/* Tom Button → opens key picker */}
            <div className="relative">
               <button
                  onClick={() => setIsKeyPickerOpen(p => !p)}
                  className={`flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 hover:bg-white/5 transition-colors cursor-pointer ${isKeyPickerOpen ? 'border-primary/40' : ''}`}
               >
                  <span className="text-[9px] text-text-muted uppercase tracking-widest font-bold">Tom</span>
                  <span className="text-primary text-xs font-mono font-black">{songKey}</span>
               </button>
               {isKeyPickerOpen && (
                  <>
                     <div className="fixed inset-0 z-40" onClick={() => setIsKeyPickerOpen(false)} />
                     <div className="absolute bottom-full mb-2 left-0 bg-[#1c1c1e] border border-white/10 rounded-xl z-50 p-3 w-44 shadow-2xl">
                        <p className="text-[9px] text-text-muted mb-2 font-mono uppercase tracking-wider">Selecionar tom:</p>
                        <div className="grid grid-cols-4 gap-1">
                           {KEYS.map(k => (
                              <button key={k} onClick={() => { setSongKey(k); setIsKeyPickerOpen(false); }}
                                 className={`py-1.5 text-[10px] font-bold rounded transition-colors cursor-pointer font-mono ${songKey === k ? 'bg-primary text-black' : 'text-white/70 bg-white/5 hover:bg-primary/20 hover:text-primary'}`}>
                                 {k}
                              </button>
                           ))}
                        </div>
                     </div>
                  </>
               )}
            </div>

            {/* + Click button (visible when tracks are loaded) */}
            {stems.length > 0 && (
              <button
                onClick={() => setShowBpmModal(true)}
                className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-text-muted transition-all cursor-pointer"
                title={`Adicionar metrônomo a ${bpm} BPM`}
              >
                <span className="text-[9px] uppercase tracking-widest font-bold">+ Click</span>
              </button>
            )}

            {/* Voz Guia button */}
            {stems.length > 0 && (
              <button
                onClick={() => setShowVoiceGuide(true)}
                className={`flex items-center gap-1.5 bg-black/40 border rounded-md px-2.5 py-1.5 transition-all cursor-pointer text-[9px] uppercase tracking-widest font-bold ${voiceCues.length > 0 ? 'border-yellow-400/40 text-yellow-400 bg-yellow-400/5' : 'border-white/10 text-text-muted hover:bg-yellow-400/10 hover:border-yellow-400/30 hover:text-yellow-400'}`}
                title="Configurar Voz Guia"
              >
                <Mic size={11} />
                Voz Guia {voiceCues.length > 0 && `(${voiceCues.length})`}
              </button>
            )}

            {/* Sync Offset */}
            <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-md p-1 h-8">
               <span className="text-[9px] text-text-muted uppercase tracking-widest font-bold px-2">Sync</span>
               <button onClick={() => setClickOffsetMs(p => p - 10)} className="w-5 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors" title="Atrasar Metrônomo">
                  <ChevronLeft size={12}/>
               </button>
               <span className="text-[10px] text-white font-mono font-bold w-10 text-center">{clickOffsetMs > 0 ? '+' : ''}{clickOffsetMs}</span>
               <button onClick={() => setClickOffsetMs(p => p + 10)} className="w-5 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors" title="Adiantar Metrônomo">
                  <ChevronRight size={12}/>
               </button>
               <span className="text-[8px] text-text-muted font-mono ml-1 mr-1">ms</span>
            </div>
         </div>
         <div className="flex gap-4 items-center flex-1 justify-center">
            <button
               onClick={() => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(0)); voiceCuesRef.current.forEach(c => { c.fired = false; }); }}
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
             
             <h2 className="text-lg font-black text-white mb-1.5 uppercase tracking-wider">Publicar na Nuvem</h2>
             <p className="text-text-muted text-[10px] mb-5 font-mono">Salvando projeto multi-faixa de {stems.length} canais na sua biblioteca.</p>
             
             {!isSaving ? (
               <div className="flex flex-col gap-4">
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Música *</label>
                     <input value={songName} onChange={e => setSongName(e.target.value)}
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                       placeholder="ex: Águas Purificadoras"
                     />
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Artista</label>
                     <input value={artist} onChange={e => setArtist(e.target.value)}
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                       placeholder="ex: Hillsong"
                     />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">BPM (IA)</label>
                     <input type="number" value={bpm} onChange={e => setBpm(e.target.value)} 
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono"
                     />
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Tom</label>
                     <select value={songKey} onChange={e => setSongKey(e.target.value)}
                       className="w-full daw-input rounded-md px-3 py-2 text-white text-xs font-mono appearance-none">
                       {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                     </select>
                   </div>
                 </div>
                  <div className="mt-1">
                    <label className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1 block font-mono">Imagem de Capa (Opcional)</label>
                    <div className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 daw-input rounded-md px-3 py-2 cursor-pointer text-text-muted text-xs font-mono overflow-hidden">
                        <UploadCloud size={14} className="text-primary flex-shrink-0" />
                        <span className="truncate">{coverFile ? coverFile.name : 'Selecionar imagem...'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                      </label>
                      {coverFile && (
                        <button onClick={() => setCoverFile(null)} className="p-2 text-text-muted hover:text-accent-red daw-input rounded-md transition-colors shrink-0">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {isAdmin && (
                    <div className="mt-3 bg-primary/5 border border-primary/20 rounded-md p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-wider font-mono mb-0.5">Visibilidade Global</div>
                        <div className="text-[9px] text-text-muted font-mono leading-tight">Publicar na Plataforma para todos os usuários.</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={publishGlobal} onChange={(e) => setPublishGlobal(e.target.checked)} />
                        <div className="w-9 h-5 bg-black/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text-muted peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary border border-white/10"></div>
                      </label>
                    </div>
                  )}

                 <button onClick={handleSaveToDatabase} className="w-full bg-primary text-black font-black py-3 rounded-md mt-3 uppercase tracking-wider text-xs active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)] cursor-pointer">
                   SALVAR & PUBLICAR
                 </button>
               </div>
             ) : (
               <div className="flex flex-col items-center py-8">
                  <UploadCloud size={36} className="text-primary animate-pulse mb-4" />
                  <div className="text-white font-black text-sm uppercase tracking-wider mb-1">{saveProgress >= 100 ? 'PRONTO!' : 'PUBLICANDO...'}</div>
                  <div className="text-text-muted text-[10px] text-center mb-6 h-5 font-mono">{saveStatus}</div>
                  
                  <div className="w-full lcd-display rounded-md h-1.5 overflow-hidden">
                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${saveProgress}%` }}></div>
                  </div>
               </div>
             )}
          </div>
        </div>
      )}

      {/* BPM MODAL */}
      {showBpmModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => !isGeneratingClick && setShowBpmModal(false)}>
          <div className="bg-[#1c1c1e] w-full max-w-[340px] rounded-2xl p-5 shadow-2xl border border-white/5 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm font-bold tracking-wide">BPM</span>
              <button onClick={() => !isGeneratingClick && setShowBpmModal(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
                <X size={18} />
              </button>
            </div>
            <div className="text-white/60 text-sm font-medium mb-4">{getTempoName(parseInt(bpm) || 120)}</div>
            <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2 mb-6">
              <button onClick={() => setBpm(String(Math.max(40, (parseInt(bpm) || 120) - 1)))} disabled={isGeneratingClick}
                className="w-12 h-12 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer disabled:opacity-50">
                <Minus size={20} />
              </button>
              <input type="number" value={bpm}
                onChange={e => setBpm(e.target.value)}
                onBlur={() => { const n = parseInt(bpm); if (isNaN(n)) setBpm('120'); else setBpm(String(Math.max(40, Math.min(300, n)))); }}
                disabled={isGeneratingClick}
                className="text-white font-black text-4xl w-24 text-center bg-transparent focus:outline-none"
              />
              <button onClick={() => setBpm(String(Math.min(300, (parseInt(bpm) || 120) + 1)))} disabled={isGeneratingClick}
                className="w-12 h-12 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer disabled:opacity-50">
                <Plus size={20} />
              </button>
            </div>
            {/* Click Sound selector */}
            {!isGeneratingClick && (
              <div className="mb-4">
                <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold mb-2">Som do Click</p>
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {CLICK_TYPES.map(t => (
                    <button key={t.id} onClick={() => updateClickSel({ type: t.id })} disabled={isGeneratingClick}
                      className={`py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer active:scale-95 border ${clickSel.type === t.id ? 'bg-primary/15 border-primary text-primary' : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438]'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {CLICK_SUBDIVISIONS.map(s => (
                    <button key={s.id} onClick={() => updateClickSel({ subdivision: s.id })} disabled={isGeneratingClick}
                      className={`py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer active:scale-95 border ${clickSel.subdivision === s.id ? 'bg-primary/15 border-primary text-primary' : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438]'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isGeneratingClick && (
              <div className="text-center text-[10px] font-bold text-primary animate-pulse uppercase tracking-wider mb-4">
                Gerando click {clickSel.type}...
              </div>
            )}
            <button onClick={addMetronomeChannel} disabled={isGeneratingClick || stems.length === 0}
              className="w-full bg-[#2a2a2d] hover:bg-[#343438] text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider cursor-pointer border border-white/5 active:scale-95">
              {isGeneratingClick ? <Loader2 size={16} className="animate-spin" /> : <Play fill="currentColor" size={14} />}
              GERAR CLICK — {clickSel.type} {clickSel.subdivision}
            </button>
          </div>
        </div>
      )}

      {/* VOICE GUIDE MODAL */}
      {showVoiceGuide && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowVoiceGuide(false)}>
          <div className="bg-[#1c1c1e] w-full max-w-lg rounded-2xl shadow-2xl border border-white/8 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <Mic size={16} className="text-yellow-400" />
                <span className="text-white font-black text-sm uppercase tracking-wider">Voz Guia</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Auto-Detect button */}
                <button
                  onClick={autoDetectVoiceGuide}
                  disabled={isAutoDetecting}
                  title="IA analisa o áudio e detecta seções automaticamente"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-400/30 bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 active:scale-95"
                >
                  {isAutoDetecting ? <Loader2 size={11} className="animate-spin" /> : <Mic size={11} />}
                  {isAutoDetecting ? 'Analisando...' : 'Auto-Detectar'}
                </button>
                <button onClick={() => setShowVoiceGuide(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Auto-detect loading state */}
            {isAutoDetecting && (
              <div className="px-5 py-4 flex items-center gap-3 bg-yellow-400/5 border-b border-yellow-400/10 shrink-0">
                <Loader2 size={16} className="text-yellow-400 animate-spin shrink-0" />
                <div>
                  <p className="text-yellow-400 text-[10px] font-black uppercase tracking-wider">Analisando estrutura do áudio...</p>
                  <p className="text-text-muted text-[9px] font-mono mt-0.5">Detectando mudanças de energia e seções</p>
                </div>
              </div>
            )}

            {/* Instruction */}
            {!isAutoDetecting && (
              <p className="text-[10px] text-text-muted font-mono px-5 pt-3 pb-2 shrink-0">
                {isPlaying ? '▶ Clique em uma seção para marcar o tempo atual' : 'Reproduza a música e clique para carimbar o tempo — ou use Auto-Detectar'}
              </p>
            )}

            {/* Tabs */}
            {!isAutoDetecting && (
              <div className="flex gap-1 px-5 pb-3 shrink-0">
                <button
                  onClick={() => setVoiceGuideTab('sections')}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${voiceGuideTab === 'sections' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-text-muted hover:bg-white/10 hover:text-white'}`}
                >Seções</button>
                <button
                  onClick={() => setVoiceGuideTab('dynamic')}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${voiceGuideTab === 'dynamic' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-text-muted hover:bg-white/10 hover:text-white'}`}
                >Dinâmicas</button>
              </div>
            )}

            {/* Cue Grid */}
            {!isAutoDetecting && (
              <div className="overflow-y-auto px-5 pb-3 flex-1 custom-scrollbar">
                <div className="grid grid-cols-4 gap-1.5">
                  {(voiceGuideTab === 'sections' ? GUIDE_SECTIONS : GUIDE_DYNAMICS).map(item => (
                    <button
                      key={item.file}
                      onClick={() => addVoiceCue(item.label, item.file)}
                      className="py-2 px-1 rounded-lg text-[10px] font-bold text-center transition-all cursor-pointer border border-white/5 bg-white/4 hover:bg-yellow-400/15 hover:border-yellow-400/40 hover:text-yellow-400 text-white/70 active:scale-95 leading-tight"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Added Cues List */}
            {voiceCues.length > 0 && (
              <div className="border-t border-white/5 px-5 pt-3 pb-4 shrink-0">
                <p className="text-[9px] text-text-muted uppercase tracking-widest font-bold mb-2">Cues adicionados ({voiceCues.length})</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto custom-scrollbar">
                  {voiceCues.map(cue => (
                    <div key={cue.id} className="flex items-center justify-between bg-white/3 border border-white/5 rounded-md px-2.5 py-1.5">
                      <span className="text-yellow-400 font-mono text-[10px] font-bold w-10 shrink-0">{formatCueTime(cue.time)}</span>
                      <span className="text-white/80 text-[10px] font-bold flex-1 px-2 truncate">{cue.label}</span>
                      <button
                        onClick={() => removeVoiceCue(cue.id)}
                        className="text-text-muted hover:text-accent-red transition-colors cursor-pointer p-0.5"
                      ><X size={11} /></button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setVoiceCues([]); voiceCuesRef.current = []; }}
                  className="mt-2 text-[9px] font-mono text-text-muted/50 hover:text-accent-red transition-colors cursor-pointer underline"
                >
                  Limpar todos
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
    </div>
  );
};
