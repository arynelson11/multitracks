import { useState } from 'react'
import {
  Download, Apple, Monitor, ArrowLeft, ShieldCheck,
  Sliders, Wand2, WifiOff, Radio, Smartphone, FileText, Music4, Keyboard,
} from 'lucide-react'
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'

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
  { icon: Keyboard, title: 'Tom e click', desc: 'Mude a tonalidade em segundos, com click de levada brasileira e pré-contagem.' },
]

export function DownloadPage() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMac = /Macintosh|Mac OS X/.test(ua)
  const isWin = /Windows/.test(ua)
  const [showHelp, setShowHelp] = useState<'mac' | 'win' | null>(null)

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans">
      {/* Glow de fundo */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 40% at 50% 0%, rgba(249,115,22,0.10) 0%, transparent 70%)' }} />

      <div className="relative max-w-5xl mx-auto px-5 sm:px-8 py-10">
        {/* Topo */}
        <header className="flex items-center justify-between mb-12">
          <a href="/" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </a>
          <PlaybackStudioWordmark size="sm" />
        </header>

        {/* Hero */}
        <div className="text-center mb-12">
          <span className="inline-block px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] font-bold uppercase tracking-widest mb-5">
            App para desktop
          </span>
          <h1 className="font-display font-bold text-4xl sm:text-6xl tracking-tight mb-4">
            Baixe o <span className="text-orange-500 italic">Playback Studio</span>
          </h1>
          <p className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            A plataforma do domingo no seu computador. Toque o repertório offline, conduza a banda
            ao vivo e separe qualquer música em faixas, tudo num app só.
          </p>
        </div>

        {/* Botões de download */}
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-3">
          <DownloadButton
            href={MAC_ARM_URL} icon={<Apple className="w-7 h-7" />}
            platform="Mac" label="Baixar (Apple Silicon)" sub="M1, M2, M3 ou mais novo" highlighted={isMac}
            onHelp={() => setShowHelp('mac')}
          />
          <DownloadButton
            href={MAC_INTEL_URL} icon={<Apple className="w-7 h-7" />}
            platform="Mac" label="Baixar (Intel)" sub="Macs até 2020" highlighted={isMac}
            onHelp={() => setShowHelp('mac')}
          />
          <DownloadButton
            href={WIN_URL} icon={<Monitor className="w-7 h-7" />}
            platform="Windows" label="Baixar (.exe)" sub="Windows 10 ou 11" highlighted={isWin}
            onHelp={() => setShowHelp('win')}
          />
        </div>

        {/* Dica de qual Mac */}
        {isMac && (
          <p className="text-center text-zinc-500 text-xs max-w-2xl mx-auto mb-4">
            Não sabe qual Mac você tem? Menu <strong className="text-zinc-300"></strong> → <strong className="text-zinc-300">Sobre Este Mac</strong>.
            Se aparecer <strong className="text-zinc-300">Apple M1/M2/M3</strong>, use Apple Silicon. Se aparecer <strong className="text-zinc-300">Intel</strong>, use a versão Intel.
          </p>
        )}

        {/* Ajuda de instalação */}
        {showHelp && (
          <div className="max-w-2xl mx-auto mb-6 bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-zinc-300">
            <p className="font-bold text-white mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-orange-400" /> Primeira vez abrindo</p>
            {showHelp === 'mac' ? (
              <p>O app ainda não tem assinatura da Apple, então o Mac pode bloquear o duplo clique.
                Clique com o <strong>botão direito no app</strong> e escolha <strong>Abrir</strong>. Só na primeira vez.</p>
            ) : (
              <p>O Windows pode mostrar um aviso do SmartScreen (app sem certificado ainda).
                Clique em <strong>Mais informações</strong> e depois <strong>Executar assim mesmo</strong>. Só na primeira vez.</p>
            )}
          </div>
        )}

        <p className="text-center text-zinc-600 text-xs mb-16">
          Grátis pra instalar. As funções seguem o seu plano (Livre, Pro ou Studio).
        </p>

        {/* Funcionalidades */}
        <div className="mb-14">
          <h2 className="text-center font-display font-bold text-2xl sm:text-3xl mb-2">Tudo o que o app faz</h2>
          <p className="text-center text-zinc-500 text-sm mb-8">Do ensaio em casa ao culto no domingo.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-orange-500/30 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-3">
                  <f.icon className="w-5 h-5 text-orange-400" />
                </div>
                <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Requisitos */}
        <div className="max-w-2xl mx-auto bg-white/[0.03] border border-white/10 rounded-2xl p-6 mb-12">
          <h3 className="font-semibold text-white mb-3">Requisitos</h3>
          <ul className="text-sm text-zinc-400 space-y-2">
            <li><strong className="text-zinc-200">macOS:</strong> 11 (Big Sur) ou superior.</li>
            <li><strong className="text-zinc-200">Windows:</strong> 10 ou 11 (64 bits).</li>
            <li>Login com a sua conta Playback Studio (a mesma do site).</li>
          </ul>
        </div>

        <footer className="text-center text-zinc-600 text-xs pb-8">
          Playback Studio · A plataforma do domingo
        </footer>
      </div>
    </div>
  )
}

function DownloadButton({ href, icon, platform, label, sub, highlighted, onHelp }: {
  href: string; icon: React.ReactNode; platform: string; label: string; sub: string; highlighted: boolean; onHelp: () => void
}) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col transition-all ${highlighted ? 'bg-orange-500/[0.07] border-orange-500/30' : 'bg-white/[0.03] border-white/10'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="text-white">{icon}</div>
        <div className="min-w-0">
          <p className="font-bold text-white leading-tight">{platform}</p>
          <p className="text-zinc-500 text-xs truncate">{sub}</p>
        </div>
      </div>
      <a
        href={href}
        className="mt-auto w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 text-black font-bold text-[13px] hover:bg-orange-400 active:scale-[0.98] transition-all"
      >
        <Download className="w-4 h-4" /> {label}
      </a>
      <button onClick={onHelp} className="w-full text-center text-[11px] text-zinc-500 hover:text-zinc-300 mt-2 transition-colors">
        Como instalar?
      </button>
    </div>
  )
}
