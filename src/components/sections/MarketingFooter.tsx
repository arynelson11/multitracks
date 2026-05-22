import { Link } from 'react-router-dom'
import { PlaybackStudioWordmark } from '../brand/PlaybackStudioWordmark'

interface Props {
  onEnter: () => void
}

export function MarketingFooter({ onEnter }: Props) {
  return (
    <footer className="border-t border-tinta-border py-10 px-5 sm:px-8">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
        <div className="flex items-center gap-3">
          <PlaybackStudioWordmark size="sm" tone="light" />
          <span className="text-warm-400 text-[11px]">a plataforma do domingo</span>
        </div>
        <div className="flex items-center gap-6 text-[12px] text-warm-200">
          <button onClick={onEnter} className="hover:text-bone transition-colors cursor-pointer">Entrar</button>
          <button onClick={onEnter} className="hover:text-bone transition-colors cursor-pointer">Criar conta</button>
          <Link to="/precos" className="hover:text-bone transition-colors">Planos</Link>
          <Link to="/como-funciona" className="hover:text-bone transition-colors">Como funciona</Link>
          <Link to="/faq" className="hover:text-bone transition-colors">FAQ</Link>
          <Link to="/blog" className="hover:text-bone transition-colors">Blog</Link>
        </div>
        <p className="text-[11px] text-warm-400">© {new Date().getFullYear()} Playback Studio · Feito por quem toca.</p>
      </div>
    </footer>
  )
}
