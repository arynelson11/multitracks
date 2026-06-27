import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './contexts/SettingsContext'
import { pbTraceFlushOnStartup } from './lib/pbTrace'

// Imprime o trace de diagnóstico da sessão anterior (se a aba morreu num crash).
pbTraceFlushOnStartup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)
