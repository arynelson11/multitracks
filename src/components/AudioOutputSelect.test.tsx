// @vitest-environment jsdom
// Seletor do aparelho de saída (aba Geral): o que faz continua e o visual é o do kit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { state } = vi.hoisted(() => ({
  state: {
    settings: { audioDeviceId: 'default' },
    updateSetting: vi.fn(),
    availableAudioDevices: [
      { deviceId: 'default', label: 'Padrão', kind: 'audiooutput' },
      { deviceId: 'communications', label: 'Comunicação', kind: 'audiooutput' },
      { deviceId: 'abcdef123', label: '', kind: 'audiooutput' },
      { deviceId: 'placa', label: 'Focusrite 2i2', kind: 'audiooutput' },
    ] as unknown as MediaDeviceInfo[],
    refreshAudioDevices: vi.fn(async () => {}),
    canPickOutput: true,
  },
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => state }))

import { AudioOutputSelect } from './AudioOutputSelect'

afterEach(() => { cleanup(); vi.clearAllMocks(); state.canPickOutput = true })

describe('AudioOutputSelect', () => {
  it('lista as saídas ao aparecer, sem default e communications, e nome curto pra saída sem nome', () => {
    render(<AudioOutputSelect />)
    expect(state.refreshAudioDevices).toHaveBeenCalledTimes(1)
    const select = screen.getByRole('combobox', { name: 'Dispositivo de Áudio' }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Padrão do Sistema', 'Dispositivo (abcde...)', 'Focusrite 2i2'])
    fireEvent.change(select, { target: { value: 'placa' } })
    expect(state.updateSetting).toHaveBeenCalledWith('audioDeviceId', 'placa')
  })

  it('seletor e botão de atualizar do kit, com alvo de 44 px e textos de hoje', () => {
    const { container } = render(<AudioOutputSelect />)
    const refresh = screen.getByRole('button', { name: 'Atualizar a lista de dispositivos' })
    expect(refresh.className).toContain('min-h-ps-touch')
    fireEvent.click(refresh)
    expect(state.refreshAudioDevices).toHaveBeenCalledTimes(2)
    for (const t of ['Dispositivo de Áudio', 'Selecionar dispositivo de saída principal', 'Pra mostrar o nome das saídas, o navegador pede acesso ao microfone. Nada é gravado.']) expect(container.textContent).toContain(t)
    const select = screen.getByRole('combobox')
    for (const c of ['min-h-ps-touch', 'text-ps-md']) expect(select.className).toContain(c)
  })

  it('navegador que não troca a saída: só o aviso, sem seletor e sem atualizar', () => {
    state.canPickOutput = false
    const { container } = render(<AudioOutputSelect />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.textContent).toContain('Este navegador não deixa escolher a saída de áudio')
    expect(container.textContent).not.toContain('microfone')
  })
})
