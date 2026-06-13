import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import electron from 'vite-plugin-electron/simple'

// DESKTOP=1 ativa o variante Electron (scripts *:desktop).
// Sem a flag, é o build normal do site (idêntico ao de antes).
const isDesktop = !!process.env.DESKTOP

export default defineConfig({
  // Assets relativos no desktop pra resolverem sob file://; '/' no site.
  base: isDesktop ? './' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // O service worker do PWA só entra no build do site. Dentro do Electron
    // o offline vem do filesystem (fases seguintes), não do SW.
    ...(isDesktop
      ? []
      : [
          VitePWA({
            // 'prompt' (em vez de 'autoUpdate'): em vez de trocar a versão em
            // silêncio, o app avisa "tem versão nova" e o usuário clica pra
            // atualizar (UpdateBanner via service worker). Mesma UX do desktop.
            registerType: 'prompt',
            includeAssets: ['logo.svg', 'logo.png', 'app-icon.svg', 'app-icon.png', 'favicon.svg'],
            manifest: {
              name: 'Playback Studio',
              short_name: 'Playback',
              description: 'Stems pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.',
              theme_color: '#FF6B35',
              background_color: '#121214',
              // 'browser' (em vez de 'standalone') evita que o navegador ofereça
              // "Instalar app" (PWA). A distribuição é só o app desktop (/download).
              // O cache offline via service worker (workbox) segue funcionando.
              display: 'browser',
              orientation: 'portrait',
              start_url: '/',
              scope: '/',
              icons: [
                // Backgrounded SVG — primary install icon for browsers that support SVG manifests
                {
                  src: '/app-icon.svg',
                  sizes: 'any',
                  type: 'image/svg+xml',
                  purpose: 'any',
                },
                // Backgrounded PNG 512x512 — for Android (Chrome install) + iOS-style maskable adaptive icons
                {
                  src: '/app-icon.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              runtimeCaching: [
                {
                  urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'google-fonts-cache',
                    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                    cacheableResponse: { statuses: [0, 200] },
                  },
                },
              ],
            },
          }),
        ]),
    // Electron só é montado no variante desktop. No site, o plugin nem carrega.
    ...(isDesktop
      ? [
          electron({
            main: {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  rollupOptions: {
                    external: ['bufferutil', 'utf-8-validate', 'electron-updater'],
                    output: { format: 'es', entryFileNames: '[name].mjs' },
                  },
                },
              },
            },
            preload: {
              input: 'electron/preload.ts',
              // Preload com sandbox:true precisa ser CommonJS (.cjs).
              vite: {
                build: {
                  rollupOptions: {
                    output: { format: 'cjs', entryFileNames: '[name].cjs' },
                  },
                },
              },
            },
          }),
        ]
      : []),
  ],
})
