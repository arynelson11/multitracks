// Dados das páginas do Separador no verificador (Parte 3, faixa D): o pior caso de texto em
// "Minhas separações" (nomes e artistas longos, uma sem nome, uma com 7 faixas). Nada daqui entra no app.
import type { SavedSeparation } from '../../src/hooks/useSeparationLibrary'

const COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981', '#ec4899', '#e2e8f0']
const NAMES = ['Vocais', 'Bateria', 'Baixo', 'Guitarra', 'Piano/TeCL', 'Outros/Fx', 'Metrônomo']
const stems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: NAMES[i], url: `https://r2/s${i}.wav`, color: COLORS[i] }))
const day = (d: number) => Date.UTC(2026, 10, d, 15)

export const SEPARATIONS: SavedSeparation[] = [
  { id: 'v1', songName: 'Grande é o Senhor (Ao Vivo no Ministério de Louvor com Nome Bem Comprido)', artist: 'Ministério de Louvor Diante do Trono e Convidados Especiais', bpm: '72.5', songKey: 'G#', stems: stems(7), voiceCues: [], createdAt: day(18) },
  { id: 'v2', songName: '', artist: '', bpm: '120', songKey: 'C', stems: stems(2), voiceCues: [], createdAt: day(17) },
  { id: 'v3', songName: 'Águas Purificadoras', artist: 'Hillsong', bpm: '68', songKey: 'D', stems: stems(4), voiceCues: [], createdAt: day(12) },
  { id: 'v4', songName: 'Ousado Amor', artist: 'Isaías Saad', bpm: '120', songKey: 'A#', stems: stems(6), voiceCues: [], createdAt: day(9) },
  { id: 'v5', songName: 'Te Louvarei com Todo o Meu Coração e Toda a Minha Alma Para Sempre', artist: 'Comunidade Evangélica Internacional da Zona Sul', bpm: '140', songKey: 'F#', stems: stems(6), voiceCues: [], createdAt: day(3) },
  { id: 'v6', songName: 'Santo', artist: '', bpm: '96', songKey: 'C', stems: stems(4), voiceCues: [], createdAt: Date.UTC(2026, 9, 28, 15) },
]
