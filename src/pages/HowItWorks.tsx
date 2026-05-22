import { useNavigate } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { MarketingNav } from '../components/sections/MarketingNav'
import { GuideSection } from '../components/sections/GuideSection'
import { PlanSection } from '../components/sections/PlanSection'
import { SuccessSection } from '../components/sections/SuccessSection'
import { CTASection } from '../components/sections/CTASection'
import { MarketingFooter } from '../components/sections/MarketingFooter'

export default function HowItWorks() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')

  return (
    <>
      <Head>
        <title>Como funciona a separação de faixas · Playback Studio</title>
        <meta name="description" content="Sobe a música, o Playback Studio separa em voz, bateria, baixo, guitarra, piano e pads em alguns minutos. Sua banda chega pronta no domingo com os multitracks na mão. Veja como funciona em 3 passos." />
        <link rel="canonical" href="https://playbackstudio.com.br/como-funciona" />
        <meta property="og:url" content="https://playbackstudio.com.br/como-funciona" />
        <meta property="og:title" content="Como funciona · Playback Studio" />
        <meta property="og:description" content="3 passos: sobe a música, o Playback Studio separa, sua banda chega pronta no domingo." />
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">como funciona</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Sobe a música. A gente separa.
              <br />
              Sua banda <span className="italic text-laranja">chega pronta</span>.
            </h1>
            <p className="text-warm-200 text-[16px] leading-relaxed max-w-2xl mx-auto">
              Você não precisa esperar release oficial, nem pagar licença gringa, nem garimpar fórum.
              Qualquer música, do worship ao sertanejo, vira multitracks em alguns minutos.
            </p>
          </div>
        </header>

        <GuideSection />
        <PlanSection onEnter={onEnter} />
        <SuccessSection />
        <CTASection onEnter={onEnter} />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}
