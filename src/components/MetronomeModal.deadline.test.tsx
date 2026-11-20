// @vitest-environment jsdom
// Revisão macro BC (BC2-I3): a amostra do click que não chega (rede engasgada na web) não deixa o
// Metrônomo preso por cima do palco. O gerador é o de verdade; só o pedido da amostra fica sem
// resposta. Passado o prazo, a geração falha pelo caminho de sempre (o aviso de erro) e a janela fecha.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MetronomeModal } from './MetronomeModal'
import { CLICK_SAMPLE_TIMEOUT_MS } from '../lib/AudioAnalyzer'
import { FakeClickAudioContext } from '../test/clickShims'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.stubGlobal('AudioContext', FakeClickAudioContext)
  // A amostra nunca chega (nem respeita o cancelamento): só o prazo tira a geração daqui.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Metrônomo: a amostra do click que não chega', () => {
  it('passado o prazo, a geração falha com o aviso de erro e a janela fecha', async () => {
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onClose = vi.fn()
    const onAddClick = vi.fn()
    const song = { id: 's1', name: 'Teste', duration: 90, bpm: 120, channels: [] }
    render(<MetronomeModal isOpen onClose={onClose} playlistCurrentSong={song} onAddClick={onAddClick} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^GERAR CLICK MANUAL$/i })) })
    expect((screen.getByRole('button', { name: 'Fechar' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(CLICK_SAMPLE_TIMEOUT_MS - 100) })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(alerta).toHaveBeenCalledWith('Erro ao gerar metrônomo.')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAddClick).not.toHaveBeenCalled()
  })
})
