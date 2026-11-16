import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
const ROOT = join(process.cwd(), 'src', 'admin')
const IS_TEST = /\.test\.tsx?$/

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

describe('src/admin sem travessão', () => {
  it('nenhum arquivo em src/admin/ contém o travessão', () => {
    const files = listFiles(ROOT).filter((f) => !IS_TEST.test(f))
    expect(files.length).toBeGreaterThan(10)
    const withDash = files.filter((f) => readFileSync(f, 'utf8').includes(TRAVESSAO)).map((f) => relative(ROOT, f))
    expect(withDash).toEqual([])
  })
})
