import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square } from 'lucide-react'

const BPM = 88
const B = 60 / BPM       // beat in seconds
const BAR = B * 4        // bar in seconds

// C – G – Am – F progression
const PROG = [
  { bass: 65.41,  chord: [261.63, 329.63, 392.00], mel: [329.63, 293.66, 261.63, 329.63] },
  { bass: 98.00,  chord: [196.00, 246.94, 293.66], mel: [293.66, 246.94, 196.00, 293.66] },
  { bass: 110.00, chord: [220.00, 261.63, 329.63], mel: [261.63, 329.63, 261.63, 220.00] },
  { bass: 87.31,  chord: [174.61, 220.00, 261.63], mel: [261.63, 220.00, 174.61, 261.63] },
]

const CHANNELS = [
  { id: 'click',  name: 'Click',    color: '#94a3b8' },
  { id: 'vocals', name: 'Vocais',   color: '#06b6d4' },
  { id: 'drums',  name: 'Bateria',  color: '#f59e0b' },
  { id: 'bass',   name: 'Baixo',    color: '#10b981' },
  { id: 'guitar', name: 'Guitarra', color: '#ef4444' },
  { id: 'piano',  name: 'Piano',    color: '#8b5cf6' },
  { id: 'pad',    name: 'Pad',      color: '#ec4899' },
  { id: 'master', name: 'Master',   color: '#f97316' },
] as const

type ChId = typeof CHANNELS[number]['id']
type GainMap = Partial<Record<ChId, GainNode>>
type AnalMap = Partial<Record<ChId, AnalyserNode>>

// ─── Audio helpers (access acRef.current inside – stable because refs don't change) ─────

function mkNote(
  acRef: React.MutableRefObject<AudioContext | null>,
  dest: AudioNode, freq: number, t: number, dur: number,
  type: OscillatorType, vol: number, att = 0.005, rel = 0.08
) {
  const ac = acRef.current!
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + att)
  g.gain.setValueAtTime(vol, t + dur - rel)
  g.gain.linearRampToValueAtTime(0, t + dur)
  g.connect(dest)
  const o = ac.createOscillator()
  o.type = type
  o.frequency.value = freq
  o.connect(g)
  o.start(t)
  o.stop(t + dur + 0.01)
}

function mkKick(acRef: React.MutableRefObject<AudioContext | null>, dest: AudioNode, t: number) {
  const ac = acRef.current!
  const g = ac.createGain()
  g.gain.setValueAtTime(1, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
  g.connect(dest)
  const o = ac.createOscillator()
  o.frequency.setValueAtTime(160, t)
  o.frequency.exponentialRampToValueAtTime(28, t + 0.38)
  o.connect(g)
  o.start(t)
  o.stop(t + 0.5)
}

function mkSnare(acRef: React.MutableRefObject<AudioContext | null>, dest: AudioNode, t: number) {
  const ac = acRef.current!
  const len = Math.floor(ac.sampleRate * 0.18)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf
  const flt = ac.createBiquadFilter()
  flt.type = 'bandpass'
  flt.frequency.value = 2800
  flt.Q.value = 0.7
  src.connect(flt)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.45, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
  flt.connect(g)
  g.connect(dest)
  src.start(t)
  src.stop(t + 0.22)
}

function mkHat(acRef: React.MutableRefObject<AudioContext | null>, dest: AudioNode, t: number, open = false) {
  const ac = acRef.current!
  const dur = open ? 0.22 : 0.04
  const len = Math.floor(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf
  const flt = ac.createBiquadFilter()
  flt.type = 'highpass'
  flt.frequency.value = 7500
  src.connect(flt)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.1, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  flt.connect(g)
  g.connect(dest)
  src.start(t)
  src.stop(t + dur + 0.01)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DemoMixer() {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted]   = useState<Partial<Record<ChId, boolean>>>({})
  const [soloed, setSoloed] = useState<Partial<Record<ChId, boolean>>>({})
  const [levels, setLevels] = useState<Record<ChId, number>>(
    Object.fromEntries(CHANNELS.map(c => [c.id, 0])) as Record<ChId, number>
  )

  const acRef        = useRef<AudioContext | null>(null)
  const gainsRef     = useRef<GainMap>({})
  const analysersRef = useRef<AnalMap>({})
  const nextBeatRef  = useRef(0)
  const beatIdxRef   = useRef(0)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef       = useRef(0)

  // Apply mute/solo
  useEffect(() => {
    const ac = acRef.current
    if (!ac) return
    const hasSolo = Object.values(soloed).some(Boolean)
    CHANNELS.forEach(({ id }) => {
      if (id === 'master') return
      const g = gainsRef.current[id]
      if (!g) return
      const active = hasSolo ? !!soloed[id] : !muted[id]
      g.gain.setTargetAtTime(active ? 1 : 0, ac.currentTime, 0.02)
    })
  }, [muted, soloed])

  const scheduleBeat = useCallback((beatTime: number, beatIdx: number) => {
    const beat = beatIdx % 4
    const bar  = Math.floor(beatIdx / 4)
    const p    = PROG[bar % PROG.length]
    const gs   = gainsRef.current

    // Click: accented on beat 0
    if (gs.click)
      mkNote(acRef, gs.click, beat === 0 ? 1400 : 1000, beatTime, 0.04, 'sine', beat === 0 ? 0.65 : 0.45)

    // Drums: kick 1+3, snare 2+4, hats every beat + 8th
    if (gs.drums) {
      if (beat === 0 || beat === 2) mkKick(acRef, gs.drums, beatTime)
      if (beat === 1 || beat === 3) mkSnare(acRef, gs.drums, beatTime)
      mkHat(acRef, gs.drums, beatTime, beat === 3)
      if (beat < 3) mkHat(acRef, gs.drums, beatTime + B / 2)
    }

    // Bass: root held for bar + pickup
    if (gs.bass) {
      if (beat === 0) {
        mkNote(acRef, gs.bass, p.bass,     beatTime, BAR * 0.88, 'triangle', 0.55, 0.008, 0.1)
        mkNote(acRef, gs.bass, p.bass * 2, beatTime, B   * 0.25, 'triangle', 0.18, 0.005, 0.04)
      }
      if (beat === 3) {
        const next = PROG[(bar + 1) % PROG.length]
        mkNote(acRef, gs.bass, next.bass, beatTime + B * 0.75, B * 0.25, 'triangle', 0.28, 0.005, 0.02)
      }
    }

    // Guitar: arpeggio on beats 0 and 2
    if (gs.guitar && (beat === 0 || beat === 2))
      p.chord.forEach((f, i) =>
        mkNote(acRef, gs.guitar!, f * 0.5, beatTime + i * 0.025, B * 0.85, 'sawtooth', 0.1 - i * 0.02, 0.01, 0.2)
      )

    // Piano: chord hits on 0 and 2
    if (gs.piano && (beat === 0 || beat === 2))
      p.chord.forEach(f => mkNote(acRef, gs.piano!, f, beatTime, B * 1.3, 'sine', 0.17, 0.005, 0.28))

    // Vocals: melody line, one note per beat
    if (gs.vocals)
      mkNote(acRef, gs.vocals, p.mel[beat], beatTime, B * 0.78, 'sine', 0.22, 0.04, 0.12)

    // Pad: slow-attack sustained chord, new on bar start
    if (gs.pad && beat === 0)
      p.chord.forEach(f => {
        mkNote(acRef, gs.pad!, f * 0.5, beatTime, BAR * 1.05, 'sine', 0.13, 0.55, 0.7)
        mkNote(acRef, gs.pad!, f,       beatTime, BAR * 1.05, 'sine', 0.09, 0.65, 0.8)
      })
  }, [])

  const runScheduler = useCallback(() => {
    const ac = acRef.current
    if (!ac) return
    while (nextBeatRef.current < ac.currentTime + 0.15) {
      scheduleBeat(nextBeatRef.current, beatIdxRef.current)
      nextBeatRef.current += B
      beatIdxRef.current++
    }
  }, [scheduleBeat])

  const animMeters = useCallback(() => {
    const buf = new Uint8Array(32)
    const newLevels: Record<string, number> = {}
    CHANNELS.forEach(({ id }) => {
      const a = analysersRef.current[id]
      if (!a) { newLevels[id] = 0; return }
      a.getByteFrequencyData(buf)
      newLevels[id] = buf.reduce((s, v) => s + v, 0) / buf.length / 255
    })
    setLevels(newLevels as Record<ChId, number>)
    rafRef.current = requestAnimationFrame(animMeters)
  }, [])

  const start = useCallback(() => {
    const ac = new AudioContext()
    acRef.current = ac

    const masterGain = ac.createGain()
    masterGain.gain.value = 0.78
    masterGain.connect(ac.destination)

    const masterAnalyser = ac.createAnalyser()
    masterAnalyser.fftSize = 256
    masterGain.connect(masterAnalyser)
    analysersRef.current.master = masterAnalyser

    CHANNELS.forEach(({ id }) => {
      if (id === 'master') return
      const g = ac.createGain()
      g.gain.value = 1
      const analyser = ac.createAnalyser()
      analyser.fftSize = 256
      g.connect(analyser)
      analyser.connect(masterGain)
      gainsRef.current[id]     = g
      analysersRef.current[id] = analyser
    })

    nextBeatRef.current = ac.currentTime + 0.05
    beatIdxRef.current  = 0
    runScheduler()
    timerRef.current = setInterval(runScheduler, 50)
    rafRef.current   = requestAnimationFrame(animMeters)
    setPlaying(true)
  }, [runScheduler, animMeters])

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    acRef.current?.close()
    acRef.current    = null
    gainsRef.current = {}
    analysersRef.current = {}
    setPlaying(false)
    setMuted({})
    setSoloed({})
    setLevels(Object.fromEntries(CHANNELS.map(c => [c.id, 0])) as Record<ChId, number>)
  }, [])

  useEffect(() => () => { stop() }, [stop])

  const toggleMute  = (id: ChId) => { if (id !== 'master') setMuted(p  => ({ ...p, [id]: !p[id] })) }
  const toggleSolo  = (id: ChId) => { if (id !== 'master') setSoloed(p => ({ ...p, [id]: !p[id] })) }
  const hasSolo = Object.values(soloed).some(Boolean)

  return (
    <div className="glow-o rounded-2xl overflow-hidden border border-white/[0.09] bg-[#111113]">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 px-4 h-9 border-b border-white/[0.06] bg-[#0e0e10]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
        <span className="ml-auto text-[10px] text-white/15 font-mono tracking-wider hidden sm:block">
          PLAYBACK STUDIO — MIXER AO VIVO
        </span>
      </div>

      <div className="p-5">
        {/* Channel strips */}
        <div className="grid grid-cols-8 gap-2">
          {CHANNELS.map(({ id, name, color }) => {
            const isMuted  = !!muted[id]
            const isSoloed = !!soloed[id]
            const active   = id === 'master' || (hasSolo ? isSoloed : !isMuted)
            const lv       = levels[id] ?? 0
            const barH     = active && playing ? Math.min(96, lv * 150 + 4) : 0

            return (
              <div key={id} className="flex flex-col items-center gap-1.5">
                <span className="text-[8px] sm:text-[9px] font-bold truncate w-full text-center" style={{ color }}>{name}</span>

                {/* Level bar */}
                <div className="w-full h-20 bg-black/50 rounded-sm border border-white/[0.04] flex flex-col-reverse overflow-hidden">
                  <div
                    className="w-full"
                    style={{
                      height: `${barH}%`,
                      background: `linear-gradient(to top, ${color}90, ${color}20)`,
                      transition: 'height 80ms linear',
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
                        transition: 'height 80ms linear',
                      }}
                    />
                  ))}
                </div>

                {/* M / S */}
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
            {playing && <div className="h-full bg-orange-500 rounded-full animate-pulse" style={{ width: '42%' }} />}
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
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                playing ? 'bg-red-500 hover:bg-red-400' : 'bg-orange-500 hover:bg-orange-400'
              }`}
            >
              {playing
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
          {!playing && (
            <p className="text-center text-[10px] text-white/20 mt-3">
              Pressione ▶ para tocar · <span className="text-white/30">M</span> = Mute · <span className="text-white/30">S</span> = Solo — experimente antes de criar conta
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
