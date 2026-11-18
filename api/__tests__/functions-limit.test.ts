import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A Vercel do plano Hobby aceita no máximo 12 funções em api/. Ação nova entra
// como ?action= num endpoint que já existe, nunca como arquivo novo. As pastas
// api/_lib e api/__tests__ não viram função (começam com sublinhado).

const API_DIR = fileURLToPath(new URL('..', import.meta.url))
const NOT_FUNCTIONS = new Set(['_lib', '__tests__'])
// .js também conta: a Vercel transforma qualquer um dos dois em função.
const FUNCTION_FILE = /\.(ts|js|mjs|cjs)$/

function listFunctions(dir: string, top = true): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (top && NOT_FUNCTIONS.has(entry.name)) continue
      out.push(...listFunctions(full, false))
    } else if (FUNCTION_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(relative(API_DIR, full))
    }
  }
  return out.sort()
}

describe('limite de funções da Vercel', () => {
  it('api/ tem exatamente 12 funções', () => {
    const functions = listFunctions(API_DIR)
    expect(functions, functions.join(', ')).toHaveLength(12)
    expect(functions).toContain('admin-stats.ts')
  })

  it('a função do admin tem até 30 s na Vercel', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { functions: Record<string, { maxDuration?: number }> }
    expect(vercel.functions['api/admin-stats.ts']).toEqual({ maxDuration: 30 })
  })
})
