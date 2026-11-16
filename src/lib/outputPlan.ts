// Plano de saídas de áudio (spec 5e, R-23, R-24): por qual saída da placa sai a VS, o Click e
// a Guia, e o pan que o motor põe no panner de cada canal pelo papel dele. Só contas puras:
// o roteador (T12) liga os nós, o motor (T25) aplica o pan e as Configurações (T19) mostram o
// resumo. Saídas com índice 0 aqui dentro; o texto pro operador conta a partir de 1.
import type { ChannelRole } from '../types'
import type { OutputMode, OutputPlan, OutputSettings } from './stageContracts'

/** Teto de saídas que o app usa numa placa só (o `ChannelMerger` e o destino ficam nesse tamanho). */
const MAX_OUTPUTS = 32
const MODES: readonly OutputMode[] = ['stereo', 'split2', 'multi']

type OutputMap = OutputSettings['multi']

/**
 * Aviso âmbar das saídas (as Configurações da T19 mostram o texto de `OUTPUT_WARNING_TEXT`).
 * Os três primeiros vêm do plano (`planOutputs`, placa de agora); `modo-assumido`,
 * `lado-assumido` e também `mapa-ajustado` vêm da leitura do que estava gravado (`migrateOutputs`).
 */
export type OutputWarning = 'poucos-canais' | 'sem-saida-ouvido' | 'mapa-ajustado' | 'modo-assumido' | 'lado-assumido'

export const OUTPUT_WARNING_TEXT: Record<OutputWarning, string> = {
  'poucos-canais': 'Esta placa tem menos de 4 canais. O mapa de 4 ou mais saídas fica guardado pra quando a placa maior voltar.',
  'sem-saida-ouvido': 'Click e Guia sem saída: as saídas 1 e 2 são da VS e esta placa não tem outra. Ligue a placa de 4 ou mais canais ou escolha outro modo.',
  'mapa-ajustado': 'Parte do mapa salvo não vale nesta placa: as saídas foram ajustadas, com Click e Guia fora da VS. Confira o resumo.',
  'modo-assumido': 'Não deu pra ler o modo de saída gravado. Usando Click e Guia separados: confira o resumo e o lado do ouvido.',
  'lado-assumido': 'Não deu pra ler o lado gravado de Click e Guia. Usando a saída 1 pra eles: confira antes de tocar.',
}

/** Plano com o aviso pra tela. O motor e o roteador usam só os campos de `OutputPlan`. */
export interface PlannedOutputs extends OutputPlan { warning: OutputWarning | null }

/** Configuração de saídas só de leitura, inclusive o mapa. */
export type ReadonlyOutputSettings = Readonly<Omit<OutputSettings, 'multi'>> & { readonly multi: Readonly<OutputMap> }

/**
 * Padrão (R-23): Click e Guia separados, ouvido na saída 1; com 4 ou mais, VS em 1/2, Click
 * na 3, Guia na 4. Só de leitura no tipo; quem precisa de um objeto pra mexer usa as cópias
 * que `migrateOutputs` e `sanitizeOutputs` devolvem.
 */
export const DEFAULT_OUTPUTS: ReadonlyOutputSettings = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }

const copyOutputs = (s: ReadonlyOutputSettings): OutputSettings => ({ mode: s.mode, earOnSecond: s.earOnSecond, multi: { ...s.multi } })

/** Canais do aparelho: valor não finito ou menor que 2 conta como 2; placa grande para no teto. */
function deviceChannels(maxChannelCount: number): number {
  const n = Number.isFinite(maxChannelCount) ? Math.floor(maxChannelCount) : 2
  return Math.min(Math.max(n, 2), MAX_OUTPUTS)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Saída gravada num campo do mapa: inteiro de 0 a 31, ou texto só com dígitos (valor de select). */
function readOutput(v: unknown): number | null {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < MAX_OUTPUTS ? n : null
}

/** O que dá pra ler do mapa gravado, campo a campo; nulo no campo ilegível. O par da VS começa em índice par. */
interface ReadMap { vsPair: number | null; click: number | null; guide: number | null }
function readMap(raw: unknown): ReadMap {
  if (!isRecord(raw)) return { vsPair: null, click: null, guide: null }
  const vsPair = readOutput(raw.vsPair)
  return { vsPair: vsPair !== null && vsPair % 2 === 0 ? vsPair : null, click: readOutput(raw.click), guide: readOutput(raw.guide) }
}

/**
 * Par da VS numa placa de `channels` saídas: o gravado, se cabe; senão o primeiro par (de
 * preferência 1/2) que não pega as saídas legíveis de Click e Guia, pra não jogar a VS no
 * fone de quem já está cabeado.
 */
function choosePair(read: ReadMap, channels: number): number {
  if (read.vsPair !== null && read.vsPair + 1 < channels) return read.vsPair
  const ear = [read.click, read.guide]
  for (let p = 0; p + 1 < channels; p += 2) if (!ear.includes(p) && !ear.includes(p + 1)) return p
  return DEFAULT_OUTPUTS.multi.vsPair
}

/**
 * Mapa que vale na placa. Click e Guia NUNCA usam o par da VS: nem o de agora nem o par
 * gravado (é onde a PA está cabeada). Campo legível e livre fica; campo ilegível, fora da
 * placa ou no par da VS vai pra uma saída livre (primeiro a do padrão, depois a mais baixa,
 * evitando a do outro). Sem saída livre, fica sem saída (nulo). `changed` avisa a tela.
 */
function resolveMap(read: ReadMap, channels: number): { vsPair: number; click: number | null; guide: number | null; changed: boolean } {
  const vsPair = choosePair(read, channels)
  const blocked = [vsPair, vsPair + 1]
  if (read.vsPair !== null) blocked.push(read.vsPair, read.vsPair + 1)
  const free = Array.from({ length: channels }, (_, i) => i).filter((o) => !blocked.includes(o))
  const keep = (o: number | null) => (o !== null && free.includes(o) ? o : null)
  const fill = (preferred: number, other: number | null): number | null => {
    const order = [preferred, ...free].filter((o) => free.includes(o))
    return order.find((o) => o !== other) ?? order[0] ?? null
  }
  let click = keep(read.click)
  let guide = keep(read.guide)
  if (click === null) click = fill(DEFAULT_OUTPUTS.multi.click, guide)
  if (guide === null) guide = fill(DEFAULT_OUTPUTS.multi.guide, click)
  return { vsPair, click, guide, changed: vsPair !== read.vsPair || click !== read.click || guide !== read.guide }
}

const outputList = (o: number | null): number[] => (o === null ? [] : [o])

function splitPlan(earOnSecond: boolean, fellBackFrom: OutputMode | null, warning: OutputWarning | null): PlannedOutputs {
  const ear = earOnSecond ? 1 : 0
  return { mode: 'split2', channels: 2, vs: [1 - ear], click: [ear], guide: [ear], panByRole: true, fellBackFrom, warning }
}

/**
 * Plano do modo escolhido no aparelho de agora. "Tudo junto" e "Click e Guia separados" usam
 * 2 canais em qualquer placa. "4 ou mais" usa o mapa gravado quando ele cabe; senão corrige
 * campo a campo (Click e Guia nunca no par da VS) e avisa. Com menos de 4 canais: se a VS
 * gravada não usa as saídas 1 e 2, cai em separados com o ouvido na saída 1; se usa, a VS
 * fica nelas e Click e Guia vão pro que sobrar (numa placa de 2 canais, sem saída). Não mexe
 * em `s` e devolve sempre listas novas.
 */
export function planOutputs(s: ReadonlyOutputSettings, maxChannelCount: number): PlannedOutputs {
  if (s.mode === 'stereo') return { mode: 'stereo', channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false, fellBackFrom: null, warning: null }
  if (s.mode !== 'multi') return splitPlan(s.earOnSecond === true, null, null)

  const channels = deviceChannels(maxChannelCount)
  const read = readMap(s.multi)
  if (channels < 4 && choosePair(read, MAX_OUTPUTS) >= 2) return splitPlan(false, 'multi', 'poucos-canais')
  const m = resolveMap(read, channels)
  const warning: OutputWarning | null = m.click === null || m.guide === null ? 'sem-saida-ouvido' : channels < 4 ? 'poucos-canais' : m.changed ? 'mapa-ajustado' : null
  return {
    mode: 'multi', channels, vs: [m.vsPair, m.vsPair + 1], click: outputList(m.click), guide: outputList(m.guide), panByRole: true,
    fellBackFrom: channels < 4 ? 'multi' : null, warning,
  }
}

/** Lado do panner que leva o som inteiro pra saída: -1 na saída 1 (esquerda), +1 na saída 2 (direita). */
const sideOf = (output: number | undefined): number => (output === 1 ? 1 : -1)

/**
 * Pan que o motor põe no `StereoPannerNode` do canal (R-24). "Tudo junto" usa o knob. Em
 * "Click e Guia separados" o papel decide o lado e o knob não vale: pan ±1 põe a faixa mono
 * inteira (ou a estéreo como L+R) de um lado, o mesmo nível do pan automático da v1.4.15. O
 * outro lado só fica em silêncio exato em -1; em +1 sobra um resto numérico inaudível
 * (cos(π/2) vezes o sinal: perto de 6e-17 no Chromium e 4e-8 no Gecko, abaixo de -140 dB),
 * igual à v1.4.15. Por isso a T30 (cenário SPLIT) e todo teste de sinal com o lado trocado
 * medem esse lado com limiar (ex.: abaixo de 1e-6), nunca com igual a 0. Em "4 ou mais",
 * Click e Guia vão inteiros pro lado esquerdo (-1, silêncio exato no direito; o roteador leva
 * só o esquerdo pra saída própria) e a VS usa o knob. Knob inválido vira 0 e fora da faixa
 * fica em ±1, pra nunca chegar valor estranho no panner.
 */
export function effectivePan(pan: number, role: ChannelRole, plan: OutputPlan): number {
  if (plan.mode === 'split2') return sideOf(role === 'click' ? plan.click[0] : role === 'guide' ? plan.guide[0] : plan.vs[0])
  if (plan.mode === 'multi' && (role === 'click' || role === 'guide')) return -1
  return Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0
}

/**
 * Chave própria do aparelho (localStorage, fora de `mt_app_settings`) com o marcador "já
 * migrado" (Ruling T6-1). A T25 grava `OUTPUTS_MIGRATED_VALUE` nela na primeira carga e passa
 * `outputsMigrated: localStorage.getItem(OUTPUTS_MIGRATED_KEY) === OUTPUTS_MIGRATED_VALUE`.
 * Chave própria pra um `mt_app_settings` que não abre não disparar um segundo reset de pans.
 */
export const OUTPUTS_MIGRATED_KEY = 'mt_outputs_migrated'
export const OUTPUTS_MIGRATED_VALUE = '1'

/**
 * Configuração de saídas lida do aparelho. Sem um modo conhecido é nula, a não ser depois da
 * migração (`migrated: true`): aí vira "Click e Guia separados", nunca "Tudo junto" (Ruling
 * T6-1), porque o modo ilegível não pode mandar click pra PA. Com o modo certo e o resto
 * estragado, guarda o modo e completa: lado do ouvido na saída 1; mapa de "4 ou mais"
 * corrigido campo a campo (texto de select vira número; Click e Guia nunca no par da VS).
 * Um mapa escolhido numa placa maior fica guardado mesmo que não caiba na de agora: quem
 * decide na hora é o `planOutputs`.
 */
export function sanitizeOutputs(raw: unknown, opts: { migrated: true }): OutputSettings
export function sanitizeOutputs(raw: unknown, opts?: { migrated?: boolean }): OutputSettings | null
export function sanitizeOutputs(raw: unknown, opts: { migrated?: boolean } = {}): OutputSettings | null {
  return readOutputs(raw, opts.migrated === true).outputs
}

/**
 * Leitura com os avisos do que precisou ser assumido: modo (só depois da migração), lado do
 * ouvido estragado quando o modo é separados (vale agora; nos outros modos ele não decide
 * nada) e mapa de "4 ou mais" corrigido quando o modo é esse.
 */
function readOutputs(raw: unknown, migrated: boolean): { outputs: OutputSettings | null; warnings: OutputWarning[] } {
  const rec = isRecord(raw) ? raw : {}
  const known = MODES.includes(rec.mode as OutputMode)
  if (!known && !migrated) return { outputs: null, warnings: [] }
  const mode: OutputMode = known ? (rec.mode as OutputMode) : 'split2'
  const m = resolveMap(readMap(rec.multi), MAX_OUTPUTS)
  const multi: OutputMap = { vsPair: m.vsPair, click: m.click ?? DEFAULT_OUTPUTS.multi.click, guide: m.guide ?? DEFAULT_OUTPUTS.multi.guide }
  const warnings: OutputWarning[] = []
  if (!known) warnings.push('modo-assumido')
  else if (mode === 'split2' && typeof rec.earOnSecond !== 'boolean') warnings.push('lado-assumido')
  if (mode === 'multi' && m.changed) warnings.push('mapa-ajustado')
  return { outputs: { mode, earOnSecond: rec.earOnSecond === true, multi }, warnings }
}

/** Resultado da carga das saídas; `warnings` são os avisos âmbar da leitura (a T25 guarda, a T19 mostra). */
export interface MigratedOutputs { outputs: OutputSettings; autoPan: boolean; resetLegacyPans: boolean; warnings: OutputWarning[] }

/**
 * Carga das saídas (R-23). Saídas já gravadas e válidas vencem, sem mexer em pan nenhum (o
 * interruptor do pan automático fica como está). Com o marcador "já migrado"
 * (`outputsMigrated`, só `true` conta) nunca zera pans nem cai em "Tudo junto": modo
 * ilegível vira "Click e Guia separados" (Ruling T6-1). Sem marcador e sem saídas válidas é a
 * primeira carga: quem tinha o pan automático desligado fica em "Tudo junto"; qualquer outro
 * valor (ligado era o padrão) passa pra "Click e Guia separados", desliga o pan automático e
 * pede pra zerar uma vez os pans ±1 que ele gravou nos canais. O que precisou ser assumido na
 * leitura volta em `warnings`. A T25 chama com o JSON cru do aparelho, nunca com o objeto já
 * mesclado com os padrões.
 */
export function migrateOutputs(stored: { autoPan?: unknown; outputs?: unknown; outputsMigrated?: unknown }): MigratedOutputs {
  const saved = readOutputs(stored.outputs, stored.outputsMigrated === true)
  if (saved.outputs) return { outputs: saved.outputs, autoPan: stored.autoPan === true, resetLegacyPans: false, warnings: saved.warnings }
  if (stored.autoPan === false) return { outputs: { ...copyOutputs(DEFAULT_OUTPUTS), mode: 'stereo' }, autoPan: false, resetLegacyPans: false, warnings: [] }
  return { outputs: copyOutputs(DEFAULT_OUTPUTS), autoPan: false, resetLegacyPans: true, warnings: [] }
}

/** Opções dos seletores de "4 ou mais": pares da VS (1/2, 3/4...) e saídas avulsas pro Click e a Guia. */
export function multiChoices(maxChannelCount: number): { vsPairs: number[]; singles: number[] } {
  const channels = deviceChannels(maxChannelCount)
  const singles = Array.from({ length: channels }, (_, i) => i)
  return { vsPairs: singles.filter((o) => o % 2 === 0 && o + 1 < channels), singles }
}

/** Resumo de uma linha pras Configurações, com as saídas contadas a partir de 1. */
export function outputSummary(plan: OutputPlan): string {
  const n = (output: number | undefined) => String((output ?? 0) + 1)
  const at = (output: number | undefined) => (output === undefined ? 'sem saída' : `na ${n(output)}`)
  if (plan.mode === 'stereo') return 'Tudo junto nas saídas 1 e 2'
  if (plan.mode === 'split2') return `Click e Guia na saída ${n(plan.click[0])} · VS na saída ${n(plan.vs[0])}`
  const vs = `VS nas saídas ${n(plan.vs[0])} e ${n(plan.vs[1])}`
  if (plan.click[0] === plan.guide[0]) return `${vs} · Click e Guia ${at(plan.click[0])}`
  return `${vs} · Click ${at(plan.click[0])} · Guia ${at(plan.guide[0])}`
}
