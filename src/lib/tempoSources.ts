// Faixas que o detector de tempo analisa (recomendações 2 e 3 do relatório do
// metrônomo automático): o pulso vem da bateria e da percussão (kit separado entra
// inteiro), o baixo vota no "1" e até 2 instrumentos harmônicos ajudam com a troca de
// acorde. Guia, voz, backing e click nunca entram. Reconhece só pela regra central de
// canais (família, papel manual e palavra inteira do nome), nunca por pedaço de texto.
// Puro: sem React, sem IndexedDB, sem Web Audio.
import {
  FAMILY_LABEL, FAMILY_RANK, channelFamily, familySourceName, isDrumPieceToken, isEffectsChannel, nameTokens,
  type ChannelFamily, type ChannelIdentity,
} from './channelNames'
import { findClickChannel } from './channelRoles'

export interface TempoSources<T extends ChannelIdentity> {
  // Click da música (papel manual vale): quando existe, é o pulso perfeito.
  click: T | null
  pulse: T[]
  bass: T | null
  harmony: T[]
  // Famílias analisadas (pulso e baixo), em português: "Bateria, Percussão e Baixo".
  label: string
}

type SourceFamily = keyof typeof FAMILY_LABEL

const PULSE_FAMILIES: ReadonlySet<ChannelFamily> = new Set(['bateria', 'percussao'])
const HARMONY_FAMILIES: ReadonlySet<ChannelFamily> = new Set(['pad', 'teclado', 'piano', 'violao'])
const HARMONY_MAX = 2

// Kit inteiro: o canal da bateria toda. Loop e virada tocam só parte da música, e
// peça ("Snare Drum", "Kick Drum") é só uma parte do kit separado. "Kit" e "Bat"
// sozinhos são ambíguos e não contam.
const FULL_KIT_WORDS: ReadonlySet<string> = new Set(['drum', 'drums', 'drumm', 'bateria', 'batera'])
// Peça com FX ("KICK FX") é efeito, não levada: fica na Bateria do mixer, fora do pulso.
const EFFECT_WORDS: ReadonlySet<string> = new Set(['fx'])
const PARTIAL_KIT_WORDS: ReadonlySet<string> = new Set(['loop', 'loops', 'fill', 'fills'])

interface Candidate<T> {
  ch: T
  family: ChannelFamily
}

interface PulseCandidate<T> extends Candidate<T> {
  words: ReadonlySet<string>
}

// Manual vence automático, pela mesma regra do channelFamily: com nome do usuário
// reconhecido, só as palavras dele; senão, as do arquivo.
function wordsOf(ch: ChannelIdentity): Set<string> {
  return new Set(nameTokens(familySourceName(ch)))
}

const hasAnyWord = (words: ReadonlySet<string>, wanted: ReadonlySet<string>) => [...wanted].some((word) => words.has(word))

// Bateria e percussão inteiras. Com algum loop ou virada: havendo kit inteiro, fica só
// ele; sem kit inteiro mas com kit separado (peça sem loop nem virada), saem só o loop
// e a virada, e peças e percussão ficam.
function pickPulse<T extends ChannelIdentity>(percussive: readonly PulseCandidate<T>[]): Candidate<T>[] {
  const words = percussive.map((c) => c.words)
  const isPartial = words.map((w) => hasAnyWord(w, PARTIAL_KIT_WORDS))
  const isPiece = words.map((w) => [...w].some(isDrumPieceToken))
  if (!isPartial.some(Boolean)) return [...percussive]
  const fullKit = percussive.filter((_, i) => hasAnyWord(words[i], FULL_KIT_WORDS) && !isPartial[i] && !isPiece[i])
  if (fullKit.length > 0) return fullKit
  const hasSeparateKit = percussive.some((_, i) => isPiece[i] && !isPartial[i])
  return hasSeparateKit ? percussive.filter((_, i) => !isPartial[i]) : [...percussive]
}

const isEffectPiece = (words: ReadonlySet<string>) => hasAnyWord(words, EFFECT_WORDS) && [...words].some(isDrumPieceToken)

const isSourceFamily = (family: ChannelFamily): family is SourceFamily => family !== 'desconhecido'

// "Bateria", "Bateria e Baixo", "Bateria, Percussão e Baixo": na ordem padrão das famílias.
function sourcesLabel(families: readonly ChannelFamily[]): string {
  const names = [...new Set(families)]
    .filter(isSourceFamily)
    .sort((a, b) => FAMILY_RANK[a] - FAMILY_RANK[b])
    .map((family) => FAMILY_LABEL[family])
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

export function pickTempoSources<T extends ChannelIdentity>(channels: readonly T[]): TempoSources<T> {
  // channelFamily já devolve click ou guia pra canal com esse papel (manual ou pelo nome),
  // então filtrar por família tira Click e Guia de pulso, baixo e harmonia.
  const candidates: Candidate<T>[] = channels.map((ch) => ({ ch, family: channelFamily(ch) }))
  const first = (family: ChannelFamily) => candidates.find((c) => c.family === family)

  const percussive = candidates
    .filter((c) => PULSE_FAMILIES.has(c.family))
    .map((c) => ({ ...c, words: wordsOf(c.ch) }))
    .filter((c) => !isEffectPiece(c.words))
  // Primeiro Baixo; sem ele, primeiro Synth Bass. Sem bateria nem percussão, ele é o pulso.
  const bass = first('baixo') ?? first('synthBass')
  const pulse = percussive.length > 0 ? pickPulse(percussive) : bass ? [bass] : []
  // Canal de efeito ("FX" sozinho é Teclado no mixer) não é acorde: fica fora da harmonia.
  const harmony = candidates.filter((c) => HARMONY_FAMILIES.has(c.family) && !isEffectsChannel(c.ch)).slice(0, HARMONY_MAX)
  const analyzed = bass ? [...pulse, bass] : pulse

  return {
    click: findClickChannel(channels) ?? null,
    pulse: pulse.map((c) => c.ch),
    bass: bass?.ch ?? null,
    harmony: harmony.map((c) => c.ch),
    label: sourcesLabel(analyzed.map((c) => c.family)),
  }
}
