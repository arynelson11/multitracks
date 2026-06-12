import { apiUrl } from '../lib/api';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, X, Loader2, UploadCloud, ChevronLeft, ChevronRight, Volume2, Save, Disc3, Minus, Plus, Mic, Download, Trash2, FolderOpen, Clock, CheckCircle2, Lock } from 'lucide-react';
import { uploadToR2 } from '../lib/r2';
import { getAuthHeaders } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { PricingModal } from './PricingModal';
import { generateManualClickTrackFromSample } from '../lib/AudioAnalyzer';
import { CLICK_TYPES, CLICK_SUBDIVISIONS, loadClickSelection, saveClickSelection, getClickSampleUrl } from '../lib/clickLibrary';
import { useSeparationLibrary, type SavedSeparation } from '../hooks/useSeparationLibrary';
import { audioBlobToMp3Blob } from '../lib/audioExport';

type DownloadFormat = 'wav' | 'mp3';
const DOWNLOAD_FORMAT_KEY = 'playback-studio:download-format';

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

function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ws = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const scale = peak > 1 ? 1 / peak : 1;
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * scale * 32767)), true);
  return new Blob([buffer], { type: 'audio/wav' });
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
  const { separations, saveSeparation, deleteSeparation, isLoading: isLibLoading } = useSeparationLibrary();
  const [activeSepId, setActiveSepId] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>(() => {
    if (typeof window === 'undefined') return 'wav';
    const stored = window.localStorage.getItem(DOWNLOAD_FORMAT_KEY);
    return stored === 'mp3' ? 'mp3' : 'wav';
  });
  const [encodingStemId, setEncodingStemId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DOWNLOAD_FORMAT_KEY, downloadFormat);
  }, [downloadFormat]);
  const [libSaveToast, setLibSaveToast] = useState(false);
  const [publishGlobal, setPublishGlobal] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [separationStep, setSeparationStep] = useState<'upload' | 'options'>('upload');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
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
  const [timeSignature, setTimeSignature] = useState<'3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'>('4/4');
  const [accentBeat1, setAccentBeat1] = useState(true);
  const bpmTapsRef = useRef<number[]>([]);

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

  const downloadStem = async (stem: StemData) => {
    try {
      setEncodingStemId(stem.id);
      const res = await fetch(stem.url);
      const wavBlob = await res.blob();
      const useMp3 = downloadFormat === 'mp3';
      const outBlob = useMp3 ? await audioBlobToMp3Blob(wavBlob, 320) : wavBlob;
      const ext = useMp3 ? 'mp3' : 'wav';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(outBlob);
      a.download = `${(songName || 'stem').replace(/[^a-zA-Z0-9]/g, '_')}_${stem.name}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      console.error('Download error', e);
      alert('Erro ao baixar a faixa. Tenta de novo.');
    } finally {
      setEncodingStemId(null);
    }
  };

  const handleTapTempo = () => {
    const now = Date.now();
    bpmTapsRef.current.push(now);
    if (bpmTapsRef.current.length > 8) bpmTapsRef.current.shift();
    if (bpmTapsRef.current.length < 2) return;
    const gaps = bpmTapsRef.current.slice(1).map((t, i) => t - bpmTapsRef.current[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    setBpm(String(Math.round(60000 / avg)));
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

  const updateCueTime = (id: string, raw: string) => {
    const parts = raw.split(':');
    const total = Math.max(0, (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1] || '0') || 0));
    setVoiceCues(prev => prev.map(c => c.id === id ? { ...c, time: total } : c).sort((a, b) => a.time - b.time));
  };

  const renderVoiceGuideToBlob = async (): Promise<Blob | null> => {
    if (voiceCues.length === 0) return null;
    const ctx = getAudioContext();
    const dur = songDuration || 300;
    const sr = 44100;
    const output = new Float32Array(Math.ceil(dur * sr));
    for (const cue of voiceCues) {
      const url = guideUrl(cue.file);
      let buffer = guideBufferCache.current.get(url);
      if (!buffer) {
        try {
          const res = await fetch(url);
          buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          guideBufferCache.current.set(url, buffer);
        } catch { continue; }
      }
      const start = Math.floor(cue.time * sr);
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
      }
      for (let i = 0; i < mono.length && start + i < output.length; i++) output[start + i] += mono[i];
    }
    return float32ToWav(output, sr);
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

      // 2-second chunks for finer resolution (pre-choruses can be as short as 8s)
      const CHUNK_SECS = 2;
      const chunkSamples = CHUNK_SECS * buffer.sampleRate;
      const numChunks = Math.floor(buffer.duration / CHUNK_SECS);
      const totalDur = buffer.duration;

      // Mix to mono
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
      }

      // RMS per 2s chunk
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

      // Smooth with ±5 chunk window (±10s) for stability
      const SMOOTH = 5;
      const smoothed = norm.map((_, i) => {
        const sl = norm.slice(Math.max(0, i - SMOOTH), Math.min(norm.length, i + SMOOTH + 1));
        return sl.reduce((a, b) => a + b, 0) / sl.length;
      });

      // Section energy = average of all chunks in that section (from boundary to next)
      const sectionEnergy = (startChunk: number, endChunk: number) => {
        const sl = smoothed.slice(startChunk, Math.min(numChunks, endChunk));
        return sl.length > 0 ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
      };

      // Detect boundaries: look for sustained energy change over ±8 chunks (±16s)
      const MIN_GAP_CHUNKS = Math.max(7, Math.floor(14 / CHUNK_SECS)); // min 14s between sections
      const THRESHOLD = 0.08;

      const boundaries: { time: number; startChunk: number }[] = [{ time: 0, startChunk: 0 }];

      for (let i = MIN_GAP_CHUNKS; i < numChunks - 2; i++) {
        const lastChunk = boundaries[boundaries.length - 1].startChunk;
        if (i - lastChunk < MIN_GAP_CHUNKS) continue;
        const half = Math.floor(MIN_GAP_CHUNKS / 2);
        const before = sectionEnergy(Math.max(0, i - half), i);
        const after = sectionEnergy(i, Math.min(numChunks, i + half));
        if (Math.abs(after - before) > THRESHOLD) {
          boundaries.push({ time: i * CHUNK_SECS, startChunk: i });
        }
      }

      // Compute energy for each section (from this boundary start to the next boundary start)
      const withEnergy = boundaries.map((b, idx) => {
        const nextChunk = idx < boundaries.length - 1 ? boundaries[idx + 1].startChunk : numChunks;
        return { time: b.time, startChunk: b.startChunk, energy: sectionEnergy(b.startChunk, nextChunk) };
      });

      // Cap at 12 sections — always remove the section with smallest energy delta to neighbors
      while (withEnergy.length > 12) {
        let minIdx = 1;
        let minScore = Infinity;
        for (let i = 1; i < withEnergy.length - 1; i++) {
          const score = Math.abs(withEnergy[i].energy - withEnergy[i - 1].energy)
                      + Math.abs(withEnergy[i].energy - withEnergy[i + 1].energy);
          if (score < minScore) { minScore = score; minIdx = i; }
        }
        withEnergy.splice(minIdx, 1);
      }

      const allE = withEnergy.map(b => b.energy);
      const minE = Math.min(...allE);
      const maxE = Math.max(...allE);
      const eRange = maxE - minE || 1;
      const ne = (e: number) => (e - minE) / eRange; // normalize 0–1

      // ─── Worship-structure-aware labeling ───────────────────────────────────
      // Typical flow: Intro → V → PreC → C → [V → PreC →] C → Ponte → C → Final
      // Rules (applied in order for each section i, skipping first and last):
      //   1. Chorus  — ne(energy) ≥ 0.62  (high energy peak)
      //   2. Pré-Refrão — section JUST BEFORE a Chorus, ne ≥ 0.32 (building energy)
      //   3. Ponte   — ne ≤ 0.30, position ≥ 55% of song, not yet used
      //   4. Interlúdio — ne ≤ 0.22, position < 55%, appears after at least one chorus
      //   5. Verso   — everything else (medium energy sections)
      const CHORUS_THR = 0.62;
      const PRE_THR    = 0.32;
      const BRIDGE_THR = 0.30;
      const INTER_THR  = 0.22;

      // First pass: mark chorus positions so we can identify pre-choruses
      const isChorus = withEnergy.map(b => ne(b.energy) >= CHORUS_THR);

      let chorusCount = 0, verseCount = 0, preChorusCount = 0;
      let bridgeUsed = false, interludeUsed = false;
      let chorusSeenCount = 0;

      const detectedCues: VoiceCue[] = withEnergy.map((b, idx) => {
        const ts = Date.now();

        if (idx === 0) {
          return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' };
        }
        if (idx === withEnergy.length - 1) {
          return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Final', file: 'Song Sections/Portugese - Ending.wav' };
        }

        const e = ne(b.energy);
        const pos = b.time / totalDur;
        const nextIsChorus = idx < withEnergy.length - 1 && isChorus[idx + 1];

        // 1. Chorus
        if (isChorus[idx]) {
          chorusCount++;
          chorusSeenCount++;
          const n = Math.min(chorusCount, 4);
          return { id: `ad-${ts}-${idx}`, time: b.time, label: `Refrão ${chorusCount}`, file: `Song Sections/Portugese - Chorus ${n}.wav` };
        }

        // 2. Pré-Refrão — building section right before a chorus
        if (nextIsChorus && e >= PRE_THR) {
          preChorusCount++;
          const sfx = preChorusCount > 1 ? ` ${preChorusCount}` : '';
          return { id: `ad-${ts}-${idx}`, time: b.time, label: `Pré-Refrão${sfx}`, file: `Song Sections/Portugese - Pre Chorus${sfx}.wav` };
        }

        // 3. Ponte (Bridge) — low/medium energy in second half of song
        if (pos >= 0.55 && e <= BRIDGE_THR && !bridgeUsed) {
          bridgeUsed = true;
          return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' };
        }

        // 4. Interlúdio — quiet moment in first half after at least one chorus
        if (pos < 0.55 && e <= INTER_THR && !interludeUsed && chorusSeenCount > 0) {
          interludeUsed = true;
          return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Interlúdio', file: 'Song Sections/Portugese - Interlude.wav' };
        }

        // 5. Verso (default for medium sections)
        verseCount++;
        const vn = Math.min(verseCount, 6);
        return { id: `ad-${ts}-${idx}`, time: b.time, label: `Verso ${verseCount}`, file: `Song Sections/Portugese - Verse ${vn}.wav` };
      });

      // Add 1,2,3,4 count-in before Intro when song has space before it
      const bpmNum = parseInt(bpm) || 120;
      const beat = 60 / bpmNum;
      const intro = detectedCues.find(c => c.label === 'Intro');
      if (intro && intro.time > beat) {
        for (let n = 1; n <= 4; n++) {
          const t = intro.time - (5 - n) * beat;
          if (t >= 0) detectedCues.push({ id: `ad-ci${n}-${Date.now()}`, time: t, label: String(n), file: `Song Sections/Portugese - ${n}.wav` });
        }
        detectedCues.sort((a, b) => a.time - b.time);
      }

      setVoiceCues(detectedCues);
    } catch (e: any) {
      console.error('Auto-detect erro:', e);
      alert('Não foi possível analisar a estrutura: ' + e.message);
    } finally {
      setIsAutoDetecting(false);
    }
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

  // Spacebar play/stop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (getAudioContext().state === 'suspended') getAudioContext().resume();
      const action = isPlayingRef.current ? 'pause' : 'play';
      Object.values(wavesurfers.current).forEach(ws => ws[action]());
      setIsPlaying(p => !p);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      setPendingFile(selected);
      setSeparationStep('options');
    }
  };

  const processAudio = async (audioFile: File, stemCount: number) => {
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
      const res = await fetch(apiUrl('/api/separate-audio'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ audioUrl: publicUrl, stemCount })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 402) throw new Error(`Cota esgotada: ${errBody.error}. Faça upgrade do plano para continuar.`);
        if (res.status === 401) throw new Error('Sessão expirada. Faça login novamente.');
        throw new Error(errBody.error || 'Falha ao iniciar IA.');
      }
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
        
        const checkRes = await fetch(apiUrl(`/api/check-separation?predictionId=${prediction.id}`), {
          headers: await getAuthHeaders(),
        });
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
        guitar: '#ef4444', piano: '#10b981', other: '#ec4899', no_vocals: '#10b981', click: '#ffffff'
      };
      const translateNames: Record<string, string> = {
        vocals: 'Vocais', drums: 'Bateria', bass: 'Baixo',
        guitar: 'Guitarra', piano: 'Piano/TeCL', other: 'Outros/Fx', no_vocals: 'Instrumental'
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

      // ── Auto-save to local library ──
      try {
        const sepId = await saveSeparation({
          songName: audioFile.name.replace(/\.[^/.]+$/, ''),
          artist: '',
          bpm: bpm,
          songKey: songKey,
          stems: stemsArray.map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color })),
          voiceCues: [],
        });
        if (sepId) {
          setActiveSepId(sepId);
          setLibSaveToast(true);
          setTimeout(() => setLibSaveToast(false), 2500);
        }
      } catch (e) {
        console.warn('[SepLib] Auto-save failed:', e);
      }

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
        height: 88,
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

      const songRes = await fetch(apiUrl('/api/insert-song'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          name: songName, artist: artist || 'Desconhecido',
          key: songKey, bpm: Number(bpm), cover_url,
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
          const key = `stems/${user?.id}/${songId}/${stem.id}_${Date.now()}.wav`;
          const copyRes = await fetch(apiUrl('/api/upload-stem-from-url'), {
            method: 'POST',
            headers: await getAuthHeaders(),
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

      // Render & upload Voz Guia stem if cues exist
      if (voiceCues.length > 0) {
        setSaveStatus('Renderizando Voz Guia...');
        try {
          const guideBlob = await renderVoiceGuideToBlob();
          if (guideBlob) {
            const guideFile = new File([guideBlob], 'voz_guia.wav', { type: 'audio/wav' });
            const uploadResult = await uploadToR2('stems', `${songId}/voz_guia_${Date.now()}.wav`, guideFile);
            if (!uploadResult.error && uploadResult.url) {
              stemsData.push({ song_id: songId, name: 'Voz Guia', file_url: uploadResult.url, order: total + 1 });
            }
          }
        } catch (e) { console.error('Voz Guia render error', e); }
      }

      setSaveStatus('Finalizando registros...');
      const stemsRes = await fetch(apiUrl('/api/insert-stems'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ stems: stemsData }),
      });
      if (!stemsRes.ok) {
        const b = await stemsRes.json().catch(() => ({ error: `HTTP ${stemsRes.status}` }));
        throw new Error(b.error || 'Falha ao registrar stems');
      }

      // Update local library if this session is saved
      if (activeSepId) {
        await saveSeparation({
          id: activeSepId,
          songName,
          artist,
          bpm,
          songKey,
          stems: stems.map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color })),
          voiceCues,
        });
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
        clickSel.type, clickSel.subdivision, bpmNum, duration, accentBeat1, timeSignature
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

  // ── Load a saved separation ──
  const handleOpenSavedSeparation = (sep: SavedSeparation) => {
    const stemsArray: StemData[] = sep.stems.map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color }));
    const initialStates: Record<string, { muted: boolean; soloed: boolean; volume: number; pan: number }> = {};
    stemsArray.forEach(s => {
      initialStates[s.id] = { muted: false, soloed: false, volume: 1, pan: 0 };
    });
    setStemStates(initialStates);
    setStems(stemsArray);
    setSongName(sep.songName);
    setArtist(sep.artist || '');
    setBpm(sep.bpm || '120');
    setSongKey(sep.songKey || 'C');
    setVoiceCues(sep.voiceCues || []);
    setActiveSepId(sep.id);
    setFile(null); // signal we're in "loaded" mode, stems drive the UI
  };

  if (separationStep === 'options' && pendingFile) {
    const userPlanKey = (userPlan || 'free').toLowerCase();
    const canUsePro = userPlanKey.includes('pro') || userPlanKey.includes('studio') || isAdmin;
    const canUseStudio = userPlanKey.includes('studio') || isAdmin;

    const handleSelectOption = (stemsCount: number, requirePro: boolean, requireStudio: boolean) => {
      if (requireStudio && !canUseStudio) {
        setIsPricingOpen(true);
        return;
      }
      if (requirePro && !canUsePro) {
        setIsPricingOpen(true);
        return;
      }
      
      setFile(pendingFile);
      setSongName(pendingFile.name.replace(/\.[^/.]+$/, ""));
      setSeparationStep('upload'); // Reseta o step, pois o `file` que controla a tela de processamento.
      processAudio(pendingFile, stemsCount);
    };

    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col overflow-hidden">
        <button onClick={() => { setSeparationStep('upload'); setPendingFile(null); }} className="transport-btn absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold text-text-muted cursor-pointer uppercase tracking-wider">
          <ChevronLeft size={13}/> Voltar
        </button>

        <div className="flex-1 overflow-y-auto px-6 py-12">
          <div className="max-w-4xl mx-auto mt-8">
            <h1 className="text-3xl font-black text-white mb-2">Separar faixas</h1>
            <p className="text-text-muted text-sm mb-12">Selecione o nível de isolamento de instrumentos desejado</p>

            <div className="space-y-12">
              {/* Separação Básica */}
              <div>
                <h2 className="text-white font-bold text-sm mb-4">Separação Básica</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div 
                    onClick={() => handleSelectOption(2, false, false)}
                    className="hw-btn flex flex-col p-6 rounded-xl cursor-pointer hover:bg-white/5 transition-colors border border-border/50 hover:border-primary/50 group"
                  >
                    <div className="text-white font-bold text-base mb-2 group-hover:text-primary transition-colors">Vocais, Instrumental</div>
                    <div className="text-text-muted text-xs">2 faixas</div>
                  </div>
                  <div 
                    onClick={() => handleSelectOption(4, false, false)}
                    className="hw-btn flex flex-col p-6 rounded-xl cursor-pointer hover:bg-white/5 transition-colors border border-border/50 hover:border-primary/50 group"
                  >
                    <div className="text-white font-bold text-base mb-2 group-hover:text-primary transition-colors">Vocais, Bateria, Baixo, Outros</div>
                    <div className="text-text-muted text-xs">4 faixas</div>
                  </div>
                </div>
              </div>

              {/* Separação Pro */}
              <div>
                <h2 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
                  Separação Avançada
                  {!canUsePro && <span className="bg-yellow-500/20 text-yellow-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider ml-2">PRO</span>}
                </h2>
                <div className="grid grid-cols-1 gap-4">
                  <div 
                    onClick={() => handleSelectOption(6, true, false)}
                    className={`hw-btn flex items-center p-6 rounded-xl border transition-colors group ${canUsePro ? 'cursor-pointer hover:bg-white/5 border-border/50 hover:border-primary/50' : 'cursor-not-allowed opacity-50 border-border/20 bg-black/20'}`}
                  >
                    <div className="flex-1">
                      <div className="text-white font-bold text-base mb-2">Vocais, Bateria, Baixo, Guitarra, Piano, Outros</div>
                      <div className="text-text-muted text-xs">6 faixas</div>
                    </div>
                    {!canUsePro && <Lock size={20} className="text-text-muted/50" />}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {isPricingOpen && <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />}
      </div>
    );
  }

  if (separationStep === 'upload' && !file && stems.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col overflow-hidden">
        <button onClick={onClose} className="transport-btn absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold text-text-muted cursor-pointer uppercase tracking-wider">
          <ChevronLeft size={13}/> Voltar
        </button>

        <div className="flex-1 overflow-y-auto">
          {/* ── Hero / Upload ── */}
          <div className="flex flex-col items-center text-center pt-16 pb-8 px-6">
            <div className="w-20 h-20 mb-8 rounded-2xl flex items-center justify-center border border-border bg-surface relative shadow-[0_0_40px_rgba(212,168,67,0.08)]">
              <Disc3 size={36} className="text-primary animate-[spin_10s_linear_infinite]" />
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary animate-pulse"></div>
            </div>
            <h1 className="text-3xl font-black tracking-[0.15em] uppercase mb-2 text-white">SEPARADOR IA</h1>
            <p className="text-text-muted mb-8 text-[10px] font-mono tracking-widest uppercase">Motor de Separação Multi-faixa Profissional</p>
            <label className="w-full max-w-md hw-btn flex flex-col items-center gap-4 px-8 py-10 rounded-xl cursor-pointer group">
              <UploadCloud size={36} className="text-primary group-hover:scale-110 transition-transform" />
              <div>
                <div className="font-black text-white uppercase tracking-wider text-sm mb-1">Carregar Áudio & Iniciar</div>
                <div className="text-[10px] text-text-muted/50 font-mono">MP3, WAV ou AAC</div>
              </div>
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* ── Separation Library ── */}
          <div className="max-w-3xl mx-auto px-4 pb-12">
            <div className="flex items-center gap-2 mb-4">
              <FolderOpen size={14} className="text-primary" />
              <h2 className="text-white font-black text-xs uppercase tracking-[0.15em]">Minhas Separações</h2>
              <span className="text-[9px] font-mono text-text-muted/40 ml-auto">{separations.length} salva(s)</span>
            </div>

            {isLibLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-primary" />
              </div>
            ) : separations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Disc3 size={32} className="text-text-muted/15 mb-3" />
                <p className="text-text-muted/40 text-[10px] font-mono">Nenhuma separação salva ainda.</p>
                <p className="text-text-muted/25 text-[9px] font-mono mt-1">Faça sua primeira separação e ela aparecerá aqui automaticamente.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {separations.map(sep => (
                  <div key={sep.id}
                    className="group bg-[#141416] border border-[#222] hover:border-primary/30 rounded-lg p-3.5 transition-all hover:bg-[#1a1a1c] cursor-pointer relative"
                    onClick={() => handleOpenSavedSeparation(sep)}
                  >
                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSeparation(sep.id); }}
                      className="absolute top-2 right-2 p-1.5 rounded-md text-text-muted/30 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-10"
                      title="Excluir separação"
                    >
                      <Trash2 size={12} />
                    </button>

                    {/* Song name */}
                    <div className="font-black text-white text-[11px] uppercase tracking-wider truncate pr-8 mb-1.5">
                      {sep.songName || 'Sem título'}
                    </div>

                    {/* Artist */}
                    {sep.artist && (
                      <div className="text-text-muted/50 text-[9px] font-mono truncate mb-2.5">{sep.artist}</div>
                    )}

                    {/* Metadata chips */}
                    <div className="flex items-center gap-1.5 mb-3">
                      {sep.songKey && sep.songKey !== 'C' && (
                        <span className="text-[8px] font-bold bg-secondary/10 text-secondary/80 px-1.5 py-0.5 rounded font-mono">{sep.songKey}</span>
                      )}
                      {sep.bpm && sep.bpm !== '120' && (
                        <span className="text-[8px] font-bold bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded font-mono">{sep.bpm} BPM</span>
                      )}
                      <span className="text-[8px] font-bold bg-white/5 text-text-muted/50 px-1.5 py-0.5 rounded font-mono">{sep.stems.length} faixas</span>
                    </div>

                    {/* Stem color dots */}
                    <div className="flex items-center gap-1 mb-2.5">
                      {sep.stems.slice(0, 6).map((s, i) => (
                        <div key={i} className="w-2.5 h-2.5 rounded-full border border-black/30" style={{ backgroundColor: s.color }} title={s.name} />
                      ))}
                      {sep.stems.length > 6 && (
                        <span className="text-[7px] text-text-muted/30 font-mono">+{sep.stems.length - 6}</span>
                      )}
                    </div>

                    {/* Footer: date + open */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[8px] text-text-muted/30 font-mono">
                        <Clock size={8} />
                        {new Date(sep.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-primary/60 group-hover:text-primary font-bold uppercase tracking-wider transition-colors">
                        <Play size={9} fill="currentColor" /> Abrir
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 mb-8 rounded-2xl flex items-center justify-center border border-border bg-surface relative">
          <Loader2 size={28} className="text-primary animate-spin" />
        </div>
        <h2 className="text-2xl font-black text-white tracking-[0.15em] uppercase mb-2">Analisando Frequências</h2>
        <p className="text-text-muted text-[10px] font-mono tracking-widest uppercase mb-8">Motor de IA GPU • Replicate</p>
        <div className="w-full max-w-sm mb-3">
          <div className="lcd-display rounded-md h-1.5 overflow-hidden">
            <div className="bg-primary h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
        <div className="text-[9px] text-text-muted font-mono h-8 text-center max-w-md">{progressMsg}</div>
        <p className="text-primary/60 text-[9px] mt-2 font-mono font-black tracking-[0.2em]">{progress}% CONCLUÍDO</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col font-sans select-none overflow-hidden">

      {/* ═══ HEADER ═══ */}
      <header className="h-12 bg-[#18181a] border-b border-[#222] flex items-center justify-between px-3 shrink-0 z-10 shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold text-text-muted hover:text-white cursor-pointer uppercase tracking-wider">
            <ChevronLeft size={13}/> Voltar
          </button>
          <div className="h-5 w-px bg-border mx-1 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Disc3 size={12} className="text-primary" />
            </div>
            <div>
              <div className="font-black text-white text-[10px] uppercase tracking-[0.15em] leading-tight">Separador IA</div>
              <div className="text-[8px] font-mono text-text-muted truncate max-w-[180px]">{songName || 'Sem título'}</div>
            </div>
          </div>
        </div>

        {/* Center info chips */}
        <div className="hidden md:flex items-center gap-2">
          <div className="lcd-display px-2.5 py-1 rounded text-[9px] font-mono font-black text-primary">{bpm} BPM</div>
          <div className="lcd-display px-2.5 py-1 rounded text-[9px] font-mono font-black text-text-muted">{songKey}</div>
          <div className="lcd-display px-2.5 py-1 rounded text-[9px] font-mono text-text-muted/50">{stems.length} CH</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#0e0e10] border border-[#222] rounded-md p-0.5" title="Formato de download dos stems">
            <span className="text-[7px] font-mono font-bold text-text-muted/60 uppercase tracking-widest px-1.5 hidden sm:inline">DL</span>
            {(['wav', 'mp3'] as DownloadFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setDownloadFormat(fmt)}
                className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider font-mono transition-all cursor-pointer ${
                  downloadFormat === fmt
                    ? 'bg-primary/20 text-primary shadow-[0_0_8px_rgba(255,107,53,0.3)]'
                    : 'text-text-muted/60 hover:text-white'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
          <button onClick={() => setShowSaveForm(true)}
            className="transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider text-primary cursor-pointer border-primary/20">
            <Save size={12} /> EXPORTAR
          </button>
        </div>
      </header>

      {/* ── Auto-save Toast ── */}
      <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 pointer-events-none flex flex-col items-center
        ${libSaveToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className="bg-[#111] border border-[#333] shadow-2xl rounded-full px-4 py-2 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-primary" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">Salvo na Biblioteca</span>
        </div>
      </div>

      {/* ═══ WORKSPACE ═══ */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Channel Strip Controls */}
        <div className="w-[220px] bg-[#111113] border-r border-[#222] flex flex-col overflow-y-auto overflow-x-hidden shrink-0 z-10 shadow-[2px_0_12px_rgba(0,0,0,0.5)]">
          {/* Ruler spacer */}
          <div className="h-7 bg-[#0e0e10] border-b border-[#1e1e20] flex items-center px-3 shrink-0">
            <span className="text-[7px] font-mono text-text-muted/30 uppercase tracking-[0.25em]">MIXER · {stems.length} CH</span>
          </div>

          {stems.map((stem, trackIdx) => {
            const state = stemStates[stem.id];
            if (!state) return null;
            const isMutedByOther = (Object.values(stemStates).some(s => s.soloed) && !state.soloed) || state.muted;
            return (
              <div key={`ctrl-${stem.id}`} className="h-[88px] flex flex-col border-b border-[#1a1a1c] relative hover:bg-white/[0.01] transition-colors shrink-0">
                {/* Color strip */}
                <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: stem.color, boxShadow: `0 0 8px ${stem.color}50` }} />
                <div className="flex flex-col pt-3 px-2.5 pb-2 h-full">
                  {/* Row 1: number + name + M/S/DL */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[7px] font-mono font-bold text-text-muted/25 shrink-0">{String(trackIdx + 1).padStart(2, '0')}</span>
                      <span className="text-[8px] font-bold tracking-[0.1em] uppercase truncate font-mono" style={{ color: isMutedByOther ? '#444' : stem.color }}>
                        {stem.name}
                      </span>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], muted: !p[stem.id].muted } }))}
                        className={`w-6 h-5 rounded text-[8px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${state.muted ? 'bg-[#ff3b30] text-white shadow-[0_0_8px_rgba(255,59,48,0.5)]' : 'bg-[#333] text-[#666] hover:bg-[#444]'}`}>M</button>
                      <button onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], soloed: !p[stem.id].soloed } }))}
                        className={`w-6 h-5 rounded text-[8px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${state.soloed ? 'bg-[#ffcc00] text-black shadow-[0_0_8px_rgba(255,204,0,0.5)]' : 'bg-[#333] text-[#666] hover:bg-[#444]'}`}>S</button>
                      <button onClick={() => downloadStem(stem)} disabled={encodingStemId === stem.id}
                        title={`Baixar ${stem.name} (${downloadFormat.toUpperCase()})`}
                        className="w-6 h-5 rounded cursor-pointer border border-[#222] bg-[#333] text-[#666] hover:bg-[#444] hover:text-primary flex items-center justify-center transition-all active:scale-90 disabled:opacity-60 disabled:cursor-wait">
                        {encodingStemId === stem.id ? <Loader2 size={9} className="animate-spin" /> : <Download size={9} />}
                      </button>
                    </div>
                  </div>
                  {/* Row 2: Pan knob + Volume fader */}
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <div className="logic-pan-knob" style={{ width: 22, height: 22, cursor: 'ew-resize' }}
                        title="Pan (scroll=ajuste, clique=centro)"
                        onWheel={(e) => { e.preventDefault(); const np = Math.round(Math.max(-1, Math.min(1, state.pan + (e.deltaY > 0 ? -0.1 : 0.1))) * 10) / 10; setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: np } })); }}
                        onClick={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], pan: 0 } }))}>
                        <div className="logic-pan-indicator" style={{ transform: `rotate(${state.pan * 135}deg)` }} />
                      </div>
                      <span className="text-[6px] font-mono text-text-muted/30">
                        {state.pan === 0 ? 'C' : state.pan > 0 ? `R${Math.round(Math.abs(state.pan) * 50)}` : `L${Math.round(Math.abs(state.pan) * 50)}`}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <input type="range" min="0" max="1" step="0.01" value={state.volume}
                        onChange={(e) => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], volume: parseFloat(e.target.value) } }))}
                        className="daw-slider w-full" />
                      <div className="flex items-center justify-between">
                        <span className="text-[6px] font-mono text-text-muted/30 uppercase">VOL</span>
                        <div className="lcd-display px-1.5 py-0.5 rounded-[2px] text-[7px] font-mono text-accent-green">
                          {state.volume === 0 ? '-∞' : (state.volume * 10 - 10).toFixed(1)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT: Waveform area */}
        <div className="flex-1 bg-[#0a0a0c] relative overflow-y-auto overflow-x-hidden flex flex-col">

          {/* Time ruler */}
          <div className="h-7 bg-[#0e0e10] border-b border-[#1e1e20] sticky top-0 z-30 relative overflow-hidden shrink-0">
            {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(pct => (
              <div key={pct} className="absolute bottom-0 flex flex-col items-center pointer-events-none" style={{ left: `${pct}%` }}>
                <span className="text-[6px] font-mono text-text-muted/30 mb-0.5 -translate-x-1/2">
                  {songDuration > 0 ? formatCueTime(songDuration * pct / 100) : ''}
                </span>
                <div className="w-px h-2 bg-white/8" />
              </div>
            ))}
            {/* Playhead on ruler */}
            <div className="absolute top-0 bottom-0 w-px bg-primary/50 pointer-events-none z-10" style={{ left: `${progressPlayback}%` }} />
          </div>

          {/* Playhead over waveforms */}
          <div className="absolute top-7 bottom-0 w-px bg-white/80 z-20 pointer-events-none shadow-[0_0_6px_rgba(255,255,255,0.6)]"
            style={{ left: `${progressPlayback}%` }}>
            <div className="absolute -top-1.5 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-transparent border-t-white" />
          </div>

          {/* Voice Cue Markers */}
          {songDuration > 0 && voiceCues.map(cue => (
            <div key={`marker-${cue.id}`}
              className="absolute top-7 bottom-0 z-20 cursor-pointer group/cue"
              style={{ left: `${(cue.time / songDuration) * 100}%` }}
              onClick={() => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(cue.time)); voiceCuesRef.current.forEach(c => { c.fired = c.time < cue.time - 0.1; }); }}
              title={`${cue.label} · ${formatCueTime(cue.time)}`}
            >
              <div className="w-px h-full bg-yellow-400/40 group-hover/cue:bg-yellow-400 transition-colors" />
              <div className="absolute top-0 left-0.5 bg-yellow-400 text-black text-[6px] font-black px-1 py-0.5 rounded-[3px] whitespace-nowrap leading-tight shadow-sm group-hover/cue:bg-yellow-300 transition-colors">
                {cue.label}
              </div>
            </div>
          ))}

          {stems.map((stem) => (
            <div key={`wavewrap-${stem.id}`} className="h-[88px] border-b border-[#1a1a1c] relative shrink-0"
              style={{ background: `linear-gradient(180deg, ${stem.color}05 0%, transparent 100%)` }}>
              <div id={`waveform-${stem.id}`} className="absolute w-full top-0 h-full" />
            </div>
          ))}
        </div>
      </div>

      {/* ═══ TRANSPORT FOOTER ═══ */}
      <footer className="h-14 bg-[#18181a] border-t border-[#222] shrink-0 px-3 flex items-center justify-between z-20 shadow-[0_-2px_12px_rgba(0,0,0,0.6)]">

        {/* Left: Tool buttons */}
        <div className="flex-1 flex items-center gap-1.5">
          <button onClick={() => setShowBpmModal(true)}
            className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer">
            <span className="text-[7px] text-text-muted uppercase tracking-widest font-bold font-mono">BPM</span>
            <span className="text-primary text-[11px] font-mono font-black">{bpm}</span>
          </button>

          <div className="relative">
            <button onClick={() => setIsKeyPickerOpen(p => !p)}
              className={`transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer ${isKeyPickerOpen ? 'border-primary/40' : ''}`}>
              <span className="text-[7px] text-text-muted uppercase tracking-widest font-bold font-mono">TOM</span>
              <span className="text-primary text-[11px] font-mono font-black">{songKey}</span>
            </button>
            {isKeyPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsKeyPickerOpen(false)} />
                <div className="absolute bottom-full mb-2 left-0 bg-[#1c1c1e] border border-[#333] rounded-xl z-50 p-3 w-44 shadow-2xl">
                  <p className="text-[8px] text-text-muted mb-2 font-mono uppercase tracking-wider">Selecionar tom:</p>
                  <div className="grid grid-cols-4 gap-1">
                    {KEYS.map(k => (
                      <button key={k} onClick={() => { setSongKey(k); setIsKeyPickerOpen(false); }}
                        className={`py-1.5 text-[9px] font-bold rounded transition-colors cursor-pointer font-mono ${songKey === k ? 'bg-primary text-black' : 'text-white/70 bg-white/5 hover:bg-primary/20 hover:text-primary'}`}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {stems.length > 0 && (
            <button onClick={() => setShowBpmModal(true)}
              className="transport-btn flex items-center gap-1 px-2.5 py-1.5 rounded-md cursor-pointer text-text-muted hover:text-primary transition-colors">
              <span className="text-[7px] uppercase tracking-widest font-bold font-mono">+ CLICK</span>
            </button>
          )}

          {stems.length > 0 && (
            <button onClick={() => setShowVoiceGuide(true)}
              className={`transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-all ${voiceCues.length > 0 ? 'text-yellow-400 border-yellow-500/30' : 'text-text-muted hover:text-yellow-400'}`}>
              <Mic size={10} />
              <span className="text-[7px] uppercase tracking-widest font-bold font-mono hidden sm:inline">
                VOZ {voiceCues.length > 0 && `(${voiceCues.length})`}
              </span>
            </button>
          )}

          <div className="transport-btn flex items-center gap-0.5 rounded-md px-1 h-8">
            <span className="text-[7px] text-text-muted uppercase tracking-widest font-bold px-1.5 font-mono hidden sm:inline">SYNC</span>
            <button onClick={() => setClickOffsetMs(p => p - 10)} className="w-5 h-full flex items-center justify-center text-text-muted hover:text-white rounded cursor-pointer"><ChevronLeft size={11}/></button>
            <span className="text-[9px] text-primary font-mono font-black w-9 text-center">{clickOffsetMs > 0 ? '+' : ''}{clickOffsetMs}</span>
            <button onClick={() => setClickOffsetMs(p => p + 10)} className="w-5 h-full flex items-center justify-center text-text-muted hover:text-white rounded cursor-pointer"><ChevronRight size={11}/></button>
            <span className="text-[6px] text-text-muted/40 font-mono mr-1">ms</span>
          </div>
        </div>

        {/* Center: Transport controls */}
        <div className="flex gap-2 items-center flex-1 justify-center">
          <button onClick={() => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(0)); voiceCuesRef.current.forEach(c => { c.fired = false; }); }}
            className="transport-btn p-2 rounded-md text-text-muted hover:text-white cursor-pointer active:scale-90">
            <ChevronLeft size={18}/>
          </button>
          <button onClick={togglePlay}
            className={`transport-btn w-12 h-12 rounded-lg flex items-center justify-center cursor-pointer active:scale-95 transition-all ${isPlaying ? 'text-primary border-primary/40 shadow-[0_0_16px_rgba(212,168,67,0.2)]' : 'text-white hover:text-primary'}`}>
            {isPlaying ? <Pause size={22} fill="currentColor"/> : <Play size={22} fill="currentColor" className="ml-0.5"/>}
          </button>
          <button className="transport-btn p-2 rounded-md text-text-muted/20 cursor-not-allowed">
            <ChevronLeft size={18} className="rotate-180"/>
          </button>
        </div>

        {/* Right: Master volume */}
        <div className="flex-1 flex items-center justify-end gap-2">
          <span className="text-[7px] text-text-muted uppercase tracking-widest font-bold font-mono hidden sm:inline">MASTER</span>
          <Volume2 size={12} className="text-text-muted"/>
          <input type="range" min="0" max="1" step="0.01" value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            className="daw-slider w-24" title="Master Volume" />
          <div className="lcd-display px-2 py-1 rounded-[3px] text-[8px] font-mono text-accent-green w-11 text-center shrink-0">
            {masterVolume === 0 ? '-∞' : (masterVolume * 10 - 10).toFixed(1)}
          </div>
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
          <div className="bg-[#1c1c1e] w-full max-w-[360px] rounded-2xl p-5 shadow-2xl border border-white/5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white text-sm font-bold tracking-wide">BPM</span>
                <span className="text-white/40 text-xs font-medium ml-2">{getTempoName(parseInt(bpm) || 120)}</span>
              </div>
              <button onClick={() => !isGeneratingClick && setShowBpmModal(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1"><X size={18} /></button>
            </div>

            {/* BPM stepper */}
            <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2">
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

            {/* Tap + 2x row */}
            <div className="flex gap-2">
              <button
                onClick={handleTapTempo}
                disabled={isGeneratingClick}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer active:scale-95 transition-all bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40">
                TAP TEMPO
              </button>
              <button
                onClick={() => setBpm(String(Math.min(300, (parseInt(bpm) || 120) * 2)))}
                disabled={isGeneratingClick}
                className="px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer active:scale-95 transition-all bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40">
                2×
              </button>
              <button
                onClick={() => setBpm(String(Math.max(40, Math.round((parseInt(bpm) || 120) / 2))))}
                disabled={isGeneratingClick}
                className="px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer active:scale-95 transition-all bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40">
                ½×
              </button>
            </div>

            {/* Time signature */}
            <div>
              <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold mb-2">Compasso</p>
              <div className="grid grid-cols-6 gap-1">
                {(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'] as const).map(ts => (
                  <button key={ts} onClick={() => setTimeSignature(ts)} disabled={isGeneratingClick}
                    className={`py-2 rounded-lg text-[10px] font-black transition-all cursor-pointer active:scale-95 border ${timeSignature === ts ? 'bg-primary/15 border-primary text-primary' : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438]'}`}>
                    {ts}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent beat 1 toggle */}
            <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl px-4 py-3">
              <span className="text-white/60 text-xs font-bold uppercase tracking-wider">Acentuar Tempo 1</span>
              <button
                onClick={() => setAccentBeat1(p => !p)}
                disabled={isGeneratingClick}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer border ${accentBeat1 ? 'bg-primary border-primary' : 'bg-[#2a2a2d] border-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${accentBeat1 ? 'left-5 bg-black' : 'left-0.5 bg-white/40'}`} />
              </button>
            </div>

            {/* Click Sound selector */}
            {!isGeneratingClick && (
              <div>
                <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold mb-2">Som do Click</p>
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {CLICK_TYPES.map(t => (
                    <button key={t.id} onClick={() => updateClickSel({ type: t.id })}
                      className={`py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer active:scale-95 border ${clickSel.type === t.id ? 'bg-primary/15 border-primary text-primary' : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438]'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {CLICK_SUBDIVISIONS.map(s => (
                    <button key={s.id} onClick={() => updateClickSel({ subdivision: s.id })}
                      className={`py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer active:scale-95 border ${clickSel.subdivision === s.id ? 'bg-primary/15 border-primary text-primary' : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438]'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isGeneratingClick && (
              <div className="text-center text-[10px] font-bold text-primary animate-pulse uppercase tracking-wider">
                Gerando click {clickSel.type}...
              </div>
            )}

            <button onClick={addMetronomeChannel} disabled={isGeneratingClick || stems.length === 0}
              className="w-full bg-[#2a2a2d] hover:bg-[#343438] text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider cursor-pointer border border-white/5 active:scale-95">
              {isGeneratingClick ? <Loader2 size={16} className="animate-spin" /> : <Play fill="currentColor" size={14} />}
              GERAR CLICK · {clickSel.type} {timeSignature} {clickSel.subdivision}
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
                {isPlaying ? '▶ Clique em uma seção para marcar o tempo atual' : 'Reproduza a música e clique para carimbar o tempo. Ou use Auto-Detectar.'}
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
                      <input
                        defaultValue={formatCueTime(cue.time)}
                        key={`${cue.id}-${Math.floor(cue.time)}`}
                        onBlur={e => updateCueTime(cue.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        className="text-yellow-400 font-mono text-[10px] font-bold w-12 bg-transparent border-b border-yellow-400/30 focus:border-yellow-400 focus:outline-none text-center shrink-0"
                      />
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
