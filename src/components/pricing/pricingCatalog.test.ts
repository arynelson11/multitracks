import { describe, expect, it } from 'vitest'
import { PRICES } from '../../content/site'
import { PRICING_COPY, PRICING_PLANS, reais } from './pricingCatalog'
import { PLAN_PRICING } from '../../../api/_lib/pricing'

const plan = (name: string) => PRICING_PLANS.find((p) => p.name === name)!
const TRAVESSAO = String.fromCharCode(0x2014)

describe('catálogo dos Planos', () => {
  it('preços de hoje, pelos PRICES: R$ 49,90, R$ 454,80, R$ 119,90 e R$ 1.078,80; equivalências de R$ 37,90 e R$ 89,90 por mês', () => {
    expect(PRICING_PLANS.map((p) => [p.planKey, p.name, p.price, p.period])).toEqual([
      ['essencial_mensal', 'Pro Mensal', 'R$ 49,90', '/mês'],
      ['essencial_anual', 'Pro Anual', 'R$ 454,80', '/ano'],
      ['pro_mensal', 'Studio Mensal', 'R$ 119,90', '/mês'],
      ['pro_anual', 'Studio Anual', 'R$ 1.078,80', '/ano'],
    ])
    expect(plan('Pro Anual').features).toContain('Equivale a R$ 37,90/mês')
    expect(plan('Studio Anual').features).toContain('Equivale a R$ 89,90/mês')
    // A mesma tabela do site e do FATOS.
    expect(PRICES.pro).toMatchObject({ monthly: 49.9, annualTotal: 454.8 })
    expect(PRICES.studio).toMatchObject({ monthly: 119.9, annualTotal: 1078.8 })
  })

  it('o preço de cada cartão é o que o servidor cobra (PLAN_PRICING), com o mesmo período (inicio-2 Minor 8)', () => {
    for (const p of PRICING_PLANS) {
      const server = PLAN_PRICING[p.planKey]
      expect(p.price, p.planKey).toBe(reais(server.value))
      expect(p.period, p.planKey).toBe(server.cycle === 'YEARLY' ? '/ano' : '/mês')
      expect(p.name, p.planKey).toBe(server.label)
    }
    expect(PRICING_PLANS.map((p) => p.planKey).sort()).toEqual(Object.keys(PLAN_PRICING).sort())
  })

  it('nomes, descrições e recursos de hoje', () => {
    expect(plan('Pro Mensal').description).toBe('Pra equipe que toca toda semana')
    expect(plan('Studio Mensal').description).toBe('Pra quem leva o ao vivo a sério')
    expect(plan('Pro Mensal').features).toEqual(['Separação em 2, 4 e 6 faixas', 'Download em WAV e MP3', 'BPM pela IA, voz guia e pads', 'Modo Ao Vivo com até 4 celulares no controle'])
    expect(plan('Studio Mensal').features).toEqual(['Tudo do Pro', 'Modo Ao Vivo sem limite de aparelhos', 'A banda controla loop e seções pelo celular', '150 separações de faixas por mês'])
    expect(plan('Pro Anual').features.slice(0, 3)).toEqual(['Tudo do Pro Mensal', 'Modo Ao Vivo com até 4 celulares no controle', 'Loop infinito ao vivo'])
    expect(plan('Studio Anual').features.slice(0, 3)).toEqual(['Tudo do Studio Mensal', 'Modo Ao Vivo sem limite de aparelhos', 'Controle total pela banda'])
  })

  it('só Pro Mensal e Studio Mensal aceitam a oferta; Mais Popular só no Pro Mensal', () => {
    expect(PRICING_PLANS.filter((p) => p.offerable).map((p) => p.planKey)).toEqual(['essencial_mensal', 'pro_mensal'])
    expect(PRICING_PLANS.filter((p) => p.popular).map((p) => p.planKey)).toEqual(['essencial_mensal'])
  })

  it('textos de hoje, sem travessão', () => {
    expect(PRICING_COPY.after('R$ 49,90', '/mês')).toBe('Depois R$ 49,90/mês. Cancele quando quiser.')
    expect(PRICING_COPY.switchBody('Studio Mensal', 'R$ 119,90', '/mês', 'Pro Mensal')).toBe(
      'O Studio Mensal é cobrado cheio agora (R$ 119,90/mês). O Pro Mensal termina na hora, assim que o novo for pago, sem desconto proporcional do que já foi pago.',
    )
    expect(PRICING_COPY.network('Failed to fetch')).toBe('Não foi possível conectar com o servidor. Failed to fetch')
    expect(PRICING_COPY.network('')).toBe('Não foi possível conectar com o servidor.')
    expect(JSON.stringify(PRICING_PLANS)).not.toContain(TRAVESSAO)
  })
})
