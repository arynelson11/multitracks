// Textos e contas de exibição das vistas do Separador (Parte 3). As palavras são as de hoje; o que
// aparecia em caixa alta só pelo CSS vira caixa de frase.
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'
import type { StemCount } from '../../lib/plans'

export const HOME_COPY = {
  back: 'Voltar',
  title: 'Separador IA',
  subtitle: 'Motor de Separação Multi-faixa Profissional',
  upload: 'Carregar áudio & iniciar',
  uploadHelp: 'MP3, WAV ou AAC',
  library: 'Minhas separações',
  untitled: 'Sem título',
  emptyTitle: 'Nenhuma separação salva ainda.',
  emptyBody: 'Faça sua primeira separação e ela aparecerá aqui automaticamente.',
  loading: 'Carregando as separações',
  open: 'Abrir',
} as const

/** "1 salva", "N salvas" (hoje era "N salva(s)"). */
export function savedCount(n: number): string {
  return n === 1 ? '1 salva' : `${n} salvas`
}

export const STEM_OPTION_COPY: Record<StemCount, string> = {
  2: 'Vocais, Instrumental',
  4: 'Vocais, Bateria, Baixo, Outros',
  6: 'Vocais, Bateria, Baixo, Guitarra, Piano, Outros',
}

export const OPTIONS_COPY = {
  back: 'Voltar',
  title: 'Separar faixas',
  subtitle: 'Selecione o nível de isolamento de instrumentos desejado',
  basic: 'Separação Básica',
  advanced: 'Separação Avançada',
} as const

export const PROGRESS_COPY = {
  title: 'Analisando Frequências',
  subtitle: 'Motor de IA GPU • Replicate',
  done: (percent: number) => `${percent}% concluído`,
  retry: 'Tentar de novo',
  back: 'Voltar',
} as const

/** Tom (fora o "C", que é o padrão sem valor), BPM (fora o "120") e "N faixas", na regra de hoje. */
export function separationMeta(sep: Pick<SavedSeparation, 'songKey' | 'bpm' | 'stems'>): string[] {
  const out: string[] = []
  if (sep.songKey && sep.songKey !== 'C') out.push(sep.songKey)
  if (sep.bpm && sep.bpm !== '120') out.push(`${sep.bpm} BPM`)
  out.push(`${sep.stems.length} faixas`)
  return out
}

/** A data do cartão, como hoje ("05 de nov."). */
export function separationDate(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
