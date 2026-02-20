import { useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Music, ListMusic, GripVertical, Edit2, Check, Image, Trash2, Loader2, Settings, Plus, FolderOpen, Download, Upload, X, ChevronRight } from 'lucide-react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePadSynth } from './hooks/usePadSynth'
import { SettingsModal } from './components/SettingsModal'

export default function App() {
  const {
    isReady, initEngine, loadFiles, isLoading, isRestoring,
    playlist, activeSongIndex, setPlaylistOrder, jumpToSong,
    renameSong, setCoverImage, clearSession,
    setChannelBus, exportPlaylist, importPlaylist,
    channels, play, pause, prevSong, nextSong, isPlaying, currentTime, duration,
    masterVolume, updateVolume, toggleMute, toggleSolo, updateMasterVolume
  } = useAudioEngine()

  const { playPad, activeNote, loadCustomPad, clearCustomPad, customPads, customPadNames, padVolume, updatePadVolume } = usePadSynth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const mixerRef = useRef<HTMLDivElement>(null)

  const [isEditMode, setIsEditMode] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSetlistMenuOpen, setIsSetlistMenuOpen] = useState(false)
  const [isPadEditMode, setIsPadEditMode] = useState(false)

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Touch/drag scroll for mixer
  const mixerDragState = useRef({ isDown: false, startX: 0, scrollLeft: 0 })

  const formatTime = (time: number) => {
    if (isNaN(time)) time = 0;
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Drag-and-drop handlers for setlist reorder
  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const newList = [...playlist]
    const [moved] = newList.splice(dragIndex, 1)
    newList.splice(index, 0, moved)
    setPlaylistOrder(newList)
    setDragIndex(null)
    setDragOverIndex(null)
  }
  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // Mixer touch/mouse drag scroll
  const onMixerMouseDown = (e: React.MouseEvent) => {
    const el = mixerRef.current
    if (!el) return
    mixerDragState.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft }
    el.style.cursor = 'grabbing'
  }
  const onMixerMouseMove = (e: React.MouseEvent) => {
    if (!mixerDragState.current.isDown) return
    const el = mixerRef.current
    if (!el) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    const walk = (x - mixerDragState.current.startX) * 1.5
    el.scrollLeft = mixerDragState.current.scrollLeft - walk
  }
  const onMixerMouseUp = () => {
    mixerDragState.current.isDown = false
    if (mixerRef.current) mixerRef.current.style.cursor = 'grab'
  }

  // Export handler — must append to body for proper .json download
  const handleExport = () => {
    const json = exportPlaylist()
    // Include pad names in export
    const data = JSON.parse(json)
    const padNamesObj: Record<string, string> = {}
    customPadNames.forEach((v, k) => { padNamesObj[k] = v })
    data.customPadNames = padNamesObj
    const finalJson = JSON.stringify(data, null, 2)

    const blob = new Blob([finalJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `repertorio-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setIsSetlistMenuOpen(false)
  }

  // Import handler
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      importPlaylist(ev.target?.result as string)
    }
    reader.readAsText(file)
    setIsSetlistMenuOpen(false)
  }

  // Splash Screen
  if (!isReady) {
    return (
      <div className="min-h-screen bg-background text-text-main flex flex-col items-center justify-center font-sans">
        <div className="w-24 h-24 mb-8 bg-surface rounded-3xl flex items-center justify-center border border-white/5 shadow-2xl relative overflow-hidden">
          <Music size={40} className="text-primary relative z-10" />
          <div className="absolute inset-0 bg-primary/10 animate-pulse"></div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Multitracks Playback</h1>
        <p className="text-text-muted mb-8 max-w-md text-center">
          Bem-vindo ao sistema de reprodução. O motor conectará ao seu banco de dados local.
        </p>
        <button
          onClick={initEngine}
          className="bg-primary hover:bg-emerald-400 text-black px-8 py-4 rounded-xl font-bold text-lg transition-all cursor-pointer shadow-[0_0_30px_rgba(16,185,129,0.3)] flex items-center gap-3"
        >
          {isRestoring ? <Loader2 className="animate-spin" size={24} /> : <Play size={24} fill="currentColor" />}
          Iniciar Motor
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-text-main flex flex-col font-sans select-none overflow-hidden">
      {/* Header / Transport */}
      <header className="h-16 bg-surface border-b border-white/5 flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-6">
          {/* Setlist Menu */}
          <div className="relative">
            <button
              onClick={() => setIsSetlistMenuOpen(!isSetlistMenuOpen)}
              className="text-xl font-bold tracking-tighter hover:text-primary transition-colors cursor-pointer flex items-center gap-2"
            >
              <ListMusic size={20} className="text-primary" />
              PLAYBACK
            </button>

            {isSetlistMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSetlistMenuOpen(false)}></div>
                <div className="absolute top-full left-0 mt-2 w-80 bg-[#2c2c2e] rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden">
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

                    <button onClick={() => { fileInputRef.current?.click(); setIsSetlistMenuOpen(false); }}
                      className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                      <span className="text-white font-medium flex items-center gap-3"><FolderOpen size={18} className="text-[#0A84FF]" />Importar Stems</span>
                      <ChevronRight size={16} className="text-text-muted" />
                    </button>

                    <hr className="border-white/5 my-1" />

                    {playlist.length > 0 && (
                      <button onClick={handleExport}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white font-medium flex items-center gap-3"><Download size={18} className="text-emerald-400" />Salvar Repertório (.json)</span>
                        <ChevronRight size={16} className="text-text-muted" />
                      </button>
                    )}

                    <button onClick={() => importInputRef.current?.click()}
                      className="w-full text-left px-4 py-3 rounded-lg hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                      <span className="text-white font-medium flex items-center gap-3"><Upload size={18} className="text-cyan-400" />Carregar Repertório (.json)</span>
                      <ChevronRight size={16} className="text-text-muted" />
                    </button>
                    <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                  </div>

                  {playlist.length > 0 && (
                    <div className="border-t border-white/10 p-2">
                      <div className="px-4 py-2 text-[10px] font-bold text-text-muted/50 uppercase tracking-widest">Repertório Atual</div>
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

          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg text-sm font-medium border border-white/5 transition-colors cursor-pointer">
            <Music size={16} />
            + Stems
          </button>
          <input type="file" ref={fileInputRef} multiple accept="audio/*" className="hidden"
            onChange={(e) => { if (e.target.files) loadFiles(e.target.files) }} />

          <div className="flex bg-black/40 rounded-lg p-1 ml-2 gap-1">
            <button onClick={prevSong} className="p-2 hover:bg-white/10 rounded transition-colors active:bg-white/20 cursor-pointer"><SkipBack size={20} /></button>
            <button onClick={isPlaying ? pause : play}
              className={`p-2 rounded transition-colors cursor-pointer ${isPlaying ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'hover:bg-white/10'}`}>
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button onClick={nextSong} className="p-2 hover:bg-white/10 rounded transition-colors active:bg-white/20 cursor-pointer"><SkipForward size={20} /></button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {playlist.length > 0 && (
            <button onClick={clearSession} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer" title="Limpar Setlist">
              <Trash2 size={18} />
            </button>
          )}
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-lg text-text-muted hover:bg-white/10 hover:text-white transition-colors cursor-pointer" title="Ajustes">
            <Settings size={18} />
          </button>
          <button onClick={() => setIsEditMode(!isEditMode)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border cursor-pointer ${isEditMode ? 'bg-secondary/20 text-secondary border-secondary/30' : 'bg-transparent text-text-muted border-white/5 hover:bg-white/10'}`}>
            {isEditMode ? <Check size={16} /> : <Edit2 size={16} />}
            {isEditMode ? 'Concluir' : 'Editar'}
          </button>
          <div className="font-mono text-xl tracking-wider text-secondary flex items-baseline gap-1 bg-black/40 px-4 py-1.5 rounded-lg font-light">
            {formatTime(currentTime)}
            <span className="text-sm text-text-muted">/ {formatTime(duration)}</span>
          </div>
        </div>
      </header>

      {/* Loading Overlay */}
      {(isLoading || isRestoring) && (
        <div className="absolute top-16 inset-x-0 h-1 bg-primary/20 overflow-hidden z-50">
          <div className="h-full bg-primary animate-pulse w-full"></div>
        </div>
      )}

      {/* Setlist Area with Drag-and-Drop */}
      <section className="h-32 border-b border-white/5 bg-black/40 flex items-center px-4 gap-4 overflow-x-auto shrink-0 relative">
        <div className="absolute left-4 top-2 text-[10px] font-bold text-text-muted/40 uppercase tracking-widest pl-1">Repertório</div>
        <div className="w-full flex items-center gap-3 pt-4">
          {playlist.map((song, i) => (
            <div key={song.id}
              draggable={isEditMode}
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              onClick={() => !isEditMode && jumpToSong(i)}
              className={`
                 flex-none w-72 h-20 rounded-xl flex items-center p-2 gap-3 border transition-all overflow-hidden relative
                 ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-white/20'}
                 ${isEditMode && dragOverIndex === i ? 'border-secondary border-2 bg-secondary/10' : ''}
                 ${isEditMode && dragIndex === i ? 'opacity-40' : ''}
                 ${i === activeSongIndex && !isEditMode ? 'bg-primary/10 border-primary/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-surface border-white/5 text-text-muted'}
                 ${isEditMode && !(dragOverIndex === i) && !(dragIndex === i) ? 'border-dashed border-white/20' : ''}
               `}>
              {/* Cover Image */}
              <div className="w-16 h-16 rounded-md bg-black/40 flex-shrink-0 overflow-hidden relative group flex items-center justify-center border border-white/5">
                {song.coverImage ? (
                  <img src={song.coverImage} className="w-full h-full object-cover" alt="Cover" />
                ) : (
                  <Image size={24} className="opacity-20" />
                )}
                {isEditMode && (
                  <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                    <Edit2 size={14} className="text-white mb-1" />
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">Capa</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setCoverImage(song.id, ev.target?.result as string);
                        reader.readAsDataURL(f);
                      }
                    }} />
                  </label>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center min-w-0 pr-1">
                {isEditMode ? (
                  <>
                    <input type="text"
                      className="w-full bg-black/40 text-sm font-semibold text-white px-2 py-1 rounded border border-white/10 outline-none focus:border-secondary mb-1 transition-colors"
                      value={song.name}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      draggable={false}
                      onChange={(e) => renameSong(song.id, e.target.value)}
                    />
                    <div className="flex items-center gap-2 text-text-muted/50">
                      <GripVertical size={14} />
                      <span className="text-[10px]">Arraste para reordenar</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`font-semibold text-sm truncate mb-1 ${i === activeSongIndex ? 'text-white' : 'text-text-main'}`}>
                      {i + 1}. {song.name}
                    </div>
                    <div className="text-xs opacity-60 font-mono flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-primary">
                        {i === activeSongIndex && isPlaying && <Play size={10} fill="currentColor" />}
                        {i === activeSongIndex && !isPlaying && <div className="w-1.5 h-1.5 rounded-full bg-primary/50"></div>}
                      </div>
                      {formatTime(song.duration)}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {playlist.length === 0 && (
            <div className="text-sm text-text-muted/50 flex flex-col items-center justify-center w-full py-2 gap-2">
              <ListMusic size={24} className="opacity-50" />
              <span>Nenhuma música adicionada. Clique em "+ Stems"</span>
            </div>
          )}
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Timeline */}
        <section className="h-16 border-b border-white/5 px-4 py-2 flex flex-col gap-4 relative shrink-0">
          <div className="flex-1 bg-surface rounded-md relative overflow-hidden border border-white/5 cursor-crosshair">
            <div className="absolute inset-y-0 left-0 bg-primary/10 transition-none" style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }} />
            <div className="absolute inset-y-0 w-px bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)] z-10" style={{ left: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }} />
          </div>
        </section>

        {/* Lower Split */}
        <section className="flex-1 flex overflow-hidden">

          {/* Mixer Area with touch/drag scroll */}
          <div ref={mixerRef}
            className="flex-1 bg-black/20 overflow-x-auto flex flex-nowrap items-end p-4 gap-2"
            style={{ cursor: 'grab', touchAction: 'pan-x' }}
            onMouseDown={onMixerMouseDown}
            onMouseMove={onMixerMouseMove}
            onMouseUp={onMixerMouseUp}
            onMouseLeave={onMixerMouseUp}
          >

            {channels.map((ch) => (
              <div key={ch.id} className="w-24 h-full bg-surface rounded-lg border border-white/5 flex flex-col items-center p-2 pt-4 flex-shrink-0 relative overflow-hidden group">
                {(isPlaying && ch.volume > 0 && !ch.muted && (!channels.some(c => c.soloed) || ch.soloed)) && (
                  <div className="absolute inset-0 border border-primary/20 rounded-lg pointer-events-none"></div>
                )}
                <div className="font-semibold text-xs tracking-wider text-text-muted truncate w-full text-center mb-4 uppercase" title={ch.name}>
                  {ch.name.length > 8 ? ch.name.substring(0, 8) + '...' : ch.name}
                </div>
                <div className="absolute top-2 right-2 flex flex-col items-center opacity-30">
                  <div className="text-[8px] tracking-tighter">{ch.bus === '1' ? 'L' : ch.bus === '2' ? 'R' : ch.pan === 0 ? 'C' : ch.pan < 0 ? 'L' : 'R'}</div>
                </div>
                <div className="flex gap-1 mb-4 w-full px-1">
                  <button onClick={() => toggleMute(ch.id)} className={`flex-1 h-8 rounded text-xs font-bold transition-colors cursor-pointer ${ch.muted ? 'bg-red-500 text-black border border-red-500' : 'bg-black/40 text-text-muted hover:bg-white/10'}`}>M</button>
                  <button onClick={() => toggleSolo(ch.id)} className={`flex-1 h-8 rounded text-xs font-bold transition-colors cursor-pointer ${ch.soloed ? 'bg-yellow-500 text-black border border-yellow-500' : 'bg-black/40 text-text-muted hover:bg-white/10'}`}>S</button>
                </div>
                <div className="flex-1 w-full flex justify-center py-2 relative">
                  <input type="range" min="0" max="1.2" step="0.01" value={ch.volume}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onChange={(e) => updateVolume(ch.id, parseFloat(e.target.value))}
                    className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                    style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                  <div className="h-full w-2 bg-black/60 rounded-full relative overflow-hidden pointer-events-none flex justify-center border border-white/5">
                    <div className="absolute bottom-0 w-full transition-all duration-75" style={{ height: `${(ch.volume / 1.2) * 100}%`, backgroundColor: (channels.some(c => c.soloed) && !ch.soloed) || ch.muted ? '#ef4444' : '#06b6d4' }}></div>
                  </div>
                  <div className="absolute w-8 h-4 bg-white/20 rounded border border-white/20 shadow-lg pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(ch.volume / 1.2) * 100}% - 8px)` }}>
                    <div className="w-full h-px bg-white/50 mt-1.5"></div>
                  </div>
                </div>
                <div className="mt-4 text-xs font-mono text-white/40">{Math.round(ch.volume * 100)}%</div>
              </div>
            ))}

            {playlist.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-text-muted/50 border-2 border-dashed border-white/5 rounded-2xl group flex-col gap-4">
                <Music size={48} className="opacity-20 group-hover:opacity-40 transition-opacity" />
                <span>Importe os stems de uma música no "+ Stems" acima para começar</span>
              </div>
            )}

            <div className="flex-1"></div>

            {/* Master Fader */}
            <div className="w-28 h-full bg-surface rounded-xl border border-white/5 flex flex-col items-center p-2 pt-4 flex-shrink-0 ml-4 shadow-xl relative">
              <div className="font-bold text-xs tracking-wider text-primary truncate w-full text-center mb-6 uppercase">MASTER</div>
              <div className="flex-1 w-full flex justify-center py-2 relative">
                <input type="range" min="0" max="1.2" step="0.01" value={masterVolume}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onChange={(e) => updateMasterVolume(parseFloat(e.target.value))}
                  className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                  style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                <div className="h-full w-3 bg-black/60 rounded-full relative overflow-hidden pointer-events-none flex justify-center border border-white/5 shadow-inner">
                  <div className="absolute bottom-0 w-full transition-all duration-75 bg-primary" style={{ height: `${(masterVolume / 1.2) * 100}%` }}></div>
                </div>
                <div className="absolute w-12 h-6 bg-[#333] border border-white/20 shadow-2xl rounded pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(masterVolume / 1.2) * 100}% - 12px)` }}>
                  <div className="w-full h-0.5 bg-primary mt-2.5"></div>
                </div>
              </div>
              <div className="mt-4 text-xs font-mono text-primary/80 font-bold mb-1">{Math.round(masterVolume * 100)}%</div>
            </div>
          </div>

          {/* Pad Player Area */}
          <div className="w-96 bg-surface border-l border-white/5 p-4 flex flex-col z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
            <div className="font-semibold text-xs tracking-wider text-text-muted mb-2 flex justify-between uppercase items-center">
              <span>Ambient Pad Player</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsPadEditMode(!isPadEditMode)}
                  className={`text-[10px] border px-2 py-0.5 rounded-full flex items-center font-bold cursor-pointer transition-colors ${isPadEditMode ? 'bg-secondary/20 text-secondary border-secondary/30' : 'border-secondary/30 text-secondary bg-secondary/5 hover:bg-secondary/15'}`}>
                  {isPadEditMode ? 'OK' : 'EDITAR'}
                </button>
              </div>
            </div>
            {/* Pad Volume Slider */}
            <div className="flex items-center gap-3 mb-4 px-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold shrink-0">Vol</span>
              <input type="range" min="0" max="1" step="0.01" value={padVolume}
                onChange={(e) => updatePadVolume(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-secondary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg" />
              <span className="text-[10px] text-text-muted font-mono w-8 text-right">{Math.round(padVolume * 100)}%</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-3">
              {['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].map(note => (
                <div key={note} className="relative">
                  <button
                    onClick={() => !isPadEditMode && playPad(note)}
                    className={`
                      w-full h-full rounded-xl flex flex-col items-center justify-center text-2xl font-bold transition-all border cursor-pointer min-h-[60px]
                      ${activeNote === note
                        ? 'bg-secondary/20 text-secondary border-secondary/50 shadow-[0_0_25px_rgba(6,182,212,0.3)] ring-1 ring-secondary scale-[1.02]'
                        : customPads.has(note) ? 'bg-purple-900/30 text-purple-300 border-purple-500/30 hover:bg-purple-900/50' : 'bg-[#1e1e1e] text-text-main hover:bg-white/10 border-white/5 hover:border-white/10'}
                    `}
                  >
                    <span className="text-lg">{note}</span>
                    {customPads.has(note) && <span className="text-[8px] mt-0.5 opacity-60 truncate max-w-full px-1">{customPadNames.get(note) || 'Custom'}</span>}
                    {activeNote === note && <span className="text-[9px] tracking-widest font-medium opacity-60 uppercase text-secondary">Playing</span>}
                  </button>
                  {isPadEditMode && (
                    <div className="absolute inset-0 bg-black/80 rounded-xl flex flex-col items-center justify-center gap-1 z-10 border border-white/10">
                      <label className="text-[9px] font-bold text-white uppercase cursor-pointer hover:text-secondary transition-colors flex items-center gap-1">
                        <Upload size={12} />
                        Carregar
                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) loadCustomPad(note, f)
                        }} />
                      </label>
                      {customPads.has(note) && (
                        <button onClick={() => clearCustomPad(note)} className="text-[9px] font-bold text-red-400 hover:text-red-300 cursor-pointer flex items-center gap-1">
                          <X size={10} /> Remover
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
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} channels={channels} onSetChannelBus={setChannelBus} />
    </div>
  )
}
