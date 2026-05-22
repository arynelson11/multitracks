import { useNavigate, Link } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { ArrowRight } from 'lucide-react'
import { MarketingNav } from '../components/sections/MarketingNav'
import { MarketingFooter } from '../components/sections/MarketingFooter'
import { CTASection } from '../components/sections/CTASection'
import { getAllPosts } from '../lib/blog'

export default function BlogList() {
  const navigate = useNavigate()
  const onEnter = () => navigate('/app')
  const posts = getAllPosts()

  return (
    <>
      <Head>
        <title>Blog · Playback Studio (worship, multitracks, banda)</title>
        <meta name="description" content="Guias práticos pra quem toca em banda: worship, gospel, sertanejo. Como usar multitracks, montar repertório, fazer ensaio render. Escrito por quem toca." />
        <link rel="canonical" href="https://playbackstudio.com.br/blog" />
        <meta property="og:url" content="https://playbackstudio.com.br/blog" />
        <meta property="og:title" content="Blog · Playback Studio" />
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        <header className="pt-36 pb-12 px-5 sm:px-8 bg-tinta">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4">blog</p>
            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-5">
              Guias pra <span className="italic text-laranja">quem toca</span>.
            </h1>
            <p className="text-warm-200 text-[16px] leading-relaxed max-w-2xl mx-auto">
              Tudo que a gente aprendeu tocando em equipe: fluxo de ensaio, multitracks na prática,
              como o domingo flui. Escrito sem rodeio.
            </p>
          </div>
        </header>

        <section className="py-16 px-5 sm:px-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {posts.length === 0 && (
              <p className="text-warm-400 text-center">Em breve.</p>
            )}
            {posts.map(post => (
              <article key={post.slug} className="border border-tinta-border bg-tinta-raised rounded-2xl p-7 hover:border-laranja/40 transition-colors">
                <div className="flex items-center gap-3 text-[11px] text-warm-400 mb-3 uppercase tracking-widest">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span>·</span>
                  <span>{post.readingMinutes} min de leitura</span>
                </div>
                <h2 className="font-display font-semibold text-[22px] sm:text-[26px] text-bone mb-3 leading-tight">
                  <Link to={`/blog/${post.slug}`} className="hover:text-laranja transition-colors">
                    {post.title}
                  </Link>
                </h2>
                <p className="text-[14px] text-warm-200 leading-relaxed mb-4">
                  {post.description}
                </p>
                <Link
                  to={`/blog/${post.slug}`}
                  className="inline-flex items-center gap-2 text-[13px] font-semibold text-laranja hover:text-laranja-light transition-colors"
                >
                  Ler post <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <CTASection onEnter={onEnter} />
        <MarketingFooter onEnter={onEnter} />
      </div>
    </>
  )
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}
