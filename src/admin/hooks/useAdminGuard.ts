import { useAuth } from '../../hooks/useAuth';

export type GuardStatus = 'loading' | 'anon' | 'denied' | 'ok';

// Decide pelo papel lido do perfil (profiles.is_admin), nunca pelo e-mail. O servidor
// confere de novo em cada ação; aqui só decide o que mostrar.
export function useAdminGuard(): { status: GuardStatus; email: string | null; signOut: () => Promise<void> } {
  const { user, loading, isAdmin, signOut } = useAuth();
  let status: GuardStatus = 'loading';
  if (!loading) {
    if (!user) status = 'anon';
    else if (!isAdmin) status = 'denied';
    else status = 'ok';
  }
  return { status, email: user?.email ?? null, signOut };
}
