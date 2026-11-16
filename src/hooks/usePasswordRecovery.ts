import { useEffect, useSyncExternalStore } from 'react'
import {
  isPasswordRecovery, subscribePasswordRecovery, watchPasswordRecovery, type RecoveryAuthClient,
} from '../lib/passwordRecovery'

// true enquanto a pessoa voltou do link de recuperar senha e ainda não criou a senha nova.
export function usePasswordRecovery(client: RecoveryAuthClient | null): boolean {
  useEffect(() => (client ? watchPasswordRecovery(client) : undefined), [client])
  return useSyncExternalStore(subscribePasswordRecovery, isPasswordRecovery, isPasswordRecovery)
}
