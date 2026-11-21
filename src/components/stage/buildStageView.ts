// Do motor pro palco novo (T29): junta o estado do useAudioEngine e o do App na StageView da T1,
// sem React e sem Web Audio. O App chama uma vez por mudança (useMemo) e a casca só desenha.
import { buildChannelLabels } from '../../lib/channelNames'
import { findClickChannel, isSilencedBySolo } from '../../lib/channelRoles'
import { shownEndMode } from '../../lib/autoAdvance'
import { canBandControlSections, canUseRepertoire, canUseSections } from '../../lib/plans'
import { armLabel } from '../../lib/sectionArm'
import { defaultSectionName, SECTION_SHORTCUTS } from '../../lib/sectionTypes'
import { barSeconds, markerIdForSpan } from '../../lib/songGrid'
import { gridHasPhase } from '../../lib/stageContracts'
import type {
  ArmIntent, GridWarning, OutputPlan, SectionSpan, SongGrid, StageChannel, StageGates, StageSection, StageSong, StageView,
  TransitionView,
} from '../../lib/stageContracts'
import type { LiveArmed, Marker, Song } from '../../types'

/**
 * O que o palco precisa do motor. `currentSection` é a seção que se ouve agora (`sectionIndexAt`
 * das `spans` no tempo OUVIDO, a mesma conta do motor pra armar): o App calcula, porque a posição
 * muda a cada quadro e a seção só muda na fronteira (a vista fica igual entre as fronteiras).
 * `duration` é a duração com que o motor encaixou as `spans` (a mesma vai pra onda e pros nomes).
 */
export interface EngineStageState {
  song: Song | undefined; playlist: readonly Song[]; activeIndex: number; duration: number; spans: readonly SectionSpan[]; currentSection: number
  isPlaying: boolean; isCountingIn: boolean; precountEnabled: boolean; precountBeats: number; precountTimes: readonly number[]
  playbackMode: 'continue' | 'stop' | 'fade-out'; sectionIntent: ArmIntent | null; transitionView: TransitionView | null
  landed: StageView['landed']; songGrid: SongGrid | null; gridWarning: GridWarning | null; isReadingGrid: boolean; outputPlan: OutputPlan
  masterVolume: number; masterMuted: boolean
}

/** O que é do App (plano, conta, janelas abertas). */
export interface StageUiState {
  plan: string | null; isAdmin: boolean; online: boolean; isDesktop: boolean; userName: string | null; hostActive: boolean
  editMode: boolean; channelEditMode: boolean; padPanelOpen: boolean; activePad: string | null; repertoireName: string | null
  /** Músicas do mês no palco pro selo do Livre; nulo pra conta paga (e pro admin). */
  livre: StageView['app']['livre']
  /** Pan automático das Configurações (trava o knob em "Tudo junto"). */
  autoPan?: boolean
}

/** Teto do REPETIR no palco (o mesmo 9 do palco antigo; a banda ganha uma passagem a mais no motor). */
export const STAGE_MAX_REPEATS = 9

/**
 * Portões do plano (plans.ts), os mesmos pro palco e pro motor: seções e loop infinito seguem
 * `canUseSections` (todos os planos desde a Parte 3, o Livre inclusive); a banda controlar
 * seções é do Studio (`canBandControlSections`); o AUTO entre músicas é do pago
 * (`canUseRepertoire`, o mesmo `autoNext` que o motor recebe; o admin ganha na vista).
 */
export function stageGatesFor(plan: string | null | undefined): StageGates {
  const sections = canUseSections(plan)
  return { sections, infinite: sections, maxRepeats: STAGE_MAX_REPEATS, bandSections: canBandControlSections(plan), autoNext: canUseRepertoire(plan) }
}

/** Cor de reserva de uma seção sem tipo e sem cor (a do Refrão, como o `colorForSection`). */
const FALLBACK_SECTION_COLOR = '#FF6B35'

/**
 * Cor da seção: a do TIPO quando o nome é o padrão de um tipo ("Verso 2" é Verso); nome próprio
 * fica com a cor gravada na marca (o editor do admin escolhe) ou a de reserva.
 */
function sectionColor(marker: Marker | undefined): string {
  if (!marker) return FALLBACK_SECTION_COLOR
  const type = defaultSectionName(marker.label)?.type
  const typeColor = type ? SECTION_SHORTCUTS.find((s) => s.name === type)?.color : undefined
  return typeColor ?? marker.color ?? FALLBACK_SECTION_COLOR
}

/** Compassos de um trecho, só com a grade com fase (é ela que sabe onde cai o 1). */
function barsOf(span: SectionSpan, grid: SongGrid | null): number | null {
  if (!grid || !gridHasPhase(grid)) return null
  const bar = barSeconds(grid)
  if (!Number.isFinite(bar) || bar <= 0) return null
  const bars = Math.round((span.end - span.start) / bar)
  return Number.isFinite(bars) ? Math.max(1, bars) : null
}

/** Seções do palco: os trechos encaixados do motor, com o nome e a cor da marca que deu origem a cada um. */
function stageSections(song: Song | undefined, duration: number, spans: readonly SectionSpan[], grid: SongGrid | null): StageSection[] {
  const markers = song?.markers ?? []
  return spans.map((span) => {
    const id = markerIdForSpan(markers, duration, grid, span.index)
    const marker = id === null ? undefined : markers.find((m) => m.id === id)
    return { index: span.index, label: marker?.label ?? '', color: sectionColor(marker), start: span.start, end: span.end, bars: barsOf(span, grid) }
  })
}

/** Título e artista: o artista salvo ou o "Artista - Título" do nome, como a lista do palco antigo. */
export function splitSongName(song: Pick<Song, 'name' | 'artist'>): { title: string; artist?: string } {
  const artist = song.artist?.trim()
  if (artist) {
    const prefix = `${artist} - `
    return { title: song.name.startsWith(prefix) ? song.name.slice(prefix.length) : song.name, artist }
  }
  const parts = song.name.split(' - ')
  return parts.length >= 2 ? { title: parts.slice(1).join(' - ').trim(), artist: parts[0].trim() } : { title: song.name }
}

function stageSong(e: EngineStageState, repertoireName: string | null): StageSong | null {
  const s = e.song
  if (!s) return null
  const { title, artist } = splitSongName(s)
  const prev = e.playlist[e.activeIndex - 1]
  const next = e.playlist[e.activeIndex + 1]
  return {
    id: s.id, name: title, artist, coverImage: s.coverImage, originalKey: s.originalKey ?? null, pitch: s.pitch ?? 0,
    // BPM SALVO, na semínima (Aviso T29 final): a faixa do meio converte a grade sozinha.
    bpm: typeof s.bpm === 'number' && Number.isFinite(s.bpm) && s.bpm > 0 ? s.bpm : null,
    signature: e.songGrid?.signature ?? s.timeSignature ?? null,
    duration: e.duration, position: e.activeIndex + 1, total: e.playlist.length,
    prevName: prev ? splitSongName(prev).title : null, nextName: next ? splitSongName(next).title : null, repertoireName,
  }
}

/** Canais do mixer: rótulo e cor pela regra central, papel resolvido e calado pelo Solo de outro (o M é `muted`). */
function stageChannels(song: Song | undefined): StageChannel[] {
  const channels = song?.channels ?? []
  const labels = new Map(buildChannelLabels(channels).map((l) => [l.id, l]))
  return channels.map((ch) => {
    const l = labels.get(ch.id)
    return {
      id: ch.id, label: l?.label ?? ch.name, color: l?.color ?? '#878792', role: l?.role ?? 'normal',
      volume: ch.volume, muted: ch.muted, soloed: ch.soloed, pan: ch.pan, silenced: isSilencedBySolo(ch, channels),
    }
  })
}

/** A vista inteira do palco novo. */
export function buildStageView(e: EngineStageState, ui: StageUiState): StageView {
  const clickChannel = findClickChannel(e.song?.channels ?? [])
  // O admin tem o AUTO em qualquer plano, como no motor (autoNext: isAdmin || canUseRepertoire).
  const planGates = stageGatesFor(ui.plan)
  const gates = ui.isAdmin ? { ...planGates, autoNext: true } : planGates
  return {
    song: stageSong(e, ui.repertoireName),
    sections: stageSections(e.song, e.duration, e.spans, e.songGrid),
    currentSection: e.currentSection,
    intent: e.sectionIntent,
    transition: e.transitionView,
    landed: e.landed,
    grid: e.songGrid,
    gridWarning: e.gridWarning,
    isReadingGrid: e.isReadingGrid,
    isPlaying: e.isPlaying,
    isCountingIn: e.isCountingIn,
    precount: { enabled: e.precountEnabled, beats: e.precountBeats, times: [...e.precountTimes] },
    // Sem o AUTO (Livre), o 'continue' do motor para no fim: a tela mostra PARAR (Ruling AUTO-livre).
    endMode: shownEndMode(e.playbackMode, gates.autoNext !== false),
    // Click ligado = o canal de click sem o M (o botão CLICK é o M dele).
    click: { channelId: clickChannel?.id ?? null, on: !!clickChannel && !clickChannel.muted },
    channels: stageChannels(e.song),
    master: { volume: e.masterVolume, muted: e.masterMuted },
    outputs: e.outputPlan,
    gates,
    editMode: ui.editMode,
    channelEditMode: ui.channelEditMode,
    padPanelOpen: ui.padPanelOpen,
    activePad: ui.activePad,
    app: {
      online: ui.online, isDesktop: ui.isDesktop, isAdmin: ui.isAdmin, userName: ui.userName, hostActive: ui.hostActive,
      // Selo do Livre só com o palco parado: nunca com a música tocando ou na pré-contagem.
      livre: ui.livre && !e.isPlaying && !e.isCountingIn ? ui.livre : null,
    },
    autoPan: ui.autoPan === true,
  }
}

/**
 * Pulo armado como o celular da banda vê (HOST_STATE.armed): a seção alvo pelo índice da lista
 * `sections` (a mesma das spans, que os comandos da banda usam), com nome, cor, se é PRÓXIMA ou
 * REPETE e as passagens. Nulo sem nada armado ou com o alvo fora da lista.
 */
export function liveArmedOf(view: Pick<StageView, 'intent' | 'sections' | 'currentSection'>): LiveArmed | null {
  const label = armLabel(view.intent, view.currentSection)
  const target = view.intent ? view.sections[view.intent.target] : undefined
  if (!label || !target) return null
  return { index: target.index, label: target.label, color: target.color, kind: label.kind, plays: label.plays }
}
