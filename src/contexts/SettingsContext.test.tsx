// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SettingsProvider, useSettings } from './SettingsContext'
import { listAudioOutputs } from '../lib/audioOutputs'

const output = (deviceId: string, label: string) =>
  ({ deviceId, label, kind: 'audiooutput', groupId: 'g', toJSON: () => ({}) }) as MediaDeviceInfo
const input = (deviceId: string, label: string) =>
  ({ deviceId, label, kind: 'audioinput', groupId: 'g', toJSON: () => ({}) }) as MediaDeviceInfo

function fakeMediaDevices(before: MediaDeviceInfo[], after: MediaDeviceInfo[] = before) {
  let granted = false
  const stop = vi.fn()
  const listeners = new Set<() => void>()
  const md = {
    enumerateDevices: vi.fn(async () => (granted ? after : before)),
    getUserMedia: vi.fn(async () => {
      granted = true
      return { getTracks: () => [{ stop }] } as unknown as MediaStream
    }),
    addEventListener: vi.fn((_: string, fn: () => void) => { listeners.add(fn) }),
    removeEventListener: vi.fn((_: string, fn: () => void) => { listeners.delete(fn) }),
    fire: () => listeners.forEach(fn => fn()),
  }
  return { md, stop }
}

describe('listAudioOutputs', () => {
  it('sem mediaDevices devolve lista vazia', async () => {
    expect(await listAudioOutputs(undefined, { askLabels: true })).toEqual([])
  })

  it('com askLabels falso nunca pede o microfone', async () => {
    const { md } = fakeMediaDevices([output('', '')], [output('a', 'Fone')])
    const list = await listAudioOutputs(md, { askLabels: false })
    expect(md.getUserMedia).not.toHaveBeenCalled()
    expect(list.map(d => d.deviceId)).toEqual([''])
  })

  it('pede o microfone só quando falta nome nas saídas, para a captura na hora e lista de novo', async () => {
    const { md, stop } = fakeMediaDevices([output('', ''), input('', '')], [output('a', 'Fone'), output('b', 'Interface'), input('m', 'Mic')])
    const list = await listAudioOutputs(md, { askLabels: true })
    expect(md.getUserMedia).toHaveBeenCalledTimes(1)
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(list.map(d => d.label)).toEqual(['Fone', 'Interface'])
  })

  it('não pede o microfone quando as saídas já vêm com nome', async () => {
    const { md } = fakeMediaDevices([output('a', 'Fone')])
    const list = await listAudioOutputs(md, { askLabels: true })
    expect(md.getUserMedia).not.toHaveBeenCalled()
    expect(list).toHaveLength(1)
  })

  it('permissão negada não derruba: devolve o que deu pra listar', async () => {
    const { md } = fakeMediaDevices([output('', '')])
    md.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const list = await listAudioOutputs(md, { askLabels: true })
    expect(list).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
  })
})

describe('SettingsProvider e o microfone', () => {
  let fake: ReturnType<typeof fakeMediaDevices>

  beforeEach(() => {
    fake = fakeMediaDevices([output('', '')], [output('a', 'Fone')])
    Object.defineProperty(navigator, 'mediaDevices', { value: fake.md, configurable: true })
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  })

  function Probe() {
    const { availableAudioDevices, refreshAudioDevices } = useSettings()
    return (
      <div>
        <span data-testid="n">{availableAudioDevices.map(d => d.label).join(',')}</span>
        <button onClick={() => { void refreshAudioDevices() }}>listar</button>
      </div>
    )
  }

  it('montar o app (landing, visitante sem login) não pede o microfone', async () => {
    await act(async () => { render(<SettingsProvider><Probe /></SettingsProvider>) })
    await act(async () => { await Promise.resolve() })
    expect(fake.md.getUserMedia).not.toHaveBeenCalled()
  })

  it('troca de aparelho de áudio atualiza a lista sem pedir o microfone', async () => {
    await act(async () => { render(<SettingsProvider><Probe /></SettingsProvider>) })
    await act(async () => { fake.md.fire(); await Promise.resolve() })
    expect(fake.md.getUserMedia).not.toHaveBeenCalled()
  })

  it('o pedido só acontece quando alguém pede a lista de saídas (Configurações)', async () => {
    await act(async () => { render(<SettingsProvider><Probe /></SettingsProvider>) })
    await act(async () => { screen.getByText('listar').click() })
    await act(async () => { await Promise.resolve() })
    expect(fake.md.getUserMedia).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('n').textContent).toBe('Fone')
  })
})
