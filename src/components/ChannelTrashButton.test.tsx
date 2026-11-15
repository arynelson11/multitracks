// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelTrashButton } from './ChannelTrashButton'
import { TWO_TAP_WINDOW_MS, useTwoTapConfirm } from '../hooks/useTwoTapConfirm'

// Mesma ligação do mixer no App: um estado só pra todas as lixeiras da música.
const CHANNELS = [{ id: 'a', label: 'Guitarra' }, { id: 'b', label: 'Baixo' }]
function Mixer({ removeChannel }: { removeChannel: (id: string) => void }) {
  const trash = useTwoTapConfirm(removeChannel)
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
  it('Esc desarma', () => {
    const removeChannel = setup()
    fireEvent.click(trashOf('Guitarra'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(isArmed('Guitarra')).toBe(false)
    fireEvent.click(trashOf('Guitarra'))
    expect(removeChannel).not.toHaveBeenCalled()
  })
  it('alvo de toque de 44px e texto que acompanha o padding, sem largura fixa', () => {
    setup()
    fireEvent.click(trashOf('Guitarra'))
    const classes = trashOf('Guitarra').className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['min-h-ps-touch', 'min-w-ps-touch', 'whitespace-nowrap']))
    expect(classes.some((c) => /^w-\d|^w-\[/.test(c))).toBe(false)
    expect(trashOf('Guitarra').className).toContain('#f59e0b')
  })
})
