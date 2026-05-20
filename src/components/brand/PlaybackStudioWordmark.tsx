/**
 * PlaybackStudioWordmark
 * ─────────────────────────────────────────────────────────
 * The Playback Studio wordmark — set in Fraunces with refined tracking.
 *
 * Use directly when you need just the typographic mark.
 * For full brand lockups, use <BrandLogo variant="lockup" />.
 *
 * Tone:
 *   - 'dark'  → tinta (#121214) over light surfaces (rare in dark theme)
 *   - 'light' → bone  (#E8E8EC) over dark/musgo backgrounds (default)
 *   - 'accent'→ laranja (#FF6B35) for special moments only
 */

type Size = 'sm' | 'md' | 'lg' | 'xl'
type Tone = 'dark' | 'light' | 'accent'

interface PlaybackStudioWordmarkProps {
  size?: Size
  tone?: Tone
  className?: string
}

const SIZE: Record<Size, string> = {
  sm: 'text-[16px]',
  md: 'text-[20px]',
  lg: 'text-[28px]',
  xl: 'text-[48px]',
}

const TONE: Record<Tone, string> = {
  dark: 'text-tinta',
  light: 'text-bone',
  accent: 'text-laranja',
}

export function PlaybackStudioWordmark({ size = 'md', tone = 'light', className = '' }: PlaybackStudioWordmarkProps) {
  return (
    <span
      className={`font-display font-semibold leading-none inline-flex items-baseline gap-1.5 ${SIZE[size]} ${TONE[tone]} ${className}`}
      style={{
        fontFamily: 'var(--font-display)',
        letterSpacing: '-0.02em',
        fontFeatureSettings: '"ss01"',
      }}
    >
      <span>Playback</span>
      <span className="text-laranja font-medium italic">Studio</span>
    </span>
  )
}
