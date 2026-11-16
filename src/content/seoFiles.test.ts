import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SITEMAP_PATHS } from './routes'
import { SITE_URL } from './site'
import { buildSitemap } from '../lib/siteSeo'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

describe('robots.txt e sitemap.xml', () => {
  const robots = read('../../public/robots.txt')

  it('robots libera o site, esconde /admin e aponta o sitemap', () => {
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Allow: \/$/m)
    expect(robots).toMatch(/^Disallow: \/admin$/m)
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
  })

  it('o sitemap (gerado no build) lista as páginas públicas com endereço absoluto e sem /admin', () => {
    const sitemap = buildSitemap('2026-11-16')
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
    expect(locs).toEqual(SITEMAP_PATHS.map(p => (p === '/' ? `${SITE_URL}/` : `${SITE_URL}${p}`)))
    expect(sitemap).not.toContain('/admin')
    expect(sitemap.match(/<lastmod>2026-11-16<\/lastmod>/g)).toHaveLength(SITEMAP_PATHS.length)
  })
})
