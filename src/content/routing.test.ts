import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_ROUTES, SW_NAVIGATION_ALLOWLIST, SW_PRECACHE_IGNORES } from './routes'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

interface VercelHeader { key: string; value: string }
interface VercelConfig {
  cleanUrls?: boolean
  trailingSlash?: boolean
  rewrites?: { source: string; destination: string }[]
  redirects?: { source: string; destination: string; permanent?: boolean; has?: { type: string; value: string }[] }[]
  headers?: { source: string; headers: VercelHeader[] }[]
}
const vercel = JSON.parse(read('../../vercel.json')) as VercelConfig

describe('vercel.json', () => {
  it('serve page.html em /page (cleanUrls) e tira a barra do fim', () => {
    expect(vercel.cleanUrls).toBe(true)
    expect(vercel.trailingSlash).toBe(false)
  })

  it('não manda endereço desconhecido pro index.html (sem soft 404)', () => {
    for (const r of vercel.rewrites ?? []) {
      expect(r.destination).not.toMatch(/index\.html$/)
    }
  })

  it('mantém as funções de /api', () => {
    expect(vercel.rewrites).toContainEqual({ source: '/api/(.*)', destination: '/api/$1' })
  })
})

describe('página 404', () => {
  const html = read('../../public/404.html')
  it('é uma página própria, fora do índice, com volta pra home', () => {
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('<html lang="pt-BR">')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('href="/"')
    expect(html).not.toContain('<!--')
    expect(html).not.toContain('—')
    expect(html).not.toMatch(/<script/i)
  })
})

describe('service worker', () => {
  const served = (url: string) => SW_NAVIGATION_ALLOWLIST.some(re => re.test(url))
  it('entrega o app guardado só nas rotas do app, inclusive com query', () => {
    for (const r of APP_ROUTES) expect(served(r)).toBe(true)
    expect(served('/?payment=success')).toBe(true)
    expect(served('/?s=ABC123')).toBe(true)
    expect(served('/download?origem=whatsapp')).toBe(true)
  })
  it('com barra no fim vai pra rede (a Vercel faz o 308; o app compara o caminho exato)', () => {
    for (const p of ['/download/', '/admin/', '/download/?x=1', '/admin/?x=1']) expect(served(p)).toBe(false)
  })

  it('o 404 e a imagem de compartilhamento não entram no precache', () => {
    expect(SW_PRECACHE_IGNORES).toContain('**/404.html')
    expect(SW_PRECACHE_IGNORES).toContain('**/og-image.png')
    expect(SW_PRECACHE_IGNORES).toContain('**/node_modules/**/*')
  })

  it('deixa páginas legais, 404 e arquivos irem pra rede', () => {
    for (const p of ['/privacidade', '/termos', '/cancelamento', '/pagina-que-nao-existe', '/robots.txt', '/sitemap.xml', '/downloads', '/admin/x']) {
      expect(served(p)).toBe(false)
    }
  })
})
