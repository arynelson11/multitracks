// Worker da grade da música (Parte 2, T27; Ruling T27-worker): a conta pesada da grade roda
// fora da thread principal, pra um play apertado no meio de uma leitura começar na hora.
// - 'click': analyzeClickTrack (T3) num canal de click (80 a 450 ms por música);
// - 'plano': planAutoClick (M7), o plano do click que falta (até uns 4 s numa música de 5 min).
// A decodificação continua na thread principal (decodeAudioData já é assíncrona); o motor manda
// CÓPIAS das amostras por transferência (o AudioBuffer original continua tocando) e o resultado
// volta igual ao da função chamada direto (mesmas funções, mesmos números).
// O motor cria este arquivo pelo `?worker&inline` do Vite: o código vai dentro do pacote e nasce
// por Blob URL, então funciona no app de computador (file://), sem arquivo de worker à parte.
import { analyzeClickTrack, type ClickAnalysis } from '../lib/clickMeter'
import { planAutoClick, type AutoClickChannel, type AutoClickPlan } from '../lib/autoClick'
import { pickTempoSources } from '../lib/tempoSources'
import type { TimeSignature } from '../lib/stageContracts'
import type { ChannelIdentity } from '../lib/channelNames'

/** Canal mandado pro plano: a identidade (nome, nome do usuário, papel manual) e as amostras de cada canal do áudio. */
export interface GridWorkerChannel { id: string; name: string; customName?: string; role?: ChannelIdentity['role']; sampleRate: number; data: Float32Array[] }

/** Pedidos (sem o `id`, que o motor põe). */
export type GridWorkerTask =
  | { kind: 'click'; samples: Float32Array; sampleRate: number; known: TimeSignature | null; bpm: number | null }
  | { kind: 'plano'; channels: GridWorkerChannel[]; songBpm?: number; signature?: TimeSignature }
export type GridWorkerRequest = GridWorkerTask & { id: number }

export type GridWorkerResponse =
  | { id: number; kind: 'click'; analysis: ClickAnalysis | null }
  | { id: number; kind: 'plano'; plan: AutoClickPlan }
  | { id: number; kind: 'erro'; message: string }

/**
 * Canais que o plano do click lê (bateria e percussão, baixo e até 2 harmônicos, pela regra
 * central do `pickTempoSources`), na ordem em que entram na conta. O motor manda só estes pro
 * Worker (as vozes, a guia e o resto não precisam viajar); o `planAutoClick` com só eles dá o
 * mesmo plano que com a música inteira (testado em gridWorker.test.ts).
 */
export function tempoChannelsForPlan<T extends ChannelIdentity>(channels: readonly T[]): T[] {
  const s = pickTempoSources(channels)
  const picked = [...s.pulse, ...(s.bass ? [s.bass] : []), ...s.harmony]
  return picked.filter((ch, i) => picked.indexOf(ch) === i)
}

/** O pouco de AudioBuffer que o planAutoClick lê (taxa, canais e amostras), em cima das amostras recebidas. */
function asAudioBuffer(ch: GridWorkerChannel): AudioBuffer {
  const length = ch.data[0]?.length ?? 0
  const buffer = {
    sampleRate: ch.sampleRate, numberOfChannels: ch.data.length, length, duration: ch.sampleRate > 0 ? length / ch.sampleRate : 0,
    getChannelData: (c: number) => ch.data[c],
  }
  return buffer as unknown as AudioBuffer
}

/** Responde um pedido com as funções de sempre; erro vira resposta de erro (o motor desiste daquela leitura). */
export function handleGridRequest(req: GridWorkerRequest): GridWorkerResponse {
  try {
    if (req.kind === 'click') return { id: req.id, kind: 'click', analysis: analyzeClickTrack(req.samples, req.sampleRate, req.known, req.bpm) }
    if (req.kind === 'plano') {
      const channels: AutoClickChannel[] = req.channels.map((ch) => ({ id: ch.id, name: ch.name, customName: ch.customName, role: ch.role, buffer: asAudioBuffer(ch) }))
      return { id: req.id, kind: 'plano', plan: planAutoClick(channels, { songBpm: req.songBpm, signature: req.signature }) }
    }
    return { id: (req as { id: number }).id, kind: 'erro', message: `pedido desconhecido: ${String((req as { kind?: unknown }).kind)}` }
  } catch (e) {
    return { id: req.id, kind: 'erro', message: e instanceof Error ? e.message : String(e) }
  }
}

// Dentro do Worker (sem `window`): responde cada pedido. Importado pela thread principal (o motor
// usa o tempoChannelsForPlan; o teste usa o handleGridRequest), não escuta nada.
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<GridWorkerRequest>) => void) | null; postMessage(m: GridWorkerResponse): void }
  scope.onmessage = (e) => scope.postMessage(handleGridRequest(e.data))
}

// Com o Vite, o `?worker&inline` do motor troca este módulo pelo construtor do Worker. Sem o Vite
// (o esbuild das páginas de scripts/verify-pitch), o import vira este módulo comum, e o padrão
// nulo deixa o motor sem Worker (sem leitura automática da grade) em vez de quebrar o pacote.
export default null

