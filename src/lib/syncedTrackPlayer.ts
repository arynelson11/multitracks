// Player de faixa em Web Audio que imita o <audio> o suficiente pro WaveSurfer
// usar como `media`, com uma diferença que importa: SINCRONIA POR AMOSTRA.
//
// Por que existe: o Separador tocava cada faixa num <audio> separado. Cada
// elemento tem seu próprio pipeline e começa quando "fica pronto", então as
// faixas saíam com dezenas de ms de diferença entre si, e a diferença mudava a
// cada play/seek. Bateria e baixo até disfarçam; o click não: soa fora.
//
// Aqui todas as faixas tocam AudioBuffers no MESMO AudioContext, e qualquer
// play/seek disparado no mesmo tick de JS usa o MESMO instante `when` no
// start(). Resultado: todas as faixas começam na mesma amostra.

type Listener = (...args: unknown[]) => void;

// Folga entre o comando e o som sair: dá tempo de agendar todas as faixas no
// mesmo instante. 40 ms é imperceptível ao apertar play.
const START_LATENCY = 0.04;

const sharedWhenByCtx = new WeakMap<BaseAudioContext, number>();

/** Mesmo `when` pra todo mundo que der play/seek dentro do mesmo tick de JS. */
function sharedStartTime(ctx: AudioContext): number {
  const cached = sharedWhenByCtx.get(ctx);
  if (cached !== undefined) return cached;
  const when = ctx.currentTime + START_LATENCY;
  sharedWhenByCtx.set(ctx, when);
  queueMicrotask(() => sharedWhenByCtx.delete(ctx));
  return when;
}

export class SyncedTrackPlayer {
  /** Saída da faixa. Quem usa conecta no mixer (gain → pan → destino). */
  readonly output: GainNode;

  paused = true;
  seeking = false;
  autoplay = false;
  controls = false;
  preservesPitch = true;
  crossOrigin: string | null = null;
  currentSrc = '';

  private readonly ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private node: AudioBufferSourceNode | null = null;
  private position = 0; // segundos na faixa no instante startedAt
  private startedAt = 0; // ctx.currentTime em que o node começa a soar
  private rate = 1;
  private _muted = false;
  private _volume = 1;
  private listeners = new Map<string, Set<Listener>>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
  }

  // ── eventos (interface que o WaveSurfer usa) ──
  addEventListener(event: string, listener: Listener, options?: { once?: boolean }): () => void {
    let fn = listener;
    if (options?.once) {
      fn = (...args: unknown[]) => {
        this.removeEventListener(event, fn);
        listener(...args);
      };
    }
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.removeEventListener(event, fn);
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: string): void {
    this.listeners.get(event)?.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error('[SyncedTrackPlayer] listener error', e);
      }
    });
  }

  // ── fonte ──
  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.stopNode();
    this.paused = true;
    this.currentSrc = value;
    this.buffer = null;
    this.position = 0;
    if (!value) {
      this.emit('emptied');
      return;
    }
    fetch(value)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar a faixa`);
        return res.arrayBuffer();
      })
      .then(ab => (this.currentSrc === value ? this.ctx.decodeAudioData(ab) : null))
      .then(buf => {
        if (!buf || this.currentSrc !== value) return;
        this.buffer = buf;
        this.emit('loadedmetadata');
        this.emit('canplay');
      })
      .catch(err => {
        console.error('[SyncedTrackPlayer] falha ao carregar faixa:', err);
        this.emit('error');
      });
  }

  load(): void {
    /* compat com HTMLMediaElement: a carga acontece no setter de src */
  }

  removeAttribute(attr: string): void {
    if (attr === 'src') this.src = '';
  }

  remove(): void {
    /* compat: não está no DOM */
  }

  canPlayType(mime: string): CanPlayTypeResult {
    return /^(audio|video)\//.test(mime) ? 'maybe' : '';
  }

  get isLoaded(): boolean {
    return !!this.buffer;
  }

  /** Amostras decodificadas (mesma linha do tempo que toca). Vazio se não carregou. */
  getChannelData(): Float32Array[] {
    if (!this.buffer) return [];
    const out: Float32Array[] = [];
    for (let c = 0; c < this.buffer.numberOfChannels; c++) out.push(this.buffer.getChannelData(c));
    return out;
  }

  get sampleRate(): number {
    return this.buffer?.sampleRate ?? this.ctx.sampleRate;
  }

  // ── transporte ──
  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get ended(): boolean {
    return this.duration > 0 && this.currentTime >= this.duration;
  }

  /** Posição na faixa num instante do relógio de áudio. */
  positionAt(ctxTime: number): number {
    if (this.paused) return this.position;
    return this.position + Math.max(0, ctxTime - this.startedAt) * this.rate;
  }

  get currentTime(): number {
    return this.positionAt(this.ctx.currentTime);
  }

  set currentTime(value: number) {
    const wasPlaying = !this.paused;
    if (wasPlaying) this.stopNode();
    this.position = Math.max(0, value || 0);
    if (wasPlaying) this.startNode(sharedStartTime(this.ctx));
    this.emit('seeking');
    this.emit('timeupdate');
  }

  play(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    if (this.position >= this.duration && this.duration > 0) this.position = 0;
    this.paused = false;
    this.startNode(sharedStartTime(this.ctx));
    this.emit('play');
    return Promise.resolve();
  }

  pause(): void {
    if (this.paused) return;
    this.position = this.positionAt(this.ctx.currentTime);
    this.stopNode();
    this.paused = true;
    this.emit('pause');
  }

  /**
   * Entra tocando alinhado a outra faixa que já está tocando (ex.: click gerado
   * com a música rodando). Calcula onde a referência vai estar no instante em que
   * esta começa, então não fica nem 1 ms atrasada.
   */
  joinPlayback(reference: SyncedTrackPlayer): void {
    if (reference.paused) {
      this.pause();
      this.currentTime = reference.currentTime;
      return;
    }
    this.stopNode();
    const when = sharedStartTime(this.ctx);
    this.position = reference.positionAt(when);
    this.paused = false;
    this.startNode(when);
    this.emit('play');
  }

  /** Para tudo e solta o áudio decodificado (memória: iPad agradece). */
  release(): void {
    this.stopNode();
    this.paused = true;
    if (this.currentSrc.startsWith('blob:')) URL.revokeObjectURL(this.currentSrc);
    this.currentSrc = '';
    this.buffer = null;
    this.listeners.clear();
    try {
      this.output.disconnect();
    } catch {
      /* já desconectado */
    }
  }

  private startNode(when: number): void {
    this.stopNode();
    if (!this.buffer) {
      // Ainda carregando: a posição anda pelo relógio e quem sincroniza chama
      // joinPlayback quando ficar pronta.
      this.startedAt = when;
      return;
    }
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.playbackRate.value = this.rate;
    node.connect(this.output);
    const offset = Math.min(this.position, Math.max(0, this.buffer.duration - 1e-3));
    node.start(when, offset);
    node.onended = () => {
      if (this.node !== node) return;
      this.position = this.duration;
      this.node = null;
      this.paused = true;
      this.emit('pause');
      this.emit('ended');
    };
    this.node = node;
    this.startedAt = when;
  }

  private stopNode(): void {
    const node = this.node;
    this.node = null;
    if (!node) return;
    node.onended = null;
    try {
      node.stop();
    } catch {
      /* ainda não tinha começado */
    }
    node.disconnect();
  }

  // ── propriedades que o WaveSurfer lê/escreve ──
  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    if (value === this.rate) return;
    const wasPlaying = !this.paused;
    if (wasPlaying) this.position = this.positionAt(this.ctx.currentTime);
    this.rate = value;
    if (wasPlaying) this.startNode(sharedStartTime(this.ctx));
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = value;
    this.output.gain.value = this._muted ? 0 : value;
    this.emit('volumechange');
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    this.output.gain.value = value ? 0 : this._volume;
    this.emit('volumechange');
  }
}
