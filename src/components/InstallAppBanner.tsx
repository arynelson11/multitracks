import { useEffect, useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { InstallAppGuide } from './InstallAppGuide'

// Aviso discreto pra quem usa o Playback Studio pelo navegador do celular/tablet:
// dá pra instalar na tela de início. No iPhone/iPad é o único jeito de a pessoa
// descobrir (o Safari não oferece sozinho). Aparece depois de um tempo de uso e,
// em "Agora não", some por 30 dias. Nunca aparece no computador, no app desktop
// nem no app já instalado.

const SNOOZE_KEY = 'install_banner_snooze_until'
const SHOW_AFTER_MS = 15000
const SNOOZE_DAYS = 30

export function InstallAppBanner() {
  const { shouldOffer, platform, canPrompt, promptInstall } = usePWAInstall()
  const [visible, setVisible] = useState(false)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    if (!shouldOffer) return
    let until = 0
    try { until = Number(localStorage.getItem(SNOOZE_KEY) || 0) } catch { /* sem storage: mostra */ }
    if (Date.now() < until) return
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [shouldOffer])

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000)) } catch { /* ignora */ }
    setVisible(false)
    setShowSteps(false)
  }

  const install = async () => {
    if (platform === 'android' && canPrompt) {
      if (await promptInstall()) setVisible(false)
      return
    }
    setShowSteps(true)
  }

  // shouldOffer vira false quando instala: some na hora, sem esperar efeito.
  if (!visible || !shouldOffer) return null

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9990] w-[min(92vw,440px)] bg-[#1c1c1e] border border-orange-500/30 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] p-4 flex items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold leading-tight">Instale o app na tela de início</p>
          <p className="text-zinc-400 text-xs leading-snug">Abre em tela cheia, como app, direto do ícone.</p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={() => { void install() }} className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-bold cursor-pointer">
            Instalar
          </button>
          <button onClick={snooze} className="px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-[11px] cursor-pointer">
            Agora não
          </button>
        </div>
      </div>

      {showSteps && (
        <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setShowSteps(false)}>
          <div className="w-full max-w-md bg-[#1c1c1e] border border-white/10 rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-base">Instalar o Playback Studio</h2>
              <button onClick={() => setShowSteps(false)} className="text-zinc-400 hover:text-white p-1 cursor-pointer" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <InstallAppGuide onInstalled={() => { setShowSteps(false); setVisible(false) }} />
          </div>
        </div>
      )}
    </>
  )
}
