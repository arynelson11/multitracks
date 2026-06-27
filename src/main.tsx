import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './contexts/SettingsContext'
import { pbTraceShowOnStartup } from './lib/pbTrace'

// Mostra na tela (e no console) o trace da sessão anterior, se a aba morreu num
// crash. A última linha indica onde travou.
pbTraceShowOnStartup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)
