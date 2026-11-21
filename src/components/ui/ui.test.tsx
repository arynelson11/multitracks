// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button, Chip, Led, Panel, Segmented } from './index'

afterEach(cleanup)
const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$))/

describe('Button', () => {
  it('largura acompanha o texto: sem w- fixo, com padding e alvo de 44px', () => {
    render(<Button>Salvar</Button>)
    const b = screen.getByRole('button', { name: 'Salvar' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).not.toMatch(FIXED_WIDTH)
    for (const c of ['px-ps-pad-x', 'min-h-ps-touch', 'min-w-ps-touch', 'whitespace-nowrap']) expect(b.className).toContain(c)
  })
  it('código de cores: on laranja, armed branco, alert âmbar', () => {
    render(<><Button tone="on">A</Button><Button tone="armed">B</Button><Button tone="alert">C</Button></>)
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('text-ps-or')
    expect(screen.getByRole('button', { name: 'B' }).className).toContain('inset-ring-ps-arm')
    expect(screen.getByRole('button', { name: 'C' }).className).toContain('text-ps-alert')
  })
  it('pressed vira aria-pressed; clique dispara; disabled não dispara', () => {
    const onClick = vi.fn()
    render(<><Button pressed onClick={onClick}>Loop</Button><Button disabled onClick={onClick}>Off</Button></>)
    const loop = screen.getByRole('button', { name: 'Loop' })
    expect(loop.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(loop)
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('só ícone exige aria-label e o ícone fica escondido do leitor de tela', () => {
    render(<Button icon={<svg data-testid="i" />} aria-label="Editar canal" />)
    expect(screen.getByRole('button', { name: 'Editar canal' })).toBeTruthy()
    expect(screen.getByTestId('i').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Chip', () => {
  it('alvo de 44px, números tabulares, on laranja', () => {
    render(<Chip on>+1</Chip>)
    const c = screen.getByRole('button', { name: '+1' })
    expect(c.className).not.toMatch(FIXED_WIDTH)
    for (const k of ['min-h-ps-touch', 'tabular-nums', 'text-ps-or']) expect(c.className).toContain(k)
  })
})

describe('Segmented', () => {
  const opts = [{ value: 'click', label: 'Click' }, { value: 'guide', label: 'Guia' }, { value: 'normal', label: 'Normal' }] as const
  it('radiogroup com rótulo, opção atual marcada e sem largura fixa', () => {
    render(<Segmented aria-label="Papel do canal" options={[...opts]} value="guide" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Papel do canal' })).toBeTruthy()
    const guia = screen.getByRole('radio', { name: 'Guia' })
    expect(guia.getAttribute('aria-checked')).toBe('true')
    expect(guia.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'Click' }).tabIndex).toBe(-1)
    expect(guia.className).not.toMatch(FIXED_WIDTH)
    expect(guia.className).toContain('min-w-[62px]')
  })
  it('opção com selo e dica: o selo vai depois do rótulo, pequeno e neutro, e a dica no title', () => {
    render(<Segmented aria-label="Fim" options={[{ value: 'a', label: 'AUTO', badge: 'LIVRE', title: 'Dica' }, { value: 'b', label: 'PARAR' }]} value="b" onChange={() => {}} />)
    const a = screen.getByRole('radio', { name: 'AUTO LIVRE' })
    expect(a.getAttribute('title')).toBe('Dica')
    const badge = a.querySelector('[data-segmented-badge]') as HTMLElement
    expect(badge.textContent).toBe('LIVRE')
    expect(badge.className).toContain('text-ps-micro')
    expect(screen.getByRole('radio', { name: 'PARAR' }).querySelector('[data-segmented-badge]')).toBeNull()
  })
  it('clique e setas chamam onChange (com volta), Home e End', () => {
    const onChange = vi.fn()
    render(<Segmented aria-label="Papel" options={[...opts]} value="normal" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Click' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'End' })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['click', 'click', 'click', 'normal'])
  })
})

describe('Panel e Led', () => {
  it('Panel pop usa a superfície pop com sombra', () => {
    render(<Panel variant="pop" data-testid="p" />)
    const p = screen.getByTestId('p')
    for (const k of ['bg-ps-pop', 'shadow-ps-pop', 'inset-ring-ps-line-2']) expect(p.className).toContain(k)
  })
  it('Led: decorativo sem label; com label vira img; live pisca e respeita movimento reduzido', () => {
    const { container } = render(<><Led state="on" /><Led state="live" label="Ao vivo" /></>)
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain('bg-ps-or')
    const live = screen.getByRole('img', { name: 'Ao vivo' })
    expect(live.className).toContain('animate-ps-blink')
    expect(live.className).toContain('motion-reduce:animate-none')
  })
})

// No Tailwind vence a utilidade que vem depois no CSS gerado, não na className.
// Por isso a variação substitui a classe da base em vez de somar uma oposta.
// A comparação é por classe inteira: 'inset-ring-ps-line' não pode casar com 'inset-ring-ps-line-2'.
const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean)

describe('variação substitui a base (sem par de utilidades conflitantes)', () => {
  it('Chip ligado não leva o fundo, o texto nem o anel cinza da base', () => {
    render(<><Chip>Desligado</Chip><Chip on>Ligado</Chip></>)
    const off = classes(screen.getByRole('button', { name: 'Desligado' }))
    const on = classes(screen.getByRole('button', { name: 'Ligado' }))
    for (const k of ['bg-ps-s2', 'text-ps-bone', 'inset-ring-ps-line']) expect(off).toContain(k)
    for (const k of ['bg-ps-or-soft', 'text-ps-or', 'inset-ring-ps-or-line']) expect(on).toContain(k)
    for (const k of ['bg-ps-s2', 'text-ps-bone', 'inset-ring-ps-line', 'hover:inset-ring-ps-line-2']) expect(on).not.toContain(k)
  })
  it('Chip small troca o tamanho e o peso da fonte em vez de somar', () => {
    render(<Chip small>BPM</Chip>)
    const c = classes(screen.getByRole('button', { name: 'BPM' }))
    for (const k of ['text-ps-sm', 'font-extrabold']) expect(c).toContain(k)
    for (const k of ['text-ps-base', 'font-bold']) expect(c).not.toContain(k)
  })
  it('opção selecionada do Segmented não leva o texto apagado da base', () => {
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    render(<Segmented aria-label="Teste" options={opts} value="a" onChange={() => {}} />)
    const sel = classes(screen.getByRole('radio', { name: 'A' }))
    const other = classes(screen.getByRole('radio', { name: 'B' }))
    for (const k of ['bg-ps-s3', 'text-ps-bone', 'inset-ring-ps-line-2']) expect(sel).toContain(k)
    for (const k of ['text-ps-mut', 'hover:text-ps-bone']) expect(sel).not.toContain(k)
    for (const k of ['text-ps-mut', 'hover:text-ps-bone']) expect(other).toContain(k)
    expect(other).not.toContain('text-ps-bone')
  })
  it('Button lg troca a altura mínima de 44px pela de 56px', () => {
    render(<><Button>Médio</Button><Button size="lg">Grande</Button></>)
    const md = classes(screen.getByRole('button', { name: 'Médio' }))
    const lg = classes(screen.getByRole('button', { name: 'Grande' }))
    expect(md).toContain('min-h-ps-touch')
    expect(md).not.toContain('min-h-14')
    expect(lg).toContain('min-h-14')
    expect(lg).not.toContain('min-h-ps-touch')
  })
  it('Panel pop troca o raio em vez de somar o da base', () => {
    render(<><Panel data-testid="flat" /><Panel variant="pop" data-testid="pop" /></>)
    expect(classes(screen.getByTestId('flat'))).toContain('rounded-ps-2xl')
    const pop = classes(screen.getByTestId('pop'))
    expect(pop).toContain('rounded-ps-xl')
    expect(pop).not.toContain('rounded-ps-2xl')
  })
})

describe('texto nunca vaza da peça', () => {
  it('Button, Chip e opção do Segmented não encolhem abaixo do texto numa linha flex apertada', () => {
    // min-w-ps-touch troca o piso automático (min-width: auto) do item flex; sem shrink-0 o texto nowrap vaza.
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    render(<><Button>Salvar alterações</Button><Chip>+1</Chip><Segmented aria-label="Teste" options={opts} value="a" onChange={() => {}} /></>)
    expect(classes(screen.getByRole('button', { name: 'Salvar alterações' }))).toContain('shrink-0')
    expect(classes(screen.getByRole('button', { name: '+1' }))).toContain('shrink-0')
    for (const r of screen.getAllByRole('radio')) expect(classes(r)).toContain('shrink-0')
  })
})
