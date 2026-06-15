/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

// Webhook do Asaas: confirma o pagamento e ativa o plano no Supabase.
// Autenticação: o Asaas envia, em todo POST, o header `asaas-access-token` com
// o valor que você cadastra no painel (igual ao ASAAS_WEBHOOK_TOKEN aqui).
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_PLANS = new Set(['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']);

// Eventos que significam "dinheiro confirmado" -> ativa/renova o plano.
const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// externalReference foi gravado como `${userId}::${planKey}` no checkout.
function parseRef(ref?: string): { userId: string; planKey: string } | null {
  if (!ref || !ref.includes('::')) return null;
  const [userId, planKey] = ref.split('::');
  if (!UUID_V4_RE.test(userId) || !VALID_PLANS.has(planKey)) return null;
  return { userId, planKey };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!webhookToken || !supabaseUrl || !serviceRoleKey) {
    console.error('[asaas-webhook] server misconfigured: missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Valida o token enviado pelo Asaas no header.
  const provided = typeof req.headers?.['asaas-access-token'] === 'string'
    ? req.headers['asaas-access-token'] as string
    : '';
  if (!provided || !safeEqualStr(provided, webhookToken)) {
    console.warn('[asaas-webhook] invalid or missing token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = typeof req.body === 'object' && req.body ? req.body : {};
    const event: string | undefined = payload?.event;
    const payment = payload?.payment ?? {};

    // Só agimos em pagamento confirmado. Outros eventos respondem 200 (ack) pra
    // o Asaas não reenviar, mas não alteram nada.
    if (!event || !PAID_EVENTS.has(event)) {
      return res.status(200).json({ received: true, ignored: event ?? 'no-event' });
    }

    const ref = parseRef(payment?.externalReference);
    if (!ref) {
      console.warn('[asaas-webhook] missing/invalid externalReference', { event });
      return res.status(200).json({ received: true, reason: 'no-ref' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from('profiles')
      .update({ plan: ref.planKey })
      .eq('id', ref.userId);

    if (error) {
      console.error('[asaas-webhook] supabase update failed:', error.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    console.log('[asaas-webhook] plan updated', { plan: ref.planKey });
    return res.status(200).json({ received: true, updated: true });
  } catch (error: any) {
    console.error('[asaas-webhook] handler error:', error?.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
