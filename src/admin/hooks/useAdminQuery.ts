import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdminApiError, adminGet, type AdminParams } from '../lib/adminApi'

export type AdminQueryState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

// Resultado do último pedido que gravou: `seq` diz qual foi, `query` de que ação e parâmetros.
type Settled<T> = { seq: number; query: string; data: T | null; error: string | null }

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
function settle<T>(prev: Settled<T>, seq: number, query: string, out: Outcome<T>): Settled<T> {
  if (out.ok) return { seq, query, data: out.data, error: null }
  return { seq, query, data: prev.query === query ? prev.data : null, error: out.error }
}

/**
 * Lê uma ação GET do admin. Todo pedido (do efeito ou do refetch) ganha um número novo de um
 * contador que só cresce, e só o pedido mais novo grava: dois refetch seguidos, ou voltar a um
 * filtro com o pedido antigo dele ainda no ar, nunca deixam a resposta velha sobrescrever a nova
 * (Ruling ADM-T4-id). Enquanto a nova não chega, os dados anteriores continuam com `loading`.
 * O refetch pede sempre com a ação e os parâmetros de agora, mesmo guardado de um render antigo
 * (Ruling ADM-T4-refetch).
 */
export function useAdminQuery<T>(
  action: string,
  params?: AdminParams,
  opts?: { enabled?: boolean },
): AdminQueryState<T> {
  const enabled = opts?.enabled ?? true
  const key = paramsKey(params)
  const query = `${action}?${key}`
  // Contador de pedidos (só cresce) e o número do pedido que ainda pode gravar (0 = nenhum).
  const seq = useRef(0)
  const latest = useRef(0)
  // Número do último refetch: o carregando fica ligado até um pedido igual ou mais novo gravar.
  const [refetchSeq, setRefetchSeq] = useState(0)
  const [settled, setSettled] = useState<Settled<T>>({ seq: 0, query: '', data: null, error: null })
  // Na troca de ação ou parâmetro, só vale resultado gravado depois dela: voltar a um filtro que
  // já tinha resposta também liga o carregando até o pedido novo chegar.
  const [watched, setWatched] = useState({ query, floor: 0 })
  if (watched.query !== query) setWatched({ query, floor: settled.seq + 1 })
  // O que vale agora, pro refetch: quem guardou o refetch de um render antigo (a varredura da T19,
  // que termina depois de o período mudar) pede o filtro de agora, e não o de quando guardou.
  const current = useRef({ enabled, action, key })
  useLayoutEffect(() => {
    current.current = { enabled, action, key }
  })

  useEffect(() => {
    if (!enabled) return
    const mine = ++seq.current
    latest.current = mine
    const q = `${action}?${key}`
    load<T>(action, key).then((out) => {
      if (latest.current === mine) setSettled((prev) => settle(prev, mine, q, out))
    })
    // Trocou a ação, o parâmetro ou desmontou: este pedido perde a vez.
    return () => {
      if (latest.current === mine) latest.current = 0
    }
  }, [enabled, action, key])

  const refetch = useCallback(async () => {
    const now = current.current
    if (!now.enabled) return
    const mine = ++seq.current
    latest.current = mine
    setRefetchSeq(mine)
    const q = `${now.action}?${now.key}`
    const out = await load<T>(now.action, now.key)
    if (latest.current === mine) setSettled((prev) => settle(prev, mine, q, out))
  }, [])

  const loading = enabled && (settled.query !== query || settled.seq < Math.max(refetchSeq, watched.floor))
  return { data: settled.data, loading, error: loading ? null : settled.error, refetch }
}
