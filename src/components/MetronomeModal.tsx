import { useState, useRef, useCallback, useId, useLayoutEffect } from 'react';
import { Play, Loader2, Minus, Plus, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { Button, Chip, IconButton, Led, Notice, Switch, TextField } from './ui';
import { StageDialog } from './stage/StageDialog';

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

// O click gerado não entrou: a música mudou enquanto ele era feito (Gerar click manual ou Inserir click).
const DISCARDED_TEXT = 'A música mudou enquanto o click era gerado: ele não entrou. Gere de novo na música certa.';

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
            <Chip key={f.label} title={`${f.name}: ${formatBpm(target)} BPM${!inRange ? ` (fora de ${BPM_RANGE.min} a ${BPM_RANGE.max} BPM)` : !canAnalyze ? ' (pare a música pra refazer)' : ''}`} disabled={busy || !canAnalyze || !inRange} onClick={() => onAnalyze(target)}>
              {f.label}
            </Chip>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="ps-label">Mover o 1</span>
        <div className="flex items-center gap-1.5">
          <IconButton aria-label="Mover o 1 pra trás" icon={<ChevronLeft size={16} />} disabled={busy} onClick={() => onAdjust({ moveOne: moveOne - 1 })} />
          <span className="ps-num text-ps-bone text-ps-base font-bold min-w-8 text-center">{shownMove > 0 ? '+' : ''}{shownMove}</span>
          <IconButton aria-label="Mover o 1 pra frente" icon={<ChevronRight size={16} />} disabled={busy} onClick={() => onAdjust({ moveOne: moveOne + 1 })} />
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
  const uid = useId();
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual');
  const [bpm, setBpm] = useState<number>(120);
  const [bpmInput, setBpmInput] = useState<string>('120');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  // Click gerado que não entrou porque a música mudou no meio (fica até a próxima geração).
  const [discarded, setDiscarded] = useState(false);
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
    // O click é da música em que foi pedido: a geração cede a vez e leva ~1 s (Ruling T27-gerador),
    // e nesse meio tempo a música pode mudar (AUTO no fim, comando da banda). Aí ele não entra.
    const forSong = songId;
    let entered = true;
    setDiscarded(false);
    setIsSynthesizing(true);
    setStatusMsg(`Gerando click ${clickSel.type} ${clickSel.subdivision} a ${bpm} BPM...`);
    try {
      const { clickTrackUrl } = await generateManualClickTrackFromSample(
        clickSel.type, clickSel.subdivision, bpm, songDuration, accentBeat1, timeSignature
      );
      if (clickTrackUrl) {
        const res = await fetch(clickTrackUrl);
        const blob = await res.blob();
        URL.revokeObjectURL(clickTrackUrl);
        if (liveRef.current.songId !== forSong) {
          entered = false;
          setDiscarded(true);
          return;
        }
        const file = new File([blob], `Click_${clickSel.type}_${bpm}bpm.wav`, { type: 'audio/wav' });
        onAddClick(file);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar metrônomo.');
    } finally {
      setIsSynthesizing(false);
      setStatusMsg('');
      // Fica aberto quando o click não entrou, com o aviso.
      if (entered) onClose();
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
    setDiscarded(false);
    setIsSynthesizing(true);
    setStatusMsg('Gerando o click...');
    try {
      const plan = adjustAutoClick(shownAuto.plan, { moveOne: shownAuto.moveOne, halfBeat: shownAuto.halfBeat });
      const blob = await renderAutoClick(plan, songDuration, clickSel);
      // O "Inserir" põe o click na música ativa: se ela mudou enquanto o click era gerado, não entra
      // (e o modal diz isso).
      if (liveRef.current.songId !== forSong) {
        setDiscarded(true);
        return;
      }
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

  // Enquanto o click é gerado a janela não fecha: o X fica desligado (como era antes), e nem o Esc
  // nem o toque fora fecham. A amostra do click tem prazo (AudioAnalyzer), então isso não prende.
  const close = () => { if (!isSynthesizing) onClose(); };

  return (
    <StageDialog open title="Metrônomo" size="sm" onClose={close} closeDisabled={isSynthesizing}>
      <div className="flex flex-col gap-4">
        {/* Andamento: nome, BPM com − e +, TAP TEMPO e 2× */}
        <section aria-labelledby={`${uid}-bpm`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 id={`${uid}-bpm`} className="ps-label">Andamento</h3>
            <span className="text-ps-sm font-bold text-ps-mut">{getTempoName(bpm)}</span>
          </div>
          <div className="flex items-center gap-2">
            <IconButton aria-label="Diminuir o BPM" icon={<Minus size={18} />} disabled={isSynthesizing} onClick={() => handleBpmChange(bpm - 1)} />
            <TextField
              label="BPM" hideLabel type="number" inputMode="numeric" min={40} max={300}
              value={bpmInput} onChange={(e) => setBpmInput(e.target.value)} onBlur={handleBpmInputBlur}
              disabled={isSynthesizing} trailing="BPM" className="flex-1" inputClassName="text-center ps-num font-bold"
            />
            <IconButton aria-label="Aumentar o BPM" icon={<Plus size={18} />} disabled={isSynthesizing} onClick={() => handleBpmChange(bpm + 1)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="grow" icon={<Led state={tapCount > 0 ? 'on' : 'off'} />} disabled={isSynthesizing} onClick={handleTapTempo}>
              TAP TEMPO
            </Button>
            <Chip title="Dobrar o BPM" disabled={isSynthesizing || bpm * 2 > 300} onClick={handleDoubleTempo}>2×</Chip>
          </div>
        </section>

        {/* Som do click, subdivisão e compasso: a escolha acesa em laranja (ligado) */}
        <section aria-labelledby={`${uid}-som`} className="flex flex-col gap-2">
          <h3 id={`${uid}-som`} className="ps-label">Som do click</h3>
          <div className="flex flex-wrap gap-1.5">
            {CLICK_TYPES.map(t => (
              <Chip key={t.id} small on={clickSel.type === t.id} aria-pressed={clickSel.type === t.id} disabled={isSynthesizing} onClick={() => updateClickSel({ type: t.id })}>
                {t.label}
              </Chip>
            ))}
          </div>
        </section>

        <section aria-labelledby={`${uid}-sub`} className="flex flex-col gap-2">
          <h3 id={`${uid}-sub`} className="ps-label">Subdivisão</h3>
          <div className="flex flex-wrap gap-1.5">
            {CLICK_SUBDIVISIONS.map(s => (
              <Chip key={s.id} small on={clickSel.subdivision === s.id} aria-pressed={clickSel.subdivision === s.id} disabled={isSynthesizing} onClick={() => updateClickSel({ subdivision: s.id })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </section>

        <section aria-labelledby={`${uid}-compasso`} className="flex flex-col gap-2">
          <h3 id={`${uid}-compasso`} className="ps-label">Compasso</h3>
          <div className="flex flex-wrap gap-1.5">
            {TIME_SIGNATURES.map(ts => (
              <Chip key={ts} small on={timeSignature === ts} aria-pressed={timeSignature === ts} disabled={isSynthesizing} onClick={() => changeMeter(ts)}>
                {ts}
              </Chip>
            ))}
          </div>
        </section>

        <Switch
          label="Acentuar o 1" description="O primeiro tempo do compasso soa mais forte."
          checked={accentBeat1} onChange={setAccentBeat1} disabled={isSynthesizing}
          className="rounded-ps-lg bg-ps-s1 py-2 pl-3 pr-2 inset-ring inset-ring-ps-line"
        />

        {isSynthesizing && statusMsg && (
          <Notice role="status" className="flex items-center gap-2">
            <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
            <span>{statusMsg}</span>
          </Notice>
        )}
        {discarded && !isSynthesizing && (
          <Notice tone="alert" role="status">{DISCARDED_TEXT}</Notice>
        )}

        {/* Ações: o click manual e o click IA (a ação principal, em laranja) */}
        <div className="flex flex-col gap-2">
          <Button
            icon={isSynthesizing && activeTab === 'manual' ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Play fill="currentColor" size={14} />}
            disabled={isSynthesizing || !playlistCurrentSong}
            onClick={() => { setActiveTab('manual'); handleManualGenerate(); }}
          >
            GERAR CLICK MANUAL
          </Button>

          {existingClick !== null && (
            <p className="text-ps-mut text-ps-sm font-bold text-center px-2">Esta música já tem click ({existingClick}).</p>
          )}
          {isPlaying && (
            <p className="text-ps-alert text-ps-sm font-bold text-center px-2">Pare a música pra analisar o tempo.</p>
          )}
          <Button
            tone="primary"
            className="uppercase"
            icon={isSynthesizing && activeTab === 'ai' ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Wand2 size={16} />}
            disabled={isSynthesizing || !playlistCurrentSong || isPlaying}
            onClick={() => analyze()}
          >
            {existingClick !== null ? 'Gerar outro click' : 'Gerar click IA'}
          </Button>
        </div>

        {shownAuto.step === 'falhou' && (
          <p ref={revealResult} className="text-ps-alert text-ps-base font-bold text-center px-2">{FAIL_TEXT[shownAuto.reason]}</p>
        )}

        {shownAuto.step === 'pronto' && (
          <AutoClickResult
            sectionRef={revealResult} plan={shownAuto.plan} moveOne={shownAuto.moveOne} halfBeat={shownAuto.halfBeat} songBpm={songBpm}
            busy={isSynthesizing} canAnalyze={!isPlaying} onAnalyze={analyze} onAdjust={adjustAuto} onInsert={handleInsertAuto}
          />
        )}
      </div>
    </StageDialog>
  );
}
