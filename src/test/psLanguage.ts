// Trava da linguagem nova nas telas (Parte 3): acha as classes do visual antigo que sobraram numa
// tela montada. O que conta como antigo: o dourado `primary` e o ciano `secondary` do DAW, as
// classes `daw-*`, cor em hex solto na classe, texto de 8 e 9 px, as cores prontas do Tailwind
// (zinc, orange, red...), o branco solto, os tokens do DAW (`text-muted`, `border`, `card`...),
// as fontes antigas (`font-mono`, `font-sans`) e as peças do palco antigo. O `font-display` (Fraunces)
// não entra: é a fonte da marca, que o `PlaybackStudioWordmark` usa em qualquer tela.
const OLD: RegExp[] = [
  /(^|:)(bg|text|border|shadow|ring|from|to|via|outline|fill|stroke|accent)-(primary|secondary)(-dim)?(\/\d+)?$/,
  /^daw-/,
  /\[#[0-9a-f]{3,8}\]/i,
  /(^|:)text-\[(8|9)px\]$/,
  /(^|:)[a-z-]+-(zinc|orange|emerald|red|neutral|gray|slate|amber|cyan)-\d{2,3}(\/\d+)?$/,
  /(^|:)(text|border)-white(\/\d+)?$/,
  /(^|:)bg-white\/\d+$/,
  /(^|:)text-black$/,
  /(^|:)(text|bg|border)-(text-muted|text-main|card|border|border-light|surface|surface-raised|background)(\/\d+)?$/,
  /(^|:)(text|bg|border)-accent-[a-z]+(\/\d+)?$/,
  /^font-(mono|sans)$/,
  /^(lcd-display|hw-btn)$/,
]

/** Classes do visual antigo em `root` e nos elementos dentro dele (lista vazia = só linguagem nova). */
export function oldLanguageClasses(root: ParentNode): string[] {
  const els: Element[] = [...root.querySelectorAll('*')]
  if (root instanceof Element) els.unshift(root)
  const found = new Set<string>()
  for (const el of els) {
    const cls = el.getAttribute('class')
    if (!cls) continue
    for (const c of cls.split(/\s+/)) if (c && OLD.some((re) => re.test(c))) found.add(c)
  }
  return [...found]
}
