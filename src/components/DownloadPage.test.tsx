// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DownloadPage } from './DownloadPage'

afterEach(cleanup)
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
