// @vitest-environment jsdom
// Modo Ao Vivo do host na linguagem do palco (Parte 3, faixa C). As props não mudam (a frente 1b
// põe o limite do Livre pelo App) e a janela fica na camada própria (z-[100]): quem passa do limite
// de aparelhos ganha os Planos (z-[110]) por cima dela.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LiveModeModal } from './LiveModeModal'
import { oldLanguageClasses } from '../test/psLanguage'

type Props = Parameters<typeof LiveModeModal>[0]
const URL_LOCAL = 'http://192.168.0.10:3000/?sessao=palco-principal-da-igreja'

function abrir(over: Partial<Props> = {}) {
  const props: Props = {
    isOpen: true, onClose: vi.fn(), serverUrl: URL_LOCAL, isStarting: false, serverError: null, onStopServer: vi.fn(),
    devices: [], approvedIps: [], onToggleDevice: vi.fn(), onToggleAll: vi.fn(), remoteSessionCode: null, onToggleRemote: vi.fn(), ...over,
  }
  render(<LiveModeModal {...props} />)
  return props
}

const texto = () => document.body.textContent ?? ''
afterEach(cleanup)

describe('Modo Ao Vivo: nada some', () => {
  it('as props são as mesmas 12', () => {
    expectTypeOf<keyof Props>().toEqualTypeOf<
      'isOpen' | 'onClose' | 'serverUrl' | 'isStarting' | 'serverError' | 'onStopServer' | 'devices' | 'approvedIps' | 'onToggleDevice' | 'onToggleAll' | 'remoteSessionCode' | 'onToggleRemote'
    >()
  })

  it('fechado não mostra nada', () => {
    abrir({ isOpen: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('iniciando e erro', () => {
    abrir({ serverUrl: null, isStarting: true })
    expect(screen.getByRole('status').textContent).toContain('Iniciando o servidor')
    cleanup()
    abrir({ serverUrl: null, serverError: 'Porta 3000 ocupada' })
    const erro = screen.getByRole('alert')
    expect(erro.textContent).toContain('Erro ao iniciar o servidor')
    expect(erro.textContent).toContain('Porta 3000 ocupada')
  })

  it('ligado: QR code, endereço, luz de ao vivo e ninguém conectado ainda', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Modo Ao Vivo' })).toBeTruthy()
    expect(document.querySelector('[role="dialog"] svg[data-qr]')).not.toBeNull()
    expect(screen.getByText(URL_LOCAL)).toBeTruthy()
    expect(texto()).toContain('Conecte na mesma rede')
    expect(screen.getByRole('img', { name: 'Ao vivo' })).toBeTruthy()
    expect(texto()).toContain('Nenhum dispositivo conectado ainda.')
    expect(screen.queryByRole('button', { name: /todos/ })).toBeNull()
  })

  it('aparelhos: Controla ou Só segue por aparelho, e Liberar ou Bloquear todos', () => {
    const p = abrir({ devices: ['192.168.0.12', '', '192.168.0.30'], approvedIps: ['192.168.0.12'] })
    const linhas = screen.getAllByRole('listitem')
    expect(linhas.map((l) => l.textContent)).toEqual(['192.168.0.12Controla', 'Dispositivo 2Só segue', '192.168.0.30Só segue'])
    const controla = within(linhas[0]).getByRole('button')
    expect(controla.getAttribute('aria-pressed')).toBe('true')
    expect(within(linhas[2]).getByRole('button').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(controla)
    expect(p.onToggleDevice).toHaveBeenCalledWith('192.168.0.12')
    fireEvent.click(screen.getByRole('button', { name: 'Liberar todos' }))
    expect(p.onToggleAll).toHaveBeenCalledTimes(1)
    cleanup()
    abrir({ devices: ['192.168.0.12'], approvedIps: ['192.168.0.12'] })
    expect(screen.getByRole('button', { name: 'Bloquear todos' })).toBeTruthy()
  })

  it('Desativar desliga o servidor; o músico remoto continua escondido', () => {
    const p = abrir({ remoteSessionCode: 'ABC123' })
    fireEvent.click(screen.getByRole('button', { name: 'Desativar Modo Ao Vivo' }))
    expect(p.onStopServer).toHaveBeenCalledTimes(1)
    expect(texto()).not.toContain('remoto')
  })

  it('X e toque fora fecham; toque dentro não', () => {
    const p = abrir()
    fireEvent.click(screen.getByRole('dialog'))
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })

  // Revisão macro BC (BC2-M9): arrastar pra selecionar o endereço comprido e soltar fora não fecha.
  it('apertar dentro e soltar fora não fecha; apertar e soltar fora fecha', () => {
    const p = abrir()
    const camada = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.pointerDown(screen.getByText(URL_LOCAL))
    fireEvent.click(camada)
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(camada)
    fireEvent.click(camada)
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  // Revisão macro BC (BC2-I2): com a banda inteira conectada, o conteúdo passa da altura e o
  // justify-center jogava o topo do QR pra fora do alcance da rolagem; o safe center não.
  it('a área que rola centraliza só quando cabe (justify-center-safe)', () => {
    abrir({ devices: ['1', '2', '3', '4', '5', '6'], approvedIps: [] })
    const area = screen.getByRole('dialog').children[1] as HTMLElement
    const classes = area.className.split(' ')
    expect(classes).toContain('overflow-y-auto')
    expect(classes).toContain('justify-center-safe')
    expect(classes).not.toContain('justify-center')
  })
})

describe('Modo Ao Vivo: linguagem do palco', () => {
  it('camada própria abaixo dos Planos e só classes da linguagem nova', () => {
    abrir({ devices: ['192.168.0.12'], approvedIps: [] })
    expect((screen.getByRole('dialog').parentElement as HTMLElement).className).toContain('z-[100]')
    // Sem aria-modal: os Planos abrem por cima (fora desta janela) e o leitor de tela tem de achá-los.
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})
