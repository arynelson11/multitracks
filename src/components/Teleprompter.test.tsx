// @vitest-environment jsdom
// Teleprompter na linguagem do palco (Parte 3, faixa C). Saiu de dentro do App.tsx sem mudar o que
// mostra: sem seções, esperando a seção, a seção atual com a letra, o progresso e o nome da música.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Teleprompter, type TeleprompterProps } from './Teleprompter'
import { oldLanguageClasses } from '../test/psLanguage'

afterEach(cleanup)

function abrir(props: Partial<TeleprompterProps> = {}) {
  const onClose = vi.fn()
  render(
    <Teleprompter
      songName="Grande é o Senhor" hasMarkers marker={{ label: 'Refrão', color: '#FF6B35', lyrics: 'Grande é o Senhor\ne mui digno de louvor' }}
      currentTime={30} duration={120} onClose={onClose} {...props}
    />,
  )
  return { onClose }
}

const texto = () => document.body.textContent ?? ''

describe('Teleprompter: nada some', () => {
  it('seção atual: selo com o nome na cor da seção e a letra grande', () => {
    abrir()
    const selo = screen.getByText('Refrão')
    expect(selo.style.color).toBe('rgb(255, 107, 53)')
    const letra = screen.getByRole('heading', { level: 1 })
    expect(letra.textContent).toBe('Grande é o Senhor\ne mui digno de louvor')
    expect(letra.className).toContain('whitespace-pre-wrap')
  })

  it('seção sem cor usa o verde de antes; sem letra mostra reticências', () => {
    abrir({ marker: { label: 'Verso' } })
    expect(screen.getByText('Verso').style.color).toBe('rgb(16, 185, 129)')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('…')
  })

  it('sem seções marcadas diz isso; com seções e nenhuma atual, espera a próxima', () => {
    abrir({ hasMarkers: false, marker: null })
    expect(texto()).toContain('Nenhuma seção marcada nesta música.')
    cleanup()
    abrir({ marker: null })
    expect(texto()).toContain('Esperando a próxima seção...')
  })

  it('progresso da música e o nome dela embaixo', () => {
    abrir()
    expect(screen.getByRole('progressbar', { name: 'Posição na música' }).getAttribute('aria-valuenow')).toBe('25')
    expect(texto()).toContain('Grande é o Senhor')
    cleanup()
    abrir({ duration: 0, songName: null })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(texto()).toContain('Nenhuma música aberta')
  })

  it('o X fecha; nenhuma tecla é tratada aqui (Espaço e Esc continuam com o palco)', () => {
    const { onClose } = abrir()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o teleprompter' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Teleprompter: linguagem do palco', () => {
  it('só classes da linguagem nova', () => {
    abrir()
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})
