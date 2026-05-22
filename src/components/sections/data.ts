import { Mic2, Drumstick, Guitar, Music, Disc3, Church } from 'lucide-react'

export const AUDIENCE = [
  { icon: Church,    title: 'Equipes de adoração',  desc: 'Do ensaio ao culto, qualquer música pronta com a levada na mão.' },
  { icon: Music,     title: 'Bandas em geral',      desc: 'Gospel, sertanejo, MPB, rock, indie. Qualquer ritmo, multitracks prontos pro próximo show.' },
  { icon: Mic2,      title: 'Vocalistas e ministros', desc: 'Voice guide discreto, tonalidade no seu alcance, referência sem inundar o in-ear.' },
  { icon: Guitar,    title: 'Instrumentistas',      desc: 'Multitracks de qualquer música. Guitarra, baixo, teclado, piano pra ensaiar como sua banda toca.' },
  { icon: Drumstick, title: 'Bateristas',           desc: 'Click track no seu jeito, separação que respeita a levada original.' },
  { icon: Disc3,     title: 'Solo e produtores',    desc: 'Construa em cima de qualquer faixa. Separe, remixe, refaça arranjos.' },
]

export interface Plan {
  id: string
  name: string
  monthly: number
  annual: number
  desc: string
  badge: string | null
  highlight: boolean
  features: string[]
  cta: string
}

export const PLANS: Plan[] = [
  {
    id: 'gratuito',
    name: 'Livre',
    monthly: 0, annual: 0,
    desc: 'Pra experimentar e ver se funciona',
    badge: null,
    highlight: false,
    features: [
      '5 separações por mês',
      'Separação em 2 ou 4 faixas',
      'Biblioteca local salva no navegador',
      'Não gasta tokens ao recarregar músicas',
      'Mixer básico multicanal',
    ],
    cta: 'Começar grátis',
  },
  {
    id: 'essencial',
    name: 'Pro',
    monthly: 49.90, annual: 39.90,
    desc: 'Pra equipe que toca toda semana',
    badge: 'Mais escolhido',
    highlight: true,
    features: [
      '50 separações por mês',
      'Separação Avançada (6 faixas)',
      'Pads ambiente completos',
      'Voice guide auto-detector',
      'Click com levada brasileira',
      'Auto-detecção de seções (worship)',
      'Suporte por email',
    ],
    cta: 'Assinar Pro',
  },
  {
    id: 'pro',
    name: 'Studio',
    monthly: 99.90, annual: 79.90,
    desc: 'Pra quem leva isso a sério',
    badge: null,
    highlight: false,
    features: [
      '150 separações por mês',
      'Qualidade máxima (Processamento Avançado)',
      'Tudo do Pro +',
      'Prioridade no processamento',
      'Múltiplos repertórios simultâneos',
      'Acesso antecipado a features',
      'Suporte prioritário',
    ],
    cta: 'Assinar Studio',
  },
]

export const FAQS = [
  {
    q: 'O que são multitracks (ou stems)?',
    a: 'Multitracks (também chamados de stems) são as faixas individuais de uma música. Voz separada, bateria separada, baixo separado, etc. Com o Playback Studio você sobe qualquer música e recebe tudo separado pra sua banda ensaiar e tocar como precisa.'
  },
  {
    q: 'Como funciona a separação de faixas?',
    a: 'Você sobe a música (MP3, WAV ou link). A IA do Playback Studio separa em voz, guitarra, baixo, bateria, piano e pads em alguns minutos. Os multitracks ficam disponíveis pra download, no mixer e pra compartilhar com a equipe.'
  },
  {
    q: 'O Playback Studio serve pra qualquer música?',
    a: 'Sim. Diferente de catálogos licenciados, o Playback Studio não depende de uma biblioteca pré-aprovada. Qualquer música funciona: worship, gospel, sertanejo, MPB, rock, indie, original da banda.'
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

export const TESTIMONIALS = [
  {
    name: 'Lucas Ferreira',
    role: 'Ministro de louvor',
    text: 'Domingo flui agora. A equipe chega afinada porque ensaiou com multitracks de verdade, não com áudio original cheio de voz.',
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
