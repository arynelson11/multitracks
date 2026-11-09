import { useEffect, useState } from 'react'

// Instalar o Playback Studio na tela de início (celular/tablet).
//
// - Android/Chrome/Edge: o navegador dispara `beforeinstallprompt` e a gente
//   mostra o próprio botão "Instalar app".
// - iPhone/iPad: o Safari NÃO tem esse evento. A instalação é manual
//   (Compartilhar > Adicionar à Tela de Início), então mostramos o passo a passo.
// - App desktop (Electron) e app já instalado: nada a oferecer.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// O evento costuma chegar logo que a página carrega, antes da tela que mostra o
// botão montar. Guardamos no nível do módulo pra não perder.
let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(fn => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export type InstallPlatform = 'ios' | 'android' | 'desktop'

export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  // iPadOS no Safari se apresenta como Mac; a diferença é ter tela de toque.
  const isIPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(ua) || isIPadOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

export function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function usePWAInstall() {
  const [canPrompt, setCanPrompt] = useState(() => !!deferredPrompt)
  const [isInstalled, setIsInstalled] = useState(isRunningInstalled)

  useEffect(() => {
    const update = () => {
      setCanPrompt(!!deferredPrompt)
      setIsInstalled(isRunningInstalled())
    }
    listeners.add(update)
    const onInstalled = () => setIsInstalled(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      listeners.delete(update)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const isDesktopApp = typeof window !== 'undefined' && !!window.playbackDesktop?.isElectron
  const platform = detectInstallPlatform()

  /** Abre o diálogo nativo de instalação (só Android/Chrome/Edge). Retorna true se aceitou. */
  const promptInstall = async (): Promise<boolean> => {
    const ev = deferredPrompt
    if (!ev) return false
    await ev.prompt()
    const { outcome } = await ev.userChoice
    deferredPrompt = null
    notify()
    if (outcome === 'accepted') setIsInstalled(true)
    return outcome === 'accepted'
  }

  return {
    platform,
    isInstalled,
    isDesktopApp,
    /** O navegador oferece o diálogo nativo (o botão "Instalar app" funciona). */
    canPrompt,
    /** Faz sentido oferecer a instalação aqui (celular/tablet, fora do app instalado). */
    shouldOffer: !isDesktopApp && !isInstalled && platform !== 'desktop',
    promptInstall,
  }
}
