// Fonte única de "quem é admin" no front. O servidor tem a sua própria cópia
// em api/_lib/auth.ts (não dá pra importar de src/ no backend). Mantê-las em
// sincronia. O front é só gate de UI; a trava real é server-side.
export const ADMIN_EMAILS = ['arynelson11@gmail.com'] as const;

export function isAdminEmail(email?: string | null): boolean {
  return !!email && (ADMIN_EMAILS as readonly string[]).includes(email);
}
