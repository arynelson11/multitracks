import { useState } from 'react'
import { Check } from 'lucide-react'
import { PLANS } from './data'

interface Props {
  onCheckout: (planId: string, price: number, billing: 'monthly' | 'annual') => void
  /** If true, hides the section heading (useful when used inside a Pricing page with its own H1). */
  hideHeading?: boolean
}

export function PricingSection({ onCheckout, hideHeading = false }: Props) {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')

  return (
    <section className="py-24 px-5 sm:px-8 bg-tinta-soft" id="precos">
      <div className="max-w-5xl mx-auto">
        {!hideHeading && (
          <>
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">planos</p>
            <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-3 text-center">
              Planos pra sua banda chegar pronta no domingo.
            </h2>
            <p className="text-warm-200 text-[15px] mb-10 text-center">
              Sem fidelidade, sem pegadinha. Começa de graça e cresce quando precisar.
            </p>
          </>
        )}

        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-1 bg-tinta-raised border border-tinta-border rounded-xl p-1">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${billing === 'monthly' ? 'bg-bone text-tinta' : 'text-warm-200 hover:text-bone'}`}
            >
              Mensal
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer flex items-center gap-2 ${billing === 'annual' ? 'bg-bone text-tinta' : 'text-warm-200 hover:text-bone'}`}
            >
              Anual
              <span className="text-[10px] font-bold text-musgo-light bg-musgo/20 px-1.5 py-0.5 rounded">−25%</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-5">
          {PLANS.map((plan) => {
            const price = billing === 'annual' ? plan.annual : plan.monthly
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl p-7 flex flex-col border-2 ${plan.highlight
                    ? 'border-laranja bg-tinta-raised'
                    : 'border-tinta-border bg-tinta-raised'
                  }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-laranja text-bone text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-widest whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-display font-semibold text-[22px] text-bone mb-1">{plan.name}</h3>
                  <p className="text-warm-400 text-[13px]">{plan.desc}</p>
                </div>
                <div className="mb-7">
                  {price === 0 ? (
                    <div className="font-display font-semibold text-[40px] text-bone">Grátis</div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[14px] text-warm-400">R$</span>
                        <span className="font-display font-semibold text-[40px] text-bone leading-none">{price.toFixed(2).replace('.', ',')}</span>
                        <span className="text-warm-400 text-[14px]">/mês</span>
                      </div>
                      {billing === 'annual' && (
                        <p className="text-[11px] text-musgo-light mt-2">R$ {(price * 12).toFixed(2).replace('.', ',')} cobrado anualmente</p>
                      )}
                      {billing === 'monthly' && (
                        <p className="text-[11px] text-warm-400 mt-2">ou R$ {plan.annual.toFixed(2).replace('.', ',')}/mês no anual</p>
                      )}
                    </>
                  )}
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((feat, j) => (
                    <li key={j} className="flex items-start gap-2.5 text-[13px] text-warm-200">
                      <Check size={13} className={`mt-0.5 shrink-0 ${plan.highlight ? 'text-laranja' : 'text-musgo-light'}`} />
                      {feat}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => onCheckout(plan.id, price, billing)}
                  className={`w-full py-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer ${plan.highlight
                      ? 'bg-laranja hover:bg-laranja-dark text-bone shadow-lg shadow-laranja/25'
                      : 'bg-tinta hover:bg-tinta-border border border-tinta-border text-bone'
                    }`}
                >
                  {plan.cta}
                </button>
              </div>
            )
          })}
        </div>
        <p className="text-center text-[12px] text-warm-400 mt-8">Preços em Reais · Cancele quando quiser · Sem fidelidade</p>
      </div>
    </section>
  )
}
