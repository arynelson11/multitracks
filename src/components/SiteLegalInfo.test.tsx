// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SiteLegalInfo } from './SiteLegalInfo'
import { LandingPage } from './LandingPage'

afterEach(cleanup)

describe('rodapé legal', () => {
  it('tem Grupo AIO, CNPJ e Macaé/RJ', () => {
    render(<SiteLegalInfo />)
    expect(screen.getByText('Grupo AIO · CNPJ 43.247.025/0001-05 · Macaé/RJ')).toBeTruthy()
  })

  it('leva pra Privacidade, Termos e Cancelamento', () => {
    render(<SiteLegalInfo />)
    expect(screen.getByRole('link', { name: 'Privacidade' }).getAttribute('href')).toBe('/privacidade')
    expect(screen.getByRole('link', { name: 'Termos' }).getAttribute('href')).toBe('/termos')
    expect(screen.getByRole('link', { name: 'Cancelamento' }).getAttribute('href')).toBe('/cancelamento')
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
    expect(footer?.querySelector('a[href="/privacidade"]')).toBeTruthy()
  })
})
