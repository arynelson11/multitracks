import matter from 'gray-matter'
import { marked } from 'marked'

export interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  author: string
  cover?: string
  tags: string[]
  html: string
  excerpt: string
  readingMinutes: number
}

const rawPosts = import.meta.glob('../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function slugFromPath(path: string): string {
  const file = path.split('/').pop() ?? ''
  return file.replace(/\.md$/, '')
}

function computeReadingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 220))
}

function parsePost(path: string, raw: string): BlogPost {
  const { data, content } = matter(raw)
  const html = marked.parse(content, { async: false }) as string
  const slug = (data.slug as string) ?? slugFromPath(path)
  return {
    slug,
    title: (data.title as string) ?? slug,
    description: (data.description as string) ?? '',
    date: (data.date as string) ?? '',
    author: (data.author as string) ?? 'Playback Studio',
    cover: data.cover as string | undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    html,
    excerpt: content.slice(0, 200).replace(/\s+/g, ' ').trim() + '…',
    readingMinutes: computeReadingMinutes(content),
  }
}

const POSTS: BlogPost[] = Object.entries(rawPosts)
  .map(([path, raw]) => parsePost(path, raw))
  .sort((a, b) => (a.date < b.date ? 1 : -1))

export function getAllPosts(): BlogPost[] {
  return POSTS
}

export function getPostSlugs(): string[] {
  return POSTS.map(p => p.slug)
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find(p => p.slug === slug)
}
