import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './contexts/SettingsContext'
import { UpdateBanner } from './components/UpdateBanner'
import { setZoomLocked } from './lib/viewportZoom'

// O app nasce com o zoom travado, como sempre foi (o iPhone não dá zoom sozinho ao tocar
// num campo). Landing e /download liberam enquanto estão na tela (useFreeZoom).
setZoomLocked(true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
      {/* Aviso de versão nova em TODAS as telas (antes só existia na de Multitracks) */}
      <UpdateBanner />
    </SettingsProvider>
  </StrictMode>,
)
