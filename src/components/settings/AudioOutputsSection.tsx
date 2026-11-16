// Saídas de áudio (spec 5e, R-23, R-24) na aba Geral das Configurações: Tudo junto, Click e
// Guia separados ou 4 ou mais saídas. Só recebe props: as contas são da T6 (outputPlan.ts) e
// quem grava em settings.outputs e religa o roteador é o App/motor (T25, T29). Não pede
// microfone nem lista aparelhos: o seletor do aparelho continua no AudioOutputSelect.
import { useId } from 'react'
import { Segmented } from '../ui'
import type { SegmentedOption } from '../ui'
import { OUTPUT_WARNING_TEXT, multiChoices, outputSummary, planOutputs } from '../../lib/outputPlan'
import type { OutputWarning, PlannedOutputs } from '../../lib/outputPlan'
import type { OutputMode, OutputSettings } from '../../lib/stageContracts'

export interface AudioOutputsSectionProps {
  outputs: OutputSettings
  maxChannels: number
  supportsDevicePick: boolean
  onChange(next: OutputSettings): void
  /**
   * Avisos da leitura do que estava gravado (`migrateOutputs(...).warnings`, guardados pela
   * T25). Opcional: sem ele só aparecem os avisos do plano da placa de agora.
   */
  loadWarnings?: readonly OutputWarning[]
}

type OutputMap = OutputSettings['multi']
type Side = '1' | '2'

const SIDE_OPTIONS: SegmentedOption<Side>[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

const MODE_LABEL: Record<OutputMode, string> = {
  stereo: 'Tudo junto',
  split2: 'Click e Guia separados',
  multi: '4 ou mais saídas',
}

// O Segmented base não apaga a opção desligada; aqui ela fica clara de que não dá pra tocar.
// A marcada continua com cara de escolhida mesmo desligada (1 canal: só leitura).
// flex-wrap: em tela estreita as opções descem de linha em vez de vazar ou cortar texto.
const SEGMENTED =
  'self-start max-w-full flex-wrap [&>button:disabled]:cursor-not-allowed [&>button:disabled:not([aria-checked=true])]:opacity-35'
// text-pretty: o navegador evita deixar uma palavra sozinha na última linha.
const NOTE = 'text-ps-base leading-snug text-pretty text-ps-mut'
const ALERT = 'rounded-ps-md bg-ps-alert-soft px-3 py-2 text-ps-base leading-snug text-pretty font-semibold text-ps-alert inset-ring inset-ring-ps-alert-line'
const SELECT = 'min-h-ps-touch rounded-ps-md bg-ps-s2 px-3 text-ps-md text-ps-bone inset-ring inset-ring-ps-line cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const OPTION = 'bg-ps-s2 text-ps-bone'

/** Canais pra mostrar ao operador: valor estranho conta como 2, igual ao `planOutputs`. */
function shownChannels(maxChannels: number): number {
  return Number.isFinite(maxChannels) && maxChannels >= 1 ? Math.floor(maxChannels) : 2
}

const channelsText = (n: number) => (n === 1 ? '1 canal' : `${n} canais`)
const out = (o: number) => String(o + 1)

/**
 * Avisos âmbar, sem repetir. A queda de 4 ou mais pra separados (Ruling T6-2) diz o lado que
 * vale de verdade (o lado escolhido, `earOnSecond`), não um lado fixo. O resto usa o texto da T6.
 */
function alertTexts(plan: PlannedOutputs, channels: number, loadWarnings: readonly OutputWarning[]): string[] {
  const texts: string[] = []
  if (plan.mode === 'split2' && plan.fellBackFrom === 'multi') {
    texts.push(`Esta placa tem só ${channelsText(channels)}. Usando Click e Guia na saída ${out(plan.click[0])} e a VS na saída ${out(plan.vs[0])}.`)
  } else if (plan.warning) {
    texts.push(OUTPUT_WARNING_TEXT[plan.warning])
  }
  for (const w of loadWarnings) {
    const t = OUTPUT_WARNING_TEXT[w]
    if (t && !texts.includes(t)) texts.push(t)
  }
  return texts
}

export function AudioOutputsSection({ outputs, maxChannels, supportsDevicePick, onChange, loadWarnings = [] }: AudioOutputsSectionProps) {
  const titleId = useId()
  const plan = planOutputs(outputs, maxChannels)
  const channels = shownChannels(maxChannels)
  const canMulti = maxChannels >= 4
  // Aparelho de 1 canal (Ruling T6-mono): o plano já é Tudo junto, com o aviso mono.
  const mono = plan.warning === 'mono'
  const alerts = alertTexts(plan, channels, loadWarnings)

  const emit = (patch: Partial<OutputSettings>) =>
    onChange({ mode: outputs.mode, earOnSecond: outputs.earOnSecond, multi: { ...outputs.multi }, ...patch })

  // A escolha mostra o modo que VALE nesta placa (o plano), não o gravado (Ruling T19-mono-tela):
  // com 1 canal é Tudo junto, só leitura; na queda de 4 ou mais é separados, e a parada do Tab
  // fica nele em vez de em Tudo junto. O gravado nunca muda sozinho e volta com a placa certa.
  const shownMode = plan.mode
  const modeOptions: SegmentedOption<OutputMode>[] = [
    { value: 'stereo', label: MODE_LABEL.stereo, disabled: mono },
    { value: 'split2', label: MODE_LABEL.split2, disabled: mono },
    // Com 3 canais e a VS em 1 e 2, 4 ou mais é o que vale: fica ligada (marcada e parada do
    // Tab, tocar nela não grava), pra a parada não cair em Tudo junto.
    { value: 'multi', label: MODE_LABEL.multi, disabled: mono || (!canMulti && shownMode !== 'multi') },
  ]
  const savedLabel: string | undefined = MODE_LABEL[outputs.mode]
  const waiting = shownMode !== outputs.mode && savedLabel !== undefined

  const setMode = (m: OutputMode) => {
    if (!mono && m !== shownMode) emit({ mode: m })
  }
  const setSide = (s: Side) => {
    const earOnSecond = s === '2'
    if (earOnSecond !== outputs.earOnSecond) emit({ earOnSecond })
  }

  // Mapa de 4 ou mais: os seletores mostram o que vale nesta placa (o plano). Mudar um campo
  // grava o mapa que aparece com a mudança, já resolvido pelo plano: se a VS for pra onde
  // estavam Click e Guia, eles saem do par da VS (nunca na PA) e o resumo mostra pra onde foram.
  const shownMap: OutputMap = {
    vsPair: plan.vs[0] ?? outputs.multi.vsPair,
    click: plan.click[0] ?? outputs.multi.click,
    guide: plan.guide[0] ?? outputs.multi.guide,
  }
  const pick = (field: keyof OutputMap, value: number) => {
    const wanted: OutputMap = { ...shownMap, [field]: value }
    const resolved = planOutputs({ ...outputs, multi: wanted }, maxChannels)
    emit({ multi: { vsPair: resolved.vs[0] ?? wanted.vsPair, click: resolved.click[0] ?? wanted.click, guide: resolved.guide[0] ?? wanted.guide } })
  }
  const showMap = canMulti && plan.mode === 'multi'
  const choices = multiChoices(maxChannels)
  const earChoices = choices.singles.filter((o) => !plan.vs.includes(o))

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-ps-base font-bold text-ps-bone">Saídas de áudio</h3>
      <div className="flex flex-col gap-2">
        <Segmented aria-label="Saídas de áudio" options={modeOptions} value={shownMode} onChange={setMode} className={SEGMENTED} />
        {/* Na queda de 4 ou mais e com 1 canal o aviso âmbar já diz quantos canais a placa tem. */}
        {!canMulti && !mono && plan.fellBackFrom === null && <p className={NOTE}>Esta saída tem {channelsText(channels)}.</p>}
        {waiting && (
          <p className={NOTE}>
            Vale enquanto esta saída tiver {channelsText(channels)}. Sua escolha ({savedLabel}) volta quando a placa tiver {outputs.mode === 'multi' ? 4 : 2} canais.
          </p>
        )}
      </div>

      {plan.mode === 'split2' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-ps-base text-ps-bone">Click e Guia na saída</span>
          <Segmented aria-label="Click e Guia na saída" options={SIDE_OPTIONS} value={outputs.earOnSecond ? '2' : '1'} onChange={setSide} className={SEGMENTED} />
        </div>
      )}

      {showMap && (
        <div className="flex flex-wrap gap-3">
          <MapSelect label="VS estéreo" value={shownMap.vsPair} choices={choices.vsPairs} text={(p) => `Saídas ${out(p)} e ${out(p + 1)}`} onPick={(v) => pick('vsPair', v)} />
          <MapSelect label="Click" value={shownMap.click} choices={earChoices} text={(o) => `Saída ${out(o)}`} onPick={(v) => pick('click', v)} />
          <MapSelect label="Guia" value={shownMap.guide} choices={earChoices} text={(o) => `Saída ${out(o)}`} onPick={(v) => pick('guide', v)} />
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="text-ps-base leading-snug font-semibold tabular-nums text-ps-bone">{outputSummary(plan)}</p>
        {alerts.map((t) => (
          <p key={t} data-output-alert="" className={ALERT}>{t}</p>
        ))}
      </div>

      {!supportsDevicePick && <p className={NOTE}>Neste navegador o som sai pela saída do sistema.</p>}
    </section>
  )
}

interface MapSelectProps { label: string; value: number; choices: number[]; text(o: number): string; onPick(v: number): void }

/** Seletor de uma saída do mapa: grava número (nunca o texto do select), fonte de 16 px e alvo de 44 px. */
function MapSelect({ label, value, choices, text, onPick }: MapSelectProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="ps-label">{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => onPick(Number(e.target.value))}
        className={SELECT}
      >
        {choices.map((o) => (
          <option key={o} value={String(o)} className={OPTION}>{text(o)}</option>
        ))}
      </select>
    </div>
  )
}
