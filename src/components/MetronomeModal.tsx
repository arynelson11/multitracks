import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { Play, Loader2, X, Minus, Plus, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
import { generateManualClickTrackFromSample } from '../lib/AudioAnalyzer';
import { formatBpm } from '../lib/beatGrid';
import { CLICK_TYPES, CLICK_SUBDIVISIONS, loadClickSelection, saveClickSelection, getClickSampleUrl } from '../lib/clickLibrary';
import type { ClickTrackType, ClickSubdivision } from '../lib/clickLibrary';
import {
  adjustAutoClick, autoClickChecks, clickChannelLabel, planAutoClick, renderAutoClick,
  type AutoClickCheck, type AutoClickOkPlan, type AutoClickPlan,
} from '../lib/autoClick';
import { TIME_SIGNATURES, pulsesPerBar, type TimeSignature } from '../lib/stageContracts';
import type { Song } from '../types';
import { Button, Chip } from './ui';

interface MetronomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistCurrentSong: (Pick<Song, 'name' | 'duration' | 'channels'> & Partial<Pick<Song, 'id' | 'bpm'>>) | null;
  onAddClick: (file: File) => void;
  /** Compasso da grade da música (T29). Sem ele vale o guardado pra esta música, senão 4/4. */
  initialSignature?: TimeSignature;
  /** Música tocando: a análise do click IA trava a tela por alguns segundos, então fica bloqueada. */
  isPlaying?: boolean;
}

// ─── Compasso lembrado por música (mt_meter_<id da música>) ───
const meterKey = (songId: string | undefined) => (songId ? `mt_meter_${songId}` : null);

function initialMeter(songId: string | undefined, initial: TimeSignature | undefined): TimeSignature {
  const known = (v: unknown) => TIME_SIGNATURES.find(s => s === v) ?? null;
  const fromProp = known(initial);
  if (fromProp) return fromProp;
  const key = meterKey(songId);
  if (key) {
    try {
      const saved = known(localStorage.getItem(key));
      if (saved) return saved;
    } catch { /* armazenamento indisponível: fica o padrão */ }
  }
  return '4/4';
}

// ─── Click IA: o que mostrar depois da análise ───
// O resultado é da música em que a análise foi feita (`songId`): se a música muda com o modal
// aberto (AUTO depois do fim, comando da banda), ele some e nunca entra na música nova.
type AutoState =
  | { step: 'parado' }
  | { step: 'pronto'; songId: string | undefined; plan: AutoClickOkPlan; moveOne: number; halfBeat: boolean }
  | { step: 'falhou'; songId: string | undefined; reason: Extract<AutoClickPlan, { ok: false }>['reason'] | 'erro' };
const PARADO: AutoState = { step: 'parado' };

const FAIL_TEXT: Record<Extract<AutoState, { step: 'falhou' }>['reason'], string> = {
  'confianca-baixa': 'Não deu pra ter certeza do tempo desta música. Confira o BPM ou use o modo manual.',
  'sem-faixa': 'Nenhuma faixa de bateria, percussão ou baixo pra analisar. Use o modo manual.',
  'ja-tem-click': 'Esta música já tem click.',
  erro: 'Não deu pra analisar a música. Tente de novo ou use o modo manual.',
};

function checkText(check: AutoClickCheck, songBpm: number | undefined): string {
  switch (check) {
    case 'um': return 'Confira o 1: se o acento cair fora do compasso, use Mover o 1.';
    case 'contratempo': return 'Confira o tempo: o click pode cair no contratempo. Se cair, use Deslocar meio tempo.';
    case 'bpm-salvo': return `O BPM salvo${songBpm ? ` (${formatBpm(songBpm)})` : ''} não bate com o áudio. Confira o andamento.`;
    case 'andamento': return 'Confira o andamento: o BPM salvo decidiu entre dois tempos parecidos.';
  }
}

// Trocar o BPM achado: refaz a grade em volta do BPM escolhido (metade, dobro e a família 3:2, Ruling M2b-2).
const BPM_FACTORS: { factor: number; label: string; name: string }[] = [
  { factor: 1 / 2, label: '½×', name: 'Metade' },
  { factor: 2 / 3, label: '⅔×', name: 'Dois terços' },
  { factor: 3 / 2, label: '3⁄2×', name: 'Uma vez e meia' },
  { factor: 2, label: '2×', name: 'Dobro' },
];
const BPM_RANGE = { min: 30, max: 300 };

// ─── Click sound preview: plays the actual sample file ───
const previewClickSound = async (type: ClickTrackType, subdivision: ClickSubdivision) => {
  try {
    const url = getClickSampleUrl(type, subdivision);
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const res = await fetch(url);
    if (!res.ok) return;
    const ab = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    setTimeout(() => ctx.close(), 2000);
  } catch { /* ignore preview errors */ }
};

interface AutoClickResultProps {
  sectionRef: (el: HTMLElement | null) => void;
  plan: AutoClickOkPlan;
  moveOne: number;
  halfBeat: boolean;
  songBpm: number | undefined;
  busy: boolean;
  /** Falso com a música tocando: os chips refazem a análise, que trava a tela. */
  canAnalyze: boolean;
  onAnalyze: (nearBpm: number) => void;
  onAdjust: (patch: Partial<{ moveOne: number; halfBeat: boolean }>) => void;
  onInsert: () => void;
}

// Resultado do click IA antes de inserir: BPM e faixas analisadas, metade/dobro/3:2, Mover o 1,
// Deslocar meio tempo (só com risco de contratempo) e o que conferir, em âmbar.
function AutoClickResult({ sectionRef, plan, moveOne, halfBeat, songBpm, busy, canAnalyze, onAnalyze, onAdjust, onInsert }: AutoClickResultProps) {
  const d = plan.detection;
  const beats = pulsesPerBar(plan.signature);
  const step = ((moveOne % beats) + beats) % beats;
  const shownMove = step > beats / 2 ? step - beats : step;
  return (
    <section ref={sectionRef} aria-label="Resultado da análise"
      className="mt-3 flex flex-col gap-3 rounded-ps-xl bg-ps-s1 inset-ring inset-ring-ps-line p-3">
      <p className="text-ps-bone text-ps-base font-bold text-center px-1">
        <span className="ps-num">BPM {d.bpm.toFixed(1)}</span> · analisado em {plan.label}
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {BPM_FACTORS.map(f => {
          const target = Math.round(d.bpm * f.factor * 100) / 100;
          const inRange = target >= BPM_RANGE.min && target <= BPM_RANGE.max;
          return (
            <Chip key={f.label} title={`${f.name}: ${formatBpm(target)} BPM`} disabled={busy || !canAnalyze || !inRange} onClick={() => onAnalyze(target)}>
              {f.label}
            </Chip>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="ps-label">Mover o 1</span>
        <div className="flex items-center gap-1.5">
          <Button aria-label="Mover o 1 pra trás" icon={<ChevronLeft size={16} />} disabled={busy} onClick={() => onAdjust({ moveOne: moveOne - 1 })} />
          <span className="ps-num text-ps-bone text-ps-base font-bold min-w-8 text-center">{shownMove > 0 ? '+' : ''}{shownMove}</span>
          <Button aria-label="Mover o 1 pra frente" icon={<ChevronRight size={16} />} disabled={busy} onClick={() => onAdjust({ moveOne: moveOne + 1 })} />
        </div>
      </div>
      {d.offbeatRisk && (
        <Button tone={halfBeat ? 'on' : 'default'} pressed={halfBeat} disabled={busy} onClick={() => onAdjust({ halfBeat: !halfBeat })}>
          Deslocar meio tempo
        </Button>
      )}
      {autoClickChecks(d).map(c => (
        <p key={c} className="text-ps-alert text-ps-sm font-bold px-1">{checkText(c, songBpm)}</p>
      ))}
      <Button tone="primary" disabled={busy} onClick={onInsert}>Inserir click</Button>
    </section>
  );
}

export function MetronomeModal({ isOpen, onClose, playlistCurrentSong, onAddClick, initialSignature, isPlaying = false }: MetronomeModalProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual');
  const [bpm, setBpm] = useState<number>(120);
  const [bpmInput, setBpmInput] = useState<string>('120');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [auto, setAuto] = useState<AutoState>({ step: 'parado' });

  // Click library selection (persisted in localStorage)
  const [clickSel, setClickSel] = useState(() => loadClickSelection());
  const [accentBeat1, setAccentBeat1] = useState(true);
  const songId = playlistCurrentSong?.id;
  // O compasso escolhido vale pra música em que foi escolhido; música nova lê o dela.
  const [meter, setMeter] = useState(() => ({ songId, ts: initialMeter(songId, initialSignature) }));
  const timeSignature: TimeSignature = meter.songId === songId ? meter.ts : initialMeter(songId, initialSignature);
  // Só o resultado desta música aparece (e só ele pode ser inserido).
  const shownAuto: AutoState = auto.step !== 'parado' && auto.songId === songId ? auto : PARADO;

  // Música e "tocando" de agora, pra quem volta de um await (a análise e o click gerado).
  const liveRef = useRef({ songId, isPlaying });
  useLayoutEffect(() => { liveRef.current = { songId, isPlaying }; });

  // Toda troca de compasso fica guardada pra esta música; a análise feita em outro compasso deixa de valer.
  const changeMeter = (ts: TimeSignature) => {
    setMeter({ songId, ts });
    setAuto(PARADO);
    const key = meterKey(songId);
    if (!key) return;
    try { localStorage.setItem(key, ts); } catch { /* armazenamento indisponível */ }
  };

  const updateClickSel = (partial: Partial<typeof clickSel>) => {
    const next = { ...clickSel, ...partial };
    setClickSel(next);
    saveClickSelection(next);
    previewClickSound(next.type, next.subdivision);
  };
  
  // O resultado do click IA aparece embaixo dos botões: rola até ele quando surge.
  const revealResult = useCallback((el: HTMLElement | null) => { el?.scrollIntoView?.({ block: 'nearest' }); }, []);

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tapCount, setTapCount] = useState(0);

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

  const handleDoubleTempo = () => {
    handleBpmChange(bpm * 2);
  };

  const handleTapTempo = useCallback(() => {
    const now = performance.now();
    
    // Clear old tap timeout
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    
    // Reset if last tap was more than 2.5 seconds ago
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2500) {
      tapTimesRef.current = [];
    }

    tapTimesRef.current.push(now);
    setTapCount(prev => prev + 1);
    
    // Need at least 2 taps to calculate BPM
    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      // Average the intervals (ms)
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avgInterval);
      handleBpmChange(newBpm);
    }
    
    // Keep only last 8 taps
    if (tapTimesRef.current.length > 8) {
      tapTimesRef.current = tapTimesRef.current.slice(-8);
    }

    // Auto-reset after 2.5s of no tapping
    tapTimeoutRef.current = setTimeout(() => {
      tapTimesRef.current = [];
      setTapCount(0);
    }, 2500);
  }, []);

  const songDuration = playlistCurrentSong?.duration ?? 300;

  const handleManualGenerate = async () => {
    if (!playlistCurrentSong) return;
    setIsSynthesizing(true);
    setStatusMsg(`Gerando click ${clickSel.type} ${clickSel.subdivision} a ${bpm} BPM...`);
    try {
      const { clickTrackUrl } = await generateManualClickTrackFromSample(
        clickSel.type, clickSel.subdivision, bpm, songDuration, accentBeat1, timeSignature
      );
      if (clickTrackUrl) {
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        const file = new File([blob], `Click_${clickSel.type}_${bpm}bpm.wav`, { type: 'audio/wav' });
        onAddClick(file);
        URL.revokeObjectURL(clickTrackUrl);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar metrônomo.');
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
      onClose();
    }
  };

  // ─── Click IA (fluxo único, src/lib/autoClick.ts) ───
  const channels = (playlistCurrentSong?.channels ?? []).filter(ch => ch.buffer);
  const existingClick = clickChannelLabel(channels);
  const songBpm = playlistCurrentSong?.bpm;

  // A detecção é síncrona (até alguns segundos): só com a música parada, depois de pintar a mensagem.
  const analyze = async (nearBpm?: number) => {
    if (!playlistCurrentSong || isPlaying) return;
    setActiveTab('ai');
    setIsSynthesizing(true);
    setStatusMsg(nearBpm ? `Refazendo a grade em ${formatBpm(nearBpm)} BPM...` : 'Analisando o tempo da música...');
    const forSong = songId;
    try {
      await new Promise(r => setTimeout(r, 30));
      // A música pode ter começado (ou mudado) nesses 30 ms: aí a conta não roda.
      if (liveRef.current.isPlaying || liveRef.current.songId !== forSong) return;
      const plan = planAutoClick(channels, { songBpm, signature: timeSignature, allowExistingClick: existingClick !== null, nearBpm });
      setAuto(plan.ok ? { step: 'pronto', songId: forSong, plan, moveOne: 0, halfBeat: false } : { step: 'falhou', songId: forSong, reason: plan.reason });
    } catch (e) {
      console.error(e);
      setAuto({ step: 'falhou', songId: forSong, reason: 'erro' });
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
    }
  };

  const handleInsertAuto = async () => {
    if (shownAuto.step !== 'pronto') return;
    const forSong = shownAuto.songId;
    setIsSynthesizing(true);
    setStatusMsg('Gerando o click...');
    try {
      const plan = adjustAutoClick(shownAuto.plan, { moveOne: shownAuto.moveOne, halfBeat: shownAuto.halfBeat });
      const blob = await renderAutoClick(plan, songDuration, clickSel);
      // O "Inserir" põe o click na música ativa: se ela mudou enquanto o click era gerado, não entra.
      if (liveRef.current.songId !== forSong) return;
      onAddClick(new File([blob], `Click_IA_${formatBpm(plan.detection.bpm)}bpm.wav`, { type: 'audio/wav' }));
      onClose();
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar o click.');
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
    }
  };

  const adjustAuto = (patch: Partial<{ moveOne: number; halfBeat: boolean }>) => {
    if (shownAuto.step === 'pronto') setAuto({ ...shownAuto, ...patch });
  };

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div 
        className="bg-[#1c1c1e] w-full max-w-[380px] rounded-2xl p-5 shadow-2xl border border-white/5 flex flex-col max-h-[90vh] overflow-y-auto scrollbar-hide"
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
        <div className="text-white/60 text-sm font-medium mb-3">{getTempoName(bpm)}</div>

        {/* Big BPM Row */}
        <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2 mb-3">
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

        {/* Tap Tempo + 2x Row */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleTapTempo}
            disabled={isSynthesizing}
            className="flex-1 bg-[#2a2a2d] hover:bg-[#3a3a3e] border border-white/5 text-white py-3 rounded-xl font-bold transition-all text-xs tracking-wider cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span className="relative flex h-2.5 w-2.5">
              {tapCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tapCount > 0 ? 'bg-primary' : 'bg-white/30'}`}></span>
            </span>
            TAP TEMPO
          </button>
          <button
            onClick={handleDoubleTempo}
            disabled={isSynthesizing || bpm * 2 > 300}
            className="w-[72px] bg-[#2a2a2d] hover:bg-[#3a3a3e] border border-white/5 text-white py-3 rounded-xl font-black transition-all text-sm tracking-wider cursor-pointer active:scale-95 disabled:opacity-50"
          >
            2×
          </button>
        </div>

        {/* ─── Click Sound Library ─── */}
        <div className="mb-3">
          <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Som do Click</div>
          <div className="grid grid-cols-4 gap-1.5">
            {CLICK_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => updateClickSel({ type: t.id })}
                disabled={isSynthesizing}
                className={`py-2 rounded-lg text-[10px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 border disabled:opacity-50 ${
                  clickSel.type === t.id
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438] hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Subdivision ─── */}
        <div className="mb-4">
          <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Subdivisão</div>
          <div className="grid grid-cols-4 gap-1.5">
            {CLICK_SUBDIVISIONS.map(s => (
              <button
                key={s.id}
                onClick={() => updateClickSel({ subdivision: s.id })}
                disabled={isSynthesizing}
                className={`py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 border disabled:opacity-50 ${
                  clickSel.subdivision === s.id
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438] hover:text-white/80'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Time Signature ─── */}
        <div className="mb-4">
          <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Compasso</div>
          <div className="grid grid-cols-6 gap-1.5">
            {TIME_SIGNATURES.map(ts => (
              <button
                key={ts}
                onClick={() => changeMeter(ts)}
                disabled={isSynthesizing}
                aria-pressed={timeSignature === ts}
                className={`py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 border disabled:opacity-50 ${
                  timeSignature === ts
                    ? 'bg-primary/15 border-primary text-primary shadow-[0_0_12px_rgba(212,168,67,0.15)]'
                    : 'bg-[#2a2a2d] border-white/5 text-white/60 hover:bg-[#343438] hover:text-white/80'
                }`}
              >
                {ts}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Accent Toggle ─── */}
        <div className="mb-5 flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl px-4 py-3">
          <span className="text-white/70 text-xs font-bold tracking-wide">Acentuar beat 1</span>
          <button
            onClick={() => setAccentBeat1(!accentBeat1)}
            disabled={isSynthesizing}
            className={`relative w-11 h-6 rounded-full transition-all cursor-pointer disabled:opacity-50 ${
              accentBeat1 ? 'bg-primary' : 'bg-[#3a3a3e]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${
                accentBeat1 ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Status Loading/Text */}
        {isSynthesizing && statusMsg && (
          <div className="text-center text-[10px] font-bold text-primary animate-pulse uppercase tracking-wider mb-4">
            {statusMsg}
          </div>
        )}


        {/* Actions */}
        <div className="flex flex-col gap-3 mt-auto">
          <button 
            onClick={() => { setActiveTab('manual'); handleManualGenerate(); }}
            disabled={isSynthesizing || !playlistCurrentSong}
            className="w-full bg-[#2a2a2d] hover:bg-[#343438] text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider cursor-pointer border border-white/5 active:scale-95"
          >
            {isSynthesizing && activeTab === 'manual' ? <Loader2 size={16} className="animate-spin" /> : <Play fill="currentColor" size={14} />}
            GERAR CLICK MANUAL
          </button>

          {existingClick !== null && (
            <p className="text-ps-mut text-ps-sm font-bold text-center px-2">Esta música já tem click ({existingClick}).</p>
          )}
          {isPlaying && (
            <p className="text-ps-alert text-ps-sm font-bold text-center px-2">Pare a música pra analisar o tempo.</p>
          )}
          <button 
            onClick={() => analyze()}
            disabled={isSynthesizing || !playlistCurrentSong || isPlaying}
            className="w-full bg-primary hover:bg-primary-dim text-black py-3.5 rounded-xl font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs tracking-wider uppercase cursor-pointer shadow-[0_4px_15px_rgba(212,168,67,0.2)] active:scale-95"
          >
            {isSynthesizing && activeTab === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {existingClick !== null ? 'Gerar outro click' : 'Gerar click IA'}
          </button>
        </div>

        {shownAuto.step === 'falhou' && (
          <p ref={revealResult} className="mt-3 text-ps-alert text-ps-base font-bold text-center px-2">{FAIL_TEXT[shownAuto.reason]}</p>
        )}

        {shownAuto.step === 'pronto' && (
          <AutoClickResult
            sectionRef={revealResult} plan={shownAuto.plan} moveOne={shownAuto.moveOne} halfBeat={shownAuto.halfBeat} songBpm={songBpm}
            busy={isSynthesizing} canAnalyze={!isPlaying} onAnalyze={analyze} onAdjust={adjustAuto} onInsert={handleInsertAuto}
          />
        )}
      </div>
    </div>
  );
}
