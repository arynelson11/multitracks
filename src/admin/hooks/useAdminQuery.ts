import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminApiError, adminGet, type AdminParams } from '../lib/adminApi'

export type AdminQueryState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

// Resultado da última busca que terminou: `id` diz qual pedido foi, `query` qual ação e parâmetros.
type Settled<T> = { id: string; query: string; data: T | null; error: string | null }

const MSG_UNKNOWN = 'Não deu pra carregar. Tente de novo.'

/** Chave estável dos parâmetros: o mesmo valor num objeto novo a cada render não busca de novo. */
function paramsKey(params?: AdminParams): string {
  return JSON.stringify(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))
}

function paramsFromKey(key: string): AdminParams | undefined {
  const entries = JSON.parse(key) as [string, string | number][]
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string }

async function load<T>(action: string, key: string): Promise<Outcome<T>> {
  try {
    return { ok: true, data: await adminGet<T>(action, paramsFromKey(key)) }
  } catch (e) {
    return { ok: false, error: e instanceof AdminApiError ? e.message : MSG_UNKNOWN }
  }
}

/** Com erro, os dados anteriores só ficam se forem da mesma ação e dos mesmos parâmetros. */
function settle<T>(prev: Settled<T>, id: string, query: string, out: Outcome<T>): Settled<T> {
  if (out.ok) return { id, query, data: out.data, error: null }
  return { id, query, data: prev.query === query ? prev.data : null, error: out.error }
}

/**
 * Lê uma ação GET do admin. Cada pedido tem um id (ação, parâmetros e quantas vezes o refetch
 * rodou) e só o pedido mais novo grava o resultado: trocar o filtro no meio de uma busca
 * descarta a resposta velha, que nunca sobrescreve a nova. Enquanto a nova não chega, os
 * dados anteriores continuam com `loading` ligado.
 */
export function useAdminQuery<T>(
  action: string,
  params?: AdminParams,
  opts?: { enabled?: boolean },
): AdminQueryState<T> {
  const enabled = opts?.enabled ?? true
  const key = paramsKey(params)
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<Settled<T>>({ id: '', query: '', data: null, error: null })
  // Id do pedido que pode gravar o resultado; vazio = nenhum.
  const latest = useRef('')

  const query = `${action}?${key}`
  const id = `${query}#${nonce}`

  useEffect(() => {
    if (!enabled) return
    // Se o refetch já começou este pedido, aqui só fica a vigia de troca e de desmontar.
    if (latest.current !== id) {
      latest.current = id
      load<T>(action, key).then((out) => {
        if (latest.current === id) setSettled((prev) => settle(prev, id, query, out))
      })
    }
    return () => {
      if (latest.current === id) latest.current = ''
    }
  }, [enabled, id, action, key, query])

  const refetch = useCallback(async () => {
    if (!enabled) return
    const next = nonce + 1
    const reqId = `${query}#${next}`
    latest.current = reqId
    setNonce(next)
    const out = await load<T>(action, key)
    if (latest.current === reqId) setSettled((prev) => settle(prev, reqId, query, out))
  }, [enabled, nonce, query, action, key])

  const loading = enabled && settled.id !== id
  return { data: settled.data, loading, error: loading ? null : settled.error, refetch }
}
