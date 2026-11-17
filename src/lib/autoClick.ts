// Fluxo único do click automático (Grupo M, M7): escolhe as faixas pela regra central,
// mede a grade com o BPM da música como referência, barra quando não há pulso e diz o que
// o operador precisa conferir. O "Gerar click IA" do Metrônomo e o click que falta no palco
// (T27) usam este mesmo fluxo; nenhum dos dois chama o caminho antigo
// (analyzeBufferAndGenerateClick, o da v1.4.9).
//
// A detecção é síncrona e pesada (até uns 4 s numa música de 5 min com baixo e harmonia):
// quem chama nunca roda com a música tocando no thread principal (Rulings M2-4 e M2-8).
import type { ChannelRole } from '../types'
import { generateManualClickTrackFromSample } from './AudioAnalyzer'
import { detectSongGrid, type SongGridDetection, type TempoTrack } from './beatGrid'
import { buildChannelLabels } from './channelNames'
import { findClickChannel } from './channelRoles'
import type { ClickLibrarySelection } from './clickLibrary'
import { pulsesPerBar, type TimeSignature } from './stageContracts'
import { pickTempoSources, type TempoSources } from './tempoSources'

/** Canal que o fluxo lê: identidade (nome, nome do usuário e papel manual) e o áudio. */
export interface AutoClickChannel { id: string; name: string; customName?: string; role?: ChannelRole; buffer: AudioBuffer }

/**
 * Resultado do fluxo. `label`: no `ok` e na `confianca-baixa`, as famílias analisadas
 * ("Bateria e Baixo"); no `ja-tem-click`, o nome do canal de click na tela; no
 * `sem-faixa`, vazio. `detection` só existe quando o detector rodou.
 */
export type AutoClickPlan =
  | { ok: true; detection: SongGridDetection; signature: TimeSignature; label: string }
  | { ok: false; reason: 'ja-tem-click' | 'sem-faixa' | 'confianca-baixa'; detection?: SongGridDetection; label: string }

export type AutoClickOkPlan = Extract<AutoClickPlan, { ok: true }>

/**
 * Porteiro de "tem pulso" (Ruling M2b-2): abaixo disto nada é gerado. Medido na música
 * inteira com as multitracks reais do dono (M2b): passa 27 de 28 grades certas e barra 67
 * de 70 faixas sem pulso, mas deixa passar 5 de 8 grades erradas. Não prova que a grade
 * está certa: por isso o modal mostra o resultado e pede pra conferir antes de inserir.
 * O `CONFIDENCE_CUT` (0,72) do src/lib/tempo/confidence.ts foi calibrado só em sintéticos
 * e não vale pra produção (Ruling M2-1).
 */
export const AUTO_CLICK_MIN_CONFIDENCE = 0.5

/**
 * Folga mínima do "1" (`downbeatMargin`) pra ele sair sem pedir conferência, quando vem do
 * baixo, da harmonia ou do bumbo sozinho (Ruling M3-M7). A folga é diferença de perfis,
 * não dB. Medido na M7 (detector 57aab63, igual ao de hoje):
 * - nas 140 leituras julgadas das multitracks reais (45 músicas, inteira, cortes e com o
 *   BPM do nome), marca 15 dos 17 "1" errados e 53 dos 123 certos; o maior errado marcado
 *   tem folga 0,733 e o certo seguinte 0,795 (o corte fica no meio do vão);
 * - no fluxo do modal (BPM da música e compasso do click, música inteira), pede pra
 *   conferir o 1 em 21 das 44 músicas que passam no porteiro;
 * - nos 540 sintéticos da M3 (bateria sozinha, com pads, drone e o bumbo do 3 de +0,5 a
 *   +1,3 dB), nenhum "1" errado sai sem marca: o bumbo do 3 a +1,3 dB sai `bumbo` com folga
 *   de 0,557 a 0,561 e fica marcado. Com o baixo votando, nenhum certo é marcado.
 * Limite conhecido: 2 dos 17 errados do real têm folga alta (bumbo 1,35 numa leitura com o
 * BPM do nome; harmonia 3,35 num corte de 60 s com confiança 0,12, que o porteiro barra).
 */
export const DOWNBEAT_MIN_MARGIN = 0.76

/** O que o operador precisa conferir antes de confiar no click. */
export type AutoClickCheck = 'um' | 'contratempo' | 'bpm-salvo' | 'andamento'

// "1" que pode sair sem conferência, se a folga der: veio do baixo, da harmonia ou do bumbo sozinho.
const MEASURED_DOWNBEAT = new Set(['baixo', 'harmonia', 'bumbo'])

/**
 * O que conferir, na ordem de mostrar:
 * - `um`: o "1" é incerto. Todo `bumbo-lidera` (Ruling M3-M7), empate desfeito por onde
 *   a bateria começa, reserva ou origem ausente; e baixo, harmonia ou bumbo com folga abaixo
 *   de `DOWNBEAT_MIN_MARGIN`;
 * - `contratempo`: a grade pode estar meio tempo fora (`offbeatRisk`, Ruling M2-6);
 * - `bpm-salvo`: o BPM salvo não bate com o áudio (`preferConflict`, Ruling M4-prefer);
 * - `andamento`: o BPM salvo escolheu a família 3:2 sem o áudio confirmar (`preferChoseFamily`).
 */
export function autoClickChecks(d: SongGridDetection): AutoClickCheck[] {
  const checks: AutoClickCheck[] = []
  const measured = d.downbeatFrom !== undefined && MEASURED_DOWNBEAT.has(d.downbeatFrom)
  if (!measured || !((d.downbeatMargin ?? 0) >= DOWNBEAT_MIN_MARGIN)) checks.push('um')
  if (d.offbeatRisk) checks.push('contratempo')
  if (d.preferConflict) checks.push('bpm-salvo')
  if (d.preferChoseFamily) checks.push('andamento')
  return checks
}

/**
 * Faixas pro `detectSongGrid`: as de pulso, o baixo e a harmonia, com os canais do áudio.
 * Sem bateria nem percussão o baixo é o pulso (`pickTempoSources`) e entra também como
 * baixo, votando no "1" como na calibração com as multitracks reais.
 */
export function toTempoTracks(s: TempoSources<AutoClickChannel>): TempoTrack[] {
  const picked = [
    ...s.pulse.map((ch) => ({ ch, use: 'pulse' as const })),
    ...(s.bass ? [{ ch: s.bass, use: 'bass' as const }] : []),
    ...s.harmony.map((ch) => ({ ch, use: 'harmony' as const })),
  ]
  const labels = new Map(buildChannelLabels(picked.map((p) => p.ch)).map((l) => [l.id, l.label]))
  return picked.map(({ ch, use }) => ({
    id: ch.id,
    label: labels.get(ch.id) ?? ch.name,
    use,
    channels: Array.from({ length: ch.buffer.numberOfChannels }, (_, c) => ch.buffer.getChannelData(c)),
  }))
}

/** Nome na tela do canal de click da música (papel manual vale), ou null sem click. */
export function clickChannelLabel(channels: readonly AutoClickChannel[]): string | null {
  const click = findClickChannel(channels)
  if (!click) return null
  return buildChannelLabels(channels).find((l) => l.id === click.id)?.label ?? click.name
}

const positive = (x: number | undefined): number | undefined => (x !== undefined && Number.isFinite(x) && x > 0 ? x : undefined)

/**
 * O fluxo: com click na música (e sem `allowExistingClick`), `ja-tem-click`; sem bateria,
 * percussão nem baixo, `sem-faixa`; senão a grade das faixas (`detectSongGrid`, numa taxa
 * só: faixa com outra taxa de amostragem fica de fora), com o BPM da música como referência
 * suave (`preferBpm`), o compasso (padrão 4/4) e, se o operador escolheu um BPM (½×, 2×, ⅔×,
 * 3⁄2× no Metrônomo), o refino em volta dele (`nearBpm`, que vence o `preferBpm`). Confiança
 * abaixo de `AUTO_CLICK_MIN_CONFIDENCE`, `confianca-baixa`. Nunca lê a faixa de click.
 */
export function planAutoClick(
  channels: readonly AutoClickChannel[],
  opts: { songBpm?: number; signature?: TimeSignature; allowExistingClick?: boolean; nearBpm?: number },
): AutoClickPlan {
  const clickLabel = clickChannelLabel(channels)
  if (clickLabel !== null && !opts.allowExistingClick) return { ok: false, reason: 'ja-tem-click', label: clickLabel }
  const found = pickTempoSources(channels)
  if (found.pulse.length === 0) return { ok: false, reason: 'sem-faixa', label: '' }
  const sampleRate = found.pulse[0].buffer.sampleRate
  const sameRate = (ch: AutoClickChannel) => ch.buffer.sampleRate === sampleRate
  const sources: TempoSources<AutoClickChannel> = {
    ...found,
    pulse: found.pulse.filter(sameRate),
    bass: found.bass && sameRate(found.bass) ? found.bass : null,
    harmony: found.harmony.filter(sameRate),
  }
  const signature = opts.signature ?? '4/4'
  const detection = detectSongGrid(toTempoTracks(sources), sampleRate, {
    preferBpm: positive(opts.songBpm), signature, nearBpm: positive(opts.nearBpm),
  })
  if (!(detection.confidence >= AUTO_CLICK_MIN_CONFIDENCE)) return { ok: false, reason: 'confianca-baixa', detection, label: found.label }
  return { ok: true, detection, signature, label: found.label }
}

const mod = (a: number, m: number) => ((a % m) + m) % m

/**
 * Ajustes do operador antes de inserir: `moveOne` anda o "1" de tempo em tempo (pulsos do
 * compasso, com volta); `halfBeat` leva a grade inteira, e o "1" junto, meio pulso pra frente
 * (só oferecido com `offbeatRisk`). O 1º pulso continua em `[0, pulso)`.
 */
export function adjustAutoClick(plan: AutoClickOkPlan, adj: { moveOne: number; halfBeat: boolean }): AutoClickOkPlan {
  if (adj.moveOne === 0 && !adj.halfBeat) return plan
  const d = plan.detection
  const beats = pulsesPerBar(plan.signature)
  const pulse = 60 / d.pulseBpm
  let { firstBeat, downbeat } = d
  if (adj.halfBeat) {
    const one = firstBeat + downbeat * pulse + pulse / 2
    firstBeat = mod(one, pulse)
    downbeat = mod(Math.round((one - firstBeat) / pulse), beats)
  }
  downbeat = mod(downbeat + Math.round(adj.moveOne), beats)
  return { ...plan, detection: { ...d, firstBeat, downbeat } }
}

/**
 * O click da biblioteca (`sel`) na grade do plano, com acento no "1", do tamanho da música.
 * O click anda no pulso da grade (`pulseBpm`: a colcheia no x/8, nunca a semínima mostrada)
 * e o gerador já adianta cada click pelo ataque da amostra (clickAttack.ts).
 */
export async function renderAutoClick(plan: AutoClickOkPlan, duration: number, sel: ClickLibrarySelection): Promise<Blob> {
  const d = plan.detection
  const { clickTrackUrl } = await generateManualClickTrackFromSample(
    sel.type, sel.subdivision, d.pulseBpm, duration, true, plan.signature, { firstBeat: d.firstBeat, downbeat: d.downbeat },
  )
  try {
    const res = await fetch(clickTrackUrl)
    return await res.blob()
  } finally {
    URL.revokeObjectURL(clickTrackUrl)
  }
}
