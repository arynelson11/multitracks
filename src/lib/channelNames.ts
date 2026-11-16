// Regra central do nome do canal: limpa o nome do arquivo, reconhece a família
// do instrumento, monta o rótulo organizado (com número quando repete), a cor e
// a ordem padrão. Tudo aqui é puro: sem React, sem IndexedDB, sem Web Audio.
// O nome original (`name`) nunca é alterado; o rótulo é só exibição.
import type { ChannelOrderMode, ChannelRole } from '../types'

export type ChannelFamily =
  | 'click' | 'guia' | 'bateria' | 'percussao' | 'baixo' | 'synthBass' | 'violao' | 'guitarra'
  | 'teclado' | 'piano' | 'pad' | 'ambiencia' | 'vocal' | 'backing' | 'desconhecido'

type KnownFamily = Exclude<ChannelFamily, 'desconhecido'>

// O `Channel` do motor e o `SavedChannel` do repertório cabem aqui.
export interface ChannelIdentity {
  id: string
  name: string
  customName?: string
  role?: ChannelRole
  srcIdx?: number
}

// Rótulo sem o número de repetição.
export interface ChannelRecognition {
  family: ChannelFamily
  label: string
}

export interface ChannelLabel {
  id: string
  // O que aparece na tela: nome do usuário, se houver; senão o automático.
  label: string
  // Rótulo automático, já com o número de repetição quando o canal entra na numeração.
  autoLabel: string
  isCustom: boolean
  family: ChannelFamily
  color: string
  role: ChannelRole
}

export const FAMILY_LABEL: Record<KnownFamily, string> = {
  click: 'Click', guia: 'Guia', backing: 'Backing', synthBass: 'Synth Bass', baixo: 'Baixo',
  violao: 'Violão', guitarra: 'Guitarra', piano: 'Piano', pad: 'Pad', teclado: 'Teclado',
  bateria: 'Bateria', percussao: 'Percussão', vocal: 'Vocal', ambiencia: 'Ambiência',
}

export const FAMILY_COLOR: Record<ChannelFamily, string> = {
  click: '#FF6B35', guia: '#f59e0b', bateria: '#ef4444', percussao: '#f97316', baixo: '#22c55e',
  synthBass: '#16a34a', violao: '#ec4899', guitarra: '#f43f5e', teclado: '#8b5cf6', piano: '#a855f7',
  pad: '#6366f1', ambiencia: '#818cf8', vocal: '#06b6d4', backing: '#0ea5e9', desconhecido: '#9d9da8',
}

export const FAMILY_RANK: Record<ChannelFamily, number> = {
  click: 0, guia: 1, bateria: 2, percussao: 3, baixo: 4, synthBass: 5, violao: 6, guitarra: 7,
  teclado: 8, piano: 9, pad: 10, ambiencia: 10, vocal: 11, backing: 12, desconhecido: 13,
}

// Mesmo limite do nome do usuário (CUSTOM_NAME_MAX em channelRoles.ts): o rótulo
// de nome não reconhecido cabe em até 2 linhas no canal sem ser cortado na tela.
const UNRECOGNIZED_LABEL_MAX = 24

interface FamilyRule {
  family: KnownFamily
  words: ReadonlySet<string>
  // Palavras fracas: só decidem a família quando o resto do nome é número ou marca
  // de andamento ("Beat 01", "Tempo_120bpm"). "Beat Loop" não é Click.
  weakWords: ReadonlySet<string>
  sequences: readonly (readonly string[])[]
  // Peças com rótulo próprio dentro da família (bateria e percussão). Peça que também
  // é palavra fraca só dá o rótulo quando decide a família ("Loop 2" é Loop; "PERC LOOP"
  // continua Percussão Loop).
  pieces?: ReadonlyMap<string, string>
}

const rule = (
  family: KnownFamily,
  words: readonly string[],
  extra: {
    weakWords?: readonly string[]
    sequences?: readonly (readonly string[])[]
    pieces?: Record<string, string>
  } = {},
): FamilyRule => ({
  family,
  words: new Set(words),
  weakWords: new Set(extra.weakWords ?? []),
  sequences: extra.sequences ?? [],
  pieces: extra.pieces ? new Map(Object.entries(extra.pieces)) : undefined,
})

// Ordem de prioridade: vence a primeira família que tiver alguma palavra no nome.
const FAMILY_RULES: readonly FamilyRule[] = [
  // BEAT e TEMPO são fracas: "Beat" e "Tempo 120" são Click; "Ambient Beat Pad" é Pad.
  rule('click', ['CLICK', 'CLICKS', 'CLICKTRACK', 'CLIQUE', 'CLK', 'METRO', 'METRONOMO', 'METRONOME', 'MTR'], {
    weakWords: ['TEMPO', 'BEAT'],
  }),
  rule('guia', ['GUIA', 'GUIAS', 'GUIDE', 'GUIDES', 'CUE', 'CUES']),
  // CORAL e CORAIS: nome comum de coro em pt-BR. BACKVOCAL, BACKVOX e BVOX (grudados),
  // COROS e CHOIRS: grafias que a regra antiga de formantes pegava por pedaço do nome.
  rule('backing', ['BV', 'BVS', 'BGV', 'BGVS', 'BACKING', 'BACKINGS', 'CORO', 'COROS', 'CORAL', 'CORAIS', 'CHOIR', 'CHOIRS',
    'BACKVOCAL', 'BACKVOCALS', 'BACKVOX', 'BVOX'], {
    sequences: [['BACK', 'VOCAL'], ['BACK', 'VOX']],
  }),
  rule('synthBass', ['SUB', 'SUBBASS', 'SYNTHBASS'], {
    sequences: [['SYNTH', 'BASS'], ['SYN', 'BASS'], ['SUB', 'BASS']],
  }),
  rule('baixo', ['BASS', 'BASSES', 'BAIXO', 'BX', 'BAJO']),
  rule('violao', ['AG', 'ACOUSTIC', 'ACUSTICO', 'VIOLAO', 'VIOLOES', 'VL'], {
    sequences: [['AC', 'GTR'], ['AC', 'GUITAR']],
  }),
  rule('guitarra', ['EG', 'GTR', 'GTRS', 'GUITAR', 'GUITARS', 'GUIT', 'GUITARRA', 'GUITARRAS']),
  rule('piano', ['PIANO', 'PIANOS', 'PNO']),
  rule('pad', ['PAD', 'PADS']),
  rule('teclado', ['KEY', 'KEYS', 'KEYBOARD', 'KEYBOARDS', 'TECLADO', 'TECLADOS', 'TECL', 'TEC', 'SYNTH',
    'SYNTHS', 'SYN', 'ORGAN', 'ORGAO', 'RHODES', 'WURLI', 'EP']),
  rule('bateria', ['DRUMS', 'DRUM', 'DRM', 'BATERIA', 'BATERIAS', 'BATERA', 'BAT', 'KIT', 'DRUMSET', 'DRUMKIT'], {
    pieces: {
      KICK: 'Bumbo', BASSDRUM: 'Bumbo', BUMBO: 'Bumbo', SNARE: 'Caixa', CAIXA: 'Caixa',
      HAT: 'Chimbal', HIHAT: 'Chimbal', HH: 'Chimbal', CHIMBAL: 'Chimbal',
      OH: 'Overhead', OVERHEAD: 'Overhead', OVERHEADS: 'Overhead', TOMS: 'Tons',
    },
  }),
  // LOOP é fraca: só é Percussão quando é a única palavra do nome, fora número e
  // andamento ("Loop 2"). "Drum Loop" é Bateria Loop; "Beat Loop" fica não reconhecido.
  rule('percussao', ['PERC', 'PERCS', 'PERCUSSION', 'PERCUSSAO', 'PERCUSSOES', 'CAJON', 'CONGA', 'CONGAS'], {
    weakWords: ['LOOP', 'LOOPS'],
    pieces: { SHAKER: 'Shaker', LOOP: 'Loop', LOOPS: 'Loop' },
  }),
  // LEADVOCAL, LEADVOX (grudados) e VOCALISTA: grafias que a regra antiga de formantes pegava.
  rule('vocal', ['VOX', 'VOCAL', 'VOCALS', 'VOCAIS', 'VOC', 'VOZ', 'VOZES', 'VOICE', 'LEAD', 'LV', 'LEADVOCAL', 'LEADVOX', 'VOCALISTA']),
  rule('ambiencia', ['AMB', 'AMBIENCE', 'AMBIENT', 'AMBIENCIA']),
]

const ROLE_FAMILIES: ReadonlySet<ChannelFamily> = new Set(['click', 'guia'])

// Complemento do rótulo. Vence o "é palavra de outra família" (GTR AMB = Guitarra Ambiente).
const COMPLEMENT = new Map(Object.entries({
  BASE: 'Base', BASES: 'Base', RHYTHM: 'Base', RITMO: 'Base', RIT: 'Base',
  DEDIL: 'Dedilhado', DEDILHADO: 'Dedilhado', DED: 'Dedilhado',
  ARP: 'Arpejo', ARPEJO: 'Arpejo', ARPEGGIO: 'Arpejo',
  SOLO: 'Solo', LEAD: 'Solo',
  AMB: 'Ambiente', AMBIENT: 'Ambiente', AMBIENCE: 'Ambiente', AMBIENTE: 'Ambiente',
  REVERSE: 'Reverso',
  LOOP: 'Loop', LOOPS: 'Loop',
  FX: 'FX',
  DOUBLE: 'Dobra', DBL: 'Dobra', DOBRA: 'Dobra',
  L: 'L', LEFT: 'L', ESQ: 'L',
  R: 'R', RIGHT: 'R', DIR: 'R',
}))
const COMPLEMENT_MAX = 2

const AUDIO_EXTENSION = /\.(?:wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus|caf)$/i
// "drums copy", "drums - Copy 2", "drums (cópia)", "drums (Copy 2)", "drums (1)".
const COPY_SUFFIX = /(?:[\s_-]*\(\s*(?:copy|cópia)(?:[\s_-]*\d+)?\s*\)|(?:^|[\s_-]+)(?:copy|cópia)(?:[\s_-]*\d+)?|\s*\(\d{1,3}\))$/iu
// Um só sufixo de exportação: "DRUMS_1" vira "DRUMS", "Stage_1_2" vira "Stage_1".
const EXPORT_SUFFIX = /[_-]\d{1,3}$/

// Passo 1 da limpeza: extensão, sufixo de cópia e um sufixo de exportação.
// Nome ausente (ZIP, repertório ou stem vindo sem `name`) vira vazio e o rótulo cai em "Canal".
function stripFileName(raw: string): string {
  const text = typeof raw === 'string' ? raw : ''
  let name = text.normalize('NFC').trim().replace(AUDIO_EXTENSION, '').trim()
  for (let previous = ''; previous !== name;) {
    previous = name
    name = name.replace(COPY_SUFFIX, '').trim()
  }
  return name.replace(EXPORT_SUFFIX, '').trim()
}

// Virada de minúscula pra maiúscula (camelCase): "ClickTrack" quebra em Click e Track.
// Sigla toda em maiúscula ("GTR", "BVS") não tem virada e não quebra.
const CAMEL_CASE_TURN = /(\p{Ll})(\p{Lu})/gu

// Compostos que viram um token só antes do casamento: "BASS DRUM(S)" é o bumbo da
// bateria, não o baixo; e palavras de família que o corte camelCase separa
// ("OverHead", "TeCL") voltam a ser uma palavra só.
const COMPOUNDS: readonly { parts: readonly string[]; token: string }[] = [
  { parts: ['BASS', 'DRUM'], token: 'BASSDRUM' },
  { parts: ['BASS', 'DRUMS'], token: 'BASSDRUM' },
  { parts: ['OVER', 'HEAD'], token: 'OVERHEAD' },
  { parts: ['OVER', 'HEADS'], token: 'OVERHEADS' },
  { parts: ['TE', 'CL'], token: 'TECL' },
]

function mergeCompounds(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length;) {
    const compound = COMPOUNDS.find(({ parts }) => parts.every((part, k) => tokens[i + k] === part))
    if (compound) {
      out.push(compound.token)
      i += compound.parts.length
    } else {
      out.push(tokens[i])
      i += 1
    }
  }
  return out
}

// camelCase quebrado, sem acento, caixa alta, letras separadas de números ("GTR1" vira GTR e 1).
function tokenize(cleaned: string): string[] {
  const tokens = cleaned.replace(CAMEL_CASE_TURN, '$1 $2').normalize('NFD').replace(/\p{M}/gu, '')
    .toUpperCase().match(/\p{L}+|\p{N}+/gu) ?? []
  return mergeCompounds(tokens)
}

// As palavras que o reconhecimento enxerga no nome, em minúsculas: mesma limpeza do
// arquivo e mesmo corte ("Batería_Loop 2.wav" vira bateria, loop e 2). Pra quem precisa
// olhar palavra inteira do nome sem `includes` em pedaço de texto.
export function nameTokens(raw: string): string[] {
  return tokenize(stripFileName(raw)).map((token) => token.toLowerCase())
}

// Marca de andamento: número ("01", "120") ou BPM ("120bpm" vira 120 e BPM).
const TEMPO_MARKS: ReadonlySet<string> = new Set(['BPM'])
const isTempoMark = (token: string) => /^\p{N}+$/u.test(token) || TEMPO_MARKS.has(token)

// Palavra fraca só conta quando todo o resto do nome é marca de andamento.
function weakHits(tokens: readonly string[], familyRule: FamilyRule): Set<number> {
  const hits = new Set<number>()
  tokens.forEach((token, i) => {
    if (familyRule.weakWords.has(token)) hits.add(i)
  })
  if (hits.size === 0 || !tokens.every((token, i) => hits.has(i) || isTempoMark(token))) return new Set()
  return hits
}

// Índices dos tokens que casaram a família (palavra inteira, sequência de palavras
// ou palavra fraca com o resto em número/andamento).
function familyHits(tokens: readonly string[], familyRule: FamilyRule): Set<number> {
  const hits = weakHits(tokens, familyRule)
  tokens.forEach((token, i) => {
    const isStrongPiece = familyRule.pieces?.has(token) && !familyRule.weakWords.has(token)
    if (familyRule.words.has(token) || isStrongPiece) hits.add(i)
  })
  for (const sequence of familyRule.sequences) {
    for (let start = 0; start + sequence.length <= tokens.length; start++) {
      if (sequence.every((word, k) => tokens[start + k] === word)) {
        sequence.forEach((_, k) => hits.add(start + k))
      }
    }
  }
  return hits
}

// Vence a primeira família, na ordem de prioridade, que casar algum token. Com a
// palavra fraca exigindo o resto em número/andamento, ela nunca disputa com outra família.
function matchFamily(raw: string, ignoreRoleFamilies: boolean) {
  const tokens = tokenize(stripFileName(raw))
  for (const familyRule of FAMILY_RULES) {
    if (ignoreRoleFamilies && ROLE_FAMILIES.has(familyRule.family)) continue
    const hits = familyHits(tokens, familyRule)
    if (hits.size > 0) return { familyRule, tokens, hits }
  }
  return undefined
}

// A peça vence o genérico: "KICK DRUM" vira Bumbo. Só conta peça que casou a família.
function familyBaseLabel(familyRule: FamilyRule, tokens: readonly string[], hits: ReadonlySet<number>): string {
  for (const [i, token] of tokens.entries()) {
    const piece = hits.has(i) ? familyRule.pieces?.get(token) : undefined
    if (piece) return piece
  }
  return FAMILY_LABEL[familyRule.family]
}

function complementOf(tokens: readonly string[], hits: ReadonlySet<number>): string[] {
  const out: string[] = []
  tokens.forEach((token, i) => {
    if (out.length >= COMPLEMENT_MAX || hits.has(i)) return
    const word = COMPLEMENT.get(token)
    if (word && !out.includes(word)) out.push(word)
  })
  return out
}

// Toda em maiúscula com 3 letras ou mais, ou toda em minúscula, vira Capitalizada.
// Palavras mistas e siglas de até 2 letras ficam como estão.
function capitalizeWord(word: string): string {
  const letters = word.match(/\p{L}/gu)?.length ?? 0
  const upper = word.toLocaleUpperCase('pt-BR')
  const lower = word.toLocaleLowerCase('pt-BR')
  const isAllUpper = word === upper && word !== lower
  const isAllLower = word === lower && word !== upper
  if (!((isAllUpper && letters >= 3) || isAllLower)) return word
  return lower.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_, lead: string, first: string) => lead + first.toLocaleUpperCase('pt-BR'))
}

// Junta palavras inteiras até o limite. A primeira entra sempre, mesmo maior que
// o limite: nunca corta no meio da palavra e nunca fica vazio.
function fitWholeWords(words: readonly string[], max: number): string {
  let out = words[0] ?? ''
  for (const word of words.slice(1)) {
    if (out.length + 1 + word.length > max) break
    out += ` ${word}`
  }
  return out
}

// Quebras de palavra do rótulo, além do espaço: `_`, `-`, `.` e a virada camelCase
// (CAMEL_CASE_TURN). Sigla toda em maiúscula não quebra; `/` fica como está ("Outros/Fx").
const LABEL_SEPARATOR = /[_.-]/g

// Rótulo de nome não reconhecido: "MASTER_1" vira Master, "Track 5" continua Track 5,
// "Intro-Loop" e "IntroLoop" viram Intro Loop.
export function cleanChannelName(raw: string): string {
  const words = stripFileName(raw)
    .replace(LABEL_SEPARATOR, ' ')
    .replace(CAMEL_CASE_TURN, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeWord)
  return fitWholeWords(words, UNRECOGNIZED_LABEL_MAX) || 'Canal'
}

// Sem ignoreRoleFamilies, segue o mesmo papel do roleFromName (com o teste antigo de
// Click e Guia): "vozguia bass" é Guia aqui também, não Baixo. Com ignoreRoleFamilies
// (rótulo e família de canal Normal) fica só o instrumento.
export function recognizeChannel(raw: string, opts: { ignoreRoleFamilies?: boolean } = {}): ChannelRecognition {
  const ignoreRoleFamilies = opts.ignoreRoleFamilies ?? false
  const match = matchFamily(raw, ignoreRoleFamilies)
  if (!ignoreRoleFamilies && !(match && ROLE_FAMILIES.has(match.familyRule.family))) {
    const legacy = legacyRoleFromName(raw)
    if (legacy === 'click') return { family: 'click', label: FAMILY_LABEL.click }
    if (legacy === 'guide') return { family: 'guia', label: FAMILY_LABEL.guia }
  }
  if (!match) return { family: 'desconhecido', label: cleanChannelName(raw) }
  const { familyRule, tokens, hits } = match
  const base = familyBaseLabel(familyRule, tokens, hits)
  // Click e Guia nunca têm complemento.
  const extra = ROLE_FAMILIES.has(familyRule.family) ? [] : complementOf(tokens, hits)
  return { family: familyRule.family, label: [base, ...extra].join(' ') }
}

// Detector antigo (produção até a v1.4.9): `includes` de click, metronomo, guia ou guide.
// O papel automático nunca é mais estreito que ele, senão a guia ou o click de uma
// música já salva vão pra PA. Vale no nome sem acento, em caixa alta e sem nada além
// de A-Z e 0-9, mesmo que outra palavra case outra família ("vozguia bass" é Guia).
// Só promove: quando a palavra já reconhece Click ou Guia, ela decide entre os dois
// ("MTR Guia" é Click). BEAT e TEMPO não entram aqui: seguem as regras de palavra fraca.
const LEGACY_CLICK = /CLICK|METRONOM/
const LEGACY_GUIDE = /GUIA|GUIDE/

function legacyRoleFromName(raw: string): ChannelRole | undefined {
  const compact = stripFileName(raw).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (LEGACY_CLICK.test(compact)) return 'click'
  if (LEGACY_GUIDE.test(compact)) return 'guide'
  return undefined
}

// Papel pela palavra inteira, sem o teste antigo.
function roleFromWords(raw: string): ChannelRole {
  const family = matchFamily(raw, false)?.familyRule.family
  if (family === 'click') return 'click'
  if (family === 'guia') return 'guide'
  return 'normal'
}

// Papel automático pelo nome do arquivo: a palavra e, se ela não der Click nem Guia,
// o teste antigo. O papel manual (`role`) é decidido antes, em resolveChannelRole.
export function roleFromName(raw: string): ChannelRole {
  const fromWords = roleFromWords(raw)
  if (fromWords !== 'normal') return fromWords
  return legacyRoleFromName(raw) ?? 'normal'
}

function hasCustomName(ch: ChannelIdentity): ch is ChannelIdentity & { customName: string } {
  return typeof ch.customName === 'string' && ch.customName.trim() !== ''
}

// Manual vence; renomear não tira o papel que veio do nome original. Ordem: palavra
// no nome do arquivo, palavra no nome do usuário e, só então, o teste antigo no nome
// do ARQUIVO. O teste antigo existe pras músicas já salvas; no nome digitado ele
// tiraria da PA um "Violão Aguiar" ou um "Teclado guiado".
export function resolveChannelRole(ch: ChannelIdentity): ChannelRole {
  if (ch.role) return ch.role
  const fromName = roleFromWords(ch.name)
  if (fromName !== 'normal') return fromName
  if (hasCustomName(ch)) {
    const fromCustom = roleFromWords(ch.customName)
    if (fromCustom !== 'normal') return fromCustom
  }
  return legacyRoleFromName(ch.name) ?? 'normal'
}

export function channelFamily(ch: ChannelIdentity): ChannelFamily {
  const role = resolveChannelRole(ch)
  if (role === 'click') return 'click'
  if (role === 'guide') return 'guia'
  if (hasCustomName(ch)) {
    const fromCustom = recognizeChannel(ch.customName, { ignoreRoleFamilies: true }).family
    if (fromCustom !== 'desconhecido') return fromCustom
  }
  return recognizeChannel(ch.name, { ignoreRoleFamilies: true }).family
}

const ORIGINAL_NAME_ORDER = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function compareSrcIdx(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a - b
}

// Ordem da numeração: nome original natural, depois srcIdx, depois id. Não depende da posição na lista.
function compareForNumbering(a: ChannelIdentity, b: ChannelIdentity): number {
  return ORIGINAL_NAME_ORDER.compare(a.name, b.name)
    || compareSrcIdx(a.srcIdx, b.srcIdx)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// Mesma ordem da entrada.
export function buildChannelLabels(channels: readonly ChannelIdentity[]): ChannelLabel[] {
  const items = channels.map((ch) => {
    const role = resolveChannelRole(ch)
    const auto = role === 'click' ? FAMILY_LABEL.click
      : role === 'guide' ? FAMILY_LABEL.guia
        : recognizeChannel(ch.name, { ignoreRoleFamilies: true }).label
    return { ch, role, auto, customName: hasCustomName(ch) ? ch.customName : undefined }
  })

  // Só canais sem nome do usuário entram na numeração.
  const groups = new Map<string, typeof items>()
  for (const item of items) {
    if (item.customName !== undefined) continue
    const key = item.auto.toLocaleLowerCase('pt-BR')
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  const numbered = new Map<(typeof items)[number], string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => compareForNumbering(a.ch, b.ch))
    ordered.forEach((item, i) => numbered.set(item, `${item.auto} ${i + 1}`))
  }

  return items.map((item) => {
    const autoLabel = numbered.get(item) ?? item.auto
    const family = channelFamily(item.ch)
    return {
      id: item.ch.id,
      label: item.customName ?? autoLabel,
      autoLabel,
      isCustom: item.customName !== undefined,
      family,
      color: FAMILY_COLOR[family],
      role: item.role,
    }
  })
}

// Estável e sem mutar a entrada: mesma família mantém a ordem original.
export function sortChannelsByDefault<T extends ChannelIdentity>(channels: readonly T[]): T[] {
  return channels
    .map((ch, index) => ({ ch, index, rank: FAMILY_RANK[channelFamily(ch)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.ch)
}

// 'manual' mantém a ordem do usuário; automático (ou ausente) aplica a ordem padrão.
export function arrangeChannels<T extends ChannelIdentity>(channels: readonly T[], mode: ChannelOrderMode | undefined): T[] {
  return mode === 'manual' ? [...channels] : sortChannelsByDefault(channels)
}
