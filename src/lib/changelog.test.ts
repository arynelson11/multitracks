import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHANGELOG } from './changelog'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }

describe('changelog', () => {
  it('a primeira entrada é a versão do package.json (a aba Sobre mostra essa versão)', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version)
  })
})
