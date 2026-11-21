// Nomes dos canais que o app gera (Parte 3): o click do motor, o do Separador e a voz guia.
// Uma fonte só pros três lugares que precisam reconhecer canal gerado (o motor, a separação e o
// painel SEPARAÇÃO do palco): a troca atômica tira pelo nome original (`name`, nunca o customName).

/** O click que o motor gera sozinho quando a música não tem click. */
export const GENERATED_CLICK_NAME = 'Click gerado'
/** O click do Separador (Gerar click do BPM). */
export const SEPARATOR_CLICK_NAME = 'Metrônomo'
/** O canal da voz guia (Gerar canal de Voz Guia). */
export const VOICE_GUIDE_NAME = 'Voz Guia'
/** Todo click que o app gera: o painel troca qualquer um deles pelo novo (um por música, P5). */
export const APP_CLICK_NAMES: readonly string[] = [GENERATED_CLICK_NAME, SEPARATOR_CLICK_NAME]
/** Clicks que o Metrônomo do app grava ("Click_IA_120bpm", "Click_Classic_120bpm"; MetronomeModal.tsx). */
export const METRONOME_CLICK_NAME = /^Click_[A-Za-z]+_[\d.]+bpm$/
/**
 * Todo click que o app gera, inclusive os do Metrônomo ("Inserir click"): o painel troca qualquer
 * um deles pelo novo, nunca dois clicks do app na mesma música (P5, sep-1 M5).
 */
export const isAppClickName = (name: string): boolean => APP_CLICK_NAMES.includes(name) || METRONOME_CLICK_NAME.test(name)
/** Todo canal que o app gera. */
export const APP_GENERATED_NAMES: readonly string[] = [GENERATED_CLICK_NAME, SEPARATOR_CLICK_NAME, VOICE_GUIDE_NAME]
