// Efeitos do papel do canal (Click, Guia, Normal) no som: solo, troca de tom,
// pan automático e quem serve de referência pra onda e pro tempo. Também aplica
// a edição de nome e papel sem mutar nada. Puro: sem React, sem IndexedDB, sem Web Audio.
// Importa de channelNames.ts; channelNames.ts nunca importa daqui.
import type { ChannelOrderMode, ChannelRole } from '../types'
import { arrangeChannels, channelFamily, resolveChannelRole, type ChannelIdentity } from './channelNames'

export interface AutoPanRouting {
  pan: -1 | 0 | 1
  bus: '1' | '2' | '1/2'
}

export interface MixState {
  volume: number
  muted: boolean
  soloed: boolean
}

// `undefined` não mexe no campo; `null` volta ao automático.
export interface ChannelMetaPatch {
  customName?: string | null
  role?: ChannelRole | null
}

export const CUSTOM_NAME_MAX = 24

// Click e Guia ficam fora da troca de tom.
export function isPitchExempt(ch: ChannelIdentity): boolean {
  return resolveChannelRole(ch) !== 'normal'
}

// Click e Guia continuam tocando quando outro canal está em Solo (spec 9b).
export function isSoloSafe(ch: ChannelIdentity): boolean {
  const role = resolveChannelRole(ch)
  return role === 'click' || role === 'guide'
}

export function isSilencedBySolo<T extends ChannelIdentity & MixState>(ch: T, all: readonly T[]): boolean {
  // O papel só é calculado quando há solo ligado (caso raro), porque isto roda a cada quadro do VU.
  return !ch.soloed && all.some((other) => other.soloed) && !isSoloSafe(ch)
}

// Preenchimento do fader do mixer. `silenced`: M ligado ou calado pelo Solo de outro canal.
// Calado fica cinza neutro, nunca vermelho: o vermelho é a cor da família Bateria, e o M
// aceso já marca o mute.
export function channelFaderFill(color: string, silenced: boolean): string {
  return silenced
    ? 'linear-gradient(to top, rgba(255,255,255,0.12), rgba(255,255,255,0.04))'
    : `linear-gradient(to top, ${color}66, ${color}15)`
}

// O M continua valendo pra todos, inclusive Click e Guia.
export function channelGain<T extends ChannelIdentity & MixState>(ch: T, all: readonly T[]): number {
  if (ch.muted || isSilencedBySolo(ch, all)) return 0
  return ch.volume
}

const EAR: AutoPanRouting = { pan: -1, bus: '1' }
const PA: AutoPanRouting = { pan: 1, bus: '2' }
const CENTER: AutoPanRouting = { pan: 0, bus: '1/2' }

// Pan automático ligado: Click e Guia no ouvido (L, bus 1); o resto no PA (R, bus 2).
export function autoPanFor(ch: ChannelIdentity, autoPanEnabled: boolean): AutoPanRouting {
  if (!autoPanEnabled) return { ...CENTER }
  return resolveChannelRole(ch) === 'normal' ? { ...PA } : { ...EAR }
}

// "A música já tem click" (Parte 2): vale o papel manual.
export function findClickChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined {
  return channels.find((ch) => resolveChannelRole(ch) === 'click')
}

// Canal de referência pra onda do SectionBar e pra detecção de tom.
export function pickMainChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined {
  return channels.find((ch) => resolveChannelRole(ch) === 'normal')
}

// Fonte do tempo: bateria, depois baixo, depois o primeiro normal, depois o primeiro.
export function pickTempoSourceChannel<T extends ChannelIdentity>(channels: readonly T[]): T | undefined {
  return channels.find((ch) => channelFamily(ch) === 'bateria')
    ?? channels.find((ch) => channelFamily(ch) === 'baixo')
    ?? pickMainChannel(channels)
    ?? channels[0]
}

// Espaços colapsados, trim, no máximo CUSTOM_NAME_MAX, sem espaço sobrando no fim
// e sem partir um emoji (par de surrogates) ao meio. Vale no EDITAR CANAIS e no ZIP importado.
export function normalizeCustomName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_NAME_MAX)
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1)
  return name.trimEnd()
}

// Sempre devolve uma cópia nova; nunca muta o canal recebido.
export function applyChannelMetaPatch<T extends ChannelIdentity>(ch: T, patch: ChannelMetaPatch): T {
  const next: ChannelIdentity = { ...ch }
  if (patch.customName !== undefined) {
    const name = patch.customName === null ? '' : normalizeCustomName(patch.customName)
    if (name) next.customName = name
    else delete next.customName
  }
  if (patch.role !== undefined) {
    if (patch.role === null) delete next.role
    else next.role = patch.role
  }
  return next as T
}

// `after` é o mesmo objeto que está em `channels`. Id desconhecido devolve a lista
// na mesma ordem, sem `before`/`after`.
export function applyChannelMetaToList<T extends ChannelIdentity>(
  channels: readonly T[],
  channelId: string,
  patch: ChannelMetaPatch,
  mode: ChannelOrderMode | undefined,
): { channels: T[]; before?: T; after?: T; roleChanged: boolean } {
  const index = channels.findIndex((ch) => ch.id === channelId)
  if (index === -1) return { channels: [...channels], roleChanged: false }
  const before = channels[index]
  const after = applyChannelMetaPatch(before, patch)
  const patched = channels.map((ch, i) => (i === index ? after : ch))
  return {
    channels: arrangeChannels(patched, mode),
    before,
    after,
    roleChanged: resolveChannelRole(before) !== resolveChannelRole(after),
  }
}

// O que o motor faz quando o papel do canal muda: nada, soltar o nó de tom
// (parado e passou a ser isento) ou reiniciar curto (tocando).
export function pitchChangeAction(
  before: ChannelIdentity,
  after: ChannelIdentity,
  ctx: { isPlaying: boolean; pitch: number },
): 'none' | 'release' | 'restart' {
  const wasExempt = isPitchExempt(before)
  const isExempt = isPitchExempt(after)
  if (wasExempt === isExempt || ctx.pitch === 0) return 'none'
  if (!ctx.isPlaying) return isExempt ? 'release' : 'none'
  return 'restart'
}
