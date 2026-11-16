import { useSyncExternalStore } from 'react'
import { isPasswordRecovery, subscribePasswordRecovery } from '../lib/passwordRecovery'

// true depois do evento PASSWORD_RECOVERY do Supabase, até a pessoa salvar a senha nova ou desistir.
export function usePasswordRecovery(): boolean {
  return useSyncExternalStore(subscribePasswordRecovery, isPasswordRecovery, isPasswordRecovery)
}
