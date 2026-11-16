// Compara a grade do detector com o gabarito do click.
//
// Critérios (fixados antes de rodar):
// - BPM: nível do gabarito (fator 1) ou do nome da pasta quando ele é dobro ou
//   metade do gabarito: "certo" com |erro| <= 0,1 BPM. Fator 2 ou 1/2 que o nome
//   não apoia: "oitava". 3, 1/3, 3/2 ou 2/3: "proporção". Outro: "errado".
// - Fase: erro com sinal de cada tempo do click (no nível da grade achada) até o
//   tick mais perto da grade (positivo = grade atrasada). Mediana: "tempo" se
//   |mediana| <= 35 ms, "contratempo" se a mediana está a 35 ms de meio período
//   (só no mesmo nível), senão "fora". Aderência: fração dos tempos com |erro| <= 40 ms.
// - Grade certa: BPM certo + fase no tempo + aderência >= 80%.
// - "1": com a grade certa no nível do gabarito, cada acento do click vota no
//   índice do tempo (mod compasso) em que cai; certo se o voto majoritário é o
//   downbeat do detector. Sem acento, o mesmo contra o 1º click em 0:00 (presumido).

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

const FACTORS = [[1, '1'], [2, '2'], [0.5, '1/2'], [3, '3'], [1 / 3, '1/3'], [1.5, '3/2'], [2 / 3, '2/3']];

// Tempos do gabarito no nível `f` (1, 2 ou 1/2).
function levelBeats(truth, f) {
  const b = truth.beats, j = truth.beatIdx;
  if (f === 1) return b;
  if (f === 2) {
    const out = [];
    for (let i = 0; i < b.length; i++) {
      out.push(b[i]);
      if (i + 1 < b.length && j[i + 1] - j[i] === 1) out.push((b[i] + b[i + 1]) / 2);
    }
    return out;
  }
  // metade: tempos de índice par contado a partir do "1" (acento ou 1º tempo)
  const ref = truth.accents.length ? truth.accents[0] : b[0];
  const j0 = j[b.indexOf(ref)] ?? 0;
  return b.filter((_, i) => (((j[i] - j0) % 2) + 2) % 2 === 0);
}

/**
 * @param det resultado do detectSongGrid ({ bpm, firstBeat, downbeat, confidence, offbeatRisk })
 * @param truth gabarito (clickTruth)
 * @param beatsPerBar compasso passado ao detector
 * @param upTo só considera tempos do click até este segundo (duração analisada)
 */
export function evaluateGrid(det, truth, beatsPerBar, upTo = Infinity) {
  const P = 60 / det.bpm;
  const r = det.bpm / truth.bpm;
  let best = null;
  for (const [f, lab] of FACTORS) {
    const dev = Math.abs(r / f - 1);
    if (!best || dev < best.dev) best = { f, lab, dev };
  }
  const nameF = truth.nameRel?.factor ?? null;
  let level, factor = null;
  if (best.dev <= 0.004) {
    factor = best.f;
    if (factor === 1 || (nameF === factor && (factor === 2 || factor === 0.5))) level = 'certo';
    else if (factor === 2 || factor === 0.5) level = 'oitava';
    else level = 'proporção';
  } else level = 'errado';
  const refBpm = truth.bpm * (factor ?? 1);
  const bpmErr = det.bpm - refBpm;
  if (level === 'certo' && Math.abs(bpmErr) > 0.1) level = 'aproximado';

  const f = factor === 2 || factor === 0.5 ? factor : 1;
  const beats = levelBeats(truth, f).filter((t) => t <= upTo);
  const errs = beats.map((b) => {
    const tick = det.firstBeat + Math.round((b - det.firstBeat) / P) * P;
    return tick - b;
  });
  const phaseMs = median(errs) * 1000;
  const adherence = errs.filter((e) => Math.abs(e) <= 0.04).length / (errs.length || 1);
  const head = errs.filter((_, i) => beats[i] <= beats[0] + 30);
  const tail = errs.filter((_, i) => beats[i] >= beats[beats.length - 1] - 30);
  let phaseClass = 'fora';
  if (level === 'errado' || level === 'proporção') phaseClass = 'n/a';
  else if (Math.abs(phaseMs) <= 35) phaseClass = 'tempo';
  else if (factor === 1 && Math.abs(Math.abs(phaseMs) - (P * 1000) / 2) <= 35) phaseClass = 'contratempo';
  const gridOk = level === 'certo' && phaseClass === 'tempo' && adherence >= 0.8;
  const gridOctave = level === 'oitava' && phaseClass === 'tempo' && adherence >= 0.8;

  // "1"
  let downbeatOk = null, downbeatSource = null;
  if (gridOk && factor === 1) {
    const acc = (truth.accents.length ? truth.accents : truth.presumedOne !== null ? [truth.presumedOne] : []).filter((t) => t <= upTo);
    if (acc.length) {
      downbeatSource = truth.accents.length ? 'acento' : 'presumido';
      const votes = new Array(beatsPerBar).fill(0);
      for (const a of acc) {
        const n = Math.round((a - det.firstBeat) / P);
        votes[((n % beatsPerBar) + beatsPerBar) % beatsPerBar]++;
      }
      const top = votes.indexOf(Math.max(...votes));
      downbeatOk = top === det.downbeat;
    }
  }
  return {
    level, factor: best.dev <= 0.004 ? best.lab : null, bpmErr, phaseMs, phaseClass, adherence,
    headMs: median(head) * 1000, tailMs: median(tail) * 1000, gridOk, gridOctave, downbeatOk, downbeatSource,
  };
}
