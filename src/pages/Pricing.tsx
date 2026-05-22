import { useNavigate } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { MarketingNav } from '../components/sections/MarketingNav'
import { PricingSection } from '../components/sections/PricingSection'
import { FAQSection } from '../components/sections/FAQSection'
import { CTASection } from '../components/sections/CTASection'
import { MarketingFooter } from '../components/sections/MarketingFooter'

export default function Pricing() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')

  const goToCheckout = (planId: string, price: number, billing: 'monthly' | 'annual') => {
    if (price > 0) {
      localStorage.setItem('checkoutIntent', `${planId}_${billing === 'annual' ? 'anual' : 'mensal'}`)
    } else {
      localStorage.removeItem('checkoutIntent')
    }
    onEnter()
  }

  return (
    <>
      <Head>
        <title>Planos e preços · Playback Studio (Livre, Pro, Studio)</title>
        <meta name="description" content="Playback Studio tem 3 planos: Livre (5 separações grátis), Pro (R$ 39,90/mês anual) e Studio (R$ 79,90/mês anual). Cancele quando quiser, sem fidelidade." />
        <link rel="canonical" href="https://playbackstudio.com.br/precos" />
        <meta property="og:url" content="https://playbackstudio.com.br/precos" />
        <meta property="og:title" content="Planos e preços · Playback Studio" />
        <meta property="og:description" content="Livre, Pro ou Studio. Multitracks de qualquer música, do gospel ao MPB. A partir de R$ 39,90/mês." />
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">planos do playback studio</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Planos pra sua banda chegar pronta no <span className="italic text-laranja">domingo</span>.
            </h1>
            <p className="text-warm-200 text-[16px] leading-relaxed max-w-2xl mx-auto">
              Começa de graça. Sobe pra Pro quando o domingo virar semana cheia.
              Sem fidelidade, sem pegadinha — paga em Reais, cancela quando quiser.
            </p>
          </div>
        </header>

        <PricingSection onCheckout={goToCheckout} hideHeading />

        <FAQSection />
        <CTASection onEnter={onEnter} />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}
