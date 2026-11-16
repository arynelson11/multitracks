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
// - Volta seguinte (Ruling T17-volta): o pulo leva junto os bipes da volta seguinte do mesmo pedido
//   (REPETIR com 2 passagens ou mais) que caem antes do pouso mais um tique, porque a volta seguinte
//   só é planejada depois do pouso e o "1" dela, numa seção de 1 compasso, cai no próprio pouso. Se
//   a contagem dela começa a menos de um tempo do pouso, a guia não reabre entre as voltas.
// - Tique que perde a janela inteira de um pulo (fio principal travado): a música seguiu sozinha.
//   Se ela chegou no alvo pelo caminho natural, conta como a passagem; REPETE e LOOP perdidos
//   desarmam (virariam um pulo pra trás); pulo pra outra seção continua armado, mais tarde.
import { afterLanding, armLabel, isSelfLoop } from '../lib/sectionArm'
import { GUIDE_MUTE_ON_JUMP, MIN_LEAD, planTransition, type TransitionPlan } from '../lib/sectionTransition'
import { ctxTimeOf, dropFrom, heardTime, positionAt, pruneBefore, withSegment } from '../lib/playTimeline'
import { barSeconds, pulseSeconds, sanitizeGrid, sectionIndexAt } from '../lib/songGrid'
import type { ArmIntent, SectionSpan, SongGrid, TimelineSegment, TransitionView } from '../lib/stageContracts'
import { scheduleCount, type ScheduledCount } from './countTones'
import { CLOCK_INTERVAL_MS, type ClockMode } from './schedulerClock'
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

// Período do tique no setInterval com a janela escondida (medido na T5: 1 por segundo).
const INTERVAL_TICK = 1
// Rampas do ganho do barramento da guia (calar, voltar, devolver no cancelamento).
const GUIDE_RAMP = 0.01
// Comparação de instantes da música (1 microssegundo, a mesma do songGrid e da T11).
const EPS = 1e-6
// Folga negativa da volta seguinte vista do pouso: o bipe que cai no início da seção não fica de
// fora por arredondamento (o sectionIndexAt tolera 1 microssegundo, então a seção continua a mesma).
const ON_THE_ONE = 1e-7

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

// Um bipe: instante da música, número do tempo no compasso e instante do contexto.
interface Beat { t: number; label: number; at: number }
// Guia calada: desce em `from` e sobe em `to` (tempo do contexto, já com a latência da entrada).
interface Interval { from: number; to: number }

// Volta seguinte, preparada junto com o pulo. `beats`: os bipes dela que já saíram (podem ser
// nenhum). `from`, `switchAt` e `countTotal` dizem de que plano ela é (a volta confere antes de
// adotar); `T` é o "1" dela no contexto e `muteFrom`, o primeiro bipe dela; `mutesGuide`: a guia
// fica calada do pulo até esse "1". Depois do pouso, `iv` é o trecho da guia que vem emendado e
// `baseEnd` é onde ele acabaria sem a emenda (nulo se só existe por ela).
interface NextPass { from: number; switchAt: number; countTotal: number; beats: Beat[]; count: ScheduledCount | null; T: number; muteFrom: number; mutesGuide: boolean; iv: Interval | null; baseEnd: number | null }

// O pulo marcado no áudio. `plan` em segundos da música, com todos os bipes desta volta (inclusive
// os que saíram adiantados); `position` e `minLead` dizem de onde ele foi visto (pra trocar o alvo
// sem mudar o instante); `step` é o passo da contagem (segundos da música); `guideFrom` é o início
// da guia calada desta volta e `guideIv` o trecho dela na guia; `next`, a volta seguinte.
interface Scheduled {
  intent: ArmIntent
  plan: TransitionPlan
  position: number
  minLead: number
  rate: number
  barLength: number | null
  step: number | null
  T: number
  countCtx: number[]
  counts: ScheduledCount[]
  guideFrom: number | null
  guideIv: Interval | null
  next: NextPass | null
  oldVoices: readonly Voice[]
  newVoices: Voice[]
}

// O último plano publicado sem agendar: pra notar o tique que perdeu a janela inteira.
interface Seen { intent: ArmIntent; from: number; to: number; switchAt: number }

const latencyOf = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

// Igualdade rasa de objetos simples: mesmo conjunto de chaves, valores iguais, listas pelo conteúdo.
function shallowSame<T extends object>(a: T | null, b: T | null): boolean {
  if (a === null || b === null) return a === b
  const keys = Object.keys(a) as (keyof T)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => {
    const x: unknown = a[k]
    const y: unknown = b[k]
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => Object.is(v, y[i]))
    return Object.is(x, y)
  })
}

/** Igualdade da transição que a tela mostra (qualquer campo, listas pelo conteúdo): decide o `onView`. */
export function sameTransitionView(a: TransitionView | null, b: TransitionView | null): boolean {
  return shallowSame(a, b)
}

const sameIntent = (a: ArmIntent | null, b: ArmIntent | null) => shallowSame(a, b)

// Compassos até o pulo contando o que toca, como a T11 (pelo menos 1); nulo sem grade.
function barsUntil(secondsLeft: number, barLength: number | null): number | null {
  if (barLength === null) return null
  return Math.max(1, Math.ceil(secondsLeft / barLength - 1e-6))
}

/**
 * Segura o parâmetro em `now` (= ctx.currentTime) no valor `value`, que é o da própria automação
 * nesse instante, sem degrau. Pela especificação, o cancelAndHoldAtTime só põe um ponto em `now`
 * quando uma rampa cruza `now`; fora de rampa ele só apaga o resto, e uma rampa pedida depois
 * partiria do último evento. Por isso, fora de rampa, um set no valor que o parâmetro já tem (sem
 * salto, mesmo caindo uma amostra depois). Sem cancelAndHoldAtTime (Firefox), no meio da rampa ela
 * volta a terminar em `now` com o valor da receita, como no countTones. Nunca segue um setTarget
 * (Ruling ÁUDIO): a guia e os envelopes das vozes só usam set e rampa linear.
 */
function holdParam(param: AudioParam, now: number, value: number, inRamp: boolean): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
    if (!inRamp) param.setValueAtTime(value, now)
  } else {
    param.cancelScheduledValues(now)
    if (inRamp) param.linearRampToValueAtTime(value, now)
    else param.setValueAtTime(value, now)
  }
}

/**
 * Ganho do barramento da guia: trechos calados em ordem (desce em 10 ms em `from`, sobe em 10 ms em
 * `to`), mais a volta pra 1 depois de um cancelamento. Sabe o valor em qualquer instante pela
 * própria receita, pra segurar e mudar sem degrau. Mudar o fim de um trecho que ainda não acabou
 * (emendar a volta seguinte, ou desfazer a emenda) só apaga eventos do futuro com o valor parado.
 */
class GuideTrack {
  #param: AudioParam | null = null
  #list: Interval[] = []
  #release: { at: number; from: number } | null = null

  has(iv: Interval | null): iv is Interval { return iv !== null && this.#list.includes(iv) }

  /** Trecho novo depois de tudo o que já está marcado (começa em `now` no mínimo). */
  append(param: AudioParam, iv: Interval, now: number): Interval {
    this.#prune(now)
    this.#param = param
    let from = Math.max(iv.from, now)
    if (this.#release) from = Math.max(from, this.#release.at + GUIDE_RAMP)
    const to = Math.max(iv.to, from + GUIDE_RAMP)
    param.setValueAtTime(1, from)
    param.linearRampToValueAtTime(0, from + GUIDE_RAMP)
    param.setValueAtTime(0, to)
    param.linearRampToValueAtTime(1, to + GUIDE_RAMP)
    const added = { from, to }
    this.#list.push(added)
    return added
  }

  /** Muda o fim do último trecho, que ainda não começou a subir. */
  setEnd(iv: Interval, to: number, now: number): void {
    const param = this.#param
    if (!param || !this.has(iv) || now >= iv.to) return
    const end = Math.max(to, now, iv.from + GUIDE_RAMP)
    param.cancelScheduledValues(iv.to)
    param.setValueAtTime(0, end)
    param.linearRampToValueAtTime(1, end + GUIDE_RAMP)
    iv.to = end
  }

  /** Tira o último trecho: antes de ele começar só apaga; depois devolve a guia. */
  remove(iv: Interval, now: number): void {
    if (!this.has(iv)) return
    if (this.#param && now < iv.from) {
      this.#param.cancelScheduledValues(iv.from)
      this.#list = this.#list.filter((x) => x !== iv)
      return
    }
    this.release(now)
  }

  /** Devolve a guia em `now`: parte do valor de `now` e sobe até 1 em 10 ms. */
  release(now: number): void {
    const param = this.#param
    this.#prune(now)
    if (!param || (this.#list.length === 0 && this.#release === null)) { this.#list = []; return }
    const value = this.#valueAt(now)
    holdParam(param, now, value, this.#inRamp(now))
    param.linearRampToValueAtTime(1, now + GUIDE_RAMP)
    this.#list = []
    this.#release = { at: now, from: value }
  }

  #prune(now: number): void {
    this.#list = this.#list.filter((iv) => iv.to + GUIDE_RAMP > now)
    if (this.#release && this.#release.at + GUIDE_RAMP <= now) this.#release = null
  }

  #valueAt(t: number): number {
    const r = this.#release
    if (r && t >= r.at && t < r.at + GUIDE_RAMP) return r.from + ((1 - r.from) * (t - r.at)) / GUIDE_RAMP
    for (const iv of this.#list) {
      if (t <= iv.from) return 1
      if (t < iv.from + GUIDE_RAMP) return 1 - (t - iv.from) / GUIDE_RAMP
      if (t <= iv.to) return 0
      if (t < iv.to + GUIDE_RAMP) return (t - iv.to) / GUIDE_RAMP
    }
    return 1
  }

  #inRamp(t: number): boolean {
    const r = this.#release
    if (r && t > r.at && t < r.at + GUIDE_RAMP) return true
    return this.#list.some((iv) => (t > iv.from && t < iv.from + GUIDE_RAMP) || (t > iv.to && t < iv.to + GUIDE_RAMP))
  }
}

/**
 * Agendador do pulo de seção. O motor (T28) cria o agendador e chama `tick` pelo relógio (25 ms) e
 * logo depois de cada play, `setIntent` a cada pedido do operador (botoeira, onda, REPETIR, LOOP,
 * banda) e `reset` na pausa, na busca, na troca de música e no reinício do play. Com a VS parada o
 * motor deixa a linha do tempo vazia: o tique não agenda nada e guarda a intenção. Quem cria chama
 * `dispose`. O aviso ao operador de relógio no setInterval (`clockMode`) é da tela (T28/T29): a
 * `TransitionView` não tem campo pra isso.
 */
export class SectionScheduler {
  readonly #deps: SchedulerDeps
  readonly #guide = new GuideTrack()
  #intent: ArmIntent | null = null
  #view: TransitionView | null = null
  #sentIntent: ArmIntent | null = null
  #scheduled: Scheduled | null = null
  #carry: NextPass | null = null
  #seen: Seen | null = null
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
   * tem, agenda os bipes que ainda cabem na folga mínima. A volta seguinte é refeita pro pedido
   * novo. Depois da guarda o pulo acontece e o pedido vale logo depois do pouso. Re-planeja já.
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
   * do "1" (`T`) desfaz tudo (a voz nova que já subia desce em rampa, como a antiga volta); do "1"
   * em diante o pulo já soou, então fecha o pouso (as vozes novas passam pro motor, que é quem para
   * o som). Os bipes da volta seguinte saem e a guia volta. A tela fica sem transição até o tique.
   */
  reset(): void {
    if (this.#disposed) return
    const s = this.#scheduled
    const now = this.#now()
    this.#seen = null
    const landed = s && now >= s.T ? s : null
    if (landed) this.#land(landed, now)
    else if (s) this.#undo(s, now)
    this.#dropCarry(now)
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

  #tickPeriod(): number {
    return this.#deps.clockMode?.() === 'interval' ? INTERVAL_TICK : CLOCK_INTERVAL_MS / 1000
  }

  #latency(): number { return latencyOf(this.#deps.entryLatency()) }

  #grid(): SongGrid | null {
    const raw = this.#deps.grid()
    return raw ? sanitizeGrid(raw) : null
  }

  #plan(now: number): void {
    const d = this.#deps
    let intent = this.#intent
    if (intent === null) { this.#seen = null; this.#dropCarry(now); this.#publish(null); return }
    const timeline = d.timeline()
    const rate = d.rate()
    if (timeline.length === 0 || !(rate > 0)) { this.#publish(null); return }
    const position = positionAt(timeline, now, rate)
    if (!Number.isFinite(position)) { this.#publish(null); return }
    // Na pré-contagem do play (antes do primeiro segmento) a posição fica parada no ponto de
    // retomada: a folga desconta o tempo que falta pra música começar, senão o bipe que cai ali sai.
    const ahead = timeline[0].ctxStart - now
    const minLead = ahead > 0 ? Math.max(0, MIN_LEAD - ahead * rate) : MIN_LEAD
    const spans = d.spans()
    const grid = this.#grid()

    intent = this.#afterMissedWindow(intent, spans, position + minLead)
    if (intent === null) { this.#dropCarry(now); this.#publish(null); return }

    const plan = planTransition({ spans, grid, position, intent, minLead })
    if (plan === null) {
      this.#intent = null
      this.#seen = null
      this.#dropCarry(now)
      this.#publish(null)
      return
    }
    const toCtx = (t: number) => ctxTimeOf(timeline, t, now, rate)
    const T = toCtx(plan.switchAt)
    const fresh: Beat[] = plan.countTimes.map((t, i) => ({ t, label: plan.countLabels[i], at: toCtx(t) }))
    if (!Number.isFinite(T) || !fresh.every((b) => Number.isFinite(b.at))) { this.#publish(null); return }

    // Bipes desta volta que já saíram com o pulo de antes: só servem se o plano é o mesmo.
    const carry = this.#carry && this.#fits(this.#carry, plan) ? this.#carry : null
    if (this.#carry && !carry) this.#dropCarry(now)
    const carried = carry?.beats ?? []
    const toSchedule = fresh.filter((b) => !carried.some((c) => c.label === b.label))
    const beats = [...carried, ...toSchedule].sort((a, b) => a.at - b.at)
    const merged: TransitionPlan = { ...plan, countTimes: beats.map((b) => b.t), countLabels: beats.map((b) => b.label), guideMuteFrom: GUIDE_MUTE_ON_JUMP && beats.length > 0 ? beats[0].t : null }
    const countCtx = beats.map((b) => b.at)
    const barLength = grid ? barSeconds(grid) : null

    const first = Math.min(T - FADE, ...toSchedule.map((b) => b.at))
    if (first - now > this.#horizon()) {
      this.#seen = { intent, from: plan.from, to: plan.to, switchAt: plan.switchAt }
      this.#publish(this.#viewOf(intent, merged, T, countCtx, plan.barsLeft, false, barLength !== null))
      return
    }

    this.#seen = null
    this.#carry = null
    const counts = carry?.count ? [carry.count] : []
    const own = this.#scheduleBeats(toSchedule)
    if (own) counts.push(own)
    const oldVoices = [...d.currentVoices()]
    fadeOutVoices(oldVoices, T, FADE)
    const newVoices = d.startSwitchVoices(T, plan.targetOffset, FADE)
    d.setTimeline(withSegment(d.timeline(), { ctxStart: T, songStart: plan.targetOffset }))
    const s: Scheduled = {
      intent, plan: merged, position, minLead, rate, barLength, step: grid ? pulseSeconds(grid) * grid.countEvery : null,
      T, countCtx, counts, guideFrom: null, guideIv: null, next: null, oldVoices, newVoices,
    }
    if (carry?.mutesGuide && this.#guide.has(carry.iv)) {
      // A guia já está calada desde o pulo de antes, emendada até este "1".
      s.guideIv = carry.iv
      s.guideFrom = carry.iv.from
    } else if (GUIDE_MUTE_ON_JUMP && beats.length > 0) {
      s.guideFrom = Math.max(beats[0].at + this.#latency(), now)
    }
    s.next = this.#nextPass(s, spans, grid)
    this.#scheduled = s
    this.#applyGuide(s, now)
    this.#publish(this.#scheduledView(s, now))
  }

  // Tique que perdeu a janela inteira do último plano publicado (o pulo dele já passou sem agendar).
  #afterMissedWindow(intent: ArmIntent, spans: readonly SectionSpan[], p: number): ArmIntent | null {
    const seen = this.#seen
    if (!seen || !sameIntent(seen.intent, intent) || p <= seen.switchAt + EPS) return intent
    this.#seen = null
    if (seen.to === seen.from) this.#intent = null
    else if (sectionIndexAt(spans, p) === seen.to) this.#intent = afterLanding(intent)
    return this.#intent
  }

  #fits(c: NextPass, plan: TransitionPlan): boolean {
    return plan.countTotal > 0 && c.from === plan.from && c.countTotal === plan.countTotal && Math.abs(c.switchAt - plan.switchAt) <= EPS
  }

  #scheduleBeats(beats: readonly Beat[]): ScheduledCount | null {
    if (beats.length === 0) return null
    const d = this.#deps
    const dest = d.countDestination()
    return dest ? scheduleCount(d.ctx, dest, beats.map(({ at, label }) => ({ at, label }))) : null
  }

  // Volta seguinte do mesmo pedido, vista do pouso: os bipes dela que caem antes do pouso mais um
  // tique (com a folga mínima) saem agora, convertidos pelo segmento novo (Ruling T17-volta). A
  // guia emenda quando a contagem dela começa a menos de um tempo do pouso, tenha o bipe saído
  // adiantado ou não (com folga 0 o bipe 0,1 s depois do pouso fica pro plano dela).
  #nextPass(s: Scheduled, spans: readonly SectionSpan[], grid: SongGrid | null): NextPass | null {
    const next = afterLanding(s.intent)
    if (next === null || isSelfLoop(next, s.plan.to)) return null
    const np = planTransition({ spans, grid, position: s.plan.targetOffset, intent: next, minLead: -ON_THE_ONE })
    if (np === null || np.from !== s.plan.to || np.countTimes.length === 0) return null
    const toCtx = (t: number) => s.T + (t - s.plan.targetOffset) / s.rate
    const cutoff = s.T + FADE + RELEASE_AFTER + this.#tickPeriod() + MIN_LEAD
    const muteFrom = toCtx(np.countTimes[0])
    const beats = np.countTimes.map((t, i) => ({ t, label: np.countLabels[i], at: toCtx(t) })).filter((b) => b.at < cutoff)
    const mutesGuide = GUIDE_MUTE_ON_JUMP && s.step !== null && (muteFrom - s.T) * s.rate < s.step - EPS
    if (beats.length === 0 && !mutesGuide) return null
    return { from: np.from, switchAt: np.switchAt, countTotal: np.countTotal, beats, count: this.#scheduleBeats(beats), T: toCtx(np.switchAt), muteFrom, mutesGuide, iv: null, baseEnd: null }
  }

  // Trecho da guia calada desta volta: do primeiro bipe (mais L) ao "1", ou ao "1" da volta seguinte
  // quando ela emenda; só a volta seguinte, se esta não cala.
  #guideWanted(s: Scheduled): Interval | null {
    if (!GUIDE_MUTE_ON_JUMP) return null
    const L = this.#latency()
    const n = s.next?.mutesGuide ? s.next : null
    if (s.guideFrom !== null) return { from: s.guideFrom, to: (n ? n.T : s.T) + L }
    if (n) return { from: n.muteFrom + L, to: n.T + L }
    return null
  }

  #applyGuide(s: Scheduled, now: number): void {
    const param = this.#deps.guideGain()
    const want = this.#guideWanted(s)
    const have = this.#guide.has(s.guideIv) ? s.guideIv : null
    if (have === null) {
      s.guideIv = want && param ? this.#guide.append(param, want, now) : null
    } else if (want === null) {
      this.#guide.remove(have, now)
      s.guideIv = null
    } else if (want.from !== have.from) {
      this.#guide.remove(have, now)
      s.guideIv = param && want.from > now ? this.#guide.append(param, want, now) : null
    } else if (want.to !== have.to) {
      this.#guide.setEnd(have, want.to, now)
    }
    if (s.guideFrom !== null && s.guideIv) s.guideFrom = s.guideIv.from
  }

  #retarget(s: Scheduled, next: ArmIntent | null): void {
    if (sameIntent(next, s.intent)) return
    const now = this.#now()
    if (next === null) { this.#undo(s, now); return }
    const d = this.#deps
    const spans = d.spans()
    const grid = this.#grid()
    // Visto do mesmo ponto em que o pulo foi agendado: mesmo instante, mesma seção de saída.
    const plan = planTransition({ spans, grid, position: s.position, intent: next, minLead: s.minLead })
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
    let { countTimes, countLabels, countTotal, guideMuteFrom } = s.plan
    if (had && plan.countTotal === 0) {
      for (const c of s.counts) c.cancel(now)
      s.counts = []
      s.countCtx = []
      s.guideFrom = null
      ;({ countTimes, countLabels, countTotal, guideMuteFrom } = plan)
    } else if (!had && plan.countTimes.length > 0) {
      // Armou tarde a contagem: só os bipes que ainda cabem na folga mínima, com o número real.
      const timeline = d.timeline()
      const kept = plan.countTimes
        .map((t, i) => ({ t, label: plan.countLabels[i], at: ctxTimeOf(timeline, t, now, s.rate) }))
        .filter((b) => Number.isFinite(b.at) && b.at >= now + MIN_LEAD)
      countTimes = kept.map((b) => b.t)
      countLabels = kept.map((b) => b.label)
      countTotal = plan.countTotal
      guideMuteFrom = GUIDE_MUTE_ON_JUMP && kept.length > 0 ? kept[0].t : null
      s.countCtx = kept.map((b) => b.at)
      const own = this.#scheduleBeats(kept)
      s.counts = own ? [own] : []
      s.guideFrom = guideMuteFrom !== null ? kept[0].at + this.#latency() : null
    }
    s.plan = { ...plan, countTimes, countLabels, countTotal, guideMuteFrom }
    s.intent = next
    s.next?.count?.cancel(now)
    s.next = this.#nextPass(s, spans, grid)
    this.#applyGuide(s, now)
  }

  // Cancela antes do "1": bipes (desta volta e da seguinte), guia, vozes que saíam e as que
  // entrariam, e o segmento do pulo.
  #undo(s: Scheduled, now: number): void {
    const d = this.#deps
    this.#scheduled = null
    for (const c of s.counts) c.cancel(now)
    s.next?.count?.cancel(now)
    if (this.#guide.has(s.guideIv)) this.#guide.remove(s.guideIv, now)
    restoreVoices(s.oldVoices, now)
    this.#silenceNewVoices(s, now)
    d.setTimeline(dropFrom(d.timeline(), s.T))
  }

  // Vozes do pulo desfeito. Antes de `T - FADE` nenhuma começou: param já. Entre `T - FADE` e `T`
  // (só o reset chega aqui) a que já subia segura o envelope em `now` e desce em FADE, espelho da
  // antiga que volta pelo restoreVoices (a soma das duas fica 1); para depois, já em silêncio. O
  // jeito de segurar é o mesmo do restoreVoices da T7: cancelAndHoldAtTime (a subida cruza `now`,
  // então o ponto entra) ou, sem ele, o valor atual do parâmetro. Valor de outra fonte deixaria a
  // soma fora de 1 (medido no Chrome sem cancelAndHoldAtTime: 0,004 com a receita aqui e o valor
  // atual na antiga). Alvo em 0:00 não tem pré-rolagem: a voz nova só começaria em `T`.
  #silenceNewVoices(s: Scheduled, now: number): void {
    const rising = now >= s.T - FADE && s.plan.targetOffset >= FADE * s.rate
    if (!rising) { stopVoices(s.newVoices, now); return }
    for (const v of s.newVoices) {
      const gain = v.env.gain
      if (typeof gain.cancelAndHoldAtTime === 'function') {
        gain.cancelAndHoldAtTime(now)
      } else {
        const held = gain.value
        gain.cancelScheduledValues(now)
        gain.setValueAtTime(held, now)
      }
      gain.linearRampToValueAtTime(0, now + FADE)
    }
    stopVoices(s.newVoices, now + FADE)
  }

  // Fecha o pouso: solta as vozes que saíram (mudas desde T), entrega as novas e conta a passagem.
  // A passagem só conta se o pedido atual é pro alvo que pousou (pedido trocado depois da guarda
  // continua armado). Os bipes adiantados da volta seguinte ficam esperando o plano dela. A linha
  // do tempo é podada pelo tempo OUVIDO (T5): a tela lê por ele.
  #land(s: Scheduled, now: number): void {
    const d = this.#deps
    this.#scheduled = null
    this.#seen = null
    stopVoices(s.oldVoices, now)
    d.setCurrentVoices(s.newVoices)
    const asked = this.#intent
    this.#intent = asked !== null && asked.target === s.plan.to ? afterLanding(asked) : asked
    const L = this.#latency()
    this.#carry = s.next ? { ...s.next, iv: s.next.mutesGuide ? s.guideIv : null, baseEnd: s.guideFrom !== null ? s.T + L : null } : null
    const outputLatency = (d.ctx as Partial<Pick<AudioContext, 'outputLatency'>>).outputLatency ?? 0
    const timeline = d.timeline()
    const pruned = pruneBefore(timeline, heardTime(now, outputLatency, L))
    if (pruned.length !== timeline.length) d.setTimeline(pruned)
  }

  // Bipes adiantados que a volta não adotou (pedido mudou, cancelado, pausa): saem, e a guia
  // emendada volta pro fim que teria sem a emenda (ou é devolvida, se ele já passou).
  #dropCarry(now: number): void {
    const c = this.#carry
    if (!c) return
    this.#carry = null
    c.count?.cancel(now)
    if (!c.mutesGuide || !this.#guide.has(c.iv)) return
    if (c.baseEnd !== null && now < c.baseEnd) this.#guide.setEnd(c.iv, c.baseEnd, now)
    else this.#guide.remove(c.iv, now)
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
    if (sameTransitionView(view, this.#view) && sameIntent(intent, this.#sentIntent)) return
    this.#view = view
    this.#sentIntent = intent
    this.#deps.onView(view, intent)
  }
}
