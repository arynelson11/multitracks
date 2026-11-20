// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button, Chip, Led, Notice, Panel, Segmented, Select, Switch, TabPanel, Tabs, TextArea, TextField } from './index'

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

// ---------------------------------------------------------------------------------------------
// Peças novas da Parte 3 (faixa B): campo de texto, área de texto, seletor, interruptor, abas e aviso.
// ---------------------------------------------------------------------------------------------

describe('TextField', () => {
  it('rótulo ligado ao campo, ajuda e erro no aria-describedby, aria-invalid só com erro', () => {
    render(<><TextField label="Email" help="A gente nunca mostra seu e-mail." placeholder="seu@email.com" /><TextField label="Senha" error="A senha precisa ter pelo menos 6 caracteres." /></>)
    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email.tagName).toBe('INPUT')
    expect(email.getAttribute('aria-invalid')).toBeNull()
    const help = screen.getByText('A gente nunca mostra seu e-mail.')
    expect(email.getAttribute('aria-describedby')).toBe(help.id)
    const senha = screen.getByLabelText('Senha')
    expect(senha.getAttribute('aria-invalid')).toBe('true')
    const err = screen.getByText('A senha precisa ter pelo menos 6 caracteres.')
    expect(senha.getAttribute('aria-describedby')!.split(' ')).toContain(err.id)
    expect(classes(err)).toContain('text-ps-alert')
  })
  it('caixa com alvo de 44 px e fonte de 16 px; o erro troca o anel cinza pelo âmbar', () => {
    render(<><TextField label="Nome" /><TextField label="Com erro" error="Errado." /></>)
    const ok = screen.getByLabelText('Nome')
    const bad = screen.getByLabelText('Com erro')
    expect(classes(ok)).toContain('text-ps-md')
    const okBox = classes(ok.parentElement!)
    const badBox = classes(bad.parentElement!)
    expect(okBox).toContain('min-h-ps-touch')
    expect(okBox).toContain('inset-ring-ps-line')
    expect(okBox).not.toContain('inset-ring-ps-alert-line')
    expect(badBox).toContain('inset-ring-ps-alert-line')
    for (const k of ['inset-ring-ps-line', 'hover:inset-ring-ps-line-2']) expect(badBox).not.toContain(k)
    expect(okBox.join(' ')).not.toMatch(FIXED_WIDTH)
  })
  it('repassa os atributos do input, digitar chama onChange, ícone escondido e trailing visível', () => {
    const onChange = vi.fn()
    render(<TextField label="Senha" type="password" required minLength={6} value="" onChange={onChange} icon={<svg data-testid="ic" />} trailing="mín 6" />)
    const input = screen.getByLabelText('Senha') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.required).toBe(true)
    expect(input.minLength).toBe(6)
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('ic').parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('mín 6')).toBeTruthy()
  })
  it('hideLabel esconde o rótulo da vista e mantém o nome acessível; className vai no contêiner', () => {
    const { container } = render(<TextField label="Buscar" hideLabel className="flex-1" />)
    expect(screen.getByLabelText('Buscar')).toBeTruthy()
    expect(classes(container.querySelector('label')!)).toContain('sr-only')
    expect(classes(container.firstElementChild!)).toContain('flex-1')
  })
  it('desligado: caixa apagada e o campo não recebe digitação', () => {
    render(<TextField label="Travado" disabled />)
    const input = screen.getByLabelText('Travado') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(classes(input.parentElement!)).toContain('opacity-35')
  })
})

describe('TextArea e Select', () => {
  it('TextArea: rótulo, ajuda, erro, linhas e redimensionar na vertical', () => {
    render(<TextArea label="Letra" help="Uma linha por verso." error="Vazio." rows={6} />)
    const area = screen.getByLabelText('Letra') as HTMLTextAreaElement
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.rows).toBe(6)
    expect(area.getAttribute('aria-invalid')).toBe('true')
    const ids = area.getAttribute('aria-describedby')!.split(' ')
    expect(ids).toContain(screen.getByText('Uma linha por verso.').id)
    expect(ids).toContain(screen.getByText('Vazio.').id)
    expect(classes(area)).toContain('resize-y')
    expect(classes(area)).toContain('text-ps-md')
  })
  it('Select: rótulo ligado, opções como filhos, troca chama onChange com o valor, alvo de 44 px', () => {
    const onChange = vi.fn()
    render(
      <Select label="Saída" value="2" onChange={(e) => onChange(e.target.value)} help="Escolha o aparelho.">
        <option value="1">Saída 1</option>
        <option value="2">Saída 2</option>
      </Select>,
    )
    const sel = screen.getByRole('combobox', { name: 'Saída' }) as HTMLSelectElement
    expect(sel.value).toBe('2')
    fireEvent.change(sel, { target: { value: '1' } })
    expect(onChange).toHaveBeenCalledWith('1')
    expect(sel.getAttribute('aria-describedby')).toBe(screen.getByText('Escolha o aparelho.').id)
    expect(classes(sel.parentElement!)).toContain('min-h-ps-touch')
    expect(classes(sel)).toContain('appearance-none')
  })
})

describe('Switch', () => {
  it('role switch com nome e descrição; clique alterna; aria-checked segue o checked', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Switch label="Pan automático" description="Click e Guia no L." checked={false} onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Pan automático' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-describedby')).toBe(screen.getByText('Click e Guia no L.').id)
    expect(sw.getAttribute('type')).toBe('button')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenLastCalledWith(true)
    rerender(<Switch label="Pan automático" checked onChange={onChange} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
  it('alvo de 44 px, anel de foco laranja; ligado é laranja e desligado não', () => {
    const { rerender } = render(<Switch label="A" checked={false} onChange={() => {}} />)
    const off = screen.getByRole('switch')
    for (const k of ['min-h-ps-touch', 'min-w-ps-touch', 'focus-visible:outline-ps-or']) expect(classes(off)).toContain(k)
    const offTrack = classes(off.firstElementChild!)
    expect(offTrack).not.toContain('bg-ps-or-soft')
    rerender(<Switch label="A" checked onChange={() => {}} />)
    const onTrack = classes(screen.getByRole('switch').firstElementChild!)
    expect(onTrack).toContain('bg-ps-or-soft')
    expect(onTrack).toContain('inset-ring-ps-or-line')
    for (const k of offTrack.filter((c) => c.startsWith('bg-') || c.startsWith('inset-ring-ps'))) expect(onTrack).not.toContain(k)
  })
  it('desligado não chama onChange e fica apagado; hideLabel mantém o nome', () => {
    const onChange = vi.fn()
    const { container } = render(<Switch label="Grade" checked disabled hideLabel onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Grade' }) as HTMLButtonElement
    expect(sw.disabled).toBe(true)
    fireEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
    expect(classes(container.firstElementChild!)).toContain('opacity-35')
  })
})

describe('Tabs e TabPanel', () => {
  const tabs = [{ value: 'perfil', label: 'Perfil' }, { value: 'geral', label: 'Geral' }, { value: 'buses', label: 'Buses', disabled: true }, { value: 'sobre', label: 'Sobre' }]
  it('tablist com nome, aba atual marcada e só ela no Tab; painel ligado à aba', () => {
    render(<><Tabs id="cfg" aria-label="Abas" tabs={tabs} value="geral" onChange={() => {}} /><TabPanel tabsId="cfg" value="geral">conteúdo</TabPanel></>)
    expect(screen.getByRole('tablist', { name: 'Abas' })).toBeTruthy()
    const geral = screen.getByRole('tab', { name: 'Geral' })
    expect(geral.getAttribute('aria-selected')).toBe('true')
    expect(geral.tabIndex).toBe(0)
    expect(screen.getByRole('tab', { name: 'Perfil' }).tabIndex).toBe(-1)
    const panel = screen.getByRole('tabpanel', { name: 'Geral' })
    expect(geral.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(geral.id)
  })
  it('clique troca; clique na atual não chama; setas com volta pulam a desligada; Home e End', () => {
    const onChange = vi.fn()
    render(<Tabs id="cfg" aria-label="Abas" tabs={tabs} value="geral" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Geral' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Perfil' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Geral' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Perfil' }), { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Geral' }), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Geral' }), { key: 'End' })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['perfil', 'sobre', 'sobre', 'perfil', 'sobre'])
    expect((screen.getByRole('tab', { name: 'Buses' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('abas descem de linha sem encolher abaixo do texto; atual laranja sem o texto apagado da base', () => {
    render(<Tabs id="cfg" aria-label="Abas" tabs={tabs} value="geral" onChange={() => {}} />)
    expect(classes(screen.getByRole('tablist'))).toContain('flex-wrap')
    const on = classes(screen.getByRole('tab', { name: 'Geral' }))
    const idle = classes(screen.getByRole('tab', { name: 'Perfil' }))
    for (const k of ['shrink-0', 'whitespace-nowrap', 'min-h-ps-touch']) expect(on).toContain(k)
    for (const k of ['bg-ps-or-soft', 'text-ps-or', 'inset-ring-ps-or-line']) expect(on).toContain(k)
    for (const k of ['text-ps-mut', 'hover:text-ps-bone']) expect(on).not.toContain(k)
    expect(idle).toContain('text-ps-mut')
    expect(idle).not.toContain('text-ps-or')
    expect(on.join(' ')).not.toMatch(FIXED_WIDTH)
    expect(classes(screen.getByRole('tab', { name: 'Buses' }))).toContain('opacity-35')
  })
})

describe('Notice', () => {
  it('info neutro e alert âmbar, sem par de utilidades conflitantes; repassa role', () => {
    render(<><Notice role="status">Cadastro feito.</Notice><Notice tone="alert" role="alert">Senha errada.</Notice></>)
    const info = classes(screen.getByRole('status'))
    const alert = classes(screen.getByRole('alert'))
    for (const k of ['bg-ps-s2', 'text-ps-bone', 'inset-ring-ps-line']) expect(info).toContain(k)
    for (const k of ['bg-ps-alert-soft', 'text-ps-alert', 'inset-ring-ps-alert-line']) expect(alert).toContain(k)
    for (const k of ['bg-ps-s2', 'text-ps-bone', 'inset-ring-ps-line']) expect(alert).not.toContain(k)
  })
})

describe('limites conhecidos resolvidos (Parte 3)', () => {
  it('Chip tem o anel de foco laranja e visual de desligado', () => {
    render(<Chip disabled>Trava</Chip>)
    const c = classes(screen.getByRole('button', { name: 'Trava' }))
    for (const k of ['focus-visible:outline-ps-or', 'disabled:opacity-35']) expect(c).toContain(k)
  })
  it('Segmented: opção desligada fica apagada, a marcada desligada não, e as opções têm anel de foco', () => {
    const opts = [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }]
    render(<Segmented aria-label="Teste" options={opts} value="a" onChange={() => {}} />)
    expect(classes(screen.getByRole('radio', { name: 'B' }))).toContain('opacity-35')
    expect(classes(screen.getByRole('radio', { name: 'A' }))).not.toContain('opacity-35')
    expect(classes(screen.getByRole('radio', { name: 'C' }))).not.toContain('opacity-35')
    expect(classes(screen.getByRole('radio', { name: 'C' }))).toContain('focus-visible:outline-ps-or')
  })
})
