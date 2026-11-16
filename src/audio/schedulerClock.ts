// Relógio do agendador do pulo (Parte 2, Arquitetura A: "dois relógios").
// Só decide QUANDO o agendador olha o plano: o som em si é marcado no tempo do AudioContext.
// O tique vem de um Worker nascido de uma Blob URL (funciona no desktop em file://): o
// navegador segura o setInterval da janela quando o app fica atrás de outra janela no culto
// (Holyrics, OBS, projetor), e o do Worker continua no ritmo.
// CONDIÇÃO: o Worker só mantém os 25 ms em segundo plano com o AudioContext RODANDO (medido no
// Electron 42: sem contexto rodando o timer do próprio Worker cai pra 1 a 3 s). Hoje vale porque
// o motor nunca suspende o contexto depois do primeiro play. Não suspender o contexto na pausa,
// nem ligar o relógio antes do contexto rodar, sem rever isso.
// Sem Worker, o setInterval da janela segura as pontas (`mode: 'interval'`), com aviso no console
// e no `onFallback`. Ele NÃO cumpre a folga de 0,3 s com a janela escondida (1 tique por segundo):
// quem agenda aumenta o horizonte ou avisa o operador.

/** O pedaço do Worker que o relógio usa (o teste passa um falso). */
export interface WorkerLike { postMessage(m: unknown): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null }
/** Caminho do tique: o Worker, ou o setInterval da janela depois de o Worker faltar ou falhar. */
export type ClockMode = 'worker' | 'interval'
/** `mode` começa em 'worker' (o Worker só é tentado no primeiro start) e passa a 'interval' de vez se ele faltar ou falhar. */
export interface SchedulerClock { start(): void; stop(): void; dispose(): void; readonly running: boolean; readonly mode: ClockMode }

/** Intervalo entre tiques do agendador, em milissegundos. */
export const CLOCK_INTERVAL_MS = 25

export interface SchedulerClockOptions {
  intervalMs?: number
  createWorker?: (url: string) => WorkerLike
  createObjectURL?: (b: Blob) => string
  revokeObjectURL?: (url: string) => void
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
  /** Chamado uma vez, com o motivo, quando o relógio passa pra 'interval' (já ligado no caminho novo se estava rodando). */
  onFallback?: (reason: unknown) => void
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
 * nascer ou com erro depois), cai no `setIntervalFn`, passa `mode` pra 'interval' e avisa uma vez
 * (console e `onFallback`; um `onFallback` que lança não derruba o relógio). Tique atrasado que
 * chega depois do `stop` é ignorado. Depois do `dispose`, `start` não faz nada.
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
    try {
      opts.onFallback?.(reason)
    } catch (err) {
      console.error('Relógio do agendador: o aviso de troca pro setInterval falhou.', err)
    }
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

  return { start, stop, dispose, get running() { return running }, get mode(): ClockMode { return useInterval ? 'interval' : 'worker' } }
}
