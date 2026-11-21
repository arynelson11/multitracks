import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense, memo } from 'react'
import { Play, Pause, SkipBack, SkipForward, Music, ListMusic, GripVertical, Edit2, Pencil, Check, Trash2, Loader2, Settings, Plus, FolderOpen, Download, Upload, X, ChevronRight, Cloud, Wand2, Timer, Move, LogOut, Shield, Home, Disc, Repeat, Square, Menu, Server } from 'lucide-react'
const AdminApp = lazy(() => import('./admin/AdminApp'))
// Mesma função a cada render: o InAppAdmin importa de novo com ela no "Tentar de novo".
const loadAdminApp = () => import('./admin/AdminApp')
import { BrandLogo } from './components/BrandLogo'
import { PlayMark } from './components/brand/PlayMark'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePadSynth } from './hooks/usePadSynth'
import { useSamplesLibrary, type SampleItem } from './hooks/useSamplesLibrary'
import { SettingsModal } from './components/SettingsModal'
import { MetronomeModal } from './components/MetronomeModal'
import { LibraryModal } from './components/LibraryModal'
import { AdminModal } from './components/AdminModal'
import { PadSetsModal } from './components/PadSetsModal'
import { LiveModeModal } from './components/LiveModeModal'
import { FollowerView } from './components/FollowerView'
import { AuthPage } from './components/AuthPage'
import { SeparatorStudio } from './components/SeparatorStudio'

import { LandingPage } from './components/LandingPage'
import { DownloadPage } from './components/DownloadPage'
import { GuidedTour, type TourStep } from './components/GuidedTour'
import { WhatsNewModal } from './components/WhatsNewModal'
import { SectionBar, SECTION_SHORTCUTS, colorForSection } from './components/SectionBar'
import { canUseSections, maxLiveDevices, planTier, canBandControlSections, canUseGeneratedClick, canChangeKey, canUsePlatformCatalog, canUseCloudPads, canUseRepertoire } from './lib/plans'
import { useLivre } from './hooks/useLivre'
import { usePlansWhenQuiet } from './hooks/usePlansWhenQuiet'
import { stageSongKey } from './lib/livreRules'
import { nextSongAfter, removalOpensRefusedSong } from './lib/songRemoval'
import { cycleEndMode, shownEndMode, type EndMode } from './lib/autoAdvance'
import { trackAd } from './lib/productEvents'
import { livreLiveLeftText } from './components/livre/adCopy'
import { LimitGate } from './components/livre/LimitGate'
import { AdSlot } from './components/livre/AdSlot'
import { AdminEntryButton, InAppAdmin } from './components/AdminEntryButton'
import { BlockedScreen } from './components/BlockedScreen'
import { shouldShowBlocked } from './lib/profileFlags'
import { usePasswordRecovery } from './hooks/usePasswordRecovery'
import { cancelPasswordRecovery, finishPasswordRecovery } from './lib/passwordRecovery'
import { NewPasswordPage } from './components/NewPasswordPage'
import { keyToSemitone, semitonesBetweenKeys } from './lib/pitchRules'
import { InstallAppBanner } from './components/InstallAppBanner'
import { RenewalNoticeBanner } from './components/RenewalNoticeBanner'
import { AUDIO_FILE_ACCEPT } from './lib/uploadContentType'
import { useDesktopUpdate } from './hooks/useDesktopUpdate'
import { CURRENT_VERSION } from './lib/changelog'
import { KEY_NAMES } from './lib/keyNames'
import { StageShell as StageShellView } from './components/stage/StageShell'
import type { StageShellActions } from './components/stage/StageShell'
import type { PadPanelProps } from './components/stage/PadPanel'
import { RepertoirePanel } from './components/stage/RepertoirePanel'
import { useStageViewport } from './components/stage/useStageViewport'
import { useMixPeaks } from './components/stage/useMixPeaks'
import { buildStageView, liveArmedOf, splitSongName, stageGatesFor } from './components/stage/buildStageView'
import { addSectionAt, nudgeSection as nudgeSectionMarker, removeSection as removeSectionMarker } from './lib/sectionEdit'
import { startAction } from './lib/sectionArm'
import { cloudSongOf } from './lib/cloudMatch'
import { markerIdForSpan, sectionIndexAt } from './lib/songGrid'
import { countState } from './lib/transitionView'
import { FADER_MAX_GAIN } from './lib/faderScale'
import { useSettings } from './contexts/SettingsContext'
import { getCachedSongsList, updateCachedSongMeta } from './lib/offlineCache'
import type { Plays, SongGrid, StageClock, TimeSignature } from './lib/stageContracts'
import type { Song } from './types'

const TOUR_STEPS: TourStep[] = [
  { title: 'Bem-vindo ao Playback Studio', body: 'Vou te mostrar tudo rapidinho. Pode pular quando quiser e rever depois pelo Config.' },
  { target: 'repertorios', title: 'Repertórios', body: 'Monte e gerencie seus repertórios (setlists). Crie um novo, salve em .zip pra fazer backup ou carregue um já pronto.' },
  { target: 'faixas', title: 'Faixas', body: 'Importe faixas do seu computador ou crie uma faixa de metrônomo infinito num BPM à sua escolha.' },
  { target: 'biblioteca', title: 'Biblioteca', body: 'Baixe músicas prontas da nuvem. Depois de baixadas, elas tocam offline no palco, sem internet.' },
  { target: 'metronomo', title: 'Metrônomo', body: 'Click no tempo da música pra banda tocar junto.' },
  { target: 'setlist-area', title: 'Suas músicas', body: 'Aqui ficam as músicas do repertório atual, depois de baixar da nuvem ou importar do computador. Toque numa pra carregar.' },
  { target: 'anotacoes', title: 'Anotações', body: 'Deixe lembretes do culto: ordem das músicas, tons, transições. Fica salvo no seu dispositivo.' },
  { target: 'modos', title: 'Auto, Parar e Fade', body: 'Escolha o que acontece no fim da música: AUTO segue pra próxima, PARAR encerra, FADE baixa o volume nos últimos segundos.' },
  { target: 'play', title: 'Tocar', body: 'O play inicia a música. Use os botões ao lado pra ir pra anterior ou próxima.' },
  { target: 'secoes', title: 'Seções da música', body: 'Marque as partes da música (Intro, Verso, Refrão...). Cada parte vira um bloco colorido na régua. Toque num bloco pra pular direto pra aquela parte.' },
  { target: 'secoes', title: 'Repetir uma parte', body: 'Escolha quantas vezes repetir (Nx) ou ∞ e toque no ↻ da seção. No ao vivo, dá pra estender o refrão sem cortar nada: a repetição entra no fim da parte. O botão Sair encerra o loop.' },
  { target: 'secoes', title: 'Voltar pra uma parte', body: 'O botão ↩ numa seção agenda voltar pra ela no fim da parte atual. Perfeito pra "voltar no refrão" quando o momento pede.' },
  { target: 'secoes', title: 'Atalhos de teclado', body: 'Espaço toca/pausa. Setas ← → andam 5s na música (com Shift, 1s, pra ajuste fino). Pra marcar uma parte na hora certa, tecle a inicial: I Intro, V Verso, P Pré, R Refrão, B Ponte, F Final.' },
  { target: 'mixer', title: 'Mixer das faixas', body: 'Controle volume, mute, solo e pan de cada instrumento separadamente. Cada faixa no seu lugar.' },
  { target: 'pads', title: 'Pads de ambiente', body: 'Toque pads em qualquer tom pra sustentar os momentos do louvor.' },
  { target: 'tom', title: 'Tom', body: 'Transponha a música pro tom que a banda canta, em segundos, sem mudar a velocidade.' },
  { target: 'precontagem', title: 'Pré-contagem', body: 'Liga uma contagem de clicks antes da música começar, pra a banda entrar junto no tempo.' },
  { target: 'editar', title: 'Editar', body: 'Entre no modo de edição pra reordenar faixas e ajustar a sua mesa do jeito que preferir.' },
  { target: 'host', title: 'Modo Ao Vivo (Host)', body: 'A banda conecta pelo celular (QR Code) e acompanha música, tom, parte e letra. Quem você liberar também repete e volta seções pelo próprio celular. Você decide quem controla.' },
  { target: 'inicio', title: 'Início', body: 'Volta pra tela inicial, onde você troca de modo e acessa a Separação de Faixas (transforma qualquer música em faixas separadas).' },
  { target: 'config', title: 'Config', body: 'Ajustes do app, saída de áudio e buses. É aqui também que você reabre este tutorial quando quiser.' },
  { title: 'Tudo pronto!', body: 'Agora é com você. Bom domingo e bom louvor! 🎶' },
]
import { useAuth } from './hooks/useAuth'
import { PricingModal } from './components/PricingModal'
import { supabase, updateSongMarkers as saveMkToCloud, fetchSongs as fetchCloudSongs, updateSong } from './lib/supabase'
import { LyricsEditor } from './components/LyricsEditor'
import { Teleprompter } from './components/Teleprompter'
import { useNetworkStatus } from './hooks/useNetworkStatus'
import { useLiveSync } from './hooks/useLiveSync'
import { buildChannelLabels, FAMILY_COLOR, type ChannelLabel } from './lib/channelNames'
import { channelFaderFill, channelGain, findClickChannel, isSilencedBySolo, pickWaveformChannel, waveformMixChannels } from './lib/channelRoles'
import { ChannelEditPanel } from './components/ChannelEditPanel'
import { ChannelTrashButton } from './components/ChannelTrashButton'
import { useTwoTapConfirm } from './hooks/useTwoTapConfirm'
import { Button } from './components/ui'
import { TextPromptDialog } from './components/TextPromptDialog'
import { endlessMetronomeBpmError, songNameError } from './lib/textPromptRules'

// ───────────────── PALCO NOVO (T29) ─────────────────

/**
 * Tour no palco novo: troca só o que mudou. A lista do repertório e as Anotações ficam no painel
 * REPERTÓRIOS (um passo só, no botão dele, que fica sempre à vista); os 4 passos das seções, o do
 * EDITAR e o do CONFIG falam do palco novo. Os alvos (`data-tour`) vêm das peças do palco.
 */
const NEW_STAGE_SECTION_STEPS: TourStep[] = [
  { target: 'secoes', title: 'Seções da música', body: 'Toque numa seção pra armar: ela termina, conta 1-2-3-4 no click e entra no 1.' },
  { target: 'secoes', title: 'Repetir uma parte', body: 'REPETIR com o número de vezes, ou ∞ e LOOP pra repetir sem parar.' },
  { target: 'secoes', title: 'Cancelar o pulo', body: 'Tocar de novo na seção armada, no X do aviso ou Esc cancela.' },
  { target: 'secoes', title: 'Atalhos de teclado', body: 'Teclas 1 a 9 armam, setas trocam de seção, Shift + setas andam 5 s; marcar seções fica no EDITAR.' },
]
const FIRST_SECTION_STEP = TOUR_STEPS.find((step) => step.target === 'secoes')
const TOUR_STEPS_NEW_STAGE: TourStep[] = TOUR_STEPS.flatMap((step): TourStep[] => {
  if (step.target === 'setlist-area') return [{ target: 'repertorios', title: 'Suas músicas e Anotações', body: 'A lista do repertório e as Anotações ficam no painel REPERTÓRIOS.' }]
  if (step.target === 'anotacoes') return []
  if (step.target === 'secoes') return step === FIRST_SECTION_STEP ? NEW_STAGE_SECTION_STEPS : []
  if (step.target === 'editar') return [{ ...step, body: 'No EDITAR você marca e ajusta as seções e escolhe o compasso da música.' }]
  if (step.target === 'config') return [{ ...step, body: 'Ajustes do app, saídas de áudio (Click e Guia separados da VS) e a chave do palco. É aqui também que você reabre este tutorial.' }]
  return [step]
})

/**
 * Topo do fader do palco antigo (1,2, como na v1.4.16). O palco novo vai até +6 dB (FADER_MAX_GAIN):
 * um volume acima de 1,2 que veio de lá aparece no topo, sem o preenchimento passar do trilho.
 */
const OLD_FADER_MAX = 1.2

/** Resolução da onda grande do palco novo (picos por música; a onda junta por pixel). */
const STAGE_WAVE_BUCKETS = 2048

/**
 * A casca do palco novo só renderiza quando a vista, as ações, os pads ou os painéis mudam: o App
 * renderiza a cada quadro tocando (o `currentTime` do motor), e a botoeira mede os nomes a cada
 * renderização. O que muda a cada quadro (tempo, VU, anel) a casca lê pelo `StageClock`.
 */
const StageShell = memo(StageShellView)

/**
 * Objeto com as mesmas funções de `sample`, estável, que chama sempre a versão de `latest` da
 * renderização mais nova (o App troca as funções a cada renderização; a casca guarda o mesmo objeto).
 */
function delegateTo<T extends object>(sample: T, latest: { readonly current: T }): T {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(sample)) {
    out[key] = (...args: unknown[]) => (latest.current as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args)
  }
  return out as T
}

/** Amostras lidas do analisador de cada canal: uma janela só, reaproveitada a cada quadro. */
const meterWindow = new Float32Array(2048)
/** Pico pós-fader do canal (0 a 1) no quadro de agora, pelo AnalyserNode que o App liga no fader. */
function analyserPeak(analyser: AnalyserNode | undefined): number {
  if (!analyser) return 0
  const n = Math.min(analyser.fftSize, meterWindow.length)
  const view = meterWindow.subarray(0, n)
  analyser.getFloatTimeDomainData(view)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = Math.abs(view[i])
    if (v > peak) peak = v
  }
  return Math.min(1, peak)
}

interface SampleListProps {
  kind: 'samples' | 'loops'; items: readonly SampleItem[]; loading: boolean; activeFolder: string | null; playingUrl: string | null
  onFolder(folder: string | null): void; onPlay(url: string): void
}

/** Lista de SAMPLES ou LOOPS (pastas e arquivos), a mesma nos dois palcos. */
function SampleList({ kind, items, loading, activeFolder, playingUrl, onFolder, onPlay }: SampleListProps) {
  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      </div>
    )
  }
  let content: React.ReactNode
  if (items.length === 0) {
    content = (
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-center h-full">
        {kind === 'samples' ? <Disc size={28} className="text-purple-500/30 mb-3" /> : <Repeat size={28} className="text-cyan-500/30 mb-3" />}
        <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">Nenhum {kind === 'samples' ? 'sample' : 'loop'} encontrado</p>
        <p className="text-[9px] text-text-muted/50 font-mono">Use o Admin para enviar ficheiros</p>
      </div>
    )
  } else if (!activeFolder) {
    const folders = Array.from(new Set(items.map(i => i.folder || 'Sem Categoria')))
    content = folders.map(folder => (
      <button
        key={folder}
        onClick={() => onFolder(folder)}
        className="w-full flex items-center gap-2 px-2.5 py-3 rounded-md border transition-all active:scale-[0.98] cursor-pointer text-left group bg-white/3 border-border hover:bg-white/5 hover:border-white/10 text-text-main"
      >
        <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-white/5 group-hover:bg-white/10 transition-all">
          <FolderOpen size={14} className={kind === 'samples' ? 'text-purple-400' : 'text-cyan-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold truncate font-mono">{folder}</p>
          <p className="text-[9px] text-text-muted font-mono">
            {items.filter(i => (i.folder || 'Sem Categoria') === folder).length} ficheiro(s)
          </p>
        </div>
        <ChevronRight size={14} className="text-text-muted" />
      </button>
    ))
  } else {
    const folderItems = items.filter(i => (i.folder || 'Sem Categoria') === activeFolder)
    content = folderItems.map((item, i) => (
      <button
        key={i}
        onClick={() => onPlay(item.url)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border transition-all active:scale-[0.98] cursor-pointer text-left group
          ${playingUrl === item.url
            ? kind === 'samples'
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
              : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
            : 'bg-white/3 border-border hover:bg-white/5 hover:border-white/10 text-text-main'
          }`}
      >
        {/* Play/Stop icon */}
        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all
          ${playingUrl === item.url
            ? kind === 'samples' ? 'bg-purple-500/20' : 'bg-cyan-500/20'
            : 'bg-white/5 group-hover:bg-white/10'
          }`}>
          {playingUrl === item.url
            ? <Square size={10} className="fill-current" />
            : <Play size={10} className="fill-current ml-0.5" />
          }
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold truncate font-mono">{item.name}</p>
          <p className="text-[8px] text-text-muted/60 font-mono truncate uppercase tracking-wider">{(item.size / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
        {/* Playing indicator */}
        {playingUrl === item.url && (
          <div className="flex gap-0.5 items-end h-3">
            <div className="w-0.5 bg-current rounded-full bar-anim" style={{ animationDelay: '0s', height: '40%' }} />
            <div className="w-0.5 bg-current rounded-full bar-anim" style={{ animationDelay: '0.15s', height: '70%' }} />
            <div className="w-0.5 bg-current rounded-full bar-anim" style={{ animationDelay: '0.3s', height: '50%' }} />
          </div>
        )}
      </button>
    ))
  }
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Folder Navigation Header */}
        {activeFolder && (
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => onFolder(null)} className="p-1 rounded bg-white/5 hover:bg-white/10 text-white transition-all active:scale-95 cursor-pointer">
              <ChevronRight size={14} className="rotate-180" />
            </button>
            <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono truncate">{activeFolder}</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar min-h-0">{content}</div>
      </div>
    </div>
  )
}

// Itens dos menus e diálogos do App no palco novo: alvo de 44 px, texto que acompanha a largura.
const STAGE_MENU_ITEM =
  'flex min-h-ps-touch w-full items-center gap-2.5 rounded-ps-md px-3 text-left text-ps-sm font-semibold text-ps-bone cursor-pointer select-none hover:bg-ps-s2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'

interface StageTracksMenuProps {
  hasSong: boolean; onClose(): void; onImport(files: FileList): void; onMetronome(): void; onRename(): void; onCover(file: File): void
}

/** Menu FAIXAS do palco novo: o de hoje (importar e metrônomo infinito) mais renomear e trocar a capa da música. */
function StageTracksMenu({ hasSong, onClose, onImport, onMetronome, onRename, onCover }: StageTracksMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div role="menu" aria-label="Faixas" className="relative z-50 mt-1 flex w-max max-w-[calc(100vw-32px)] flex-col gap-0.5 rounded-ps-xl bg-ps-pop p-1.5 font-ps-sans shadow-ps-pop inset-ring inset-ring-ps-line-2">
        <label className={STAGE_MENU_ITEM}>
          <Upload size={16} className="shrink-0 text-ps-mut" /> Importar do dispositivo
          <input type="file" multiple accept={AUDIO_FILE_ACCEPT} className="hidden"
            onChange={(e) => { onClose(); if (e.target.files) onImport(e.target.files) }} />
        </label>
        <button type="button" role="menuitem" className={STAGE_MENU_ITEM} onClick={() => { onClose(); onMetronome() }}>
          <Timer size={16} className="shrink-0 text-ps-mut" /> Criar metrônomo (infinito)
        </button>
        {hasSong && (
          <>
            <button type="button" role="menuitem" className={STAGE_MENU_ITEM} onClick={() => { onClose(); onRename() }}>
              <Pencil size={16} className="shrink-0 text-ps-mut" /> Renomear esta música
            </button>
            <label className={STAGE_MENU_ITEM}>
              <Edit2 size={16} className="shrink-0 text-ps-mut" /> Trocar a capa
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; onClose(); if (f) onCover(f) }} />
            </label>
          </>
        )}
      </div>
    </>
  )
}

interface PadSoundsDialogProps {
  custom: { has(note: string): boolean }; names: ReadonlyMap<string, string>; onLoad(note: string, file: File): void; onClear(note: string): void; onClose(): void
}

/** EDITAR dos pads no palco novo: carregar ou tirar o som de cada tom (o que o modo editar do palco antigo fazia). */
function PadSoundsDialog({ custom, names, onLoad, onClear, onClose }: PadSoundsDialogProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog" aria-label="Sons dos pads" onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-ps-xl bg-ps-pop p-4 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-line-2"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="ps-label">Sons dos pads</span>
          <button type="button" aria-label="Fechar" title="Fechar" onClick={onClose}
            className="inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center justify-center rounded-ps-md bg-ps-s2 text-ps-mut hover:text-ps-bone">
            <X size={18} />
          </button>
        </div>
        <p className="text-ps-sm text-ps-mut">Carregue um arquivo de áudio pra um tom, ou tire o som carregado pra voltar ao pad do conjunto.</p>
        <ul className="flex flex-col gap-1.5">
          {KEY_NAMES.map((note) => (
            <li key={note} className="flex flex-wrap items-center gap-2 rounded-ps-md bg-ps-s1 px-3 py-1.5 inset-ring inset-ring-ps-line">
              <span className="ps-num w-9 shrink-0 text-ps-md font-extrabold">{note}</span>
              <span className="min-w-0 flex-1 break-words text-ps-sm text-ps-mut">{custom.has(note) ? (names.get(note) || 'Som carregado') : 'Som do conjunto'}</span>
              <label className="inline-flex min-h-ps-touch min-w-ps-touch shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-ps-md bg-ps-s2 px-3 text-ps-sm font-bold inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2">
                <Upload size={14} /> Carregar
                <input type="file" accept={AUDIO_FILE_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(note, f) }} />
              </label>
              {custom.has(note) && (
                <button type="button" onClick={() => onClear(note)}
                  className="inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center justify-center gap-1.5 rounded-ps-md bg-ps-s2 px-3 text-ps-sm font-bold text-ps-alert inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2">
                  <X size={14} /> Tirar
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading, signOut, userPlan, isAdmin, blockedAt, deleteAccount } = useAuth()
  // Conta comum bloqueada pelo admin: a tela de bloqueio entra no lugar do app (o servidor
  // recusa as funções dela). Sem a data do bloqueio, ou com a leitura do perfil falhando, nada muda.
  const blocked = shouldShowBlocked({ user, blockedAt, isAdmin })
  // Volta do link de recuperar senha: mostra a tela Criar nova senha antes de tudo.
  const isRecoveringPassword = usePasswordRecovery()
  const isOnline = useNetworkStatus()
  const { settings } = useSettings()

  // ── Palco novo ou antigo (R-25): uma decisão só, a chave "Novo" E a tela larga (1024 x 740 ou
  // mais). Ela escolhe a tela, o mecanismo do pulo (stageMode do motor) e os comandos da banda
  // (os adaptadores do motor seguem o modo). Só muda com a VS parada: trocar a chave ou
  // redimensionar tocando vale na próxima parada (o ajuste fica logo depois do motor).
  const { wide } = useStageViewport()
  const wantNewStage = settings.stageVersion === 'novo' && wide
  const [useNewStage, setUseNewStage] = useState(wantNewStage)
  // Portões do plano, os mesmos pro motor e pra tela (seções e ∞ dos pagos; banda no Studio).
  const sectionGates = useMemo(() => stageGatesFor(userPlan), [userPlan])

  const {
    isReady, initEngine, loadFiles, isLoading, isRestoring,
    playlist, activeSongIndex, setPlaylistOrder, removeSongFromPlaylist, jumpToSong,
    renameSong, setCoverImage, clearSession,
    setChannelBus, exportPlaylist, importPlaylist,
    channels, pause, seekTo, prevSong, nextSong, isPlaying, currentTime, duration,
    masterVolume, updateVolume, toggleMute, toggleSolo, updateMasterVolume,
    changePitch, setOriginalKey, currentMarker, setSongMarkers, setSongLyrics, syncSongMeta,
    playbackMode, setPlaybackMode,
    activeLoop, pendingJump, armLoop, cancelLoop, armJump, cancelJump,
    addChannelToActiveSong,
    updatePan, removeChannel, reorderChannels, setChannelMeta,
    precountEnabled, precountBeats, isCountingIn,
    setPrecountBeats, togglePrecountEnabled, playWithPrecount, cancelCountIn,
    createEndlessMetronomeSong,
    outputPlan, maxOutputChannels, masterMuted, toggleMasterMute, getOutputLevels,
    sectionIntent, transitionView, landed, sectionSpansView, armSection, stepSection, armRepeat, toggleSectionLoop, cancelArm,
    heardNow, heardPosition, precountTimes,
    songGrid, gridWarning, setSongMeter, redetectSongGrid, isReadingGrid,
  } = useAudioEngine(user?.id, {
    autoClick: canUseGeneratedClick(userPlan), sectionGates, stageMode: useNewStage ? 'novo' : 'antigo',
    // AUTO entre músicas é do repertório, que é do pago (Parte 3, D4); o admin nunca tem limite do Livre.
    autoNext: isAdmin || canUseRepertoire(userPlan),
  })
  // A trava da R-25: a escolha nova só entra com a VS parada (nem tocando nem na pré-contagem).
  if (wantNewStage !== useNewStage && !isPlaying && !isCountingIn) setUseNewStage(wantNewStage)

  const { playPad, stopPad, activeNote, loadCustomPad, clearCustomPad, customPads, customPadNames, padVolume, updatePadVolume, selectedPadSet, selectPadSet, padMode } = usePadSynth()
  const [isPricingOpen, setIsPricingOpen] = useState(false)
  const [padActiveView, setPadActiveView] = useState<'pads' | 'samples' | 'loops'>('pads')
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const { samples, loops, loading: samplesLoading, playingUrl, playSample, stopPlayback } = useSamplesLibrary()
  const mixerRef = useRef<HTMLDivElement>(null)
  // Mixer sem canal cortado pela metade: mede a área visível e calcula a largura
  // dos canais pra caber um número INTEIRO deles (o resto rola de lado). Recalcula
  // ao girar o aparelho ou redimensionar a janela. Callback ref: funciona mesmo o
  // mixer aparecendo só depois do login.
  const stripsObserverRef = useRef<ResizeObserver | null>(null)
  const stripsRef = useCallback((el: HTMLDivElement | null) => {
    stripsObserverRef.current?.disconnect()
    stripsObserverRef.current = null
    if (!el) return
    const fit = () => {
      const cs = getComputedStyle(el)
      const padL = parseFloat(cs.paddingLeft) || 0
      const inner = el.clientWidth - padL - (parseFloat(cs.paddingRight) || 0)
      const gap = parseFloat(cs.columnGap) || 4
      const minW = window.innerWidth < 640 ? 84 : window.innerHeight <= 560 ? 74 : 104
      const n = Math.max(1, Math.floor((inner + gap) / (minW + gap)))
      const w = Math.floor((inner - (n - 1) * gap) / n)
      el.style.setProperty('--strip-w', `${w}px`)
      el.style.scrollPaddingLeft = `${padL}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    stripsObserverRef.current = ro
  }, [])

  const [showAuth, setShowAuth] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isChannelEditMode, setIsChannelEditMode] = useState(false)
  const [isSeparatorOpen, setIsSeparatorOpen] = useState(false)
  // Admin dentro do app (web e computador): estado interno, nunca o endereço, porque o
  // app de computador roda de file://. O isAdminOpen abaixo é o envio de músicas.
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false)
  // O painel só vale com o papel. Sem ele (a sessão caiu, a conta perdeu o papel, a leitura
  // falhou), fecha de vez: não reabre sozinho por cima do player na próxima leitura boa.
  if (isAdminPanelOpen && !isAdmin) setIsAdminPanelOpen(false)
  // A mesma condição decide se o painel aparece e se os atalhos do player param.
  const adminPanelShown = isAdminPanelOpen && isAdmin
  const [forceShowSplash, setForceShowSplash] = useState(false)
  const [isMetronomeModalOpen, setIsMetronomeModalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [isSetlistMenuOpen, setIsSetlistMenuOpen] = useState(false)
  const [isTracksMenuOpen, setIsTracksMenuOpen] = useState(false)
  const [isPadEditMode, setIsPadEditMode] = useState(false)
  const [isPadSetsModalOpen, setIsPadSetsModalOpen] = useState(false)
  const [isTeleprompterMode, setIsTeleprompterMode] = useState(false)
  const [isMarkerEditorOpen, setIsMarkerEditorOpen] = useState(false)
  const [isLyricsEditorOpen, setIsLyricsEditorOpen] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  // Atualização do app desktop: checa no foco e na abertura. Alimenta o botão
  // do cabeçalho e o aviso na aba Novidades.
  const { update: desktopUpdate, install: installDesktopUpdate } = useDesktopUpdate()
  // Controle remoto: a permissão é por IP (agrupa as conexões do mesmo aparelho e
  // resiste a reconexões). O líder libera quais IPs podem comandar.
  const [connectedDevices, setConnectedDevices] = useState<{ id: string; ip: string }[]>([])
  const [approvedIps, setApprovedIps] = useState<string[]>([])
  const connectedIps = [...new Set(connectedDevices.map((d) => d.ip).filter(Boolean))]
  // Fase 5 — sessão na nuvem: quando ativa, o líder espelha o estado via Supabase Realtime
  // pra músicos remotos (fora da LAN). O código vai no link compartilhado.
  const [remoteSessionCode, setRemoteSessionCode] = useState<string | null>(null)
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerLyrics, setMarkerLyrics] = useState('')
  const [markerColor, setMarkerColor] = useState('#10b981')
  const [mobileView, setMobileView] = useState<'mixer' | 'pads'>('mixer')
  const [isSaving, setIsSaving] = useState(false)
  // Pergunta de uma linha do próprio app (o Electron não tem window.prompt): renomear a música do
  // menu FAIXAS e o BPM do metrônomo infinito, nos dois palcos.
  const [textPrompt, setTextPrompt] = useState<{ kind: 'metronome' } | { kind: 'rename'; songId: string; name: string } | null>(null)
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false)
  const [isPrecountOpen, setIsPrecountOpen] = useState(false)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false)
  const [mobileDrawerView, setMobileDrawerView] = useState<'main' | 'tom' | 'faixas'>('main')
  const [chDragIdx, setChDragIdx] = useState<number | null>(null)
  const [chDragOverIdx, setChDragOverIdx] = useState<number | null>(null)
  const [vuLevels, setVuLevels] = useState<Record<string, number>>({})
  const [repertoireNotes, setRepertoireNotes] = useState('')

  const [isLiveModeOpen, setIsLiveModeOpen] = useState(false)
  const [liveServerUrl, setLiveServerUrl] = useState<string | null>(null)
  const [isLiveServerStarting, setIsLiveServerStarting] = useState(false)
  const [liveServerError, setLiveServerError] = useState<string | null>(null)

  // ── Sincronização Live (Líder / Follower) ──
  // Fase 4: próxima seção (marcador) com base no playhead atual
  const _activeMarkers = playlist[activeSongIndex]?.markers
  const nextMarkerLabel = _activeMarkers && _activeMarkers.length > 0
    ? ([..._activeMarkers].sort((a, b) => a.time - b.time).find((m) => m.time > currentTime)?.label ?? null)
    : null

  // Próxima música com tom e BPM (não só o nome): o follower calcula a nota a partir de originalKey + pitch.
  // Sem música atual (Livre que apagou a atual com o mês cheio) não há próxima.
  const _next = nextSongAfter(playlist, activeSongIndex)
  const nextSongInfo = _next
    ? { name: _next.name, originalKey: _next.originalKey ?? null, pitch: _next.pitch ?? 0, bpm: _next.bpm ?? null }
    : null

  // Rótulo organizado e cor de cada canal pela regra central. O nome original segue em `ch.name`.
  const channelLabels: Map<string, ChannelLabel> = useMemo(
    () => new Map(buildChannelLabels(channels).map((l) => [l.id, l])),
    [channels],
  )
  // Onda do SectionBar (palco antigo): primeiro instrumento harmônico, não a bateria. Só recalcula quando os canais mudam.
  const sectionWaveBuffer = useMemo(() => (pickWaveformChannel(channels) ?? channels[0])?.buffer || null, [channels])
  // Onda grande do palco novo: a música inteira, todos os canais Normal (Ruling ONDA-MIX). A lista é
  // nova a cada fader mexido; o useMixPeaks só recomeça a conta quando os canais mudam de verdade.
  const stageWaveBuffers = useMemo(
    () => (useNewStage ? waveformMixChannels(channels).flatMap((ch) => (ch.buffer ? [ch.buffer] : [])) : null),
    [useNewStage, channels],
  )

  // EDITAR CANAIS: lixeira com dois toques (o primeiro arma, o segundo em até 3 s apaga).
  // Trocar de música desarma (resetKey é a música ativa).
  const channelTrash = useTwoTapConfirm(removeChannel, { resetKey: playlist[activeSongIndex]?.id })

  // EDITAR CANAIS: canal com o painel "Editar canal" aberto, preso à música em que abriu.
  const [editing, setEditing] = useState<{ channelId: string; songIndex: number } | null>(null)
  const editingChannel = editing?.songIndex === activeSongIndex
    ? channels.find((c) => c.id === editing.channelId)
    : undefined
  // Trocou de música ou o canal saiu dela: fecha. Ajuste no render, sem efeito.
  if (editing && !editingChannel) setEditing(null)
  // Placeholder do nome no painel: o rótulo que aparece se o usuário apagar o nome,
  // calculado como se aquele canal não tivesse nome do usuário (volta numerado, ex. "Guitarra 1").
  const editingAutoLabel = useMemo(() => {
    if (!editingChannel) return ''
    const withoutCustomName = channels.map(({ id, name, customName, role, srcIdx }) =>
      ({ id, name, role, srcIdx, customName: id === editingChannel.id ? undefined : customName }))
    return buildChannelLabels(withoutCustomName).find((l) => l.id === editingChannel.id)?.autoLabel ?? editingChannel.name
  }, [channels, editingChannel])

  // ── Palco novo (T29): vista, ações, relógio e painéis da casca ──
  const [isRepertoireOpen, setIsRepertoireOpen] = useState(false)
  const [isPadPanelOpen, setIsPadPanelOpen] = useState(false)
  const [isPadSoundsOpen, setIsPadSoundsOpen] = useState(false)
  // As Configurações abrem na seção de saídas pelo aviso SAÍDAS (Ruling T18-saidas).
  const [settingsFocus, setSettingsFocus] = useState<'outputs' | null>(null)
  // Analisador de cada canal, ligado no fader (o VU do palco antigo e o medidor do palco novo).
  const analysersRef = useRef<Record<string, AnalyserNode>>({})
  const activeSong: Song | undefined = playlist[activeSongIndex]

  // A grade com identidade estável (Aviso T18 M4): o motor monta um objeto novo a cada mudança no
  // repertório (um volume mexido), e a onda refaz as linhas de compasso quando a grade muda.
  const gridBpm = songGrid?.bpm
  const gridFirst = songGrid?.firstDownbeat
  const gridSignature = songGrid?.signature
  const gridCountEvery = songGrid?.countEvery
  const gridSource = songGrid?.source
  const gridMeterSource = songGrid?.meterSource
  const stageGrid = useMemo<SongGrid | null>(() => (
    gridBpm === undefined || gridFirst === undefined || gridSignature === undefined || gridCountEvery === undefined || gridSource === undefined || gridMeterSource === undefined
      ? null
      : { bpm: gridBpm, firstDownbeat: gridFirst, signature: gridSignature, countEvery: gridCountEvery, source: gridSource, meterSource: gridMeterSource }
  ), [gridBpm, gridFirst, gridSignature, gridCountEvery, gridSource, gridMeterSource])

  // Seção que se ouve agora (a mesma conta do motor pra armar). Muda só na fronteira: a vista fica igual entre elas.
  const stageSection = useNewStage ? sectionIndexAt(sectionSpansView, isPlaying ? heardPosition() : currentTime) : -1
  const userName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || null
  const hostActive = liveServerUrl !== null || remoteSessionCode !== null
  // Música parada de verdade (nem tocando, nem na pré-contagem): só assim aparece o anúncio da casa
  // ou janela que abre sozinha (as Novidades). O mesmo estado que o useLivre recebe em `busy`.
  const engineQuiet = !isPlaying && !isCountingIn
  // Livre (Parte 3): uma instância só do hook, a do palco (as 3 músicas do mês, o repertório pago,
  // os 10 minutos do Ao Vivo e a tela de limite, que só aparece com a VS parada). Os minutos correm
  // com a sessão ligada e alguém da banda nela (Ruling R16-mudada): na rede local, com pelo menos
  // um celular conectado; na sessão pela nuvem, enquanto ela estiver ligada, porque o líder não vê
  // quem entrou (Ruling T18-remoto). Quando acabam, a banda sai (servidor desligado, código da nuvem
  // e liberações apagados) e o motor segue tocando: nada aqui mexe no som.
  const onLiveExpired = () => { void handleStopLiveMode(); setRemoteSessionCode(null); setApprovedIps([]) }
  const livre = useLivre({ userId: user?.id ?? null, plan: userPlan, isAdmin, busy: { isPlaying, isCountingIn }, liveActive: hostActive && (connectedIps.length > 0 || remoteSessionCode !== null), onLiveExpired })
  // Recurso pago tocado no Livre com a música tocando ou na pré-contagem (Ruling pads-tocando):
  // os Planos esperam a música parar, como a tela de limite. Quem paga e o admin abrem na hora.
  const openPlans = usePlansWhenQuiet(livre.isLivre, engineQuiet, () => setIsPricingOpen(true))
  // Planos abertos com a música tocando não mostram o desconto (nada de oferta por cima do palco).
  const hidePlansOffer = livre.isLivre && !engineQuiet
  const isDesktopApp = !!window.playbackDesktop?.isElectron
  const stageView = useMemo(() => (useNewStage ? buildStageView({
    song: activeSong, playlist, activeIndex: activeSongIndex, duration, spans: sectionSpansView, currentSection: stageSection,
    isPlaying, isCountingIn, precountEnabled, precountBeats, precountTimes, playbackMode, sectionIntent, transitionView,
    landed, songGrid: stageGrid, gridWarning, isReadingGrid, outputPlan, masterVolume, masterMuted,
  }, {
    plan: userPlan, isAdmin, online: isOnline, isDesktop: isDesktopApp, userName, hostActive, editMode: isEditMode,
    channelEditMode: isChannelEditMode, padPanelOpen: isPadPanelOpen, activePad: activeNote, repertoireName: null,
    // Selo do Livre na barra ("LIVRE · 2 de 3 músicas este mês"); a vista tira ele tocando. Com a
    // sessão do Ao Vivo ligada, o tempo que falta hoje (Ruling relogio-livre), que fica tocando.
    livre: livre.isLivre ? { ...livre.stage, liveLeftMs: hostActive ? livre.live.remainingMs : null } : null, autoPan: settings.autoPan,
  }) : null), [
    useNewStage, activeSong, playlist, activeSongIndex, duration, sectionSpansView, stageSection, isPlaying, isCountingIn, precountEnabled,
    precountBeats, precountTimes, playbackMode, sectionIntent, transitionView, landed, stageGrid, gridWarning, isReadingGrid, outputPlan,
    masterVolume, masterMuted, userPlan, isAdmin, isOnline, isDesktopApp, userName, hostActive, isEditMode, isChannelEditMode,
    isPadPanelOpen, activeNote, settings.autoPan, livre.isLivre, livre.stage, livre.live,
  ])

  // Grava o compasso na nuvem quem pode editar BPM e tom daquela música (R-30): o admin nas músicas
  // da biblioteca e o dono da música privada (user_id de songs; a RLS continua sendo a trava). O
  // índice do cache offline só muda pelo updateCachedSongMeta.
  const saveMeterToCloud = async (sourceId: string, signature: TimeSignature) => {
    if (!isOnline || !user) return
    try {
      let allowed = isAdmin
      if (!allowed) {
        const cloud = (await getCachedSongsList()).find((cs) => cs.id === sourceId)
        allowed = !!cloud && cloud.is_global !== true && cloud.user_id === user.id
      }
      if (!allowed) return
      if (await updateSong(sourceId, { time_signature: signature })) await updateCachedSongMeta(sourceId, { time_signature: signature })
    } catch (e) {
      console.error('Falha ao salvar o compasso na nuvem:', e)
    }
  }
  const upgradeIf = (r: { upgrade: boolean }) => { if (r.upgrade) openPlans() }
  const clampToSong = (t: number) => Math.max(0, Math.min(duration || 0, Number.isFinite(t) ? t : 0))
  const promptEndlessMetronome = () => setTextPrompt({ kind: 'metronome' })

  // ── Livre no palco e no repertório (Parte 3, D4 com a Ruling R10) ──
  // Os dois palcos, os menus e a banda trocam de música, importam e mexem no .zip só por estas
  // versões. No Livre: abrir outra música (do repertório, do aparelho ou da biblioteca) conta nas 3
  // do mês e, sem vaga, pede a tela das músicas do mês; próxima, anterior e .zip são do pago e
  // pedem a tela do repertório. Nenhuma delas mexe no som: a tela espera a VS parar (useLivre).
  // Quem paga e o admin passam direto, como antes.
  const jumpToSongGated = useCallback((i: number) => {
    const song = playlist[i]
    if (livre.isLivre && song && !livre.canOpenSong(stageSongKey(song))) { livre.requestLimit('stage-songs'); return }
    jumpToSong(i)
  }, [livre, playlist, jumpToSong])
  // Sem próxima música não há o que pedir: o motor também não faz nada.
  const nextSongGated = useCallback(() => {
    if (livre.isLivre && activeSongIndex < playlist.length - 1) { livre.requestLimit('repertoire'); return }
    nextSong()
  }, [livre, activeSongIndex, playlist.length, nextSong])
  // Na primeira música o anterior volta pro começo dela, como sempre (não troca de música).
  const prevSongGated = useCallback(() => {
    if (livre.isLivre && activeSongIndex > 0) { livre.requestLimit('repertoire'); return }
    prevSong()
  }, [livre, activeSongIndex, prevSong])
  // AUTO entre músicas (Ruling AUTO-livre): no Livre ele aparece travado nos dois palcos (a tela
  // mostra PARAR, shownEndMode) e o toque nele pede a tela do repertório, que espera a VS parar.
  const autoNextAllowed = !livre.isLivre
  const shownMode = shownEndMode(playbackMode, autoNextAllowed)
  const setEndModeGated = (m: EndMode) => {
    if (m === 'continue' && !autoNextAllowed) { livre.requestLimit('repertoire'); return }
    setPlaybackMode(m)
  }
  const exportZipGated = () => {
    if (livre.isLivre) { setIsSetlistMenuOpen(false); livre.requestLimit('repertoire'); return }
    void handleExport()
  }
  const importZipGated = (file: File) => {
    if (livre.isLivre) { livre.requestLimit('repertoire'); return }
    void importPlaylist(file)
  }
  // Tirar música vale pra todos (D4). Tirando a atual, a seguinte viraria a atual: no Livre essa
  // troca passa pelo mesmo portão (ajuste do coordenador). Recusada (mês cheio e ela ainda não
  // contada), não sobra música atual: a VS fica parada sem música e a tela das músicas do mês é
  // pedida (aparece só parada). Aceita, ela vira a atual e conta pelo efeito da contagem.
  const removeSongGated = (id: string) => {
    if (livre.isLivre && removalOpensRefusedSong(playlist, activeSongIndex, id, (s) => livre.canOpenSong(stageSongKey(s)))) {
      removeSongFromPlaylist(id, { openNext: false })
      livre.requestLimit('stage-songs')
      return
    }
    removeSongFromPlaylist(id)
  }

  // "Uma música por vez" (D4): no Livre, a música importada ou baixada vira a atual com a VS parada.
  // O pedido guarda as músicas de antes; quando o carregamento termina, o efeito abaixo vê o
  // repertório crescer e abre a nova (o motor acrescenta no fim). Carregamento que falha não abre
  // nada. Tocando, a música nova só entra no repertório.
  const [livreLoaded, setLivreLoaded] = useState<{ before: ReadonlySet<string> } | null>(null)
  const livreLoadedSeen = useRef<{ before: ReadonlySet<string> } | null>(null)
  const loadAsCurrent = async (load: () => Promise<void>) => {
    if (!livre.isLivre) return load()
    const before = new Set(playlist.map((s) => s.id))
    await load()
    setLivreLoaded({ before })
  }
  const importFilesGated = (files: FileList) => {
    if (livre.isLivre && !livre.canOpenNewSong()) { livre.requestLimit('stage-songs'); return }
    void loadAsCurrent(() => loadFiles(files))
  }
  useEffect(() => {
    if (livreLoaded === null || livreLoadedSeen.current === livreLoaded) return
    livreLoadedSeen.current = livreLoaded
    const last = playlist.length - 1
    if (last < 0 || livreLoaded.before.has(playlist[last].id) || isPlaying || isCountingIn) return
    jumpToSongGated(last)
  }, [livreLoaded, playlist, isPlaying, isCountingIn, jumpToSongGated])

  // A música que vira a atual conta nas do mês no Livre (D3), por qualquer caminho, inclusive a
  // restaurada ao abrir o app (essa nunca é barrada). A mesma música de novo no mês não conta outra
  // vez. Quem barra é quem troca de música (as versões acima); aqui só se grava.
  const { noteSongOpened } = livre
  useEffect(() => {
    if (activeSong) noteSongOpened(stageSongKey(activeSong))
  }, [activeSong, noteSongOpened])

  // Ações do palco (StageActions + a da casca) e o que os painéis do App chamam. A casca recebe
  // um objeto estável (delegateTo) que chama a versão da renderização mais nova.
  const stageImpl = {
    togglePlay: () => { if (isCountingIn) cancelCountIn(); else if (isPlaying) pause(); else playWithPrecount() },
    // COMEÇO (Ruling I3-comeco): tocando com seções, arma a primeira como um pulo (cai no 1 com a
    // contagem e cancela como qualquer seção armada); parado, ou tocando sem nada pra armar (a
    // casca já pediu o segundo toque), volta direto pro 0:00.
    goToStart: () => {
      if (startAction(isPlaying, sectionSpansView.length, sectionGates) === 'arm') upgradeIf(armSection(0))
      else seekTo(0)
    },
    setEndMode: (m: 'continue' | 'stop' | 'fade-out') => setEndModeGated(m),
    togglePrecount: () => togglePrecountEnabled(!precountEnabled),
    cyclePrecountBeats: () => setPrecountBeats(precountBeats >= 8 ? 1 : precountBeats + 1),
    toggleClick: () => { const click = findClickChannel(channels); if (click) toggleMute(click.id) },
    openMetronome: () => setIsMetronomeModalOpen(true),
    tapSection: (i: number) => upgradeIf(armSection(i)),
    stepSection: (dir: -1 | 1) => upgradeIf(stepSection(dir)),
    cancelArm: () => cancelArm(),
    armRepeat: (plays: Plays) => upgradeIf(armRepeat(plays)),
    toggleLoop: () => upgradeIf(toggleSectionLoop()),
    seek: (t: number) => seekTo(clampToSong(t)),
    seekBy: (dt: number) => seekTo(clampToSong(heardPosition() + dt)),
    // Trocar o tom segue o portão do plano (canChangeKey), como o TOM do palco antigo.
    changePitch: (semitones: number) => withPlan(canChangeKey(userPlan), () => changePitch(semitones)),
    // Tom original com a mesma ação do TOM do palco antigo: definir grava o original e volta o tom
    // pro 0; "Redefinir detecção de tom" (nulo) apaga o original e volta pro 0. Mesmo portão do tom.
    setOriginalKey: (key: string | null) => withPlan(canChangeKey(userPlan), () => { setOriginalKey(key); changePitch(0) }),
    prevSong: () => prevSongGated(),
    nextSong: () => nextSongGated(),
    setVolume: (id: string, gain: number) => updateVolume(id, gain),
    toggleMute: (id: string) => toggleMute(id),
    toggleSolo: (id: string) => toggleSolo(id),
    setPan: (id: string, pan: number) => updatePan(id, pan),
    setMasterVolume: (gain: number) => updateMasterVolume(gain),
    toggleMasterMute: () => toggleMasterMute(),
    togglePadPanel: () => setIsPadPanelOpen((open) => !open),
    openLyrics: () => setIsTeleprompterMode(true),
    openRepertoires: () => setIsRepertoireOpen((open) => !open),
    openTracks: () => setIsTracksMenuOpen((open) => !open),
    openLibrary: () => withPlan(canUsePlatformCatalog(userPlan), () => setIsLibraryOpen(true)),
    toggleEditMode: () => setIsEditMode((on) => !on),
    toggleChannelEditMode: () => { setIsChannelEditMode((on) => !on); channelTrash.disarm() },
    openHost: () => { void handleStartLiveMode() },
    openSettings: () => { setSettingsFocus(null); setIsSettingsOpen(true) },
    goHome: () => setForceShowSplash(true),
    signOut: () => { void signOut() },
    openUpgrade: () => openPlans(),
    openLivreBadge: () => { trackAd('ad_clicked', 'badge'); setIsPricingOpen(true) },
    openChannelEdit: (id: string) => setEditing({ channelId: id, songIndex: activeSongIndex }),
    reorderChannel: (from: number, to: number) => {
      const arr = [...channels]
      const [moved] = arr.splice(from, 1)
      if (!moved) return
      arr.splice(to, 0, moved)
      reorderChannels(arr)
    },
    removeChannel: (id: string) => removeChannel(id),
    // Modo EDITAR (T16): marcar, ajustar e tirar seção mexem na marca de origem do trecho.
    markSection: (label: string) => {
      if (!canUseSections(userPlan)) { openPlans(); return }
      if (!activeSong) return
      setSongMarkers(activeSong.id, addSectionAt(activeSong.markers ?? [], heardPosition(), label, stageGrid, () => crypto.randomUUID()))
    },
    nudgeSection: (index: number, bars: number) => {
      if (!activeSong) return
      const markers = activeSong.markers ?? []
      const id = markerIdForSpan(markers, duration, stageGrid, index)
      if (id) setSongMarkers(activeSong.id, nudgeSectionMarker(markers, id, bars, stageGrid, duration))
    },
    removeSection: (index: number) => {
      if (!activeSong) return
      const markers = activeSong.markers ?? []
      const id = markerIdForSpan(markers, duration, stageGrid, index)
      if (id) setSongMarkers(activeSong.id, removeSectionMarker(markers, id))
    },
    // Compasso escolhido no EDITAR: no repertório e no aparelho (motor) e, com a música da
    // biblioteca, na nuvem pra quem pode editar (R-30). Sem grade não há o que escolher.
    setMeter: (signature: TimeSignature, countEvery: 1 | 3) => {
      if (!activeSong || !stageGrid) return
      setSongMeter(activeSong.id, signature, countEvery)
      if (activeSong.sourceId) void saveMeterToCloud(activeSong.sourceId, signature)
    },
    // Sem canal de Click a releitura não tem efeito no motor (Ruling T27-reler): o botão já vem desligado.
    redetectMeter: () => {
      if (!activeSong || !findClickChannel(activeSong.channels)) return
      void redetectSongGrid(activeSong.id)
    },
    openOutputSettings: () => { setSettingsFocus('outputs'); setIsSettingsOpen(true) },
    // Painel de pads, SAMPLES e LOOPS.
    padView: (v: PadPanelProps['view']) => { if (v === 'pads') stopPlayback(); setPadActiveView(v); setActiveFolder(null) },
    padNote: (note: string) => playPad(note),
    padVolume: (v: number) => updatePadVolume(v),
    padSets: () => withPlan(canUseCloudPads(userPlan), () => setIsPadSetsModalOpen(true)),
    padEdit: () => setIsPadSoundsOpen(true),
    padLoad: (note: string, file: File) => loadCustomPad(note, file),
    padClear: (note: string) => clearCustomPad(note),
    padSoundsClose: () => setIsPadSoundsOpen(false),
    sampleFolder: (folder: string | null) => setActiveFolder(folder),
    samplePlay: (url: string) => playSample(url),
    // Painel REPERTÓRIOS.
    repSelect: (i: number) => jumpToSongGated(i),
    repReorder: (from: number, to: number) => {
      const list = [...playlist]
      const [moved] = list.splice(from, 1)
      if (!moved) return
      list.splice(to, 0, moved)
      setPlaylistOrder(list)
    },
    repRemove: (id: string) => removeSongGated(id),
    repNew: () => clearSession(),
    repExport: () => exportZipGated(),
    repImport: (file: File) => importZipGated(file),
    repClose: () => setIsRepertoireOpen(false),
    notesChange: (v: string) => setRepertoireNotes(v),
    // Menu FAIXAS.
    tracksClose: () => setIsTracksMenuOpen(false),
    tracksImport: (files: FileList) => importFilesGated(files),
    tracksMetronome: () => promptEndlessMetronome(),
    tracksRename: () => {
      if (activeSong) setTextPrompt({ kind: 'rename', songId: activeSong.id, name: activeSong.name })
    },
    tracksCover: (file: File) => {
      if (!activeSong) return
      const songId = activeSong.id
      const reader = new FileReader()
      reader.onload = (ev) => setCoverImage(songId, ev.target?.result as string)
      reader.readAsDataURL(file)
    },
  } satisfies StageShellActions & Record<string, (...args: never[]) => void>
  const stageImplRef = useRef(stageImpl)
  useLayoutEffect(() => { stageImplRef.current = stageImpl })
  const [stageCalls] = useState(() => delegateTo(stageImpl, stageImplRef))

  // Leituras de cada quadro (useFrame dentro das peças): tempo ouvido, nível de cada canal e do PRINCIPAL.
  const stageClock = useMemo<StageClock>(() => ({
    heardNow: () => heardNow(),
    position: () => heardPosition(),
    level: (id: string) => analyserPeak(analysersRef.current[id]),
    masterLevels: () => getOutputLevels(),
  }), [heardNow, heardPosition, getOutputLevels])

  // Onda grande: o maior pico entre todos os canais Normal, uma vez por música, aos pedaços que cedem a
  // vez à tela (nenhuma tarefa longa, a música pode trocar sozinha tocando); vazia até ficar pronta e
  // cancelada se a música trocar antes (Ruling ONDA-MIX).
  const stagePeaks = useMixPeaks(stageWaveBuffers, STAGE_WAVE_BUCKETS)

  // Tom da música agora (índice de 0 a 11) pro "TOM" da grade de pads; nulo sem tom original.
  const stageOriginalKey = keyToSemitone(activeSong?.originalKey ?? null)
  const stageKeyIndex = stageOriginalKey === null ? null : ((stageOriginalKey + (activeSong?.pitch ?? 0)) % 12 + 12) % 12
  const padSetName = padMode === 'system' && selectedPadSet ? selectedPadSet.name : null
  const stagePads = useMemo<Omit<PadPanelProps, 'open' | 'onClose'>>(() => ({
    view: padActiveView, onViewChange: stageCalls.padView, notes: KEY_NAMES, activeNote, songKeyIndex: stageKeyIndex, volume: padVolume,
    setName: padSetName, onPlayNote: stageCalls.padNote, onVolume: stageCalls.padVolume, onOpenSets: stageCalls.padSets, onEditPads: stageCalls.padEdit,
    samples: <SampleList kind="samples" items={samples} loading={samplesLoading} activeFolder={activeFolder} playingUrl={playingUrl} onFolder={stageCalls.sampleFolder} onPlay={stageCalls.samplePlay} />,
    loops: <SampleList kind="loops" items={loops} loading={samplesLoading} activeFolder={activeFolder} playingUrl={playingUrl} onFolder={stageCalls.sampleFolder} onPlay={stageCalls.samplePlay} />,
  }), [stageCalls, padActiveView, activeNote, stageKeyIndex, padVolume, padSetName, samples, loops, samplesLoading, activeFolder, playingUrl])

  // Painéis do App dentro da casca: REPERTÓRIOS sempre montado (abre e fecha pelo `open`, pro foco
  // voltar a quem abriu) e o menu FAIXAS só aberto. As ferramentas do admin entram no EDITAR (no render).
  const repertoireSongs = useMemo(() => playlist.map((s) => {
    const { title, artist } = splitSongName(s)
    return { id: s.id, name: title, artist, coverImage: s.coverImage, originalKey: s.originalKey ?? null, bpm: s.bpm ?? null }
  }), [playlist])
  const hasActiveSong = !!activeSong
  const stageSlots = useMemo(() => ({
    repertoire: (
      <RepertoirePanel
        open={isRepertoireOpen} songs={repertoireSongs} activeIndex={activeSongIndex} isPlaying={isPlaying} notes={repertoireNotes}
        onNotesChange={stageCalls.notesChange} onSelect={stageCalls.repSelect} onReorder={stageCalls.repReorder} onRemove={stageCalls.repRemove}
        onNew={stageCalls.repNew} onExport={stageCalls.repExport} onImport={stageCalls.repImport} onClose={stageCalls.repClose}
      />
    ),
    tracksMenu: isTracksMenuOpen ? (
      <StageTracksMenu
        hasSong={hasActiveSong} onClose={stageCalls.tracksClose} onImport={stageCalls.tracksImport} onMetronome={stageCalls.tracksMetronome}
        onRename={stageCalls.tracksRename} onCover={stageCalls.tracksCover}
      />
    ) : null,
  }), [stageCalls, isRepertoireOpen, repertoireSongs, activeSongIndex, isPlaying, repertoireNotes, isTracksMenuOpen, hasActiveSong])

  // Ao Vivo do host com o palco novo: seções pelas spans (os índices batem com os comandos da
  // banda), o pulo armado e a contagem do pulo agendado (o número muda quando o bipe ouvido muda).
  const liveArmed = stageView ? liveArmedOf(stageView) : null
  const liveCountTotal = useNewStage && transitionView?.committed && transitionView.countTotal > 0 ? transitionView.countTotal : null
  const liveCountBeat = liveCountTotal !== null && transitionView ? countState(transitionView, heardNow()).currentLabel : null

  const { isFollowerMode, isConnected, followerState, sendCommand } = useLiveSync({
    isPlaying,
    currentTime,
    songName: playlist[activeSongIndex]?.name || null,
    currentMarker: currentMarker || null,
    nextMarkerLabel,
    nextSong: nextSongInfo,
    lyrics: playlist[activeSongIndex]?.lyrics ?? null,
    lyricsSynced: playlist[activeSongIndex]?.lyricsSynced ?? null,
    chords: playlist[activeSongIndex]?.chords ?? null,
    controlEnabled: false,
    approvedIps,
    setlist: playlist.map((s) => s.name),
    activeIndex: activeSongIndex,
    // O celular da banda vê o mesmo nome organizado do mixer.
    channels: channels.map((c) => ({ id: c.id, name: channelLabels.get(c.id)?.label ?? c.name, volume: c.volume, muted: c.muted, soloed: c.soloed })),
    activePad: activeNote,
    padVolume,
    pitch: playlist[activeSongIndex]?.pitch || 0,
    originalKey: playlist[activeSongIndex]?.originalKey || null,
    sections: stageView
      ? stageView.sections.map((sec) => ({ label: sec.label, color: sec.color }))
      : (playlist[activeSongIndex]?.markers || []).map((m) => ({ label: m.label, color: m.color || '#FF6B35' })),
    activeLoop,
    armed: liveArmed,
    countBeat: liveCountBeat,
    countTotal: liveCountTotal,
    bandSectionsEnabled: canBandControlSections(userPlan),
  }, remoteSessionCode)

  // Líder: mantém a lista de dispositivos conectados. As aprovações são por IP e
  // persistem mesmo se a conexão cair (o aparelho reconecta e mantém a liberação).
  useEffect(() => {
    if (!window.playbackDesktop?.isElectron) return
    const cleanup = window.playbackDesktop.onClientsUpdate((clients) => {
      setConnectedDevices(clients)
    })
    return cleanup
  }, [])

  // Líder: recebe comandos dos dispositivos da banda e executa — só dos dispositivos aprovados.
  useEffect(() => {
    if (!window.playbackDesktop?.isElectron) return
    const cleanup = window.playbackDesktop.onRemoteCommand((cmd) => {
      const allowed = !!cmd.ip && approvedIps.includes(cmd.ip)
      if (!allowed) return
      // Conta bloqueada: o player não está na tela, então a banda não toca nada por trás.
      if (blocked) return
      switch (cmd.action) {
        case 'toggle-play': isPlaying ? pause() : playWithPrecount(); break
        // Livre (Ruling R10): próxima e anterior da banda são do repertório (pago); escolher música
        // pela banda conta nas 3 do mês, como abrir do repertório. Tocando, a tela espera parar.
        case 'next': nextSongGated(); break
        case 'prev': prevSongGated(); break
        case 'select-song': if (typeof cmd.index === 'number') jumpToSongGated(cmd.index); break
        // Volume pela banda no mesmo teto do fader do palco (+6 dB, FADER_MAX_GAIN), nunca negativo.
        case 'set-volume': if (cmd.id && typeof cmd.value === 'number' && Number.isFinite(cmd.value)) updateVolume(cmd.id, Math.min(FADER_MAX_GAIN, Math.max(0, cmd.value))); break
        case 'toggle-mute': if (cmd.id) toggleMute(cmd.id); break
        case 'toggle-solo': if (cmd.id) toggleSolo(cmd.id); break
        case 'set-pitch': if (typeof cmd.value === 'number') changePitch(cmd.value); break
        case 'play-pad': if (cmd.id) playPad(cmd.id); break
        case 'set-pad-volume': if (typeof cmd.value === 'number') updatePadVolume(cmd.value); break
        // Seções pela banda: exclusivo do Studio. value === -1 = loop infinito.
        case 'arm-loop': if (canBandControlSections(userPlan) && typeof cmd.index === 'number') armLoop(cmd.index, cmd.value === -1 ? 'infinite' : (cmd.value ?? 1)); break
        case 'cancel-loop': if (canBandControlSections(userPlan)) cancelLoop(); break
        case 'arm-jump': if (canBandControlSections(userPlan) && typeof cmd.index === 'number') armJump(cmd.index); break
      }
    })
    return cleanup
  }, [approvedIps, userPlan, isPlaying, pause, playWithPrecount, nextSongGated, prevSongGated, jumpToSongGated, updateVolume, toggleMute, toggleSolo, changePitch, playPad, updatePadVolume, armLoop, cancelLoop, armJump, blocked])

  // Cria uma seção no ponto atual com o nome dado. Usado pelo menu "Marcar" e
  // pelos atalhos de teclado (V, R, ...).
  const addSectionMarker = useCallback((label: string) => {
    if (!canUseSections(userPlan)) { setIsPricingOpen(true); return }
    const activeSong = playlist[activeSongIndex]
    if (!activeSong) return
    const newMarker = { id: crypto.randomUUID(), time: currentTime, label, color: colorForSection(label) }
    const newMarkers = [...(activeSong.markers || []), newMarker].sort((a, b) => a.time - b.time)
    setSongMarkers(activeSong.id, newMarkers)
  }, [playlist, activeSongIndex, currentTime, setSongMarkers, userPlan])

  // Atalhos de teclado: espaço = play/pause; setas = andar na barra (passo fino
  // com Shift); letras (V, R, ...) marcam a seção no ponto atual. Ignora quando
  // o foco está num campo de texto pra não atrapalhar anotações, etc.
  useEffect(() => {
    // Palco novo: o teclado é o da casca (useStageShortcuts), com as regras de foco da Ruling T18-atalho.
    if (useNewStage) return
    const onKey = (e: KeyboardEvent) => {
      // A página de separação tem seus próprios atalhos (Espaço toca os multitracks
      // separados, não a playlist). Enquanto ela estiver aberta, o App não responde
      // ao teclado pra não controlar a playback errada. O admin também: lá Espaço e
      // setas são dos botões e das abas, e uma letra não pode marcar seção na música.
      if (isSeparatorOpen || adminPanelShown) return
      // Conta bloqueada: a tela de bloqueio está no lugar do player.
      if (blocked) return
      // Diálogo do app aberto (renomear, metrônomo infinito; Ruling B-dialogo): com o foco fora do
      // campo (no Cancelar, no painel), o Espaço não toca e as letras não marcam seção por baixo dele.
      if (textPrompt !== null) return
      // Tela de limite do Livre aberta: mesma coisa (Ruling R9).
      if (livre.limit !== null) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (playlist.length === 0) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Space') {
        e.preventDefault()
        isPlaying ? pause() : playWithPrecount()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 5
        seekTo(Math.min(duration, currentTime + step))
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 5
        seekTo(Math.max(0, currentTime - step))
      } else {
        const shortcut = SECTION_SHORTCUTS.find((s) => s.code === e.code)
        if (shortcut) {
          e.preventDefault()
          addSectionMarker(shortcut.name)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playlist.length, isPlaying, pause, playWithPrecount, seekTo, currentTime, duration, addSectionMarker, isSeparatorOpen, useNewStage, adminPanelShown, blocked, textPrompt, livre.limit])

  // Bloqueio que chega com o app aberto (o perfil é relido ao voltar pra janela): a tela de
  // bloqueio tira o player da tela, então nada fica tocando sem controle. Para a música, a
  // contagem, o pad e a prévia de sample. O Separador para o próprio som ao sair da tela.
  useEffect(() => {
    if (!blocked) return
    if (isCountingIn) cancelCountIn()
    if (isPlaying) pause()
    if (activeNote) stopPad()
    if (playingUrl) stopPlayback()
  }, [blocked, isCountingIn, cancelCountIn, isPlaying, pause, activeNote, stopPad, playingUrl, stopPlayback])

  const handleStartLiveMode = async () => {
    // Modo Ao Vivo pra todos os planos (Parte 3). O Livre tem 10 minutos por dia: sem minutos, a tela
    // de limite do Ao Vivo (com a música tocando, ela espera parar). Aparelhos por plano: liveDeviceCap.
    if (!livre.canStartLive()) {
      livre.requestLimit('live')
      return
    }
    setIsLiveModeOpen(true)
    if (liveServerUrl || !window.playbackDesktop?.isElectron) return

    setIsLiveServerStarting(true)
    setLiveServerError(null)
    
    try {
      const { url, error } = await window.playbackDesktop.startLocalServer()
      if (error) {
        setLiveServerError(error)
      } else {
        setLiveServerUrl(url)
      }
    } catch (err: any) {
      setLiveServerError(err.message)
    } finally {
      setIsLiveServerStarting(false)
    }
  }

  const handleStopLiveMode = async () => {
    if (window.playbackDesktop?.isElectron) {
      await window.playbackDesktop.stopLocalServer()
    }
    setLiveServerUrl(null)
    // Servidor desligado: ninguém conectado (o Electron não manda a lista vazia depois de fechar, e
    // a lista velha faria os minutos do Livre correrem ao ligar o HOST de novo sem celular).
    setConnectedDevices([])
    setIsLiveModeOpen(false)
  }

  // Celulares da banda com controle no Ao Vivo, até o teto do plano (maxLiveDevices: Livre 1, Pro 4,
  // Studio sem limite). O admin nunca tem o limite do Livre: no plano Livre ele fica sem teto.
  const liveDeviceCap = isAdmin && planTier(userPlan) === 'free' ? Infinity : maxLiveDevices(userPlan)
  // Liberar um celular. Passou do teto: no Livre a tela do celular a mais, nos pagos os Planos.
  const approveLiveDevice = (ip: string) => {
    if (approvedIps.includes(ip)) {
      setApprovedIps(prev => prev.filter(x => x !== ip))
      return
    }
    if (approvedIps.length >= liveDeviceCap) {
      if (livre.isLivre) livre.requestLimit('live-devices')
      else setIsPricingOpen(true)
      return
    }
    setApprovedIps(prev => (prev.includes(ip) ? prev : [...prev, ip]))
  }
  // Liberar todos respeita o teto; no Livre, sobrando celular, a tela do celular a mais explica.
  const approveAllLiveDevices = () => {
    const allApproved = connectedIps.length > 0 && connectedIps.every(ip => approvedIps.includes(ip))
    if (allApproved) {
      setApprovedIps([])
      return
    }
    setApprovedIps(connectedIps.slice(0, liveDeviceCap))
    if (connectedIps.length > liveDeviceCap && livre.isLivre) livre.requestLimit('live-devices')
  }

  useEffect(() => {
    if (user?.id) setRepertoireNotes(localStorage.getItem(`repertoire_notes_${user.id}`) || '')
  }, [user?.id])

  useEffect(() => {
    if (user?.id) localStorage.setItem(`repertoire_notes_${user.id}`, repertoireNotes)
  }, [repertoireNotes, user?.id])

  // ── Checkout Intent Logic ──
  useEffect(() => {
    if (user && !loading) {
      const intent = localStorage.getItem('checkoutIntent')
      if (intent) {
        setIsPricingOpen(true)
        localStorage.removeItem('checkoutIntent')
      }
    }
  }, [user, loading])

  // ── Tutorial guiado na primeira vez (após o app montar, fora do splash) ──
  useEffect(() => {
    if (!user || !isReady || forceShowSplash) return
    if (localStorage.getItem('tour_seen')) return
    const t = setTimeout(() => setShowTour(true), 600) // espera o layout assentar
    return () => clearTimeout(t)
  }, [user, isReady, forceShowSplash])

  const closeTour = () => {
    setShowTour(false)
    localStorage.setItem('tour_seen', '1')
  }

  // ── Popup de novidades: mostra quando há versão nova que o usuário não viu ──
  // Só dispara depois do tutorial (pra não empilhar dois popups na 1ª vez) e com a música parada
  // (nem tocando, nem na pré-contagem): tocando, espera ela parar; a música que começa nos 700 ms
  // cancela a abertura.
  useEffect(() => {
    if (!user || !isReady || forceShowSplash || showTour || !engineQuiet) return
    if (!localStorage.getItem('tour_seen')) return
    if (localStorage.getItem('last_seen_version') === CURRENT_VERSION) return
    const t = setTimeout(() => setShowWhatsNew(true), 700)
    return () => clearTimeout(t)
  }, [user, isReady, forceShowSplash, showTour, engineQuiet])

  const closeWhatsNew = () => {
    setShowWhatsNew(false)
    localStorage.setItem('last_seen_version', CURRENT_VERSION)
  }

  // Recurso preso a um portão do plano (src/lib/plans.ts): liberado, roda a ação; senão abre os
  // Planos (no Livre, só com a música parada: openPlans espera ela parar).
  const withPlan = (allowed: boolean, action: () => void) => {
    if (!allowed) {
      openPlans()
      return
    }
    action()
  }

  const vuAnimRef = useRef<number>(0)

  // ── VU Meter animation loop ──
  useEffect(() => {
    if (!isPlaying || channels.length === 0) {
      if (vuAnimRef.current) cancelAnimationFrame(vuAnimRef.current)
      return
    }

    // Create AnalyserNodes for channels that don't have one yet (os dois palcos medem por eles)
    channels.forEach(ch => {
      if (!analysersRef.current[ch.id]) {
        try {
          const ctx = ch.gainNode.context as AudioContext
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.7
          ch.gainNode.connect(analyser)
          analysersRef.current[ch.id] = analyser
        } catch (_) { /* ok */ }
      }
    })

    // Palco novo: o medidor de cada canal lê o analisador a cada quadro dentro da peça
    // (StageClock.level), sem estado do React aqui.
    if (useNewStage) return

    // Ganho de cada canal pela mesma regra do motor (M, Solo, Click e Guia fora do Solo).
    // Calculado uma vez por mudança nos canais, não a cada quadro.
    const gainById = new Map(channels.map((ch) => [ch.id, channelGain(ch, channels)]))

    const updateVU = () => {
      const levels: Record<string, number> = {}
      let masterPeak = 0

      channels.forEach(ch => {
        const analyser = analysersRef.current[ch.id]
        let chLevel = 0
        if (analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          chLevel = sum / data.length / 255
        }
        levels[ch.id] = chLevel

        masterPeak = Math.max(masterPeak, chLevel * (gainById.get(ch.id) ?? 0))
      })
      
      levels['master'] = masterPeak * masterVolume
      setVuLevels(levels)
      vuAnimRef.current = requestAnimationFrame(updateVU)
    }
    vuAnimRef.current = requestAnimationFrame(updateVU)

    return () => {
      if (vuAnimRef.current) cancelAnimationFrame(vuAnimRef.current)
    }
  }, [isPlaying, channels, useNewStage])

  // Channel drag handlers
  const onChDragStart = (idx: number) => setChDragIdx(idx)
  const onChDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setChDragOverIdx(idx) }
  const onChDrop = (idx: number) => {
    if (chDragIdx === null || chDragIdx === idx) { setChDragIdx(null); setChDragOverIdx(null); return }
    const arr = [...channels]
    const [moved] = arr.splice(chDragIdx, 1)
    arr.splice(idx, 0, moved)
    reorderChannels(arr)
    setChDragIdx(null); setChDragOverIdx(null)
  }
  const onChDragEnd = () => { setChDragIdx(null); setChDragOverIdx(null) }

  // VU Meter rendering helper
  const renderVU = (channelId: string, isMaster = false) => {
    const level = isMaster && channelId === 'master' ? (vuLevels['master'] || 0) : (vuLevels[channelId] || 0)
    const totalSegments = 40
    const activeCount = Math.round(level * totalSegments)
    return (
      <div className="vu-meter h-full">
        {Array.from({ length: totalSegments }).map((_, i) => {
          const isActive = i < activeCount
          let colorClass = 'green'
          if (i >= totalSegments * 0.85) colorClass = 'red'
          else if (i >= totalSegments * 0.65) colorClass = 'yellow'
          return <div key={i} className={`vu-segment ${colorClass} ${isActive ? 'active' : ''}`} />
        })}
      </div>
    )
  }

  // Pan Knob Drag State
  const activePanDrag = useRef<{id: string, startY: number, startPan: number} | null>(null)

  const handlePanPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, pan: number) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    activePanDrag.current = { id, startY: e.clientY, startPan: pan }
  }
  const handlePanPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePanDrag.current) {
      const dy = activePanDrag.current.startY - e.clientY
      let newPan = activePanDrag.current.startPan + (dy / 100)
      newPan = Math.max(-1, Math.min(1, newPan))
      updatePan(activePanDrag.current.id, Math.round(newPan * 10) / 10)
    }
  }
  const handlePanPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePanDrag.current) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      activePanDrag.current = null
    }
  }

  const activePitch = playlist[activeSongIndex]?.pitch || 0
  const activeOriginalKey = playlist[activeSongIndex]?.originalKey || null
  // Tom original em qualquer grafia (Bb, Am, f#...). Não reconhecido conta como
  // desconhecido: o usuário define manualmente e nada é transposto (nunca NaN).
  const originalKeyIndex = keyToSemitone(activeOriginalKey)
  const hasOriginalKey = originalKeyIndex !== null
  const currentKeyName = originalKeyIndex !== null
    ? KEY_NAMES[((originalKeyIndex + activePitch) % 12 + 12) % 12]
    : null

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Touch/drag scroll for mixer
  const mixerDragState = useRef({ isDown: false, startX: 0, scrollLeft: 0 })

  // V5: Scrubbing state
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [localDragTime, setLocalDragTime] = useState(0);

  const formatTime = (time: number) => {
    if (isNaN(time)) time = 0;
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Drag-and-drop handlers
  const handleDragStart = (index: number) => { setDragIndex(index) }
  const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index) }
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); setDragOverIndex(null); return }
    const newList = [...playlist]
    const [moved] = newList.splice(dragIndex, 1)
    newList.splice(index, 0, moved)
    setPlaylistOrder(newList)
    setDragIndex(null); setDragOverIndex(null)
  }
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }

  // Mixer touch/mouse drag scroll
  const onMixerMouseDown = (e: React.MouseEvent) => {
    const el = mixerRef.current; if (!el) return
    mixerDragState.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft }
    el.style.cursor = 'grabbing'
  }

  const onMixerMouseMove = (e: React.MouseEvent) => {
    if (!mixerDragState.current.isDown) return
    const el = mixerRef.current; if (!el) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    el.scrollLeft = mixerDragState.current.scrollLeft - (x - mixerDragState.current.startX) * 1.5
  }
  const onMixerMouseUp = () => {
    mixerDragState.current.isDown = false
    if (mixerRef.current) mixerRef.current.style.cursor = 'grab'
  }

  // Export handler (ZIP with audio)
  const handleExport = async () => {
    setIsSaving(true)
    setIsSetlistMenuOpen(false)
    try {
      await exportPlaylist()
    } finally {
      setIsSaving(false)
    }
  }

  // ───────────────── PAINEL ADMIN (/admin) ─────────────────
  if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0e0e10] flex items-center justify-center"><Loader2 size={40} className="text-orange-500 animate-spin" /></div>}>
        <AdminApp />
      </Suspense>
    )
  }

  // ───────────────── PÁGINA DE DOWNLOAD (pública) ─────────────────
  if (typeof window !== 'undefined' && window.location.pathname === '/download') {
    return <DownloadPage />
  }

  // ───────────────── FOLLOWER (acesso via IP na rede local) ─────────────────
  // Tela pública de leitura do músico — não exige login nem engine de áudio,
  // então precisa ser checada ANTES dos bloqueios de auth/loading/splash.
  if (isFollowerMode) {
    return <FollowerView state={followerState} isConnected={isConnected} sendCommand={sendCommand} />
  }

  // ───────────────── AUTH BLOCKING ─────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 size={40} className="text-orange-500 animate-spin" />
      </div>
    )
  }

  if (!supabase) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white px-6">
        <h1 className="text-3xl font-bold mb-4 text-orange-500">Configuração Incompleta</h1>
        <p className="text-gray-400 text-center max-w-md mb-6 leading-relaxed">
          As variáveis de ambiente do banco de dados (<strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_ANON_KEY</strong>) não foram configuradas neste servidor.
        </p>
        <div className="bg-white/5 border border-white/10 p-6 rounded-2xl max-w-lg text-sm text-zinc-400 text-center">
          <p className="mb-2"><strong>Como resolver:</strong></p>
          <p>
            1. Acesse o painel da <strong>Vercel</strong>.<br />
            2. Vá em <strong>Settings &gt; Environment Variables</strong>.<br />
            3. Adicione as mesmas chaves que estão no seu arquivo <code>.env</code> local.<br />
            4. Vá em <strong>Deployments</strong> e clique em <strong>Redeploy</strong> no último build.
          </p>
        </div>
      </div>
    )
  }

  // ───────────────── NOVA SENHA (volta do link de recuperar senha) ─────────────────
  if (isRecoveringPassword) {
    return (
      <NewPasswordPage
        client={supabase}
        onDone={finishPasswordRecovery}
        onCancel={() => { void cancelPasswordRecovery(supabase!).then(() => setShowAuth(true)) }}
      />
    )
  }

  if (!user) {
    // No app desktop a landing não faz sentido (a distribuição é o próprio app):
    // vai direto pro login. A página inicial de marketing é só no site (navegador).
    const isDesktopApp = !!window.playbackDesktop?.isElectron
    if (showAuth || isDesktopApp) return <AuthPage />
    return <LandingPage onEnter={() => setShowAuth(true)} />
  }

  // ───────────────── CONTA BLOQUEADA (pelo admin) ─────────────────
  // No lugar do Separador e do player. Conta admin nunca cai aqui (shouldShowBlocked).
  if (blocked) return <BlockedScreen plan={userPlan} onSignOut={signOut} onDeleteAccount={deleteAccount} />

  // ───────────────── SEPARATOR (acessível da tela inicial) ─────────────────
  // O motor do palco segue tocando com o Separador aberto: ele recebe o estado pra a tela de limite
  // e o anúncio do Livre esperarem a música parar (Ruling R12).
  if (isSeparatorOpen) {
    return <SeparatorStudio onClose={() => setIsSeparatorOpen(false)} stageBusy={{ isPlaying, isCountingIn }} userId={user?.id ?? null} userPlan={userPlan} isAdmin={isAdmin} />
  }

  // ───────────────── ADMIN (dentro do app, só pra quem tem o papel) ─────────────────
  // Se o pedaço do admin não carregar ou quebrar, o InAppAdmin mostra a frase com a volta pro app.
  if (adminPanelShown) {
    return <InAppAdmin load={loadAdminApp} onClose={() => setIsAdminPanelOpen(false)} />
  }

  // ───────────────── SPLASH ─────────────────
  if (!isReady || forceShowSplash) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-text-main flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 sm:w-20 sm:h-20 mb-8 rounded-2xl flex items-center justify-center border border-tinta-border bg-tinta-raised relative animate-boot">
          <PlayMark size="lg" className="relative z-10" />
          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-laranja animate-led"></div>
        </div>
        <h1 className="font-display font-semibold text-3xl sm:text-5xl tracking-tight mb-1 text-center text-white" style={{ letterSpacing: '-0.02em' }}>Playback <span className="text-laranja italic font-medium">Studio</span></h1>
        <p className="text-text-muted mb-10 text-center text-xs sm:text-sm font-mono tracking-widest uppercase">
          A plataforma do domingo
        </p>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
          <button onClick={() => { setForceShowSplash(false); if (!isReady) initEngine(); }}
            className="hw-btn flex-1 text-primary hover:text-white px-6 py-5 rounded-xl text-sm uppercase tracking-widest flex flex-col items-center gap-3 cursor-pointer">
            {isRestoring ? <Loader2 className="animate-spin" size={28} /> : <Play size={28} fill="currentColor" />}
            <span className="font-black">Multitracks</span>
            <span className="text-[10px] font-mono text-text-muted normal-case tracking-wide">Motor de playback profissional</span>
          </button>
          <button onClick={() => setIsSeparatorOpen(true)}
            className="hw-btn flex-1 text-purple-400 hover:text-white px-6 py-5 rounded-xl text-sm uppercase tracking-widest flex flex-col items-center gap-3 cursor-pointer border-purple-900/40 hover:border-purple-500/40">
            <Wand2 size={28} />
            <span className="font-black">Separação de Faixas</span>
            <span className="text-[10px] font-mono text-text-muted normal-case tracking-wide">Separar instrumentos com IA</span>
          </button>
        </div>
        {/* Anúncio da casa (Parte 3): só no Livre, com a música parada, uma vez por dia e no máximo um
            anúncio grande por sessão. "Conhecer o Pro" abre os Planos aqui mesmo. */}
        <div className="mt-6 w-full max-w-md empty:hidden">
          <AdSlot placement="home" userId={user.id} isLivre={livre.isLivre} quiet={engineQuiet} onCta={() => setIsPricingOpen(true)} />
        </div>
        <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} hideOffer={hidePlansOffer} />
      </div>
    )
  }

  // Editor de marcadores do admin (cor, letra e salvar na nuvem), nos dois palcos: no antigo
  // embaixo da barra de seções, no novo dentro das ferramentas do admin do EDITAR.
  const markerEditorPanel = () => (
            <div className="mt-1.5 bg-black/40 rounded-lg border border-white/10 p-2 sm:p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Editor de Marcadores</span>
                <button onClick={() => setIsMarkerEditorOpen(false)} className="text-text-muted hover:text-white text-xs cursor-pointer">✕</button>
              </div>
              {/* Add Marker Form */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={markerLabel}
                  onChange={(e) => setMarkerLabel(e.target.value)}
                  placeholder="Seção (ex: Verso 1)"
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder-text-muted/50 w-28 sm:w-36 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <input
                  type="text"
                  value={markerLyrics}
                  onChange={(e) => setMarkerLyrics(e.target.value)}
                  placeholder="Letra (opcional)"
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder-text-muted/50 flex-1 min-w-[100px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="flex items-center gap-1">
                  {['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'].map(c => (
                    <button
                      key={c}
                      onClick={() => setMarkerColor(c)}
                      className={`w-4 h-4 rounded-full cursor-pointer transition-all ${markerColor === c ? 'ring-2 ring-white scale-110' : 'opacity-50 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (!markerLabel.trim()) return;
                    const activeSong = playlist[activeSongIndex];
                    if (!activeSong) return;
                    const newMarker = {
                      id: crypto.randomUUID(),
                      time: currentTime,
                      label: markerLabel.trim(),
                      lyrics: markerLyrics.trim() || undefined,
                      color: markerColor
                    };
                    const newMarkers = [...(activeSong.markers || []), newMarker].sort((a, b) => a.time - b.time);
                    setSongMarkers(activeSong.id, newMarkers);
                    setMarkerLabel('');
                    setMarkerLyrics('');
                  }}
                  className="bg-primary/20 text-primary px-3 py-1 rounded-md text-xs font-bold hover:bg-primary/30 cursor-pointer active:scale-95 transition-all border border-primary/30"
                >
                  + {formatTime(currentTime)}
                </button>
              </div>
              {/* Existing Markers List */}
              {playlist[activeSongIndex]?.markers && playlist[activeSongIndex].markers!.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {playlist[activeSongIndex].markers!.map((m) => (
                    <div key={m.id} className="flex items-center gap-1 bg-white/5 rounded-md px-1.5 py-0.5 text-[10px] border border-white/5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color || '#fff' }}></span>
                      <span className="text-white/80 font-medium">{formatTime(m.time)}</span>
                      <span className="text-white/60">{m.label}</span>
                      <button
                        onClick={() => {
                          const activeSong = playlist[activeSongIndex];
                          if (!activeSong) return;
                          const newMarkers = (activeSong.markers || []).filter(x => x.id !== m.id);
                          setSongMarkers(activeSong.id, newMarkers);
                        }}
                        className="text-red-400/60 hover:text-red-400 cursor-pointer ml-0.5"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {/* Save to Cloud button */}
              <button
                onClick={async () => {
                  const activeSong = playlist[activeSongIndex];
                  if (!activeSong?.markers) return;
                  // Só a música da nuvem com a id que o download gravou (sourceId), nunca pelo nome.
                  if (!activeSong.sourceId) {
                    alert('Esta música não veio da biblioteca da nuvem: os marcadores ficam só neste aparelho.');
                    return;
                  }
                  const match = cloudSongOf(await fetchCloudSongs(), activeSong);
                  if (match) {
                    const ok = await saveMkToCloud(match.id, activeSong.markers);
                    if (ok) alert(`Marcadores salvos na nuvem em "${match.name}". ☁️`);
                    else alert('Erro ao salvar marcadores na nuvem. Eles continuam neste aparelho.');
                  } else {
                    alert('Música não encontrada na biblioteca da nuvem: os marcadores ficam só neste aparelho.');
                  }
                }}
                className="mt-2 bg-secondary/10 text-secondary px-3 py-1 rounded-md text-[10px] font-bold hover:bg-secondary/20 cursor-pointer active:scale-95 transition-all border border-secondary/20 w-full text-center"
              >
                ☁️ Salvar Marcadores na Nuvem
              </button>
            </div>
  )

  // Ferramentas do admin no EDITAR do palco novo (a casca só mostra pra admin): o admin dentro do
  // app (o mesmo que o botão ADMIN do palco antigo abre), o editor de marcadores e o de letra e cifra.
  const stageAdminTools = useNewStage && isEditMode && isAdmin ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setIsAdminPanelOpen(true)} icon={<Shield size={14} />}>ADMIN</Button>
        <Button tone={isMarkerEditorOpen ? 'on' : 'default'} onClick={() => setIsMarkerEditorOpen(!isMarkerEditorOpen)} icon={<Pencil size={14} />}>Editor avançado</Button>
        <Button onClick={() => setIsLyricsEditorOpen(true)} icon={<Edit2 size={14} />}>Letra e cifra</Button>
      </div>
      {isMarkerEditorOpen && markerEditorPanel()}
    </div>
  ) : null
  // Modais do App abertos (e a tela de limite do Livre): o teclado do palco fica desligado (Espaço não toca por baixo deles).
  const stageKeyboard = !isSettingsOpen && !isLibraryOpen && !isAdminOpen && !isMetronomeModalOpen && !isLyricsEditorOpen
    && !isPadSetsModalOpen && !isPricingOpen && !isLiveModeOpen && !showTour && !showWhatsNew && !isPadSoundsOpen && textPrompt === null
    && livre.limit === null

  // ───────────────── MAIN APP ─────────────────
  return (
    <div className="h-[100dvh] w-screen fixed inset-0 overflow-hidden compact:overflow-y-auto compact:overflow-x-hidden bg-[#0e0e10] text-text-main flex flex-col select-none">

      {useNewStage && stageView ? (
        <>
          {/* Palco novo (T29): a casca toma o lugar do cabeçalho, da faixa do repertório e do conteúdo; modais, teleprompter, tour e Ao Vivo ficam iguais. */}
          {(isLoading || isRestoring) && (
            <div className="absolute inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-ps-or/20"><div className="h-full w-full animate-pulse bg-ps-or" /></div>
          )}
          <StageShell
            view={stageView} actions={stageCalls} clock={stageClock} peaks={stagePeaks} pads={stagePads}
            slots={stageAdminTools ? { ...stageSlots, adminTools: stageAdminTools } : stageSlots}
            keyboardEnabled={stageKeyboard} outputWarning={outputPlan.warning}
          />
        </>
      ) : (
      <>
      {/* ═══ HEADER / TRANSPORT ═══ */}
      <header className="bg-[#18181a] border-b border-border shrink-0">
        {/* Top row: Brand + Tools + Timer */}
        <div className="app-topbar flex compact:hidden items-center justify-between gap-2 px-3 sm:px-4 h-11 sm:h-12 short:h-10 border-b border-border">
          {/* Left: Menu + Brand */}
          <div className="flex items-center gap-1.5 xl:gap-3 shrink-0">
            <div className="relative flex items-center">
              <div className="cursor-default focus:outline-none flex items-center gap-2.5">
                <span className="flex lg:hidden"><BrandLogo size="sm" tone="light" variant="mark" /></span>
                <span className="hidden lg:flex"><BrandLogo size="sm" tone="light" variant="horizontal" /></span>
                <div className={`flex short:hidden items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-mono font-bold transition-all ${isOnline ? 'text-primary/70 border-primary/20 bg-primary/5' : 'text-accent-red border-accent-red/20 bg-accent-red/5'}`}>
                  <span className={`w-1 h-1 rounded-full ${isOnline ? 'bg-primary' : 'bg-accent-red animate-pulse'}`} />
                  <span className="hidden xl:inline">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
              </div>
            </div>

            {/* Toolbar icons */}
            <div className="h-5 w-px bg-border mx-1"></div>
            
            <div className="relative">
              <button data-tour="repertorios" title="Repertórios" aria-label="Repertórios" onClick={() => setIsSetlistMenuOpen(!isSetlistMenuOpen)}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${isSetlistMenuOpen ? 'text-white bg-white/10' : 'text-text-muted hover:text-white'}`}>
                <ListMusic size={14} /> <span className="hidden xl:inline">REPERTÓRIOS</span>
              </button>

              {/* ─── Setlist Dropdown ─── */}
              {isSetlistMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsSetlistMenuOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 sm:w-80 daw-panel rounded-lg z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <button onClick={() => setIsSetlistMenuOpen(false)} className="text-primary text-xs font-bold uppercase tracking-wider cursor-pointer">Cancelar</button>
                      <span className="text-white font-bold text-xs uppercase tracking-wider">Repertórios</span>
                      <div className="w-14"></div>
                    </div>
                    <div className="p-2">
                      <button onClick={() => { clearSession(); setIsSetlistMenuOpen(false); }}
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><Plus size={16} className="text-primary" />Novo Repertório</span>
                        <ChevronRight size={14} className="text-text-muted" />
                      </button>
                      <label
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><FolderOpen size={16} className="text-primary" />Importar multitracks</span>
                        <ChevronRight size={14} className="text-text-muted" />
                        <input type="file" multiple accept={AUDIO_FILE_ACCEPT} className="hidden"
                          onChange={(e) => { if (e.target.files) { importFilesGated(e.target.files); setIsSetlistMenuOpen(false) } }} />
                      </label>
                      <hr className="border-border my-1" />
                      {playlist.length > 0 && (
                        <button onClick={exportZipGated} disabled={isSaving}
                          className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                          <span className="text-white text-sm font-medium flex items-center gap-3">
                            {isSaving ? <Loader2 size={16} className="text-primary animate-spin" /> : <Download size={16} className="text-accent-green" />}
                            {isSaving ? 'Salvando...' : 'Salvar (.zip)'}
                          </span>
                          <ChevronRight size={14} className="text-text-muted" />
                        </button>
                      )}
                      <label
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors">
                        <span className="text-white text-sm font-medium flex items-center gap-3"><Upload size={16} className="text-secondary" />Carregar (.zip)</span>
                        <ChevronRight size={14} className="text-text-muted" />
                        <input type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setIsSetlistMenuOpen(false); importZipGated(f) } }} />
                      </label>
                    </div>
                    {playlist.length > 0 && (
                      <div className="border-t border-border p-2">
                        <div className="px-4 py-1.5 text-[9px] font-bold text-text-muted/50 uppercase tracking-[0.2em]">Atual</div>
                        <div className="px-4 py-2.5 rounded-md bg-white/5 flex items-center gap-3">
                          {playlist[0]?.coverImage ? (
                            <img src={playlist[0].coverImage} className="w-9 h-9 rounded object-cover" alt="" />
                          ) : (
                            <div className="w-9 h-9 rounded bg-primary/10 flex items-center justify-center"><Music size={14} className="text-primary" /></div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-medium text-xs truncate">Repertório Atual</div>
                            <div className="text-text-muted text-[10px] font-mono">{playlist.length} Songs • {formatTime(playlist.reduce((acc, s) => acc + s.duration, 0))}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button data-tour="faixas" title="Faixas" aria-label="Faixas" onClick={() => setIsTracksMenuOpen(!isTracksMenuOpen)}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${isTracksMenuOpen ? 'text-white bg-white/10' : 'text-text-muted hover:text-white'}`}>
                <Music size={14} /> <span className="hidden xl:inline">FAIXAS</span>
              </button>

              {isTracksMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsTracksMenuOpen(false)} />
                  <div className="absolute top-full left-0 mt-2 w-56 glass border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1">
                    <label className="w-full text-left px-4 py-2 text-xs font-medium text-text hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-2">
                        <Upload size={14} /> Importar do dispositivo
                        <input type="file" multiple accept={AUDIO_FILE_ACCEPT} className="hidden"
                          onChange={(e) => { 
                            setIsTracksMenuOpen(false); 
                            if (e.target.files) importFilesGated(e.target.files) 
                          }} />
                    </label>
                    <button onClick={() => {
                      setIsTracksMenuOpen(false);
                      promptEndlessMetronome();
                    }}
                      className="w-full text-left px-4 py-2 text-xs font-medium text-text hover:bg-white/10 transition-colors flex items-center gap-2">
                      <Timer size={14} /> Criar Metrônomo (Infinito)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button data-tour="biblioteca" title="Biblioteca" aria-label="Biblioteca" onClick={() => withPlan(canUsePlatformCatalog(userPlan), () => setIsLibraryOpen(true))}
              className="transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Cloud size={14} /> <span className="hidden xl:inline">BIBLIOTECA</span>
            </button>
            <button data-tour="metronomo" title="Metrônomo" aria-label="Metrônomo" onClick={() => setIsMetronomeModalOpen(true)}
              className="transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Timer size={14} /> <span className="hidden xl:inline">METRÔNOMO</span>
            </button>
          </div>

          {/* Transporte compacto (celular deitado): entra no cabeçalho pra o mixer ganhar a altura.
              Modo ao terminar (AUTO/PARAR/FADE) vira um botão que alterna a cada toque. */}
          <div className="hidden short:flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEndModeGated(cycleEndMode(playbackMode, autoNextAllowed))}
              title={autoNextAllowed ? 'Ao terminar a música: toque pra trocar (Auto, Parar, Fade)' : 'Ao terminar a música: toque pra trocar (Parar, Fade). No Livre, o Auto é do Pro'}
              className={`transport-btn h-8 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider font-mono cursor-pointer whitespace-nowrap ${shownMode === 'continue' ? 'text-primary' : shownMode === 'stop' ? 'text-accent-red' : 'text-purple-400'}`}>
              {shownMode === 'continue' ? '▶ Auto' : shownMode === 'stop' ? '■ Parar' : 'Fade'}
            </button>
            <button onClick={prevSongGated} title="Música anterior" aria-label="Música anterior"
              className="transport-btn w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipBack size={15} /></button>
            <button onClick={isCountingIn ? cancelCountIn : isPlaying ? pause : playWithPrecount} title={isPlaying ? 'Pausar' : 'Tocar'} aria-label={isPlaying ? 'Pausar' : 'Tocar'}
              className={`transport-btn w-11 h-8 flex items-center justify-center rounded-md active:scale-90 cursor-pointer ${isPlaying || isCountingIn ? 'active text-primary' : 'text-white'}`}>
              {isPlaying ? <Pause size={17} fill="currentColor" /> : isCountingIn ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
            </button>
            <button onClick={nextSongGated} title="Próxima música" aria-label="Próxima música"
              className="transport-btn w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipForward size={15} /></button>
          </div>

          {/* Right: Controls + User */}
          <div className="flex items-center gap-1.5 xl:gap-3 shrink-0">

            {/* Key Selector */}
            <div className="relative">
              <button data-tour="tom" onClick={() => withPlan(canChangeKey(userPlan), () => setIsKeyPickerOpen(!isKeyPickerOpen))}
                className={`transport-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${isKeyPickerOpen ? 'text-primary' : 'text-text-muted hover:text-white'}`}>
                <span>TOM</span>
                {currentKeyName && <span className="text-primary font-mono">{currentKeyName}</span>}
              </button>
              {isKeyPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsKeyPickerOpen(false)} />
                  <div className="absolute top-full mt-1 right-0 daw-panel rounded-lg z-50 p-3 w-48">
                    <p className="text-[10px] text-text-muted mb-2 font-mono">
                      {hasOriginalKey ? 'Selecionar tom:' : 'Tom original desconhecido. Defina manualmente:'}
                    </p>
                    <div className="grid grid-cols-4 gap-1">
                      {KEY_NAMES.map(key => {
                        const isCurrent = key === currentKeyName
                        const isOriginal = KEY_NAMES.indexOf(key) === originalKeyIndex && !isCurrent
                        return (
                          <button key={key} onClick={() => {
                            if (hasOriginalKey) {
                              changePitch(semitonesBetweenKeys(activeOriginalKey, key))
                            } else {
                              setOriginalKey(key)
                              changePitch(0)
                            }
                            setIsKeyPickerOpen(false)
                          }}
                            className={`py-1.5 text-[10px] font-bold rounded transition-colors cursor-pointer font-mono ${isCurrent ? 'bg-primary text-black' : isOriginal ? 'bg-white/15 text-white border border-white/20' : 'text-white/70 bg-white/5 hover:bg-primary/20 hover:text-primary'}`}>
                            {key}
                          </button>
                        )
                      })}
                    </div>
                    {activeOriginalKey && (
                      <button onClick={() => { setOriginalKey(null); changePitch(0); setIsKeyPickerOpen(false); }}
                        className="mt-2 w-full text-[9px] text-text-muted hover:text-accent-red cursor-pointer text-center transition-colors font-mono">
                        Redefinir detecção de tom
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Pré-contagem */}
            <div className="relative">
              <button
                data-tour="precontagem"
                onClick={() => setIsPrecountOpen(!isPrecountOpen)}
                className={`transport-btn flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${precountEnabled ? 'text-primary' : 'text-text-muted hover:text-white'}`}
                title="Pré-contagem"
              >
                <span className="min-[1680px]:hidden text-[10px] font-mono tracking-wider whitespace-nowrap">1·2·3</span>
                <span className="hidden min-[1680px]:inline whitespace-nowrap">PRÉ-CONTAGEM</span>
              </button>
              {isPrecountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsPrecountOpen(false)} />
                  <div className="absolute top-full mt-1 right-0 daw-panel rounded-lg z-50 p-4 w-64">
                    {/* Toggle row */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-white text-sm font-bold">Pré-contagem</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePrecountEnabled(!precountEnabled); }}
                        className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${precountEnabled ? 'bg-primary' : 'bg-white/10'}`}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow"
                          style={{ transform: precountEnabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s' }}
                        />
                      </button>
                    </div>
                    {/* Beat count */}
                    <p className="text-text-muted text-xs mb-3">Clicks antes da reprodução começar</p>
                    <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2">
                      <button
                        onClick={() => setPrecountBeats(precountBeats - 1)}
                        className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold"
                      >−</button>
                      <span className="text-white font-black text-3xl w-12 text-center">{precountBeats}</span>
                      <button
                        onClick={() => setPrecountBeats(precountBeats + 1)}
                        className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold"
                      >+</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="h-5 w-px bg-border hidden sm:block short:hidden"></div>

            {/* EDITAR */}
            <button data-tour="editar" title="Editar" aria-label="Editar" onClick={() => setIsEditMode(!isEditMode)}
              className={`items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 border cursor-pointer hidden sm:flex ${isEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border hover:bg-white/5 hover:text-white'}`}>
              {isEditMode ? <Check size={12} /> : <Edit2 size={12} />}
              <span className="hidden min-[1680px]:inline">{isEditMode ? 'OK' : 'EDITAR'}</span>
            </button>

            {/* Admin: abre dentro do app, só pra quem tem o papel */}
            <AdminEntryButton isAdmin={isAdmin} variant="toolbar"
              onOpen={() => { setIsAdminPanelOpen(true); setIsMobileDrawerOpen(false) }} />

            {/* Live Mode - only for Electron */}
            {window.playbackDesktop?.isElectron && (
              <button data-tour="host" onClick={handleStartLiveMode}
                className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-primary hover:bg-primary/10 border border-primary/20 hover:border-primary/40 transition-all">
                <Server size={14} /><span className="hidden min-[1680px]:inline uppercase">Host</span>
              </button>
            )}

            {/* Atualização disponível (desktop) */}
            {desktopUpdate && (
              <button onClick={installDesktopUpdate} title={`Baixar versão ${desktopUpdate.latestVersion}`}
                className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-black bg-primary hover:bg-primary/90 border border-primary transition-all">
                <Download size={14} /><span className="hidden min-[1680px]:inline uppercase">Atualizar</span>
              </button>
            )}

            {/* Config */}
            <button data-tour="config" title="Configurações" aria-label="Configurações" onClick={() => setIsSettingsOpen(true)}
              className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white">
              <Settings size={14} /><span className="hidden min-[1680px]:inline">CONFIG</span>
            </button>

            {/* Início */}
            <button data-tour="inicio" title="Início" aria-label="Início" onClick={() => setForceShowSplash(true)}
              className="transport-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-white border border-border hover:border-white/20 transition-all">
              <Home size={14} /><span className="hidden min-[1680px]:inline">INÍCIO</span>
            </button>

            <div className="h-5 w-px bg-border hidden sm:block short:hidden"></div>

            {/* User + SAIR */}
            <button onClick={() => setIsSettingsOpen(true)} className="items-center gap-2 hidden sm:flex short:hidden cursor-pointer group" title="Meu perfil">
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border border-white/15" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-[10px] font-black">
                  {(user.user_metadata?.display_name || user.email || '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden min-[1680px]:inline text-white text-[10px] font-mono font-medium group-hover:text-primary transition-colors">{user.user_metadata?.display_name || user.email?.split('@')[0]}</span>
            </button>
            <button onClick={signOut} title="Sair" aria-label="Sair"
              className="transport-btn flex short:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer text-text-muted hover:text-accent-red border border-border hover:border-accent-red/40 transition-all">
              <LogOut size={12} /><span className="hidden min-[1680px]:inline font-mono">SAIR</span>
            </button>
          </div>
        </div>

        {/* ═══ MOBILE PORTRAIT HEADER ═══ */}
        <div className="hidden compact:flex items-center px-3 h-12 border-b border-border relative">
          <button
            onClick={() => { setIsMobileDrawerOpen(true); setMobileDrawerView('main'); }}
            className="text-text-muted hover:text-white p-1.5 -ml-1.5 rounded-md cursor-pointer active:scale-90 transition-transform"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
            <BrandLogo size="sm" tone="light" variant="horizontal" />
          </div>
          <div className="ml-auto flex items-center">
            <div className={`w-2 h-2 rounded-full border border-black/50 ${isOnline ? 'bg-primary' : 'bg-accent-red animate-pulse'}`} title={isOnline ? 'Online' : 'Offline'} />
          </div>
        </div>

        {/* Mobile portrait: action buttons grid */}
        <div className="hidden compact:grid grid-cols-5 gap-1.5 px-3 py-2.5 border-b border-border bg-[#141416]">
          {/* REPERTÓRIO */}
          <div className="relative">
            <button
              onClick={() => setIsSetlistMenuOpen(!isSetlistMenuOpen)}
              className={`w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[9px] font-bold cursor-pointer transition-all active:scale-95 border ${isSetlistMenuOpen ? 'bg-white/10 text-white border-white/10' : 'bg-transparent text-text-muted border-border hover:text-white'}`}
            >
              <ListMusic size={16} />
              <span className="tracking-wider font-mono">REPERT.</span>
            </button>
            {isSetlistMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSetlistMenuOpen(false)} />
                <div className="absolute top-full left-0 mt-2 w-72 daw-panel rounded-lg z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <button onClick={() => setIsSetlistMenuOpen(false)} className="text-primary text-xs font-bold uppercase tracking-wider cursor-pointer">Cancelar</button>
                    <span className="text-white font-bold text-xs uppercase tracking-wider">Repertórios</span>
                    <div className="w-14" />
                  </div>
                  <div className="p-2">
                    <button onClick={() => { clearSession(); setIsSetlistMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer">
                      <span className="text-white text-sm font-medium flex items-center gap-3"><Plus size={16} className="text-primary" />Novo Repertório</span>
                      <ChevronRight size={14} className="text-text-muted" />
                    </button>
                    <label className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer">
                      <span className="text-white text-sm font-medium flex items-center gap-3"><FolderOpen size={16} className="text-primary" />Importar multitracks</span>
                      <ChevronRight size={14} className="text-text-muted" />
                      <input type="file" multiple accept={AUDIO_FILE_ACCEPT} className="hidden"
                        onChange={(e) => { if (e.target.files) { importFilesGated(e.target.files); setIsSetlistMenuOpen(false) } }} />
                    </label>
                    <hr className="border-border my-1" />
                    {playlist.length > 0 && (
                      <button onClick={exportZipGated} disabled={isSaving}
                        className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer">
                        <span className="text-white text-sm font-medium flex items-center gap-3">
                          {isSaving ? <Loader2 size={16} className="text-primary animate-spin" /> : <Download size={16} className="text-accent-green" />}
                          {isSaving ? 'Salvando...' : 'Salvar (.zip)'}
                        </span>
                        <ChevronRight size={14} className="text-text-muted" />
                      </button>
                    )}
                    <label className="w-full text-left px-4 py-2.5 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer">
                      <span className="text-white text-sm font-medium flex items-center gap-3"><Upload size={16} className="text-secondary" />Carregar (.zip)</span>
                      <ChevronRight size={14} className="text-text-muted" />
                      <input type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setIsSetlistMenuOpen(false); importZipGated(f) } }} />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* METRÔNOMO */}
          <button
            onClick={() => setIsMetronomeModalOpen(true)}
            className="w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[9px] font-bold cursor-pointer transition-all active:scale-95 border bg-transparent text-text-muted border-border hover:text-white"
          >
            <Timer size={16} />
            <span className="tracking-wider font-mono">METRO</span>
          </button>

          {/* PRÉ-CONTAGEM */}
          <div className="relative">
            <button
              onClick={() => setIsPrecountOpen(!isPrecountOpen)}
              className={`w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[9px] font-bold cursor-pointer transition-all active:scale-95 border ${precountEnabled ? 'border-primary/30 text-primary bg-primary/5' : 'bg-transparent text-text-muted border-border hover:text-white'}`}
            >
              <span className="text-[11px] font-mono font-bold tracking-tight">1·2·3</span>
              <span className="tracking-wider font-mono">PRÉ</span>
            </button>
            {isPrecountOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsPrecountOpen(false)} />
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 daw-panel rounded-lg z-50 p-4 w-64">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-white text-sm font-bold">Pré-contagem</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePrecountEnabled(!precountEnabled); }}
                      className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${precountEnabled ? 'bg-primary' : 'bg-white/10'}`}
                    >
                      <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow"
                        style={{ transform: precountEnabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s' }} />
                    </button>
                  </div>
                  <p className="text-text-muted text-xs mb-3">Clicks antes da reprodução começar</p>
                  <div className="flex items-center justify-between bg-[#141415] border border-white/5 rounded-xl p-2">
                    <button onClick={() => setPrecountBeats(precountBeats - 1)}
                      className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold">−</button>
                    <span className="text-white font-black text-3xl w-12 text-center">{precountBeats}</span>
                    <button onClick={() => setPrecountBeats(precountBeats + 1)}
                      className="w-10 h-10 flex items-center justify-center bg-[#2a2a2d] hover:bg-[#343438] rounded-lg active:scale-95 transition-all text-white/80 cursor-pointer text-lg font-bold">+</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* EDITAR */}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[9px] font-bold cursor-pointer transition-all active:scale-95 border ${isEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border hover:text-white'}`}
          >
            {isEditMode ? <Check size={16} /> : <Edit2 size={16} />}
            <span className="tracking-wider font-mono">{isEditMode ? 'OK' : 'EDIT'}</span>
          </button>

          {/* INÍCIO */}
          <button
            onClick={() => setForceShowSplash(true)}
            className="w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[9px] font-bold cursor-pointer transition-all active:scale-95 border bg-transparent text-text-muted border-border hover:text-white"
          >
            <Home size={16} />
            <span className="tracking-wider font-mono">INÍCIO</span>
          </button>
        </div>

        {/* Transport Controls Row */}
        <div className="flex flex-col tight:flex-row tight:justify-center items-center px-3 py-2 sm:py-2.5 tight:py-1.5 short:py-1 short:hidden bg-[#141416] gap-1 tight:gap-4">
          {/* Playback Mode — acima dos controles */}
          <div data-tour="modos" className="hidden sm:flex items-center lcd-display rounded-md overflow-hidden">
            <button onClick={() => setEndModeGated('continue')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono ${shownMode === 'continue' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title={autoNextAllowed ? 'Continuar para próxima música' : 'No Livre, passar sozinho pra próxima música é do Pro'}>▶ AUTO{!autoNextAllowed && <span className="ml-1 px-1 rounded bg-white/10 text-[7px] text-text-muted">LIVRE</span>}</button>
            <button onClick={() => setEndModeGated('stop')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider border-l border-r border-border transition-all cursor-pointer font-mono ${shownMode === 'stop' ? 'bg-accent-red/15 text-accent-red' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title="Parar no final">⏹ PARAR</button>
            <button onClick={() => setEndModeGated('fade-out')}
              className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono ${shownMode === 'fade-out' ? 'bg-purple-500/15 text-purple-400' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              title="Fade nos últimos 5 segundos">🔉 FADE</button>
          </div>

          {/* Play controls — centralizados abaixo */}
          <div className="flex items-center gap-1.5">
            <button onClick={prevSongGated} className="transport-btn p-2 rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipBack size={18} /></button>
            <button data-tour="play" onClick={isCountingIn ? cancelCountIn : isPlaying ? pause : playWithPrecount}
              className={`transport-btn p-3 short:p-2 rounded-lg active:scale-90 cursor-pointer ${isPlaying || isCountingIn ? 'active text-primary' : 'text-white'}`}>
              {isPlaying ? <Pause size={24} fill="currentColor" /> : isCountingIn ? <Loader2 size={24} className="animate-spin" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
            </button>
            <button onClick={nextSongGated} className="transport-btn p-2 rounded-md text-text-muted hover:text-white active:scale-90 cursor-pointer"><SkipForward size={18} /></button>
            {/* Mobile edit toggle (landscape only — portrait has it in the buttons grid) */}
            <button onClick={() => setIsEditMode(!isEditMode)}
              className={`hidden ml-2 items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors border cursor-pointer ${isEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border'}`}>
              {isEditMode ? <Check size={12} /> : <Edit2 size={12} />}
            </button>
          </div>
        </div>
      </header>

      {/* Loading bar */}
      {(isLoading || isRestoring) && (
        <div className="h-1 bg-primary/20 overflow-hidden z-50"><div className="h-full bg-primary animate-pulse w-full"></div></div>
      )}

      {/* ═══ SETLIST & NOTES AREA ═══ */}
      <section data-tour="setlist-area" className="h-56 sm:h-48 tight:h-36 short:h-[64px] border-b border-border bg-[#141416] flex flex-col sm:flex-row shrink-0 relative overflow-hidden">
        {/* Left: Notes Panel */}
        <div data-tour="anotacoes" className="h-20 sm:h-auto w-full sm:w-80 tight:w-64 short:w-52 border-b sm:border-b-0 sm:border-r border-[#222] p-3 short:p-2 flex flex-col bg-[#0e0e10] shrink-0">
          <div className="text-[10px] font-bold text-text-muted/60 uppercase tracking-[0.15em] mb-2 short:mb-1 font-mono flex items-center justify-between">
            Anotações
            <Edit2 size={10} className="text-text-muted/40" />
          </div>
          <textarea 
            className="flex-1 w-full bg-[#141416] border border-[#222] rounded-md p-2.5 short:p-1.5 text-[11px] sm:text-xs text-text-main resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
            placeholder="Ex: 1. Abertura (Tom: C)&#10;2. Medley Rápido (Tom: G)..."
            value={repertoireNotes}
            onChange={(e) => setRepertoireNotes(e.target.value)}
          />
        </div>

        {/* Right: Repertoire Horizontal Scroll */}
        <div className="flex-1 p-3 short:p-2 overflow-x-auto overflow-y-hidden bg-[#141416] relative scrollbar-hide flex flex-col">
          <div className="text-[10px] font-bold text-text-muted/40 uppercase tracking-[0.2em] font-mono mb-2 shrink-0 short:hidden">FAIXAS NO REPERTÓRIO</div>
          
          <div className="flex flex-1 items-center gap-3">
            {playlist.map((song, i) => (
              <div key={song.id}
                draggable={isEditMode}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                onClick={() => !isEditMode && jumpToSongGated(i)}
                className={`
                  flex-none w-48 sm:w-72 tight:w-60 short:w-52 h-full rounded-md flex flex-col p-3 short:p-1.5 gap-2 short:gap-0 border transition-all overflow-hidden relative justify-center
                  ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-border-light'}
                  ${isEditMode && dragOverIndex === i ? 'border-primary border-2 bg-primary/5' : ''}
                  ${isEditMode && dragIndex === i ? 'opacity-40' : ''}
                  ${i === activeSongIndex && !isEditMode ? 'bg-surface border-primary/40 text-white shadow-[0_0_12px_rgba(212,168,67,0.08)] z-[2]' : 'bg-[#1a1a1c] border-border text-text-muted'}
                  ${isEditMode && !(dragOverIndex === i) && !(dragIndex === i) ? 'border-dashed border-text-muted/20' : ''}
                `}>
                
                <div className="flex items-center gap-3 h-full">
                  {/* Cover */}
                  <div className="w-14 h-14 sm:w-16 sm:h-16 tight:w-12 tight:h-12 short:w-9 short:h-9 rounded bg-black/40 flex-shrink-0 overflow-hidden relative group flex items-center justify-center border border-border shadow-md">
                    {song.coverImage ? (
                      <img src={song.coverImage} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music size={20} className="opacity-15" />
                    )}
                    {isEditMode && (
                      <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                        <Edit2 size={12} className="text-white mb-0.5" />
                        <span className="text-[8px] font-bold text-white uppercase tracking-wider">COVER</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) { const reader = new FileReader(); reader.onload = (ev) => setCoverImage(song.id, ev.target?.result as string); reader.readAsDataURL(f); }
                        }} />
                      </label>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-center min-w-0 pr-1 gap-1 short:gap-0.5">
                    {isEditMode ? (
                      <>
                        <input type="text"
                          className="w-full daw-input text-xs sm:text-sm font-bold text-white px-2 py-1 rounded mb-0.5"
                          value={song.name}
                          onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} draggable={false}
                          onChange={(e) => renameSong(song.id, e.target.value)}
                        />
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1 text-text-muted/40">
                            <GripVertical size={12} /><span className="text-[10px] font-mono">ARRASTAR</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeSongGated(song.id); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            draggable={false}
                            className="p-1 rounded text-accent-red/60 hover:text-accent-red hover:bg-accent-red/10 transition-all cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const parts = song.name.split(' - ')
                          const artist = parts.length >= 2 ? parts[0].trim() : ''
                          const title = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : song.name
                          return (
                            <>
                              <div className={`font-bold text-xs sm:text-sm short:text-xs truncate leading-snug ${i === activeSongIndex ? 'text-white' : 'text-text-main/80'}`}>
                                {i + 1}. {title}
                              </div>
                              {artist && (
                                <div className="text-[10px] text-text-muted/60 truncate font-mono short:hidden">{artist}</div>
                              )}
                              <div className="flex items-center gap-2 mt-0.5 short:mt-0">
                                {song.originalKey && (
                                  <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{song.originalKey}</span>
                                )}
                                {song.bpm && (
                                  <span className="text-[9px] font-mono text-text-muted/60 whitespace-nowrap">{song.bpm} BPM</span>
                                )}
                                <span className="text-[9px] font-mono text-text-muted/50 ml-auto flex items-center gap-1">
                                  {i === activeSongIndex && isPlaying && <Play size={8} fill="currentColor" className="text-primary" />}
                                  {i === activeSongIndex && !isPlaying && <div className="w-1 h-1 rounded-full bg-primary/50"></div>}
                                  {formatTime(song.duration)}
                                </span>
                              </div>
                            </>
                          )
                        })()}
                      </>
                    )}
                  </div>
                </div>

                {/* Active indicator bar */}
                {i === activeSongIndex && !isEditMode && <div className="absolute bottom-0 left-3 right-3 h-[3px] short:h-[2px] bg-primary rounded-t-sm shadow-[0_0_8px_rgba(212,168,67,1)]"></div>}
              </div>
            ))}
          </div>

          {playlist.length === 0 && (
            <div className="text-[10px] sm:text-xs text-text-muted/30 flex flex-col items-center justify-center w-full h-full py-8 gap-2 font-mono uppercase tracking-wider">
              <ListMusic size={24} className="opacity-30" />
              <span>Importe faixas para começar</span>
            </div>
          )}
        </div>
      </section>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden compact:overflow-visible compact:flex-none">

        {/* Timeline */}
        <section className="border-b border-border px-3 sm:px-4 py-1.5 sm:py-2 short:py-1 flex flex-col relative shrink-0 bg-[#111113]">
          {/* Progress Bar */}
          <div className="h-6 sm:h-7 bg-[#0a0a0c] rounded relative overflow-hidden border border-border cursor-pointer group">
            {/* Fill */}
            <div className="absolute inset-y-0 left-0 bg-primary/10 transition-none pointer-events-none" style={{ width: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />
            {/* Playhead */}
            <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)] z-10 pointer-events-none" style={{ left: duration > 0 ? `${((isDraggingTimeline ? localDragTime : currentTime) / duration) * 100}%` : '0%' }} />
            
            {/* Timer Output in Progress Bar */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none z-[15] font-mono text-[11px] sm:text-[13px] font-bold text-accent-yellow tracking-widest flex items-baseline gap-1" style={{ textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.5)' }}>
              {formatTime(isDraggingTimeline ? localDragTime : currentTime)}
              <span className="text-[10px] sm:text-[11px] text-text-muted">/ {formatTime(duration)}</span>
            </div>

            {/* Marker lines inside bar */}
            {playlist[activeSongIndex]?.markers?.map((marker) => (
              <div
                key={marker.id}
                className="absolute inset-y-0 w-px pointer-events-none z-[5]"
                style={{
                  left: duration > 0 ? `${(marker.time / duration) * 100}%` : '0%',
                  backgroundColor: `${marker.color || '#fff'}40`
                }}
              />
            ))}

            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={isDraggingTimeline ? localDragTime : currentTime}
              onMouseDown={() => {
                setIsDraggingTimeline(true);
                setLocalDragTime(currentTime);
              }}
              onTouchStart={() => {
                setIsDraggingTimeline(true);
                setLocalDragTime(currentTime);
              }}
              onChange={(e) => {
                setLocalDragTime(parseFloat(e.target.value));
              }}
              onMouseUp={(e) => {
                setIsDraggingTimeline(false);
                seekTo(parseFloat((e.target as HTMLInputElement).value));
              }}
              onTouchEnd={(e) => {
                setIsDraggingTimeline(false);
                seekTo(parseFloat((e.target as HTMLInputElement).value));
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            />
          </div>

          {/* Barra de Seções: chips + loop (N/∞) + voltar + marcar */}
          {playlist[activeSongIndex] && (
            <div data-tour="secoes">
              <SectionBar
                markers={playlist[activeSongIndex].markers || []}
                currentMarkerId={currentMarker?.id || null}
                currentTime={currentTime}
                duration={duration}
                waveBuffer={sectionWaveBuffer}
                bpm={playlist[activeSongIndex].bpm}
                activeLoop={activeLoop}
                pendingJump={pendingJump}
                canEdit={!!user}
                infiniteAllowed={canUseSections(userPlan)}
                maxRepeats={9}
                onUpgrade={() => openPlans()}
                onSeek={seekTo}
                onArmLoop={armLoop}
                onCancelLoop={cancelLoop}
                onArmJump={armJump}
                onCancelJump={cancelJump}
                onAddMarker={addSectionMarker}
                onRemoveMarker={(id) => {
                  const activeSong = playlist[activeSongIndex];
                  if (!activeSong) return;
                  setSongMarkers(activeSong.id, (activeSong.markers || []).filter((x) => x.id !== id));
                }}
              />
              {/* Ferramentas avançadas (admin): cor/letra por marcador + salvar na nuvem */}
              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <button
                    onClick={() => setIsMarkerEditorOpen(!isMarkerEditorOpen)}
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide cursor-pointer active:scale-95 border transition-all ${isMarkerEditorOpen ? 'bg-primary/20 text-primary border-primary/40' : 'text-text-muted border-white/10 hover:bg-white/5'}`}
                  >
                    ✏️ Editor avançado
                  </button>
                  <button
                    onClick={() => setIsLyricsEditorOpen(true)}
                    className="shrink-0 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide cursor-pointer active:scale-95 border transition-all text-text-muted border-white/10 hover:bg-white/5"
                  >
                    📝 Letra/Cifra
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─── Marker Editor Panel (Admin) ─── */}
          {isMarkerEditorOpen && isAdmin && markerEditorPanel()}
        </section>

        {/* ─── Mobile View Toggle ─── */}
        <div className="flex md:hidden border-b border-border bg-[#141416] shrink-0">
          <button onClick={() => setMobileView('mixer')}
            className={`flex-1 py-2 short:py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors cursor-pointer font-mono ${mobileView === 'mixer' ? 'text-primary border-b-2 border-primary' : 'text-text-muted'}`}>
            MIXER
          </button>
          <button onClick={() => setMobileView('pads')}
            className={`flex-1 py-2 short:py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors cursor-pointer font-mono ${mobileView === 'pads' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted'}`}>
            PADS
          </button>
        </div>

        {/* ─── Lower Split ─── */}
        <section className="flex-1 min-h-0 flex overflow-hidden compact:min-h-[72dvh]">

          {/* ═══ MIXER ═══ */}
          <div ref={mixerRef} data-tour="mixer"
            className={`bg-[#111113] overflow-x-auto flex flex-col items-stretch
              ${mobileView === 'mixer' ? 'flex' : 'hidden'} md:flex flex-1`}
            style={{ touchAction: 'pan-x' }}>

            {/* Mixer Toolbar */}
            {channels.length > 0 && (
              <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 short:py-0.5 border-b border-border bg-[#141416] shrink-0">
                <span className="text-[9px] font-mono font-bold text-text-muted/40 uppercase tracking-[0.2em]">MIXER • {channels.length} CANAIS</span>
                <button onClick={() => { setIsChannelEditMode(!isChannelEditMode); channelTrash.disarm() }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all active:scale-95 border cursor-pointer ${isChannelEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'bg-transparent text-text-muted border-border hover:bg-white/5'}`}>
                  {isChannelEditMode ? <Check size={10} /> : <Move size={10} />}
                  {isChannelEditMode ? 'PRONTO' : 'EDITAR CANAIS'}
                </button>
              </div>
            )}

            <div ref={stripsRef} className="flex-1 min-h-0 flex flex-nowrap items-stretch p-3 sm:p-4 tight:p-2 short:p-1.5 gap-1 overflow-x-auto overflow-y-hidden pointer-coarse:snap-x pointer-coarse:snap-mandatory"
              style={{ cursor: 'grab' }}
              onMouseDown={onMixerMouseDown} onMouseMove={onMixerMouseMove} onMouseUp={onMixerMouseUp} onMouseLeave={onMixerMouseUp}>

            {channels.map((ch, idx) => {
              const chLabel = channelLabels.get(ch.id)
              const chColor = chLabel?.color ?? FAMILY_COLOR.desconhecido
              const chName = chLabel?.label ?? ch.name
              // Click e Guia continuam tocando com Solo em outro canal; o M vale pra todos.
              const isMutedByOther = ch.muted || isSilencedBySolo(ch, channels)
              return (
              <div key={ch.id}
                draggable={isChannelEditMode}
                onDragStart={() => onChDragStart(idx)}
                onDragOver={(e) => onChDragOver(e, idx)}
                onDrop={() => onChDrop(idx)}
                onDragEnd={onChDragEnd}
                className={`channel-strip [width:var(--strip-w,6rem)] snap-start h-full min-h-0 rounded-md flex flex-col items-center p-1.5 sm:p-2 pt-1 flex-shrink-0 relative overflow-hidden ${isChannelEditMode ? 'cursor-grab active:cursor-grabbing' : ''} ${isChannelEditMode && chDragOverIdx === idx ? 'border-primary border-2' : ''} ${isChannelEditMode && chDragIdx === idx ? 'opacity-40' : ''}`}>
                {/* Group color strip */}
                <div className="channel-group-strip" style={{ backgroundColor: chColor }}></div>

                {/* Active glow */}
                {(isPlaying && ch.volume > 0 && !isMutedByOther) && (
                  <div className="absolute inset-0 rounded-md pointer-events-none" style={{ border: `1px solid ${chColor}15` }}></div>
                )}

                {/* Nome do canal: sempre inteiro, quebra linha (até trecho único sem espaço) em vez de cortar */}
                <div className="w-full text-center text-[9px] sm:text-[10px] font-semibold leading-[11px] min-h-[22px] wrap-anywhere mt-1 mb-1.5 short:mt-0.5 short:mb-0.5" style={{ color: chColor }} title={`${chName} (arquivo: ${ch.name})`}>
                  {chName}
                </div>

                {/* Pan Knob container */}
                <div className="logic-pan-knob-container mb-2 short:mb-0.5 w-full">
                  <div className="logic-pan-knob"
                    title={`Pan: ${ch.pan === 0 ? 'C' : ch.pan < 0 ? 'L'+Math.round(Math.abs(ch.pan) * 100) : 'R'+Math.round(ch.pan * 100)}`}
                    onDoubleClick={() => updatePan(ch.id, 0)}
                    onPointerDown={(e) => handlePanPointerDown(e, ch.id, ch.pan)}
                    onPointerMove={handlePanPointerMove}
                    onPointerUp={handlePanPointerUp}
                    onPointerCancel={handlePanPointerUp}
                    onWheel={(e) => {
                      e.stopPropagation()
                      const newPan = Math.max(-1, Math.min(1, ch.pan + (e.deltaY > 0 ? -0.1 : 0.1)))
                      updatePan(ch.id, Math.round(newPan * 10) / 10)
                    }}>
                    <div className="logic-pan-indicator" style={{ transform: `rotate(${ch.pan * 135}deg)` }}></div>
                  </div>
                  {/* Values box like Logic: Pan | Vol */}
                  <div className="flex justify-center gap-1 mt-1 w-full px-1 short:hidden">
                    <div className="bg-[#1a1a1c] text-[#ddd] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-8 text-center flex-1">
                      {ch.pan === 0 ? '0.0' : ch.pan > 0 ? `+${Math.round(ch.pan * 50)}` : `${Math.round(ch.pan * 50)}`}
                    </div>
                    <div className="bg-[#1a1a1c] text-[#4ade80] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-8 text-center flex-1 truncate">
                      {ch.volume === 0 ? '-∞' : `${(ch.volume * 10 - 10).toFixed(1)}`}
                    </div>
                  </div>
                </div>

                {/* Fader + VU Meter */}
                <div className="flex-1 min-h-0 w-full flex justify-center py-1 mt-1 mb-2 short:mt-0 short:mb-1 relative gap-1 lg:gap-2">
                  {/* Fader Track */}
                  <div className="relative h-full flex justify-center w-6">
                    <input type="range" min="0" max="1.2" step="0.01" value={ch.volume}
                      onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                      onChange={(e) => updateVolume(ch.id, parseFloat(e.target.value))}
                      className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                      style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                    <div className="logic-fader-track h-full w-3 sm:w-4 relative pointer-events-none">
                      <div className="logic-fader-fill" style={{ 
                        height: `${(Math.min(ch.volume, OLD_FADER_MAX) / OLD_FADER_MAX) * 100}%`, 
                        background: channelFaderFill(chColor, isMutedByOther)
                      }}></div>
                    </div>
                    <div className="logic-fader-knob absolute pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(Math.min(ch.volume, OLD_FADER_MAX) / OLD_FADER_MAX) * 100}% - var(--knob-half, 26px))` }}>
                    </div>
                  </div>

                  {/* Spacer / Decals could go here */}
                  <div className="w-2 hidden sm:block"></div>

                  {/* VU Meter Right */}
                  {renderVU(ch.id)}
                </div>

                {/* M/S Buttons */}
                <div className="flex gap-1 mb-1.5 w-[90%] px-0.5 justify-center mt-auto">
                  <button onClick={() => toggleMute(ch.id)} className={`flex-1 h-5 sm:h-6 pointer-coarse:h-7 rounded text-[9px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${ch.muted ? 'bg-[#ff3b30] text-white shadow-[0_0_8px_rgba(255,59,48,0.6)]' : 'bg-[#444] text-[#999] hover:bg-[#555]'}`}>M</button>
                  <button onClick={() => toggleSolo(ch.id)} className={`flex-1 h-5 sm:h-6 pointer-coarse:h-7 rounded text-[9px] font-black transition-all active:scale-90 cursor-pointer border border-[#222] ${ch.soloed ? 'bg-[#ffcc00] text-black shadow-[0_0_8px_rgba(255,204,0,0.6)]' : 'bg-[#444] text-[#999] hover:bg-[#555]'}`}>S</button>
                </div>

                {/* Channel Edit Overlay */}
                {isChannelEditMode && (
                  <div className="channel-edit-overlay">
                    {/* mt-auto aqui e na lixeira: alça e lápis no meio do espaço acima da lixeira, que fica no pé */}
                    <GripVertical size={16} className="text-text-muted/60 mb-1 mt-auto" />
                    <span className="text-[7px] font-mono text-text-muted/50 uppercase tracking-wider">Arrastar</span>
                    <Button
                      icon={<Pencil size={16} />}
                      aria-label="Renomear e escolher papel"
                      title="Renomear e escolher papel"
                      onClick={(e) => { e.stopPropagation(); setEditing({ channelId: ch.id, songIndex: activeSongIndex }) }}
                      className="mt-2"
                    />
                    {chLabel && chLabel.role !== 'normal' && (
                      <span className="max-w-full px-1 text-center font-ps-sans text-ps-sm font-semibold text-ps-bone break-words">
                        Papel: {chLabel.role === 'click' ? 'Click' : 'Guia'}
                      </span>
                    )}
                    {/* Pé da sobreposição, longe do lápis: 6px do gap + 18px = pelo menos 24px. */}
                    <div className="mt-auto flex justify-center pt-[18px] pb-2">
                      <ChannelTrashButton channelLabel={chName} armed={channelTrash.armedId === ch.id}
                        onPress={() => channelTrash.press(ch.id)} />
                    </div>
                  </div>
                )}
              </div>
              )
            })}

            {playlist.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-text-muted/20 border border-dashed border-border rounded-md flex-col gap-3 p-4">
                <Music size={32} className="opacity-20" />
                <span className="text-[10px] font-mono uppercase tracking-wider">Importe faixas para começar</span>
              </div>
            )}

            <div className="flex-1"></div>

            {/* Master Fader */}
            <div className="channel-strip w-28 sm:w-32 short:w-24 h-full min-h-0 rounded-md flex flex-col items-center p-1.5 sm:p-2 pt-1 flex-shrink-0 ml-2 sm:ml-4 relative border-primary/20 bg-[#38383a]">
              <div className="channel-group-strip" style={{ backgroundColor: '#d4a843' }}></div>
              <div className="font-bold text-[8px] sm:text-[9px] tracking-[0.08em] w-full text-center mb-1.5 uppercase font-mono mt-1" style={{ color: '#d4a843' }}>
                PRINCIPAL
              </div>

              {/* Master Fake Pan Knob Area */}
              <div className="logic-pan-knob-container mb-2 short:mb-0.5 w-full">
                <div className="logic-pan-knob opacity-50 select-none">
                  <div className="logic-pan-indicator" style={{ transform: 'rotate(0deg)' }}></div>
                </div>
                {/* Values box like Logic: Pan | Vol */}
                <div className="flex justify-center gap-1 mt-1 w-full px-2">
                  <div className="bg-[#1a1a1c] text-[#ddd] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-10 text-center flex-1">
                    0.0
                  </div>
                  <div className="bg-[#1a1a1c] text-[#4ade80] text-[8px] font-mono px-1 py-0.5 rounded-[2px] border border-black/80 w-10 text-center flex-1 truncate">
                    {masterVolume === 0 ? '-∞' : `${(masterVolume * 10 - 10).toFixed(1)}`}
                  </div>
                </div>
              </div>

              {/* Master Fader + VU */}
              <div className="flex-1 w-full flex justify-center py-1 mt-1 mb-2 relative gap-1.5">
                <div className="relative h-full flex justify-center w-6">
                  <input type="range" min="0" max="1.2" step="0.01" value={masterVolume}
                    onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                    onChange={(e) => updateMasterVolume(parseFloat(e.target.value))}
                    className="absolute h-full w-full bg-transparent appearance-none cursor-pointer z-10 opacity-0"
                    style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any} />
                  <div className="logic-fader-track h-full w-4 sm:w-5 relative pointer-events-none">
                    <div className="logic-fader-fill" style={{ 
                      height: `${(Math.min(masterVolume, OLD_FADER_MAX) / OLD_FADER_MAX) * 100}%`, 
                      background: 'linear-gradient(to top, rgba(212,168,67,0.5), rgba(212,168,67,0.1))'
                    }}></div>
                  </div>
                  <div className="logic-fader-knob master absolute pointer-events-none transition-all duration-75 z-20" style={{ bottom: `calc(${(Math.min(masterVolume, OLD_FADER_MAX) / OLD_FADER_MAX) * 100}% - var(--knob-half-master, 30px))` }}>
                  </div>
                </div>
                
                {/* Space separator */}
                <div className="w-3 hidden sm:block"></div>

                {renderVU('master', true)}
              </div>
            </div>
            </div>
          </div>

          {/* ═══ PAD PLAYER ═══ */}
          <div data-tour="pads" className={`bg-[#18181a] border-l border-border p-3 sm:p-4 short:p-2 flex flex-col z-10 shadow-[-10px_0_20px_rgba(0,0,0,0.4)] min-h-0 overflow-hidden shrink-0
            ${mobileView === 'pads' ? 'flex w-full' : 'hidden'} md:flex md:w-72 lg:w-96 tight:lg:w-80 short:md:w-60`}>
            <div className="font-bold text-[10px] tracking-[0.15em] text-text-muted mb-2 short:mb-1 flex justify-between uppercase items-center font-mono">
              <span>{padActiveView === 'pads' ? 'REPRODUTOR DE PADS' : padActiveView === 'samples' ? 'SAMPLES' : 'LOOPS'}</span>
              {padActiveView === 'pads' && (
                <button onClick={() => setIsPadEditMode(!isPadEditMode)}
                  className={`text-[9px] border px-2 py-0.5 rounded font-bold cursor-pointer transition-all active:scale-95 font-mono tracking-wider ${isPadEditMode ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-text-muted hover:bg-white/5 hover:text-white'}`}>
                  {isPadEditMode ? 'PRONTO' : 'EDITAR'}
                </button>
              )}
            </div>

            {/* Pad Cloud Selector — only in pads view */}
            {padActiveView === 'pads' && (
              <div className="flex gap-1 mb-2 short:mb-1">
                <button
                  onClick={() => withPlan(canUseCloudPads(userPlan), () => setIsPadSetsModalOpen(true))}
                  className={`flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer
                    ${padMode === 'system'
                      ? 'bg-secondary/15 text-secondary border-secondary/30'
                      : 'bg-white/3 text-text-muted border-border hover:bg-white/5 hover:text-white'
                    }`}>
                  <Cloud size={10} />
                  {padMode === 'system' && selectedPadSet ? selectedPadSet.name : 'PADS NUVEM'}
                </button>
              </div>
            )}

            {/* ═══ 3-WAY VIEW TOGGLE ═══ */}
            <div className="flex gap-1 mb-3 short:mb-1.5">
              <button
                onClick={() => { stopPlayback(); setPadActiveView('pads'); setActiveFolder(null); }}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer
                  ${padActiveView === 'pads'
                    ? 'bg-secondary/15 text-secondary border-secondary/30'
                    : 'bg-white/3 text-text-muted border-border hover:bg-white/5 hover:text-white'
                  }`}>
                <Music size={10} /> PADS
              </button>
              <button
                onClick={() => { setPadActiveView('samples'); setActiveFolder(null); }}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer
                  ${padActiveView === 'samples'
                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                    : 'bg-white/3 text-text-muted border-border hover:bg-purple-500/10 hover:text-purple-300 hover:border-purple-500/30'
                  }`}>
                <Disc size={10} /> SAMPLES
              </button>
              <button
                onClick={() => { setPadActiveView('loops'); setActiveFolder(null); }}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded flex items-center justify-center gap-1.5 font-mono tracking-wider border transition-all active:scale-95 cursor-pointer
                  ${padActiveView === 'loops'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-white/3 text-text-muted border-border hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-500/30'
                  }`}>
                <Repeat size={10} /> LOOPS
              </button>
            </div>

            {/* ═══ CONDITIONAL CONTENT AREA ═══ */}
            {padActiveView === 'pads' ? (
              <>
                {/* Volume */}
                <div className="flex items-center gap-3 mb-3 short:mb-1.5 px-1">
                  <span className="text-[9px] text-text-muted uppercase tracking-[0.15em] font-bold shrink-0 font-mono">VOL</span>
                  <input type="range" min="0" max="1" step="0.01" value={padVolume}
                    onChange={(e) => updatePadVolume(parseFloat(e.target.value))}
                    className="daw-slider flex-1" />
                  <span className="text-[9px] text-text-muted font-mono w-8 text-right font-bold">{Math.round(padVolume * 100)}%</span>
                </div>
                {/* Grid */}
                <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-3 md:grid-cols-3 md:grid-rows-4 short:md:grid-cols-4 short:md:grid-rows-3 gap-1.5 sm:gap-2 short:gap-1">
                  {KEY_NAMES.map(note => (
                    <div key={note} className="relative">
                      <button onClick={() => !isPadEditMode && playPad(note)}
                        className={`
                          mpc-pad w-full h-full rounded-lg flex flex-col items-center justify-center text-base sm:text-lg font-bold cursor-pointer min-h-[48px] sm:min-h-[56px] tight:min-h-0 active:scale-95 font-mono relative
                          ${activeNote === note
                            ? 'pressed border-secondary/50 text-secondary shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                            : customPads.has(note) ? 'border-purple-500/30 text-purple-300 hover:border-purple-400/50' : 'text-text-main/70 hover:text-white hover:border-border-light'}
                        `}>
                        {/* LED indicator */}
                        <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full transition-all ${activeNote === note ? 'bg-secondary shadow-[0_0_6px_rgba(6,182,212,0.8)]' : customPads.has(note) ? 'bg-purple-500/50' : 'bg-white/10'}`}></div>
                        <span className="mt-1">{note}</span>
                        {customPads.has(note) && <span className="text-[6px] mt-0.5 opacity-50 truncate max-w-full px-1 uppercase tracking-wider">{customPadNames.get(note) || 'Person.'}</span>}
                        {activeNote === note && <span className="text-[7px] tracking-[0.2em] font-bold opacity-50 uppercase text-secondary">TOCANDO</span>}
                      </button>
                      {isPadEditMode && (
                        <div className="absolute inset-0 bg-black/85 rounded-lg flex flex-col items-center justify-center gap-1 z-10 border border-border">
                          <label className="text-[7px] font-bold text-white uppercase cursor-pointer hover:text-primary transition-colors flex items-center gap-1 font-mono tracking-wider">
                            <Upload size={9} />CARREGAR
                            <input type="file" accept={AUDIO_FILE_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadCustomPad(note, f) }} />
                          </label>
                          {customPads.has(note) && (
                            <button onClick={() => clearCustomPad(note)} className="text-[7px] font-bold text-accent-red hover:text-red-300 cursor-pointer flex items-center gap-1 font-mono tracking-wider">
                              <X size={8} /> REMOVER
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ═══ SAMPLES / LOOPS LIST VIEW ═══ */
              <SampleList
                kind={padActiveView === 'samples' ? 'samples' : 'loops'} items={padActiveView === 'samples' ? samples : loops}
                loading={samplesLoading} activeFolder={activeFolder} playingUrl={playingUrl} onFolder={setActiveFolder} onPlay={playSample}
              />
            )}
          </div>
        </section>
      </main>
      </>
      )}

      {/* Editar canal (EDITAR CANAIS > lápis). Fica aqui, fora do mixer: a sobreposição do
          canal tem backdrop-filter, que prenderia o `fixed` do painel dentro da faixa. */}
      {editingChannel && (
        <ChannelEditPanel
          key={editingChannel.id}
          channel={editingChannel}
          autoLabel={editingAutoLabel}
          onSave={(value) => { setChannelMeta(editingChannel.id, value); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => { setIsSettingsOpen(false); setSettingsFocus(null) }}
        focusSection={settingsFocus}
        isPlaying={isPlaying || isCountingIn}
        maxOutputChannels={maxOutputChannels}
        outputWarning={outputPlan.warning}
        hideOffer={hidePlansOffer}
        channels={channels}
        onSetChannelBus={setChannelBus}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onReplayTour={() => setShowTour(true)}
        desktopUpdate={desktopUpdate}
        onInstallUpdate={installDesktopUpdate}
      />

      {/* Library Modal */}
      <LibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onBeforeDownload={(songId) => {
          if (livre.canOpenSong(`cloud:${songId}`)) return true
          // Livre sem vaga no mês (a música já aberta no mês sempre passa): nada baixa e a tela de limite aparece.
          livre.requestLimit('stage-songs')
          return false
        }}
        onDownload={async (files, songName, coverUrl, markers, originalKey, artist, bpm, extra, songId) => {
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));
          const fullName = artist ? `${artist} - ${songName}` : songName;
          // No Livre, a música baixada vira a atual com a VS parada (como a importada do aparelho).
          await loadAsCurrent(() => loadFiles(dt.files, fullName, coverUrl || undefined, markers, originalKey ?? null, bpm, {
            artist,
            lyrics: extra?.lyrics ?? null,
            lyricsSynced: extra?.lyricsSynced ?? null,
            chords: extra?.chords ?? null,
            sourceId: songId,
            // Compasso salvo na nuvem (songs.time_signature): sem ele o click que falta nunca é gerado.
            timeSignature: extra?.timeSignature,
          }));
        }}
        onSongEdited={({ songId, prevName, prevBpm, prevOriginalKey, name, artist, originalKey, bpm, coverImage }) => {
          // Reflete a edição da biblioteca no repertório já carregado (e no ao vivo).
          syncSongMeta({ sourceId: songId, prevName, prevBpm, prevOriginalKey, name, artist, originalKey, bpm, coverImage });
        }}
      />

      {/* Admin Modal */}
      {isAdmin && (
        <AdminModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
      )}

      {showTour && <GuidedTour steps={useNewStage ? TOUR_STEPS_NEW_STAGE : TOUR_STEPS} onClose={closeTour} />}
      {showWhatsNew && <WhatsNewModal onClose={closeWhatsNew} />}
      <InstallAppBanner />
      <RenewalNoticeBanner userId={user?.id} plan={userPlan} />

      <LiveModeModal
        isOpen={isLiveModeOpen}
        onClose={() => setIsLiveModeOpen(false)}
        serverUrl={liveServerUrl}
        isStarting={isLiveServerStarting}
        serverError={liveServerError}
        onStopServer={handleStopLiveMode}
        devices={connectedIps}
        approvedIps={approvedIps}
        onToggleDevice={approveLiveDevice}
        onToggleAll={approveAllLiveDevices}
        remoteSessionCode={remoteSessionCode}
        onToggleRemote={() => setRemoteSessionCode(prev => prev ? null : Math.random().toString(36).slice(2, 8).toUpperCase())}
        livreTimeLeft={livre.isLivre ? livreLiveLeftText(livre.live.remainingMs) : null}
      />

      {/* Renomear (menu FAIXAS do palco novo) e BPM do metrônomo infinito, nos dois palcos. */}
      {textPrompt?.kind === 'metronome' && (
        <TextPromptDialog
          title="Criar metrônomo (infinito)" label="BPM da nova faixa de Click, de 40 a 300" initialValue="120" submitLabel="Criar" inputMode="numeric"
          validate={endlessMetronomeBpmError} onCancel={() => setTextPrompt(null)}
          onSubmit={(v) => { setTextPrompt(null); createEndlessMetronomeSong(Number(v)) }}
        />
      )}
      {textPrompt?.kind === 'rename' && (
        <TextPromptDialog
          title="Renomear esta música" label="Nome da música" initialValue={textPrompt.name}
          validate={songNameError} onCancel={() => setTextPrompt(null)}
          onSubmit={(v) => { const { songId } = textPrompt; setTextPrompt(null); renameSong(songId, v) }}
        />
      )}

      {/* Editor de Letra & Cifra (Admin) */}
      {isLyricsEditorOpen && playlist[activeSongIndex] && (
        <LyricsEditor
          song={playlist[activeSongIndex]}
          onClose={() => setIsLyricsEditorOpen(false)}
          onSave={async ({ lyrics, lyricsSynced, chords }) => {
            const activeSong = playlist[activeSongIndex]
            if (!activeSong) return false
            // Estado local (reflete no follower e persiste no IndexedDB)
            setSongLyrics(activeSong.id, { lyrics, lyricsSynced, chords })
            // Nuvem: só a música com a id que o download gravou (sourceId), nunca pelo nome. Sem ela,
            // fica só no aparelho e o editor diz isso ("Salvo localmente").
            if (!activeSong.sourceId) return false
            try {
              const match = cloudSongOf(await fetchCloudSongs(), activeSong)
              if (match) {
                return await updateSong(match.id, { lyrics, lyrics_synced: lyricsSynced, chords })
              }
            } catch (e) {
              console.error('Falha ao salvar letra/cifra na nuvem:', e)
            }
            return false
          }}
        />
      )}


      <PadSetsModal
        isOpen={isPadSetsModalOpen}
        onClose={() => setIsPadSetsModalOpen(false)}
        onSelect={selectPadSet}
        selectedPadSet={selectedPadSet}
        isAdmin={isAdmin}
      />

      {/* EDITAR dos pads no palco novo: carregar ou tirar o som de cada tom. */}
      {isPadSoundsOpen && (
        <PadSoundsDialog
          custom={customPads} names={customPadNames} onLoad={stageCalls.padLoad} onClear={stageCalls.padClear} onClose={stageCalls.padSoundsClose}
        />
      )}

      {/* ═══ TELEPROMPTER OVERLAY ═══ */}
      {isTeleprompterMode && <Teleprompter songName={playlist[activeSongIndex]?.name ?? null} hasMarkers={(playlist[activeSongIndex]?.markers?.length ?? 0) > 0} marker={currentMarker ?? null} currentTime={currentTime} duration={duration} onClose={() => setIsTeleprompterMode(false)} />}

      {isMetronomeModalOpen && playlist[activeSongIndex] && (
        <MetronomeModal 
          isOpen={isMetronomeModalOpen} 
          initialSignature={stageGrid?.signature ?? playlist[activeSongIndex].timeSignature}
          onClose={() => setIsMetronomeModalOpen(false)} 
          playlistCurrentSong={playlist[activeSongIndex]}
          onAddClick={addChannelToActiveSong} 
          isPlaying={isPlaying || isCountingIn}
        />
      )}

      <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} hideOffer={hidePlansOffer} />

      {/* Tela de limite do Livre (Parte 3): só com a VS parada (o useLivre segura o pedido até parar).
          Ela fica por cima dos Planos, então "Ver todos os planos" fecha ela antes de abrir os Planos. */}
      {livre.limit !== null && (
        <LimitGate key={livre.limit} kind={livre.limit} onClose={livre.closeLimit} onSeePlans={() => { livre.closeLimit(); setIsPricingOpen(true) }} />
      )}

      {/* ═══ MOBILE PORTRAIT DRAWER ═══ */}
      {isMobileDrawerOpen && (
        <div className="hidden compact:block fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsMobileDrawerOpen(false)} />
          <div className="absolute top-0 left-0 bottom-0 w-72 bg-[#141416] border-r border-border flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-border bg-[#18181a] shrink-0">
              {mobileDrawerView !== 'main' ? (
                <button onClick={() => setMobileDrawerView('main')}
                  className="text-text-muted hover:text-white text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center gap-1">
                  <ChevronRight size={14} className="rotate-180" />
                  Voltar
                </button>
              ) : (
                <span className="text-text-muted text-[10px] font-bold uppercase tracking-[0.2em] font-mono">Menu</span>
              )}
              <button onClick={() => setIsMobileDrawerOpen(false)}
                className="text-text-muted hover:text-white p-1 -mr-1 rounded-md cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-2">
              {mobileDrawerView === 'main' && (
                <div className="flex flex-col gap-1">
                  {/* User chip */}
                  <div className="px-3 py-2 mb-2 bg-white/3 border border-border rounded-md">
                    <div className="text-[9px] text-text-muted/60 font-mono uppercase tracking-wider">Usuário</div>
                    <div className="text-white text-xs font-mono truncate">{user.email}</div>
                  </div>

                  {/* TOM */}
                  <button onClick={() => setMobileDrawerView('tom')}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <span className="text-primary font-mono w-5 text-center">♪</span>
                      Tom
                    </span>
                    <span className="flex items-center gap-2">
                      {currentKeyName && <span className="text-primary text-xs font-mono">{currentKeyName}</span>}
                      <ChevronRight size={14} className="text-text-muted" />
                    </span>
                  </button>

                  {/* BIBLIOTECA */}
                  <button onClick={() => { withPlan(canUsePlatformCatalog(userPlan), () => setIsLibraryOpen(true)); setIsMobileDrawerOpen(false); }}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <Cloud size={16} className="text-primary" />
                      Biblioteca
                    </span>
                    <ChevronRight size={14} className="text-text-muted" />
                  </button>

                  {/* FAIXAS */}
                  <button onClick={() => setMobileDrawerView('faixas')}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <Music size={16} className="text-primary" />
                      Faixas
                    </span>
                    <ChevronRight size={14} className="text-text-muted" />
                  </button>

                  <hr className="border-border my-2" />

                  {/* ADMIN: abre dentro do app, só pra quem tem o papel */}
                  <AdminEntryButton isAdmin={isAdmin} variant="drawer"
                    onOpen={() => { setIsAdminPanelOpen(true); setIsMobileDrawerOpen(false) }} />

                  {/* CONFIG */}
                  <button onClick={() => { setIsSettingsOpen(true); setIsMobileDrawerOpen(false); }}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <Settings size={16} className="text-text-muted" />
                      Configuração
                    </span>
                    <ChevronRight size={14} className="text-text-muted" />
                  </button>

                  {/* SAIR */}
                  <button onClick={() => { signOut(); setIsMobileDrawerOpen(false); }}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-accent-red/10 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-accent-red/30">
                    <span className="text-accent-red text-sm font-bold flex items-center gap-3">
                      <LogOut size={16} />
                      Sair
                    </span>
                  </button>
                </div>
              )}

              {mobileDrawerView === 'tom' && (
                <div className="p-2">
                  <p className="text-[10px] text-text-muted mb-3 font-mono">
                    {hasOriginalKey ? 'Selecionar tom:' : 'Tom original desconhecido. Defina manualmente:'}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {KEY_NAMES.map(key => {
                      const isCurrent = key === currentKeyName
                      const isOriginal = KEY_NAMES.indexOf(key) === originalKeyIndex && !isCurrent
                      return (
                        <button key={key} onClick={() => {
                          if (hasOriginalKey) {
                            changePitch(semitonesBetweenKeys(activeOriginalKey, key))
                          } else {
                            setOriginalKey(key)
                            changePitch(0)
                          }
                        }}
                          className={`py-2 text-[11px] font-bold rounded transition-colors cursor-pointer font-mono ${isCurrent ? 'bg-primary text-black' : isOriginal ? 'bg-white/15 text-white border border-white/20' : 'text-white/70 bg-white/5 hover:bg-primary/20 hover:text-primary'}`}>
                          {key}
                        </button>
                      )
                    })}
                  </div>
                  {activeOriginalKey && (
                    <button onClick={() => { setOriginalKey(null); changePitch(0); }}
                      className="mt-3 w-full text-[10px] text-text-muted hover:text-accent-red cursor-pointer text-center transition-colors font-mono py-2">
                      Redefinir detecção de tom
                    </button>
                  )}
                </div>
              )}

              {mobileDrawerView === 'faixas' && (
                <div className="p-2 flex flex-col gap-1">
                  <label className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <Upload size={16} className="text-primary" />
                      Importar do dispositivo
                    </span>
                    <ChevronRight size={14} className="text-text-muted" />
                    <input type="file" multiple accept={AUDIO_FILE_ACCEPT} className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          importFilesGated(e.target.files)
                          setIsMobileDrawerOpen(false)
                        }
                      }} />
                  </label>
                  <button onClick={() => {
                    setIsMobileDrawerOpen(false);
                    promptEndlessMetronome();
                  }}
                    className="w-full text-left px-3 py-3 rounded-md hover:bg-white/5 flex items-center justify-between cursor-pointer transition-colors border border-transparent hover:border-border">
                    <span className="text-white text-sm font-bold flex items-center gap-3">
                      <Timer size={16} className="text-primary" />
                      Criar Metrônomo (Infinito)
                    </span>
                    <ChevronRight size={14} className="text-text-muted" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
