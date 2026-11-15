// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelEditPanel } from './ChannelEditPanel'
import type { ChannelIdentity } from '../lib/channelNames'

afterEach(cleanup)
const setup = (channel: ChannelIdentity = { id: 'c1', name: 'GTR_1' }, autoLabel = 'Guitarra') => {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<ChannelEditPanel channel={channel} autoLabel={autoLabel} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}
const nameInput = () => screen.getByLabelText('Nome') as HTMLInputElement

describe('ChannelEditPanel', () => {
  it('mostra título, arquivo original e o nome automático como placeholder', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Editar canal' })).toBeTruthy()
    expect(screen.getByText('Arquivo: GTR_1')).toBeTruthy()
    expect([nameInput().placeholder, nameInput().value, nameInput().maxLength]).toEqual(['Guitarra', '', 24])
  })
  it('papel automático marcado com o selo Automático', () => {
    setup({ id: 'c1', name: 'CLICK 13' }, 'Click')
    expect(screen.getByRole('radio', { name: 'Click' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Automático')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar papel automático' })).toBeNull()
  })
  it('papel automático acompanha o nome digitado', () => {
    setup({ id: 'c1', name: 'Track 7' }, 'Track 7')
    fireEvent.change(nameInput(), { target: { value: 'Click' } })
    expect(screen.getByRole('radio', { name: 'Click' }).getAttribute('aria-checked')).toBe('true')
  })
  it('salva nome limpo e papel manual', () => {
    const { onSave } = setup()
    fireEvent.change(nameInput(), { target: { value: '  Guitarra do Zé  ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Guia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSave).toHaveBeenCalledWith({ customName: 'Guitarra do Zé', role: 'guide' })
  })
  it('voltar ao automático manda null nos dois', () => {
    const { onSave } = setup({ id: 'c1', name: 'GTR_1', customName: 'Zé', role: 'click' })
    fireEvent.click(screen.getByRole('button', { name: 'Usar nome automático' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar papel automático' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSave).toHaveBeenCalledWith({ customName: null, role: null })
  })
  it('Enter no nome salva; Esc e Cancelar fecham sem salvar', () => {
    const { onSave, onClose } = setup()
    fireEvent.keyDown(nameInput(), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  it('textos de ajuda e aviso da biblioteca, sem travessão', () => {
    setup()
    expect(screen.getByText('Canal da música: vai pra PA no pan automático e acompanha a troca de tom.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Click' }))
    expect(screen.getByText('Canal do click: vai pro ouvido da banda no pan automático e não muda com a troca de tom. Continua tocando mesmo quando outro canal está em Solo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Guia' }))
    expect(screen.getByText('Canal da voz guia: vai pro ouvido da banda no pan automático e não muda com a troca de tom. Continua tocando mesmo quando outro canal está em Solo.')).toBeTruthy()
    expect(screen.getByText('Vale só pro seu repertório. A música da biblioteca não muda.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('\u2014')
  })

  it('campo de nome com 16px, pra o iPhone e o iPad não darem zoom ao focar', () => {
    setup()
    // text-ps-md vale 16px (fixado em src/styles/ps-tokens.test.ts); text-ps-base (13px) faria o Safari ampliar a tela.
    expect(nameInput().className).toContain('text-ps-md')
    expect(nameInput().className).not.toContain('text-ps-base')
  })

  // Comportamento de diálogo modal (aria-modal): foco, Tab preso e teclas que não vazam pro palco.
  it('abre com foco no nome e explica que o nome do usuário vence o automático', () => {
    setup()
    expect(document.activeElement).toBe(nameInput())
    expect(screen.getByText('O nome que você der aparece no lugar do automático.')).toBeTruthy()
  })
  it('o foco não se perde quando o botão de voltar ao automático some', () => {
    setup({ id: 'c1', name: 'GTR_1', customName: 'Zé', role: 'click' })
    fireEvent.click(screen.getByRole('button', { name: 'Usar nome automático' }))
    expect(document.activeElement).toBe(nameInput())
    fireEvent.click(screen.getByRole('button', { name: 'Usar papel automático' }))
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Normal' }))
  })
  it('Tab e Shift+Tab ficam dentro do painel', () => {
    setup()
    const salvar = screen.getByRole('button', { name: 'Salvar' })
    salvar.focus()
    fireEvent.keyDown(salvar, { key: 'Tab' })
    expect(document.activeElement).toBe(nameInput())
    fireEvent.keyDown(nameInput(), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(salvar)
  })
  it('teclas do painel não chegam aos atalhos do palco (setas, Espaço)', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    try {
      setup()
      fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'ArrowLeft', code: 'ArrowLeft' })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Salvar' }), { key: ' ', code: 'Space' })
      expect(onWindowKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })
  it('ao fechar, o foco volta pra quem abriu o painel', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(
      <ChannelEditPanel channel={{ id: 'c1', name: 'GTR_1' }} autoLabel="Guitarra" onSave={vi.fn()} onClose={vi.fn()} />,
    )
    expect(document.activeElement).toBe(nameInput())
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
