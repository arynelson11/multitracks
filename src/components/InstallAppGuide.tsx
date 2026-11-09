import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Download, EllipsisVertical, PlusSquare, Share } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'

// Passo a passo pra instalar o Playback Studio na tela de início do celular/tablet.
// Muda conforme o aparelho: botão nativo no Android, caminho do Safari no
// iPhone/iPad (que não tem botão de instalar) e QR code no computador.

const SITE_URL = 'https://playbackstudio.com.br'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-orange-500/15 border border-orange-500/40 text-orange-400 text-xs font-bold flex items-center justify-center">{n}</span>
      <span className="text-sm text-zinc-300 leading-relaxed pt-0.5">{children}</span>
    </li>
  )
}

export function InstallAppGuide({ onInstalled }: { onInstalled?: () => void }) {
  const { platform, isInstalled, isDesktopApp, canPrompt, promptInstall } = usePWAInstall()

  if (isInstalled) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-400">
        <CheckCircle2 className="w-4 h-4" /> Você já está usando o app instalado.
      </p>
    )
  }

  if (platform === 'android' && canPrompt) {
    return (
      <div className="space-y-3">
        <button
          onClick={async () => { if (await promptInstall()) onInstalled?.() }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-bold transition-colors cursor-pointer"
        >
          <Download className="w-5 h-5" /> Instalar app
        </button>
        <p className="text-xs text-zinc-500">O ícone aparece na tela de início e o app abre em tela cheia, sem a barra do navegador.</p>
      </div>
    )
  }

  if (platform === 'android') {
    return (
      <ol className="space-y-3">
        <Step n={1}>Toque no menu <EllipsisVertical className="inline w-4 h-4 align-text-bottom" /> do navegador (canto de cima).</Step>
        <Step n={2}>Escolha <strong className="text-white">Instalar app</strong> ou <strong className="text-white">Adicionar à tela inicial</strong>.</Step>
        <Step n={3}>Confirme. O ícone do Playback Studio aparece na tela de início.</Step>
      </ol>
    )
  }

  if (platform === 'ios') {
    return (
      <ol className="space-y-3">
        <Step n={1}>
          Toque no botão <strong className="text-white">Compartilhar</strong> <Share className="inline w-4 h-4 align-text-bottom" /> do
          Safari (embaixo no iPhone, em cima no iPad).
        </Step>
        <Step n={2}>
          Role a lista e toque em <strong className="text-white">Adicionar à Tela de Início</strong> <PlusSquare className="inline w-4 h-4 align-text-bottom" />.
        </Step>
        <Step n={3}>Toque em <strong className="text-white">Adicionar</strong>. Pronto: abra pelo ícone na tela de início.</Step>
        <li className="text-xs text-zinc-500 pl-9">No app instalado você entra na sua conta uma vez de novo (o iPhone guarda o login separado do Safari).</li>
      </ol>
    )
  }

  // Computador: manda pro celular pelo QR code. No app desktop não faz sentido mostrar.
  if (isDesktopApp) return null
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="bg-white p-3 rounded-xl shrink-0">
        <QRCodeSVG value={SITE_URL} size={120} />
      </div>
      <ol className="space-y-3">
        <Step n={1}>Aponte a câmera do celular ou tablet pro código e abra o site.</Step>
        <Step n={2}>No iPhone/iPad: <strong className="text-white">Compartilhar</strong>, depois <strong className="text-white">Adicionar à Tela de Início</strong>.</Step>
        <Step n={3}>No Android: toque em <strong className="text-white">Instalar app</strong> ou no menu do navegador.</Step>
      </ol>
    </div>
  )
}
