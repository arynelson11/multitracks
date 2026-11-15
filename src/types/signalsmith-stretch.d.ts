declare module 'signalsmith-stretch' {
    export interface SignalsmithStretchScheduleOptions {
        output?: number;
        active?: boolean;
        input?: number;
        rate?: number;
        semitones?: number;
        tonalityHz?: number;
        formantSemitones?: number;
        formantCompensation?: boolean;
        formantBaseHz?: number;
        loopStart?: number;
        loopEnd?: number;
    }

    // Os métodos extras viram mensagens pro worklet (assíncronos). NÃO existe
    // close(): o nó não pode ser destruído e o process() dele roda até o
    // AudioContext fechar. Pra parar o DSP, use stop() e reaproveite o nó.
    export interface SignalsmithStretchNode extends AudioNode {
        start(when?: number, offset?: number): Promise<unknown>;
        stop(when?: number): Promise<unknown>;
        schedule(opts: SignalsmithStretchScheduleOptions): Promise<unknown>;
        setTransposeSemitones(semitones: number, tonalityHz?: number): void;
        setTransposeFactor(factor: number, tonalityHz?: number): void;
        setFormantSemitones(semitones: number): void;
        setFormantFactor(factor: number): void;
        setFormantBase(baseRelativeToNyquist: number): void;
        addBuffers(buffers: Float32Array[]): Promise<number>;
        dropBuffers(toSeconds?: number): void;
        latency(): number;
    }

    export default function SignalsmithStretch(
        context: BaseAudioContext,
        channelOptions?: AudioWorkletNodeOptions
    ): Promise<SignalsmithStretchNode>;
}
