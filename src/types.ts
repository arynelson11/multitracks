export interface Channel {
    id: string;
    name: string;
    buffer: AudioBuffer;
    file?: File;
    gainNode: GainNode;
    pannerNode: StereoPannerNode;
    sourceNode: AudioBufferSourceNode | null;
    volume: number;
    muted: boolean;
    soloed: boolean;
    pan: number;
    bus: '1' | '2' | '1/2';
}

export interface Song {
    id: string;
    name: string;
    coverImage?: string;
    channels: Channel[];
    duration: number;
}
