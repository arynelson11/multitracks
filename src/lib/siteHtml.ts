// Ajustes que o build faz no index.html do site (plugin em vite.config.ts).
// Funções puras sobre texto: dá pra testar sem rodar o build.

import { SITE_URL, type PageHead } from '../content/site'

// Valor de exemplo da meta do Google Search Console no index.html. Enquanto o dono não
// troca pelo código de verdade, o build tira a tag (não publica um código falso).
export const SEARCH_CONSOLE_PLACEHOLDER = 'COLE_AQUI_O_CODIGO_DO_SEARCH_CONSOLE'

export function stripHtmlComments(html: string): string {
  return html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/g, '')
}

export function dropUnsetSearchConsoleTag(html: string): string {
  const tag = new RegExp(`[ \\t]*<meta name="google-site-verification" content="${SEARCH_CONSOLE_PLACEHOLDER}"\\s*/?>[ \\t]*\\r?\\n?`)
  return html.replace(tag, '')
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const absoluteUrl = (path: string) => (path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`)

function replaceOnce(html: string, re: RegExp, value: string, what: string): string {
  if (!re.test(html)) throw new Error(`siteHtml: não achei ${what} no index.html`)
  return html.replace(re, (_m, before: string, after: string) => `${before}${value}${after}`)
}

// Troca título, descrição, canonical e os textos de compartilhamento pelos da página.
// Falha alto se alguma tag sumir do index.html, pra nunca publicar a página com o head errado.
export function applyPageHead(html: string, head: PageHead): string {
  let out = html
  out = replaceOnce(out, /(<title>)[^<]*(<\/title>)/, escapeHtml(head.title), '<title>')
  const meta: [RegExp, string, string][] = [
    [/(<meta name="description" content=")[^"]*(")/, head.description, 'meta description'],
    [/(<link rel="canonical" href=")[^"]*(")/, absoluteUrl(head.path), 'canonical'],
    [/(<meta property="og:url" content=")[^"]*(")/, absoluteUrl(head.path), 'og:url'],
    [/(<meta property="og:title" content=")[^"]*(")/, head.ogTitle, 'og:title'],
    [/(<meta property="og:description" content=")[^"]*(")/, head.ogDescription, 'og:description'],
    [/(<meta name="twitter:title" content=")[^"]*(")/, head.ogTitle, 'twitter:title'],
    [/(<meta name="twitter:description" content=")[^"]*(")/, head.ogDescription, 'twitter:description'],
  ]
  for (const [re, value, what] of meta) out = replaceOnce(out, re, escapeHtml(value), what)
  if (head.noindex) {
    out = replaceOnce(out, /(<meta charset="UTF-8" \/>)()/, '\n    <meta name="robots" content="noindex, nofollow" />', 'meta charset')
  }
  return out
}
