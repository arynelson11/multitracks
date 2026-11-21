// @vitest-environment jsdom
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE_DYNAMICS, GUIDE_SECTIONS } from '../../lib/separation/voiceGuide'
import { oldLanguageClasses } from '../../test/psLanguage'
import { BpmClickEditor } from './BpmClickEditor'
import { CloudSaveForm } from './CloudSaveForm'
import { VoiceGuideEditor } from './VoiceGuideEditor'
import { PAUSE_TO_USE } from './toolsCopy'

const TRAVESSAO = String.fromCharCode(0x2014)
afterEach(cleanup)

type BpmProps = React.ComponentProps<typeof BpmClickEditor>
const bpmProps = (over: Partial<BpmProps> = {}): BpmProps => ({
  bpm: '120', meter: '4/4', accentBeat1: true, downbeatShift: 0, clickSel: { type: 'Classic', subdivision: 'quarter' },
  info: '', busy: null, hasTracks: true,
  onBpm: vi.fn(), onBpmBlur: vi.fn(), onStep: vi.fn(), onTap: vi.fn(), onScale: vi.fn(), onDetect: vi.fn(),
  onMeter: vi.fn(), onAccent: vi.fn(), onShiftDownbeat: vi.fn(), onClickSel: vi.fn(), onGenerate: vi.fn(),
  ...over,
})
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('BpmClickEditor', () => {
  it('BPM: -1, +1, Tap tempo, 2× e ½× chamam as ações; o nome do andamento aparece', () => {
    const p = bpmProps({ bpm: '130' })
    render(<BpmClickEditor {...p} />)
    expect(screen.getByText('Allegro')).toBeTruthy()
    fireEvent.click(btn('Diminuir o BPM')); expect(p.onStep).toHaveBeenCalledWith(-1)
    fireEvent.click(btn('Aumentar o BPM')); expect(p.onStep).toHaveBeenCalledWith(1)
    fireEvent.click(btn('Tap tempo')); expect(p.onTap).toHaveBeenCalled()
    fireEvent.click(btn('Dobrar o BPM')); expect(p.onScale).toHaveBeenCalledWith(2)
    fireEvent.click(btn('Metade do BPM')); expect(p.onScale).toHaveBeenCalledWith(0.5)
    const field = screen.getByLabelText('BPM') as HTMLInputElement
    expect(field.value).toBe('130')
    fireEvent.change(field, { target: { value: '98' } }); expect(p.onBpm).toHaveBeenCalledWith('98')
    fireEvent.blur(field); expect(p.onBpmBlur).toHaveBeenCalled()
  })

  it('BPM: Detectar mostra Analisando a música... e desliga; sem faixas desliga Detectar e Gerar click', () => {
    const p = bpmProps({ busy: 'bpm', info: '119.87 BPM medido na faixa Bateria.' })
    render(<BpmClickEditor {...p} />)
    expect(btn('Analisando a música...').disabled).toBe(true)
    expect(screen.getByText('119.87 BPM medido na faixa Bateria.')).toBeTruthy()
    expect(btn(/^Gerar click/).disabled).toBe(true)
    cleanup()
    const q = bpmProps({ hasTracks: false })
    render(<BpmClickEditor {...q} />)
    expect(btn('Detectar BPM da música').disabled).toBe(true)
    expect(btn(/^Gerar click/).disabled).toBe(true)
    cleanup()
    const r = bpmProps()
    render(<BpmClickEditor {...r} />)
    expect(btn('Detectar BPM da música').title).toBe('Mede o BPM exato na bateria da música')
    fireEvent.click(btn('Detectar BPM da música')); expect(r.onDetect).toHaveBeenCalled()
    fireEvent.click(btn('Gerar click · Classic 4/4 1/4')); expect(r.onGenerate).toHaveBeenCalled()
  })

  it('BPM: sem a detecção no plano, o Detectar continua tocável e diz o motivo', () => {
    const p = bpmProps({ detectLocked: true })
    render(<BpmClickEditor {...p} />)
    expect(btn('Detectar BPM da música').title).toBe('Detecção de BPM disponível nos planos pagos')
    expect(btn('Detectar BPM da música').disabled).toBe(false)
  })

  it('BPM: Mover o 1 só com o acento ligado; compasso, som e subdivisão chamam com o valor', () => {
    const p = bpmProps({ downbeatShift: 2 })
    render(<BpmClickEditor {...p} />)
    expect(screen.getByText('+2')).toBeTruthy()
    fireEvent.click(btn('Mover o 1 um tempo pra trás')); expect(p.onShiftDownbeat).toHaveBeenCalledWith(-1)
    fireEvent.click(btn('Mover o 1 um tempo pra frente')); expect(p.onShiftDownbeat).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('switch', { name: /Acentuar tempo 1/ })); expect(p.onAccent).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('radio', { name: '6/8' })); expect(p.onMeter).toHaveBeenCalledWith('6/8')
    fireEvent.click(screen.getByRole('radio', { name: 'Woodblock' })); expect(p.onClickSel).toHaveBeenCalledWith({ type: 'Woodblock' })
    fireEvent.click(screen.getByRole('radio', { name: '1/8' })); expect(p.onClickSel).toHaveBeenCalledWith({ subdivision: 'eighth' })
    expect(screen.getAllByRole('radio')).toHaveLength(6 + 7 + 4)
    cleanup()
    render(<BpmClickEditor {...bpmProps({ accentBeat1: false })} />)
    expect(screen.queryByText('Mover o "1"')).toBeNull()
  })

  it('BPM: gerando esconde som e subdivisão e mostra Gerando click <tipo>...', () => {
    render(<BpmClickEditor {...bpmProps({ busy: 'click', clickSel: { type: 'Cowbell', subdivision: 'eighth' } })} />)
    expect(screen.getByText('Gerando click Cowbell...')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Som do click' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Subdivisão' })).toBeNull()
    expect(btn('Diminuir o BPM').disabled).toBe(true)
    expect(btn('Tap tempo').disabled).toBe(true)
  })

  it('BPM: disabledReason desliga Detectar e Gerar click com o motivo no title', () => {
    render(<BpmClickEditor {...bpmProps({ disabledReason: PAUSE_TO_USE })} />)
    expect(btn('Detectar BPM da música').disabled).toBe(true)
    expect(btn('Detectar BPM da música').title).toBe(PAUSE_TO_USE)
    expect(btn(/^Gerar click/).disabled).toBe(true)
    expect(btn(/^Gerar click/).title).toBe(PAUSE_TO_USE)
    // O resto do BPM continua mexendo.
    expect(btn('Tap tempo').disabled).toBe(false)
  })

  it('BPM: SYNC mostra o deslocamento com sinal e só anda ligado', () => {
    const onNudge = vi.fn()
    render(<BpmClickEditor {...bpmProps({ sync: { offsetMs: 20, enabled: false, busy: false, onNudge } })} />)
    expect(screen.getByText('+20 ms')).toBeTruthy()
    expect(btn('Adiantar o click 10 ms').disabled).toBe(true)
    cleanup()
    render(<BpmClickEditor {...bpmProps({ sync: { offsetMs: -10, enabled: true, busy: false, onNudge } })} />)
    fireEvent.click(btn('Adiantar o click 10 ms')); expect(onNudge).toHaveBeenCalledWith(-10)
    fireEvent.click(btn('Atrasar o click 10 ms')); expect(onNudge).toHaveBeenCalledWith(10)
    expect(screen.getByText('-10 ms')).toBeTruthy()
  })

  it('BPM: mensagem de erro aparece em alerta', () => {
    render(<BpmClickEditor {...bpmProps({ message: 'Não deu pra gerar o click. Tenta de novo.' })} />)
    expect(screen.getByRole('alert').textContent).toBe('Não deu pra gerar o click. Tenta de novo.')
  })
})

type VoiceProps = React.ComponentProps<typeof VoiceGuideEditor>
const CUES = [
  { id: 'c1', time: 0, label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' },
  { id: 'c2', time: 65, label: 'Refrão 1', file: 'Song Sections/Portugese - Chorus 1.wav' },
]
const voiceProps = (over: Partial<VoiceProps> = {}): VoiceProps => ({
  cues: CUES, tab: 'sections', playing: false, detecting: false, rendering: false, hasChannel: false, pending: false,
  onTab: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onTime: vi.fn(), onClear: vi.fn(), onDetect: vi.fn(), onCommit: vi.fn(),
  ...over,
})

describe('VoiceGuideEditor', () => {
  it('voz guia: abas, cada marcação chama onAdd, a lista edita o tempo no blur e no Enter e tira', () => {
    const p = voiceProps()
    render(<VoiceGuideEditor {...p} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Dinâmicas' })); expect(p.onTab).toHaveBeenCalledWith('dynamic')
    expect(screen.getAllByRole('button', { name: 'Intro' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Ponte' })); expect(p.onAdd).toHaveBeenCalledWith(GUIDE_SECTIONS.find((g) => g.label === 'Ponte'))
    expect(screen.getByText('Marcações (2)')).toBeTruthy()
    const t = screen.getByLabelText('Tempo de Refrão 1') as HTMLInputElement
    expect(t.value).toBe('1:05')
    fireEvent.change(t, { target: { value: '1:10' } })
    fireEvent.blur(t); expect(p.onTime).toHaveBeenCalledWith('c2', '1:10')
    fireEvent.click(screen.getByRole('button', { name: 'Tirar Intro' })); expect(p.onRemove).toHaveBeenCalledWith('c1')
    cleanup()
    render(<VoiceGuideEditor {...voiceProps({ tab: 'dynamic' })} />)
    expect(screen.getAllByRole('button', { name: 'All In' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Ponte' })).toBeNull()
    expect(GUIDE_DYNAMICS.length).toBeGreaterThan(0)
  })

  it('voz guia: Enter no tempo sai do campo (e grava pelo blur)', () => {
    const p = voiceProps()
    render(<VoiceGuideEditor {...p} />)
    const t = screen.getByLabelText('Tempo de Intro') as HTMLInputElement
    t.focus()
    fireEvent.keyDown(t, { key: 'Enter' })
    expect(document.activeElement).not.toBe(t)
  })

  it('voz guia: Limpar todos, Auto-detectar e Gerar ou Atualizar canal conforme hasChannel', () => {
    const p = voiceProps()
    render(<VoiceGuideEditor {...p} />)
    fireEvent.click(btn('Limpar todos')); expect(p.onClear).toHaveBeenCalled()
    fireEvent.click(btn('Auto-detectar')); expect(p.onDetect).toHaveBeenCalled()
    expect(btn('Auto-detectar').title).toBe('IA analisa o áudio e detecta seções automaticamente')
    fireEvent.click(btn('Gerar canal de Voz Guia')); expect(p.onCommit).toHaveBeenCalled()
    cleanup()
    render(<VoiceGuideEditor {...voiceProps({ hasChannel: true })} />)
    expect(btn('Atualizar canal de Voz Guia')).toBeTruthy()
    cleanup()
    render(<VoiceGuideEditor {...voiceProps({ rendering: true })} />)
    expect(btn('Gerando canal...').disabled).toBe(true)
    cleanup()
    render(<VoiceGuideEditor {...voiceProps({ detecting: true })} />)
    expect(btn('Analisando...').disabled).toBe(true)
    expect(screen.getByText('Analisando estrutura do áudio...')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    cleanup()
    render(<VoiceGuideEditor {...voiceProps({ cues: [] })} />)
    expect(screen.queryByRole('button', { name: /canal de Voz Guia/ })).toBeNull()
    expect(screen.queryByText('Limpar todos')).toBeNull()
  })

  it('voz guia: tocando, a instrução diz pra clicar; marcação nova acende o Gerar canal', () => {
    render(<VoiceGuideEditor {...voiceProps({ playing: true, pending: true })} />)
    expect(screen.getByText('Clique em uma seção para marcar o tempo atual')).toBeTruthy()
    expect(screen.getByText('Marcações novas ainda não estão no canal.')).toBeTruthy()
    expect(btn('Gerar canal de Voz Guia').className).toContain('bg-ps-or')
    cleanup()
    render(<VoiceGuideEditor {...voiceProps()} />)
    expect(screen.getByText('Reproduza a música e clique para carimbar o tempo. Ou use Auto-Detectar.')).toBeTruthy()
    expect(btn('Gerar canal de Voz Guia').className).not.toContain('bg-ps-or ')
  })

  it('voz guia: disabledReason desliga Auto-detectar e Gerar canal, nunca a grade', () => {
    const p = voiceProps({ disabledReason: PAUSE_TO_USE, playing: true })
    render(<VoiceGuideEditor {...p} />)
    expect(btn('Auto-detectar').disabled).toBe(true)
    expect(btn('Auto-detectar').title).toBe(PAUSE_TO_USE)
    expect(btn('Gerar canal de Voz Guia').disabled).toBe(true)
    expect(btn('Verso').disabled).toBe(false)
    fireEvent.click(btn('Verso')); expect(p.onAdd).toHaveBeenCalled()
  })
})

type CloudProps = React.ComponentProps<typeof CloudSaveForm>
const cloudProps = (over: Partial<CloudProps> = {}): CloudProps => ({
  channels: 5, name: 'Águas', artist: '', bpm: '72', songKey: 'D', cover: null, showBpm: true, isAdmin: false, publishGlobal: false,
  saving: false, progress: 0, status: '', onChange: vi.fn(), onSubmit: vi.fn(), ...over,
})

describe('CloudSaveForm', () => {
  it('publicar: campos, BPM só com showBpm, visibilidade só pro admin, capa escolhe e tira', () => {
    const p = cloudProps({ isAdmin: true })
    render(<CloudSaveForm {...p} />)
    expect(screen.getByText('Salvando projeto multi-faixa de 5 canais na sua biblioteca.')).toBeTruthy()
    const name = screen.getByLabelText('Música *') as HTMLInputElement
    expect(name.placeholder).toBe('ex: Águas Purificadoras')
    fireEvent.change(name, { target: { value: 'Outra' } }); expect(p.onChange).toHaveBeenCalledWith({ name: 'Outra' })
    fireEvent.change(screen.getByLabelText('Artista'), { target: { value: 'Hillsong' } }); expect(p.onChange).toHaveBeenCalledWith({ artist: 'Hillsong' })
    fireEvent.change(screen.getByLabelText('BPM (IA)'), { target: { value: '80' } }); expect(p.onChange).toHaveBeenCalledWith({ bpm: '80' })
    const key = screen.getByLabelText('Tom') as HTMLSelectElement
    expect(key.options).toHaveLength(12)
    fireEvent.change(key, { target: { value: 'G' } }); expect(p.onChange).toHaveBeenCalledWith({ songKey: 'G' })
    fireEvent.click(screen.getByRole('switch', { name: /Visibilidade global/ })); expect(p.onChange).toHaveBeenCalledWith({ publishGlobal: true })
    const cover = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(cover.accept).toBe('image/*')
    const img = new File(['c'], 'capa.png', { type: 'image/png' })
    fireEvent.change(cover, { target: { files: [img] } }); expect(p.onChange).toHaveBeenCalledWith({ cover: img })
    fireEvent.click(btn('Salvar & publicar')); expect(p.onSubmit).toHaveBeenCalled()
    cleanup()
    const q = cloudProps({ cover: img, showBpm: false })
    render(<CloudSaveForm {...q} />)
    expect(screen.queryByLabelText('BPM (IA)')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText('capa.png')).toBeTruthy()
    fireEvent.click(btn('Tirar')); expect(q.onChange).toHaveBeenCalledWith({ cover: null })
  })

  it('publicar: salvando mostra Publicando..., o status e a barra; message aparece em alerta', () => {
    render(<CloudSaveForm {...cloudProps({ saving: true, progress: 40, status: 'Enviando Vocais pra nuvem (1 de 5)...' })} />)
    expect(screen.getByText('Publicando...')).toBeTruthy()
    expect(screen.getByText('Enviando Vocais pra nuvem (1 de 5)...')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
    expect(screen.queryByRole('button', { name: 'Salvar & publicar' })).toBeNull()
    cleanup()
    render(<CloudSaveForm {...cloudProps({ saving: true, progress: 100, status: 'Sucesso! Música publicada na nuvem.' })} />)
    expect(screen.getByText('Pronto!')).toBeTruthy()
    cleanup()
    render(<CloudSaveForm {...cloudProps({ message: 'Preencha o Nome da Música.' })} />)
    expect(screen.getByRole('alert').textContent).toBe('Preencha o Nome da Música.')
  })
})

describe('as três peças no Separador', () => {
  it('o Separador abre as três no StageDialog e nenhum alert sobrou nessas ferramentas', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(src).toMatch(/<BpmClickEditor[\s>]/)
    expect(src).toMatch(/<VoiceGuideEditor[\s>]/)
    expect(src).toMatch(/<CloudSaveForm[\s>]/)
    expect(src.match(/<StageDialog[\s>]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(src).not.toMatch(/alert\('Adicione marcadores|alert\('Erro ao gerar canal|alert\("Preencha|alert\("Erro ao salvar|alert\('Não deu pra gerar o click|alert\('Não foi possível analisar/)
  })

  it('nenhum texto com travessão nem classe do visual antigo nas três peças', () => {
    render(<BpmClickEditor {...bpmProps({ sync: { offsetMs: 0, enabled: true, busy: false, onNudge: vi.fn() } })} />)
    render(<VoiceGuideEditor {...voiceProps()} />)
    render(<CloudSaveForm {...cloudProps({ isAdmin: true })} />)
    expect(document.body.textContent).not.toContain(TRAVESSAO)
    expect(oldLanguageClasses(document.body)).toEqual([])
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
      for (const a of ['title', 'aria-label', 'placeholder']) expect(el.getAttribute(a) ?? '').not.toContain(TRAVESSAO)
    }
  })
})
