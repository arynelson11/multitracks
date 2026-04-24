import { useState } from 'react'
import {
  Music, Wand2, Sliders, Mic2, Drumstick, Guitar, Piano,
  Play, Star, ChevronDown, Check, Zap,
  ArrowRight, SlidersHorizontal, FileAudio, MonitorPlay,
  Move, BarChart2, Church, Disc3
} from 'lucide-react'

interface LandingPageProps {
  onEnter: () => void
}

/* ─── Dados ─────────────────────────────── */

const AUDIENCE = [
  { icon: Church,    title: 'Ministérios de Louvor', desc: 'Do ensaio ao culto, controle cada instrumento com precisão profissional no palco.' },
  { icon: Drumstick, title: 'Bateristas',            desc: 'Extraia a bateria de qualquer música, treine em cima e crie backing tracks perfeitos.' },
  { icon: Mic2,      title: 'Vocalistas',            desc: 'Isole a voz, ajuste o tom para seu alcance e pratique com a música do seu jeito.' },
  { icon: Guitar,    title: 'Guitarristas',          desc: 'Separe as guitarras, desacelere solos e domine cada nota no seu ritmo.' },
  { icon: Piano,     title: 'Tecladistas',           desc: 'Isole teclados e pads, ajuste a tonalidade e adicione seus próprios arranjos.' },
  { icon: Disc3,     title: 'Produtores',            desc: 'Separe stems, remixe e construa produções em cima de qualquer referência.' },
]

const FEATURES_PLAYER = [
  { icon: Sliders,           title: 'Mixer Profissional Multicanal',  desc: 'Console completo com volume, mute, solo e pan individuais por instrumento — como um estúdio real.' },
  { icon: BarChart2,         title: 'VU Meters em Tempo Real',        desc: 'Meça os níveis de cada canal com medidores profissionais. Visualize a mix enquanto toca.' },
  { icon: SlidersHorizontal, title: 'Alteração de Tom (Pitch)',       desc: 'Mude o pitch em semitons sem alterar o andamento. Ideal para adaptar à voz do seu cantor.' },
  { icon: Music,             title: 'Metrônomo com IA',               desc: 'Gere click tracks via IA (detecta BPM automaticamente) ou defina manualmente. Precount configurável.' },
  { icon: Move,              title: 'Drag & Drop Intuitivo',          desc: 'Reordene músicas na setlist e canais no mixer arrastando. Workflow rápido e sem atrito.' },
  { icon: MonitorPlay,       title: 'Playlist / Setlist Completa',    desc: 'Monte repertórios completos, importe e exporte em .zip com áudios e configurações salvas.' },
  { icon: FileAudio,         title: 'Biblioteca em Nuvem',            desc: 'Acesse músicas, stems, metadados e marcadores de qualquer dispositivo, a qualquer hora.' },
]

const PLANS = [
  {
    name: 'Gratuito',
    monthly: 0, annual: 0,
    desc: 'Experimente sem compromisso',
    badge: null as string | null,
    highlight: false,
    features: [
      '5 separações de faixas / mês',
      'Player com até 5 músicas',
      'Mixer básico multicanal',
      'Metrônomo manual',
      'Marcadores de seção',
      'Sem biblioteca em nuvem',
    ],
    cta: 'Começar Grátis',
    btnStyle: 'border border-white/20 text-white hover:bg-white/5',
  },
  {
    name: 'Essencial',
    monthly: 19.90, annual: 14.90,
    desc: 'Para músicos e ministros ativos',
    badge: 'Mais Popular',
    highlight: true,
    features: [
      'Separações de faixas ilimitadas',
      'Biblioteca em nuvem (50 músicas)',
      'Mixer profissional completo',
      'VU Meters em tempo real',
      'Alteração de tom (pitch)',
      'Metrônomo com IA + precount',
      'Teleprompter com letras',
      'Pad Synth integrado (9 pads)',
      'Import/Export de repertório (ZIP)',
      'Sincronização entre dispositivos',
    ],
    cta: 'Assinar Essencial',
    btnStyle: 'bg-orange-500 hover:bg-orange-400 text-white',
  },
  {
    name: 'Pro',
    monthly: 34.90, annual: 27.90,
    desc: 'Para equipes e produtores',
    badge: null as string | null,
    highlight: false,
    features: [
      'Tudo do plano Essencial',
      'Biblioteca em nuvem ilimitada',
      'Processamento de IA prioritário',
      'Upload de faixas para biblioteca',
      'Gerenciamento de banda/equipe',
      'Múltiplos repertórios simultâneos',
      'Suporte prioritário via chat',
    ],
    cta: 'Assinar Pro',
    btnStyle: 'border border-purple-500/50 text-purple-300 hover:bg-purple-500/10',
  },
]

const FAQS = [
  { q: 'O que são multitracks / stems?', a: 'Multitracks são as faixas individuais de uma música — bateria separada, baixo separado, vocais separados etc. Com o Playback Studio você controla cada instrumento independentemente: silencia, ajusta volume, muda tom de cada canal.' },
  { q: 'Como funciona a separação de faixas com IA?', a: 'Você carrega qualquer música (MP3, WAV, FLAC, M4A) no Separator Studio. Nossa IA analisa e separa em stems: vocais, bateria, baixo, guitarra, piano e outros elementos. Os stems ficam disponíveis direto no seu mixer para uso imediato.' },
  { q: 'Funciona no celular (iPhone/Android)?', a: 'Sim! É um Progressive Web App otimizado para mobile. Funciona no navegador do iPhone e Android sem instalar nada. A interface se adapta completamente à tela do celular.' },
  { q: 'Posso usar ao vivo no palco?', a: 'Com certeza — foi projetado para isso. Funciona offline após carregar as músicas, com interface de baixa latência, modo teleprompter para letras, precount para entrar no tempo e controle total de cada canal em tempo real.' },
  { q: 'O app funciona offline, sem internet?', a: 'Após carregar as músicas e stems, o player e o mixer funcionam completamente offline. A separação com IA e a sincronização com a nuvem requerem conexão, mas tudo que você já carregou fica disponível mesmo sem internet.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim, sem fidelidade e sem multa. Cancele quando quiser direto pelo painel. O acesso continua até o fim do período pago.' },
]

/* ─── Componente ────────────────────────── */

export function LandingPage({ onEnter }: LandingPageProps) {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-[#070708] text-white overflow-x-hidden">
      <style>{`
        @keyframes bar { 0%,100%{height:20%} 50%{height:100%} }
        .bar-anim { animation: bar 1.1s ease-in-out infinite; }
        .bar-anim:nth-child(2){animation-delay:.14s}
        .bar-anim:nth-child(3){animation-delay:.28s}
        .bar-anim:nth-child(4){animation-delay:.07s}
        .bar-anim:nth-child(5){animation-delay:.21s}
        .bar-anim:nth-child(6){animation-delay:.35s}
        .bar-anim:nth-child(7){animation-delay:.04s}
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        .float { animation: float 5s ease-in-out infinite; }
        .hover-lift { transition: transform .2s, border-color .2s; }
        .hover-lift:hover { transform: translateY(-4px); }
        .tg-orange { background: linear-gradient(135deg,#fb923c,#f97316,#ea580c); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
        .tg-purple { background: linear-gradient(135deg,#c084fc,#a855f7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
        .glow-o { box-shadow: 0 0 80px 15px rgba(249,115,22,.1); }
      `}</style>

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#070708]/80 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center">
              <Music size={13} className="text-orange-400" />
            </div>
            <span className="font-black tracking-[0.15em] uppercase text-[13px]">Playback Studio</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="hidden sm:block text-[13px] text-white/50 hover:text-white px-3 py-1.5 transition-colors cursor-pointer">Entrar</button>
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="text-[13px] bg-orange-500 hover:bg-orange-400 text-white px-5 py-2 rounded-lg font-bold transition-colors cursor-pointer">Cadastre-se</button>
          </div>
        </div>
      </nav>

      {/* ════════ HERO ════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 pt-14 pb-20 overflow-hidden">
        {/* Atmosphere */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-orange-500/[0.05] blur-[130px]" />
          <div className="absolute bottom-0 right-1/4 w-[350px] h-[300px] rounded-full bg-purple-600/[0.05] blur-[100px]" />
          <div className="absolute inset-0 opacity-[0.025]" style={{backgroundImage:'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',backgroundSize:'64px 64px'}} />
        </div>

        <div className="relative text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-orange-500/[0.07] border border-orange-500/20 rounded-full px-4 py-1.5 text-[12px] text-orange-400 font-semibold mb-8 tracking-wide">
            <Zap size={11} className="fill-orange-400" />
            IA + Mixer Profissional — tudo integrado
          </div>

          <h1 className="text-[clamp(2.6rem,8vw,5.8rem)] font-black leading-[1.02] tracking-tight mb-6">
            Tudo o que seu ministério
            <br />
            <span className="tg-orange">precisa para ministrar</span>
            <br />
            com excelência.
          </h1>

          <p className="text-[clamp(.95rem,2vw,1.2rem)] text-white/45 max-w-2xl mx-auto mb-10 leading-relaxed">
            Do ensaio ao culto ao vivo — separe faixas com IA, controle cada instrumento
            com um mixer profissional e eleve sua experiência de adoração.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="flex items-center justify-center gap-2.5 bg-orange-500 hover:bg-orange-400 text-white px-8 py-4 rounded-xl font-bold text-[15px] transition-all hover:scale-[1.03] cursor-pointer">
              <Play size={17} fill="white" /> Comece a criar
            </button>
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="flex items-center justify-center gap-2.5 bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-white px-8 py-4 rounded-xl font-bold text-[15px] transition-all cursor-pointer">
              <Wand2 size={17} className="text-purple-400" /> Veja os recursos
            </button>
          </div>
          <p className="text-[12px] text-white/20 mt-5">Grátis para começar · Sem cartão de crédito</p>
        </div>

        {/* Mixer mockup */}
        <div className="relative mt-16 w-full max-w-3xl mx-auto float">
          <div className="glow-o rounded-2xl overflow-hidden border border-white/[0.09] bg-[#111113]">
            <div className="flex items-center gap-1.5 px-4 h-9 border-b border-white/[0.06] bg-[#0e0e10]">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <span className="ml-auto text-[10px] text-white/15 font-mono tracking-wider">PLAYBACK STUDIO — MIXER AO VIVO</span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-8 gap-2">
                {[
                  {n:'Click',   c:'#94a3b8',h:72},{n:'Vocais',  c:'#06b6d4',h:58},
                  {n:'Bateria', c:'#f59e0b',h:82},{n:'Baixo',   c:'#10b981',h:54},
                  {n:'Guitarra',c:'#ef4444',h:44},{n:'Piano',   c:'#8b5cf6',h:66},
                  {n:'Pad',     c:'#ec4899',h:36},{n:'Master',  c:'#f97316',h:88},
                ].map((ch, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <span className="text-[8px] sm:text-[9px] font-bold truncate w-full text-center" style={{color:ch.c}}>{ch.n}</span>
                    <div className="w-full h-20 bg-black/50 rounded-sm border border-white/[0.04] flex flex-col-reverse overflow-hidden">
                      <div className="w-full" style={{height:`${ch.h}%`,background:`linear-gradient(to top,${ch.c}90,${ch.c}20)`}} />
                    </div>
                    <div className="flex items-end gap-[2px] h-3 w-full px-0.5">
                      {[1,2,3,4,5,6,7].map(j => (
                        <div key={j} className="flex-1 rounded-sm bar-anim" style={{background:ch.c+'60',animationDelay:`${j*.07+i*.05}s`,animationDuration:`${.8+(j%3)*.2}s`}} />
                      ))}
                    </div>
                    <div className="flex gap-1 w-full">
                      <div className="flex-1 h-4 rounded text-[7px] font-bold flex items-center justify-center bg-white/[0.05] text-white/25">M</div>
                      <div className="flex-1 h-4 rounded text-[7px] font-bold flex items-center justify-center bg-white/[0.05] text-white/25">S</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Timeline */}
              <div className="mt-4 pt-3 border-t border-white/[0.05]">
                <div className="h-1 bg-white/[0.07] rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-orange-500 rounded-full" style={{width:'38%'}} />
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-white/25">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5"/></svg>
                  </div>
                  <button onClick={onEnter} className="w-11 h-11 rounded-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center transition-colors cursor-pointer">
                    <Play size={18} fill="white" className="ml-0.5" />
                  </button>
                  <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-white/25">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5"/></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 w-2/3 h-14 bg-orange-500/[0.07] blur-2xl rounded-full" />
        </div>
      </section>

      {/* ════════ STATS ════════ */}
      <section className="py-16 px-5 sm:px-8 border-y border-white/[0.05]">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-4 sm:gap-8 text-center">
          {[
            { n: '10.000+', label: 'Músicos ativos' },
            { n: '500+',    label: 'Ministérios de Louvor' },
            { n: '5.000+',  label: 'Faixas separadas com IA' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-[clamp(1.8rem,5vw,3rem)] font-black text-white leading-none">{s.n}</div>
              <div className="text-[12px] sm:text-[13px] text-white/35 mt-1.5">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════ 2 MÓDULOS ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-white/25 text-[11px] font-bold uppercase tracking-[0.25em] mb-16">Duas ferramentas. Uma plataforma.</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="hover-lift relative bg-gradient-to-br from-orange-500/[0.09] via-orange-500/[0.03] to-transparent border border-orange-500/20 rounded-2xl p-8 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-orange-500/[0.08] blur-3xl" />
              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center mb-5">
                  <Sliders size={20} className="text-orange-400" />
                </div>
                <h3 className="text-xl font-black mb-3">Playback Studio</h3>
                <p className="text-white/40 text-[14px] leading-relaxed mb-5">
                  Motor de multitracks profissional com mixer completo, VU meters, alteração de tom,
                  metrônomo com IA, teleprompter e biblioteca em nuvem.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['Mixer','Pitch','Metrônomo IA','Teleprompter','Nuvem','Pad Synth'].map(t => (
                    <span key={t} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="hover-lift relative bg-gradient-to-br from-purple-500/[0.09] via-purple-500/[0.03] to-transparent border border-purple-500/20 rounded-2xl p-8 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-purple-500/[0.08] blur-3xl" />
              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mb-5">
                  <Wand2 size={20} className="text-purple-400" />
                </div>
                <h3 className="text-xl font-black mb-3">Separação com IA</h3>
                <p className="text-white/40 text-[14px] leading-relaxed mb-5">
                  Upload de qualquer música. Nossa IA separa vocais, bateria, baixo, guitarra
                  e piano em segundos. Salve na nuvem e use direto no mixer.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['Vocais','Bateria','Baixo','Guitarra','Piano','Outros'].map(t => (
                    <span key={t} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ DEMO — Som profissional ════════ */}
      <section className="py-20 px-5 sm:px-8 bg-gradient-to-b from-transparent via-purple-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-[clamp(2rem,5vw,3.5rem)] font-black leading-tight mb-4">
            Som profissional.<br /><span className="tg-purple">Estúdio opcional.</span>
          </h2>
          <p className="text-white/40 text-base sm:text-lg max-w-xl mx-auto mb-12 leading-relaxed">
            Remova vocais, isole stems e transforme qualquer música em um playback customizado.
            Tudo em um só lugar.
          </p>
          {/* Visual demo */}
          <div className="bg-[#0f0f11] border border-white/[0.07] rounded-2xl p-6 sm:p-8 mb-8 text-left">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] text-white/25 font-mono">adoracao_original.mp3</span>
              <span className="flex items-center gap-1.5 text-[11px] text-purple-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse inline-block" />
                IA processando faixas...
              </span>
            </div>
            {/* Waveform */}
            <div className="flex items-center gap-[2px] h-14 mb-6">
              {Array.from({length:90}).map((_,i) => {
                const h = 12 + Math.sin(i*.42)*28 + Math.sin(i*.13)*18 + (i%5===0?16:0)
                return <div key={i} className="flex-1 rounded-sm bg-purple-500/25" style={{height:`${Math.max(6,h)}%`}} />
              })}
            </div>
            {/* Stems grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                {name:'Vocais',  color:'#06b6d4', pct:88},
                {name:'Bateria', color:'#f59e0b', pct:94},
                {name:'Baixo',   color:'#10b981', pct:79},
                {name:'Guitarra',color:'#ef4444', pct:72},
                {name:'Piano',   color:'#8b5cf6', pct:67},
                {name:'Outros',  color:'#ec4899', pct:61},
              ].map((s,i) => (
                <div key={i} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.05] rounded-xl p-3">
                  <div className="w-2 h-7 rounded-full shrink-0" style={{background:s.color+'70'}} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold mb-1" style={{color:s.color}}>{s.name}</div>
                    <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${s.pct}%`,background:s.color}} />
                    </div>
                  </div>
                  <Check size={12} style={{color:s.color}} className="shrink-0" />
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="inline-flex items-center gap-2.5 bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-xl font-bold text-[15px] transition-all hover:scale-[1.03] cursor-pointer">
            <Wand2 size={17} /> Faça o upload da sua faixa
          </button>
        </div>
      </section>

      {/* ════════ FEITO PARA ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-white/25 text-[11px] font-bold uppercase tracking-[0.25em] mb-4">Feito para</p>
            <h2 className="text-[clamp(2rem,5vw,3.2rem)] font-black">Cada músico. Cada contexto.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AUDIENCE.map((a, i) => (
              <div key={i} className="hover-lift group bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-orange-500/20 rounded-2xl p-6 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] group-hover:bg-orange-500/12 flex items-center justify-center mb-4 transition-colors">
                  <a.icon size={20} className="text-white/35 group-hover:text-orange-400 transition-colors" />
                </div>
                <h4 className="font-black text-[15px] mb-2">{a.title}</h4>
                <p className="text-[13px] text-white/38 leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ FEATURES ════════ */}
      <section className="py-24 px-5 sm:px-8 bg-gradient-to-b from-transparent via-white/[0.012] to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-orange-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-4">
              <Sliders size={12} /> Playback Studio
            </div>
            <h2 className="text-[clamp(2rem,5vw,3.2rem)] font-black mb-4">O mixer que o seu palco merece</h2>
            <p className="text-white/35 max-w-lg mx-auto text-[15px] leading-relaxed">
              Controle total sobre cada instrumento. Do ensaio ao show, com qualidade de estúdio profissional.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES_PLAYER.map((f, i) => (
              <div key={i} className="hover-lift group bg-white/[0.02] hover:bg-orange-500/[0.03] border border-white/[0.06] hover:border-orange-500/20 rounded-xl p-5 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 group-hover:bg-orange-500/18 flex items-center justify-center mb-3 transition-colors">
                  <f.icon size={17} className="text-orange-400" />
                </div>
                <h4 className="font-bold text-[14px] mb-1.5">{f.title}</h4>
                <p className="text-[12px] text-white/38 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PAD SYNTH ════════ */}
      <section className="py-14 px-5 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="hover-lift bg-gradient-to-r from-cyan-500/[0.05] to-transparent border border-cyan-500/15 rounded-2xl p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-8">
            <div className="flex-1 text-center sm:text-left">
              <div className="inline-flex items-center gap-2 text-cyan-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">
                <SlidersHorizontal size={12} /> Recurso exclusivo
              </div>
              <h3 className="text-2xl font-black mb-3">Pad Synth Integrado</h3>
              <p className="text-white/38 text-[14px] leading-relaxed">
                9 pads de sintetizador direto na interface. Crie atmosferas e pads suaves
                durante a ministração. Múltiplos conjuntos personalizáveis com controle de volume e modo de execução.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 shrink-0">
              {Array.from({length:9}).map((_,i) => (
                <div key={i} className={`w-12 h-12 rounded-xl border flex items-center justify-center text-[12px] font-black transition-all ${i===4?'bg-cyan-500/25 border-cyan-400/50 text-cyan-300':'bg-white/[0.04] border-white/10 text-white/22 hover:bg-white/[0.07]'}`}>
                  {String.fromCharCode(65+i)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════ PRICING ════════ */}
      <section className="py-24 px-5 sm:px-8" id="precos">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[clamp(2rem,5vw,3.2rem)] font-black mb-3">Planos e Preços</h2>
            <p className="text-white/35 text-[15px] mb-8">Recursos profissionais. Preço justo.</p>
            <div className="inline-flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-xl p-1">
              <button onClick={() => setBilling('monthly')} className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer ${billing==='monthly'?'bg-white/10 text-white':'text-white/40 hover:text-white/60'}`}>Mensal</button>
              <button onClick={() => setBilling('annual')} className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer flex items-center gap-2 ${billing==='annual'?'bg-white/10 text-white':'text-white/40 hover:text-white/60'}`}>
                Anual <span className="text-[10px] font-black text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">−25%</span>
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {PLANS.map((plan, i) => {
              const price = billing === 'annual' ? plan.annual : plan.monthly
              return (
                <div key={i} className={`relative rounded-2xl p-7 flex flex-col border-2 ${plan.highlight ? 'border-orange-500/40 bg-gradient-to-b from-orange-500/[0.07] to-orange-500/[0.02]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                  {plan.badge && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest whitespace-nowrap">
                      {plan.badge}
                    </div>
                  )}
                  <div className="mb-5">
                    <h3 className="font-black text-lg mb-1">{plan.name}</h3>
                    <p className="text-white/35 text-[12px]">{plan.desc}</p>
                  </div>
                  <div className="mb-7">
                    {price === 0 ? (
                      <div className="text-4xl font-black">Grátis</div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-sm text-white/35">R$</span>
                          <span className="text-4xl font-black">{price.toFixed(2).replace('.',',')}</span>
                          <span className="text-white/35 text-sm">/mês</span>
                        </div>
                        {billing === 'annual' && (
                          <p className="text-[11px] text-green-400 mt-1">R$ {(price*12).toFixed(2).replace('.',',')} cobrado anualmente</p>
                        )}
                        {billing === 'monthly' && (
                          <p className="text-[11px] text-white/25 mt-1">ou R$ {plan.annual.toFixed(2).replace('.',',')}/mês no anual</p>
                        )}
                      </>
                    )}
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((feat, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-[12px] text-white/52">
                        <Check size={13} className={`mt-0.5 shrink-0 ${plan.highlight ? 'text-orange-400' : 'text-white/22'}`} />
                        {feat}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => {
                        if (price > 0) {
                            localStorage.setItem('checkoutIntent', `${plan.name.toLowerCase()}_${billing === 'annual' ? 'anual' : 'mensal'}`);
                        } else {
                            localStorage.removeItem('checkoutIntent');
                        }
                        onEnter();
                    }} 
                    className={`w-full py-3 rounded-xl text-[13px] font-bold transition-all cursor-pointer ${plan.btnStyle}`}>
                    {plan.cta}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-center text-[11px] text-white/18 mt-8">Preços em Reais (BRL) · Cancele quando quiser · Sem fidelidade</p>
        </div>
      </section>

      {/* ════════ DEPOIMENTOS ════════ */}
      <section className="py-20 px-5 sm:px-8 bg-gradient-to-b from-transparent via-white/[0.012] to-transparent">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-white/25 text-[11px] font-bold uppercase tracking-[0.25em] mb-4">Aprovado por quem usa</p>
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">
            Músicos que transformaram<br />sua prática com o Playback Studio.
          </h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              {name:'Lucas Ferreira',  role:'Líder de Louvor',    text:'Finalmente um app que tem tudo junto. Separo as faixas com IA, jogo no mixer, ajusto o tom — sem sair do app. Transformou minha ministração.'},
              {name:'Ana Paula Costa', role:'Tecladista & Cantora',text:'O metrônomo com IA detecta o BPM e gera o click track perfeito automaticamente. O teleprompter no palco é genial. Não uso mais nada.'},
              {name:'Rodrigo Melo',    role:'Baterista',           text:'Os marcadores de seção me ajudam a ver toda a estrutura da música em tempo real. E poder silenciar minha faixa na hora H é incrível.'},
            ].map((r,i) => (
              <div key={i} className="hover-lift bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6">
                <div className="flex gap-0.5 mb-4">
                  {[1,2,3,4,5].map(j=><Star key={j} size={12} className="text-orange-400 fill-orange-400"/>)}
                </div>
                <p className="text-[13px] text-white/48 leading-relaxed mb-5">"{r.text}"</p>
                <div>
                  <div className="font-bold text-[13px]">{r.name}</div>
                  <div className="text-[11px] text-white/28">{r.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ MISSÃO ════════ */}
      <section className="py-16 px-5 sm:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-10 sm:p-12">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/25 mb-5">Nossa missão</p>
            <p className="text-[clamp(1.1rem,2.5vw,1.5rem)] font-medium text-white/60 leading-relaxed italic">
              "Atender ministros e músicos do Brasil inteiro, criando recursos que maximizem
              seu tempo para o que realmente importa — a adoração."
            </p>
          </div>
        </div>
      </section>

      {/* ════════ FAQ ════════ */}
      <section className="py-20 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">Perguntas Frequentes</h2>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.02]">
                <button onClick={() => setOpenFaq(openFaq===i?null:i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-white/[0.03] transition-colors">
                  <span className="font-semibold text-[14px] pr-4">{faq.q}</span>
                  <ChevronDown size={15} className={`text-white/28 shrink-0 transition-transform ${openFaq===i?'rotate-180':''}`} />
                </button>
                {openFaq===i && (
                  <div className="px-5 pb-5 pt-4 text-[13px] text-white/42 leading-relaxed border-t border-white/[0.05]">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ CTA FINAL ════════ */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <div className="relative bg-gradient-to-br from-orange-500/[0.07] via-orange-500/[0.03] to-purple-500/[0.05] border border-orange-500/20 rounded-3xl p-12 sm:p-16 overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-36 bg-orange-500/[0.07] blur-3xl rounded-full pointer-events-none" />
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center mx-auto mb-6">
                <Music size={26} className="text-orange-400" />
              </div>
              <h2 className="text-[clamp(1.8rem,5vw,3rem)] font-black mb-4">
                Pronto para ministrar com excelência?
              </h2>
              <p className="text-white/38 text-[15px] leading-relaxed mb-8">
                Comece grátis hoje. Configure seu primeiro repertório em menos de 5 minutos.
              </p>
              <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="inline-flex items-center gap-2.5 bg-orange-500 hover:bg-orange-400 text-white px-9 py-4 rounded-xl font-bold text-[15px] transition-all hover:scale-[1.03] cursor-pointer">
                Começar Grátis Agora <ArrowRight size={18} />
              </button>
              <p className="text-[11px] text-white/18 mt-5">Grátis para sempre no plano básico · Upgrade quando quiser</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer className="border-t border-white/[0.05] py-10 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
              <Music size={12} className="text-orange-400" />
            </div>
            <span className="font-black tracking-[0.15em] uppercase text-[11px] text-white/38">Playback Studio</span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-white/28">
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="hover:text-white/55 transition-colors cursor-pointer">Entrar</button>
            <button onClick={() => { localStorage.removeItem('checkoutIntent'); onEnter(); }} className="hover:text-white/55 transition-colors cursor-pointer">Criar Conta</button>
            <a href="#precos" className="hover:text-white/55 transition-colors">Preços</a>
          </div>
          <p className="text-[11px] text-white/18">© 2025 Playback Studio. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  )
}
