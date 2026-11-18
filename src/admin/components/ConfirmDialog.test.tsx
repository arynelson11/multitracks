// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'
import { AdminApiError } from '../lib/adminApi'

// O adminApi (de onde vem o AdminApiError) lê o token do supabase; aqui nada vai pra rede.
vi.mock('../../lib/supabase', () => ({ getAuthHeaders: async () => ({}) }))

afterEach(cleanup)

// Frase do Registro: a resposta da ação não chegou e o servidor pode ter feito (Ruling ADM-T4-incerto).
const LOST = 'A resposta do servidor não chegou. Confira no Registro se a ação foi feita antes de tentar de novo.'
const lost = () => new AdminApiError(LOST, 0, true)

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

  it('confirmDisabled desliga Confirmar e o clique não chama onConfirm; ligado de novo, confirma', () => {
    const { rerender, props, onConfirm, confirm } = setup({ confirmDisabled: true })
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).not.toHaveBeenCalled()
    // Cancelar continua valendo
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(<ConfirmDialog {...props} confirmDisabled={false} />)
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a linha de ajuda da nota aparece sob o campo e descreve o campo, junto com o mínimo', () => {
    setup({ note: { label: 'Motivo', required: true, minLength: 3, hint: 'A pessoa pode ver este motivo.' } })
    const field = screen.getByLabelText('Motivo') as HTMLTextAreaElement
    const described = document.getElementById(field.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe('Pelo menos 3 caracteres.A pessoa pode ver este motivo.')
    // Sob o campo: depois dele no documento.
    const hint = screen.getByText('A pessoa pode ver este motivo.')
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    // Sem mínimo nem ajuda, o campo não aponta pra nada.
    setup({ note: { label: 'Nota', required: false } })
    expect(screen.getByLabelText('Nota').getAttribute('aria-describedby')).toBeNull()
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

  it('erro incerto segura Confirmar até fechar e abrir de novo', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} busy />)
    rerender(<ConfirmDialog {...props} busy={false} error={lost()} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(LOST)
    expect(alert.className).toContain('text-ps-alert')
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Nem limpando o erro nem trocando por outro: só fechar e abrir solta.
    rerender(<ConfirmDialog {...props} error={null} />)
    expect(confirm().disabled).toBe(true)
    rerender(<ConfirmDialog {...props} error={new AdminApiError('Esta marcação já foi conferida.', 409)} />)
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Cancelar continua valendo, pra pessoa ir conferir no Registro.
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('erro incerto segura Confirmar também sem busy', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} error={lost()} />)
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a frase do Registro passada em texto também segura Confirmar', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} busy />)
    rerender(<ConfirmDialog {...props} busy={false} error={LOST} />)
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('erro certo do servidor rearma Confirmar', () => {
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} busy />)
    rerender(<ConfirmDialog {...props} busy={false} error={new AdminApiError('Esta marcação já foi conferida.', 409)} />)
    expect(screen.getByRole('alert').textContent).toBe('Esta marcação já foi conferida.')
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('fechar e abrir de novo solta Confirmar depois do erro incerto', () => {
    const uncertain = lost()
    const { onConfirm, confirm, props, rerender } = setup()
    fireEvent.click(confirm())
    rerender(<ConfirmDialog {...props} busy />)
    rerender(<ConfirmDialog {...props} busy={false} error={uncertain} />)
    expect(confirm().disabled).toBe(true)
    rerender(<ConfirmDialog {...props} open={false} error={uncertain} />)
    // Quem chama pode esquecer de limpar o erro ao reabrir: o aviso antigo aparece, mas não segura.
    rerender(<ConfirmDialog {...props} open error={uncertain} />)
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(2)
    // E um erro incerto novo nesta abertura segura de novo.
    rerender(<ConfirmDialog {...props} open busy />)
    rerender(<ConfirmDialog {...props} open busy={false} error={lost()} />)
    expect(confirm().disabled).toBe(true)
  })

  it('tom de alerta no botão de confirmar', () => {
    const { confirm } = setup({ tone: 'alert', confirmLabel: 'Bloquear' })
    expect(confirm().className).toContain('text-ps-alert')
  })
})
