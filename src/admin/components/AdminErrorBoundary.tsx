// Rede de segurança do admin (Ruling ADM-T7-forma). Um erro de render numa aba mostra a frase
// pronta no lugar dela, com a casca (topo e abas) de pé. Sem isto o erro desmonta a árvore inteira
// do React e, com o admin aberto dentro do app, o app todo fica em branco. Quem usa troca a `key`
// ao trocar de aba, pra aba nova começar sem o erro da anterior.
import { Component, type ReactNode } from 'react'
import { Button } from '../../components/ui'

type AdminErrorBoundaryProps = {
  children: ReactNode
  // Dentro do app: "Voltar ao app". Na web em /admin (sem onClose): "Sair", como a casca.
  onClose?: () => void
  onSignOut: () => void
}

type AdminErrorBoundaryState = { failed: boolean }

export class AdminErrorBoundary extends Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = { failed: false }

  // O React já escreve o erro no console; aqui só troca a aba pela frase.
  static getDerivedStateFromError(): AdminErrorBoundaryState {
    return { failed: true }
  }

  // Monta a aba de novo, do zero (o estado dela se perdeu no erro, então ela pede os dados outra vez).
  private retry = () => this.setState({ failed: false })

  render() {
    if (!this.state.failed) return this.props.children
    const { onClose, onSignOut } = this.props
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-ps-base text-ps-alert break-words">Esta aba teve um problema. Tente de novo ou volte ao app.</p>
        <div className="flex flex-wrap gap-ps-gap">
          <Button onClick={this.retry}>Tentar de novo</Button>
          {onClose ? (
            <Button tone="ghost" onClick={onClose}>
              Voltar ao app
            </Button>
          ) : (
            <Button tone="ghost" onClick={onSignOut}>
              Sair
            </Button>
          )}
        </div>
      </div>
    )
  }
}
