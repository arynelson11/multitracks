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

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Valida o par userId/planKey (venha de onde vier) antes de ativar o plano.
function validRef(userId?: string, planKey?: string): boolean {
  return !!userId && !!planKey && UUID_V4_RE.test(userId) && VALID_PLANS.has(planKey);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!webhookToken || !supabaseUrl || !serviceRoleKey) {
    console.error('[asaas-webhook] server misconfigured: missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const provided = typeof req.headers?.['asaas-access-token'] === 'string'
    ? req.headers['asaas-access-token'] as string
    : '';
  if (!provided || !safeEqualStr(provided, webhookToken)) {
    // Diagnóstico temporário: compara formato sem expor os valores, pra
    // resolver desalinhamento de token entre Vercel e painel do Asaas.
    console.warn('[asaas-webhook] invalid or missing token');
    return res.status(401).json({
      error: 'Unauthorized',
      _diag: {
        envLen: webhookToken.length,
        envPrefix: webhookToken.slice(0, 6),
        gotLen: provided.length,
        gotPrefix: provided.slice(0, 6),
        match: provided === webhookToken,
      },
    });
  }

  try {
    const payload = typeof req.body === 'object' && req.body ? req.body : {};
    const event: string | undefined = payload?.event;

    // Ativamos o plano no CHECKOUT_PAID (1ª cobrança da assinatura concluída).
    if (event !== 'CHECKOUT_PAID') {
      return res.status(200).json({ received: true, ignored: event ?? 'no-event' });
    }

    const checkout = payload?.checkout ?? {};
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) Caminho principal: vínculo gravado por nós (checkout id -> user/plano).
    let userId: string | undefined;
    let planKey: string | undefined;
    if (checkout?.id) {
      const { data } = await supabase
        .from('pending_checkouts')
        .select('user_id, plan_key')
        .eq('id', checkout.id)
        .single();
      if (data) { userId = data.user_id; planKey = data.plan_key; }
    }

    // 2) Bônus: se o Asaas tiver propagado nosso externalReference, usa também.
    if (!validRef(userId, planKey) && typeof checkout?.externalReference === 'string' && checkout.externalReference.includes('::')) {
      const [u, p] = checkout.externalReference.split('::');
      userId = u; planKey = p;
    }

    if (!validRef(userId, planKey)) {
      console.warn('[asaas-webhook] could not resolve user/plan', { checkoutId: checkout?.id });
      return res.status(200).json({ received: true, reason: 'no-ref' });
    }

    const { error } = await supabase.from('profiles').update({ plan: planKey }).eq('id', userId);
    if (error) {
      console.error('[asaas-webhook] supabase update failed:', error.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    // Limpa o vínculo já consumido (não bloqueia o sucesso se falhar).
    if (checkout?.id) {
      await supabase.from('pending_checkouts').delete().eq('id', checkout.id);
    }

    console.log('[asaas-webhook] plan updated', { plan: planKey });
    return res.status(200).json({ received: true, updated: true });
  } catch (error: any) {
    console.error('[asaas-webhook] handler error:', error?.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
