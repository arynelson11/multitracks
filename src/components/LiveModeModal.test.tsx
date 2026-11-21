// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LiveModeModal } from './LiveModeModal'

// Revisão macro 1b (Ruling relogio-livre): no Livre, a janela do Ao Vivo mostra em texto o tempo
// que falta hoje com a banda; quem paga não vê linha nenhuma.
const base = {
  isOpen: true, onClose: vi.fn(), serverUrl: 'http://192.168.0.10:3001', isStarting: false, serverError: null,
  onStopServer: vi.fn(), devices: [], approvedIps: [], onToggleDevice: vi.fn(), onToggleAll: vi.fn(),
  remoteSessionCode: null, onToggleRemote: vi.fn(),
}

afterEach(cleanup)

describe('LiveModeModal: tempo do Livre', () => {
  it('com o tempo do Livre, a janela mostra a frase', () => {
    render(<LiveModeModal {...base} livreTimeLeft="No Livre, restam 07:12 hoje com a banda." />)
    expect(screen.getByRole('timer').textContent).toBe('No Livre, restam 07:12 hoje com a banda.')
  })

  it('sem o tempo (quem paga e o admin), nenhuma linha', () => {
    render(<LiveModeModal {...base} livreTimeLeft={null} />)
    expect(screen.queryByRole('timer')).toBeNull()
    render(<LiveModeModal {...base} />)
    expect(screen.queryByRole('timer')).toBeNull()
  })
})
