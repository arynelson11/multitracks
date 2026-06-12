import { Wifi, WifiOff, Music, FastForward, Clock, Activity } from 'lucide-react';
import type { FollowerState } from '../hooks/useLiveSync';

interface FollowerViewProps {
  state: FollowerState;
  isConnected: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPitch(pitch: number): string {
  if (pitch === 0) return 'Original';
  return pitch > 0 ? `+${pitch}` : `${pitch}`;
}

export function FollowerView({ state, isConnected }: FollowerViewProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-zinc-950 to-emerald-900/10 pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50" />
      
      {/* Status Badge */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 backdrop-blur-md border border-white/10 shadow-lg transition-all duration-500 z-10">
        {isConnected ? (
          <>
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400 text-sm font-medium tracking-wide">Sincronizado</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4 text-red-400" />
            <span className="text-red-400 text-sm font-medium tracking-wide">Desconectado</span>
          </>
        )}
      </div>

      <div className="w-full max-w-4xl space-y-8 z-10">
        
        {/* Main Content Area */}
        <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-8 sm:p-12 shadow-2xl flex flex-col items-center text-center space-y-6">
          
          <div className="space-y-2">
            <h3 className="text-indigo-400 font-semibold tracking-widest uppercase text-sm flex items-center justify-center gap-2">
              <Music className="w-4 h-4" /> Tocando Agora
            </h3>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white/90 drop-shadow-md">
              {state.songName || 'Aguardando líder...'}
            </h1>
          </div>

          {state.currentMarker && (
            <div className="px-6 py-2 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-xl font-medium shadow-inner">
              {state.currentMarker.label}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full pt-8">
            {/* Time */}
            <div className="bg-black/30 rounded-2xl p-4 border border-white/5 flex flex-col items-center justify-center gap-1">
              <Clock className="w-5 h-5 text-zinc-400 mb-1" />
              <span className="text-3xl font-light font-mono text-zinc-200">{formatTime(state.currentTime)}</span>
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Tempo</span>
            </div>

            {/* Pitch */}
            <div className="bg-black/30 rounded-2xl p-4 border border-white/5 flex flex-col items-center justify-center gap-1">
              <Activity className="w-5 h-5 text-emerald-400 mb-1" />
              <span className="text-3xl font-bold text-emerald-300">
                {formatPitch(state.pitch)}
              </span>
              <span className="text-xs text-emerald-500/70 uppercase tracking-widest font-semibold">Tom</span>
            </div>

            {/* Status (Playing/Paused) */}
            <div className="bg-black/30 rounded-2xl p-4 border border-white/5 flex flex-col items-center justify-center gap-1 col-span-2 md:col-span-2">
               <span className={`text-2xl font-medium ${state.isPlaying ? 'text-emerald-400' : 'text-amber-400'}`}>
                 {state.isPlaying ? '▶ EM REPRODUÇÃO' : '⏸ PAUSADO'}
               </span>
               <span className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mt-2">Status</span>
            </div>
          </div>
        </div>

        {/* Next Song Bar */}
        {state.nextSongName && (
          <div className="bg-indigo-950/40 backdrop-blur-md rounded-2xl border border-indigo-500/20 p-6 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <FastForward className="w-6 h-6 text-indigo-400" />
              </div>
              <div className="text-left">
                <h4 className="text-indigo-400 text-sm font-semibold uppercase tracking-wider mb-1">Próxima Música</h4>
                <p className="text-2xl font-medium text-white/80">{state.nextSongName}</p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
