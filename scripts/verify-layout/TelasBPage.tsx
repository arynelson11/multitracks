// Página das telas da faixa B da Parte 3 no verificador de layout: login (entrar, criar conta,
// recuperar), Criar nova senha e as Configurações abertas, com o pior caso de texto. A conta e as
// configurações vêm das simulações em fakes/ (o vite.config.ts troca os módulos do app). Nada
// daqui entra no app.
import { AuthPage } from '../../src/components/AuthPage'
import { NewPasswordPage } from '../../src/components/NewPasswordPage'
import { SettingsModal } from '../../src/components/SettingsModal'
import type { RecoveryAuthClient } from '../../src/lib/passwordRecovery'
import type { Channel } from '../../src/types'
import type { EstadoB } from './telasB'

const noop = () => {}

const RECOVERY: RecoveryAuthClient = {
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }),
    updateUser: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
  },
}

// Canais com os nomes organizados mais compridos (o nome do arquivo fica no title).
const CHANNELS = [
  { id: 'c1', name: 'click.wav', bus: '1' },
  { id: 'c2', name: 'guia.wav', bus: '1' },
  { id: 'c3', name: 'Percussao Dedilhado Ambiente.wav', bus: '1/2' },
  { id: 'c4', name: 'Guitarra Base Distorcida Dobrada.wav', bus: '2' },
  { id: 'c5', name: 'Teclado Pad Ambiente Atmosfera.wav', bus: '1/2' },
  { id: 'c6', name: 'Backing Vocal Soprano Contralto.wav', bus: '1/2' },
] as unknown as Channel[]

/** As telas da faixa B no estado pedido (as Configurações sempre abertas, como o App abre). */
export function TelasBPage({ estado }: { estado: EstadoB }) {
  if (estado === 'login' || estado === 'criarconta' || estado === 'recuperar') return <AuthPage />
  if (estado === 'novasenha') return <NewPasswordPage client={RECOVERY} onDone={noop} onCancel={noop} />
  return (
    <div className="min-h-dvh bg-ps-ink">
      <SettingsModal
        isOpen
        onClose={noop}
        channels={CHANNELS}
        onSetChannelBus={noop}
        onOpenAdmin={noop}
        onReplayTour={noop}
        maxOutputChannels={2}
        desktopUpdate={{ latestVersion: '1.4.30', url: 'https://playbackstudio.com.br/download' }}
        onInstallUpdate={noop}
      />
    </div>
  )
}

