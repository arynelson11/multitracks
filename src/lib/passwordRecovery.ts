// Volta do link "Esqueceu sua senha?": o Supabase loga a pessoa com uma sessão de
// recuperação e avisa com o evento PASSWORD_RECOVERY (o endereço chega com type=recovery).
// Este módulo guarda esse estado pra o App mostrar a tela "Criar nova senha"
// (src/components/NewPasswordPage.tsx) antes de qualquer outra.
// Web: o link do email volta no site. Desktop: o link volta pelo playbackstudio:// e o
// AuthPage liga o estado quando o fragmento tem type=recovery.

export interface RecoveryAuthClient {
  auth: {
    onAuthStateChange(callback: (event: string, session: unknown) => void): {
      data: { subscription: { unsubscribe(): void } }
    }
    updateUser(attributes: { password: string }): Promise<{ error: { message: string } | null }>
  }
}

export function hashIsRecovery(hash: string): boolean {
  return /(?:^#|&)type=recovery(?:&|$)/.test(hash)
}

let recovering = typeof window !== 'undefined' && hashIsRecovery(window.location.hash)
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
