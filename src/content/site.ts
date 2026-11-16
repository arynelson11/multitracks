// Dados públicos do site num lugar só: o que a landing mostra e o que o build
// escreve no HTML (título por página, JSON-LD e o resumo do <noscript>).
// Preços e recursos seguem o PLAYBACK_STUDIO_FATOS.md; mudou lá, muda aqui no mesmo passo.
// Este arquivo também é lido pelo vite.config.ts, então fica sem nada de navegador.

export const SITE_URL = 'https://playbackstudio.com.br'
export const BRAND_NAME = 'Playback Studio'
export const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  alt: 'Logo do Playback Studio: o triângulo de play laranja cortado em faixas, sobre fundo escuro',
}

export const COMPANY = {
  name: 'Grupo AIO',
  cnpj: '43.247.025/0001-05',
  city: 'Macaé',
  state: 'RJ',
}

export const CONTACT = {
  whatsappNumber: '5522997249896',
  whatsappDisplay: '(22) 99724-9896',
  email: 'contatoplaybackstudio@gmail.com',
}

export const WHATSAPP_URL =
  `https://wa.me/${CONTACT.whatsappNumber}?text=` +
  encodeURIComponent('Olá! Vim pelo site do Playback Studio e preciso de ajuda.')

// Páginas legais (HTML estático em public/, servido sem o .html pelo cleanUrls da Vercel).
export const LEGAL_LINKS = [
  { href: '/privacidade', label: 'Privacidade' },
  { href: '/termos', label: 'Termos' },
  { href: '/cancelamento', label: 'Cancelamento' },
] as const

// Preço cobrado de verdade (api/checkout.ts). annualTotal é o valor cobrado no anual.
export const PRICES = {
  pro: { name: 'Pro', monthly: 49.9, annualTotal: 454.8 },
  studio: { name: 'Studio', monthly: 119.9, annualTotal: 1078.8 },
} as const

// Resumo de cada plano (vai pro <noscript>). Segue a seção 2 do FATOS.
export const PLAN_SUMMARIES = {
  livre: '5 separações por mês em 2 faixas (voz e instrumental), pra ouvir no mixer. A biblioteca de separações fica no navegador.',
  pro: '50 separações por mês em 2, 4 ou 6 faixas, download em WAV e MP3, BPM pela IA, voz guia, pads, seções com loop, troca de tom, teleprompter, biblioteca na nuvem com repertório e Modo Ao Vivo com até 4 aparelhos.',
  studio: '150 separações por mês, tudo do Pro, Modo Ao Vivo sem limite de aparelhos e a banda controla loop e seções pelo celular.',
} as const

export interface PageHead {
  path: string
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  noindex?: boolean
}

export const PAGE_HEADS: Record<'home' | 'download' | 'admin', PageHead> = {
  home: {
    path: '/',
    title: 'Playback Studio: multitracks de qualquer música pra igreja',
    description:
      'Separação de faixas com IA pra banda da igreja. Transforme qualquer música em multitracks pro VS, com mixer, tom, click e voz guia. Comece grátis no Livre.',
    ogTitle: 'Playback Studio: multitracks de qualquer música pra igreja',
    ogDescription:
      'Separe qualquer música em multitracks pro VS da igreja, com mixer, tom, click e voz guia. Comece grátis.',
  },
  download: {
    path: '/download',
    title: 'Baixar o Playback Studio pra Mac, Windows e celular',
    description:
      'Baixe o app de multitracks pra Mac (Apple Silicon e Intel) e Windows, com Modo Ao Vivo e uso sem internet, ou instale no celular e no tablet.',
    ogTitle: 'Baixar o Playback Studio pra Mac, Windows e celular',
    ogDescription:
      'App de multitracks pra Mac e Windows, com Modo Ao Vivo e uso sem internet. No celular e no tablet, instale na tela de início.',
  },
  admin: {
    path: '/admin',
    title: 'Painel · Playback Studio',
    description: 'Painel interno do Playback Studio.',
    ogTitle: 'Painel · Playback Studio',
    ogDescription: 'Painel interno do Playback Studio.',
    noindex: true,
  },
}

export interface Faq {
  q: string
  a: string
}

// Perguntas da landing. O mesmo texto vai pro JSON-LD (FAQPage), então a resposta é texto puro.
export const FAQS: Faq[] = [
  {
    q: 'O que é separação de faixas?',
    a: 'São as faixas individuais de uma música, também chamadas de multitracks ou stems: a voz separada, a bateria separada, o baixo separado e assim por diante. Com o Playback Studio você sobe qualquer música e recebe as faixas separadas pra banda ensaiar e tocar como precisa.',
  },
  {
    q: 'Dá pra montar o VS da igreja com o Playback Studio?',
    a: 'Dá. VS é como muita igreja chama o playback com as faixas separadas, o click e a guia. No Livre você separa em 2 faixas (voz e instrumental) pra experimentar. Nos planos Pro e Studio você separa em até 6 faixas, a IA detecta o BPM pro click, a voz guia sai falada em português e dá pra mudar o tom pro alcance de quem canta.',
  },
  {
    q: 'Dá pra repetir uma parte da música ao vivo?',
    a: 'Dá, nos planos Pro e Studio. Você marca as seções (intro, verso, refrão, ponte) e, na hora do louvor, repete um trecho quantas vezes quiser ou deixa em loop até decidir seguir. A volta acontece no fim da parte, sem cortar a música no meio.',
  },
  {
    q: 'A banda consegue acompanhar pelo celular?',
    a: 'Sim, no Modo Ao Vivo, que abre pelo app de computador (Mac ou Windows). Cada músico aponta o celular pro QR Code e acompanha a música, o tom e a letra em tempo real, sem instalar nada. No Pro entram até 4 aparelhos. No Studio não tem limite, e a banda ainda controla as repetições e as seções pelo celular.',
  },
  {
    q: 'Como funciona a separação?',
    a: 'Você sobe a música em MP3, WAV ou AAC. A IA do Playback Studio separa em até 6 faixas (voz, bateria, baixo, guitarra, piano e os outros instrumentos) em alguns minutos. No Livre a separação é em 2 faixas, voz e instrumental. As faixas abrem no mixer, e o download em WAV ou MP3 vem nos planos Pro e Studio.',
  },
  {
    q: 'Qual a diferença pra um catálogo de multitracks?',
    a: 'Catálogo te dá só as músicas que já foram licenciadas, e você espera o lançamento sair. O Playback Studio é uma ferramenta: você sobe qualquer música e ela vira multitracks em alguns minutos. Worship, gospel, sertanejo, MPB, rock, indie, até a música autoral da sua banda. Você cria o que precisa, não espera o que existe.',
  },
  {
    q: 'Funciona no celular?',
    a: 'Sim. Dá pra usar no navegador do celular ou instalar na tela de início do iPhone, do iPad e do Android, e ele abre como app. O Modo Ao Vivo e o uso sem internet ficam no app de computador. O passo a passo está na página Baixar app.',
  },
  {
    q: 'Posso usar ao vivo no palco?',
    a: 'Pode, foi feito pra isso. No app de computador (Mac e Windows), depois de carregar as músicas, o player e o mixer tocam sem internet, com controle de cada canal em tempo real. No navegador e no celular, o app precisa de conexão.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: `Sim, sem fidelidade. Por enquanto o cancelamento é feito pelo nosso atendimento: chame no WhatsApp ${CONTACT.whatsappDisplay} ou mande um email pra ${CONTACT.email} pedindo o cancelamento. As regras estão na página Cancelamento, no rodapé do site.`,
  },
]
