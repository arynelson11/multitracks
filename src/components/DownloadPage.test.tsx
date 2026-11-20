// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DownloadPage } from './DownloadPage'
import { oldLanguageClasses } from '../test/psLanguage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeAll(() => {
  // jsdom não tem matchMedia (o guia de instalação pergunta se o app já está instalado).
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
const text = () => document.body.textContent ?? ''

describe('DownloadPage', () => {
  it('tem um <main> e o link de pular para o conteúdo', () => {
    render(<DownloadPage />)
    expect(document.querySelectorAll('main#conteudo')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' }).getAttribute('href')).toBe('#conteudo')
  })

  it('títulos não pulam nível', () => {
    render(<DownloadPage />)
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => Number(h.tagName[1]))
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
  })

  it('rodapé com o bloco legal', () => {
    render(<DownloadPage />)
    expect(text()).toContain('Grupo AIO · CNPJ 43.247.025/0001-05 · Macaé/RJ')
  })
})

describe('DownloadPage: textos atualizados', () => {
  it('requisito do macOS 12, Mac Intel pelo processador e sem levada brasileira', () => {
    render(<DownloadPage />)
    expect(text()).toContain('12 (Monterey) ou mais novo')
    expect(text()).not.toContain('Big Sur')
    expect(text()).toContain('Macs com processador Intel')
    expect(text()).not.toContain('até 2020')
    expect(text()).not.toContain('levada brasileira')
  })

  it('a ajuda do Mac separa o macOS 14 ou mais antigo do macOS 15 ou mais novo', () => {
    render(<DownloadPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Como instalar no Mac' })[0])
    expect(text()).toContain('Primeira abertura no macOS 14 (Sonoma) ou mais antigo')
    expect(text()).toContain('No macOS 15 (Sequoia) ou mais novo')
    expect(text()).toContain('Abrir Mesmo Assim')
    expect(text()).not.toContain('geralmente resolve já no passo 2')
  })
})

// Parte 3, faixa C: a página no layout do palco, sem mudar o que ela oferece.
describe('DownloadPage: nada some no layout do palco', () => {
  const GH = 'https://github.com/arynelson11/multitracks/releases/latest/download'

  it('os três instaladores com os mesmos endereços', () => {
    render(<DownloadPage />)
    expect(screen.getByRole('link', { name: 'Baixar (Apple Silicon)' }).getAttribute('href')).toBe(`${GH}/Playback-Studio-mac-arm64.dmg`)
    expect(screen.getByRole('link', { name: 'Baixar (Intel)' }).getAttribute('href')).toBe(`${GH}/Playback-Studio-mac-x64.dmg`)
    expect(screen.getByRole('link', { name: 'Baixar (.exe)' }).getAttribute('href')).toBe(`${GH}/Playback-Studio-win.exe`)
  })

  it('no Mac os dois instaladores do Mac ficam em destaque e aparece a dica de qual Mac', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15')
    render(<DownloadPage />)
    const destaques = [...document.querySelectorAll('[data-highlighted="true"]')].map(el => el.textContent ?? '')
    expect(destaques).toHaveLength(2)
    expect(destaques.every(t => t.includes('Mac'))).toBe(true)
    expect(text()).toContain('Não sabe qual Mac você tem?')
  })

  // Revisão macro BC (BC3-3, decisão do coordenador): o cartão do sistema de quem abre fica em
  // destaque com o anel line-3 e o selo neutro SEU SISTEMA, sem o laranja (laranja é ligado).
  it('o destaque do sistema é o anel line-3 com o selo SEU SISTEMA, sem laranja no cartão', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    render(<DownloadPage />)
    const cartoes = [...document.querySelectorAll<HTMLElement>('[data-highlighted]')]
    expect(cartoes).toHaveLength(1)
    const [win] = cartoes
    expect(win.textContent).toContain('Windows')
    expect(win.className).toContain('inset-ring-ps-line-3')
    expect(win.className).not.toMatch(/ps-or/)
    expect(win.textContent).toContain('SEU SISTEMA')
    const outros = [...document.querySelectorAll<HTMLElement>('.rounded-ps-2xl')].filter((el) => el !== win && el.querySelector('a[href]'))
    expect(outros.length).toBe(2)
    for (const c of outros) expect(c.textContent).not.toContain('SEU SISTEMA')
  })

  it('Como instalar no Windows abre a ajuda do SmartScreen', () => {
    render(<DownloadPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Como instalar no Windows' }))
    expect(text()).toContain('Windows Defender SmartScreen')
    expect(text()).toContain('Executar assim mesmo')
  })

  it('as 8 funções, os requisitos e o plano', () => {
    render(<DownloadPage />)
    expect(screen.getByRole('heading', { name: 'Tudo o que o app faz' })).toBeTruthy()
    expect(document.querySelectorAll('[data-feature]')).toHaveLength(8)
    expect(text()).toContain('10 ou 11 (64 bits)')
    expect(text()).toContain('Grátis pra instalar. As funções seguem o seu plano (Livre, Pro ou Studio).')
  })

  it('só classes da linguagem nova, sem texto cortado com reticências', () => {
    render(<DownloadPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Como instalar no Mac' })[0])
    expect(oldLanguageClasses(document.body)).toEqual([])
    expect(document.querySelector('.truncate')).toBeNull()
  })
})
