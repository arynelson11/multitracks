// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LimitScreen } from './LimitScreen'
import { StageDialog } from '../stage/StageDialog'
import type { LimitScreenProps } from './LimitScreen'
import { LIMIT_COPY, OFFER_COPY, formatCountdown, offerRemainingMs } from './limitCopy'
import type { OfferView } from './limitCopy'
import { LIMIT_SCREEN_KINDS, isQuiet, queueRequest, queueSettle } from '../../lib/livreRules'
import type { EngineBusy, LimitScreenKind, QuietQueue } from '../../lib/livreRules'
import { PRICES } from '../../content/site'
import { formatReais } from '../../lib/prices'

// O livreRules importa o separationUsage, que puxa o cliente do Supabase: sem .env ele avisaria no console.
vi.mock('../../lib/supabase', () => ({ supabase: null }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const TRAVESSAO = String.fromCharCode(0x2014)
const T0 = Date.parse('2026-11-19T15:00:00Z')
const HOUR = 3_600_000
const PRICES_OFFER = { essencial_mensal: 24.9, pro_mensal: 59.9 }
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const active = (expiresAtMs: number): OfferView => ({ status: 'active', expiresAt: new Date(expiresAtMs).toISOString(), prices: PRICES_OFFER })

function props(patch: Partial<LimitScreenProps> = {}): LimitScreenProps {
  return {
    kind: 'stage-songs',
    offer: { status: 'none' },
    busyPlan: null,
    error: null,
    now: () => T0,
    onChoose: vi.fn(),
    onSeePlans: vi.fn(),
    onClose: vi.fn(),
    ...patch,
  }
}

const screenFor = (kind: LimitScreenKind) => render(<LimitScreen {...props({ kind })} />)
const dialog = () => screen.getByRole('dialog')
// Os botões da tela, sem o X do canto (que é da janela).
const actionNames = () =>
  screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Fechar').map((b) => b.textContent)
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const proButton = () => button('Assinar o Pro por R$ 24,90')
const studioButton = () => button('Assinar o Studio por R$ 59,90')
const timer = () => screen.queryByRole('timer')

describe('textos da tela de limite', () => {
  it('cada tipo de limite mostra o próprio título e o próprio texto', () => {
    for (const k of LIMIT_SCREEN_KINDS) {
      const r = screenFor(k)
      expect(r.getByRole('heading').textContent).toBe(LIMIT_COPY[k].title)
      expect(r.getByRole('dialog', { name: LIMIT_COPY[k].title })).toBeTruthy()
      expect(r.getByText(LIMIT_COPY[k].body)).toBeTruthy()
      r.unmount()
    }
  })

  // Revisão macro 1b (I2): no Pro o teto é de quem controla (até 4); os outros acompanham.
  it('os 10 minutos acabaram: o texto do Pro fala de até 4 celulares no controle', () => {
    expect(LIMIT_COPY.live.body).toBe('No Pro são até 4 celulares no controle, com a banda acompanhando o culto do começo ao fim.')
  })

  it('o celular a mais no Livre tem título e texto próprios, verdadeiros com minutos sobrando', () => {
    expect(LIMIT_COPY['live-devices']).toEqual({
      title: 'No Livre, só 1 celular da banda controla o palco',
      body: 'No Pro e no Studio o culto segue sem ninguém correr até o computador: mais celulares da banda controlam junto com você.',
    })
    // Não fala dos minutos (ainda sobram) e não repete o título de outra tela.
    expect(LIMIT_COPY['live-devices'].title).not.toMatch(/minutos|acabaram/)
    expect(LIMIT_COPY['live-devices'].body).not.toMatch(/minutos|acabaram/)
    const titles = LIMIT_SCREEN_KINDS.map((k) => LIMIT_COPY[k].title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('o título das separações não leva número, porque o admin pode dar separações a mais (R11)', () => {
    expect(LIMIT_COPY.separations.title).toBe('As separações deste mês acabaram')
    expect(LIMIT_COPY.separations.title).not.toMatch(/\d/)
  })

  it('o preço cheio depois do primeiro mês sai de PRICES, sem preço escrito à mão (R15)', () => {
    expect(OFFER_COPY.after).toBe('Depois do primeiro mês, Pro R$ 49,90 e Studio R$ 119,90 por mês. Cancele quando quiser, com garantia de 7 dias.')
    expect(OFFER_COPY.after).toContain(`Pro R$ ${formatReais(PRICES.pro.monthly)}`)
    expect(OFFER_COPY.after).toContain(`Studio R$ ${formatReais(PRICES.studio.monthly)}`)
    expect(read('./limitCopy.ts')).not.toMatch(/49,90|119,90/)
  })

  it('formatCountdown(172800000) é 48:00:00 e negativo é 00:00:00', () => {
    expect(formatCountdown(172_800_000)).toBe('48:00:00')
    expect(formatCountdown(-5)).toBe('00:00:00')
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(172_799_000)).toBe('47:59:59')
    // Horas passam de 24 e de 99; o segundo quebrado arredonda pra cima (nunca 00:00:00 com a oferta no ar).
    expect(formatCountdown(49 * HOUR)).toBe('49:00:00')
    expect(formatCountdown(100 * HOUR + 61_000)).toBe('100:01:01')
    expect(formatCountdown(1)).toBe('00:00:01')
    expect(formatCountdown(Number.NaN)).toBe('00:00:00')
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe('00:00:00')
  })

  it('offerRemainingMs nunca é negativo e data estragada vale zero', () => {
    expect(offerRemainingMs(new Date(T0 + 1000).toISOString(), T0)).toBe(1000)
    expect(offerRemainingMs(new Date(T0 - 1000).toISOString(), T0)).toBe(0)
    expect(offerRemainingMs('não é data', T0)).toBe(0)
    expect(offerRemainingMs(new Date(T0 + 1000).toISOString(), Number.NaN)).toBe(0)
  })

  it('nenhum travessão e nenhum stems nos textos', () => {
    const texts = [
      ...LIMIT_SCREEN_KINDS.flatMap((k) => [LIMIT_COPY[k].title, LIMIT_COPY[k].body]),
      OFFER_COPY.heading, OFFER_COPY.pro('24,90'), OFFER_COPY.studio('59,90'), OFFER_COPY.after,
      OFFER_COPY.clock('47:59:59'), OFFER_COPY.seePlans, OFFER_COPY.plans, OFFER_COPY.later,
    ]
    for (const t of texts) {
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(/stems?/i)
    }
    for (const offer of [active(T0 + 48 * HOUR), { status: 'none' } as const, { status: 'loading' } as const]) {
      for (const k of LIMIT_SCREEN_KINDS) {
        const r = render(<LimitScreen {...props({ kind: k, offer, error: 'Não deu pra abrir o pagamento.' })} />)
        expect(r.baseElement.innerHTML).not.toContain(TRAVESSAO)
        expect(r.baseElement.textContent).not.toMatch(/stems?/i)
        r.unmount()
      }
    }
    expect(read('./limitCopy.ts')).not.toContain(TRAVESSAO)
    expect(read('./LimitScreen.tsx')).not.toContain(TRAVESSAO)
  })
})

describe('LimitScreen com a oferta do primeiro mês', () => {
  it('com a oferta ativa mostra Pro por R$ 24,90, Studio por R$ 59,90 e o relógio 47:59:59', () => {
    render(<LimitScreen {...props({ offer: active(T0 + 48 * HOUR - 1000) })} />)
    expect(screen.getByText(OFFER_COPY.heading)).toBeTruthy()
    expect(timer()?.textContent).toBe('Termina em 47:59:59')
    expect(proButton().disabled).toBe(false)
    expect(studioButton().disabled).toBe(false)
    expect(screen.getByText(OFFER_COPY.after)).toBeTruthy()
    expect(actionNames()).toEqual(['Assinar o Pro por R$ 24,90', 'Assinar o Studio por R$ 59,90', 'Agora não', 'Ver todos os planos'])
    // Um título só: o da oferta não é outro heading.
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  it('o Pro é o botão principal laranja e o relógio é número neutro, não alerta', () => {
    render(<LimitScreen {...props({ offer: active(T0 + 48 * HOUR) })} />)
    expect(proButton().className).toContain('bg-ps-or')
    expect(studioButton().className).not.toContain('bg-ps-or')
    expect(button('Ver todos os planos').className).not.toContain('bg-ps-or')
    const clock = timer() as HTMLElement
    expect(clock.className).toContain('ps-num')
    expect(clock.className).not.toMatch(/ps-alert|text-ps-or/)
  })

  it('o relógio anda e, ao zerar, a oferta some e ficam Ver os planos e Agora não', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const setSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    render(<LimitScreen {...props({ now: undefined, offer: active(T0 + 3000) })} />)
    expect(timer()?.textContent).toBe('Termina em 00:00:03')
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy.mock.calls[0][1]).toBe(1000)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(timer()?.textContent).toBe('Termina em 00:00:02')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(timer()?.textContent).toBe('Termina em 00:00:01')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(timer()).toBeNull()
    expect(screen.queryByText(OFFER_COPY.heading)).toBeNull()
    expect(dialog().textContent).not.toContain('R$')
    expect(actionNames()).toEqual(['Agora não', 'Ver os planos'])
    // Sem oferta no ar o relógio para.
    expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[0].value)
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('48 horas de relógio: com o tempo do aparelho andando, um minuto depois mostra 47:59:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    render(<LimitScreen {...props({ now: undefined, offer: active(T0 + 48 * HOUR) })} />)
    expect(timer()?.textContent).toBe('Termina em 48:00:00')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(timer()?.textContent).toBe('Termina em 47:59:00')
  })

  it('a oferta que chega depois do carregando começa no relógio de agora, não no da abertura', () => {
    let clock = T0
    const now = () => clock
    const r = render(<LimitScreen {...props({ now, offer: { status: 'loading' } })} />)
    clock = T0 + 5000 // a resposta do servidor demorou 5 s
    r.rerender(<LimitScreen {...props({ now, offer: active(clock + 48 * HOUR) })} />)
    expect(timer()?.textContent).toBe('Termina em 48:00:00')
  })

  it('sem oferta mostra só Ver os planos e Agora não', () => {
    const setSpy = vi.spyOn(window, 'setInterval')
    const p = props({ offer: { status: 'none' } })
    render(<LimitScreen {...p} />)
    expect(actionNames()).toEqual(['Agora não', 'Ver os planos'])
    expect(button('Ver os planos').className).toContain('bg-ps-or')
    expect(dialog().textContent).not.toContain('R$')
    expect(timer()).toBeNull()
    // Sem oferta não há relógio andando.
    expect(setSpy).not.toHaveBeenCalled()
    fireEvent.click(button('Ver os planos'))
    expect(p.onSeePlans).toHaveBeenCalledTimes(1)
    fireEvent.click(button('Agora não'))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(p.onChoose).not.toHaveBeenCalled()
  })

  it('oferta ativa que já venceu, ou com data estragada, abre como sem oferta', () => {
    for (const expiresAt of [new Date(T0 - 1).toISOString(), new Date(T0).toISOString(), 'amanhã']) {
      const r = render(<LimitScreen {...props({ offer: { status: 'active', expiresAt, prices: PRICES_OFFER } })} />)
      expect(actionNames()).toEqual(['Agora não', 'Ver os planos'])
      expect(timer()).toBeNull()
      r.unmount()
    }
  })

  it('carregando a oferta não mostra preço nenhum', () => {
    render(<LimitScreen {...props({ offer: { status: 'loading' } })} />)
    expect(dialog().textContent).not.toContain('R$')
    expect(screen.queryByText(OFFER_COPY.heading)).toBeNull()
    expect(timer()).toBeNull()
    expect(actionNames()).toEqual(['Agora não', 'Ver os planos'])
  })

  it('escolher o Pro chama onChoose com essencial_mensal; busyPlan desliga os dois', () => {
    const p = props({ offer: active(T0 + 48 * HOUR) })
    const r = render(<LimitScreen {...p} />)
    fireEvent.click(proButton())
    expect(p.onChoose).toHaveBeenLastCalledWith('essencial_mensal')
    fireEvent.click(studioButton())
    expect(p.onChoose).toHaveBeenLastCalledWith('pro_mensal')
    expect(p.onChoose).toHaveBeenCalledTimes(2)

    r.rerender(<LimitScreen {...p} busyPlan="essencial_mensal" />)
    expect(proButton().disabled).toBe(true)
    expect(studioButton().disabled).toBe(true)
    expect(proButton().getAttribute('aria-busy')).toBe('true')
    expect(studioButton().getAttribute('aria-busy')).toBeNull()
    fireEvent.click(proButton())
    fireEvent.click(studioButton())
    expect(p.onChoose).toHaveBeenCalledTimes(2)
    // Dá pra sair enquanto o pagamento abre.
    expect(button('Agora não').disabled).toBe(false)
    expect(button('Ver todos os planos').disabled).toBe(false)

    r.rerender(<LimitScreen {...p} busyPlan="pro_mensal" />)
    expect(studioButton().getAttribute('aria-busy')).toBe('true')
    expect(proButton().disabled).toBe(true)
  })

  it('Ver todos os planos chama onSeePlans e Agora não fecha', () => {
    const p = props({ offer: active(T0 + 48 * HOUR) })
    render(<LimitScreen {...p} />)
    fireEvent.click(button('Ver todos os planos'))
    expect(p.onSeePlans).toHaveBeenCalledTimes(1)
    fireEvent.click(button('Agora não'))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })

  it('o erro aparece dentro da tela e nenhum alert é chamado', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const p = props({ offer: active(T0 + 48 * HOUR) })
    const r = render(<LimitScreen {...p} />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(proButton())
    r.rerender(<LimitScreen {...p} error="Não deu pra abrir o pagamento. Confira a internet e tente de novo." />)
    const msg = screen.getByRole('alert')
    expect(msg.textContent).toBe('Não deu pra abrir o pagamento. Confira a internet e tente de novo.')
    expect(dialog().contains(msg)).toBe(true)
    expect(msg.className).toContain('text-ps-alert')
    // Com o erro, a oferta continua e dá pra tentar de novo.
    expect(proButton().disabled).toBe(false)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('o erro também aparece sem oferta', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<LimitScreen {...props({ error: 'A oferta terminou. Veja os planos pelo preço de sempre.' })} />)
    expect(screen.getByRole('alert').textContent).toBe('A oferta terminou. Veja os planos pelo preço de sempre.')
    expect(alertSpy).not.toHaveBeenCalled()
  })
})

describe('a tela de limite só aparece com a música parada (fila da T6)', () => {
  const playing: EngineBusy = { isPlaying: true, isCountingIn: false }
  const countIn: EngineBusy = { isPlaying: false, isCountingIn: true }
  const stopped: EngineBusy = { isPlaying: false, isCountingIn: false }
  const view = (q: QuietQueue<LimitScreenKind>) =>
    q.shown ? <LimitScreen {...props({ kind: q.shown, offer: active(T0 + 48 * HOUR) })} /> : <p>palco</p>

  it('pedida tocando ou na pré-contagem, só aparece quando a música para, e sai se ela volta a tocar', () => {
    let q: QuietQueue<LimitScreenKind> = { pending: null, shown: null }
    q = queueRequest(q, 'stage-songs', isQuiet(playing))
    const r = render(view(q))
    expect(screen.queryByRole('dialog')).toBeNull()

    q = queueSettle(q, isQuiet(countIn))
    r.rerender(view(q))
    expect(screen.queryByRole('dialog')).toBeNull()

    q = queueSettle(q, isQuiet(stopped))
    r.rerender(view(q))
    expect(screen.getByRole('dialog', { name: LIMIT_COPY['stage-songs'].title })).toBeTruthy()

    // A banda dá play (ou começa a pré-contagem) com a tela aberta: ela sai e não volta sozinha.
    q = queueSettle(q, isQuiet(countIn))
    r.rerender(view(q))
    expect(screen.queryByRole('dialog')).toBeNull()
    q = queueSettle(q, isQuiet(stopped))
    r.rerender(view(q))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Pedido na pré-contagem também espera.
    q = queueRequest(q, 'live', isQuiet(countIn))
    r.rerender(view(q))
    expect(screen.queryByRole('dialog')).toBeNull()
    q = queueSettle(q, isQuiet(stopped))
    r.rerender(view(q))
    expect(screen.getByRole('dialog', { name: LIMIT_COPY.live.title })).toBeTruthy()
  })

  it('com a tela aberta, Espaço não chega ao atalho de tocar do palco', () => {
    const onStageKey = vi.fn()
    window.addEventListener('keydown', onStageKey)
    try {
      render(<LimitScreen {...props({ offer: active(T0 + 48 * HOUR) })} />)
      fireEvent.keyDown(proButton(), { key: ' ', code: 'Space' })
      expect(onStageKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onStageKey)
    }
  })
})

// Junção da 1b com as faixas B e C: a janela do palco ganhou a pilha (Esc e toque fora só na de
// cima, foco na de cima). A tela de limite aberta por cima de outra janela (o Metrônomo) segue.
describe('tela de limite por cima de outra janela do palco', () => {
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const metronome = (onClose: () => void, patch: { closeDisabled?: boolean } = {}) => (
    <StageDialog open title="Metrônomo" onClose={onClose} {...patch}><button type="button">TAP TEMPO</button></StageDialog>
  )
  const withLimit = (metroClose: () => void, limitProps: LimitScreenProps | null, patch: { closeDisabled?: boolean } = {}) => (
    <>
      {metronome(metroClose, patch)}
      {limitProps ? <LimitScreen {...limitProps} /> : null}
    </>
  )

  it('aparece por cima, pega o foco e um Esc fecha só ela; o seguinte fecha a de baixo', () => {
    const metroClose = vi.fn()
    const p = props({ kind: 'live', offer: active(T0 + 48 * HOUR) })
    const { container, rerender } = render(withLimit(metroClose, null))
    rerender(withLimit(metroClose, p))
    const [below, above] = Array.from(container.children) as HTMLElement[]
    expect(Number(above.style.zIndex)).toBeGreaterThan(120)
    expect(below.style.zIndex).toBe('')
    expect(above.contains(document.activeElement)).toBe(true)
    esc()
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(metroClose).not.toHaveBeenCalled()
    rerender(withLimit(metroClose, null))
    expect(below.contains(document.activeElement)).toBe(true)
    esc()
    expect(metroClose).toHaveBeenCalledTimes(1)
  })

  it('toque fora fecha só a tela de limite, e os botões dela continuam funcionando', () => {
    const metroClose = vi.fn()
    const p = props({ kind: 'stage-songs', offer: active(T0 + 48 * HOUR) })
    const { container, rerender } = render(withLimit(metroClose, null))
    rerender(withLimit(metroClose, p))
    fireEvent.click(proButton())
    expect(p.onChoose).toHaveBeenCalledWith('essencial_mensal')
    fireEvent.click(button('Ver todos os planos'))
    expect(p.onSeePlans).toHaveBeenCalledTimes(1)
    const above = container.children[1] as HTMLElement
    fireEvent.pointerDown(above)
    fireEvent.click(above)
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(metroClose).not.toHaveBeenCalled()
  })

  it('por cima do Metrônomo gerando o click (que não fecha), o Esc ainda fecha a tela de limite', () => {
    const metroClose = vi.fn()
    const p = props({ kind: 'separations' })
    const { rerender } = render(withLimit(metroClose, null, { closeDisabled: true }))
    rerender(withLimit(metroClose, p, { closeDisabled: true }))
    esc()
    expect(p.onClose).toHaveBeenCalledTimes(1)
    rerender(withLimit(metroClose, null, { closeDisabled: true }))
    esc()
    expect(metroClose).not.toHaveBeenCalled()
  })
})
