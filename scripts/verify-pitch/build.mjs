// Monta a página de verificação: empacota o hook REAL (src/hooks/useAudioEngine.ts)
// com esbuild e troca o pacote signalsmith-stretch por uma cópia instrumentada
// (só contadores; o DSP não muda). Nada daqui entra no app.
import { build as esbuild } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, '.build');

// Cópia instrumentada do pacote: conta chamadas de process() por ramo
// (live = com fonte, buf = ativo sem fonte, idle = parado via stop()) e expõe
// o segmento atual (ativo, semitons, formantes) num método remoto debug().
function makeDebugCopy() {
  const srcPath = path.join(ROOT, 'node_modules/signalsmith-stretch/SignalsmithStretch.mjs');
  let src = fs.readFileSync(srcPath, 'utf8');
  const rep = (oldStr, newStr) => {
    const n = src.split(oldStr).length - 1;
    if (n !== 1) throw new Error(`trecho esperado 1x, achado ${n}x: ${oldStr.slice(0, 60)}`);
    src = src.replace(oldStr, newStr);
  };
  rep('\t\t\tthis.wasmReady = false;\n',
    '\t\t\tthis.wasmReady = false;\n\t\t\tthis._pc = 0; this._nanBlocks = 0; this._liveBlocks = 0; this._bufBlocks = 0; this._idleBlocks = 0;\n');
  rep('\t\t\t\tlatency: _ => {',
    '\t\t\t\tdebug: _ => { const s = this.timeMap[0]; return {pc: this._pc, nanBlocks: this._nanBlocks, liveBlocks: this._liveBlocks, bufBlocks: this._bufBlocks, idleBlocks: this._idleBlocks, seg: {active: s.active, semitones: s.semitones, formantCompensation: s.formantCompensation, formantBaseHz: s.formantBaseHz}}; },\n\t\t\t\tlatency: _ => {');
  rep('\t\tprocess(inputList, outputList, parameters) {\n',
    '\t\tprocess(inputList, outputList, parameters) {\n\t\t\tthis._pc++;\n');
  rep('\t\t\tif (!currentMapSegment.active) {\n',
    '\t\t\tif (!currentMapSegment.active) {\n\t\t\t\tthis._idleBlocks++;\n');
  rep('\t\t\t} else if (inputs?.length) {\n\t\t\t\t// Live input\n',
    '\t\t\t} else if (inputs?.length) {\n\t\t\t\t// Live input\n\t\t\t\tthis._liveBlocks++;\n');
  rep('\t\t\t\t// constantly seeking', '\t\t\t\tthis._bufBlocks++;\n\t\t\t\t// constantly seeking');
  rep('\t\t\t\tchannelBuffer.set(buffer);\n\t\t\t});\n',
    '\t\t\t\tchannelBuffer.set(buffer);\n\t\t\t\tif (buffer.some(v => v !== v)) this._nanBlocks++;\n\t\t\t});\n');
  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, 'SignalsmithStretch.debug.mjs');
  fs.writeFileSync(out, src);
  return out;
}

// Com `rev`, empacota o src/ daquele commit (git archive) em vez do working tree:
// assim o "antes" de cada correção roda com o mesmo harness do "depois".
function entryFor(rev) {
  if (!rev) return path.join(HERE, 'www/harness.jsx');
  const sha = execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT }).toString().trim();
  const base = path.join(OUT, `rev-${sha}`);
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'src'], { cwd: ROOT, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', base], { input: tar });
  const www = path.join(base, 'scripts/verify-pitch/www');
  fs.mkdirSync(www, { recursive: true });
  for (const f of ['harness.jsx', 'instrument.js']) fs.copyFileSync(path.join(HERE, 'www', f), path.join(www, f));
  return path.join(www, 'harness.jsx');
}

export async function buildHarness({ rev } = {}) {
  const debugCopy = makeDebugCopy();
  await esbuild({
    entryPoints: [entryFor(rev)],
    outfile: path.join(OUT, 'harness.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    // es2022: sem helpers injetados dentro do processador do worklet (o pacote
    // serializa a função com toString(), então ela precisa ser autocontida).
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    nodePaths: [path.join(ROOT, 'node_modules')],
    logLevel: 'warning',
    define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"verify"}' },
    plugins: [{
      name: 'signalsmith-debug',
      setup(b) {
        b.onResolve({ filter: /^signalsmith-stretch$/ }, () => ({ path: debugCopy }));
      },
    }],
  });
  return OUT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--rev');
  await buildHarness({ rev: i >= 0 ? process.argv[i + 1] : undefined });
  console.log('build ok em', OUT);
}
