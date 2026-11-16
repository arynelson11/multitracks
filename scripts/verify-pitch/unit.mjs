#!/usr/bin/env node
// Testes das regras puras da troca de tom (src/lib/pitchRules.ts), sem dependência
// nova: transpila com o esbuild do Vite e roda no Node.
// Uso: node scripts/verify-pitch/unit.mjs   (sai com 1 se algo falhar)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, '.build', 'pitchRules.mjs');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await build({ entryPoints: [path.join(ROOT, 'src/lib/pitchRules.ts')], outfile: OUT, format: 'esm', platform: 'neutral', bundle: false, logLevel: 'warning' });
const R = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

let fails = 0, total = 0;
const check = (item, label, got, want) => {
  total++;
  const ok = Object.is(got, want);
  if (!ok) fails++;
  const show = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v === undefined ? 'undefined' : JSON.stringify(v));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  item ${item}  ${label}  ->  ${show(got)}${ok ? '' : ` (esperado ${show(want)})`}`);
};
const need = (fn) => {
  if (typeof R[fn] === 'function') return R[fn];
  total++; fails++;
  console.log(`  FAIL  ${fn} não existe em src/lib/pitchRules.ts`);
  return null;
};

console.log('== item 4: click/guia por nome, sem acento e sem caixa ==');
const isClick = need('isClickOrGuideName');
if (isClick) {
  for (const n of ['Metrônomo', 'METRÔNOMO', 'metronomo', 'Metronomo Loop', 'Click', 'CLICK', 'Click_IA_120bpm', 'Voz Guia', 'GUIA', 'Guide'])
    check(4, `"${n}" é click/guia`, isClick(n), true);
  // Rodada 1, item 4: "metronom" cobre o nome em inglês e sem a última letra.
  for (const n of ['Metronome', 'METRONOME', 'metronome 120bpm', 'Metronom', 'metronom'])
    check('R1-4', `"${n}" é click/guia`, isClick(n), true);
  for (const n of ['Bateria', 'Baixo', 'Vocal', 'Voz', 'Teclado', 'Violão', 'Backing'])
    check(4, `"${n}" não é click/guia`, isClick(n), false);
}

console.log('\n== item 5: formantes só em voz ==');
const formant = need('wantsFormantCompensation');
if (formant) {
  for (const n of ['Vocal', 'VOCAL 1', 'Voz', 'Voz 2', 'Vox', 'Lead Vocal', 'Backing', 'Backing Vocals', 'Coro', 'Coral', 'Choir', 'BV', 'bv alto'])
    check(5, `"${n}" com formantes`, formant(n), true);
  for (const n of ['Bateria', 'Baixo', 'Teclado', 'Guitarra', 'Violão', 'Pad', 'Synth', 'Strings', 'Piano', 'Click', 'Metrônomo', 'Voz Guia'])
    check(5, `"${n}" sem formantes`, formant(n), false);
  // O motor passa o papel da regra central (papel manual vale): voz marcada Normal
  // na mão ganha formantes mesmo com "guia" no nome; voz marcada Click/Guia não.
  check(5, '"Voz Guia" marcada Normal com formantes', formant('Voz Guia', false), true);
  check(5, '"VozGuia" marcada Normal com formantes', formant('VozGuia', false), true);
  check(5, '"Vocal" marcado Guia sem formantes', formant('Vocal', true), false);
  check(5, '"Bateria" marcada Normal sem formantes', formant('Bateria', false), false);
}

console.log('\n== item 6: tom em qualquer formato, nunca NaN ==');
const k2s = need('keyToSemitone');
if (k2s) {
  const want = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
    c: 0, bb: 10, 'f#': 6, Am: 9, 'F#m': 6, Ebm: 3, 'C#m': 1, 'C♯': 1, 'B♭': 10, ' G ': 7, Cb: 11, 'E#': 5, 'B#': 0 };
  for (const [k, v] of Object.entries(want)) check(6, `tom "${k}"`, k2s(k), v);
  for (const k of ['Xyz', 'H', 'Do', '', '#', 'Cm7b5x']) check(6, `tom "${k}" não reconhecido`, k2s(k), null);
}
const between = need('semitonesBetweenKeys');
if (between) {
  const cases = [['C', 'D', 2], ['C', 'G', -5], ['A', 'C', 3], ['Bb', 'C', 2], ['Db', 'Eb', 2], ['Am', 'C', 3], ['F#m', 'A', 3],
    ['c', 'd', 2], ['bb', 'c', 2], ['B♭', 'C', 2], ['Eb', 'A', 6], ['G', 'Db', -6], ['G', 'C#', -6], ['Xyz', 'C', 0], ['', 'C', 0], [null, 'C', 0], ['C', 'Xyz', 0]];
  for (const [a, b, v] of cases) check(6, `de "${a}" para "${b}"`, between(a, b), v);
  const odd = [null, undefined, '', 'Xyz', 'H', 'Bb', 'Am', 'c#', 'B♭', '123'];
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
