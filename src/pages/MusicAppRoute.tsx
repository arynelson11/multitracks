import { lazy, Suspense } from 'react'
import { ClientOnly } from 'vite-react-ssg'
import { Loader2 } from 'lucide-react'
import { SettingsProvider } from '../contexts/SettingsContext'

const MusicApp = lazy(() => import('./MusicApp'))

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 size={40} className="text-orange-500 animate-spin" />
    </div>
  )
}

export default function MusicAppRoute() {
  return (
    <ClientOnly>
      {() => (
        <SettingsProvider>
          <Suspense fallback={<LoadingScreen />}>
            <MusicApp />
          </Suspense>
        </SettingsProvider>
      )}
    </ClientOnly>
  )
}
