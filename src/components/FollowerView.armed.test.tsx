// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FollowerView } from './FollowerView'
import { INITIAL_STATE, readHostState, type FollowerState } from '../hooks/useLiveSync'
import type { WsMessage } from '../types'

type HostStatePayload = Extract<WsMessage, { type: 'HOST_STATE' }>['payload']

const TRAVESSAO = String.fromCharCode(0x2014)

const BASE: FollowerState = {
  ...INITIAL_STATE,
  isPlaying: true,
  songName: 'Grande é o Senhor',
  currentMarker: { id: 'm1', time: 30, label: 'Verso', color: '#10b981' },
  nextMarkerLabel: 'Ponte',
  sections: [{ label: 'Verso', color: '#10b981' }, { label: 'Refrão', color: '#FF6B35' }, { label: 'Ponte', color: '#8b5cf6' }],
}

const show = (state: FollowerState) => render(<FollowerView state={state} isConnected sendCommand={() => {}} />)
const strip = () => screen.queryByTestId('faixa-armada')
const dots = () => screen.queryAllByTestId('bolinha-contagem')
const litDots = () => dots().filter((d) => d.getAttribute('data-acesa') === 'true')

afterEach(cleanup)

describe('celular vê o pulo armado e a contagem aproximada', () => {
  it('faixa mostra PRÓXIMA: Refrão e 2 de 4 bolinhas acesas', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: 2, countTotal: 4 })
    expect(strip()?.textContent).toContain('PRÓXIMA: Refrão')
    expect(dots()).toHaveLength(4)
    expect(litDots()).toHaveLength(2)
    // As acesas são as primeiras: a contagem anda da esquerda pra direita.
    expect(dots().map((d) => d.getAttribute('data-acesa'))).toEqual(['true', 'true', 'false', 'false'])
    expect(strip()?.textContent).not.toContain(TRAVESSAO)
  })

  it('faixa na cor da seção armada', () => {
    show({ ...BASE, armed: { index: 2, label: 'Ponte', color: '#8b5cf6', kind: 'proxima', plays: 1 }, countBeat: 1, countTotal: 4 })
    expect(strip()?.style.color).toBe('rgb(139, 92, 246)')
    expect(litDots()[0].style.backgroundColor).toBe('rgb(139, 92, 246)')
  })

  it('repetir a seção mostra REPETE: <seção>', () => {
    show({ ...BASE, armed: { index: 0, label: 'Verso', color: '#10b981', kind: 'repete', plays: 'infinite' }, countBeat: null, countTotal: 4 })
    expect(strip()?.textContent).toContain('REPETE: Verso')
    expect(strip()?.textContent).not.toContain('PRÓXIMA')
    // Antes do último compasso: as bolinhas aparecem apagadas.
    expect(dots()).toHaveLength(4)
    expect(litDots()).toHaveLength(0)
  })

  it('sem grade (sem contagem) a faixa aparece sem bolinhas', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: null, countTotal: null })
    expect(strip()?.textContent).toContain('PRÓXIMA: Refrão')
    expect(dots()).toHaveLength(0)
  })

  it('com pulo armado a próxima natural sai do topo pra não mostrar duas próximas', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: null, countTotal: 4 })
    expect(screen.queryByText('Ponte')).toBeNull()
  })

  it('contagem fora do normal não desenha bolinha sem fim', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: 5000, countTotal: 1e9 })
    expect(dots().length).toBeGreaterThan(0)
    expect(dots().length).toBeLessThanOrEqual(12)
    expect(litDots()).toHaveLength(dots().length)
  })

  it('tempo fracionário da contagem arredonda pra baixo (bolinhas e aria-label)', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: 2.5, countTotal: 4 })
    expect(litDots()).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Contagem 2 de 4' })).toBeTruthy()
  })

  it('sem cor na seção a faixa usa o bone neutro, não o laranja de ligado', () => {
    show({ ...BASE, armed: { index: 1, label: 'Refrão', color: '', kind: 'proxima', plays: 1 }, countBeat: 1, countTotal: 4 })
    expect(strip()?.style.color).toBe('rgb(232, 232, 236)')
    expect(litDots()[0].style.backgroundColor).toBe('rgb(232, 232, 236)')
  })

  it('sem nome na seção a faixa mostra só PRÓXIMA ou REPETE, sem os dois pontos', () => {
    show({ ...BASE, armed: { index: 1, label: '', color: '#FF6B35', kind: 'proxima', plays: 1 }, countBeat: null, countTotal: null })
    expect(strip()?.textContent?.trim()).toBe('PRÓXIMA')
    cleanup()
    show({ ...BASE, armed: { index: 0, label: '  ', color: '#10b981', kind: 'repete', plays: 2 }, countBeat: null, countTotal: null })
    expect(strip()?.textContent?.trim()).toBe('REPETE')
  })

  it('host antigo sem os campos vira null e não mostra a faixa', () => {
    // O que chega de um host da versão anterior: os três campos não existem.
    const antigo: Record<string, unknown> = { ...BASE }
    delete antigo.armed
    delete antigo.countBeat
    delete antigo.countTotal
    const state = readHostState(antigo as unknown as HostStatePayload, false)
    expect(state.armed).toBeNull()
    expect(state.countBeat).toBeNull()
    expect(state.countTotal).toBeNull()
    show(state)
    expect(strip()).toBeNull()
    expect(dots()).toHaveLength(0)
    // O resto da tela segue igual: a próxima natural continua no topo.
    expect(screen.getByText('Ponte')).toBeTruthy()
  })
})
