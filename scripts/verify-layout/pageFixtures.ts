// Dados das páginas do Separador no verificador (Parte 3, faixa D): o pior caso de texto em
// "Minhas separações" (nomes e artistas longos, uma sem nome, uma com 7 faixas). Nada daqui entra no app.
import type { SavedSeparation } from '../../src/hooks/useSeparationLibrary'
import type { LibraryEdit, LibraryRow } from '../../src/components/library/libraryRows'

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

/** O player de reserva com a música e as 7 faixas de nome mais longo. */
export const PLAYER_SONG = 'Grande é o Senhor (Ao Vivo no Ministério de Louvor com Nome Bem Comprido)'
export const PLAYER_TRACKS = [
  { id: 'vocals', name: 'Vocais Principais e Backing', color: '#06b6d4' },
  { id: 'drums', name: 'Bateria Acústica Completa', color: '#f59e0b' },
  { id: 'bass', name: 'Baixo Elétrico', color: '#8b5cf6' },
  { id: 'guitar', name: 'Guitarra Base e Solo', color: '#ef4444' },
  { id: 'piano', name: 'Piano/TeCL', color: '#10b981' },
  { id: 'other', name: 'Outros/Fx', color: '#ec4899' },
  { id: 'metronome', name: 'Metrônomo', color: '#e2e8f0' },
]

// ---------- Biblioteca na Nuvem (Parte 3, partes 3 a 5) ----------

const libRow = (id: string, over: Partial<LibraryRow>): LibraryRow => ({
  id, name: 'Águas Purificadoras', artist: 'Hillsong', coverUrl: null, key: 'D', bpm: 68, cached: false,
  state: 'import', progress: '', canEdit: false, remove: null, deleting: false, ...over,
})

/**
 * 8 músicas com o pior caso de texto: nome e artista longos, uma em cada estado do baixar (importar,
 * abrir do cache, baixando com o progresso mais longo, adicionada, sem internet fora do cache), uma
 * sem artista, tom nem BPM, uma do admin com editar e excluir e uma excluindo.
 */
export const LIBRARY_ROWS: LibraryRow[] = [
  libRow('b1', {
    name: 'Grande é o Senhor (Ao Vivo no Ministério de Louvor com Nome Bem Comprido)', artist: 'Ministério de Louvor Diante do Trono e Convidados Especiais',
    key: 'G#m', bpm: 72.5, canEdit: true, remove: 'cloud',
  }),
  libRow('b2', { name: 'Te Louvarei com Todo o Meu Coração e Toda a Minha Alma Para Sempre', artist: 'Comunidade Evangélica Internacional da Zona Sul', key: 'F#', bpm: 140, cached: true, state: 'open', remove: 'device' }),
  libRow('b3', { name: 'Ousado Amor', artist: 'Isaías Saad', key: 'A#', bpm: 120, state: 'downloading', progress: 'Baixando as multitracks: 1024,8 MB (11 de 12)' }),
  libRow('b4', { name: 'Santo', artist: 'Fernandinho', key: 'C', bpm: 96, state: 'added' }),
  libRow('b5', { name: 'Lugar Secreto (Versão Acústica Estendida com Ministração)', artist: 'Gabriela Rocha', key: 'E', bpm: 64.25, state: 'offline' }),
  libRow('b6', { name: 'Música Sem Nome do Ensaio', artist: null, key: null, bpm: undefined }),
  libRow('b7', { name: 'Minha Versão de Ensaio (Domingo à Noite)', artist: 'Banda da Igreja', key: 'Bb', bpm: 88, canEdit: true, remove: 'cloud', cached: true, state: 'open' }),
  libRow('b8', { name: 'Raridade', artist: 'Anderson Freire', key: 'Ab', bpm: 70, canEdit: true, remove: 'cloud', deleting: true }),
]

/** A edição aberta na primeira música, com os valores longos e uma capa escolhida. */
export const LIBRARY_EDIT: LibraryEdit = {
  id: 'b1',
  name: 'Grande é o Senhor (Ao Vivo no Ministério de Louvor com Nome Bem Comprido)',
  artist: 'Ministério de Louvor Diante do Trono e Convidados Especiais',
  bpmText: '72,5', key: 'G#m',
  file: new File(['capa'], 'capa_grande_e_o_senhor_ao_vivo_ministerio_versao_final_2026.png', { type: 'image/png' }),
}

/** A lixeira aberta (inicio-1 M7): o nome de 80 caracteres no texto de antes de "Excluir da nuvem?". */
export const LIBRARY_DELETE_NAME = 'Te Louvarei com Todo o Meu Coração e Toda a Minha Alma (Ao Vivo na Igreja, 2026)'
