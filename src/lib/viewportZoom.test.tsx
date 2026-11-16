// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { setZoomLocked, VIEWPORT_FREE, VIEWPORT_LOCKED } from './viewportZoom'
import { useFreeZoom } from '../hooks/useFreeZoom'
import { LandingPage } from '../components/LandingPage'

const viewport = () => document.querySelector('meta[name="viewport"]')?.getAttribute('content')

beforeEach(() => {
  document.head.innerHTML = `<meta name="viewport" content="${VIEWPORT_FREE}" />`
})
afterEach(cleanup)

describe('zoom do viewport', () => {
  it('o app trava o zoom como antes (o iPhone não dá zoom sozinho ao tocar num campo)', () => {
    setZoomLocked(true)
    expect(viewport()).toBe(VIEWPORT_LOCKED)
  })

  it('a página pública libera o zoom e devolve a trava ao sair', () => {
    setZoomLocked(true)
    function Publica() { useFreeZoom(); return null }
    const { unmount } = render(<Publica />)
    expect(viewport()).toBe(VIEWPORT_FREE)
    unmount()
    expect(viewport()).toBe(VIEWPORT_LOCKED)
  })

  it('a landing libera o zoom', () => {
    setZoomLocked(true)
    render(<LandingPage onEnter={() => {}} />)
    expect(viewport()).toBe(VIEWPORT_FREE)
  })
})
