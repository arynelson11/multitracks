import { useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Music, ListMusic, GripVertical, Edit2, Check, Image, Trash2, Loader2, Settings, Plus, FolderOpen, Download, Upload, X, ChevronRight, Cloud, Wand2 } from 'lucide-react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePadSynth } from './hooks/usePadSynth'
import { SettingsModal } from './components/SettingsModal'
import { LibraryModal } from './components/LibraryModal'
import { AdminModal } from './components/AdminModal'
import { AuthPage } from './components/AuthPage'
import { SeparatorStudio } from './components/SeparatorStudio'
import { useAuth } from './hooks/useAuth'
import { supabase, updateSongMarkers as saveMkToCloud, fetchSongs as fetchCloudSongs } from './lib/supabase'

export default function App() {
  const {
    isReady, initEngine, loadFiles, isLoading, isRestoring,
    playlist, activeSongIndex, setPlaylistOrder, jumpToSong,
    renameSong, setCoverImage, clearSession,
    setChannelBus, exportPlaylist, importPlaylist,
    channels, play, pause, seekTo, prevSong, nextSong, isPlaying, currentTime, duration,
    masterVolume, updateVolume, toggleMute, toggleSolo, updateMasterVolume,
    changePitch, currentMarker, setSongMarkers,
    playbackMode, setPlaybackMode, vampActive, toggleVamp,
    timeStretch, updateTimeStretch
  } = useAudioEngine()

  const { playPad, activeNote, loadCustomPad, clearCustomPad, customPads, customPadNames, padVolume, updatePadVolume, padMode, updatePadMode } = usePadSynth()
  const { user, loading, signOut } = useAuth()
  const mixerRef = useRef<HTMLDivElement>(null)

  const [isEditMode, setIsEditMode] = useState(false)
  const [isSeparatorOpen, setIsSeparatorOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [isSetlistMenuOpen, setIsSetlistMenuOpen] = useState(false)
  const [isPadEditMode, setIsPadEditMode] = useState(false)
  const [isTeleprompterMode, setIsTeleprompterMode] = useState(false)
  const [isMarkerEditorOpen, setIsMarkerEditorOpen] = useState(false)
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerLyrics, setMarkerLyrics] = useState('')
  const [markerColor, setMarkerColor] = useState('#10b981')
  const [mobileView, setMobileView] = useState<'mixer' | 'pads'>('mixer')
  const [isSaving, setIsSaving] = useState(false)

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Touch/drag scroll for mixer
  const mixerDragState = useRef({ isDown: false, startX: 0, scrollLeft: 0 })

  // V5: Scrubbing state
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [localDragTime, setLocalDragTime] = useState(0);

  const formatTime = (time: number) => {
    if (isNaN(time)) time = 0;
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Drag-and-drop handlers
  const handleDragStart = (index: number) => { setDragIndex(index) }
  const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index) }
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); setDragOverIndex(null); return }
    const newList = [...playlist]
    const [moved] = newList.splice(dragIndex, 1)
    newList.splice(index, 0, moved)
    setPlaylistOrder(newList)
    setDragIndex(null); setDragOverIndex(null)
  }
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }

  // Mixer touch/mouse drag scroll
  const onMixerMouseDown = (e: React.MouseEvent) => {
    const el = mixerRef.current; if (!el) return
    mixerDragState.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft }
    el.style.cursor = 'grabbing'
  }

  const onMixerMouseMove = (e: React.MouseEvent) => {
    if (!mixerDragState.current.isDown) return
    const el = mixerRef.current; if (!el) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    el.scrollLeft = mixerDragState.current.scrollLeft - (x - mixerDragState.current.startX) * 1.5
  }
  const onMixerMouseUp = () => {
    mixerDragState.current.isDown = false
    if (mixerRef.current) mixerRef.current.style.cursor = 'grab'
  }

  // Export handler (ZIP with audio)
  const handleExport = async () => {
    setIsSaving(true)
    setIsSetlistMenuOpen(false)
    await exportPlaylist()
    setIsSaving(false)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setIsSetlistMenuOpen(false)
    importPlaylist(file)
  }

  // ───────────────── AUTH BLOCKING ─────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 size={40} className="text-orange-500 animate-spin" />
      </div>
    )
  }

  if (!supabase) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white px-6">
        <h1 className="text-3xl font-bold mb-4 text-orange-500">Configuração Incompleta</h1>
        <p className="text-gray-400 text-center max-w-md mb-6 leading-relaxed">
          As variáveis de ambiente do banco de dados (<strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_ANON_KEY</strong>) não foram configuradas neste servidor.
        </p>
        <div className="bg-white/5 border border-white/10 p-6 rounded-2xl max-w-lg text-sm text-zinc-400 text-center">
          <p className="mb-2"><strong>Como resolver:</strong></p>
          <p>
            1. Acesse o painel da <strong>Vercel</strong>.<br />
            2. Vá em <strong>Settings &gt; Environment Variables</strong>.<br />
            3. Adicione as mesmas chaves que estão no seu arquivo <code>.env</code> local.<br />
            4. Vá em <strong>Deployments</strong> e clique em <strong>Redeploy</strong> no último build.
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  // ───────────────── SPLASH ─────────────────
  if (!isReady) {
    return (
      <div className="min-h-screen bg-background text-text-main flex flex-col items-center justify-center font-sans px-6">
        <div className="w-20 h-20 sm:w-24 sm:h-24 mb-6 bg-surface rounded-3xl flex items-center justify-center border border-white/5 shadow-2xl relative overflow-hidden">
          <Music size={36} className="text-primary relative z-10" />
          <div className="absolute inset-0 bg-primary/10 animate-pulse"></div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 text-center">Multitracks Playback</h1>
        <p className="text-text-muted mb-8 max-w-md text-center text-sm">
          Bem-vindo ao sistema de reprodução. O motor conectará ao seu banco de dados local.
        </p>
        <button onClick={initEngine}
          className="bg-primary hover:bg-emerald-400 text-black px-6 py-3 sm:px-8 sm:py-4 rounded-xl font-bold text-base sm:text-lg transition-all cursor-pointer shadow-[0_0_30px_rgba(16,185,129,0.3)] flex items-center gap-3">
          {isRestoring ? <Loader2 className="animate-spin" size={22} /> : <Play size={22} fill="currentColor" />}
          Iniciar Motor
        </button>
      </div>
    )
  }

  // ───────────────── MAIN APP ─────────────────
  return (
    <div className="min-h-screen bg-background text-text-main flex flex-col font-sans select-none overflow-hidden">

      {/* ═══ HEADER / TRANSPORT ═══ */}
      <header className="bg-surface border-b border-white/5 shrink-0">
        {/* Top row: Brand + Timer */}
        <div className="flex items-center justify-between px-3 sm:px-4 h-12 sm:h-14">
          {/* Left: Menu + Brand */}
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="relative">
              <button onClick={() => setIsSetlistMenuOpen(!isSetlistMenuOpen)}
                className="text-base sm:text-xl font-bold tracking-tighter hover:text-primary active:scale-95 transition-all duration-200 cursor-pointer flex items-center gap-1.5 focus:outline-none">
                <ListMusic size={18} className="text-primary" />
                <span className="hidden xs:inline">PLAYBACK</span>
              </button>

              {/* ─── Setlist Dropdown ─── */}
              {isSetlistMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsSetlistMenuOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 sm:w-80 bg-[#2c2c2e] rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                      <button onClick={() => setIsSetlistMenuOpen(false)} className="text-[#0A84FF] text-sm font-medium cursor-pointer">Cancelar</button>
                      <span className="text-white font-semibold text-sm">Repertórios</span>
                      <div className="w-14"></div>
                    </div>
                    <div className="p-2">
                      <button onClick={() => { clearSession(); setIsSetlistMenuOpen(false); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white font-medium flex items-center gap-3"><Plus size={18} className="text-[#0A84FF]" />Novo Repertório</span>
                        <ChevronRight size={16} className="text-text-muted" />
                      </button>
                      <label
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white font-medium flex items-center gap-3"><FolderOpen size={18} className="text-[#0A84FF]" />Importar Stems</span>
                        <ChevronRight size={16} className="text-text-muted" />
                        <input type="file" multiple accept="audio/*" className="hidden"
                          onChange={(e) => { if (e.target.files) { loadFiles(e.target.files); setIsSetlistMenuOpen(false) } }} />
                      </label>
                      <hr className="border-white/5 my-1" />
                      {playlist.length > 0 && (
                        <button onClick={handleExport} disabled={isSaving}
                          className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                          <span className="text-white font-medium flex items-center gap-3">
                            {isSaving ? <Loader2 size={18} className="text-emerald-400 animate-spin" /> : <Download size={18} className="text-emerald-400" />}
                            {isSaving ? 'Salvando...' : 'Salvar Repertório (.zip)'}
                          </span>
                          <ChevronRight size={16} className="text-text-muted" />
                        </button>
                      )}
                      <label
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white font-medium flex items-center gap-3"><Upload size={18} className="text-cyan-400" />Carregar Repertório (.zip)</span>
                        <ChevronRight size={16} className="text-text-muted" />
                        <input type="file" accept=".zip" className="hidden" onChange={handleImport} />
                      </label>
                    </div>
                    {playlist.length > 0 && (
                      <div className="border-t border-white/10 p-2">
                        <div className="px-4 py-2 text-[10px] font-bold text-text-muted/50 uppercase tracking-widest">Atual</div>
                        <div className="px-4 py-3 rounded-lg bg-white/5 flex items-center gap-3">
                          {playlist[0]?.coverImage ? (
                            <img src={playlist[0].coverImage} className="w-10 h-10 rounded-md object-cover" alt="" />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center"><Music size={16} className="text-primary" /></div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-medium text-sm truncate">Repertório Atual</div>
                            <div className="text-text-muted text-xs">{playlist.length} Músicas • {formatTime(playlist.reduce((acc, s) => acc + s.duration, 0))}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <label
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 active:scale-95 px-4 py-2.5 rounded-xl text-sm sm:text-base font-semibold border border-white/5 transition-all duration-200 cursor-pointer min-h-[48px] focus-within:ring-2 focus-within:ring-primary/50">
              <Music size={18} />
              <span className="hidden sm:inline">+</span> Stems
              <input type="file" multiple accept="audio/*" className="hidden"
                onChange={(e) => { if (e.target.files) loadFiles(e.target.files) }} />
            </label>
            <button onClick={() => setIsLibraryOpen(true)}
              className="flex items-center gap-2 bg-secondary/10 hover:bg-secondary/20 active:scale-95 text-secondary px-4 py-2.5 rounded-xl text-sm sm:text-base font-semibold border border-secondary/20 transition-all duration-200 cursor-pointer min-h-[48px] focus:outline-none focus:ring-2 focus:ring-secondary/50">
              <Cloud size={18} />
              <span className="hidden sm:inline">Biblioteca</span>
            </button>
            <button onClick={() => setIsSeparatorOpen(true)}
              className="flex items-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 active:scale-95 text-purple-400 px-4 py-2.5 rounded-xl text-sm sm:text-base font-semibold border border-purple-500/20 transition-all duration-200 cursor-pointer min-h-[48px] focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <Wand2 size={18} />
              <span className="hidden sm:inline">Separar Faixas</span>
            </button>
          </div>

          {/* Right: Actions + Timer */}
          <div className="flex items-center gap-3 sm:gap-4">

            {/* User Auth Profile */}
            <div className="flex items-center gap-2">
              <span className="text-white text-xs font-medium hidden sm:block bg-white/5 px-2 py-1 rounded-md">{user.email?.split('@')[0]}</span>
              <button onClick={signOut} className="text-xs text-text-muted hover:text-white transition-colors cursor-pointer hidden sm:block">Sair</button>
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shadow-inner cursor-pointer" onClick={signOut}>
                {user.email?.charAt(0).toUpperCase()}
              </div>
            </div>

            <div className="h-6 w-px bg-white/10 hidden sm:block mx-1"></div>

            {playlist.length > 0 && (
              <button onClick={clearSession} className="p-2 rounded-xl text-red-400 hover:bg-red-500/10 active:scale-90 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400/50"><Trash2 size={20} /></button>
            )}
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-xl text-text-muted hover:bg-white/10 hover:text-white active:scale-90 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"><Settings size={20} /></button>
            <button onClick={() => setIsEditMode(!isEditMode)}
              className={`items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95 border cursor-pointer hidden sm:flex focus:outline-none focus:ring-2 focus:ring-secondary/50 ${isEditMode ? 'bg-secondary/20 text-secondary border-secondary/30' : 'bg-transparent text-text-muted border-white/5 hover:bg-white/10'}`}>
              {isEditMode ? <Check size={16} /> : <Edit2 size={16} />}
              {isEditMode ? 'OK' : 'Editar'}
            </button>
            <div className="flex items-center bg-black/40 rounded-lg overflow-hidden border border-white/10 mr-1 sm:mr-3">
              <button
                onClick={() => changePitch((playlist[activeSongIndex]?.pitch || 0) - 1)}
                className="px-2 sm:px-3 py-1 sm:py-1.5 text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >-</button>
              <div className="px-1 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-xs font-bold text-white min-w-[36px] sm:min-w-[48px] text-center border-l border-r border-white/10 uppercase">
                {playlist[activeSongIndex]?.pitch ? (playlist[activeSongIndex].pitch > 0 ? '+' : '') + playlist[activeSongIndex].pitch : '0'} ST
              </div>
              <button
                onClick={() => changePitch((playlist[activeSongIndex]?.pitch || 0) + 1)}
                className="px-2 sm:px-3 py-1 sm:py-1.5 text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >+</button>
            </div>

            {/* Time-Stretch Speed Control */}
            <div className="flex items-center bg-white/5 rounded-lg border border-white/10">
              <span className="text-[9px] text-text-muted font-bold px-1.5">SPD</span>
              <button onClick={() => updateTimeStretch(Math.max(0.5, timeStretch - 0.05))} className="px-1.5 py-1 sm:py-1.5 text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs">-</button>
              <div className="px-1 py-1 sm:py-1.5 text-[10px] sm:text-xs font-bold text-white min-w-[36px] text-center border-l border-r border-white/10">{(timeStretch * 100).toFixed(0)}%</div>
              <button onClick={() => updateTimeStretch(Math.min(1.5, timeStretch + 0.05))} className="px-1.5 py-1 sm:py-1.5 text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs">+</button>
              {timeStretch !== 1 && <button onClick={() => updateTimeStretch(1)} className="text-[8px] text-red-400 cursor-pointer px-1.5 hover:bg-white/5 py-1">RST</button>}
            </div>


            <div className="font-mono text-base sm:text-xl tracking-wider text-secondary flex items-baseline gap-1.5 bg-black/40 px-3 sm:px-4 py-1.5 rounded-lg font-light">
              {formatTime(currentTime)}
              <span className="text-xs sm:text-sm text-text-muted">/ {formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* Transport Controls Row */}
        <div className="flex items-center justify-center gap-2 px-3 pb-2 sm:pb-3">
          <button onClick={prevSong} className="p-2.5 text-text-muted hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 active:scale-90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"><SkipBack size={22} /></button>
          <button onClick={isPlaying ? pause : play}
            className={`p-3.5 rounded-2xl transition-all duration-300 active:scale-90 shadow-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${isPlaying ? 'bg-primary/20 text-primary hover:bg-primary/30 shadow-primary/20' : 'bg-white/5 text-white hover:bg-white/15'}`}>
            {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
          </button>
          <button onClick={nextSong} className="p-2.5 text-text-muted hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 active:scale-90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"><SkipForward size={22} /></button>

          {/* VAMP Toggle */}
          <button
            onClick={toggleVamp}
            className={`ml-1 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 active:scale-90 cursor-pointer border ${vampActive
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse'
                : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10 hover:text-white'
              }`}
            title={vampActive ? 'Desativar VAMP (Loop Infinito)' : 'Ativar VAMP: loop seção atual'}
          >
            {vampActive ? '🔁 VAMP' : '🔁'}
          </button>

          {/* Playback Mode Selector */}
          <div className="hidden sm:flex items-center bg-black/40 rounded-lg overflow-hidden border border-white/10 ml-1">
            <button
              onClick={() => setPlaybackMode('continue')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${playbackMode === 'continue' ? 'bg-primary/20 text-primary' : 'text-text-muted hover:text-white hover:bg-white/5'
                }`}
              title="Continuar para próxima música"
            >▶ Auto</button>
            <button
              onClick={() => setPlaybackMode('stop')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase border-l border-r border-white/10 transition-all cursor-pointer ${playbackMode === 'stop' ? 'bg-red-500/20 text-red-400' : 'text-text-muted hover:text-white hover:bg-white/5'
                }`}
              title="Parar ao final da música"
            >⏹ Stop</button>
            <button
              onClick={() => setPlaybackMode('fade-out')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${playbackMode === 'fade-out' ? 'bg-purple-500/20 text-purple-400' : 'text-text-muted hover:text-white hover:bg-white/5'
                }`}
              title="Fade out nos últimos 5 segundos"
            >🔉 Fade</button>
          </div>

          {/* Mobile edit toggle */}
          <button onClick={() => setIsEditMode(!isEditMode)}
            className={`sm:hidden ml-2 items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors border cursor-pointer flex ${isEditMode ? 'bg-secondary/20 text-secondary border-secondary/30' : 'bg-transparent text-text-muted border-white/5'}`}>
            {isEditMode ? <Check size={12} /> : <Edit2 size={12} />}
          </button>
        </div>
      </header>

      {/* Loading bar */}
      {(isLoading || isRestoring) && (
        <div className="h-1 bg-primary/20 overflow-hidden z-50"><div className="h-full bg-primary animate-pulse w-full"></div></div>
      )}

      {/* ═══ SETLIST AREA ═══ */}
      <section className="h-24 sm:h-32 border-b border-white/5 bg-black/40 flex items-center px-3 sm:px-4 gap-3 overflow-x-auto shrink-0 relative">
        <div className="absolute left-3 sm:left-4 top-1.5 text-[9px] sm:text-[10px] font-bold text-text-muted/40 uppercase tracking-widest">Repertório</div>
        <div className="w-full flex items-center gap-2 sm:gap-3 pt-3">
          {playlist.map((song, i) => (
            <div key={song.id}
              draggable={isEditMode}
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              onClick={() => !isEditMode && jumpToSong(i)}
              className={`
                flex-none w-52 sm:w-72 h-16 sm:h-20 rounded-xl flex items-center p-2 gap-2 sm:gap-3 border transition-all overflow-hidden relative
                ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-white/20'}
                ${isEditMode && dragOverIndex === i ? 'border-secondary border-2 bg-secondary/10' : ''}
                ${isEditMode && dragIndex === i ? 'opacity-40' : ''}
                ${i === activeSongIndex && !isEditMode ? 'bg-primary/10 border-primary/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-surface border-white/5 text-text-muted'}
                ${isEditMode && !(dragOverIndex === i) && !(dragIndex === i) ? 'border-dashed border-white/20' : ''}
              `}>
              {/* Cover */}
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-md bg-black/40 flex-shrink-0 overflow-hidden relative group flex items-center justify-center border border-white/5">
                {song.coverImage ? (
                  <img src={song.coverImage} className="w-full h-full object-cover" alt="" />
                ) : (
                  <Image size={20} className="opacity-20" />
                )}
                {isEditMode && (
                  <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                    <Edit2 size={12} className="text-white mb-0.5" />
                    <span className="text-[8px] font-bold text-white uppercase">Capa</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { const reader = new FileReader(); reader.onload = (ev) => setCoverImage(song.id, ev.target?.result as string); reader.readAsDataURL(f); }
                    }} />
                  </label>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center min-w-0 pr-1">
                {isEditMode ? (
                  <>
                    <input type="text"
                      className="w-full bg-black/40 text-xs sm:text-sm font-semibold text-white px-2 py-1 rounded border border-white/10 outline-none focus:border-secondary mb-0.5 transition-colors"
                      value={song.name}
                      onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} draggable={false}
                      onChange={(e) => renameSong(song.id, e.target.value)}
                    />
                    <div className="flex items-center gap-1 text-text-muted/50">
                      <GripVertical size={12} /><span className="text-[9px]">Arraste</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`font-semibold text-xs sm:text-sm truncate mb-0.5 ${i === activeSongIndex ? 'text-white' : 'text-text-main'}`}>
                      {i + 1}. {song.name}
                    </div>
                    <div className="text-[10px] sm:text-xs opacity-60 font-mono flex items-center justify-between">
                      <div className="flex items-center gap-1 text-primary">
                        {i === activeSongIndex && isPlaying && <Play size={8} fill="currentColor" />}
                        {i === activeSongIndex && !isPlaying && <div className="w-1 h-1 rounded-full bg-primary/50"></div>}
                      </div>
                      {formatTime(song.duration)}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {playlist.length === 0 && (
            <div className="text-xs sm:text-sm text-text-muted/50 flex flex-col items-center justify-center w-full py-2 gap-1">
              <ListMusic size={20} className="opacity-50" />
              <span>Clique em "Stems" para adicionar músicas</span>
            </div>
          )}
        </div>
      </section>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Timeline */}
        <section className="border-b border-white/5 px-3 sm:px-4 py-1.5 sm:py-2 flex flex-col relative shrink-0">
          {/* Progress Bar */}
          <div className="h-6 sm:h-8 bg-surface rounded-md relative overflow-hidden border border-white/5 cursor-pointer group">
            {/* Fill */}
            <div className="absolute inset-y-0 left-0 bg-primary/20 transition-none pointer-events-none" style={{ width: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />
            {/* Playhead */}
            <div className="absolute inset-y-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)] z-10 pointer-events-none" style={{ left: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />

            {/* Marker lines inside bar */}
            {playlist[activeSongIndex]?.markers?.map((marker) => (
              <div
                key={marker.id}
                className="absolute inset-y-0 w-px pointer-events-none z-[5]"
                style={{
                  left: duration > 0 ? `${(marker.time / duration) * 100}%` : '0%',
                  backgroundColor: `${marker.color || '#fff'}40`
                }}
              />
            ))}

            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={isDraggingTimeline ? localDragTime : currentTime}
              onMouseDown={() => {
                setIsDraggingTimeline(true);
                setLocalDragTime(currentTime);
              }}
              onTouchStart={() => {
                setIsDraggingTimeline(true);
                setLocalDragTime(currentTime);
              }}
              onChange={(e) => {
                setLocalDragTime(parseFloat(e.target.value));
              }}
              onMouseUp={(e) => {
                setIsDraggingTimeline(false);
                seekTo(parseFloat((e.target as HTMLInputElement).value));
              }}
              onTouchEnd={(e) => {
                setIsDraggingTimeline(false);
                seekTo(parseFloat((e.target as HTMLInputElement).value));
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            />
          </div>

          {/* Section Markers Row (below bar) */}
          {playlist[activeSongIndex]?.markers && playlist[activeSongIndex].markers!.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto scrollbar-hide">
              {playlist[activeSongIndex].markers!.map((marker) => {
                const isActive = currentMarker?.id === marker.id;
                return (
                  <button
                    key={marker.id}
                    onClick={() => seekTo(marker.time)}
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide transition-all duration-200 cursor-pointer active:scale-95 border ${isActive
                      ? 'shadow-lg scale-105'
                      : 'opacity-60 hover:opacity-100'
                      }`}
                    style={{
                      color: marker.color || '#fff',
                      borderColor: isActive ? marker.color || '#fff' : `${marker.color || '#fff'}30`,
                      backgroundColor: isActive ? `${marker.color || '#fff'}20` : 'transparent',
                      boxShadow: isActive ? `0 0 12px ${marker.color || '#fff'}30` : 'none'
                    }}
                  >
                    {marker.label}
                  </button>
                );
              })}
              {/* Marker Editor Toggle (Admin only) */}
              {user?.email === 'arynelson11@gmail.com' && (
                <button
                  onClick={() => setIsMarkerEditorOpen(!isMarkerEditorOpen)}
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide cursor-pointer active:scale-95 border transition-all ${isMarkerEditorOpen ? 'bg-primary/20 text-primary border-primary/40' : 'text-text-muted border-white/10 hover:bg-white/5'}`}
                >
                  ✏️ Editar
                </button>
              )}
            </div>
          )}

          {/* No markers yet + admin can add */}
          {(!playlist[activeSongIndex]?.markers || playlist[activeSongIndex].markers!.length === 0) && user?.email === 'arynelson11@gmail.com' && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                onClick={() => setIsMarkerEditorOpen(!isMarkerEditorOpen)}
                className="shrink-0 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide cursor-pointer active:scale-95 border text-text-muted border-white/10 hover:bg-white/5"
              >
                + Adicionar Marcadores
              </button>
            </div>
          )}

          {/* ─── Marker Editor Panel (Admin) ─── */}
          {isMarkerEditorOpen && user?.email === 'arynelson11@gmail.com' && (
            <div className="mt-1.5 bg-black/40 rounded-lg border border-white/10 p-2 sm:p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Editor de Marcadores</span>
                <button onClick={() => setIsMarkerEditorOpen(false)} className="text-text-muted hover:text-white text-xs cursor-pointer">✕</button>
              </div>
              {/* Add Marker Form */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={markerLabel}
                  onChange={(e) => setMarkerLabel(e.target.value)}
                  placeholder="Seção (ex: Verso 1)"
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder-text-muted/50 w-28 sm:w-36 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <input
                  type="text"
                  value={markerLyrics}
                  onChange={(e) => setMarkerLyrics(e.target.value)}
                  placeholder="Letra (opcional)"
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder-text-muted/50 flex-1 min-w-[100px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="flex items-center gap-1">
                  {['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'].map(c => (
                    <button
                      key={c}
                      onClick={() => setMarkerColor(c)}
                      className={`w-4 h-4 rounded-full cursor-pointer transition-all ${markerColor === c ? 'ring-2 ring-white scale-110' : 'opacity-50 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (!markerLabel.trim()) return;
                    const activeSong = playlist[activeSongIndex];
                    if (!activeSong) return;
                    const newMarker = {
                      id: crypto.randomUUID(),
                      time: currentTime,
                      label: markerLabel.trim(),
                      lyrics: markerLyrics.trim() || undefined,
                      color: markerColor
                    };
                    const newMarkers = [...(activeSong.markers || []), newMarker].sort((a, b) => a.time - b.time);
                    setSongMarkers(activeSong.id, newMarkers);
                    setMarkerLabel('');
                    setMarkerLyrics('');
                  }}
                  className="bg-primary/20 text-primary px-3 py-1 rounded-md text-xs font-bold hover:bg-primary/30 cursor-pointer active:scale-95 transition-all border border-primary/30"
                >
                  + {formatTime(currentTime)}
                </button>
              </div>
              {/* Existing Markers List */}
              {playlist[activeSongIndex]?.markers && playlist[activeSongIndex].markers!.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {playlist[activeSongIndex].markers!.map((m) => (
                    <div key={m.id} className="flex items-center gap-1 bg-white/5 rounded-md px-1.5 py-0.5 text-[10px] border border-white/5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color || '#fff' }}></span>
                      <span className="text-white/80 font-medium">{formatTime(m.time)}</span>
                      <span className="text-white/60">{m.label}</span>
                      <button
                        onClick={() => {
                          const activeSong = playlist[activeSongIndex];
                          if (!activeSong) return;
                          const newMarkers = (activeSong.markers || []).filter(x => x.id !== m.id);
                          setSongMarkers(activeSong.id, newMarkers);
                        }}
                        className="text-red-400/60 hover:text-red-400 cursor-pointer ml-0.5"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {/* Save to Cloud button */}
              <button
                onClick={async () => {
                  const activeSong = playlist[activeSongIndex];
                  if (!activeSong?.markers) return;
                  const cloudSongs = await fetchCloudSongs();
                  const match = cloudSongs.find((cs: any) => activeSong.name.includes(cs.name) || cs.name.includes(activeSong.name));
                  if (match) {
                    const ok = await saveMkToCloud(match.id, activeSong.markers);
                    if (ok) alert('Marcadores salvos na nuvem! ☁️');
                    else alert('Erro ao salvar marcadores.');
                  } else {
                    alert('Música não encontrada na biblioteca cloud. Salve apenas localmente.');
                  }
                }}
                className="mt-2 bg-secondary/10 text-secondary px-3 py-1 rounded-md text-[10px] font-bold hover:bg-secondary/20 cursor-pointer active:scale-95 transition-all border border-secondary/20 w-full text-center"
              >
                ☁️ Salvar Marcadores na Nuvem
              </button>
            </div>
          )}
        </section>

        {/* ─── Mobile View Toggle ─── */}
        <div className="flex lg:hidden border-b border-white/5 bg-surface/50 shrink-0">
          <button onClick={() => setMobileView('mixer')}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${mobileView === 'mixer' ? 'text-primary border-b-2 border-primary' : 'text-text-muted'}`}>
            🎚️ Mixer
          </button>
          <button onClick={() => setMobileView('pads')}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${mobileView === 'pads' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted'}`}>
            🎹 Pads
          </button>
        </div>

        {/* ─── Lower Split ─── */}
        <section className="flex-1 flex overflow-hidden">

          {/* ═══ MIXER ═══ */}
          <div ref={mixerRef}
            className={`bg-black/20 overflow-x-auto flex flex-nowrap items-end p-3 sm:p-4 gap-2
              ${mobileView === 'mixer' ? 'flex' : 'hidden'} lg:flex flex-1`}
            style={{ cursor: 'grab', touchAction: 'pan-x' }}
            onMouseDown={onMixerMouseDown} onMouseMove={onMixerMouseMove} onMouseUp={onMixerMouseUp} onMouseLeave={onMixerMouseUp}>

            {channels.map((ch) => (
              <div key={ch.id} className="w-20 sm:w-24 h-full bg-surface rounded-lg border border-white/5 flex flex-col items-center p-1.5 sm:p-2 pt-3 sm:pt-4 flex-shrink-0 relative overflow-hidden">
                {(isPlaying && ch.volume > 0 && !ch.muted && (!channels.some(c => c.soloed) || ch.soloed)) && (
                  <div className="absolute inset-0 border border-primary/20 rounded-lg pointer-events-none"></div>
                )}
                <div className="font-semibold text-[10px] sm:text-xs tracking-wider text-text-muted truncate w-full text-center mb-2 sm:mb-4 uppercase" title={ch.name}>
                  {ch.name.length > 7 ? ch.name.substring(0, 7) + '..' : ch.name}
                </div>
                <div className="absolute top-1.5 right-1.5 opacity-30">
                  <div className="text-[7px] sm:text-[8px]">{ch.bus === '1' ? 'L' : ch.bus === '2' ? 'R' : 'C'}</div>
                </div>
                <div className="flex gap-1 mb-2 sm:mb-4 w-full px-0.5">
                  <button onClick={() => toggleMute(ch.id)} className={`flex-1 h-7 sm:h-9 rounded-md text-[10px] sm:text-xs font-bold transition-all duration-200 active:scale-90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500/50 ${ch.muted ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-red-500/10 text-red-500/50 border border-red-500/20 hover:bg-red-500/30 text-red-400'}`}>M</button>
                  <button onClick={() => toggleSolo(ch.id)} className={`flex-1 h-7 sm:h-9 rounded-md text-[10px] sm:text-xs font-bold transition-all duration-200 active:scale-90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-500/50 ${ch.soloed ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-yellow-500/10 text-yellow-500/50 border border-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400'}`}>S</button>
                </div>
                <div className="flex-1 w-full flex justify-center py-1 sm:py-2 relative">
                  <input type="range" min="0" max="1.2" step="0.01" value={ch.volume}
                    onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                    onChange={(e) => updateVolume(ch.id, parseFloat(e.target.value))}
                    className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                    style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                  <div className="h-full w-2 sm:w-2.5 bg-black/60 rounded-full relative overflow-hidden pointer-events-none border border-white/5 shadow-inner">
                    <div className="absolute bottom-0 w-full transition-all duration-75" style={{ height: `${(ch.volume / 1.2) * 100}%`, backgroundColor: (channels.some(c => c.soloed) && !ch.soloed) || ch.muted ? '#ef4444' : '#06b6d4' }}></div>
                  </div>
                  <div className="absolute w-8 sm:w-10 h-4 sm:h-5 bg-white/10 rounded-sm border border-white/20 shadow-lg pointer-events-none transition-all duration-75 z-20 backdrop-blur-sm" style={{ bottom: `calc(${(ch.volume / 1.2) * 100}% - 8px)` }}>
                    <div className="w-full h-[2px] bg-white/80 mt-1.5 sm:mt-2 shadow-[0_0_5px_rgba(255,255,255,0.5)]"></div>
                  </div>
                </div>
                <div className="mt-2 sm:mt-4 text-[10px] sm:text-xs font-mono text-white/40">{Math.round(ch.volume * 100)}%</div>
              </div>
            ))}

            {playlist.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-text-muted/50 border-2 border-dashed border-white/5 rounded-2xl flex-col gap-3 p-4">
                <Music size={36} className="opacity-20" />
                <span className="text-xs sm:text-sm text-center">Importe os stems de uma música</span>
              </div>
            )}

            <div className="flex-1"></div>

            {/* Master Fader */}
            <div className="w-24 sm:w-28 h-full bg-surface rounded-xl border border-white/5 flex flex-col items-center p-1.5 sm:p-2 pt-3 sm:pt-4 flex-shrink-0 ml-2 sm:ml-4 shadow-xl relative">
              <div className="font-bold text-[10px] sm:text-xs tracking-wider text-primary w-full text-center mb-4 sm:mb-6 uppercase">MASTER</div>
              <div className="flex-1 w-full flex justify-center py-1 sm:py-2 relative">
                <input type="range" min="0" max="1.2" step="0.01" value={masterVolume}
                  onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                  onChange={(e) => updateMasterVolume(parseFloat(e.target.value))}
                  className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                  style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                <div className="h-full w-3 sm:w-4 bg-black/60 rounded-full relative overflow-hidden pointer-events-none border border-white/5 shadow-inner">
                  <div className="absolute bottom-0 w-full transition-all duration-75 bg-primary" style={{ height: `${(masterVolume / 1.2) * 100}%` }}></div>
                </div>
                <div className="absolute w-12 sm:w-14 h-6 sm:h-7 bg-[#222] border border-primary/40 shadow-2xl rounded-sm pointer-events-none transition-all duration-75 z-20 overflow-hidden" style={{ bottom: `calc(${(masterVolume / 1.2) * 100}% - 12px)` }}>
                  <div className="w-full h-1 bg-primary mt-2.5 sm:mt-3 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                </div>
              </div>
              <div className="mt-2 sm:mt-4 text-[10px] sm:text-xs font-mono text-primary/80 font-bold mb-1">{Math.round(masterVolume * 100)}%</div>
            </div>
          </div>

          {/* ═══ PAD PLAYER ═══ */}
          <div className={`bg-surface border-l border-white/5 p-3 sm:p-4 flex flex-col z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]
            ${mobileView === 'pads' ? 'flex w-full' : 'hidden'} lg:flex lg:w-96`}>
            <div className="font-semibold text-xs tracking-wider text-text-muted mb-2 flex justify-between uppercase items-center">
              <span>Ambient Pad Player</span>
              <button onClick={() => setIsPadEditMode(!isPadEditMode)}
                className={`text-[10px] border px-2 py-0.5 rounded-lg font-bold cursor-pointer transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-secondary/50 ${isPadEditMode ? 'bg-secondary/20 text-secondary border-secondary/30' : 'border-secondary/30 text-secondary bg-secondary/5 hover:bg-secondary/15'}`}>
                {isPadEditMode ? 'OK' : 'EDITAR'}
              </button>
            </div>

            {/* Pad Source Selector */}
            <div className="flex bg-black/40 rounded-xl p-1 mb-3 border border-white/5">
              <button onClick={() => updatePadMode('system')} className={`flex-1 py-1.5 text-[10px] sm:text-[11px] font-bold rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-secondary/50 ${padMode === 'system' ? 'bg-secondary/20 text-secondary shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-text-muted hover:text-white hover:bg-white/5'}`}>NUVEM</button>
              <button onClick={() => updatePadMode('synth')} className={`flex-1 py-1.5 text-[10px] sm:text-[11px] font-bold rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-secondary/50 ${padMode === 'synth' ? 'bg-secondary/20 text-secondary shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-text-muted hover:text-white hover:bg-white/5'}`}>SYNTH</button>
              <button onClick={() => updatePadMode('custom')} className={`flex-1 py-1.5 text-[10px] sm:text-[11px] font-bold rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-secondary/50 ${padMode === 'custom' ? 'bg-secondary/20 text-secondary shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-text-muted hover:text-white hover:bg-white/5'}`}>LOCAL</button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-3 mb-3 px-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold shrink-0">Vol</span>
              <input type="range" min="0" max="1" step="0.01" value={padVolume}
                onChange={(e) => updatePadVolume(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-secondary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg" />
              <span className="text-[10px] text-text-muted font-mono w-8 text-right">{Math.round(padVolume * 100)}%</span>
            </div>
            {/* Grid */}
            <div className="flex-1 grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-3 gap-2 sm:gap-3">
              {['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].map(note => (
                <div key={note} className="relative">
                  <button onClick={() => !isPadEditMode && playPad(note)}
                    className={`
                      w-full h-full rounded-2xl flex flex-col items-center justify-center text-lg sm:text-2xl font-bold transition-all duration-200 cursor-pointer min-h-[50px] sm:min-h-[60px] active:scale-95 focus:outline-none focus:ring-2 focus:ring-secondary/50
                      ${activeNote === note
                        ? 'bg-secondary/20 text-secondary border border-secondary/50 shadow-[0_0_20px_rgba(6,182,212,0.4)] ring-1 ring-secondary scale-[1.02]'
                        : customPads.has(note) ? 'bg-purple-900/30 text-purple-300 border border-purple-500/30 hover:bg-purple-900/50 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-white/5 text-text-main hover:bg-white/10 border border-white/5'}
                    `}>
                    <span>{note}</span>
                    {customPads.has(note) && <span className="text-[7px] sm:text-[8px] mt-0.5 opacity-60 truncate max-w-full px-1">{customPadNames.get(note) || 'Custom'}</span>}
                    {activeNote === note && <span className="text-[8px] sm:text-[9px] tracking-widest font-medium opacity-60 uppercase text-secondary">Playing</span>}
                  </button>
                  {isPadEditMode && (
                    <div className="absolute inset-0 bg-black/80 rounded-xl flex flex-col items-center justify-center gap-1 z-10 border border-white/10">
                      <label className="text-[8px] sm:text-[9px] font-bold text-white uppercase cursor-pointer hover:text-secondary transition-colors flex items-center gap-1">
                        <Upload size={10} />Carregar
                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadCustomPad(note, f) }} />
                      </label>
                      {customPads.has(note) && (
                        <button onClick={() => clearCustomPad(note)} className="text-[8px] sm:text-[9px] font-bold text-red-400 hover:text-red-300 cursor-pointer flex items-center gap-1">
                          <X size={9} /> Remover
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        channels={channels}
        onSetChannelBus={setChannelBus}
        onOpenAdmin={() => setIsAdminOpen(true)}
      />

      {/* Library Modal */}
      <LibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onDownload={async (files, songName, coverUrl, markers) => {
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));
          await loadFiles(dt.files, songName, coverUrl || undefined, markers);
        }}
      />

      {/* Admin Modal */}
      {user?.email === 'arynelson11@gmail.com' && (
        <AdminModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
      )}

      {/* ═══ TELEPROMPTER OVERLAY ═══ */}
      {isTeleprompterMode && (
        <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-4 sm:p-6 border-b border-white/5">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white/50">Teleprompter</h2>
            <button onClick={() => setIsTeleprompterMode(false)} className="p-2 sm:p-3 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-white/80 border border-white/10">
              <X size={24} />
            </button>
          </div>
          {/* Body */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-16 relative">
            {!playlist[activeSongIndex]?.markers || playlist[activeSongIndex].markers!.length === 0 ? (
              <div className="text-text-muted/50 text-xl font-medium tracking-wide">
                Nenhum marcador configurado para esta música.
              </div>
            ) : (
              <div className="w-full max-w-5xl flex flex-col gap-6 lg:gap-8 items-center text-center">
                {currentMarker ? (
                  <>
                    <span
                      className="px-4 py-1.5 rounded-full text-base font-bold tracking-widest uppercase mb-4"
                      style={{ backgroundColor: `${currentMarker.color || '#10b981'}20`, color: currentMarker.color || '#10b981' }}
                    >
                      {currentMarker.label}
                    </span>
                    <h1
                      className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-tight text-white/95"
                      style={{ whiteSpace: 'pre-wrap', textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                    >
                      {currentMarker.lyrics || '—'}
                    </h1>
                  </>
                ) : (
                  <div className="text-text-muted/50 text-3xl font-bold tracking-wide animate-pulse">
                    Aguardando Seção...
                  </div>
                )}
              </div>
            )}
            {/* Mini progress bar */}
            <div className="absolute bottom-8 left-8 right-8 text-center text-text-muted/30 font-mono tracking-widest uppercase text-sm font-bold flex flex-col items-center gap-2">
              <div className="h-1 w-full max-w-md bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-white/20 transition-all duration-75" style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}></div>
              </div>
              {playlist[activeSongIndex]?.name || 'Nenhuma Selecionada'}
            </div>
          </div>
        </div>
      )}

      {isSeparatorOpen && (
        <SeparatorStudio
          onClose={() => setIsSeparatorOpen(false)}
          onImportToLibrary={() => {
             alert("Faixas exportadas com sucesso! Implementar o download para o formato do player principal.")
          }}
        />
      )}
    </div>
  )
}
