// Páginas do Separador no verificador (Parte 3, faixa D): as vistas montadas só com props, sem
// Supabase nem motor, com o pior caso de texto. Medidas como as telas da faixa C. Nada daqui entra no app.
import { SeparatorHome } from '../../src/components/separator/SeparatorHome'
import { SeparatorOptions } from '../../src/components/separator/SeparatorOptions'
import { SeparatorPlayerBar } from '../../src/components/separator/SeparatorPlayerBar'
import { SeparatorTrackStrip } from '../../src/components/separator/SeparatorTrackStrip'
import { PLAYER_SONG, PLAYER_TRACKS, SEPARATIONS } from './pageFixtures'
import { laneFloor } from '../../src/components/separator/separatorCopy'

const noop = () => {}

/**
 * Player de reserva: a barra e 7 faixas com os nomes mais longos, como o Separador monta, sem as
 * ondas de verdade (uma onda falsa de largura fixa no lugar do WaveSurfer).
 */
function PlayerPage() {
  // A altura da faixa que o Separador usa com 7 faixas: o piso da tela (as 7 não cabem sem rolar).
  const lane = laneFloor(window.innerWidth, window.innerHeight)
  return (
    <div data-separator-player className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone">
      <SeparatorPlayerBar
        songName={PLAYER_SONG} channels={PLAYER_TRACKS.length} format="mp3" canSave saving={false} bpm="72.5" songKey="G#" keyPickerOpen={false}
        isPlaying isLooping time="12:34" total="15:00" voice={{ count: 14, locked: false }} sync={{ offsetMs: -120, enabled: true, busy: false }}
        masterVolume={0.8}
        onBack={noop} onFormat={noop} onSave={noop} onExport={noop} onOpenBpm={noop} onKeyPicker={noop} onKey={noop}
        onStart={noop} onTogglePlay={noop} onEnd={noop} onToggleLoop={noop} onVoice={noop} onNudge={noop} onMaster={noop}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="z-10 flex w-[220px] shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-ps-line bg-ps-s1 compact:w-[156px] short:w-[184px]">
          <div className="sticky top-0 z-10 flex h-7 shrink-0 items-center border-b border-ps-line bg-ps-ink-0 px-3"><span className="ps-label">MIXER · 7 CH</span></div>
          {PLAYER_TRACKS.map((t, i) => (
            <SeparatorTrackStrip
              key={t.id} index={i} name={t.name} color={t.color} state={{ muted: i === 2, soloed: i === 0, volume: 0.8, pan: i === 1 ? -0.4 : 0 }}
              silenced={i !== 0} height={lane} compact={false} downloading={i === 3} downloadTitle={`Baixar ${t.name} (MP3)`} downloadLocked={false}
              onMute={noop} onSolo={noop} onDownload={noop} onPan={noop} onPanCenter={noop} onVolume={noop}
            />
          ))}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-ps-ink">
          <div className="relative" style={{ width: 1200 }}>
            <div className="sticky top-0 z-30 h-7 border-b border-ps-line bg-ps-ink-0" />
            {PLAYER_TRACKS.map((t) => (
              <div key={t.id} className="border-b border-ps-line" style={{ height: lane, background: `linear-gradient(180deg, ${t.color}40 0%, ${t.color}1f 100%)` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SeparatorPage({ estado }: { estado: 'separador-inicio' | 'separador-opcoes' | 'separador-player' }) {
  if (estado === 'separador-player') return <PlayerPage />
  if (estado === 'separador-opcoes') return <SeparatorOptions options={[2, 4, 6]} onBack={noop} onChoose={noop} />
  return <SeparatorHome separations={SEPARATIONS} loading={false} onBack={noop} onPickFile={noop} onOpen={noop} onDelete={noop} />
}
