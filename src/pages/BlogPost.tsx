import { useNavigate, useParams, Link } from 'react-router-dom'
import { Head } from 'vite-react-ssg'
import { ArrowLeft } from 'lucide-react'
import { MarketingNav } from '../components/sections/MarketingNav'
import { MarketingFooter } from '../components/sections/MarketingFooter'
import { CTASection } from '../components/sections/CTASection'
import { getPostBySlug, getPostSlugs } from '../lib/blog'

export function getStaticPaths(): string[] {
  return getPostSlugs().map(s => `blog/${s}`)
}

export const Component = BlogPost

export default function BlogPost() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()
  const post = slug ? getPostBySlug(slug) : undefined
  const onEnter = () => navigate('/app')

  if (!post) {
    return (
      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />
        <div className="pt-36 px-5 sm:px-8 text-center max-w-2xl mx-auto">
          <h1 className="font-display font-semibold text-[clamp(1.8rem,4vw,2.6rem)] text-bone mb-4">Post não encontrado</h1>
          <p className="text-warm-200 mb-8">A gente não achou esse post.</p>
          <Link to="/blog" className="inline-flex items-center gap-2 text-laranja hover:text-laranja-light">
            <ArrowLeft size={14} /> Voltar pro blog
          </Link>
        </div>
      </div>
    )
  }

  const url = `https://playbackstudio.com.br/blog/${post.slug}`
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    author: { '@type': 'Organization', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: 'Playback Studio',
      logo: { '@type': 'ImageObject', url: 'https://playbackstudio.com.br/logo.png' },
    },
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: url,
    image: post.cover ?? 'https://playbackstudio.com.br/og-image.png',
    inLanguage: 'pt-BR',
  }

  return (
    <>
      <Head>
        <title>{post.title} · Playback Studio</title>
        <meta name="description" content={post.description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="article:published_time" content={post.date} />
        <meta property="article:author" content={post.author} />
        {post.tags.map(tag => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}
        <script type="application/ld+json">{JSON.stringify(articleJsonLd)}</script>
      </Head>

      <div className="brand-context-dark min-h-screen overflow-x-hidden">
        <MarketingNav onEnter={onEnter} />

        <article className="pt-36 pb-16 px-5 sm:px-8">
          <div className="max-w-2xl mx-auto">
            <Link to="/blog" className="inline-flex items-center gap-2 text-[13px] text-warm-400 hover:text-bone mb-8 transition-colors">
              <ArrowLeft size={14} /> Todos os posts
            </Link>

            <div className="flex items-center gap-3 text-[11px] text-warm-400 mb-4 uppercase tracking-widest">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span>·</span>
              <span>{post.readingMinutes} min de leitura</span>
            </div>

            <h1 className="font-display font-semibold text-[clamp(2rem,5vw,3rem)] leading-[1.1] tracking-[-0.02em] text-bone mb-6">
              {post.title}
            </h1>

            <p className="text-warm-200 text-[17px] leading-relaxed mb-10 pb-10 border-b border-tinta-border">
              {post.description}
            </p>

            <div
              className="prose-blog max-w-none"
              dangerouslySetInnerHTML={{ __html: post.html }}
            />

            {post.tags.length > 0 && (
              <div className="mt-12 pt-8 border-t border-tinta-border flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-warm-400 uppercase tracking-widest">Tags</span>
                {post.tags.map(tag => (
                  <span key={tag} className="text-[12px] text-warm-200 bg-tinta-raised border border-tinta-border rounded-full px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </article>

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
