// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import type { OutputSettings } from '../lib/stageContracts'
import { SettingsProvider, useSettings } from './SettingsContext'
import { canPickAudioOutput, listAudioOutputs } from '../lib/audioOutputs'
import { AudioOutputSelect } from '../components/AudioOutputSelect'

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
    expect(await listAudioOutputs(undefined, { askLabels: true, canPickOutput: true })).toEqual([])
  })

  it('com askLabels falso nunca pede o microfone', async () => {
    const { md } = fakeMediaDevices([output('', '')], [output('a', 'Fone')])
    const list = await listAudioOutputs(md, { askLabels: false, canPickOutput: true })
    expect(md.getUserMedia).not.toHaveBeenCalled()
    expect(list.map(d => d.deviceId)).toEqual([''])
  })

  it('pede o microfone só quando falta nome nas saídas, para a captura na hora e lista de novo', async () => {
    const { md, stop } = fakeMediaDevices([output('', ''), input('', '')], [output('a', 'Fone'), output('b', 'Interface'), input('m', 'Mic')])
    const list = await listAudioOutputs(md, { askLabels: true, canPickOutput: true })
    expect(md.getUserMedia).toHaveBeenCalledTimes(1)
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(list.map(d => d.label)).toEqual(['Fone', 'Interface'])
  })

  it('navegador que não troca a saída (iOS, Safari, Firefox) nunca pede o microfone', async () => {
    const { md } = fakeMediaDevices([output('', '')], [output('a', 'Fone')])
    await listAudioOutputs(md, { askLabels: true, canPickOutput: false })
    const semSaidas = fakeMediaDevices([], [output('a', 'Fone')])
    await listAudioOutputs(semSaidas.md, { askLabels: true, canPickOutput: false })
    expect(md.getUserMedia).not.toHaveBeenCalled()
    expect(semSaidas.md.getUserMedia).not.toHaveBeenCalled()
  })

  it('lista vazia não conta como saída sem nome (não pede)', async () => {
    const { md } = fakeMediaDevices([], [output('a', 'Fone')])
    expect(await listAudioOutputs(md, { askLabels: true, canPickOutput: true })).toEqual([])
    expect(md.getUserMedia).not.toHaveBeenCalled()
  })

  it('não pede o microfone quando as saídas já vêm com nome', async () => {
    const { md } = fakeMediaDevices([output('a', 'Fone')])
    const list = await listAudioOutputs(md, { askLabels: true, canPickOutput: true })
    expect(md.getUserMedia).not.toHaveBeenCalled()
    expect(list).toHaveLength(1)
  })

  it('permissão negada não derruba: devolve o que deu pra listar', async () => {
    const { md } = fakeMediaDevices([output('', '')])
    md.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const list = await listAudioOutputs(md, { askLabels: true, canPickOutput: true })
    expect(list).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
  })
})

// AudioContext com ou sem setSinkId (o jsdom não tem AudioContext).
function stubAudioContext(withSinkId: boolean) {
  class FakeAudioContext {}
  if (withSinkId) Object.assign(FakeAudioContext.prototype, { setSinkId: () => Promise.resolve() })
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true })
}
function dropAudioContext() {
  Object.defineProperty(globalThis, 'AudioContext', { value: undefined, configurable: true, writable: true })
}

describe('canPickAudioOutput', () => {
  afterEach(dropAudioContext)
  it('só quando o AudioContext tem setSinkId (Chrome, Edge e o app desktop)', () => {
    dropAudioContext()
    expect(canPickAudioOutput()).toBe(false)
    stubAudioContext(false)
    expect(canPickAudioOutput()).toBe(false)
    stubAudioContext(true)
    expect(canPickAudioOutput()).toBe(true)
  })
})

describe('SettingsProvider e o microfone', () => {
  let fake: ReturnType<typeof fakeMediaDevices>

  beforeEach(() => {
    fake = fakeMediaDevices([output('', '')], [output('a', 'Fone')])
    Object.defineProperty(navigator, 'mediaDevices', { value: fake.md, configurable: true })
    stubAudioContext(true)
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    dropAudioContext()
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

  it('sem setSinkId, pedir a lista não pede o microfone', async () => {
    stubAudioContext(false)
    await act(async () => { render(<SettingsProvider><Probe /></SettingsProvider>) })
    await act(async () => { screen.getByText('listar').click() })
    await act(async () => { await Promise.resolve() })
    expect(fake.md.getUserMedia).not.toHaveBeenCalled()
  })
})

describe('AudioOutputSelect (aba Geral das Configurações)', () => {
  let fake: ReturnType<typeof fakeMediaDevices>
  beforeEach(() => {
    fake = fakeMediaDevices([output('', '')], [output('a', 'Fone'), output('b', 'Interface')])
    Object.defineProperty(navigator, 'mediaDevices', { value: fake.md, configurable: true })
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    dropAudioContext()
  })

  it('no navegador que não troca a saída mostra o aviso e nunca pede o microfone', async () => {
    stubAudioContext(false)
    await act(async () => { render(<SettingsProvider><AudioOutputSelect /></SettingsProvider>) })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Este navegador não deixa escolher a saída de áudio')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(fake.md.getUserMedia).not.toHaveBeenCalled()
  })

  it('no Chrome e no desktop lista as saídas ao abrir (pedindo o microfone só porque faltava nome)', async () => {
    stubAudioContext(true)
    await act(async () => { render(<SettingsProvider><AudioOutputSelect /></SettingsProvider>) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fake.md.getUserMedia).toHaveBeenCalledTimes(1)
    const options = [...screen.getByRole('combobox').querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(['Padrão do Sistema', 'Fone', 'Interface'])
  })
})

// ---------- T25: saídas por papel, chave do palco e migração do pan automático (R-23) ----------

describe('SettingsProvider: saídas e palco na primeira carga', () => {
  const SETTINGS = 'mt_app_settings'
  const MARKER = 'mt_outputs_migrated'
  const SPLIT: OutputSettings = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }
  const STEREO: OutputSettings = { ...SPLIT, mode: 'stereo' }
  // O que o Probe viu no último render (guardado depois do render, num efeito).
  const latest: { current: ReturnType<typeof useSettings> | null } = { current: null }
  const seen = () => latest.current!

  function Probe() {
    const value = useSettings()
    useEffect(() => { latest.current = value })
    return null
  }
  async function load(stored?: unknown, marker?: string) {
    if (stored !== undefined) localStorage.setItem(SETTINGS, typeof stored === 'string' ? stored : JSON.stringify(stored))
    if (marker !== undefined) localStorage.setItem(MARKER, marker)
    await act(async () => { render(<SettingsProvider><Probe /></SettingsProvider>) })
    return seen()
  }
  const storedNow = () => JSON.parse(localStorage.getItem(SETTINGS) ?? 'null')

  beforeEach(() => { localStorage.clear(); latest.current = null; dropAudioContext() })
  afterEach(() => { cleanup(); localStorage.clear() })

  it('quem tinha pan automático entra em separados, sem pan automático, e o palco antigo é o padrão (Ruling T29-padrao)', async () => {
    const { settings, outputLoadWarnings } = await load({ autoPan: true, audioDeviceId: 'fone' })
    expect(settings).toMatchObject({ outputs: SPLIT, autoPan: false, stageVersion: 'antigo', legacyPanReset: true, audioDeviceId: 'fone' })
    expect(outputLoadWarnings).toEqual([])
    // Gravado na hora: as saídas nas configurações e o marcador na chave própria.
    expect(storedNow()).toMatchObject({ outputs: SPLIT, autoPan: false, stageVersion: 'antigo', legacyPanReset: true, audioDeviceId: 'fone' })
    expect(localStorage.getItem(MARKER)).toBe('1')
  })

  it('quem nunca gravou nada (o pan automático era o padrão) também entra em separados', async () => {
    const { settings } = await load()
    expect(settings).toMatchObject({ outputs: SPLIT, autoPan: false, stageVersion: 'antigo', legacyPanReset: true, audioDeviceId: 'default' })
    expect(localStorage.getItem(MARKER)).toBe('1')
  })

  it('com o pan automático desligado fica em Tudo junto e não zera pan nenhum', async () => {
    const { settings } = await load({ autoPan: false, audioDeviceId: 'default' })
    expect(settings).toMatchObject({ outputs: STEREO, autoPan: false, legacyPanReset: false })
  })

  it('depois da migração, saída ilegível vira separados sem zerar os pans de novo', async () => {
    const { settings, outputLoadWarnings } = await load({ autoPan: true, outputs: { mode: 'quebrado' } }, '1')
    expect(settings).toMatchObject({ outputs: SPLIT, legacyPanReset: false })
    expect(outputLoadWarnings).toEqual(['modo-assumido'])
  })

  it('se só o marcador sumir, as saídas gravadas vencem e nada é zerado', async () => {
    const { settings } = await load({ autoPan: true, outputs: STEREO })
    expect(settings).toMatchObject({ outputs: STEREO, autoPan: true, legacyPanReset: false })
    expect(localStorage.getItem(MARKER)).toBe('1')
  })

  it('configurações quebradas sem marcador contam como primeira carga', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { settings } = await load('{nao e json')
    expect(error).toHaveBeenCalled()
    expect(settings).toMatchObject({ outputs: SPLIT, autoPan: false, legacyPanReset: true })
    expect(storedNow()).toMatchObject({ outputs: SPLIT })
    error.mockRestore()
  })

  it('palco novo só com a escolha do usuário; antigo, ausente ou valor estranho fica no antigo (Ruling T29-padrao)', async () => {
    expect((await load({ autoPan: false, stageVersion: 'novo' })).settings.stageVersion).toBe('novo')
    cleanup(); localStorage.clear()
    expect((await load({ autoPan: false, stageVersion: 'antigo' })).settings.stageVersion).toBe('antigo')
    cleanup(); localStorage.clear()
    expect((await load({ autoPan: false })).settings.stageVersion).toBe('antigo')
    cleanup(); localStorage.clear()
    expect((await load({ autoPan: false, stageVersion: 'v7' })).settings.stageVersion).toBe('antigo')
    cleanup(); localStorage.clear()
    expect((await load({ autoPan: false, stageVersion: 'NOVO' })).settings.stageVersion).toBe('antigo')
  })

  it('o pedido de zerar os pans fica gravado nas cargas seguintes (cada conta zera uma vez no motor)', async () => {
    await load({ autoPan: true })
    expect(storedNow().legacyPanReset).toBe(true)
    cleanup()
    // Segunda carga: saídas válidas e marcador gravados, o pedido continua pras contas que ainda não abriram.
    const second = await load()
    expect(second.settings).toMatchObject({ outputs: SPLIT, legacyPanReset: true })
  })

  it('a migração já está gravada antes de qualquer efeito dos filhos', async () => {
    let storedAtChildEffect: unknown = null
    function Child() {
      useEffect(() => { storedAtChildEffect = JSON.parse(localStorage.getItem(SETTINGS) ?? 'null') }, [])
      return null
    }
    localStorage.setItem(SETTINGS, JSON.stringify({ autoPan: true }))
    await act(async () => { render(<SettingsProvider><Child /></SettingsProvider>) })
    expect(storedAtChildEffect).toMatchObject({ outputs: SPLIT, legacyPanReset: true })
    expect(localStorage.getItem(MARKER)).toBe('1')
  })

  it('avisos da leitura somem quando o operador grava uma escolha de saídas', async () => {
    const first = await load({ autoPan: false, outputs: { mode: 'split2', multi: SPLIT.multi } }, '1')
    expect(first.outputLoadWarnings).toEqual(['lado-assumido'])
    await act(async () => { first.updateSetting('stageVersion', 'antigo') })
    expect(seen().outputLoadWarnings).toEqual(['lado-assumido'])
    await act(async () => { first.updateSetting('outputs', { ...SPLIT, earOnSecond: true }) })
    expect(seen().outputLoadWarnings).toEqual([])
    expect(storedNow().outputs).toEqual({ ...SPLIT, earOnSecond: true })
  })
})
