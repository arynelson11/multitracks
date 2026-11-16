// Relógio do agendador do pulo (Parte 2, Arquitetura A: "dois relógios").
// Só decide QUANDO o agendador olha o plano: o som em si é marcado no tempo do AudioContext.
// O tique vem de um Worker nascido de uma Blob URL (funciona no desktop em file://): o
// navegador segura o setInterval da janela quando o app fica atrás de outra janela no culto
// (Holyrics, OBS, projetor), e o do Worker continua no ritmo. Sem Worker, o setInterval da
// janela segura as pontas, com aviso no console.

/** O pedaço do Worker que o relógio usa (o teste passa um falso). */
export interface WorkerLike { postMessage(m: unknown): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null }
export interface SchedulerClock { start(): void; stop(): void; dispose(): void; readonly running: boolean }

/** Intervalo entre tiques do agendador, em milissegundos. */
export const CLOCK_INTERVAL_MS = 25

export interface SchedulerClockOptions {
  intervalMs?: number
  createWorker?: (url: string) => WorkerLike
  createObjectURL?: (b: Blob) => string
  revokeObjectURL?: (url: string) => void
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

const FALLBACK_WARNING = 'Relógio do agendador sem Worker: usando o setInterval da janela, que o navegador pode atrasar com o app em segundo plano.'

// Código do Worker: um tique (postMessage(0)) a cada `ms` entre 'start' e 'stop'.
const workerSource = (ms: number): string => [
  'let id = null',
  'self.onmessage = (e) => {',
  `  if (e.data === 'start') { if (id === null) id = setInterval(() => self.postMessage(0), ${ms}) }`,
  "  else if (e.data === 'stop') { if (id !== null) { clearInterval(id); id = null } }",
  '}',
].join('\n')

// Worker do navegador no formato WorkerLike. Erro depois de nascer (o script não carregou)
// chama `onBroken`, pro relógio trocar de caminho em vez de ficar sem tique.
function browserWorker(url: string, onBroken: (err: unknown) => void): WorkerLike {
  const real = new Worker(url)
  const like: WorkerLike = {
    onmessage: null,
    postMessage: (m) => real.postMessage(m),
    terminate: () => real.terminate(),
  }
  real.onmessage = (e) => like.onmessage?.(e)
  real.onerror = (e) => onBroken(e)
  return like
}

/**
 * Relógio que chama `onTick` a cada `intervalMs` (padrão 25 ms) entre `start` e `stop`. O Worker
 * nasce no primeiro `start` e é reaproveitado até o `dispose`. Sem Worker (ausente, lançando ao
 * nascer ou com erro depois), cai no `setIntervalFn` e avisa uma vez. Tique atrasado que chega
 * depois do `stop` é ignorado. Depois do `dispose`, `start` não faz nada.
 */
export function createSchedulerClock(onTick: () => void, opts: SchedulerClockOptions = {}): SchedulerClock {
  const intervalMs = opts.intervalMs !== undefined && Number.isFinite(opts.intervalMs) && opts.intervalMs > 0 ? opts.intervalMs : CLOCK_INTERVAL_MS
  // Guardadas em variáveis e chamadas soltas: o setInterval do navegador lança se chamado como método de outro objeto.
  const setIntervalFn = opts.setIntervalFn ?? globalThis.setInterval
  const clearIntervalFn = opts.clearIntervalFn ?? globalThis.clearInterval
  const createObjectURL = opts.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b))
  const revokeObjectURL = opts.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url))
  const createWorker = opts.createWorker ?? ((url: string) => browserWorker(url, fallBack))

  let running = false
  let disposed = false
  let worker: WorkerLike | null = null
  let workerUrl: string | null = null
  let useInterval = false
  let stopInterval: (() => void) | null = null

  const tick = () => { if (running) onTick() }

  function releaseWorker(): void {
    if (worker) { worker.onmessage = null; worker.terminate(); worker = null }
    if (workerUrl !== null) { revokeObjectURL(workerUrl); workerUrl = null }
  }

  function startInterval(): void {
    if (stopInterval) return
    const handle = setIntervalFn(tick, intervalMs)
    stopInterval = () => clearIntervalFn(handle)
  }

  function endInterval(): void {
    if (!stopInterval) return
    stopInterval()
    stopInterval = null
  }

  function fallBack(reason: unknown): void {
    if (useInterval || disposed) return
    console.warn(FALLBACK_WARNING, reason)
    useInterval = true
    releaseWorker()
    if (running) startInterval()
  }

  function ensureWorker(): WorkerLike | null {
    if (useInterval) return null
    if (worker) return worker
    try {
      workerUrl = createObjectURL(new Blob([workerSource(intervalMs)], { type: 'text/javascript' }))
      const w = createWorker(workerUrl)
      w.onmessage = tick
      worker = w
      return w
    } catch (err) {
      fallBack(err)
      return null
    }
  }

  function start(): void {
    if (disposed || running) return
    running = true
    const w = ensureWorker()
    if (w) w.postMessage('start')
    else startInterval()
  }

  function stop(): void {
    if (!running) return
    running = false
    worker?.postMessage('stop')
    endInterval()
  }

  function dispose(): void {
    if (disposed) return
    stop()
    disposed = true
    releaseWorker()
  }

  return { start, stop, dispose, get running() { return running } }
}
