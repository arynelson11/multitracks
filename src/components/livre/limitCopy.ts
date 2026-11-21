// Textos e contas da tela de limite do Livre (LimitScreen.tsx). Regra de copy do produto:
// o resultado antes do recurso, sem prometer número de vendas, nada técnico, nenhum travessão.
import type { LimitScreenKind } from '../../lib/livreRules'
import { PRICES } from '../../content/site'
import { formatReais } from '../../lib/prices'

// Um título e um texto por tela de limite. O das separações não leva o número: o admin pode dar
// separações a mais pra conta, e "as 3" ficaria falso (Ruling R11). O do celular a mais não fala
// dos minutos (ainda sobram): no Livre os outros celulares continuam acompanhando ("Só segue"),
// só 1 controla.
export const LIMIT_COPY: Record<LimitScreenKind, { title: string; body: string }> = {
  separations: {
    title: 'As separações deste mês acabaram',
    body: 'No Pro são 50 separações por mês, e cada instrumento chega pronto pro ensaio.',
  },
  'stage-songs': {
    title: 'Você já tocou 3 músicas diferentes este mês',
    body: 'No Pro o culto inteiro roda no palco, música atrás de música, sem contar nada.',
  },
  live: {
    title: 'Os 10 minutos de hoje com a banda acabaram',
    body: 'No Pro são até 4 celulares no controle, com a banda acompanhando o culto do começo ao fim.',
  },
  'live-devices': {
    title: 'No Livre, só 1 celular da banda controla o palco',
    body: 'No Pro e no Studio o culto segue sem ninguém correr até o computador: mais celulares da banda controlam junto com você.',
  },
  repertoire: {
    title: 'Montar o repertório é do Pro',
    body: 'No Pro você monta o culto em ordem e passa de uma música pra outra sem parar o palco.',
  },
  // Parte 3 (faixa D, P9): no palco, BAIXAR e SALVAR NA NUVEM do painel SEPARAÇÃO abrem esta mesma tela.
  download: {
    title: 'Baixar e salvar na nuvem é do Pro',
    body: 'No Pro cada músico leva a sua faixa pro ensaio, em WAV ou MP3, e a música fica salva na nuvem pra abrir em qualquer aparelho.',
  },
}

// A oferta do primeiro mês. Os preços com desconto vêm do servidor (OfferView); o preço cheio
// de depois sai de PRICES (src/content/site.ts), que segue o FATOS (Ruling R15).
export const OFFER_COPY = {
  heading: 'Primeiro mês com desconto',
  pro: (v: string) => `Assinar o Pro por R$ ${v}`,
  studio: (v: string) => `Assinar o Studio por R$ ${v}`,
  after: `Depois do primeiro mês, Pro R$ ${formatReais(PRICES.pro.monthly)} e Studio R$ ${formatReais(PRICES.studio.monthly)} por mês. Cancele quando quiser, com garantia de 7 dias.`,
  clock: (t: string) => `Termina em ${t}`,
  seePlans: 'Ver todos os planos',
  plans: 'Ver os planos',
  later: 'Agora não',
} as const

// O que a tela sabe da oferta. As chaves dos preços são as do checkout: `essencial_mensal` é o
// Pro Mensal e `pro_mensal` é o Studio Mensal.
export type OfferView =
  | { status: 'loading' }
  | { status: 'active'; expiresAt: string; prices: { essencial_mensal: number; pro_mensal: number } }
  | { status: 'none' }

// Quanto falta pra janela da oferta fechar. Nunca negativo; data estragada vale zero.
export function offerRemainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0
  return Math.max(0, end - now)
}

const two = (n: number) => String(n).padStart(2, '0')

// 'HH:MM:SS', com as horas passando de 24 (a janela é de 48 horas). O segundo quebrado conta
// inteiro, então com a oferta no ar o relógio nunca mostra 00:00:00. Negativo ou estragado: zero.
export function formatCountdown(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${two(h)}:${two(m)}:${two(s)}`
}
