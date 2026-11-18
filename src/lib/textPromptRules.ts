// Regras dos campos do TextPromptDialog (o diálogo de uma linha que substitui o window.prompt).

/** BPM do metrônomo infinito: inteiro de 40 a 300 (as mesmas regras do prompt de antes). */
export function endlessMetronomeBpmError(value: string): string | null {
  const bpm = Number(value)
  return /^\d+$/.test(value) && bpm >= 40 && bpm <= 300 ? null : 'BPM inválido. Digite um número entre 40 e 300.'
}

/** Nome de música: não pode ficar vazio. */
export function songNameError(value: string): string | null {
  return value ? null : 'Digite um nome pra música.'
}
