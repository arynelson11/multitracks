// Volta do link "Esqueceu sua senha?": o Supabase valida o token no servidor, loga a pessoa
// com a sessão de recuperação e só então avisa com o evento PASSWORD_RECOVERY. Só esse
// evento liga a tela "Criar nova senha" (src/components/NewPasswordPage.tsx); o endereço
// (#type=recovery) sozinho nunca liga, senão qualquer link com esse pedaço abriria a tela
// pra quem já está logado. A escuta é registrada junto com o cliente (src/lib/supabase.ts).
// O link do email sempre volta no site, na web e no desktop (AuthPage).

export interface RecoveryAuthClient {
  auth: {
    onAuthStateChange(callback: (event: string, session: unknown) => void): {
      data: { subscription: { unsubscribe(): void } }
    }
    updateUser(attributes: { password: string }): Promise<{ error: { message: string } | null }>
    signOut(): Promise<{ error: { message: string } | null }>
  }
}

let recovering = false
const listeners = new Set<() => void>()
const set = (value: boolean) => {
  if (recovering === value) return
  recovering = value
  listeners.forEach(l => l())
}

export const isPasswordRecovery = () => recovering
export const startPasswordRecovery = () => set(true)
export const finishPasswordRecovery = () => set(false)

export function subscribePasswordRecovery(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function watchPasswordRecovery(client: RecoveryAuthClient): () => void {
  const { data } = client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') startPasswordRecovery()
  })
  return () => data.subscription.unsubscribe()
}

// Desistiu de trocar a senha: sai da sessão de recuperação (não fica logado por um link).
export async function cancelPasswordRecovery(client: RecoveryAuthClient): Promise<void> {
  try {
    await client.auth.signOut()
  } finally {
    finishPasswordRecovery()
  }
}
