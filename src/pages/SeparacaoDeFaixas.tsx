import { useNavigate, Link } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { ArrowRight, Mic2, Wand2, Music, Headphones } from 'lucide-react'
import { MarketingNav } from '../components/sections/MarketingNav'
import { MarketingFooter } from '../components/sections/MarketingFooter'
import { CTASection } from '../components/sections/CTASection'
import { FAQSection } from '../components/sections/FAQSection'

const URL = 'https://playbackstudio.com.br/separacao-de-faixas'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Separação de faixas: guia completo (multitracks com IA)',
  description: 'Como funciona a separação de faixas com IA. Use casos práticos pra banda, voice guide, karaokê, remix. Como fazer rápido no Playback Studio.',
  url: URL,
  inLanguage: 'pt-BR',
  isPartOf: {
    '@type': 'WebSite',
    name: 'Playback Studio',
    url: 'https://playbackstudio.com.br/',
  },
}

export default function SeparacaoDeFaixas() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')

  return (
    <>
      <Head>
        <title>Separação de faixas: gera multitracks de qualquer música · Playback Studio</title>
        <meta name="description" content="Separação de faixas com IA: qualquer música vira multitracks (voz, bateria, baixo, guitarra, piano) em alguns minutos. Pra banda ensaiar, tocar ao vivo, refazer arranjo. Sem instalar nada." />
        <link rel="canonical" href={URL} />
        <meta property="og:url" content={URL} />
        <meta property="og:title" content="Separação de faixas (multitracks) · Playback Studio" />
        <meta property="og:description" content="Separe qualquer música em multitracks em alguns minutos. Pra banda, voice guide, karaokê, remix. Direto no navegador." />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        {/* Hero */}
        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">separação de faixas com ia</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.4rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Separação de faixas: qualquer música vira <span className="italic text-laranja">multitracks</span>.
            </h1>
            <p className="text-warm-200 text-[17px] leading-relaxed max-w-2xl mx-auto mb-8">
              IA separa qualquer música em até 6 faixas isoladas. Voz, bateria, baixo, guitarra,
              piano, outros. Em alguns minutos. Sem instalar nada, direto no navegador.
            </p>
            <button
              onClick={onEnter}
              className="inline-flex items-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
            >
              Separar minha primeira música <ArrowRight size={17} />
            </button>
            <p className="text-[12px] text-warm-400 mt-4">5 separações grátis no plano Livre. Sem cartão.</p>
          </div>
        </header>

        {/* Content */}
        <article className="py-16 px-5 sm:px-8">
          <div className="max-w-2xl mx-auto prose-blog">

            <h2>O que é separação de faixas</h2>
            <p>
              Toda música que você ouve no Spotify ou no YouTube é uma mistura final, com todos os instrumentos
              empilhados num arquivo só. Quando a música foi gravada em estúdio, cada instrumento tinha sua
              própria faixa. Mas no produto final (a chamada "master") tudo virou uma camada só.
            </p>
            <p>
              <strong>Separação de faixas</strong> é o processo reverso: pegar essa mistura final e desfazê-la,
              reconstruindo cada instrumento na sua faixa individual. Cada faixa separada é o que chamamos de
              <strong> multitrack</strong>: pode ser usado isolado (pra estudo, voice guide, karaokê), combinado
              em parte (pra suprir alguém que faltou na banda), ou todos juntos no player ao vivo (com cada
              canal controlado independente, igual estúdio).
            </p>
            <p>
              Durante décadas, isso só era possível se você tivesse acesso aos arquivos brutos do estúdio onde
              a música foi gravada. Hoje, com IA treinada pra reconhecer instrumentos por padrões de frequência,
              qualquer pessoa separa qualquer música em poucos minutos.
            </p>

            <h2>Pra que separar faixas, na prática</h2>

            <h3>1. Voice guide pra equipe vocal</h3>
            <p>
              Quem canta em banda precisa estudar a melodia da gravação original. Mas a voz no contexto da
              mix completa é difícil de isolar de ouvido. Com a faixa de voz separada, vocalistas e ministros
              estudam fraseado, respiração e intenção sem ruído.
            </p>

            <h3>2. Banda instrumental ensaiando</h3>
            <p>
              Baterista isola só a bateria e o click pra estudar levada e fills. Baixista ouve só o baixo
              pra pegar grooves. Tecladista isola piano e teclado. Cada um aprende a parte dele em casa
              durante a semana, e ensaio vira polimento. Dá mais detalhe no nosso guia
              <Link to="/blog/repertorio-worship-domingo"> sobre montar repertório de worship pro domingo</Link>.
            </p>

            <h3>3. Karaokê e backing track</h3>
            <p>
              A faixa instrumental (sem voz) é o que karaokê profissional chama de backing track. Útil
              tanto pra cantar por cima quanto pra dar pra cantora de fora que vai participar de um culto
              ou show. Você gera de qualquer música, mesmo das que nunca tiveram versão karaokê oficial.
            </p>

            <h3>4. Tocar ao vivo com playback de multitracks</h3>
            <p>
              Sua banda chega ao palco. Tecladista faltou. Baixista ainda tá no trânsito. Em vez de adiar
              ou improvisar grosseiro, você roda os multitracks dos instrumentos faltantes pelo player,
              cada um no seu canal, com volume controlado. Mistura banda ao vivo com playback estruturado.
            </p>

            <h3>5. Remix, mashup e arranjo próprio</h3>
            <p>
              Produtores usam faixas isoladas como matéria-prima pra criar versões novas. Bandas que querem
              refazer arranjo (trocar guitarra original pela do guitarrista da equipe, substituir piano por
              teclado retrô) precisam do mesmo: cada faixa separada pra trabalhar em cima.
            </p>

            <h2>Como funciona a separação por IA (sem técnico)</h2>
            <p>
              Não é remoção literal. O algoritmo aprendeu, ouvindo milhares de músicas, a reconhecer padrões
              característicos de cada tipo de som. Voz humana tem faixa de frequência e padrões de modulação
              específicos. Bateria tem ataques curtos e graves característicos. Cordas vibram diferente. A IA
              usa esses padrões pra <strong>reconstruir</strong> cada faixa separadamente, frame por frame.
            </p>
            <p>
              O resultado nunca é 100% perfeito (especialmente em músicas muito densas ou com efeitos pesados
              de reverb). Mas pra uso de banda, voice guide, karaokê ou estudo, é mais que suficiente. Em
              muitos casos a qualidade fica indistinguível de multitracks originais.
            </p>

            <h2>Como o Playback Studio separa</h2>
            <p>
              Três passos:
            </p>
            <ol>
              <li><strong>Sobe a música.</strong> MP3, WAV ou link do YouTube. Sem conversão, sem corte.</li>
              <li><strong>A IA separa.</strong> Em poucos minutos: voz, bateria, baixo, guitarra, piano e outros, cada um na sua faixa.</li>
              <li><strong>Você usa.</strong> Baixa, ouve no mixer integrado, compartilha com a equipe ou usa direto no player ao vivo.</li>
            </ol>
            <p>
              <Link to="/app">Cria conta de graça</Link> e a primeira separação sai em menos de 5 minutos.
              5 separações por mês no plano Livre, sem cartão.
            </p>

            <h2>Honestidade: limites da separação por IA</h2>
            <p>
              IA boa não promete milagre. Vale saber antes:
            </p>
            <ul>
              <li><strong>Reverbs e efeitos pesados</strong> ficam parcialmente na faixa errada. Voz com muito eco original deixa eco fantasma na faixa instrumental.</li>
              <li><strong>Coros e backing vocals</strong> às vezes misturam com voz principal ou ficam no instrumental, dependendo de como foram gravados.</li>
              <li><strong>Músicas muito antigas</strong> (anos 70 pra trás) podem ter mais artifacts porque a gravação original já era diferente.</li>
            </ul>
            <p>
              Pra uso profissional de mixagem, isso importa. Pra uso de banda, ensaio, voice guide ou karaokê,
              na prática quase ninguém percebe.
            </p>

            <h2>Quantas faixas o Playback Studio separa</h2>
            <p>
              Depende do plano:
            </p>
            <ul>
              <li><strong>Livre e Pro (separação básica)</strong>: 2 ou 4 faixas. Voz / instrumental, ou voz / bateria / baixo / outros.</li>
              <li><strong>Pro e Studio (separação avançada)</strong>: até 6 faixas. Voz, bateria, baixo, guitarra, piano, outros.</li>
            </ul>
            <p>
              <Link to="/precos">Vê os planos completos</Link> com preço em Reais.
            </p>

            <h2>Comum entre quem usa: equipes de worship brasileiras</h2>
            <p>
              A maioria das equipes que usa o Playback Studio toca em ministério de adoração. Faz sentido:
              setlist muda toda semana, repertório é amplo, banda voluntária não tira tudo de ouvido. Se
              é o seu caso, vê também a página específica sobre
              <Link to="/multitracks"> multitracks pra worship</Link>.
            </p>

            <h2>Próximo passo</h2>
            <p>
              <Link to="/app">Sobe sua primeira música</Link> agora e em 3 minutos você tem as faixas separadas.
              Se preferir ver os planos antes, <Link to="/precos">aqui</Link> (tem plano grátis pra testar sem compromisso).
            </p>
          </div>
        </article>

        {/* Features grid */}
        <section className="py-16 px-5 sm:px-8 bg-tinta-soft">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-display font-semibold text-[clamp(1.5rem,3.5vw,2.2rem)] text-bone text-center mb-12">
              O que você consegue fazer
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: Mic2, title: 'Voz isolada', desc: 'Pra voice guide, estudo de melodia e fraseado.' },
                { icon: Music, title: 'Instrumental limpo', desc: 'Pra karaokê, banda tocar por cima ou refazer arranjo.' },
                { icon: Wand2, title: 'Até 6 faixas', desc: 'Voz, bateria, baixo, guitarra, piano, outros. Cada um na sua faixa.' },
                { icon: Headphones, title: 'Tudo no celular', desc: 'PWA que roda no navegador, sem instalar nada.' },
              ].map((f, i) => (
                <div key={i} className="bg-tinta-raised border border-tinta-border rounded-2xl p-6">
                  <div className="w-10 h-10 rounded-xl bg-laranja/15 border border-laranja/25 flex items-center justify-center mb-4">
                    <f.icon size={18} className="text-laranja" />
                  </div>
                  <h3 className="font-display font-semibold text-[16px] text-bone mb-2">{f.title}</h3>
                  <p className="text-[13px] text-warm-200 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <FAQSection />
        <CTASection onEnter={onEnter} heading={<>Separa sua primeira música agora.</>} subtitle="Grátis, sem cartão de crédito, em menos de 5 minutos." />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}
