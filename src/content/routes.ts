import { LEGAL_LINKS } from './site'

// Rotas que existem de verdade no site. Qualquer outro endereço devolve 404 (public/404.html).
// O app decide a tela pelo pathname em App.tsx ('/', '/download' e '/admin').
// Lido também pelo vite.config.ts (service worker), então fica sem nada de navegador.

export const APP_ROUTES = ['/', '/download', '/admin'] as const

// Páginas públicas que entram no sitemap (gerado no build). As legais só entram com
// LEGAL_PAGES_LIVE ligado em src/content/site.ts.
export const SITEMAP_PATHS: string[] = ['/', '/download', ...LEGAL_LINKS.map(l => l.href)]

// O service worker só devolve o app guardado (index.html) na navegação para as rotas
// do app. O resto (páginas legais, 404, arquivos) vai pra rede, senão quem já visitou o
// site veria a landing no lugar de /privacidade ou de um endereço que não existe.
// O Workbox testa pathname + search, por isso a query (?payment=success, ?s=CODIGO) é aceita.
export const SW_NAVIGATION_ALLOWLIST: RegExp[] = [
  /^\/(?:\?.*)?$/,
  /^\/download\/?(?:\?.*)?$/,
  /^\/admin\/?(?:\?.*)?$/,
]
