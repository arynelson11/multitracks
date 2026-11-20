import { describe, expect, it } from 'vitest'
import { buildStageView, liveArmedOf, splitSongName, stageGatesFor } from './buildStageView'
import type { EngineStageState, StageUiState } from './buildStageView'
import { sectionSpans } from '../../lib/songGrid'
import type { OutputPlan, SongGrid, TransitionView } from '../../lib/stageContracts'
import type { Channel, Marker, Song } from '../../types'

const TRAVESSAO = String.fromCharCode(0x2014)

// Canal do repertório só com o que a vista lê (os nós de áudio não entram na conta).
function channel(id: string, name: string, patch: Partial<Channel> = {}): Channel {
  return { id, name, volume: 1, muted: false, soloed: false, pan: 0, bus: '1/2', ...patch } as unknown as Channel
}

const GRID: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const MARKERS: Marker[] = [
  { id: 'm-intro', time: 0, label: 'Intro', color: '#ffffff' },
  { id: 'm-verso', time: 8, label: 'Verso 2' },
  { id: 'm-proprio', time: 24, label: 'Ministração', color: '#123456' },
]

function song(id: string, patch: Partial<Song> = {}): Song {
  return { id, name: `Música ${id}`, channels: [], duration: 40, ...patch }
}

const PLAN: OutputPlan = { mode: 'split2', channels: 2, vs: [1], click: [0], guide: [0], panByRole: true, fellBackFrom: null }

function engine(patch: Partial<EngineStageState> = {}): EngineStageState {
  const active = patch.song ?? song('a', { markers: MARKERS })
  const grid = patch.songGrid === undefined ? GRID : patch.songGrid
  return {
    song: active, playlist: [active], activeIndex: 0, duration: active.duration, spans: sectionSpans(active.markers ?? [], active.duration, grid), currentSection: 0,
    isPlaying: false, isCountingIn: false, precountEnabled: true, precountBeats: 4, precountTimes: [],
    playbackMode: 'continue', sectionIntent: null, transitionView: null, landed: null, songGrid: grid, gridWarning: null,
    isReadingGrid: false, outputPlan: PLAN, masterVolume: 0.9, masterMuted: false, ...patch,
  }
}

const UI: StageUiState = {
  plan: 'pro_mensal', isAdmin: false, online: true, isDesktop: true, userName: 'Ary', hostActive: false,
  editMode: false, channelEditMode: false, padPanelOpen: false, activePad: null, repertoireName: null, livre: null,
}
const build = (e: Partial<EngineStageState> = {}, ui: Partial<StageUiState> = {}) => buildStageView(engine(e), { ...UI, ...ui })

describe('buildStageView', () => {
  it('canais com rótulo, cor, papel e calado pelo solo', () => {
    const channels = [
      channel('c', 'Click.wav'),
      channel('g', 'Guia.wav'),
      channel('d', 'Bateria.wav', { soloed: true }),
      channel('b', 'Baixo.wav', { volume: 0.5 }),
      channel('n', 'Teclado.wav', { customName: 'Synth do Zé', muted: true }),
    ]
    const v = buildStageView(engine({ song: song('a', { channels }) }), UI)
    const byId = new Map(v.channels.map((c) => [c.id, c]))
    expect(byId.get('c')).toMatchObject({ label: 'Click', role: 'click', color: '#94a3b8', silenced: false })
    // Click e Guia continuam com o Solo de outro canal (spec 9b); o resto fica calado.
    expect(byId.get('g')).toMatchObject({ role: 'guide', silenced: false })
    expect(byId.get('d')).toMatchObject({ label: 'Bateria', role: 'normal', color: '#d4a373', soloed: true, silenced: false })
    expect(byId.get('b')).toMatchObject({ label: 'Baixo', volume: 0.5, silenced: true })
    // Nome do usuário vence; o M fica em `muted` (calado = muted || silenced, quem junta é a peça).
    expect(byId.get('n')).toMatchObject({ label: 'Synth do Zé', muted: true, silenced: true })
    expect(v.channels.map((c) => c.id)).toEqual(['c', 'g', 'd', 'b', 'n'])
  })

  it('seções pelas spans, na cor do tipo, com compassos quando a grade tem fase', () => {
    const v = buildStageView(engine({ currentSection: 1 }), UI)
    expect(v.sections).toEqual([
      // A cor do tipo vence a gravada na marca; nome próprio fica com a da marca.
      { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
      { index: 1, label: 'Verso 2', color: '#10b981', start: 8, end: 24, bars: 8 },
      { index: 2, label: 'Ministração', color: '#123456', start: 24, end: 40, bars: 8 },
    ])
    expect(v.currentSection).toBe(1)
    // Só com o BPM salvo (sem fase) não se sabe onde cai o 1: sem compassos.
    const semFase = buildStageView(engine({ songGrid: { ...GRID, source: 'bpm' } }), UI)
    expect(semFase.sections.map((s) => s.bars)).toEqual([null, null, null])
    const semGrade = buildStageView(engine({ songGrid: null }), UI)
    expect(semGrade.sections.map((s) => s.bars)).toEqual([null, null, null])
    // Marca fora da duração não vira seção e não desloca os índices (são os da lista de spans).
    const fora = song('a', { markers: [...MARKERS, { id: 'm-fora', time: 99, label: 'Final' }] })
    expect(buildStageView(engine({ song: fora }), UI).sections.map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('posição da música, anterior e A SEGUIR', () => {
    const playlist = [
      song('1', { name: 'Aline Barros - Ressuscita-me' }),
      song('2', { name: 'Fernandinho - Uma Nova História', artist: 'Fernandinho', originalKey: 'G', pitch: 2, bpm: 72.5, timeSignature: '6/8' }),
      song('3', { name: 'Lugar Secreto' }),
    ]
    const v = buildStageView(engine({ song: playlist[1], playlist, activeIndex: 1, songGrid: null }), { ...UI, repertoireName: 'Culto' })
    expect(v.song).toMatchObject({
      id: '2', name: 'Uma Nova História', artist: 'Fernandinho', originalKey: 'G', pitch: 2, bpm: 72.5, signature: '6/8',
      position: 2, total: 3, prevName: 'Ressuscita-me', nextName: 'Lugar Secreto', repertoireName: 'Culto', duration: 40,
    })
    // A grade decide o compasso mostrado; o BPM é o SALVO (semínima), a faixa do meio converte a grade.
    const comGrade = buildStageView(engine({ song: playlist[1], playlist, activeIndex: 1, songGrid: { ...GRID, signature: '3/4' } }), UI)
    expect(comGrade.song).toMatchObject({ signature: '3/4', bpm: 72.5 })
    const primeira = buildStageView(engine({ song: playlist[0], playlist, activeIndex: 0 }), UI)
    expect(primeira.song).toMatchObject({ name: 'Ressuscita-me', artist: 'Aline Barros', position: 1, prevName: null, nextName: 'Uma Nova História' })
    expect(buildStageView(engine({ song: undefined, playlist: [], spans: [] }), UI).song).toBeNull()
    expect(splitSongName({ name: 'Sem Artista' })).toEqual({ title: 'Sem Artista' })
  })

  it('portões do plano Livre e do Studio', () => {
    // Parte 3 (Livre como amostra): o Livre tem seções e o loop infinito como os pagos; a banda nas seções segue do Studio.
    expect(buildStageView(engine(), { ...UI, plan: 'free' }).gates).toEqual({ sections: true, infinite: true, maxRepeats: 9, bandSections: false })
    expect(buildStageView(engine(), { ...UI, plan: null }).gates).toEqual({ sections: true, infinite: true, maxRepeats: 9, bandSections: false })
    expect(buildStageView(engine(), { ...UI, plan: 'essencial_anual' }).gates).toEqual({ sections: true, infinite: true, maxRepeats: 9, bandSections: false })
    expect(buildStageView(engine(), { ...UI, plan: 'pro_mensal' }).gates).toEqual({ sections: true, infinite: true, maxRepeats: 9, bandSections: true })
    // O motor recebe os mesmos portões que a tela.
    expect(stageGatesFor('pro_anual')).toEqual(buildStageView(engine(), { ...UI, plan: 'pro_anual' }).gates)
  })

  it('o pan automático das Configurações chega na vista (trava o knob em Tudo junto); ausente é desligado', () => {
    expect(buildStageView(engine(), { ...UI, autoPan: true }).autoPan).toBe(true)
    expect(buildStageView(engine(), { ...UI, autoPan: false }).autoPan).toBe(false)
    expect(buildStageView(engine(), UI).autoPan).toBe(false)
  })

  it('click ligado = canal de click sem M; música sem click = channelId null', () => {
    const ligado = buildStageView(engine({ song: song('a', { channels: [channel('d', 'Bateria.wav'), channel('k', 'Click.wav')] }) }), UI)
    expect(ligado.click).toEqual({ channelId: 'k', on: true })
    const mudo = buildStageView(engine({ song: song('a', { channels: [channel('k', 'Click.wav', { muted: true })] }) }), UI)
    expect(mudo.click).toEqual({ channelId: 'k', on: false })
    // Papel manual vence o nome: um canal chamado "Click" marcado como Normal não é o click.
    const manual = buildStageView(engine({ song: song('a', { channels: [channel('k', 'Click.wav', { role: 'normal' })] }) }), UI)
    expect(manual.click).toEqual({ channelId: null, on: false })
    const semClick = buildStageView(engine({ song: song('a', { channels: [channel('d', 'Bateria.wav')] }) }), UI)
    expect(semClick.click).toEqual({ channelId: null, on: false })
  })

  it('isReadingGrid e gridWarning passam pro palco', () => {
    const v = buildStageView(engine({ isReadingGrid: true, gridWarning: 'compasso-assumido' }), UI)
    expect(v.isReadingGrid).toBe(true)
    expect(v.gridWarning).toBe('compasso-assumido')
    expect(v.grid).toBe(GRID)
    const outro = buildStageView(engine({ isReadingGrid: false, gridWarning: 'sem-grade', songGrid: null }), UI)
    expect(outro).toMatchObject({ isReadingGrid: false, gridWarning: 'sem-grade', grid: null })
  })

  it('motor, mixer, saídas e o que é do App passam como vieram', () => {
    const transition = { from: 0, to: 2, kind: 'proxima', plays: 1 } as unknown as TransitionView
    const v = buildStageView(
      engine({
        isPlaying: true, isCountingIn: true, precountTimes: [1, 2], playbackMode: 'fade-out', sectionIntent: { target: 2, plays: 1 },
        transitionView: transition, landed: { index: 1, at: 3 }, masterVolume: 0.7, masterMuted: true,
      }),
      { ...UI, isAdmin: true, online: false, hostActive: true, editMode: true, channelEditMode: true, padPanelOpen: true, activePad: 'G' },
    )
    expect(v).toMatchObject({
      isPlaying: true, isCountingIn: true, precount: { enabled: true, beats: 4, times: [1, 2] }, endMode: 'fade-out',
      intent: { target: 2, plays: 1 }, transition, landed: { index: 1, at: 3 }, master: { volume: 0.7, muted: true }, outputs: PLAN,
      editMode: true, channelEditMode: true, padPanelOpen: true, activePad: 'G',
      app: { online: false, isDesktop: true, isAdmin: true, userName: 'Ary', hostActive: true },
    })
  })

  it('pulo armado pro celular da banda: índice da span, nome, cor, PRÓXIMA ou REPETE', () => {
    const v = buildStageView(engine({ currentSection: 0 }), UI)
    expect(liveArmedOf({ ...v, intent: { target: 2, plays: 'infinite' } })).toEqual({ index: 2, label: 'Ministração', color: '#123456', kind: 'proxima', plays: 'infinite' })
    expect(liveArmedOf({ ...v, intent: { target: 0, plays: 3 } })).toEqual({ index: 0, label: 'Intro', color: '#3b82f6', kind: 'repete', plays: 3 })
    expect(liveArmedOf({ ...v, intent: null })).toBeNull()
    expect(liveArmedOf({ ...v, intent: { target: 7, plays: 1 } })).toBeNull()
  })

  describe('selo do Livre (app.livre)', () => {
    const L = { used: 2, limit: 3 }
    it('o selo some com a música tocando e na pré-contagem', () => {
      expect(build({ isPlaying: true }, { livre: L }).app.livre).toBeNull()
      expect(build({ isCountingIn: true }, { livre: L }).app.livre).toBeNull()
      expect(build({ isPlaying: true, isCountingIn: true }, { livre: L }).app.livre).toBeNull()
      expect(build({}, { livre: L }).app.livre).toEqual(L)
    })
    it('conta paga: app.livre nulo', () => {
      expect(build({}, { livre: null }).app.livre).toBeNull()
      expect(build({ isPlaying: true }, { livre: null }).app.livre).toBeNull()
    })
  })

  it('nenhum texto com travessão', () => {
    const v = buildStageView(engine(), UI)
    expect(JSON.stringify(v)).not.toContain(TRAVESSAO)
  })
})
