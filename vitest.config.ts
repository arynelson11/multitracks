import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // api/__tests__: testes do backend (Vercel ignora pastas com sublinhado).
  // execArgv: no Node 25+ o localStorage próprio do Node esconde o do jsdom;
  // desligado, o portão não depende da versão do Node da máquina.
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
    restoreMocks: true,
    execArgv: ['--no-experimental-webstorage'],
  },
})
