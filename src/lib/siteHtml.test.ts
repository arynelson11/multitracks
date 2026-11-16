import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyPageHead, dropUnsetSearchConsoleTag, SEARCH_CONSOLE_PLACEHOLDER, stripHtmlComments } from './siteHtml'
import { OG_IMAGE, PAGE_HEADS, SITE_URL } from '../content/site'

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
const attr = (html: string, re: RegExp) => html.match(re)?.[1]

describe('index.html', () => {
  it('não tem comentário nenhum (o HTML publicado sai limpo)', () => {
    expect(indexHtml).not.toContain('<!--')
  })

  it('não tem travessão', () => {
    expect(indexHtml).not.toContain('—')
  })

  it('o head da home bate com src/content/site.ts', () => {
    expect(applyPageHead(indexHtml, PAGE_HEADS.home)).toBe(indexHtml)
  })

  it('título e descrição falam multitracks, igreja, VS e separação de faixas, sem stems', () => {
    const { title, description } = PAGE_HEADS.home
    expect(title).toMatch(/multitracks/)
    expect(title).toMatch(/igreja/)
    expect(description).toMatch(/Separação de faixas/)
    expect(description).toMatch(/\bVS\b/)
    expect(`${title} ${description}`.toLowerCase()).not.toContain('stems')
    expect(title.length).toBeLessThanOrEqual(60)
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('Open Graph completo, com imagem absoluta 1200x630', () => {
    expect(attr(indexHtml, /<meta property="og:url" content="([^"]+)"/)).toBe(`${SITE_URL}/`)
    expect(attr(indexHtml, /<meta property="og:site_name" content="([^"]+)"/)).toBe('Playback Studio')
    expect(attr(indexHtml, /<meta property="og:image" content="([^"]+)"/)).toBe(OG_IMAGE.url)
    expect(OG_IMAGE.url.startsWith('https://')).toBe(true)
    expect(attr(indexHtml, /<meta property="og:image:width" content="([^"]+)"/)).toBe('1200')
    expect(attr(indexHtml, /<meta property="og:image:height" content="([^"]+)"/)).toBe('630')
    expect(attr(indexHtml, /<meta property="og:image:alt" content="([^"]+)"/)).toBe(OG_IMAGE.alt)
  })

  it('Twitter com card grande, título, descrição e imagem', () => {
    expect(attr(indexHtml, /<meta name="twitter:card" content="([^"]+)"/)).toBe('summary_large_image')
    expect(attr(indexHtml, /<meta name="twitter:title" content="([^"]+)"/)).toBe(PAGE_HEADS.home.ogTitle)
    expect(attr(indexHtml, /<meta name="twitter:description" content="([^"]+)"/)).toBe(PAGE_HEADS.home.ogDescription)
    expect(attr(indexHtml, /<meta name="twitter:image" content="([^"]+)"/)).toBe(OG_IMAGE.url)
  })

  it('tem o ponto da verificação do Search Console, com o valor de exemplo', () => {
    expect(indexHtml).toContain(`<meta name="google-site-verification" content="${SEARCH_CONSOLE_PLACEHOLDER}" />`)
  })

  it('a imagem de compartilhamento existe e é um PNG 1200x630', () => {
    const png = readFileSync(fileURLToPath(new URL('../../public/og-image.png', import.meta.url)))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.length).toBeLessThan(300 * 1024)
  })
})

describe('limpeza do HTML no build', () => {
  it('tira comentários de uma linha e de várias linhas', () => {
    const html = '<head>\n    <!-- um -->\n    <meta a />\n    <!-- dois\n         linhas -->\n    <meta b />\n</head>'
    expect(stripHtmlComments(html)).toBe('<head>\n    <meta a />\n    <meta b />\n</head>')
  })

  it('tira a meta do Search Console enquanto ela tem o valor de exemplo', () => {
    const out = dropUnsetSearchConsoleTag(indexHtml)
    expect(out).not.toContain('google-site-verification')
    expect(out).toContain('<link rel="canonical"')
  })

  it('mantém a meta quando o dono troca pelo código de verdade', () => {
    const real = indexHtml.replace(SEARCH_CONSOLE_PLACEHOLDER, 'abc123XYZ_codigo-real')
    expect(dropUnsetSearchConsoleTag(real)).toContain('<meta name="google-site-verification" content="abc123XYZ_codigo-real" />')
  })
})

describe('head por página', () => {
  it('o /download ganha título, descrição, canonical e compartilhamento próprios', () => {
    const out = applyPageHead(indexHtml, PAGE_HEADS.download)
    expect(attr(out, /<title>([^<]+)<\/title>/)).toBe(PAGE_HEADS.download.title)
    expect(attr(out, /<meta name="description" content="([^"]+)"/)).toBe(PAGE_HEADS.download.description)
    expect(attr(out, /<link rel="canonical" href="([^"]+)"/)).toBe(`${SITE_URL}/download`)
    expect(attr(out, /<meta property="og:url" content="([^"]+)"/)).toBe(`${SITE_URL}/download`)
    expect(attr(out, /<meta property="og:title" content="([^"]+)"/)).toBe(PAGE_HEADS.download.ogTitle)
    expect(attr(out, /<meta name="twitter:description" content="([^"]+)"/)).toBe(PAGE_HEADS.download.ogDescription)
    expect(out).not.toContain('name="robots"')
  })

  it('o /admin sai com noindex', () => {
    const out = applyPageHead(indexHtml, PAGE_HEADS.admin)
    expect(out).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(attr(out, /<link rel="canonical" href="([^"]+)"/)).toBe(`${SITE_URL}/admin`)
  })

  it('falha alto se o index.html perder uma tag (nunca publica head errado)', () => {
    const broken = indexHtml.replace(/<link rel="canonical"[^>]*>/, '')
    expect(() => applyPageHead(broken, PAGE_HEADS.download)).toThrow(/canonical/)
  })
})
