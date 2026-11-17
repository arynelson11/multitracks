// Entrada do admin pelo app (web e computador). Só aparece pra quem tem o papel de admin
// (profiles.is_admin, lido pelo useAuth); o servidor confere de novo em cada ação.
// Abre por estado interno do App (onOpen), nunca pelo endereço: no app de computador,
// que roda de file://, "/admin" não existe.
import { ChevronRight, Shield } from 'lucide-react'

type AdminEntryButtonProps = {
  isAdmin: boolean
  variant: 'toolbar' | 'drawer'
  onOpen: () => void
}

export function AdminEntryButton({ isAdmin, variant, onOpen }: AdminEntryButtonProps) {
  if (!isAdmin) return null

  if (variant === 'toolbar') {
    return (
      // O texto ADMIN só aparece em tela larga: o nome acessível vem do aria-label.
      <button type="button" onClick={onOpen} title="Admin" aria-label="Admin"
        className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 transition-all">
        <Shield size={14} /><span className="hidden min-[1680px]:inline">ADMIN</span>
      </button>
    )
  }

  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
      <span className="text-white text-sm font-bold flex items-center gap-3">
        <Shield size={16} className="text-primary" />
        Admin
      </span>
      <ChevronRight size={14} className="text-text-muted" />
    </button>
  )
}
