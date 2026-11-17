import { LEGAL_LINKS } from './site'

// Rotas que existem de verdade no site. Qualquer outro endereço devolve 404 (public/404.html).
// O app decide a tela pelo pathname em App.tsx ('/', '/download' e '/admin').
// Lido também pelo vite.config.ts (service worker), então fica sem nada de navegador.

export const APP_ROUTES = ['/', '/download', '/admin'] as const

// Páginas públicas que entram no sitemap (gerado no build). As legais só entram com
// LEGAL_PAGES_LIVE ligado em src/content/site.ts.
// lastmod é a data da ÚLTIMA MUDANÇA DO CONTEÚDO da página, fixa (não a data do build: o
// Google ignora lastmod que muda a cada deploy). Mudou o texto da página, troque a data aqui.
export const SITEMAP_PAGES: { path: string; lastmod: string }[] = [
  { path: '/', lastmod: '2026-11-16' },
  { path: '/download', lastmod: '2026-11-16' },
  ...LEGAL_LINKS.map(l => ({ path: l.href, lastmod: l.lastmod })),
]
export const SITEMAP_PATHS: string[] = SITEMAP_PAGES.map(p => p.path)

// O service worker só devolve o app guardado (index.html) na navegação para as rotas
// do app. O resto (páginas legais, 404, arquivos) vai pra rede, senão quem já visitou o
// site veria a landing no lugar de /privacidade ou de um endereço que não existe.
// O Workbox testa pathname + search, por isso a query (?payment=success, ?s=CODIGO) é aceita.
// Com barra no fim (/download/) fica de fora: vai pra rede e a Vercel responde 308 pro caminho
// sem barra (o App.tsx compara o caminho exato e mostraria a landing no lugar).
export const SW_NAVIGATION_ALLOWLIST: RegExp[] = [
  /^\/(?:\?.*)?$/,
  /^\/download(?:\?.*)?$/,
  /^\/admin(?:\?.*)?$/,
]

// Fora do precache do service worker: o 404 (não serve offline e deixaria a instalação do
// SW dependendo de /404 responder 200) e a imagem de compartilhamento (~240 KB, só pra redes).
// O node_modules é o padrão do plugin, mantido.
export const SW_PRECACHE_IGNORES = ['**/node_modules/**/*', '**/og-image.png', '**/404.html']
