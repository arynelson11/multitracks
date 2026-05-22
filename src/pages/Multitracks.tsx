import { useNavigate, Link } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { ArrowRight, Check, X } from 'lucide-react'
import { MarketingNav } from '../components/sections/MarketingNav'
import { MarketingFooter } from '../components/sections/MarketingFooter'
import { CTASection } from '../components/sections/CTASection'
import { FAQSection } from '../components/sections/FAQSection'

const URL = 'https://playbackstudio.com.br/multitracks'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Multitracks: qualquer música, sem catálogo',
  description: 'Multitracks de qualquer música pra banda brasileira. Sem catálogo, sem licença gringa. IA separa em minutos. Pra worship, gospel, rock, sertanejo, MPB.',
  url: URL,
  inLanguage: 'pt-BR',
  isPartOf: {
    '@type': 'WebSite',
    name: 'Playback Studio',
    url: 'https://playbackstudio.com.br/',
  },
}

export default function Multitracks() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')

  return (
    <>
      <Head>
        <title>Multitracks de qualquer música, sem catálogo · Playback Studio</title>
        <meta name="description" content="Multitracks de qualquer música, gerados por IA. Pra banda brasileira tocar worship, gospel, rock, MPB. Sem catálogo, sem licença, sem espera. Pronto pro próximo domingo." />
        <link rel="canonical" href={URL} />
        <meta property="og:url" content={URL} />
        <meta property="og:title" content="Multitracks · Playback Studio" />
        <meta property="og:description" content="Banda brasileira toca qualquer música. Sem catálogo, sem licença, sem espera. Pronto pro domingo." />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        {/* Hero */}
        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">multitracks pra banda brasileira</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.4rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Multitracks de <span className="italic text-laranja">qualquer música</span>. Sem catálogo.
            </h1>
            <p className="text-warm-200 text-[17px] leading-relaxed max-w-2xl mx-auto mb-8">
              Sua banda toca qualquer música. Worship, gospel, sertanejo, rock, MPB, autoral.
              IA separa em multitracks em alguns minutos. Sem licença gringa, sem espera, sem release.
            </p>
            <button
              onClick={onEnter}
              className="inline-flex items-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
            >
              Começa de graça <ArrowRight size={17} />
            </button>
            <p className="text-[12px] text-warm-400 mt-4">5 separações grátis. Sem cartão.</p>
          </div>
        </header>

        {/* Article body */}
        <article className="py-16 px-5 sm:px-8">
          <div className="max-w-2xl mx-auto prose-blog">

            <h2>O que são multitracks</h2>
            <p>
              <strong>Multitracks</strong> são os arquivos de uma música separados em faixas individuais
              prontas pra tocar ao vivo. Em vez de você ter o áudio final misturado (o que sai no Spotify),
              você tem cada instrumento em sua própria faixa: voz, bateria, baixo, guitarra, piano, pads.
            </p>
            <p>
              No palco, esses multitracks rodam pelo player com cada canal controlado independente. Sua
              banda toca por cima, com volume de cada faixa ajustável em tempo real. Quando alguém da
              equipe falta, o multitrack daquele instrumento mantém a música cheia. Quando a banda tá
              completa, os multitracks viram apoio (pads, naipes, voice guide).
            </p>

            <h2>O problema do modelo tradicional de multitracks</h2>
            <p>
              Há décadas, equipes que querem tocar com multitracks dependem dos mesmos catálogos americanos:
              MultiTracks.com, Loop Community, Praise Charts. Modelo de licenciamento, baseado em catálogo
              limitado, pago por música em dólar.
            </p>
            <p>
              Esse modelo serve megachurch gringa. Pra equipe brasileira, no minuto que você sai do top
              20 do Hillsong, Bethel ou Elevation, <strong>você fica sem opção</strong>:
            </p>
            <ul>
              <li>Música nova de banda brasileira (Casa Worship, Gabriela Rocha, Eli Soares, Aline Barros) raramente tem multitrack oficial.</li>
              <li>Hinos congregacionais que sua igreja toca há 20 anos? Esquece.</li>
              <li>Música autoral da sua banda? Nunca vai estar em catálogo.</li>
              <li>Cover de cantora local que viralizou? Impossível.</li>
            </ul>
            <p>
              Resultado: equipe brasileira fica refém de repertório limitado, paga em dólar, e ainda toca
              metade do setlist "de ouvido" porque a outra metade nem tem multitrack disponível.
            </p>

            <h2>A virada: multitracks de qualquer música, gerados por IA</h2>
            <p>
              A IA mudou o jogo. Hoje qualquer música, gravada em qualquer época, em qualquer país, em
              qualquer estilo, vira multitracks em alguns minutos. Não precisa que alguém "libere" em
              catálogo. Não precisa pagar licença por faixa. Não precisa esperar release oficial.
            </p>
            <p>
              <strong>Você sobe a música. A IA separa. Sua banda tem o multitrack.</strong>
            </p>
            <p>
              Em vez de "qual música cabe no nosso catálogo?", a pergunta vira "qual música a gente quer
              tocar?". Sem filtro técnico no meio.
            </p>

            <h2>Catálogo gringo vs Playback Studio</h2>
            <div className="not-prose my-8 grid sm:grid-cols-2 gap-4">
              <div className="bg-tinta-raised border border-tinta-border rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <X size={18} className="text-warm-400" />
                  <h3 className="font-display font-semibold text-[18px] text-bone">Catálogo licenciado</h3>
                </div>
                <ul className="space-y-2 text-[13px] text-warm-200">
                  <li className="flex gap-2"><X size={13} className="text-warm-400 mt-1 shrink-0"/>Cobra por música, em dólar</li>
                  <li className="flex gap-2"><X size={13} className="text-warm-400 mt-1 shrink-0"/>Música nova demora semanas pra liberar</li>
                  <li className="flex gap-2"><X size={13} className="text-warm-400 mt-1 shrink-0"/>Não tem 90% do repertório brasileiro</li>
                  <li className="flex gap-2"><X size={13} className="text-warm-400 mt-1 shrink-0"/>Música autoral? Esquece</li>
                  <li className="flex gap-2"><X size={13} className="text-warm-400 mt-1 shrink-0"/>Click sempre gringo, sem levada BR</li>
                </ul>
              </div>
              <div className="bg-tinta-raised border-2 border-laranja/40 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Check size={18} className="text-laranja" />
                  <h3 className="font-display font-semibold text-[18px] text-bone">Playback Studio</h3>
                </div>
                <ul className="space-y-2 text-[13px] text-warm-200">
                  <li className="flex gap-2"><Check size={13} className="text-laranja mt-1 shrink-0"/>Assinatura em Reais, sem licença por música</li>
                  <li className="flex gap-2"><Check size={13} className="text-laranja mt-1 shrink-0"/>Música nova vira multitrack em minutos</li>
                  <li className="flex gap-2"><Check size={13} className="text-laranja mt-1 shrink-0"/>Qualquer música, qualquer banda, qualquer época</li>
                  <li className="flex gap-2"><Check size={13} className="text-laranja mt-1 shrink-0"/>Música autoral também funciona</li>
                  <li className="flex gap-2"><Check size={13} className="text-laranja mt-1 shrink-0"/>Click com levada brasileira no Pro</li>
                </ul>
              </div>
            </div>

            <h2>O que sua banda faz com multitracks</h2>

            <h3>Equipe vocal</h3>
            <p>
              Voice guide isolado pra cada vocalista treinar a parte. Sem precisar tirar de ouvido em
              cima de mix poluída. Ministro alinha afinação e fraseado da equipe inteira em 1 ensaio,
              não em 5.
            </p>

            <h3>Banda instrumental</h3>
            <p>
              Cada músico estuda a parte dele em isolamento durante a semana. Baixista ouve só baixo,
              baterista só bateria. Sábado, ensaio é polimento, não decifração. Vê o fluxo completo no
              guia de <Link to="/blog/repertorio-worship-domingo">como montar repertório de worship</Link>.
            </p>

            <h3>Quando alguém falta</h3>
            <p>
              Tecladista viajou? Baixista doente? Você roda só a faixa daquele instrumento no player
              enquanto o resto da banda toca ao vivo. Som cheio, sem improvisação grosseira.
            </p>

            <h3>Tonalidade pra ministro</h3>
            <p>
              Ministro precisa tom mais baixo essa semana? O player do <Link to="/app">Playback Studio</Link>
              transpõe a música inteira preservando o arranjo. Sem regravar.
            </p>

            <h3>Setlist que muda em cima da hora</h3>
            <p>
              Sábado 22h o ministro manda mensagem trocando uma música. Você sobe a nova, em 3 minutos
              tá separada em multitrack, manda no grupo. Equipe ainda dorme preparada.
            </p>

            <h2>Features pensadas pra worship brasileiro</h2>
            <ul>
              <li><strong>Click com levada brasileira</strong> (plano Pro): metrônomo que respeita o feel do worship BR.</li>
              <li><strong>Auto-detecção de seções</strong>: intro, verso, refrão, ponte marcados automaticamente. Útil pra ministro pular direto pra seção.</li>
              <li><strong>Voice guide auto-detector</strong>: voz da gravação original como referência discreta no in-ear.</li>
              <li><strong>Multi-repertório</strong> (plano Studio): cada equipe (manhã, noite, ensaio jovem) com sua própria lista.</li>
              <li><strong>Funciona offline ao vivo</strong>: depois de carregar, o player toca sem internet. Crítico em palco.</li>
            </ul>

            <h2>Pra quem o Playback Studio NÃO serve</h2>
            <p>
              Honestidade: se você procura:
            </p>
            <ul>
              <li><strong>Multitrack oficial pra mixagem profissional</strong> em estúdio (com 30+ canais separados em alta resolução), siga com Loop Community ou MultiTracks.com. A separação por IA não compete em uso de mixagem profissional.</li>
              <li><strong>Catálogo curado de "música pra culto"</strong> com tudo já pronto, organizado e etiquetado, com tonalidades alternativas oficiais. O Playback Studio te dá ferramenta. Você escolhe e processa a música.</li>
            </ul>
            <p>
              Pro resto (90% das equipes brasileiras que tocam todo domingo) a equação muda. Custo menor,
              repertório ilimitado, autonomia total.
            </p>

            <h2>Como começar essa semana</h2>
            <ol>
              <li><Link to="/app">Cria conta de graça</Link> (sem cartão, plano Livre tem 5 separações/mês).</li>
              <li>Sobe uma música do próximo setlist, qualquer música.</li>
              <li>Em 3-5 minutos os multitracks estão prontos.</li>
              <li>Compartilha no grupo da equipe.</li>
              <li>Domingo, sente a diferença.</li>
            </ol>
            <p>
              Se sua equipe gostar (vai gostar), <Link to="/precos">vê os planos pagos</Link>. Pro plano
              cobre 50 separações por mês a R$ 39,90 mensais no anual. Tipicamente menos do que uma única
              música custaria num catálogo gringo.
            </p>

            <h2>Quer ler mais antes de testar?</h2>
            <ul>
              <li><Link to="/separacao-de-faixas">Separação de faixas: guia completo</Link></li>
              <li><Link to="/blog/o-que-sao-multitracks">O que são multitracks: o guia pra quem toca em banda</Link></li>
              <li><Link to="/blog/repertorio-worship-domingo">Como montar repertório de worship pro domingo</Link></li>
            </ul>
          </div>
        </article>

        <FAQSection />
        <CTASection onEnter={onEnter} heading={<>Pronto pro próximo <span className="italic text-laranja">domingo</span>?</>} />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}
