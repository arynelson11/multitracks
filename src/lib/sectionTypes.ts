// Tipos de seção da música (Intro, Verso, Pré, Refrão, Ponte, Final): nome, tecla do atalho e
// cor de cada um, e o limite do nome de seção. Puro: sem React. O SectionBar reexporta os dois
// primeiros pra quem ainda importa de lá.

// Atalhos pra marcar uma seção no calor do ao vivo: a tecla cria a seção no
// ponto atual já com o nome e a cor do tipo. `code` usa a tecla física
// (independe de layout). Pré e Ponte colidem em "P", então Ponte usa "B".
// Nenhuma dessas cores repete a cor de uma família de canal (Ruling T21).
export const SECTION_SHORTCUTS: { name: string; key: string; code: string; color: string }[] = [
  { name: 'Intro', key: 'I', code: 'KeyI', color: '#3b82f6' },
  { name: 'Verso', key: 'V', code: 'KeyV', color: '#10b981' },
  { name: 'Pré', key: 'P', code: 'KeyP', color: '#f59e0b' },
  { name: 'Refrão', key: 'R', code: 'KeyR', color: '#FF6B35' },
  { name: 'Ponte', key: 'B', code: 'KeyB', color: '#8b5cf6' },
  { name: 'Final', key: 'F', code: 'KeyF', color: '#ec4899' },
]

/** Cor de um tipo de seção pelo nome (fallback laranja pra nomes customizados). */
export function colorForSection(label: string): string {
  return SECTION_SHORTCUTS.find((s) => s.name.toLowerCase() === label.trim().toLowerCase())?.color || '#FF6B35'
}

/**
 * Nome de seção tem até 14 caracteres (Ruling T8-4): é o que cabe no aviso PRÓXIMA e na
 * botoeira. Quem limita é quem dá o nome (o modo EDITAR); nome antigo mais longo, que já está
 * salvo, quebra a linha ou encolhe na tela, mas nunca é cortado.
 */
export const SECTION_NAME_MAX = 14

/**
 * Nome dado agora a uma seção: acentos juntados (NFC, pra "é" decomposto contar 1), espaços
 * colapsados, trim, no máximo `SECTION_NAME_MAX`, sem espaço sobrando no fim e sem partir um
 * emoji (par de surrogates) ao meio. Mesma regra do nome do canal (`normalizeCustomName`), mais
 * o NFC. Emoji conta 2. Vazio quando não sobra nada.
 */
export function normalizeSectionName(raw: string): string {
  let name = raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, SECTION_NAME_MAX)
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1)
  return name.trimEnd()
}

const DEFAULT_NAME = new RegExp(`^(${SECTION_SHORTCUTS.map((s) => s.name).join('|')})(?: (\\d+))?$`, 'iu')

/**
 * Nome padrão de um tipo ("Verso", "refrão 2"): o tipo, escrito como no atalho, e o número que
 * vem depois (ou nulo). Nome próprio ("Ministração da Palavra", "Pré-refrão 1") dá nulo. Caixa,
 * espaços e acento decomposto não contam (Ruling T16-nome-proprio).
 */
export function defaultSectionName(label: string): { type: string; number: string | null } | null {
  const m = DEFAULT_NAME.exec(label.normalize('NFC').replace(/\s+/g, ' ').trim())
  if (!m) return null
  const type = SECTION_SHORTCUTS.find((s) => s.name.toLowerCase() === m[1].toLowerCase())?.name
  return type ? { type, number: m[2] ?? null } : null
}
