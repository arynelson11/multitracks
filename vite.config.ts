import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import electron from 'vite-plugin-electron/simple'
import type { Plugin } from 'vite'
import { applyPageHead, dropUnsetSearchConsoleTag, stripHtmlComments } from './src/lib/siteHtml'
import { buildSitemap, injectSiteSeo, withoutFaqJsonLd } from './src/lib/siteSeo'
import { PAGE_HEADS } from './src/content/site'
import { SW_NAVIGATION_ALLOWLIST, SW_PRECACHE_IGNORES } from './src/content/routes'

// DESKTOP=1 ativa o variante Electron (scripts *:desktop).
// Sem a flag, é o build normal do site (idêntico ao de antes).
const isDesktop = !!process.env.DESKTOP

// Limpa o index.html publicado (site e desktop): nenhum comentário sai no HTML e a meta
// do Google Search Console só sai quando tiver o código de verdade.
// Notas do index.html que antes eram comentários dentro dele:
// - viewport: sai sem maximum-scale (zoom livre pra acessibilidade). O app trava o zoom em
//   main.tsx (src/lib/viewportZoom.ts) pro iPhone não dar zoom sozinho ao tocar num campo;
//   landing e /download liberam enquanto estão na tela.
// - apple-touch-icon: quadrado com fundo cheio (180x180); o iOS aplica os cantos e
//   canto transparente viraria preto.
// - mobile-web-app-capable: o app instalado na tela de início abre sem a barra do navegador.
// - apple-mobile-web-app-status-bar-style 'black' (e não 'black-translucent'): o app fica
//   abaixo do relógio/notch. Com translucent ele desenha por baixo e o CSS não trata
//   safe-area, então VOLTAR/SALVAR do topo ficariam escondidos atrás do relógio.
// - fontes do Google: carregam sem bloquear a renderização (preload de estilo que vira
//   stylesheet no onload, com <noscript> pra quem não roda JS). Mesmas famílias e pesos de
//   antes, menos o Caveat: só o peso 500 e só as letras de "domingo." (a única palavra
//   escrita com ele, no DomingoMark), o que corta o arquivo de 72 KiB pra poucos KiB.
// - google-site-verification: troque COLE_AQUI_O_CODIGO_DO_SEARCH_CONSOLE pelo código que
//   o Search Console mostra no método "Tag HTML" (só o valor do content).
//
// No site (não no desktop) também põe o JSON-LD (Organization, WebSite, SoftwareApplication
// e FAQPage) e um resumo do produto no <noscript>, e escreve download.html e admin.html: o mesmo app, com
// título, descrição, canonical e compartilhamento de cada página (o /admin com noindex).
// Com o cleanUrls do vercel.json, /download serve download.html e endereço que não existe
// cai no public/404.html com status 404 (antes toda URL devolvia a home com 200).
function siteHtml({ desktop }: { desktop: boolean }): Plugin {
  return {
    name: 'playback-site-html',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        const clean = dropUnsetSearchConsoleTag(stripHtmlComments(html))
        return desktop ? clean : injectSiteSeo(clean)
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (desktop) return
        const index = bundle['index.html']
        if (!index || index.type !== 'asset') this.error('siteHtml: index.html não saiu no build')
        const html = typeof index.source === 'string' ? index.source : new TextDecoder().decode(index.source)
        for (const page of [PAGE_HEADS.download, PAGE_HEADS.admin]) {
          this.emitFile({ type: 'asset', fileName: `${page.path.slice(1)}.html`, source: applyPageHead(withoutFaqJsonLd(html), page) })
        }
        // sitemap.xml sai das rotas públicas (as legais só com LEGAL_PAGES_LIVE ligado), com o
        // lastmod fixo de cada página em src/content/routes.ts.
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemap() })
      },
    },
  }
}

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
            // registerSW.js com defer: não bloqueia a primeira pintura (ele só registra o
            // service worker no evento load, então nada muda no comportamento).
            injectRegister: 'script-defer',
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
              // O app guardado só responde às rotas do app ('/', '/download', '/admin').
              // Sem isso, quem já visitou o site veria a landing em /privacidade, /termos,
              // /cancelamento e em endereço que não existe (o 404 tem que vir da rede).
              navigateFallbackAllowlist: SW_NAVIGATION_ALLOWLIST,
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              // Sem a imagem de compartilhamento e o 404 (src/content/routes.ts).
              globIgnores: SW_PRECACHE_IGNORES,
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
    siteHtml({ desktop: isDesktop }),
  ],
})
