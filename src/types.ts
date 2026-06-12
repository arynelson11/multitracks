export interface Channel {
    id: string;
    name: string;
    buffer: AudioBuffer;
    file?: File;
    gainNode: GainNode;
    pannerNode: StereoPannerNode;
    sourceNode: AudioBufferSourceNode | null;
    pitchShiftNode?: any;
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
    pitch?: number;
    originalKey?: string | null;
    bpm?: number;
    markers?: Marker[];
}

export interface Marker {
    id: string; // generated UUID 
    time: number; // in seconds
    label: string; // e.g., 'Intro', 'Coro 1', 'Ponte'
    lyrics?: string; // Multiline text for teleprompter 
    color?: string; // Optional hex for the timeline UI dot
}

declare global {
  interface Window {
    playbackDesktop?: {
      isElectron: boolean
      platform: string
      version: string
      openExternalUrl: (url: string) => void
      onDeepLinkAuth: (callback: (fragment: string) => void) => () => void
      startLocalServer: (preferredPort?: number) => Promise<{ url: string | null; error: string | null }>
      stopLocalServer: () => Promise<void>
      broadcastState: (state: any) => void
    }
  }
}

export type WsMessage = 
  | { type: 'CLIENT_JOINED' }
  | { 
      type: 'HOST_STATE'; 
      payload: { 
        isPlaying: boolean; 
        currentTime: number; 
        songName: string | null;
        nextSongName: string | null;
        currentMarker: Marker | null;
        pitch: number;
        originalKey: string | null;
      } 
    }
