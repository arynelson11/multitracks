import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Download, EllipsisVertical, PlusSquare, Share } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { Button } from './ui'

// Passo a passo pra instalar o Playback Studio na tela de início do celular/tablet.
// Muda conforme o aparelho: botão nativo no Android, caminho do Safari no
// iPhone/iPad (que não tem botão de instalar) e QR code no computador.

const SITE_URL = 'https://playbackstudio.com.br'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="ps-num flex size-6 shrink-0 items-center justify-center rounded-full bg-ps-s2 text-ps-sm font-bold text-ps-bone inset-ring inset-ring-ps-line-2">{n}</span>
      <span className="pt-0.5 text-ps-base leading-relaxed text-ps-mut">{children}</span>
    </li>
  )
}

export function InstallAppGuide({ onInstalled }: { onInstalled?: () => void }) {
  const { platform, isInstalled, isDesktopApp, canPrompt, promptInstall } = usePWAInstall()

  if (isInstalled) {
    return (
      <p className="flex items-center gap-2 text-ps-base text-ps-moss-hi">
        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" /> Você já está usando o app instalado.
      </p>
    )
  }

  if (platform === 'android' && canPrompt) {
    return (
      <div className="space-y-3">
        <Button tone="primary" icon={<Download size={18} />} onClick={async () => { if (await promptInstall()) onInstalled?.() }}>
          Instalar app
        </Button>
        <p className="text-ps-sm text-ps-mut">O ícone aparece na tela de início e o app abre em tela cheia, sem a barra do navegador.</p>
      </div>
    )
  }

  if (platform === 'android') {
    return (
      <ol className="space-y-3">
        <Step n={1}>Toque no menu <EllipsisVertical aria-hidden="true" className="inline size-4 align-text-bottom" /> do navegador (canto de cima).</Step>
        <Step n={2}>Escolha <strong className="text-ps-bone">Instalar app</strong> ou <strong className="text-ps-bone">Adicionar à tela inicial</strong>.</Step>
        <Step n={3}>Confirme. O ícone do Playback Studio aparece na tela de início.</Step>
      </ol>
    )
  }

  if (platform === 'ios') {
    return (
      <ol className="space-y-3">
        <Step n={1}>
          Toque no botão <strong className="text-ps-bone">Compartilhar</strong> <Share aria-hidden="true" className="inline size-4 align-text-bottom" /> do
          Safari (embaixo no iPhone, em cima no iPad).
        </Step>
        <Step n={2}>
          Role a lista e toque em <strong className="text-ps-bone">Adicionar à Tela de Início</strong> <PlusSquare aria-hidden="true" className="inline size-4 align-text-bottom" />.
        </Step>
        <Step n={3}>Toque em <strong className="text-ps-bone">Adicionar</strong>. Pronto: abra pelo ícone na tela de início.</Step>
        <li className="pl-9 text-ps-sm text-ps-mut">No app instalado você entra na sua conta uma vez de novo (o iPhone guarda o login separado do Safari).</li>
      </ol>
    )
  }

  // Computador: manda pro celular pelo QR code. No app desktop não faz sentido mostrar.
  if (isDesktopApp) return null
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="shrink-0 rounded-ps-lg bg-white p-3">
        <QRCodeSVG value={SITE_URL} size={120} title="QR code com o endereço do Playback Studio" />
      </div>
      <ol className="space-y-3">
        <Step n={1}>Aponte a câmera do celular ou tablet pro código e abra o site.</Step>
        <Step n={2}>No iPhone/iPad: <strong className="text-ps-bone">Compartilhar</strong>, depois <strong className="text-ps-bone">Adicionar à Tela de Início</strong>.</Step>
        <Step n={3}>No Android: toque em <strong className="text-ps-bone">Instalar app</strong> ou no menu do navegador.</Step>
      </ol>
    </div>
  )
}
