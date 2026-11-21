// Página das demais telas da Parte 3 (faixa C) no verificador: cada estado monta uma tela do app
// com o pior caso de texto, por cima do fundo do palco, e o check.ts mede como no palco (texto
// cortado, encostando, alvo de toque e rolagem de lado). Nada daqui entra no app.
import { AdminLogin } from '../../src/admin/AdminLogin'
import { MetronomeModal } from '../../src/components/MetronomeModal'
import { DownloadPage } from '../../src/components/DownloadPage'
import { GuidedTour } from '../../src/components/GuidedTour'
import { LiveModeModal } from '../../src/components/LiveModeModal'
import { LyricsEditor } from '../../src/components/LyricsEditor'
import { PadSetsModal } from '../../src/components/PadSetsModal'
import { Teleprompter } from '../../src/components/Teleprompter'
import { UpdateBanner } from '../../src/components/UpdateBanner'
import { WhatsNewModal } from '../../src/components/WhatsNewModal'
import type { Channel, Song } from '../../src/types'
import type { TelaEstado } from './telasEstados'
import { SeparatorPage } from './pages'

const noop = () => {}

/** Canal com áudio de mentira: o Metrônomo só olha se tem buffer e o nome. */
const fakeChannel = (id: string, name: string) => ({ id, name, buffer: {} }) as unknown as Channel

const SONG = {
  id: 'verificador',
  name: 'Grande é o Senhor (Ao Vivo no Ministério de Louvor com Nome Bem Comprido)',
  duration: 300,
  bpm: 72,
  channels: [fakeChannel('c', 'Click'), fakeChannel('d', 'Bateria'), fakeChannel('b', 'Baixo')],
}

/** Conjuntos de pads com nome e descrição longos (o pior caso da lista). */
const PAD_SETS = [
  { id: 'p1', name: 'Pads de Ministração Profunda Domingo à Noite', description: 'Pads quentes pra ministração, gravados em estúdio com reverb longo e camadas de cordas', base_path: 'p1', created_at: '2026-11-01' },
  { id: 'p2', name: 'Ambiente Suave', description: null, base_path: 'p2', created_at: '2026-11-02' },
  { id: 'p3', name: 'Shimmer Atmosférico com Guitarra Ambiente e Teclado', description: 'Camadas de shimmer', base_path: 'p3', created_at: '2026-11-03' },
]

// O catálogo de pads vem da API: aqui a página responde sozinha (o resto passa direto).
const realFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  String(input).includes('/api/pad-catalog')
    ? Promise.resolve(new Response(JSON.stringify({ sets: PAD_SETS }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    : realFetch(input, init)

/** Música com letra sincronizada, artista e cifra longos (o pior caso do editor de letra). */
const LYRIC_SONG = {
  ...SONG,
  artist: 'Ministério de Louvor Diante do Trono e Convidados Especiais',
  lyrics: 'Grande é o Senhor e mui digno de louvor\nNa cidade do nosso Deus, seu santo monte\nAlegria de toda a terra',
  lyricsSynced: '[00:01.00]Grande é o Senhor',
  chords: 'E              B              C#m        A\nGrande é o Senhor e mui digno de louvor na cidade do nosso Deus, seu santo monte',
} as unknown as Song

const ESTADO = new URLSearchParams(location.search).get('estado')

// Aviso de atualização no app de computador: avisa na hora que existe a versão nova (caso do Mac,
// "Baixar"). Só no estado dele, pra nenhum outro estado ganhar o aviso por cima.
if (ESTADO === 'atualizacao') {
  window.playbackDesktop = {
    onUpdateReady: () => noop,
    onUpdateAvailable: (cb: (info: { version: string }) => void) => { cb({ version: '1.4.30' }); return noop },
    installUpdate: noop,
  } as unknown as Window['playbackDesktop']
}

// Aviso de atualização no site (revisão macro BC, BC3-4): o caso do texto mais longo (66
// caracteres, "Atualizar") e o único que aparece no celular. Simula a versão nova do service worker
// já esperando, com a página controlada por ele.
if (ESTADO === 'atualizacao-web') {
  const registro = { waiting: { postMessage: noop }, addEventListener: noop, update: () => Promise.resolve() }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: {}, addEventListener: noop, removeEventListener: noop, getRegistration: () => Promise.resolve(registro) },
  })
}

// Página de download aberta no celular (revisão macro BC, BC3-4): o ramo do celular (guia de
// instalar no topo, sem o QR code), que o estado download em 390 nunca mede (lá o navegador é o do
// computador).
if (ESTADO === 'download-celular') {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  })
}

/**
 * Passos do tour com alvo: o primeiro (o medido no estado tour) é o de texto mais longo do app, o
 * Atalhos de teclado do palco antigo (revisão macro BC, BC3-4: antes era o do Modo Ao Vivo), e o
 * Modo Ao Vivo vem depois.
 */
const TOUR_ALVO = [
  { target: 'alvo', title: 'Atalhos de teclado', body: 'Espaço toca/pausa. Setas ← → andam 5s na música (com Shift, 1s, pra ajuste fino). Pra marcar uma parte na hora certa, tecle a inicial: I Intro, V Verso, P Pré, R Refrão, B Ponte, F Final.' },
  { target: 'alvo', title: 'Modo Ao Vivo (Host)', body: 'A banda conecta pelo celular (QR Code) e acompanha música, tom, parte e letra. Quem você liberar também repete e volta seções pelo próprio celular. Você decide quem controla.' },
  { title: 'Tudo pronto!', body: 'Agora é com você.' },
]
const TOUR_CENTRO = [{ title: 'Bem-vindo ao Playback Studio', body: 'Vou te mostrar tudo rapidinho. Pode pular quando quiser e rever depois pelo Config.' }, ...TOUR_ALVO]

/** Modo Ao Vivo ligado com endereço longo e três aparelhos (um sem IP, um liberado). */
const LIVE = {
  isOpen: true, onClose: noop, isStarting: false, onStopServer: noop, onToggleDevice: noop, onToggleAll: noop,
  remoteSessionCode: null, onToggleRemote: noop,
  serverUrl: 'http://192.168.100.200:3000/?sessao=palco-principal-da-igreja-batista-central',
  devices: ['192.168.100.201', '', 'fe80::1c2b:3a4d:5e6f:7a8b'], approvedIps: ['192.168.100.201'],
}

/** A banda inteira conectada (revisão macro BC, BC2-I2): com 4 ou mais, o topo do QR saía cortado. */
const BANDA_CHEIA = ['192.168.100.201', '192.168.100.202', '192.168.100.203', '192.168.100.204', 'fe80::1c2b:3a4d:5e6f:7a8b', '192.168.100.206']

// As peças da página são exportadas só pela regra do react-refresh (arquivo com componente exporta componente).

export function TelaPage({ estado }: { estado: TelaEstado }) {
  return (
    <div className="min-h-dvh bg-ps-ink font-ps-sans text-ps-bone">
      {estado === 'metronomo' && <MetronomeModal isOpen onClose={noop} playlistCurrentSong={SONG} onAddClick={noop} />}
      {(estado === 'letra' || estado === 'cifra') && <LyricsEditor song={LYRIC_SONG} onSave={async () => true} onClose={noop} />}
      {estado === 'teleprompter' && (
        <Teleprompter
          songName={SONG.name} hasMarkers currentTime={95} duration={300} onClose={noop}
          marker={{ label: 'Refrão Final Estendido', color: '#FF6B35', lyrics: 'Grande é o Senhor e mui digno de louvor\nNa cidade do nosso Deus, seu santo monte\nAlegria de toda a terra, grande é o Senhor\nEm quem nós temos a vitória' }}
        />
      )}
      {estado === 'teleprompter-vazio' && <Teleprompter songName={null} hasMarkers={false} marker={null} currentTime={0} duration={0} onClose={noop} />}
      {estado === 'novidades' && <WhatsNewModal onClose={noop} />}
      {(estado === 'atualizacao' || estado === 'atualizacao-web') && <UpdateBanner />}
      {estado === 'tour' && (
        <>
          <button type="button" data-tour="alvo" className="absolute left-1/2 top-[30%] min-h-ps-touch -translate-x-1/2 rounded-ps-lg bg-ps-s1 px-ps-pad-x text-ps-sm font-bold text-ps-bone">HOST</button>
          <GuidedTour steps={TOUR_ALVO} onClose={noop} />
        </>
      )}
      {estado === 'tour-centro' && <GuidedTour steps={TOUR_CENTRO} onClose={noop} />}
      {(estado === 'download' || estado === 'download-ajuda' || estado === 'download-celular') && <DownloadPage />}
      {estado === 'aovivo' && <LiveModeModal {...LIVE} serverError={null} />}
      {estado === 'aovivo-cheio' && <LiveModeModal {...LIVE} devices={BANDA_CHEIA} approvedIps={BANDA_CHEIA.slice(0, 2)} serverError={null} />}
      {estado === 'aovivo-erro' && <LiveModeModal {...LIVE} serverUrl={null} serverError="Não deu pra abrir a porta 3000: outro programa está usando (EADDRINUSE)." />}
      {estado === 'adminlogin' && <AdminLogin />}
      {(estado === 'separador-inicio' || estado === 'separador-opcoes' || estado === 'separador-player'
        || estado === 'separador-bpm' || estado === 'separador-voz' || estado === 'separador-publicar') && <SeparatorPage estado={estado} />}
      {(estado === 'padsnuvem' || estado === 'padsnuvem-editar') && (
        <PadSetsModal isOpen onClose={noop} onSelect={noop} selectedPadSet={{ id: 'p2', name: 'Ambiente Suave', base_path: 'p2' }} isAdmin />
      )}
    </div>
  )
}
