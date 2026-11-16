// Agendador do pulo de seção do palco novo (Parte 2, Arquitetura A). Recebe a intenção armada,
// monta o plano da troca (T11) e marca no relógio do áudio a contagem (só pela entrada do click),
// o calar da guia, a descida das vozes que saem e a entrada das vozes novas (T7), mais o segmento
// novo da linha do tempo (T5). Também desfaz o que agendou. O tique (T5, a cada 25 ms) só decide
// QUANDO olhar o plano; todo som é marcado em tempo do AudioContext.
//
// Regras de quando mexer no que já foi agendado:
// - Agendado, o pulo fica CONGELADO (Ruling T17-congela): o tique não re-planeja nem cancela por
//   causa do plano recalculado (nos últimos 50 ms ele já aponta pro fim da seção seguinte, ou é nulo
//   na final). Só o operador mexe: cancelar ou trocar o alvo, até `T - CANCEL_GUARD`. Depois disso o
//   pulo acontece e o pedido vale logo depois do pouso.
// - Linha do tempo vazia (VS parada, T5) ou posição que não é número: não agenda, não desarma e não
//   cancela o já agendado.
// - Plano nulo com posição válida (cauda da final depois da última barra, ou alvo que saiu da lista):
//   não há pulo possível, então desarma e a tela recebe a intenção nula.
import { afterLanding, armLabel } from '../lib/sectionArm'
import { GUIDE_MUTE_ON_JUMP, MIN_LEAD, planTransition, type TransitionPlan } from '../lib/sectionTransition'
import { ctxTimeOf, dropFrom, heardTime, positionAt, pruneBefore, withSegment } from '../lib/playTimeline'
import { barSeconds, sanitizeGrid } from '../lib/songGrid'
import type { ArmIntent, SectionSpan, SongGrid, TimelineSegment, TransitionView } from '../lib/stageContracts'
import { scheduleCount, type CountBeat, type ScheduledCount } from './countTones'
import type { ClockMode } from './schedulerClock'
import { fadeOutVoices, restoreVoices, stopVoices, type Voice } from './voices'

/** Folga (s) entre agendar e o primeiro evento do pulo; antes disso nada é marcado no áudio. */
export const HORIZON = 0.3
/** Cruzamento (s) das vozes que saem com as que entram, terminando no "1" do destino. */
export const FADE = 0.005
/** Cancelar ou trocar o alvo vale até `T - CANCEL_GUARD`; depois o pulo acontece. */
export const CANCEL_GUARD = 0.03
/** As vozes que saíram (já mudas) são soltas em `T + FADE + RELEASE_AFTER`. */
export const RELEASE_AFTER = 0.03
/**
 * Horizonte com o relógio no setInterval da janela (`mode: 'interval'` da T5): com a janela
 * escondida ele dá 1 tique por segundo, então o agendador olha 1,5 s à frente pra sempre cair um
 * tique antes do primeiro evento.
 */
export const HORIZON_INTERVAL = 1.5

// Rampas do ganho do barramento da guia (calar, voltar, devolver no cancelamento).
const GUIDE_RAMP = 0.01
// Comparação de instantes da música (1 microssegundo, a mesma do songGrid e da T11).
const EPS = 1e-6

export interface SchedulerDeps {
  ctx: BaseAudioContext
  /** Velocidade da música (timeStretch), maior que 0 (Ruling T17-rate). */
  rate(): number
  timeline(): readonly TimelineSegment[]
  setTimeline(next: TimelineSegment[]): void
  spans(): readonly SectionSpan[]
  grid(): SongGrid | null
  currentVoices(): readonly Voice[]
  setCurrentVoices(v: Voice[]): void
  /** O motor cria uma voz por canal com startVoicesForSwitch(ctx, specs, T, targetOffset, fade, rate). */
  startSwitchVoices(T: number, targetOffset: number, fade: number): Voice[]
  /** Entrada do canal de click, ou o countDelay do roteador (R-35); nulo = pulo sem bipes. */
  countDestination(): AudioNode | null
  /** Ganho do barramento da Guia (nunca o fader); nulo = a guia não é calada. */
  guideGain(): AudioParam | null
  /** Atraso da entrada de click e guia (compensação do tom), 0 no tom 0. */
  entryLatency(): number
  clickAudible(): boolean
  /** Chamado só quando muda algo visível (a transição ou a intenção). */
  onView(view: TransitionView | null, intent: ArmIntent | null): void
  /** O pulo pousou em `to` no instante `at` do contexto. */
  onLanded(to: number, at: number): void
  /** Caminho do relógio que chama o tique (T5). 'interval' aumenta o horizonte; sem ela vale o Worker. */
  clockMode?(): ClockMode
}

// Guia calada de `from` a `to` (tempo do contexto, já com a latência da entrada).
interface GuideMute { param: AudioParam; from: number; to: number }

// O pulo marcado no áudio. `plan` em segundos da música, com os bipes que de fato fazem parte do
// pulo; `position` é de onde ele foi visto (pra trocar o alvo sem mudar o instante).
interface Scheduled {
  intent: ArmIntent
  plan: TransitionPlan
  position: number
  rate: number
  barLength: number | null
  T: number
  countCtx: number[]
  count: ScheduledCount | null
  guide: GuideMute | null
  oldVoices: readonly Voice[]
  newVoices: Voice[]
}

const latencyOf = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

function sameIntent(a: ArmIntent | null, b: ArmIntent | null): boolean {
  if (a === null || b === null) return a === b
  return a.target === b.target && a.plays === b.plays
}

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i])

function sameView(a: TransitionView | null, b: TransitionView | null): boolean {
  if (a === null || b === null) return a === b
  return a.from === b.from && a.to === b.to && a.kind === b.kind && a.plays === b.plays && a.switchAt === b.switchAt
    && sameList(a.countTimes, b.countTimes) && sameList(a.countLabels, b.countLabels) && a.countTotal === b.countTotal
    && a.barsLeft === b.barsLeft && a.committed === b.committed && a.clickAudible === b.clickAudible && a.hasGrid === b.hasGrid
}

// Compassos até o pulo contando o que toca, como a T11 (pelo menos 1); nulo sem grade.
function barsUntil(secondsLeft: number, barLength: number | null): number | null {
  if (barLength === null) return null
  return Math.max(1, Math.ceil(secondsLeft / barLength - 1e-6))
}

function muteGuide(g: GuideMute): void {
  g.param.setValueAtTime(1, g.from)
  g.param.linearRampToValueAtTime(0, g.from + GUIDE_RAMP)
  g.param.setValueAtTime(0, g.to)
  g.param.linearRampToValueAtTime(1, g.to + GUIDE_RAMP)
}

// Ganho da guia em `t` pela própria automação do muteGuide.
function guideValueAt(g: GuideMute, t: number): number {
  if (t <= g.from) return 1
  if (t < g.from + GUIDE_RAMP) return 1 - (t - g.from) / GUIDE_RAMP
  if (t <= g.to) return 0
  if (t < g.to + GUIDE_RAMP) return (t - g.to) / GUIDE_RAMP
  return 1
}

/**
 * Devolve a guia em `now` (= ctx.currentTime): parte do valor de `now` e sobe até 1 em 10 ms, sem
 * degrau (com a voz da guia falando, um salto de 0 pra 1 estala no fone). Pela especificação, o
 * cancelAndHoldAtTime só põe um ponto em `now` quando uma rampa cruza `now`; fora de rampa (guia
 * calada, ou antes de calar) ele só apaga o resto, e a subida partiria do último evento. Por isso,
 * fora de rampa, um set no valor que o parâmetro já tem (sem salto, mesmo caindo uma amostra
 * depois). Sem cancelAndHoldAtTime (Firefox), no meio da rampa ela volta a terminar em `now` com o
 * valor da receita, como no countTones. Nada aqui segue um setTarget (Ruling ÁUDIO).
 */
function releaseGuide(g: GuideMute, now: number): void {
  const { param } = g
  const value = guideValueAt(g, now)
  const inRamp = (now > g.from && now < g.from + GUIDE_RAMP) || (now > g.to && now < g.to + GUIDE_RAMP)
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
    if (!inRamp) param.setValueAtTime(value, now)
  } else {
    param.cancelScheduledValues(now)
    if (inRamp) param.linearRampToValueAtTime(value, now)
    else param.setValueAtTime(value, now)
  }
  param.linearRampToValueAtTime(1, now + GUIDE_RAMP)
}

/**
 * Agendador do pulo de seção. O motor (T28) cria um por música tocando, chama `tick` pelo relógio
 * (25 ms) e logo depois de cada play, `setIntent` a cada toque do operador e `reset` na pausa, na
 * busca, na troca de música e no reinício do play. Com a VS parada o motor deixa a linha do tempo
 * vazia: o tique não agenda nada e guarda a intenção. Quem cria chama `dispose`.
 */
export class SectionScheduler {
  readonly #deps: SchedulerDeps
  #intent: ArmIntent | null = null
  #view: TransitionView | null = null
  #sentIntent: ArmIntent | null = null
  #scheduled: Scheduled | null = null
  #disposed = false

  constructor(deps: SchedulerDeps) {
    this.#deps = deps
  }

  /** O que o operador pediu por último (depois do pouso já descontada a passagem). */
  get intent(): ArmIntent | null { return this.#intent }
  /** O que a tela mostra do pulo; nulo sem plano. */
  get view(): TransitionView | null { return this.#view }

  /**
   * Novo pedido do operador. Com o pulo agendado e antes de `T - CANCEL_GUARD`: nulo desfaz tudo;
   * outro alvo troca só as vozes novas e o segmento, no mesmo instante; se o plano novo não tem
   * contagem (loop infinito da própria seção) também para os bipes e devolve a guia; se só o novo
   * tem, agenda os bipes que ainda cabem na folga mínima. Depois da guarda o pulo acontece e o
   * pedido vale logo depois do pouso. Re-planeja já (chama `tick`).
   */
  setIntent(next: ArmIntent | null): void {
    if (this.#disposed) return
    this.#intent = next
    const s = this.#scheduled
    if (s && this.#now() < s.T - CANCEL_GUARD) this.#retarget(s, next)
    this.tick()
  }

  /**
   * Olha o plano no instante `ctx.currentTime`. Sem nada agendado: fora do horizonte só publica a
   * transição (`committed: false`); dentro dele agenda uma vez. Com o pulo agendado: só atualiza a
   * tela até `T + FADE + RELEASE_AFTER`, quando solta as vozes que saíram, entrega as novas ao motor,
   * conta a passagem e já planeja a próxima volta.
   */
  tick(): void {
    if (this.#disposed) return
    const now = this.#now()
    const due = this.#scheduled
    const landed = due && now >= due.T + FADE + RELEASE_AFTER ? due : null
    if (landed) this.#land(landed, now)
    const s = this.#scheduled
    if (s) this.#publish(this.#scheduledView(s, now))
    else this.#plan(now)
    if (landed) this.#deps.onLanded(landed.plan.to, landed.T)
  }

  /**
   * Pausa, busca, troca de música, reinício do play: desfaz o agendado e guarda a intenção. Antes
   * do "1" (`T`) desfaz tudo; do "1" em diante o pulo já soou, então fecha o pouso (as vozes novas
   * passam pro motor, que é quem para o som). A tela fica sem transição até o próximo tique.
   */
  reset(): void {
    if (this.#disposed) return
    const s = this.#scheduled
    const now = this.#now()
    const landed = s && now >= s.T ? s : null
    if (landed) this.#land(landed, now)
    else if (s) this.#undo(s, now)
    this.#publish(null)
    if (landed) this.#deps.onLanded(landed.plan.to, landed.T)
  }

  /** Desfaz o agendado (como o `reset`) e ignora tudo o que vier depois. */
  dispose(): void {
    if (this.#disposed) return
    this.reset()
    this.#disposed = true
  }

  #now(): number { return this.#deps.ctx.currentTime }

  #horizon(): number {
    return this.#deps.clockMode?.() === 'interval' ? HORIZON_INTERVAL : HORIZON
  }

  #plan(now: number): void {
    const intent = this.#intent
    if (intent === null) { this.#publish(null); return }
    const d = this.#deps
    const timeline = d.timeline()
    const rate = d.rate()
    if (timeline.length === 0 || !(rate > 0)) { this.#publish(null); return }
    const position = positionAt(timeline, now, rate)
    if (!Number.isFinite(position)) { this.#publish(null); return }

    const rawGrid = d.grid()
    const grid = rawGrid ? sanitizeGrid(rawGrid) : null
    const plan = planTransition({ spans: d.spans(), grid, position, intent })
    if (plan === null) {
      this.#intent = null
      this.#publish(null)
      return
    }
    const toCtx = (t: number) => ctxTimeOf(timeline, t, now, rate)
    const T = toCtx(plan.switchAt)
    const countCtx = plan.countTimes.map(toCtx)
    if (!Number.isFinite(T) || !countCtx.every((t) => Number.isFinite(t))) { this.#publish(null); return }

    const barLength = grid ? barSeconds(grid) : null
    const first = Math.min(T - FADE, ...countCtx)
    if (first - now > this.#horizon()) {
      this.#publish(this.#viewOf(intent, plan, T, countCtx, plan.barsLeft, false, barLength !== null))
      return
    }

    const beats: CountBeat[] = countCtx.map((at, i) => ({ at, label: plan.countLabels[i] }))
    const { count, guide } = this.#cue(beats, plan.guideMuteFrom !== null, T)
    const oldVoices = [...d.currentVoices()]
    fadeOutVoices(oldVoices, T, FADE)
    const newVoices = d.startSwitchVoices(T, plan.targetOffset, FADE)
    d.setTimeline(withSegment(d.timeline(), { ctxStart: T, songStart: plan.targetOffset }))
    const s: Scheduled = { intent, plan, position, rate, barLength, T, countCtx, count, guide, oldVoices, newVoices }
    this.#scheduled = s
    this.#publish(this.#scheduledView(s, now))
  }

  // Bipes em `countDestination()` e guia calada do primeiro bipe até o "1" (mais a latência da entrada).
  #cue(beats: CountBeat[], wantsGuideMute: boolean, T: number): { count: ScheduledCount | null; guide: GuideMute | null } {
    const d = this.#deps
    if (beats.length === 0) return { count: null, guide: null }
    const dest = d.countDestination()
    const count = dest ? scheduleCount(d.ctx, dest, beats) : null
    // A constante é conferida aqui: o guideMuteFrom do plano é calculado com a constante do módulo da T11.
    const param = GUIDE_MUTE_ON_JUMP && wantsGuideMute ? d.guideGain() : null
    if (!param) return { count, guide: null }
    const L = latencyOf(d.entryLatency())
    const guide: GuideMute = { param, from: beats[0].at + L, to: T + L }
    muteGuide(guide)
    return { count, guide }
  }

  #retarget(s: Scheduled, next: ArmIntent | null): void {
    if (sameIntent(next, s.intent)) return
    const now = this.#now()
    if (next === null) { this.#undo(s, now); return }
    const d = this.#deps
    // Visto do mesmo ponto em que o pulo foi agendado: mesmo instante, mesma seção de saída.
    const rawGrid = d.grid()
    const plan = planTransition({ spans: d.spans(), grid: rawGrid ? sanitizeGrid(rawGrid) : null, position: s.position, intent: next })
    if (plan === null || plan.from !== s.plan.from || Math.abs(plan.switchAt - s.plan.switchAt) > EPS) {
      // Seções ou grade mudaram depois de agendar (ou o alvo saiu da lista): desfaz e o tique re-planeja.
      this.#undo(s, now)
      return
    }
    if (plan.to !== s.plan.to) {
      stopVoices(s.newVoices, now)
      s.newVoices = d.startSwitchVoices(s.T, plan.targetOffset, FADE)
      d.setTimeline(withSegment(d.timeline(), { ctxStart: s.T, songStart: plan.targetOffset }))
    }

    const had = s.plan.countTimes.length > 0
    const has = plan.countTimes.length > 0
    let { countTimes, countLabels, countTotal, guideMuteFrom } = s.plan
    if (had && !has) {
      s.count?.cancel(now)
      if (s.guide) releaseGuide(s.guide, now)
      s.count = null
      s.guide = null
      s.countCtx = []
      ;({ countTimes, countLabels, countTotal, guideMuteFrom } = plan)
    } else if (!had && has) {
      // Armou tarde a contagem: só os bipes que ainda cabem na folga mínima, com o número real.
      const timeline = d.timeline()
      const kept = plan.countTimes
        .map((t, i) => ({ t, label: plan.countLabels[i], at: ctxTimeOf(timeline, t, now, s.rate) }))
        .filter((b) => Number.isFinite(b.at) && b.at >= now + MIN_LEAD)
      countTimes = kept.map((b) => b.t)
      countLabels = kept.map((b) => b.label)
      countTotal = plan.countTotal
      guideMuteFrom = kept.length > 0 && plan.guideMuteFrom !== null ? kept[0].t : null
      s.countCtx = kept.map((b) => b.at)
      const cue = this.#cue(kept.map((b) => ({ at: b.at, label: b.label })), guideMuteFrom !== null, s.T)
      s.count = cue.count
      s.guide = cue.guide
    }
    s.plan = { ...plan, countTimes, countLabels, countTotal, guideMuteFrom }
    s.intent = next
  }

  // Cancela antes do "1": bipes, guia, vozes que saíam e as que entrariam, e o segmento do pulo.
  #undo(s: Scheduled, now: number): void {
    const d = this.#deps
    this.#scheduled = null
    s.count?.cancel(now)
    if (s.guide) releaseGuide(s.guide, now)
    restoreVoices(s.oldVoices, now)
    stopVoices(s.newVoices, now)
    d.setTimeline(dropFrom(d.timeline(), s.T))
  }

  // Fecha o pouso: solta as vozes que saíram (mudas desde T), entrega as novas e conta a passagem.
  // A passagem só conta se o pedido atual é pro alvo que pousou (pedido trocado depois da guarda
  // continua armado). A linha do tempo é podada pelo tempo OUVIDO (T5): a tela lê por ele.
  #land(s: Scheduled, now: number): void {
    const d = this.#deps
    this.#scheduled = null
    stopVoices(s.oldVoices, now)
    d.setCurrentVoices(s.newVoices)
    const asked = this.#intent
    this.#intent = asked !== null && asked.target === s.plan.to ? afterLanding(asked) : asked
    const outputLatency = (d.ctx as Partial<Pick<AudioContext, 'outputLatency'>>).outputLatency ?? 0
    const timeline = d.timeline()
    const pruned = pruneBefore(timeline, heardTime(now, outputLatency, latencyOf(d.entryLatency())))
    if (pruned.length !== timeline.length) d.setTimeline(pruned)
  }

  #scheduledView(s: Scheduled, now: number): TransitionView {
    const barsLeft = now >= s.T ? (s.barLength === null ? null : 1) : barsUntil((s.T - now) * s.rate, s.barLength)
    return this.#viewOf(s.intent, s.plan, s.T, s.countCtx, barsLeft, true, s.barLength !== null)
  }

  #viewOf(intent: ArmIntent, plan: TransitionPlan, T: number, countCtx: readonly number[], barsLeft: number | null, committed: boolean, hasGrid: boolean): TransitionView {
    return {
      from: plan.from, to: plan.to, kind: armLabel(intent, plan.from)?.kind ?? 'proxima', plays: intent.plays,
      switchAt: T, countTimes: [...countCtx], countLabels: [...plan.countLabels], countTotal: plan.countTotal,
      barsLeft, committed, clickAudible: this.#deps.clickAudible(), hasGrid,
    }
  }

  #publish(view: TransitionView | null): void {
    const intent = this.#intent
    if (sameView(view, this.#view) && sameIntent(intent, this.#sentIntent)) return
    this.#view = view
    this.#sentIntent = intent
    this.#deps.onView(view, intent)
  }
}
