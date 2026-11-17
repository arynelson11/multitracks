import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Nomes e e-mail montados em tempo de execução: assim este arquivo nunca os contém.
const OWNER = ['arynelson11', 'gmail.com'].join('@')
const OLD_HELPER = ['isAdmin', 'Email'].join('')
const OLD_LIST = ['ADMIN', 'EMAILS'].join('_')

const SRC = join(process.cwd(), 'src')
const IS_TEST = /\.test\.tsx?$/
const IS_TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|md|svg)$/

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

const sourceFiles = () => listFiles(SRC).filter((f) => IS_TEXT.test(f) && !IS_TEST.test(f))
const filesContaining = (text: string) =>
  sourceFiles().filter((f) => readFileSync(f, 'utf8').includes(text)).map((f) => relative(SRC, f))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

// Abrir o admin por endereço não funciona no app de computador (file://).
const NAVIGATES_TO_ADMIN = /location\.(href\s*=|assign\(|replace\()\s*['"`][^'"`]*\/admin/

describe('entrada do admin pelo app', () => {
  it('App.tsx não abre o admin por endereço', () => {
    const app = read('App.tsx')
    expect(app).not.toMatch(NAVIGATES_TO_ADMIN)
    // Abre por estado interno, só pra quem tem o papel, com a volta pro app.
    expect(app).toMatch(/const \[isAdminPanelOpen, setIsAdminPanelOpen\] = useState\(false\)/)
    expect(app).toMatch(/if \(isAdminPanelOpen && isAdmin\)/)
    expect(app).toMatch(/<AdminApp onClose=\{\(\) => setIsAdminPanelOpen\(false\)\} \/>/)
    expect(app.match(/<AdminEntryButton\b/g)?.length).toBe(2)
  })

  it('a rota /admin da web continua', () => {
    expect(read('App.tsx')).toContain("window.location.pathname === '/admin'")
  })

  it('o botão de entrada não usa o endereço', () => {
    const button = read('components/AdminEntryButton.tsx')
    expect(button).not.toMatch(/window\.location|location\.(href|assign|replace)/)
  })

  it('nada em src/ cita isAdminEmail nem ADMIN_EMAILS', () => {
    expect(sourceFiles().length).toBeGreaterThan(50)
    expect(filesContaining(OLD_HELPER)).toEqual([])
    expect(filesContaining(OLD_LIST)).toEqual([])
  })

  it('src/lib/admin.ts não existe', () => {
    expect(existsSync(join(SRC, 'lib', 'admin.ts'))).toBe(false)
  })

  it('nada em src/ contém o e-mail do dono', () => {
    expect(filesContaining(OWNER)).toEqual([])
  })
})
