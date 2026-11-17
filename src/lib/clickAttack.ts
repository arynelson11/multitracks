// Ataque de cada amostra de click da biblioteca (public/Click Tracks): quanto tempo,
// depois do início do arquivo, a amostra leva pra chegar a -20 dB do pico. O gerador
// de click adianta cada click por esse tempo, pra que o início audível caia no tempo
// da música (recomendação 7 do relatório do metrônomo automático).
import type { ClickSubdivision, ClickTrackType } from './clickLibrary';

/**
 * Ataque a -20 dB de cada arquivo, em ms: 1ª amostra com |x| >= 10% do pico, no mono.
 * A chave é o nome do arquivo sem o prefixo "New Click -  ". Medido por
 * scripts/verify-click/samples.mjs (campo `first_m20dB_ms` de
 * scripts/verify-click/samples.json); o teste confere a tabela com o JSON e com os WAV.
 */
export const CLICK_ATTACK_MS: Readonly<Record<string, number>> = Object.freeze({
  'Blip-accents.wav': 0.045,
  'Blip-eighth.wav': 0.045,
  'Blip-quarter.wav': 0.045,
  'Blip-sixteenth.wav': 0.045,
  'Classic-accents.wav': 0.045,
  'Classic-eighth.wav': 1.02,
  'Classic-quarter.wav': 1.088,
  'Classic-sixteenth.wav': 0.68,
  'Cowbell-accents.wav': 0.522,
  'Cowbell-eighth.wav': 1.043,
  'Cowbell-quarter.wav': 1.156,
  'Cowbell-sixteenth.wav': 0.794,
  'Digital-accents.wav': 0.068,
  'Digital-sixteenth.wav': 0.068,
  'Gentle-accents.wav': 0.068,
  'Gentle-eighth.wav': 0.045,
  'Gentle-quarter.wav': 0.045,
  'Gentle-sixteenth.wav': 0.045,
  'Percussive-accents.wav': 0.045,
  'Percussive-eighth.wav': 5.261,
  'Percussive-quarter.wav': 4.444,
  'Percussive-sixteenth.wav': 3.628,
  'Saw-accents.wav': 0.952,
  'Saw-eighth.wav': 0.045,
  'Saw-quarter.wav': 0.045,
  'Woodblock-accents.wav': 0.159,
  'Woodblock-eighth.wav': 0.136,
  'Woodblock-quarter.wav': 0.136,
  'Woodblock-sixteenth.wav': 0.136,
});

/**
 * Ataque da amostra de `type` e `subdivision`, em segundos: quanto o gerador adianta
 * cada click. O arquivo é achado pelo mesmo nome que o `getClickSampleUrl` pede
 * (ex. Classic + quarter = "Classic-quarter.wav"); amostra fora da tabela dá 0.
 */
export function attackSeconds(type: ClickTrackType, subdivision: ClickSubdivision): number {
  return (CLICK_ATTACK_MS[`${type}-${subdivision}.wav`] ?? 0) / 1000;
}
