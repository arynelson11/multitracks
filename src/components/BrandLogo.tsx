/**
 * BrandLogo — Playback Studio
 * ─────────────────────────────────────────────────────────
 * The official brand lockup for Playback Studio.
 *
 * Variants:
 *   - 'wordmark' (default) → just the Playback Studio wordmark
 *   - 'mark'               → just the PlayMark symbol (favicon/app-icon contexts)
 *   - 'horizontal'         → PlayMark + Playback Studio wordmark, side-by-side
 *   - 'lockup'             → wordmark + "domingo." Visual Hammer below
 *   - 'full'               → PlayMark + wordmark + "domingo." (peak signature)
 *
 * Tone:
 *   - 'dark'            → for light backgrounds (rare in dark theme)
 *   - 'light' (default) → for dark backgrounds (default app context)
 */

import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'
import { DomingoMark } from './brand/DomingoMark'
import { PlayMark } from './brand/PlayMark'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'wordmark' | 'mark' | 'horizontal' | 'lockup' | 'full'
type Tone = 'dark' | 'light'

interface BrandLogoProps {
  size?: Size
  variant?: Variant
  tone?: Tone
  className?: string
}

const WORDMARK_SIZE: Record<Size, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
}

const MARK_SIZE: Record<Size, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
}

const DOMINGO_SIZE: Record<Size, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
}

export function BrandLogo({
  size = 'md',
  variant = 'wordmark',
  tone = 'light',
  className = '',
}: BrandLogoProps) {
  if (variant === 'mark') {
    return <PlayMark size={MARK_SIZE[size]} className={className} />
  }

  if (variant === 'horizontal') {
    return (
      <div className={`inline-flex items-center gap-2.5 ${className}`}>
        <PlayMark size={MARK_SIZE[size]} />
        <PlaybackStudioWordmark size={WORDMARK_SIZE[size]} tone={tone} />
      </div>
    )
  }

  if (variant === 'lockup') {
    return (
      <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
        <PlaybackStudioWordmark size={WORDMARK_SIZE[size]} tone={tone} />
        <DomingoMark size={DOMINGO_SIZE[size]} tone="laranja" />
      </div>
    )
  }

  if (variant === 'full') {
    return (
      <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
        <div className="inline-flex items-center gap-2.5">
          <PlayMark size={MARK_SIZE[size]} />
          <PlaybackStudioWordmark size={WORDMARK_SIZE[size]} tone={tone} />
        </div>
        <DomingoMark size={DOMINGO_SIZE[size]} tone="laranja" />
      </div>
    )
  }

  return <PlaybackStudioWordmark size={WORDMARK_SIZE[size]} tone={tone} className={className} />
}
