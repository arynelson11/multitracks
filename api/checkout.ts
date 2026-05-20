/// <reference types="node" />
import axios from 'axios';
import { applyCors } from './_lib/cors.js';

function parseBody(req: any): Record<string, any> {
  // Em runtimes recentes da Vercel, req.body pode chegar como string, Buffer ou undefined.
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

export default async function handler(req: any, res: any) {
  // Garante que qualquer falha retorne JSON válido (nunca HTML da Vercel).
  try {
    applyCors(req, res, 'POST,OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    const body = parseBody(req);
    const productId = typeof body.productId === 'string' ? body.productId : '';
    const userId    = typeof body.userId    === 'string' ? body.userId    : '';
    const email     = typeof body.email     === 'string' ? body.email     : '';

    if (!productId || !userId || !email) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing: { productId: !productId, userId: !userId, email: !email },
      });
    }

    const token = process.env.ABACATEPAY_ACCESS_TOKEN;
    if (!token) {
      console.error('[checkout] Missing ABACATEPAY_ACCESS_TOKEN');
      return res.status(500).json({ error: 'Server misconfiguration: ABACATEPAY_ACCESS_TOKEN' });
    }

    const api = axios.create({
      baseURL: 'https://api.abacatepay.com/v2',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000, // Falha rápido em vez de estourar o timeout do Vercel.
    });

    const baseUrl = process.env.VITE_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || req.headers.origin
      || 'http://localhost:5173';

    const completionUrl = `${baseUrl}/?payment=success`;
    const returnUrl     = `${baseUrl}/?payment=cancelled`;

    // Coleta de erros por tentativa — sempre devolve JSON com a resposta crua do AbacatePay
    // para que possamos ver no front exatamente o que a API rejeitou.
    const attempts: Array<{ endpoint: string; payload: any; error: any }> = [];

    // Tentativa 1: /v2/subscriptions/create com productId direto (produtos com cycle pré-criados).
    try {
      const payload = { productId, customer: { email }, returnUrl, completionUrl, metadata: { userId } };
      const response = await api.post('/subscriptions/create', payload);
      const url = response.data?.data?.url || response.data?.url;
      if (url) return res.status(200).json({ url });
      attempts.push({ endpoint: '/subscriptions/create', payload, error: { reason: 'no url', body: response.data } });
    } catch (err: any) {
      attempts.push({ endpoint: '/subscriptions/create', payload: 'see code', error: err?.response?.data || err?.message });
    }

    // Tentativa 2: /v2/checkouts/create com products[].
    try {
      const payload = {
        products: [{ productId, quantity: 1 }],
        customer: { email },
        returnUrl,
        completionUrl,
        metadata: { userId },
      };
      const response = await api.post('/checkouts/create', payload);
      const url = response.data?.data?.url || response.data?.url;
      if (url) return res.status(200).json({ url });
      attempts.push({ endpoint: '/checkouts/create', payload, error: { reason: 'no url', body: response.data } });
    } catch (err: any) {
      attempts.push({ endpoint: '/checkouts/create', payload: 'see code', error: err?.response?.data || err?.message });
    }

    // Tentativa 3: /v2/billing/create — schema oficial documentado (one-time, products inline).
    try {
      const payload = {
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        products: [{ externalId: productId, name: productId, description: productId, quantity: 1, price: 0 }],
        customer: { email },
        returnUrl,
        completionUrl,
      };
      const response = await api.post('/billing/create', payload);
      const url = response.data?.data?.url || response.data?.url;
      if (url) return res.status(200).json({ url });
      attempts.push({ endpoint: '/billing/create', payload, error: { reason: 'no url', body: response.data } });
    } catch (err: any) {
      attempts.push({ endpoint: '/billing/create', payload: 'see code', error: err?.response?.data || err?.message });
    }

    console.error('[checkout] all attempts failed:', JSON.stringify(attempts));
    return res.status(502).json({
      error: 'Failed to create checkout',
      details: attempts,
    });
  } catch (e: any) {
    // Última linha de defesa — qualquer crash inesperado retorna JSON.
    console.error('[checkout] unexpected handler error:', e?.message, e?.stack);
    return res.status(500).json({
      error: 'Unexpected handler error',
      message: e?.message || 'unknown',
    });
  }
}
