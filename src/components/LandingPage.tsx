import { useState } from 'react'
import {
  Mic2, Drumstick, Guitar, Music, Disc3,
  Star, ChevronDown, Check,
  ArrowRight, Church, Download,
  Gauge, Archive, ScrollText, Sparkles, FileAudio, WifiOff, QrCode,
} from 'lucide-react'
import { DemoMixer } from './DemoMixer'
import { BrandLogo } from './BrandLogo'
import { DomingoMark } from './brand/DomingoMark'
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'

// Suporte / contato via WhatsApp
const WHATSAPP_URL =
  'https://wa.me/5522997249896?text=' +
  encodeURIComponent('Olá! Vim pelo site do Playback Studio e preciso de ajuda.')

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a11.94 11.94 0 005.71 1.454h.006c6.585 0 11.946-5.359 11.949-11.893a11.821 11.821 0 00-3.487-8.46"/>
    </svg>
  )
}

interface LandingPageProps {
  onEnter: () => void
}

/* ─── Dados ─────────────────────────────── */

/**
 * Audience multi-perfil: worship em destaque + outros contextos.
 * 'Feito por quem toca' é a âncora — qualquer banda/músico que toca todo
 * fim de semana se reconhece aqui.
 */
const AUDIENCE = [
  { icon: Church,    title: 'Equipes de adoração',  desc: 'Do ensaio ao culto, qualquer música pronta com a levada na mão.' },
  { icon: Music,     title: 'Bandas em geral',      desc: 'Gospel, sertanejo, MPB, rock, indie. Qualquer ritmo, faixas separadas pro próximo show.' },
  { icon: Mic2,      title: 'Vocalistas e ministros', desc: 'Voice guide discreto, tonalidade no seu alcance, referência sem inundar o in-ear.' },
  { icon: Guitar,    title: 'Instrumentistas',      desc: 'Faixas separadas de qualquer música. Guitarra, baixo, teclado, piano pra ensaiar como sua banda toca.' },
  { icon: Drumstick, title: 'Bateristas',           desc: 'Click track no seu jeito, separação que respeita a levada original.' },
  { icon: Disc3,     title: 'Solo e produtores',    desc: 'Construa em cima de qualquer faixa. Separe, remixe, refaça arranjos.' },
]

/**
 * Recursos que já existem no produto mas costumam passar batido na primeira
 * visita. Tudo aqui é entregue de verdade hoje, sem promessa de roadmap.
 */
const FEATURES = [
  { icon: Gauge,      title: 'BPM detectado pela IA',      desc: 'Ao separar, a IA já estima o andamento da música. O click entra na velocidade certa, sem você contar nada.' },
  { icon: ScrollText, title: 'Teleprompter de letras',     desc: 'Suba a letra da música e a equipe acompanha na tela, sincronizada com as seções, no palco ou pelo celular.' },
  { icon: Sparkles,   title: 'Voz guia automática',        desc: 'O Playback Studio marca sozinho os pontos de entrada e monta a voz guia pra orientar quem canta.' },
  { icon: Archive,    title: 'Repertório com backup .zip', desc: 'Monte seus repertórios e salve tudo num arquivo .zip. Carregue de volta em qualquer aparelho, quando quiser.' },
  { icon: FileAudio,  title: 'Download em WAV ou MP3',     desc: 'Baixe cada faixa separada no formato que precisar. WAV pra produzir, MP3 pra mandar rápido pra equipe.' },
  { icon: QrCode,     title: 'Banda conecta por QR Code',  desc: 'No Modo Ao Vivo, cada músico aponta o celular pro QR Code e entra na sessão. Música, tom e letra em tempo real.' },
  { icon: WifiOff,    title: 'App desktop que toca offline', desc: 'Baixe o app pro Mac ou Windows. Depois de carregar as músicas, tudo funciona no palco mesmo sem internet.' },
]

const PLANS = [
  {
    id: 'gratuito',
    name: 'Livre',
    monthly: 0, annual: 0,
    desc: 'Pra experimentar e ver se funciona',
    badge: null as string | null,
    highlight: false,
    features: [
      '5 separações de faixas por mês',
      'Separação em 2 faixas (vocal e instrumental)',
      'Ouça cada faixa isolada no mixer',
      'Biblioteca de separações local, salva no navegador',
    ],
    cta: 'Começar grátis',
  },
  {
    id: 'essencial',
    name: 'Pro',
    monthly: 49.90, annual: 37.90,
    desc: 'Pra equipe que toca toda semana',
    badge: 'Mais escolhido',
    highlight: true,
    features: [
      '50 separações de faixas por mês',
      'Separação em 2, 4 e 6 faixas',
      'Download das faixas em WAV e MP3',
      'BPM pela IA e click com levada brasileira',
      'Voz guia pra orientar a equipe',
      'Pads de ambiente',
      'Marque seções e repita em loop infinito ao vivo',
      'Transposição de tom',
      'Modo Ao Vivo: banda conecta por QR Code, até 4 aparelhos',
      'Teleprompter de letras',
      'Biblioteca cloud e repertório com backup .zip',
      'Suporte por email',
    ],
    cta: 'Assinar Pro',
  },
  {
    id: 'pro',
    name: 'Studio',
    monthly: 119.90, annual: 89.90,
    desc: 'Pra quem leva o ao vivo a sério',
    badge: null as string | null,
    highlight: false,
    features: [
      '150 separações de faixas por mês',
      'Qualidade máxima de separação',
      'Tudo do Pro',
      'Modo Ao Vivo sem limite de aparelhos',
      'A banda controla loop e seções pelo celular',
      'Prioridade no processamento',
      'Suporte prioritário',
    ],
    cta: 'Assinar Studio',
  },
]

const FAQS = [
  {
    q: 'O que é separação de faixas?',
    a: 'São as faixas individuais de uma música (também chamadas de stems): voz separada, bateria separada, baixo separado, e por aí vai. Com o Playback Studio você sobe qualquer música e recebe tudo separado pra sua banda ensaiar e tocar como precisa.'
  },
  {
    q: 'Dá pra repetir uma parte da música ao vivo?',
    a: 'Dá. Você marca as seções (intro, verso, refrão, ponte) e, no momento do louvor, repete um trecho quantas vezes quiser ou deixa em loop até decidir seguir. A volta acontece no fim da parte, sem cortar a música no meio.'
  },
  {
    q: 'A banda consegue acompanhar pelo celular?',
    a: 'Sim, no Modo Ao Vivo. Cada músico conecta o celular e acompanha a música, o tom e a letra em tempo real. Nos planos pagos a banda também ajuda a controlar a execução, e no Studio controla as repetições e seções direto do celular.'
  },
  {
    q: 'Como funciona a separação?',
    a: 'Você sobe a música (MP3, WAV ou AAC). A IA do Playback Studio separa em voz, bateria, baixo, guitarra, piano e os outros instrumentos em alguns minutos. Os stems ficam disponíveis pra download, no mixer e pra compartilhar com a equipe.'
  },
  {
    q: 'Qual a diferença pra um catálogo de multitracks?',
    a: 'Catálogo te dá só as músicas que já foram licenciadas, e você espera o release sair. O Playback Studio é uma ferramenta: você sobe qualquer música e ela vira multitracks na hora. Worship, gospel, sertanejo, MPB, rock, indie, até a original da sua banda. Você cria o que precisa, não espera o que existe.'
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
    role: 'Ministro de louvor',
    text: 'Domingo flui agora. A equipe chega afinada porque ensaiou com stems de verdade, não com áudio original cheio de voz.',
  },
  {
    name: 'Ana Paula Costa',
    role: 'Vocalista, banda gospel',
    text: 'A levada do click brasileiro fez diferença real no ensaio. Antes a banda tava sempre se ajustando ao metrônomo gringo. Agora é natural.',
  },
  {
    name: 'Rodrigo Melo',
    role: 'Tecladista e produtor',
    text: 'Sábado o ministro de louvor muda uma música? Em alguns minutos tá separada. Domingo a gente não precisa improvisar.',
  },
]

/* ─── Componente ────────────────────────── */

export function LandingPage({ onEnter }: LandingPageProps) {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

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
    <div className="brand-context-dark min-h-screen overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-tinta/85 backdrop-blur-xl border-b border-tinta-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <BrandLogo size="md" tone="light" variant="horizontal" />
          <div className="flex items-center gap-2">
            <a
              href="/download"
              className="hidden sm:flex items-center gap-1.5 text-[13px] text-warm-400 hover:text-bone px-3 py-1.5 transition-colors cursor-pointer font-medium"
            >
              <Download size={14} /> Baixar app
            </a>
            <button
              onClick={goToApp}
              className="hidden sm:block text-[13px] text-warm-400 hover:text-bone px-3 py-1.5 transition-colors cursor-pointer font-medium"
            >
              Entrar
            </button>
            <button
              onClick={goToApp}
              className="text-[13px] bg-laranja hover:bg-laranja-dark text-bone px-5 py-2 rounded-lg font-semibold transition-colors cursor-pointer"
            >
              Começa de graça
            </button>
          </div>
        </div>
      </nav>

      {/* ════════ HERO ════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 pt-28 pb-20 overflow-hidden">
        {/* Atmosphere (warm dark) */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-laranja/[0.10] blur-[140px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-musgo/[0.10] blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(247,243,237,1) 1px,transparent 1px),linear-gradient(90deg,rgba(247,243,237,1) 1px,transparent 1px)', backgroundSize: '64px 64px' }} />
        </div>

        <div className="relative text-center max-w-4xl mx-auto">
          {/* Visual Hammer */}
          <div className="mb-6 inline-flex items-baseline gap-3 select-none">
            <span className="text-warm-400 text-[14px] font-medium tracking-wide">pronto pro</span>
            <DomingoMark size="md" tone="laranja" />
          </div>

          <h1 className="font-display font-semibold text-[clamp(2.4rem,7vw,5rem)] leading-[1.05] tracking-[-0.02em] text-bone mb-6">
            Multitracks de qualquer música.
            <br />
            Pra sua banda chegar
            <br />
            pronta no <span className="italic text-laranja">domingo</span>.
          </h1>

          <p className="text-[clamp(.95rem,2vw,1.2rem)] text-warm-200 max-w-2xl mx-auto mb-10 leading-relaxed">
            Sábado 23h alguém manda mudando o setlist, e a música não está em catálogo nenhum.
            O Playback Studio separa qualquer música, do worship ao sertanejo,
            em faixas prontas. No domingo, repita o refrão e estenda a ministração sem cortar nada.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={goToApp}
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
            <a
              href="/download"
              className="inline-flex items-center justify-center gap-2.5 bg-musgo/15 hover:bg-musgo/25 border border-musgo/30 text-musgo-light px-8 py-4 rounded-xl font-semibold text-[15px] transition-all cursor-pointer"
            >
              <Download size={17} /> Baixar app
            </a>
          </div>

          <p className="text-[12px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
        </div>

        {/* Product preview — DAW preserved (dual aesthetic) */}
        <div className="relative mt-16 w-full max-w-3xl mx-auto">
          <div className="rounded-2xl overflow-hidden border border-tinta-border shadow-2xl shadow-black/40">
            <DemoMixer />
          </div>
          <p className="text-center text-[11px] text-warm-400 mt-3 font-mono">o estúdio dentro do Playback Studio</p>
        </div>
      </section>

      {/* ════════ STAKES — problema + empatia ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-tinta-soft">
        <div className="max-w-3xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o sábado que a gente conhece</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-8 text-center">
            Domingo não tem que ser correria.
          </h2>
          <div className="bg-tinta-raised border border-tinta-border rounded-2xl p-7 sm:p-9 mb-8 leading-relaxed text-[15px] text-warm-200">
            <p className="mb-4">
              Sábado 23h o ministro de louvor manda mudando o setlist. Você passa a madrugada procurando multitracks
              em fórum. Domingo de manhã o som tá descosturado porque a equipe não teve tempo de ensaiar como precisa.
              Segunda você acorda exausto. Tudo de novo na próxima semana.
            </p>
            <p className="text-bone font-medium">
              A gente sabe. A gente também tocava assim.
            </p>
          </div>
        </div>
      </section>

      {/* ════════ GUIDE — 3 benefícios ════════ */}
      <section id="como-funciona" className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o que o Playback Studio entrega</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
            Construída por quem toca.
            <br />
            Pra quem toca.
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { title: 'Qualquer música, não só o catálogo', desc: 'A música que o ministro escolheu não está em catálogo nenhum? Sobe ela aqui. Qualquer música vira multitracks, na hora.' },
              { title: 'Biblioteca de Separações Local', desc: 'Suas separações ficam salvas no seu navegador. Feche e abra depois sem gastar tokens novamente.' },
              { title: 'Você cria, não espera release', desc: 'No catálogo você recebe o que já existe. Aqui você prepara o que a sua equipe precisa, sem esperar lançamento nem licença gringa.' },
            ].map((item, i) => (
              <div key={i} className="bg-tinta-raised border border-tinta-border rounded-2xl p-7 hover:border-laranja/40 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-laranja/15 border border-laranja/25 flex items-center justify-center mb-5">
                  <span className="text-laranja font-display font-semibold text-[15px]">{i + 1}</span>
                </div>
                <h3 className="font-display font-semibold text-[20px] text-bone mb-3 leading-tight">{item.title}</h3>
                <p className="text-[14px] text-warm-200 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PLAN — 3 passos ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-tinta-soft">
        <div className="max-w-4xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o domingo em 3 passos</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
            Como você chega pronto.
          </h2>

          <div className="space-y-5">
            {[
              { n: '1', title: 'Sobe a música', desc: 'Qualquer formato de áudio: MP3, WAV ou AAC.' },
              { n: '2', title: 'O Playback Studio separa tudo', desc: 'Voz, bateria, baixo, guitarra, piano e os outros instrumentos. Em alguns minutos.' },
              { n: '3', title: 'Sua banda chega pronta no domingo', desc: 'Faixas separadas, click e voice guide. Você marca as seções (intro, verso, refrão) pra repetir trechos ao vivo, e a banda acompanha pelo celular.' },
            ].map(step => (
              <div key={step.n} className="bg-tinta-raised border border-tinta-border rounded-2xl p-6 sm:p-8 flex items-start gap-6">
                <div className="w-14 h-14 rounded-full bg-laranja text-bone flex items-center justify-center font-display font-semibold text-[24px] shrink-0">
                  {step.n}
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="font-display font-semibold text-[22px] text-bone mb-2 leading-tight">{step.title}</h3>
                  <p className="text-[15px] text-warm-200 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <button
              onClick={goToApp}
              className="inline-flex items-center justify-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
            >
              Sobe sua primeira música <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {/* ════════ AUDIENCE — pra quem é ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">feito pra</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
            Quem toca todo fim de semana.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AUDIENCE.map((a, i) => (
              <div key={i} className="group bg-tinta-raised border border-tinta-border hover:border-musgo/50 rounded-2xl p-6 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-musgo/15 group-hover:bg-musgo/25 flex items-center justify-center mb-4 transition-colors">
                  <a.icon size={20} className="text-musgo-light" />
                </div>
                <h4 className="font-display font-semibold text-[16px] text-bone mb-2">{a.title}</h4>
                <p className="text-[13px] text-warm-200 leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ FEATURES — tudo que vem junto ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">tudo que vem junto</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-4 text-center">
            Mais do que separar faixas.
          </h2>
          <p className="text-warm-200 text-[15px] max-w-2xl mx-auto mb-16 text-center leading-relaxed">
            A separação é só o começo. O Playback Studio leva a música do upload até o palco, com tudo que a banda precisa no caminho.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="group bg-tinta-raised border border-tinta-border hover:border-laranja/40 rounded-2xl p-6 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-laranja/15 group-hover:bg-laranja/25 flex items-center justify-center mb-4 transition-colors">
                  <f.icon size={20} className="text-laranja" />
                </div>
                <h4 className="font-display font-semibold text-[16px] text-bone mb-2">{f.title}</h4>
                <p className="text-[13px] text-warm-200 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ SUCCESS — transformação ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-tinta-soft">
        <div className="max-w-3xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">seu próximo domingo, diferente</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-12 text-center">
            Sexta separa. Sábado ensaia.
            <br />
            <span className="italic text-musgo-light">Domingo flui.</span>
          </h2>
          <div className="bg-tinta-raised border border-tinta-border rounded-2xl p-7 sm:p-9 space-y-4 text-[15px] leading-relaxed">
            {[
              { day: 'Sexta', text: 'Ministro de louvor manda o setlist. Você sobe no Playback Studio.' },
              { day: 'Sábado', text: 'Tudo separado. Equipe baixou. Ensaio fluiu.' },
              { day: 'Domingo', text: 'Banda travada mas leve. Ministração fluindo.' },
              { day: 'Segunda', text: '"Vamo pra próxima."' },
            ].map((row, i) => (
              <div key={i} className="flex items-baseline gap-5 pb-4 last:pb-0 border-b border-tinta-border last:border-0">
                <span className="font-display font-semibold text-bone text-[18px] w-24 shrink-0">{row.day}</span>
                <span className="text-warm-200">{row.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ TESTIMONIALS ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">bandas que já chegam prontas</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
            Histórias de domingo.
          </h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((r, i) => (
              <div key={i} className="bg-tinta-raised border border-tinta-border rounded-2xl p-7">
                <div className="flex gap-0.5 mb-4">
                  {[1, 2, 3, 4, 5].map(j => <Star key={j} size={12} className="text-laranja fill-laranja" />)}
                </div>
                <p className="text-[14px] text-warm-200 leading-relaxed mb-5">"{r.text}"</p>
                <div>
                  <div className="font-display font-semibold text-[15px] text-bone">{r.name}</div>
                  <div className="text-[12px] text-warm-400">{r.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PRICING ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-tinta-soft" id="precos">
        <div className="max-w-5xl mx-auto">
          <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">planos</p>
          <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-3 text-center">
            Planos pra sua banda chegar pronta no domingo.
          </h2>
          <p className="text-warm-200 text-[15px] mb-10 text-center">
            Sem fidelidade, sem pegadinha. Começa de graça e cresce quando precisar.
          </p>

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
                    onClick={() => goToCheckout(plan.id, price)}
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

      {/* ════════ FAQ ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display font-semibold text-[clamp(1.6rem,4vw,2.4rem)] text-bone text-center mb-12">
            Perguntas frequentes
          </h2>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-tinta-border rounded-xl overflow-hidden bg-tinta-raised">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-tinta-border/40 transition-colors"
                >
                  <span className="font-semibold text-[14px] text-bone pr-4">{faq.q}</span>
                  <ChevronDown size={15} className={`text-warm-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 pt-4 text-[13px] text-warm-200 leading-relaxed border-t border-tinta-border">
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
          <div className="relative bg-tinta-raised border-2 border-laranja/40 rounded-3xl p-12 sm:p-16 overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-36 bg-laranja/15 blur-3xl rounded-full pointer-events-none" />
            <div className="relative">
              <div className="inline-flex items-baseline gap-3 mb-6">
                <span className="text-warm-400 text-[14px] font-medium tracking-wide">pronto pro</span>
                <DomingoMark size="lg" tone="laranja" />
                <span className="text-warm-400 text-[14px] font-medium tracking-wide">?</span>
              </div>
              <h2 className="font-display font-semibold text-[clamp(1.8rem,5vw,2.8rem)] text-bone mb-4 leading-tight">
                Sua próxima semana,
                <br />
                já fica diferente.
              </h2>
              <p className="text-warm-200 text-[15px] leading-relaxed mb-8">
                Começa de graça. Sobe sua primeira música em menos de 2 minutos.
              </p>
              <button
                onClick={goToApp}
                className="inline-flex items-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-9 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
              >
                Começa de graça <ArrowRight size={18} />
              </button>
              <p className="text-[11px] text-warm-400 mt-5">Sem cartão de crédito · Cancele quando quiser</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer className="border-t border-tinta-border py-10 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <PlaybackStudioWordmark size="sm" tone="light" />
            <span className="text-warm-400 text-[11px]">a plataforma do domingo</span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-warm-200">
            <button onClick={goToApp} className="hover:text-bone transition-colors cursor-pointer">Entrar</button>
            <button onClick={goToApp} className="hover:text-bone transition-colors cursor-pointer">Criar conta</button>
            <a href="#precos" className="hover:text-bone transition-colors">Planos</a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-bone transition-colors"
            >
              <WhatsappIcon className="w-3.5 h-3.5" />
              Suporte
            </a>
          </div>
          <p className="text-[11px] text-warm-400">© {new Date().getFullYear()} Playback Studio · Feito por quem toca.</p>
        </div>
      </footer>

      {/* ════════ BOTÃO FLUTUANTE WHATSAPP ════════ */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-white shadow-lg shadow-black/30 transition-transform hover:scale-105 active:scale-95"
      >
        <WhatsappIcon className="w-6 h-6" />
        <span className="hidden sm:block text-sm font-semibold pr-1">Fale com a gente</span>
      </a>
    </div>
  )
}
