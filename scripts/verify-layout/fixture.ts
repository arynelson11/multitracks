// Dados de exemplo do verificador de layout (T20): o pior caso de texto que o palco novo recebe
// (14 canais com os nomes organizados mais longos da Parte 1, 9 seções com uma "Refrão Final
// Estendido", música e artista longos, 6 no repertório). Uma vista por estado (`?estado=`).
// Nada daqui entra no app.
import type { PadPanelProps } from '../../src/components/stage/PadPanel'
import { TELA_ESTADOS } from './telasEstados'
import type { RepertoirePanelProps, RepertoireSongItem } from '../../src/components/stage/RepertoirePanel'
import type { StageShellActions } from '../../src/components/stage/StageShell'
import type { OutputWarning } from '../../src/lib/outputPlan'
import type {
  OutputPlan, OutputSettings, SongGrid, StageChannel, StageClock, StageGates, StageSection, StageSong, StageView, TransitionView,
} from '../../src/lib/stageContracts'

/** Estados da rodada normal, nessa ordem (o run.mjs tem a mesma lista); os das demais telas vêm de telasEstados.ts. */
export const ESTADOS = ['normal', 'contando', 'pads', 'editar', 'livre', 'selo', 'repertorio', 'tom', 'semtom', 'compasso', 'config', ...TELA_ESTADOS] as const
/** Estado de prova: um botão de largura fixa com texto longo, que o verificador tem de acusar. */
export const ESTADO_PROVA = 'quebrado'
export type Estado = (typeof ESTADOS)[number] | typeof ESTADO_PROVA

export function parseEstado(value: string | null): Estado | null {
  if (value === ESTADO_PROVA) return value
  return (ESTADOS as readonly string[]).includes(value ?? '') ? (value as Estado) : null
}

const noop = () => {}

/** StageActions vazias: toda ação existe e não faz nada (o verificador só mede). */
export const ACTIONS = new Proxy({}, { get: () => noop }) as StageShellActions

// ---------- Música, seções e grade ----------

/** 120 BPM em 4/4: um compasso a cada 2 s. Linha do tempo sem pulo: tempo do contexto = tempo da música. */
const BAR = 2

const sec = (index: number, label: string, color: string, start: number, end: number): StageSection => ({
  index, label, color, start, end, bars: Math.round((end - start) / BAR),
})

export const SECTIONS: StageSection[] = [
  sec(0, 'Intro', '#3b82f6', 0, 16),
  sec(1, 'Verso 1', '#10b981', 16, 48),
  sec(2, 'Pré-Refrão', '#f59e0b', 48, 64),
  sec(3, 'Refrão', '#FF6B35', 64, 96),
  sec(4, 'Verso 2', '#10b981', 96, 128),
  sec(5, 'Ponte', '#8b5cf6', 128, 160),
  sec(6, 'Refrão 2', '#FF6B35', 160, 192),
  sec(7, 'Refrão Final Estendido', '#FF6B35', 192, 256),
  sec(8, 'Final', '#ec4899', 256, 300),
]
const CURRENT = 3
const TARGET = 7

const GRID: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }

const SONG: StageSong = {
  id: 'verificador',
  name: 'Grande É o Senhor e Mui Digno de Louvor (Ao Vivo em São Paulo)',
  artist: 'Ministério Adoração e Vida com Participação Especial do Coral Jovem',
  originalKey: 'F#', pitch: 2, bpm: 120, signature: '4/4', duration: 300, position: 3, total: 6,
  prevName: 'Lugar Secreto (Acústico na Igreja da Cidade)', nextName: 'Tu És Soberano Sobre Todas as Coisas',
  repertoireName: 'Culto de Domingo à Noite, Santa Ceia e Batismos',
}

// ---------- Canais ----------

const ch = (id: string, label: string, color: string, role: StageChannel['role'], volume: number, pan = 0, extra: Partial<StageChannel> = {}): StageChannel => ({
  id, label, color, role, volume, muted: false, soloed: false, pan, silenced: false, ...extra,
})

export const CHANNELS: StageChannel[] = [
  ch('c01', 'Click', '#94a3b8', 'click', 0.9),
  ch('c02', 'Guia', '#cbd5e1', 'guide', 0.85),
  ch('c03', 'Bateria', '#d4a373', 'normal', 0.8),
  ch('c04', 'Percussão Dedilhado Ambiente', '#e09f3e', 'normal', 0.7, -0.4),
  ch('c05', 'Baixo', '#9c6644', 'normal', 0.82),
  ch('c06', 'Violão Dedilhado', '#84a98c', 'normal', 0.6, 0.3),
  ch('c07', 'Guitarra Base', '#e76f51', 'normal', 0.66, -0.5),
  ch('c08', 'Guitarra Solo Ambiente', '#f4a261', 'normal', 0.55, 0.5, { muted: true }),
  ch('c09', 'Teclado Piano Elétrico', '#2a9d8f', 'normal', 0.7),
  ch('c10', 'Synth Bass', '#6d597a', 'normal', 0.6),
  ch('c11', 'Pad Ambiente', '#8e7dbe', 'normal', 0.5),
  ch('c12', 'Backing Vocal Soprano', '#e5989b', 'normal', 0.65, -0.2),
  ch('c13', 'Voz Principal Ministração', '#ffb4a2', 'normal', 0.75, 0, { soloed: true }),
  ch('c14', 'Ambiência Reverso', '#b5838d', 'normal', 0.45, 0.2),
]

const SPLIT: OutputPlan = { mode: 'split2', channels: 2, vs: [1], click: [0], guide: [0], panByRole: true, fellBackFrom: null }

const PAGO: StageGates = { sections: true, infinite: true, maxRepeats: 8, bandSections: true }
const LIVRE: StageGates = { sections: false, infinite: false, maxRepeats: 4, bandSections: false }

// ---------- Relógio parado na contagem ----------

/** Pulo armado do Refrão pro "Refrão Final Estendido": o último compasso do Refrão tem os bipes em 94, 94,5, 95 e 95,5 s. */
const COUNT_TIMES = [94, 94.5, 95, 95.5]
/** Relógio parado entre o 2º e o 3º bipe: a contagem está no tempo 2. */
const NOW = 94.7

export const CLOCK: StageClock = {
  heardNow: () => NOW,
  position: () => NOW,
  level: (id) => (id === 'c08' ? 0 : 0.35 + (Number(id.slice(1)) % 5) * 0.1),
  masterLevels: () => ({ l: 0.62, r: 0.58 }),
}

const COUNTING: TransitionView = {
  from: CURRENT, to: TARGET, kind: 'proxima', plays: 1, switchAt: 96, countTimes: COUNT_TIMES, countLabels: [1, 2, 3, 4], countTotal: 4,
  barsLeft: 1, committed: true, clickAudible: true, hasGrid: true,
}

/** Onda de exemplo (determinística): picos de 0 a 1 que sobem e descem pelas seções. */
export function makePeaks(n = 1600): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const body = 0.45 + 0.3 * Math.sin(t * Math.PI * 6) * Math.sin(t * Math.PI)
    out[i] = Math.min(1, Math.max(0.05, body + 0.2 * Math.abs(Math.sin(i * 1.7)) * Math.abs(Math.cos(i * 0.31))))
  }
  return out
}

// ---------- Vista por estado ----------

const BASE: StageView = {
  song: SONG, sections: SECTIONS, currentSection: CURRENT, intent: null, transition: null, landed: null, grid: GRID, gridWarning: null,
  isReadingGrid: false, isPlaying: true, isCountingIn: false, precount: { enabled: true, beats: 4, times: [] }, endMode: 'continue',
  click: { channelId: 'c01', on: true }, channels: CHANNELS, master: { volume: 0.9, muted: false }, outputs: SPLIT, gates: PAGO,
  editMode: false, channelEditMode: false, padPanelOpen: false, activePad: null,
  app: { online: true, isDesktop: true, isAdmin: false, userName: 'Ary Nelson', hostActive: false, livre: null },
}

/** Vista do palco em cada estado; `config` não usa o palco. */
export function viewFor(estado: Estado): StageView {
  switch (estado) {
    case 'contando':
      // Pior caso do transporte e da barra: pulo armado contando, compasso assumido (aviso âmbar
      // ao lado do PRÓXIMA), OFFLINE (mais largo que ONLINE) e HOST ligado.
      return {
        ...BASE, intent: { target: TARGET, plays: 1 }, transition: COUNTING, gridWarning: 'compasso-assumido',
        grid: { ...GRID, meterSource: 'padrao' }, app: { ...BASE.app, online: false, hostActive: true },
      }
    case 'pads':
      return { ...BASE, padPanelOpen: true, activePad: 'G#' }
    case 'editar':
    case 'compasso':
      return { ...BASE, editMode: true, isPlaying: false }
    case 'livre':
      return { ...BASE, gates: LIVRE, grid: { ...GRID, source: 'bpm' }, gridWarning: 'sem-click-lido' }
    case 'selo':
      // Pior caso da barra com o selo do Livre (Parte 3): palco parado (o selo só aparece parado),
      // OFFLINE (mais largo que ONLINE), HOST ligado, o aviso SAÍDAS e as 3 músicas do mês usadas.
      return { ...BASE, gates: LIVRE, isPlaying: false, app: { ...BASE.app, online: false, hostActive: true, livre: { used: 3, limit: 3 } } }
    case 'semtom':
      // Grade de tons sem tom original (a maior): semitons em 3 linhas, com "Definir o tom original" ao lado do 0.
      return { ...BASE, song: { ...SONG, originalKey: null, pitch: 3 } }
    default:
      return BASE
  }
}

/** Aviso âmbar SAÍDAS na barra: aparece nos estados em que a barra está no pior caso (no `selo`, junto com o selo do Livre). */
export function outputWarningFor(estado: Estado): OutputWarning | null {
  return estado === 'contando' || estado === 'selo' ? 'sink-timeout' : null
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export const PADS: Omit<PadPanelProps, 'open' | 'onClose'> = {
  view: 'pads', onViewChange: noop, notes: NOTES, activeNote: 'G#', songKeyIndex: 8, volume: 0.55,
  setName: 'Pads Atmosféricos de Adoração Vol. 2', onPlayNote: noop, onVolume: noop, onOpenSets: noop, onEditPads: noop,
}

const REPERTOIRE: RepertoireSongItem[] = [
  { id: 'r1', name: 'Abertura Instrumental com Leitura', artist: 'Banda da Igreja', originalKey: 'D', bpm: 72 },
  { id: 'r2', name: 'Lugar Secreto (Acústico na Igreja da Cidade)', artist: 'Gabriela Rocha e Convidados', originalKey: 'A', bpm: 68 },
  { id: 'r3', name: SONG.name, artist: SONG.artist, originalKey: 'F#', bpm: 120 },
  { id: 'r4', name: 'Tu És Soberano Sobre Todas as Coisas', artist: 'Ministério Diante do Trono', originalKey: 'Bb', bpm: 76.5 },
  { id: 'r5', name: 'Maravilhosa Graça (Versão Estendida)', artist: 'Coral e Orquestra Jovem da Comunidade', originalKey: 'G', bpm: 64 },
  { id: 'r6', name: 'Santo Espírito', artist: 'Laura Souguellis', originalKey: 'E', bpm: 70 },
]

export function repertoireProps(open: boolean): RepertoirePanelProps {
  return {
    open, songs: REPERTOIRE, activeIndex: 2, isPlaying: true,
    notes: 'Ceia depois da 3ª música. Repetir o refrão final duas vezes se o pastor pedir. Batismos no fim: Santo Espírito bem baixinho.',
    onNotesChange: noop, onSelect: noop, onReorder: noop, onRemove: noop, onNew: noop, onExport: noop, onImport: noop, onClose: noop,
  }
}

// ---------- Configurações (as duas seções da T19) ----------

export interface OutputsCase { outputs: OutputSettings; maxChannels: number; supportsDevicePick: boolean; loadWarnings: OutputWarning[] }

/** Placa de 2 canais com o mapa de 4 ou mais gravado (cai pra separados, com os avisos) e placa de 8 canais com o mapa. */
export const OUTPUT_CASES: OutputsCase[] = [
  { outputs: { mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }, maxChannels: 2, supportsDevicePick: false, loadWarnings: ['lado-assumido'] },
  { outputs: { mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }, maxChannels: 8, supportsDevicePick: true, loadWarnings: [] },
]
