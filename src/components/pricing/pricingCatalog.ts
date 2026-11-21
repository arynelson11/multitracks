// Os 4 cartões da tela de Planos e os textos dela (PricingModal + PricingView), fora do componente.
// Preços pelos PRICES (src/content/site.ts, a tabela que segue o servidor e o FATOS) com formatReais:
// o cartão não desalinha do preço cobrado. Nomes, descrições e recursos são os de antes.
import { PRICES } from '../../content/site'
import { annualPerMonth, formatReais } from '../../lib/prices'
import type { CheckoutPlanKey } from '../../lib/checkout'

export interface PricingPlan {
  planKey: CheckoutPlanKey
  name: string
  price: string
  period: '/mês' | '/ano'
  description: string
  features: readonly string[]
  /** "Mais Popular": o Pro Mensal, a ação principal da tela. */
  popular: boolean
  /** Aceita a oferta do primeiro mês (só os dois mensais; o anual nunca). */
  offerable: boolean
}

export const reais = (value: number): string => `R$ ${formatReais(value)}`

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    planKey: 'essencial_mensal',
    name: 'Pro Mensal',
    price: reais(PRICES.pro.monthly),
    period: '/mês',
    description: 'Pra equipe que toca toda semana',
    features: ['Separação em 2, 4 e 6 faixas', 'Download em WAV e MP3', 'BPM pela IA, voz guia e pads', 'Modo Ao Vivo com até 4 celulares no controle'],
    popular: true,
    offerable: true,
  },
  {
    planKey: 'essencial_anual',
    name: 'Pro Anual',
    price: reais(PRICES.pro.annualTotal),
    period: '/ano',
    description: 'Pra equipe que toca toda semana',
    features: ['Tudo do Pro Mensal', 'Modo Ao Vivo com até 4 celulares no controle', 'Loop infinito ao vivo', `Equivale a ${reais(annualPerMonth(PRICES.pro.annualTotal))}/mês`],
    popular: false,
    offerable: false,
  },
  {
    planKey: 'pro_mensal',
    name: 'Studio Mensal',
    price: reais(PRICES.studio.monthly),
    period: '/mês',
    description: 'Pra quem leva o ao vivo a sério',
    features: ['Tudo do Pro', 'Modo Ao Vivo sem limite de aparelhos', 'A banda controla loop e seções pelo celular', '150 separações de faixas por mês'],
    popular: false,
    offerable: true,
  },
  {
    planKey: 'pro_anual',
    name: 'Studio Anual',
    price: reais(PRICES.studio.annualTotal),
    period: '/ano',
    description: 'Pra quem leva o ao vivo a sério',
    features: ['Tudo do Studio Mensal', 'Modo Ao Vivo sem limite de aparelhos', 'Controle total pela banda', `Equivale a ${reais(annualPerMonth(PRICES.studio.annualTotal))}/mês`],
    popular: false,
    offerable: false,
  },
]

export const PRICING_COPY = {
  title: 'Escolha seu Plano',
  subtitle: 'Desbloqueie todo o poder do seu estúdio em nuvem',
  subtitleSwitch: 'Trocar de plano: o novo é cobrado cheio e o atual termina na hora, sem proporcional.',
  popular: 'Mais Popular',
  subscribe: 'Assinar Agora',
  processing: 'Processando...',
  current: 'Seu plano atual',
  firstMonth: 'Primeiro mês por',
  after: (price: string, period: string) => `Depois ${price}${period}. Cancele quando quiser.`,
  opened: 'Abrimos o pagamento no seu navegador. Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes.',
  switchTitle: 'Trocar de plano?',
  switchBody: (name: string, price: string, period: string, current: string) =>
    `O ${name} é cobrado cheio agora (${price}${period}). O ${current} termina na hora, assim que o novo for pago, sem desconto proporcional do que já foi pago.`,
  back: 'Voltar',
  confirmSwitch: 'Confirmar troca',
  loginNeeded: 'Por favor, faça login para assinar um plano.',
  // O "\n" de antes entre a frase e o motivo vira duas frases.
  network: (reason: string) => `Não foi possível conectar com o servidor.${reason ? ` ${reason}` : ''}`,
} as const
