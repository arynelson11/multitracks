// Teleprompter: a letra da seção atual em tela cheia, pra quem canta ler de longe (botão LETRA do
// palco). Saiu de dentro do App.tsx na Parte 3 (faixa C) sem mudar o que mostra. Não trata tecla
// nenhuma: Espaço, setas e Esc continuam com o palco por baixo (tocar, pular, cancelar o pulo).
import { X } from 'lucide-react'
import { IconButton, ProgressBar } from './ui'

export interface TeleprompterProps {
  /** Nome da música aberta (nulo sem música). */
  songName: string | null
  /** A música tem seções marcadas. */
  hasMarkers: boolean
  /** Seção em que a música está agora (nula antes da primeira). */
  marker: { label: string; color?: string; lyrics?: string } | null
  currentTime: number
  duration: number
  onClose(): void
}

/** Cor da seção sem cor salva: o verde de sempre do teleprompter. */
const DEFAULT_SECTION_COLOR = '#10b981'

export function Teleprompter({ songName, hasMarkers, marker, currentTime, duration, onClose }: TeleprompterProps) {
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0
  const color = marker?.color || DEFAULT_SECTION_COLOR

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ps-ink-0 font-ps-sans text-ps-bone">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ps-line px-ps-gutter py-2">
        <h2 className="ps-label">Teleprompter</h2>
        <IconButton tone="ghost" aria-label="Fechar o teleprompter" icon={<X size={22} />} onClick={onClose} />
      </div>

      {/* my-auto no filho centraliza sem passar do começo da rolagem quando a letra não cabe. */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-ps-gutter py-8 lg:px-16">
        {!hasMarkers ? (
          <p className="my-auto text-center text-ps-lg font-medium text-ps-dim">Nenhuma seção marcada nesta música.</p>
        ) : marker ? (
          <div className="my-auto flex w-full max-w-5xl flex-col items-center gap-6 text-center lg:gap-8">
            {/* Cor da seção vem do dado (a cor que a seção tem no palco). */}
            <span
              className="rounded-ps-pill px-4 py-1.5 text-ps-base font-extrabold uppercase tracking-[0.14em]"
              style={{ color, backgroundColor: `${color}20` }}
            >
              {marker.label}
            </span>
            <h1 className="w-full whitespace-pre-wrap break-words text-4xl leading-tight font-black text-ps-bone sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl">
              {marker.lyrics || '…'}
            </h1>
          </div>
        ) : (
          <p className="my-auto animate-ps-blink text-center text-3xl font-bold text-ps-dim motion-reduce:animate-none">Esperando a próxima seção...</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 px-ps-gutter pb-8 pt-2">
<ProgressBar label="Posição na música" hideLabel value={Math.round(progress)} className="w-full max-w-md" />
        <p className="text-center text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut break-words">{songName || 'Nenhuma música aberta'}</p>
      </div>
    </div>
  )
}
