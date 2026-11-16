import type { StageSong } from '../../lib/stageContracts'
import { cx } from '../ui'
import { Icon } from './icons'

export interface SongCellProps { song: StageSong | null; onPrev(): void; onNext(): void }

const END = 'Fim do repertório'

// v5 .c-song: capa à esquerda e o texto ao lado. A célula é medida pela faixa (data-fit-height):
// se título, artista e A SEGUIR não couberem na altura, todos descem um tamanho. Nada corta.
const CELL = 'group/fit relative flex min-w-0 flex-row items-center gap-3.5 px-4 py-3'
// v5 .art: lado = min(altura da faixa - 40 px, 132 px, 8,4% da tela), então entre 1024 e 1279 a capa fica menor.
// Sem capa, o título em cima de um fundo musgo (sem esconder o que passa: a capa não corta texto).
const ART =
  'relative flex size-[min(calc(var(--ps-mid-h,168px)_-_40px),132px,8.4vw)] shrink-0 items-end rounded-ps-lg bg-[linear-gradient(135deg,var(--color-ps-moss),var(--color-ps-s2))] p-[9px] text-ps-micro leading-[1.2] font-extrabold tracking-[0.06em] break-words text-ps-bone uppercase shadow-[inset_0_0_0_1px_var(--color-ps-line),0_8px_20px_color-mix(in_srgb,var(--color-ps-ink-0)_70%,transparent)]'
// v5 .nbtn: 44 px de altura; o A SEGUIR cresce até 300 px e quebra o nome em linhas em vez de cortar.
const NAV =
  'inline-flex min-h-ps-touch items-center rounded-ps-md bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2 transition-[box-shadow,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'

/**
 * Música da faixa do meio (mockup v5): capa (ou o título em cima do fundo), "Música N de T" com o
 * nome do repertório (só a partir de 1700 px, v6), título, artista, anterior e "A SEGUIR" com a
 * próxima ("Fim do repertório", desabilitado, na última). `song.position` conta a partir de 1.
 * O anterior fica ativo na primeira música: lá o motor volta pro começo dela.
 */
export function SongCell({ song, onPrev, onNext }: SongCellProps) {
  const next = song?.nextName ?? null
  const showPosition = song !== null && song.total >= 1 && song.position >= 1
  return (
    <div data-cell="musica" data-fit-height="" className={CELL}>
      <div data-cover="" className={ART}>
        {song?.coverImage ? <img src={song.coverImage} alt="" className="absolute inset-0 size-full rounded-ps-lg object-cover" /> : song?.name}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {showPosition && (
          <span className="text-ps-label leading-tight font-bold tracking-[0.14em] break-words text-ps-mut uppercase">
            <b className="whitespace-nowrap text-ps-or">Música {song.position} de {song.total}</b>
            {song.repertoireName && <span data-repertoire-name="" className="hidden min-[1700px]:inline"> · {song.repertoireName}</span>}
          </span>
        )}
        <strong
          data-song-title=""
          className="mt-[3px] text-[clamp(20px,2.6vh,26px)] leading-[1.15] font-bold tracking-[-0.01em] break-words text-ps-bone group-data-[fit=small]/fit:text-ps-md"
        >
          {song ? song.name : 'Nenhuma música'}
        </strong>
        {song?.artist && <span className="text-ps-base leading-tight break-words text-ps-mut group-data-[fit=small]/fit:text-ps-sm">{song.artist}</span>}
        <div className="mt-[9px] flex gap-1.5">
          <button
            type="button" aria-label="Música anterior" disabled={song === null} onClick={() => onPrev()}
            title={song?.prevName ? `Música anterior: ${song.prevName}` : 'Volta pro começo da música'}
            className={cx(NAV, 'min-w-ps-touch shrink-0 justify-center')}
          >
            <Icon name="prev" className="size-[18px]" />
          </button>
          <button
            type="button" disabled={next === null} onClick={() => onNext()}
            aria-label={next !== null ? `Próxima música: ${next}` : END} title={next !== null ? 'Próxima música' : END}
            className={cx(NAV, 'min-w-auto max-w-[300px] grow justify-start gap-[7px] px-2.5 py-1.5 text-left')}
          >
            <Icon name="next" className="size-[18px]" />
            <span className="flex min-w-0 flex-col gap-px">
              <small className="text-[9px] leading-tight font-extrabold tracking-[0.14em] text-ps-mut">A SEGUIR</small>
              <b className="text-ps-base leading-tight font-semibold break-words group-data-[fit=small]/fit:text-ps-sm">{next ?? END}</b>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
