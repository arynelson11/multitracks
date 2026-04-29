import { AudioLines } from 'lucide-react'

type Size = 'sm' | 'md' | 'lg'

interface BrandLogoProps {
  size?: Size
}

const config: Record<Size, { box: string; icon: number; text: string; sub: string }> = {
  sm: { box: 'w-6 h-6 rounded-md',  icon: 12, text: 'text-[12px] tracking-[0.16em]', sub: 'text-[7px] tracking-[0.3em]' },
  md: { box: 'w-7 h-7 rounded-[9px]', icon: 14, text: 'text-[13px] tracking-[0.18em]', sub: 'text-[8px]  tracking-[0.32em]' },
  lg: { box: 'w-9 h-9 rounded-xl',  icon: 18, text: 'text-[16px] tracking-[0.2em]',  sub: 'text-[9px]  tracking-[0.35em]' },
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  const c = config[size]

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${c.box} flex items-center justify-center flex-shrink-0 border border-white/[0.08]`}
        style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.12) 0%, rgba(168,85,247,0.18) 100%)' }}
      >
        <AudioLines size={c.icon} strokeWidth={2.2} className="text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
      </div>

      <div className="flex flex-col leading-none gap-[2px]">
        <span className={`font-black uppercase ${c.text} text-white leading-none`}>
          Playback
        </span>
        <span className={`font-bold uppercase ${c.sub} leading-none`}
          style={{ background: 'linear-gradient(90deg,#22d3ee,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Studio
        </span>
      </div>
    </div>
  )
}
