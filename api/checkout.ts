/// <reference types="node" />
import axios from 'axios';
import { applyCors } from './_lib/cors.js';

// ── Tabela de preços (fonte única) ──
// O valor da assinatura é definido aqui, no backend, e enviado pro Asaas via
// API. Assim o preço não depende de produto configurado em painel (era a dor
// do AbacatePay). As chaves são os nomes internos usados em profiles.plan.
// Anual: `value` é o total cobrado uma vez por ano (ciclo YEARLY).
const PLAN_PRICING: Record<string, { value: number; cycle: 'MONTHLY' | 'YEARLY'; description: string }> = {
  essencial_mensal: { value: 49.90, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)' },
  essencial_anual:  { value: 454.80, cycle: 'YEARLY',  description: 'Playback Studio Pro (anual)' },
  pro_mensal:       { value: 119.90, cycle: 'MONTHLY', description: 'Playback Studio Studio (mensal)' },
  pro_anual:        { value: 1078.80, cycle: 'YEARLY', description: 'Playback Studio Studio (anual)' },
};

function parseBody(req: any): Record<string, any> {
  const raw = req?.body;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer?.(raw)) return raw;
  try {
    const str = Buffer.isBuffer?.(raw) ? raw.toString('utf8') : String(raw);
    return str ? JSON.parse(str) : {};
  } catch {
    return {};
  }
}

// Base da API conforme o ambiente. Sandbox por padrão; produção só quando
// ASAAS_ENV === 'production' (evita cobrar de verdade por engano em testes).
function asaasBaseUrl(): string {
  return process.env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

export default async function handler(req: any, res: any) {
  try {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    const body = parseBody(req);
    const planKey = typeof body.planKey === 'string' ? body.planKey : '';
    const userId  = typeof body.userId  === 'string' ? body.userId  : '';
    const email   = typeof body.email   === 'string' ? body.email   : '';

    const plan = PLAN_PRICING[planKey];
    if (!plan || !userId || !email) {
      return res.status(400).json({
        error: 'Missing or invalid fields',
        detail: { planKey: !plan, userId: !userId, email: !email },
      });
    }

    const apiKey = process.env.ASAAS_API_KEY;
    if (!apiKey) {
      console.error('[checkout] Missing ASAAS_API_KEY');
      return res.status(500).json({ error: 'Server misconfiguration: ASAAS_API_KEY' });
    }

    const api = axios.create({
      baseURL: asaasBaseUrl(),
      headers: { access_token: apiKey, 'Content-Type': 'application/json' },
      timeout: 9000,
    });

    const baseUrl = process.env.VITE_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || req.headers.origin
      || 'http://localhost:5173';

    // Data da 1ª cobrança = hoje (o cliente paga ao concluir o checkout).
    const today = new Date().toISOString().slice(0, 10);

    // Checkout hospedado do Asaas: coleta os dados do pagador (inclui CPF) na
    // própria página, cobra no cartão e cria a assinatura recorrente sozinho.
    const payload = {
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire: 60,
      callback: {
        successUrl: `${baseUrl}/?payment=success`,
        cancelUrl: `${baseUrl}/?payment=cancelled`,
        expiredUrl: `${baseUrl}/?payment=expired`,
      },
      items: [{ name: plan.description, description: plan.description, quantity: 1, value: plan.value }],
      subscription: { cycle: plan.cycle, nextDueDate: today },
      // Sem customerData: o checkout hospedado do Asaas coleta nome, CPF,
      // telefone e endereço do pagador na própria página (mais simples e seguro).
      // Liga o pagamento ao usuário e ao plano (lido no webhook).
      externalReference: `${userId}::${planKey}`,
    };

    try {
      const response = await api.post('/checkouts', payload);
      const data = response.data ?? {};
      const url = data.link || data.url || data.checkoutUrl || data?.data?.link;
      if (url) return res.status(200).json({ url });
      console.error('[checkout] no url in Asaas response:', JSON.stringify(data));
      return res.status(502).json({ error: 'Checkout criado sem URL', details: data });
    } catch (err: any) {
      const detail = err?.response?.data || err?.message;
      console.error('[checkout] Asaas error:', JSON.stringify(detail));
      return res.status(502).json({ error: 'Falha ao criar checkout no Asaas', details: detail });
    }
  } catch (e: any) {
    console.error('[checkout] unexpected handler error:', e?.message, e?.stack);
    return res.status(500).json({ error: 'Unexpected handler error', message: e?.message || 'unknown' });
  }
}
