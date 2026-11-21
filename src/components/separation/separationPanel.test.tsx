// @vitest-environment jsdom
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { StageSeparation } from '../../hooks/useStageSeparation'
import { oldLanguageClasses } from '../../test/psLanguage'
import { SeparationPanel } from './SeparationPanel'

const TRAVESSAO = String.fromCharCode(0x2014)
const PAUSE = 'Pare a música pra usar'
afterEach(cleanup)

function fakeSeparation(over: Partial<StageSeparation> = {}): StageSeparation {
  const fn = () => vi.fn()
  return {
    sep: {
      id: 'sep_1', songName: 'Águas', artist: '', bpm: '72', songKey: 'D', createdAt: 1, voiceCues: [],
      stems: [
        { id: 'vocals', name: 'Vocais', url: 'https://r2/v.wav', color: '#06b6d4' },
        { id: 'drums', name: 'Bateria', url: 'https://r2/d.wav', color: '#f59e0b' },
      ],
    },
    loading: false, bpm: '72', meter: '4/4', accentBeat1: true, downbeatShift: 0, clickSel: { type: 'Classic', subdivision: 'quarter' },
    offsetMs: 0, hasClick: true, gridInfo: '', cues: [{ id: 'c1', time: 10, label: 'Verso 1', file: 'f' }], cuesPending: false, hasGuide: false,
    guideTab: 'sections', format: 'wav', downloadingId: null,
    cloud: { name: 'Águas', artist: '', bpm: '72', songKey: 'D', cover: null, publishGlobal: false, progress: 0, status: '' },
    busy: null, message: null,
    setBpm: fn(), blurBpm: fn(), stepBpm: fn(), tap: fn(), scaleBpm: fn(), detectBpm: fn(), setMeter: fn(), setAccent: fn(), shiftDownbeat: fn(),
    setClickSel: fn(), generateClick: fn(), nudge: fn(), setGuideTab: fn(), addCue: fn(), removeCue: fn(), setCueTime: fn(), clearCues: fn(),
    detectCues: fn(), commitVoiceGuide: fn(), setFormat: fn(), download: fn(), setCloud: fn(), publish: fn(), flushPending: fn(),
    ...over,
  } as StageSeparation
}

type Props = React.ComponentProps<typeof SeparationPanel>
const props = (over: Partial<Props> = {}): Props => ({
  open: true, songName: 'Hillsong - Águas', tab: 'faixas', onTab: vi.fn(), s: fakeSeparation(), playing: false,
  canDownload: true, canCloudSave: true, onLimit: vi.fn(), onOpenCloudSave: vi.fn(), onMySeparations: vi.fn(), onClose: vi.fn(), ...over,
})
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('SeparationPanel', () => {
  it('abas FAIXAS, VOZ GUIA e BPM E CLICK trocam pelo onTab', () => {
    const p = props()
    render(<SeparationPanel {...p} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Faixas', 'Voz guia', 'BPM e click'])
    fireEvent.click(screen.getByRole('tab', { name: /voz guia/i })); expect(p.onTab).toHaveBeenCalledWith('voz')
    fireEvent.click(screen.getByRole('tab', { name: /bpm e click/i })); expect(p.onTab).toHaveBeenCalledWith('bpm')
    cleanup()
    render(<SeparationPanel {...props({ tab: 'voz' })} />)
    expect(document.querySelector('[data-voice-editor]')).toBeTruthy()
    cleanup()
    render(<SeparationPanel {...props({ tab: 'bpm' })} />)
    expect(document.querySelector('[data-bpm-editor]')).toBeTruthy()
    expect(btn('Adiantar o click 10 ms')).toBeTruthy()
  })

  it('FAIXAS: uma linha por faixa com Baixar, o formato, Salvar na nuvem e Minhas separações', () => {
    const p = props()
    render(<SeparationPanel {...p} />)
    expect([...document.querySelectorAll('[data-separation-stem]')].map((e) => e.getAttribute('data-separation-stem'))).toEqual(['vocals', 'drums'])
    fireEvent.click(btn('Baixar Bateria (WAV)')); expect(p.s.download).toHaveBeenCalledWith('drums')
    fireEvent.click(screen.getByRole('radio', { name: 'MP3' })); expect(p.s.setFormat).toHaveBeenCalledWith('mp3')
    fireEvent.click(btn('Salvar na nuvem')); expect(p.onOpenCloudSave).toHaveBeenCalled()
    fireEvent.click(btn('Minhas separações')); expect(p.onMySeparations).toHaveBeenCalled()
    expect(screen.getByText('Hillsong - Águas')).toBeTruthy()
  })

  it('tocando: Baixar, Salvar na nuvem, Gerar click, SYNC, Detectar e Gerar canal desligados com o motivo', () => {
    render(<SeparationPanel {...props({ playing: true })} />)
    expect(btn('Baixar Vocais (WAV)').disabled).toBe(true)
    expect(btn('Baixar Vocais (WAV)').title).toBe(PAUSE)
    expect(btn('Salvar na nuvem').disabled).toBe(true)
    expect(btn('Salvar na nuvem').title).toBe(PAUSE)
    // "Minhas separações" continua (abre o Separador, sem tela por cima do palco).
    expect(btn('Minhas separações').disabled).toBe(false)
    cleanup()
    render(<SeparationPanel {...props({ playing: true, tab: 'bpm' })} />)
    expect(btn(/^Gerar click/).disabled).toBe(true)
    expect(btn(/^Gerar click/).title).toBe(PAUSE)
    expect(btn('Detectar BPM da música').disabled).toBe(true)
    expect(btn('Adiantar o click 10 ms').disabled).toBe(true)
    cleanup()
    render(<SeparationPanel {...props({ playing: true, tab: 'voz' })} />)
    expect(btn('Auto-detectar').disabled).toBe(true)
    expect(btn('Gerar canal de Voz Guia').disabled).toBe(true)
    expect(btn('Gerar canal de Voz Guia').title).toBe(PAUSE)
  })

  it('tocando, a grade de marcações da voz guia continua ligada', () => {
    const p = props({ playing: true, tab: 'voz' })
    render(<SeparationPanel {...p} />)
    expect(btn('Refrão').disabled).toBe(false)
    fireEvent.click(btn('Refrão'))
    expect(p.s.addCue).toHaveBeenCalledWith(expect.objectContaining({ label: 'Refrão' }))
    expect(screen.getByText('Clique em uma seção para marcar o tempo atual')).toBeTruthy()
  })

  it('Livre: Baixar e Salvar na nuvem chamam onLimit e não baixam', () => {
    const p = props({ canDownload: false, canCloudSave: false })
    render(<SeparationPanel {...p} />)
    fireEvent.click(btn('Baixar Vocais (WAV)'))
    fireEvent.click(btn('Salvar na nuvem'))
    expect(p.onLimit).toHaveBeenCalledTimes(2)
    expect(p.s.download).not.toHaveBeenCalled()
    expect(p.onOpenCloudSave).not.toHaveBeenCalled()
  })

  it('o anúncio aparece no topo da aba FAIXAS quando vem', () => {
    render(<SeparationPanel {...props({ ad: <div data-house-ad="separation-done" /> })} />)
    const ad = document.querySelector('[data-house-ad="separation-done"]')!
    const first = document.querySelector('[data-separation-stem]')!
    expect(ad.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    render(<SeparationPanel {...props({ tab: 'voz', ad: <div data-house-ad="separation-done" /> })} />)
    expect(document.querySelector('[data-house-ad]')).toBeNull()
  })

  it('X e Esc fecham; a gaveta não é modal', () => {
    const p = props()
    render(<SeparationPanel {...p} />)
    const dialog = screen.getByRole('dialog', { name: 'Separação' })
    expect(dialog.hasAttribute('aria-modal')).toBe(false)
    fireEvent.click(btn('Fechar a separação')); expect(p.onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(2)
    cleanup()
    render(<SeparationPanel {...props({ open: false })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mensagem de erro do hook aparece em alerta; carregando e sem separação também dizem', () => {
    render(<SeparationPanel {...props({ s: fakeSeparation({ message: 'Erro ao baixar a faixa. Tenta de novo.' }) })} />)
    expect(screen.getByRole('alert').textContent).toBe('Erro ao baixar a faixa. Tenta de novo.')
    cleanup()
    render(<SeparationPanel {...props({ s: fakeSeparation({ loading: true, sep: null }) })} />)
    expect(screen.getByRole('status').textContent).toBe('Carregando a separação')
    cleanup()
    render(<SeparationPanel {...props({ s: fakeSeparation({ sep: null }) })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('nenhum texto com travessão nem classe do visual antigo', () => {
    for (const tab of ['faixas', 'voz', 'bpm'] as const) {
      render(<SeparationPanel {...props({ tab })} />)
      expect(document.body.textContent).not.toContain(TRAVESSAO)
      expect(oldLanguageClasses(document.body)).toEqual([])
      for (const el of document.querySelectorAll('[title],[aria-label]')) {
        expect(el.getAttribute('title') ?? '').not.toContain(TRAVESSAO)
        expect(el.getAttribute('aria-label') ?? '').not.toContain(TRAVESSAO)
      }
      cleanup()
    }
  })
})
