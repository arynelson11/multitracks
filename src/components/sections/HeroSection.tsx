import { Download } from 'lucide-react'
import { DemoMixer } from '../DemoMixer'
import { DomingoMark } from '../brand/DomingoMark'
import { usePWAInstall } from '../../hooks/usePWAInstall'

interface Props {
  onEnter: () => void
  /** Override H1 text per route. Default = landing default. */
  h1?: React.ReactNode
  /** Override subtitle per route. */
  subtitle?: React.ReactNode
  /** Show DAW preview below CTAs. Default true. */
  showDemo?: boolean
}

export function HeroSection({ onEnter, h1, subtitle, showDemo = true }: Props) {
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall()

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 pt-28 pb-20 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-laranja/[0.10] blur-[140px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-musgo/[0.10] blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(247,243,237,1) 1px,transparent 1px),linear-gradient(90deg,rgba(247,243,237,1) 1px,transparent 1px)', backgroundSize: '64px 64px' }} />
      </div>

      <div className="relative text-center max-w-4xl mx-auto">
        <div className="mb-6 inline-flex items-baseline gap-3 select-none">
          <span className="text-warm-400 text-[14px] font-medium tracking-wide">pronto pro</span>
          <DomingoMark size="md" tone="laranja" />
        </div>

        <h1 className="font-display font-semibold text-[clamp(2.4rem,7vw,5rem)] leading-[1.05] tracking-[-0.02em] text-bone mb-6">
          {h1 ?? (
            <>
              Multitracks pra qualquer música.
              <br />
              Pra sua banda chegar
              <br />
              pronta no <span className="italic text-laranja">domingo</span>.
            </>
          )}
        </h1>

        <p className="text-[clamp(.95rem,2vw,1.2rem)] text-warm-200 max-w-2xl mx-auto mb-10 leading-relaxed">
          {subtitle ?? (
            <>
              Sábado 23h alguém manda mudando o setlist. O Playback Studio separa qualquer
              música, do worship ao sertanejo, do rock ao MPB,
              em multitracks prontos.
            </>
          )}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={onEnter}
            className="inline-flex items-center justify-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
          >
            Começa de graça
          </button>
          <a
            href="#como-funciona"
            className="inline-flex items-center justify-center gap-2.5 bg-tinta-raised hover:bg-tinta-border border border-tinta-border text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all cursor-pointer"
          >
            Ver como funciona
          </a>
          {isInstallable && !isInstalled && (
            <button
              onClick={promptInstall}
              className="inline-flex items-center justify-center gap-2.5 bg-musgo/15 hover:bg-musgo/25 border border-musgo/30 text-musgo-light px-8 py-4 rounded-xl font-semibold text-[15px] transition-all cursor-pointer"
            >
              <Download size={17} /> Instalar app
            </button>
          )}
        </div>

        <p className="text-[12px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
      </div>

      {showDemo && (
        <div className="relative mt-16 w-full max-w-3xl mx-auto">
          <div className="rounded-2xl overflow-hidden border border-tinta-border shadow-2xl shadow-black/40">
            <DemoMixer />
          </div>
          <p className="text-center text-[11px] text-warm-400 mt-3 font-mono">o estúdio dentro do Playback Studio</p>
        </div>
      )}
    </section>
  )
}
