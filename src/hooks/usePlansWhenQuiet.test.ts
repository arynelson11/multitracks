// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { usePlansWhenQuiet } from './usePlansWhenQuiet'

// Revisão macro 1b (Ruling pads-tocando): no Livre, tocar num recurso pago com a música tocando
// ou na pré-contagem não abre os Planos na hora; eles esperam a música parar, como a tela de
// limite. Quem paga e o admin (fora do Livre) abrem na hora, como antes.

const TRAVESSAO = String.fromCharCode(0x2014)
type Props = { isLivre: boolean; quiet: boolean }

function setup(initial: Props) {
  const open = vi.fn()
  const h = renderHook((p: Props) => usePlansWhenQuiet(p.isLivre, p.quiet, open), { initialProps: initial })
  return { open, request: () => act(() => h.result.current()), rerender: (p: Props) => h.rerender(p) }
}

afterEach(cleanup)

describe('usePlansWhenQuiet', () => {
  it('Livre parado: abre os Planos na hora', () => {
    const s = setup({ isLivre: true, quiet: true })
    s.request()
    expect(s.open).toHaveBeenCalledTimes(1)
  })

  it('Livre tocando ou contando: espera a música parar e abre uma vez só', () => {
    const s = setup({ isLivre: true, quiet: false })
    s.request()
    s.request()
    expect(s.open).not.toHaveBeenCalled()
    s.rerender({ isLivre: true, quiet: false })
    expect(s.open).not.toHaveBeenCalled()
    s.rerender({ isLivre: true, quiet: true })
    expect(s.open).toHaveBeenCalledTimes(1)
    // Parada de novo depois, sem pedido novo: nada abre.
    s.rerender({ isLivre: true, quiet: false })
    s.rerender({ isLivre: true, quiet: true })
    expect(s.open).toHaveBeenCalledTimes(1)
  })

  it('quem paga e o admin (fora do Livre) abrem na hora, mesmo tocando', () => {
    const s = setup({ isLivre: false, quiet: false })
    s.request()
    expect(s.open).toHaveBeenCalledTimes(1)
  })

  it('o pedido do Livre que esperava some se a conta deixa de ser Livre (assinou) antes de parar', () => {
    const s = setup({ isLivre: true, quiet: false })
    s.request()
    s.rerender({ isLivre: false, quiet: false })
    s.rerender({ isLivre: false, quiet: true })
    expect(s.open).not.toHaveBeenCalled()
  })

  it('o arquivo não tem travessão', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/usePlansWhenQuiet.ts'), 'utf8')
    expect(src).not.toContain(TRAVESSAO)
  })
})
