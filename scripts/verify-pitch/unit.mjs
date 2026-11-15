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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  item ${item}  ${label}  ->  ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(want)})`}`);
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
  for (const n of ['Bateria', 'Baixo', 'Vocal', 'Voz', 'Teclado', 'Violão', 'Backing'])
    check(4, `"${n}" não é click/guia`, isClick(n), false);
}

console.log(`\nresumo: ${total} verificações, ${fails} falhas`);
process.exit(fails ? 1 : 0);
