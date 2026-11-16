import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // api/__tests__: testes do backend (Vercel ignora pastas com sublinhado).
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'], restoreMocks: true },
})
