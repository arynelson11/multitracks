import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SITEMAP_PAGES, SITEMAP_PATHS } from './routes'
import { SITE_URL } from './site'
import { buildSitemap } from '../lib/siteSeo'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

afterEach(() => { vi.useRealTimers() })

describe('robots.txt e sitemap.xml', () => {
  const robots = read('../../public/robots.txt')

  it('robots libera o site, esconde /admin e aponta o sitemap', () => {
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Allow: \/$/m)
    expect(robots).toMatch(/^Disallow: \/admin$/m)
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
  })

  it('o sitemap (gerado no build) lista as páginas públicas com endereço absoluto e sem /admin', () => {
    const sitemap = buildSitemap()
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
    expect(locs).toEqual(SITEMAP_PATHS.map(p => (p === '/' ? `${SITE_URL}/` : `${SITE_URL}${p}`)))
    expect(sitemap).not.toContain('/admin')
    const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1])
    expect(lastmods).toEqual(SITEMAP_PAGES.map(p => p.lastmod))
  })

  it('o lastmod é a data da última mudança de cada página, não a data do build', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
    const sitemap = buildSitemap()
    expect(sitemap).not.toContain('2030-01-01')
    for (const page of SITEMAP_PAGES) expect(page.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(SITEMAP_PAGES.find(p => p.path === '/')?.lastmod).toBe('2026-11-21')
    expect(SITEMAP_PAGES.find(p => p.path === '/download')?.lastmod).toBe('2026-11-21')
  })
})
