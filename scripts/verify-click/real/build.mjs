// Empacota um script desta pasta com o detector de uma versão COMMITADA do repo
// (padrão: HEAD), nunca com o que está meio editado no checkout: outros agentes
// trabalham aqui. A árvore src/ da versão sai com `git archive` pra
// dist/detector-<commit>/ e o import `detector/...` aponta pra ela. O commit e o
// sha256 dos arquivos do detector entram no bundle (__DETECTOR__) e em cada
// resultado gravado.
//
//   node build.mjs calibrate.mjs            # detector do HEAD
//   node build.mjs calibrate.mjs --ref abc  # detector de outro commit
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const ref = refIdx >= 0 ? args[refIdx + 1] : 'HEAD';
const entries = args.filter((a, i) => !a.startsWith('--') && (refIdx < 0 || i !== refIdx + 1));
const git = (...a) => execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim();
const commit = git('rev-parse', '--short=10', ref);
const tree = path.join(here, 'dist', `detector-${commit}`);
if (!fs.existsSync(path.join(tree, 'src'))) {
  fs.mkdirSync(tree, { recursive: true });
  const top = git('rev-parse', '--show-toplevel');
  const tar = execFileSync('git', ['archive', commit, 'src'], { cwd: top, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', tree], { input: tar });
}
const files = ['lib/beatGrid.ts', 'lib/tempoSources.ts', 'lib/channelNames.ts', 'lib/channelRoles.ts',
  ...fs.readdirSync(path.join(tree, 'src/lib/tempo')).filter(f => f.endsWith('.ts') && !f.includes('.test.')).sort().map(f => `lib/tempo/${f}`)];
const h = crypto.createHash('sha256');
for (const f of files) h.update(f).update(fs.readFileSync(path.join(tree, 'src', f)));
const detector = { ref, commit, sha256: h.digest('hex').slice(0, 16), files };
console.log(`detector ${commit} (sha256 ${detector.sha256})`);
await esbuild.build({
  entryPoints: entries.length ? entries : ['calibrate.mjs'],
  bundle: true, platform: 'node', format: 'esm', outdir: path.join(here, 'dist'), outExtension: { '.js': '.mjs' },
  alias: { detector: path.join(tree, 'src') },
  define: { 'import.meta.env.BASE_URL': '"/"', __DETECTOR__: JSON.stringify(detector) }, logLevel: 'warning',
});
