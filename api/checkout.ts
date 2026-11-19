/// <reference types="node" />
import axios from 'axios';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyCors } from './_lib/cors.js';
import { BLOCKED_MESSAGE, verifyUser } from './_lib/auth.js';
import { PLAN_PRICING, isPlanKey } from './_lib/pricing.js';
import { asaasBaseUrl, asaasFromEnv } from './_lib/asaas.js';
import { BillingError, accountSubscriptionCount, brtToday, cancelSubscriptionForUser, previewCancellation, runPendingActions } from './_lib/billing.js';
import {
  OFFER_PRICING, isAdKind, isAdPlacement, isOfferPlan, isOfferTrigger, offerCheckoutItem, readOffer, readOfferWindow,
  recordAdEvent, type OfferAnswer, type OfferPlanKey, type OfferStatus,
} from './_lib/offer.js';

// Ações de cobrança do usuário logado:
//   POST /api/checkout                 cria o checkout hospedado do Asaas (padrão)
//   POST /api/checkout?action=cancel   cancela a assinatura de quem está logado
//   POST /api/checkout?action=cancel-preview  diz o que o cancelamento faria (sem mudar nada)
//   POST /api/checkout?action=sync     no login: tenta de novo as pendências do usuário com o Asaas
//   POST /api/checkout?action=offer    estado da oferta do primeiro mês (com open, a tela de limite abre a janela)
//   POST /api/checkout?action=track    anúncio da casa visto ou clicado (funil do admin)
// Criar checkout com offer: true cobra o primeiro mês com desconto, conferido aqui (api/_lib/offer.ts).
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

    // Conta bloqueada pelo admin não assina nem vê oferta; cancelar, prévia e sync seguem acima (D10).
    if (auth.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE });

    const body = parseBody(req);
    if (action === 'offer') return offerForUser(userId, body, res);
    if (action === 'track') return trackForUser(userId, body, res);
    if (action) return res.status(400).json({ error: 'Invalid action' });

    const planKey = typeof body.planKey === 'string' ? body.planKey : '';

    if (!isPlanKey(planKey)) {
      return res.status(400).json({ error: 'Invalid planKey' });
    }
    const plan = PLAN_PRICING[planKey];
    // Oferta do primeiro mês: só com offer === true. App antigo não manda o campo (preço cheio).
    if (body.offer != null && typeof body.offer !== 'boolean') {
      return res.status(400).json({ error: MSG_BAD_REQUEST });
    }
    let offerPlan: OfferPlanKey | null = null;
    if (body.offer === true) {
      if (!isOfferPlan(planKey)) {
        return res.status(400).json({ error: 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.' });
      }
      offerPlan = planKey;
    }

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

    // Com a oferta, o servidor confere tudo antes de abrir o pagamento. Sem direito ou sem
    // janela: 409 com offerEnded e nada no Asaas (o app mostra o preço cheio e a pessoa
    // decide). Nunca cobra o preço cheio por baixo.
    let offer: { month: string; item: ReturnType<typeof offerCheckoutItem> } | null = null;
    if (offerPlan) {
      const checked = await checkOfferForCheckout(db, userId, new Date());
      if (checked.kind === 'error') return res.status(checked.status).json(checked.body);
      offer = { month: checked.month, item: offerCheckoutItem(offerPlan) };
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
      // Com a oferta, o item (e a assinatura que o Asaas cria dele) sai com o valor do primeiro
      // mês e o texto diz o preço de depois; depois do primeiro pagamento o servidor troca a
      // assinatura pro preço cheio.
      items: [offer
        ? { ...offer.item, quantity: 1 }
        : { name: plan.description, description: plan.description, quantity: 1, value: plan.value }],
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
        // Com a oferta: o mês da janela e o valor cobrado (o webhook marca a oferta como usada
        // e agenda a volta ao preço cheio). Sem a oferta, as duas colunas nem vão.
        const { error: linkErr } = await db.from('pending_checkouts').insert({
          id: checkoutId, user_id: userId, plan_key: planKey, switch_confirmed: body.confirmedSwitch === true,
          created_at: new Date().toISOString(), // decide entre planos diferentes pagos juntos
          ...(offer ? { offer_month: offer.month, offer_value: offer.item.value } : {}),
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
const MSG_BAD_REQUEST = 'Pedido inválido.';
const MSG_OFFER_FIRST_ONLY = 'A oferta do primeiro mês vale só na primeira assinatura da conta.';
const MSG_OFFER_ENDED = 'A oferta do primeiro mês terminou. O preço agora é o cheio.';

type OfferCheck =
  | { kind: 'ok'; month: string }
  | { kind: 'error'; status: number; body: { error: string; offerEnded?: true } };

// A conta tem direito ao desconto agora? Primeira assinatura da conta (mesma regra do
// arrependimento, lida uma vez) e janela aberta no registro, lida sem abrir janela nova.
// Falha do banco (assinaturas, registro da oferta, inclusive o SQL ainda não rodado, ou
// resposta fora do formato): 500, nada no Asaas, a pessoa tenta de novo (nunca a frase falsa
// de oferta terminada). O 409 de oferta terminada é só quando o registro diz que não há janela.
async function checkOfferForCheckout(db: SupabaseClient, userId: string, now: Date): Promise<OfferCheck> {
  const down = { kind: 'error', status: 500, body: { error: MSG_CHECKOUT_DOWN } } as const;
  let count: number;
  try {
    count = await accountSubscriptionCount(db, userId);
  } catch (e) {
    console.error('[checkout] nao deu pra conferir a primeira assinatura:', e instanceof Error ? e.message : 'erro');
    return down;
  }
  if (count > 0) return { kind: 'error', status: 409, body: { error: MSG_OFFER_FIRST_ONLY, offerEnded: true } };
  let answer: OfferAnswer;
  try {
    answer = await readOfferWindow(db, userId, { open: false, now });
  } catch (e) {
    console.error('[checkout] nao deu pra conferir a oferta:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return down;
  }
  if (answer.status !== 'active' || !answer.month || !(Date.parse(answer.expiresAt ?? '') > now.getTime())) {
    return { kind: 'error', status: 409, body: { error: MSG_OFFER_ENDED, offerEnded: true } };
  }
  return { kind: 'ok', month: answer.month };
}

// Estado da oferta de QUEM ESTÁ LOGADO. Com open: true (só a tela de limite), abre a janela
// do mês se ainda não houver, com o limite que a abriu em trigger. Qualquer erro de banco:
// 200 sem oferta (status none), pra tela abrir com o preço cheio.
async function offerForUser(userId: string, body: Record<string, any>, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const open = body.open === true;
  if (open && !isOfferTrigger(body.trigger)) return res.status(400).json({ error: MSG_BAD_REQUEST });
  let answer: { status: OfferStatus; expiresAt: string | null } = { status: 'none', expiresAt: null };
  const db = serviceDb();
  if (db) {
    try {
      const read = await readOffer(db, userId, { open, trigger: open ? body.trigger : undefined, now: new Date() });
      answer = { status: read.status, expiresAt: read.expiresAt };
    } catch (e) {
      console.warn('[checkout:offer] sem oferta:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    }
  }
  return res.status(200).json({ ...answer, prices: OFFER_PRICING });
}

// Anúncio da casa visto ou clicado por QUEM ESTÁ LOGADO (a conta vem só do login, nunca do
// corpo). ok falso: já tinha o mesmo no dia ou o banco falhou.
async function trackForUser(userId: string, body: Record<string, any>, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!isAdKind(body.kind) || !isAdPlacement(body.placement)) return res.status(400).json({ error: MSG_BAD_REQUEST });
  const db = serviceDb();
  if (!db) return res.status(200).json({ ok: false });
  return res.status(200).json({ ok: await recordAdEvent(db, userId, body.kind, body.placement, new Date()) });
}

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
