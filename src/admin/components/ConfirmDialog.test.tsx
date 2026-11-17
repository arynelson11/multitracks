// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

type Props = Parameters<typeof ConfirmDialog>[0]

function setup(extra: Partial<Props> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const props: Props = {
    open: true,
    title: 'Conferir marcação',
    confirmLabel: 'Conferido',
    onConfirm,
    onCancel,
    children: <p>A marcação sai da lista.</p>,
    ...extra,
  }
  const view = render(<ConfirmDialog {...props} />)
  const confirm = () => screen.getByRole('button', { name: props.confirmLabel }) as HTMLButtonElement
  return { ...view, props, onConfirm, onCancel, confirm }
}

describe('ConfirmDialog', () => {
  it('fechado não mostra nada', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('é um diálogo modal com o título e o texto', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Conferir marcação' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('A marcação sai da lista.')
  })

  it('dois cliques seguidos em Confirmar chamam onConfirm uma vez', () => {
    const { onConfirm, confirm } = setup()
    fireEvent.click(confirm())
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('a trava solta quando busy volta a falso', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} busy />)
    rerender(<ConfirmDialog {...props} busy={false} error="Não deu certo." />)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('um erro novo solta a trava mesmo sem busy, pra Confirmar não ficar morto', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} error="Não deu certo." />)
    fireEvent.click(confirm())
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('rótulo comprido quebra linha dentro do botão em vez de estourar o diálogo', () => {
    const label = 'Cancelar a assinatura agora sem estorno'
    setup({ confirmLabel: label, tone: 'alert' })
    const button = screen.getByRole('button', { name: label })
    // O Button não quebra texto (whitespace-nowrap); o rótulo vai num span que quebra, e o botão
    // fica no máximo da largura do diálogo.
    expect(button.className).toContain('max-w-full')
    const span = screen.getByText(label)
    expect(span.tagName).toBe('SPAN')
    expect(span.className).toContain('whitespace-normal')
  })

  it('a trava solta quando o diálogo reabre', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} open={false} />)
    rerender(<ConfirmDialog {...props} open />)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('Esc cancela', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('o Tab não sai do diálogo, nem passando por um campo do texto', () => {
    setup({ children: <input aria-label="Dias" /> })
    const dialog = screen.getByRole('dialog')
    const days = screen.getByLabelText('Dias')
    const last = screen.getByRole('button', { name: 'Conferido' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(days)
    fireEvent.keyDown(days, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Cancelar chama onCancel', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('com busy Esc não cancela e Confirmar fica desligado', () => {
    const { onCancel, onConfirm, confirm } = setup({ busy: true })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('nota obrigatória curta desliga Confirmar', () => {
    const { onConfirm, confirm } = setup({ note: { label: 'Nota', required: true, minLength: 3 } })
    const field = screen.getByLabelText('Nota') as HTMLTextAreaElement
    expect(confirm().disabled).toBe(true)
    fireEvent.change(field, { target: { value: ' ab ' } })
    expect(confirm().disabled).toBe(true)
    fireEvent.change(field, { target: { value: '  estornei hoje  ' } })
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith('estornei hoje')
  })

  it('nota opcional deixa confirmar vazio', () => {
    const { onConfirm, confirm } = setup({ note: { label: 'Nota (opcional)', required: false } })
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('erro aparece dentro do diálogo', () => {
    setup({ error: 'Esta marcação já foi conferida.' })
    const dialog = screen.getByRole('dialog')
    const msg = screen.getByText('Esta marcação já foi conferida.')
    expect(dialog.contains(msg)).toBe(true)
    expect(msg.className).toContain('text-ps-alert')
  })

  it('tom de alerta no botão de confirmar', () => {
    const { confirm } = setup({ tone: 'alert', confirmLabel: 'Bloquear' })
    expect(confirm().className).toContain('text-ps-alert')
  })
})
