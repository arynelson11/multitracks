// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SiteLegalInfo } from './SiteLegalInfo'
import { LandingPage } from './LandingPage'
import { LEGAL_PAGES, LEGAL_PAGES_LIVE } from '../content/site'

afterEach(cleanup)

describe('rodapé legal', () => {
  it('tem Grupo AIO, CNPJ e Macaé/RJ', () => {
    render(<SiteLegalInfo />)
    expect(screen.getByText('Grupo AIO · CNPJ 43.247.025/0001-05 · Macaé/RJ')).toBeTruthy()
  })

  it('só leva pra Privacidade, Termos e Cancelamento com as páginas ligadas', () => {
    render(<SiteLegalInfo />)
    for (const page of LEGAL_PAGES) {
      const link = screen.queryByRole('link', { name: page.label })
      if (LEGAL_PAGES_LIVE) expect(link?.getAttribute('href')).toBe(page.href)
      else expect(link).toBeNull()
    }
  })

  it('mostra o contato que o site já usa (WhatsApp e email)', () => {
    render(<SiteLegalInfo />)
    expect(screen.getByRole('link', { name: 'WhatsApp (22) 99724-9896' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5522997249896\?/)
    expect(screen.getByRole('link', { name: 'contatoplaybackstudio@gmail.com' }).getAttribute('href')).toBe('mailto:contatoplaybackstudio@gmail.com')
  })

  it('está no rodapé da landing', () => {
    render(<LandingPage onEnter={() => {}} />)
    const footer = document.querySelector('footer')
    expect(footer?.textContent).toContain('Grupo AIO · CNPJ 43.247.025/0001-05 · Macaé/RJ')
    expect(!!footer?.querySelector('a[href="/privacidade"]')).toBe(LEGAL_PAGES_LIVE)
  })
})
