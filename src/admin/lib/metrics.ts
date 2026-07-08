// Câmbio estimado (rotular como estimativa na UI). Sem API de câmbio (YAGNI).
export const USD_BRL = 5.4;

// Receita mensal-equivalente por plano (espelha PLAN_PRICING de checkout.ts;
// anual dividido por 12). Fonte para receita aproximada por usuário.
export const PLAN_MONTHLY_BRL: Record<string, number> = {
  free: 0,
  essencial_mensal: 49.90,
  essencial_anual: 37.90,
  pro_mensal: 119.90,
  pro_anual: 89.90,
};

export function planMonthlyBRL(plan: string | null | undefined): number {
  return PLAN_MONTHLY_BRL[(plan ?? 'free')] ?? 0;
}

export function usdToBRL(usd: number): number {
  return (usd || 0) * USD_BRL;
}

// Margem mensal por usuário: receita (exata se houver, senão aproximada pelo
// plano) menos custo de IA convertido em BRL.
export function userMarginBRL(args: { plan: string; costUSD: number; exactMonthlyBRL?: number }): number {
  const revenue = args.exactMonthlyBRL ?? planMonthlyBRL(args.plan);
  return revenue - usdToBRL(args.costUSD);
}
