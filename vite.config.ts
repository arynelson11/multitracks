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
            // 'autoUpdate' (era 'prompt' até 2026-11-09): com 'prompt' a versão nova
            // só entrava quando a pessoa tocava no aviso, e o aviso só existia na tela
            // de Multitracks. Quem ia direto pro Separador ficava PRESO na versão velha
            // (o iPad do irmão do Ary continuou com o bug do upload depois do fix).
            // Agora a versão nova assume sozinha e vale na próxima abertura; o aviso
            // (global, em main.tsx) só oferece recarregar, nunca recarrega sozinho pra
            // não cortar uma música tocando.
            registerType: 'autoUpdate',
            includeAssets: ['logo.svg', 'logo.png', 'app-icon.svg', 'app-icon.png', 'favicon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png'],
            manifest: {
              id: '/',
              name: 'Playback Studio',
              short_name: 'Playback',
              description: 'Multitracks pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.',
              theme_color: '#FF6B35',
              background_color: '#121214',
              // Desde 2026-11-09 o site também é app de celular/tablet: "standalone"
              // deixa instalar na tela de início (Android oferece "Instalar app";
              // iPhone/iPad via Compartilhar > Adicionar à Tela de Início) e abre
              // sem a barra do navegador. Antes era 'browser' de propósito, pra
              // distribuição ser só o app desktop.
              display: 'standalone',
              // 'any': o mixer do Separador usa melhor a tela deitada (iPad/celular).
              orientation: 'any',
              start_url: '/',
              scope: '/',
              categories: ['music', 'productivity'],
              lang: 'pt-BR',
              icons: [
                // Quadrados com fundo cheio (sem canto transparente): cada sistema
                // aplica a própria máscara (círculo/gota no Android, cantos no iOS).
                { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                // O desenho cabe na área segura de 80%: serve como ícone adaptativo.
                { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              // Versão nova assume na hora e limpa caches de versões antigas.
              skipWaiting: true,
              clientsClaim: true,
              cleanupOutdatedCaches: true,
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
