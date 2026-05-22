import type { RouteRecord } from 'vite-react-ssg'
import { Outlet } from 'react-router-dom'
import Home from './pages/Home'
import Pricing from './pages/Pricing'
import HowItWorks from './pages/HowItWorks'
import FAQ from './pages/FAQ'
import BlogList from './pages/BlogList'
import BlogPost from './pages/BlogPost'
import SeparacaoDeFaixas from './pages/SeparacaoDeFaixas'
import Multitracks from './pages/Multitracks'
import MusicAppRoute from './pages/MusicAppRoute'
import { getPostSlugs } from './lib/blog'

function RootLayout() {
  return <Outlet />
}

export const routes: RouteRecord[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Home, entry: 'src/pages/Home.tsx' },
      { path: 'precos', Component: Pricing, entry: 'src/pages/Pricing.tsx' },
      { path: 'como-funciona', Component: HowItWorks, entry: 'src/pages/HowItWorks.tsx' },
      { path: 'faq', Component: FAQ, entry: 'src/pages/FAQ.tsx' },
      { path: 'separacao-de-faixas', Component: SeparacaoDeFaixas, entry: 'src/pages/SeparacaoDeFaixas.tsx' },
      { path: 'multitracks', Component: Multitracks, entry: 'src/pages/Multitracks.tsx' },
      { path: 'blog', Component: BlogList, entry: 'src/pages/BlogList.tsx' },
      {
        path: 'blog/:slug',
        Component: BlogPost,
        entry: 'src/pages/BlogPost.tsx',
        getStaticPaths: () => getPostSlugs().map(s => `blog/${s}`),
      },
      {
        path: 'app/*',
        Component: MusicAppRoute,
        entry: 'src/pages/MusicAppRoute.tsx',
        getStaticPaths: () => ['app'],
      },
    ],
  },
]
