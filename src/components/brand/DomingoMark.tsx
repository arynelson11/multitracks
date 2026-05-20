/**
 * DomingoMark — Visual Hammer
 * ─────────────────────────────────────────────────────────
 * The handwritten word "domingo." rendered as the brand's
 * Visual Hammer (Al Ries' Verbal Nail made visible).
 *
 * Current implementation uses Caveat font as a placeholder.
 * PRODUCTION TODO: replace with custom hand-drawn SVG asset
 * commissioned from an illustrator, to ensure trademarkability
 * and full ownability (Brand Book §4.1, §4.3).
 *
 * Default rendering: laranja over dark background, with
 * a slight rotation to evoke a quick handwritten note.
 */

type Size = 'sm' | 'md' | 'lg' | 'xl'
type Tone = 'laranja' | 'tinta' | 'bone'

interface DomingoMarkProps {
  size?: Size
  tone?: Tone
  rotate?: boolean
  withPeriod?: boolean
  className?: string
}

const SIZE: Record<Size, string> = {
  sm: 'text-[24px]',
  md: 'text-[36px]',
  lg: 'text-[56px]',
  xl: 'text-[88px]',
}

const TONE: Record<Tone, string> = {
  laranja: 'text-laranja',
  tinta: 'text-tinta',
  bone: 'text-bone',
}

export function DomingoMark({
  size = 'md',
  tone = 'laranja',
  rotate = true,
  withPeriod = true,
  className = '',
}: DomingoMarkProps) {
  return (
    <span
      className={`font-handwriting inline-block leading-none ${SIZE[size]} ${TONE[tone]} ${className}`}
      style={{
        fontFamily: 'var(--font-handwriting)',
        fontWeight: 500,
        transform: rotate ? 'rotate(-2deg)' : undefined,
      }}
    >
      domingo{withPeriod && '.'}
    </span>
  )
}
