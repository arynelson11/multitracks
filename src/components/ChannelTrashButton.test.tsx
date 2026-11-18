// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { ChannelTrashButton } from './ChannelTrashButton'
import { TWO_TAP_MIN_GAP_MS, TWO_TAP_WINDOW_MS, useTwoTapConfirm } from '../hooks/useTwoTapConfirm'

// Mesma ligação do mixer no App: um estado só pra todas as lixeiras da música.
const CHANNELS = [{ id: 'a', label: 'Guitarra' }, { id: 'b', label: 'Baixo' }]
function Mixer({ removeChannel, songId = 's1' }: { removeChannel: (id: string) => void; songId?: string }) {
  const trash = useTwoTapConfirm(removeChannel, { resetKey: songId })
  return (
    <>
      {CHANNELS.map((ch) => (
        <ChannelTrashButton key={ch.id} channelLabel={ch.label}
          armed={trash.armedId === ch.id} onPress={() => trash.press(ch.id)} />
      ))}
    </>
  )
}
const setup = () => {
  const removeChannel = vi.fn()
  render(<Mixer removeChannel={removeChannel} />)
  return removeChannel
}
const trashOf = (label: string) => screen.getByRole('button', { name: new RegExp(`canal ${label}$`) })
const isArmed = (label: string) => trashOf(label).textContent === 'Apagar?'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('lixeira do canal pede segundo toque', () => {
  it('janela de 3000 ms', () => {
    expect(TWO_TAP_WINDOW_MS).toBe(3000)
  })
  it('primeiro toque arma: não apaga e mostra "Apagar?" com o aviso no aria-label', () => {
    const removeChannel = setup()
    expect(trashOf('Guitarra').getAttribute('aria-label')).toBe('Apagar o canal Guitarra')
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect(screen.getByText('Apagar?')).toBeTruthy()
    expect(trashOf('Guitarra').getAttribute('aria-label')).toBe('Toque de novo para apagar o canal Guitarra')
  })
  // Junção (R2): duplo clique rápido ou Enter segurado não podem apagar num gesto só.
  it('segundo toque antes de 350 ms é ignorado: continua armada e não apaga', () => {
    expect(TWO_TAP_MIN_GAP_MS).toBe(350)
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS - 1) })
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect(isArmed('Guitarra')).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })
  it('duplo clique (dois cliques no mesmo instante) só arma', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect(isArmed('Guitarra')).toBe(true)
  })
  it('repetição de tecla (Enter segurado) não aciona a lixeira; o primeiro Enter sim', () => {
    setup()
    const first = createEvent.keyDown(trashOf('Guitarra'), { key: 'Enter' })
    fireEvent(trashOf('Guitarra'), first)
    expect(first.defaultPrevented).toBe(false)
    for (const key of ['Enter', ' ']) {
      const held = createEvent.keyDown(trashOf('Guitarra'), { key, repeat: true })
      fireEvent(trashOf('Guitarra'), held)
      expect(held.defaultPrevented).toBe(true)
    }
  })
  it('segundo toque dentro da janela apaga uma vez só', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    act(() => { vi.advanceTimersByTime(TWO_TAP_WINDOW_MS - 1) })
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).toHaveBeenCalledTimes(1)
    expect(removeChannel).toHaveBeenCalledWith('a')
    expect(isArmed('Guitarra')).toBe(false)
  })
  it('toque, 3001 ms, toque: não apaga (desarmou sozinho e o segundo toque só rearma)', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    act(() => { vi.advanceTimersByTime(3001) })
    expect(isArmed('Guitarra')).toBe(false)
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect(isArmed('Guitarra')).toBe(true)
  })
  it('armar o canal A e tocar a lixeira do B: A desarma e nada é apagado', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    fireEvent.click(trashOf('Baixo'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect([isArmed('Guitarra'), isArmed('Baixo')]).toEqual([false, true])
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
  })
  // Junção (R5): trocar de música desarma. Voltar pra música em menos de 3 s não
  // encontra a lixeira ainda armada.
  it('trocar de música desarma, e voltar logo não acha a lixeira armada', () => {
    const removeChannel = vi.fn()
    const { rerender } = render(<Mixer removeChannel={removeChannel} songId="s1" />)
    fireEvent.click(trashOf('Guitarra'))
    expect(isArmed('Guitarra')).toBe(true)
    rerender(<Mixer removeChannel={removeChannel} songId="s2" />)
    expect(isArmed('Guitarra')).toBe(false)
    rerender(<Mixer removeChannel={removeChannel} songId="s1" />)
    expect(isArmed('Guitarra')).toBe(false)
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS) })
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
    expect(isArmed('Guitarra')).toBe(true)
  })
  it('Esc desarma', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(isArmed('Guitarra')).toBe(false)
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
  })
  it('alvo de toque de 44px, texto que acompanha o padding, sem largura fixa, âmbar de alerta', () => {
    setup()
    fireEvent.click(trashOf('Guitarra'))
    const classes = trashOf('Guitarra').className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['min-h-ps-touch', 'min-w-ps-touch', 'whitespace-nowrap']))
    expect(classes.some((c) => /^w-\d|^w-\[/.test(c))).toBe(false)
    // Âmbar do token de alerta (ps-alert), não o #f59e0b da seção Pré.
    expect(classes).toContain('bg-ps-alert')
    expect(trashOf('Guitarra').className).not.toContain('#f59e0b')
  })
})
