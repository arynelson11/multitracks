import { useState, useEffect, useRef } from 'react';
import type { LiveArmed, Marker, WsMessage } from '../types';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface FollowerState {
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
  // Seções da música atual + estado do loop (pra banda comandar pelo celular).
  sections: { label: string; color: string }[];
  activeLoop: { index: number; remaining: number | 'infinite' } | null;
  // Banda pode controlar loop/seções pelo celular? (exclusivo do Studio)
  bandSectionsEnabled: boolean;
  // Pulo armado no host e a contagem aproximada dele (ver HOST_STATE em types.ts).
  // Sempre null quando o host não manda (versão anterior).
  armed: LiveArmed | null;
  countBeat: number | null;
  countTotal: number | null;
}

type HostStatePayload = Extract<WsMessage, { type: 'HOST_STATE' }>['payload'];

// Estado que o líder entrega ao hook: os campos do pulo armado são opcionais
// enquanto o App não os informa; ausente vai como null.
type LiveJumpField = 'armed' | 'countBeat' | 'countTotal';
export type LeaderLiveState = Omit<FollowerState, LiveJumpField> & Partial<Pick<FollowerState, LiveJumpField>>;

// Hosts privados (rede local) — usados pra distinguir o follower da LAN do site público.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export const INITIAL_STATE: FollowerState = {
  isPlaying: false,
  currentTime: 0,
  songName: null,
  currentMarker: null,
  nextMarkerLabel: null,
  nextSong: null,
  lyrics: null,
  lyricsSynced: null,
  chords: null,
  controlEnabled: false,
  approvedIps: [],
  setlist: [],
  activeIndex: 0,
  channels: [],
  activePad: null,
  padVolume: 1,
  pitch: 0,
  originalKey: null,
  sections: [],
  activeLoop: null,
  bandSectionsEnabled: false,
  armed: null,
  countBeat: null,
  countTotal: null,
};

export function buildPayload(state: LeaderLiveState): HostStatePayload {
  return {
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    songName: state.songName,
    currentMarker: state.currentMarker,
    nextMarkerLabel: state.nextMarkerLabel,
    nextSong: state.nextSong,
    approvedIps: state.approvedIps,
    lyrics: state.lyrics,
    lyricsSynced: state.lyricsSynced,
    chords: state.chords,
    controlEnabled: state.controlEnabled,
    setlist: state.setlist,
    activeIndex: state.activeIndex,
    channels: state.channels,
    activePad: state.activePad,
    padVolume: state.padVolume,
    pitch: state.pitch,
    originalKey: state.originalKey,
    sections: state.sections,
    activeLoop: state.activeLoop,
    bandSectionsEnabled: state.bandSectionsEnabled,
    armed: state.armed ?? null,
    countBeat: state.countBeat ?? null,
    countTotal: state.countTotal ?? null,
  };
}

function readArmed(value: unknown): LiveArmed | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  if (typeof a.index !== 'number' || typeof a.label !== 'string' || typeof a.color !== 'string') return null;
  if (a.kind !== 'proxima' && a.kind !== 'repete') return null;
  if (a.plays !== 'infinite' && typeof a.plays !== 'number') return null;
  return { index: a.index, label: a.label, color: a.color, kind: a.kind, plays: a.plays };
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Leitura do HOST_STATE no celular, igual nos dois caminhos (rede local e nuvem).
// Host da versão anterior não manda o pulo armado nem a contagem: viram null.
// Valor malformado também vira null, pra tela nunca quebrar no meio do culto.
export function readHostState(payload: HostStatePayload, controlEnabled: boolean): FollowerState {
  return {
    ...payload,
    armed: readArmed(payload.armed),
    countBeat: readCount(payload.countBeat),
    countTotal: readCount(payload.countTotal),
    controlEnabled,
  };
}

// sessionCode: ativo no líder quando "convidar remoto" está ligado (publica na nuvem).
export function useLiveSync(leaderState: LeaderLiveState, sessionCode?: string | null) {
  const isLeader = !!window.playbackDesktop?.isElectron;
  const remoteSession = !isLeader ? new URLSearchParams(window.location.search).get('s') : null;
  const isFollowerRemote = !isLeader && !!remoteSession;
  const isFollowerLAN = !isLeader && !remoteSession && PRIVATE_HOST.test(window.location.hostname);
  const isFollowerMode = isFollowerRemote || isFollowerLAN;

  const [followerState, setFollowerState] = useState<FollowerState>(INITIAL_STATE);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myIpRef = useRef<string | null>(null);

  const leaderStateRef = useRef(leaderState);
  useEffect(() => {
    leaderStateRef.current = leaderState;
  }, [leaderState]);

  // Líder: emite o estado na LAN (WebSocket local) a cada 200ms.
  useEffect(() => {
    if (!isLeader) return;
    const intervalId = setInterval(() => {
      const message: WsMessage = { type: 'HOST_STATE', payload: buildPayload(leaderStateRef.current) };
      window.playbackDesktop?.broadcastState?.(message);
    }, 200);
    return () => clearInterval(intervalId);
  }, [isLeader]);

  // Líder: quando há sessão remota ativa, espelha o estado pela nuvem (Supabase Realtime).
  useEffect(() => {
    if (!isLeader || !sessionCode || !supabase) return;
    const sb = supabase;
    const channel = sb.channel(`live:${sessionCode}`, { config: { broadcast: { self: false } } });
    channel.subscribe();
    const intervalId = setInterval(() => {
      channel.send({ type: 'broadcast', event: 'host-state', payload: buildPayload(leaderStateRef.current) });
    }, 300);
    return () => {
      clearInterval(intervalId);
      sb.removeChannel(channel);
    };
  }, [isLeader, sessionCode]);

  // Follower LAN: WebSocket no servidor local do líder.
  useEffect(() => {
    if (!isFollowerLAN) return;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsMessage;
          if (data.type === 'CLIENT_JOINED') {
            myIpRef.current = data.ip ?? null;
          } else if (data.type === 'HOST_STATE') {
            const payload = data.payload;
            const myIp = myIpRef.current;
            const effectiveControl = !!myIp && payload.approvedIps.includes(myIp);
            setFollowerState(readHostState(payload, effectiveControl));
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [isFollowerLAN]);

  // Follower remoto: segue pela nuvem (Supabase Realtime). Read-only nesta fase.
  useEffect(() => {
    if (!isFollowerRemote || !remoteSession || !supabase) return;
    const sb = supabase;
    const channel = sb.channel(`live:${remoteSession}`);
    channel.on('broadcast', { event: 'host-state' }, ({ payload }) => {
      setFollowerState(readHostState(payload as HostStatePayload, false));
      setIsConnected(true);
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      sb.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [isFollowerRemote, remoteSession]);

  // Follower envia um comando pro líder (LAN via WebSocket, remoto via Realtime).
  const sendCommand = (action: string, extra?: { index?: number; id?: string; value?: number }) => {
    if (isFollowerRemote && channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'command', payload: { action, ...(extra || {}) } });
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'COMMAND', action, ...(extra || {}) }));
    }
  };

  return {
    isFollowerMode,
    isConnected,
    // No líder: o mesmo estado que o celular leria (pulo ausente vira null).
    followerState: isLeader ? readHostState(buildPayload(leaderState), leaderState.controlEnabled) : followerState,
    sendCommand,
  };
}
