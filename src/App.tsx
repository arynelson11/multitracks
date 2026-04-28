import { useRef, useState, useEffect, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, Music, ListMusic, GripVertical, Edit2, Check, Trash2, Loader2, Settings, Plus, FolderOpen, Download, Upload, X, ChevronRight, Cloud, Wand2, Timer, Move, LogOut, Shield, Home } from 'lucide-react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePadSynth } from './hooks/usePadSynth'
import { SettingsModal } from './components/SettingsModal'
import { MetronomeModal } from './components/MetronomeModal'
import { LibraryModal } from './components/LibraryModal'
import { AdminModal } from './components/AdminModal'
import { AdminDashboard } from './components/AdminDashboard'
import { PadSetsModal } from './components/PadSetsModal'
import { AuthPage } from './components/AuthPage'
import { SeparatorStudio } from './components/SeparatorStudio'
import { LandingPage } from './components/LandingPage'
import { useAuth } from './hooks/useAuth'
import { PricingModal } from './components/PricingModal'
import { supabase, updateSongMarkers as saveMkToCloud, fetchSongs as fetchCloudSongs } from './lib/supabase'

export default function App() {
  const { user, loading, signOut, userPlan } = useAuth()

  const {
    isReady, initEngine, loadFiles, isLoading, isRestoring,
    playlist, activeSongIndex, setPlaylistOrder, removeSongFromPlaylist, jumpToSong,
    renameSong, setCoverImage, clearSession,
    setChannelBus, exportPlaylist, importPlaylist,
    channels, pause, seekTo, prevSong, nextSong, isPlaying, currentTime, duration,
    masterVolume, updateVolume, toggleMute, toggleSolo, updateMasterVolume,
    changePitch, setOriginalKey, currentMarker, setSongMarkers,
    playbackMode, setPlaybackMode,
    addChannelToActiveSong,
    updatePan, removeChannel, reorderChannels,
    precountEnabled, precountBeats, isCountingIn,
    setPrecountBeats, togglePrecountEnabled, playWithPrecount, cancelCountIn,
    createEndlessMetronomeSong,
  } = useAudioEngine(user?.id)

  const { playPad, activeNote, loadCustomPad, clearCustomPad, customPads, customPadNames, padVolume, updatePadVolume, selectedPadSet, selectPadSet, padMode } = usePadSynth()
  const [isPricingOpen, setIsPricingOpen] = useState(false)
  const mixerRef = useRef<HTMLDivElement>(null)

  const [showAuth, setShowAuth] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isChannelEditMode, setIsChannelEditMode] = useState(false)
  const [isSeparatorOpen, setIsSeparatorOpen] = useState(false)
  const [forceShowSplash, setForceShowSplash] = useState(false)
  const [isMetronomeModalOpen, setIsMetronomeModalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState(false)
  const [isSetlistMenuOpen, setIsSetlistMenuOpen] = useState(false)
  const [isTracksMenuOpen, setIsTracksMenuOpen] = useState(false)
  const [isPadEditMode, setIsPadEditMode] = useState(false)
  const [isPadSetsModalOpen, setIsPadSetsModalOpen] = useState(false)
  const [isTeleprompterMode, setIsTeleprompterMode] = useState(false)
  const [isMarkerEditorOpen, setIsMarkerEditorOpen] = useState(false)
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerLyrics, setMarkerLyrics] = useState('')
  const [markerColor, setMarkerColor] = useState('#10b981')
  const [mobileView, setMobileView] = useState<'mixer' | 'pads'>('mixer')
  const [isSaving, setIsSaving] = useState(false)
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false)
  const [isPrecountOpen, setIsPrecountOpen] = useState(false)
  const [chDragIdx, setChDragIdx] = useState<number | null>(null)
  const [chDragOverIdx, setChDragOverIdx] = useState<number | null>(null)
  const [vuLevels, setVuLevels] = useState<Record<string, number>>({})
  const [repertoireNotes, setRepertoireNotes] = useState('')

  useEffect(() => {
    if (user?.id) setRepertoireNotes(localStorage.getItem(`repertoire_notes_${user.id}`) || '')
  }, [user?.id])

  useEffect(() => {
    if (user?.id) localStorage.setItem(`repertoire_notes_${user.id}`, repertoireNotes)
  }, [repertoireNotes, user?.id])

  // ── Checkout Intent Logic ──
  useEffect(() => {
    if (user && !loading) {
      const intent = localStorage.getItem('checkoutIntent')
      if (intent) {
        setIsPricingOpen(true)
        localStorage.removeItem('checkoutIntent')
      }
    }
  }, [user, loading])

  // Helper for Premium Features
  const handlePremiumFeature = (action: () => void) => {
    if (userPlan === 'free') {
      setIsPricingOpen(true)
      return
    }
    action()
  }

  const analysersRef = useRef<Record<string, AnalyserNode>>({})
  const vuAnimRef = useRef<number>(0)

  // ── Instrument group classification ──
  const getChannelGroup = useCallback((name: string): { group: string; color: string; order: number } => {
    const n = name.toLowerCase()
    if (n.includes('click') || n.includes('metronom') || n.includes('metro')) return { group: 'Click', color: '#94a3b8', order: 0 }
    if (n.includes('vocal') || n.includes('voz') || n.includes('guia') || n.includes('guide') || n.includes('voc')) return { group: 'Vocais', color: '#06b6d4', order: 1 }
    if (n.includes('drum') || n.includes('bater') || n.includes('perc') || n.includes('kick') || n.includes('snare') || n.includes('hat')) return { group: 'Bateria', color: '#f59e0b', order: 2 }
    if (n.includes('bass') || n.includes('baixo') || n.includes('sub')) return { group: 'Baixo', color: '#10b981', order: 3 }
    if (n.includes('eg') || n.includes('guitar') || n.includes('guit') || n.includes('ag') || n.includes('violao') || n.includes('violão')) return { group: 'Guitarra', color: '#ef4444', order: 4 }
    if (n.includes('piano') || n.includes('synth') || n.includes('pad') || n.includes('keys') || n.includes('tecl') || n.includes('organ') || n.includes('rhodes')) return { group: 'Teclado', color: '#8b5cf6', order: 5 }
    return { group: 'Outros', color: '#ec4899', order: 6 }
  }, [])

  // ── VU Meter animation loop ──
  useEffect(() => {
    if (!isPlaying || channels.length === 0) {
      if (vuAnimRef.current) cancelAnimationFrame(vuAnimRef.current)
      return
    }

    // Create AnalyserNodes for channels that don't have one yet
    channels.forEach(ch => {
      if (!analysersRef.current[ch.id]) {
        try {
          const ctx = ch.gainNode.context as AudioContext
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.7
          ch.gainNode.connect(analyser)
          analysersRef.current[ch.id] = analyser
        } catch (_) { /* ok */ }
      }
    })

    const updateVU = () => {
      const levels: Record<string, number> = {}
      let masterPeak = 0

      channels.forEach(ch => {
        const analyser = analysersRef.current[ch.id]
        let chLevel = 0
        if (analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          chLevel = sum / data.length / 255
        }
        levels[ch.id] = chLevel

        if (!ch.muted && (!channels.some(c => c.soloed) || ch.soloed)) {
          masterPeak = Math.max(masterPeak, chLevel * ch.volume)
        }
      })
      
      levels['master'] = masterPeak * masterVolume
      setVuLevels(levels)
      vuAnimRef.current = requestAnimationFrame(updateVU)
    }
    vuAnimRef.current = requestAnimationFrame(updateVU)

    return () => {
      if (vuAnimRef.current) cancelAnimationFrame(vuAnimRef.current)
    }
  }, [isPlaying, channels])

  // Channel drag handlers
  const onChDragStart = (idx: number) => setChDragIdx(idx)
  const onChDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setChDragOverIdx(idx) }
  const onChDrop = (idx: number) => {
    if (chDragIdx === null || chDragIdx === idx) { setChDragIdx(null); setChDragOverIdx(null); return }
    const arr = [...channels]
    const [moved] = arr.splice(chDragIdx, 1)
    arr.splice(idx, 0, moved)
    reorderChannels(arr)
    setChDragIdx(null); setChDragOverIdx(null)
  }
  const onChDragEnd = () => { setChDragIdx(null); setChDragOverIdx(null) }

  // VU Meter rendering helper
  const renderVU = (channelId: string, isMaster = false) => {
    const level = isMaster && channelId === 'master' ? (vuLevels['master'] || 0) : (vuLevels[channelId] || 0)
    const totalSegments = 40
    const activeCount = Math.round(level * totalSegments)
    return (
      <div className="vu-meter h-full">
        {Array.from({ length: totalSegments }).map((_, i) => {
          const isActive = i < activeCount
          let colorClass = 'green'
          if (i >= totalSegments * 0.85) colorClass = 'red'
          else if (i >= totalSegments * 0.65) colorClass = 'yellow'
          return <div key={i} className={`vu-segment ${colorClass} ${isActive ? 'active' : ''}`} />
        })}
      </div>
    )
  }

  // Pan Knob Drag State
  const activePanDrag = useRef<{id: string, startY: number, startPan: number} | null>(null)

  const handlePanPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, pan: number) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    activePanDrag.current = { id, startY: e.clientY, startPan: pan }
  }
  const handlePanPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePanDrag.current) {
      const dy = activePanDrag.current.startY - e.clientY
      let newPan = activePanDrag.current.startPan + (dy / 100)
      newPan = Math.max(-1, Math.min(1, newPan))
      updatePan(activePanDrag.current.id, Math.round(newPan * 10) / 10)
    }
  }
  const handlePanPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePanDrag.current) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      activePanDrag.current = null
    }
  }

  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const KEY_TO_SEMITONE: Record<string, number> = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 }

  const activePitch = playlist[activeSongIndex]?.pitch || 0
  const activeOriginalKey = playlist[activeSongIndex]?.originalKey || null
  const currentKeyName = activeOriginalKey
    ? KEYS[((KEY_TO_SEMITONE[activeOriginalKey] + activePitch) % 12 + 12) % 12]
    : null

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
    if (showAuth) return <AuthPage />
    return <LandingPage onEnter={() => setShowAuth(true)} />
  }

  // ───────────────── SEPARATOR (acessível da tela inicial) ─────────────────
  if (isSeparatorOpen) {
    return <SeparatorStudio onClose={() => setIsSeparatorOpen(false)} />
  }

  // ───────────────── SPLASH ─────────────────
  if (!isReady || forceShowSplash) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-text-main flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 sm:w-20 sm:h-20 mb-8 rounded-2xl flex items-center justify-center border border-border-light bg-surface relative animate-boot">
          <Music size={32} className="text-primary relative z-10" />
          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary animate-led"></div>
        </div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-[0.15em] uppercase mb-1 text-center text-white">PLAYBACK STUDIO</h1>
        <p className="text-text-muted mb-10 text-center text-xs sm:text-sm font-mono tracking-widest uppercase">
          Motor Multitracks Profissional
        </p>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
          <button onClick={() => { setForceShowSplash(false); if (!isReady) initEngine(); }}
            className="hw-btn flex-1 text-primary hover:text-white px-6 py-5 rounded-xl text-sm uppercase tracking-widest flex flex-col items-center gap-3 cursor-pointer">
            {isRestoring ? <Loader2 className="animate-spin" size={28} /> : <Play size={28} fill="currentColor" />}
            <span className="font-black">Playback Studio</span>
            <span className="text-[10px] font-mono text-text-muted normal-case tracking-wide">Motor multitracks profissional</span>
          </button>
          <button onClick={() => setIsSeparatorOpen(true)}
            className="hw-btn flex-1 text-purple-400 hover:text-white px-6 py-5 rounded-xl text-sm uppercase tracking-widest flex flex-col items-center gap-3 cursor-pointer border-purple-900/40 hover:border-purple-500/40">
            <Wand2 size={28} />
            <span className="font-black">Separação de Faixas</span>
            <span className="text-[10px] font-mono text-text-muted normal-case tracking-wide">Separar instrumentos com IA</span>
          </button>
        </div>
      </div>
    )
  }

  // ───────────────── MAIN APP ─────────────────
  return (
    <div className="min-h-screen bg-[#0e0e10] text-text-main flex flex-col select-none overflow-hidden">

      {/* ═══ HEADER / TRANSPORT ═══ */}
      <header className="bg-[#18181a] border-b border-border shrink-0">
        {/* Top row: Brand + Tools + Timer */}
        <div className="flex items-center justify-between px-3 sm:px-4 h-11 sm:h-12 border-b border-border">
          {/* Left: Menu + Brand */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative">
              <button onClick={() => setIsSetlistMenuOpen(!isSetlistMenuOpen)}
                className="text-sm sm:text-base font-black tracking-[0.1em] uppercase hover:text-primary active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 focus:outline-none text-white/80">
                <ListMusic size={16} className="text-primary" />
                <span className="hidden xs:inline">PLAYBACK</span>
              </button>

              {/* ─── Setlist Dropdown ─── */}
              {isSetlistMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsSetlistMenuOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 sm:w-80 daw-panel rounded-lg z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <button onClick={() => setIsSetlistMenuOpen(false)} className="text-primary text-xs font-bold uppercase tracking-wider cursor-pointer">Cancelar</button>
                      <span className="text-white font-bold text-xs uppercase tracking-wider">Repertórios</span>
                      <div className="w-14"></div>
                    </div>
                    <div className="p-2">
                      <button onClick={() => { clearSession(); setIsSetlistMenuOpen(false); }}
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><Plus size={16} className="text-primary" />Novo Repertório</span>
                        <ChevronRight size={14} className="text-text-muted" />
                      </button>
                      <label
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><FolderOpen size={16} className="text-primary" />Importar Stems</span>
                        <ChevronRight size={14} className="text-text-muted" />
                        <input type="file" multiple accept="audio/*" className="hidden"
                          onChange={(e) => { if (e.target.files) { loadFiles(e.target.files); setIsSetlistMenuOpen(false) } }} />
                      </label>
                      <hr className="border-border my-1" />
                      {playlist.length > 0 && (
                        <button onClick={handleExport} disabled={isSaving}
                          className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                          <span className="text-white text-sm font-medium flex items-center gap-3">
                            {isSaving ? <Loader2 size={16} className="text-primary animate-spin" /> : <Download size={16} className="text-accent-green" />}
                            {isSaving ? 'Salvando...' : 'Salvar (.zip)'}
                          </span>
                          <ChevronRight size={14} className="text-text-muted" />
                        </button>
                      )}
                      <label
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><Upload size={16} className="text-secondary" />Carregar (.zip)</span>
                        <ChevronRight size={14} className="text-text-muted" />
                        <input type="file" accept=".zip" className="hidden" onChange={handleImport} />
                      </label>
                    </div>
                    {playlist.length > 0 && (
                      <div className="border-t border-border p-2">
                        <div className="px-4 py-1.5 text-[9px] font-bold text-text-muted/50 uppercase tracking-[0.2em]">Atual</div>
                        <div className="px-4 py-2.5 rounded-md bg-white/5 flex items-center gap-3">
                          {playlist[0]?.coverImage ? (
                            <img src={playlist[0].coverImage} className="w-9 h-9 rounded object-cover" alt="" />
                          ) : (
                            <div className="w-9 h-9 rounded bg-primary/10 flex items-center justify-center"><Music size={14} className="text-primary" /></div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-medium text-xs truncate">Repertório Atual</div>
                            <div className="text-text-muted text-[10px] font-mono">{playlist.length} Songs • {formatTime(playlist.reduce((acc, s) => acc + s.duration, 0))}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Toolbar icons */}
            <div className="h-5 w-px bg-border mx-1"></div>
            
            <div className="relative">
              <button onClick={() => setIsTracksMenuOpen(!isTracksMenuOpen)}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${isTracksMenuOpen ? 'text-white bg-white/10' : 'text-text-muted hover:text-white'}`}>
                <Music size={14} /> <span className="hidden sm:inline">FAIXAS</span>
              </button>

              {isTracksMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsTracksMenuOpen(false)} />
                  <div className="absolute top-full left-0 mt-2 w-56 glass border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1">
                    <label className="w-full text-left px-4 py-2 text-xs font-medium text-text hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-2">
                        <Upload size={14} /> Importar do dispositivo
                        <input type="file" multiple accept="audio/*" className="hidden"
                          onChange={(e) => { 
                            setIsTracksMenuOpen(false); 
                            if (e.target.files) loadFiles(e.target.files) 
                          }} />
                    </label>
                    <button onClick={() => {
                      setIsTracksMenuOpen(false);
                      const bpmInput = window.prompt("Digite o BPM desejado para a nova faixa de Click (ex: 120):", "120");
                      if (bpmInput) {
                        const bpm = parseInt(bpmInput, 10);
                        if (!isNaN(bpm) && bpm >= 40 && bpm <= 300) {
                          createEndlessMetronomeSong(bpm);
                        } else {
                          alert("BPM inválido. Digite um número entre 40 e 300.");
                        }
                      }
                    }}
                      className="w-full text-left px-4 py-2 text-xs font-medium text-text hover:bg-white/10 transition-colors flex items-center gap-2">
                      <Timer size={14} /> Criar Metrônomo (Infinito)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button onClick={() => handlePremiumFeature(() => setIsLibraryOpen(true))}
              className="transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Cloud size={14} /> <span className="hidden sm:inline">BIBLIOTECA</span>
            </button>
            <button onClick={() => setIsMetronomeModalOpen(true)}
              className="transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Timer size={14} /> <span className="hidden sm:inline">METRÔNOMO</span>
            </button>
          </div>

          {/* Right: Controls + User */}
          <div className="flex items-center gap-2 sm:gap-3">

            {/* Key Selector */}
            <div className="relative">
              <button onClick={() => handlePremiumFeature(() => setIsKeyPickerOpen(!isKeyPickerOpen))}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${isKeyPickerOpen ? 'text-primary' : 'text-text-muted hover:text-white'}`}>
                <span>TOM</span>
                {currentKeyName && <span className="text-primary font-mono">{currentKeyName}</span>}
              </button>
              {isKeyPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsKeyPickerOpen(false)} />
                  <div className="absolute top-full mt-1 right-0 daw-panel rounded-lg z-50 p-3 w-48">
                    <p className="text-[10px] text-text-muted mb-2 font-mono">
                      {activeOriginalKey ? 'Selecionar tom:' : 'Tom original desconhecido. Defina manualmente:'}
                    </p>
                    <div className="grid grid-cols-4 gap-1">
                      {KEYS.map(key => {
                        const isCurrent = key === currentKeyName
                        const isOriginal = key === activeOriginalKey && !isCurrent
                        return (
                          <button key={key} onClick={() => {
                            if (activeOriginalKey) {
                              const diff = KEY_TO_SEMITONE[key] - KEY_TO_SEMITONE[activeOriginalKey]
                              const semitones = diff > 6 ? diff - 12 : diff < -6 ? diff + 12 : diff
                              changePitch(semitones)
                            } else {
                              setOriginalKey(key)
                              changePitch(0)
                            }
                            setIsKeyPickerOpen(false)
                          }}
                            className={`py-1.5 text-[10px] font-bold rounded transition-colors cursor-pointer font-mono ${isCurrent ? 'bg-primary text-black' : isOriginal ? 'bg-white/15 text-white border border-white/20' : 'text-white/70 bg-white/5 hover:bg-primary/20 hover:text-primary'}`}>
                            {key}
                          </button>
                        )
                      })}
                    </div>
                    {activeOriginalKey && (
                      <button onClick={() => { setOriginalKey(null); changePitch(0); setIsKeyPickerOpen(false); }}
                        className="mt-2 w-full text-[9px] text-text-muted hover:text-accent-red cursor-pointer text-center transition-colors font-mono">
                        Redefinir detecção de tom
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Pré-contagem */}
            <div className="relative">
              <button
                onClick={() => setIsPrecountOpen(!isPrecountOpen)}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${precountEnabled ? 'text-primary' : 'text-text-muted hover:text-white'}`}
                title="Pré-contagem"
              >
                PRÉ-CONTAGEM
              </button>
              {isPrecountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsPrecountOpen(false)} />
                  <div className="absolute top-full mt-1 right-0 daw-panel rounded-lg z-50 p-4 w-64">
                    {/* Toggle row */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-white text-sm font-bold">Pré-contagem</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePrecountEnabled(!precountEnabled); }}
                        className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${precountEnabled ? 'bg-primary' : 'bg-white/10'}`}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow"
                          style={{ transform: precountEnabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s' }}
                        />
                      </button>
                    </div>
                    {/* Beat count */}
                    <p className="text-text-muted text-xs mb-3">Clicks antes da reprodução começar</p>
                    <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2">
                      <button
                        onClick={() => setPrecountBeats(precountBeats - 1)}
                        className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold"
                      >−</button>
                      <span className="text-white font-black text-3xl w-12 text-center">{precountBeats}</span>
                      <button
                        onClick={() => setPrecountBeats(precountBeats + 1)}
                        className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold"
                      >+</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="h-5 w-px bg-border hidden sm:block"></div>

            {/* EDITAR */}
            <button onClick={() => setIsEditMode(!isEditMode)}
              className={`items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 border cursor-pointer hidden sm:flex ${isEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border hover:bg-white/5 hover:text-white'}`}>
              {isEditMode ? <Check size={12} /> : <Edit2 size={12} />}
              {isEditMode ? 'OK' : 'EDITAR'}
            </button>

            {/* Admin Dashboard - only for admin */}
            {(user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com') && (
              <button onClick={() => setIsAdminDashboardOpen(true)}
                className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 transition-all">
                <Shield size={14} /><span className="hidden sm:inline">ADMIN</span>
              </button>
            )}

            {/* Config */}
            <button onClick={() => setIsSettingsOpen(true)}
              className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Settings size={14} /><span className="hidden sm:inline">CONFIG</span>
            </button>

            {/* Início */}
            <button onClick={() => setForceShowSplash(true)}
              className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white border border-border hover:border-white/20 transition-all">
              <Home size={14} /><span className="hidden sm:inline">INÍCIO</span>
            </button>

            <div className="h-5 w-px bg-border hidden sm:block"></div>

            {/* User + SAIR */}
            <span className="text-white text-[10px] font-mono font-medium hidden sm:block">{user.email?.split('@')[0]}</span>
            <button onClick={signOut}
              className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-accent-red border border-border hover:border-accent-red/40 transition-all">
              <LogOut size={12} /><span className="hidden sm:inline font-mono">SAIR</span>
            </button>
          </div>
        </div>

        {/* Transport Controls Row */}
        <div className="flex flex-col items-center px-3 py-2 sm:py-2.5 bg-[#141416] gap-1">
          {/* Playback Mode — acima dos controles */}
          <div className="hidden sm:flex items-center lcd-display rounded-md overflow-hidden">
            <button onClick={() => setPlaybackMode('continue')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono ${playbackMode === 'continue' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title="Continuar para próxima música">▶ AUTO</button>
            <button onClick={() => setPlaybackMode('stop')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider border-l border-r border-border transition-all cursor-pointer font-mono ${playbackMode === 'stop' ? 'bg-accent-red/15 text-accent-red' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title="Parar no final">⏹ PARAR</button>
            <button onClick={() => setPlaybackMode('fade-out')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono ${playbackMode === 'fade-out' ? 'bg-purple-500/15 text-purple-400' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title="Fade nos últimos 5 segundos">🔉 FADE</button>
          </div>

          {/* Play controls — centralizados abaixo */}
          <div className="flex items-center gap-1.5">
            <button onClick={prevSong} className="transport-btn p-2 rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipBack size={18} /></button>
            <button onClick={isCountingIn ? cancelCountIn : isPlaying ? pause : playWithPrecount}
              className={`transport-btn p-3 rounded-lg active:scale-90 cursor-pointer ${isPlaying || isCountingIn ? 'active text-primary' : 'text-white'}`}>
              {isPlaying ? <Pause size={24} fill="currentColor" /> : isCountingIn ? <Loader2 size={24} className="animate-spin" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
            </button>
            <button onClick={nextSong} className="transport-btn p-2 rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipForward size={18} /></button>
            {/* Mobile edit toggle */}
            <button onClick={() => setIsEditMode(!isEditMode)}
              className={`sm:hidden ml-2 items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors border cursor-pointer flex ${isEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border'}`}>
              {isEditMode ? <Check size={12} /> : <Edit2 size={12} />}
            </button>
          </div>
        </div>
      </header>

      {/* Loading bar */}
      {(isLoading || isRestoring) && (
        <div className="h-1 bg-primary/20 overflow-hidden z-50"><div className="h-full bg-primary animate-pulse w-full"></div></div>
      )}

      {/* ═══ SETLIST & NOTES AREA ═══ */}
      <section className="h-40 sm:h-48 border-b border-border bg-[#141416] flex shrink-0 relative overflow-hidden">
        {/* Left: Notes Panel */}
        <div className="w-1/3 sm:w-80 border-r border-[#222] p-3 flex flex-col bg-[#0e0e10] shrink-0">
          <div className="text-[10px] font-bold text-text-muted/60 uppercase tracking-[0.15em] mb-2 font-mono flex items-center justify-between">
            Anotações
            <Edit2 size={10} className="text-text-muted/40" />
          </div>
          <textarea 
            className="flex-1 w-full bg-[#141416] border border-[#222] rounded-md p-2.5 text-[11px] sm:text-xs text-text-main resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
            placeholder="Ex: 1. Abertura (Tom: C)&#10;2. Medley Rápido (Tom: G)..."
            value={repertoireNotes}
            onChange={(e) => setRepertoireNotes(e.target.value)}
          />
        </div>

        {/* Right: Repertoire Horizontal Scroll */}
        <div className="flex-1 p-3 overflow-x-auto overflow-y-hidden bg-[#141416] relative scrollbar-hide flex flex-col">
          <div className="text-[10px] font-bold text-text-muted/40 uppercase tracking-[0.2em] font-mono mb-2 shrink-0">FAIXAS NO REPERTÓRIO</div>
          
          <div className="flex flex-1 items-center gap-3">
            {playlist.map((song, i) => (
              <div key={song.id}
                draggable={isEditMode}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                onClick={() => !isEditMode && jumpToSong(i)}
                className={`
                  flex-none w-56 sm:w-72 h-full rounded-md flex flex-col p-3 gap-2 border transition-all overflow-hidden relative justify-center
                  ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-border-light'}
                  ${isEditMode && dragOverIndex === i ? 'border-primary border-2 bg-primary/5' : ''}
                  ${isEditMode && dragIndex === i ? 'opacity-40' : ''}
                  ${i === activeSongIndex && !isEditMode ? 'bg-surface border-primary/40 text-white shadow-[0_0_12px_rgba(212,168,67,0.08)] z-[2]' : 'bg-[#1a1a1c] border-border text-text-muted'}
                  ${isEditMode && !(dragOverIndex === i) && !(dragIndex === i) ? 'border-dashed border-text-muted/20' : ''}
                `}>
                
                <div className="flex items-center gap-3 h-full">
                  {/* Cover */}
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded bg-black/40 flex-shrink-0 overflow-hidden relative group flex items-center justify-center border border-border shadow-md">
                    {song.coverImage ? (
                      <img src={song.coverImage} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music size={20} className="opacity-15" />
                    )}
                    {isEditMode && (
                      <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                        <Edit2 size={12} className="text-white mb-0.5" />
                        <span className="text-[8px] font-bold text-white uppercase tracking-wider">COVER</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) { const reader = new FileReader(); reader.onload = (ev) => setCoverImage(song.id, ev.target?.result as string); reader.readAsDataURL(f); }
                        }} />
                      </label>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-center min-w-0 pr-1 gap-1">
                    {isEditMode ? (
                      <>
                        <input type="text"
                          className="w-full daw-input text-xs sm:text-sm font-bold text-white px-2 py-1 rounded mb-0.5"
                          value={song.name}
                          onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} draggable={false}
                          onChange={(e) => renameSong(song.id, e.target.value)}
                        />
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1 text-text-muted/40">
                            <GripVertical size={12} /><span className="text-[10px] font-mono">ARRASTAR</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeSongFromPlaylist(song.id); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            draggable={false}
                            className="p-1 rounded text-accent-red/60 hover:text-accent-red hover:bg-accent-red/10 transition-all cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const parts = song.name.split(' - ')
                          const artist = parts.length >= 2 ? parts[0].trim() : ''
                          const title = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : song.name
                          return (
                            <>
                              <div className={`font-bold text-xs sm:text-sm truncate leading-snug ${i === activeSongIndex ? 'text-white' : 'text-text-main/80'}`}>
                                {i + 1}. {title}
                              </div>
                              {artist && (
                                <div className="text-[10px] text-text-muted/60 truncate font-mono">{artist}</div>
                              )}
                              <div className="flex items-center gap-2 mt-0.5">
                                {song.originalKey && (
                                  <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{song.originalKey}</span>
                                )}
                                {song.bpm && (
                                  <span className="text-[9px] font-mono text-text-muted/60">{song.bpm} BPM</span>
                                )}
                                <span className="text-[9px] font-mono text-text-muted/50 ml-auto flex items-center gap-1">
                                  {i === activeSongIndex && isPlaying && <Play size={8} fill="currentColor" className="text-primary" />}
                                  {i === activeSongIndex && !isPlaying && <div className="w-1 h-1 rounded-full bg-primary/50"></div>}
                                  {formatTime(song.duration)}
                                </span>
                              </div>
                            </>
                          )
                        })()}
                      </>
                    )}
                  </div>
                </div>

                {/* Active indicator bar */}
                {i === activeSongIndex && !isEditMode && <div className="absolute bottom-0 left-3 right-3 h-[3px] bg-primary rounded-t-sm shadow-[0_0_8px_rgba(212,168,67,1)]"></div>}
              </div>
            ))}
          </div>

          {playlist.length === 0 && (
            <div className="text-[10px] sm:text-xs text-text-muted/30 flex flex-col items-center justify-center w-full h-full py-8 gap-2 font-mono uppercase tracking-wider">
              <ListMusic size={24} className="opacity-30" />
              <span>Importe faixas para começar</span>
            </div>
          )}
        </div>
      </section>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Timeline */}
        <section className="border-b border-border px-3 sm:px-4 py-1.5 sm:py-2 flex flex-col relative shrink-0 bg-[#111113]">
          {/* Progress Bar */}
          <div className="h-6 sm:h-7 bg-[#0a0a0c] rounded relative overflow-hidden border border-border cursor-pointer group">
            {/* Fill */}
            <div className="absolute inset-y-0 left-0 bg-primary/10 transition-none pointer-events-none" style={{ width: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />
            {/* Playhead */}
            <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)] z-10 pointer-events-none" style={{ left: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />
            
            {/* Timer Output in Progress Bar */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none z-[15] font-mono text-[11px] sm:text-[13px] font-bold text-accent-yellow tracking-widest flex items-baseline gap-1" style={{ textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.5)' }}>
              {formatTime(isDraggingTimeline ? localDragTime : currentTime)}
              <span className="text-[10px] sm:text-[11px] text-text-muted">/ {formatTime(duration)}</span>
            </div>

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
                    className={`shrink-0 px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold tracking-wider transition-all cursor-pointer active:scale-95 border font-mono uppercase ${isActive
                      ? 'shadow-lg scale-105'
                      : 'opacity-50 hover:opacity-100'
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
        <div className="flex lg:hidden border-b border-border bg-[#141416] shrink-0">
          <button onClick={() => setMobileView('mixer')}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors cursor-pointer font-mono ${mobileView === 'mixer' ? 'text-primary border-b-2 border-primary' : 'text-text-muted'}`}>
            MIXER
          </button>
          <button onClick={() => handlePremiumFeature(() => setMobileView('pads'))}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors cursor-pointer font-mono ${mobileView === 'pads' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted'}`}>
            PADS
          </button>
        </div>

        {/* ─── Lower Split ─── */}
        <section className="flex-1 flex overflow-hidden">

          {/* ═══ MIXER ═══ */}
          <div ref={mixerRef}
            className={`bg-[#111113] overflow-x-auto flex flex-col items-stretch
              ${mobileView === 'mixer' ? 'flex' : 'hidden'} lg:flex flex-1`}
            style={{ touchAction: 'pan-x' }}>

            {/* Mixer Toolbar */}
            {channels.length > 0 && (
              <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 border-b border-border bg-[#141416] shrink-0">
                <span className="text-[9px] font-mono font-bold text-text-muted/40 uppercase tracking-[0.2em]">MIXER • {channels.length} CANAIS</span>
                <button onClick={() => setIsChannelEditMode(!isChannelEditMode)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all active:scale-95 border cursor-pointer ${isChannelEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border hover:bg-white/5'}`}>
                  {isChannelEditMode ? <Check size={10} /> : <Move size={10} />}
                  {isChannelEditMode ? 'PRONTO' : 'EDITAR CANAIS'}
                </button>
              </div>
            )}

            <div className="flex-1 flex flex-nowrap items-end p-3 sm:p-4 gap-1 overflow-x-auto"
              style={{ cursor: 'grab' }}
              onMouseDown={onMixerMouseDown} onMouseMove={onMixerMouseMove} onMouseUp={onMixerMouseUp} onMouseLeave={onMixerMouseUp}>

            {channels.map((ch, idx) => {
              const grp = getChannelGroup(ch.name)
              const isMutedByOther = (channels.some(c => c.soloed) && !ch.soloed) || ch.muted
              return (
              <div key={ch.id}
                draggable={isChannelEditMode}
                onDragStart={() => onChDragStart(idx)}
                onDragOver={(e) => onChDragOver(e, idx)}
                onDrop={() => onChDrop(idx)}
                onDragEnd={onChDragEnd}
                className={`channel-strip w-24 sm:w-28 h-full rounded-md flex flex-col items-center p-1.5 sm:p-2 pt-1 flex-shrink-0 relative overflow-hidden ${isChannelEditMode ? 'cursor-grab active:cursor-grabbing' : ''} ${isChannelEditMode && chDragOverIdx === idx ? 'border-primary border-2' : ''} ${isChannelEditMode && chDragIdx === idx ? 'opacity-40' : ''}`}>
                {/* Group color strip */}
                <div className="channel-group-strip" style={{ backgroundColor: grp.color }}></div>

                {/* Active glow */}
                {(isPlaying && ch.volume > 0 && !isMutedByOther) && (
                  <div className="absolute inset-0 rounded-md pointer-events-none" style={{ border: `1px solid ${grp.color}15` }}></div>
                )}

                {/* Channel Label */}
                <div className="font-bold text-[8px] sm:text-[9px] tracking-[0.08em] truncate w-full text-center mb-1.5 uppercase font-mono mt-1" style={{ color: grp.color }} title={ch.name}>
                  {ch.name.length > 8 ? ch.name.substring(0, 8) + '..' : ch.name}
                </div>

                {/* Pan Knob container */}
                <div className="logic-pan-knob-container mb-2 w-full">
                  <div className="logic-pan-knob"
                    title={`Pan: ${ch.pan === 0 ? 'C' : ch.pan < 0 ? 'L'+Math.round(Math.abs(ch.pan) * 100) : 'R'+Math.round(ch.pan * 100)}`}
                    onDoubleClick={() => updatePan(ch.id, 0)}
                    onPointerDown={(e) => handlePanPointerDown(e, ch.id, ch.pan)}
                    onPointerMove={handlePanPointerMove}
                    onPointerUp={handlePanPointerUp}
                    onPointerCancel={handlePanPointerUp}
                    onWheel={(e) => {
                      e.stopPropagation()
                      const newPan = Math.max(-1, Math.min(1, ch.pan + (e.deltaY > 0 ? -0.1 : 0.1)))
                      updatePan(ch.id, Math.round(newPan * 10) / 10)
                    }}>
                    <div className="logic-pan-indicator" style={{ transform: `rotate(${ch.pan * 135}deg)` }}></div>
                  </div>
                  {/* Values box like Logic: Pan | Vol */}
                  <div className="flex justify-center gap-1 mt-1 w-full px-1">
                    <div className="bg-[#1a1a1c] text-[#ddd] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-8 text-center flex-1">
                      {ch.pan === 0 ? '0.0' : ch.pan > 0 ? `+${Math.round(ch.pan * 50)}` : `${Math.round(ch.pan * 50)}`}
                    </div>
                    <div className="bg-[#1a1a1c] text-[#4ade80] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-8 text-center flex-1 truncate">
                      {ch.volume === 0 ? '-∞' : `${(ch.volume * 10 - 10).toFixed(1)}`}
                    </div>
                  </div>
                </div>

                {/* Fader + VU Meter */}
                <div className="flex-1 w-full flex justify-center py-1 mt-1 mb-2 relative gap-1 lg:gap-2">
                  {/* Fader Track */}
                  <div className="relative h-full flex justify-center w-6">
                    <input type="range" min="0" max="1.2" step="0.01" value={ch.volume}
                      onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                      onChange={(e) => updateVolume(ch.id, parseFloat(e.target.value))}
                      className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                      style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                    <div className="logic-fader-track h-full w-3 sm:w-4 relative pointer-events-none">
                      <div className="logic-fader-fill" style={{ 
                        height: `${(ch.volume / 1.2) * 100}%`, 
                        background: isMutedByOther
                          ? 'linear-gradient(to top, rgba(239,68,68,0.4), rgba(239,68,68,0.1))'
                          : `linear-gradient(to top, ${grp.color}66, ${grp.color}15)`
                      }}></div>
                    </div>
                    <div className="logic-fader-knob absolute pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(ch.volume / 1.2) * 100}% - 26px)` }}>
                    </div>
                  </div>

                  {/* Spacer / Decals could go here */}
                  <div className="w-2 hidden sm:block"></div>

                  {/* VU Meter Right */}
                  {renderVU(ch.id)}
                </div>

                {/* M/S Buttons */}
                <div className="flex gap-1 mb-1.5 w-[90%] px-0.5 justify-center mt-auto">
                  <button onClick={() => toggleMute(ch.id)} className={`flex-1 h-5 sm:h-6 rounded text-[9px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${ch.muted ? 'bg-[#ff3b30] text-white shadow-[0_0_8px_rgba(255,59,48,0.6)]' : 'bg-[#444] text-[#999] hover:bg-[#555]'}`}>M</button>
                  <button onClick={() => toggleSolo(ch.id)} className={`flex-1 h-5 sm:h-6 rounded text-[9px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${ch.soloed ? 'bg-[#ffcc00] text-black shadow-[0_0_8px_rgba(255,204,0,0.6)]' : 'bg-[#444] text-[#999] hover:bg-[#555]'}`}>S</button>
                </div>

                {/* Channel Edit Overlay */}
                {isChannelEditMode && (
                  <div className="channel-edit-overlay">
                    <GripVertical size={16} className="text-text-muted/60 mb-1" />
                    <span className="text-[7px] font-mono text-text-muted/50 uppercase tracking-wider">Arrastar</span>
                    <button onClick={(e) => { e.stopPropagation(); removeChannel(ch.id) }}
                      className="mt-2 w-7 h-7 rounded-full bg-accent-red/20 flex items-center justify-center hover:bg-accent-red/40 transition-colors cursor-pointer">
                      <Trash2 size={12} className="text-accent-red" />
                    </button>
                  </div>
                )}
              </div>
              )
            })}

            {playlist.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-text-muted/20 border border-dashed border-border rounded-md flex-col gap-3 p-4">
                <Music size={32} className="opacity-20" />
                <span className="text-[10px] font-mono uppercase tracking-wider">Importe faixas para começar</span>
              </div>
            )}

            <div className="flex-1"></div>

            {/* Master Fader */}
            <div className="channel-strip w-28 sm:w-32 h-full rounded-md flex flex-col items-center p-1.5 sm:p-2 pt-1 flex-shrink-0 ml-2 sm:ml-4 relative border-primary/20 bg-[#38383a]">
              <div className="channel-group-strip" style={{ backgroundColor: '#d4a843' }}></div>
              <div className="font-bold text-[8px] sm:text-[9px] tracking-[0.08em] w-full text-center mb-1.5 uppercase font-mono mt-1" style={{ color: '#d4a843' }}>
                PRINCIPAL
              </div>

              {/* Master Fake Pan Knob Area */}
              <div className="logic-pan-knob-container mb-2 w-full">
                <div className="logic-pan-knob opacity-50 select-none">
                  <div className="logic-pan-indicator" style={{ transform: 'rotate(0deg)' }}></div>
                </div>
                {/* Values box like Logic: Pan | Vol */}
                <div className="flex justify-center gap-1 mt-1 w-full px-2">
                  <div className="bg-[#1a1a1c] text-[#ddd] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-10 text-center flex-1">
                    0.0
                  </div>
                  <div className="bg-[#1a1a1c] text-[#4ade80] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-10 text-center flex-1 truncate">
                    {masterVolume === 0 ? '-∞' : `${(masterVolume * 10 - 10).toFixed(1)}`}
                  </div>
                </div>
              </div>

              {/* Master Fader + VU */}
              <div className="flex-1 w-full flex justify-center py-1 mt-1 mb-2 relative gap-1.5">
                <div className="relative h-full flex justify-center w-6">
                  <input type="range" min="0" max="1.2" step="0.01" value={masterVolume}
                    onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                    onChange={(e) => updateMasterVolume(parseFloat(e.target.value))}
                    className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                    style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                  <div className="logic-fader-track h-full w-4 sm:w-5 relative pointer-events-none">
                    <div className="logic-fader-fill" style={{ 
                      height: `${(masterVolume / 1.2) * 100}%`, 
                      background: 'linear-gradient(to top, rgba(212,168,67,0.5), rgba(212,168,67,0.1))'
                    }}></div>
                  </div>
                  <div className="logic-fader-knob master absolute pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(masterVolume / 1.2) * 100}% - 30px)` }}>
                  </div>
                </div>
                
                {/* Space separator */}
                <div className="w-3 hidden sm:block"></div>

                {renderVU('master', true)}
              </div>
            </div>
            </div>
          </div>

          {/* ═══ PAD PLAYER ═══ */}
          <div className={`bg-[#18181a] border-l border-border p-3 sm:p-4 flex flex-col z-10 shadow-[-10px_0_20px_rgba(0,0,0,0.4)]
            ${mobileView === 'pads' ? 'flex w-full' : 'hidden'} lg:flex lg:w-96`}>
            <div className="font-bold text-[10px] tracking-[0.15em] text-text-muted mb-2 flex justify-between uppercase items-center font-mono">
              <span>REPRODUTOR DE PADS</span>
              <button onClick={() => setIsPadEditMode(!isPadEditMode)}
                className={`text-[9px] border px-2 py-0.5 rounded font-bold cursor-pointer transition-all active:scale-95 font-mono tracking-wider ${isPadEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-text-muted hover:bg-white/5 hover:text-white'}`}>
                {isPadEditMode ? 'PRONTO' : 'EDITAR'}
              </button>
            </div>

            {/* Pad Source Selector */}
            {/* Pad Cloud Selector */}
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => handlePremiumFeature(() => setIsPadSetsModalOpen(true))}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer
                  ${padMode === 'system'
                    ? 'bg-secondary/15 text-secondary border-secondary/30'
                    : 'bg-white/3 text-text-muted border-border hover:bg-white/5 hover:text-white'
                  }`}>
                <Cloud size={10} />
                {padMode === 'system' && selectedPadSet ? selectedPadSet.name : 'PADS NUVEM'}
              </button>
            </div>

            {/* Samples & Loops Buttons */}
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => handlePremiumFeature(() => {})}
                className="flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer bg-white/3 text-text-muted border-border hover:bg-purple-500/10 hover:text-purple-300 hover:border-purple-500/30"
              >
                🎵 SAMPLES
              </button>
              <button
                onClick={() => handlePremiumFeature(() => {})}
                className="flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer bg-white/3 text-text-muted border-border hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-500/30"
              >
                🔁 LOOPS
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-3 mb-3 px-1">
              <span className="text-[9px] text-text-muted uppercase tracking-[0.15em] font-bold shrink-0 font-mono">VOL</span>
              <input type="range" min="0" max="1" step="0.01" value={padVolume}
                onChange={(e) => updatePadVolume(parseFloat(e.target.value))}
                className="daw-slider flex-1" />
              <span className="text-[9px] text-text-muted font-mono w-8 text-right font-bold">{Math.round(padVolume * 100)}%</span>
            </div>
            {/* Grid */}
            <div className="flex-1 grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-3 gap-1.5 sm:gap-2">
              {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => (
                <div key={note} className="relative">
                  <button onClick={() => !isPadEditMode && playPad(note)}
                    className={`
                      mpc-pad w-full h-full rounded-lg flex flex-col items-center justify-center text-base sm:text-lg font-bold cursor-pointer min-h-[48px] sm:min-h-[56px] active:scale-95 font-mono relative
                      ${activeNote === note
                        ? 'pressed border-secondary/50 text-secondary shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                        : customPads.has(note) ? 'border-purple-500/30 text-purple-300 hover:border-purple-400/50' : 'text-text-main/70 hover:text-white hover:border-border-light'}
                    `}>
                    {/* LED indicator */}
                    <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full transition-all ${activeNote === note ? 'bg-secondary shadow-[0_0_6px_rgba(6,182,212,0.8)]' : customPads.has(note) ? 'bg-purple-500/50' : 'bg-white/10'}`}></div>
                    <span className="mt-1">{note}</span>
                    {customPads.has(note) && <span className="text-[6px] mt-0.5 opacity-50 truncate max-w-full px-1 uppercase tracking-wider">{customPadNames.get(note) || 'Person.'}</span>}
                    {activeNote === note && <span className="text-[7px] tracking-[0.2em] font-bold opacity-50 uppercase text-secondary">TOCANDO</span>}
                  </button>
                  {isPadEditMode && (
                    <div className="absolute inset-0 bg-black/85 rounded-lg flex flex-col items-center justify-center gap-1 z-10 border border-border">
                      <label className="text-[7px] font-bold text-white uppercase cursor-pointer hover:text-primary transition-colors flex items-center gap-1 font-mono tracking-wider">
                        <Upload size={9} />CARREGAR
                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadCustomPad(note, f) }} />
                      </label>
                      {customPads.has(note) && (
                        <button onClick={() => clearCustomPad(note)} className="text-[7px] font-bold text-accent-red hover:text-red-300 cursor-pointer flex items-center gap-1 font-mono tracking-wider">
                          <X size={8} /> REMOVER
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
        onDownload={async (files, songName, coverUrl, markers, originalKey, artist, bpm) => {
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));
          const fullName = artist ? `${artist} - ${songName}` : songName;
          await loadFiles(dt.files, fullName, coverUrl || undefined, markers, originalKey ?? null, bpm);
        }}
      />

      {/* Admin Modal */}
      {user?.email === 'arynelson11@gmail.com' && (
        <AdminModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
      )}

      {/* Admin Dashboard */}
      {(user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com') && (
        <AdminDashboard isOpen={isAdminDashboardOpen} onClose={() => setIsAdminDashboardOpen(false)} />
      )}

      <PadSetsModal
        isOpen={isPadSetsModalOpen}
        onClose={() => setIsPadSetsModalOpen(false)}
        onSelect={selectPadSet}
        selectedPadSet={selectedPadSet}
        isAdmin={user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com'}
      />

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

      {isMetronomeModalOpen && playlist[activeSongIndex] && (
        <MetronomeModal 
          isOpen={isMetronomeModalOpen} 
          onClose={() => setIsMetronomeModalOpen(false)} 
          playlistCurrentSong={playlist[activeSongIndex]}
          onAddClick={addChannelToActiveSong} 
        />
      )}

      <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
    </div>
  )
}
