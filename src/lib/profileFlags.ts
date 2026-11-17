import { supabase } from './supabase'

// Papel de admin e bloqueio da conta, lidos do próprio perfil (db/supabase_admin_papel.sql).
// No app isso só decide o que mostrar; a trava de verdade é o servidor (verifyAdmin em
// api/_lib/auth.ts), que lê o mesmo campo com a chave de serviço.

export type ProfileFlags = { isAdmin: boolean; blockedAt: string | null }

type Row = { is_admin?: unknown; blocked_at?: unknown } | null

const notAdmin = (): ProfileFlags => ({ isAdmin: false, blockedAt: null })

// Erro, coluna ausente (SQL do papel ainda não rodou), perfil sem linha ou falha de rede:
// não é admin nem bloqueado. Só o valor true dá o papel.
export async function fetchProfileFlags(userId: string): Promise<ProfileFlags> {
  if (!supabase) return notAdmin()
  try {
    const res: { data: Row; error: unknown } = await supabase.from('profiles').select('is_admin, blocked_at').eq('id', userId).maybeSingle()
    if (res.error || !res.data) return notAdmin()
    return {
      isAdmin: res.data.is_admin === true,
      blockedAt: typeof res.data.blocked_at === 'string' ? res.data.blocked_at : null,
    }
  } catch {
    return notAdmin()
  }
}

// Tela de conta bloqueada: com login, com a data do bloqueio e sem ser admin (conta admin
// nunca fica presa fora do app). Sem a data (não bloqueada, ou leitura do perfil que falhou),
// o app segue normal; a trava de verdade é o servidor, que recusa as funções da conta.
export function shouldShowBlocked(s: { user: unknown; blockedAt: string | null; isAdmin: boolean }): boolean {
  return !!s.user && typeof s.blockedAt === 'string' && s.blockedAt !== '' && s.isAdmin !== true
}

// Última abertura do app, que o admin vê na ficha. O banco só regrava depois de 1 hora;
// esta trava, por conta, evita um pedido por tela (cada componente tem sua instância do
// useAuth) e ainda grava a conta que entrar depois no mesmo app aberto. O banco grava
// pela sessão (auth.uid()); o id aqui só separa as contas.
const touched = new Set<string>()

export function touchLastSeen(userId: string): void {
  if (touched.has(userId) || !supabase) return
  touched.add(userId)
  try {
    // O pedido do supabase-js só sai quando alguém chama then. Sem esperar; erro ignorado.
    void supabase.rpc('touch_last_seen').then(() => undefined, () => undefined)
  } catch {
    // cliente com problema: a última abertura é só informação pro admin
  }
}
