// Página do verificador de layout (T20): monta o palco novo (ou as Configurações) com os dados
// do fixture.ts no estado pedido em `?estado=` e mede (check.ts). Nada daqui entra no app.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/index.css'
import { AudioOutputsSection } from '../../src/components/settings/AudioOutputsSection'
import { StageVersionSetting } from '../../src/components/settings/StageVersionSetting'
import { RepertoirePanel } from '../../src/components/stage/RepertoirePanel'
import { StageShell } from '../../src/components/stage/StageShell'
import { describe, reportFatal, verifyPage } from './check'
import type { Failure } from './check'
import type { Estado } from './fixture'
import { ACTIONS, CLOCK, OUTPUT_CASES, PADS, makePeaks, outputWarningFor, parseEstado, repertoireProps, viewFor } from './fixture'

const noop = () => {}
const peaks = makePeaks()

// As peças da página são exportadas só pela regra do react-refresh (arquivo com componente exporta componente).

/** As duas seções da T19 numa página própria, na largura do painel das Configurações (max-w-2xl, p-6). */
export function ConfigPage() {
  return (
    <div className="min-h-dvh bg-ps-ink px-4 py-8 font-ps-sans text-ps-bone">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-ps-2xl bg-ps-ink-0 p-6 inset-ring inset-ring-ps-line">
        <StageVersionSetting value="novo" onChange={noop} />
        {OUTPUT_CASES.map((c) => (
          <div key={c.maxChannels} data-placa={`${c.maxChannels} canais`} className="border-t border-ps-line pt-6">
            <AudioOutputsSection outputs={c.outputs} maxChannels={c.maxChannels} supportsDevicePick={c.supportsDevicePick} onChange={noop} loadWarnings={c.loadWarnings} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Estado de prova: o botão de largura fixa com texto longo (texto cortado e encostando) e, ao lado,
 * um caso de cada regra, pra provar que o verificador pega todas: texto passando de um contêiner que
 * corta, selo com o texto colado na borda, alvo de toque de 32 px, item pela metade numa fileira que
 * rola de lado e uma faixa larga que faz a página rolar de lado.
 */
export function BrokenCases() {
  return (
    <>
      <div className="fixed bottom-24 left-4 z-[60] flex flex-col items-start gap-2 rounded-ps-lg bg-ps-ink p-3">
        <button type="button" data-prova="" className="h-11 w-[96px] truncate rounded-ps-lg bg-ps-s2 px-1 text-ps-sm font-bold text-ps-bone">
          Texto comprido demais pra este botão
        </button>
        <div data-prova-caixa="" className="h-6 w-24 overflow-hidden">
          <span className="whitespace-nowrap text-ps-base text-ps-bone">Nome que passa da caixa</span>
        </div>
        <span data-prova-selo="" className="rounded-ps-xs bg-ps-alert px-0.5 text-ps-micro font-extrabold text-ps-ink">ALERTA</span>
        <button type="button" data-prova-toque="" className="size-8 rounded-ps-md bg-ps-s2 text-ps-bone">X</button>
        <div data-prova-fileira="" className="flex w-40 gap-2 overflow-x-auto text-ps-base text-ps-bone">
          <span className="w-28 shrink-0">Primeiro item</span>
          <span className="w-28 shrink-0">Segundo item</span>
        </div>
      </div>
      <div data-prova-largo="" className="h-px w-[130vw]" />
    </>
  )
}

export function Stage({ estado }: { estado: Estado }) {
  return (
    <>
      <StageShell
        view={viewFor(estado)} actions={ACTIONS} clock={CLOCK} peaks={peaks} pads={PADS}
        slots={{ repertoire: <RepertoirePanel {...repertoireProps(estado === 'repertorio')} /> }}
        keyboardEnabled={false} outputWarning={outputWarningFor(estado)}
      />
      {estado === 'quebrado' && <BrokenCases />}
    </>
  )
}

/** Toque de ponteiro (click com detail 1), como o dedo: a grade de tons não puxa o foco. */
function tap(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`não achei ${selector} pra abrir`)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

/** O que abrir depois de montar: a grade de tons e o diálogo do compasso são estado da casca. */
const PREPARE: Partial<Record<Estado, () => void>> = {
  tom: () => tap('[data-cell="tom"] button[aria-haspopup="dialog"]'),
  compasso: () => tap('[data-cell="tempo"] button[title="Escolher o compasso da música"]'),
}

/** O que tem de estar na tela em cada estado (e o texto, quando importa). Sem isso a medida passaria sem medir o estado. */
const EXPECT: Record<Estado, { sel: string; text?: string }> = {
  normal: { sel: '[data-stage-shell] [data-waveform] [data-block]' },
  contando: { sel: '[data-channel-strip] [data-count][data-on="true"]', text: '2' },
  pads: { sel: '[role="dialog"][aria-label="Pads"]' },
  editar: { sel: '[role="group"][aria-label="Marcar seção"]' },
  livre: { sel: '[data-tour="secoes"] p' },
  repertorio: { sel: '[role="dialog"][aria-label="Repertório"]' },
  tom: { sel: '[data-cell="tom"] button[aria-expanded="true"]' },
  compasso: { sel: '[data-stage-meter]' },
  config: { sel: '[data-placa="8 canais"] select' },
  quebrado: { sel: '[data-prova]' },
}

function expectState(estado: Estado): void {
  const { sel, text } = EXPECT[estado]
  const el = document.querySelector(sel)
  if (!el) throw new Error(`estado ${estado} não montou: falta ${sel}`)
  if (text !== undefined && el.textContent?.trim() !== text) throw new Error(`estado ${estado}: ${sel} mostra "${el.textContent ?? ''}", esperado "${text}"`)
}

/** Faixas do palco de cima pra baixo, na ordem do mockup v5. */
const BANDS = [
  '[data-stage-shell] header', 'section[aria-label="Transporte"]', '[data-stage-wave]', '[data-stage-sections]', '[data-stage-mid]', '[data-stage-mixer]',
]
/** O nome do repertório ao lado de "MÚSICA 3 DE 6" só aparece a partir desta largura (v6 linha 244). */
const REPERTOIRE_NAME_MIN_W = 1700

/**
 * Estrutura do palco que a arquitetura D do plano manda conferir aqui: as faixas na mesma ordem em
 * qualquer largura, sem uma por cima da outra, e o nome do repertório só a partir de 1700 px. Os
 * canais inteiros no mixer que rola de lado já saem da regra (a): nada pela metade na borda.
 */
function stageStructure(): Failure[] {
  const out: Failure[] = []
  let prev: { sel: string; bottom: number } | null = null
  for (const sel of BANDS) {
    const el = document.querySelector(sel)
    if (!el) {
      out.push({ kind: 'estrutura', selector: sel, text: '', detail: 'faixa do palco não está na tela' })
      continue
    }
    const r = el.getBoundingClientRect()
    if (prev && r.top < prev.bottom - 0.5) out.push({ kind: 'estrutura', selector: describe(el), text: '', detail: `começa em ${r.top.toFixed(1)}px, antes do fim da faixa de cima (${prev.sel}, ${prev.bottom.toFixed(1)}px)` })
    prev = { sel, bottom: r.bottom }
  }
  const repName = document.querySelector('[data-repertoire-name]')
  const shown = repName !== null && repName.getClientRects().length > 0
  const want = window.innerWidth >= REPERTOIRE_NAME_MIN_W
  if (shown !== want) out.push({ kind: 'estrutura', selector: '[data-repertoire-name]', text: repName?.textContent?.trim() ?? '', detail: `nome do repertório ${shown ? 'aparece' : 'some'} em ${window.innerWidth}px (aparece só a partir de ${REPERTOIRE_NAME_MIN_W}px)` })
  return out
}

const params = new URLSearchParams(location.search)
const name = params.get('name') ?? 'resultado'
const raw = params.get('estado')
const estado = parseEstado(raw)

if (!estado) {
  reportFatal(name, String(raw), `estado desconhecido: ${String(raw)}`)
} else {
  window.addEventListener('error', (e) => reportFatal(name, estado, `erro na página: ${e.message}`))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{estado === 'config' ? <ConfigPage /> : <Stage estado={estado} />}</StrictMode>,
  )
  void verifyPage(name, estado, { prepare: PREPARE[estado], expect: () => expectState(estado), checks: estado === 'config' ? undefined : stageStructure })
}
