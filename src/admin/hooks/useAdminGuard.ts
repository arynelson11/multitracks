import { useAuth } from '../../hooks/useAuth';
import { isAdminEmail } from '../../lib/admin';

export type GuardStatus = 'loading' | 'anon' | 'denied' | 'ok';

export function useAdminGuard(): { status: GuardStatus; email: string | null; signOut: () => Promise<void> } {
  const { user, loading, signOut } = useAuth();
  let status: GuardStatus = 'loading';
  if (!loading) {
    if (!user) status = 'anon';
    else if (!isAdminEmail(user.email)) status = 'denied';
    else status = 'ok';
  }
  return { status, email: user?.email ?? null, signOut };
}
