/**
 * PlayMark
 * ─────────────────────────────────────────────────────────
 * The Playback Studio symbol — a stylized play triangle
 * with horizontal "stem cuts" suggesting the platform's
 * core function: separating any song into stems.
 *
 * Concept:
 *   - Play triangle = action, the universal "go" cue
 *   - Horizontal slices = stems being separated
 *   - 4 bands = canonical stem split (voz/baixo/bateria/outros)
 *
 * Color: defaults to laranja (#FF6B35) via currentColor.
 * Background: transparent — cuts adapt to whatever's behind.
 *
 * Usage:
 *   <PlayMark size="md" />                      // laranja default
 *   <PlayMark size="lg" className="text-bone" /> // monochrome
 *   <PlayMark size="favicon" />                  // simplified for 16px
 */

type Size = 'favicon' | 'sm' | 'md' | 'lg' | 'xl'

interface PlayMarkProps {
  size?: Size
  className?: string
}

const PIXEL_SIZE: Record<Size, number> = {
  favicon: 16,
  sm: 20,
  md: 28,
  lg: 40,
  xl: 64,
}

export function PlayMark({ size = 'md', className = '' }: PlayMarkProps) {
  const px = PIXEL_SIZE[size]
  // Favicon uses 2 cuts (wider stroke) for legibility at small size.
  // All other sizes use 3 cuts for proper "4-stem" reading.
  const isFavicon = size === 'favicon'
  const maskId = `playmark-cuts-${size}`

  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      xmlns="http://www.w3.org/2000/svg"
      className={`text-laranja inline-block ${className}`}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect width="64" height="64" fill="white" />
          {isFavicon ? (
            <>
              <line x1="0" y1="27" x2="64" y2="27" stroke="black" strokeWidth="5" />
              <line x1="0" y1="37" x2="64" y2="37" stroke="black" strokeWidth="5" />
            </>
          ) : (
            <>
              <line x1="0" y1="22" x2="64" y2="22" stroke="black" strokeWidth="4" />
              <line x1="0" y1="32" x2="64" y2="32" stroke="black" strokeWidth="4" />
              <line x1="0" y1="42" x2="64" y2="42" stroke="black" strokeWidth="4" />
            </>
          )}
        </mask>
      </defs>
      <path
        d="M 14 12 L 52 32 L 14 52 Z"
        fill="currentColor"
        mask={`url(#${maskId})`}
        strokeLinejoin="round"
      />
    </svg>
  )
}
