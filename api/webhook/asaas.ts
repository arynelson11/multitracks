/// <reference types="node" />
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'
import { asaasFromEnv } from '../_lib/asaas.js'
import { isBillingEvent, processStoredEvent, runDailyJob, runPendingActions, sanitizeAsaasPayload } from '../_lib/billing.js'
import { RECONCILE_CRON, runReconcile } from '../_lib/reconcile.js'

// Webhook do Asaas + job diário de cobrança.
//
// POST (Asaas): checkout pago, assinatura e cobranças. Autenticação pelo header
// `asaas-access-token` (= ASAAS_WEBHOOK_TOKEN, comparação em tempo constante).
// O evento é GRAVADO (sem dados de cartão) antes de processar e a resposta é
// 200 assim que está gravado: o que falhar no processamento (Asaas ou rede
// fora do ar) fica 'failed' e o job tenta de novo, sem travar a fila
// Sequencial do Asaas. Só autenticação errada responde 401; só falha ao gravar
// o evento responde 500 (aí o Asaas reenvia, que é o certo). Idempotente pelo
// id do evento: evento já processado responde 200 sem repetir nada.
//
// GET (Vercel Cron, 1x por dia): header `Authorization: Bearer <CRON_SECRET>`.
// Roda o job diário (o mesmo do pg_cron), reprocessa eventos que falharam e
// tenta de novo as pendências com o Asaas.
// GET ?action=reconcile (outro cron diário, mesmo segredo): conferência entre o
// app e o Asaas que só lê o Asaas e só marca pro admin (api/_lib/reconcile.ts).
// Também é reconhecida pelo cabeçalho x-vercel-cron-schedule do agendamento dela.
//
// Regras em api/_lib/billing.ts; estado em db/supabase_assinaturas.sql.

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function header(req: any, name: string): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const v = req.headers?.[name]
  return typeof v === 'string' ? v : ''
}

function getAction(req: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = req.query?.action
  if (typeof q === 'string' && q) return q
  if (typeof req.url === 'string' && req.url.includes('?')) {
    const v = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)).get('action')
    if (v) return v
  }
  return header(req, 'x-vercel-cron-schedule') === RECONCILE_CRON ? 'reconcile' : ''
}

export default async function handler(req: any, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[asaas-webhook] server misconfigured: missing env vars')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  // ── Job diário (Vercel Cron) ──
  if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET
    const auth = header(req, 'authorization')
    if (!cronSecret || !auth.startsWith('Bearer ') || !safeEqualStr(auth.slice(7), cronSecret)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (getAction(req) === 'reconcile') {
      try {
        const out = await runReconcile({ db: createClient(supabaseUrl, serviceRoleKey), asaas: asaasFromEnv(5000) })
        console.log('[billing-reconcile] ok', out)
        return res.status(200).json({ ok: true, reconcile: out })
      } catch (e) {
        console.error('[billing-reconcile] falhou:', e instanceof Error ? e.message : 'erro')
        return res.status(500).json({ error: 'Reconcile failed' })
      }
    }
    try {
      const out = await runDailyJob({ db: createClient(supabaseUrl, serviceRoleKey), asaas: asaasFromEnv(5000) })
      console.log('[billing-job] ok', out)
      return res.status(200).json({ ok: true, ...out })
    } catch (e) {
      console.error('[billing-job] falhou:', e instanceof Error ? e.message : 'erro')
      return res.status(500).json({ error: 'Job failed' })
    }
  }

  // ── Webhook do Asaas ──
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN
  if (!webhookToken) {
    console.error('[asaas-webhook] server misconfigured: missing ASAAS_WEBHOOK_TOKEN')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }
  if (webhookToken.length < 32) console.warn('[asaas-webhook] ASAAS_WEBHOOK_TOKEN curto: o Asaas pede de 32 a 255 caracteres')
  const provided = header(req, 'asaas-access-token')
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
  const deps = { db, asaas: asaasFromEnv(5000) }
  const eventId = typeof payload.id === 'string' && payload.id
    ? payload.id
    : `sha:${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40)}`

  // 1. Grava o evento (sem cartão). Já existe: responde conforme o estado.
  let attempts = 0
  const { error: insErr } = await db.from('asaas_webhook_events')
    .insert({ id: eventId, event, payload: sanitizeAsaasPayload(payload), status: 'pending' })
  if (insErr) {
    if (insErr.code !== '23505') {
      console.error('[asaas-webhook] nao gravou o evento, o Asaas vai reenviar:', insErr.message)
      return res.status(500).json({ error: 'Could not persist event' })
    }
    const { data } = await db.from('asaas_webhook_events').select('status, attempts').eq('id', eventId).maybeSingle()
    const row = data as { status?: string; attempts?: number } | null
    if (row?.status === 'done') return res.status(200).json({ received: true, duplicate: true })
    attempts = row?.attempts ?? 0
  }

  // 2. Processa. Falha fica 'failed' pro job; a resposta é 200 de qualquer jeito.
  const outcome = await processStoredEvent(deps, eventId, payload, attempts)

  // 3. Aproveita pra tentar de novo pendências antigas com o Asaas (best-effort).
  try { await runPendingActions(deps, { limit: 3 }) } catch (e) {
    console.warn('[asaas-webhook] pendencias ficam pro job:', e instanceof Error ? e.message : 'erro')
  }

  console.log('[asaas-webhook] recebido', { event, processed: outcome.ok, result: outcome.result })
  return res.status(200).json({ received: true, processed: outcome.ok, result: outcome.result })
}
