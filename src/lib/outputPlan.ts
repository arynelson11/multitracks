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

/** Padrão (R-23): Click e Guia separados, ouvido na saída 1; com 4 ou mais, VS em 1/2, Click na 3, Guia na 4. */
export const DEFAULT_OUTPUTS: OutputSettings = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }

const copyOutputs = (s: OutputSettings): OutputSettings => ({ mode: s.mode, earOnSecond: s.earOnSecond, multi: { ...s.multi } })

/** Canais do aparelho: valor não finito ou menor que 2 conta como 2; placa grande para no teto. */
function deviceChannels(maxChannelCount: number): number {
  const n = Number.isFinite(maxChannelCount) ? Math.floor(maxChannelCount) : 2
  return Math.min(Math.max(n, 2), MAX_OUTPUTS)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isOutput = (o: unknown, channels: number): o is number => Number.isInteger(o) && (o as number) >= 0 && (o as number) < channels

/**
 * Mapa de "4 ou mais" que cabe em `channels` saídas: VS num par que começa em índice par
 * (saídas 1/2, 3/4...), Click e Guia em saídas da placa fora desse par. Click e Guia podem dividir
 * a mesma saída ("os dois juntos", spec 5e).
 */
function mapFits(m: OutputMap, channels: number): boolean {
  if (!isOutput(m.vsPair, channels) || m.vsPair % 2 !== 0 || !isOutput(m.vsPair + 1, channels)) return false
  const outsidePair = (o: number) => isOutput(o, channels) && o !== m.vsPair && o !== m.vsPair + 1
  return outsidePair(m.click) && outsidePair(m.guide)
}

function splitPlan(earOnSecond: boolean, fellBackFrom: OutputMode | null): OutputPlan {
  const ear = earOnSecond ? 1 : 0
  return { mode: 'split2', channels: 2, vs: [1 - ear], click: [ear], guide: [ear], panByRole: true, fellBackFrom }
}

/**
 * Plano do modo escolhido no aparelho de agora. "Tudo junto" e "Click e Guia separados" usam
 * 2 canais em qualquer placa. "4 ou mais" com placa menor cai em separados com o ouvido na
 * saída 1 e avisa por `fellBackFrom`; com mapa que não cabe, usa o padrão VS 1/2, Click 3, Guia 4.
 */
export function planOutputs(s: OutputSettings, maxChannelCount: number): OutputPlan {
  if (s.mode === 'stereo') return { mode: 'stereo', channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false, fellBackFrom: null }
  if (s.mode !== 'multi') return splitPlan(s.earOnSecond === true, null)

  const channels = deviceChannels(maxChannelCount)
  if (channels < 4) return splitPlan(false, 'multi')
  const m = [s.multi, DEFAULT_OUTPUTS.multi].find((candidate) => isRecord(candidate) && mapFits(candidate, channels))
  if (!m) return splitPlan(false, 'multi')
  return { mode: 'multi', channels, vs: [m.vsPair, m.vsPair + 1], click: [m.click], guide: [m.guide], panByRole: true, fellBackFrom: null }
}

/** Lado do panner que leva o som inteiro pra saída: -1 na saída 1 (esquerda), +1 na saída 2 (direita). */
const sideOf = (output: number | undefined): number => (output === 1 ? 1 : -1)

/**
 * Pan que o motor põe no `StereoPannerNode` do canal (R-24). "Tudo junto" usa o knob. Em
 * "Click e Guia separados" o papel decide o lado e o knob não vale: pan ±1 põe a faixa mono
 * inteira (ou a estéreo como L+R) de um lado e deixa o outro em silêncio, o mesmo nível do
 * pan automático da v1.4.15. Em "4 ou mais", Click e Guia vão inteiros pro lado esquerdo (o
 * roteador leva só esse lado pra saída própria) e a VS usa o knob. Knob inválido vira 0 e
 * fora da faixa fica em ±1, pra nunca chegar valor estranho no panner.
 */
export function effectivePan(pan: number, role: ChannelRole, plan: OutputPlan): number {
  if (plan.mode === 'split2') return sideOf(role === 'click' ? plan.click[0] : role === 'guide' ? plan.guide[0] : plan.vs[0])
  if (plan.mode === 'multi' && (role === 'click' || role === 'guide')) return -1
  return Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0
}

/**
 * Configuração de saídas lida do aparelho. Nulo sem um modo conhecido. Com o modo certo e o
 * resto estragado, guarda o modo (é a escolha que importa pra não mandar click pra PA) e
 * completa com o padrão: lado do ouvido na saída 1 e, se o mapa de "4 ou mais" não vale em
 * placa nenhuma, o mapa padrão. Um mapa escolhido numa placa maior fica guardado mesmo que
 * não caiba na de agora: quem decide na hora é o `planOutputs`.
 */
export function sanitizeOutputs(raw: unknown): OutputSettings | null {
  if (!isRecord(raw) || !MODES.includes(raw.mode as OutputMode)) return null
  const m = raw.multi
  const map: OutputMap | null = isRecord(m) ? { vsPair: m.vsPair as number, click: m.click as number, guide: m.guide as number } : null
  return {
    mode: raw.mode as OutputMode,
    earOnSecond: raw.earOnSecond === true,
    multi: map && mapFits(map, MAX_OUTPUTS) ? map : { ...DEFAULT_OUTPUTS.multi },
  }
}

/**
 * Primeira carga com o plano de saídas (R-23). Saídas já gravadas e válidas vencem, sem
 * mexer em pan nenhum (o interruptor do pan automático fica como está). Sem elas, quem tinha
 * o pan automático desligado fica em "Tudo junto"; qualquer outro valor (ligado era o padrão)
 * passa pra "Click e Guia separados", desliga o pan automático e pede pra zerar uma vez os
 * pans ±1 que ele gravou nos canais.
 */
export function migrateOutputs(stored: { autoPan?: unknown; outputs?: unknown }): { outputs: OutputSettings; autoPan: boolean; resetLegacyPans: boolean } {
  const saved = sanitizeOutputs(stored.outputs)
  if (saved) return { outputs: saved, autoPan: stored.autoPan === true, resetLegacyPans: false }
  if (stored.autoPan === false) return { outputs: { ...copyOutputs(DEFAULT_OUTPUTS), mode: 'stereo' }, autoPan: false, resetLegacyPans: false }
  return { outputs: copyOutputs(DEFAULT_OUTPUTS), autoPan: false, resetLegacyPans: true }
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
  if (plan.mode === 'stereo') return 'Tudo junto nas saídas 1 e 2'
  if (plan.mode === 'split2') return `Click e Guia na saída ${n(plan.click[0])} · VS na saída ${n(plan.vs[0])}`
  const vs = `VS nas saídas ${n(plan.vs[0])} e ${n(plan.vs[1])}`
  if (plan.click[0] === plan.guide[0]) return `${vs} · Click e Guia na ${n(plan.click[0])}`
  return `${vs} · Click na ${n(plan.click[0])} · Guia na ${n(plan.guide[0])}`
}
