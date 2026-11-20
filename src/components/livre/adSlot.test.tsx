// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HOME_AD, SEPARATION_AD } from './adCopy'
import type { AdSlotProps } from './AdSlot'

// O evento do funil vai pro servidor: aqui só se confere o que foi mandado.
const trackAd = vi.hoisted(() => vi.fn())
vi.mock('../../lib/productEvents', () => ({ trackAd }))

const TRAVESSAO = String.fromCharCode(0x2014)
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const U = 'conta-livre'

// Cada "sessão" é o app recarregado: módulos novos (o anúncio grande da sessão volta a zero),
// com o mesmo armazenamento do aparelho (o dia do anúncio da tela inicial fica guardado).
async function newSession() {
  vi.resetModules()
  const { AdSlot } = await import('./AdSlot')
  const store = await import('../../lib/livreStore')
  return { AdSlot, store }
}

type Session = Awaited<ReturnType<typeof newSession>>

function slot(s: Session, over: Partial<AdSlotProps> = {}) {
  const onCta = vi.fn()
  const props: AdSlotProps = { placement: 'home', userId: U, isLivre: true, quiet: true, onCta, ...over }
  const r = render(<s.AdSlot {...props} />)
  const rerender = (more: Partial<AdSlotProps>) => r.rerender(<s.AdSlot {...props} {...more} />)
  return { ...r, rerender, onCta }
}

const shown = (placement: AdSlotProps['placement']) => trackAd.mock.calls.filter((c) => c[0] === 'ad_shown' && c[1] === placement).length

beforeEach(() => {
  localStorage.clear()
  trackAd.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 20/11/2026 ao meio-dia de Brasília.
  vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('anúncio da casa (AdSlot)', () => {
  it('mostra na tela inicial uma vez por dia e grava ad_shown home uma vez', async () => {
    const s1 = await newSession()
    const a = slot(s1)
    expect(screen.getByRole('region', { name: HOME_AD.title }).dataset.houseAd).toBe('home')
    expect(shown('home')).toBe(1)
    expect(s1.store.bigAdShownThisSession()).toBe(true)
    expect(s1.store.readHomeAdDay(U)).toBe('2026-11-20')
    // Renderizar de novo (a música para e toca, a tela muda) não grava outro anúncio visto.
    a.rerender({ quiet: false })
    a.rerender({ quiet: true })
    expect(shown('home')).toBe(1)
    a.unmount()

    // App aberto de novo no mesmo dia (23:30 de Brasília já é 21/11 em UTC): não aparece.
    vi.setSystemTime(new Date('2026-11-21T02:30:00Z'))
    const s2 = await newSession()
    const b = slot(s2)
    expect(b.container.textContent).not.toContain(HOME_AD.title)
    expect(shown('home')).toBe(1)
    expect(s2.store.bigAdShownThisSession()).toBe(false)
    b.unmount()

    // Passou a meia-noite de Brasília: aparece de novo, uma vez.
    vi.setSystemTime(new Date('2026-11-21T03:30:00Z'))
    const s3 = await newSession()
    slot(s3)
    expect(screen.getByRole('region', { name: HOME_AD.title })).toBeTruthy()
    expect(shown('home')).toBe(2)
    expect(s3.store.readHomeAdDay(U)).toBe('2026-11-21')
  })

  it('o anúncio da tela inicial não aparece com a música tocando', async () => {
    const s = await newSession()
    // Tocando ou na pré-contagem (quem monta passa quiet falso nos dois casos).
    const { container, rerender } = slot(s, { quiet: false })
    expect(container.textContent).not.toContain(HOME_AD.title)
    // Nada decidido nem gravado enquanto toca.
    expect(trackAd).not.toHaveBeenCalled()
    expect(s.store.bigAdShownThisSession()).toBe(false)
    expect(s.store.readHomeAdDay(U)).toBeNull()

    // A música parou: aparece (e grava uma vez).
    rerender({ quiet: true })
    expect(container.textContent).toContain(HOME_AD.title)
    expect(shown('home')).toBe(1)
    // Tocou de novo: o cartão sai e volta quando ela para, sem gravar outro.
    rerender({ quiet: false })
    expect(container.textContent).not.toContain(HOME_AD.title)
    rerender({ quiet: true })
    expect(container.textContent).toContain(HOME_AD.title)
    expect(shown('home')).toBe(1)
  })

  it('não mostra se já houve anúncio grande na sessão', async () => {
    const s = await newSession()
    s.store.markBigAdShown()
    const home = slot(s)
    expect(home.container.textContent).not.toContain(HOME_AD.title)
    home.unmount()
    const sep = slot(s, { placement: 'separation-done', justSeparated: true })
    expect(sep.container.textContent).not.toContain(SEPARATION_AD.title)
    expect(trackAd).not.toHaveBeenCalled()
    // A tela inicial não marcou o dia: amanhã ou em outra sessão de hoje ela ainda pode aparecer.
    expect(s.store.readHomeAdDay(U)).toBeNull()
  })

  it('conta paga nunca vê o anúncio', async () => {
    const s = await newSession()
    const home = slot(s, { isLivre: false })
    expect(home.container.textContent).not.toContain(HOME_AD.title)
    home.unmount()
    const sep = slot(s, { placement: 'separation-done', justSeparated: true, isLivre: false })
    expect(sep.container.textContent).not.toContain(SEPARATION_AD.title)
    expect(trackAd).not.toHaveBeenCalled()
    expect(s.store.bigAdShownThisSession()).toBe(false)
    expect(s.store.readHomeAdDay(U)).toBeNull()
    // Sem conta também não (não há onde contar o dia).
    const semConta = slot(s, { userId: null })
    expect(semConta.container.textContent).not.toContain(HOME_AD.title)
    expect(trackAd).not.toHaveBeenCalled()
  })

  it('Conhecer o Pro grava ad_clicked e chama onCta; Agora não esconde de vez', async () => {
    const s = await newSession()
    const { container, rerender, onCta } = slot(s)
    fireEvent.click(screen.getByRole('button', { name: HOME_AD.cta }))
    expect(onCta).toHaveBeenCalledTimes(1)
    expect(trackAd).toHaveBeenCalledWith('ad_clicked', 'home')
    expect(trackAd.mock.calls.filter((c) => c[0] === 'ad_clicked')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: HOME_AD.dismiss }))
    expect(container.textContent).not.toContain(HOME_AD.title)
    // De vez: tocar e parar não traz de volta, e nada é gravado de novo.
    rerender({ quiet: false })
    rerender({ quiet: true })
    expect(container.textContent).not.toContain(HOME_AD.title)
    expect(onCta).toHaveBeenCalledTimes(1)
    expect(shown('home')).toBe(1)
  })

  it('o do fim da separação só aparece com justSeparated', async () => {
    const s = await newSession()
    // Montado antes de a separação terminar (ou com uma separação antiga aberta): nada, e não decide ainda.
    const { container, rerender } = slot(s, { placement: 'separation-done', justSeparated: false })
    expect(container.textContent).not.toContain(SEPARATION_AD.title)
    expect(trackAd).not.toHaveBeenCalled()

    // A separação terminou, com a música parada: aparece, grava uma vez e não marca o dia da tela inicial.
    rerender({ justSeparated: true })
    expect(screen.getByRole('region', { name: SEPARATION_AD.title }).dataset.houseAd).toBe('separation-done')
    expect(shown('separation-done')).toBe(1)
    expect(s.store.bigAdShownThisSession()).toBe(true)
    expect(s.store.readHomeAdDay(U)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: SEPARATION_AD.cta }))
    expect(trackAd).toHaveBeenCalledWith('ad_clicked', 'separation-done')

    // Abriu outra separação: o cartão sai.
    rerender({ justSeparated: false })
    expect(container.textContent).not.toContain(SEPARATION_AD.title)
    cleanup()

    // Um anúncio grande por sessão: a tela inicial, na mesma sessão, não mostra o dela.
    const home = slot(s)
    expect(home.container.textContent).not.toContain(HOME_AD.title)
    expect(shown('home')).toBe(0)
  })

  it('nenhum travessão e nenhum setState dentro de efeito no AdSlot', () => {
    const src = read('./AdSlot.tsx')
    expect(src).not.toContain(TRAVESSAO)
    // Ruling R8: o efeito só grava fora do React; a decisão assenta na renderização.
    const effects = src.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[/g) ?? []
    expect(effects.length).toBeGreaterThan(0)
    for (const e of effects) expect(e).not.toMatch(/\bset[A-Z]\w*\(/)
  })
})
