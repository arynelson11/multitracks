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
  subtitle: 'Separação de faixas com IA',
  // Etapas da separação, faladas pra quem usa (sem nome de serviço nem termo técnico).
  steps: {
    start: 'Preparando a separação de faixas...',
    upload: 'Enviando a música...',
    separating: 'Separando as faixas...',
    waiting: 'Separando as faixas: as multitracks ficam prontas em alguns minutos.',
  },
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

export const PLAYER_COPY = {
  back: 'Voltar',
  subtitle: (channels: number) => `Separador IA · ${channels} CH`,
  format: 'Formato de download das faixas',
  save: 'Salvar',
  saving: 'Salvando',
  saveTitle: 'Salvar tudo na sua biblioteca',
  saved: 'Tudo salvo na biblioteca',
  export: 'Exportar',
  bpm: 'BPM',
  key: 'Tom',
  keyPicker: 'Selecionar tom',
  keyPickerClose: 'Fechar a escolha do tom',
  start: 'Voltar ao início',
  play: 'Tocar',
  pause: 'Pausar',
  end: 'Ir para o fim',
  loopOn: 'Loop ativado',
  loopOff: 'Loop desativado',
  loop: 'Loop',
  voice: 'Voz',
  voiceTitle: 'Voz guia',
  voiceLocked: 'Voz guia disponível nos planos pagos',
  sync: 'SYNC',
  syncTitle: 'Ajuste fino do click: < adianta, > atrasa (10 ms por toque)',
  syncOff: 'Gere o click no BPM pra usar o ajuste fino',
  syncEarlier: 'Adiantar o click 10 ms',
  syncLater: 'Atrasar o click 10 ms',
  master: 'Volume geral',
  mute: 'Mudo',
  solo: 'Solo',
  download: (name: string, format: string) => `Baixar ${name} (${format.toUpperCase()})`,
  downloadLocked: 'Download disponível nos planos pagos',
  downloadError: 'Erro ao baixar a faixa. Tenta de novo.',
  pan: (name: string) => `Pan de ${name}`,
  panTitle: 'Pan (scroll=ajuste, clique=centro)',
  volume: (name: string) => `Volume de ${name}`,
  vol: 'VOL',
  cueTitle: (label: string, time: string) => `${label} · ${time}, arraste para mover`,
  mixer: (channels: number) => `MIXER · ${channels} CH`,
} as const

/** O número do volume ao lado do controle, na conta de hoje ("-∞" no zero). */
export function volumeDb(v: number): string {
  return v === 0 ? '-∞' : (v * 10 - 10).toFixed(1)
}

/** O pan como hoje: C no centro, L ou R com 0 a 50. */
export function panText(pan: number): string {
  return pan === 0 ? 'C' : pan > 0 ? `R${Math.round(Math.abs(pan) * 50)}` : `L${Math.round(Math.abs(pan) * 50)}`
}

/** Rolar no pan anda 0,1 por passo, de -1 a 1, com uma casa (a regra de hoje). */
export function panFromWheel(pan: number, deltaY: number): number {
  return Math.round(Math.max(-1, Math.min(1, pan + (deltaY > 0 ? -0.1 : 0.1))) * 10) / 10
}

/**
 * Altura mínima da faixa do player pra nada cortar (nome que quebra linha e alvos de 44 px):
 * celular em pé (até 639 px de largura) 150, tela baixa (até 560 px de altura) 112, o resto 132.
 */
export function laneFloor(width: number, height: number): number {
  if (width < 640) return 150
  if (height <= 560) return 112
  return 132
}

export const OPENING_COPY = {
  title: 'Abrindo no palco',
  detail: (done: number, total: number) => `Baixando as faixas (${done} de ${total})`,
} as const
