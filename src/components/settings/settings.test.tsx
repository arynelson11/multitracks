// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AudioOutputsSection } from './AudioOutputsSection'
import { StageVersionSetting } from './StageVersionSetting'
import { OUTPUT_WARNING_TEXT, multiChoices } from '../../lib/outputPlan'
import type { OutputSettings } from '../../lib/stageContracts'

afterEach(cleanup)

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i
const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$))/

const SPLIT: OutputSettings = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }
const STEREO: OutputSettings = { ...SPLIT, mode: 'stereo' }
const MULTI: OutputSettings = { ...SPLIT, mode: 'multi' }

interface Opts { outputs?: OutputSettings; maxChannels?: number; supportsDevicePick?: boolean; loadWarnings?: Parameters<typeof AudioOutputsSection>[0]['loadWarnings'] }
function renderOutputs(o: Opts = {}) {
  const onChange = vi.fn<(next: OutputSettings) => void>()
  const utils = render(
    <AudioOutputsSection
      outputs={o.outputs ?? SPLIT}
      maxChannels={o.maxChannels ?? 2}
      supportsDevicePick={o.supportsDevicePick ?? true}
      onChange={onChange}
      loadWarnings={o.loadWarnings}
    />,
  )
  return { ...utils, onChange }
}

const modeGroup = () => screen.getByRole('radiogroup', { name: 'Saídas de áudio' })
const modeRadio = (name: string) => within(modeGroup()).getByRole('radio', { name }) as HTMLButtonElement
const alerts = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-output-alert]')).map((e) => e.textContent)
const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const optionTexts = (s: HTMLSelectElement) => Array.from(s.options).map((o) => o.textContent)

describe('AudioOutputsSection', () => {
  it('4 ou mais saídas desabilitado em placa de 2 canais', () => {
    const { onChange, container } = renderOutputs({ maxChannels: 2 })
    expect(modeRadio('Tudo junto').disabled).toBe(false)
    expect(modeRadio('Click e Guia separados').disabled).toBe(false)
    expect(modeRadio('Click e Guia separados').getAttribute('aria-checked')).toBe('true')
    const multi = modeRadio('4 ou mais saídas')
    expect(multi.disabled).toBe(true)
    expect(container.textContent).toContain('Esta saída tem 2 canais.')
    fireEvent.click(multi)
    expect(onChange).not.toHaveBeenCalled()
    // Placa de 1 canal (fone em modo de chamada): singular, e a opção continua desligada.
    cleanup()
    const one = renderOutputs({ maxChannels: 1 })
    expect(modeRadio('4 ou mais saídas').disabled).toBe(true)
    expect(one.container.textContent).toContain('Esta saída tem 1 canal.')
  })

  it('4 ou mais saídas liberado em placa de 8 canais, com os seletores de multiChoices', () => {
    const { onChange, container, rerender } = renderOutputs({ maxChannels: 8 })
    expect(container.textContent).not.toContain('Esta saída tem')
    fireEvent.click(modeRadio('4 ou mais saídas'))
    expect(onChange).toHaveBeenCalledWith({ mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } })
    expect(screen.queryByRole('combobox')).toBeNull()

    rerender(<AudioOutputsSection outputs={MULTI} maxChannels={8} supportsDevicePick onChange={onChange} />)
    const choices = multiChoices(8)
    expect(optionTexts(select('VS estéreo'))).toEqual(choices.vsPairs.map((p) => `Saídas ${p + 1} e ${p + 2}`))
    // Click e Guia nunca no par da VS: as saídas 1 e 2 nem aparecem.
    const singlesFora = choices.singles.filter((o) => o > 1).map((o) => `Saída ${o + 1}`)
    expect(optionTexts(select('Click'))).toEqual(singlesFora)
    expect(optionTexts(select('Guia'))).toEqual(singlesFora)
    expect(select('VS estéreo').value).toBe('0')
    expect(select('Click').value).toBe('2')
    expect(select('Guia').value).toBe('3')
    for (const name of ['VS estéreo', 'Click', 'Guia']) {
      const s = select(name)
      for (const c of ['min-h-ps-touch', 'text-ps-md']) expect(s.className).toContain(c)
      expect(s.className).not.toMatch(FIXED_WIDTH)
    }
    // A chave do lado não aparece em 4 ou mais (o lado só vale em separados).
    expect(screen.queryByRole('radiogroup', { name: 'Click e Guia na saída' })).toBeNull()
  })

  it('mudar o lado do click chama onChange com earOnSecond', () => {
    const { onChange, rerender } = renderOutputs({ maxChannels: 2 })
    const side = screen.getByRole('radiogroup', { name: 'Click e Guia na saída' })
    const um = within(side).getByRole('radio', { name: '1' })
    const dois = within(side).getByRole('radio', { name: '2' })
    expect(um.getAttribute('aria-checked')).toBe('true')
    for (const r of [um, dois]) expect(r.className).toContain('min-h-ps-touch')
    fireEvent.click(dois)
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'split2', earOnSecond: true, multi: { vsPair: 0, click: 2, guide: 3 } })

    const trocado: OutputSettings = { ...SPLIT, earOnSecond: true }
    rerender(<AudioOutputsSection outputs={trocado} maxChannels={2} supportsDevicePick onChange={onChange} />)
    const lado = screen.getByRole('radiogroup', { name: 'Click e Guia na saída' })
    expect(within(lado).getByRole('radio', { name: '2' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(lado).getByRole('radio', { name: '1' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } })
    // Tocar no lado que já vale não grava nada.
    onChange.mockClear()
    fireEvent.click(within(lado).getByRole('radio', { name: '2' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a chave do lado só aparece em separados, inclusive na queda de 4 ou mais', () => {
    renderOutputs({ outputs: STEREO, maxChannels: 2 })
    expect(screen.queryByRole('radiogroup', { name: 'Click e Guia na saída' })).toBeNull()
    cleanup()
    const { onChange } = renderOutputs({ outputs: MULTI, maxChannels: 2 })
    const side = screen.getByRole('radiogroup', { name: 'Click e Guia na saída' })
    fireEvent.click(within(side).getByRole('radio', { name: '2' }))
    // O modo gravado continua 4 ou mais (o mapa fica guardado); só o lado da queda muda.
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'multi', earOnSecond: true, multi: { vsPair: 0, click: 2, guide: 3 } })
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('trocar o modo grava o modo e guarda lado e mapa', () => {
    const { onChange } = renderOutputs({ outputs: { ...SPLIT, earOnSecond: true }, maxChannels: 2 })
    fireEvent.click(modeRadio('Tudo junto'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'stereo', earOnSecond: true, multi: { vsPair: 0, click: 2, guide: 3 } })
    onChange.mockClear()
    fireEvent.click(modeRadio('Click e Guia separados'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('seletores de 4 ou mais gravam número e tiram Click e Guia do par novo da VS', () => {
    const { onChange } = renderOutputs({ outputs: MULTI, maxChannels: 8 })
    fireEvent.change(select('Click'), { target: { value: '5' } })
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 5, guide: 3 } })
    fireEvent.change(select('Guia'), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 2 } })
    // VS pra 3 e 4, onde estavam Click e Guia: eles saem do par da VS (nunca na PA).
    fireEvent.change(select('VS estéreo'), { target: { value: '2' } })
    const next = onChange.mock.lastCall![0]
    expect(next.multi.vsPair).toBe(2)
    for (const o of [next.multi.click, next.multi.guide]) {
      expect(typeof o).toBe('number')
      expect([2, 3]).not.toContain(o)
    }
  })

  it('resumo e aviso de queda em português', () => {
    const base = renderOutputs({ outputs: STEREO, maxChannels: 2 })
    expect(base.container.textContent).toContain('Tudo junto nas saídas 1 e 2')
    expect(alerts(base.container)).toEqual([])
    cleanup()

    const split = renderOutputs({ outputs: SPLIT, maxChannels: 2 })
    expect(split.container.textContent).toContain('Click e Guia na saída 1 · VS na saída 2')
    expect(alerts(split.container)).toEqual([])
    cleanup()

    const multi = renderOutputs({ outputs: MULTI, maxChannels: 8 })
    expect(multi.container.textContent).toContain('VS nas saídas 1 e 2 · Click na 3 · Guia na 4')
    expect(alerts(multi.container)).toEqual([])
    cleanup()

    // Queda (Ruling T6-2): 4 ou mais gravado, aparelho de 2 canais.
    const queda = renderOutputs({ outputs: MULTI, maxChannels: 2 })
    expect(queda.container.textContent).toContain('Click e Guia na saída 1 · VS na saída 2')
    expect(alerts(queda.container)).toEqual(['Esta placa tem só 2 canais. Usando Click e Guia na saída 1 e a VS na saída 2.'])
    const aviso = queda.container.querySelector('[data-output-alert]')!
    expect(aviso.className).toContain('text-ps-alert')
    expect(aviso.className).toContain('bg-ps-alert-soft')
    // O aviso âmbar já diz quantos canais: a nota da opção desligada não repete.
    expect(queda.container.textContent).not.toContain('Esta saída tem')
    expect(modeRadio('4 ou mais saídas').getAttribute('aria-checked')).toBe('true')
    cleanup()

    // Com o lado trocado a queda segue o lado escolhido.
    const quedaTrocada = renderOutputs({ outputs: { ...MULTI, earOnSecond: true }, maxChannels: 2 })
    expect(alerts(quedaTrocada.container)).toEqual(['Esta placa tem só 2 canais. Usando Click e Guia na saída 2 e a VS na saída 1.'])
    cleanup()

    // 3 canais com a VS em 1 e 2: continua 4 ou mais (Click e Guia na 3), com o aviso do plano.
    const tres = renderOutputs({ outputs: MULTI, maxChannels: 3 })
    expect(tres.container.textContent).toContain('VS nas saídas 1 e 2 · Click e Guia na 3')
    expect(alerts(tres.container)).toEqual([OUTPUT_WARNING_TEXT['poucos-canais']])
    cleanup()

    // Mapa de uma placa maior numa de 4 canais: ajustado, com aviso.
    const grande: OutputSettings = { mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 6, guide: 7 } }
    const ajustado = renderOutputs({ outputs: grande, maxChannels: 4 })
    expect(alerts(ajustado.container)).toEqual([OUTPUT_WARNING_TEXT['mapa-ajustado']])
    expect(ajustado.container.textContent).toContain('VS nas saídas 1 e 2 · Click na 3 · Guia na 4')
    cleanup()

    // Avisos da leitura do que estava gravado (migração da T25), sem repetir o do plano.
    const lidos = renderOutputs({ outputs: grande, maxChannels: 4, loadWarnings: ['lado-assumido', 'mapa-ajustado'] })
    expect(alerts(lidos.container)).toEqual([OUTPUT_WARNING_TEXT['mapa-ajustado'], OUTPUT_WARNING_TEXT['lado-assumido']])
    cleanup()

    // Navegador que não troca a saída.
    const semEscolha = renderOutputs({ supportsDevicePick: false })
    expect(semEscolha.container.textContent).toContain('Neste navegador o som sai pela saída do sistema.')
    cleanup()
    const comEscolha = renderOutputs({ supportsDevicePick: true })
    expect(comEscolha.container.textContent).not.toContain('Neste navegador')
  })

  it('alvos de 44 px e sem largura fixa nos botões', () => {
    const { container } = renderOutputs({ outputs: SPLIT, maxChannels: 8 })
    const radios = container.querySelectorAll('[role="radio"]')
    expect(radios.length).toBe(5)
    for (const r of radios) {
      expect(r.className).toContain('min-h-ps-touch')
      expect(r.className).not.toMatch(FIXED_WIDTH)
    }
  })
})

describe('StageVersionSetting', () => {
  it('chave do palco alterna Novo e Antigo', () => {
    const onChange = vi.fn<(v: 'novo' | 'antigo') => void>()
    const { container, rerender } = render(<StageVersionSetting value="novo" onChange={onChange} />)
    const group = screen.getByRole('radiogroup', { name: 'Palco' })
    const novo = within(group).getByRole('radio', { name: 'Novo' })
    const antigo = within(group).getByRole('radio', { name: 'Antigo' })
    expect(novo.getAttribute('aria-checked')).toBe('true')
    expect(antigo.getAttribute('aria-checked')).toBe('false')
    for (const r of [novo, antigo]) expect(r.className).toContain('min-h-ps-touch')
    expect(container.textContent).toContain(
      'Se o palco novo der problema no culto, volte pro antigo aqui. Vale na próxima vez que a música parar. O repertório e o som não mudam.',
    )
    fireEvent.click(antigo)
    expect(onChange).toHaveBeenLastCalledWith('antigo')

    rerender(<StageVersionSetting value="antigo" onChange={onChange} />)
    expect(within(screen.getByRole('radiogroup', { name: 'Palco' })).getByRole('radio', { name: 'Antigo' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Palco' })).getByRole('radio', { name: 'Novo' }))
    expect(onChange).toHaveBeenLastCalledWith('novo')
    // Tocar no que já vale não grava nada.
    onChange.mockClear()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Palco' })).getByRole('radio', { name: 'Antigo' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('textos', () => {
  it('sem travessão', () => {
    const estados: Opts[] = [
      { outputs: STEREO, maxChannels: 2, supportsDevicePick: false },
      { outputs: SPLIT, maxChannels: 1 },
      { outputs: { ...SPLIT, earOnSecond: true }, maxChannels: 8 },
      { outputs: MULTI, maxChannels: 8 },
      { outputs: MULTI, maxChannels: 2 },
      { outputs: MULTI, maxChannels: 3 },
      { outputs: { mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 6, guide: 7 } }, maxChannels: 4, loadWarnings: ['modo-assumido', 'lado-assumido', 'mapa-ajustado', 'sem-saida-ouvido', 'poucos-canais'] },
    ]
    const roots: HTMLElement[] = []
    for (const e of estados) roots.push(renderOutputs(e).container)
    roots.push(render(<StageVersionSetting value="novo" onChange={() => {}} />).container)
    roots.push(render(<StageVersionSetting value="antigo" onChange={() => {}} />).container)
    for (const root of roots) {
      const t = root.textContent!
      expect(t.length).toBeGreaterThan(0)
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(PROIBIDAS)
      for (const el of root.querySelectorAll('[aria-label],[title]')) {
        for (const attr of ['aria-label', 'title']) {
          const v = el.getAttribute(attr) ?? ''
          expect(v).not.toContain(TRAVESSAO)
          expect(v).not.toMatch(PROIBIDAS)
        }
      }
    }
  })
})
