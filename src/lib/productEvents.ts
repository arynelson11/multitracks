// Eventos do produto que o app manda pro funil do admin (Parte 3, D7). Por enquanto só o anúncio
// da casa visto e clicado (POST /api/checkout?action=track); o servidor grava no máximo um de
// cada por conta, lugar e dia de Brasília e tira a conta do login, nunca do corpo.
import { apiUrl } from './api'
import { getAuthHeaders } from './supabase'
import type { AdPlacement } from './livreRules'

/**
 * Grava um anúncio visto ou clicado. Dispara e esquece: nunca lança, ninguém espera a resposta e
 * a tela segue igual se falhar (sem internet o evento só fica sem gravar). Sem sessão não manda.
 */
export function trackAd(kind: 'ad_shown' | 'ad_clicked', placement: AdPlacement): void {
  void (async () => {
    try {
      const headers = await getAuthHeaders()
      if (!headers.Authorization) return
      await fetch(apiUrl('/api/checkout?action=track'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind, placement }),
      })
    } catch { /* só o funil perde o evento */ }
  })()
}
