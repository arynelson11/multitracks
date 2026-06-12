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
    artist?: string;
    lyrics?: string | null;
    lyricsSynced?: string | null; // LRC format ([mm:ss.xx] linha)
    chords?: string | null;
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
      onRemoteCommand: (callback: (cmd: { type: 'COMMAND'; action: string; index?: number; id?: string; value?: number; clientId?: string; ip?: string }) => void) => () => void
      onClientsUpdate: (callback: (clients: { id: string; ip: string }[]) => void) => () => void
    }
  }
}

export type WsMessage =
  | { type: 'CLIENT_JOINED'; clientId?: string; ip?: string }
  | { 
      type: 'HOST_STATE'; 
      payload: { 
        isPlaying: boolean; 
        currentTime: number; 
        songName: string | null;
        currentMarker: Marker | null;
        nextMarkerLabel: string | null;
        nextSong: { name: string; originalKey: string | null; pitch: number; bpm: number | null } | null;
        lyrics: string | null;
        lyricsSynced: string | null;
        chords: string | null;
        controlEnabled: boolean;
        approvedIps: string[];
        setlist: string[];
        activeIndex: number;
        channels: { id: string; name: string; volume: number; muted: boolean; soloed: boolean }[];
        activePad: string | null;
        padVolume: number;
        pitch: number;
        originalKey: string | null;
      }
    }
  | { type: 'COMMAND'; action: string; index?: number; id?: string; value?: number }
