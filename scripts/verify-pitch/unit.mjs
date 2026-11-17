#!/usr/bin/env node
// Testes das regras puras da troca de tom, sem dependência nova: transpila com o
// esbuild do Vite e roda no Node. Tom escrito e semitons em src/lib/pitchRules.ts;
// quem fica fora do tom (Click e Guia) e quem ganha formantes (voz) pela regra
// central de canais em src/lib/channelRoles.ts, a mesma que o motor usa.
// Uso: node scripts/verify-pitch/unit.mjs   (sai com 1 se algo falhar)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BUILD = path.join(HERE, '.build');
fs.mkdirSync(BUILD, { recursive: true });
const load = async (src, out) => {
  const outfile = path.join(BUILD, out);
  await build({ entryPoints: [path.join(ROOT, src)], outfile, format: 'esm', platform: 'neutral', bundle: true, logLevel: 'warning' });
  return import(pathToFileURL(outfile).href + '?t=' + Date.now());
};
const R = await load('src/lib/pitchRules.ts', 'pitchRules.mjs');
const C = await load('src/lib/channelRoles.ts', 'channelRoles.mjs');

let fails = 0, total = 0;
const check = (item, label, got, want) => {
  total++;
  const ok = Object.is(got, want);
  if (!ok) fails++;
  const show = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v === undefined ? 'undefined' : JSON.stringify(v));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  item ${item}  ${label}  ->  ${show(got)}${ok ? '' : ` (esperado ${show(want)})`}`);
};
const need = (fn, mod = R, file = 'src/lib/pitchRules.ts') => {
  if (typeof mod[fn] === 'function') return mod[fn];
  total++; fails++;
  console.log(`  FAIL  ${fn} não existe em ${file}`);
  return null;
};
const needCentral = (fn) => need(fn, C, 'src/lib/channelRoles.ts');
const ch = (name, extra = {}) => ({ id: 'u', name, ...extra });

console.log('== item 4: Click e Guia fora do tom pela regra central (sem acento e sem caixa) ==');
const exemptOf = needCentral('isPitchExempt');
if (exemptOf) {
  const isClick = (n) => exemptOf(ch(n));
  for (const n of ['Metrônomo', 'METRÔNOMO', 'metronomo', 'Metronomo Loop', 'Click', 'CLICK', 'Click_IA_120bpm', 'Voz Guia', 'GUIA', 'Guide'])
    check(4, `"${n}" é click/guia`, isClick(n), true);
  // Rodada 1, item 4: o nome em inglês e sem a última letra.
  for (const n of ['Metronome', 'METRONOME', 'metronome 120bpm', 'Metronom', 'metronom'])
    check('R1-4', `"${n}" é click/guia`, isClick(n), true);
  for (const n of ['Bateria', 'Baixo', 'Vocal', 'Voz', 'Teclado', 'Violão', 'Backing'])
    check(4, `"${n}" não é click/guia`, isClick(n), false);
  check(4, '"CLICK" marcado Normal transpõe (papel manual vale)', exemptOf(ch('CLICK', { role: 'normal' })), false);
}

console.log('\n== item 5: formantes só em voz (família Vocal ou Backing da regra central) ==');
const formantOf = needCentral('wantsFormantCompensation');
if (formantOf) {
  const formant = (n, extra) => formantOf(ch(n, extra));
  for (const n of ['Vocal', 'VOCAL 1', 'Voz', 'Voz 2', 'Vox', 'Lead Vocal', 'Backing', 'Backing Vocals', 'Coro', 'Coral', 'Choir', 'BV', 'bv alto'])
    check(5, `"${n}" com formantes`, formant(n), true);
  for (const n of ['Bateria', 'Baixo', 'Teclado', 'Guitarra', 'Violão', 'Pad', 'Synth', 'Strings', 'Piano', 'Click', 'Metrônomo', 'Voz Guia'])
    check(5, `"${n}" sem formantes`, formant(n), false);
  // Papel manual vale: voz marcada Normal ganha formantes mesmo com "guia" no nome;
  // voz marcada Click/Guia não.
  check(5, '"Voz Guia" marcada Normal com formantes', formant('Voz Guia', { role: 'normal' }), true);
  check(5, '"VozGuia" marcada Normal com formantes', formant('VozGuia', { role: 'normal' }), true);
  check(5, '"Vocal" marcado Guia sem formantes', formant('Vocal', { role: 'guide' }), false);
  check(5, '"Bateria" marcada Normal sem formantes', formant('Bateria', { role: 'normal' }), false);
  // Rodada 1, item 7: instrumento solo nunca (a família do instrumento vem antes de
  // voz); VOC, BGV e "Lead" sozinho são voz.
  for (const n of ['Lead', 'LEAD', 'Lead 2', 'Lead Vocal', 'Lead Vox', 'VOC', 'Voc 1', 'voc', 'BGV', 'bgv 2', 'BGVs'])
    check('R1-7', `"${n}" com formantes`, formant(n), true);
  for (const n of ['Lead Guitar', 'Guitarra Lead', 'Lead Gtr', 'GTR Lead', 'Lead Guit', 'Synth Lead', 'Lead Synth', 'Lead Key', 'Lead Keys',
    'Keys Lead', 'Piano Lead', 'Lead Bass', 'Baixo Lead', 'Lead EG', 'EG Lead', 'Lead AG', 'Lead Violão', 'Teclado Lead', 'Lead Pno', 'Lead Pad'])
    check('R1-7', `"${n}" sem formantes`, formant(n), false);
  // Vale o nome dado no EDITAR CANAIS.
  check('R1-7', '"FX" renomeado "Voz" com formantes', formant('FX', { customName: 'Voz' }), true);
  check('R1-7', '"Lead" renomeado "Guitarra Solo" sem formantes', formant('Lead', { customName: 'Guitarra Solo' }), false);
}

console.log('\n== item 6: tom em qualquer formato, nunca NaN ==');
const k2s = need('keyToSemitone');
if (k2s) {
  const want = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
    c: 0, bb: 10, 'f#': 6, Am: 9, 'F#m': 6, Ebm: 3, 'C#m': 1, 'C♯': 1, 'B♭': 10, ' G ': 7, Cb: 11, 'E#': 5, 'B#': 0 };
  for (const [k, v] of Object.entries(want)) check(6, `tom "${k}"`, k2s(k), v);
  for (const k of ['Xyz', 'H', '', '#', 'Cm7b5x']) check(6, `tom "${k}" não reconhecido`, k2s(k), null);
  // Rodada 1, item 6: solfejo, com ou sem acento, sustenido/bemol e menor.
  const solf = { 'Dó': 0, Do: 0, 'dó': 0, DO: 0, 'Ré': 2, Re: 2, Mi: 4, 'Fá': 5, Fa: 5, Sol: 7, SOL: 7, 'Lá': 9, La: 9, Si: 11,
    'Lá m': 9, 'Rém': 2, 'Sol#': 8, Sib: 10, 'Si b': 10, Mib: 3, 'Fá#m': 6, 'Dó#': 1, 'Ré♭': 1, 'Dó maior': 0, 'Lá menor': 9, 'Mi m': 4, Dob: 11, 'Si#': 0, ' Sol ': 7 };
  for (const [k, v] of Object.entries(solf)) check('R1-6', `tom "${k}"`, k2s(k), v);
  for (const k of ['Sole', 'Lam7', 'Dó#x', 'Ut', 'Sold']) check('R1-6', `tom "${k}" não reconhecido`, k2s(k), null);
}
const between = need('semitonesBetweenKeys');
if (between) {
  const cases = [['C', 'D', 2], ['C', 'G', -5], ['A', 'C', 3], ['Bb', 'C', 2], ['Db', 'Eb', 2], ['Am', 'C', 3], ['F#m', 'A', 3],
    ['c', 'd', 2], ['bb', 'c', 2], ['B♭', 'C', 2], ['Eb', 'A', 6], ['G', 'Db', -6], ['G', 'C#', -6], ['Xyz', 'C', 0], ['', 'C', 0], [null, 'C', 0], ['C', 'Xyz', 0]];
  for (const [a, b, v] of cases) check(6, `de "${a}" para "${b}"`, between(a, b), v);
  for (const [a, b, v] of [['Lá m', 'C', 3], ['Sib', 'C', 2], ['Dó', 'D', 2], ['Sol#', 'A', 1], ['Fá', 'Sol', 2], ['Xyz', 'Ré', 0]])
    check('R1-6', `de "${a}" para "${b}"`, between(a, b), v);
  const odd = [null, undefined, '', 'Xyz', 'H', 'Bb', 'Am', 'c#', 'B♭', '123', 'Lá m', 'Sib', 'Dó', 'Sole'];
  let finite = true;
  for (const a of odd) for (const b of ['C', 'Bb', 'F#', 'Xyz', null]) if (!Number.isFinite(between(a, b))) finite = false;
  check(6, 'nenhuma combinação de tons gera NaN', finite, true);
}
const sane = need('sanitizeSemitones');
if (sane) {
  for (const [v, w] of [[NaN, 0], [Infinity, 0], [-Infinity, 0], [15, 12], [-15, -12], [3, 3], [-5, -5], [0, 0]]) check(6, `semitons ${v} pro motor`, sane(v), w);
}

console.log(`\nresumo: ${total} verificações, ${fails} falhas`);
process.exit(fails ? 1 : 0);
