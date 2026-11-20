// @vitest-environment jsdom
// Teleprompter ligado no App (junção das faixas B e C da Parte 3): o bloco que vivia dentro do
// App.tsx virou <Teleprompter />. O App inteiro não monta no teste, então a prova tem duas partes:
// 1. o texto do App liga o componente com as mesmas entradas que o bloco antigo lia;
// 2. o bloco antigo (copiado abaixo como estava no App.tsx antes da troca) e o componente, com
//    essas entradas, mostram a mesma letra, a mesma seção (nome e cor), o mesmo progresso e o
//    mesmo nome da música, e fecham do mesmo jeito (o X desliga o modo teleprompter).
// Os textos fixos mudaram de propósito na faixa C (ex.: "Aguardando Seção..." virou "Esperando a
// próxima seção..."): aqui conta em qual caso a tela está, não a frase.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { X } from 'lucide-react'
import { Teleprompter } from './components/Teleprompter'
import type { Marker, Song } from './types'

afterEach(cleanup)

// No jsdom o import.meta.url não é file://: o caminho sai da raiz do repo, como no GuidedTour.test.tsx.
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')

/** As entradas que o App tem na hora de desenhar o teleprompter. */
interface AppState {
  playlist: Song[]
  activeSongIndex: number
  currentMarker: Marker | null
  currentTime: number
  duration: number
  setIsTeleprompterMode: (open: boolean) => void
}

/** O bloco do App.tsx antes da troca, sem mudar uma linha do JSX. */
function OldBlock({ playlist, activeSongIndex, currentMarker, currentTime, duration, setIsTeleprompterMode }: AppState) {
  return (
        <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-4 sm:p-6 border-b border-white/5">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white/50">Teleprompter</h2>
            <button onClick={() => setIsTeleprompterMode(false)} className="p-2 sm:p-3 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-white/80 border border-white/10">
              <X size={24} />
            </button>
          </div>
          {/* Body */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-16 relative">
            {!playlist[activeSongIndex]?.markers || playlist[activeSongIndex].markers!.length === 0 ? (
              <div className="text-text-muted/50 text-xl font-medium tracking-wide">
                Nenhum marcador configurado para esta música.
              </div>
            ) : (
              <div className="w-full max-w-5xl flex flex-col gap-6 lg:gap-8 items-center text-center">
                {currentMarker ? (
                  <>
                    <span
                      className="px-4 py-1.5 rounded-full text-base font-bold tracking-widest uppercase mb-4"
                      style={{ backgroundColor: `${currentMarker.color || '#10b981'}20`, color: currentMarker.color || '#10b981' }}
                    >
                      {currentMarker.label}
                    </span>
                    <h1
                      className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-tight text-white/95"
                      style={{ whiteSpace: 'pre-wrap', textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                    >
                      {currentMarker.lyrics || '…'}
                    </h1>
                  </>
                ) : (
                  <div className="text-text-muted/50 text-3xl font-bold tracking-wide animate-pulse">
                    Aguardando Seção...
                  </div>
                )}
              </div>
            )}
            {/* Mini progress bar */}
            <div className="absolute bottom-8 left-8 right-8 text-center text-text-muted/30 font-mono tracking-widest uppercase text-sm font-bold flex flex-col items-center gap-2">
              <div className="h-1 w-full max-w-md bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-white/20 transition-all duration-75" style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}></div>
              </div>
              {playlist[activeSongIndex]?.name || 'Nenhuma Selecionada'}
            </div>
          </div>
        </div>
  )
}

/** A linha que o App.tsx passou a ter, com as mesmas expressões. */
function NewBlock({ playlist, activeSongIndex, currentMarker, currentTime, duration, setIsTeleprompterMode }: AppState) {
  return <Teleprompter songName={playlist[activeSongIndex]?.name ?? null} hasMarkers={(playlist[activeSongIndex]?.markers?.length ?? 0) > 0} marker={currentMarker ?? null} currentTime={currentTime} duration={duration} onClose={() => setIsTeleprompterMode(false)} />
}

type Caso = 'sem-secoes' | 'esperando' | 'secao'

/** O que a tela mostra: o caso, a seção (nome e cor), a letra, o progresso e o texto inteiro. */
function observe(semSecoes: string, esperando: string, progress: () => number) {
  const text = document.body.textContent ?? ''
  const h1 = document.querySelector('h1')
  const caso: Caso | null = text.includes(semSecoes) ? 'sem-secoes' : text.includes(esperando) ? 'esperando' : h1 ? 'secao' : null
  const selo = h1?.previousElementSibling as HTMLElement | null | undefined
  return { caso, label: selo?.textContent ?? null, color: selo?.style.color ?? null, lyrics: h1?.textContent ?? null, progress: Math.round(progress()), text }
}

function seeOld(state: AppState) {
  const { container } = render(<OldBlock {...state} />)
  const bar = container.querySelector<HTMLElement>('[style*="width"]')
  const seen = observe('Nenhum marcador configurado para esta música.', 'Aguardando Seção...', () => parseFloat(bar?.style.width ?? 'NaN'))
  fireEvent.click(container.querySelector('button')!)
  cleanup()
  return seen
}

function seeNew(state: AppState) {
  const { getByRole } = render(<NewBlock {...state} />)
  const seen = observe('Nenhuma seção marcada nesta música.', 'Esperando a próxima seção...', () => Number(getByRole('progressbar').getAttribute('aria-valuenow')))
  fireEvent.click(getByRole('button', { name: 'Fechar o teleprompter' }))
  cleanup()
  return seen
}

const VERSO: Marker = { id: 'm1', time: 10, label: 'Verso', color: '#FF6B35', lyrics: 'Grande é o Senhor\ne mui digno de louvor' }
const PONTE: Marker = { id: 'm2', time: 40, label: 'Ponte' }
const song = (markers?: Marker[]) => ({ id: 's1', name: 'Grande é o Senhor (Ao Vivo)', channels: [], markers }) as unknown as Song

const CASOS: Array<[string, Omit<AppState, 'setIsTeleprompterMode'>, Caso]> = [
  ['sem música aberta', { playlist: [], activeSongIndex: 0, currentMarker: null, currentTime: 0, duration: 0 }, 'sem-secoes'],
  ['música sem seções', { playlist: [song()], activeSongIndex: 0, currentMarker: null, currentTime: 30, duration: 120 }, 'sem-secoes'],
  ['música com a lista de seções vazia', { playlist: [song([])], activeSongIndex: 0, currentMarker: null, currentTime: 30, duration: 120 }, 'sem-secoes'],
  ['índice fora da lista (a seção do motor não conta)', { playlist: [song([VERSO])], activeSongIndex: 3, currentMarker: VERSO, currentTime: 30, duration: 120 }, 'sem-secoes'],
  ['com seções, antes da primeira', { playlist: [song([VERSO, PONTE])], activeSongIndex: 0, currentMarker: null, currentTime: 5, duration: 120 }, 'esperando'],
  ['na seção com cor e letra', { playlist: [song([VERSO, PONTE])], activeSongIndex: 0, currentMarker: VERSO, currentTime: 30, duration: 120 }, 'secao'],
  ['na seção sem cor e sem letra', { playlist: [song([VERSO, PONTE])], activeSongIndex: 0, currentMarker: PONTE, currentTime: 47.3, duration: 200 }, 'secao'],
]

describe('Teleprompter no App: a ligação', () => {
  it('o App importa o componente e o bloco antigo saiu', () => {
    // Booleanos com mensagem: assim a falha não despeja o App.tsx inteiro.
    expect(/import \{ Teleprompter \} from '\.\/components\/Teleprompter'/.test(app), 'import do Teleprompter no App').toBe(true)
    expect(app.includes('Nenhum marcador configurado para esta música.'), 'texto do bloco antigo no App').toBe(false)
    expect(app.includes('Aguardando Seção...'), 'texto do bloco antigo no App').toBe(false)
    expect(app.match(/isTeleprompterMode &&/g)?.length ?? 0, 'quantos isTeleprompterMode && no App').toBe(1)
  })

  it('o App liga o Teleprompter com as entradas do bloco antigo e o X desliga o modo', () => {
    const linha = '{isTeleprompterMode && <Teleprompter songName={playlist[activeSongIndex]?.name ?? null} hasMarkers={(playlist[activeSongIndex]?.markers?.length ?? 0) > 0} marker={currentMarker ?? null} currentTime={currentTime} duration={duration} onClose={() => setIsTeleprompterMode(false)} />}'
    expect(flat(app).includes(flat(linha)), `no App: ${linha}`).toBe(true)
  })
})

describe('Teleprompter no App: mostra o que o bloco antigo mostrava', () => {
  it.each(CASOS)('%s', (_nome, base, caso) => {
    const oldClose = vi.fn()
    const newClose = vi.fn()
    const antes = seeOld({ ...base, setIsTeleprompterMode: oldClose })
    const depois = seeNew({ ...base, setIsTeleprompterMode: newClose })

    expect(antes.caso).toBe(caso)
    expect(depois.caso).toBe(caso)
    // Mesma seção (nome e cor, com o verde de sempre quando não tem cor) e a mesma letra.
    expect(depois.label).toBe(antes.label)
    expect(depois.color).toBe(antes.color)
    expect(depois.lyrics).toBe(antes.lyrics)
    // O mesmo progresso da música (o novo arredonda pro número inteiro de porcento).
    expect(depois.progress).toBe(antes.progress)
    // O nome da música aberta aparece nos dois.
    const name = base.playlist[base.activeSongIndex]?.name
    if (name) {
      expect(antes.text).toContain(name)
      expect(depois.text).toContain(name)
    }
    // O X fecha do mesmo jeito: desliga o modo teleprompter.
    expect(oldClose.mock.calls).toEqual([[false]])
    expect(newClose.mock.calls).toEqual([[false]])
  })

  it('na seção: a cor e a letra são as da seção atual', () => {
    const seen = seeNew({ playlist: [song([VERSO])], activeSongIndex: 0, currentMarker: VERSO, currentTime: 30, duration: 120, setIsTeleprompterMode: () => {} })
    expect(seen.label).toBe('Verso')
    expect(seen.color).toBe('rgb(255, 107, 53)')
    expect(seen.lyrics).toBe('Grande é o Senhor\ne mui digno de louvor')
    expect(seen.progress).toBe(25)
  })
})
