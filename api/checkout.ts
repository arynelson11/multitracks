/// <reference types="node" />
import axios from 'axios';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyCors } from './_lib/cors.js';
import { verifyUser } from './_lib/auth.js';
import { PLAN_PRICING, isPlanKey } from './_lib/pricing.js';
import { asaasBaseUrl, asaasFromEnv } from './_lib/asaas.js';
import { BillingError, brtToday, cancelSubscriptionForUser, previewCancellation, runPendingActions } from './_lib/billing.js';

// Ações de cobrança do usuário logado:
//   POST /api/checkout                 cria o checkout hospedado do Asaas (padrão)
//   POST /api/checkout?action=cancel   cancela a assinatura de quem está logado
//   POST /api/checkout?action=cancel-preview  diz o que o cancelamento faria (sem mudar nada)
//   POST /api/checkout?action=sync     no login: tenta de novo as pendências do usuário com o Asaas
// O cancelamento mora aqui porque a Vercel do plano atual aceita no máximo 12
// funções em api/ e já são 12. Preços: api/_lib/pricing.ts (fonte única).

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

export default async function handler(req: any, res: any) {
  try {
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    // Autenticação: userId/email vêm SEMPRE do JWT, nunca do body.
    // Impede criar cobrança em nome de terceiros e poluir pending_checkouts.
    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const userId = auth.userId;

    const action = typeof req.query?.action === 'string' ? req.query.action : '';
    if (action === 'cancel') return cancelForUser(userId, res);
    if (action === 'cancel-preview') return previewForUser(userId, res);
    if (action === 'sync') return syncForUser(userId, res);
    if (action) return res.status(400).json({ error: 'Invalid action' });

    const body = parseBody(req);
    const planKey = typeof body.planKey === 'string' ? body.planKey : '';

    if (!isPlanKey(planKey)) {
      return res.status(400).json({ error: 'Invalid planKey' });
    }
    const plan = PLAN_PRICING[planKey];

    // Compra duplicada (duas abas, app antigo): já tem este plano ativo.
    const db = serviceDb();
    if (!db) return res.status(500).json({ error: MSG_CHECKOUT_DOWN });
    let duplicate: boolean;
    try {
      duplicate = await hasActiveSamePlan(db, userId, planKey);
    } catch (e) {
      console.error('[checkout] nao deu pra conferir assinatura ativa:', e instanceof Error ? e.message : 'erro');
      return res.status(500).json({ error: MSG_CHECKOUT_DOWN });
    }
    if (duplicate) {
      return res.status(409).json({
        error: `Você já tem o ${plan.label} ativo. Não precisa assinar de novo; para mudar, escolha outro plano.`,
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

    // Data da 1ª cobrança = hoje EM BRASÍLIA (o cliente paga ao concluir o
    // checkout). Antes era a data de UTC: depois das 21:00 ia a de amanhã.
    const today = brtToday(new Date());

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
      const checkoutId = data.id || data?.data?.id;
      if (url && checkoutId) {
        // Grava o vínculo checkout -> usuário/plano. O webhook CHECKOUT_PAID lê
        // isso pelo id do checkout (o Asaas não propaga nosso externalReference
        // pro pagamento/assinatura, então guardamos do nosso lado).
        // Sem o vínculo o pagamento não liga ao usuário: não entrega o link.
        // switch_confirmed: a pessoa confirmou "Trocar de plano?" (sem proporcional).
        const { error: linkErr } = await db.from('pending_checkouts').insert({
          id: checkoutId, user_id: userId, plan_key: planKey, switch_confirmed: body.confirmedSwitch === true,
          created_at: new Date().toISOString(), // decide entre planos diferentes pagos juntos
        });
        if (linkErr) {
          console.error('[checkout] failed to save pending_checkout:', linkErr.message);
          return res.status(500).json({ error: MSG_CHECKOUT_DOWN });
        }
        return res.status(200).json({ url });
      }
      // Detalhe do Asaas só no log, nunca no navegador.
      console.error('[checkout] resposta do Asaas sem link ou id:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: MSG_CHECKOUT_DOWN });
    } catch (err: any) {
      const detail = err?.response?.data || err?.message;
      console.error('[checkout] Asaas error:', JSON.stringify(detail)?.slice(0, 500));
      return res.status(502).json({ error: MSG_CHECKOUT_DOWN });
    }
  } catch (e: any) {
    console.error('[checkout] unexpected handler error:', e?.message);
    return res.status(500).json({ error: MSG_CHECKOUT_DOWN });
  }
}

const MSG_CHECKOUT_DOWN = 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.';

// Já existe assinatura ativa deste plano? (linha nova ou, pra quem assinou antes
// desta versão, o plano do perfil sem data de fim). Cancelada ainda no período
// pago pode assinar de novo.
async function hasActiveSamePlan(db: SupabaseClient, userId: string, planKey: string): Promise<boolean> {
  const subs = await db.from('billing_subscriptions').select('id')
    .eq('user_id', userId).eq('status', 'active').eq('kind', 'asaas').eq('plan_key', planKey);
  if (subs.error) throw new Error(subs.error.message);
  if (((subs.data as unknown[] | null) ?? []).length > 0) return true;
  const prof = await db.from('profiles').select('plan, plan_expires_at').eq('id', userId).maybeSingle();
  if (prof.error) throw new Error(prof.error.message);
  const p = prof.data as { plan?: string | null; plan_expires_at?: string | null } | null;
  return p?.plan === planKey && !p?.plan_expires_at;
}

// Cancela a assinatura de QUEM ESTÁ LOGADO (o id vem do JWT; o corpo do pedido é
// ignorado). Regras em api/_lib/billing.ts: até o fim do período pago, ou
// estorno e Livre na hora se for arrependimento em até 7 dias da primeira compra.
async function cancelForUser(userId: string, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    console.error('[checkout:cancel] missing Supabase env');
    return res.status(500).json({ error: 'O cancelamento está indisponível agora. Fale com a gente pelo WhatsApp.' });
  }
  try {
    const result = await cancelSubscriptionForUser(
      { db: createClient(supaUrl, serviceKey), asaas: asaasFromEnv(5000) },
      { userId, source: 'user' },
    );
    console.log('[checkout:cancel] ok', { result: result.result, refunded: result.refunded });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof BillingError) {
      // erro de banco antes de qualquer passo no Asaas: nada mudou; sem detalhe técnico pro usuário
      const message = e.code === 'db_error'
        ? 'Não deu para cancelar agora. Nada foi alterado. Tente de novo em alguns minutos.'
        : e.message;
      if (e.code === 'db_error') console.error('[checkout:cancel] db:', e.message);
      return res.status(e.httpStatus).json({ error: message, code: e.code });
    }
    console.error('[checkout:cancel] unexpected:', e instanceof Error ? e.message : 'erro');
    return res.status(500).json({ error: 'Não deu para cancelar agora. Nada foi alterado. Tente de novo em alguns minutos.' });
  }
}

function serviceDb() {
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supaUrl && serviceKey ? createClient(supaUrl, serviceKey) : null;
}

// O que o cancelamento faria pra QUEM ESTÁ LOGADO (tela de confirmação).
async function previewForUser(userId: string, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = serviceDb();
  if (!db) return res.status(500).json({ error: 'Indisponível agora.' });
  try {
    return res.status(200).json(await previewCancellation({ db, asaas: asaasFromEnv(5000) }, userId));
  } catch (e) {
    console.warn('[checkout:cancel-preview]', e instanceof Error ? e.message : 'erro');
    return res.status(502).json({ error: 'Não deu para consultar agora.' });
  }
}

// No login: tenta de novo as pendências deste usuário com o Asaas (best-effort).
async function syncForUser(userId: string, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = serviceDb();
  if (!db) return res.status(200).json({ ok: false });
  try {
    const out = await runPendingActions({ db, asaas: asaasFromEnv(5000) }, { userId, limit: 5 });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    console.warn('[checkout:sync]', e instanceof Error ? e.message : 'erro');
    return res.status(200).json({ ok: false });
  }
}
