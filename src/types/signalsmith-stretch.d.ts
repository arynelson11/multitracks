declare module 'signalsmith-stretch' {
    interface SignalsmithStretchScheduleOptions {
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

    interface SignalsmithStretchNode extends AudioNode {
        start(when?: number, offset?: number): void;
        stop(when?: number): void;
        schedule(opts: SignalsmithStretchScheduleOptions): void;
        setTransposeSemitones(semitones: number, tonalityHz?: number): void;
        setTransposeFactor(factor: number, tonalityHz?: number): void;
        setFormantSemitones(semitones: number): void;
        setFormantFactor(factor: number): void;
        setFormantBase(baseRelativeToNyquist: number): void;
        addBuffers(buffers: Float32Array[]): Promise<number>;
        dropBuffers(toSeconds?: number): void;
        latency(): number;
        close(): void;
    }

    export default function SignalsmithStretch(
        context: BaseAudioContext,
        channelOptions?: AudioWorkletNodeOptions
    ): Promise<SignalsmithStretchNode>;
}
