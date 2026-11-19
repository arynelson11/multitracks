// Textos do anúncio da casa e do selo do Livre (Parte 3, spec seção 6). Resultado antes de
// recurso, sem prometer número de vendas, nenhum travessão. Quando aparecem fica em
// src/lib/livreRules.ts e em quem monta (AdSlot, barra do palco), nunca aqui.
import type { AdPlacement } from '../../lib/livreRules'

/** Lugares do cartão do anúncio da casa (os outros dois da lista são a tela de limite e o selo). */
export type HouseAdPlacement = Extract<AdPlacement, 'home' | 'separation-done'>

export interface HouseAdCopy {
  title: string
  /** Frase do resultado; o cartão do fim da separação não tem. */
  body?: string
  cta: string
  dismiss: string
}

/** Tela inicial, no máximo uma vez por dia. */
export const HOME_AD = {
  title: 'O que o Pro faz por você',
  body: 'Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio.',
  cta: 'Conhecer o Pro',
  dismiss: 'Agora não',
} as const satisfies HouseAdCopy

/** Ao lado do resultado de uma separação que acabou de terminar. */
export const SEPARATION_AD = {
  title: 'No Pro você baixa essas faixas e salva na nuvem',
  cta: 'Conhecer o Pro',
  dismiss: 'Agora não',
} as const satisfies HouseAdCopy

export const HOUSE_AD_COPY: Record<HouseAdPlacement, HouseAdCopy> = { home: HOME_AD, 'separation-done': SEPARATION_AD }

/** Número inteiro e não negativo; o que não é número vale 0. */
function count(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

/** Começo do selo, a forma curta da barra abaixo de 1280 px: "LIVRE · 2 de 3". Nunca mostra mais do que o limite. */
export function livreBadgeShort(used: number, limit: number): string {
  const max = count(limit)
  return `LIVRE · ${Math.min(count(used), max)} de ${max}`
}

/** O resto do selo, que a barra esconde abaixo de 1280 px (o nome do botão continua com o texto inteiro). */
export const LIVRE_BADGE_REST = ' músicas este mês'

/** Texto do selo: "LIVRE · 2 de 3 músicas este mês". */
export function livreBadgeText(used: number, limit: number): string {
  return livreBadgeShort(used, limit) + LIVRE_BADGE_REST
}
