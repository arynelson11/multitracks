// Junta os resultados de calibrate.mjs (results/run-<commit>-*.json) e imprime as
// tabelas do relatório da M2b em Markdown: gabarito, música a música, confiança
// x duração, negativos, distribuição das confianças e o vão (ou a falta dele).
//
//   node summarize.mjs [--commit <hash>]   (não precisa de build: só lê os JSON)
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.cwd(), 'results');
const args = process.argv.slice(2);
const want = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : null;
const files = fs.readdirSync(OUT).filter((f) => /^run-.*\.json$/.test(f) && (!want || f.includes(want)));
const all = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
const byPkg = new Map();
for (const r of all) byPkg.set(r.pkg, r); // o último arquivo vence
const res = [...byPkg.values()].sort((a, b) => a.pkg.localeCompare(b.pkg, 'pt'));
const commits = [...new Set(res.map((r) => r.detector && `${r.detector.commit} (sha256 ${r.detector.sha256})`).filter(Boolean))];

const f2 = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '' : Number(v).toFixed(d).replace('.', ','));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '');

function shortName(pkg) {
  const s = pkg.replace(/\(.*?\)/g, ' ').replace(/\b\d+([.,]\d+)?\s*bpm\b/gi, ' ').replace(/\bbpm\s*\d+([.,]\d+)?/gi, ' ')
    .replace(/\bbpm\b/gi, ' ').replace(/^(mt|vs)\s+/i, '').replace(/multitracks?/gi, ' ');
  const segs = s.split(/\s*[-_|｜:]\s*/).map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x && !/^(tom\b.*|[A-G][#b]?|\d+([.,]\d+)?|original.*|by .*)$/i.test(x));
  let out = segs[0] ?? pkg;
  for (let i = 1; out.length < 6 && i < segs.length; i++) out += ` ${segs[i]}`;
  return out.slice(0, 26).trim();
}
const names = new Map();
for (const r of res) {
  let n = shortName(r.pkg);
  if ([...names.values()].includes(n)) n = `${n} (${r.truth ? Math.round(r.truth.bpm) : '?'})`;
  for (let k = 2; [...names.values()].includes(n); k++) n = `${n.replace(/ \d+$/, '')} ${k}`;
  names.set(r.pkg, n);
}

const ok = res.filter((r) => r.truth && r.runs?.length);
const skipped = res.filter((r) => !r.truth || !r.runs?.length);
const full = (r) => r.runs.find((x) => x.full);

console.log(`# Resumo M2b\n\nDetector: ${commits.join(', ')}\nPacotes lidos: ${res.length}; com gabarito e faixa de pulso: ${ok.length}.`);
if (skipped.length) {
  console.log('\nFora da conta:');
  for (const r of skipped) console.log(`- ${r.pkg}: ${r.skipped ?? r.error ?? (r.runs?.length ? '' : 'sem faixa de pulso (tempoSources vazio)')}`);
}

// 1. Gabarito
console.log('\n## Gabarito pelo click\n');
console.log('| Música | Click usado | Taxa de clicks | BPM do click | Tipo | Compasso | Nome da pasta | Andamento | Duração |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of res.filter((x) => x.truth)) {
  const t = r.truth;
  const tipo = t.kind === 'alternado' ? 'alternado forte/fraco (colcheias)' : t.kind === 'acento' ? `acento a cada ${t.accentEvery} clicks${t.subdivision ? ' (colcheias)' : ''}` : t.kind;
  console.log(`| ${names.get(r.pkg)} | ${r.click.used} | ${f2(t.clickRate, 2)} | ${f2(t.bpm, 3)} | ${tipo} | ${t.beatsPerBar} (${t.bpbSource}) | ${t.nameBpm ?? ''} ${t.nameRel ? `(${t.nameRel.label})` : ''} | ${t.variable ? `variável ${f2(t.localMin, 2)} a ${f2(t.localMax, 2)}${t.changes.length ? `: ${t.changes.slice(0, 2).join('; ')}` : ''}` : 'fixo'} | ${f2(r.fullSeconds, 0)} s |`);
}

// 2. Música a música (duração inteira)
console.log('\n## Música a música (duração inteira)\n');
console.log('| Música | BPM click | BPM detectado | Nível | Erro BPM | Fase (ms) | Aderência | "1" | Confiança | Risco contratempo | Faixas usadas | Com nearBpm |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of ok) {
  const x = full(r), e = x.eval, n = r.nearRun;
  const one = e.downbeatOk === null ? 'n/a' : `${e.downbeatOk ? 'sim' : 'não'} (${e.downbeatSource})`;
  console.log(`| ${names.get(r.pkg)} | ${f2(r.truth.bpm, 2)} | ${f2(x.det.bpm, 2)} | ${e.level}${e.factor && e.factor !== '1' ? ` x${e.factor}` : ''} | ${e.level === 'errado' ? '' : f2(e.bpmErr, 2)} | ${e.phaseClass === 'n/a' ? 'n/a' : `${f2(e.phaseMs, 1)} (${e.phaseClass})`} | ${pct(Math.round(e.adherence * 100), 100)} | ${one} | ${f2(x.det.confidence, 3)} | ${x.det.offbeatRisk ? 'sim' : 'não'} | ${x.det.tracksUsed.join(', ')} | ${f2(n.det.bpm, 2)} ${n.eval.gridOk ? 'certa' : n.eval.gridOctave ? 'oitava' : 'errada'} ${f2(n.det.confidence, 3)} |`);
}

// 3. Métricas gerais
const N = ok.length;
const bpmOk = ok.filter((r) => full(r).eval.level === 'certo').length;
const bpmOct = ok.filter((r) => full(r).eval.level === 'oitava').length;
const phaseOk = ok.filter((r) => full(r).eval.gridOk).length;
const oneAcc = ok.filter((r) => full(r).eval.downbeatSource === 'acento');
const onePre = ok.filter((r) => full(r).eval.downbeatSource === 'presumido');
console.log(`\n## Números (duração inteira, ${N} músicas)\n`);
console.log(`- BPM certo (nível do click ou do nome, erro <= 0,1): ${bpmOk}/${N} = ${pct(bpmOk, N)}; na oitava: ${bpmOct}`);
console.log(`- Grade certa (BPM certo + fase no tempo + aderência >= 80%): ${phaseOk}/${N} = ${pct(phaseOk, N)}`);
console.log(`- "1" certo pelo acento: ${oneAcc.filter((r) => full(r).eval.downbeatOk).length}/${oneAcc.length}; pelo 1º click presumido: ${onePre.filter((r) => full(r).eval.downbeatOk).length}/${onePre.length} (só onde a grade está certa)`);
const nearOk = ok.filter((r) => r.nearRun.eval.gridOk).length;
console.log(`- Com nearBpm (BPM do nome): grade certa ${nearOk}/${N} = ${pct(nearOk, N)}`);

// 4. Confiança x duração
const durs = [30, 60, 120, 240, 'inteira'];
console.log('\n## Confiança x duração (faixas do app)\n');
console.log(`| Música | ${durs.map((d) => (d === 'inteira' ? 'inteira' : `${d} s`)).join(' | ')} |`);
console.log(`|---|${durs.map(() => '---').join('|')}|`);
const cell = (x) => (x ? `${f2(x.det.confidence, 2)}${x.eval.gridOk ? '' : x.eval.gridOctave ? ' (8ª)' : ' (x)'}` : '');
const runAt = (runs, d) => (d === 'inteira' ? runs.find((x) => x.full) : runs.find((x) => !x.full && x.seconds === d));
for (const r of ok) console.log(`| ${names.get(r.pkg)} | ${durs.map((d) => cell(runAt(r.runs, d))).join(' | ')} |`);
console.log('\n(x) = grade errada nessa duração; (8ª) = grade alinhada na oitava.');

// 5. Negativos
console.log('\n## Negativos (faixa sem pulso sozinha como pulso)\n');
console.log(`| Música | Tipo | Faixa | ${durs.map((d) => (d === 'inteira' ? 'inteira' : `${d} s`)).join(' | ')} |`);
console.log(`|---|---|---|${durs.map(() => '---').join('|')}|`);
for (const r of ok) for (const n of r.negatives) console.log(`| ${names.get(r.pkg)} | ${n.cat} | ${n.name} | ${durs.map((d) => cell(runAt(n.runs, d))).join(' | ')} |`);
console.log('\nSem marca = a grade dessa faixa caiu certa no click (acertou por acaso).');

// 6. Distribuição e vão. Positivos em três grupos: grade certa, grade alinhada
// na oitava (todo tempo do click cai num tick, mas o BPM é dobro/metade) e grade
// errada (BPM errado, proporção, contratempo, deriva). Negativo que caiu certo no
// click conta à parte (não é falso positivo).
function gap(title, good, bad) {
  const s = (a) => [...a].sort((p, q) => p.c - q.c);
  if (!good.length || !bad.length) return;
  const minG = s(good)[0].c, maxB = s(bad)[bad.length - 1].c;
  if (minG > maxB) {
    console.log(`- ${title}: VÃO de ${f2(maxB, 3)} (maior errado) a ${f2(minG, 3)} (menor certo); meio ${f2((minG + maxB) / 2, 3)}`);
    return;
  }
  const over = [...good.filter((p) => p.c <= maxB).map((p) => ({ ...p, k: 'certo' })), ...bad.filter((w) => w.c >= minG).map((w) => ({ ...w, k: 'errado' }))].sort((p, q) => q.c - p.c);
  console.log(`- ${title}: SEM VÃO. Menor certo ${f2(minG, 3)}, maior errado ${f2(maxB, 3)}; ${over.filter((o) => o.k === 'certo').length} certos e ${over.filter((o) => o.k === 'errado').length} errados na faixa de sobreposição:`);
  for (const o of over.slice(0, 40)) console.log(`  - ${o.k} ${f2(o.c, 3)} ${o.who}: det ${f2(o.d.bpm, 2)} ${o.e.level}${o.e.factor && o.e.factor !== '1' ? ' x' + o.e.factor : ''} ${o.e.phaseClass} ader ${f2(o.e.adherence, 2)}`);
}
function distribution(label, pick, verbose = true) {
  const pos = [], oct = [], posBad = [], neg = [], negLucky = [];
  for (const r of ok) {
    const x = pick(r.runs);
    if (x) (x.eval.gridOk ? pos : x.eval.gridOctave ? oct : posBad).push({ c: x.det.confidence, who: names.get(r.pkg), e: x.eval, d: x.det });
    for (const n of r.negatives) {
      const y = pick(n.runs);
      if (y) (y.eval.gridOk || y.eval.gridOctave ? negLucky : neg).push({ c: y.det.confidence, who: `${names.get(r.pkg)} / ${n.name}`, e: y.eval, d: y.det });
    }
  }
  const s = (a) => [...a].sort((p, q) => p.c - q.c);
  const range = (a) => (a.length ? `${f2(s(a)[0].c, 3)} a ${f2(s(a)[a.length - 1].c, 3)} (mediana ${f2(s(a)[a.length >> 1].c, 3)}, n=${a.length}, saturados >= 0,999: ${a.filter((p) => p.c >= 0.999).length})` : 'nenhum');
  console.log(`\n### ${label}\n`);
  console.log(`- Positivos, grade certa: ${range(pos)}`);
  console.log(`- Positivos, grade alinhada na oitava: ${range(oct)}`);
  console.log(`- Positivos, grade errada: ${range(posBad)}`);
  console.log(`- Negativos, grade errada: ${range(neg)}`);
  console.log(`- Negativos que caíram certos no click: ${range(negLucky)}`);
  if (verbose) {
    gap('Certa x (oitava + errada + negativos)', pos, [...oct, ...posBad, ...neg]);
    gap('Alinhada (certa + oitava) x (errada + negativos)', [...pos, ...oct], [...posBad, ...neg]);
    gap('Positivo alinhado x só negativos', [...pos, ...oct], neg);
  }
  console.log('\n| Corte | Certas que passam | Oitavas que passam | Erradas de positivo que passam | Negativos que passam |');
  console.log('|---|---|---|---|---|');
  for (const c of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.72, 0.8, 0.9, 0.95, 0.99, 0.999]) {
    const k = (a) => `${a.filter((p) => p.c >= c).length}/${a.length}`;
    console.log(`| ${f2(c, 3)} | ${k(pos)} | ${k(oct)} | ${k(posBad)} | ${k(neg)} |`);
  }
  return { pos, oct, posBad, neg, negLucky };
}
console.log('\n## Distribuição das confianças');
const dFull = distribution('Duração inteira', (runs) => runs.find((x) => x.full));
for (const d of [240, 120, 60, 30]) distribution(`Primeiros ${d} s (música mais curta que isso entra inteira)`, (runs) => runs.find((x) => !x.full && x.seconds === d) ?? runs.find((x) => x.full && x.seconds <= d + 5), d === 240);

// 7. Piores casos (duração inteira): errado com confiança alta primeiro, depois certo com confiança baixa
console.log('\n## Piores casos (duração inteira)\n');
const worst = [
  ...dFull.posBad.map((p) => ({ ...p, score: p.c + 1 })),
  ...dFull.oct.map((p) => ({ ...p, score: p.c * 0.2 })),
  ...dFull.neg.map((p) => ({ ...p, score: p.c + 0.5 })),
  ...dFull.pos.map((p) => ({ ...p, score: 1 - p.c })),
].sort((a, b) => b.score - a.score).slice(0, 12);
for (const w of worst) console.log(`- ${w.who}: conf ${f2(w.c, 3)}, det ${f2(w.d.bpm, 2)} (${w.e.level}${w.e.factor ? ' x' + w.e.factor : ''}, fase ${w.e.phaseClass} ${f2(w.e.phaseMs, 1)} ms, aderência ${f2(w.e.adherence, 2)}, começo ${f2(w.e.headMs, 0)} ms, fim ${f2(w.e.tailMs, 0)} ms), faixas ${w.d.tracksUsed.join(', ')}`);

// 8. Tempo de análise
const ms = ok.map((r) => ({ s: full(r).seconds, ms: full(r).det.ms, n: full(r).det.tracksUsed.length }));
console.log(`\nTempo do detectSongGrid na música inteira (Node, este Mac): ${ms.map((m) => f2(m.ms / 1000 / (m.s / 60) / m.n, 2)).sort().join(' ')} s por minuto por faixa`);

// 9. Extras: fase entre as grades alinhadas, contratempo, negativos sem a guia
{
  const aligned = ok.map((r) => ({ r, x: full(r) })).filter(({ x }) => ['certo', 'oitava', 'aproximado'].includes(x.eval.level));
  const ph = aligned.map(({ x }) => x.eval.phaseMs).sort((a, b) => a - b);
  const cls = {};
  for (const { x } of aligned) cls[x.eval.phaseClass] = (cls[x.eval.phaseClass] || 0) + 1;
  console.log(`\n## Extras (duração inteira)\n`);
  console.log(`- Fase nas ${aligned.length} grades no nível certo ou na oitava: ${JSON.stringify(cls)}; erro de ${f2(ph[0], 1)} a ${f2(ph[ph.length - 1], 1)} ms, mediana ${f2(ph[ph.length >> 1], 1)} ms, |erro| mediano ${f2([...ph].map(Math.abs).sort((a, b) => a - b)[ph.length >> 1], 1)} ms`);
  const risk = ok.filter((r) => full(r).det.offbeatRisk);
  console.log(`- offbeatRisk ligado: ${risk.length} (${risk.map((r) => `${names.get(r.pkg)} ${full(r).eval.gridOk ? 'certa' : 'errada'}`).join(', ')})`);
  for (const cats of [['guia'], ['voz', 'pad', 'cordas/coro']]) {
    const xs = [];
    for (const r of ok) for (const n of r.negatives) if (cats.includes(n.cat)) {
      const y = n.runs.find((z) => z.full);
      xs.push({ c: y.det.confidence, who: `${names.get(r.pkg)} / ${n.name}`, lucky: y.eval.gridOk || y.eval.gridOctave, lev: y.eval.level, f: y.eval.factor });
    }
    xs.sort((a, b) => b.c - a.c);
    const wrong = xs.filter((x) => !x.lucky);
    console.log(`- Negativos ${cats.join('/')}: n=${xs.length}, grade errada n=${wrong.length}, mediana ${f2(wrong[wrong.length >> 1]?.c, 3)}; os 6 maiores: ${xs.slice(0, 6).map((x) => `${x.who} ${f2(x.c, 3)}${x.lucky ? ' (caiu certo)' : ` (${x.lev}${x.f && x.f !== '1' ? ' x' + x.f : ''})`}`).join('; ')}`);
  }
  // Confiança das grades certas por duração (mediana) e quantas grades certas em cada duração
  const line = [];
  for (const d of [30, 60, 120, 240, 'inteira']) {
    const xs = ok.map((r) => (d === 'inteira' ? full(r) : r.runs.find((x) => !x.full && x.seconds === d) ?? (full(r).seconds <= d + 5 ? full(r) : null))).filter(Boolean);
    const good = xs.filter((x) => x.eval.gridOk).map((x) => x.det.confidence).sort((a, b) => a - b);
    const al = xs.filter((x) => x.eval.gridOk || x.eval.gridOctave).length;
    line.push(`${d === 'inteira' ? 'inteira' : d + ' s'}: ${good.length}/${xs.length} certas (${al} alinhadas), confiança mediana das certas ${f2(good[good.length >> 1], 3)}, saturadas ${good.filter((c) => c >= 0.999).length}`);
  }
  console.log(`- Por duração: ${line.join('; ')}`);
  const nf = ok.filter((r) => !r.nearRun.eval.gridOk).map((r) => `${names.get(r.pkg)} (near ${r.nearRun.nearBpm}: det ${r.nearRun.det.bpm}, ${r.nearRun.eval.level})`);
  console.log(`- nearBpm sem grade certa: ${nf.join('; ')}`);
  const one = ok.filter((r) => full(r).eval.downbeatOk !== null).map((r) => `${names.get(r.pkg)} ${full(r).eval.downbeatOk ? 'sim' : 'não'} (${full(r).eval.downbeatSource}, det ${full(r).det.downbeat}, compasso ${r.truth.beatsPerBar})`);
  console.log(`- "1": ${one.join('; ')}`);
}
