/**
 * BrandLogo — Levada
 * ─────────────────────────────────────────────────────────
 * The official brand lockup for Levada.
 *
 * Variants:
 *   - 'wordmark' (default) → just the Levada wordmark
 *   - 'lockup'             → Levada + "domingo" Visual Hammer below
 *
 * Tone:
 *   - 'dark'  (default) → for light backgrounds (bone, light surfaces)
 *   - 'light'           → for dark/musgo backgrounds (e.g. footer, dark mode)
 *
 * Size affects both the wordmark and the optional Visual Hammer.
 *
 * Public API kept backwards-compatible with the previous
 * Playback Studio component: existing `<BrandLogo size="sm" />`
 * usages continue to work without changes.
 */

import { LevadaWordmark } from './brand/LevadaWordmark'
import { DomingoMark } from './brand/DomingoMark'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'wordmark' | 'lockup'
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
  md: 'sm',
  lg: 'md',
}

export function BrandLogo({
  size = 'md',
  variant = 'wordmark',
  tone = 'dark',
  className = '',
}: BrandLogoProps) {
  if (variant === 'lockup') {
    return (
      <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
        <LevadaWordmark size={WORDMARK_SIZE[size]} tone={tone} />
        <DomingoMark
          size={MARK_SIZE[size]}
          tone={tone === 'light' ? 'bone' : 'terracota'}
        />
      </div>
    )
  }

  return <LevadaWordmark size={WORDMARK_SIZE[size]} tone={tone} className={className} />
}
