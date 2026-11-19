// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextPromptDialog } from './TextPromptDialog'
import { endlessMetronomeBpmError, songNameError } from '../lib/textPromptRules'
import type { TextPromptDialogProps } from './TextPromptDialog'

afterEach(cleanup)

const TRAVESSAO = String.fromCharCode(0x2014)

const setup = (patch: Partial<TextPromptDialogProps> = {}) => {
  const props: TextPromptDialogProps = {
    title: 'Criar metrônomo (infinito)', label: 'BPM da nova faixa de Click, de 40 a 300', initialValue: '120', submitLabel: 'Criar',
    inputMode: 'numeric', validate: endlessMetronomeBpmError, onSubmit: vi.fn(), onCancel: vi.fn(), ...patch,
  }
  const r = render(<TextPromptDialog {...props} />)
  return { ...r, props, input: screen.getByLabelText(props.label) as HTMLInputElement }
}

describe('TextPromptDialog (no lugar do window.prompt, que o Electron não tem)', () => {
  it('abre com o valor, o foco no campo e o texto selecionado', () => {
    const { input } = setup()
    expect(screen.getByRole('dialog', { name: 'Criar metrônomo (infinito)' })).toBeTruthy()
    expect(input.value).toBe('120')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
    expect(input.getAttribute('inputmode')).toBe('numeric')
  })

  it('Enter ou Criar salva o valor sem espaços nas pontas', () => {
    const { input, props } = setup()
    fireEvent.change(input, { target: { value: ' 96 ' } })
    fireEvent.submit(input.form!)
    expect(props.onSubmit).toHaveBeenCalledWith('96')
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('valor inválido mostra o erro e não fecha; digitar de novo limpa o erro', () => {
    const { input, props } = setup()
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('BPM inválido. Digite um número entre 40 e 300.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(input, { target: { value: '50' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Esc, Cancelar e o toque fora cancelam; o Esc não chega aos atalhos do palco (não cancela o pulo)', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    const { input, props, container } = setup()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(onWindowKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(container.firstElementChild!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('dialog'))
    expect(props.onCancel).toHaveBeenCalledTimes(3) // dentro do diálogo não cancela
    window.removeEventListener('keydown', onWindowKey)
  })

  it('o foco volta pra quem abriu ao fechar', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = setup()
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('renomear: nome vazio não salva', () => {
    const { input, props } = setup({ title: 'Renomear esta música', label: 'Nome da música', initialValue: 'Fé', submitLabel: undefined, inputMode: undefined, validate: songNameError })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Digite um nome pra música.')
    fireEvent.change(input, { target: { value: ' Lugar Secreto ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.submit(input.form!)
    expect(props.onSubmit).toHaveBeenCalledWith('Lugar Secreto')
  })

  it('regras do BPM: inteiro de 40 a 300, como o prompt de antes', () => {
    for (const ok of ['40', '120', '300']) expect(endlessMetronomeBpmError(ok)).toBeNull()
    for (const bad of ['', '39', '301', '12.5', 'abc', '-80', '1e2']) expect(endlessMetronomeBpmError(bad)).not.toBeNull()
  })

  it('alvos de 44 px e texto sem travessão', () => {
    const { container } = setup()
    for (const b of container.querySelectorAll('button')) expect(b.className).toContain('min-h-ps-touch')
    expect(screen.getByLabelText('BPM da nova faixa de Click, de 40 a 300').className).toContain('min-h-ps-touch')
    expect(container.textContent).not.toContain(TRAVESSAO)
  })
})
