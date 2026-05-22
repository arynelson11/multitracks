import { ArrowRight } from 'lucide-react'
import { DomingoMark } from '../brand/DomingoMark'

interface Props {
  onEnter: () => void
  heading?: React.ReactNode
  subtitle?: React.ReactNode
}

export function CTASection({ onEnter, heading, subtitle }: Props) {
  return (
    <section className="py-24 px-5 sm:px-8">
      <div className="max-w-2xl mx-auto text-center">
        <div className="relative bg-tinta-raised border-2 border-laranja/40 rounded-3xl p-12 sm:p-16 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-36 bg-laranja/15 blur-3xl rounded-full pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-baseline gap-3 mb-6">
              <span className="text-warm-400 text-[14px] font-medium tracking-wide">pronto pro</span>
              <DomingoMark size="lg" tone="laranja" />
              <span className="text-warm-400 text-[14px] font-medium tracking-wide">?</span>
            </div>
            <h2 className="font-display font-semibold text-[clamp(1.8rem,5vw,2.8rem)] text-bone mb-4 leading-tight">
              {heading ?? (
                <>
                  Sua próxima semana,
                  <br />
                  já fica diferente.
                </>
              )}
            </h2>
            <p className="text-warm-200 text-[15px] leading-relaxed mb-8">
              {subtitle ?? 'Começa de graça. Sobe sua primeira música em menos de 2 minutos.'}
            </p>
            <button
              onClick={onEnter}
              className="inline-flex items-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-9 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
            >
              Começa de graça <ArrowRight size={18} />
            </button>
            <p className="text-[11px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
          </div>
        </div>
      </div>
    </section>
  )
}
