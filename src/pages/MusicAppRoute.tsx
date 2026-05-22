import { lazy, Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SettingsProvider } from '../contexts/SettingsContext'

const MusicApp = lazy(() => import('./MusicApp'))

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center text-white">
      <div className="flex flex-col items-center gap-4">
        <Loader2 size={40} className="text-orange-500 animate-spin" />
        <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">Carregando</p>
      </div>
    </div>
  )
}

export default function MusicAppRoute() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  if (!hydrated) return <LoadingScreen />

  return (
    <SettingsProvider>
      <Suspense fallback={<LoadingScreen />}>
        <MusicApp />
      </Suspense>
    </SettingsProvider>
  )
}
