import { useState } from 'react'
import {
  Mic2, Drumstick, Guitar, Piano,
  Star, ChevronDown, Check,
  ArrowRight, Church, Download, Calendar,
} from 'lucide-react'
import { DemoMixer } from './DemoMixer'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { BrandLogo } from './BrandLogo'
import { DomingoMark } from './brand/DomingoMark'
import { LevadaWordmark } from './brand/LevadaWordmark'

interface LandingPageProps {
  onEnter: () => void
}

/* ─── Dados ─────────────────────────────── */

/**
 * Audience focado em worship (Lei do Sacrifício — Al Ries).
 * Cortamos: produtores, músicos seculares, bateristas/guitarristas genéricos.
 * Mantemos: papéis dentro da equipe de worship.
 */
const AUDIENCE = [
  { icon: Church,    title: 'Equipes de adoração',  desc: 'Do ensaio ao culto, qualquer música pronta com a levada na mão.' },
  { icon: Mic2,      title: 'Ministros e vocalistas', desc: 'Voice guide discreto, tonalidade no seu alcance, referência sem inundar o in-ear.' },
  { icon: Guitar,    title: 'Instrumentistas',      desc: 'Stems de qualquer música — guitarra, baixo, bateria, teclado — pra ensaiar como sua equipe toca.' },
  { icon: Drumstick, title: 'Bateristas',           desc: 'Click track com levada brasileira, não o metrônomo gringo plano.' },
  { icon: Piano,     title: 'Tecladistas',          desc: 'Isole pads e teclados. Construa em cima do que a equipe precisa pro domingo.' },
  { icon: Calendar,  title: 'Líderes de louvor',    desc: 'Setlist na sexta, separação no sábado, domingo sem corre.' },
]

const PLANS = [
  {
    id: 'gratuito',
    name: 'Levada Livre',
    monthly: 0, annual: 0,
    desc: 'Pra você experimentar e ver se funciona',
    badge: null as string | null,
    highlight: false,
    features: [
      '5 separações por mês',
      'Stems padrão',
      'Acesso à biblioteca de clicks BR',
      'Mixer básico multicanal',
    ],
    cta: 'Começar grátis',
  },
  {
    id: 'essencial',
    name: 'Levada Toca',
    monthly: 49.90, annual: 39.90,
    desc: 'Pra equipe que toca todo domingo',
    badge: 'Mais escolhido',
    highlight: true,
    features: [
      '50 separações por mês',
      'Stems de qualidade estendida',
      'Pads ambiente completos',
      'Voice guide auto-detector',
      'Click com levada brasileira',
      'Auto-detecção de seções de culto',
      'Biblioteca em nuvem',
      'Suporte por email',
    ],
    cta: 'Assinar Toca',
  },
  {
    id: 'pro',
    name: 'Levada Tudo',
    monthly: 99.90, annual: 79.90,
    desc: 'Pra quem leva isso à sério',
    badge: null as string | null,
    highlight: false,
    features: [
      'Separações ilimitadas',
      'Qualidade máxima',
      'Tudo da Levada Toca +',
      'Prioridade no processamento',
      'Múltiplos repertórios simultâneos',
      'Acesso antecipado a features',
      'Suporte prioritário',
    ],
    cta: 'Assinar Tudo',
  },
]

const FAQS = [
  {
    q: 'O que são stems?',
    a: 'Stems são as faixas individuais de uma música — voz separada, bateria separada, baixo separado, etc. Com a Levada você sobe qualquer música e recebe tudo separado pra sua equipe ensaiar e tocar como precisa.'
  },
  {
    q: 'Como funciona a separação?',
    a: 'Você sobe a música (MP3, WAV ou link). A IA da Levada separa em voz, guitarra, baixo, bateria, piano e pads em alguns minutos. Os stems ficam disponíveis pra download, no mixer e pra compartilhar com sua equipe.'
  },
  {
    q: 'A Levada serve pra qualquer música?',
    a: 'Sim. Diferente de catálogos licenciados, a Levada não depende de uma biblioteca pré-aprovada. Qualquer música que sua igreja queira cantar — antiga, recente, brasileira, traduzida, original da banda — funciona.'
  },
  {
    q: 'Funciona no celular?',
    a: 'Sim. É um Progressive Web App otimizado pra mobile. Funciona no navegador do iPhone e Android, sem instalar nada. A interface se adapta à tela do celular.'
  },
  {
    q: 'Posso usar ao vivo no palco?',
    a: 'Pode. Foi construído pra isso. Após carregar as músicas, o player e mixer funcionam offline com baixa latência e controle total dos canais em tempo real.'
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, sem fidelidade. Cancele direto pelo painel a qualquer momento. O acesso continua até o fim do período pago.'
  },
]

const TESTIMONIALS = [
  {
    name: 'Lucas Ferreira',
    role: 'Líder de louvor',
    text: 'Domingo flui agora. A equipe chega afinada porque ensaiou com stems de verdade, não com áudio original cheio de voz.',
  },
  {
    name: 'Ana Paula Costa',
    role: 'Vocalista',
    text: 'A levada do click brasileiro fez diferença real no ensaio. Antes a equipe tava sempre se ajustando ao metrônomo gringo. Agora é natural.',
  },
  {
    name: 'Rodrigo Melo',
    role: 'Tecladista',
    text: 'Sábado o pastor muda uma música? Em alguns minutos tá separada. Domingo a gente não precisa improvisar.',
  },
]

/* ─── Componente ────────────────────────── */

export function LandingPage({ onEnter }: LandingPageProps) {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall()

  const goToCheckout = (planId: string, price: number) => {
    if (price > 0) {
      localStorage.setItem('checkoutIntent', `${planId}_${billing === 'annual' ? 'anual' : 'mensal'}`)
    } else {
      localStorage.removeItem('checkoutIntent')
    }
    onEnter()
  }

  const goToApp = () => {
    localStorage.removeItem('checkoutIntent')
    onEnter()
  }

  return (
    <div className="brand-context min-h-screen overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-xl border-b border-warm-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <BrandLogo size="md" tone="dark" />
          <div className="flex items-center gap-2">
            <button
              onClick={goToApp}
              className="hidden sm:block text-[13px] text-warm-600 hover:text-tinta px-3 py-1.5 transition-colors cursor-pointer font-medium"
            >
              Entrar
            </button>
            <button
              onClick={goToApp}
              className="text-[13px] bg-terracota hover:bg-terracota-dark text-bone px-5 py-2 rounded-lg font-semibold transition-colors cursor-pointer"
            >
              Começa de graça
            </button>
          </div>
        </div>
      </nav>

      {/* ════════ HERO ════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 pt-28 pb-20 overflow-hidden">
        {/* Atmosphere (subtle, warm) */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-terracota/[0.06] blur-[140px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-musgo/[0.06] blur-[120px]" />
        </div>

        <div className="relative text-center max-w-4xl mx-auto">
          {/* Visual Hammer floating above headline */}
          <div className="mb-6 inline-flex items-baseline gap-3 select-none">
            <span className="text-warm-400 text-[14px] font-medium tracking-wide">pronto pro</span>
            <DomingoMark size="md" tone="terracota" />
          </div>

          <h1 className="font-display font-semibold text-[clamp(2.4rem,7vw,5rem)] leading-[1.05] tracking-[-0.02em] text-tinta mb-6">
            Stems pra qualquer música.
            <br />
            Pra sua equipe chegar
            <br />
            pronta no <span className="italic text-terracota">domingo</span>.
          </h1>

          <p className="text-[clamp(.95rem,2vw,1.2rem)] text-warm-600 max-w-2xl mx-auto mb-10 leading-relaxed">
            A gente sabe: domingo chega e três músicas do setlist não tão em catálogo nenhum.
            A Levada resolve isso. Feita por quem toca, pra quem toca.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={goToApp}
              className="inline-flex items-center justify-center gap-2.5 bg-terracota hover:bg-terracota-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-terracota/20"
            >
              Começa de graça
            </button>
            <a
              href="#como-funciona"
              className="inline-flex items-center justify-center gap-2.5 bg-bone hover:bg-warm-100 border border-warm-200 text-tinta px-8 py-4 rounded-xl font-semibold text-[15px] transition-all cursor-pointer"
            >
              Ver como funciona
            </a>
            {isInstallable && !isInstalled && (
              <button
                onClick={promptInstall}
                className="inline-flex items-center justify-center gap-2.5 bg-musgo-wash hover:bg-musgo-light/30 border border-musgo/30 text-musgo-dark px-8 py-4 rounded-xl font-semibold text-[15px] transition-all cursor-pointer"
              >
                <Download size={17} /> Instalar app
              </button>
            )}
          </div>

          <p className="text-[12px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
        </div>

        {/* Product preview — DAW aesthetic embedded inside warm brand context */}
        <div className="relative mt-16 w-full max-w-3xl mx-auto">
          <div className="rounded-2xl overflow-hidden border border-warm-200 shadow-2xl shadow-tinta/5">
            <DemoMixer />
          </div>
          <p className="text-center text-[11px] text-warm-400 mt-3 font-mono">o estúdio dentro da Levada</p>
        </div>
      </section>

      {/* ════════ STAKES — problema + empatia ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-musgo-wash/40">
        <div className="max-w-3xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o sábado que a gente conhece</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-8 text-center">
            Domingo não tem que ser correria.
          </h2>
          <div className="bg-bone border border-warm-200 rounded-2xl p-7 sm:p-9 mb-8 leading-relaxed text-[15px] text-warm-600">
            <p className="mb-4">
              Sábado 23h o pastor manda mudando o setlist. Você passa a madrugada procurando multitracks
              em fórum. Domingo de manhã o som tá descosturado porque a equipe não teve tempo de ensaiar como precisa.
              Segunda você acorda exausto. Tudo de novo na próxima semana.
            </p>
            <p className="text-tinta font-medium">
              A gente sabe — porque a gente também tocava assim.
            </p>
          </div>
        </div>
      </section>

      {/* ════════ GUIDE — 3 benefícios ════════ */}
      <section id="como-funciona" className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o que a Levada entrega</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-16 text-center">
            Construída por músicos de worship.
            <br />
            Pra músicos de worship.
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { title: 'Qualquer música, separada', desc: 'Sobe MP3, WAV ou link. A Levada separa em voz, instrumentos e pads em alguns minutos.' },
              { title: 'Worship brasileiro, de verdade', desc: 'Estrutura de culto BR reconhecida. Click com levada nacional. Em português.' },
              { title: 'Sem catálogo travando', desc: 'Sua igreja escolhe a música. Você prepara. Sem esperar release, sem licença gringa.' },
            ].map((item, i) => (
              <div key={i} className="bg-bone border border-warm-200 rounded-2xl p-7 hover:border-terracota/40 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-terracota/10 border border-terracota/20 flex items-center justify-center mb-5">
                  <span className="text-terracota font-display font-semibold text-[15px]">{i + 1}</span>
                </div>
                <h3 className="font-display font-semibold text-[20px] text-tinta mb-3 leading-tight">{item.title}</h3>
                <p className="text-[14px] text-warm-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PLAN — 3 passos ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-terracota-wash/30">
        <div className="max-w-4xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o domingo em 3 passos</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-16 text-center">
            Como você chega pronto.
          </h2>

          <div className="space-y-5">
            {[
              { n: '1', title: 'Sobe a música', desc: 'Qualquer formato — MP3, WAV, ou link do YouTube.' },
              { n: '2', title: 'A Levada separa tudo', desc: 'Voz, guitarra, baixo, bateria, piano, pads — em alguns minutos.' },
              { n: '3', title: 'Sua equipe chega pronta no domingo', desc: 'Stems, click, voice guide, seções marcadas (intro, verso, refrão, ponte, altar call) — na mão.' },
            ].map(step => (
              <div key={step.n} className="bg-bone border border-warm-200 rounded-2xl p-6 sm:p-8 flex items-start gap-6">
                <div className="w-14 h-14 rounded-full bg-terracota text-bone flex items-center justify-center font-display font-semibold text-[24px] shrink-0">
                  {step.n}
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="font-display font-semibold text-[22px] text-tinta mb-2 leading-tight">{step.title}</h3>
                  <p className="text-[15px] text-warm-600 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <button
              onClick={goToApp}
              className="inline-flex items-center justify-center gap-2.5 bg-terracota hover:bg-terracota-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-terracota/20"
            >
              Sobe sua primeira música <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {/* ════════ AUDIENCE — pra quem é ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">feito pra</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-16 text-center">
            Quem toca todo domingo.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AUDIENCE.map((a, i) => (
              <div key={i} className="group bg-bone border border-warm-200 hover:border-musgo/40 rounded-2xl p-6 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-musgo/10 group-hover:bg-musgo/20 flex items-center justify-center mb-4 transition-colors">
                  <a.icon size={20} className="text-musgo" />
                </div>
                <h4 className="font-display font-semibold text-[16px] text-tinta mb-2">{a.title}</h4>
                <p className="text-[13px] text-warm-600 leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ SUCCESS — transformação ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-musgo-wash/40">
        <div className="max-w-3xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">seu próximo domingo, diferente</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-12 text-center">
            Sexta separa. Sábado ensaia.
            <br />
            <span className="italic text-musgo-dark">Domingo flui.</span>
          </h2>
          <div className="bg-bone border border-warm-200 rounded-2xl p-7 sm:p-9 space-y-4 text-[15px] leading-relaxed">
            {[
              { day: 'Sexta', text: 'Pastor manda setlist. Você sobe na Levada.' },
              { day: 'Sábado', text: 'Tudo separado. Equipe baixou. Ensaio fluiu.' },
              { day: 'Domingo', text: 'Equipe travada mas leve. Ministração fluindo.' },
              { day: 'Segunda', text: '"Vamo pra próxima."' },
            ].map((row, i) => (
              <div key={i} className="flex items-baseline gap-5 pb-4 last:pb-0 border-b border-warm-100 last:border-0">
                <span className="font-display font-semibold text-tinta text-[18px] w-24 shrink-0">{row.day}</span>
                <span className="text-warm-600">{row.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ TESTIMONIALS ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">equipes que já chegam prontas</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-16 text-center">
            Histórias de domingo.
          </h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((r, i) => (
              <div key={i} className="bg-bone border border-warm-200 rounded-2xl p-7">
                <div className="flex gap-0.5 mb-4">
                  {[1, 2, 3, 4, 5].map(j => <Star key={j} size={12} className="text-terracota fill-terracota" />)}
                </div>
                <p className="text-[14px] text-warm-600 leading-relaxed mb-5">"{r.text}"</p>
                <div>
                  <div className="font-display font-semibold text-[15px] text-tinta">{r.name}</div>
                  <div className="text-[12px] text-warm-400">{r.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PRICING ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-terracota-wash/30" id="precos">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-600 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">planos</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-tinta mb-3 text-center">
            Planos pra sua equipe chegar pronta no domingo.
          </h2>
          <p className="text-warm-600 text-[15px] mb-10 text-center">
            Sem fidelidade, sem pegadinha. Começa de graça e cresce quando precisar.
          </p>

          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center gap-1 bg-bone border border-warm-200 rounded-xl p-1">
              <button
                onClick={() => setBilling('monthly')}
                className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${billing === 'monthly' ? 'bg-tinta text-bone' : 'text-warm-600 hover:text-tinta'}`}
              >
                Mensal
              </button>
              <button
                onClick={() => setBilling('annual')}
                className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer flex items-center gap-2 ${billing === 'annual' ? 'bg-tinta text-bone' : 'text-warm-600 hover:text-tinta'}`}
              >
                Anual
                <span className="text-[10px] font-bold text-musgo-dark bg-musgo-wash px-1.5 py-0.5 rounded">−25%</span>
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
                      ? 'border-terracota bg-bone'
                      : 'border-warm-200 bg-bone'
                    }`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-terracota text-bone text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-widest whitespace-nowrap">
                      {plan.badge}
                    </div>
                  )}
                  <div className="mb-5">
                    <h3 className="font-display font-semibold text-[22px] text-tinta mb-1">{plan.name}</h3>
                    <p className="text-warm-600 text-[13px]">{plan.desc}</p>
                  </div>
                  <div className="mb-7">
                    {price === 0 ? (
                      <div className="font-display font-semibold text-[40px] text-tinta">Grátis</div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[14px] text-warm-600">R$</span>
                          <span className="font-display font-semibold text-[40px] text-tinta leading-none">{price.toFixed(2).replace('.', ',')}</span>
                          <span className="text-warm-600 text-[14px]">/mês</span>
                        </div>
                        {billing === 'annual' && (
                          <p className="text-[11px] text-musgo-dark mt-2">R$ {(price * 12).toFixed(2).replace('.', ',')} cobrado anualmente</p>
                        )}
                        {billing === 'monthly' && (
                          <p className="text-[11px] text-warm-400 mt-2">ou R$ {plan.annual.toFixed(2).replace('.', ',')}/mês no anual</p>
                        )}
                      </>
                    )}
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((feat, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-[13px] text-warm-600">
                        <Check size={13} className={`mt-0.5 shrink-0 ${plan.highlight ? 'text-terracota' : 'text-musgo'}`} />
                        {feat}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => goToCheckout(plan.id, price)}
                    className={`w-full py-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer ${plan.highlight
                        ? 'bg-terracota hover:bg-terracota-dark text-bone shadow-lg shadow-terracota/20'
                        : 'bg-bone hover:bg-warm-100 border border-warm-200 text-tinta'
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

      {/* ════════ FAQ ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display font-semibold text-[clamp(1.6rem,4vw,2.4rem)] text-tinta text-center mb-12">
            Perguntas frequentes
          </h2>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-warm-200 rounded-xl overflow-hidden bg-bone">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-warm-100 transition-colors"
                >
                  <span className="font-semibold text-[14px] text-tinta pr-4">{faq.q}</span>
                  <ChevronDown size={15} className={`text-warm-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 pt-4 text-[13px] text-warm-600 leading-relaxed border-t border-warm-100">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ CTA FINAL ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <div className="relative bg-terracota-wash border-2 border-terracota/30 rounded-3xl p-12 sm:p-16 overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-36 bg-terracota/10 blur-3xl rounded-full pointer-events-none" />
            <div className="relative">
              <div className="inline-flex items-baseline gap-3 mb-6">
                <span className="text-warm-600 text-[14px] font-medium tracking-wide">pronto pro</span>
                <DomingoMark size="lg" tone="terracota" />
                <span className="text-warm-600 text-[14px] font-medium tracking-wide">?</span>
              </div>
              <h2 className="font-display font-semibold text-[clamp(1.8rem,5vw,2.8rem)] text-tinta mb-4 leading-tight">
                Sua próxima semana,
                <br />
                já fica diferente.
              </h2>
              <p className="text-warm-600 text-[15px] leading-relaxed mb-8">
                Começa de graça. Sobe sua primeira música em menos de 2 minutos.
              </p>
              <button
                onClick={goToApp}
                className="inline-flex items-center gap-2.5 bg-terracota hover:bg-terracota-dark text-bone px-9 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-terracota/20"
              >
                Começa de graça <ArrowRight size={18} />
              </button>
              <p className="text-[11px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer className="border-t border-warm-200 py-10 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <LevadaWordmark size="sm" tone="dark" />
            <span className="text-warm-400 text-[11px]">a plataforma do domingo</span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-warm-600">
            <button onClick={goToApp} className="hover:text-tinta transition-colors cursor-pointer">Entrar</button>
            <button onClick={goToApp} className="hover:text-tinta transition-colors cursor-pointer">Criar conta</button>
            <a href="#precos" className="hover:text-tinta transition-colors">Planos</a>
          </div>
          <p className="text-[11px] text-warm-400">© {new Date().getFullYear()} Levada · Feito por quem toca.</p>
        </div>
      </footer>
    </div>
  )
}
