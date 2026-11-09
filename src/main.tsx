import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './contexts/SettingsContext'
import { UpdateBanner } from './components/UpdateBanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
      {/* Aviso de versão nova em TODAS as telas (antes só existia na de Multitracks) */}
      <UpdateBanner />
    </SettingsProvider>
  </StrictMode>,
)
