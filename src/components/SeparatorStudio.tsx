import { apiUrl } from '../lib/api';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { uploadToR2 } from '../lib/r2';
import { getAuthHeaders } from '../lib/supabase';
import { fetchMonthlyQuota, formatDateBR } from '../lib/separationUsage';
import { useAuth } from '../hooks/useAuth';
import { useLivre } from '../hooks/useLivre';
import { canDownloadStems, canUseVoiceGuide, canUseBpmDetection, planTier, separationStemOptions, ALL_STEM_COUNTS, type StemCount } from '../lib/plans';
import { isQuiet, separationIsThisMonth, separationKey, type EngineBusy } from '../lib/livreRules';
import { PricingModal } from './PricingModal';
import { LimitGate } from './livre/LimitGate';
import { AdSlot } from './livre/AdSlot';
import { type BeatGrid } from '../lib/beatGrid';
import { SyncedTrackPlayer } from '../lib/syncedTrackPlayer';
import { loadClickSelection, saveClickSelection, getClickSampleUrl } from '../lib/clickLibrary';
import { useSeparationLibrary, type SavedSeparation } from '../hooks/useSeparationLibrary';
import { GuidedTour, type TourStep } from './GuidedTour';
import { SeparatorHome } from './separator/SeparatorHome';
import { SeparatorOptions } from './separator/SeparatorOptions';
import { SeparatorProgress } from './separator/SeparatorProgress';
import { OPENING_COPY, PLAYER_COPY, PROGRESS_COPY, laneFloor } from './separator/separatorCopy';
import { OPEN_ERROR_TEXT, fetchSeparationFiles, stemsToOpen, type StageSeparationOpen } from '../lib/separation/stageHandoff';
import { SeparatorPlayerBar } from './separator/SeparatorPlayerBar';
import { SeparatorTrackStrip } from './separator/SeparatorTrackStrip';
import { FAMILY_COLOR } from '../lib/channelNames';
import { Notice } from './ui';
import { StageDialog } from './stage/StageDialog';
import { BpmClickEditor } from './separation/BpmClickEditor';
import { VoiceGuideEditor } from './separation/VoiceGuideEditor';
import { CloudSaveForm } from './separation/CloudSaveForm';
import { BPM_COPY, CLOUD_COPY, VOICE_COPY } from './separation/toolsCopy';
import { detectVoiceCues, formatCueTime, guideUrl, parseCueTime, renderVoiceGuideWav, voiceSourceTrack, type VoiceCue } from '../lib/separation/voiceGuide';
import { BEATS_PER_BAR, bpmReport, clickPlan, generateSeparatorClick, measureGrid, normalizeBpm, nudgeOffset, pickGridSource as pickGridTrack, scaleBpm, stepBpm, tapTempo, type SeparatorMeter } from '../lib/separation/separatorClick';
import { downloadStem as downloadStemFile, readDownloadFormat, writeDownloadFormat, type DownloadFormat } from '../lib/separation/stemFiles';
import { CLOUD_STATUS, publishToCloud } from '../lib/separation/cloudPublish';

const SEP_TOUR_STEPS: TourStep[] = [
  { title: 'Separação de Faixas', body: 'Aqui você transforma qualquer música em faixas separadas (vocal, bateria, baixo, instrumentos) usando IA. Veja como funciona.' },
  { target: 'sep-upload', title: '1. Carregue a música', body: 'Envie um arquivo de áudio (MP3, WAV ou AAC) do seu computador. É o ponto de partida.' },
  { title: '2. Escolha as faixas', body: 'Depois de enviar, você escolhe em quantas faixas separar: 2, 4 ou 6. Quanto mais faixas, mais controle sobre cada instrumento.' },
  { title: '3. Processa na nuvem', body: 'A IA separa a música em alguns minutos e ela abre no palco, com as ferramentas no painel SEPARAÇÃO.' },
  { target: 'sep-biblioteca', title: '4. Suas separações', body: 'Tudo que você separa fica salvo aqui. Reabra quando quiser: a música abre no palco.' },
  { title: 'Pronto!', body: 'Carregue uma música e experimente. A separação é o atalho pra ter qualquer faixa pronta pro domingo.' },
]

// Onde o palco novo não aparece (tela menor ou palco Antigo), a separação abre no player do
// Separador, com as mesmas ferramentas: os passos 3 e 4 dizem isso. Os alvos são os mesmos.
const SEP_TOUR_STEPS_RESERVA: TourStep[] = SEP_TOUR_STEPS.map((step) =>
  step.title === '3. Processa na nuvem'
    ? { ...step, body: 'A IA separa a música em alguns minutos. Você pode ouvir cada faixa isolada, ajustar e gerar um click no tempo da música.' }
    : step.title === '4. Suas separações'
      ? { ...step, body: 'Tudo que você separa fica salvo aqui. Reabra quando quiser ou mande direto pro seu repertório do Multitracks.' }
      : step)

const NO_STAGE_SEPARATIONS: ReadonlySet<string> = new Set()

// Densidade da waveform: px por segundo de áudio. Timeline nunca comprime —
// se a duração * esse valor passar da largura visível, a área rola de lado.
const WAVEFORM_PX_PER_SECOND = 40;

interface StemData {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface SeparatorStudioProps {
  onClose: () => void;
  // O motor do palco (App), que continua tocando com o Separador aberto. A tela de limite e o
  // anúncio do Livre só aparecem com ele parado também (Ruling R12).
  stageBusy: EngineBusy;
  // Parte 3 (faixa D): com o palco novo na tela (chave Novo e janela larga), a separação abre no
  // palco; sem ele, aqui no player de reserva, como antes.
  stageAvailable?: boolean;
  // As separações que já estão no repertório do palco (não são baixadas de novo, P7).
  stageSeparationIds?: ReadonlySet<string>;
  onOpenOnStage?: (o: StageSeparationOpen) => void;
}

let globalAudioCtx: AudioContext | null = null;
function getAudioContext() {
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return globalAudioCtx;
}

export const SeparatorStudio: React.FC<SeparatorStudioProps> = ({ onClose, stageBusy, stageAvailable = false, stageSeparationIds = NO_STAGE_SEPARATIONS, onOpenOnStage }) => {
  const { user, userPlan, isAdmin, loading: authLoading } = useAuth();
  const canDownload = isAdmin || canDownloadStems(userPlan);
  const canVoiceGuide = isAdmin || canUseVoiceGuide(userPlan);
  const canBpm = isAdmin || canUseBpmDetection(userPlan);
  // Salvar/publicar na nuvem (songs/stems + WAVs no R2) é recurso pago. Livre usa só biblioteca local.
  const canCloudSave = isAdmin || planTier(userPlan) !== 'free';
  const { separations, saveSeparation, deleteSeparation, isLoading: isLibLoading } = useSeparationLibrary();
  const [activeSepId, setActiveSepId] = useState<string | null>(null);
  // Data da separação aberta: toda gravação leva ela, pra a de outro mês nunca virar "deste mês"
  // (sem ela o saveSeparation usa a da lista, que troca quando o plano muda).
  const [activeSepCreatedAt, setActiveSepCreatedAt] = useState<number | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>(() => readDownloadFormat());
  const [encodingStemId, setEncodingStemId] = useState<string | null>(null);
  useEffect(() => { writeDownloadFormat(downloadFormat); }, [downloadFormat]);
  const [libSaveToast, setLibSaveToast] = useState(false);
  const [publishGlobal, setPublishGlobal] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [separationStep, setSeparationStep] = useState<'upload' | 'options'>('upload');
  const [showSepTour, setShowSepTour] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Frase de erro na entrada do Separador (hoje era um alert): falha no processamento.
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  // Abrindo no palco: as faixas baixando (com o progresso) ou a frase do erro com Tentar de novo.
  const [opening, setOpening] = useState<{ sep: SavedSeparation; justSeparated: boolean; done: number; total: number; error: string | null } | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);
  // Frases de erro das três ferramentas, mostradas dentro da janela delas (hoje eram alert).
  const [bpmMessage, setBpmMessage] = useState<string | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Marcações que já estão no canal de Voz Guia: as outras acendem o "Gerar canal".
  const [committedCues, setCommittedCues] = useState<readonly VoiceCue[] | null>(null);

  // Tutorial da separação na primeira vez que a tela abre.
  useEffect(() => {
    if (localStorage.getItem('sep_tour_seen')) return;
    const t = setTimeout(() => setShowSepTour(true), 500);
    return () => clearTimeout(t);
  }, []);
  const closeSepTour = () => {
    setShowSepTour(false);
    localStorage.setItem('sep_tour_seen', '1');
  };
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState<StemData[]>([]);
  
  // Áudio Core
  const [isPlaying, setIsPlaying] = useState(false);

  // Livre (Parte 3): a instância do Separador (a tela de limite do App não aparece com ele aberto).
  // O motor que conta é o player daqui junto com o do palco atrás, que segue tocando (Ruling R12).
  // Os minutos do Ao Vivo correm só na instância do App.
  const busy: EngineBusy = { isPlaying: isPlaying || stageBusy.isPlaying, isCountingIn: stageBusy.isCountingIn };
  const quiet = isQuiet(busy);
  const livre = useLivre({ userId: user?.id ?? null, plan: userPlan, isAdmin, busy, liveActive: false, onLiveExpired: () => {} });
  // O useAuth desta tela começa em Livre até ler o perfil: quem paga e o admin nunca veem regra do
  // Livre nesse meio tempo.
  const isLivre = livre.isLivre && !authLoading;
  // A separação acabou de terminar (até abrir outra ou voltar): só ela chama o anúncio do fim.
  const [justSeparated, setJustSeparated] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const isLoopingRef = useRef(false);
  const wavesurfers = useRef<Record<string, WaveSurfer>>({});
  const panners = useRef<Record<string, StereoPannerNode>>({});
  const gainNodes = useRef<Record<string, GainNode>>({});
  // Um player Web Audio por faixa, todos no mesmo AudioContext (sincronia por amostra).
  const players = useRef<Record<string, SyncedTrackPlayer>>({});
  // URL carregada em cada faixa: o efeito das ondas só recria a faixa que mudou.
  const trackUrls = useRef<Record<string, string>>({});
  // Faixa de referência do transporte (a primeira): tempo, fim da música, loop.
  const masterIdRef = useRef<string | null>(null);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [progressPlayback, setProgressPlayback] = useState(0);
  // Altura de cada faixa: preenche o espaço vertical disponível conforme o nº de stems.
  const [laneHeight, setLaneHeight] = useState(96);
  
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
  const [timeSignature, setTimeSignature] = useState<SeparatorMeter>('4/4');
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

  // Baixar sem o download no plano: no Livre a tela de limite (aparece com a música parada); quem
  // paga abre os Planos como sempre.
  const blockDownload = () => {
    if (isLivre) livre.requestLimit('download');
    else setIsPricingOpen(true);
  };

  const downloadStem = async (stem: StemData) => {
    if (!canDownload) { blockDownload(); return; }
    try {
      setDownloadError(null);
      setEncodingStemId(stem.id);
      await downloadStemFile({ url: stem.url, songName, stemName: stem.name, format: downloadFormat });
    } catch (e) {
      console.error('Download error', e);
      setDownloadError(PLAYER_COPY.downloadError);
    } finally {
      setEncodingStemId(null);
    }
  };

  const handleTapTempo = () => {
    const tapped = tapTempo(bpmTapsRef.current, Date.now());
    bpmTapsRef.current = tapped.taps;
    if (tapped.bpm) setBpm(tapped.bpm);
  };

  // Voz Guia
  const [voiceCues, setVoiceCues] = useState<VoiceCue[]>([]);
  const [showVoiceGuide, setShowVoiceGuide] = useState(false);
  const [voiceGuideTab, setVoiceGuideTab] = useState<'sections' | 'dynamic'>('sections');
  const [songDuration, setSongDuration] = useState(0);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isRenderingGuide, setIsRenderingGuide] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const voiceCuesRef = useRef<(VoiceCue & { fired: boolean })[]>([]);
  const guideBufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  // Drag de marcadores na timeline
  const waveAreaRef = useRef<HTMLDivElement>(null);
  // Coluna de controles (esquerda) e ondas (direita) rolam JUNTAS na vertical: com
  // mais faixas do que cabem na tela (ex.: celular deitado), as linhas não desalinham.
  const ctrlColRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const syncVerticalScroll = (from: 'ctrl' | 'wave') => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingScrollRef.current) { syncingScrollRef.current = false; return; }
    const other = from === 'ctrl' ? waveAreaRef.current : ctrlColRef.current;
    const top = e.currentTarget.scrollTop;
    if (other && Math.abs(other.scrollTop - top) > 0.5) {
      syncingScrollRef.current = true;
      other.scrollTop = top;
    }
  };
  // Wrapper interno com a largura real da timeline (pode ser mais larga que o viewport visível e rolar de lado)
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const draggingCueRef = useRef<string | null>(null);
  const cueDragMovedRef = useRef(false);
  const cueRafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);


  // ── Click sincronizado ──
  // Ajuste fino (ms) que vai GRAVADO no arquivo do click na hora de gerar
  // (positivo = click mais tarde). Antes o SYNC tentava deslocar o <audio> do
  // click na reprodução, mas procurava a faixa 'click' (o id é 'metronome'):
  // nunca fazia nada, e ainda se perdia no loop e no começo da música.
  const [clickOffsetMs, setClickOffsetMs] = useState(0);
  // "Mover o 1": quantos tempos deslocar o acento caso a detecção erre o tempo forte.
  const [downbeatShift, setDownbeatShift] = useState(0);
  const [isDetectingBpm, setIsDetectingBpm] = useState(false);
  const [gridInfo, setGridInfo] = useState<string>('');
  // Grade medida do áudio, reaproveitada no ajuste fino sem reanalisar.
  const beatGridRef = useRef<{ key: string; grid: BeatGrid } | null>(null);

  // Fala da voz guia decodificada, com o cache desta tela (a mistura e o disparo usam as duas).
  const decodeGuide = useCallback(async (url: string): Promise<AudioBuffer | null> => {
    const cached = guideBufferCache.current.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      const buffer = await getAudioContext().decodeAudioData(await res.arrayBuffer());
      guideBufferCache.current.set(url, buffer);
      return buffer;
    } catch (e) {
      console.error('Voz Guia: erro ao carregar áudio:', url, e);
      return null;
    }
  }, []);

  const playGuideBuffer = useCallback(async (file: string) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await decodeGuide(guideUrl(file));
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  }, [decodeGuide]);

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
    const total = parseCueTime(raw);
    setVoiceCues(prev => prev.map(c => c.id === id ? { ...c, time: total } : c).sort((a, b) => a.time - b.time));
  };

  // ── Arrastar marcador na timeline ──
  const timeFromClientX = (clientX: number): number => {
    const rect = timelineContentRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || songDuration <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * songDuration;
  };
  const handleCuePointerDown = (e: React.PointerEvent, cueId: string) => {
    e.stopPropagation();
    draggingCueRef.current = cueId;
    cueDragMovedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handleCuePointerMove = (e: React.PointerEvent) => {
    if (draggingCueRef.current === null) return;
    cueDragMovedRef.current = true;
    const t = timeFromClientX(e.clientX);
    setVoiceCues(prev => prev.map(c => c.id === draggingCueRef.current ? { ...c, time: t } : c));
  };
  const handleCuePointerUp = (e: React.PointerEvent, cue: VoiceCue) => {
    const wasDragging = draggingCueRef.current !== null;
    const moved = cueDragMovedRef.current;
    draggingCueRef.current = null;
    if (!wasDragging) return;
    if (moved) {
      // Reordena por tempo e rearma o disparo das cues a partir do novo ponto.
      setVoiceCues(prev => [...prev].sort((a, b) => a.time - b.time));
      voiceCuesRef.current.forEach(c => { c.fired = c.time < timeFromClientX(e.clientX) - 0.1; });
    } else {
      // Clique simples (sem arrastar) = navega o playhead até a cue.
      Object.values(wavesurfers.current).forEach(ws => ws.setTime(cue.time));
      voiceCuesRef.current.forEach(c => { c.fired = c.time < cue.time - 0.1; });
    }
  };

  // ── Renderiza a Voz Guia num canal real (igual ao Click) ──
  // Sobe o áudio pro R2 → URL https → persiste automaticamente como qualquer stem.
  const commitVoiceGuideChannel = async () => {
    if (voiceCues.length === 0) { setVoiceMessage(VOICE_COPY.needCues); return; }
    setVoiceMessage(null);
    setIsRenderingGuide(true);
    const committing = voiceCues;
    try {
      const blob = await renderVoiceGuideToBlob();
      if (!blob) throw new Error('Falha ao renderizar voz guia');
      const file = new File([blob], 'voz_guia.wav', { type: 'audio/wav' });
      const up = await uploadToR2('stems', `${user?.id || 'anon'}/${activeSepId || 'tmp'}/voz_guia_${Date.now()}.wav`, file);
      const url = (!up.error && up.url) ? up.url : URL.createObjectURL(blob);
      setStems(prev => {
        const old = prev.find(s => s.id === 'voiceguide');
        if (old && old.url.startsWith('blob:')) URL.revokeObjectURL(old.url);
        const guideStem: StemData = { id: 'voiceguide', name: 'Voz Guia', url, color: '#fbbf24' };
        return [...prev.filter(s => s.id !== 'voiceguide'), guideStem];
      });
      setStemStates(p => ({ ...p, voiceguide: p.voiceguide ?? { muted: false, soloed: false, volume: 0.9, pan: 0 } }));
      setCommittedCues(committing);
      setShowVoiceGuide(false);
    } catch (e) {
      console.error('Erro ao gerar canal de Voz Guia', e);
      setVoiceMessage(VOICE_COPY.renderError);
    } finally {
      setIsRenderingGuide(false);
    }
  };

  const renderVoiceGuideToBlob = (): Promise<Blob | null> =>
    renderVoiceGuideWav(voiceCues, songDuration || 300, decodeGuide);

  const autoDetectVoiceGuide = async () => {
    setVoiceMessage(null);
    setIsAutoDetecting(true);
    try {
      const ctx = getAudioContext();
      let buffer: AudioBuffer;

      // Preferimos a faixa de VOCAIS como fonte: em louvor a entrada/saída e a
      // intensidade do vocal demarcam as seções com muito mais clareza do que a
      // energia do mix completo (onde a bateria domina e borra os limites).
      // O nome passa pela regra central: a Voz Guia é da família Guia, não Vocal.
      const sourceStem = voiceSourceTrack(stems);

      if (sourceStem) {
        const res = await fetch(sourceStem.url);
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      } else if (file) {
        buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      } else {
        throw new Error('Sem faixas para analisar');
      }

      setVoiceCues(detectVoiceCues(buffer, bpm));
    } catch (e: any) {
      console.error('Auto-detect erro:', e);
      setVoiceMessage(VOICE_COPY.detectError(e.message));
    } finally {
      setIsAutoDetecting(false);
    }
  };

  // Controle de Master e Mute/Solo via GainNode (garante funcionamento no Safari).
  // Lê de refs pra poder ser chamado também quando uma faixa nasce (senão o click
  // recém-gerado tocava com volume cheio até alguém mexer no mixer).
  const stemStatesRef = useRef(stemStates);
  const masterVolumeRef = useRef(masterVolume);
  const applyMix = useCallback(() => {
    const states = stemStatesRef.current;
    const hasSolo = Object.values(states).some(s => s.soloed);
    const ctx = getAudioContext();
    Object.keys(gainNodes.current).forEach(id => {
      const state = states[id];
      const gainNode = gainNodes.current[id];
      const panner = panners.current[id];
      if (!state || !gainNode) return;
      let finalVol = state.volume * masterVolumeRef.current;
      if (state.muted) finalVol = 0;
      else if (hasSolo && !state.soloed) finalVol = 0;
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setValueAtTime(finalVol, ctx.currentTime);
      if (panner) panner.pan.value = state.pan;
    });
  }, []);
  useEffect(() => {
    stemStatesRef.current = stemStates;
    masterVolumeRef.current = masterVolume;
    applyMix();
  }, [stemStates, masterVolume, stems, applyMix]);

  // ── Transporte: todas as faixas no mesmo relógio ──
  const getMasterWs = useCallback((): WaveSurfer | undefined => {
    const id = masterIdRef.current;
    return (id && wavesurfers.current[id]) || Object.values(wavesurfers.current)[0];
  }, []);

  const playAll = useCallback(async () => {
    const ctx = getAudioContext();
    // iOS/Safari: precisa ESPERAR o resume antes de agendar, senão as faixas são
    // agendadas com o relógio parado e saem mudas.
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) { console.error('Falha ao retomar o áudio', e); }
    }
    const all = Object.values(wavesurfers.current);
    const t = getMasterWs()?.getCurrentTime() ?? 0;
    // Mesmo tick de JS → mesmo instante de início em todas (ver SyncedTrackPlayer).
    all.forEach(ws => ws.setTime(t));
    all.forEach(ws => { void ws.play(); });
    setIsPlaying(true);
  }, [getMasterWs]);

  const pauseAll = useCallback(() => {
    Object.values(wavesurfers.current).forEach(ws => ws.pause());
    setIsPlaying(false);
  }, []);

  const seekAll = useCallback((time: number) => {
    const t = Math.max(0, time);
    Object.values(wavesurfers.current).forEach(ws => ws.setTime(t));
  }, []);

  // Sincroniza voiceCuesRef com state preservando fired
  useEffect(() => {
    const currentMap = new Map(voiceCuesRef.current.map(c => [c.id, c.fired]));
    voiceCuesRef.current = voiceCues.map(c => ({ ...c, fired: currentMap.get(c.id) ?? false }));
  }, [voiceCues]);

  // Persiste o estado atual na biblioteca local. Só os stems com URL remota (IA);
  // canais locais (blob: voz guia/metrônomo) são efêmeros e o usuário regera ao reabrir.
  const persistSeparation = useCallback(() => {
    if (!activeSepId) return Promise.resolve();
    // Nunca grava a separação sem faixas (a que foi pro palco nunca é sobrescrita ao fechar).
    if (!stems.some(s => /^https?:\/\//.test(s.url))) return Promise.resolve();
    return saveSeparation({
      id: activeSepId,
      createdAt: activeSepCreatedAt ?? undefined,
      songName, artist, bpm, songKey,
      // Persiste todo stem com URL remota (IA + canais já subidos pro R2), levando
      // junto o estado do mixer (mute/solo/volume/pan) de cada faixa.
      stems: stems
        .filter(s => /^https?:\/\//.test(s.url))
        .map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color, state: stemStates[s.id] })),
      voiceCues,
    }).catch(() => {});
  }, [activeSepId, activeSepCreatedAt, songName, artist, bpm, songKey, stems, stemStates, voiceCues, saveSeparation]);

  // Mantém uma ref pra versão mais recente — usada no flush ao desmontar.
  const persistRef = useRef(persistSeparation);
  useEffect(() => { persistRef.current = persistSeparation; }, [persistSeparation]);

  // Auto-save (debounced) em qualquer edição: cues, BPM, tom, nome, artista.
  useEffect(() => {
    if (!activeSepId) return;
    const t = setTimeout(() => { persistSeparation(); }, 800);
    return () => clearTimeout(t);
  }, [voiceCues, bpm, songKey, songName, artist, activeSepId, persistSeparation]);

  // Flush ao desmontar (ex.: fechar o estúdio) — garante o último estado salvo.
  useEffect(() => {
    return () => { persistRef.current?.(); };
  }, []);

  // Voltar do estúdio → tela inicial do Separador (upload + Minhas Separações),
  // não pra home do app. Salva antes e limpa a sessão atual.
  const goToSeparatorHome = () => {
    persistSeparation();
    // Revoga URLs locais dos canais gerados pra não vazar memória.
    stems.forEach(s => { if (s.url.startsWith('blob:')) URL.revokeObjectURL(s.url); });
    setStems([]);
    setStemStates({});
    setVoiceCues([]);
    voiceCuesRef.current = [];
    setFile(null);
    setActiveSepId(null);
    setActiveSepCreatedAt(null);
    setJustSeparated(false);
    setSeparationStep('upload');
    resetClickSync();
  };

  // Grade e ajuste fino são da música aberta: zera ao trocar de separação.
  function resetClickSync() {
    beatGridRef.current = null;
    autoDetectedForRef.current = null;
    setClickOffsetMs(0);
    setDownbeatShift(0);
    setGridInfo('');
  }

  // Salvar manual (botão) — força a gravação e mostra confirmação ao usuário.
  const forceSave = async () => {
    if (!activeSepId || isManualSaving) return;
    setIsManualSaving(true);
    try {
      await persistSeparation();
      setLibSaveToast(true);
      setTimeout(() => setLibSaveToast(false), 2500);
    } finally {
      setIsManualSaving(false);
    }
  };

  // Atualiza isPlayingRef
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);

  // Scheduler de cues — RAF loop
  useEffect(() => {
    if (!isPlaying) {
      if (cueRafRef.current !== null) { cancelAnimationFrame(cueRafRef.current); cueRafRef.current = null; }
      return;
    }
    const runScheduler = () => {
      const firstWs = getMasterWs();
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
  }, [isPlaying, playGuideBuffer, getMasterWs]);

  // Spacebar play/stop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (isPlayingRef.current) pauseAll();
      else void playAll();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playAll, pauseAll]);

  // Arquivo escolhido na entrada (botão ou arrastar e soltar): vai pra escolha das faixas.
  const handleFileUpload = (selected: File) => {
    setHomeNotice(null);
    setPendingFile(selected);
    setSeparationStep('options');
  };

  // Livre sem separação no mês (pelo contador lido antes ou pelo 402 do servidor): a tela de limite
  // no lugar do alert, que aparece com a música parada (a daqui e a do palco atrás), e a tela de
  // envio volta. Quem paga segue com o aviso da data e os Planos (Ruling R11).
  const showLivreSeparationLimit = () => {
    livre.requestLimit('separations');
    setIsProcessing(false);
    setFile(null);
  };

  const processAudio = async (audioFile: File, stemCount: number) => {
    // ── Cota do mês (lida do banco, a mesma que o servidor usa) ──
    // Só evita subir o arquivo à toa: quem decide de verdade é o servidor (402).
    // Se não der pra ler o contador, segue e deixa o servidor responder.
    // O limite soma o extra do mês dado pelo admin (o servidor soma igual); lido junto
    // com o contador e com teto de 4 s, nunca atrasa a separação. Sem o extra (erro, SQL
    // que não rodou ou leitura lenta), vale o do plano.
    if (!isAdmin) {
      const { usage, limit: maxLimit } = await fetchMonthlyQuota(userPlan);
      if (usage && usage.used >= maxLimit) {
        if (isLivre) { showLivreSeparationLimit(); return; }
        alert(`Você já usou as ${maxLimit} separações deste mês. O contador volta a zero em ${formatDateBR(usage.resetsAt)}.`);
        setIsPricingOpen(true);
        return;
      }
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressMsg(PROGRESS_COPY.steps.start);

    try {
      // 1. O Cloudflare tem upload muito mais rápido
      setProgressMsg(PROGRESS_COPY.steps.upload);
      const uploadRes = await uploadToR2('temp', `${Date.now()}_${audioFile.name}`, audioFile);
      if (uploadRes.error) throw new Error(uploadRes.error);
      const publicUrl = uploadRes.url!;
      setProgress(10);

      // 2. Chamar IA
      setProgressMsg(PROGRESS_COPY.steps.separating);
      const res = await fetch(apiUrl('/api/separate-audio'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ audioUrl: publicUrl, stemCount })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 402) {
          if (isLivre) { showLivreSeparationLimit(); return; }
          setIsPricingOpen(true);
          throw new Error(errBody.error || 'Você chegou no limite de separações deste mês.');
        }
        if (res.status === 401) throw new Error('Sessão expirada. Faça login novamente.');
        throw new Error(errBody.error || 'Falha ao iniciar IA.');
      }
      const { prediction } = await res.json();
      setProgress(30);
      
      // 3. Polling do Replicate
      let status = prediction.status;
      let finalOutput = null;
      
      while (status !== 'succeeded' && status !== 'failed') {
        setProgressMsg(PROGRESS_COPY.steps.waiting);
        await new Promise(resolve => setTimeout(resolve, 4000));
        setProgress(p => Math.min(85, p + 2)); 
        
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

      // As URLs do motor de IA (replicate.delivery) são EFÊMERAS: expiram em ~1h.
      // Re-hospedamos cada stem no R2 ANTES de exibir/salvar e usamos as URLs do
      // R2 também no estado em memória. Assim qualquer re-save posterior (gerar
      // click, voz guia, mexer no mixer, renomear via persistSeparation) grava as
      // URLs permanentes, e não as do Replicate — senão reabrir mostra as faixas
      // em branco. O upload é server-side (/api/upload-stem-from-url busca a URL e
      // grava no R2): o cliente não segura blob na RAM, seguro p/ memória do iOS.
      setProgress(92);
      const songSlug = `sep_${Date.now()}`;
      const persistedStems: StemData[] = await Promise.all(stemsArray.map(async (s) => {
        if (!user?.id || !/^https?:\/\//.test(s.url)) return s;
        try {
          const key = `stems/${user.id}/${songSlug}/${s.id}_${Date.now()}.wav`;
          const copyRes = await fetch(apiUrl('/api/upload-stem-from-url'), {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: JSON.stringify({ sourceUrl: s.url, key, contentType: 'audio/wav' }),
          });
          if (copyRes.ok) {
            const data = await copyRes.json();
            if (data?.url) return { ...s, url: data.url };
          }
          console.warn('[SepLib] Re-host falhou, mantendo URL temporária:', s.id, copyRes.status);
        } catch (e) {
          console.warn('[SepLib] Re-host erro:', s.id, e);
        }
        return s;
      }));

      setProgress(100);

      // ── Auto-save to local library ── (antes de mostrar: com o registro, a música pode abrir no palco)
      const createdAt = Date.now();
      const songTitle = audioFile.name.replace(/\.[^/.]+$/, '');
      const savedStems = persistedStems.map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color }));
      let sepId: string | null = null;
      try {
        sepId = await saveSeparation({
          songName: songTitle,
          artist: '',
          bpm: bpm,
          songKey: songKey,
          createdAt,
          stems: savedStems,
          voiceCues: [],
        });
      } catch (e) {
        console.warn('[SepLib] Auto-save failed:', e);
      }

      // Palco novo na tela e a separação salva: ela abre no palco (com o anúncio do fim no painel).
      // Sem registro (P10) ou sem o palco novo, o player daqui, como antes.
      if (sepId && stageAvailable) {
        setIsProcessing(false);
        setFile(null);
        void openOnStage({ id: sepId, songName: songTitle, artist: '', bpm, songKey, stems: savedStems, voiceCues: [], createdAt }, true);
        return;
      }

      setStemStates(initialStates);
      setStems(persistedStems);
      setIsProcessing(false);
      // Acabou de separar: é do mês, então abre sem contar nas 3 do Livre, e chama o anúncio do fim.
      setJustSeparated(true);
      if (sepId) {
        setActiveSepId(sepId);
        setActiveSepCreatedAt(createdAt);
        setLibSaveToast(true);
        setTimeout(() => setLibSaveToast(false), 2500);
      }

    } catch (e: any) {
      console.error(e);
      // Volta pra entrada com a frase no topo (no lugar do alert de antes).
      setHomeNotice('Erro no processamento: ' + e.message);
      setIsProcessing(false);
      setFile(null);
    }
  };

  // Altura de cada faixa a partir da área visível das ondas (menos a régua de 28px).
  // Piso menor em tela baixa (celular deitado) pra caberem mais faixas sem cortar.
  const computeLaneHeight = useCallback((count: number) => {
    const areaH = waveAreaRef.current?.clientHeight || (window.innerHeight - 172);
    const available = areaH - 28;
    // Piso pelo que a faixa precisa pra nada cortar (nome que quebra linha, alvos de 44 px).
    const floor = laneFloor(window.innerWidth, window.innerHeight);
    return Math.max(floor, Math.min(240, Math.floor(available / Math.max(1, count))));
  }, []);
  // A barra de rolagem horizontal da timeline ocupa altura só na coluna das ondas;
  // o mesmo espaço vai no fim da coluna de controles pra as linhas casarem até o fim.
  useEffect(() => {
    const wave = waveAreaRef.current;
    const ctrl = ctrlColRef.current;
    if (!wave || !ctrl) return;
    ctrl.style.paddingBottom = `${Math.max(0, wave.offsetHeight - wave.clientHeight)}px`;
  }, [songDuration, laneHeight, stems.length]);

  // Girou o aparelho ou mudou o tamanho da janela: recalcula e redesenha as ondas.
  useEffect(() => {
    let t: number | undefined;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const n = Object.keys(wavesurfers.current).length;
        if (!n) return;
        const lh = computeLaneHeight(n);
        setLaneHeight(lh);
        Object.values(wavesurfers.current).forEach(ws => ws.setOptions({ height: lh }));
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(t); };
  }, [computeLaneHeight]);

  // Solta uma faixa: para o som, desliga do mixer e libera o áudio decodificado.
  const destroyTrack = useCallback((id: string) => {
    try { wavesurfers.current[id]?.destroy(); } catch { /* já destruída */ }
    players.current[id]?.release();
    try { gainNodes.current[id]?.disconnect(); } catch { /* já desconectado */ }
    try { panners.current[id]?.disconnect(); } catch { /* já desconectado */ }
    delete wavesurfers.current[id];
    delete players.current[id];
    delete gainNodes.current[id];
    delete panners.current[id];
    delete trackUrls.current[id];
  }, []);

  // Desenhando as ondas + criando os players. INCREMENTAL: só mexe na faixa que
  // entrou, saiu ou mudou de URL. Antes, gerar o click ou a voz guia destruía e
  // baixava de novo TODAS as faixas (e a música parava).
  useEffect(() => {
    if (stems.length === 0) {
      Object.keys(wavesurfers.current).forEach(destroyTrack);
      masterIdRef.current = null;
      setIsPlaying(false);
      return;
    }

    // Distribui a altura REAL da área das ondas (medida, não suposta) entre as
    // faixas. Assim as lanes preenchem a tela em qualquer aparelho/orientação.
    const lh = computeLaneHeight(stems.length);
    setLaneHeight(lh);

    const wanted = new Map(stems.map(s => [s.id, s]));
    Object.keys(wavesurfers.current).forEach(id => {
      const s = wanted.get(id);
      // Mesmo áudio que só trocou de endereço (blob: local → URL do R2 após o upload):
      // mantém a faixa tocando em vez de baixar tudo de novo.
      if (s && trackUrls.current[id] !== s.url && urlAliases.current.get(s.url) === trackUrls.current[id]) {
        trackUrls.current[id] = s.url;
        return;
      }
      if (!s || trackUrls.current[id] !== s.url) destroyTrack(id);
    });
    masterIdRef.current = stems[0].id;
    const ctx = getAudioContext();

    stems.forEach((stem) => {
      const existing = wavesurfers.current[stem.id];
      if (existing) {
        existing.setOptions({ height: lh });
        return;
      }
      const container = document.getElementById(`waveform-${stem.id}`);
      if (!container) return;
      container.innerHTML = '';

      // Roteamento Web Audio: player → gain → panner → destination (mesmo contexto pra todas)
      const player = new SyncedTrackPlayer(ctx);
      const gainNode = ctx.createGain();
      const panner = ctx.createStereoPanner();
      player.output.connect(gainNode);
      gainNode.connect(panner);
      panner.connect(ctx.destination);
      players.current[stem.id] = player;
      gainNodes.current[stem.id] = gainNode;
      panners.current[stem.id] = panner;
      trackUrls.current[stem.id] = stem.url;

      const ws = WaveSurfer.create({
        container,
        waveColor: stem.color + '8c', // ~55% opacity — onda destaca sobre a lane colorida
        progressColor: stem.color,
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: lh,
        normalize: true,
        media: player as unknown as HTMLMediaElement,
        url: stem.url,
      });

      ws.on('ready', () => {
        const isMaster = masterIdRef.current === stem.id;
        if (isMaster) setSongDuration(ws.getDuration());
        // Faixa que ficou pronta com a música andando (ex.: click gerado durante o
        // play) entra alinhada à de referência, no mesmo instante do relógio.
        const masterPlayer = masterIdRef.current ? players.current[masterIdRef.current] : undefined;
        const ref = masterPlayer && masterPlayer !== player && masterPlayer.isLoaded ? masterPlayer : player;
        if (isPlayingRef.current) player.joinPlayback(ref);
        else if (ref !== player) ws.setTime(ref.currentTime);
      });

      // Tempo/fim da música vêm só da faixa de referência.
      ws.on('timeupdate', (time) => {
        if (masterIdRef.current !== stem.id) return;
        const d = ws.getDuration();
        if (d > 0) setProgressPlayback((time / d) * 100);
      });
      ws.on('finish', () => {
        if (masterIdRef.current !== stem.id) return;
        voiceCuesRef.current.forEach(c => { c.fired = false; });
        const all = Object.values(wavesurfers.current);
        if (isLoopingRef.current) {
          // Loop: todas voltam pro 0 e recomeçam no mesmo instante.
          all.forEach(w => w.setTime(0));
          all.forEach(w => { void w.play(); });
        } else {
          // Para TODAS (a mais longa não segue tocando sozinha) e rebobina.
          all.forEach(w => { w.pause(); w.setTime(0); });
          setIsPlaying(false);
        }
        setProgressPlayback(0);
      });

      // Clique na onda: leva TODAS (inclusive esta) pro mesmo ponto no mesmo tick,
      // então reiniciam juntas. Nada de compensação por faixa: o ajuste do click
      // já está gravado no arquivo dele.
      ws.on('interaction', () => {
        const time = ws.getCurrentTime();
        voiceCuesRef.current.forEach(cue => { cue.fired = time > cue.time + 0.3; });
        seekAll(time);
      });

      wavesurfers.current[stem.id] = ws;
    });

    applyMix();
  }, [stems, destroyTrack, applyMix, seekAll, computeLaneHeight]);

  // Fechou o estúdio: para tudo e solta o áudio da memória.
  useEffect(() => () => {
    Object.keys(wavesurfers.current).forEach(destroyTrack);
  }, [destroyTrack]);

  // Controles
  const togglePlay = () => {
    if (isPlaying) pauseAll();
    else void playAll();
  };
  // Início: todas no 0 e as marcações rearmam. Fim: todas na duração.
  const goToStart = () => {
    Object.values(wavesurfers.current).forEach(ws => ws.setTime(0));
    voiceCuesRef.current.forEach(c => { c.fired = false; });
    setProgressPlayback(0);
  };
  const goToEnd = () => { Object.values(wavesurfers.current).forEach(ws => ws.setTime(ws.getDuration())); };

  const handleSaveToDatabase = async () => {
    if (!canCloudSave) { setIsPricingOpen(true); return; }
    if (!songName) { setCloudMessage(CLOUD_COPY.needName); return; }
    setCloudMessage(null);

    setIsSaving(true);
    setSaveProgress(0);
    setSaveStatus(CLOUD_STATUS.start);

    try {
      await publishToCloud({
        songName, artist, songKey, bpm: Number(bpm), cover: coverFile,
        isGlobal: isAdmin ? publishGlobal : false,
        userId: user?.id ?? null,
        stems,
        // Voz guia renderizada só quando o canal não foi commitado ainda (senão ela já sobe
        // junto com as faixas).
        voiceGuide: voiceCues.length > 0 && !stems.some(s => s.id === 'voiceguide') ? renderVoiceGuideToBlob : null,
      }, ({ status, progress }) => { setSaveStatus(status); setSaveProgress(progress); });

      // Update local library if this session is saved
      if (activeSepId) {
        await saveSeparation({
          id: activeSepId,
          createdAt: activeSepCreatedAt ?? undefined,
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
      setCloudMessage(CLOUD_COPY.error(e.message));
      setIsSaving(false);
    }
  };

  // ── Click sincronizado com a música ──
  // Faixa usada pra medir a grade: bateria é a referência; sem ela, instrumental/baixo.
  const pickGridSource = (): StemData | undefined => pickGridTrack(stems);

  // Mede BPM exato + 1º tempo no áudio decodificado (o mesmo que está tocando,
  // então a grade fica na mesma linha do tempo do player). Cacheado por faixa/BPM.
  const analyzeGrid = async (nearBpm: number | undefined, beatsPerBar: number): Promise<{ grid: BeatGrid; source: StemData } | null> => {
    const source = pickGridSource();
    if (!source) return null;
    const key = `${source.url}|${nearBpm ?? 'auto'}|${beatsPerBar}`;
    if (beatGridRef.current?.key === key) return { grid: beatGridRef.current.grid, source };

    let channels: Float32Array[] = [];
    let sampleRate = 0;
    const player = players.current[source.id];
    if (player?.isLoaded) {
      channels = player.getChannelData();
      sampleRate = player.sampleRate;
    } else {
      const buf = await getAudioContext().decodeAudioData(await (await fetch(source.url)).arrayBuffer());
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      sampleRate = buf.sampleRate;
    }
    // Deixa o spinner pintar antes do cálculo (roda na thread principal, ~0,2-1 s).
    await new Promise(r => setTimeout(r, 30));
    const grid = measureGrid(channels, sampleRate, { nearBpm, beatsPerBar });
    beatGridRef.current = { key, grid };
    return { grid, source };
  };

  const detectBpmFromAudio = async () => {
    if (!canBpm) { setIsPricingOpen(true); return; }
    setIsDetectingBpm(true);
    setGridInfo('');
    try {
      const res = await analyzeGrid(undefined, BEATS_PER_BAR[timeSignature]);
      if (!res) { setGridInfo('Nenhuma faixa pra analisar.'); return; }
      const report = bpmReport(res.grid, res.source.name);
      setBpm(report.bpm);
      setDownbeatShift(0);
      setGridInfo(report.info);
    } catch (e) {
      console.error('[Click] detecção de BPM falhou', e);
      setGridInfo('Não deu pra analisar o áudio. Tenta de novo.');
    } finally {
      setIsDetectingBpm(false);
    }
  };

  // Planos com detecção: abrir o modal com o BPM ainda no padrão (120) já mede sozinho.
  const autoDetectedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showBpmModal || !canBpm || stems.length === 0) return;
    const sourceUrl = pickGridSource()?.url;
    if (!sourceUrl || autoDetectedForRef.current === sourceUrl || bpm !== '120') return;
    autoDetectedForRef.current = sourceUrl;
    void detectBpmFromAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBpmModal]);

  // blob: → URL do R2 do MESMO áudio: o efeito das faixas não recarrega a faixa.
  const urlAliases = useRef<Map<string, string>>(new Map());

  const addMetronomeChannel = async (offsetOverrideMs?: number) => {
    const typed = parseFloat(bpm);
    const bpmNum = Number.isFinite(typed) && typed >= 20 ? typed : 120;
    const offsetMs = offsetOverrideMs ?? clickOffsetMs;
    setBpmMessage(null);
    setIsGeneratingClick(true);
    try {
      const beatsPerBar = BEATS_PER_BAR[timeSignature];
      // Grade medida no áudio, refinada em volta do BPM escolhido: acha o BPM exato
      // (ex.: 120 digitado, 119,87 real) e onde cai o 1º tempo da música.
      let grid: BeatGrid | null = null;
      try {
        grid = (await analyzeGrid(bpmNum, beatsPerBar))?.grid ?? null;
      } catch (e) {
        console.warn('[Click] análise falhou, gerando no BPM digitado a partir de 0:00', e);
      }
      const plan = clickPlan({ typedBpm: bpm, offsetMs, downbeatShift, grid });

      const master = getMasterWs();
      const duration = (master && master.getDuration() > 0 ? master.getDuration() : 0) || songDuration || 600;
      const clickTrackUrl = await generateSeparatorClick({ plan, durationSec: duration, sel: clickSel, accentBeat1, meter: timeSignature });

      // Entra na hora (URL local), já tocando junto se a música estiver rodando.
      const oldUrl = stems.find(s => s.id === 'metronome')?.url;
      setStems(prev => [
        ...prev.filter(s => s.id !== 'metronome'),
        { id: 'metronome', name: 'Metrônomo', url: clickTrackUrl, color: '#e2e8f0' },
      ]);
      if (oldUrl?.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(oldUrl), 5000);
      setStemStates(p => ({ ...p, metronome: p.metronome ?? { muted: false, soloed: false, volume: 0.8, pan: 0 } }));
      setShowBpmModal(false);

      // Sobe pro R2 em segundo plano → URL https → persiste com a separação.
      void (async () => {
        try {
          const blob = await (await fetch(clickTrackUrl)).blob();
          const file = new File([blob], 'click.wav', { type: 'audio/wav' });
          const up = await uploadToR2('stems', `${user?.id || 'anon'}/${activeSepId || 'tmp'}/click_${Date.now()}.wav`, file);
          if (up.error || !up.url) { console.warn('[Click] upload falhou, fica só nesta sessão:', up.error); return; }
          const remoteUrl = up.url;
          urlAliases.current.set(remoteUrl, clickTrackUrl);
          setStems(prev => prev.map(s => (s.id === 'metronome' && s.url === clickTrackUrl ? { ...s, url: remoteUrl } : s)));
          // O player já tem o áudio decodificado: solta o WAV local (~16 MB) da memória.
          setTimeout(() => URL.revokeObjectURL(clickTrackUrl), 10000);
        } catch (e) {
          console.warn('[Click] upload falhou, fica só nesta sessão:', e);
        }
      })();
    } catch (e) {
      console.error('Erro ao gerar metrônomo', e);
      setBpmMessage(BPM_COPY.clickError);
    } finally {
      setIsGeneratingClick(false);
    }
  };

  // SYNC da barra: ajuste fino de ±10 ms. Regera o click com o deslocamento
  // gravado no arquivo (reaproveita a grade já medida, então é rápido).
  const nudgeTimerRef = useRef<number | null>(null);
  const hasMetronome = stems.some(s => s.id === 'metronome');
  const nudgeClick = (deltaMs: number) => {
    const next = nudgeOffset(clickOffsetMs, deltaMs);
    setClickOffsetMs(next);
    if (!hasMetronome) return;
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = window.setTimeout(() => { void addMetronomeChannel(next); }, 600);
  };

  // ── Abrir no palco ──
  // Baixa as faixas uma por vez (tudo ou nada) e entrega ao App, que fecha o Separador e carrega no
  // palco. "Voltar" cancela; erro mostra a frase com Tentar de novo, e nada vai pro App.
  const openOnStage = async (sep: SavedSeparation, justSeparatedNow: boolean) => {
    openAbortRef.current?.abort();
    const ctrl = new AbortController();
    openAbortRef.current = ctrl;
    const toOpen = stemsToOpen(sep);
    setOpening({ sep, justSeparated: justSeparatedNow, done: 0, total: toOpen.length, error: null });
    try {
      const files = await fetchSeparationFiles(toOpen, {
        signal: ctrl.signal,
        onProgress: (done, total) => { if (!ctrl.signal.aborted) setOpening(o => (o && o.sep.id === sep.id ? { ...o, done, total } : o)); },
      });
      if (ctrl.signal.aborted) return;
      onOpenOnStage?.({ sep, files, justSeparated: justSeparatedNow });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.error('[Separador] abrir no palco falhou', e);
      setOpening(o => (o && o.sep.id === sep.id ? { ...o, error: OPEN_ERROR_TEXT } : o));
    }
  };
  const cancelOpening = () => {
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    setOpening(null);
  };
  useEffect(() => () => { openAbortRef.current?.abort(); }, []);

  // ── Load a saved separation ──
  const handleOpenSavedSeparation = (sep: SavedSeparation) => {
    // Livre: a separação do mês sempre abre, sem contar. A de um mês anterior conta nas 3 músicas
    // do mês; com o mês cheio ela não abre e a tela de limite aparece (com a música parada).
    if (isLivre) {
      const freeThisMonth = separationIsThisMonth(sep.createdAt, new Date());
      if (!livre.canOpenSong(separationKey(sep.id), { freeThisMonth })) { livre.requestLimit('stage-songs'); return; }
      livre.noteSongOpened(separationKey(sep.id), { freeThisMonth });
    }
    setHomeNotice(null);
    // Palco novo na tela: a separação abre no palco. Já no repertório, só pula pra ela (P7).
    if (stageAvailable) {
      if (stageSeparationIds.has(sep.id)) { onOpenOnStage?.({ sep, files: null, justSeparated: false }); return; }
      void openOnStage(sep, false);
      return;
    }
    const stemsArray: StemData[] = sep.stems.map(s => ({ id: s.id, name: s.name, url: s.url, color: s.color }));
    const initialStates: Record<string, { muted: boolean; soloed: boolean; volume: number; pan: number }> = {};
    sep.stems.forEach(s => {
      // Restaura o mixer salvo (mute/solo/volume/pan); default se não houver.
      initialStates[s.id] = s.state ?? { muted: false, soloed: false, volume: 1, pan: 0 };
    });
    setStemStates(initialStates);
    setStems(stemsArray);
    setSongName(sep.songName);
    setArtist(sep.artist || '');
    setBpm(sep.bpm || '120');
    setSongKey(sep.songKey || 'C');
    setVoiceCues(sep.voiceCues || []);
    setCommittedCues(sep.stems.some(s => s.id === 'voiceguide') ? (sep.voiceCues || []) : null);
    setActiveSepId(sep.id);
    setActiveSepCreatedAt(sep.createdAt);
    setJustSeparated(false);
    setFile(null); // signal we're in "loaded" mode, stems drive the UI
    resetClickSync();
  };

  // Tela de limite do Livre, por cima de qualquer tela do Separador: só com a música parada (a daqui
  // e a do palco atrás; o useLivre segura o pedido até parar). Uma por tipo de limite. Ela fica por
  // cima dos Planos, então "Ver os planos" fecha ela antes de abrir os Planos.
  const limitGate = livre.limit !== null && (
    <LimitGate key={livre.limit} kind={livre.limit} onClose={livre.closeLimit} onSeePlans={() => { livre.closeLimit(); setIsPricingOpen(true) }} />
  );

  if (opening) {
    return (
      <>
        <SeparatorProgress
          title={OPENING_COPY.title} subtitle={opening.sep.songName || 'Sem título'}
          percent={opening.total > 0 ? (opening.done / opening.total) * 100 : 0}
          detail={OPENING_COPY.detail(opening.done, opening.total)} error={opening.error}
          onRetry={() => { void openOnStage(opening.sep, opening.justSeparated); }} onBack={cancelOpening}
        />
        {limitGate}
      </>
    );
  }

  if (separationStep === 'options' && pendingFile) {
    // As opções vêm do plano (plans.ts): o Livre separa em 4 ou 6 faixas, quem paga em 2, 4 ou 6.
    // Admin nunca tem a trava do Livre.
    const stemOptions = isAdmin ? ALL_STEM_COUNTS : separationStemOptions(userPlan);

    const handleSelectOption = (stemsCount: StemCount) => {
      setFile(pendingFile);
      setSongName(pendingFile.name.replace(/\.[^/.]+$/, ""));
      setSeparationStep('upload'); // Reseta o step, pois o `file` que controla a tela de processamento.
      processAudio(pendingFile, stemsCount);
    };

    return (
      <>
        <SeparatorOptions options={stemOptions} onBack={() => { setSeparationStep('upload'); setPendingFile(null); }} onChoose={handleSelectOption} />
        {isPricingOpen && <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />}
        {limitGate}
      </>
    );
  }

  if (separationStep === 'upload' && !file && stems.length === 0) {
    return (
      <>
        <SeparatorHome
          separations={separations}
          loading={isLibLoading}
          onBack={onClose}
          onPickFile={handleFileUpload}
          onOpen={handleOpenSavedSeparation}
          onDelete={(id) => { void deleteSeparation(id); }}
          tour={showSepTour ? <GuidedTour steps={stageAvailable ? SEP_TOUR_STEPS : SEP_TOUR_STEPS_RESERVA} onClose={closeSepTour} /> : null}
          notice={homeNotice ? <Notice tone="alert" role="alert">{homeNotice}</Notice> : null}
        />
        {/* "Ver os planos" da tela de limite também abre os Planos aqui. */}
        <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
        {limitGate}
      </>
    );
  }

  if (isProcessing) {
    return (
      <>
        <SeparatorProgress title={PROGRESS_COPY.title} subtitle={PROGRESS_COPY.subtitle} percent={progress} detail={progressMsg} />
        {limitGate}
      </>
    );
  }

  const hasSolo = Object.values(stemStates).some(st => st.soloed);
  return (
    <div data-separator-player className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone select-none">

      {/* ═══ HEADER (a barra do palco) ═══ */}
      <SeparatorPlayerBar
        songName={songName} channels={stems.length} format={downloadFormat} canSave={!!activeSepId} saving={isManualSaving}
        bpm={bpm} songKey={songKey} keyPickerOpen={isKeyPickerOpen}
        isPlaying={isPlaying} isLooping={isLooping}
        time={formatCueTime(songDuration * progressPlayback / 100)} total={formatCueTime(songDuration)}
        voice={stems.length > 0 ? { count: voiceCues.length, locked: !canVoiceGuide } : null}
        sync={{ offsetMs: clickOffsetMs, enabled: hasMetronome, busy: isGeneratingClick }}
        masterVolume={masterVolume}
        onBack={goToSeparatorHome} onFormat={setDownloadFormat} onSave={() => { void forceSave(); }} onExport={() => setShowSaveForm(true)}
        onOpenBpm={() => setShowBpmModal(true)} onKeyPicker={setIsKeyPickerOpen} onKey={setSongKey}
        onStart={goToStart} onTogglePlay={togglePlay} onEnd={goToEnd} onToggleLoop={() => setIsLooping(p => !p)}
        onVoice={() => canVoiceGuide ? setShowVoiceGuide(true) : setIsPricingOpen(true)}
        onNudge={nudgeClick} onMaster={setMasterVolume}
      />
      {downloadError && <div className="shrink-0 px-ps-gutter pt-2"><Notice tone="alert" role="alert">{downloadError}</Notice></div>}

      {/* ── Aviso de salvo (a região de status fica sempre na página) ── */}
      <div role="status" className="pointer-events-none absolute left-1/2 top-28 z-[120] -translate-x-1/2">
        {libSaveToast && <Notice className="whitespace-nowrap shadow-ps-pop">{PLAYER_COPY.saved}</Notice>}
      </div>

      {/* ═══ WORKSPACE ═══ */}
      {/* Mixer e waveform sempre lado a lado (também em mobile/tablet).
          min-w-0 na waveform (abaixo) evita que ela vaze da tela em telas estreitas. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* LEFT: Channel Strip Controls */}
        <div ref={ctrlColRef} onScroll={syncVerticalScroll('ctrl')} className="z-10 flex w-[220px] shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-ps-line bg-ps-s1 compact:w-[156px] short:w-[184px]">
          {/* Ruler spacer (fixo no topo, igual à régua das ondas) */}
          <div className="sticky top-0 z-10 flex h-7 shrink-0 items-center border-b border-ps-line bg-ps-ink-0 px-3">
            <span className="ps-label">{PLAYER_COPY.mixer(stems.length)}</span>
          </div>

          {stems.map((stem, trackIdx) => {
            const state = stemStates[stem.id];
            if (!state) return null;
            const patch = (next: Partial<typeof state>) => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], ...next } }));
            return (
              <div key={`ctrl-${stem.id}`} data-track-id={stem.id}>
                <SeparatorTrackStrip
                  index={trackIdx} name={stem.name} color={stem.color} state={state}
                  silenced={state.muted || (hasSolo && !state.soloed)}
                  height={laneHeight} compact={false}
                  downloading={encodingStemId === stem.id}
                  downloadTitle={canDownload ? PLAYER_COPY.download(stem.name, downloadFormat) : PLAYER_COPY.downloadLocked}
                  downloadLocked={!canDownload}
                  onMute={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], muted: !p[stem.id].muted } }))}
                  onSolo={() => setStemStates(p => ({ ...p, [stem.id]: { ...p[stem.id], soloed: !p[stem.id].soloed } }))}
                  onDownload={() => canDownload ? downloadStem(stem) : blockDownload()}
                  onPan={(pan) => patch({ pan })} onPanCenter={() => patch({ pan: 0 })}
                  onVolume={(volume) => patch({ volume })}
                />
              </div>
            );
          })}
        </div>

        {/* RIGHT: Waveform area — viewport com scroll (vertical p/ canais, horizontal p/ timeline) */}
        <div ref={waveAreaRef} onScroll={syncVerticalScroll('wave')} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-ps-ink">

          {/* Conteúdo com largura real da timeline (duração × px/s) — nunca comprime, rola de lado se passar da tela */}
          <div ref={timelineContentRef} data-timeline className="relative flex flex-col" style={{ width: songDuration > 0 ? Math.max(songDuration * WAVEFORM_PX_PER_SECOND, 100) : '100%', minWidth: '100%' }}>

            {/* Time ruler */}
            <div data-ruler className="sticky top-0 z-30 h-7 shrink-0 overflow-hidden border-b border-ps-line bg-ps-ink-0">
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(pct => (
                <div key={pct} className="pointer-events-none absolute bottom-0 flex flex-col items-center" style={{ left: `${pct}%` }}>
                  <span className="ps-num mb-0.5 -translate-x-1/2 text-ps-micro text-ps-dim">
                    {songDuration > 0 ? formatCueTime(songDuration * pct / 100) : ''}
                  </span>
                  <div className="h-2 w-px bg-ps-line-2" />
                </div>
              ))}
              {/* Playhead on ruler */}
              <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-ps-bone/60" style={{ left: `${progressPlayback}%` }} />
            </div>

            {/* Playhead over waveforms */}
            <div data-playhead className="pointer-events-none absolute bottom-0 top-7 z-20 w-px bg-ps-bone"
              style={{ left: `${progressPlayback}%` }}>
              <div className="absolute -top-1.5 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-ps-bone" />
            </div>

            {/* Voice Cue Markers — arrastáveis */}
            {songDuration > 0 && voiceCues.map(cue => (
              <div key={`marker-${cue.id}`} data-cue={cue.id}
                className="group/cue absolute bottom-0 top-7 z-20 cursor-ew-resize touch-none"
                style={{ left: `${(cue.time / songDuration) * 100}%`, ['--cue' as string]: FAMILY_COLOR.guia }}
                onPointerDown={(e) => handleCuePointerDown(e, cue.id)}
                onPointerMove={handleCuePointerMove}
                onPointerUp={(e) => handleCuePointerUp(e, cue)}
                title={PLAYER_COPY.cueTitle(cue.label, formatCueTime(cue.time))}
              >
                <div className="h-full w-px bg-(--cue) opacity-50 transition-opacity group-hover/cue:opacity-100" />
                <div className="absolute left-0.5 top-0 select-none whitespace-nowrap rounded-ps-xs bg-(--cue) px-1 py-0.5 text-ps-micro font-extrabold leading-tight text-ps-ink">
                  {cue.label}
                </div>
              </div>
            ))}

            {stems.map((stem) => (
              <div key={`wavewrap-${stem.id}`} data-wave-id={stem.id} className="relative shrink-0 border-b border-ps-line"
                style={{ height: laneHeight, background: `linear-gradient(180deg, ${stem.color}40 0%, ${stem.color}1f 100%)` }}>
                <div className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: stem.color }} />
                <div id={`waveform-${stem.id}`} className="absolute w-full top-0 h-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Anúncio da casa no fim da separação (Parte 3): só no Livre, logo depois de separar e com a
          música parada (a daqui e a do palco). No fluxo, embaixo das faixas, sem cobrir nada.
          "Conhecer o Pro" abre os Planos aqui mesmo. */}
      <div className="grid shrink-0 grid-cols-[minmax(0,28rem)] justify-center border-t border-ps-line bg-ps-s1 px-3 py-3 empty:hidden">
        <AdSlot placement="separation-done" userId={user?.id ?? null} isLivre={isLivre} quiet={quiet} justSeparated={justSeparated} onCta={() => setIsPricingOpen(true)} />
      </div>

      {/* Publicar na nuvem: não fecha publicando (como hoje). */}
      <StageDialog open={showSaveForm} title={CLOUD_COPY.title} onClose={() => { if (!isSaving) setShowSaveForm(false); }} dismissible={!isSaving} closeDisabled={isSaving}>
        <CloudSaveForm
          channels={stems.length} name={songName} artist={artist} bpm={bpm} songKey={songKey} cover={coverFile}
          showBpm={canBpm} isAdmin={isAdmin} publishGlobal={publishGlobal}
          saving={isSaving} progress={saveProgress} status={saveStatus} message={cloudMessage}
          onChange={(patch) => {
            if (patch.name !== undefined) setSongName(patch.name);
            if (patch.artist !== undefined) setArtist(patch.artist);
            if (patch.bpm !== undefined) setBpm(patch.bpm);
            if (patch.songKey !== undefined) setSongKey(patch.songKey);
            if (patch.cover !== undefined) setCoverFile(patch.cover);
            if (patch.publishGlobal !== undefined) setPublishGlobal(patch.publishGlobal);
          }}
          onSubmit={() => { void handleSaveToDatabase(); }}
        />
      </StageDialog>

      {/* BPM e click: não fecha gerando o click (como hoje). */}
      <StageDialog open={showBpmModal} title={BPM_COPY.title} size="sm" onClose={() => { if (!isGeneratingClick) setShowBpmModal(false); }} dismissible={!isGeneratingClick} closeDisabled={isGeneratingClick}>
        <BpmClickEditor
          bpm={bpm} meter={timeSignature} accentBeat1={accentBeat1} downbeatShift={downbeatShift} clickSel={clickSel}
          info={gridInfo} busy={isGeneratingClick ? 'click' : isDetectingBpm ? 'bpm' : null} hasTracks={stems.length > 0}
          message={bpmMessage} detectLocked={!canBpm}
          onBpm={setBpm} onBpmBlur={() => setBpm(normalizeBpm(bpm))} onStep={(d) => setBpm(stepBpm(bpm, d))}
          onTap={handleTapTempo} onScale={(f) => setBpm(scaleBpm(bpm, f))} onDetect={() => { void detectBpmFromAudio(); }}
          onMeter={setTimeSignature} onAccent={setAccentBeat1} onShiftDownbeat={(d) => setDownbeatShift(v => v + d)}
          onClickSel={updateClickSel} onGenerate={() => { void addMetronomeChannel(); }}
        />
      </StageDialog>

      {/* Voz guia */}
      <StageDialog open={showVoiceGuide} title={VOICE_COPY.title} onClose={() => setShowVoiceGuide(false)}>
        <VoiceGuideEditor
          cues={voiceCues} tab={voiceGuideTab} playing={isPlaying} detecting={isAutoDetecting} rendering={isRenderingGuide}
          hasChannel={stems.some(s => s.id === 'voiceguide')} pending={voiceCues.length > 0 && voiceCues !== committedCues}
          message={voiceMessage}
          onTab={setVoiceGuideTab} onAdd={(o) => addVoiceCue(o.label, o.file)} onRemove={removeVoiceCue} onTime={updateCueTime}
          onClear={() => { setVoiceCues([]); voiceCuesRef.current = []; }}
          onDetect={() => { void autoDetectVoiceGuide(); }} onCommit={() => { void commitVoiceGuideChannel(); }}
        />
      </StageDialog>

      <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
      {limitGate}
    </div>
  );
};
