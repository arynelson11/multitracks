import type { SongGrid, TimeSignature } from './lib/stageContracts'

// Papel do canal no palco. Click e Guia continuam tocando com outro canal em
// Solo e ficam fora da troca de tom. Campo ausente no canal quer dizer
// automático (o papel vem do nome do arquivo).
export type ChannelRole = 'click' | 'guide' | 'normal'

// Ordem dos canais da música. 'auto' segue a ordem padrão por família;
// 'manual' mantém a ordem que o usuário arrumou. Campo ausente quer dizer automático.
export type ChannelOrderMode = 'auto' | 'manual'

export interface Channel {
    id: string;
    // Nome original do arquivo. Nunca é sobrescrito: o nome organizado é só exibição.
    name: string;
    // Nome escolhido pelo usuário. Ausente quer dizer nome automático.
    customName?: string;
    // Papel escolhido pelo usuário. Ausente quer dizer papel automático.
    role?: ChannelRole;
    buffer: AudioBuffer;
    file?: File;
    // Para músicas baixadas da nuvem: ponteiro pro stem no cache offline
    // (songId + índice). O repertório reaproveita esses bytes em vez de gravar
    // uma 2ª cópia — gravar duas vezes estourava a memória no iPhone.
    srcId?: string;
    srcIdx?: number;
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
    // Liga o item do repertório à música na nuvem (biblioteca). Permite
    // ressincronizar nome/tom/bpm/capa quando a música é editada na biblioteca,
    // mesmo já estando baixada/no ao vivo. Itens antigos não têm (fallback p/ nome).
    sourceId?: string;
    name: string;
    coverImage?: string;
    channels: Channel[];
    // Modo de ordem dos canais. Ausente quer dizer automático.
    channelOrder?: ChannelOrderMode;
    duration: number;
    pitch?: number;
    originalKey?: string | null;
    bpm?: number;
    markers?: Marker[];
    artist?: string;
    lyrics?: string | null;
    lyricsSynced?: string | null; // LRC format ([mm:ss.xx] linha)
    chords?: string | null;
    // Grade da música (Parte 2): BPM, primeiro 1 e compasso lidos no click, ou só o BPM
    // salvo; o compasso escolhido no EDITAR vence. Ausente quer dizer ainda sem grade.
    grid?: SongGrid;
    // Compasso salvo na nuvem (songs.time_signature). Ausente quer dizer não informado.
    timeSignature?: TimeSignature;
    // O "1" da grade de click não foi provado (nem pelo acento do click nem pelas seções): o
    // palco avisa COMPASSO ASSUMIDO, também com o compasso escolhido no EDITAR. Só existe junto
    // de grade de click; ausente quer dizer sem aviso (Ruling T27-campo).
    downbeatAssumed?: true;
    // O usuário apagou um canal de Click desta música: o motor não gera o "Click gerado" no lugar
    // (manual vence automático, Ruling X1-critical). Só `true`; ausente quer dizer nunca apagou.
    clickRemoved?: true;
    // A música veio de uma separação do Separador (Parte 3): a conta do Livre usa a mesma chave
    // do Separador e o painel SEPARAÇÃO lê as ferramentas dela. Vale só na conta (não vai pro .zip).
    separation?: SeparationLink;
}

/** De qual separação a música do palco veio: a id e a data dela (a data nunca muda). */
export interface SeparationLink { id: string; createdAt: number }

/** O mixer salvo de uma faixa da separação, aplicado na primeira carga no palco. */
export interface ChannelStartState { volume: number; muted: boolean; soloed: boolean; pan: number }

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
      onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) => () => void
      onUpdateReady: (callback: (version: string) => void) => () => void
      checkForUpdate: () => Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion: string | null; url: string }>
      installUpdate: () => Promise<void>
    }
  }
}

// Pulo armado no host, como o celular da banda vê: seção alvo (índice na lista
// `sections` do HOST_STATE), rótulo e cor dela, e se é a próxima ou a repetição
// da atual. `plays` é quantas vezes ela vai tocar ('infinite' no loop ∞).
export interface LiveArmed {
  index: number;
  label: string;
  color: string;
  kind: 'proxima' | 'repete';
  plays: number | 'infinite';
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
        sections: { label: string; color: string }[];
        activeLoop: { index: number; remaining: number | 'infinite' } | null;
        bandSectionsEnabled: boolean;
        // Opcionais: o host da versão anterior não manda. Contagem aproximada
        // (a rede atrasa; o tempo exato é o click no ouvido): `countBeat` é o
        // tempo ouvido agora (1..countTotal), null antes do último compasso.
        armed?: LiveArmed | null;
        countBeat?: number | null;
        countTotal?: number | null;
      }
    }
  | { type: 'COMMAND'; action: string; index?: number; id?: string; value?: number }
