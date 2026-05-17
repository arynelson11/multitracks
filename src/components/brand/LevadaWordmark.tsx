/**
 * LevadaWordmark
 * ─────────────────────────────────────────────────────────
 * The Levada wordmark — set in Fraunces with refined tracking.
 *
 * Use directly when you need just the typographic mark.
 * For full brand lockups, use <BrandLogo variant="lockup" />.
 *
 * Tone:
 *   - 'dark'  → tinta (#1F1B16) over light backgrounds (default)
 *   - 'light' → bone  (#F7F3ED) over dark/musgo backgrounds
 *   - 'accent'→ terracota (#B85C38) for special moments only
 */

type Size = 'sm' | 'md' | 'lg' | 'xl'
type Tone = 'dark' | 'light' | 'accent'

interface LevadaWordmarkProps {
  size?: Size
  tone?: Tone
  className?: string
}

const SIZE: Record<Size, string> = {
  sm: 'text-[18px]',
  md: 'text-[24px]',
  lg: 'text-[36px]',
  xl: 'text-[64px]',
}

const TONE: Record<Tone, string> = {
  dark: 'text-tinta',
  light: 'text-bone',
  accent: 'text-terracota',
}

export function LevadaWordmark({ size = 'md', tone = 'dark', className = '' }: LevadaWordmarkProps) {
  return (
    <span
      className={`font-display font-semibold leading-none ${SIZE[size]} ${TONE[tone]} ${className}`}
      style={{
        fontFamily: 'var(--font-display)',
        letterSpacing: '-0.02em',
        fontFeatureSettings: '"ss01"',
      }}
    >
      Levada
    </span>
  )
}
