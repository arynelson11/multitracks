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
/** Todo canal que o app gera. */
export const APP_GENERATED_NAMES: readonly string[] = [GENERATED_CLICK_NAME, SEPARATOR_CLICK_NAME, VOICE_GUIDE_NAME]
