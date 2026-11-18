// @vitest-environment jsdom
// "Gerar click IA" do Metrônomo (M7): mostra o resultado antes de inserir, metade e dobro
// trocam o BPM, confiança baixa avisa e não insere, compasso lembrado por música e o BPM da
// música vai pro detector. O detector e o gerador de click são mockados.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MetronomeModal } from './MetronomeModal'
import { analyzeBufferAndGenerateClick, generateManualClickTrackFromSample } from '../lib/AudioAnalyzer'
import { detectSongGrid, type SongGridDetection } from '../lib/beatGrid'
import type { Channel } from '../types'
import { FakeAudioBuffer } from '../test/fakeAudio'

vi.mock('../lib/beatGrid', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/beatGrid')>()
  return { ...real, detectSongGrid: vi.fn() }
})
vi.mock('../lib/AudioAnalyzer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/AudioAnalyzer')>()
  return {
    ...real,
    analyzeBufferAndGenerateClick: vi.fn(),
    generateManualClickTrackFromSample: vi.fn(async () => ({ clickTrackUrl: 'blob:click-auto' })),
  }
})

const detect = vi.mocked(detectSongGrid)
const generate = vi.mocked(generateManualClickTrackFromSample)
const TRAVESSAO = String.fromCharCode(0x2014)
const AVISO_CONFIANCA = 'Não deu pra ter certeza do tempo desta música. Confira o BPM ou use o modo manual.'
const AVISO_DESCARTADO = 'A música mudou enquanto o click era gerado: ele não entrou.'

/** Detecção montada à mão: com BPM escolhido (nearBpm) a grade sai nele, senão 135. */
function detection(over: Partial<SongGridDetection> = {}) {
  return (_t: unknown, _sr: number, opts: { nearBpm?: number } = {}): SongGridDetection => {
    const bpm = opts.nearBpm ?? 135
    return {
      bpm, pulseBpm: bpm, firstBeat: 0.12, downbeat: 0, confidence: 1, offbeatRisk: false, preferConflict: false,
      downbeatFrom: 'baixo', downbeatMargin: 2, alternatives: [bpm / 2, bpm * 2], tracksUsed: ['k', 'b'], ...over,
    }
  }
}

function channel(id: string, name: string): Channel {
  const buffer = new FakeAudioBuffer(1, 4800, 48000) as unknown as AudioBuffer
  return { id, name, buffer } as unknown as Channel
}

const song = (over: { id?: string; bpm?: number; channels?: Channel[] } = {}) => ({
  id: 's1', name: 'Teste', duration: 90, bpm: 135, channels: [channel('k', 'Drums'), channel('b', 'Bass')], ...over,
})

type ModalProps = Parameters<typeof MetronomeModal>[0]

/** Abre o modal; `trocar` rerenderiza o MESMO modal com outras props (música nova, tocando...). */
function abrir(props: Partial<ModalProps> = {}) {
  const onAddClick = vi.fn()
  const onClose = vi.fn()
  const base = { isOpen: true, onClose, playlistCurrentSong: song(), onAddClick, ...props }
  const r = render(<MetronomeModal {...base} />)
  const trocar = (mais: Partial<ModalProps>) => r.rerender(<MetronomeModal {...base} {...mais} />)
  return { onAddClick, onClose, trocar }
}

/** Botão pelo texto (sem diferenciar caixa). */
const botao = (texto: string) => screen.getByRole('button', { name: new RegExp(`^${texto}$`, 'i') })
const texto = () => document.body.textContent ?? ''
/** Botão dentro do resultado da análise (o 2× do BPM manual fica fora). */
const noResultado = (texto: string) =>
  within(screen.getByRole('region', { name: 'Resultado da análise' })).getByRole('button', { name: new RegExp(`^${texto}$`, 'i') })

async function gerarIA(nome = 'Gerar click IA') {
  await act(async () => { fireEvent.click(botao(nome)) })
  await vi.waitFor(() => expect(detect).toHaveBeenCalled())
}

beforeEach(() => {
  localStorage.clear()
  detect.mockReset()
  detect.mockImplementation(detection())
  generate.mockClear()
  vi.mocked(analyzeBufferAndGenerateClick).mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['wav'], { type: 'audio/wav' }) })))
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Metrônomo: Gerar click IA', () => {
  it('mostra o resultado antes de inserir; só insere no "Inserir click"', async () => {
    const { onAddClick, onClose } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0 · analisado em Bateria e Baixo'))
    expect(onAddClick).not.toHaveBeenCalled()
    expect(texto()).not.toContain(TRAVESSAO)
    await act(async () => { fireEvent.click(noResultado('Inserir click')) })
    await vi.waitFor(() => expect(onAddClick).toHaveBeenCalledTimes(1))
    const file = onAddClick.mock.calls[0][0] as File
    expect(file.name).toBe('Click_IA_135bpm.wav')
    expect(generate).toHaveBeenCalledWith('Classic', 'quarter', 135, 90, true, '4/4', { firstBeat: 0.12, downbeat: 0 })
    expect(onClose).toHaveBeenCalled()
    expect(analyzeBufferAndGenerateClick).not.toHaveBeenCalled()
  })

  it('½× troca o BPM mostrado (refaz a grade no BPM escolhido) e 2× volta', async () => {
    abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
    await act(async () => { fireEvent.click(noResultado('½×')) })
    await vi.waitFor(() => expect(texto()).toContain('BPM 67.5 · analisado em Bateria e Baixo'))
    expect(detect.mock.calls.at(-1)?.[2]).toMatchObject({ nearBpm: 67.5 })
    await act(async () => { fireEvent.click(noResultado('2×')) })
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
  })

  it('confiança baixa mostra o aviso em âmbar e não insere nada', async () => {
    detect.mockImplementation(detection({ confidence: 0.2 }))
    const { onAddClick } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain(AVISO_CONFIANCA))
    expect(screen.getByText(AVISO_CONFIANCA).className).toContain('text-ps-alert')
    expect(screen.queryByRole('button', { name: /inserir click/i })).toBeNull()
    expect(onAddClick).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('o BPM da música vai pro detector como preferBpm, com o compasso escolhido', async () => {
    abrir({ playlistCurrentSong: song({ bpm: 72 }) })
    fireEvent.click(botao('3/4'))
    await gerarIA()
    expect(detect.mock.calls[0][2]).toMatchObject({ preferBpm: 72, signature: '3/4' })
  })

  it('com click na música: avisa e o botão vira "Gerar outro click", que analisa as outras faixas', async () => {
    abrir({ playlistCurrentSong: song({ channels: [channel('c', 'Click'), channel('k', 'Drums')] }) })
    expect(texto()).toContain('Esta música já tem click (Click).')
    expect(screen.queryByRole('button', { name: /^gerar click ia$/i })).toBeNull()
    await gerarIA('Gerar outro click')
    expect(detect.mock.calls[0][0].map(t => t.id)).toEqual(['k'])
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0 · analisado em Bateria'))
  })

  it('1 incerto pede conferência; Mover o 1 e Deslocar meio tempo (só com risco de contratempo) mudam o click', async () => {
    detect.mockImplementation(detection({ downbeatFrom: 'bumbo-lidera', downbeatMargin: 0.2, offbeatRisk: true }))
    const { onAddClick } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('Confira o 1'))
    expect(texto()).toContain('contratempo')
    fireEvent.click(screen.getByRole('button', { name: 'Mover o 1 pra frente' }))
    fireEvent.click(noResultado('Deslocar meio tempo'))
    expect(noResultado('Deslocar meio tempo').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { fireEvent.click(noResultado('Inserir click')) })
    await vi.waitFor(() => expect(onAddClick).toHaveBeenCalledTimes(1))
    const P = 60 / 135
    const grade = generate.mock.calls[0][6]
    // O 1 andou um tempo e meio pra frente: 0,12 + 1,5 tempo.
    expect((grade?.firstBeat ?? 0) + (grade?.downbeat ?? 0) * P).toBeCloseTo(0.12 + 1.5 * P, 9)
  })

  it('sem risco de contratempo não aparece "Deslocar meio tempo"', async () => {
    abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
    expect(screen.queryByRole('button', { name: /deslocar meio tempo/i })).toBeNull()
    expect(texto()).not.toContain('Confira o 1')
  })

  it('com a música tocando não analisa (a conta trava a tela) e diz por quê', async () => {
    abrir({ isPlaying: true })
    expect((botao('Gerar click IA') as HTMLButtonElement).disabled).toBe(true)
    expect(texto()).toContain('Pare a música pra analisar o tempo.')
    await act(async () => { fireEvent.click(botao('Gerar click IA')) })
    await new Promise(r => setTimeout(r, 60))
    expect(detect).not.toHaveBeenCalled()
  })

  // Guarda de forma: o App não tem teste de comportamento barato. Sem esta ligação o modal
  // nunca sabe que a música está tocando e a análise roda no meio do culto (Ruling M7-arquivos).
  it('o App passa ao Metrônomo que a música está tocando (inclusive na contagem)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const start = app.indexOf('<MetronomeModal')
    expect(start).toBeGreaterThan(-1)
    const tag = app.slice(start, app.indexOf('/>', start))
    expect(tag).toMatch(/\bisPlaying=\{isPlaying \|\| isCountingIn\}/)
  })
})

// A música pode mudar com o modal aberto (AUTO depois do fim, comando da banda): o resultado é
// da música em que a análise foi feita e nunca entra na música nova (Rodada 1, Important 1).
describe('Metrônomo: troca de música com o modal aberto', () => {
  const musicaB = () => song({ id: 's2', name: 'Outra', bpm: 90, channels: [channel('k2', 'Drums')] })

  it('o resultado some e o "Inserir click" não aparece na música nova', async () => {
    const { onAddClick, trocar } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
    trocar({ playlistCurrentSong: musicaB() })
    expect(screen.queryByRole('region', { name: 'Resultado da análise' })).toBeNull()
    expect(screen.queryByRole('button', { name: /inserir click/i })).toBeNull()
    expect(texto()).not.toContain('BPM 135.0')
    expect(onAddClick).not.toHaveBeenCalled()
  })

  it('aviso de falha também é da música em que a análise foi feita', async () => {
    detect.mockImplementation(detection({ confidence: 0.2 }))
    const { trocar } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain(AVISO_CONFIANCA))
    trocar({ playlistCurrentSong: musicaB() })
    expect(texto()).not.toContain(AVISO_CONFIANCA)
  })

  it('click sendo gerado quando a música muda não entra na música nova', async () => {
    let soltar: (v: { clickTrackUrl: string }) => void = () => {}
    generate.mockImplementationOnce(() => new Promise(r => { soltar = r }))
    const { onAddClick, onClose, trocar } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
    await act(async () => { fireEvent.click(noResultado('Inserir click')) })
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    trocar({ playlistCurrentSong: musicaB() })
    await act(async () => { soltar({ clickTrackUrl: 'blob:click-auto' }) })
    await new Promise(r => setTimeout(r, 30))
    expect(onAddClick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // E diz por quê (adiado da M7: antes o click sumia sem aviso).
    expect(texto()).toContain(AVISO_DESCARTADO)
  })

  it('GERAR CLICK MANUAL: a música muda durante a geração e o click não entra na música nova; o modal fica aberto e avisa', async () => {
    let soltar: (v: { clickTrackUrl: string }) => void = () => {}
    generate.mockImplementationOnce(() => new Promise(r => { soltar = r }))
    const { onAddClick, onClose, trocar } = abrir()
    await act(async () => { fireEvent.click(botao('GERAR CLICK MANUAL')) })
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    trocar({ playlistCurrentSong: musicaB() })
    await act(async () => { soltar({ clickTrackUrl: 'blob:click-manual' }) })
    await new Promise(r => setTimeout(r, 30))
    expect(onAddClick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(texto()).toContain(AVISO_DESCARTADO)
    // Na mesma música o click entra e o modal fecha, como sempre (e o aviso some na geração nova).
    await act(async () => { fireEvent.click(botao('GERAR CLICK MANUAL')) })
    await vi.waitFor(() => expect(onAddClick).toHaveBeenCalledTimes(1))
    expect((onAddClick.mock.calls[0][0] as File).name).toBe('Click_Classic_120bpm.wav')
    expect(onClose).toHaveBeenCalled()
    expect(texto()).not.toContain(AVISO_DESCARTADO)
  })

  it('o compasso passa a ser o da música nova (guardado, senão 4/4)', () => {
    localStorage.setItem('mt_meter_s2', '3/4')
    const { trocar } = abrir()
    fireEvent.click(botao('6/8'))
    trocar({ playlistCurrentSong: musicaB() })
    expect(botao('3/4').getAttribute('aria-pressed')).toBe('true')
    trocar({ playlistCurrentSong: song({ id: 's3' }) })
    expect(botao('4/4').getAttribute('aria-pressed')).toBe('true')
    trocar({ playlistCurrentSong: song() })
    expect(botao('6/8').getAttribute('aria-pressed')).toBe('true')
  })

  it('a música que começa a tocar nos 30 ms antes da conta não deixa a análise rodar', async () => {
    const { trocar } = abrir()
    fireEvent.click(botao('Gerar click IA'))
    trocar({ isPlaying: true })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    expect(detect).not.toHaveBeenCalled()
  })

  it('com a música tocando os chips de BPM também ficam desligados', async () => {
    const { trocar } = abrir()
    await gerarIA()
    await vi.waitFor(() => expect(texto()).toContain('BPM 135.0'))
    trocar({ isPlaying: true })
    expect((noResultado('½×') as HTMLButtonElement).disabled).toBe(true)
    // O motivo vai no title do chip (adiado da M7).
    expect(noResultado('½×').getAttribute('title')).toContain('pare a música pra refazer')
  })
})

describe('Metrônomo: compasso', () => {
  const marcado = (ts: string) => botao(ts).getAttribute('aria-pressed')

  it('volta ao reabrir a mesma música (mt_meter_<id>), outra música começa em 4/4', () => {
    abrir()
    expect(marcado('4/4')).toBe('true')
    fireEvent.click(botao('6/8'))
    expect(localStorage.getItem('mt_meter_s1')).toBe('6/8')
    cleanup()
    abrir()
    expect(marcado('6/8')).toBe('true')
    cleanup()
    abrir({ playlistCurrentSong: song({ id: 's2' }) })
    expect(marcado('4/4')).toBe('true')
  })

  it('initialSignature vence o guardado; trocar grava na chave da música', () => {
    localStorage.setItem('mt_meter_s1', '6/8')
    abrir({ initialSignature: '3/4' })
    expect(marcado('3/4')).toBe('true')
    fireEvent.click(botao('12/8'))
    expect(localStorage.getItem('mt_meter_s1')).toBe('12/8')
  })

  it('valor estranho guardado é ignorado (4/4)', () => {
    localStorage.setItem('mt_meter_s1', '9/9')
    abrir()
    expect(marcado('4/4')).toBe('true')
  })
})
