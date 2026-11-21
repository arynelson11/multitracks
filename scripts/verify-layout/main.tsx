// Página do verificador de layout (T20): monta o palco novo (ou as Configurações) com os dados
// do fixture.ts no estado pedido em `?estado=` e mede (check.ts). Nada daqui entra no app.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/index.css'
import { AdSlot } from '../../src/components/livre/AdSlot'
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
 * Uma coluna da tela inicial do App (o retorno do splash em src/App.tsx), com o que mede o anúncio
 * da casa: a coluna centrada com `px-6`, os dois botões (aqui duas caixas sem texto, no mesmo
 * lugar) e, embaixo, o cartão do AdSlot no mesmo `div` do App (`mt-6 w-full max-w-md`). O AdSlot é
 * o de verdade, no Livre e parado; sem Supabase no build, o evento do funil não sai.
 */
function InicioColumn({ frame }: { frame: 'janela' | '390' }) {
  return (
    <div data-inicio={frame} className={frame === 'janela' ? 'flex min-h-dvh w-full flex-col items-center justify-center px-6' : 'mx-auto flex w-[390px] flex-col items-center px-6 py-10 inset-ring inset-ring-ps-line'}>
      <div aria-hidden="true" className="flex w-full max-w-md flex-col gap-4 sm:flex-row">
        <div className="h-[118px] flex-1 rounded-xl bg-tinta-raised" />
        <div className="h-[118px] flex-1 rounded-xl bg-tinta-raised" />
      </div>
      <div className="mt-6 w-full max-w-md empty:hidden">
        <AdSlot placement="home" userId="verificador" isLivre quiet onCta={noop} />
      </div>
    </div>
  )
}

/**
 * A tela inicial com o cartão do anúncio, duas vezes: na largura da janela e numa moldura de 390 px
 * (celular em pé, onde a tela inicial também abre), em que o cartão fica com 342 px. Os dois AdSlot
 * decidem na mesma renderização, antes de o primeiro gravar o anúncio grande da sessão.
 */
export function InicioPage() {
  return (
    <div className="bg-[#0a0a0c] font-ps-sans text-ps-bone">
      <InicioColumn frame="janela" />
      <InicioColumn frame="390" />
    </div>
  )
}

/**
 * Estado de prova: o botão de largura fixa com texto longo (texto cortado e encostando) e, ao lado,
 * um caso pra cada ramo das regras, pra provar que o verificador pega todos (uma falha por ramo):
 * texto passando de um contêiner que corta, selo com o texto colado na borda, alvo de toque de 32 px,
 * item pela metade numa fileira que rola de lado, faixa larga que faz a página rolar de lado, caixa do
 * texto cortada (com o texto inteiro), texto acima do começo de uma rolagem, texto saindo de caixa
 * grande, M/S abaixo de 32x30, bloco estreito baixo, botão só de ícone cortado e, num palco de
 * mentira, faixas fora de ordem, a área do palco rolando na vertical, a casca rolando de lado a
 * partir de 1024 px e o aviso SAÍDAS em cima do selo ONLINE.
 */
export function BrokenCases() {
  return (
    <>
      <div className="fixed bottom-4 left-4 z-[60] flex flex-col items-start gap-2 rounded-ps-lg bg-ps-ink p-3">
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
        {/* Caixa do texto cortada: a pílula de 40 px passa da caixa de 36, o texto no meio cabe. */}
        <div data-prova-moldura="" className="h-9 overflow-hidden">
          <span className="inline-flex h-10 items-center rounded-ps-md bg-ps-s2 px-3 text-ps-sm font-bold text-ps-bone">Pílula</span>
        </div>
        {/* Texto acima do começo de uma rolagem vertical: com a rolagem no início não se chega nele. */}
        <div data-prova-acima="" className="h-10 w-40 overflow-y-auto">
          <p className="-mt-3 text-ps-base text-ps-bone">Linha acima</p>
        </div>
        {/* Texto saindo de caixa grande (mais de 40 px de altura, sem overflow). */}
        <div data-prova-caixa-grande="" className="h-12 w-20 rounded-ps-md bg-ps-s2">
          <span className="whitespace-nowrap text-ps-base text-ps-bone">Texto que sai da caixa</span>
        </div>
        <button type="button" data-prova-ms="" data-touch-exception="ms" className="size-6 rounded-ps-sm bg-ps-s2 text-ps-sm font-extrabold text-ps-bone">M</button>
        <button type="button" data-prova-estreito="" data-narrow="" aria-label="Bloco estreito" className="h-8 w-6 rounded-ps-sm bg-ps-s2" />
        {/* Botão só de ícone cortado de lado (o X do PRÓXIMA fora da tela): sem texto, só a regra do ícone pega. */}
        <div data-prova-icone="" className="h-12 w-6 overflow-hidden">
          <button type="button" aria-label="Fechar a prova" className="inline-flex size-11 items-center justify-center rounded-ps-md bg-ps-s2 text-ps-bone">
            <svg aria-hidden="true" viewBox="0 0 10 10" className="size-3"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" /></svg>
          </button>
        </div>
      </div>
      {/* Palco de mentira, sem texto: faixas fora de ordem (mixer antes da faixa do meio), a área que rola maior que a janela dela,
          a casca mais larga que a caixa (rola de lado a partir de 1024 px) e o aviso SAÍDAS começando em cima do selo ONLINE. */}
      <div data-stage-shell="" data-prova-palco="" aria-hidden="true" className="fixed top-24 right-4 z-[60] flex w-16 flex-col bg-ps-ink">
        <header className="relative h-2 bg-ps-s2">
          <span data-online="" className="absolute top-0 left-0 h-2 w-6" />
          <span data-output-alert="" className="absolute top-0 left-2 h-2 w-4" />
          <nav className="absolute top-0 right-0 h-2 w-4" />
        </header>
        <div data-stage-hscroll="" className="h-2 w-16 overflow-x-auto">
          <div className="h-1 w-40" />
        </div>
        <div data-stage-scroll="" className="flex h-10 flex-col overflow-y-auto">
          <section aria-label="Transporte" className="h-4 shrink-0" />
          <div data-stage-wave="" className="h-4 shrink-0" />
          <div data-stage-sections="" className="h-4 shrink-0" />
          <div data-stage-mixer="" className="h-4 shrink-0" />
          <div data-stage-mid="" className="h-4 shrink-0" />
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
  semtom: () => tap('[data-cell="tom"] button[aria-haspopup="dialog"]'),
  compasso: () => tap('[data-cell="tempo"] button[title="Escolher o compasso da música"]'),
}

/** O que tem de estar na tela em cada estado (o texto ou quantos, quando importa). Sem isso a medida passaria sem medir o estado. */
const EXPECT: Record<Estado, { sel: string; text?: string; count?: number }> = {
  normal: { sel: '[data-stage-shell] [data-waveform] [data-block]' },
  contando: { sel: '[data-channel-strip] [data-count][data-on="true"]', text: '2' },
  pads: { sel: '[role="dialog"][aria-label="Pads"]' },
  editar: { sel: '[role="group"][aria-label="Marcar seção"]' },
  livre: { sel: '[data-tour="secoes"] p' },
  selo: { sel: 'header [data-livre-badge]', text: 'LIVRE · 3 de 3 músicas este mês' },
  repertorio: { sel: '[role="dialog"][aria-label="Repertório"]' },
  tom: { sel: '[data-cell="tom"] button[aria-expanded="true"]' },
  semtom: { sel: '[data-cell="tom"] [data-define-original]' },
  compasso: { sel: '[data-stage-meter]' },
  config: { sel: '[data-placa="8 canais"] select' },
  inicio: { sel: '[data-inicio] [data-house-ad="home"]', count: 2 },
  quebrado: { sel: '[data-prova]' },
}

function expectState(estado: Estado): void {
  const { sel, text, count } = EXPECT[estado]
  const el = document.querySelector(sel)
  if (!el) throw new Error(`estado ${estado} não montou: falta ${sel}`)
  const found = document.querySelectorAll(sel).length
  if (count !== undefined && found !== count) throw new Error(`estado ${estado}: ${found} de ${sel}, esperado ${count}`)
  if (text !== undefined && el.textContent?.trim() !== text) throw new Error(`estado ${estado}: ${sel} mostra "${el.textContent ?? ''}", esperado "${text}"`)
}

/** Faixas do palco de cima pra baixo, na ordem do mockup v5 (dentro de cada `[data-stage-shell]`). */
const BANDS = ['header', 'section[aria-label="Transporte"]', '[data-stage-wave]', '[data-stage-sections]', '[data-stage-mid]', '[data-stage-mixer]']
/** O nome do repertório ao lado de "MÚSICA 3 DE 6" só aparece a partir desta largura (v6 linha 244). */
const REPERTOIRE_NAME_MIN_W = 1700
/**
 * Quanto a área do palco pode rolar na vertical, por estado. Ao vivo, nada: a partir de 740 px de altura
 * tudo tem de caber parado. No EDITAR (e no compasso, que abre nele) a T18 aceitou rolar até 38 px em
 * tela baixa, com duas linhas de seções (medido na v1.4.20: 38 px em 1024x740, 18 px em 1024x768).
 * Abaixo de 1024 px de largura a barra da rolagem de lado da casca (Ruling I2-estreito) também conta.
 */
const SCROLL_ALLOWANCE: Partial<Record<Estado, number>> = { editar: 38, compasso: 38 }

/**
 * Estrutura de um palco que a arquitetura D do plano manda conferir aqui: as faixas na mesma ordem
 * em qualquer largura, sem uma por cima da outra, o nome do repertório só a partir de 1700 px e a
 * área do palco sem rolar na vertical além da folga do estado (a regra (a) trata a rolagem vertical
 * como página; aqui ela vira falha). Os canais inteiros no mixer que rola de lado já saem da regra
 * (a): nada pela metade na borda.
 */
function shellStructure(shell: Element, allowance: number): Failure[] {
  const out: Failure[] = []
  let prev: { sel: string; bottom: number } | null = null
  for (const sel of BANDS) {
    const el = shell.querySelector(sel)
    if (!el) {
      out.push({ kind: 'estrutura', selector: `${describe(shell)} ${sel}`, text: '', detail: 'faixa do palco não está na tela' })
      continue
    }
    const r = el.getBoundingClientRect()
    if (prev && r.top < prev.bottom - 0.5) out.push({ kind: 'estrutura', selector: describe(el), text: '', detail: `começa em ${r.top.toFixed(1)}px, antes do fim da faixa de cima (${prev.sel}, ${prev.bottom.toFixed(1)}px)` })
    prev = { sel, bottom: r.bottom }
  }
  const scroll = shell.querySelector('[data-stage-scroll]')
  const extra = scroll ? scroll.scrollHeight - scroll.clientHeight : 0
  // Na tela estreita a barra da rolagem de lado (quando o sistema mostra uma) come a altura dela.
  const hscroll = shell.querySelector<HTMLElement>('[data-stage-hscroll]')
  const bar = hscroll ? Math.max(0, hscroll.offsetHeight - hscroll.clientHeight) : 0
  const room = allowance + bar
  if (scroll && extra > room + 1) {
    out.push({ kind: 'estrutura', selector: describe(scroll), text: '', detail: `o palco rola ${extra}px na vertical (${scroll.scrollHeight}px numa área de ${scroll.clientHeight}px; folga neste estado: ${allowance}px${bar > 0 ? ` + ${bar}px da barra de rolagem de lado` : ''})` })
  }
  // A partir de 1024 px a casca não rola de lado: a barra do app inteira cabe (com OFFLINE, HOST, o
  // aviso SAÍDAS e o selo do Livre). A rolagem de lado só vale abaixo de 1024 px (Ruling I2-estreito).
  if (hscroll && window.innerWidth >= 1024 && hscroll.scrollWidth > hscroll.clientWidth + 1) {
    out.push({ kind: 'estrutura', selector: describe(hscroll), text: '', detail: `a casca rola ${hscroll.scrollWidth - hscroll.clientWidth}px de lado em ${window.innerWidth}px (o conteúdo tem ${hscroll.scrollWidth}px)` })
  }
  // O aviso SAÍDAS fica por cima da barra (absoluto): não pode cobrir o selo ONLINE, o do Livre nem o menu.
  const outAlert = shell.querySelector('[data-output-alert]')
  if (outAlert) {
    const a = outAlert.getBoundingClientRect()
    const nav = shell.querySelector('header nav')
    for (const sel of ['[data-online]', '[data-livre-badge]']) {
      const el = shell.querySelector(sel)
      if (el && a.left < el.getBoundingClientRect().right - 0.5) out.push({ kind: 'estrutura', selector: describe(outAlert), text: outAlert.textContent?.trim() ?? '', detail: `o aviso SAÍDAS começa em ${a.left.toFixed(1)}px, em cima de ${sel} (termina em ${el.getBoundingClientRect().right.toFixed(1)}px)` })
    }
    if (nav && a.right > nav.getBoundingClientRect().left + 0.5) out.push({ kind: 'estrutura', selector: describe(outAlert), text: outAlert.textContent?.trim() ?? '', detail: `o aviso SAÍDAS termina em ${a.right.toFixed(1)}px, em cima do menu (começa em ${nav.getBoundingClientRect().left.toFixed(1)}px)` })
  }
  const repName = shell.querySelector('[data-repertoire-name]')
  const shown = repName !== null && repName.getClientRects().length > 0
  const want = window.innerWidth >= REPERTOIRE_NAME_MIN_W
  if (shown !== want) out.push({ kind: 'estrutura', selector: '[data-repertoire-name]', text: repName?.textContent?.trim() ?? '', detail: `nome do repertório ${shown ? 'aparece' : 'some'} em ${window.innerWidth}px (aparece só a partir de ${REPERTOIRE_NAME_MIN_W}px)` })
  return out
}

/** Estrutura de cada palco na página (no estado de prova, também o palco de mentira). */
function stageStructure(estado: Estado): Failure[] {
  const allowance = SCROLL_ALLOWANCE[estado] ?? 0
  return [...document.querySelectorAll('[data-stage-shell]')].flatMap((shell) => shellStructure(shell, allowance))
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
    <StrictMode>{estado === 'config' ? <ConfigPage /> : estado === 'inicio' ? <InicioPage /> : <Stage estado={estado} />}</StrictMode>,
  )
  const pageOnly = estado === 'config' || estado === 'inicio'
  void verifyPage(name, estado, { prepare: PREPARE[estado], expect: () => expectState(estado), checks: pageOnly ? undefined : () => stageStructure(estado) })
}
