// As ferramentas da separação ligadas ao palco (Parte 3, painel SEPARAÇÃO): BPM e click, SYNC, voz
// guia, baixar e publicar na nuvem, sobre a música do palco que veio de uma separação. Lê a
// separação da música ativa e grava de volta em "Minhas separações" sempre com a data dela (P15).
// Com a música tocando ou na pré-contagem, nada que gera, analisa ou baixa roda (P3); marcar a voz
// guia funciona sempre, no tempo ouvido. Erro vira `message` (a frase de hoje), nunca alert.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, Song } from '../types'
import type { SavedSeparation, SavedStem } from './useSeparationLibrary'
import type { BeatGrid } from '../lib/beatGrid'
import { FAMILY_COLOR } from '../lib/channelNames'
import { loadClickSelection, saveClickSelection, type ClickLibrarySelection } from '../lib/clickLibrary'
import { SEPARATOR_CLICK_NAME, VOICE_GUIDE_NAME, isAppClickName } from '../lib/generatedChannels'
import { publishToCloud } from '../lib/separation/cloudPublish'
import {
  BEATS_PER_BAR, bpmReport, clickPlan, generateSeparatorClick, measureGrid, normalizeBpm, nudgeOffset, pickGridSource,
  scaleBpm as scaleBpmText, stepBpm as stepBpmText, tapTempo, type SeparatorMeter,
} from '../lib/separation/separatorClick'
import { downloadStem, readDownloadFormat, writeDownloadFormat, type DownloadFormat } from '../lib/separation/stemFiles'
import {
  detectVoiceCues, parseCueTime, renderVoiceGuideWav, voiceSourceTrack, type GuideAudio, type GuideCueOption, type VoiceCue,
} from '../lib/separation/voiceGuide'
import { BPM_COPY, CLOUD_COPY, DOWNLOAD_ERROR, VOICE_COPY } from '../components/separation/toolsCopy'

export interface StageSeparationBridge {
  /** A música ativa do palco. */
  song: Song | null
  /** Tocando ou na pré-contagem. */
  busy: boolean
  heardPosition(): number
  /** O App passa (n, f) => replaceAppChannel(song.id, n, f): os nomes que saem, ou um casador de nome. */
  replaceChannel(names: readonly string[] | ((name: string) => boolean), file: File): Promise<Channel | null>
}

export interface StageSeparationStore {
  userId: string | null
  isAdmin: boolean
  getSeparation(id: string): Promise<SavedSeparation | null>
  saveSeparation(data: Omit<SavedSeparation, 'id' | 'createdAt'> & { id: string; createdAt: number }): Promise<string | null>
  /** O App passa uploadToR2('stems', path, file) e devolve a URL, ou nulo. */
  upload(path: string, file: File): Promise<string | null>
}

export type SeparationBusy = 'click' | 'bpm' | 'guide' | 'cues' | 'download' | 'cloud' | null

/** Onde a frase de erro aparece (sep-2 M4): cada ferramenta mostra só a dela. */
export type SeparationMessageArea = 'faixas' | 'voz' | 'bpm' | 'cloud'
export type SeparationMessages = Readonly<Record<SeparationMessageArea, string | null>>

export interface StageSeparationCloud { name: string; artist: string; bpm: string; songKey: string; cover: File | null; publishGlobal: boolean; progress: number; status: string }

export interface StageSeparation {
  sep: SavedSeparation | null; loading: boolean
  bpm: string; meter: SeparatorMeter; accentBeat1: boolean; downbeatShift: number; clickSel: ClickLibrarySelection
  offsetMs: number; hasClick: boolean; gridInfo: string
  cues: readonly VoiceCue[]; cuesPending: boolean; hasGuide: boolean; guideTab: 'sections' | 'dynamic'
  format: DownloadFormat; downloadingId: string | null
  cloud: StageSeparationCloud
  busy: SeparationBusy; messages: SeparationMessages
  setBpm(t: string): void; blurBpm(): void; stepBpm(d: 1 | -1): void; tap(): void; scaleBpm(f: 2 | 0.5): void; detectBpm(): Promise<void>
  setMeter(m: SeparatorMeter): void; setAccent(on: boolean): void; shiftDownbeat(d: 1 | -1): void; setClickSel(p: Partial<ClickLibrarySelection>): void
  generateClick(): Promise<void>; nudge(deltaMs: 10 | -10): void
  setGuideTab(t: 'sections' | 'dynamic'): void; addCue(o: GuideCueOption): void; removeCue(id: string): void; setCueTime(id: string, raw: string): void
  clearCues(): void; detectCues(): Promise<void>; commitVoiceGuide(): Promise<void>
  setFormat(f: DownloadFormat): void; download(stemId: string): Promise<void>
  setCloud(p: Partial<StageSeparationCloud>): void; publish(): Promise<boolean>
  /** Fechar a gaveta: gera a voz guia pendente se parado (P4) e grava o que falta. */
  flushPending(): Promise<void>
}

// O trabalho em cima de uma separação, preso à música e à separação de onde veio (`key`):
// trocar de música não precisa zerar nada, a chave diferente já esconde o de antes. O que estava
// pendente na música que sai é gravado na troca, e a voz guia por gerar volta com ela (ver leaveWork).
interface Work {
  key: string
  sep: SavedSeparation | null
  bpm: string; meter: SeparatorMeter; accentBeat1: boolean; downbeatShift: number; offsetMs: number; gridInfo: string
  cues: VoiceCue[]; cuesPending: boolean; guideTab: 'sections' | 'dynamic'
  cloud: StageSeparationCloud
  /** Algo mudou que ainda não foi pra "Minhas separações". */
  dirty: boolean
}

const EMPTY_CLOUD: StageSeparationCloud = { name: '', artist: '', bpm: '120', songKey: 'C', cover: null, publishGlobal: false, progress: 0, status: '' }
const SAVE_DELAY_MS = 800
const SYNC_DELAY_MS = 600
/** A leitura da separação que falha tenta de novo depois disso (sep-1 M7), e para depois da última. */
const READ_RETRY_MS: readonly number[] = [3000, 10000, 30000]
const NO_MESSAGES: SeparationMessages = { faixas: null, voz: null, bpm: null, cloud: null }
const PUBLISHED = 'Sucesso! Música publicada na nuvem.'
const CLICK_COLOR = '#e2e8f0'

function workFor(key: string, sep: SavedSeparation | null): Work {
  return {
    key, sep,
    bpm: sep?.bpm || '120', meter: '4/4', accentBeat1: true, downbeatShift: 0, offsetMs: 0, gridInfo: '',
    cues: [...(sep?.voiceCues ?? [])].sort((a, b) => a.time - b.time), cuesPending: false, guideTab: 'sections',
    cloud: sep ? { ...EMPTY_CLOUD, name: sep.songName, artist: sep.artist, bpm: sep.bpm || '120', songKey: sep.songKey || 'C' } : EMPTY_CLOUD,
    dirty: false,
  }
}

/** Põe o trabalho na fila da separação (inicio-1 I1 e M1): um por vez, na ordem em que chegaram, pra
 *  duas gravações (ou uma leitura e uma gravação) nunca se cruzarem entre o getSeparation e o upsert. */
function enqueue<T>(queue: Map<string, Promise<unknown>>, id: string, job: () => Promise<T>): Promise<T> {
  const run = (queue.get(id) ?? Promise.resolve()).then(job)
  const tail = run.catch(() => undefined)
  queue.set(id, tail)
  void tail.then(() => { if (queue.get(id) === tail) queue.delete(id) })
  return run
}

/** O que uma ação muda na separação gravada: a faixa nova (click ou voz guia) e o nome publicado. */
interface SepChange { stem?: SavedStem; songName?: string; artist?: string }

/** As amostras de cada lado do áudio do canal, pra medir a grade. */
function samplesOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
}

let decodeCtx: BaseAudioContext | null = null
/** Contexto só de decodificar as falas da voz guia (não toca nada nem mexe no relógio do palco). */
function decoder(): BaseAudioContext {
  if (!decodeCtx) {
    const Offline = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
    decodeCtx = new Offline(1, 1, 44100)
  }
  return decodeCtx
}

type StageSeparationActions = Omit<StageSeparation,
  'sep' | 'loading' | 'bpm' | 'meter' | 'accentBeat1' | 'downbeatShift' | 'clickSel' | 'offsetMs' | 'hasClick' | 'gridInfo'
  | 'cues' | 'cuesPending' | 'hasGuide' | 'guideTab' | 'format' | 'downloadingId' | 'cloud' | 'busy' | 'messages'>

export function useStageSeparation(bridge: StageSeparationBridge, store: StageSeparationStore): StageSeparation {
  const song = bridge.song
  const sepId = song?.separation?.id ?? null
  const key = song && sepId ? `${song.id}|${sepId}` : null

  const [work, setWork] = useState<Work | null>(null)
  const [msgs, setMsgs] = useState<{ key: string | null; byArea: SeparationMessages }>({ key: null, byArea: NO_MESSAGES })
  const [busy, setBusyState] = useState<SeparationBusy>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [clickSel, setClickSelState] = useState<ClickLibrarySelection>(() => loadClickSelection())
  const [format, setFormatState] = useState<DownloadFormat>(() => readDownloadFormat())

  const cur = work && work.key === key ? work : null
  const messages = msgs.key === key ? msgs.byArea : NO_MESSAGES

  // A versão mais nova de tudo pros timers e pras ações que esperam (atualizada só em efeito).
  const live = useRef({ bridge, store, cur, busy, clickSel, format, key, work })
  useEffect(() => { live.current = { bridge, store, cur, busy, clickSel, format, key, work } })
  const busyRef = useRef<SeparationBusy>(null)
  const setBusy = (b: SeparationBusy) => { busyRef.current = b; setBusyState(b) }
  const taps = useRef<number[]>([])
  const gridCache = useRef<{ key: string; grid: BeatGrid } | null>(null)
  const guideCache = useRef(new Map<string, GuideAudio>())
  const nudgeTimer = useRef<number | null>(null)
  // SYNC que o timer não pôde regerar (a música começou antes dos 600 ms, sep-1 M1): regera na parada.
  const syncPending = useRef<{ key: string; offset: number } | null>(null)
  const cueSeq = useRef(0)
  // Trabalho da música que saiu (review-sep-fix, gaveta presa à música): as chaves com a voz guia
  // ainda por gerar. A gravação da troca entra na fila da separação, que a leitura da volta espera.
  const cuesPendingByKey = useRef(new Set<string>())
  const saveQueue = useRef(new Map<string, Promise<unknown>>())
  const withPendingCues = (w: Work): Work => {
    if (!cuesPendingByKey.current.delete(w.key)) return w
    return { ...w, cuesPending: true }
  }

  const patch = useCallback((p: Partial<Work> | ((w: Work) => Partial<Work>)) => {
    setWork((w) => (w && w.key === live.current.key ? { ...w, ...(typeof p === 'function' ? p(w) : p) } : w))
  }, [])
  const say = (area: SeparationMessageArea, text: string | null) => {
    const k = live.current.key
    setMsgs((m) => ({ key: k, byArea: { ...(m.key === k ? m.byArea : NO_MESSAGES), [area]: text } }))
  }
  const stopped = () => !live.current.bridge.busy && busyRef.current === null

  // Grava em "Minhas separações": sempre com a id e a data da separação, nunca sem faixas, na fila
  // da separação e sobre o registro lido (inicio-1 I1 e M1). A ação grava só o que ela muda (a faixa
  // nova sobre as faixas do registro, o nome publicado), com as marcações e o BPM do trabalho mais
  // novo da mesma música, ou os do registro se a música já saiu. Só a gravação da troca (`leave`)
  // grava as marcações e o BPM do trabalho que sai.
  // `from`: o trabalho de quando a ação começou (a música pode ter trocado no meio de um await).
  const persist = useCallback((change: SepChange = {}, from?: Work, leave = false): Promise<void> => {
    const w = from ?? live.current.cur
    if (!w?.sep) return Promise.resolve()
    if (!change.stem && w.sep.stems.length === 0) return Promise.resolve()
    const { id, createdAt } = w.sep
    // O tom original só vem da música ativa (a gravação do timer e do fechar a gaveta).
    const originalKey = from ? null : live.current.bridge.song?.originalKey
    return enqueue(saveQueue.current, id, async () => {
      const st = live.current.store
      const rec = await st.getSeparation(id).catch(() => null)
      // Apagada em "Minhas separações" com a música ainda no palco (sep-1 M4): não volta pela gravação.
      if (!rec) return
      const { stem } = change
      const stems = stem ? [...rec.stems.filter((s) => s.id !== stem.id), stem] : rec.stems
      if (stems.length === 0) return
      const newest = live.current.work
      const src = leave ? w : newest && newest.key === w.key && newest.sep ? newest : null
      const data = {
        id, createdAt,
        songName: change.songName ?? rec.songName, artist: change.artist ?? rec.artist,
        bpm: src ? src.bpm : rec.bpm, songKey: originalKey || rec.songKey || w.sep.songKey,
        stems, voiceCues: [...(src ? src.cues : rec.voiceCues ?? [])],
      }
      await st.saveSeparation(data)
      // Mudou algo durante a gravação (uma marcação nova tocando, por exemplo): continua pendente.
      const same = (x: Work) => !!src && x.cues === src.cues && x.bpm === src.bpm
      setWork((x) => (x && x.key === w.key && x.sep ? { ...x, dirty: same(x) ? false : x.dirty, sep: { ...x.sep, ...data } } : x))
    })
  }, [])

  // Trocou de música (o AUTO, tocando, ou um toque): o trabalho da que saiu grava na hora, sem
  // esperar os 800 ms (o timer de baixo é limpo na troca), e a voz guia ainda por gerar fica
  // guardada pela chave: de volta à música, o Gerar canal continua laranja com o aviso.
  const prevKey = useRef(key)
  useEffect(() => {
    const left = prevKey.current
    prevKey.current = key
    if (!left || left === key) return
    const w = live.current.work
    if (!w || w.key !== left || !w.sep) return
    if (w.cuesPending) cuesPendingByKey.current.add(left)
    if (!w.dirty) return
    void persist({}, w, true).catch((e) => { console.error('[Separação] o trabalho da música que saiu não gravou', e) })
  }, [key, persist])

  // Lê a separação da música ativa (a de outra música fica escondida pela chave). Sem resposta
  // (offline, ou a separação ainda subindo pra nuvem), tenta de novo sozinha (sep-1 M7). A leitura
  // entra na fila da separação: a gravação da troca de música (as marcações dos últimos 800 ms) e a
  // de uma ação no ar terminam antes (por isso este efeito vem depois do da troca).
  useEffect(() => {
    if (!key || !sepId) return
    let alive = true
    let timer: number | undefined
    let attempt = 0
    const read = () => {
      void enqueue(saveQueue.current, sepId, () => live.current.store.getSeparation(sepId))
        .catch(() => null)
        .then((rec) => {
          if (!alive) return
          if (rec) { setWork(withPendingCues(workFor(key, rec))); return }
          setWork((w) => (w && w.key === key && w.sep ? w : workFor(key, null)))
          if (attempt < READ_RETRY_MS.length) timer = window.setTimeout(read, READ_RETRY_MS[attempt++])
        })
    }
    read()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [key, sepId])

  // BPM, marcações e o tom original gravam 800 ms depois da última mudança.
  const songKeyNow = song?.originalKey ?? null
  useEffect(() => {
    if (!cur?.sep || (!cur.dirty && (!songKeyNow || songKeyNow === cur.sep.songKey))) return
    const t = window.setTimeout(() => { void persist() }, SAVE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [cur?.sep, cur?.dirty, cur?.bpm, cur?.cues, songKeyNow, persist])

  useEffect(() => () => { if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current) }, [])
  // O SYNC guardado regera assim que a música para e nenhuma ferramenta está no meio (sep-1 M1).
  const bridgeBusy = bridge.busy
  useEffect(() => {
    const p = syncPending.current
    if (!p || bridgeBusy || busy !== null) return
    syncPending.current = null
    if (p.key === key) void generateClickRef.current(p.offset)
  }, [bridgeBusy, busy, key])

  // Grade medida no canal de bateria do palco (sem ela, instrumental, baixo...), com cache.
  const analyze = async (nearBpm: number | undefined, beatsPerBar: number, channels: readonly Channel[] = live.current.bridge.song?.channels ?? []): Promise<{ grid: BeatGrid; name: string } | null> => {
    const source = pickGridSource(channels)
    if (!source?.buffer) return null
    const cacheKey = `${source.id}|${nearBpm ?? 'auto'}|${beatsPerBar}`
    const name = source.customName || source.name
    if (gridCache.current?.key === cacheKey) return { grid: gridCache.current.grid, name }
    // Deixa o "Analisando" pintar antes da conta (roda na thread principal).
    await new Promise((r) => setTimeout(r, 30))
    const grid = measureGrid(samplesOf(source.buffer), source.buffer.sampleRate, { nearBpm, beatsPerBar })
    gridCache.current = { key: cacheKey, grid }
    return { grid, name }
  }

  const decodeGuide = async (url: string): Promise<GuideAudio | null> => {
    const cached = guideCache.current.get(url)
    if (cached) return cached
    try {
      const res = await fetch(url)
      const buffer = await decoder().decodeAudioData(await res.arrayBuffer())
      guideCache.current.set(url, buffer)
      return buffer
    } catch (e) {
      console.error('Voz Guia: erro ao carregar áudio:', url, e)
      return null
    }
  }

  const generateClick = async (offsetOverride?: number) => {
    // A ponte e o trabalho de agora: trocar de música no meio não leva o click pra outra música.
    const { cur: w, bridge: br, store: st, clickSel: sel } = live.current
    const s = br.song
    if (!w?.sep || !s || !stopped()) return
    setBusy('click')
    say('bpm', null)
    try {
      const typed = parseFloat(w.bpm)
      const near = Number.isFinite(typed) && typed >= 20 ? typed : 120
      let grid: BeatGrid | null = null
      try { grid = (await analyze(near, BEATS_PER_BAR[w.meter], s.channels))?.grid ?? null } catch (e) { console.warn('[Click] análise falhou', e) }
      const plan = clickPlan({ typedBpm: w.bpm, offsetMs: offsetOverride ?? w.offsetMs, downbeatShift: w.downbeatShift, grid })
      const url = await generateSeparatorClick({ plan, durationSec: s.duration || 600, sel, accentBeat1: w.accentBeat1, meter: w.meter })
      const blob = await (await fetch(url)).blob()
      URL.revokeObjectURL(url)
      const file = new File([blob], `${SEPARATOR_CLICK_NAME}.wav`, { type: 'audio/wav' })
      // Um click gerado pelo app por música (P5): troca o do motor, o de antes ou o do Metrônomo
      // (sep-1 M5), numa troca só.
      const added = await br.replaceChannel(isAppClickName, file)
      if (!added) return
      const remote = await st.upload(`${st.userId || 'anon'}/${w.sep.id}/click_${Date.now()}.wav`, file)
      if (remote) await persist({ stem: { id: 'metronome', name: SEPARATOR_CLICK_NAME, url: remote, color: CLICK_COLOR } }, w)
    } catch (e) {
      console.error('Erro ao gerar metrônomo', e)
      say('bpm', BPM_COPY.clickError)
    } finally {
      setBusy(null)
    }
  }

  const generateClickRef = useRef(generateClick)
  useEffect(() => { generateClickRef.current = generateClick })

  const commitVoiceGuide = async () => {
    const { cur: w, bridge: br, store: st } = live.current
    const s = br.song
    if (!w?.sep || !s || !stopped()) return
    if (w.cues.length === 0) { say('voz', VOICE_COPY.needCues); return }
    setBusy('guide')
    say('voz', null)
    try {
      const blob = await renderVoiceGuideWav(w.cues, s.duration || 300, decodeGuide)
      if (!blob) throw new Error('Falha ao renderizar voz guia')
      const file = new File([blob], `${VOICE_GUIDE_NAME}.wav`, { type: 'audio/wav' })
      const added = await br.replaceChannel([VOICE_GUIDE_NAME], file)
      if (!added) return
      // Também na música que saiu no meio da geração: de volta, nada fica pendente à toa.
      cuesPendingByKey.current.delete(w.key)
      setWork((x) => (x && x.key === w.key ? { ...x, cuesPending: false } : x))
      const remote = await st.upload(`${st.userId || 'anon'}/${w.sep.id}/voz_guia_${Date.now()}.wav`, file)
      await persist(remote ? { stem: { id: 'voiceguide', name: VOICE_GUIDE_NAME, url: remote, color: FAMILY_COLOR.guia } } : {}, w)
    } catch (e) {
      console.error('Erro ao gerar canal de Voz Guia', e)
      say('voz', VOICE_COPY.renderError)
    } finally {
      setBusy(null)
    }
  }

  const sortCues = (cues: VoiceCue[]) => [...cues].sort((a, b) => a.time - b.time)
  const editCues = (f: (cues: VoiceCue[]) => VoiceCue[]) => patch((w) => ({ cues: sortCues(f(w.cues)), cuesPending: true, dirty: true }))

  // Ações estáveis (só leem a versão mais nova pelos refs): o palco (memo) não renderiza de novo
  // só porque o App renderizou.
  const [actions] = useState<StageSeparationActions>(() => ({
    setBpm: (t) => patch({ bpm: t, dirty: true }),
    blurBpm: () => patch((w) => ({ bpm: normalizeBpm(w.bpm), dirty: true })),
    stepBpm: (d) => patch((w) => ({ bpm: stepBpmText(w.bpm, d), dirty: true })),
    tap: () => {
      const t = tapTempo(taps.current, Date.now())
      taps.current = t.taps
      if (t.bpm) patch({ bpm: t.bpm, dirty: true })
    },
    scaleBpm: (f) => patch((w) => ({ bpm: scaleBpmText(w.bpm, f), dirty: true })),
    detectBpm: async () => {
      const w = live.current.cur
      if (!w?.sep || !stopped()) return
      setBusy('bpm')
      patch({ gridInfo: '' })
      try {
        const res = await analyze(undefined, BEATS_PER_BAR[w.meter])
        if (!res) { patch({ gridInfo: 'Nenhuma faixa pra analisar.' }); return }
        const report = bpmReport(res.grid, res.name)
        patch({ bpm: report.bpm, downbeatShift: 0, gridInfo: report.info, dirty: true })
      } catch (e) {
        console.error('[Click] detecção de BPM falhou', e)
        patch({ gridInfo: 'Não deu pra analisar o áudio. Tenta de novo.' })
      } finally {
        setBusy(null)
      }
    },
    setMeter: (m) => patch({ meter: m }),
    setAccent: (on) => patch({ accentBeat1: on }),
    shiftDownbeat: (d) => patch((w) => ({ downbeatShift: w.downbeatShift + d })),
    setClickSel: (p) => {
      const next = { ...live.current.clickSel, ...p }
      setClickSelState(next)
      saveClickSelection(next)
    },
    generateClick: () => generateClick(),
    nudge: (deltaMs) => {
      const w = live.current.cur
      if (!w?.sep || !stopped()) return
      const next = nudgeOffset(w.offsetMs, deltaMs)
      patch({ offsetMs: next })
      live.current = { ...live.current, cur: { ...w, offsetMs: next } }
      if (!(live.current.bridge.song?.channels ?? []).some((c) => c.name === SEPARATOR_CLICK_NAME)) return
      if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
      syncPending.current = null
      const k = live.current.key
      nudgeTimer.current = window.setTimeout(() => {
        nudgeTimer.current = null
        // Tocando (ou outra ferramenta no meio): regera na parada, com o ajuste que a tela mostra.
        if (stopped()) void generateClick(next)
        else if (k) syncPending.current = { key: k, offset: next }
      }, SYNC_DELAY_MS)
    },

    setGuideTab: (t) => patch({ guideTab: t }),
    addCue: (o) => {
      const time = live.current.bridge.heardPosition()
      cueSeq.current += 1
      const cue: VoiceCue = { id: `${Date.now()}-${cueSeq.current}`, time, label: o.label, file: o.file }
      editCues((cues) => [...cues, cue])
    },
    removeCue: (id) => editCues((cues) => cues.filter((c) => c.id !== id)),
    setCueTime: (id, raw) => editCues((cues) => cues.map((c) => (c.id === id ? { ...c, time: parseCueTime(raw) } : c))),
    clearCues: () => editCues(() => []),
    detectCues: async () => {
      const w = live.current.cur
      if (!w?.sep || !stopped()) return
      setBusy('cues')
      say('voz', null)
      try {
        const source = voiceSourceTrack(live.current.bridge.song?.channels ?? [])
        if (!source?.buffer) throw new Error('Sem faixas para analisar')
        const detected = detectVoiceCues(source.buffer, w.bpm)
        patch({ cues: detected, cuesPending: true, dirty: true })
      } catch (e) {
        console.error('Auto-detect erro:', e)
        say('voz', VOICE_COPY.detectError(e instanceof Error ? e.message : String(e)))
      } finally {
        setBusy(null)
      }
    },
    commitVoiceGuide,

    setFormat: (f) => { setFormatState(f); writeDownloadFormat(f) },
    download: async (stemId) => {
      const w = live.current.cur
      const stem = w?.sep?.stems.find((s) => s.id === stemId)
      if (!w?.sep || !stem || !stopped()) return
      setBusy('download')
      setDownloadingId(stemId)
      say('faixas', null)
      try {
        await downloadStem({ url: stem.url, songName: w.sep.songName, stemName: stem.name, format: live.current.format })
      } catch (e) {
        console.error('Download error', e)
        say('faixas', DOWNLOAD_ERROR)
      } finally {
        setDownloadingId(null)
        setBusy(null)
      }
    },

    setCloud: (p) => patch((w) => ({ cloud: { ...w.cloud, ...p } })),
    publish: async () => {
      const w = live.current.cur
      const s = live.current.bridge.song
      const st = live.current.store
      if (!w?.sep || !s || !stopped()) return false
      if (!w.cloud.name) { say('cloud', CLOUD_COPY.needName); return false }
      setBusy('cloud')
      say('cloud', null)
      const cues = w.cues
      try {
        await publishToCloud({
          songName: w.cloud.name, artist: w.cloud.artist, songKey: w.cloud.songKey, bpm: Number(w.cloud.bpm), cover: w.cloud.cover,
          isGlobal: st.isAdmin ? w.cloud.publishGlobal : false,
          userId: st.userId,
          stems: w.sep.stems.map((x) => ({ id: x.id, name: x.name, url: x.url })),
          // A voz guia entra renderizada quando ainda não é uma das faixas.
          voiceGuide: cues.length > 0 && !w.sep.stems.some((x) => x.id === 'voiceguide') ? () => renderVoiceGuideWav(cues, s.duration || 300, decodeGuide) : null,
        }, ({ status, progress }) => patch((x) => ({ cloud: { ...x.cloud, status, progress } })))
        patch((x) => ({ cloud: { ...x.cloud, status: PUBLISHED, progress: 100 } }))
        await persist({ songName: w.cloud.name, artist: w.cloud.artist }, w)
        return true
      } catch (e) {
        say('cloud', CLOUD_COPY.error(e instanceof Error ? e.message : String(e)))
        return false
      } finally {
        setBusy(null)
      }
    },

    flushPending: async () => {
      const w = live.current.cur
      if (!w?.sep) return
      if (w.cuesPending && w.cues.length > 0 && stopped()) { await commitVoiceGuide(); return }
      if (w.dirty) await persist()
    }
  }))

  const songChannels = song?.channels
  const sep = cur?.sep ?? null
  return useMemo<StageSeparation>(() => {
    const channels = songChannels ?? []
    return {
      sep,
      loading: !!key && !cur,
      bpm: cur?.bpm ?? '120', meter: cur?.meter ?? '4/4', accentBeat1: cur?.accentBeat1 ?? true, downbeatShift: cur?.downbeatShift ?? 0,
      clickSel, offsetMs: cur?.offsetMs ?? 0,
      hasClick: channels.some((c) => c.name === SEPARATOR_CLICK_NAME),
      gridInfo: cur?.gridInfo ?? '',
      cues: cur?.cues ?? [], cuesPending: cur?.cuesPending ?? false,
      hasGuide: channels.some((c) => c.name === VOICE_GUIDE_NAME) || !!sep?.stems.some((s) => s.id === 'voiceguide'),
      guideTab: cur?.guideTab ?? 'sections',
      format, downloadingId,
      cloud: cur?.cloud ?? EMPTY_CLOUD,
      busy, messages,
      ...actions,
    }
  }, [sep, cur, key, clickSel, songChannels, format, downloadingId, busy, messages, actions])
}
