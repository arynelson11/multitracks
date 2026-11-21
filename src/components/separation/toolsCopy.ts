// Textos das ferramentas da separação (BPM e click, voz guia, publicar na nuvem), usadas no
// Separador de reserva e no painel SEPARAÇÃO do palco (Parte 3). As palavras são as de hoje; o que
// aparecia em caixa alta só pelo CSS vira caixa de frase. "Cues" virou "Marcações".

export const PAUSE_TO_USE = 'Pare a música pra usar'

// O que denuncia um motivo técnico (sep-2 M2): código HTTP, rede, servidor, banco ou inglês.
const TECHNICAL = /\bHTTP\b|\b[1-5]\d\d\b|fetch|network|server|failed|unable|error|exception|undefined|\bnull\b|json|token|timeout|abort|decode|cors|violates|policy|row-level|permission denied|supabase|replicate|\bthe\b|\bto\b|\bof\b|\bnot\b/i

/** O motivo do erro, se ele é uma frase pra quem usa; senão nulo (quem chama mostra a frase de reserva). */
export function friendlyReason(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text || TECHNICAL.test(text)) return null
  return text
}

export const KEYS: readonly string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const BPM_COPY = {
  title: 'BPM',
  minus: 'Diminuir o BPM',
  plus: 'Aumentar o BPM',
  field: 'BPM',
  tap: 'Tap tempo',
  double: '2×',
  half: '½×',
  doubleLabel: 'Dobrar o BPM',
  halfLabel: 'Metade do BPM',
  detect: 'Detectar BPM da música',
  detecting: 'Analisando a música...',
  detectTitle: 'Mede o BPM exato na bateria da música',
  detectLocked: 'Detecção de BPM disponível nos planos pagos',
  meter: 'Compasso',
  accent: 'Acentuar tempo 1',
  moveOne: 'Mover o "1"',
  moveOneTitle: 'Use se o acento do click cair no tempo errado do compasso',
  moveOneBack: 'Mover o 1 um tempo pra trás',
  moveOneForward: 'Mover o 1 um tempo pra frente',
  sound: 'Som do click',
  subdivision: 'Subdivisão',
  generating: (type: string) => `Gerando click ${type}...`,
  generate: (type: string, meter: string, sub: string) => `Gerar click · ${type} ${meter} ${sub}`,
  note: 'O click é alinhado sozinho à bateria da música. Se precisar, ajuste fino no SYNC da barra.',
  noteWithSync: 'O click é alinhado sozinho à bateria da música. Se precisar, ajuste fino no SYNC.',
  sync: 'SYNC',
  syncTitle: 'Ajuste fino do click: < adianta, > atrasa (10 ms por toque)',
  syncOff: 'Gere o click no BPM pra usar o ajuste fino',
  syncEarlier: 'Adiantar o click 10 ms',
  syncLater: 'Atrasar o click 10 ms',
  clickError: 'Não deu pra gerar o click. Tenta de novo.',
} as const

export const VOICE_COPY = {
  title: 'Voz Guia',
  detect: 'Auto-detectar',
  detecting: 'Analisando...',
  detectTitle: 'IA analisa o áudio e detecta seções automaticamente',
  analyzing: 'Analisando estrutura do áudio...',
  analyzingDetail: 'Detectando mudanças de energia e seções',
  playingHint: 'Clique em uma seção para marcar o tempo atual',
  stoppedHint: 'Reproduza a música e clique para carimbar o tempo. Ou use Auto-Detectar.',
  tabs: 'Tipo de marcação',
  sections: 'Seções',
  dynamics: 'Dinâmicas',
  list: (n: number) => `Marcações (${n})`,
  cueTime: (label: string) => `Tempo de ${label}`,
  remove: (label: string) => `Tirar ${label}`,
  clear: 'Limpar todos',
  generate: 'Gerar canal de Voz Guia',
  update: 'Atualizar canal de Voz Guia',
  rendering: 'Gerando canal...',
  pending: 'Marcações novas ainda não estão no canal.',
  note: 'Vira um canal no mixer (igual ao Click). Edite os marcadores e clique de novo para atualizar.',
  needCues: 'Adicione marcadores de voz primeiro.',
  renderError: 'Erro ao gerar canal de voz guia.',
  detectError: (why: string) => {
    const reason = friendlyReason(why)
    return reason ? `Não foi possível analisar a estrutura: ${reason}` : 'Não foi possível analisar a estrutura do áudio. Tente de novo.'
  },
} as const

export const CLOUD_COPY = {
  title: 'Publicar na Nuvem',
  intro: (n: number) => `Salvando projeto multi-faixa de ${n} canais na sua biblioteca.`,
  name: 'Música *',
  namePlaceholder: 'ex: Águas Purificadoras',
  artist: 'Artista',
  artistPlaceholder: 'ex: Hillsong',
  bpm: 'BPM (IA)',
  key: 'Tom',
  cover: 'Imagem de capa (opcional)',
  coverPick: 'Selecionar imagem...',
  global: 'Visibilidade global',
  globalHelp: 'Publicar na Plataforma para todos os usuários.',
  submit: 'Salvar & publicar',
  saving: 'Publicando...',
  done: 'Pronto!',
  progress: 'Publicando na nuvem',
  needName: 'Preencha o Nome da Música.',
  error: (why: string) => {
    const reason = friendlyReason(why)
    return reason ? `Erro ao salvar: ${reason}` : 'Não deu pra salvar agora. Confira a internet e tente de novo.'
  },
} as const

/** Baixar uma faixa que não chegou (a frase de hoje do Separador). */
export const DOWNLOAD_ERROR = 'Erro ao baixar a faixa. Tenta de novo.'

/** Abas da gaveta SEPARAÇÃO do palco. */
export type SeparationTab = 'faixas' | 'voz' | 'bpm'

export const PANEL_COPY = {
  title: 'Separação',
  close: 'Fechar a separação',
  closeTitle: 'Fechar (Esc)',
  tabs: 'Ferramentas da separação',
  tracks: 'Faixas',
  voice: 'Voz guia',
  bpm: 'BPM e click',
  loading: 'Carregando a separação',
  missing: 'Não deu pra ler esta separação em "Minhas separações".',
  format: 'Formato',
  formatLabel: 'Formato de download das faixas',
  download: 'Baixar',
  downloadTitle: (name: string, format: string) => `Baixar ${name} (${format.toUpperCase()})`,
  cloud: 'Salvar na nuvem',
  mine: 'Minhas separações',
} as const
