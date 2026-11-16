import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FAQS, LEGAL_LINKS, LEGAL_PAGES, LEGAL_PAGES_LIVE } from './site'
import { SITEMAP_PATHS } from './routes'
import { buildNoscript, buildSitemap } from '../lib/siteSeo'

const file = (p: string) => fileURLToPath(new URL(p, import.meta.url))

describe('páginas legais (rascunho até o dono aprovar)', () => {
  it('o interruptor e os arquivos andam juntos: HTML em public/ só com LEGAL_PAGES_LIVE ligado', () => {
    for (const page of LEGAL_PAGES) {
      expect(existsSync(file(`../../public${page.href}.html`))).toBe(LEGAL_PAGES_LIVE)
      expect(existsSync(file(`../../docs/legal-rascunho${page.href}.html`))).toBe(!LEGAL_PAGES_LIVE)
    }
  })

  it('desligado: nada aponta pra elas (rodapé, sitemap, noscript e FAQ)', () => {
    if (LEGAL_PAGES_LIVE) return
    expect(LEGAL_LINKS).toEqual([])
    expect([...SITEMAP_PATHS]).toEqual(['/', '/download'])
    const sitemap = buildSitemap()
    const noscript = buildNoscript()
    for (const page of LEGAL_PAGES) {
      expect(sitemap).not.toContain(page.href)
      expect(noscript).not.toContain(`href="${page.href}"`)
    }
    for (const f of FAQS) expect(f.a).not.toMatch(/página (Cancelamento|Privacidade|Termos)/)
  })

  it('a lista pra religar tem as três páginas', () => {
    expect(LEGAL_PAGES.map(p => p.href)).toEqual(['/privacidade', '/termos', '/cancelamento'])
  })
})
