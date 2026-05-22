import { Link } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'

interface Props {
  onEnter: () => void
}

export function MarketingNav({ onEnter }: Props) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-tinta/85 backdrop-blur-xl border-b border-tinta-border">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
        <Link to="/" aria-label="Playback Studio — Home">
          <BrandLogo size="md" tone="light" variant="horizontal" />
        </Link>
        <div className="hidden md:flex items-center gap-6 text-[13px] text-warm-200">
          <Link to="/como-funciona" className="hover:text-bone transition-colors">Como funciona</Link>
          <Link to="/precos" className="hover:text-bone transition-colors">Planos</Link>
          <Link to="/faq" className="hover:text-bone transition-colors">FAQ</Link>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEnter}
            className="hidden sm:block text-[13px] text-warm-400 hover:text-bone px-3 py-1.5 transition-colors cursor-pointer font-medium"
          >
            Entrar
          </button>
          <button
            onClick={onEnter}
            className="text-[13px] bg-laranja hover:bg-laranja-dark text-bone px-5 py-2 rounded-lg font-semibold transition-colors cursor-pointer"
          >
            Começa de graça
          </button>
        </div>
      </div>
    </nav>
  )
}
