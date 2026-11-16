import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
const headersFor = (source: string) => vercel.headers?.find(h => h.source === source)?.headers ?? []
const header = (source: string, key: string) =>
  headersFor(source).find(h => h.key.toLowerCase() === key.toLowerCase())?.value

describe('vercel.json: cabeçalhos e www', () => {
  it('www vai pro domínio sem www com redirecionamento permanente', () => {
    const www = vercel.redirects?.find(r => r.has?.some(h => h.type === 'host' && h.value === 'www.playbackstudio.com.br'))
    expect(www).toBeTruthy()
    expect(www?.permanent).toBe(true)
    expect(www?.destination).toBe('https://playbackstudio.com.br/$1')
  })

  it('arquivo com hash em /assets fica em cache por 1 ano, imutável', () => {
    expect(header('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it('cabeçalhos de segurança em tudo que não é /api', () => {
    const src = '/((?!api/).*)'
    expect(header(src, 'X-Content-Type-Options')).toBe('nosniff')
    expect(header(src, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header(src, 'X-Frame-Options')).toBe('DENY')
    expect(header(src, 'Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  it('Permissions-Policy deixa o microfone pro próprio site e bloqueia câmera e localização', () => {
    const pp = header('/((?!api/).*)', 'Permissions-Policy') ?? ''
    expect(pp).toContain('microphone=(self)')
    expect(pp).toContain('camera=()')
    expect(pp).toContain('geolocation=()')
  })

  it('/admin fora do índice do Google', () => {
    expect(header('/admin', 'X-Robots-Tag')).toBe('noindex, nofollow')
  })
})
