import * as esbuild from 'esbuild';
await esbuild.build({
  entryPoints: process.argv.slice(2).length ? process.argv.slice(2) : ['harness.mjs'],
  bundle: true, platform: 'node', format: 'esm', outdir: 'dist', outExtension: { '.js': '.mjs' },
  define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'warning',
});
