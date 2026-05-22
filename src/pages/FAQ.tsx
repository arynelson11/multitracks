import { useNavigate } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { MarketingNav } from '../components/sections/MarketingNav'
import { FAQSection } from '../components/sections/FAQSection'
import { CTASection } from '../components/sections/CTASection'
import { MarketingFooter } from '../components/sections/MarketingFooter'

export default function FAQ() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')

  return (
    <>
      <Head>
        <title>Perguntas frequentes · Playback Studio</title>
        <meta name="description" content="Tira-dúvidas sobre o Playback Studio: o que são multitracks, como funciona a separação de faixas, se serve pra qualquer música, se roda no celular, se pode usar ao vivo no palco." />
        <link rel="canonical" href="https://playbackstudio.com.br/faq" />
        <meta property="og:url" content="https://playbackstudio.com.br/faq" />
        <meta property="og:title" content="Perguntas frequentes · Playback Studio" />
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">perguntas frequentes</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Dúvidas sobre o <span className="italic text-laranja">Playback Studio</span>.
            </h1>
            <p className="text-warm-200 text-[16px] leading-relaxed max-w-2xl mx-auto">
              Não achou sua dúvida aqui? Manda email pra <a href="mailto:contato@playbackstudio.com.br" className="text-laranja hover:underline">contato@playbackstudio.com.br</a>. A gente responde sempre.
            </p>
          </div>
        </header>

        <FAQSection hideHeading />
        <CTASection onEnter={onEnter} />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}
