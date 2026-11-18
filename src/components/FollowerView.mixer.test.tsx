// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FollowerView } from './FollowerView'
import { INITIAL_STATE, type FollowerState } from '../hooks/useLiveSync'
import { FADER_MAX_GAIN } from '../lib/faderScale'

afterEach(cleanup)

// Celular da banda com o controle liberado e um canal posto a +6 dB no palco novo.
const STATE: FollowerState = {
  ...INITIAL_STATE,
  isPlaying: true,
  songName: 'Grande é o Senhor',
  controlEnabled: true,
  channels: [{ id: 'c1', name: 'Bateria', volume: FADER_MAX_GAIN, muted: false, soloed: false }],
}

describe('mixer do celular da banda', () => {
  it('fader com o mesmo teto do palco (+6 dB, FADER_MAX_GAIN): o canal acima de 1,2 não cai no primeiro toque', () => {
    const sendCommand = vi.fn()
    render(<FollowerView state={STATE} isConnected sendCommand={sendCommand} />)
    fireEvent.click(screen.getByTitle('Mixer'))
    const fader = screen.getByRole('slider') as HTMLInputElement
    expect(Number(fader.max)).toBeCloseTo(FADER_MAX_GAIN, 6)
    expect(Number(fader.value)).toBeCloseTo(FADER_MAX_GAIN, 2)
    // Daí pra baixo um pouco: manda 1,5 (+3,5 dB), não o 1,2 de antes.
    fireEvent.change(fader, { target: { value: '1.5' } })
    expect(sendCommand).toHaveBeenLastCalledWith('set-volume', { id: 'c1', value: 1.5 })
  })
})
