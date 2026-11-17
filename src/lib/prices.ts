// Contas de preço do site (texto em reais e desconto do anual), sem nada de navegador.

const cents = (n: number) => Math.round(n * 100)

// 1078.8 -> "1.078,80"
export function formatReais(value: number): string {
  const [int, dec] = (cents(value) / 100).toFixed(2).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

// Quanto o anual economiza em relação a 12 meses do mensal, em reais e em % inteiro arredondado.
export function annualSavings(monthly: number, annualTotal: number): { reais: number; percent: number } {
  const full = cents(monthly) * 12
  const saved = full - cents(annualTotal)
  return { reais: saved / 100, percent: Math.round((saved / full) * 100) }
}

// Valor por mês do plano anual, em reais (R$ 454,80 / 12 = R$ 37,90).
export function annualPerMonth(annualTotal: number): number {
  return Math.round(cents(annualTotal) / 12) / 100
}
