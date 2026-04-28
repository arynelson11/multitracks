import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square } from 'lucide-react'

// ─── Musical constants ────────────────────────────────────────────────────────
const BPM  = 108          // upbeat gospel tempo
const B    = 60 / BPM     // ~0.556 s per beat
const BAR  = B * 4

// Gospel: G – C – D – C  (G major — bright and uplifting)
const PROG = [
  {
    bass:  98.00,   fifth: 146.83,                            // G2, D3
    chord: [196.00, 246.94, 293.66, 392.00],                  // G3 B3 D4 G4
    mel:   [392.00, 493.88, 440.00, 392.00],                  // G4 B4 A4 G4
  },
  {
    bass: 130.81,   fifth: 196.00,                            // C3, G3
    chord: [261.63, 329.63, 392.00, 523.25],                  // C4 E4 G4 C5
    mel:  [392.00,  329.63, 392.00, 493.88],                  // G4 E4 G4 B4
  },
  {
    bass: 146.83,   fifth: 220.00,                            // D3, A3
    chord: [293.66, 369.99, 440.00, 587.33],                  // D4 F#4 A4 D5
    mel:  [493.88,  440.00, 493.88, 440.00],                  // B4 A4 B4 A4
  },
  {
    bass: 130.81,   fifth: 196.00,                            // C3, G3
    chord: [261.63, 329.63, 392.00, 523.25],                  // C4 E4 G4 C5
    mel:  [392.00,  329.63, 261.63, 293.66],                  // G4 E4 C4 D4
  },
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

type ChId   = typeof CHANNELS[number]['id']
type GainMap = Partial<Record<ChId, GainNode>>
type AnalMap = Partial<Record<ChId, AnalyserNode>>

// ─── Audio helpers ────────────────────────────────────────────────────────────
// All helpers receive `ac` explicitly to avoid stale-closure issues.

function mkClick(ac: AudioContext, dest: AudioNode, freq: number, t: number, vol: number) {
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
  g.connect(dest)
  const o = ac.createOscillator()
  o.type = 'sine'; o.frequency.value = freq
  o.connect(g); o.start(t); o.stop(t + 0.05)
}

function mkKick(ac: AudioContext, dest: AudioNode, t: number, vol = 1.0) {
  // Tonal sweep (the "thump")
  const g = ac.createGain()
  g.gain.setValueAtTime(vol * 0.85, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  g.connect(dest)
  const o = ac.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(170, t)
  o.frequency.exponentialRampToValueAtTime(36, t + 0.36)
  o.connect(g); o.start(t); o.stop(t + 0.45)

  // Attack transient (the "click")
  const clickLen = Math.floor(ac.sampleRate * 0.012)
  const buf = ac.createBuffer(1, clickLen, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < clickLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / clickLen)
  const src = ac.createBufferSource(); src.buffer = buf
  const cg = ac.createGain(); cg.gain.value = vol * 0.4
  src.connect(cg); cg.connect(dest); src.start(t); src.stop(t + 0.015)
}

function mkSnare(ac: AudioContext, dest: AudioNode, t: number) {
  // Noise body
  const len = Math.floor(ac.sampleRate * 0.22)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource(); src.buffer = buf
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.9
  src.connect(bp)
  const ng = ac.createGain()
  ng.gain.setValueAtTime(0.55, t)
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
  bp.connect(ng); ng.connect(dest); src.start(t); src.stop(t + 0.24)

  // Tonal crack (adds body)
  const to = ac.createOscillator()
  to.type = 'sine'
  to.frequency.setValueAtTime(220, t)
  to.frequency.exponentialRampToValueAtTime(90, t + 0.06)
  const tg = ac.createGain()
  tg.gain.setValueAtTime(0.4, t)
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
  to.connect(tg); tg.connect(dest); to.start(t); to.stop(t + 0.1)
}

function mkHat(ac: AudioContext, dest: AudioNode, t: number, open = false) {
  const dur = open ? 0.24 : 0.045
  const len = Math.floor(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource(); src.buffer = buf
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 8500
  src.connect(hp)
  const g = ac.createGain()
  g.gain.setValueAtTime(open ? 0.12 : 0.09, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  hp.connect(g); g.connect(dest); src.start(t); src.stop(t + dur + 0.01)
}

function mkBass(ac: AudioContext, dest: AudioNode, freq: number, t: number, dur: number) {
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.75, t + 0.008)
  g.gain.setValueAtTime(0.75, t + dur - 0.04)
  g.gain.linearRampToValueAtTime(0, t + dur)
  g.connect(dest)

  // Triangle fundamental
  const o = ac.createOscillator()
  o.type = 'triangle'; o.frequency.value = freq
  o.connect(g); o.start(t); o.stop(t + dur + 0.01)

  // Sub octave (adds depth)
  const sub = ac.createOscillator()
  sub.type = 'sine'; sub.frequency.value = freq / 2
  const sg = ac.createGain(); sg.gain.value = 0.35
  sub.connect(sg); sg.connect(g); sub.start(t); sub.stop(t + dur + 0.01)

  // Low-pass to keep it warm
  const lpf = ac.createBiquadFilter()
  lpf.type = 'lowpass'; lpf.frequency.value = 400
  // Note: g already connected, lpf is just for the sub path above
}

function mkPianoChord(ac: AudioContext, dest: AudioNode, freqs: number[], t: number, stagger = false) {
  freqs.forEach((freq, idx) => {
    const offset = stagger ? idx * 0.008 : 0
    const start = t + offset

    const g = ac.createGain()
    // Piano envelope: instant attack → fast initial decay → slow sustain
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(0.28, start + 0.003)
    g.gain.exponentialRampToValueAtTime(0.18, start + 0.12)
    g.gain.exponentialRampToValueAtTime(0.001, start + 1.6)
    g.connect(dest)

    // Fundamental (triangle — warm)
    const o1 = ac.createOscillator()
    o1.type = 'triangle'; o1.frequency.value = freq
    o1.connect(g); o1.start(start); o1.stop(start + 1.7)

    // 2nd harmonic
    const o2 = ac.createOscillator()
    o2.type = 'sine'; o2.frequency.value = freq * 2
    const g2 = ac.createGain(); g2.gain.value = 0.22
    o2.connect(g2); g2.connect(g); o2.start(start); o2.stop(start + 1.2)

    // Bright attack partial (decays fast — simulates piano hammer)
    const o3 = ac.createOscillator()
    o3.type = 'sine'; o3.frequency.value = freq * 4
    const g3 = ac.createGain()
    g3.gain.setValueAtTime(0.1, start)
    g3.gain.exponentialRampToValueAtTime(0.001, start + 0.06)
    o3.connect(g3); g3.connect(g); o3.start(start); o3.stop(start + 0.08)
  })
}

function mkOrgan(ac: AudioContext, dest: AudioNode, freqs: number[], t: number, dur: number) {
  freqs.forEach(freq => {
    const masterG = ac.createGain()
    masterG.gain.setValueAtTime(0, t)
    masterG.gain.linearRampToValueAtTime(0.07, t + 0.015)  // fast organ attack
    masterG.gain.setValueAtTime(0.07, t + dur - 0.04)
    masterG.gain.linearRampToValueAtTime(0, t + dur)

    // Low-pass softens square wave harshness
    const lpf = ac.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = 1800; lpf.Q.value = 0.5
    masterG.connect(lpf); lpf.connect(dest)

    // Drawbars: 8' (fundamental), 4' (octave), 16' (sub)
    const drawbars: [number, number][] = [[1, 0.6], [2, 0.35], [0.5, 0.25]]
    drawbars.forEach(([mult, v]) => {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'square'; o.frequency.value = freq * mult; g.gain.value = v
      o.connect(g); g.connect(masterG); o.start(t); o.stop(t + dur + 0.05)
    })
  })
}

function mkVocal(ac: AudioContext, dest: AudioNode, freq: number, t: number, dur: number) {
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.28, t + 0.06)  // slow attack = sung feel
  g.gain.setValueAtTime(0.28, t + dur - 0.08)
  g.gain.linearRampToValueAtTime(0, t + dur)
  g.connect(dest)

  // Main oscillator
  const o = ac.createOscillator()
  o.type = 'sine'; o.frequency.value = freq
  o.connect(g); o.start(t); o.stop(t + dur + 0.01)

  // Vibrato LFO (fades in naturally)
  const lfo = ac.createOscillator()
  const lfoG = ac.createGain()
  lfo.type = 'sine'; lfo.frequency.value = 5.8
  lfoG.gain.setValueAtTime(0, t)
  lfoG.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.4)  // vibrato fades in
  lfo.connect(lfoG); lfoG.connect(o.frequency)
  lfo.start(t); lfo.stop(t + dur + 0.02)

  // Thin layer of filtered noise for "breath" texture
  const blen = Math.floor(ac.sampleRate * dur)
  const bbuf = ac.createBuffer(1, blen, ac.sampleRate)
  const bd = bbuf.getChannelData(0)
  for (let i = 0; i < blen; i++) bd[i] = (Math.random() * 2 - 1) * 0.015
  const bsrc = ac.createBufferSource(); bsrc.buffer = bbuf
  bsrc.connect(g); bsrc.start(t); bsrc.stop(t + dur + 0.01)
}

function mkGuitarStab(ac: AudioContext, dest: AudioNode, freqs: number[], t: number) {
  freqs.forEach((freq, i) => {
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t + i * 0.004)
    g.gain.linearRampToValueAtTime(0.09 - i * 0.015, t + i * 0.004 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.004 + 0.12)

    const lpf = ac.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = 3500; lpf.Q.value = 0.5
    g.connect(lpf); lpf.connect(dest)

    const o = ac.createOscillator()
    o.type = 'sawtooth'; o.frequency.value = freq
    o.connect(g); o.start(t + i * 0.004); o.stop(t + i * 0.004 + 0.15)
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DemoMixer() {
  const [playing, setPlaying] = useState(false)
  const [muted,   setMuted]   = useState<Partial<Record<ChId, boolean>>>({})
  const [soloed,  setSoloed]  = useState<Partial<Record<ChId, boolean>>>({})
  const [levels,  setLevels]  = useState<Record<ChId, number>>(
    Object.fromEntries(CHANNELS.map(c => [c.id, 0])) as Record<ChId, number>
  )

  const acRef        = useRef<AudioContext | null>(null)
  const gainsRef     = useRef<GainMap>({})
  const analysersRef = useRef<AnalMap>({})
  const nextBeatRef  = useRef(0)
  const beatIdxRef   = useRef(0)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef       = useRef(0)

  // Apply mute / solo
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
    const ac = acRef.current
    if (!ac) return
    const beat = beatIdx % 4
    const bar  = Math.floor(beatIdx / 4)
    const p    = PROG[bar % PROG.length]
    const gs   = gainsRef.current

    // ── Click ───────────────────────────────────────────────
    if (gs.click) {
      mkClick(ac, gs.click, beat === 0 ? 1600 : 1050, beatTime, beat === 0 ? 0.7 : 0.45)
    }

    // ── Drums ────────────────────────────────────────────────
    if (gs.drums) {
      // Kick on 1 and 3
      if (beat === 0) mkKick(ac, gs.drums, beatTime, 1.0)
      if (beat === 2) mkKick(ac, gs.drums, beatTime, 0.88)

      // Strong gospel backbeat: snare on 2 and 4
      if (beat === 1 || beat === 3) mkSnare(ac, gs.drums, beatTime)

      // 8th note hi-hats (every beat + half beat)
      mkHat(ac, gs.drums, beatTime)
      mkHat(ac, gs.drums, beatTime + B / 2, beat === 3)  // open before the 1

      // Gospel bounce: extra soft kick on the "and" of 2
      if (beat === 1) mkKick(ac, gs.drums, beatTime + B * 0.75, 0.38)

      // 16th note hat accent on the "a" of 1 and 3 (adds groove)
      if (beat === 0 || beat === 2) mkHat(ac, gs.drums, beatTime + B * 0.75)
    }

    // ── Bass ─────────────────────────────────────────────────
    if (gs.bass) {
      // Root held across beats 1-2
      if (beat === 0) mkBass(ac, gs.bass, p.bass, beatTime, B * 1.85)
      // Fifth on beat 3
      if (beat === 2) mkBass(ac, gs.bass, p.fifth, beatTime, B * 1.2)
      // Pickup note on beat 4 (approach to next chord root)
      if (beat === 3) {
        const next = PROG[(bar + 1) % PROG.length]
        mkBass(ac, gs.bass, next.bass, beatTime + B * 0.75, B * 0.28)
      }
    }

    // ── Piano ─────────────────────────────────────────────────
    if (gs.piano) {
      // Full chord hit on beat 1 (staggered for natural feel)
      if (beat === 0) mkPianoChord(ac, gs.piano, p.chord, beatTime, true)
      // Lighter chord stab on beat 2 (gospel pump)
      if (beat === 1) mkPianoChord(ac, gs.piano, p.chord.slice(1), beatTime + B * 0.5, false)
      // Chord hit on beat 3
      if (beat === 2) mkPianoChord(ac, gs.piano, p.chord, beatTime, true)
      // Anticipation chord before beat 1 of next bar
      if (beat === 3) mkPianoChord(ac, gs.piano, p.chord.slice(1, 3), beatTime + B * 0.75, false)
    }

    // ── Guitar ────────────────────────────────────────────────
    if (gs.guitar) {
      const stabFreqs = p.chord.slice(1, 4)  // upper voicing
      // Stab on beat 1
      if (beat === 0) mkGuitarStab(ac, gs.guitar, stabFreqs, beatTime)
      // Syncopated stab on the "and" of 2
      if (beat === 1) mkGuitarStab(ac, gs.guitar, stabFreqs, beatTime + B * 0.5)
      // Stab on beat 3
      if (beat === 2) mkGuitarStab(ac, gs.guitar, stabFreqs, beatTime)
      // Anticipation stab before the 1
      if (beat === 3) mkGuitarStab(ac, gs.guitar, stabFreqs, beatTime + B * 0.75)
    }

    // ── Vocals ────────────────────────────────────────────────
    if (gs.vocals) {
      const note = p.mel[beat]
      if (note > 0) mkVocal(ac, gs.vocals, note, beatTime, B * 0.82)
    }

    // ── Organ/Pad ─────────────────────────────────────────────
    if (gs.pad && beat === 0) {
      // Sustained organ chord for the full bar
      mkOrgan(ac, gs.pad, p.chord.slice(0, 3), beatTime, BAR * 1.05)
    }
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

    // ── Master chain: gain → compressor → destination ─────────
    const compressor = ac.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value      = 12
    compressor.ratio.value     = 6
    compressor.attack.value    = 0.002
    compressor.release.value   = 0.12
    compressor.connect(ac.destination)

    const masterGain = ac.createGain()
    masterGain.gain.value = 0.82
    masterGain.connect(compressor)

    const masterAnalyser = ac.createAnalyser()
    masterAnalyser.fftSize = 256
    masterGain.connect(masterAnalyser)
    analysersRef.current.master = masterAnalyser

    // ── Per-channel routing ────────────────────────────────────
    CHANNELS.forEach(({ id }) => {
      if (id === 'master') return
      const g       = ac.createGain(); g.gain.value = 1
      const analyser = ac.createAnalyser(); analyser.fftSize = 256
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
    acRef.current        = null
    gainsRef.current     = {}
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
              <div className="h-full bg-orange-500 rounded-full animate-pulse" style={{ width: '42%' }} />
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
