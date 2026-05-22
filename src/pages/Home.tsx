
import { Head } from 'vite-react-ssg'
import { LandingPage } from '../components/LandingPage'

export default function Home() {
  return (
    <>
      <Head>
        <title>Playback Studio · Multitracks de qualquer música, pronto pro domingo</title>
        <meta name="description" content="O Playback Studio separa qualquer música em multitracks prontos. Voz, bateria, baixo, guitarra, piano. Pra sua banda chegar no domingo com tudo na mão. Feito por quem toca." />
        <link rel="canonical" href="https://playbackstudio.com.br/" />
        <meta property="og:url" content="https://playbackstudio.com.br/" />
        <meta property="og:title" content="Playback Studio · A plataforma do domingo" />
      </Head>
      <LandingPage onEnter={() => { window.location.href = '/app' }} />
    </>
  )
}
