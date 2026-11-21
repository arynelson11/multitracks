// O AUTO: no fim da música, passar sozinho pra próxima do repertório (spec 5 da Parte 3).
// Só no modo 'continue', com uma música depois da atual e quando o plano permite (`allowed`;
// no Livre a navegação entre músicas é do pago). Fora disso o fim para como no modo 'stop':
// a VS para e nenhum timer da próxima nasce.
export function shouldAutoAdvance(i: { mode: 'continue' | 'stop' | 'fade-out'; activeIndex: number; length: number; allowed: boolean }): boolean {
  return i.allowed && i.mode === 'continue' && i.activeIndex < i.length - 1
}

export type EndMode = 'continue' | 'stop' | 'fade-out'

// O fim da música como a tela mostra (Ruling AUTO-livre, revisão macro da 1b). Sem o AUTO no
// plano (`autoNext` falso, o Livre), o 'continue' guardado no motor para no fim como o 'stop':
// a tela mostra PARAR e o AUTO aparece travado. Com o AUTO, o modo como é.
export function shownEndMode(mode: EndMode, autoNext: boolean): EndMode {
  return !autoNext && mode === 'continue' ? 'stop' : mode
}

// O botão que alterna o fim da música a cada toque (palco antigo no celular deitado): AUTO, PARAR,
// FADE e volta. Sem o AUTO, só PARAR e FADE (o AUTO travado fica nos três botões da tela larga).
export function cycleEndMode(mode: EndMode, autoNext: boolean): EndMode {
  const shown = shownEndMode(mode, autoNext)
  if (!autoNext) return shown === 'stop' ? 'fade-out' : 'stop'
  return shown === 'continue' ? 'stop' : shown === 'stop' ? 'fade-out' : 'continue'
}
