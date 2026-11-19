// O AUTO: no fim da música, passar sozinho pra próxima do repertório (spec 5 da Parte 3).
// Só no modo 'continue', com uma música depois da atual e quando o plano permite (`allowed`;
// no Livre a navegação entre músicas é do pago). Fora disso o fim para como no modo 'stop':
// a VS para e nenhum timer da próxima nasce.
export function shouldAutoAdvance(i: { mode: 'continue' | 'stop' | 'fade-out'; activeIndex: number; length: number; allowed: boolean }): boolean {
  return i.allowed && i.mode === 'continue' && i.activeIndex < i.length - 1
}
