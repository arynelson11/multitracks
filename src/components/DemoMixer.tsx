import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square, Loader2 } from 'lucide-react'

// Player da landing: toca 6 stems reais (separados no próprio Playback Studio)
// em loop, com mute/solo e VU de verdade. Os arquivos ficam em public/demo/.
const CHANNELS = [
  { id: 'vocais',   name: 'Vocais',   color: '#06b6d4' },
  { id: 'bateria',  name: 'Bateria',  color: '#f59e0b' },
  { id: 'baixo',    name: 'Baixo',    color: '#10b981' },
  { id: 'guitarra', name: 'Guitarra', color: '#ef4444' },
  { id: 'teclado',  name: 'Teclado',  color: '#8b5cf6' },
  { id: 'outros',   name: 'Outros',   color: '#ec4899' },
  { id: 'master',   name: 'Master',   color: '#f97316' },
] as const

type ChId = typeof CHANNELS[number]['id']
const STEMS = CHANNELS.filter(c => c.id !== 'master')

// BASE_URL resolve o caminho no web ('/') e no build desktop. Ver desktop_absolute_paths.
const stemUrl = (id: string) => `${import.meta.env.BASE_URL}demo/${id}.mp3`

export function DemoMixer() {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(false)
  const [muted,   setMuted]   = useState<Partial<Record<ChId, boolean>>>({})
  const [soloed,  setSoloed]  = useState<Partial<Record<ChId, boolean>>>({})
  const [levels,  setLevels]  = useState<Record<ChId, number>>(
    Object.fromEntries(CHANNELS.map(c => [c.id, 0])) as Record<ChId, number>
  )
  const [progress, setProgress] = useState(0)

  const acRef            = useRef<AudioContext | null>(null)
  const buffersRef       = useRef<Partial<Record<ChId, AudioBuffer>>>({})
  const gainsRef         = useRef<Partial<Record<ChId, GainNode>>>({})
  const analysersRef     = useRef<Partial<Record<ChId, AnalyserNode>>>({})
  const masterAnalyserRef = useRef<AnalyserNode | null>(null)
  const sourcesRef       = useRef<AudioBufferSourceNode[]>([])
  const startAtRef       = useRef(0)
  const durRef           = useRef(1)
  const rafRef           = useRef(0)

  // Apply mute / solo to the persistent per-channel gains.
  useEffect(() => {
    const ac = acRef.current
    if (!ac) return
    const hasSolo = Object.values(soloed).some(Boolean)
    STEMS.forEach(({ id }) => {
      const g = gainsRef.current[id]
      if (!g) return
      const active = hasSolo ? !!soloed[id] : !muted[id]
      g.gain.setTargetAtTime(active ? 1 : 0, ac.currentTime, 0.02)
    })
  }, [muted, soloed])

  // Fetch + decode the 6 stems once (cached in buffersRef).
  const ensureLoaded = useCallback(async (ac: AudioContext) => {
    if (Object.keys(buffersRef.current).length === STEMS.length) return
    const entries = await Promise.all(STEMS.map(async ({ id }) => {
      const res = await fetch(stemUrl(id))
      if (!res.ok) throw new Error(`fetch ${id} → HTTP ${res.status}`)
      const arr = await res.arrayBuffer()
      const buffer = await ac.decodeAudioData(arr)
      return [id, buffer] as const
    }))
    entries.forEach(([id, buffer]) => { buffersRef.current[id] = buffer })
  }, [])

  // Build the audio graph once (master chain + per-channel gain/analyser). Reused across plays.
  const ensureGraph = useCallback((ac: AudioContext) => {
    if (masterAnalyserRef.current) return

    const compressor = ac.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.knee.value      = 12
    compressor.ratio.value     = 4
    compressor.attack.value    = 0.003
    compressor.release.value   = 0.15
    compressor.connect(ac.destination)

    const masterGain = ac.createGain()
    masterGain.gain.value = 1.5   // stems separados vêm baixos; sobe o mix
    masterGain.connect(compressor)

    const masterAnalyser = ac.createAnalyser()
    masterAnalyser.fftSize = 256
    masterGain.connect(masterAnalyser)
    masterAnalyserRef.current = masterAnalyser

    STEMS.forEach(({ id }) => {
      const g = ac.createGain(); g.gain.value = 1
      const an = ac.createAnalyser(); an.fftSize = 256
      g.connect(an); an.connect(masterGain)
      gainsRef.current[id]     = g
      analysersRef.current[id] = an
    })
  }, [])

  const start = useCallback(async () => {
    setError(false)
    try {
      const ac = acRef.current ?? new AudioContext()
      acRef.current = ac
      if (ac.state === 'suspended') await ac.resume()

      if (Object.keys(buffersRef.current).length < STEMS.length) {
        setLoading(true)
        await ensureLoaded(ac)
        setLoading(false)
      }
      ensureGraph(ac)

      const startAt = ac.currentTime + 0.08
      startAtRef.current = startAt
      durRef.current = buffersRef.current[STEMS[0].id]?.duration ?? 1

      sourcesRef.current = STEMS.map(({ id }) => {
        const src = ac.createBufferSource()
        src.buffer = buffersRef.current[id]!
        src.loop = true
        src.connect(gainsRef.current[id]!)
        src.start(startAt)
        return src
      })

      const buf = new Uint8Array(32)
      const tick = () => {
        const nl: Record<string, number> = {}
        CHANNELS.forEach(({ id }) => {
          const a = id === 'master' ? masterAnalyserRef.current : analysersRef.current[id]
          if (!a) { nl[id] = 0; return }
          a.getByteFrequencyData(buf)
          nl[id] = buf.reduce((s, v) => s + v, 0) / buf.length / 255
        })
        setLevels(nl as Record<ChId, number>)
        setProgress((((ac.currentTime - startAtRef.current) % durRef.current) / durRef.current) * 100)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      setPlaying(true)
    } catch (e) {
      console.error('[DemoMixer] play failed:', e)
      setLoading(false)
      setError(true)
      setPlaying(false)
    }
  }, [ensureLoaded, ensureGraph])

  const stop = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* já parou */ } })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setMuted({})
    setSoloed({})
    setProgress(0)
    setLevels(Object.fromEntries(CHANNELS.map(c => [c.id, 0])) as Record<ChId, number>)
  }, [])

  useEffect(() => () => {
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* noop */ } })
    cancelAnimationFrame(rafRef.current)
    acRef.current?.close()
  }, [])

  const toggleMute = (id: ChId) => { if (id !== 'master') setMuted(p  => ({ ...p, [id]: !p[id] })) }
  const toggleSolo = (id: ChId) => { if (id !== 'master') setSoloed(p => ({ ...p, [id]: !p[id] })) }
  const hasSolo = Object.values(soloed).some(Boolean)

  return (
    <div className="glow-o rounded-2xl overflow-hidden border border-white/[0.09] bg-[#111113]">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 px-4 h-9 border-b border-white/[0.06] bg-[#0e0e10]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
        <span className="ml-auto text-[10px] text-white/15 font-mono tracking-wider hidden sm:block">
          PLAYBACK STUDIO · MIXER AO VIVO
        </span>
      </div>

      <div className="p-5">
        {/* Channel strips */}
        <div className="grid grid-cols-7 gap-2">
          {CHANNELS.map(({ id, name, color }) => {
            const isMuted  = !!muted[id]
            const isSoloed = !!soloed[id]
            const active   = id === 'master' || (hasSolo ? isSoloed : !isMuted)
            const lv       = levels[id] ?? 0
            const barH     = active && playing ? Math.min(96, lv * 155 + 4) : 0

            return (
              <div key={id} className="flex flex-col items-center gap-1.5">
                <span className="text-[8px] sm:text-[9px] font-bold truncate w-full text-center" style={{ color }}>
                  {name}
                </span>

                {/* Level bar */}
                <div className="w-full h-20 bg-black/50 rounded-sm border border-white/[0.04] flex flex-col-reverse overflow-hidden">
                  <div
                    className="w-full"
                    style={{
                      height: `${barH}%`,
                      background: `linear-gradient(to top, ${color}90, ${color}20)`,
                      transition: 'height 75ms linear',
                    }}
                  />
                </div>

                {/* VU bars */}
                <div className="flex items-end gap-[2px] h-3 w-full px-0.5">
                  {[1,2,3,4,5,6,7].map(j => (
                    <div
                      key={j}
                      className="flex-1 rounded-sm"
                      style={{
                        height: active && playing ? `${Math.max(8, lv * 90 + j * 4)}%` : '15%',
                        background: color + '60',
                        transition: 'height 75ms linear',
                      }}
                    />
                  ))}
                </div>

                {/* M / S buttons */}
                <div className="flex gap-1 w-full">
                  {id !== 'master' ? (
                    <>
                      <button
                        onClick={() => toggleMute(id)}
                        className={`flex-1 h-4 rounded text-[7px] font-bold flex items-center justify-center cursor-pointer transition-all ${
                          isMuted
                            ? 'bg-red-500/30 border border-red-500/50 text-red-400'
                            : 'bg-white/[0.05] text-white/25 hover:text-white/50'
                        }`}
                      >M</button>
                      <button
                        onClick={() => toggleSolo(id)}
                        className={`flex-1 h-4 rounded text-[7px] font-bold flex items-center justify-center cursor-pointer transition-all ${
                          isSoloed
                            ? 'bg-yellow-500/30 border border-yellow-500/50 text-yellow-400'
                            : 'bg-white/[0.05] text-white/25 hover:text-white/50'
                        }`}
                      >S</button>
                    </>
                  ) : (
                    <div className="h-4 w-full" />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Transport */}
        <div className="mt-4 pt-3 border-t border-white/[0.05]">
          <div className="h-1 bg-white/[0.07] rounded-full overflow-hidden mb-3">
            {playing && (
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${progress}%`, transition: 'width 75ms linear' }} />
            )}
          </div>
          <div className="flex items-center justify-center gap-4">
            <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-white/25">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19,20 9,12 19,4"/>
                <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5"/>
              </svg>
            </div>
            <button
              onClick={playing ? stop : start}
              disabled={loading}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-60 ${
                playing ? 'bg-red-500 hover:bg-red-400' : 'bg-orange-500 hover:bg-orange-400'
              }`}
            >
              {loading
                ? <Loader2 size={16} className="text-white animate-spin" />
                : playing
                  ? <Square size={15} fill="white" className="text-white" />
                  : <Play   size={18} fill="white" className="ml-0.5" />
              }
            </button>
            <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-white/25">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,4 15,12 5,20"/>
                <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5"/>
              </svg>
            </div>
          </div>
          {!playing && !loading && (
            <p className="text-center text-[10px] text-white/20 mt-3">
              Pressione ▶ para tocar · <span className="text-white/30">M</span> = Mute · <span className="text-white/30">S</span> = Solo · experimente antes de criar conta
            </p>
          )}
          {loading && (
            <p className="text-center text-[10px] text-white/20 mt-3">Carregando as faixas...</p>
          )}
          {error && (
            <p className="text-center text-[10px] text-red-400/70 mt-3">Não deu pra carregar o áudio. Tente de novo.</p>
          )}
        </div>
      </div>
    </div>
  )
}
