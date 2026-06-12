import { useState, useEffect, useRef } from 'react';
import type { Marker, WsMessage } from '../types';

export interface FollowerState {
  isPlaying: boolean;
  currentTime: number;
  songName: string | null;
  nextSongName: string | null;
  currentMarker: Marker | null;
  pitch: number;
  originalKey: string | null;
}

export function useLiveSync(leaderState: FollowerState) {
  const isLeader = !!window.playbackDesktop?.isElectron;
  const [followerState, setFollowerState] = useState<FollowerState>({
    isPlaying: false,
    currentTime: 0,
    songName: null,
    nextSongName: null,
    currentMarker: null,
    pitch: 0,
    originalKey: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isFollowerMode] = useState(!isLeader);

  // Refs para armazenar o estado mais recente do líder sem recriar o intervalo
  const leaderStateRef = useRef(leaderState);
  useEffect(() => {
    leaderStateRef.current = leaderState;
  }, [leaderState]);

  // Lógica do Líder (Emissor)
  useEffect(() => {
    if (!isLeader) return;

    // Transmite a cada 200ms para não sobrecarregar o WebSocket com os 60fps do requestAnimationFrame
    const intervalId = setInterval(() => {
      const state = leaderStateRef.current;
      const message: WsMessage = {
        type: 'HOST_STATE',
        payload: {
          isPlaying: state.isPlaying,
          currentTime: state.currentTime,
          songName: state.songName,
          nextSongName: state.nextSongName,
          currentMarker: state.currentMarker,
          pitch: state.pitch,
          originalKey: state.originalKey
        }
      };
      window.playbackDesktop?.broadcastState?.(message);
    }, 200);

    return () => clearInterval(intervalId);
  }, [isLeader]);

  // Lógica do Seguidor (Receptor)
  useEffect(() => {
    if (isLeader) return;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Usa o mesmo host e porta do servidor web atual
      ws = new WebSocket(`${protocol}//${window.location.host}`);

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsMessage;
          if (data.type === 'HOST_STATE') {
            setFollowerState(data.payload);
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Tenta reconectar a cada 3 segundos
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
  }, [isLeader]);

  return {
    isFollowerMode,
    isConnected,
    followerState: isLeader ? leaderState : followerState
  };
}
