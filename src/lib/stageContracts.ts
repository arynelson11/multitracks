// Contratos do palco novo (Parte 2): tipos que o motor, o agendador do pulo e as peças
// do palco trocam entre si, mais as contas de compasso que todo mundo usa.
// Sem React e sem Web Audio: só tipos e funções puras.
import type { ChannelRole } from '../types'
import type { TimeSignatureType } from './AudioAnalyzer'

// ---------- Compasso ----------

export type TimeSignature = TimeSignatureType // '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'

const PULSES: Record<TimeSignature, number> = { '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '7/8': 7, '12/8': 12 }

/** Compassos que o palco conhece, nessa ordem (é a ordem do seletor do modo EDITAR). */
export const TIME_SIGNATURES: readonly TimeSignature[] = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']

/** Pulsos do click num compasso: 3, 4, 5, 6, 7 ou 12. */
export function pulsesPerBar(sig: TimeSignature): number {
  return PULSES[sig]
}

/** Compasso composto (o pulso se agrupa de 3 em 3): 6/8 e 12/8. */
export function isCompound(sig: TimeSignature): boolean {
  return sig === '6/8' || sig === '12/8'
}

/** Bipes da contagem num compasso. Contar de 3 em 3 só encurta o composto (6/8 conta 2, 12/8 conta 4). */
export function countPulses(sig: TimeSignature, countEvery: 1 | 3): number {
  return countEvery === 3 && isCompound(sig) ? pulsesPerBar(sig) / 3 : pulsesPerBar(sig)
}

/** Compasso de um número de pulsos lido no click; nulo quando não é nenhum dos conhecidos. */
export function signatureForPulses(n: number): TimeSignature | null {
  return TIME_SIGNATURES.find((s) => PULSES[s] === n) ?? null
}

// ---------- BPM do pulso e BPM exibido ----------
// Conversão única (Ruling T3-BPM): o BPM que a tela mostra e que o `bpm_exact` grava é sempre o
// da semínima, como no Ableton, na MultiTracks e no nome das pastas ("Fé" em 6/8 = 78). Decide o
// DENOMINADOR do compasso (Ruling D1-denominador): no x/8 (6/8, 7/8, 12/8) o pulso da grade é a
// colcheia, no x/4 é a semínima.

/** Compasso de colcheia (x/8: 6/8, 7/8, 12/8): o pulso da grade é a colcheia, metade da semínima. */
export function isEighthPulse(sig: TimeSignature): boolean {
  return sig.endsWith('/8')
}

/** BPM exibido e salvo (semínima) a partir do BPM do pulso: metade no x/8, o mesmo no x/4. NaN com entrada não finita ou <= 0. */
export function displayBpmFromPulseBpm(pulseBpm: number, signature: TimeSignature): number {
  if (!Number.isFinite(pulseBpm) || pulseBpm <= 0) return NaN
  return isEighthPulse(signature) ? pulseBpm / 2 : pulseBpm
}

/** BPM do pulso a partir do BPM exibido e salvo (semínima): o dobro no x/8, o mesmo no x/4. NaN com entrada não finita ou <= 0. */
export function pulseBpmFromDisplayBpm(displayBpm: number, signature: TimeSignature): number {
  if (!Number.isFinite(displayBpm) || displayBpm <= 0) return NaN
  return isEighthPulse(signature) ? displayBpm * 2 : displayBpm
}

// ---------- Grade da música ----------

export type GridSource = 'click' | 'bpm'                            // de onde vêm BPM e fase
export type MeterSource = 'manual' | 'salvo' | 'acento' | 'padrao'  // de onde vem o compasso

/**
 * Grade da música. `bpm` = pulsos da GRADE por minuto, com decimais (é o que o pulso e o
 * compasso usam): a semínima no 3/4, 4/4 e 5/4 e a colcheia no 6/8, 7/8 e 12/8. Não é a taxa
 * do click (um click em colcheias no 4/4 dá a grade na semínima) nem, no x/8, o BPM da música:
 * o BPM exibido e salvo (`bpm_exact`) é sempre a semínima, `displayBpmFromPulseBpm(g.bpm,
 * g.signature)` (78 no "Fé" em 6/8, com a grade em 156), e a volta é `pulseBpmFromDisplayBpm`.
 * `firstDownbeat` é o primeiro "1" em segundos da música (só vale com `source: 'click'`).
 */
export interface SongGrid { bpm: number; firstDownbeat: number; signature: TimeSignature; countEvery: 1 | 3; source: GridSource; meterSource: MeterSource }

/** Só a grade lida na faixa de click sabe onde cai o "1"; com o BPM salvo a contagem fica ancorada no destino. */
export const gridHasPhase = (g: SongGrid): boolean => g.source === 'click'

export type GridWarning = 'sem-grade' | 'sem-click-lido' | 'compasso-assumido'

/** Aviso âmbar da célula de tempo (e do PRÓXIMA com pulo armado): rótulo curto e a explicação no title. */
export const GRID_WARNING_TEXT: Record<GridWarning, { label: string; title: string }> = {
  'sem-grade': { label: 'SEM GRADE', title: 'Sem click e sem BPM salvo: o pulo cai na marca da seção, sem contagem.' },
  'sem-click-lido': { label: 'SEM CLICK LIDO', title: 'A contagem usa o BPM salvo da música. Confira o canal de click.' },
  'compasso-assumido': { label: 'COMPASSO ASSUMIDO', title: 'O click não tem acento no 1. Confira o compasso no EDITAR.' },
}

// ---------- Intenção armada e linha do tempo ----------

export type Plays = number | 'infinite'
/** O que o operador armou: ir pra seção `target` e tocá-la `plays` vezes (∞ continua). */
export interface ArmIntent { target: number; plays: Plays }
/** Trecho da linha do tempo: a partir de `ctxStart` (tempo do AudioContext) a música anda de `songStart`. */
export interface TimelineSegment { ctxStart: number; songStart: number }
export interface SectionSpan { index: number; start: number; end: number; snappedTo?: 'bar' | 'pulse' | 'raw' } // segundos da música, encaixados; index = posição na lista de spans; snappedTo = como o início caiu na grade (sectionSpans)

// ---------- Saídas de áudio ----------

export type OutputMode = 'stereo' | 'split2' | 'multi'
export interface OutputSettings { mode: OutputMode; earOnSecond: boolean; multi: { vsPair: number; click: number; guide: number } } // saídas com índice 0
export interface OutputPlan { mode: OutputMode; channels: number; vs: number[]; click: number[]; guide: number[]; panByRole: boolean; fellBackFrom: OutputMode | null }
export type StageVersion = 'novo' | 'antigo'
export type StageMode = 'novo' | 'antigo' // o que vale agora (chave + tela), decidido pelo App

// ---------- O que o palco mostra ----------

export interface StageSection { index: number; label: string; color: string; start: number; end: number; bars: number | null }
export interface TransitionView {
  from: number; to: number; kind: 'proxima' | 'repete'; plays: Plays
  switchAt: number | null; countTimes: number[]; countLabels: number[]; countTotal: number // tempos do contexto
  barsLeft: number | null; committed: boolean; clickAudible: boolean; hasGrid: boolean
}
export interface StageChannel { id: string; label: string; color: string; role: ChannelRole; volume: number; muted: boolean; soloed: boolean; pan: number; silenced: boolean }
export interface StageSong { id: string; name: string; artist?: string; coverImage?: string; originalKey: string | null; pitch: number; bpm: number | null; signature: TimeSignature | null; duration: number; position: number; total: number; prevName: string | null; nextName: string | null; repertoireName: string | null }
export interface StageGates { sections: boolean; infinite: boolean; maxRepeats: number; bandSections: boolean }
export interface StageView {
  song: StageSong | null; sections: StageSection[]; currentSection: number; intent: ArmIntent | null; transition: TransitionView | null
  landed: { index: number; at: number } | null; grid: SongGrid | null; gridWarning: GridWarning | null; isReadingGrid: boolean
  isPlaying: boolean; isCountingIn: boolean; precount: { enabled: boolean; beats: number; times: number[] }
  endMode: 'continue' | 'stop' | 'fade-out'; click: { channelId: string | null; on: boolean }
  channels: StageChannel[]; master: { volume: number; muted: boolean }; outputs: OutputPlan; gates: StageGates
  editMode: boolean; channelEditMode: boolean; padPanelOpen: boolean; activePad: string | null
  app: { online: boolean; isDesktop: boolean; isAdmin: boolean; userName: string | null; hostActive: boolean }
  /** Pan automático ligado nas Configurações. Só muda o som em "Tudo junto", onde o lado vem do papel e o knob trava. */
  autoPan?: boolean
}
export interface StageActions {
  togglePlay(): void; goToStart(): void; setEndMode(m: StageView['endMode']): void; togglePrecount(): void; cyclePrecountBeats(): void
  toggleClick(): void; openMetronome(): void; tapSection(i: number): void; stepSection(dir: -1 | 1): void; cancelArm(): void
  armRepeat(plays: Plays): void; toggleLoop(): void; seek(t: number): void; seekBy(dt: number): void; changePitch(semitones: number): void
  prevSong(): void; nextSong(): void; setVolume(id: string, gain: number): void; toggleMute(id: string): void; toggleSolo(id: string): void
  setPan(id: string, pan: number): void; setMasterVolume(gain: number): void; toggleMasterMute(): void; togglePadPanel(): void; openLyrics(): void
  openRepertoires(): void; openTracks(): void; openLibrary(): void; toggleEditMode(): void; toggleChannelEditMode(): void; openHost(): void
  openSettings(): void; goHome(): void; signOut(): void; openUpgrade(): void; openChannelEdit(id: string): void
  reorderChannel(from: number, to: number): void; removeChannel(id: string): void
  markSection(label: string): void; nudgeSection(index: number, bars: number): void; removeSection(index: number): void
  setMeter(sig: TimeSignature, countEvery: 1 | 3): void; redetectMeter(): void
  /** Tom original da música (um dos 12 tons) ou nulo pra "Redefinir detecção de tom", como no palco antigo. */
  setOriginalKey(key: string | null): void
}
/** Leituras de cada quadro (lidas por useFrame dentro da peça, nunca guardadas em estado do React). */
export interface StageClock { heardNow(): number; position(): number; level(channelId: string): number; masterLevels(): { l: number; r: number } }
