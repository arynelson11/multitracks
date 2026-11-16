// JSON-LD (Organization, WebSite, SoftwareApplication e FAQPage) e o resumo do <noscript>,
// escritos no index.html do site pelo build (plugin em vite.config.ts). Saem dos mesmos
// dados que a landing mostra (src/content/site.ts), então não descolam do texto da página.

import {
  BRAND_NAME, COMPANY, CONTACT, FAQS, LEGAL_LINKS, OG_IMAGE, PAGE_HEADS, PLAN_SUMMARIES, PRICES, SITE_URL,
} from '../content/site'
import { SITEMAP_PATHS } from '../content/routes'
import { formatReais } from './prices'
import { escapeHtml } from './siteHtml'

// faq: só a home mostra a FAQ, então só ela leva o FAQPage (dado estruturado tem que
// bater com o que está visível na página).
export function buildJsonLd({ faq = true }: { faq?: boolean } = {}): string {
  const org = `${SITE_URL}/#organizacao`
  const home = PAGE_HEADS.home
  const offer = (name: string, price: number, billingDuration?: 'P1M' | 'P1Y') => ({
    '@type': 'Offer',
    name,
    price: price.toFixed(2),
    priceCurrency: 'BRL',
    url: `${SITE_URL}/#precos`,
    ...(billingDuration && {
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: price.toFixed(2),
        priceCurrency: 'BRL',
        billingDuration,
      },
    }),
  })
  const graph = [
    {
      '@type': 'Organization',
      '@id': org,
      // O Google mostra o name no painel da marca: vai a marca. A razão social vai em legalName.
      name: BRAND_NAME,
      legalName: COMPANY.name,
      taxID: COMPANY.cnpj,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/pwa-512.png`,
      email: CONTACT.email,
      address: { '@type': 'PostalAddress', addressLocality: COMPANY.city, addressRegion: COMPANY.state, addressCountry: 'BR' },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: CONTACT.email,
        telephone: `+${CONTACT.whatsappNumber}`,
        availableLanguage: 'pt-BR',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#site`,
      url: `${SITE_URL}/`,
      name: BRAND_NAME,
      inLanguage: 'pt-BR',
      publisher: { '@id': org },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#app`,
      name: BRAND_NAME,
      url: `${SITE_URL}/`,
      description: home.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Windows, macOS, Android, iOS, Web',
      inLanguage: 'pt-BR',
      image: OG_IMAGE.url,
      publisher: { '@id': org },
      offers: [
        offer('Livre', 0),
        offer('Pro Mensal', PRICES.pro.monthly, 'P1M'),
        offer('Pro Anual', PRICES.pro.annualTotal, 'P1Y'),
        offer('Studio Mensal', PRICES.studio.monthly, 'P1M'),
        offer('Studio Anual', PRICES.studio.annualTotal, 'P1Y'),
      ],
    },
    faq && {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#perguntas`,
      inLanguage: 'pt-BR',
      mainEntity: FAQS.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ].filter(Boolean)
  // "<" vira \u003c: nenhum texto consegue fechar o <script> antes da hora.
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">${json}</script>`
}

// Resumo do produto pra quem abre sem JavaScript (e robôs que não rodam JS).
export function buildNoscript(): string {
  const p = PRICES
  const plan = (name: string, price: string, text: string) =>
    `<li><strong>${escapeHtml(name)}</strong>: ${escapeHtml(price)}. ${escapeHtml(text)}</li>`
  const links = [
    `<a href="/download">Baixar o app</a>`,
    ...LEGAL_LINKS.map(l => `<a href="${l.href}">${escapeHtml(l.label)}</a>`),
    `<a href="https://wa.me/${CONTACT.whatsappNumber}">WhatsApp ${escapeHtml(CONTACT.whatsappDisplay)}</a>`,
    `<a href="mailto:${CONTACT.email}">${escapeHtml(CONTACT.email)}</a>`,
  ].join(' · ')
  return [
    '<noscript>',
    '<div style="max-width:720px;margin:0 auto;padding:32px 20px;font-family:system-ui,sans-serif;line-height:1.6;color:#E8E8EC;background:#121214">',
    `<h1>${escapeHtml(PAGE_HEADS.home.title)}</h1>`,
    `<p>${escapeHtml(PAGE_HEADS.home.description)}</p>`,
    '<p>O Playback Studio separa qualquer música em multitracks (voz, bateria, baixo, guitarra, piano e outros instrumentos) pra banda da igreja ensaiar e tocar no domingo, com mixer e, nos planos Pro e Studio, troca de tom, BPM e voz guia. Funciona no navegador, no celular e no tablet, e tem app pra Mac e Windows com Modo Ao Vivo.</p>',
    '<h2>Planos</h2>',
    '<ul>',
    plan('Livre', 'grátis', PLAN_SUMMARIES.livre),
    plan('Pro', `R$ ${formatReais(p.pro.monthly)} por mês ou R$ ${formatReais(p.pro.annualTotal)} por ano`, PLAN_SUMMARIES.pro),
    plan('Studio', `R$ ${formatReais(p.studio.monthly)} por mês ou R$ ${formatReais(p.studio.annualTotal)} por ano`, PLAN_SUMMARIES.studio),
    '</ul>',
    `<p>${links}</p>`,
    `<p>${escapeHtml(`${COMPANY.name} · CNPJ ${COMPANY.cnpj} · ${COMPANY.city}/${COMPANY.state}`)}</p>`,
    '<p>Pra usar o Playback Studio, ligue o JavaScript do navegador.</p>',
    '</div>',
    '</noscript>',
  ].join('\n')
}

// JSON-LD no fim do <head> e o resumo logo depois do <div id="root">.
export function injectSiteSeo(html: string): string {
  if (!html.includes('</head>')) throw new Error('siteHtml: index.html sem </head>')
  if (!html.includes('<div id="root"></div>')) throw new Error('siteHtml: index.html sem <div id="root"></div>')
  return html
    .replace('</head>', `  ${buildJsonLd()}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"></div>\n${buildNoscript()}`)
}

// sitemap.xml das páginas públicas (src/content/routes.ts), escrito no build do site.
export function buildSitemap(lastmod: string): string {
  const urls = SITEMAP_PATHS.map(p => {
    const loc = p === '/' ? `${SITE_URL}/` : `${SITE_URL}${p}`
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

// Página sem a FAQ (/download, /admin): troca o JSON-LD da home pelo sem FAQPage.
export function withoutFaqJsonLd(html: string): string {
  const re = /<script type="application\/ld\+json">[\s\S]*?<\/script>/
  if (!re.test(html)) throw new Error('siteSeo: JSON-LD não encontrado no HTML')
  return html.replace(re, () => buildJsonLd({ faq: false }))
}
