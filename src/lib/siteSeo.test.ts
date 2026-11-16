import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildJsonLd, buildNoscript, injectSiteSeo, withoutFaqJsonLd } from './siteSeo'
import { FAQS } from '../content/site'

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

type Node = Record<string, unknown> & { '@type': string }
const graph = (script: string): Node[] => {
  const json = script.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '')
  const data = JSON.parse(json) as { '@context': string; '@graph': Node[] }
  expect(data['@context']).toBe('https://schema.org')
  return data['@graph']
}
const byType = (nodes: Node[], type: string) => nodes.find(n => n['@type'] === type)

describe('JSON-LD', () => {
  const nodes = graph(buildJsonLd())

  it('Organization é o Grupo AIO com o CNPJ', () => {
    const org = byType(nodes, 'Organization')
    expect(org?.name).toBe('Grupo AIO')
    expect(org?.taxID).toBe('43.247.025/0001-05')
    expect(org?.email).toBe('contatoplaybackstudio@gmail.com')
    expect((org?.brand as Node).name).toBe('Playback Studio')
    expect((org?.address as Node).addressLocality).toBe('Macaé')
  })

  it('SoftwareApplication com os preços do FATOS', () => {
    const app = byType(nodes, 'SoftwareApplication')
    expect(app?.name).toBe('Playback Studio')
    expect(app?.applicationCategory).toBe('MultimediaApplication')
    const offers = app?.offers as Node[]
    expect(offers.map(o => [o.name, o.price, o.priceCurrency])).toEqual([
      ['Livre', '0.00', 'BRL'],
      ['Pro Mensal', '49.90', 'BRL'],
      ['Pro Anual', '454.80', 'BRL'],
      ['Studio Mensal', '119.90', 'BRL'],
      ['Studio Anual', '1078.80', 'BRL'],
    ])
    expect(app).not.toHaveProperty('aggregateRating')
  })

  it('FAQPage com as perguntas e respostas reais da landing', () => {
    const faq = byType(nodes, 'FAQPage')
    const items = faq?.mainEntity as Node[]
    expect(items).toHaveLength(FAQS.length)
    items.forEach((q, i) => {
      expect(q.name).toBe(FAQS[i].q)
      expect((q.acceptedAnswer as Node).text).toBe(FAQS[i].a)
    })
  })

  it('nenhum texto fecha o <script> antes da hora', () => {
    expect(buildJsonLd().slice(0, -'</script>'.length)).not.toMatch(/<\//)
  })

  it('páginas sem FAQ (download e admin) saem sem o FAQPage', () => {
    const html = withoutFaqJsonLd(injectSiteSeo(indexHtml))
    const script = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0] ?? ''
    const types = graph(script).map(n => n['@type'])
    expect(types).toEqual(['Organization', 'WebSite', 'SoftwareApplication'])
  })
})

describe('noscript', () => {
  const html = buildNoscript()
  it('resume o produto com os planos, os preços e os links', () => {
    expect(html.startsWith('<noscript>')).toBe(true)
    expect(html).toContain('R$ 49,90 por mês ou R$ 454,80 por ano')
    expect(html).toContain('R$ 119,90 por mês ou R$ 1.078,80 por ano')
    expect(html).toContain('href="/download"')
    expect(html).toContain('href="/privacidade"')
    expect(html).toContain('Grupo AIO · CNPJ 43.247.025/0001-05 · Macaé/RJ')
    expect(html).toContain('multitracks')
    expect(html).not.toContain('—')
  })
})

describe('injectSiteSeo', () => {
  it('põe o JSON-LD no fim do head e o noscript logo depois do root', () => {
    const out = injectSiteSeo(indexHtml)
    expect(out.indexOf('application/ld+json')).toBeLessThan(out.indexOf('</head>'))
    expect(out).toMatch(/<div id="root"><\/div>\n<noscript>/)
    expect(out.match(/<noscript>/g)).toHaveLength(1)
  })
})
