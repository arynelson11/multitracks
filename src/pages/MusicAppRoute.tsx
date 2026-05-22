import { Component, type ReactNode, lazy, Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SettingsProvider } from '../contexts/SettingsContext'

const MusicApp = lazy(() => import('./MusicApp'))

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center text-white">
      <div className="flex flex-col items-center gap-4">
        <Loader2 size={40} className="text-orange-500 animate-spin" />
        <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">Carregando o estúdio</p>
      </div>
    </div>
  )
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[MusicAppRoute] crash', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white px-6 text-center">
          <h1 className="text-2xl font-bold text-orange-500 mb-3">Algo deu errado</h1>
          <p className="text-zinc-400 max-w-md mb-6">Não foi possível carregar o estúdio. Recarrega a página ou volta pra landing.</p>
          <pre className="text-[10px] text-zinc-600 max-w-lg overflow-auto bg-white/5 p-3 rounded mb-4">{this.state.error.message}</pre>
          <div className="flex gap-3">
            <button onClick={() => window.location.reload()} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded font-semibold">Recarregar</button>
            <a href="/" className="border border-white/20 text-white px-5 py-2 rounded font-semibold">Voltar pra home</a>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function MusicAppRoute() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  if (!hydrated) return <LoadingScreen />

  return (
    <AppErrorBoundary>
      <SettingsProvider>
        <Suspense fallback={<LoadingScreen />}>
          <MusicApp />
        </Suspense>
      </SettingsProvider>
    </AppErrorBoundary>
  )
}
