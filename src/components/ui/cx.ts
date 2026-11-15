/** Junta classes, ignorando as falsas. Não resolve conflito: quem chama não passa duas utilidades opostas. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
