// Página das demais telas da Parte 3 (faixa C) no verificador: cada estado monta uma tela do app
// com o pior caso de texto, por cima do fundo do palco, e o check.ts mede como no palco (texto
// cortado, encostando, alvo de toque e rolagem de lado). Nada daqui entra no app.
import { MetronomeModal } from '../../src/components/MetronomeModal'
import type { Channel } from '../../src/types'
import type { TelaEstado } from './telasEstados'

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

// As peças da página são exportadas só pela regra do react-refresh (arquivo com componente exporta componente).

export function TelaPage({ estado }: { estado: TelaEstado }) {
  return (
    <div className="min-h-dvh bg-ps-ink font-ps-sans text-ps-bone">
      {estado === 'metronomo' && <MetronomeModal isOpen onClose={noop} playlistCurrentSong={SONG} onAddClick={noop} />}
    </div>
  )
}
