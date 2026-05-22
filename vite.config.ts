import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'logo.png', 'app-icon.svg', 'app-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Playback Studio',
        short_name: 'Playback',
        description: 'Stems pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.',
        theme_color: '#FF6B35',
        background_color: '#121214',
        display: 'standalone',
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
        // Só hashed assets vão no precache. HTML fica fora pra sempre vir fresco.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        // Novo SW assume controle imediato quando carrega (sem esperar fechar todas as abas)
        skipWaiting: true,
        clientsClaim: true,
        // Limpa precache de deploys antigos
        cleanupOutdatedCaches: true,
        // Navegação (request HTML) sempre vai rede primeiro
        navigateFallback: null,
        runtimeCaching: [
          {
            // HTML: sempre rede, com fallback de cache se offline
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
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
  ],
})
