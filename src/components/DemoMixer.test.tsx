// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DemoMixer } from './DemoMixer'

afterEach(cleanup)

describe('DemoMixer: nomes acessíveis', () => {
  it('o play do demo tem nome', () => {
    render(<DemoMixer />)
    expect(screen.getByRole('button', { name: 'Tocar a demonstração' })).toBeTruthy()
  })

  it('M e S dizem o canal e se estão ligados', () => {
    render(<DemoMixer />)
    const mute = screen.getByRole('button', { name: 'Mute Vocais' })
    const solo = screen.getByRole('button', { name: 'Solo Bateria' })
    expect(mute.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(mute)
    expect(mute.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(solo)
    expect(solo.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('button', { name: /^(Mute|Solo) / })).toHaveLength(12)
  })
})
