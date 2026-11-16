/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { asaasFromEnv } from '../_lib/asaas.js'
import { handleAsaasEvent, isBillingEvent } from '../_lib/billing.js'

// Webhook do Asaas: checkout pago, assinatura (criada, alterada, inativada,
// removida) e cobranças (paga, vencida, estornada...). As regras ficam em
// api/_lib/billing.ts e o estado no banco (db/supabase_assinaturas.sql).
//
// Autenticação: o Asaas envia, em todo POST, o header `asaas-access-token`
// com o valor cadastrado no painel (igual ao ASAAS_WEBHOOK_TOKEN aqui).
// Idempotência: o `id` do evento ("evt_...") fica em asaas_webhook_events; um
// evento já processado responde 200 sem repetir nada. Além disso, cada passo é
// idempotente no banco (reenvio sem o mesmo id também não duplica).
// O Asaas só conta como entregue a resposta 200; qualquer outra entra em
// reenvio, e 15 falhas seguidas pausam a fila. Por isso só devolvemos 500
// quando tentar de novo pode resolver (banco ou Asaas fora do ar).

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

type Claim = 'new' | 'retry' | 'duplicate' | 'unknown'

async function claimEvent(db: SupabaseClient, id: string, event: string): Promise<Claim> {
  const { error } = await db.from('asaas_webhook_events').insert({ id, event })
  if (!error) return 'new'
  if (error.code !== '23505') {
    console.warn('[asaas-webhook] nao deu pra registrar o evento, seguindo sem idempotencia por id:', error.message)
    return 'unknown'
  }
  const { data } = await db.from('asaas_webhook_events').select('processed_at').eq('id', id).maybeSingle()
  return (data as { processed_at?: string | null } | null)?.processed_at ? 'duplicate' : 'retry'
}

export default async function handler(req: any, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN
  if (!webhookToken || !supabaseUrl || !serviceRoleKey) {
    console.error('[asaas-webhook] server misconfigured: missing env vars')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  const provided = typeof req.headers?.['asaas-access-token'] === 'string'
    ? req.headers['asaas-access-token'] as string
    : ''
  if (!provided || !safeEqualStr(provided, webhookToken)) {
    console.warn('[asaas-webhook] invalid or missing token')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const payload: Record<string, unknown> = typeof req.body === 'object' && req.body ? req.body : {}
  const event = payload.event
  if (!isBillingEvent(event)) {
    return res.status(200).json({ received: true, ignored: typeof event === 'string' ? event : 'no-event' })
  }

  const db = createClient(supabaseUrl, serviceRoleKey)
  const eventId = typeof payload.id === 'string' && payload.id ? payload.id : null

  try {
    if (eventId) {
      const claim = await claimEvent(db, eventId, event)
      if (claim === 'duplicate') return res.status(200).json({ received: true, duplicate: true })
    }

    const out = await handleAsaasEvent({ db, asaas: asaasFromEnv() }, payload)

    if (eventId) {
      const { error } = await db.from('asaas_webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', eventId)
      if (error) console.warn('[asaas-webhook] nao marcou o evento como processado:', error.message)
    }
    console.log('[asaas-webhook] processado', { event, result: out.result })
    return res.status(200).json({ received: true, ...out })
  } catch (error) {
    console.error('[asaas-webhook] handler error:', { event, message: error instanceof Error ? error.message : 'erro' })
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
