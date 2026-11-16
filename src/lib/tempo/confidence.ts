// Etapa de confiança: quanto a grade achada é pulso de verdade.
//
// A busca sempre acha ALGUMA grade, até no ruído (a melhor de milhares de
// tentativas sempre se destaca da média). Por isso a grade é medida contra
// controles: a mesma busca de fase, no mesmo período, em versões da faixa com
// blocos de 2 s embaralhados. Dentro de cada bloco o ritmo local fica (quantos
// ataques, que levada), mas a fase não passa de um bloco pro outro. Pulso de
// verdade alinha a música inteira e fica bem acima dos controles; ruído, pad,
// voz e bateria afogada ficam perto deles.
import { combScore } from './onsets';

/**
 * Abaixo deste valor a música não tem pulso confiável e nada é gerado sozinho.
 * Calibrado só com o grupo `calibracao` de src/test/tempoCases.ts (60 s, 48 kHz),
 * no meio do vão entre o maior negativo, 0,4404 (`baixo-por-compasso-96`), e o
 * menor positivo, 0,9999 (`bass-colcheias`): (0,4404 + 0,9999) / 2 = 0,72.
 * No grupo `validacao`: maior negativo 0,5205 (`baixo-por-compasso`), menor
 * positivo 1,0.
 */
export const CONFIDENCE_CUT = 0.72;

/** Quantos controles embaralhados (sorteios). */
const CONTROL_DRAWS = 16;
/** Tamanho de cada bloco embaralhado, em segundos. */
const CONTROL_BLOCK_S = 2;
/** Semente fixa: a mesma música sempre dá a mesma confiança. */
const CONTROL_SEED = 0x5eed;

// Gerador pseudoaleatório pequeno (mulberry32), com semente.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Melhor nota da grade no período `period`, com a fase andando de 1 em 1 quadro a partir de `phase`.
function bestPhaseScore(o: Float32Array, period: number, phase: number): number {
  let best = 0;
  for (let k = 0; k < period; k++) {
    const s = combScore(o, period, (phase + k) % period);
    if (s > best) best = s;
  }
  return best;
}

// Blocos de `block` quadros em ordem sorteada, cada um girado por um deslocamento
// sorteado dentro dele. Só trocar a ordem não basta: quando 2 s fecham um número
// inteiro de tempos (60, 90, 120 BPM...), todo bloco começa na mesma fase e o
// controle sai igual à música. O pedaço final (menos de um bloco) fica no lugar.
function shuffledBlocks(o: Float32Array, block: number, rnd: () => number): Float32Array {
  const nb = Math.floor(o.length / block);
  const order = Array.from({ length: nb }, (_, i) => i);
  for (let i = nb - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  const out = new Float32Array(o.length);
  for (let k = 0; k < nb; k++) {
    const src = order[k] * block;
    const shift = Math.floor(rnd() * block);
    for (let i = 0; i < block; i++) out[k * block + i] = o[src + ((i + shift) % block)];
  }
  for (let i = nb * block; i < o.length; i++) out[i] = o[i];
  return out;
}

/**
 * Confiança da grade, de 0 a 1: quanto a melhor fase no período supera a média
 * dos controles embaralhados, em múltiplos de 4 vezes essa média (1 quando a grade
 * dá 5 vezes os controles ou mais; 0 quando não passa deles).
 * @param o função de onset (banda cheia, a mesma da busca)
 * @param period período da grade, em quadros
 * @param phase fase da grade, em quadros (a busca anda a partir dela)
 * @param fps quadros por segundo de `o` (tamanho dos blocos de 2 s)
 */
export function measureConfidence(o: Float32Array, period: number, phase: number, fps: number): number {
  if (!(period > 0) || !(fps > 0)) return 0;
  const best = bestPhaseScore(o, period, phase);
  const block = Math.round(CONTROL_BLOCK_S * fps);
  if (!(best > 0) || o.length < 2 * block) return 0;
  const rnd = rng(CONTROL_SEED);
  let sum = 0;
  for (let k = 0; k < CONTROL_DRAWS; k++) sum += bestPhaseScore(shuffledBlocks(o, block, rnd), period, phase);
  const mean = sum / CONTROL_DRAWS;
  if (!(mean > 0)) return 0;
  return Math.max(0, Math.min(1, (best - mean) / (4 * mean)));
}
