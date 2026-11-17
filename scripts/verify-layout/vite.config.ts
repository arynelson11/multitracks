// Build da página do verificador de layout (T20): raiz nesta pasta, React + Tailwind como o app,
// saída em .build/. Nada daqui entra no app.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_CSS = path.resolve(HERE, '../../src/index.css')

/**
 * O Tailwind procura as classes a partir da raiz do Vite (esta pasta), e os componentes ficam em
 * src/. Só neste build, o index.css do app ganha um `@source "."` (a pasta dele, src/), antes de o
 * Tailwind compilar: as classes saem iguais às do app, sem mexer no arquivo.
 */
function appClasses(): Plugin {
  return {
    name: 'verify-layout:app-classes',
    enforce: 'pre',
    transform(code, id) {
      if (path.resolve(id.split('?')[0]) !== APP_CSS) return null
      return { code: `${code}\n@source ".";\n`, map: null }
    },
  }
}

export default defineConfig({
  root: HERE,
  // Caminhos relativos: a página e os assets saem de qualquer pasta servida.
  base: './',
  plugins: [appClasses(), react(), tailwindcss()],
  logLevel: 'warn',
  build: { outDir: '.build', emptyOutDir: true, sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 8192 },
})
