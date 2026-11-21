// Páginas do Separador no verificador (Parte 3, faixa D): as vistas montadas só com props, sem
// Supabase nem motor, com o pior caso de texto. Medidas como as telas da faixa C. Nada daqui entra no app.
import { SeparatorHome } from '../../src/components/separator/SeparatorHome'
import { SeparatorOptions } from '../../src/components/separator/SeparatorOptions'
import { SeparatorPlayerBar } from '../../src/components/separator/SeparatorPlayerBar'
import { SeparatorTrackStrip } from '../../src/components/separator/SeparatorTrackStrip'
import { LIBRARY_EDIT, LIBRARY_ROWS, PLAYER_SONG, PLAYER_TRACKS, SEPARATIONS } from './pageFixtures'
import { LibraryView } from '../../src/components/library/LibraryView'
import { libraryCountText } from '../../src/components/library/libraryRows'
import { INVALID_BPM_MESSAGE } from '../../src/lib/cloudBpm'
import { PricingView } from '../../src/components/pricing/PricingView'
import type { PricingCardView } from '../../src/components/pricing/PricingView'
import { PRICING_PLANS } from '../../src/components/pricing/pricingCatalog'
import { laneFloor } from '../../src/components/separator/separatorCopy'
import { BpmClickEditor } from '../../src/components/separation/BpmClickEditor'
import { CloudSaveForm } from '../../src/components/separation/CloudSaveForm'
import { VoiceGuideEditor } from '../../src/components/separation/VoiceGuideEditor'
import { BPM_COPY, CLOUD_COPY, VOICE_COPY } from '../../src/components/separation/toolsCopy'
import { StageDialog } from '../../src/components/stage/StageDialog'
import { CLOUD_FORM_PROPS } from './fixture'

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

const CUE_LABELS = ['1', '2', '3', '4', 'Intro', 'Verso 1', 'Pré-Refrão', 'Refrão 1', 'Verso 2', 'Pré-Refrão 2', 'Refrão 2', 'Ponte', 'Refrão 3', 'Final']

/** As janelas do Separador de reserva no pior caso, como o Separador abre (revisão sep-2 I5). */
function ToolDialog({ estado }: { estado: 'separador-bpm' | 'separador-voz' | 'separador-publicar' }) {
  if (estado === 'separador-bpm') {
    return (
      <StageDialog open title={BPM_COPY.title} size="sm" onClose={noop}>
        <BpmClickEditor
          bpm="72.5" meter="12/8" accentBeat1 downbeatShift={-2} clickSel={{ type: 'Percussive', subdivision: 'accents' }}
          info="72.48 BPM medido na faixa Bateria Acústica Completa com Pratos." busy={null} hasTracks
          message="Não deu pra gerar o click. Tenta de novo." detectLocked={false}
          onBpm={noop} onBpmBlur={noop} onStep={noop} onTap={noop} onScale={noop} onDetect={noop}
          onMeter={noop} onAccent={noop} onShiftDownbeat={noop} onClickSel={noop} onGenerate={noop}
        />
      </StageDialog>
    )
  }
  if (estado === 'separador-voz') {
    return (
      <StageDialog open title={VOICE_COPY.title} onClose={noop}>
        <VoiceGuideEditor
          cues={CUE_LABELS.map((label, i) => ({ id: `c${i}`, time: i * 17.5, label, file: 'f' }))} tab="sections" playing detecting={false}
          rendering={false} hasChannel pending message="Erro ao gerar canal de voz guia."
          onTab={noop} onAdd={noop} onRemove={noop} onTime={noop} onClear={noop} onDetect={noop} onCommit={noop}
        />
      </StageDialog>
    )
  }
  return <StageDialog open title={CLOUD_COPY.title} onClose={noop}><CloudSaveForm {...CLOUD_FORM_PROPS} /></StageDialog>
}

export function SeparatorPage({ estado }: { estado: 'separador-inicio' | 'separador-opcoes' | 'separador-player' | 'separador-bpm' | 'separador-voz' | 'separador-publicar' }) {
  if (estado === 'separador-bpm' || estado === 'separador-voz' || estado === 'separador-publicar') {
    return (
      <>
        <PlayerPage />
        <ToolDialog estado={estado} />
      </>
    )
  }
  if (estado === 'separador-player') return <PlayerPage />
  if (estado === 'separador-opcoes') return <SeparatorOptions options={[2, 4, 6]} onBack={noop} onChoose={noop} />
  return <SeparatorHome separations={SEPARATIONS} loading={false} onBack={noop} onPickFile={noop} onOpen={noop} onDelete={noop} />
}

/**
 * Biblioteca na Nuvem (Parte 3): a vista com as 8 músicas de pior caso, por cima do fundo do app.
 * Em `biblioteca-editar`, a edição aberta na primeira música, com a frase de erro.
 */
export function LibraryPage({ estado }: { estado: 'biblioteca' | 'biblioteca-editar' }) {
  const editing = estado === 'biblioteca-editar'
  return (
    <LibraryView
      open onClose={noop} onRefresh={noop} query="Senhor" onQuery={noop} tab="platform" onTab={noop}
      loading={false} countText={libraryCountText(LIBRARY_ROWS.length)} emptyText={null}
      message={editing ? INVALID_BPM_MESSAGE : null}
      rows={LIBRARY_ROWS} anyDownloading edit={editing ? LIBRARY_EDIT : null} savingEdit={false}
      onImport={noop} onCancel={noop} onEdit={noop} onEditChange={noop} onEditSave={noop} onEditClose={noop}
      onAskDelete={noop} confirmDelete={null} onConfirmDelete={noop} onCancelDelete={noop}
    />
  )
}

/**
 * Planos (Parte 3): `planos` é quem já paga (Pro Mensal, o plano atual desligado, a linha da troca e o
 * aviso do pagamento aberto no navegador); `planos-oferta` é o Livre com a janela do primeiro mês
 * aberta (R$ 24,90 e R$ 59,90 nos mensais), o Studio Mensal abrindo o pagamento e a frase de erro.
 */
export function PlansPage({ estado }: { estado: 'planos' | 'planos-oferta' }) {
  const oferta = estado === 'planos-oferta'
  const cards: PricingCardView[] = PRICING_PLANS.map((p) => {
    const current = !oferta && p.planKey === 'essencial_mensal'
    const loading = oferta && p.planKey === 'pro_mensal'
    const offerPrice = oferta && p.planKey === 'essencial_mensal' ? 'R$ 24,90' : oferta && p.planKey === 'pro_mensal' ? 'R$ 59,90' : null
    return { ...p, offerPrice, current, loading, disabled: current || loading }
  })
  return (
    <PricingView
      open onClose={noop} switching={!oferta} currentName={oferta ? 'Livre' : 'Pro Mensal'} cards={cards}
      openedExternally={!oferta} pending={null} onConfirmSwitch={noop} onCancelSwitch={noop}
      message={oferta ? 'Não foi possível conectar com o servidor. Confira a internet e tente de novo.' : null}
      onChoose={noop}
    />
  )
}
