// Entrada do admin pelo app (web e computador). Só aparece pra quem tem o papel de admin
// (profiles.is_admin, lido pelo useAuth); o servidor confere de novo em cada ação.
// Abre por estado interno do App (onOpen), nunca pelo endereço: no app de computador,
// que roda de file://, "/admin" não existe.
import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react'
import { ChevronRight, Loader2, Shield } from 'lucide-react'
import { Button } from './ui'

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

type AdminAppModule = { default: ComponentType<{ onClose?: () => void }> }

type InAppAdminProps = {
  // Importa o pedaço do admin. Tem que ser a mesma função a cada render (constante do módulo).
  load: () => Promise<AdminAppModule>
  onClose: () => void
}

const SCREEN = 'min-h-screen bg-ps-ink text-ps-bone font-ps-sans flex flex-col items-center justify-center gap-3 px-ps-gutter text-center'

// O admin dentro do app. Se o pedaço dele não carregar (publicação nova na web com o pedaço
// antigo apagado, file:// que falhou no computador) ou se ele quebrar fora das abas, mostra a
// frase com "Tentar de novo" e "Voltar ao app" no lugar da tela em branco: o admin nunca
// derruba o app do culto. O erro dentro de uma aba fica com a rede da própria aba (AdminErrorBoundary).
export function InAppAdmin({ load, onClose }: InAppAdminProps) {
  // O lazy guarda a promessa, inclusive a recusada: cada tentativa ganha um lazy novo, que
  // chama a importação outra vez. A chave nova também zera a proteção.
  const [view, setView] = useState(() => ({ attempt: 0, Admin: lazy(load) }))
  const retry = () => setView((v) => ({ attempt: v.attempt + 1, Admin: lazy(load) }))
  const { Admin } = view

  return (
    <LoadGuard key={view.attempt} onRetry={retry} onClose={onClose}>
      <Suspense fallback={
        <div className={SCREEN} role="status">
          <Loader2 size={32} aria-hidden="true" className="text-ps-mut animate-spin motion-reduce:animate-none" />
          <p className="text-ps-base text-ps-mut">Carregando...</p>
        </div>
      }>
        <Admin onClose={onClose} />
      </Suspense>
    </LoadGuard>
  )
}

type LoadGuardProps = { children: ReactNode; onRetry: () => void; onClose: () => void }

class LoadGuard extends Component<LoadGuardProps, { failed: boolean }> {
  state = { failed: false }

  // O React já escreve o erro no console; aqui só troca a tela em branco pela frase.
  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const { onRetry, onClose } = this.props
    return (
      <div className={SCREEN} role="alert">
        <p className="text-ps-base text-ps-alert break-words">Não deu pra abrir o admin. Tente de novo.</p>
        <div className="flex flex-wrap justify-center gap-ps-gap">
          <Button onClick={onRetry}>Tentar de novo</Button>
          <Button tone="ghost" onClick={onClose}>
            Voltar ao app
          </Button>
        </div>
      </div>
    )
  }
}
