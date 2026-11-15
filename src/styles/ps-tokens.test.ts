import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const vars = (css: string) =>
  Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))

// Cópia literal das 38 declarações do bloco @theme de src/index.css em HEAD (bloco das linhas 14 a 70).
const LEGACY: Record<string, string> = {
  '--color-laranja': '#FF6B35',
  '--color-laranja-light': '#FF9268',
  '--color-laranja-dark': '#CC4A1F',
  '--color-laranja-wash': '#FFE5DC',
  '--color-musgo': '#5B6B47',
  '--color-musgo-light': '#8B9B6E',
  '--color-musgo-dark': '#3D4A2F',
  '--color-musgo-wash': '#E6E8DC',
  '--color-bone': '#E8E8EC',
  '--color-tinta': '#121214',
  '--color-tinta-raised': '#1A1A1E',
  '--color-tinta-soft': '#0E0E10',
  '--color-tinta-border': '#2A2A2E',
  '--color-warm-100': '#D4D4D8',
  '--color-warm-200': '#A1A1AA',
  '--color-warm-400': '#71717A',
  '--color-warm-600': '#52525B',
  '--color-background': '#121214',
  '--color-surface': '#1a1a1e',
  '--color-surface-raised': '#222226',
  '--color-primary': '#d4a843',
  '--color-primary-dim': '#b8922e',
  '--color-secondary': '#06b6d4',
  '--color-accent-green': '#4ade80',
  '--color-accent-red': '#ef4444',
  '--color-accent-amber': '#f59e0b',
  '--color-text-main': '#d0d0d4',
  '--color-text-muted': '#71717a',
  '--color-border': '#2a2a2e',
  '--color-border-light': '#333338',
  '--color-success': '#5B6B47',
  '--color-warning': '#F5A524',
  '--color-error': '#EF4444',
  '--color-info': '#5C6E7E',
  '--font-display': "'Fraunces', 'Times New Roman', Georgia, serif",
  '--font-sans': "'Inter', system-ui, -apple-system, sans-serif",
  '--font-mono': "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
  '--font-handwriting': "'Caveat', 'Brush Script MT', cursive",
}

// Todas as linhas da tabela de tokens da Tarefa 2 (valores do mockup v5).
const NEW: Record<string, string> = {
  // Fundo e superfícies
  '--color-ps-ink': '#121214',
  '--color-ps-ink-0': '#0b0b0d',
  '--color-ps-s1': '#17171a',
  '--color-ps-s2': '#1f1f23',
  '--color-ps-s3': '#2b2b31',
  '--color-ps-raised': '#1b1b1f',
  '--color-ps-pop': '#1d1d22',
  '--color-ps-well': '#151518',
  // Linhas
  '--color-ps-line': 'rgba(255,255,255,.07)',
  '--color-ps-line-2': 'rgba(255,255,255,.15)',
  '--color-ps-line-3': 'rgba(255,255,255,.28)',
  // Texto
  '--color-ps-bone': '#E8E8EC',
  '--color-ps-mut': '#9d9da8',
  '--color-ps-dim': '#686872',
  // Laranja (ligado)
  '--color-ps-or': '#FF6B35',
  '--color-ps-or-soft': 'rgba(255,107,53,.12)',
  '--color-ps-or-line': 'rgba(255,107,53,.55)',
  '--color-ps-on-or': '#1a0b04',
  // Musgo
  '--color-ps-moss': '#5B6B47',
  '--color-ps-moss-hi': '#a9c47f',
  // Armado e alerta
  '--color-ps-arm': '#F5F5F7',
  '--color-ps-alert': '#fbbf24',
  '--color-ps-alert-soft': 'rgba(251,191,36,.12)',
  '--color-ps-alert-line': 'rgba(251,191,36,.5)',
  // Mixer
  '--color-ps-mute': '#ef4444',
  '--color-ps-solo': '#facc15',
  // Seções
  '--color-ps-sec-intro': '#3b82f6',
  '--color-ps-sec-verso': '#10b981',
  '--color-ps-sec-pre': '#f59e0b',
  '--color-ps-sec-refrao': '#FF6B35',
  '--color-ps-sec-ponte': '#8b5cf6',
  '--color-ps-sec-final': '#ec4899',
  // Raios
  '--radius-ps-xs': '6px',
  '--radius-ps-sm': '8px',
  '--radius-ps-md': '10px',
  '--radius-ps-lg': '12px',
  '--radius-ps-xl': '14px',
  '--radius-ps-2xl': '16px',
  '--radius-ps-pill': '999px',
  // Espaços
  '--spacing-ps-gutter': '16px',
  '--spacing-ps-gap': '8px',
  '--spacing-ps-pad-x': '12px',
  '--spacing-ps-touch': '44px',
  // Texto
  '--text-ps-micro': '10px',
  '--text-ps-label': '10.5px',
  '--text-ps-sm': '11px',
  '--text-ps-base': '13px',
  '--text-ps-md': '16px',
  '--text-ps-lg': '21px',
  // Fontes
  '--font-ps-sans': "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--font-ps-mono': "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  // Sombra
  '--shadow-ps-pop': '0 20px 50px rgba(0,0,0,.65)',
  // Animação
  '--animate-ps-blink': 'ps-blink 1.4s ease-in-out infinite',
}

describe('tokens da linguagem nova', () => {
  it('tokens antigos continuam idênticos (as telas da Parte 3 não mudam)', () => {
    const v = vars(read('../index.css'))
    expect(Object.keys(LEGACY)).toHaveLength(38)
    for (const [k, val] of Object.entries(LEGACY)) expect(v[k]).toBe(val)
  })
  it('index.css não declara nenhum token ps- e importa ps-tokens logo depois do tailwind', () => {
    const css = read('../index.css')
    expect(css).not.toMatch(/--[\w-]*-ps-/)
    expect(css).toMatch(/@import "tailwindcss";\s*\n@import "\.\/styles\/ps-tokens\.css";/)
  })
  it('tokens novos com os valores do mockup v5, num @theme static', () => {
    const css = read('./ps-tokens.css')
    expect(css).toMatch(/@theme static\s*\{/)
    const v = vars(css)
    for (const [k, val] of Object.entries(NEW)) expect(v[k]).toBe(val)
    expect(css).toMatch(/@utility ps-num/)
    expect(css).toMatch(/@utility ps-label/)
    expect(css).not.toContain('\u2014')
  })
  it('main.tsx carrega as fontes empacotadas antes do index.css', () => {
    const main = read('../main.tsx')
    const iInter = main.indexOf('@fontsource-variable/inter')
    const iMono = main.indexOf('@fontsource-variable/jetbrains-mono')
    const iCss = main.indexOf("'./index.css'")
    expect(iInter).toBeGreaterThan(-1)
    expect(iMono).toBeGreaterThan(-1)
    expect(Math.max(iInter, iMono)).toBeLessThan(iCss)
  })
})
