/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import axios from 'axios';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.ABACATEPAY_WEBHOOK_SECRET;
const abacatepayToken = process.env.ABACATEPAY_ACCESS_TOKEN;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRODUCT_NAME_TO_PLAN: Record<string, string> = {
  'essencial mensal': 'essencial_mensal',
  'essencial anual':  'essencial_anual',
  'pro mensal':       'pro_mensal',
  'pro anual':        'pro_anual',
};

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function verifyWithAbacatePay(resourceId: string): Promise<{ paid: boolean; productName?: string }> {
  if (!abacatepayToken) return { paid: false };
  const api = axios.create({
    baseURL: 'https://api.abacatepay.com/v2',
    headers: { Authorization: `Bearer ${abacatepayToken}` },
    timeout: 8000,
  });
  for (const path of [`/checkouts/${resourceId}`, `/subscriptions/${resourceId}`]) {
    try {
      const r = await api.get(path);
      const node = r.data?.data ?? r.data;
      const status = node?.status;
      if (status === 'PAID' || status === 'ACTIVE') {
        const productName: string | undefined =
          node?.products?.[0]?.name ?? node?.items?.[0]?.name;
        return { paid: true, productName };
      }
    } catch { /* try next path */ }
  }
  return { paid: false };
}

function mapPlan(productName?: string): string | null {
  if (!productName) return null;
  return PRODUCT_NAME_TO_PLAN[productName.trim().toLowerCase()] ?? null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey || !abacatepayToken) {
    console.error('[webhook] server misconfigured: missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const providedSecret = typeof req.query?.webhookSecret === 'string' ? req.query.webhookSecret : '';
  if (!providedSecret || !safeEqualStr(providedSecret, webhookSecret)) {
    console.warn('[webhook] invalid or missing secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = req.body ?? {};
    const eventName: string | undefined = payload?.event || payload?.type;
    const resourceId: string | undefined =
      payload?.data?.id ?? payload?.id ?? payload?.checkoutId ?? payload?.subscriptionId;
    const customerId: string | undefined =
      payload?.customerId ?? payload?.data?.customerId ?? payload?.metadata?.customerId;

    if (!resourceId || !customerId) {
      console.warn('[webhook] missing resourceId or customerId', { event: eventName });
      return res.status(200).json({ received: true, reason: 'no-id' });
    }
    if (!UUID_V4_RE.test(customerId)) {
      console.warn('[webhook] invalid customerId format');
      return res.status(400).json({ error: 'Invalid customerId' });
    }

    const verified = await verifyWithAbacatePay(resourceId);
    if (!verified.paid) {
      console.warn('[webhook] resource not confirmed as paid', { event: eventName });
      return res.status(200).json({ received: true, reason: 'not-paid' });
    }

    const planName = mapPlan(verified.productName);
    if (!planName) {
      console.error('[webhook] product not in whitelist', { productName: verified.productName });
      return res.status(200).json({ received: true, reason: 'unknown-product' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from('profiles')
      .update({ plan: planName })
      .eq('id', customerId);

    if (error) {
      console.error('[webhook] supabase update failed:', error.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    console.log('[webhook] plan updated', { plan: planName });
    return res.status(200).json({ received: true, updated: true });

  } catch (error: any) {
    console.error('[webhook] handler error:', error?.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
