// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { TWO_TAP_MIN_GAP_MS, TWO_TAP_WINDOW_MS } from '../../hooks/useTwoTapConfirm'
import { SECTION_SHORTCUTS } from '../../lib/sectionTypes'
import { sanitizeGrid, withMeter } from '../../lib/songGrid'
import { TIME_SIGNATURES } from '../../lib/stageContracts'
import type { MeterSource, SongGrid, StageSection, TimeSignature } from '../../lib/stageContracts'
import { MeterEditor } from './MeterEditor'
import type { MeterEditorProps } from './MeterEditor'
import { SectionEditBar } from './SectionEditBar'
import type { SectionEditBarProps } from './SectionEditBar'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Alvo de pelo menos 44 px e largura pelo texto: piso de 44 (ou maior) sem largura fixa. */
const expectTouch = (el: Element) => {
  const classes = el.className.split(/\s+/)
  expect(classes, el.outerHTML).toContain('min-h-ps-touch')
  const minW = classes.find((c) => c === 'min-w-ps-touch' || /^min-w-\[\d+px\]$/.test(c))
  expect(minW, el.outerHTML).toBeDefined()
  if (minW !== 'min-w-ps-touch') expect(Number(minW?.match(/\d+/)?.[0])).toBeGreaterThanOrEqual(44)
  expect(classes.some((c) => /^w-\d|^w-\[/.test(c)), el.outerHTML).toBe(false)
}
/** Texto visível, nomes acessíveis e dicas: tudo em português e sem travessão. */
const expectPortuguese = (root: HTMLElement) => {
  expect(root.textContent).not.toContain(TRAVESSAO)
  expect(root.textContent).not.toMatch(PROIBIDAS)
  for (const el of root.querySelectorAll('[aria-label],[title]')) {
    for (const attr of ['aria-label', 'title']) {
      const v = el.getAttribute(attr) ?? ''
      expect(v).not.toContain(TRAVESSAO)
      expect(v).not.toMatch(PROIBIDAS)
    }
  }
}

// ---------- Barra de edição das seções ----------

const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 8, end: 22, bars: 7 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 22, end: 38, bars: 8 },
]

const renderBar = (over: Partial<SectionEditBarProps> = {}) => {
  const props: SectionEditBarProps = {
    sections: SECTIONS, selected: null, hasGrid: true,
    onSelect: vi.fn(), onMark: vi.fn(), onNudge: vi.fn(), onRemove: vi.fn(), ...over,
  }
  const r = render(<SectionEditBar {...props} />)
  return { ...r, props, rerenderWith: (more: Partial<SectionEditBarProps>) => r.rerender(<SectionEditBar {...props} {...more} />) }
}

describe('SectionEditBar', () => {
  it('MARCAR cria pelo tipo e mostra a tecla', () => {
    const { props } = renderBar()
    const marcar = screen.getByRole('group', { name: 'Marcar seção' })
    expect(marcar.textContent).toContain('MARCAR')
    const botoes = within(marcar).getAllByRole('button')
    expect(botoes).toHaveLength(6)
    SECTION_SHORTCUTS.forEach(({ name, key, color }, i) => {
      const b = botoes[i]
      expect(b.getAttribute('aria-label')).toBe(`Marcar ${name}`)
      expect(b.getAttribute('aria-keyshortcuts')).toBe(key)
      expect(b.querySelector('[data-section-name]')?.textContent).toBe(name)
      expect(b.querySelector('kbd')?.textContent).toBe(key)
      expect(b.style.getPropertyValue('--ps-c')).toBe(color)
      expect(b.getAttribute('title')).toContain(`tecla ${key}`)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Refrão' }))
    expect(props.onMark).toHaveBeenCalledTimes(1)
    expect(props.onMark).toHaveBeenCalledWith('Refrão')
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Ponte' }))
    expect(props.onMark).toHaveBeenLastCalledWith('Ponte')
  })

  it('toque seleciona e a selecionada ganha o ajuste de 1 compasso', () => {
    const { props, rerenderWith } = renderBar()
    const lista = screen.getByRole('group', { name: 'Seções da música' })
    expect(within(lista).getAllByRole('button').map((b) => b.textContent)).toEqual(['Intro', 'Verso', 'Refrão'])
    expect(screen.getByText('Toque numa seção pra ajustar')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Mover / })).toBeNull()

    fireEvent.click(within(lista).getByRole('button', { name: 'Verso' }))
    expect(props.onSelect).toHaveBeenCalledWith(1)

    rerenderWith({ selected: 1 })
    expect(within(lista).getByRole('button', { name: 'Verso' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(lista).getByRole('button', { name: 'Intro' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('Toque numa seção pra ajustar')).toBeNull()
    const tras = screen.getByRole('button', { name: 'Mover Verso 1 compasso pra trás' })
    const frente = screen.getByRole('button', { name: 'Mover Verso 1 compasso pra frente' })
    expect(tras.textContent).toBe('1 comp.')
    expect(frente.textContent).toBe('1 comp.')
    // Seta desenhada em SVG antes (◂) e depois (▸) do texto, nunca um caractere.
    expect(tras.firstElementChild?.querySelector('svg')).toBeTruthy()
    expect(frente.lastElementChild?.querySelector('svg')).toBeTruthy()
    fireEvent.click(tras)
    expect(props.onNudge).toHaveBeenLastCalledWith(1, -1)
    fireEvent.click(frente)
    expect(props.onNudge).toHaveBeenLastCalledWith(1, 1)
  })

  it('sem grade o ajuste é de 1 s', () => {
    renderBar({ selected: 2, hasGrid: false })
    const tras = screen.getByRole('button', { name: 'Mover Refrão 1 segundo pra trás' })
    expect(tras.textContent).toBe('1 s')
    expect(screen.getByRole('button', { name: 'Mover Refrão 1 segundo pra frente' }).textContent).toBe('1 s')
    expect(screen.queryByText('1 comp.')).toBeNull()
  })

  it('remover pede o segundo toque', () => {
    const { props, rerenderWith } = renderBar({ selected: 1 })
    const lixeira = () => screen.getByRole('button', { name: /apagar a seção Verso/i })
    expect(lixeira().getAttribute('aria-label')).toBe('Apagar a seção Verso')
    expect(lixeira().textContent).not.toContain('Apagar?')

    fireEvent.click(lixeira())
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(lixeira().getAttribute('aria-label')).toBe('Toque de novo para apagar a seção Verso')
    expect(lixeira().textContent).toContain('Apagar?')
    expect(lixeira().className).toContain('bg-ps-alert')

    // Segundo toque colado no primeiro (duplo clique) não conta.
    fireEvent.click(lixeira())
    expect(props.onRemove).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(TWO_TAP_MIN_GAP_MS) })
    fireEvent.click(lixeira())
    expect(props.onRemove).toHaveBeenCalledTimes(1)
    expect(props.onRemove).toHaveBeenCalledWith(1)
    expect(lixeira().getAttribute('aria-label')).toBe('Apagar a seção Verso')

    // Desarma sozinha no fim da janela e ao trocar a seleção.
    fireEvent.click(lixeira())
    act(() => { vi.advanceTimersByTime(TWO_TAP_WINDOW_MS) })
    expect(lixeira().getAttribute('aria-label')).toBe('Apagar a seção Verso')
    fireEvent.click(lixeira())
    rerenderWith({ selected: 2 })
    expect(screen.getByRole('button', { name: /apagar a seção Refrão/i }).getAttribute('aria-label')).toBe('Apagar a seção Refrão')
    expect(props.onRemove).toHaveBeenCalledTimes(1)
  })

  it('seção na cor dela e nome antigo longo nunca cortado', () => {
    const longo = 'Ministração da Palavra de Deus'
    renderBar({ sections: [...SECTIONS, { index: 3, label: longo, color: '#123456', start: 38, end: 60, bars: null }], selected: 3 })
    const chip = screen.getByRole('button', { name: longo })
    expect(chip.textContent).toBe(longo)
    expect(chip.style.getPropertyValue('--ps-c')).toBe('#123456')
    const nome = chip.querySelector('[data-section-name]') as HTMLElement
    expect(nome.className).toContain('break-words')
    expect(chip.className).not.toMatch(/truncate|text-ellipsis|line-clamp/)
    expect(screen.getByRole('button', { name: `Mover ${longo} 1 compasso pra trás` })).toBeTruthy()
  })

  it('sem seções ou seleção que sumiu: só a dica, sem ajuste', () => {
    const { rerenderWith } = renderBar({ sections: [] })
    expect(screen.getByText('Marque a primeira seção no ponto que está tocando.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Mover / })).toBeNull()
    rerenderWith({ sections: SECTIONS, selected: 7 })
    expect(screen.getByText('Toque numa seção pra ajustar')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /apagar a seção/i })).toBeNull()
  })

  it('alvos de 44 px, largura pelo texto e tudo em português', () => {
    const { container } = renderBar({ selected: 0 })
    for (const b of container.querySelectorAll('button')) expectTouch(b)
    expectPortuguese(container)
    fireEvent.click(screen.getByRole('button', { name: /apagar a seção Intro/i }))
    expectPortuguese(container)
  })
})

// ---------- Compasso ----------

const GRID: SongGrid = { bpm: 120, firstDownbeat: 0.25, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
// "Fé" em 6/8: a grade conta colcheias (156) e a música mostra 78.
const FE: SongGrid = { bpm: 156, firstDownbeat: 0.1, signature: '6/8', countEvery: 3, source: 'click', meterSource: 'salvo' }

const renderMeter = (over: Partial<MeterEditorProps> = {}) => {
  const props: MeterEditorProps = {
    grid: GRID, songBpm: 120, busy: false, onChange: vi.fn(), onRedetect: vi.fn(), onClose: vi.fn(), ...over,
  }
  const r = render(<MeterEditor {...props} />)
  return { ...r, props, rerenderWith: (more: Partial<MeterEditorProps>) => r.rerender(<MeterEditor {...props} {...more} />) }
}
const radios = (group: string) => within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio')
const checked = (group: string) => radios(group).find((r) => r.getAttribute('aria-checked') === 'true')?.textContent ?? null

describe('MeterEditor', () => {
  it('é um diálogo com os compassos na ordem do contrato', () => {
    renderMeter()
    expect(screen.getByRole('dialog', { name: 'Compasso da música' })).toBeTruthy()
    expect(radios('Compasso').map((r) => r.textContent)).toEqual([...TIME_SIGNATURES])
    expect(checked('Compasso')).toBe('4/4')
  })

  it('compasso composto oferece contar 6 ou 2', () => {
    const { props, rerenderWith } = renderMeter({ grid: FE })
    expect(radios('Contagem').map((r) => r.textContent)).toEqual(['Contar 6', 'Contar 2'])
    expect(checked('Contagem')).toBe('Contar 2')
    fireEvent.click(screen.getByRole('radio', { name: 'Contar 6' }))
    expect(props.onChange).toHaveBeenLastCalledWith('6/8', 1)

    rerenderWith({ grid: { ...FE, signature: '12/8', countEvery: 1 } })
    expect(radios('Contagem').map((r) => r.textContent)).toEqual(['Contar 12', 'Contar 4'])
    expect(checked('Contagem')).toBe('Contar 12')
    fireEvent.click(screen.getByRole('radio', { name: 'Contar 4' }))
    expect(props.onChange).toHaveBeenLastCalledWith('12/8', 3)

    // Compasso simples conta todos os pulsos: não há escolha.
    rerenderWith({ grid: GRID })
    expect(screen.queryByRole('radiogroup', { name: 'Contagem' })).toBeNull()
  })

  it('trocar o compasso entrega o que o sanitizeGrid aceita e devolve igual', () => {
    for (const from of [GRID, FE, { ...FE, countEvery: 1 } as SongGrid, null]) {
      cleanup()
      const { props } = renderMeter({ grid: from })
      for (const sig of TIME_SIGNATURES) {
        fireEvent.click(screen.getByRole('radio', { name: sig }))
        const [gotSig, every] = (props.onChange as ReturnType<typeof vi.fn>).mock.lastCall as [TimeSignature, 1 | 3]
        expect(gotSig).toBe(sig)
        const compound = sig === '6/8' || sig === '12/8'
        // Simples conta tudo; composto mantém a contagem de quem já era composto, senão de 3 em 3 (como a leitura do click).
        const expected = !compound ? 1 : from && (from.signature === '6/8' || from.signature === '12/8') ? from.countEvery : 3
        expect(every, `${from?.signature} -> ${sig}`).toBe(expected)
        if (from) {
          const next = withMeter(from, gotSig, every)
          expect(sanitizeGrid(next)).toEqual(next)
        }
      }
    }
  })

  it('trocar simples por composto não muda o BPM que a pessoa vê', () => {
    const { rerenderWith } = renderMeter({ grid: GRID })
    const bpm = () => screen.getByText((_, el) => el?.hasAttribute('data-bpm-value') ?? false).textContent
    expect(bpm()).toBe('120.00')
    rerenderWith({ grid: withMeter(GRID, '6/8', 3) })
    expect(bpm()).toBe('120.00')
    rerenderWith({ grid: withMeter(withMeter(GRID, '6/8', 3), '7/8', 1) })
    expect(bpm()).toBe('120.00')
    rerenderWith({ grid: FE })
    expect(bpm()).toBe('78.00')
    rerenderWith({ grid: { ...GRID, bpm: 72.5 } })
    expect(bpm()).toBe('72.50')
  })

  it('origem do compasso em português e botão ocupado lendo o click', () => {
    const origens: [MeterSource, string][] = [
      ['acento', 'Lido no acento do click'], ['salvo', 'Salvo na biblioteca'],
      ['padrao', 'Assumido 4/4'], ['manual', 'Escolhido por você'],
    ]
    const { props, rerenderWith } = renderMeter()
    const origem = (attr: string) => document.querySelector(`[${attr}]`)?.textContent
    for (const [meterSource, texto] of origens) {
      rerenderWith({ grid: { ...GRID, meterSource } })
      expect(origem('data-meter-origin')).toBe(texto)
    }
    expect(origem('data-bpm-origin')).toBe('Lido no click')
    rerenderWith({ grid: { ...GRID, source: 'bpm', meterSource: 'padrao' } })
    expect(origem('data-bpm-origin')).toBe('BPM salvo da música, sem o 1 do compasso')
    rerenderWith({ grid: { ...FE, meterSource: 'padrao' } })
    expect(origem('data-meter-origin')).toBe('Assumido 6/8')

    const ler = screen.getByRole('button', { name: 'Ler o click de novo' })
    expect((ler as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(ler)
    expect(props.onRedetect).toHaveBeenCalledTimes(1)
    rerenderWith({ busy: true })
    const ocupado = screen.getByRole('button', { name: 'Lendo o click...' })
    expect((ocupado as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(ocupado)
    expect(props.onRedetect).toHaveBeenCalledTimes(1)
  })

  it('sem grade: nada escolhido e o BPM salvo, se houver', () => {
    const { rerenderWith } = renderMeter({ grid: null, songBpm: null })
    expect(checked('Compasso')).toBeNull()
    expect(document.querySelector('[data-bpm-value]')?.textContent).toBe('BPM não informado')
    expect(document.querySelector('[data-bpm-origin]')).toBeNull()
    expect(document.querySelector('[data-meter-origin]')?.textContent).toBe('Sem compasso lido')
    rerenderWith({ songBpm: 72.5 })
    expect(document.querySelector('[data-bpm-value]')?.textContent).toBe('72.50')
    expect(document.querySelector('[data-bpm-origin]')?.textContent).toBe('BPM salvo da música, sem o 1 do compasso')
  })

  it('Esc fecha o compasso e marca o evento como tratado; o X também fecha', () => {
    const { props } = renderMeter()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    const ev = createEvent.keyDown(document, { key: 'Escape' })
    fireEvent(document, ev)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    // Já tratado por outro painel: não fecha de novo.
    const tratado = createEvent.keyDown(document, { key: 'Escape' })
    tratado.preventDefault()
    fireEvent(document, tratado)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    // Outra tecla não fecha.
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar compasso' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('fechar devolve o foco pra quem abriu', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = renderMeter()
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('alvos de 44 px, largura pelo texto e tudo em português', () => {
    for (const over of [{}, { grid: FE }, { busy: true }, { grid: null, songBpm: null }] as Partial<MeterEditorProps>[]) {
      cleanup()
      const { container } = renderMeter(over)
      for (const b of container.querySelectorAll('button')) expectTouch(b)
      expectPortuguese(container)
    }
  })
})
