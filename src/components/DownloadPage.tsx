import { useState } from 'react'
import {
  Download, Apple, Monitor, ArrowLeft, ShieldCheck,
  Sliders, Wand2, WifiOff, Radio, Smartphone, FileText, Music4, Keyboard,
} from 'lucide-react'
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'
import { InstallAppGuide } from './InstallAppGuide'
import { SiteLegalInfo } from './SiteLegalInfo'
import { useFreeZoom } from '../hooks/useFreeZoom'
import { Button, Panel, Tag, cx } from './ui'
import { detectInstallPlatform } from '../hooks/usePWAInstall'

const GH = 'https://github.com/arynelson11/multitracks/releases/latest/download'
const MAC_ARM_URL = `${GH}/Playback-Studio-mac-arm64.dmg`
const MAC_INTEL_URL = `${GH}/Playback-Studio-mac-x64.dmg`
const WIN_URL = `${GH}/Playback-Studio-win.exe`

const FEATURES = [
  { icon: Sliders, title: 'Multitracks profissional', desc: 'Mixer multicanal com faders, mute, solo e pan em cada faixa.' },
  { icon: Wand2, title: 'Separação de faixas com IA', desc: 'Transforme qualquer música em faixas separadas, até 6 ao mesmo tempo.' },
  { icon: WifiOff, title: 'Funciona offline', desc: 'Baixe o repertório e toque no palco sem depender de internet.' },
  { icon: Radio, title: 'Modo Ao Vivo', desc: 'Seu computador vira o centro da sessão. A banda conecta pelo celular e acompanha música, tom, parte e letra.' },
  { icon: Smartphone, title: 'Controle pela banda', desc: 'Os músicos comandam play, repertório, mixer, pads e tom pelo celular, sempre com a sua liberação.' },
  { icon: FileText, title: 'Letra e cifra', desc: 'Busca automática da letra, com versão sincronizada que rola sozinha no tempo da música.' },
  { icon: Music4, title: 'Pads de ambiente', desc: 'Pads em qualquer tom pra sustentar os momentos do louvor.' },
  { icon: Keyboard, title: 'Tom e click', desc: 'Mude o tom em segundos, com click no tempo da música e pré-contagem.' },
]

export function DownloadPage() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  // iPad no Safari se apresenta como Mac: só destaca os instaladores no computador.
  const isMobile = detectInstallPlatform() !== 'desktop'
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isMobile
  const isWin = /Windows/.test(ua)
  const [showHelp, setShowHelp] = useState<'mac' | 'win' | null>(null)
  useFreeZoom()

  // App de celular/tablet = o site instalado na tela de início (PWA).
  const mobileSection = (
    <Panel className="mx-auto mb-12 max-w-3xl p-5 sm:p-7">
      <div className="flex items-center gap-2 mb-2">
        <Smartphone aria-hidden="true" className="size-5 shrink-0 text-ps-mut" />
        <h2 className="text-xl font-bold sm:text-2xl">No celular e no tablet</h2>
      </div>
      <p className="mb-5 text-ps-base leading-relaxed text-ps-mut">
        Instale o Playback Studio na tela de início. Ele abre como app, em tela cheia, com separação de faixas,
        mixer, repertório e pads. O Modo Ao Vivo e o uso sem internet ficam no app de computador.
      </p>
      <InstallAppGuide />
    </Panel>
  )

  return (
    <div className="site-public min-h-screen bg-ps-ink font-ps-sans text-ps-bone">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-ps-lg focus:bg-ps-bone focus:px-4 focus:py-2 focus:font-semibold focus:text-ps-ink">
        Pular para o conteúdo
      </a>
      {/* Glow de fundo */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 40% at 50% 0%, rgba(255,107,53,0.08) 0%, transparent 70%)' }} />

      <div className="relative max-w-5xl mx-auto px-5 sm:px-8 py-10">
        {/* Topo */}
        <header className="flex items-center justify-between mb-12">
          <a href="/" className="inline-flex min-h-ps-touch items-center gap-2 rounded-ps-md px-1 text-ps-base text-ps-mut transition-colors hover:text-ps-bone">
            <ArrowLeft aria-hidden="true" className="size-4" /> Voltar
          </a>
          <PlaybackStudioWordmark size="sm" />
        </header>

        <main id="conteudo" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <div className="text-center mb-12">
          <p className="mb-5"><Tag>COMPUTADOR, CELULAR E TABLET</Tag></p>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight sm:text-6xl">
            Baixe o <span className="italic text-ps-or">Playback Studio</span>
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-ps-mut sm:text-lg">
            A plataforma do domingo onde você estiver. No computador, toque o repertório offline e conduza
            a banda ao vivo. No celular e no tablet, leve tudo no bolso direto da tela de início.
          </p>
        </div>

        {/* No celular/tablet, a instalação dele vem primeiro */}
        {isMobile && mobileSection}

        {/* Botões de download */}
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-3">
          <DownloadButton
            href={MAC_ARM_URL} icon={<Apple className="size-7" />}
            platform="Mac" label="Baixar (Apple Silicon)" sub="M1, M2, M3 ou mais novo" highlighted={isMac}
            onHelp={() => setShowHelp('mac')}
          />
          <DownloadButton
            href={MAC_INTEL_URL} icon={<Apple className="size-7" />}
            platform="Mac" label="Baixar (Intel)" sub="Macs com processador Intel" highlighted={isMac}
            onHelp={() => setShowHelp('mac')}
          />
          <DownloadButton
            href={WIN_URL} icon={<Monitor className="size-7" />}
            platform="Windows" label="Baixar (.exe)" sub="Windows 10 ou 11" highlighted={isWin}
            onHelp={() => setShowHelp('win')}
          />
        </div>

        {/* Dica de qual Mac */}
        {isMac && (
          <p className="mx-auto mb-4 max-w-2xl text-center text-ps-sm text-ps-mut">
            Não sabe qual Mac você tem? <strong className="text-ps-bone">Menu </strong> → <strong className="text-ps-bone">Sobre Este Mac</strong>.
            Se aparecer <strong className="text-ps-bone">Apple M1/M2/M3</strong>, use Apple Silicon. Se aparecer <strong className="text-ps-bone">Intel</strong>, use a versão Intel.
          </p>
        )}

        {/* Ajuda de instalação */}
        {showHelp && (
          <Panel className="mx-auto mb-6 max-w-2xl p-4 text-ps-base text-ps-mut">
            <p className="mb-1 flex items-center gap-2 font-bold text-ps-bone"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" /> Primeira vez abrindo</p>
            {showHelp === 'mac' ? (
              <div className="space-y-4">
                <p>O app ainda não tem certificado pago da Apple (custa caro e estamos começando), então na primeira vez o Mac avisa antes de abrir. <strong className="text-ps-bone">Isso é normal, o app não tem vírus nem nada de errado.</strong> Siga os passos da versão do seu macOS (pra ver qual é: menu Apple, Sobre Este Mac).</p>

                <div>
                  <p className="mb-1 font-bold text-ps-bone">1. Depois de baixar o arquivo</p>
                  <p>Abra o arquivo <strong>.dmg</strong> que baixou (fica na pasta <strong>Downloads</strong>). Vai abrir uma janela: arraste o ícone do <strong>Playback Studio</strong> para cima do ícone da pasta <strong>Applications</strong> ao lado. Pronto, o app já está instalado.</p>
                </div>

                <div>
                  <p className="mb-1 font-bold text-ps-bone">2. Primeira abertura no macOS 14 (Sonoma) ou mais antigo</p>
                  <p>Abra o <strong>Finder</strong> e vá em <strong>Applications</strong> (Aplicativos). Ache o <strong>Playback Studio</strong>. <strong className="text-ps-bone">Não dê duplo clique.</strong> Clique com o <strong>botão direito do mouse</strong> em cima do ícone (no trackpad, clique com dois dedos) e escolha <strong>Abrir</strong> no menu que aparecer. Vai surgir um aviso da Apple perguntando se quer mesmo abrir: clique em <strong>Abrir</strong> de novo. Só precisa fazer isso uma vez, da próxima vez pode dar duplo clique normal.</p>
                </div>

                <div>
                  <p className="mb-1 font-bold text-ps-bone">3. No macOS 15 (Sequoia) ou mais novo, ou se o menu não tiver a opção "Abrir"</p>
                  <p>No macOS 15 o atalho do botão direito não libera mais o app. Dê um duplo clique no <strong>Playback Studio</strong> uma vez e feche o aviso que aparecer. Depois clique no <strong>menu Apple</strong> (o logo da maçã, no canto superior esquerdo da tela) e escolha <strong>Ajustes do Sistema</strong> (em Macs mais antigos chama <strong>Preferências do Sistema</strong>). No menu da esquerda, clique em <strong>Privacidade e Segurança</strong>. Role a página até o final: vai ter uma mensagem parecida com <strong>"Playback Studio" foi bloqueado para proteger o Mac</strong>, com um botão <strong>Abrir Mesmo Assim</strong> do lado. Clique nele, digite a senha do seu Mac se pedir, tente abrir o app de novo e confirme uma última vez.</p>
                </div>

                <div>
                  <p className="mb-1 font-bold text-ps-bone">4. Se aparecer a mensagem "o app está danificado"</p>
                  <p className="mb-1.5">Esse aviso específico não tem botão para liberar direto na tela, mas o app <strong className="text-ps-bone">não está corrompido</strong>: é só o macOS sendo mais rígido em Mac com chip Apple Silicon (M1, M2, M3). Resolve assim, uma vez só:</p>
                  <ol className="list-inside list-decimal space-y-1.5">
                    <li>Abra o app <strong>Terminal</strong> (aperte <kbd className="rounded-ps-xs bg-ps-s3 px-1 py-0.5 font-ps-mono text-ps-sm text-ps-bone">⌘ Espaço</kbd>, digite <strong>Terminal</strong> e aperte Enter).</li>
                    <li>Copie o comando abaixo (clique nele pra selecionar tudo), cole no Terminal e aperte Enter.</li>
                  </ol>
                  <code className="my-2 block overflow-x-auto rounded-ps-md bg-ps-ink-0 px-3 py-2 font-ps-mono text-ps-sm text-ps-bone inset-ring inset-ring-ps-line select-all">
                    xattr -cr "/Applications/Playback Studio.app"
                  </code>
                  <p className="text-ps-sm">Se pedir a senha do seu Mac, digite ela e aperte Enter (é normal a tela não mostrar nenhuma letra enquanto você digita a senha, é assim mesmo no Terminal). Depois disso, abra o Playback Studio normalmente pela pasta Applications: ele nunca mais vai pedir isso de novo.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p>O Windows pode mostrar uma tela azul do <strong>Windows Defender SmartScreen</strong> dizendo que protegeu o PC (o app ainda não tem certificado pago). É normal, não tem vírus.</p>
                <ol className="list-inside list-decimal space-y-1.5">
                  <li>Nessa tela, clique no linkzinho <strong>Mais informações</strong>.</li>
                  <li>Vai aparecer um botão novo, <strong>Executar assim mesmo</strong>. Clique nele.</li>
                </ol>
                <p className="text-ps-sm">Só precisa fazer isso na primeira vez que instalar. Depois é só seguir o instalador normal.</p>
              </div>
            )}
          </Panel>
        )}

        <p className="mb-16 text-center text-ps-sm text-ps-mut">
          Grátis pra instalar. As funções seguem o seu plano (Livre, Pro ou Studio).
        </p>

        {/* No computador, o celular vem depois dos instaladores (com QR code) */}
        {!isMobile && mobileSection}

        {/* Funcionalidades */}
        <div className="mb-14">
          <h2 className="mb-2 text-center text-2xl font-bold sm:text-3xl">Tudo o que o app faz</h2>
          <p className="mb-8 text-center text-ps-base text-ps-mut">Do ensaio em casa ao culto no domingo.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <Panel key={f.title} data-feature="" className="p-5">
                <div className="mb-3 flex size-10 items-center justify-center rounded-ps-lg bg-ps-s2 inset-ring inset-ring-ps-line">
                  <f.icon aria-hidden="true" className="size-5 text-ps-bone" />
                </div>
                <h3 className="mb-1.5 font-bold text-ps-bone">{f.title}</h3>
                <p className="text-ps-base leading-relaxed text-ps-mut">{f.desc}</p>
              </Panel>
            ))}
          </div>
        </div>

        {/* Requisitos */}
        <Panel className="mx-auto mb-12 max-w-2xl p-6">
          <h3 className="mb-3 font-bold text-ps-bone">Requisitos</h3>
          <ul className="space-y-2 text-ps-base text-ps-mut">
            <li><strong className="text-ps-bone">macOS:</strong> 12 (Monterey) ou mais novo.</li>
            <li><strong className="text-ps-bone">Windows:</strong> 10 ou 11 (64 bits).</li>
            <li>Login com a sua conta Playback Studio (a mesma do site).</li>
          </ul>
        </Panel>

        </main>

        <footer className="border-t border-ps-line pb-8 pt-8 text-center text-ps-sm">
          <p className="mb-4 text-ps-mut">Playback Studio · A plataforma do domingo</p>
          <SiteLegalInfo />
        </footer>
      </div>
    </div>
  )
}

function DownloadButton({ href, icon, platform, label, sub, highlighted, onHelp }: {
  href: string; icon: React.ReactNode; platform: string; label: string; sub: string; highlighted: boolean; onHelp: () => void
}) {
  // Cartão do instalador: o do sistema de quem abre fica em destaque pelo anel line-3 e o selo
  // neutro SEU SISTEMA (laranja é ligado; revisão macro BC, BC3-3, decisão do coordenador). O link
  // de baixar tem a cara do Button primary do kit (o kit ainda não tem link com cara de botão).
  return (
    <div
      data-highlighted={highlighted ? 'true' : undefined}
      className={cx('flex flex-col rounded-ps-2xl bg-ps-s1 p-5 inset-ring', highlighted ? 'inset-ring-ps-line-3' : 'inset-ring-ps-line')}
    >
      {highlighted && <Tag className="mb-3 self-start">SEU SISTEMA</Tag>}
      <div className="mb-4 flex items-center gap-3">
        <div aria-hidden="true" className="shrink-0 text-ps-bone">{icon}</div>
        <div className="min-w-0">
          <p className="font-bold leading-tight text-ps-bone">{platform}</p>
          <p className="text-ps-sm text-ps-mut break-words">{sub}</p>
        </div>
      </div>
      <a
        href={href}
        className="mt-auto inline-flex min-h-ps-touch items-center justify-center gap-2 rounded-ps-lg bg-ps-or px-ps-pad-x text-ps-sm font-bold tracking-[0.1em] text-ps-on-or transition-transform duration-150 active:scale-[0.96]"
      >
        <Download aria-hidden="true" className="size-4 shrink-0" /> {label}
      </a>
      <Button tone="ghost" aria-label={`Como instalar no ${platform}`} onClick={onHelp} className="mt-1">
        Como instalar?
      </Button>
    </div>
  )
}
