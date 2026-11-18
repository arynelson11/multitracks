import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import JSZip from 'jszip';
import * as Tone from 'tone';
import SignalsmithStretch, { type SignalsmithStretchNode } from 'signalsmith-stretch';
import type { Channel, ChannelRole, Song, Marker } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { detectKey, generateEndlessClickTrackFromSample } from '../lib/AudioAnalyzer';
import { loadClickSelection } from '../lib/clickLibrary';
import { attackSeconds } from '../lib/clickAttack';
import type { ClickAnalysis } from '../lib/clickMeter';
import { autoClickChecks, renderAutoClick, type AutoClickCheck, type AutoClickOkPlan } from '../lib/autoClick';
// A conta pesada da grade roda neste Worker (Ruling T27-worker). `?worker&inline`: o código dele
// vai dentro do pacote e nasce por Blob URL (funciona em file:// no app de computador).
import GridWorker from '../workers/gridWorker?worker&inline';
import { tempoChannelsForPlan, type GridWorkerChannel, type GridWorkerResponse, type GridWorkerTask } from '../workers/gridWorker';
import { sanitizeTimeSignature } from '../lib/cloudBpm';
import { barSeconds, gridFromBpm, gridFromClick, gridWarning, keepManualMeter, pulseSeconds, sanitizeGrid, sectionIndexAt, sectionSpans, withMeter } from '../lib/songGrid';
import { isCompound, type ArmIntent, type GridWarning, type Plays, type SectionSpan, type SongGrid, type StageGates, type StageMode, type TimeSignature, type TransitionView } from '../lib/stageContracts';
import { sanitizeSemitones } from '../lib/pitchRules';
import { getCachedStem, getCachedStemNames, isSongCached } from '../lib/offlineCache';
import { applyChannelMetaToList, autoPanFor, channelGain, findClickChannel, isPitchExempt, pickMainChannel, pitchChangeAction, wantsFormantCompensation, type ChannelMetaPatch } from '../lib/channelRoles';
import { arrangeChannels, resolveChannelRole, type ChannelIdentity } from '../lib/channelNames';
import { REPERTOIRE_SCHEMA_VERSION, migrateManifestSong, migrateSavedSong, toManifestSong, toSavedSong, type SavedSong } from '../lib/repertoireSchema';
import { createOutputGraph, type OutputGraph } from '../audio/outputGraph';
import { createSchedulerClock, type ClockMode, type SchedulerClock } from '../audio/schedulerClock';
import { FADE as SWITCH_FADE, SectionScheduler } from '../audio/sectionScheduler';
import { startVoice, startVoicesForSwitch, stopVoices, type Voice, type VoiceSpec } from '../audio/voices';
import { scheduleCount, type ScheduledCount } from '../audio/countTones';
import { cueReachesVs, effectivePan, planOutputs, sanitizeOutputs, type PlannedOutputs } from '../lib/outputPlan';
import { ctxTimeOf, heardTime, positionAt } from '../lib/playTimeline';
import { armAt, armRepeat as armRepeatIntent, bandRepeat, stepSection as stepSectionIntent, tapSection, toggleLoop, type ArmContext, type ArmResult } from '../lib/sectionArm';
import type { OutputPlan, OutputSettings, TimelineSegment } from '../lib/stageContracts';

// Engine de tom: signalsmith-stretch (MIT). O worklet e o WASM são gerados
// inline em runtime (Blob + base64), então funciona offline no desktop sob
// file:// — sem arquivo servido e sem caminho absoluto (que era o que quebrava
// o RubberBand no desktop). Pitch puro: muda o tom sem alterar a velocidade.

// O formato do repertório salvo no aparelho (SavedSong, v3 com nome, papel e
// ordem do usuário, a grade e o compasso salvo) e do manifest do ZIP vive em
// src/lib/repertoireSchema.ts.

// Instante comum de início: 2 blocos de áudio (128 amostras cada; 5,33 ms a
// 48 kHz) depois do relógio, na mesma grade de blocos do start(0) da v1.4.9.
// Com 1 bloco, sob carga (22 worklets) o motor às vezes já estava calculando o
// bloco seguinte e parte das faixas começava 1 bloco depois (medido); com 2,
// nenhuma separação. A folga entra em todo seek, loop e salto de seção tocando,
// por isso é a mínima segura: 40 ms davam um tropeço audível a cada volta.
const START_LEAD_QUANTA = 2;
// Reserva (a folga antiga), só quando o motor de áudio chegou no instante comum
// antes de o laço de start() terminar: sistema que calcula vários blocos de uma
// vez (Windows, iPhone) ou aparelho travado naquele instante.
const RETRY_LEAD_S = 0.04;
const nextRenderQuantum = (ctx: BaseAudioContext, quanta: number): number => {
    const quantum = 128 / ctx.sampleRate;
    return (Math.floor(ctx.currentTime / quantum + 1e-6) + quanta) * quantum;
};
// Ruling T30-grade: instante (tempo do contexto) ou ponto da faixa na amostra mais perto. Fonte que
// começa fora da grade de amostras, no instante ou no ponto da faixa, é lida pelo navegador com
// interpolação linear, que tira agudos: medido no Chrome pelo harness da T30, -0,11 dB em 4,5 kHz
// depois do pulo e -0,08 dB depois da pré-contagem; com a fração no meio da amostra, a conta dá
// uns -2 dB em 10 kHz. Desloca no máximo meia amostra (~10 µs a 48 kHz).
const onSampleGrid = (t: number, sampleRate: number): number => Math.round(t * sampleRate) / sampleRate;

// Faixa mono: o panner trabalha com 1 canal. A saída do worklet de tom é
// estéreo (L = R) e, com o panner no padrão, o StereoPanner passava a tratar a
// faixa como estéreo: ela subia +5,8 dB em pan total e +2,8 dB no centro ao
// transpor (medido). Em 1 canal a média de L e R é a própria faixa. Estéreo
// não muda.
const setupPannerForBuffer = (panner: StereoPannerNode, buffer: AudioBuffer) => {
    if (buffer.numberOfChannels !== 1) return;
    panner.channelCountMode = 'explicit';
    panner.channelCount = 1;
};

// === Saídas por papel (Parte 2, T25; spec 5e, R-23, R-24) ===
// O fader de cada canal liga no barramento do papel dele (Click, Guia ou VS) do grafo da T12
// (src/audio/outputGraph.ts), nunca direto no principal; o panner do canal recebe o pan
// EFETIVO (effectivePan): o knob em "Tudo junto", o lado do papel em "Click e Guia
// separados" (mesmo nível do pan automático de antes) e, em "4 ou mais", -1 pro Click e a
// Guia e o knob pra VS. O `ch.pan` salvo é só o knob: nem o papel nem o pan automático
// gravam nele (Ruling T25-autopan-2).

/**
 * Pan que o panner do canal recebe. Em "Tudo junto" com o pan automático ligado, o lado do
 * papel (Click e Guia à esquerda, o resto à direita, como na v1.4.15), sem tocar no knob;
 * nos outros casos o efetivo do plano com o knob.
 */
const channelPanFor = (ch: ChannelIdentity & { pan: number }, plan: OutputPlan, autoPan: boolean): number =>
    effectivePan(plan.mode === 'stereo' && autoPan ? autoPanFor(ch, true).pan : ch.pan, resolveChannelRole(ch), plan);
// A contagem sem canal de click (R-35) conta como um Click sem knob: o panner dela recebe o
// pan efetivo do papel Click (com o pan automático de "Tudo junto", o lado do ouvido).
const COUNT_CHANNEL = { id: '', name: 'Click', role: 'click' as const, pan: 0 };

// === Vozes do motor (Parte 2, T26; Arquitetura A) ===
// Soltar uma voz tocando (pausa, busca, troca de música): o envelope dela desce em curva
// exponencial a partir do valor que tem no instante da soltura e a fonte para depois, já em
// silêncio. Parar seco no meio da onda estalava na PA e no fone. A soltura começa com a folga
// do corte à frente do relógio (cutLead: a thread do áudio calcula blocos adiantados; marcada
// no passado, a curva começaria do meio e daria degrau). É setTarget depois do segurar, nunca
// rampa depois de setTarget em curso (Ruling ÁUDIO). Voz que só começa depois da soltura (a da
// pré-contagem) para já, sem som.
const VOICE_RELEASE_TC = 0.003;
// Parada depois do começo da soltura: 10 constantes de tempo, o envelope abaixo de 0,0001.
const VOICE_RELEASE_STOP = 0.03;
// Bipe cancelado soando: os osciladores param 20 ms depois do cancel (CANCEL_STOP da T7,
// countTones.ts), com folga.
const COUNT_CANCEL_TAIL = 0.03;
// Bipe da receita do v6: os osciladores param 0,22 s depois do início dele.
const COUNT_BEEP_LENGTH = 0.22;
// Lista vazia única, pro React não renderizar de novo à toa.
const NO_TIMES: number[] = [];

// === Pulo de seção do palco novo (Parte 2, T28; Arquitetura A) ===
// Sem `sectionGates` (testes, harness): tudo liberado. O App passa os portões do plano.
const ALL_SECTION_GATES: StageGates = { sections: true, infinite: true, maxRepeats: Infinity, bandSections: true };
// FADE (R-32): uma rampa única no principal, do volume até 0 nos últimos 5 s da música.
const FADE_OUT_S = 5;
// Volume principal mexido com o FADE marcado: chega no valor novo em 50 ms, só por rampa linear
// (nunca rampa depois de setTarget em curso, Ruling ÁUDIO).
const MASTER_RAMP_S = 0.05;
// Descida do principal na "próxima" tocando: setTarget pra 0,01 com constante de 0,3 s (cerca de
// -35 dB em 1,5 s, quando a troca acontece).
const NEXT_FADE_FLOOR = 0.01;
const NEXT_FADE_TC = 0.3;
// O principal volta pro volume em 5 ms por rampa linear depois que a música velha calou (Ruling
// I2-proxima).
const MASTER_SETTLE_S = 0.005;

/**
 * Segura o parâmetro em `t` sem mudar o valor: `cancelAndHoldAtTime` onde existe; no Firefox,
 * cancelScheduledValues(t) + setValueAtTime(valor de agora, t).
 */
function holdParam(param: AudioParam, t: number): void {
    if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(t);
        return;
    }
    const current = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(current, t);
}

/**
 * Solta as vozes (ver acima). `startOf` diz quando cada uma começa (tempo do contexto).
 * Devolve até quando ainda sai som delas (`until`: a cauda conta pro corte das trocas de rota e
 * segura o principal do play seguinte) e o instante em que a curva começa a descer (`at`, nulo se
 * nenhuma voz soava): até ali a voz velha segue em ganho 1.
 */
function releaseVoices(ctx: BaseAudioContext, voices: readonly Voice[], startOf: (v: Voice) => number): { at: number | null; until: number } {
    const now = ctx.currentTime;
    const t = now + cutLead(ctx);
    let until = now;
    let at: number | null = null;
    for (const v of voices) {
        if (startOf(v) > t) {
            // Ainda não começou (pré-contagem ou play recém-agendado): para antes de soar.
            stopVoices([v], now);
            continue;
        }
        holdParam(v.env.gain, t);
        v.env.gain.setTargetAtTime(0, t, VOICE_RELEASE_TC);
        stopVoices([v], t + VOICE_RELEASE_STOP);
        until = t + VOICE_RELEASE_STOP;
        at = t;
    }
    return { at, until };
}

// Ruling I4-busca: na busca e em cada volta do LOOP do palco antigo, a voz velha fica em ganho 1
// por cima da nova no máximo isto (a sobreposição aceita na Ruling T26-busca), em qualquer
// aparelho. A soltura começa com a folga do corte (cutLead: 10 ms, ou duas latências do aparelho);
// com a latência grande (Windows, placa com buffer de 10 ms) as vozes novas esperam até a voz velha
// estar a no máximo isto de começar a descer, em vez de somar com ela por até 20 ms em ganho 1.
const SEEK_OVERLAP_MAX_S = 0.0064;
/** O primeiro limite de bloco de áudio (128 amostras) a partir de `t`. */
const quantumAtOrAfter = (ctx: BaseAudioContext, t: number): number => {
    const quantum = 128 / ctx.sampleRate;
    return Math.ceil(t / quantum - 1e-6) * quantum;
};

/** FADE agendado no principal: rampa de `from` em `start` até 0 em `end` (tempo do contexto). */
interface FadeRamp { start: number; end: number; from: number }
/** Rampa linear curta no principal, de `v0` em `t0` até `v1` em `t1` (tempo do contexto). */
interface VolumeRamp { t0: number; v0: number; t1: number; v1: number }

/** Nível do FADE em `t`, pela própria receita (rampa linear). */
function fadeLevelAt(f: FadeRamp, t: number): number {
    if (t <= f.start) return f.from;
    if (t >= f.end) return 0;
    return (f.from * (f.end - t)) / (f.end - f.start);
}

/**
 * Segura o principal em `now` (= ctx.currentTime) no `value` que a automação dele tem ali, sem
 * degrau (o mesmo jeito do agendador, sectionScheduler.ts): com cancelAndHoldAtTime, no meio de
 * uma rampa ele mesmo põe o ponto; fora de rampa ele só apaga o resto, e um set no valor de agora
 * firma o ponto pra rampa seguinte partir dele. Sem ele (Firefox), no meio da rampa ela volta a
 * terminar em `now` com o valor da receita (um set ali tocaria o valor de antes da rampa). Nunca
 * segue um setTarget (Ruling ÁUDIO): o FADE só usa set e rampa linear.
 */
function holdMasterAt(param: AudioParam, now: number, value: number, inRamp: boolean): void {
    if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
        if (!inRamp) param.setValueAtTime(value, now);
        return;
    }
    param.cancelScheduledValues(now);
    if (inRamp) param.linearRampToValueAtTime(value, now);
    else param.setValueAtTime(value, now);
}

/**
 * O pedido armado do palco novo no formato que a banda (HOST_STATE) e o palco antigo conhecem: na
 * seção atual, `activeLoop` com as passagens que faltam; em outra seção, `pendingJump` e, quando
 * pediu mais de uma passagem, `activeLoop` com as repetições depois de chegar.
 */
function legacySectionView(intent: ArmIntent | null, current: number): { pendingJump: number | null; activeLoop: { index: number; remaining: number | 'infinite' } | null } {
    if (!intent) return { pendingJump: null, activeLoop: null };
    if (intent.target === current) return { pendingJump: null, activeLoop: { index: intent.target, remaining: intent.plays } };
    const remaining = intent.plays === 'infinite' ? 'infinite' : intent.plays - 1;
    return { pendingJump: intent.target, activeLoop: remaining === 0 ? null : { index: intent.target, remaining } };
}

/**
 * A voz do startVoice da T7 (src/audio/voices.ts) em duas etapas: aqui só monta fonte e
 * envelope ligados na entrada, sem start. O play monta todas, lê o instante comum e dá start em
 * todas num laço curto, como a v1.4.16 fazia com as fontes: montar dentro do laço (startVoice
 * por voz) deixava o relógio passar de bloco entre ler o instante e o 1º start (medido no
 * verify-pitch: folga de 1 bloco em vez de 2 em 5 a 8% dos reinícios, e mais plays refeitos).
 * Quando a fonte termina, fonte e envelope se desligam (como no startVoice).
 */
function buildVoice(ctx: BaseAudioContext, spec: VoiceSpec, rate: number): Voice {
    const source = ctx.createBufferSource();
    const env = ctx.createGain();
    source.buffer = spec.buffer;
    if (spec.loop) source.loop = true;
    source.playbackRate.value = rate;
    source.connect(env);
    env.connect(spec.entry);
    source.addEventListener('ended', () => {
        source.disconnect();
        env.disconnect();
    }, { once: true });
    return { channelId: spec.channelId, source, env };
}

// O metrônomo infinito (createEndlessMetronomeSong) toca em loop.
const isEndlessLoop = (ch: { name: string }): boolean => ch.name.toLowerCase().includes('metronomo loop');

// Latência que o navegador informa; valor estranho conta 0.
const latencyOf = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

// AudioContext com a troca de aparelho (Chrome, Edge e o app desktop; o tipo do DOM ainda não tem).
type SinkAudioContext = AudioContext & {
    sinkId?: string | object;
    setSinkId?: (sinkId: string) => Promise<void>;
    onsinkchange?: ((ev: Event) => unknown) | null;
};
// Constante de tempo do mudo geral: some em ~30 ms, sem estalo.
const MASTER_MUTE_TC = 0.005;

// Corte das trocas de rota (Ruling T25-corte): 3 ms descendo e 3 ms subindo. Medido no Chrome
// pelo revisor: degrau 0,0069 por amostra com 3 ms (2 ms passa de 0,01).
const ROUTE_CUT_S = 0.003;
// Um ganho do motor na frente de cada barramento, só pro corte (a Guia nunca usa o guideGain).
type RouteCuts = Record<ChannelRole, GainNode>;
// Folga antes de o corte começar: a thread do áudio calcula blocos adiantados em relação ao
// currentTime (até um buffer do aparelho; medido no Chrome 157 em tempo real: rampa marcada no
// currentTime às vezes começava no passado e descia em 0,3 ms, degrau 0,019). Pelo menos 10 ms
// ou duas latências do aparelho.
const ROUTE_CUT_LEAD_S = 0.01;
const cutLead = (ctx: BaseAudioContext): number =>
    Math.max(ROUTE_CUT_LEAD_S, 2 * ((ctx as AudioContext).baseLatency || 0));
// Relógio do áudio parado esse tempo = nada sai (contexto suspenso ou travado): troca assim mesmo.
const FROZEN_CLOCK_MS = 50;
// Teto da espera pelo fundo do corte (thread de áudio atrasada): troca assim mesmo.
const MAX_CUT_WAIT_MS = 300;
// Teto do setSinkId: aparelho que não responde não segura a fila de trocas.
const SINK_TIMEOUT_MS = 3000;

// Tique da espera do corte pelo relógio Worker da T5 (src/audio/schedulerClock.ts), ligado só
// enquanto alguém espera.
const CUT_CLOCK_INTERVAL_MS = 2;

/**
 * Espera o relógio do áudio passar de `t` (Ruling T25-relogio), conferindo o `currentTime` a
 * cada tique do relógio Worker da T5 (`tickers`), que o navegador não atrasa como os timers da
 * janela em segundo plano (ali um setTimeout de 1 ms vira 1 s). Medido no Chrome 157: uma fonte
 * marcadora por espera (ConstantSource terminando em `t`) cortava às vezes a subida do corte no
 * limite de um bloco (degrau 0,06 em 2 de 7 passadas), então nenhum nó é criado aqui. Reserva
 * por timer da janela (contexto sem Worker, os de teste) e pro relógio que não anda (contexto
 * suspenso ou travado: parado 50 ms ou mais de 300 ms de espera, troca assim mesmo).
 */
function waitForAudioTime(ctx: BaseAudioContext, t: number, tickers: { add(fn: () => void): () => void } | null): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        let unsubscribe: (() => void) | null = null;
        const started = performance.now();
        let lastClock = ctx.currentTime;
        let lastMove = started;
        const check = () => {
            if (done) return;
            const now = performance.now();
            if (ctx.currentTime !== lastClock) { lastClock = ctx.currentTime; lastMove = now; }
            if (ctx.currentTime >= t || ctx.state !== 'running' || now - lastMove > FROZEN_CLOCK_MS || now - started > MAX_CUT_WAIT_MS) {
                done = true;
                unsubscribe?.();
                resolve();
            }
        };
        check();
        if (done) return;
        unsubscribe = tickers?.add(check) ?? null;
        const timerTick = () => {
            check();
            if (!done) setTimeout(timerTick, 5);
        };
        setTimeout(timerTick, 5);
    });
}

/**
 * O setSinkId com teto: aparelho que não responde em 3 s não segura a fila (a troca segue com
 * o aparelho de agora) e devolve `true`; `onLateAnswer` é chamado quando ele enfim responder
 * (ou falhar). Aparelho que responde depois do teto troca fora do corte: limite conhecido
 * (R3-2), até o corte do sinkchange.
 */
async function setSinkWithTimeout(ctx: SinkAudioContext, deviceId: string, onLateAnswer: () => void): Promise<boolean> {
    if (typeof ctx.setSinkId !== 'function') return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), SINK_TIMEOUT_MS); });
    const answer = ctx.setSinkId(deviceId);
    try {
        const result = await Promise.race([answer.then(() => 'ok' as const), timeout]);
        if (result !== 'timeout') return false;
        console.warn(`[saídas] o setSinkId não respondeu em ${SINK_TIMEOUT_MS / 1000} s; seguindo com o aparelho de agora.`);
        answer.then(onLateAnswer, onLateAnswer);
        return true;
    } finally {
        clearTimeout(timer);
    }
}

// Canais do aparelho de saída. Medido no Chrome 157 (AudioContext de tempo real): o
// maxChannelCount é o do aparelho e não acompanha o channelCount que o grafo escreve, então
// dá pra ler de novo a cada troca. Valor estranho conta como 2 (o planOutputs faz o mesmo).
const deviceChannels = (ctx: BaseAudioContext): number => {
    const n = ctx.destination.maxChannelCount;
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
};

const sameOutputs = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((o, i) => o === b[i]);
const samePlan = (a: OutputPlan, b: OutputPlan) =>
    a.mode === b.mode && a.channels === b.channels && sameOutputs(a.vs, b.vs) && sameOutputs(a.click, b.click) && sameOutputs(a.guide, b.guide);
// O destino está como o plano pede? Depois de um setSinkId o Chrome mantém o channelCount
// antigo (medido), então o mesmo plano num aparelho novo também precisa ser religado. Num
// aparelho de 1 canal (plano `mono` da T6) o destino fica em 1.
const destinationMatches = (ctx: BaseAudioContext, plan: OutputPlan) => {
    const d = ctx.destination;
    const multi = plan.mode === 'multi';
    const channels = multi ? plan.channels : Math.min(2, d.maxChannelCount);
    return d.channelCount === channels && d.channelCountMode === 'explicit'
        && d.channelInterpretation === (multi ? 'discrete' : 'speakers');
};

/**
 * Liga o plano das saídas no grafo e devolve o plano que ficou valendo. O grafo lança
 * RangeError, sem mexer na rota de agora, quando um "4 ou mais" pede mais canais que o
 * aparelho: aí vai o mesmo modo em 2 canais (separados ou Tudo junto, que nunca lançam).
 * Erro que não é do plano (aparelho estranho) pode chegar depois de o grafo soltar a rota
 * velha: a rota anterior é ligada de novo. Nunca relança: o som não para e Click nunca vai
 * pra VS.
 */
function routeOutputs(ctx: BaseAudioContext, graph: OutputGraph, outputs: OutputSettings, maxChannels: number): PlannedOutputs {
    const previous = graph.plan;
    const wanted = planOutputs(outputs, maxChannels);
    if (samePlan(previous, wanted) && destinationMatches(ctx, wanted)) return wanted;
    // Plano de reserva em 2 canais, ou no canal único de um aparelho mono (Ruling T6-mono).
    for (const plan of [wanted, planOutputs(outputs, Math.min(maxChannels, 2))]) {
        try {
            graph.apply(plan);
            return plan;
        } catch (e) {
            if (e instanceof RangeError) {
                console.warn(`[saídas] o aparelho não aceitou o plano (${e.message}). Usando 2 canais.`);
                continue;
            }
            console.error('[saídas] o aparelho não aceitou o plano novo; a rota anterior volta.', e);
            try { graph.apply(previous); } catch (again) { console.error('[saídas] a rota anterior também não voltou.', again); }
            break;
        }
    }
    return { ...graph.plan, warning: null };
}

/**
 * Rota de reserva, só se o grafo da T12 não montar por um erro do navegador (não é o caso de
 * nenhum aparelho conhecido): barramentos -> principal -> mudo geral -> destino, sem
 * roteador. Serve "Tudo junto" e "Click e Guia separados"; em separados o lado sai do pan
 * efetivo de cada canal (±1 pelo papel, o pan automático da v1.4.15), então o Click continua
 * fora da VS. "4 ou mais" lança RangeError (o routeOutputs cai em 2 canais). Sem medidor.
 * Como no grafo da T12, o initEngine religa o `countDelay` no panner da contagem do motor e no
 * corte do Click (Opção A da T26); o `countPan` daqui fica sem entrada.
 */
function createDirectGraph(ctx: BaseAudioContext, initial: OutputPlan): OutputGraph {
    const buses: Record<ChannelRole, GainNode> = { click: ctx.createGain(), guide: ctx.createGain(), normal: ctx.createGain() };
    const countPan = ctx.createStereoPanner();
    const countDelay = ctx.createDelay(1);
    const master = ctx.createGain();
    const masterMute = ctx.createGain();
    countDelay.connect(countPan);
    countPan.connect(buses.click);
    for (const bus of Object.values(buses)) bus.connect(master);
    master.connect(masterMute);
    const setPlan = (p: OutputPlan): OutputPlan => {
        if (p.mode === 'multi') throw new RangeError('a rota de reserva não tem "4 ou mais"');
        countPan.pan.setValueAtTime(effectivePan(0, 'click', p), ctx.currentTime);
        return { ...p, vs: [...p.vs], click: [...p.click], guide: [...p.guide] };
    };
    let plan = setPlan(initial);
    masterMute.connect(ctx.destination);
    return {
        input: (role) => buses[role],
        guideGain: buses.guide.gain,
        countDelay,
        master,
        masterMute,
        get plan() { return plan; },
        apply(p) { plan = setPlan(p); },
        levels: () => ({ l: 0, r: 0 }),
        dispose() { for (const n of [...Object.values(buses), countPan, countDelay, master, masterMute]) n.disconnect(); },
    };
}

/**
 * Grafo das saídas do initEngine. RangeError (plano maior que o aparelho): nada foi montado,
 * vai em 2 canais. Erro do navegador: rota de reserva, com aviso. Nunca deixa o motor sem som.
 */
function buildOutputGraph(ctx: AudioContext, outputs: OutputSettings, maxChannels: number): { graph: OutputGraph; plan: PlannedOutputs } {
    let plan = planOutputs(outputs, maxChannels);
    try {
        return { graph: createOutputGraph(ctx, plan), plan };
    } catch (e) {
        if (e instanceof RangeError) console.warn(`[saídas] o aparelho não aceitou o plano (${e.message}). Usando 2 canais.`);
        else console.error('[saídas] o grafo das saídas não montou; tentando em 2 canais.', e);
    }
    plan = planOutputs(outputs, Math.min(maxChannels, 2));
    try {
        return { graph: createOutputGraph(ctx, plan), plan };
    } catch (e) {
        console.error('[saídas] o grafo das saídas não montou de novo; usando a rota de reserva (sem "4 ou mais").', e);
    }
    return { graph: createDirectGraph(ctx, plan), plan };
}

// localStorage que pode faltar (aba privada, armazenamento bloqueado): nunca derruba o motor.
const readLocal = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
};
const writeLocal = (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch (e) { console.error('Não consegui gravar no aparelho', e); }
};

/** O aparelho na hora da volta dos pans: as saídas, o pan automático e se ele vinha ligado (R-23). */
interface LegacyPanDevice { outputs: OutputSettings; autoPan: boolean; legacyPanReset: boolean }

/** Lado do ouvido que os Click e Guia em ±1 apontam, por votos de todas as músicas (empate: saída 1); null sem nenhum. */
function legacyEarSide(songs: readonly SavedSong[]): -1 | 1 | null {
    let left = 0;
    let right = 0;
    for (const song of songs) for (const ch of song.channels) {
        if (resolveChannelRole(ch) === 'normal') continue;
        if (ch.pan === -1) left++;
        else if (ch.pan === 1) right++;
    }
    if (left + right === 0) return null;
    return right > left ? 1 : -1;
}

/**
 * Volta dos pans ±1 de antes desta versão (R-23, Ruling I1-rota), uma vez por conta (e no ZIP
 * antigo), em todas as músicas. Zera SÓ o que o pan automático gravou: Click e Guia em -1 e o
 * resto em +1 (o barramento da aba Buses volta junto pro '1/2', que é o pan 0). Canal Normal em
 * -1 (o lado do ouvido, que o pan automático nunca dava pra ele) foi girado à mão: vira Guia
 * manual com o pan como está, porque em "Click e Guia separados" o knob não vale e ele iria pra
 * VS. Click ou Guia em +1 também é do operador e fica (separados manda pro ouvido pelo papel).
 * Com o pan automático DESLIGADO ("Tudo junto" sem ele, sem o `legacyPanReset`) os ±1 são todos
 * do operador e nada é zerado; se Click ou Guia estão num lado (`legacyEarSide`), a saída vai pra
 * "Click e Guia separados" com o ouvido desse lado (`outputs`), nunca fica em "Tudo junto" (o
 * click no PA), e o Normal que estava no lado do ouvido vira Guia pelo mesmo motivo. Sem
 * `moveOutputs` (ZIP antigo num aparelho em "Tudo junto"), a saída não muda e nada muda nos canais.
 */
function fixLegacyPans(songs: SavedSong[], device: LegacyPanDevice, opts: { moveOutputs: boolean }): { songs: SavedSong[]; outputs: OutputSettings | null } {
    type SavedCh = SavedSong['channels'][number];
    // A música só vira um objeto novo quando algum canal mudou (a restauração grava só aí).
    const each = (fix: (ch: SavedCh) => SavedCh) => songs.map((song) => {
        const channels = song.channels.map(fix);
        return channels.every((ch, i) => ch === song.channels[i]) ? song : { ...song, channels };
    });
    const toGuide = (ch: SavedCh): SavedCh => ({ ...ch, role: 'guide' });
    const byOperator = device.outputs.mode === 'stereo' && !device.autoPan && !device.legacyPanReset;
    if (!byOperator) {
        const fixed = each((ch) => {
            if (Math.abs(ch.pan) !== 1) return ch;
            if (ch.pan === autoPanFor(ch, true).pan) return { ...ch, pan: 0, bus: '1/2' };
            return resolveChannelRole(ch) === 'normal' ? toGuide(ch) : ch;
        });
        return { songs: fixed, outputs: null };
    }
    const ear = opts.moveOutputs ? legacyEarSide(songs) : null;
    if (ear === null) return { songs, outputs: null };
    return {
        songs: each((ch) => (resolveChannelRole(ch) === 'normal' && ch.pan === ear ? toGuide(ch) : ch)),
        outputs: { ...device.outputs, multi: { ...device.outputs.multi }, mode: 'split2', earOnSecond: ear === 1 },
    };
}

/** O "Click gerado" mudo (Ruling X1-critical): ao abrir com a saída sem rota própria pro Click. */
const withGeneratedClickMuted = (song: SavedSong): SavedSong =>
    (song.channels.some((ch) => isGeneratedClick(ch) && !ch.muted)
        ? { ...song, channels: song.channels.map((ch) => (isGeneratedClick(ch) ? { ...ch, muted: true } : ch)) }
        : song);

// === Grade da música (Parte 2, T27; Arquitetura B) ===
// A grade do palco vem só da faixa de click (sinal limpo, é o que a banda ouve): BPM, fase e
// compasso lidos nela pelo analyzeClickTrack (T3) e montados pelo gridFromClick (T2). Sem click,
// a grade sai do BPM salvo (sem fase) e, nos planos pagos, o motor gera o click que falta pelo
// mesmo fluxo do Metrônomo (planAutoClick e renderAutoClick, M7).

/** Nome do canal do click que o motor gera pra música sem click (o papel Click vem do nome). */
const GENERATED_CLICK_NAME = 'Click gerado';
/** O canal é o click que o motor gerou (pelo nome do arquivo, que nunca muda) e ainda é Click. */
const isGeneratedClick = (ch: ChannelIdentity): boolean => ch.name === GENERATED_CLICK_NAME && resolveChannelRole(ch) === 'click';
/**
 * O Click tem rota própria, longe do PA (Ruling X1-critical)? Em "Tudo junto" (com ou sem o pan
 * automático) e na saída de 1 canal (que o plano dá como "Tudo junto") não: ali o click gerado
 * nunca nasce, e o que já existe fica mudo.
 */
const clickHasOwnRoute = (plan: OutputPlan, autoPan: boolean): boolean => plan.mode !== 'stereo' && !cueReachesVs(plan, autoPan);
/**
 * Clicks que o Metrônomo grava ("Click_IA_120bpm", "Click_Classic_120bpm"; MetronomeModal.tsx):
 * gerados pelo mesmo gerador, com cada click adiantado pelo ataque da amostra.
 */
const METRONOME_CLICK_NAME = /^Click_[A-Za-z]+_[\d.]+bpm$/;
/** A leitura do click precisa de pelo menos 4 s de áudio (o mínimo do analyzeClickTrack). */
const CLICK_MIN_SECONDS = 4;
/** Canal de click abaixo disto (-60 dBFS) do começo ao fim é silêncio: nada a ler. */
const CLICK_SILENCE = 1e-3;
/**
 * Folga entre os pedaços de trabalho da grade que ainda ficam na thread principal (a cópia das
 * amostras de cada canal pro Worker, o WAV do click gerado): a tela e o play passam entre eles.
 */
const GRID_YIELD_MS = 30;
/**
 * Worker da grade que não responde nisso (a leitura mais longa medida, o plano do click numa
 * música de 5 min, leva uns 4 s) é dado como quebrado: é encerrado e a leitura automática para.
 */
const GRID_WORKER_TIMEOUT_MS = 120_000;
/**
 * Amostras copiadas por vez pro Worker (1 MB). Medido no Chrome 157 com uma música de 10 min: o
 * canal inteiro de uma vez travava a thread principal ~70 ms; em pedaços de 4 MB um play no meio
 * esperava até 11 ms; de 1 MB, até 6 ms (sem leitura nenhuma, 2 ms). A cópia leva ~0,6 s.
 */
const GRID_COPY_CHUNK = 1 << 18;
/**
 * Dúvidas do plano que barram o click gerado: com o tempo incerto (contratempo, BPM salvo que
 * não bate, família 3:2 escolhida pelo BPM salvo) o click sairia fora do que a banda toca, e
 * aqui ninguém confere antes de inserir (Ruling M2-6). O "1" incerto não barra: o click fica no
 * tempo e o palco avisa o compasso assumido (Ruling M3-M7: todo 'bumbo-lidera' é dúvida).
 */
const AUTO_CLICK_BLOCKERS: ReadonlySet<AutoClickCheck> = new Set<AutoClickCheck>(['contratempo', 'bpm-salvo', 'andamento']);

/** Grade e se o "1" dela é assumido (o click não provou onde ele cai e as seções não decidiram). */
interface ReadGrid { grid: SongGrid; oneAssumed: boolean }
/**
 * Pedido na fila da grade: ler o click e, nos planos pagos, gerar o que falta. `plan` guarda o
 * plano que o Worker devolveu com a VS já tocando: o WAV do click só é feito na próxima parada.
 */
interface GridJob { read: boolean; generate: boolean; plan?: AutoClickOkPlan; done: (() => void)[] }
/** Worker da grade vivo e os pedidos esperando resposta. */
interface GridWorkerLink { worker: Worker; calls: Map<number, (r: GridWorkerResponse | null) => void>; next: number }

/** Amostras do canal 0 de um canal de click que dá pra ler (4 s ou mais, com som); null se não dá. */
function readableClick(buffer: AudioBuffer | undefined): Float32Array | null {
    if (!buffer || typeof buffer.getChannelData !== 'function' || !(buffer.sampleRate > 0) || !(buffer.duration >= CLICK_MIN_SECONDS)) return null;
    try {
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > CLICK_SILENCE) return samples;
    } catch { /* buffer sem amostras: nada a ler */ }
    return null;
}

/** Canais de papel Click, na ordem da música (o papel manual vale; o loop do metrônomo infinito fica de fora). */
const clickChannelsOf = (song: Song): Channel[] => song.channels.filter((ch) => resolveChannelRole(ch) === 'click' && !isEndlessLoop(ch));

/**
 * Grade que vale pra música: a lida no click (salva no repertório) ou, sem ela, a do BPM salvo
 * com o compasso salvo na nuvem, montada na hora (acompanha o BPM quando a biblioteca muda) e
 * com o compasso escolhido no EDITAR, que fica salvo. Null sem click lido e sem BPM salvo.
 */
function songGridOf(song: Pick<Song, 'grid' | 'bpm' | 'timeSignature'>): SongGrid | null {
    const stored = sanitizeGrid(song.grid);
    if (stored?.source === 'click') return stored;
    const fromBpm = typeof song.bpm === 'number' ? gridFromBpm(song.bpm, sanitizeTimeSignature(song.timeSignature)) : null;
    return fromBpm ? sanitizeGrid(keepManualMeter(fromBpm, stored)) : null;
}

/**
 * "1" pelas seções marcadas (Ruling T3-1), quando o click não prova onde ele cai: cada marca a
 * partir do primeiro pulso vota no tempo do compasso mais perto dela (no composto, a pontuada)
 * e vence o mais votado (empate: o da marca mais cedo). Devolve o novo primeiro 1, ou null sem
 * marca que vote.
 */
function oneFromSections(g: SongGrid, markers: readonly Marker[] | undefined, firstPulse: number): number | null {
    const beat = pulseSeconds(g) * (isCompound(g.signature) ? 3 : 1);
    const beats = Math.round(barSeconds(g) / beat);
    const votes = new Map<number, { count: number; first: number }>();
    for (const m of markers ?? []) {
        if (!m || !Number.isFinite(m.time) || m.time < firstPulse - beat / 2) continue;
        const r = ((Math.round((m.time - g.firstDownbeat) / beat) % beats) + beats) % beats;
        const v = votes.get(r);
        if (v) { v.count++; v.first = Math.min(v.first, m.time); } else votes.set(r, { count: 1, first: m.time });
    }
    let best: { r: number; count: number; first: number } | null = null;
    for (const [r, v] of votes) if (!best || v.count > best.count || (v.count === best.count && v.first < best.first)) best = { r, ...v };
    return best ? g.firstDownbeat + best.r * beat : null;
}

/**
 * Grade lida num canal de click, com o mesmo compasso conhecido (o escolhido no EDITAR ou o salvo
 * na nuvem) na leitura e no gridFromClick (Aviso T27 da T3), e pelo sanitizeGrid antes de usar
 * (Aviso T27 da T2). O "1" que o click não prova (downbeatSource 'assumed') vem das seções
 * marcadas quando há; senão, e também com o compasso em dúvida (ambiguous), a grade sai com o
 * compasso assumido ('padrao': acende o COMPASSO ASSUMIDO e fica salvo no repertório, Ruling
 * W3). Null quando a leitura não dá grade.
 */
function gridFromReading(a: ClickAnalysis, known: TimeSignature | null, markers: readonly Marker[] | undefined): ReadGrid | null {
    const read = sanitizeGrid(gridFromClick(a, known));
    if (!read) return null;
    let grid = read;
    let oneAssumed = false;
    if (a.downbeatSource === 'assumed') {
        const one = oneFromSections(read, markers, a.firstPulse);
        const fromSections = one === null ? null : sanitizeGrid({ ...read, firstDownbeat: one });
        if (fromSections) grid = fromSections;
        else oneAssumed = true;
    }
    return { grid: oneAssumed || a.ambiguous ? { ...grid, meterSource: 'padrao' } : grid, oneAssumed };
}

/**
 * Grade do click que o motor gerou: a do plano em que ele foi gerado. O gerador põe o início
 * audível de cada click nela (adianta cada um pelo ataque da amostra, clickAttack.ts), então ler
 * o WAV de volta só somaria o erro do leitor (Aviso T27/M7; medido na T27: até +8,2 ms no
 * Percussive, e o 1 perdido nas semicolcheias). Compasso: o conhecido (salvo ou escolhido) ou o
 * 4/4 assumido; o 1 que o plano pede pra conferir sai assumido.
 */
function gridFromAutoClick(plan: AutoClickOkPlan, signatureKnown: boolean): ReadGrid | null {
    const d = plan.detection;
    const grid = sanitizeGrid({
        bpm: d.pulseBpm, firstDownbeat: d.firstBeat + (d.downbeat * 60) / d.pulseBpm, signature: plan.signature,
        countEvery: isCompound(plan.signature) ? 3 : 1, source: 'click', meterSource: signatureKnown ? 'salvo' : 'padrao',
    });
    if (!grid) return null;
    const oneAssumed = autoClickChecks(d).includes('um');
    return { grid: oneAssumed ? { ...grid, meterSource: 'padrao' } : grid, oneAssumed };
}

/**
 * Click gravado pelo gerador do app (o do motor ou os do Metrônomo): a leitura põe o 1 depois do
 * início audível pelo jeito da amostra soar (Aviso T27/M7), e a grade volta pelo ataque da
 * amostra escolhida na biblioteca (a que o gerador usa). Outro click: 0.
 */
function generatedClickLead(ch: Pick<Channel, 'name'>): number {
    if (ch.name !== GENERATED_CLICK_NAME && !METRONOME_CLICK_NAME.test(ch.name)) return 0;
    const { type, subdivision } = loadClickSelection();
    return attackSeconds(type, subdivision);
}

/** Leitura do click já com o início audível de um click gerado pelo app (os dois tempos andam junto). */
function withLead(a: ClickAnalysis, lead: number): ClickAnalysis {
    if (lead === 0) return a;
    return { ...a, firstPulse: a.firstPulse - lead, firstDownbeat: a.firstDownbeat === null ? null : a.firstDownbeat - lead };
}

const sameGrid = (a: SongGrid | null | undefined, b: SongGrid | null | undefined): boolean =>
    (a ?? null) === (b ?? null) || (!!a && !!b && a.bpm === b.bpm && a.firstDownbeat === b.firstDownbeat && a.signature === b.signature
        && a.countEvery === b.countEvery && a.source === b.source && a.meterSource === b.meterSource);

// `opts` (T27): `autoClick` = o plano pode gerar o click que falta (canUseBpmDetection); sem ele,
// nunca gera. `sectionGates` e `stageMode` são da T28: sem `sectionGates`, tudo liberado; sem
// `stageMode`, o palco antigo (o mecanismo da v1.4.16). O App passa os dois (R-25).
export function useAudioEngine(userId?: string, opts?: { autoClick?: boolean; sectionGates?: StageGates; stageMode?: StageMode }) {
    const DB_KEY_META = userId ? `mt_meta_playlist_${userId}` : 'mt_meta_playlist';
    const DB_KEY_FILES = userId ? `mt_files_${userId}` : 'mt_files';
    // Marca "os pans antigos desta conta já voltaram ao centro" (Ruling T25-legacy).
    const LEGACY_PANS_DONE_KEY = `mt_legacy_pans_reset:${userId ?? 'anonimo'}`;

    // Persistência por-stem do repertório. Gravar TODOS os arquivos de TODAS as
    // músicas num único registro (Map sob DB_KEY_FILES) estourava a memória da
    // aba no celular num write monolítico só: a aba era morta antes de o
    // repertório salvar e a música "sumia" — enquanto o cache offline, que grava
    // por stem, sobrevivia. Cada stem do repertório agora vive numa chave própria
    // (write pequeno e durável), mesmo padrão de offlineCache. O Map vira fallback
    // de LEITURA para repertórios antigos (gravados antes desta mudança).
    const fileKey = (channelId: string) => `${DB_KEY_FILES}:ch:${channelId}`;

    // Lê o arquivo de um canal. Ordem: cache offline (músicas baixadas, via
    // srcId/srcIdx) → chave por-stem do repertório → Map legado. O cache primeiro
    // evita a 2ª cópia que estourava a memória no iPhone.
    const getChannelFile = async (
        channelId: string,
        legacyMap?: Map<string, File> | null,
        srcId?: string,
        srcIdx?: number
    ): Promise<File | undefined> => {
        if (srcId && typeof srcIdx === 'number') {
            const fromCache = await getCachedStem(srcId, srcIdx);
            if (fromCache) return fromCache;
        }
        const perStem = await get<File>(fileKey(channelId));
        if (perStem) return perStem;
        return legacyMap?.get(channelId);
    };
    const { settings, updateSetting } = useSettings();
    // Pra volta dos pans antigos na restauração (Ruling I1-rota), que roda fora da renderização:
    // se o aparelho veio do pan automático ligado e como gravar a saída nova.
    const legacyPanResetRef = useRef(settings.legacyPanReset === true);
    const updateSettingRef = useRef(updateSetting);
    useEffect(() => {
        legacyPanResetRef.current = settings.legacyPanReset === true;
        updateSettingRef.current = updateSetting;
    });
    const audioCtxRef = useRef<AudioContext | null>(null);
    // O principal é o `master` do grafo das saídas: volume, FADE e AUTO continuam aqui.
    const masterGainRef = useRef<GainNode | null>(null);

    // === Saídas por papel (T25) ===
    // Saídas escolhidas, já lidas e corrigidas. Sem `settings.outputs` (mock de teste antigo)
    // fica "Click e Guia separados", nunca "Tudo junto" (Ruling T12/T25 b).
    const outputs = useMemo(() => sanitizeOutputs(settings.outputs, { migrated: true }), [settings.outputs]);
    const graphRef = useRef<OutputGraph | null>(null);
    // Plano que está ligado no grafo agora (com o aviso pra tela) e os canais do aparelho.
    const [outputPlan, setOutputPlan] = useState<PlannedOutputs>(() => planOutputs(outputs, 2));
    const [maxOutputChannels, setMaxOutputChannels] = useState(2);
    const [masterMuted, setMasterMuted] = useState(false);
    const masterMutedRef = useRef(false);
    // Último pan que o motor pôs em cada panner e o barramento de cada fader: o plano novo
    // ou o papel novo mexe só no que mudou, e religar o fader solta só o barramento antigo
    // (o AnalyserNode que o App liga no gainNode continua).
    const pannerPanRef = useRef(new WeakMap<StereoPannerNode, number>());
    // Cortes das trocas de rota (um por barramento) e o repertório mais novo pra quem troca
    // a rota fora da renderização.
    const routeCutsRef = useRef<RouteCuts | null>(null);
    // Quem espera o fundo do corte, chamado a cada tique do relógio Worker (criado na primeira espera).
    const cutWaitersRef = useRef(new Set<() => void>());
    const cutClockRef = useRef<SchedulerClock | null>(null);
    // Fim da subida do último corte, em tempo do áudio: o próximo só começa depois dele (NB3).
    const lastCutEndRef = useRef(0);
    // O aparelho escolhido não respondeu à troca em 3 s (aviso 'sink-timeout' na tela até ele responder).
    const sinkTimeoutRef = useRef(false);
    const sinkAttemptRef = useRef(0);
    const playlistRef = useRef<Song[]>([]);
    const faderBusRef = useRef(new WeakMap<GainNode, ChannelRole>());
    // Deixa mudo o "Click gerado" de todas as músicas quando a saída não tem rota própria pro
    // Click (Ruling X1-critical). A versão da renderização mais nova (grava o repertório da conta
    // de agora), chamada também de dentro do corte das trocas de rota.
    const muteGeneratedRef = useRef<() => void>(() => {});
    // Valores da renderização mais nova pra quem roda fora dela (initEngine, sinkchange,
    // canal que nasce depois de um await). O pan automático só vale em "Tudo junto" e só
    // no panner (channelPanFor).
    const outputsRef = useRef(outputs);
    const autoPanRef = useRef(settings.autoPan);
    useEffect(() => {
        autoPanRef.current = settings.autoPan;
    }, [settings.autoPan]);
    // Timer do fade da "próxima" (1,5 s): a pausa cancela, senão a troca e o play automático
    // cairiam depois da pausa (e no meio de uma pré-contagem).
    const nextSongTimerRef = useRef<number | null>(null);

    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    const [playlist, setPlaylist] = useState<Song[]>([]);
    const [activeSongIndex, setActiveSongIndex] = useState<number>(0);

    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentMarker, setCurrentMarker] = useState<Marker | null>(null);

    // === Phase 2: Playback Modes ===
    const [playbackMode, setPlaybackMode] = useState<'continue' | 'stop' | 'fade-out'>('continue');

    // === Seções do palco antigo (stageMode 'antigo'): loop (N vezes ou infinito) e salto ===
    // O mecanismo da v1.4.16, sem contagem. Os refs são a fonte da verdade dentro do loop de
    // rAF (updateTime); os estados só espelham pra UI re-renderizar. Loop e salto disparam no
    // FIM da seção atual (transição musical), nunca no clique. Índices das marcas (song.markers).
    const loopRef = useRef<{ index: number; remaining: number | 'infinite' } | null>(null);
    const jumpRef = useRef<number | null>(null);
    const lastSectionRef = useRef<number>(-1); // última seção do playhead (detecta transições)
    const [activeLoop, setActiveLoop] = useState<{ index: number; remaining: number | 'infinite' } | null>(null);
    const [pendingJump, setPendingJump] = useState<number | null>(null);

    // === Phase 3: Time-Stretch ===
    const [timeStretch, setTimeStretch] = useState(1); // 1.0 = normal speed
    const [masterVolume, setMasterVolume] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [shouldAutoPlayNext, setShouldAutoPlayNext] = useState(false);

    // === Pulo de seção do palco novo (T28; Arquitetura A) ===
    // Com stageMode 'novo' o SectionScheduler (src/audio/sectionScheduler.ts) cuida do pulo, do
    // REPETIR e do LOOP no relógio do áudio: contagem só pela entrada do click, guia calada no
    // último compasso, vozes que cruzam no "1". O relógio do Worker (T5) liga no play e desliga
    // quando a VS para; cada tique olha o plano e o fim da música. Índices das spans
    // (sectionSpansView), nunca das marcas. Sem stageMode, o palco antigo (o App decide, R-25):
    // o harness e os testes de antes montam o hook sem opções e seguem no caminho da v1.4.16.
    // O modo pedido só passa a valer com a VS parada (pedido tocando fica pra próxima parada).
    const requestedStageMode: StageMode = opts?.stageMode ?? 'antigo';
    const [stageMode, setStageMode] = useState<StageMode>(requestedStageMode);
    const stageModeRef = useRef<StageMode>(requestedStageMode);
    const sectionGates = opts?.sectionGates ?? ALL_SECTION_GATES;
    const [sectionIntent, setSectionIntent] = useState<ArmIntent | null>(null);
    const [transitionView, setTransitionView] = useState<TransitionView | null>(null);
    const [landed, setLanded] = useState<{ index: number; at: number } | null>(null);
    // Seção que se ouve tocando (atualizada pelo rAF e pelo tique), pra banda (activeLoop/pendingJump).
    const [playingSpan, setPlayingSpan] = useState(-1);
    // 'interval' = o Worker faltou e o tique vem do setInterval da janela (pode atrasar em 2º plano).
    const [sectionClockMode, setSectionClockMode] = useState<ClockMode>('worker');
    const sectionSchedulerRef = useRef<SectionScheduler | null>(null);
    const sectionClockRef = useRef<SchedulerClock | null>(null);
    // Papel que entra ou sai de Click com a VS tocando: até a troca de rota acabar, a contagem do
    // pulo vai pelo atraso da contagem do grafo (sempre no barramento do Click), nunca pela entrada
    // de um canal cujo fader ainda vai trocar de barramento. Conta as trocas na fila (duas trocas
    // seguidas: o fim da primeira não solta a contagem com a segunda ainda esperando).
    const countViaDelayRef = useRef(0);
    // Dentro do stopAllNodes: o reset do agendador não mexe no FADE (o play refaz tudo).
    const sectionStoppingRef = useRef(false);
    // FADE (R-32) agendado no principal: rampa de `from` em `start` até 0 em `end` (tempo do contexto).
    const fadeRef = useRef<FadeRamp | null>(null);
    // Nível em que o principal ficou segurado no meio do FADE (intenção armada); nulo = no volume.
    const fadeHeldRef = useRef<number | null>(null);
    // "1" do pulo marcado em que o principal volta pro volume (o FADE já tinha começado).
    const fadeRestoreRef = useRef<number | null>(null);
    // Rampa curta (50 ms) que o próprio FADE marcou no principal: volume mexido com o FADE marcado
    // ou a saída do FADE. Enquanto ela corre, mexer no volume de novo parte do valor dela (e nunca
    // por setTarget, que seria seguido pela rampa, Ruling ÁUDIO).
    const volumeRampRef = useRef<VolumeRamp | null>(null);

    const animationRef = useRef<number>(0);
    const pausedAtRef = useRef<number>(0);
    const autoNextTimeoutRef = useRef<number | null>(null);
    const currentPitchRef = useRef<number>(0);
    // Marca do setChannelMeta: o papel mudou tocando com tom diferente de 0 e o
    // áudio precisa reiniciar com os canais novos (efeito depois do changePitch).
    const restartAfterMetaRef = useRef(false);
    // Quantas vezes a rede de segurança do play() reagendou com a folga de reserva.
    const leadRetriesRef = useRef(0);

    // === Pré-contagem ===
    const [precountEnabled, setPrecountEnabled] = useState<boolean>(() =>
        localStorage.getItem('precount_enabled') === 'true');
    const [precountBeats, setPrecountBeatsState] = useState<number>(() =>
        parseInt(localStorage.getItem('precount_beats') || '4'));
    const [isCountingIn, setIsCountingIn] = useState(false);
    // Instantes (tempo do contexto) dos bipes da pré-contagem agendada, pra tela (PlayButton).
    const [precountTimes, setPrecountTimes] = useState<number[]>(NO_TIMES);
    // Timer só da tela: desliga o isCountingIn quando as vozes começam a ser ouvidas.
    const countInTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Contagem agendada no relógio do áudio (bipes da T7).
    const countRef = useRef<ScheduledCount | null>(null);
    // O play pendente (esperando worklet) é com pré-contagem? Um reinício nessa janela conta de novo.
    const precountPendingRef = useRef(false);
    // Papel trocado na pré-contagem: a contagem recomeça depois da troca de rota. Pedido (até a
    // renderização com a lista nova) e o trabalho já na fila de trocas.
    const recountQueuedRef = useRef(false);
    const recountJobRef = useRef<object | null>(null);
    // Opções do play que a troca de música dispara (shouldAutoPlayNext): a pré-contagem que estava valendo.
    const autoPlayOptsRef = useRef<{ precount?: boolean } | undefined>(undefined);

    const activeSong = playlist[activeSongIndex];
    const channels = activeSong?.channels || [];
    // BPM salvo e id da música ativa, pro play (pré-contagem e cadeia do play de agora).
    const songBpm = activeSong?.bpm;
    const activeSongId = activeSong?.id;
    // Grade da música ativa (T27): a lida no click, ou a do BPM salvo; null sem nenhuma.
    const activeGrid = useMemo(() => (activeSong ? songGridOf(activeSong) : null), [activeSong]);
    // Id da música ativa pra quem roda fora da renderização (canal novo depois de um await).
    const activeSongIdRef = useRef<string | undefined>(undefined);
    useEffect(() => { activeSongIdRef.current = activeSongId; }, [activeSongId]);
    // O plano pode gerar o click que falta (opção do hook, lida na hora de gerar).
    const autoClickRef = useRef(!!opts?.autoClick);
    useEffect(() => { autoClickRef.current = !!opts?.autoClick; }, [opts?.autoClick]);
    // Seções da música ativa encaixadas na grade (T2): os índices que o palco, a banda e o motor usam.
    const songMarkers = activeSong?.markers;
    const sectionSpansView = useMemo(() => sectionSpans(songMarkers ?? [], duration, activeGrid), [songMarkers, duration, activeGrid]);
    // Valores da renderização mais nova pra quem roda fora dela (agendador, relógio do Worker).
    const spansRef = useRef<SectionSpan[]>(sectionSpansView);
    const gridRef = useRef<SongGrid | null>(activeGrid);
    const channelsRef = useRef<Channel[]>(channels);
    const timeStretchRef = useRef(timeStretch);
    const masterVolumeRef = useRef(masterVolume);
    const playbackModeRef = useRef(playbackMode);
    const durationRef = useRef(duration);
    useLayoutEffect(() => {
        spansRef.current = sectionSpansView;
        gridRef.current = activeGrid;
        channelsRef.current = channels;
        timeStretchRef.current = timeStretch;
        masterVolumeRef.current = masterVolume;
        playbackModeRef.current = playbackMode;
        durationRef.current = duration;
    });

    // Papel do canal (Click, Guia, Normal), troca de tom, pan automático e ganho
    // com Solo/M saem da regra central em src/lib/channelRoles.ts. Click e Guia
    // nunca transpõem (ficam em 0 semitons) e continuam tocando no Solo de outro canal.

    // === Engine de tom (signalsmith): um worklet por canal, reaproveitado ===
    // O nó do pacote NÃO pode ser destruído: não existe close() e o process()
    // dele sempre devolve true, então o navegador segue rodando o DSP até o
    // AudioContext fechar, mesmo depois do disconnect() (medido: 375 chamadas/s
    // e 43 a 55 ms de CPU por segundo, cada). A v1.4.9 criava worklets novos a
    // cada ida ao tom != 0 e só desconectava os velhos: eles se acumulavam e
    // saturavam a thread de áudio (som que não volta ao normal no tom 0 e, na
    // troca seguinte, tudo mudo). Regras agora:
    //   - no máximo UM worklet por canal (pitchSlotsRef, pelo id do canal),
    //     criado só quando a música é transposta e nunca duplicado;
    //   - parado com stop() (API do pacote, o DSP para de processar) e desligado
    //     do panner sempre que nenhuma fonte toca por ele: tom 0, pausa, seek,
    //     troca de música. Desligar importa: a saída dele é estéreo e, ligada,
    //     faz o StereoPanner tratar a faixa mono como estéreo (+6 dB em pan
    //     total, medido), mesmo com o worklet parado e mudo;
    //   - canal que sai de cena (música trocada ou removida, canal removido)
    //     devolve o worklet pra reserva (pitchPoolRef) e o próximo canal que
    //     precisar reaproveita em vez de criar outro.
    // Se o worklet falhar, a faixa toca sem transpose: áudio nunca fica refém do tom.
    type PitchSlot = { node: SignalsmithStretchNode; panner: StereoPannerNode; active: boolean };
    const pitchSlotsRef = useRef(new Map<string, PitchSlot>());
    const pitchPendingRef = useRef(new Map<string, { token: object; promise: Promise<PitchSlot | null> }>());
    const pitchPoolRef = useRef<SignalsmithStretchNode[]>([]);
    // === Vozes, linha do tempo e contagem no relógio do áudio (Parte 2, T26; Arquitetura A) ===
    // Internos que a T27 e a T28 usam:
    //   voicesRef: as vozes tocando agora (src/audio/voices.ts: fonte + envelope ligados na
    //     entrada do canal), uma por canal (duas só durante um cruzamento da T28), fora do
    //     estado do React: se o repertório for copiado enquanto toca, a cópia não teria a
    //     referência e a voz ficaria órfã. stopAllNodes solta todas com rampa curta.
    //   timelineRef: segmentos { ctxStart, songStart } da música no relógio do áudio
    //     (src/lib/playTimeline.ts). O play cria o primeiro; o pulo agendado acrescenta o dele.
    //     Vazio = nada agendado (a posição é pausedAtRef).
    //   entryFor(ch, pitch, compensation): entrada do canal, onde a voz liga: o worklet de tom
    //     (tom diferente de 0, canal que transpõe, já ligado e no tom), o atraso de
    //     compensação (quem não transpõe com a música transposta) ou o panner (tom 0). Toda voz
    //     nova entra por aqui, inclusive as do cruzamento da T28: quando o Click ou a Guia vira
    //     Normal, o atraso velho já saiu do mapa (detachEarDelay) e a voz nova ganha um atraso
    //     novo, sem nada a registrar (não há mais mapa de voz pra entrada).
    //   soundingUntilRef: até quando ainda sai som do que já foi solto (cauda da soltura e
    //     bipe cancelado, mais o L da compensação). Conta como "algo soando" pro corte das
    //     trocas de rota; quem soltar vozes fora do stopAllNodes (o pulo da T28) atualiza junto.
    //   countDestination(): onde a contagem entra. A entrada do canal de click (pelo papel; a
    //     contagem passa pelo pan, fader e M dele) ou, sem canal de click, o atraso da
    //     contagem do grafo (graph.countDelay, R-35) com o mesmo atraso da compensação.
    //   play(opts): agenda tudo de uma vez, num instante comum; { precount: true } põe a
    //     pré-contagem antes, no mesmo relógio (bipes e vozes agendados juntos).
    //   playChainRef: canais, tom e compensação com que o play de agora entrou.
    const voicesRef = useRef<Voice[]>([]);
    const timelineRef = useRef<TimelineSegment[]>([]);
    const playChainRef = useRef<{ songId: string | null; channels: Channel[]; pitch: number; compensation: number | null } | null>(null);
    // Instante (tempo do contexto) em que cada voz começa: a soltura para já a que ainda não começou.
    const voiceStartsRef = useRef(new WeakMap<Voice, number>());
    // Até quando ainda sai som do que já foi solto: a cauda da soltura das vozes (em ganho 1 até
    // a folga do corte, depois descendo) e o fim de um bipe cancelado. Conta como "algo soando"
    // pro corte das trocas de rota (rodada 1 da T26: I1 e Minor c da revisão).
    const soundingUntilRef = useRef(0);
    // Instante em que a soltura das vozes que soavam começou a descer (Ruling I4-busca): o play
    // seguinte não começa as vozes novas mais de SEEK_OVERLAP_MAX_S antes dele.
    const releaseAtRef = useRef(0);
    // O principal fora do FADE, pro play com a música velha ainda soltando (Ruling I2-proxima):
    // `nextFadeRef` é a descida da "próxima" (setTarget pra 0,01 com constante de 0,3 s a partir
    // de `t0`, do nível `from`); `masterRestRef` é o nível em que a parada (busca, pausa) deixou o
    // principal segurado no meio do FADE. Qualquer escrita do principal fora deles os apaga.
    const nextFadeRef = useRef<{ t0: number; from: number } | null>(null);
    const masterRestRef = useRef<number | null>(null);
    // Panner da contagem sem canal de click (Opção A da T26), criado uma vez no initEngine.
    const countPannerRef = useRef<StereoPannerNode | null>(null);
    // Cada play() pega um número. Se outro play() (troca de tom, seek...) começar
    // enquanto este espera o worklet nascer, o antigo desiste sem agendar nada.
    const playGenRef = useRef(0);
    // true entre o play() parar as fontes e agendar as novas: nada está tocando,
    // a posição é pausedAtRef.
    const playPendingRef = useRef(false);
    // Latência do worklet no modo ao vivo, informada pelo pacote (~0,120 s). Em
    // modo ao vivo ele NÃO compensa: a faixa transposta sai esse tanto depois.
    const pitchLatencyRef = useRef<number | null>(null);
    // Atraso igual à latência para quem NÃO passa pelo worklet (click, guia, ou
    // faixa cujo worklet falhou) quando a música está transposta: assim sai
    // alinhado com os instrumentos. Um DelayNode por canal, criado uma vez.
    const pitchDelaysRef = useRef(new Map<string, { delay: DelayNode; panner: StereoPannerNode }>());

    // Latência real do nó, perguntada uma vez ao pacote (é fixa). Lida já quando
    // o primeiro worklet nasce: assim o play() não espera por ela mesmo se o play
    // que criou os worklets tiver sido cancelado antes de chegar nessa leitura.
    const readPitchLatency = async (node: SignalsmithStretchNode): Promise<void> => {
        if (pitchLatencyRef.current !== null) return;
        try {
            const seconds = await node.latency();
            if (pitchLatencyRef.current === null && Number.isFinite(seconds) && seconds > 0 && seconds < 1) pitchLatencyRef.current = seconds;
        } catch (e) {
            console.error('Não consegui ler a latência do worklet de tom', e);
        }
    };

    const createPitchNode = async (ctx: AudioContext): Promise<SignalsmithStretchNode | null> => {
        try {
            // Nasce parado (inativo); só processa depois do start() no play().
            const node = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
            void readPitchLatency(node);
            return node;
        } catch (e) {
            console.error('Worklet de tom falhou; faixa tocará sem transpose', e);
            return null;
        }
    };

    // Garante o worklet do canal: o que ele já tem, o que está nascendo pra ele,
    // um da reserva ou, só em último caso, um novo.
    const ensurePitchSlot = (ctx: AudioContext, ch: Channel): Promise<PitchSlot | null> => {
        const slots = pitchSlotsRef.current;
        const current = slots.get(ch.id);
        if (current) {
            current.panner = ch.pannerNode;
            return Promise.resolve(current);
        }
        const pending = pitchPendingRef.current.get(ch.id);
        if (pending) return pending.promise;
        const pooled = pitchPoolRef.current.pop();
        if (pooled) {
            const slot: PitchSlot = { node: pooled, panner: ch.pannerNode, active: false };
            slots.set(ch.id, slot);
            return Promise.resolve(slot);
        }
        const token = {};
        const promise = (async () => {
            const node = await createPitchNode(ctx);
            const stillWanted = pitchPendingRef.current.get(ch.id)?.token === token;
            if (stillWanted) pitchPendingRef.current.delete(ch.id);
            if (!node) return null;
            if (!stillWanted) {
                // Canal liberado enquanto o worklet nascia: vai direto pra reserva.
                pitchPoolRef.current.push(node);
                return null;
            }
            const slot: PitchSlot = { node, panner: ch.pannerNode, active: false };
            slots.set(ch.id, slot);
            return slot;
        })();
        pitchPendingRef.current.set(ch.id, { token, promise });
        return promise;
    };

    // Liga o worklet no panner do canal e põe o DSP pra rodar.
    const startPitchNode = (slot: PitchSlot) => {
        if (slot.active) return;
        slot.node.connect(slot.panner);
        void slot.node.start();
        slot.active = true;
    };

    // Para o DSP e desliga do panner. Fica reservado pro mesmo canal.
    const stopPitchNode = (slot: PitchSlot) => {
        if (!slot.active) return;
        void slot.node.stop();
        slot.node.disconnect();
        slot.active = false;
    };

    const stopPitchNodes = () => {
        pitchSlotsRef.current.forEach(stopPitchNode);
    };

    // Canal saiu de cena: para, desliga e devolve o worklet pra reserva (e solta
    // o atraso de compensação, se tiver).
    const releasePitchNode = (channelId: string) => {
        pitchPendingRef.current.delete(channelId);
        const comp = pitchDelaysRef.current.get(channelId);
        if (comp) {
            comp.delay.disconnect();
            pitchDelaysRef.current.delete(channelId);
        }
        const slot = pitchSlotsRef.current.get(channelId);
        if (!slot) return;
        pitchSlotsRef.current.delete(channelId);
        stopPitchNode(slot);
        pitchPoolRef.current.push(slot.node);
    };

    // Canal que sai do ouvido (Click ou Guia virando Normal) com a música transposta: o atraso de
    // compensação dele guarda os últimos L segundos (~0,12 s) do que entrou nele como Click ou
    // Guia (o click, a guia, o bipe da contagem). Esse conteúdo nunca pode sair na VS:
    //   - no pedido, o atraso sai do mapa do canal (detachEarDelay): voz nova nenhuma entra nele,
    //     nem a do reinício com o worklet que falhou (essa ganha um atraso novo e vazio pelo
    //     getLatencyDelay e toca como Normal, de propósito);
    //   - até o fundo do corte ele continua entregando no panner, com o fader ainda no barramento
    //     do ouvido (é conteúdo de Click ou Guia, vai pro ouvido);
    //   - no fundo do corte (todos os barramentos em 0) ele é desligado e descartado com o que
    //     guarda, junto com a troca do fader. Desligar e religar o mesmo nó não serviria: ele
    //     soltaria o conteúdo ao ser religado.
    const detachEarDelay = (channelId: string): DelayNode | null => {
        const comp = pitchDelaysRef.current.get(channelId);
        if (!comp) return null;
        pitchDelaysRef.current.delete(channelId);
        return comp.delay;
    };

    const releasePitchNodesExcept = (keep: Channel[]) => {
        const ids = new Set(keep.map(c => c.id));
        const known = [...pitchSlotsRef.current.keys(), ...pitchPendingRef.current.keys(), ...pitchDelaysRef.current.keys()];
        known.forEach(id => { if (!ids.has(id)) releasePitchNode(id); });
    };

    // Atraso de compensação do canal (criado na 1ª vez, depois reaproveitado).
    const getLatencyDelay = (ctx: AudioContext, ch: Channel, seconds: number): DelayNode => {
        let comp = pitchDelaysRef.current.get(ch.id);
        if (!comp) {
            const delay = ctx.createDelay(1);
            delay.connect(ch.pannerNode);
            comp = { delay, panner: ch.pannerNode };
            pitchDelaysRef.current.set(ch.id, comp);
        } else if (comp.panner !== ch.pannerNode) {
            comp.delay.disconnect();
            comp.delay.connect(ch.pannerNode);
            comp.panner = ch.pannerNode;
        }
        comp.delay.delayTime.value = seconds;
        return comp.delay;
    };

    // Aplica o tom numa faixa que está tocando pelo worklet. Formantes só em voz.
    const applyPitchToChannel = (ch: Channel, semitones: number) => {
        const slot = pitchSlotsRef.current.get(ch.id);
        if (!slot || !slot.active) return;
        // Click e Guia (regra central, o papel manual vale) nunca transpõem: ficam em 0.
        // Formantes só em voz (família Vocal ou Backing da regra central, com o nome
        // dado pelo usuário): em instrumento transposto eles tiram definição.
        const exempt = isPitchExempt(ch);
        void slot.node.schedule({
            semitones: exempt ? 0 : semitones,
            formantCompensation: wantsFormantCompensation(ch),
            formantBaseHz: 0,
        });
    };

    // Entrada do canal, onde a voz liga (Arquitetura A): a regra que antes ficava no laço do
    // play. Click e Guia (regra central, o papel manual vale) nunca usam worklet.
    const entryFor = (ch: Channel, pitch: number, compensation: number | null): AudioNode => {
        const slot = pitch !== 0 && !isPitchExempt(ch) ? pitchSlotsRef.current.get(ch.id) : undefined;
        if (slot) {
            startPitchNode(slot);
            applyPitchToChannel(ch, pitch);
            return slot.node;
        }
        // Click/guia (ou worklet que falhou) com a música transposta: o mesmo atraso.
        const ctx = audioCtxRef.current;
        if (compensation && ctx) return getLatencyDelay(ctx, ch, compensation);
        // Tom 0: direto no panner, sem worklet e sem atraso.
        return ch.pannerNode;
    };

    // Onde a contagem entra (spec linha 169: respeita o fader, o pan e o M do click). Com canal
    // de click (pelo papel), a entrada dele; sem canal de click, o atraso da contagem do grafo
    // com o atraso da compensação (0 no tom 0), pra sair no tempo da música transposta (R-35).
    // Nunca na PA: as duas saem no barramento do Click. Só depois do initEngine (o grafo existe).
    const countDestination = (): AudioNode => {
        const chain = playChainRef.current;
        const click = chain?.channels.find((ch) => resolveChannelRole(ch) === 'click');
        if (chain && click) return entryFor(click, chain.pitch, chain.compensation);
        const graph = graphRef.current;
        if (!graph) throw new Error('countDestination antes do initEngine: sem grafo das saídas');
        graph.countDelay.delayTime.value = chain?.compensation ?? 0;
        return graph.countDelay;
    };

    // Posição atual da música pela linha do tempo. Com um play() pendente (ou nada agendado)
    // nada está tocando: a posição é a de onde ele vai retomar. Antes do instante agendado a
    // música ainda não andou (não volta pra trás).
    const getPlaybackPosition = (ctx: BaseAudioContext): number => {
        if (playPendingRef.current || timelineRef.current.length === 0) return pausedAtRef.current;
        return positionAt(timelineRef.current, ctx.currentTime, timeStretch);
    };

    // Na pré-contagem: a contagem está agendada e as vozes ainda não começaram (ou o play
    // pendente é com pré-contagem, ou a contagem espera a troca de papel pra recomeçar).
    const countingIn = (): boolean => {
        if (recountQueuedRef.current) return true;
        if (playPendingRef.current) return precountPendingRef.current;
        const ctx = audioCtxRef.current;
        const first = timelineRef.current[0];
        return !!ctx && !!countRef.current && !!first && ctx.currentTime < first.ctxStart;
    };
    // Reinício no meio da pré-contagem (busca, tom, papel, troca de música): a música nunca entra
    // sem contar; a contagem recomeça do 1 no ponto novo. Chamar antes do stopAllNodes.
    const restartOpts = (): { precount?: boolean } | undefined => (countingIn() ? { precount: true } : undefined);

    // Cancela um play() que ainda espera o worklet nascer (1ª vez transposto,
    // 50 a 300 ms). Quem troca de música sem passar pelo play() chama isto antes
    // de trocar (só quando a música muda de fato):
    // sem isso o play antigo terminava depois e tocava a música anterior (a
    // closure dele tem os canais dela) com a tela já na outra.
    const cancelPendingPlay = () => {
        playGenRef.current++;
        playPendingRef.current = false;
    };

    // === Pulo de seção do palco novo (T28): ligação do agendador da T17 no motor ===
    // Tempo ouvido (Arquitetura A): o que sai no alto-falante agora, descontada a latência do
    // aparelho e a da entrada do canal (o L da compensação do tom). A tela lê a posição por ele.
    const heardNow = useCallback((): number => {
        const ctx = audioCtxRef.current;
        if (!ctx) return 0;
        return heardTime(ctx.currentTime, ctx.outputLatency, playChainRef.current?.compensation ?? 0);
    }, []);
    // Posição da música no tempo ouvido. Parada (ou com play pendente), a de onde ela vai retomar.
    const heardPosition = useCallback((): number => {
        if (!audioCtxRef.current || playPendingRef.current || timelineRef.current.length === 0) return pausedAtRef.current;
        return positionAt(timelineRef.current, heardNow(), timeStretchRef.current);
    }, [heardNow]);

    // Vozes do cruzamento (T7): uma por canal do play de agora, na entrada do canal (entryFor),
    // começando em T - fade (ou em T, com o alvo em 0:00). O pulo nunca cria worklet nem cadeia.
    const startSwitchVoices = (ctx: AudioContext, T: number, targetOffset: number, fade: number): Voice[] => {
        const chain = playChainRef.current;
        if (!chain) return [];
        const rate = timeStretchRef.current;
        const specs: VoiceSpec[] = chain.channels.map((ch) => ({ channelId: ch.id, buffer: ch.buffer, entry: entryFor(ch, chain.pitch, chain.compensation), loop: isEndlessLoop(ch) }));
        const preroll = targetOffset >= fade * rate;
        // Ruling T30-grade: a voz começa numa amostra exata (T - fade com pré-rolagem, T no 0:00) e
        // num ponto de amostra exata da faixa, a no máximo meia amostra do plano. O envelope dela
        // anda junto (sobe em [T' - fade, T']); as que saem descem no T do plano: a soma dos dois
        // fica a menos de 0,2% de 1 nos 5 ms do cruzamento, sem degrau.
        const sr = ctx.sampleRate;
        const lead = preroll ? fade * rate : 0;
        const startAt = onSampleGrid(T - (preroll ? fade : 0), sr);
        const alignedT = startAt + (preroll ? fade : 0);
        const alignedTarget = preroll ? onSampleGrid(targetOffset - lead, sr) + lead : onSampleGrid(targetOffset, sr);
        const voices = startVoicesForSwitch(ctx, specs, alignedT, alignedTarget, fade, rate);
        // Com pré-rolagem o envelope nasce em 0 já agora, não só em T - fade: no Chrome, com T - fade
        // caindo um arredondamento depois da amostra em que a fonte começa, essa primeira amostra
        // saía no ganho padrão 1 (pico de uma amostra do som inteiro, medido com o hook real).
        // Agora é sempre antes de T - fade (o plano pede o pulo a pelo menos 50 ms).
        if (preroll) for (const v of voices) v.env.gain.setValueAtTime(0, ctx.currentTime);
        for (const v of voices) voiceStartsRef.current.set(v, startAt);
        return voices;
    };
    // O pulo pousou: as vozes novas passam a ser as do motor (soltura, medidor e harness usam).
    // As que saíram já estão mudas desde o "1" e o agendador para elas.
    const adoptSwitchVoices = (voices: Voice[]) => {
        voicesRef.current = voices;
        const chain = playChainRef.current;
        for (const v of voices) {
            const ch = chain?.channels.find((c) => c.id === v.channelId);
            if (ch) ch.sourceNode = v.source;
        }
    };
    // A contagem vai soar? Sem canal de click ela sai pelo atraso do grafo, no barramento do Click.
    const clickAudible = (): boolean => {
        const list = channelsRef.current;
        const click = list.find((ch) => resolveChannelRole(ch) === 'click');
        return !click || channelGain(click, list) > 0;
    };

    // Agendador do pulo (T17), criado uma vez com o contexto. Lê tudo por refs: roda no tique do
    // Worker, fora da renderização.
    const sectionScheduler = (): SectionScheduler | null => {
        const ctx = audioCtxRef.current;
        if (!ctx) return null;
        if (!sectionSchedulerRef.current) {
            sectionSchedulerRef.current = new SectionScheduler({
                ctx,
                rate: () => timeStretchRef.current,
                timeline: () => timelineRef.current,
                setTimeline: (next) => { timelineRef.current = next; },
                spans: () => spansRef.current,
                grid: () => gridRef.current,
                currentVoices: () => voicesRef.current,
                setCurrentVoices: adoptSwitchVoices,
                startSwitchVoices: (T, targetOffset, fade) => startSwitchVoices(ctx, T, targetOffset, fade),
                countDestination: () => {
                    const graph = graphRef.current;
                    if (!graph) return null;
                    if (countViaDelayRef.current === 0) return countDestination();
                    graph.countDelay.delayTime.value = playChainRef.current?.compensation ?? 0;
                    return graph.countDelay;
                },
                guideGain: () => graphRef.current?.guideGain ?? null,
                entryLatency: () => playChainRef.current?.compensation ?? 0,
                clickAudible,
                onView: (view, intent) => {
                    setTransitionView(view);
                    setSectionIntent(intent);
                    syncFade();
                },
                onLanded: (to, at) => {
                    setLanded({ index: to, at });
                    syncFade();
                },
                clockMode: () => sectionClockRef.current?.mode ?? 'worker',
            });
        }
        return sectionSchedulerRef.current;
    };
    // Um tique do agendador, só no palco novo.
    const sectionTick = () => {
        if (stageModeRef.current === 'novo') sectionSchedulerRef.current?.tick();
    };
    // Troca de música: o pedido armado é de seções da música que sai.
    const dropSectionIntent = () => {
        sectionSchedulerRef.current?.setIntent(null);
        setLanded(null);
    };

    // === FADE (R-32): rampa única no principal, agendada no relógio do áudio ===
    // De `duração - 5 s` até a duração, marcada pelo play. Pausa, busca e troca de música a
    // desfazem. Intenção armada também: antes da rampa ela nem começa; no meio dela o principal
    // fica no nível de agora e volta pro volume no "1" do pulo (cruzando junto com as vozes).
    // Sem pedido, a rampa é refeita do ponto em que a música está. Só set e rampa linear.
    const clearFadeState = () => {
        fadeRef.current = null;
        fadeHeldRef.current = null;
        fadeRestoreRef.current = null;
        volumeRampRef.current = null;
    };
    // A rampa curta do principal ainda corre em `t`?
    const volumeRampAt = (t: number): VolumeRamp | null => {
        const r = volumeRampRef.current;
        return r && t < r.t1 ? r : null;
    };
    // Instante em que o FADE mexe no principal tocando: o relógio mais a folga do corte.
    const masterHoldAt = (ctx: BaseAudioContext) => ctx.currentTime + cutLead(ctx);
    // Nível do principal em `t` pelo que o FADE marcou, e se ele está no meio de uma rampa.
    const masterLevelAt = (t: number): { level: number; inRamp: boolean } => {
        // A rampa curta vem antes: o FADE (ou o nível segurado) que ela leva só vale depois dela.
        const r = volumeRampAt(t);
        if (r) {
            if (t <= r.t0) return { level: r.v0, inRamp: false };
            return { level: r.v0 + ((r.v1 - r.v0) * (t - r.t0)) / (r.t1 - r.t0), inRamp: true };
        }
        const f = fadeRef.current;
        if (f) return { level: fadeLevelAt(f, t), inRamp: t > f.start && t < f.end };
        const held = fadeHeldRef.current;
        const T = fadeRestoreRef.current;
        const volume = masterVolumeRef.current;
        if (held !== null && T !== null && t > T - SWITCH_FADE) {
            if (t >= T) return { level: volume, inRamp: false };
            return { level: held + ((volume - held) * (t - (T - SWITCH_FADE))) / SWITCH_FADE, inRamp: true };
        }
        return { level: held ?? volume, inRamp: false };
    };
    // Tira o FADE do principal: rampa que não começou só sai; no meio dela (ou com o nível
    // segurado e a volta no "1" marcada) o principal fica no nível de agora. `toVolume`: e sobe
    // pro volume em 50 ms (o operador saiu do FADE). O "agora" é o relógio mais a folga do corte
    // (masterHoldAt): a thread do áudio calcula blocos adiantados, e segurar num instante já
    // calculado dava degrau (medido no Chrome arrastando o volume: até 0,007 sem a folga).
    const dropFade = (ctx: BaseAudioContext, toVolume: boolean) => {
        const gain = masterGainRef.current?.gain;
        const f = fadeRef.current;
        const now = masterHoldAt(ctx);
        if (!gain) { clearFadeState(); return; }
        const ramp = volumeRampAt(now);
        // Rampa que ainda não começou (e nenhuma rampa curta indo até ela): só sai.
        if (f && now < f.start && (!ramp || ramp.t1 < f.start)) {
            gain.cancelScheduledValues(f.start);
            fadeRef.current = null;
            return;
        }
        // Só a rampa curta da saída do FADE correndo pro volume: ela termina sozinha.
        if (!f && fadeHeldRef.current === null) { fadeRestoreRef.current = null; return; }
        const { level, inRamp } = masterLevelAt(now);
        holdMasterAt(gain, now, level, inRamp);
        fadeRef.current = null;
        fadeRestoreRef.current = null;
        fadeHeldRef.current = toVolume ? null : level;
        volumeRampRef.current = null;
        if (toVolume) {
            const volume = masterVolumeRef.current;
            gain.linearRampToValueAtTime(volume, now + MASTER_RAMP_S);
            volumeRampRef.current = { t0: now, v0: level, t1: now + MASTER_RAMP_S, v1: volume };
        }
    };
    // Marca a rampa do FADE, se o modo é FADE e a música toca. `musicStart` (play): a música entra
    // ali, então começar no meio dos 5 s sai no nível proporcional sem degrau audível; tocando, a
    // rampa nova parte do nível de agora, com a folga do corte. `notBefore` (play): o principal
    // ainda está segurado ou subindo até ali (setMasterForPlay) e a rampa começa depois. Quem
    // chama confere a intenção.
    const scheduleFade = (ctx: BaseAudioContext, musicStart?: number, notBefore?: number | null) => {
        const gain = masterGainRef.current?.gain;
        const tl = timelineRef.current;
        const dur = durationRef.current;
        if (!gain || fadeRef.current || tl.length === 0 || playbackModeRef.current !== 'fade-out' || !(dur > FADE_OUT_S)) return;
        // Play pendente ou a "próxima" no fade de 1,5 s (a troca de música manda no principal).
        if (playPendingRef.current || nextSongTimerRef.current !== null) return;
        const now = ctx.currentTime;
        const rate = timeStretchRef.current;
        const start = ctxTimeOf(tl, dur - FADE_OUT_S, now, rate);
        const end = ctxTimeOf(tl, dur, now, rate);
        // Tocando, depois da rampa curta que ainda corre (ela termina no nível de onde a nova parte).
        const t0 = Math.max(musicStart ?? Math.max(masterHoldAt(ctx), volumeRampAt(masterHoldAt(ctx))?.t1 ?? 0), notBefore ?? 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= t0) return;
        const held = fadeHeldRef.current;
        const volume = masterVolumeRef.current;
        const at = Math.max(start, t0);
        const from = held ?? (start < t0 && musicStart !== undefined ? (volume * (end - t0)) / (end - start) : volume);
        gain.setValueAtTime(from, at);
        gain.linearRampToValueAtTime(0, end);
        fadeRef.current = { start: at, end, from };
        fadeHeldRef.current = null;
    };
    // Nível do principal em `t` com o FADE já tirado pela parada: a descida da "próxima", o nível em
    // que a parada o segurou no meio do FADE, ou o volume.
    const restingMasterAt = (t: number): number => {
        const n = nextFadeRef.current;
        if (n) return t <= n.t0 ? n.from : NEXT_FADE_FLOOR + (n.from - NEXT_FADE_FLOOR) * Math.exp(-(t - n.t0) / NEXT_FADE_TC);
        return masterRestRef.current ?? masterVolumeRef.current;
    };
    /**
     * O principal no play, depois de agendar as vozes (Ruling I2-proxima). Nada soltando: volta pro
     * volume na hora, como sempre. Com a música velha ainda soltando (a "próxima" no fim do fade de
     * 1,5 s; a busca saindo dos últimos 5 s com FADE), ele fica no nível de agora (com a folga do
     * corte) e só sobe depois que a cauda dela calou, em 5 ms por rampa linear: a música velha nunca
     * sai mais alta que estava. Descer (busca pra dentro do FADE) começa já, também em 5 ms. O alvo
     * é o volume ou, com o FADE, o nível dele na posição nova. Devolve até quando o principal está
     * nessa volta (o FADE só começa depois), ou null. Só set e rampa linear (Ruling ÁUDIO).
     */
    const setMasterForPlay = (ctx: BaseAudioContext, withFade: boolean): number | null => {
        const gain = masterGainRef.current?.gain;
        const now = ctx.currentTime;
        const hold = masterHoldAt(ctx);
        const level = restingMasterAt(hold);
        // Sem cancelAndHoldAtTime (Firefox), a parada segurou o principal no meio do FADE por uma
        // rampa que termina no nível de agora (dropFade): segurar de novo refaz essa rampa, porque
        // apagar a partir de `hold` tiraria o fim dela e o principal voltaria pro ponto de antes.
        const heldByRamp = masterRestRef.current !== null && typeof masterGainRef.current?.gain.cancelAndHoldAtTime !== 'function';
        nextFadeRef.current = null;
        masterRestRef.current = null;
        if (!gain) return null;
        const volume = masterVolumeRef.current;
        const tail = soundingUntilRef.current;
        if (!(tail > now)) {
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(volume, now);
            return null;
        }
        // Alvo em `t`: o volume, ou o FADE da linha do tempo nova (a mesma conta do scheduleFade).
        const tl = timelineRef.current;
        const dur = durationRef.current;
        const fadeOn = withFade && playbackModeRef.current === 'fade-out' && dur > FADE_OUT_S && tl.length > 0;
        const rate = timeStretchRef.current;
        const fade: FadeRamp = fadeOn
            ? { start: ctxTimeOf(tl, dur - FADE_OUT_S, now, rate), end: ctxTimeOf(tl, dur, now, rate), from: volume }
            : { start: Infinity, end: Infinity, from: volume };
        const targetAt = (t: number) => fadeLevelAt(fade, t);
        const from = targetAt(Math.max(hold, tail) + MASTER_SETTLE_S) > level ? Math.max(hold, tail) : hold;
        const to = from + MASTER_SETTLE_S;
        const target = targetAt(to);
        holdMasterAt(gain, hold, level, heldByRamp);
        if (from > hold) gain.setValueAtTime(level, from);
        gain.linearRampToValueAtTime(target, to);
        // O modelo do principal (masterLevelAt) conhece a volta: volume mexido nela segue dali.
        volumeRampRef.current = { t0: from, v0: level, t1: to, v1: target };
        return to;
    };
    // O FADE segue o pedido de seção (chamado a cada mudança da transição ou da intenção, e no
    // pouso): pedido armado ou pulo marcado tiram a rampa; o pulo marcado devolve o principal no
    // "1" quando ele estava segurado; sem nada armado, a rampa volta.
    const syncFade = () => {
        const ctx = audioCtxRef.current;
        const gain = masterGainRef.current?.gain;
        if (!ctx || !gain || sectionStoppingRef.current) return;
        const now = ctx.currentTime;
        // O "1" que devolvia o principal já passou: ele está no volume.
        if (fadeRestoreRef.current !== null && now >= fadeRestoreRef.current) {
            fadeRestoreRef.current = null;
            fadeHeldRef.current = null;
        }
        const scheduler = stageModeRef.current === 'novo' ? sectionSchedulerRef.current : null;
        const view = scheduler?.view ?? null;
        const T = view?.committed ? view.switchAt : null;
        // O pulo que devolveria o principal foi desfeito (ou mudou) antes do "1": fica segurado.
        if (fadeRestoreRef.current !== null && fadeRestoreRef.current !== T) dropFade(ctx, false);
        if (scheduler?.intent || T !== null) {
            if (fadeRef.current) dropFade(ctx, false);
            const held = fadeHeldRef.current;
            if (T !== null && held !== null && fadeRestoreRef.current === null && T - SWITCH_FADE > now) {
                gain.setValueAtTime(held, T - SWITCH_FADE);
                gain.linearRampToValueAtTime(masterVolumeRef.current, T);
                fadeRestoreRef.current = T;
            }
            return;
        }
        scheduleFade(ctx);
    };
    // Volume principal mexido com o FADE marcado ou o principal segurado no meio dele: em 50 ms o
    // nível segue a mesma curva com o volume novo, só por rampa linear (um setTarget aqui seria
    // seguido pela rampa do FADE, Ruling ÁUDIO); a volta no "1" do pulo vai pro volume novo.
    // O nível de agora sai do modelo (masterLevelAt), que conhece a rampa curta anterior: arrastar o
    // volume (um evento por quadro) emenda as rampas sem degrau.
    const retimeFadeVolume = (ctx: BaseAudioContext, gain: AudioParam, volume: number) => {
        const now = masterHoldAt(ctx);
        const t1 = now + MASTER_RAMP_S;
        const old = masterVolumeRef.current;
        const scale = (v: number) => (old > 0 ? (v * volume) / old : volume);
        const { level, inRamp } = masterLevelAt(now);
        holdMasterAt(gain, now, level, inRamp);
        // A rampa curta que vai até `v1` em `end` (o modelo e o parâmetro andam juntos).
        const rampTo = (v1: number, end: number) => {
            gain.linearRampToValueAtTime(v1, end);
            volumeRampRef.current = { t0: now, v0: level, t1: end, v1 };
        };
        volumeRampRef.current = null;
        const f = fadeRef.current;
        if (f) {
            const curve = { ...f, from: scale(f.from) };
            if (t1 < f.start) {
                rampTo(volume, t1);
                gain.setValueAtTime(curve.from, f.start);
                gain.linearRampToValueAtTime(0, f.end);
                fadeRef.current = curve;
            } else if (t1 < f.end) {
                const v1 = fadeLevelAt(curve, t1);
                rampTo(v1, t1);
                gain.linearRampToValueAtTime(0, f.end);
                fadeRef.current = { start: t1, end: f.end, from: v1 };
            } else {
                // O FADE acaba antes da rampa curta: segue dele até 0.
                if (f.end > now) gain.linearRampToValueAtTime(0, f.end);
                fadeRef.current = { start: now, end: Math.max(now, f.end), from: level };
            }
            return;
        }
        const held = fadeHeldRef.current;
        const T = fadeRestoreRef.current;
        fadeRestoreRef.current = null;
        if (held === null) {
            // Só a rampa curta da saída do FADE corria: termina no volume novo.
            rampTo(volume, t1);
            return;
        }
        if (T !== null && T - SWITCH_FADE <= t1) {
            // A volta no "1" já está cruzando: termina no volume novo.
            rampTo(volume, Math.max(T, t1));
            fadeHeldRef.current = null;
            return;
        }
        const next = scale(held);
        rampTo(next, t1);
        fadeHeldRef.current = next;
        if (T !== null) {
            gain.setValueAtTime(next, T - SWITCH_FADE);
            gain.linearRampToValueAtTime(volume, T);
            fadeRestoreRef.current = T;
        }
    };

    // Relógio do Worker (T5) do palco novo: liga no play e desliga quando a VS para. Cada tique
    // olha o plano do pulo, o fim da música (idempotente, o rAF também olha) e a seção ouvida.
    const startSectionClock = () => {
        if (!sectionClockRef.current) {
            sectionClockRef.current = createSchedulerClock(() => {
                sectionTick();
                if (!songEndRef.current()) setPlayingSpan(sectionIndexAt(spansRef.current, heardPosition()));
            }, { onFallback: () => setSectionClockMode('interval') });
        }
        sectionClockRef.current.start();
    };
    useEffect(() => {
        if (!isPlaying) sectionClockRef.current?.stop();
    }, [isPlaying]);
    // O relógio e o agendador saem junto com o motor.
    useEffect(() => () => {
        sectionClockRef.current?.dispose();
        sectionClockRef.current = null;
        sectionStoppingRef.current = true;
        sectionSchedulerRef.current?.dispose();
        sectionSchedulerRef.current = null;
    }, []);

    // Core persistence. Grava o repertório v3: tudo o que já era salvo (mixagem,
    // tom, marcadores, letra, cifra), sourceId, nome e papel do usuário e a ordem (v2), e a
    // grade da música e o compasso salvo na nuvem (v3; a grade só a lida no click ou com o
    // compasso escolhido no EDITAR: a do BPM salvo é montada na hora, songGridOf).
    const saveStateToDB = async (list: Song[]) => {
        await set(DB_KEY_META, list.map(toSavedSong));
    };

    const updatePlaylistAndSave = (newList: Song[]) => {
        setPlaylist(newList);
        saveStateToDB(newList);
    };

    // O repertório mais novo pra troca de rota fora da renderização (antes dos efeitos abaixo).
    useEffect(() => { playlistRef.current = playlist; }, [playlist]);

    // "Click gerado" mudo fora da rota própria (Ruling X1-critical): o M aceso, o ganho em 0 na hora
    // (dentro do corte, quando a troca de saída passa por ele) e gravado. O operador pode ligar de
    // novo no M; o app só deixa mudo quando a saída vira "Tudo junto", ao abrir assim e quando o
    // click gerado entra numa saída que já virou.
    useLayoutEffect(() => {
        muteGeneratedRef.current = () => {
            const ctx = audioCtxRef.current;
            const graph = graphRef.current;
            if (!ctx || !graph || clickHasOwnRoute(graph.plan, autoPanRef.current)) return;
            const list = playlistRef.current;
            if (!list.some((song) => song.channels.some((ch) => isGeneratedClick(ch) && !ch.muted))) return;
            const next = list.map((song) => {
                if (!song.channels.some((ch) => isGeneratedClick(ch) && !ch.muted)) return song;
                const channels = song.channels.map((ch) => (isGeneratedClick(ch) && !ch.muted ? { ...ch, muted: true } : ch));
                for (const ch of channels) {
                    if (!isGeneratedClick(ch) || !ch.gainNode) continue;
                    ch.gainNode.gain.cancelScheduledValues(ctx.currentTime);
                    ch.gainNode.gain.setValueAtTime(0, ctx.currentTime);
                }
                return { ...song, channels };
            });
            playlistRef.current = next;
            updatePlaylistAndSave(next);
        };
    });

    // Canal novo (restauração, arquivo, canal avulso, metrônomo): pan efetivo no panner e o
    // fader no corte do barramento do papel. Nunca direto no principal.
    const connectChannel = (cuts: RouteCuts, graph: OutputGraph, ch: ChannelIdentity & { pan: number }, panner: StereoPannerNode, gain: GainNode) => {
        const role = resolveChannelRole(ch);
        // Com troca na fila, o canal já nasce no plano NOVO (Ruling T25-canal-novo): ainda não
        // toca (só ganha fonte no próximo play) e o fim da troca confere de novo.
        const ctx = audioCtxRef.current;
        const plan = routeJobsRef.current > 0 && ctx ? planOutputs(outputsRef.current, deviceChannels(ctx)) : graph.plan;
        const pan = channelPanFor(ch, plan, autoPanRef.current);
        panner.pan.value = pan;
        pannerPanRef.current.set(panner, pan);
        gain.connect(cuts[role]);
        faderBusRef.current.set(gain, role);
    };

    // Pan efetivo no panner do canal, só se mudou. `smooth` só pro knob (a rampa curta de
    // antes). Troca de plano, de papel ou do pan automático vai no fundo do corte, sem rampa:
    // numa rampa o Click passaria pelo lado da VS (ex.: Click na saída 2 indo pra esquerda).
    const syncChannelPan = (ctx: BaseAudioContext, ch: Channel, plan: OutputPlan, autoPan: boolean, smooth: boolean) => {
        const pan = channelPanFor(ch, plan, autoPan);
        if (pannerPanRef.current.get(ch.pannerNode) === pan) return;
        if (smooth) ch.pannerNode.pan.setTargetAtTime(pan, ctx.currentTime, 0.05);
        else ch.pannerNode.pan.setValueAtTime(pan, ctx.currentTime);
        pannerPanRef.current.set(ch.pannerNode, pan);
    };
    // Todos os canais de todas as músicas (o repertório mais novo).
    const allChannels = () => playlistRef.current.flatMap((song) => song.channels);
    // O panner da contagem sem canal de click segue o pan efetivo do papel Click, junto com os
    // canais (no fundo do mesmo corte): em "Tudo junto" com o pan automático, o lado do ouvido.
    const countPanPending = (plan: OutputPlan, autoPan: boolean) => {
        const panner = countPannerRef.current;
        return !!panner && pannerPanRef.current.get(panner) !== channelPanFor(COUNT_CHANNEL, plan, autoPan);
    };
    const panPending = (plan: OutputPlan, autoPan: boolean) =>
        countPanPending(plan, autoPan) || allChannels().some((ch) => pannerPanRef.current.get(ch.pannerNode) !== channelPanFor(ch, plan, autoPan));
    const syncAllPans = (ctx: BaseAudioContext, plan: OutputPlan, autoPan: boolean) => {
        const countPanner = countPannerRef.current;
        if (countPanner && countPanPending(plan, autoPan)) {
            const pan = channelPanFor(COUNT_CHANNEL, plan, autoPan);
            countPanner.pan.setValueAtTime(pan, ctx.currentTime);
            pannerPanRef.current.set(countPanner, pan);
        }
        for (const ch of allChannels()) syncChannelPan(ctx, ch, plan, autoPan, false);
    };

    // Papel novo: o fader sai só do corte do barramento antigo e entra no do papel novo.
    const moveFaderToRole = (cuts: RouteCuts, ch: Channel) => {
        const role = resolveChannelRole(ch);
        const was = faderBusRef.current.get(ch.gainNode);
        if (was === role) return;
        if (was) {
            try { ch.gainNode.disconnect(cuts[was]); } catch { /* já estava desligado */ }
        }
        ch.gainNode.connect(cuts[role]);
        faderBusRef.current.set(ch.gainNode, role);
    };

    // === Corte curto das trocas de rota (Ruling T25-corte e T25-sincrono) ===
    // Algo soando pelo motor agora? Vozes agendadas ou tocando (a contagem sempre vem com elas),
    // a cauda de uma soltura (até ~40 ms depois da pausa ou da busca, em ganho 1 nos primeiros
    // 10 ms) ou o fim de um bipe cancelado (até 20 ms). Sem som não há estalo nem vazamento
    // possível: a troca vai na hora. Com a cauda contando, a troca de papel do Click na
    // pré-contagem (que solta a contagem antes da troca da fila rodar) passa pelo corte: a cauda
    // do bipe nunca sai pelo fader que acabou de ir pro barramento da VS.
    const isSounding = () => {
        const ctx = audioCtxRef.current;
        return voicesRef.current.length > 0 || (!!ctx && ctx.currentTime < soundingUntilRef.current);
    };
    const needsCut = () => {
        const ctx = audioCtxRef.current;
        return !!ctx && !!routeCutsRef.current && ctx.state === 'running' && isSounding();
    };
    /**
     * Troca no fundo de um corte de 3 ms nos três barramentos: desce (âncora com
     * setValueAtTime e rampa linear, nunca depois de setTarget: o corte não tem outra
     * automação), a partir de uma folga à frente do relógio e depois do fim do corte
     * anterior, espera o relógio do ÁUDIO passar do fundo (Ruling T25-relogio), faz a troca
     * inteira na mesma tarefa e sobe em 3 ms (também com folga). Sem som, só a troca.
     */
    // O Worker do relógio do corte sai junto com o motor.
    useEffect(() => () => { cutClockRef.current?.dispose(); cutClockRef.current = null; }, []);
    // Tiques do relógio Worker da T5 pra espera do corte. Sem Worker (contexto de teste), só a reserva por timer.
    const cutTickers = (): { add(fn: () => void): () => void } | null => {
        if (typeof Worker === 'undefined') return null;
        if (!cutClockRef.current) {
            cutClockRef.current = createSchedulerClock(() => { for (const fn of [...cutWaitersRef.current]) fn(); }, { intervalMs: CUT_CLOCK_INTERVAL_MS });
        }
        const clock = cutClockRef.current;
        return {
            add(fn) {
                cutWaitersRef.current.add(fn);
                clock.start();
                return () => {
                    cutWaitersRef.current.delete(fn);
                    if (cutWaitersRef.current.size === 0) clock.stop();
                };
            },
        };
    };
    const withRouteCut = async (change: () => void | Promise<void>): Promise<void> => {
        const ctx = audioCtxRef.current;
        const cuts = routeCutsRef.current;
        if (!ctx || !cuts || !needsCut()) {
            await change();
            return;
        }
        const nodes = Object.values(cuts);
        // Começa depois de a subida do corte anterior terminar (NB3): a âncora em 1 é o valor
        // real do ganho ali, mesmo que a espera do corte anterior tenha saído pela reserva.
        const t0 = Math.max(ctx.currentTime + cutLead(ctx), lastCutEndRef.current);
        const bottom = t0 + ROUTE_CUT_S;
        for (const g of nodes) {
            g.gain.setValueAtTime(1, t0);
            g.gain.linearRampToValueAtTime(0, bottom);
        }
        lastCutEndRef.current = bottom;
        await waitForAudioTime(ctx, bottom + 128 / ctx.sampleRate, cutTickers());
        try {
            await change();
        } finally {
            const up = Math.max(ctx.currentTime + cutLead(ctx), bottom);
            for (const g of nodes) {
                g.gain.setValueAtTime(0, up);
                g.gain.linearRampToValueAtTime(1, up + ROUTE_CUT_S);
            }
            lastCutEndRef.current = up + ROUTE_CUT_S;
            await waitForAudioTime(ctx, up + ROUTE_CUT_S, cutTickers());
        }
    };
    // As trocas vão numa fila, na ordem: uma nunca começa no meio do corte de outra.
    const routeQueueRef = useRef<Promise<void>>(Promise.resolve());
    const routeJobsRef = useRef(0);
    // Rede de segurança no fim de cada troca, sobre TODOS os canais (Ruling T25-canal-novo):
    // canal que entrou no repertório no meio do corte fica no pan do plano novo, na hora (ele
    // ainda não toca). Canal TOCANDO que ficou diferente (o pan automático ou o papel mudou na
    // subida desta troca, R3-1) não é escrito com o som inteiro: vai pro fundo de um corte na
    // fila. O acerto que já é de um corte assim escreve direto (não pede outro).
    const settleAfterRoute = (isPanFix: boolean) => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return;
        let deferred = false;
        for (const ch of allChannels()) {
            if (pannerPanRef.current.get(ch.pannerNode) === channelPanFor(ch, graph.plan, autoPanRef.current)) continue;
            if (!isPanFix && ch.sourceNode && needsCut()) { deferred = true; continue; }
            syncChannelPan(ctx, ch, graph.plan, autoPanRef.current, false);
        }
        if (deferred) {
            enqueueRoute(async () => {
                const c = audioCtxRef.current;
                const g = graphRef.current;
                if (c && g && panPending(g.plan, autoPanRef.current)) await withRouteCut(() => syncAllPans(c, g.plan, autoPanRef.current));
            }, true);
        }
    };
    const enqueueRoute = (job: () => Promise<void>, isPanFix = false) => {
        routeJobsRef.current++;
        routeQueueRef.current = routeQueueRef.current
            .then(async () => {
                try {
                    await job();
                } catch (e) {
                    console.error('[saídas] a troca de rota falhou', e);
                } finally {
                    // A fila sempre se libera, mesmo se o acerto lançar (R3-3).
                    try {
                        settleAfterRoute(isPanFix);
                    } catch (e) {
                        console.error('[saídas] o acerto de pan do fim da troca falhou', e);
                    } finally {
                        routeJobsRef.current--;
                    }
                }
            })
            .catch((e) => { console.error('[saídas] a fila de trocas falhou', e); });
    };
    // Troca síncrona (plano, papel, pan automático): fila vazia e nada soando, na hora.
    const switchRoute = (change: () => void) => {
        if (routeJobsRef.current === 0 && !needsCut()) {
            change();
            return;
        }
        enqueueRoute(() => withRouteCut(change));
    };

    // Plano e pans de todos os canais na mesma tarefa (Ruling T25-sincrono): o roteador e os
    // panners mudam juntos, no fundo do corte.
    const applyOutputsNow = () => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return;
        const max = deviceChannels(ctx);
        const hadOwnRoute = clickHasOwnRoute(graph.plan, autoPanRef.current);
        const plan = routeOutputs(ctx, graph, outputsRef.current, max);
        syncAllPans(ctx, graph.plan, autoPanRef.current);
        // A saída virou "Tudo junto" (ou 1 canal): o click gerado fica mudo no mesmo fundo do corte.
        if (hadOwnRoute && !clickHasOwnRoute(graph.plan, autoPanRef.current)) muteGeneratedRef.current();
        setMaxOutputChannels(max);
        // Aparelho que não respondeu à troca: o aviso vai junto dos outros avisos de saída (T29 mostra).
        setOutputPlan(sinkTimeoutRef.current ? { ...plan, warning: 'sink-timeout' } : plan);
    };

    // A rota de agora já é a que as saídas e o aparelho pedem (plano, destino e pans)?
    const outputsUpToDate = (): boolean => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return true;
        const wanted = planOutputs(outputsRef.current, deviceChannels(ctx));
        return samePlan(graph.plan, wanted) && destinationMatches(ctx, wanted) && !panPending(graph.plan, autoPanRef.current);
    };
    // Refaz o plano com os canais do aparelho de agora (troca de modo, de lado, de mapa ou de
    // aparelho). Nada a mudar: só atualiza o aviso, sem corte; senão troca no corte. Com outra
    // troca na fila (ex.: o sinkchange no meio do setSinkId), decide na vez dela.
    const refreshOutputs = useCallback(() => {
        if (!audioCtxRef.current || !graphRef.current) return;
        if (routeJobsRef.current > 0) {
            enqueueRoute(async () => {
                if (outputsUpToDate()) applyOutputsNow();
                else await withRouteCut(applyOutputsNow);
            });
            return;
        }
        if (outputsUpToDate()) applyOutputsNow();
        else switchRoute(applyOutputsNow);
    // Só refs e funções que leem refs: a mesma função serve pra sempre (sinkchange).
    }, []);

    // Saídas mudaram nas Configurações: plano novo.
    useEffect(() => {
        outputsRef.current = outputs;
        refreshOutputs();
    }, [outputs, refreshOutputs]);

    // Pan automático ligado ou desligado: os panners trocam de lado no corte.
    useEffect(() => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph || !panPending(graph.plan, settings.autoPan)) return;
        switchRoute(() => syncAllPans(ctx, graph.plan, autoPanRef.current));
    }, [settings.autoPan]);

    // Apply Audio Device Output Routing. Até o plano novo valer, o aparelho novo tocaria a
    // rota antiga (ex.: o Click da saída 1 do fone caindo na saída 1 de uma placa onde 1/2 é
    // a VS): o setSinkId e o plano novo acontecem os dois no fundo do mesmo corte.
    useEffect(() => {
        const ctx = audioCtxRef.current as SinkAudioContext | null;
        if (!ctx) return;
        const deviceId = settings.audioDeviceId === 'default' ? '' : settings.audioDeviceId;
        enqueueRoute(() => withRouteCut(async () => {
            if (typeof ctx.setSinkId === 'function' && ctx.sinkId !== deviceId) {
                const attempt = ++sinkAttemptRef.current;
                sinkTimeoutRef.current = false;
                try {
                    // Respondeu depois do teto: o aviso sai e o plano é refeito com o aparelho de agora.
                    sinkTimeoutRef.current = await setSinkWithTimeout(ctx, deviceId, () => {
                        if (attempt !== sinkAttemptRef.current) return;
                        sinkTimeoutRef.current = false;
                        refreshOutputs();
                    });
                } catch (e) {
                    console.error("Failed to set audio sink. Permissions or unsupported browser.", e);
                }
            }
            // O aparelho novo pode ter outro número de canais: plano novo com o máximo dele.
            applyOutputsNow();
        }));
    }, [settings.audioDeviceId, isReady]);

    // Rede de segurança: canal novo ou repertório trocado. Os canais já nascem com o pan
    // certo; aqui só corrige o que tiver ficado pra trás. Com troca na fila, entra na fila
    // atrás dela (o fim de cada troca acerta todos os canais) em vez de escrever no meio do corte.
    useEffect(() => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return;
        if (routeJobsRef.current > 0) enqueueRoute(async () => {});
        else syncAllPans(ctx, graph.plan, autoPanRef.current);
    }, [playlist, outputPlan]);

    // Sync pitch ref whenever the active song or its pitch changes
    useEffect(() => {
        currentPitchRef.current = sanitizeSemitones(activeSong?.pitch ?? 0);
    }, [activeSong?.pitch, activeSongIndex]);

    // Initialize engine
    const initEngine = useCallback(async () => {
        if (!audioCtxRef.current) {
            const ctx: SinkAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            // Barramentos por papel -> roteador -> principal -> mudo geral -> destino (T12).
            // Canais lidos antes de o grafo mexer no destino.
            const max = deviceChannels(ctx);
            const { graph, plan } = buildOutputGraph(ctx, outputsRef.current, max);
            graph.master.gain.value = 1;
            // Corte de cada barramento (criado uma vez): os faders ligam nele, ele no barramento.
            const cuts: RouteCuts = { click: ctx.createGain(), guide: ctx.createGain(), normal: ctx.createGain() };
            for (const role of ['click', 'guide', 'normal'] as const) cuts[role].connect(graph.input(role));
            routeCutsRef.current = cuts;
            // Contagem sem canal de click (R-35; Opção A da T26, vale também pra rota de reserva):
            // atraso da contagem -> panner do motor -> corte do Click -> barramento do Click.
            // Passa pelo corte das trocas como os canais, e o panner recebe o pan efetivo do papel
            // Click (syncAllPans), com o pan automático de "Tudo junto". O corte fica depois do
            // atraso: não desloca o L. O panner da contagem de dentro do grafo fica sem entrada.
            const countPanner = ctx.createStereoPanner();
            const countPan = channelPanFor(COUNT_CHANNEL, plan, autoPanRef.current);
            countPanner.pan.value = countPan;
            pannerPanRef.current.set(countPanner, countPan);
            graph.countDelay.disconnect();
            graph.countDelay.connect(countPanner);
            countPanner.connect(cuts.click);
            countPannerRef.current = countPanner;
            // Aparelho trocado (pelo setSinkId ou pelo sistema): plano novo com os canais dele.
            ctx.onsinkchange = () => refreshOutputs();

            audioCtxRef.current = ctx;
            graphRef.current = graph;
            masterGainRef.current = graph.master;
            setMaxOutputChannels(max);
            setOutputPlan(plan);
            Tone.setContext(ctx);
            setIsReady(true);

            // Try Restore. Registro v1 (antes da Parte 1) migra pra v2 aqui; o
            // primeiro save depois grava v2 com a mesma ordem, nome e papel.
            const storedMeta = await get<SavedSong[]>(DB_KEY_META);
            // Primeira restauração desta conta (R-23, Rulings T25-legacy, T25-reset-sempre e
            // I1-rota): os pans ±1 que o pan automático gravou voltam ao centro, o que o operador
            // girou à mão fica do lado dele (fixLegacyPans), e tudo já fica gravado, com todas as
            // músicas (inclusive a que não abrir agora); depois a conta ganha a marca dela. Uma vez
            // só por conta. Quem separava à mão sem o pan automático passa pra "Click e Guia
            // separados" do mesmo lado, antes de qualquer canal ligar.
            const resetLegacyPans = readLocal(LEGACY_PANS_DONE_KEY) !== '1';
            const migratedMeta = Array.isArray(storedMeta) ? storedMeta.map(migrateSavedSong) : [];
            const fixed = resetLegacyPans
                ? fixLegacyPans(migratedMeta, { outputs: outputsRef.current, autoPan: autoPanRef.current, legacyPanReset: legacyPanResetRef.current }, { moveOutputs: true })
                : { songs: migratedMeta, outputs: null };
            if (fixed.outputs) {
                outputsRef.current = fixed.outputs;
                applyOutputsNow();
                const update = updateSettingRef.current;
                if (typeof update === 'function') update('outputs', fixed.outputs);
            }
            // O "Click gerado" de antes (v1.4.19) abre mudo quando a saída não tem rota própria pro
            // Click: em "Tudo junto" ele iria pro PA (Ruling X1-critical).
            const savedMeta = clickHasOwnRoute(graph.plan, autoPanRef.current) ? fixed.songs : fixed.songs.map(withGeneratedClickMuted);
            if (savedMeta.some((s, i) => s !== migratedMeta[i])) await set(DB_KEY_META, savedMeta);
            if (resetLegacyPans) writeLocal(LEGACY_PANS_DONE_KEY, '1');
            // Map legado (repertórios gravados antes da migração por-stem). Pode
            // não existir mais; os arquivos novos vivem em chaves por-stem.
            const savedFiles = await get<Map<string, File>>(DB_KEY_FILES);

            if (savedMeta.length > 0) {
                setIsRestoring(true);

                const restoreSongs = async (metaSong: SavedSong): Promise<Song | null> => {
                    const channelPromises = metaSong.channels.map(async (metaCh): Promise<Channel | null> => {
                        const file = await getChannelFile(metaCh.id, savedFiles, metaCh.srcId, metaCh.srcIdx);
                        if (!file || !ctx) return null;

                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                            const panner = ctx.createStereoPanner();
                            setupPannerForBuffer(panner, audioBuffer);
                            const gain = ctx.createGain();

                            gain.gain.value = channelGain(metaCh, metaSong.channels);

                            panner.connect(gain);
                            connectChannel(cuts, graph, metaCh, panner, gain);

                            // Worklet de tom é lazy: só nasce no play se houver transpose.
                            // Não guarda o blob (file) na memória viva: já está
                            // persistido (cache/IDB) e é relido só quando preciso
                            // (export). Segurar file + buffer dobrava a RAM.
                            return {
                                id: metaCh.id,
                                name: metaCh.name,
                                customName: metaCh.customName,
                                role: metaCh.role,
                                buffer: audioBuffer,
                                srcId: metaCh.srcId,
                                srcIdx: metaCh.srcIdx,
                                gainNode: gain,
                                pannerNode: panner,
                                sourceNode: null,
                                volume: metaCh.volume,
                                muted: metaCh.muted,
                                soloed: metaCh.soloed,
                                pan: metaCh.pan,
                                bus: metaCh.bus || '1/2'
                            };
                        } catch (e) {
                            console.error(`Failed to restore channel ${metaCh.name}`, e);
                            return null;
                        }
                    });

                    const decoded = (await Promise.all(channelPromises)).filter((c): c is Channel => c !== null);
                    if (decoded.length === 0) return null;
                    // Ordem automática volta na ordem padrão; manual mantém a do usuário.
                    const channels = arrangeChannels(decoded, metaSong.channelOrder);

                    // O tom é detectado na ordem salva, como antes: a ordem padrão
                    // põe a bateria na frente, que é ruim pra achar o tom.
                    const mainCh = pickMainChannel(decoded);

                    let originalKey = metaSong.originalKey || null;
                    if (!originalKey && mainCh) originalKey = detectKey(mainCh.buffer);

                    const bpm = metaSong.bpm ?? undefined;

                    // Meta salvo ANTES do decode (loadFiles persiste cedo p/ a
                    // música sobreviver a um reload no celular) entra com duration
                    // 0. Aqui já temos os buffers, então recalculamos a partir
                    // deles em vez de mostrar 00:00.
                    const restoredDuration = metaSong.duration && metaSong.duration > 0
                        ? metaSong.duration
                        : Math.max(0, ...channels.map((c) => c.buffer.duration));

                    // Capas antigas podem ter sido salvas como blob: URL (object
                    // URL de sessão). Ao reabrir o app esse blob está morto e a
                    // imagem quebra (no desktop, ERR_FILE_NOT_FOUND). Descarta pra
                    // cair no placeholder; novas capas já vêm como data: URL durável.
                    const coverImage = metaSong.coverImage?.startsWith('blob:')
                        ? undefined
                        : metaSong.coverImage;

                    return {
                        id: metaSong.id,
                        sourceId: metaSong.sourceId,
                        name: metaSong.name,
                        coverImage,
                        channelOrder: metaSong.channelOrder,
                        duration: restoredDuration,
                        pitch: metaSong.pitch || 0,
                        originalKey,
                        bpm,
                        channels,
                        artist: metaSong.artist,
                        markers: metaSong.markers,
                        lyrics: metaSong.lyrics ?? null,
                        lyricsSynced: metaSong.lyricsSynced ?? null,
                        chords: metaSong.chords ?? null,
                        // Grade e compasso do v3 (já limpos pelo migrateSavedSong). Sem eles, o
                        // primeiro save de um v3 reaberto apagaria a grade (achado 67 do preflight);
                        // a grade salva não é lida de novo ao reabrir.
                        grid: metaSong.grid,
                        timeSignature: metaSong.timeSignature,
                        // O 1 não provado (Ruling T27-campo): o COMPASSO ASSUMIDO volta com a música.
                        downbeatAssumed: metaSong.downbeatAssumed,
                        // O usuário apagou o click dela: o click gerado não volta (Ruling X1-critical).
                        clickRemoved: metaSong.clickRemoved === true ? true : undefined
                    };
                };

                const songResults = await Promise.all(savedMeta.map(restoreSongs));
                const restoredPlaylist = songResults.filter((s): s is Song => s !== null);

                if (restoredPlaylist.length > 0) {
                    // A fila da grade (abaixo) já acha as músicas, antes da renderização.
                    playlistRef.current = restoredPlaylist;
                    setPlaylist(restoredPlaylist);
                    setDuration(restoredPlaylist[0].duration);
                    // Grade (T27): quem ainda não tem grade de click (repertório de antes da Parte 2)
                    // lê o click na fila, com a VS parada, e chega no culto com a grade pronta
                    // (a troca de música do AUTO é tocando, e tocando nada é lido). A grade salva
                    // não é lida de novo; o click gerado só quando a música fica ativa parada.
                    for (const song of restoredPlaylist) {
                        gridReadSeenRef.current.add(song.id);
                        scheduleSongGrid(song, { read: true, generate: false });
                    }
                }
                setIsRestoring(false);
            }
        }
    }, [DB_KEY_META, DB_KEY_FILES, LEGACY_PANS_DONE_KEY, refreshOutputs]);

    // Desliga a pré-contagem: cancela os bipes que faltam (o que soa desce sem estalo, T7), o
    // timer da tela e o estado. Chamado pela soltura de tudo (stopAllNodes).
    const endCountIn = () => {
        const ctx = audioCtxRef.current;
        const count = countRef.current;
        countRef.current = null;
        if (count && ctx) {
            const now = ctx.currentTime;
            // Bipe soando agora desce e para em 20 ms: até lá ele ainda conta como som. Com a
            // música transposta a contagem entra num atraso de compensação (o do canal de click
            // ou o da contagem, R-35) e ainda sai L depois.
            const lag = playChainRef.current?.compensation ?? 0;
            // Conta também o bipe que já parou na fonte mas ainda sai do atraso (até L depois).
            if (count.beats.some((b) => b.at <= now && now < b.at + COUNT_BEEP_LENGTH + lag)) {
                soundingUntilRef.current = Math.max(soundingUntilRef.current, now + COUNT_CANCEL_TAIL + lag);
            }
            count.cancel(now);
        }
        if (countInTimeoutRef.current) {
            clearTimeout(countInTimeoutRef.current);
            countInTimeoutRef.current = null;
        }
        setIsCountingIn(false);
        setPrecountTimes(NO_TIMES);
    };

    // Solta tudo o que toca: vozes com rampa curta (a que ainda não começou para já), contagem,
    // linha do tempo e worklets. Nada fica agendado; o play() seguinte monta tudo de novo.
    const stopAllNodes = useCallback(() => {
        const ctx = audioCtxRef.current;
        // Palco novo: o agendador desfaz o pulo marcado (do "1" em diante, fecha o pouso e as vozes
        // novas passam a ser as do motor) antes da soltura; a intenção armada fica. O FADE sai
        // junto: o play seguinte refaz o principal e a rampa.
        sectionStoppingRef.current = true;
        try {
            sectionSchedulerRef.current?.reset();
        } finally {
            sectionStoppingRef.current = false;
        }
        if (ctx) dropFade(ctx, false);
        // No meio do FADE o principal ficou segurado nesse nível: o play seguinte parte dele.
        if (fadeHeldRef.current !== null) masterRestRef.current = fadeHeldRef.current;
        clearFadeState();
        endCountIn();
        const voices = voicesRef.current;
        voicesRef.current = [];
        if (ctx && voices.length > 0) {
            const starts = voiceStartsRef.current;
            const { at, until } = releaseVoices(ctx, voices, (v) => starts.get(v) ?? 0);
            if (at !== null) releaseAtRef.current = Math.max(releaseAtRef.current, at);
            // Click e Guia com a música transposta passam pelo atraso de compensação: a cauda
            // deles ainda sai L depois (a pausa não esvazia o atraso).
            if (until > ctx.currentTime) {
                soundingUntilRef.current = Math.max(soundingUntilRef.current, until + (playChainRef.current?.compensation ?? 0));
            }
        }
        timelineRef.current = [];
        for (const ch of [...channels, ...(playChainRef.current?.channels ?? [])]) ch.sourceNode = null;
        playChainRef.current = null;
        // Sem fonte, o worklet ativo seguiria rodando o DSP à toa (mais caro que
        // tocando): para todos. O play() religa os que vai usar.
        stopPitchNodes();
    }, [channels]);

    // Pré-contagem na tela: o número do bipe ouvido sai dos instantes (PlayButton) e o
    // isCountingIn fica ligado até as vozes começarem a ser ouvidas. Timer só da tela: o som já
    // está todo agendado no relógio do áudio.
    const showCountIn = (ctx: BaseAudioContext, count: ScheduledCount, voicesAt: number, heardLag: number) => {
        setPrecountTimes(count.beats.map((b) => b.at));
        setIsCountingIn(true);
        if (countInTimeoutRef.current) clearTimeout(countInTimeoutRef.current);
        countInTimeoutRef.current = setTimeout(() => {
            countInTimeoutRef.current = null;
            setIsCountingIn(false);
            setPrecountTimes(NO_TIMES);
        }, Math.max(0, (voicesAt - ctx.currentTime + heardLag) * 1000));
    };

    // Toca do pausedAtRef. Uma voz por canal, todas no mesmo instante e no mesmo offset, na
    // entrada do canal (entryFor). Com { precount: true }: n bipes no pulso da música em
    // countDestination(), começando no instante comum, e as vozes no fim deles; tudo agendado
    // de uma vez no relógio do áudio.
    const play = useCallback(async (opts?: { precount?: boolean }) => {
        const ctx = audioCtxRef.current;
        if (!ctx || !graphRef.current || channels.length === 0) return;
        const gen = ++playGenRef.current;
        playPendingRef.current = true;
        precountPendingRef.current = !!opts?.precount;

        // iOS / Safari: must await resume before scheduling sources.
        // Otherwise sources are scheduled while ctx.currentTime is frozen,
        // and after resume they play "in the past" — silently.
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (e) { console.error('Failed to resume AudioContext', e); }
        }
        if (gen !== playGenRef.current) return;

        // O principal volta pro volume no fim (setMasterForPlay), depois de agendar as vozes: a
        // música velha pode estar soltando ainda.
        stopAllNodes();

        // Clear any auto-next timeout if user manually played
        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        // Worklets de canais que não são desta música (música trocada) voltam pra reserva.
        releasePitchNodesExcept(channels);

        // Prepara ANTES os nós de tom que faltam (é assíncrono). Antes o await ficava
        // dentro do laço de start(): na 1ª vez tocando transposto, cada faixa começava
        // depois da anterior (dezenas de ms) e o click saía fora do resto da banda.
        // Agora todos os start() rodam no mesmo tick, então começam juntos.
        if (currentPitchRef.current !== 0) {
            // Só espera quando falta worklet. Com todos prontos (seek, loop ou
            // salto transposto) segue sem await, tão rápido quanto no tom 0.
            // Click e Guia (regra central, o papel manual vale) nunca usam worklet.
            const missing = channels.filter(ch => !isPitchExempt(ch) && !pitchSlotsRef.current.has(ch.id));
            if (missing.length > 0) {
                await Promise.all(missing.map(ch => ensurePitchSlot(ctx, ch)));
                // Outro play() (troca de tom, seek, pausa) começou enquanto o worklet
                // nascia: este desiste. Sem isso as duas levas de fontes tocavam juntas.
                if (gen !== playGenRef.current) return;
            }
            // Latência do nó: normalmente já foi lida quando o worklet nasceu.
            if (pitchLatencyRef.current === null) {
                const anySlot = channels.map(ch => pitchSlotsRef.current.get(ch.id)).find(Boolean);
                if (anySlot) {
                    await readPitchLatency(anySlot.node);
                    if (gen !== playGenRef.current) return;
                }
            }
        }
        // Lido de novo: o tom pode ter mudado (entre dois tons != 0) durante a espera.
        const playPitch = currentPitchRef.current;
        // Com tom != 0 as faixas transpostas saem com a latência do worklet; quem
        // não passa por ele (Click e Guia pela regra central, ou worklet que falhou)
        // atrasa o mesmo tanto. Tom 0: sem atraso.
        const viaPitch = (ch: Channel) => playPitch !== 0 && !isPitchExempt(ch) && pitchSlotsRef.current.has(ch.id);
        const compensation = channels.some(viaPitch) ? pitchLatencyRef.current : null;
        playChainRef.current = { songId: activeSongId ?? null, channels, pitch: playPitch, compensation };
        const rate = timeStretch;
        // Ruling T30-grade: o ponto da faixa numa amostra exata (o instante do play já é a grade de
        // blocos; o da pré-contagem é arredondado abaixo). A linha do tempo usa o mesmo ponto.
        const offset = onSampleGrid(Math.max(0, pausedAtRef.current), ctx.sampleRate);
        // Pré-contagem no pulso da grade (T27), um bipe por tempo contado como na contagem do pulo
        // (no composto contando de 3 em 3, a pontuada); sem grade, o BPM salvo, e sem ele 100.
        const pulse = activeGrid
            ? pulseSeconds(activeGrid) * activeGrid.countEvery
            : 60 / (songBpm !== undefined && Number.isFinite(songBpm) && songBpm > 0 ? songBpm : 100);
        // Tempos de 1 a 8 (o que o aparelho guardou pode vir estragado: sem contagem, nunca NaN no relógio).
        const beats = opts?.precount && Number.isInteger(precountBeats) ? Math.max(1, Math.min(8, precountBeats)) : 0;

        // Monta as vozes de todas as faixas (entradas, fontes e envelopes) e só então agenda
        // todas no mesmo instante, lido depois de montar tudo: o laço de start() só agenda
        // (microssegundos). Com start(0) ("assim que der") e o laço longo, se ele cruzava um
        // bloco de áudio (2,67 ms) parte das faixas começava um ou dois blocos depois (medido:
        // 7 a 10 de 52 reinícios).
        const scheduleAll = (leadQuanta: number) => {
            const specs: VoiceSpec[] = [];
            for (const ch of channels) {
                // Ganho pela regra central (Solo e M), já no instante do play: cancela a
                // automação pendente e aplica o volume certo.
                if (ch.gainNode) {
                    ch.gainNode.gain.cancelScheduledValues(ctx.currentTime);
                    ch.gainNode.gain.setValueAtTime(channelGain(ch, channels), ctx.currentTime);
                }
                // BYPASS NO TOM 0: a engine de tom (worklet+WASM) é um phase-vocoder caro que
                // roda DSP por quadro mesmo parada. No tom 0 (caso comum) a voz vai DIRETO pro
                // panner, sem worklet, então N faixas não saturam a thread de áudio. O worklet
                // só nasce, sob demanda, quando a música está transposta e a faixa não é
                // click/guia (entryFor).
                specs.push({ channelId: ch.id, buffer: ch.buffer, entry: entryFor(ch, playPitch, compensation), loop: isEndlessLoop(ch) });
            }
            const voices = specs.map((spec) => buildVoice(ctx, spec, rate));
            // Com pré-contagem o 1º bipe sai com a folga de reserva (40 ms): com 2 blocos ele nascia
            // atrasado quando o navegador calcula vários blocos de uma vez (medido no Chrome sob
            // carga: o relógio da thread principal pulou 12,6 ms enquanto a contagem era marcada) e
            // começava no meio do ataque. As faixas entram um tempo depois; ninguém ouve 35 ms a mais
            // entre apertar o play e o 1º bipe (Ruling T30-reagenda).
            // Ruling I4-busca: com a voz velha ainda em ganho 1 (busca, volta do LOOP do palco antigo),
            // as novas começam no máximo SEEK_OVERLAP_MAX_S antes de ela descer, no limite de bloco.
            const released = releaseAtRef.current > ctx.currentTime ? quantumAtOrAfter(ctx, releaseAtRef.current - SEEK_OVERLAP_MAX_S) : 0;
            const t0 = Math.max(released, nextRenderQuantum(ctx, beats > 0 ? Math.max(leadQuanta, Math.ceil(RETRY_LEAD_S * ctx.sampleRate / 128)) : leadQuanta));
            // t0 já está na grade de blocos (logo, de amostras); com pré-contagem, o 5º tempo vai
            // pra amostra mais perto (Ruling T30-grade).
            const when = beats > 0 ? onSampleGrid(t0 + beats * pulse, ctx.sampleRate) : t0;
            // Ruling T30-reagenda: a contagem é marcada logo depois de ler o relógio, antes do laço de
            // start() das faixas (o trecho que pode demorar), pra o 1º bipe nunca nascer atrasado.
            const count = beats > 0
                ? scheduleCount(ctx, countDestination(), Array.from({ length: beats }, (_, k) => ({ at: t0 + k * pulse, label: k + 1 })))
                : null;
            for (const v of voices) v.source.start(when, offset);
            return { t0, when, voices, count };
        };

        let scheduled = scheduleAll(START_LEAD_QUANTA);
        // O relógio chegou no instante das faixas antes de o laço terminar: o motor
        // pode ter calculado aquele bloco com parte das faixas ainda sem start(),
        // e essas começariam um bloco depois até o próximo reinício. Descarta e
        // agenda de novo com a folga de reserva. Raro: precisa de 2 blocos de
        // áudio calculados durante um laço de microssegundos.
        // Ruling T30-reagenda: com pré-contagem as faixas começam um tempo inteiro depois do 1º
        // bipe, então só o instante delas conta. Cancelar uma contagem que já começou deixava um
        // tique de ~8 ms no ouvido (medido no Chrome sob carga, harness da T30); a contagem segue
        // e as faixas, já marcadas relativas a ela, valem. Nenhuma automação nova (Ruling ÁUDIO:
        // nada de rampa depois de um setTarget em curso, que é o que o cancelamento do bipe faz).
        // Só uma trava maior que o tempo até a música (a contagem já tocou) refaz tudo junto.
        if (ctx.currentTime >= scheduled.when) {
            for (const v of scheduled.voices) {
                try { v.source.stop(); } catch { /* já parada */ }
                v.source.disconnect();
                v.env.disconnect();
            }
            scheduled.count?.cancel(ctx.currentTime);
            scheduled = scheduleAll(Math.ceil(RETRY_LEAD_S * ctx.sampleRate / 128));
            // Rastro pro teste em aparelho fraco: quantos reinícios ganharam os 40 ms.
            console.warn(`[tom] reinício reagendado com a folga de reserva (${++leadRetriesRef.current})`);
        }

        const { when, voices, count } = scheduled;
        voicesRef.current = voices;
        voices.forEach((v, i) => {
            voiceStartsRef.current.set(v, when);
            channels[i].sourceNode = v.source;
        });
        timelineRef.current = [{ ctxStart: when, songStart: offset }];
        countRef.current = count;
        playPendingRef.current = false;
        precountPendingRef.current = false;
        setIsPlaying(true);
        if (count) showCountIn(ctx, count, when, latencyOf((ctx as AudioContext).outputLatency) + (compensation ?? 0));
        // Principal e FADE do fim (R-32), com a música entrando em `when`; com intenção armada o FADE
        // não começa. Vale pra pré-contagem também (ela sai pelo principal).
        const withFade = !(stageModeRef.current === 'novo' && sectionSchedulerRef.current?.intent);
        const settled = setMasterForPlay(ctx, withFade);
        if (withFade) scheduleFade(ctx, when, settled);
        // Palco novo: o relógio do Worker liga e o agendador olha o plano a partir daqui.
        if (stageModeRef.current === 'novo') {
            setPlayingSpan(sectionIndexAt(spansRef.current, offset));
            sectionScheduler();
            startSectionClock();
            sectionTick();
        }
    }, [channels, stopAllNodes, masterVolume, timeStretch, precountBeats, songBpm, activeSongId, activeGrid]);

    // Pausa (e cancela a pré-contagem). A posição sai da linha do tempo antes de soltar as vozes.
    const pause = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || !isPlaying) return;

        // Cancela um play() que ainda espera o worklet nascer.
        const position = getPlaybackPosition(ctx);
        playGenRef.current++;
        playPendingRef.current = false;
        precountPendingRef.current = false;
        recountQueuedRef.current = false;
        recountJobRef.current = null;
        pausedAtRef.current = position;
        stopAllNodes();
        setIsPlaying(false);
        // Parado, o agendador só guarda a intenção (a linha do tempo está vazia).
        sectionTick();

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }
        // Pausou no fade da "próxima": fica nesta música, parada.
        if (nextSongTimerRef.current !== null) {
            clearTimeout(nextSongTimerRef.current);
            nextSongTimerRef.current = null;
        }
    }, [isPlaying, stopAllNodes, timeStretch]);

    const skipBack = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        // Na pré-contagem, o reinício conta de novo (a música nunca entra sem contar).
        const opts = restartOpts();

        // V3: 2-second rule for restart
        if (currentTime > 2) {
            const wasPlaying = isPlaying;
            stopAllNodes();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            if (wasPlaying) play(opts);
            return;
        }

        // Behavior if <= 2 seconds
        if (activeSongIndex > 0) {
            if (autoNextTimeoutRef.current) {
                clearTimeout(autoNextTimeoutRef.current);
                autoNextTimeoutRef.current = null;
            }
            stopAllNodes();
            dropSectionIntent();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            setActiveSongIndex(prev => prev - 1);
            setDuration(playlist[activeSongIndex - 1].duration);
            if (isPlaying) {
                autoPlayOptsRef.current = opts;
                setShouldAutoPlayNext(true);
            }
        } else {
            const wasPlaying = isPlaying;
            stopAllNodes();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            if (wasPlaying) play(opts);
        }
    }, [currentTime, isPlaying, play, activeSongIndex, playlist, stopAllNodes]);

    const seekTo = useCallback((time: number) => {
        if (!audioCtxRef.current || duration === 0) return;

        // Bound time
        const targetTime = Math.max(0, Math.min(time, duration));

        const wasPlaying = isPlaying;
        // Busca na pré-contagem: conta de novo no ponto novo.
        const opts = restartOpts();

        stopAllNodes();
        pausedAtRef.current = targetTime;
        setCurrentTime(targetTime);

        // Clear any auto track switch timeouts
        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        if (wasPlaying) {
            play(opts);
        } else {
            sectionTick();
        }
    }, [duration, isPlaying, play, stopAllNodes]);

    const executeNextSong = useCallback(() => {
        if (activeSongIndex >= playlist.length - 1) return;
        // Trocou de música na pré-contagem: a próxima também conta.
        autoPlayOptsRef.current = restartOpts();
        cancelPendingPlay();

        stopAllNodes();
        dropSectionIntent();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setCurrentMarker(null);
        setActiveSongIndex(prev => prev + 1);
        setDuration(playlist[activeSongIndex + 1].duration);
        setShouldAutoPlayNext(true);

        // O principal continua onde a "próxima" deixou (o fim do fade de 1,5 s): o play da música
        // seguinte só o devolve pro volume depois que a cauda da velha calou (setMasterForPlay).
    }, [activeSongIndex, playlist, stopAllNodes]);

    const nextSong = useCallback(() => {
        if (activeSongIndex >= playlist.length - 1) return;

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        if (isPlaying) {
            // Fade out current song then execute next (troca de música por timer, exceção R-32).
            if (masterGainRef.current && audioCtxRef.current) {
                const ctx = audioCtxRef.current;
                if (nextSongTimerRef.current !== null) clearTimeout(nextSongTimerRef.current);
                nextSongTimerRef.current = window.setTimeout(() => {
                    nextSongTimerRef.current = null;
                    executeNextSong();
                }, 1500);
                // O FADE e o pulo armado saem antes (com o timer já marcado, o FADE não volta): o
                // setTarget da troca nunca é seguido por rampa (Ruling ÁUDIO).
                // O nível de onde a descida parte, pelo modelo do principal (FADE, rampa curta ou volume).
                const t0 = masterHoldAt(ctx);
                const from = nextFadeRef.current ? restingMasterAt(t0) : masterLevelAt(t0).level;
                dropFade(ctx, false);
                fadeHeldRef.current = null;
                dropSectionIntent();
                // No mesmo instante em que o FADE segurou o principal (depois dele, o setTarget
                // seria apagado pelo ponto segurado).
                masterGainRef.current.gain.setTargetAtTime(NEXT_FADE_FLOOR, t0, NEXT_FADE_TC);
                nextFadeRef.current = { t0, from };
            }
        } else {
            executeNextSong();
        }
    }, [activeSongIndex, playlist.length, isPlaying, executeNextSong]);

    const prevSong = useCallback(() => {
        // Na 1ª música volta pro começo dela: um play pendente dela continua valendo.
        if (activeSongIndex <= 0) {
            skipBack();
            return;
        }
        const opts = restartOpts();
        cancelPendingPlay();

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        stopAllNodes();
        dropSectionIntent();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setActiveSongIndex(prev => prev - 1);
        setDuration(playlist[activeSongIndex - 1].duration);

        if (isPlaying) {
            autoPlayOptsRef.current = opts;
            setShouldAutoPlayNext(true);
        }
    }, [activeSongIndex, playlist, isPlaying, skipBack, stopAllNodes]);

    useEffect(() => {
        if (shouldAutoPlayNext && channels.length > 0) {
            setShouldAutoPlayNext(false);
            const opts = autoPlayOptsRef.current;
            autoPlayOptsRef.current = undefined;
            play(opts);
        }
    }, [shouldAutoPlayNext, channels, play]);


    // Fim da música (idempotente: depois dele a linha do tempo fica vazia e nada mais acontece).
    // Visto pelo rAF e, no palco novo, também pelo tique do Worker (janela em 2º plano segura o
    // rAF). A troca de música do AUTO segue por timer (exceção R-32). Devolve se a música acabou.
    const checkSongEnd = (): boolean => {
        const ctx = audioCtxRef.current;
        if (!ctx || playPendingRef.current || timelineRef.current.length === 0) return false;
        if (getPlaybackPosition(ctx) < duration) return false;
        setCurrentTime(duration);
        setIsPlaying(false);
        stopAllNodes();

        // Playback Mode logic: 'stop' e 'fade-out' param aqui, sem passar pra próxima.
        if (playbackMode !== 'continue') return true;

        // playbackMode === 'continue' (default)
        if (activeSongIndex < playlist.length - 1) {
            if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = window.setTimeout(() => {
                executeNextSong();
            }, 5000);
        }
        return true;
    };
    // A versão da renderização mais nova (duração, modo de fim e repertório), pro tique do Worker.
    const songEndRef = useRef<() => boolean>(() => false);
    useLayoutEffect(() => { songEndRef.current = checkSongEnd; });

    // Update time loop. O FADE não passa mais por aqui: é a rampa agendada no play (R-32).
    const updateTime = useCallback(() => {
        if (!audioCtxRef.current || !isPlaying) return;
        const elapsed = getPlaybackPosition(audioCtxRef.current);

        // Active Marker tracking
        if (playlist[activeSongIndex]?.markers) {
            const markers = playlist[activeSongIndex].markers!;
            let active = null;
            for (let i = markers.length - 1; i >= 0; i--) {
                if (elapsed >= markers[i].time) {
                    active = markers[i];
                    break;
                }
            }
            setCurrentMarker(active);
        }

        // === Seções do palco antigo: loop e salto pelo rAF, como na v1.4.16 (sem contagem) ===
        // No palco novo o agendador cuida disso no relógio do áudio; aqui só a seção ouvida.
        const songMarkers = playlist[activeSongIndex]?.markers;
        if (stageModeRef.current === 'novo') {
            setPlayingSpan(sectionIndexAt(spansRef.current, heardPosition()));
        } else if (songMarkers && songMarkers.length > 0) {
            // seekTo reinicia o playback via play(), mas NÃO reagenda o rAF (o
            // useEffect só reage a mudança de isPlaying, que aqui continua true).
            // Reagendamos manualmente após cada salto, senão o updateTime morre
            // e a repetição não se sustenta.
            const loopBackTo = (time: number) => {
                seekTo(time);
                animationRef.current = requestAnimationFrame(updateTime);
            };

            // Seção atual (última cujo início já passou).
            let curIdx = -1;
            for (let i = songMarkers.length - 1; i >= 0; i--) {
                if (elapsed >= songMarkers[i].time) { curIdx = i; break; }
            }

            // LOOP: compara com o fim FIXO da seção do loop. Recalcular a seção
            // a cada frame não funciona — quando o playhead alcança o próximo
            // marcador, a "seção atual" já avançou pra ele e a condição nunca bate.
            if (loopRef.current) {
                const li = loopRef.current.index;
                const loopEnd = li < songMarkers.length - 1 ? songMarkers[li + 1].time : duration;
                if (elapsed >= loopEnd) {
                    const rem = loopRef.current.remaining;
                    if (rem === 'infinite') {
                        loopBackTo(songMarkers[li].time);
                        return;
                    }
                    if (rem > 0) {
                        loopRef.current = { index: li, remaining: rem - 1 };
                        setActiveLoop({ index: li, remaining: rem - 1 });
                        loopBackTo(songMarkers[li].time);
                        return;
                    }
                    // Acabaram as repetições: desarma e segue normal.
                    loopRef.current = null;
                    setActiveLoop(null);
                }
            }

            // SALTO: dispara na primeira troca de seção depois de armado (= fim
            // da seção atual), comparando com a seção do frame anterior.
            if (jumpRef.current !== null && lastSectionRef.current >= 0 && curIdx !== lastSectionRef.current) {
                const target = jumpRef.current;
                jumpRef.current = null;
                setPendingJump(null);
                lastSectionRef.current = curIdx;
                loopBackTo(songMarkers[target].time);
                return;
            }
            lastSectionRef.current = curIdx;
        }

        if (songEndRef.current()) return;

        setCurrentTime(elapsed);
        animationRef.current = requestAnimationFrame(updateTime);
    }, [isPlaying, duration, activeSongIndex, playlist, seekTo, heardPosition]);

    useEffect(() => {
        if (isPlaying) {
            animationRef.current = requestAnimationFrame(updateTime);
        } else {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [isPlaying, updateTime]);

    // Load files
    // `meta.timeSignature`: compasso salvo na nuvem (songs.time_signature), vai pro Song.timeSignature.
    const loadFiles = async (files: FileList, overrideSongName?: string, coverImage?: string, songMarkers?: Marker[], overrideOriginalKey?: string | null, overrideBpm?: number, meta?: { artist?: string; lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null; sourceId?: string; timeSignature?: TimeSignature | null }) => {
        if (!audioCtxRef.current || !masterGainRef.current) return;
        const timeSignature = sanitizeTimeSignature(meta?.timeSignature) ?? undefined;
        setIsLoading(true);

        // try/finally garante que o loading sempre desligue: se qualquer decode
        // ou worklet falhar no meio, a UI não fica presa em "carregando".
        try {
        const filesArray = Array.from(files);

        // Pan gravado do arquivo novo: o knob no centro. O lado de Click, Guia e VS (e o
        // pan automático de "Tudo junto") sai só no panner, pelo papel (channelPanFor).
        const NEW_PAN = { pan: 0, bus: '1/2' as const };

        // Música baixada e já no cache? Então NÃO recebemos os blobs em memória:
        // carregamos lendo do cache 1 stem por vez (getCachedStem) no decode, e
        // o repertório referencia o cache (srcId/srcIdx) em vez de 2ª cópia.
        // Segurar todos os blobs + os buffers decodificados estourava o iPhone.
        const cacheSrcId = meta?.sourceId && await isSongCached(meta.sourceId)
            ? meta.sourceId
            : null;

        // Lista de stems a processar (sem decodificar ainda). file é opcional:
        // no modo cache-streaming os bytes vêm do cache no momento do decode.
        type Prep = { uuid: string; idx: number; pan: number; bus: '1' | '2' | '1/2'; name: string; file?: File };
        let prepared: Prep[];
        if (filesArray.length === 0 && cacheSrcId) {
            const names = (await getCachedStemNames(cacheSrcId)) || [];
            prepared = names.map((nm, idx) => {
                return { uuid: crypto.randomUUID(), idx, ...NEW_PAN, name: nm.replace(/\.[^/.]+$/, "") };
            });
        } else {
            prepared = filesArray.map((file, idx) => {
                return { uuid: crypto.randomUUID(), idx, ...NEW_PAN, name: file.name.replace(/\.[^/.]+$/, ""), file };
            });
        }
        if (prepared.length === 0) {
            console.error('loadFiles: nada a carregar (sem arquivos e sem cache).');
            return;
        }

        // Nome da música (folder/override/primeiro arquivo).
        let songName = overrideSongName;
        if (!songName) {
            const first = filesArray[0];
            const pathParts = first?.webkitRelativePath ? first.webkitRelativePath.split('/') : [];
            songName = pathParts.length > 1 ? pathParts[0] : (first?.name.split('-')[0] || `Música ${playlist.length + 1}`);
        }

        const newSongId = crypto.randomUUID();

        // PERSISTE ANTES DO DECODE, POR STEM. No celular, decodificar todos os
        // stems de uma vez segura ~1GB de AudioBuffer e a aba estoura a memória: o
        // SO recarrega a página e a música sumia do repertório, porque o save só
        // acontecia DEPOIS do decode E num write monolítico (o Map inteiro) que
        // por si só já dava pico. Gravando cada stem numa chave própria + o meta
        // ANTES do decode, a música sobrevive ao reload (igual ao cache offline) e
        // é decodificada na inicialização. Arquivos primeiro, meta depois: se o
        // meta referencia um stem, o stem já está no disco. duration/tom saem
        // definitivos após o decode (a restauração recalcula a duration provisória).
        // Arquivos locais (não vieram da nuvem) ou cache indisponível: o
        // repertório guarda sua própria cópia por stem. Se veio do cache
        // offline (cacheSrcId), reusa sem 2ª cópia.
        if (!cacheSrcId) {
            for (const p of prepared) {
                await set(fileKey(p.uuid), p.file);
            }
        }
        const existingMeta = await get<SavedSong[]>(DB_KEY_META) || [];
        const preliminarySaved: SavedSong = {
            id: newSongId,
            sourceId: meta?.sourceId,
            name: songName,
            coverImage,
            channelOrder: 'auto',
            schemaVersion: REPERTOIRE_SCHEMA_VERSION,
            duration: 0,
            channels: prepared.map((p) => ({
                id: p.uuid, name: p.name, volume: 1, muted: false, soloed: false, pan: p.pan, bus: p.bus,
                srcId: cacheSrcId ?? undefined, srcIdx: cacheSrcId ? p.idx : undefined
            })),
            pitch: 0,
            originalKey: overrideOriginalKey ?? null,
            bpm: overrideBpm,
            artist: meta?.artist,
            markers: songMarkers,
            lyrics: meta?.lyrics ?? null,
            lyricsSynced: meta?.lyricsSynced ?? null,
            chords: meta?.chords ?? null,
            timeSignature
        };
        await set(DB_KEY_META, [...existingMeta, preliminarySaved]);

        const results: (Channel | null)[] = [];
        // Use small batches on touch devices to keep peak memory low.
        // Each concurrent decode holds an ArrayBuffer + the resulting AudioBuffer
        // simultaneously — on phones with 4-6 stems this can OOM the tab.
        const isTouch = typeof window !== 'undefined'
            && window.matchMedia
            && window.matchMedia('(pointer: coarse)').matches;
        const BATCH_SIZE = isTouch ? 1 : 4;

        for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
            const batch = prepared.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (p) => {
                if (!audioCtxRef.current || !masterGainRef.current) return null;

                let audioBuffer: AudioBuffer;
                try {
                    // Bytes vêm da memória (import local) OU do cache 1 por vez
                    // (música baixada). srcFile sai de escopo após o decode, então
                    // só 1 blob fica vivo por vez — não todos juntos.
                    const srcFile = p.file ?? (cacheSrcId ? await getCachedStem(cacheSrcId, p.idx) : null);
                    if (!srcFile) {
                        console.error(`Sem fonte para o stem ${p.idx} (${p.name})`);
                        return null;
                    }
                    const arrayBuffer = await srcFile.arrayBuffer();
                    audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
                } catch (e) {
                    console.error(`Failed to decode ${p.name}`, e);
                    return null;
                }

                const graph = graphRef.current;
                const cuts = routeCutsRef.current;
                if (!graph || !cuts) return null;
                const panner = audioCtxRef.current.createStereoPanner();
                setupPannerForBuffer(panner, audioBuffer);
                const gain = audioCtxRef.current.createGain();

                gain.gain.value = 1;

                panner.connect(gain);
                // Fader no barramento do papel (pelo nome do canal, como o Channel abaixo).
                connectChannel(cuts, graph, { id: p.uuid, name: p.name, pan: p.pan }, panner, gain);

                // Não retém o blob (file) na memória viva: já está persistido
                // (cache offline ou per-stem) e é relido só p/ export. Segurar
                // file + buffer ao mesmo tempo dobrava a RAM no iPhone.
                return {
                    id: p.uuid,
                    name: p.name,
                    buffer: audioBuffer,
                    srcId: cacheSrcId ?? undefined,
                    srcIdx: cacheSrcId ? p.idx : undefined,
                    gainNode: gain,
                    pannerNode: panner,
                    sourceNode: null,
                    volume: 1,
                    muted: false,
                    soloed: false,
                    pan: p.pan,
                    bus: p.bus
                } as Channel;
            });
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }
        const newChannels: Channel[] = results.filter((ch): ch is Channel => ch !== null);

        // Se NADA decodificou (arquivos corrompidos ou cache offline quebrado),
        // desfaz o registro provisório (arquivos + meta) pra não deixar uma música
        // fantasma (00:00, mixer sem canais) no repertório persistido. O finally
        // desliga o loading. Vale pro caso da Estações com cache incompleto.
        if (newChannels.length === 0) {
            console.error('loadFiles: nenhuma faixa decodificou — música não adicionada.');
            const revertMeta = await get<SavedSong[]>(DB_KEY_META) || [];
            await set(DB_KEY_META, revertMeta.filter((s) => s.id !== newSongId));
            await Promise.all(prepared.map((p) => del(fileKey(p.uuid))));
            return;
        }

        let maxDuration = 0;
        newChannels.forEach(ch => {
            if (ch.buffer.duration > maxDuration) maxDuration = ch.buffer.duration;
        });

        const mainChannel = pickMainChannel(newChannels);
        const originalKey = overrideOriginalKey !== undefined
            ? overrideOriginalKey
            : (mainChannel ? detectKey(mainChannel.buffer) : null);

        const bpm = overrideBpm !== undefined ? overrideBpm : undefined;

        // Música nova entra na ordem padrão (automática) até o usuário arrastar.
        const newSong: Song = {
            id: newSongId,
            sourceId: meta?.sourceId,
            name: songName,
            coverImage: coverImage,
            channels: arrangeChannels(newChannels, 'auto'),
            channelOrder: 'auto',
            duration: maxDuration,
            pitch: 0,
            originalKey,
            bpm,
            markers: songMarkers || undefined,
            artist: meta?.artist,
            lyrics: meta?.lyrics ?? null,
            lyricsSynced: meta?.lyricsSynced ?? null,
            chords: meta?.chords ?? null,
            timeSignature
        };

        // Sobre o repertório mais novo, não o de quando o carregamento começou: a fila da grade
        // pode ter mexido em outra música enquanto este decodificava (o click gerado dela).
        const current = playlistRef.current;
        const newPlaylist = [...current, newSong];
        if (current.length === 0) {
            setDuration(maxDuration);
            setActiveSongIndex(0);
            setCurrentTime(0);
        }
        // A fila da grade (abaixo) já acha a música nova, antes da renderização.
        playlistRef.current = newPlaylist;
        updatePlaylistAndSave(newPlaylist);
        // Grade (T27): a leitura do click (e, sem click, o click gerado) entra na fila, que só
        // anda com a VS parada e depois deste carregamento: nada pesado aqui nem no play.
        gridReadSeenRef.current.add(newSongId);
        gridGenSeenRef.current.add(newSongId);
        scheduleSongGrid(newSong, { read: true, generate: true });
        } finally {
            setIsLoading(false);
        }
    };

    const createEndlessMetronomeSong = async (bpm: number) => {
        if (!audioCtxRef.current || !masterGainRef.current || !graphRef.current || !routeCutsRef.current) return;
        const graph = graphRef.current;
        const cuts = routeCutsRef.current;
        setIsLoading(true);

        try {
            const { type, subdivision } = loadClickSelection();
            const { clickBlob } = await generateEndlessClickTrackFromSample(type, subdivision, bpm);
            const file = new File([clickBlob], 'Metronomo Loop.wav', { type: 'audio/wav' });

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            setupPannerForBuffer(panner, audioBuffer);
            const gain = audioCtxRef.current.createGain();

            // O loop é Click pela regra central: o fader vai pro barramento do Click e o
            // panner pro lado dele; o pan gravado é o knob no centro.
            gain.gain.value = 1;

            const uuid = crypto.randomUUID();
            panner.connect(gain);
            connectChannel(cuts, graph, { id: uuid, name: 'Metronomo Loop', pan: 0 }, panner, gain);

            await set(fileKey(uuid), file);

            const newChannel: Channel = {
                id: uuid,
                name: 'Metronomo Loop',
                buffer: audioBuffer,
                file: file,
                gainNode: gain,
                pannerNode: panner,
                sourceNode: null,
                volume: 1,
                muted: false,
                soloed: false,
                pan: 0,
                bus: '1/2'
            };

            const newSong: Song = {
                id: crypto.randomUUID(),
                name: `Metrônomo ${bpm} BPM`,
                coverImage: '',
                channels: [newChannel],
                channelOrder: 'auto',
                duration: 36000, // 10 horas de duração para simular "infinito"
                pitch: 0,
                originalKey: null,
                bpm: bpm,
            };

            const newPlaylist = [...playlist, newSong];
            if (playlist.length === 0) {
                setDuration(36000);
                setActiveSongIndex(0);
                setCurrentTime(0);
            }
            updatePlaylistAndSave(newPlaylist);
        } catch (e) {
            console.error("Erro ao criar metrônomo infinito", e);
        } finally {
            setIsLoading(false);
        }
    };

    // Canal novo na música que está tocando (causa 9 do relatório; o click gerado da T27 entra
    // do mesmo jeito): ganha uma voz já, na posição daquele instante, sem reiniciar os outros;
    // na pré-contagem entra junto com as outras vozes. Precisando de worklet (tom diferente de 0
    // e canal que transpõe), espera ele nascer e entra na posição de quando nasceu. Reinicia no
    // ponto, com a lista nova, em dois casos: play pendente (ele tem a lista antiga) e primeiro
    // canal transposto de uma música que tocava sem compensação (só Click e Guia), pra todos
    // saírem com o mesmo atraso. Parado: nada a fazer (o próximo play já inclui o canal).
    const addLiveVoice = async (ch: Channel, list: Channel[], songId: string): Promise<void> => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        if (playPendingRef.current) {
            restartAfterMetaRef.current = true;
            return;
        }
        const chain = playChainRef.current;
        if (!chain || chain.songId !== songId || voicesRef.current.length === 0) return;
        const transposes = chain.pitch !== 0 && !isPitchExempt(ch);
        if (transposes && chain.compensation === null) {
            restartAfterMetaRef.current = true;
            return;
        }
        const gen = playGenRef.current;
        if (transposes && !pitchSlotsRef.current.has(ch.id)) {
            await ensurePitchSlot(ctx, ch);
            // Pausa, busca ou outro play no meio da espera: o play novo já tem o canal.
            if (gen !== playGenRef.current || playChainRef.current !== chain) return;
        }
        ch.gainNode.gain.setValueAtTime(channelGain(ch, list), ctx.currentTime);
        // Palco novo: as vozes do pulo marcado são as de quando ele foi marcado. Canal novo no meio
        // desfaz (ou fecha o pouso) e o agendador marca de novo com ele (Aviso T17).
        if (stageModeRef.current === 'novo') sectionSchedulerRef.current?.reset();
        const entry = entryFor(ch, chain.pitch, chain.compensation);
        const first = timelineRef.current[0];
        const at = Math.max(nextRenderQuantum(ctx, START_LEAD_QUANTA), first?.ctxStart ?? 0);
        const voice = startVoice(ctx, { channelId: ch.id, buffer: ch.buffer, entry, loop: isEndlessLoop(ch) }, at, positionAt(timelineRef.current, at, timeStretch), timeStretch);
        voiceStartsRef.current.set(voice, at);
        voicesRef.current = [...voicesRef.current, voice];
        ch.sourceNode = voice.source;
        playChainRef.current = { ...chain, channels: [...chain.channels, ch] };
        sectionTick();
    };

    // Troca uma música do repertório fora da renderização (depois de um await), a partir da lista
    // mais nova, e grava. Devolve a música nova, ou null se ela saiu do repertório.
    const patchSong = (songId: string, patch: (song: Song) => Song): Song | null => {
        const list = playlistRef.current;
        const i = list.findIndex((s) => s.id === songId);
        if (i < 0) return null;
        const updated = patch(list[i]);
        const next = [...list];
        next[i] = updated;
        playlistRef.current = next;
        updatePlaylistAndSave(next);
        return updated;
    };

    // Canal novo numa música do repertório, ativa ou não (o "adicionar canal" da música ativa e o
    // click gerado da T27): o arquivo fica gravado por stem (não fica na memória viva: o export
    // relê do disco) e, tocando, o canal entra já pelo addLiveVoice. Devolve o canal, ou null se
    // a música saiu do repertório no meio.
    const appendChannelToSong = async (songId: string, file: File): Promise<Channel | null> => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        const cuts = routeCutsRef.current;
        if (!ctx || !graph || !cuts || !playlistRef.current.some((s) => s.id === songId)) return null;
        const audioBuffer = await ctx.decodeAudioData(await file.arrayBuffer());

        const panner = ctx.createStereoPanner();
        setupPannerForBuffer(panner, audioBuffer);
        const gain = ctx.createGain();

        // Regra central: o fader vai pro barramento do papel e o panner pro lado dele; o
        // pan gravado é o knob no centro.
        const panValue = 0;
        const uuid = crypto.randomUUID();
        const channelName = file.name.replace(/\.[^/.]+$/, '');

        gain.gain.value = 1;

        panner.connect(gain);
        connectChannel(cuts, graph, { id: uuid, name: channelName, pan: panValue }, panner, gain);

        await set(fileKey(uuid), file);

        const newChannel: Channel = {
            id: uuid,
            name: channelName,
            buffer: audioBuffer,
            gainNode: gain,
            pannerNode: panner,
            sourceNode: null,
            volume: 1,
            muted: false,
            soloed: false,
            pan: panValue,
            bus: '1/2'
        };

        let grew = false;
        // Ordem automática encaixa o canal novo na ordem padrão; manual põe no fim.
        const song = patchSong(songId, (s) => {
            grew = audioBuffer.duration > s.duration;
            return { ...s, channels: arrangeChannels([...s.channels, newChannel], s.channelOrder), duration: grew ? audioBuffer.duration : s.duration };
        });
        if (!song) {
            // A música saiu do repertório enquanto o arquivo gravava: nada dele fica no grafo nem no disco.
            gain.disconnect();
            panner.disconnect();
            await del(fileKey(uuid));
            return null;
        }
        if (grew && activeSongIdRef.current === songId) setDuration(song.duration);
        // Tocando: entra já, na posição de agora.
        await addLiveVoice(newChannel, song.channels, song.id);
        return newChannel;
    };

    const addChannelToActiveSong = async (file: File) => {
        const active = playlist[activeSongIndex];
        if (!audioCtxRef.current || !masterGainRef.current || !graphRef.current || !routeCutsRef.current || !active) return;
        setIsLoading(true);

        try {
            const added = await appendChannelToSong(active.id, file);
            // Click que entra numa música sem grade de click (o "Inserir click" do Metrônomo): a
            // grade é lida dele, na fila (com a VS tocando, espera a parada).
            const song = added && resolveChannelRole(added) === 'click' ? playlistRef.current.find((s) => s.id === active.id) : undefined;
            if (song) scheduleSongGrid(song, { read: true, generate: false });
        } catch (e) {
            console.error('Failed to add channel to active song:', e);
        } finally {
            setIsLoading(false);
        }
    };

    // === Grade da música (T27) ===
    // A leitura fica fora do caminho do play: cada música que precisa (carregada agora, ficou
    // ativa sem grade de click, ganhou um canal de click ou pediu "Ler o click de novo") entra
    // numa fila, que só começa um pedido com a VS parada (nada agendado, nenhum play pendente
    // nem contagem esperando). A conta pesada (a leitura do click e o plano do click que falta)
    // roda no Worker da grade (Ruling T27-worker): um play no meio dela começa na hora. Na
    // thread principal ficam só a cópia das amostras pro Worker (canal por canal, cedendo a
    // tela entre eles e desistindo se a VS for tocar) e o WAV do click gerado (só parado). Sem
    // Worker (ausente ou quebrado) a grade não é lida sozinha, nunca na thread principal; fica
    // a do BPM salvo e o Metrônomo, a pedido. Sem geração em lote: só a música carregada ou que
    // ficou ativa.
    const gridJobsRef = useRef(new Map<string, GridJob>());
    const [gridPending, setGridPending] = useState<readonly string[]>([]);
    const gridRunningRef = useRef(false);
    // Músicas que já entraram na fila nesta sessão: ficar ativa de novo não lê outra vez, e o
    // click gerado é tentado uma vez por música.
    const gridReadSeenRef = useRef(new Set<string>());
    const gridGenSeenRef = useRef(new Set<string>());
    const lastActiveIdRef = useRef<string | null>(null);

    // Worker da grade: nasce no primeiro pedido e fica até o motor sair de cena. 'sem-worker' =
    // não nasceu ou quebrou: a leitura automática para de vez nesta sessão.
    const gridWorkerRef = useRef<GridWorkerLink | 'sem-worker' | null>(null);
    const gridWorkerUsable = () => gridWorkerRef.current !== 'sem-worker' && typeof Worker !== 'undefined';
    // Encerra o Worker e responde nulo a quem esperava (aquela leitura desiste, sem mexer na grade).
    const dropGridWorker = (link: GridWorkerLink, why: unknown) => {
        if (gridWorkerRef.current === link) gridWorkerRef.current = 'sem-worker';
        link.worker.terminate();
        const waiting = [...link.calls.values()];
        link.calls.clear();
        waiting.forEach((done) => done(null));
        console.error('[grade] o Worker da grade parou: a grade não é mais lida sozinha nesta sessão', why);
    };
    const gridWorkerLink = (): GridWorkerLink | null => {
        const current = gridWorkerRef.current;
        if (current === 'sem-worker') return null;
        if (current) return current;
        try {
            if (typeof GridWorker !== 'function') throw new Error('pacote sem o Worker da grade');
            const link: GridWorkerLink = { worker: new GridWorker({ name: 'grade-da-musica' }), calls: new Map(), next: 1 };
            link.worker.onmessage = (e: MessageEvent<GridWorkerResponse>) => {
                const done = link.calls.get(e.data.id);
                link.calls.delete(e.data.id);
                done?.(e.data);
            };
            link.worker.onerror = (e) => dropGridWorker(link, e);
            link.worker.onmessageerror = (e) => dropGridWorker(link, e);
            gridWorkerRef.current = link;
            return link;
        } catch (e) {
            gridWorkerRef.current = 'sem-worker';
            console.error('[grade] sem o Worker da grade: a grade não é lida sozinha (fica a do BPM salvo e o Metrônomo)', e);
            return null;
        }
    };
    // Um pedido ao Worker, com as amostras transferidas (o motor já mandou cópias). Nulo = sem Worker.
    const askGridWorker = (task: GridWorkerTask, transfer: Transferable[]): Promise<GridWorkerResponse | null> => {
        const link = gridWorkerLink();
        if (!link) return Promise.resolve(null);
        return new Promise((resolve) => {
            const id = link.next++;
            const timer = setTimeout(() => dropGridWorker(link, new Error('sem resposta')), GRID_WORKER_TIMEOUT_MS);
            link.calls.set(id, (r) => { clearTimeout(timer); resolve(r); });
            try {
                link.worker.postMessage({ ...task, id }, transfer);
            } catch (e) {
                dropGridWorker(link, e);
            }
        });
    };
    useEffect(() => () => {
        const link = gridWorkerRef.current;
        gridWorkerRef.current = null;
        if (link && link !== 'sem-worker') {
            link.worker.terminate();
            const waiting = [...link.calls.values()];
            link.calls.clear();
            waiting.forEach((done) => done(null));
        }
    }, []);

    // A VS toca ou vai tocar: algo agendado no relógio, play pendente ou contagem esperando a troca de papel.
    const engineBusy = () => playPendingRef.current || recountQueuedRef.current || timelineRef.current.length > 0;
    // A próxima música vai entrar sozinha (AUTO, 5 s depois do fim; ou o fade da "próxima").
    const nextSongPending = () => autoNextTimeoutRef.current !== null || nextSongTimerRef.current !== null;
    // Cópia das amostras pro Worker (o original continua no AudioBuffer que toca), em pedaços e
    // cedendo a thread antes de cada um: a tela e o play passam entre eles. Null se a VS for
    // tocar no meio (a leitura recomeça na próxima parada).
    const copyForGridWorker = async (src: Float32Array): Promise<Float32Array | null> => {
        const out = new Float32Array(src.length);
        for (let i = 0; i < src.length; i += GRID_COPY_CHUNK) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (engineBusy()) return null;
            out.set(src.subarray(i, Math.min(src.length, i + GRID_COPY_CHUNK)), i);
        }
        return out;
    };

    const enqueueGridJob = (songId: string, want: { read: boolean; generate: boolean }): Promise<void> => new Promise((resolve) => {
        const job = gridJobsRef.current.get(songId) ?? { read: false, generate: false, done: [] };
        job.read ||= want.read;
        job.generate ||= want.generate;
        job.done.push(resolve);
        gridJobsRef.current.set(songId, job);
        setGridPending([...gridJobsRef.current.keys()]);
        kickGridJobs();
    });
    const finishGridJob = (songId: string) => {
        const job = gridJobsRef.current.get(songId);
        gridJobsRef.current.delete(songId);
        setGridPending([...gridJobsRef.current.keys()]);
        job?.done.forEach((resolve) => resolve());
    };

    // A música precisa do click gerado: não tem canal de Click, nem grade de click salva, nem um
    // click apagado pelo usuário (manual vence automático). A grade de click fica quando o usuário
    // apaga um click que deu grade; o `clickRemoved` cobre o click dele que nunca deu grade, que
    // senão voltaria como gerado na sessão seguinte (Ruling X1-critical, adiado da T27).
    const wantsGeneratedClick = (song: Song) => !findClickChannel(song.channels) && sanitizeGrid(song.grid)?.source !== 'click' && !song.clickRemoved;
    // O click gerado só nasce no palco novo e com rota própria pro Click, no plano ligado agora e
    // no que a troca na fila vai ligar (Ruling X1-critical): no palco antigo só o Metrônomo gera,
    // a pedido; em "Tudo junto" e na saída de 1 canal ele iria pro PA.
    const generatedClickRoutable = (): boolean => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return false;
        const wanted = planOutputs(outputsRef.current, deviceChannels(ctx));
        return clickHasOwnRoute(graph.plan, autoPanRef.current) && clickHasOwnRoute(wanted, autoPanRef.current);
    };
    const mayGenerateClick = () => autoClickRef.current && stageModeRef.current === 'novo' && generatedClickRoutable();

    // Põe a música na fila: lê o click quando ainda não há grade de click e há um canal de Click
    // com áudio; gera o click que falta só com `generate` (carregada agora, ou ficou ativa com a
    // VS parada), no plano que pode, sem canal de Click e sem grade de click salva.
    const scheduleSongGrid = (song: Song, want: { read: boolean; generate: boolean }) => {
        // Sem Worker, nada é lido sozinho (nunca na thread principal).
        if (!gridWorkerUsable()) return;
        const hasClickGrid = sanitizeGrid(song.grid)?.source === 'click';
        const read = want.read && !hasClickGrid && clickChannelsOf(song).some((ch) => readableClick(ch.buffer) !== null);
        const generate = want.generate && mayGenerateClick() && wantsGeneratedClick(song);
        if (read || generate) void enqueueGridJob(song.id, { read, generate });
    };

    // Passos 1 e 3: lê cada canal de Click até um dar grade (o "Click - No Drums" do Morada dá
    // nulo); sem nenhum, vale a grade do BPM salvo (songGridOf). O compasso escolhido no EDITAR
    // fica (keepManualMeter, depois do sanitizeGrid). A leitura é no Worker; aqui só a cópia do
    // canal 0 (transferida). 'espera' = a VS vai tocar antes de mandar o próximo canal (o que já
    // está no Worker termina lá e o resultado vale, mesmo tocando: aplicar é barato).
    const readSongGrid = async (songId: string): Promise<'feita' | 'espera'> => {
        const song = playlistRef.current.find((s) => s.id === songId);
        if (!song) return 'feita';
        const before = sanitizeGrid(song.grid);
        const clicks = clickChannelsOf(song);
        // Sem canal de Click, nada a ler: a grade fica como está (a de um click que o usuário
        // apagou continua, e o click gerado não volta; ver wantsGeneratedClick).
        if (clicks.length === 0) return 'feita';
        // O click que o motor gerou já nasce com a grade dele (gridFromAutoClick): ler de novo só pioraria.
        if (before?.source === 'click' && clicks.some((ch) => ch.name === GENERATED_CLICK_NAME)) return 'feita';
        const known = before?.meterSource === 'manual' ? before.signature : sanitizeTimeSignature(song.timeSignature);
        const bpm = typeof song.bpm === 'number' && Number.isFinite(song.bpm) ? song.bpm : null;
        let found: ReadGrid | null = null;
        let analyzed = 0;
        for (const ch of clicks) {
            const samples = readableClick(ch.buffer);
            if (!samples) continue;
            if (analyzed++ > 0) await new Promise((resolve) => setTimeout(resolve, GRID_YIELD_MS));
            if (engineBusy()) return 'espera';
            // A cópia vai embora (transferida); o original continua no AudioBuffer que toca.
            const copy = await copyForGridWorker(samples);
            if (!copy) return 'espera';
            const resp = await askGridWorker({ kind: 'click', samples: copy, sampleRate: ch.buffer.sampleRate, known, bpm }, [copy.buffer]);
            // Sem Worker: desiste sem mexer na grade (nunca lê aqui).
            if (!resp) return 'feita';
            if (resp.kind === 'erro') console.error(`[grade] leitura do click "${ch.name}" falhou: ${resp.message}`);
            const a: ClickAnalysis | null = resp.kind === 'click' ? resp.analysis : null;
            found = a ? gridFromReading(withLead(a, generatedClickLead(ch)), known, song.markers) : null;
            if (found) break;
        }
        const latest = playlistRef.current.find((s) => s.id === songId);
        if (!latest) return 'feita';
        // O compasso pode ter sido escolhido enquanto lia: vale o de agora.
        const prev = sanitizeGrid(latest.grid);
        const next = found
            ? sanitizeGrid(keepManualMeter(found.grid, prev)) ?? undefined
            : prev?.meterSource === 'manual' ? { ...prev, source: 'bpm' as const } : undefined;
        // O 1 não provado vai junto da grade, salvo no repertório (Ruling T27-campo).
        const downbeatAssumed = found?.oneAssumed ? true : undefined;
        if (!sameGrid(next, prev) || latest.downbeatAssumed !== downbeatAssumed) patchSong(songId, (s) => ({ ...s, grid: next, downbeatAssumed }));
        return 'feita';
    };

    // Passo 2: o click que falta, pelo fluxo do Metrônomo (M7), com o BPM salvo como referência
    // e o compasso conhecido. Sem plano bom, ou com o tempo em dúvida, não gera (a música fica
    // como hoje). O plano (planAutoClick) é feito no Worker, com cópias só das faixas que ele lê
    // (tempoChannelsForPlan: o mesmo plano que com a música inteira). O WAV do click só sai com
    // a VS parada: plano que volta com ela tocando fica guardado no pedido ('espera') e o click
    // é feito na próxima parada. O canal entra pelo addLiveVoice se a VS já estiver tocando.
    const generateMissingClick = async (songId: string, job: GridJob): Promise<'feita' | 'espera'> => {
        const song = playlistRef.current.find((s) => s.id === songId);
        if (!song || !mayGenerateClick() || !wantsGeneratedClick(song)) return 'feita';
        const before = sanitizeGrid(song.grid);
        const signature = (before?.meterSource === 'manual' ? before.signature : sanitizeTimeSignature(song.timeSignature)) ?? undefined;
        let plan = job.plan;
        if (!plan) {
            const picked = tempoChannelsForPlan(song.channels);
            // Sem bateria, percussão nem baixo: o "sem-faixa" do planAutoClick, sem acordar o Worker.
            if (picked.length === 0) return 'feita';
            const sent: GridWorkerChannel[] = [];
            for (const ch of picked) {
                const data: Float32Array[] = [];
                for (let c = 0; c < ch.buffer.numberOfChannels; c++) {
                    // A VS vai tocar no meio: desiste das cópias (refaz na parada).
                    const copy = await copyForGridWorker(ch.buffer.getChannelData(c));
                    if (!copy) return 'espera';
                    data.push(copy);
                }
                sent.push({ id: ch.id, name: ch.name, customName: ch.customName, role: ch.role, sampleRate: ch.buffer.sampleRate, data });
            }
            const resp = await askGridWorker({ kind: 'plano', channels: sent, songBpm: song.bpm, signature }, sent.flatMap((ch) => ch.data.map((d) => d.buffer)));
            if (!resp) return 'feita';
            if (resp.kind === 'erro') console.error(`[grade] o plano do click que falta falhou: ${resp.message}`);
            if (resp.kind !== 'plano' || !resp.plan.ok || autoClickChecks(resp.plan.detection).some((c) => AUTO_CLICK_BLOCKERS.has(c))) return 'feita';
            plan = resp.plan;
            if (engineBusy()) {
                job.plan = plan;
                return 'espera';
            }
        }
        const made = gridFromAutoClick(plan, signature !== undefined);
        if (!made) return 'feita';
        const blob = await renderAutoClick(plan, song.duration, loadClickSelection());
        // O usuário pôs um click (ou ele ganhou grade) enquanto o plano e o WAV saíam: o dele vence.
        // E a saída ou o palco podem ter mudado nesse meio tempo: sem rota própria, nada entra.
        const latest = playlistRef.current.find((s) => s.id === songId);
        if (!latest || !wantsGeneratedClick(latest) || !mayGenerateClick()) return 'feita';
        const added = await appendChannelToSong(songId, new File([blob], `${GENERATED_CLICK_NAME}.wav`, { type: 'audio/wav' }));
        if (!added) return 'feita';
        // A saída virou "Tudo junto" durante a leitura do WAV: ele entra mudo.
        muteGeneratedRef.current();
        patchSong(songId, (s) => ({
            ...s, grid: sanitizeGrid(keepManualMeter(made.grid, sanitizeGrid(s.grid))) ?? undefined, downbeatAssumed: made.oneAssumed ? true : undefined,
        }));
        return 'feita';
    };

    // Os passos da renderização mais nova: a fila pode ter começado a andar numa renderização
    // antiga (a restauração, um carregamento) e cada pedido usa o motor de agora (como o playRef).
    const gridStepsRef = useRef({ read: readSongGrid, generate: generateMissingClick });
    useEffect(() => { gridStepsRef.current = { read: readSongGrid, generate: generateMissingClick }; });

    // Próximo pedido que pode andar agora, na ordem de chegada: o click gerado (até uns 4 s) não
    // anda com a próxima música do AUTO pra entrar, pra não atrasar a entrada dela; a leitura
    // do click (até 450 ms) anda, e chega a tempo de a próxima tocar com a grade dela.
    const nextGridJob = (): [string, GridJob] | null => {
        for (const entry of gridJobsRef.current) if (!entry[1].generate || !nextSongPending()) return entry;
        return null;
    };

    // Anda a fila enquanto a VS está parada. 'vazia' = acabou; 'espera' = a VS vai tocar (ou só
    // sobrou click gerado esperando a próxima música entrar).
    const runGridJobs = async (): Promise<'vazia' | 'espera'> => {
        for (;;) {
            if (gridJobsRef.current.size === 0) return 'vazia';
            const head = nextGridJob();
            if (!head) return 'espera';
            const [songId, job] = head;
            if (!playlistRef.current.some((s) => s.id === songId)) {
                finishGridJob(songId);
                continue;
            }
            // Cede a tela (o "lendo a grade" aparece) antes de começar.
            await new Promise((resolve) => setTimeout(resolve, GRID_YIELD_MS));
            if (engineBusy()) return 'espera';
            if (job.generate && nextSongPending()) continue;
            try {
                if (job.generate) {
                    if (await gridStepsRef.current.generate(songId, job) === 'espera') return 'espera';
                    job.generate = false;
                    job.plan = undefined;
                }
                if (job.read) {
                    if (await gridStepsRef.current.read(songId) === 'espera') return 'espera';
                    job.read = false;
                }
            } catch (e) {
                console.error('[grade] a grade da música não foi lida', e);
            }
            finishGridJob(songId);
            // Worker quebrou no meio: o resto da fila desiste (nada é lido na thread principal).
            if (!gridWorkerUsable()) {
                for (const id of [...gridJobsRef.current.keys()]) finishGridJob(id);
                return 'vazia';
            }
        }
    };
    // Põe a fila pra andar (um corredor só). Chamado ao pedir e quando a VS para; quem decide se
    // dá pra ler é o próprio corredor, pelo engineBusy depois de ceder a tela.
    const kickGridJobs = () => {
        if (gridRunningRef.current || gridJobsRef.current.size === 0) return;
        gridRunningRef.current = true;
        void runGridJobs().then((outcome) => {
            gridRunningRef.current = false;
            // Pedido que chegou entre o fim da fila e aqui: anda de novo.
            if (outcome === 'vazia') kickGridJobs();
        });
    };
    useEffect(() => {
        if (!isPlaying && gridPending.length > 0) kickGridJobs();
    }, [isPlaying, gridPending]);

    // Música que fica ativa: lê o click se ainda não leu nesta sessão; gera o click que falta só
    // se ela ficou ativa com a VS parada ("nunca tocando": a troca de música tocando, inclusive a
    // do AUTO, não gera, nem depois de parar).
    useEffect(() => {
        if (!activeSong || activeSong.id === lastActiveIdRef.current) return;
        lastActiveIdRef.current = activeSong.id;
        const stopped = !isPlaying && !shouldAutoPlayNext && !engineBusy();
        const read = !gridReadSeenRef.current.has(activeSong.id);
        const generate = stopped && !gridGenSeenRef.current.has(activeSong.id);
        if (read) gridReadSeenRef.current.add(activeSong.id);
        if (generate) gridGenSeenRef.current.add(activeSong.id);
        if (read || generate) scheduleSongGrid(activeSong, { read, generate });
    }, [activeSong, isPlaying, shouldAutoPlayNext]);

    // Compasso escolhido no modo EDITAR (manual vence automático): BPM e fase continuam os da grade
    // que vale; fica salvo no repertório e "Ler o click de novo" mantém. Sem grade, nada a escolher.
    const setSongMeter = (songId: string, sig: TimeSignature, countEvery: 1 | 3) => {
        const song = playlistRef.current.find((s) => s.id === songId);
        const base = song ? songGridOf(song) : null;
        const next = base ? sanitizeGrid(withMeter(base, sig, countEvery)) : null;
        if (next) patchSong(songId, (s) => ({ ...s, grid: next }));
    };

    // "Ler o click de novo": refaz os passos 1 e 3 e mantém o compasso escolhido. Pela fila: com a
    // VS tocando, a leitura (e a promessa) espera a parada.
    const redetectSongGrid = async (songId: string): Promise<void> => {
        // Sem Worker não lê (nunca na thread principal): fica a grade de agora.
        if (!gridWorkerUsable() || !playlistRef.current.some((s) => s.id === songId)) return;
        await enqueueGridJob(songId, { read: true, generate: false });
    };

    // Aviso âmbar da grade da música ativa; o 1 assumido avisa também com o compasso escolhido.
    const songGridWarning: GridWarning | null = !activeSong ? null
        : gridWarning(activeGrid) ?? (activeGrid?.source === 'click' && activeSong.downbeatAssumed ? 'compasso-assumido' : null);
    const isReadingGrid = !!activeSongId && gridPending.includes(activeSongId);

    // Update markers on a song
    const setSongMarkers = (songId: string, markers: Marker[]) => {
        const newPlaylist = playlist.map(s => s.id === songId ? { ...s, markers } : s);
        updatePlaylistAndSave(newPlaylist);
    };

    // Fase 4: letra/cifra por música (documento corrido). Atualiza o estado local
    // e persiste no IndexedDB; a sincronização na nuvem é feita no App via updateSong.
    const setSongLyrics = (songId: string, data: { lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null }) => {
        const newPlaylist = playlist.map(s => s.id === songId ? { ...s, ...data } : s);
        updatePlaylistAndSave(newPlaylist);
    };

    // Ressincroniza no repertório (e no ao vivo, via estado/follower) a música
    // editada na biblioteca, mesmo já estando baixada. Casa pelo sourceId (id da
    // nuvem) ou, p/ itens antigos sem sourceId, pelo nome completo anterior.
    // Atualiza só os campos informados (nome, artista, tom, bpm, capa).
    const syncSongMeta = (opts: {
        sourceId?: string;
        prevName?: string;
        prevBpm?: number;
        prevOriginalKey?: string | null;
        name?: string;
        artist?: string;
        originalKey?: string | null;
        bpm?: number;
        coverImage?: string;
    }) => {
        let changed = false;
        const newPlaylist = playlist.map(s => {
            // Match por sourceId é exato. Para itens antigos (sem sourceId) caímos
            // no nome anterior — mas reforçado com bpm+tom anteriores p/ desempatar
            // músicas de nome idêntico: só colide quem tem nome+bpm+tom iguais, e
            // nesse caso é efetivamente a mesma música (atualizar ambas é correto).
            const nameMatch = !!opts.prevName && !s.sourceId && s.name === opts.prevName
                && (opts.prevBpm === undefined || (s.bpm ?? undefined) === opts.prevBpm)
                && (opts.prevOriginalKey === undefined || (s.originalKey ?? null) === (opts.prevOriginalKey ?? null));
            const matches = (!!opts.sourceId && s.sourceId === opts.sourceId) || nameMatch;
            if (!matches) return s;
            changed = true;
            return {
                ...s,
                ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
                ...(opts.name !== undefined ? { name: opts.name } : {}),
                ...(opts.artist !== undefined ? { artist: opts.artist } : {}),
                ...(opts.originalKey !== undefined ? { originalKey: opts.originalKey } : {}),
                ...(opts.bpm !== undefined ? { bpm: opts.bpm } : {}),
                ...(opts.coverImage !== undefined ? { coverImage: opts.coverImage } : {}),
            };
        });
        if (changed) updatePlaylistAndSave(newPlaylist);
    };

    // Setlist actions
    const setPlaylistOrder = (newPlaylist: Song[]) => {
        const currentActiveId = playlist[activeSongIndex]?.id;
        updatePlaylistAndSave(newPlaylist);

        const newIndex = newPlaylist.findIndex(s => s.id === currentActiveId);
        if (newIndex !== -1 && newIndex !== activeSongIndex) {
            setActiveSongIndex(newIndex);
        }
    };

    // === Pré-contagem functions ===
    const setPrecountBeats = (val: number) => {
        const clamped = Math.max(1, Math.min(8, val));
        setPrecountBeatsState(clamped);
        localStorage.setItem('precount_beats', String(clamped));
    };

    const togglePrecountEnabled = (val: boolean) => {
        setPrecountEnabled(val);
        localStorage.setItem('precount_enabled', String(val));
    };

    // Cancelar a pré-contagem é pausar: os bipes que faltam param, o que soa desce sem estalo e
    // nenhuma voz começa (a posição fica no ponto de onde ia tocar).
    const cancelCountIn = pause;

    // O play() mais novo (com a lista de canais da renderização mais nova), pra quem toca de
    // fora da renderização: a contagem que recomeça depois de uma troca de papel na pré-contagem.
    const playRef = useRef(play);
    useEffect(() => { playRef.current = play; }, [play]);

    // Contagem que recomeça depois de uma troca de papel na pré-contagem (pedida no
    // setChannelMeta, enfileirada pelo efeito do reinício depois da renderização com a lista
    // nova): espera a fila de trocas de rota esvaziar (os faders já nos barramentos novos) e toca
    // com o play mais novo. Pausa, busca ou outro play no meio desistem dela.
    const queueRecount = () => {
        if (recountJobRef.current) return;
        const token = {};
        recountJobRef.current = token;
        const gen = playGenRef.current;
        const job = async () => {
            // A pausa desfez este pedido (e talvez já exista outro).
            if (recountJobRef.current !== token) return;
            if (!recountQueuedRef.current || gen !== playGenRef.current) {
                recountJobRef.current = null;
                recountQueuedRef.current = false;
                return;
            }
            // Outra troca entrou na fila depois desta: vai pro fim, atrás dela.
            if (routeJobsRef.current > 1) {
                enqueueRoute(job);
                return;
            }
            recountJobRef.current = null;
            recountQueuedRef.current = false;
            void playRef.current({ precount: true });
        };
        enqueueRoute(job);
    };

    // Play com a pré-contagem ligada: bipes e vozes agendados juntos pelo play (some o timer
    // que chamava o play no fim da contagem).
    const playWithPrecount = useCallback(async () => {
        await play(precountEnabled ? { precount: true } : undefined);
    }, [precountEnabled, play]);

    const removeSongFromPlaylist = (songId: string) => {
        const currentActiveId = playlist[activeSongIndex]?.id;
        const removedIndex = playlist.findIndex(s => s.id === songId);
        // Para e devolve pra reserva os worklets de tom da música removida
        // (close() não existe no pacote; sem isso eles seguiam rodando).
        playlist.find(s => s.id === songId)?.channels.forEach(ch => releasePitchNode(ch.id));
        const newPlaylist = playlist.filter(s => s.id !== songId);

        updatePlaylistAndSave(newPlaylist);

        // Removendo a música ativa: um play dela que ainda espera o worklet nascer
        // tocaria a música removida depois (a closure dele tem os canais dela).
        if (newPlaylist.length === 0) {
            cancelPendingPlay();
            stopAllNodes();
            dropSectionIntent();
            setActiveSongIndex(0);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        if (songId === currentActiveId) {
            cancelPendingPlay();
            stopAllNodes();
            dropSectionIntent();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            const newIndex = Math.min(removedIndex, newPlaylist.length - 1);
            setActiveSongIndex(newIndex);
            setDuration(newPlaylist[newIndex].duration);
        } else {
            const newIndex = newPlaylist.findIndex(s => s.id === currentActiveId);
            if (newIndex !== -1 && newIndex !== activeSongIndex) {
                setActiveSongIndex(newIndex);
            }
        }
    };

    const jumpToSong = (index: number) => {
        if (index < 0 || index >= playlist.length) return;
        if (index === activeSongIndex) return;
        // Trocou de música na pré-contagem: a outra também conta.
        const opts = restartOpts();
        cancelPendingPlay();

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        stopAllNodes();
        dropSectionIntent();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setCurrentMarker(null);
        setActiveSongIndex(index);
        setDuration(playlist[index].duration);

        if (isPlaying) {
            autoPlayOptsRef.current = opts;
            setShouldAutoPlayNext(true);
        }
    };

    // Metadata actions (V3)
    const renameSong = (id: string, newName: string) => {
        const newPlaylist = playlist.map(s => s.id === id ? { ...s, name: newName } : s);
        updatePlaylistAndSave(newPlaylist);
    }

    const setCoverImage = (id: string, imageUrl: string) => {
        const newPlaylist = playlist.map(s => s.id === id ? { ...s, coverImage: imageUrl } : s);
        updatePlaylistAndSave(newPlaylist);
    }

    // Mixer controls
    // O ganho de cada canal sai do channelGain com a lista JÁ com a mudança do
    // clique: M cala sempre (inclusive Click e Guia); Solo de outro canal cala os
    // normais, mas Click e Guia continuam tocando. Mexer no fader de um canal
    // calado pelo Solo não faz ele voltar a tocar.
    const updateVolume = (id: string, volume: number) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => (ch.id === id ? { ...ch, volume } : ch));
        const changed = song.channels.find(ch => ch.id === id);
        if (changed?.gainNode && audioCtxRef.current) {
            changed.gainNode.gain.setTargetAtTime(channelGain(changed, song.channels), audioCtxRef.current.currentTime, 0.05);
        }
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const toggleMute = (id: string) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => (ch.id === id ? { ...ch, muted: !ch.muted } : ch));
        const changed = song.channels.find(ch => ch.id === id);
        if (changed?.gainNode && audioCtxRef.current) {
            changed.gainNode.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
            changed.gainNode.gain.setValueAtTime(channelGain(changed, song.channels), audioCtxRef.current.currentTime);
        }
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const toggleSolo = (id: string) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => (ch.id === id ? { ...ch, soloed: !ch.soloed } : ch));

        // O Solo muda quem toca em toda a música, então reaplica o ganho em todos.
        song.channels.forEach(ch => {
            if (ch.gainNode && audioCtxRef.current) {
                ch.gainNode.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
                ch.gainNode.gain.setValueAtTime(channelGain(ch, song.channels), audioCtxRef.current.currentTime);
            }
        });

        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const updatePan = (id: string, pan: number) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        // O knob grava o pan; o panner recebe o efetivo do plano (fora de "Tudo junto" o
        // papel decide o lado do Click e da Guia, e em separados também o da VS).
        song.channels = song.channels.map(ch => {
            if (ch.id === id && audioCtxRef.current) {
                const next = { ...ch, pan };
                if (graphRef.current) syncChannelPan(audioCtxRef.current, next, graphRef.current.plan, settings.autoPan, true);
                return next;
            }
            return ch;
        });
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const removeChannel = async (channelId: string) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        const ch = song.channels.find(c => c.id === channelId);
        if (ch) {
            // Tocando: a voz dele para (a cadeia do canal sai do grafo logo abaixo). Palco novo: o
            // pulo marcado com ele é desfeito antes (ou fecha o pouso) e marcado de novo sem ele.
            const ctx = audioCtxRef.current;
            const sounding = stageModeRef.current === 'novo' && voicesRef.current.some((v) => v.channelId === channelId);
            if (sounding) sectionSchedulerRef.current?.reset();
            const gone = voicesRef.current.filter((v) => v.channelId === channelId);
            if (gone.length > 0) {
                voicesRef.current = voicesRef.current.filter((v) => v.channelId !== channelId);
                if (ctx) stopVoices(gone, ctx.currentTime);
                for (const v of gone) { v.source.disconnect(); v.env.disconnect(); }
            }
            const chain = playChainRef.current;
            if (chain) playChainRef.current = { ...chain, channels: chain.channels.filter((c) => c.id !== channelId) };
            ch.sourceNode = null;
            releasePitchNode(ch.id);
            ch.gainNode.disconnect();
            ch.pannerNode.disconnect();
            if (sounding) sectionTick();
        }

        song.channels = song.channels.filter(c => c.id !== channelId);
        // Click apagado pelo usuário (o dele ou o gerado): o motor não gera outro no lugar, nem na
        // sessão seguinte, mesmo que ele nunca tenha dado grade (Ruling X1-critical).
        if (ch && resolveChannelRole(ch) === 'click' && !isEndlessLoop(ch)) song.clickRemoved = true;
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);

        // Remove from files DB. Chave por-stem (novo) + Map legado (compat).
        await del(fileKey(channelId));
        const filesDb = await get<Map<string, File>>(DB_KEY_FILES);
        if (filesDb && filesDb.delete(channelId)) {
            await set(DB_KEY_FILES, filesDb);
        }
    };

    const reorderChannels = (newOrder: Channel[]) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.channels = newOrder;
        // Arrastar fixa a ordem do usuário: manual vence a ordem padrão.
        song.channelOrder = 'manual';
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    // EDITAR CANAIS: nome e papel escolhidos pelo usuário. Ficam só no repertório
    // do usuário (IndexedDB), nunca na nuvem nem no cache offline compartilhado; o
    // nome original do arquivo (name) nunca muda.
    const setChannelMeta = (channelId: string, patch: ChannelMetaPatch) => {
        const song = playlist[activeSongIndex];
        if (!song) return;
        const { channels: next, before, after, roleChanged } = applyChannelMetaToList(song.channels, channelId, patch, song.channelOrder);
        if (!before || !after) return;

        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        const cuts = routeCutsRef.current;
        if (roleChanged) {
            // Só o fader deste canal troca de barramento (o medidor do App continua ligado
            // nele) e o panner recebe o pan efetivo do papel novo (com o pan automático em
            // "Tudo junto", o lado do papel), os dois no fundo do mesmo corte. O pan gravado
            // é o knob e não muda.
            // Click ou Guia virando Normal: o atraso de compensação dele (música transposta) não
            // recebe mais voz nenhuma e sai do caminho no mesmo fundo do corte, com o que guarda
            // (nada dele na VS; ver detachEarDelay).
            const leavesEar = resolveChannelRole(before) !== 'normal' && resolveChannelRole(after) === 'normal';
            const earDelay = leavesEar ? detachEarDelay(after.id) : null;
            // O play de agora passa a ver o papel novo (a contagem do pulo acha o click por ele).
            const chain = playChainRef.current;
            if (chain) playChainRef.current = { ...chain, channels: chain.channels.map((c) => (c.id === after.id ? after : c)) };
            // Palco novo tocando: a contagem do pulo entra pela entrada do canal de click. Papel que
            // entra ou sai de Click desfaz o pulo já marcado (os bipes param já, antes do corte; o
            // agendador marca de novo no tique seguinte) e, até a troca de rota acabar, a contagem
            // vai pelo atraso da contagem do grafo: nenhum bipe entra num fader que ainda vai
            // trocar de barramento (um Click que vira Normal levaria a contagem pra PA).
            const clickMoved = resolveChannelRole(before) === 'click' || resolveChannelRole(after) === 'click';
            const holdJump = clickMoved && stageModeRef.current === 'novo' && timelineRef.current.length > 0;
            if (holdJump) {
                countViaDelayRef.current++;
                if (sectionSchedulerRef.current?.view?.committed) sectionSchedulerRef.current.reset();
            }
            // Ganho pela regra central (Solo e M) num instante: o do canal que trocou de papel muda
            // junto com o barramento dele (com Solo ligado, um Normal calado que vira Click passa a
            // tocar: antes do fundo do corte o fader ainda está no barramento da VS).
            const applyGain = (ch: Channel, list: readonly Channel[], at: number) => {
                if (!ch.gainNode) return;
                ch.gainNode.gain.cancelScheduledValues(at);
                ch.gainNode.gain.setValueAtTime(channelGain(ch, list), at);
            };
            if (ctx && graph && cuts) {
                switchRoute(() => {
                    earDelay?.disconnect();
                    moveFaderToRole(cuts, after);
                    syncChannelPan(ctx, after, graph.plan, autoPanRef.current, false);
                    // Com o Solo como está agora (pode ter mudado durante a descida do corte).
                    const latest = playlistRef.current.find((s) => s.channels.some((c) => c.id === after.id))?.channels;
                    const current = latest?.find((c) => c.id === after.id);
                    if (latest && current && resolveChannelRole(current) === resolveChannelRole(after)) applyGain(current, latest, ctx.currentTime);
                    else applyGain(after, next, ctx.currentTime);
                });
            }
            if (holdJump) enqueueRoute(async () => { countViaDelayRef.current = Math.max(0, countViaDelayRef.current - 1); });
            // E quem continua tocando com Solo ligado: reaplica o ganho nos outros, como o toggleSolo
            // (o canal que trocou de papel muda no fundo do corte, acima).
            next.forEach(ch => {
                if (ctx && (ch.id !== after.id || !graph || !cuts)) applyGain(ch, next, ctx.currentTime);
            });
            // Papel que entra ou sai de Click na pré-contagem: a contagem entra pela entrada do
            // canal de click, então ela para já e recomeça do 1 depois da troca de rota, com a
            // lista nova. Sem isso os bipes que faltam seguiriam pela entrada antiga, cujo fader
            // vai pra outro barramento (um Click que virou Normal levaria a contagem pra PA), ou
            // entrariam num canal que ainda não chegou no barramento do Click.
            if (ctx && countingIn() && (resolveChannelRole(before) === 'click' || resolveChannelRole(after) === 'click')) {
                pausedAtRef.current = getPlaybackPosition(ctx);
                // O play pendente (esperando worklet) tem a lista antiga: desiste.
                if (playPendingRef.current) cancelPendingPlay();
                stopAllNodes();
                // O efeito do reinício enfileira a contagem nova depois de renderizar a lista nova.
                recountQueuedRef.current = true;
            }
        }

        // Click e Guia ficam fora da troca de tom. Com tom diferente de 0, entrar ou
        // sair dela solta o worklet (parado) ou reinicia curto (tocando, efeito abaixo).
        // Play pendente conta como tocando: o 1º play transposto espera o worklet
        // nascer ainda sem isPlaying e, sem reiniciar, agendaria a lista antiga com o
        // ganho antigo (com Solo ligado, o Click que virou Normal tocava sem transpor
        // e o Normal que virou Click ficava calado). O reinício cancela esse play.
        const playingOrPending = isPlaying || playPendingRef.current;
        const action = pitchChangeAction(before, after, { isPlaying: playingOrPending, pitch: currentPitchRef.current });
        if (action === 'release') releasePitchNode(after.id);
        else if (action === 'restart') restartAfterMetaRef.current = true;

        const newPlaylist = [...playlist];
        newPlaylist[activeSongIndex] = { ...song, channels: next };
        updatePlaylistAndSave(newPlaylist);
    };

    const updateMasterVolume = (volume: number) => {
        if (masterGainRef.current && audioCtxRef.current) {
            // Com o FADE marcado (ou a rampa curta dele ainda correndo depois de agora), só rampa
            // linear (retimeFadeVolume); sem ele, como sempre.
            const ctx = audioCtxRef.current;
            if (fadeRef.current || fadeHeldRef.current !== null || volumeRampAt(ctx.currentTime)) retimeFadeVolume(ctx, masterGainRef.current.gain, volume);
            else {
                masterGainRef.current.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
                // O principal vai pro volume: a descida da "próxima" e o nível da parada deixam de valer.
                nextFadeRef.current = null;
                masterRestRef.current = null;
            }
            masterVolumeRef.current = volume;
            setMasterVolume(volume);
        }
    };

    const setOriginalKey = useCallback((key: string | null) => {
        if (!activeSong) return;
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.originalKey = key;
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    }, [playlist, activeSongIndex, activeSong]);

    const changePitch = useCallback((newPitch: number) => {
        if (!activeSong) return;

        // Entre -12 e +12; NaN/infinito (tom não reconhecido, comando remoto
        // inválido) vira 0: NaN no worklet zerava a saída inteira.
        const clampedPitch = sanitizeSemitones(newPitch);
        const prevPitch = currentPitchRef.current;
        if (prevPitch === clampedPitch) return;

        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.pitch = clampedPitch;
        currentPitchRef.current = clampedPitch;

        const ctx = audioCtxRef.current;
        // Cruzar a fronteira do bypass (tom 0 <-> tom != 0) muda o ROTEAMENTO da
        // cadeia: o worklet de tom entra ou sai. Quando isso acontece tocando, a
        // posição é preservada e as fontes são recriadas pelo play() já com a
        // cadeia certa — mesmo caminho do seek. Entre dois tons != 0 (sem trocar
        // roteamento) basta reprogramar o parâmetro, sem reiniciar a fonte.
        const crossesBypass = (prevPitch === 0) !== (clampedPitch === 0);

        if (isPlaying && ctx) {
            if (crossesBypass) {
                // Na pré-contagem, conta de novo.
                const opts = restartOpts();
                const elapsed = getPlaybackPosition(ctx);
                pausedAtRef.current = Math.min(Math.max(elapsed, 0), duration || elapsed);
                // Para fontes e worklets. Voltando ao tom 0 os worklets ficam
                // parados (stop(), sem DSP) e ligados ao canal: a próxima troca
                // reaproveita em vez de criar outro.
                stopAllNodes();
                void play(opts);
            } else if (clampedPitch !== 0) {
                song.channels.forEach(ch => applyPitchToChannel(ch, clampedPitch));
                // O play de agora passa a ser neste tom: a entrada das vozes do pulo (entryFor)
                // e o canal novo tocando (addLiveVoice) reprogramam o worklet com ele.
                const chain = playChainRef.current;
                if (chain) playChainRef.current = { ...chain, pitch: clampedPitch };
            }
        }
        // Parado: o próximo play() monta o roteamento certo pelo currentPitchRef.

        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    }, [playlist, activeSongIndex, activeSong, isPlaying, duration, timeStretch, play, stopAllNodes]);

    // Papel trocado tocando com tom diferente de 0 (setChannelMeta): o canal entra
    // ou sai da troca de tom, o que muda o roteamento. O reinício roda aqui, depois
    // do render, porque o play precisa enxergar a lista nova de canais; chamado
    // dentro do setChannelMeta, ele tocaria a lista antiga. A posição vem do
    // getPlaybackPosition (com um play ainda pendente, é a de onde ele ia retomar;
    // a conta direta somava o tempo do play anterior e a música pulava pra frente)
    // e o play() novo pega outro número em playGenRef: um play antigo que ainda
    // esperava o worklet nascer desiste sem agendar fontes. Vale também com a música
    // parada e o 1º play transposto pendente (isPlaying ainda falso).
    useEffect(() => {
        // Papel trocado na pré-contagem: a contagem recomeça depois da troca de rota, pelo play
        // mais novo (já com esta lista). Aqui só o worklet de quem virou Click ou Guia volta pra
        // reserva (o play dela reaproveita) e o trabalho entra na fila, atrás das trocas.
        if (recountQueuedRef.current) {
            restartAfterMetaRef.current = false;
            channels.forEach(ch => { if (isPitchExempt(ch)) releasePitchNode(ch.id); });
            queueRecount();
            return;
        }
        if (!restartAfterMetaRef.current) return;
        restartAfterMetaRef.current = false;
        const ctx = audioCtxRef.current;
        if ((!isPlaying && !playPendingRef.current) || !ctx) return;
        // Na pré-contagem, conta de novo.
        const opts = restartOpts();
        const elapsed = getPlaybackPosition(ctx);
        pausedAtRef.current = Math.min(Math.max(elapsed, 0), duration || elapsed);
        stopAllNodes();
        // Canal que virou Click ou Guia toca sem a engine de tom: o worklet dele para
        // e volta pra reserva (por id), pro próximo canal que precisar.
        channels.forEach(ch => { if (isPitchExempt(ch)) releasePitchNode(ch.id); });
        void play(opts);
    }, [channels, isPlaying, play, stopAllNodes, duration, timeStretch]);

    // Clear Session
    const clearSession = async () => {
        await set(DB_KEY_META, []);
        await set(DB_KEY_FILES, new Map());
        // Apaga também as chaves por-stem do repertório (novo formato).
        const stemPrefix = `${DB_KEY_FILES}:ch:`;
        const allKeys = await keys();
        await Promise.all(
            allKeys
                .filter((k): k is string => typeof k === 'string' && k.startsWith(stemPrefix))
                .map((k) => del(k))
        );
        window.location.reload();
    }

    // V5: Set channel bus routing. A aba Buses só mexe no pan gravado (é um knob de 3
    // posições) e só aparece em "Tudo junto"; o panner recebe o pan efetivo do plano.
    const setChannelBus = (channelId: string, bus: '1' | '2' | '1/2') => {
        const panMap = { '1': -1, '2': 1, '1/2': 0 };
        const newPan = panMap[bus];

        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.channels = song.channels.map(ch => {
            if (ch.id === channelId && audioCtxRef.current) {
                const next = { ...ch, bus, pan: newPan };
                if (graphRef.current) syncChannelPan(audioCtxRef.current, next, graphRef.current.plan, settings.autoPan, true);
                return next;
            }
            return ch;
        });
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    // V5: Export playlist as ZIP (with full audio files)
    const exportPlaylist = async (): Promise<void> => {
        const zip = new JSZip();
        // Map legado como fallback; arquivos novos vêm das chaves por-stem.
        const legacyFilesDb = await get<Map<string, File>>(DB_KEY_FILES) || new Map<string, File>();

        // Ordem, nome e papel do usuário vão junto (repertoireSchema.ts).
        const manifest = playlist.map(toManifestSong);

        // knobPans: os pans deste ZIP são só o knob do usuário (T25). ZIP sem a marca é de
        // antes e os ±1 dele são do pan automático antigo.
        zip.file('manifest.json', JSON.stringify({ version: 5, knobPans: true, songs: manifest }, null, 2));

        // Add each audio file to the zip
        for (const song of playlist) {
            for (const ch of song.channels) {
                const file = await getChannelFile(ch.id, legacyFilesDb, ch.srcId, ch.srcIdx);
                if (file) {
                    const ext = file.name.split('.').pop() || 'wav';
                    zip.file(`audio/${ch.id}.${ext}`, file);
                }
            }
        }

        // Add custom pad files
        const padFiles = await get<Map<string, File>>('mt_custom_pads');
        if (padFiles) {
            for (const [note, file] of padFiles.entries()) {
                const ext = file.name.split('.').pop() || 'wav';
                zip.file(`pads/${note}.${ext}`, file);
            }
        }
        const padNames = await get<Map<string, string>>('mt_custom_pad_names');
        if (padNames) {
            const obj: Record<string, string> = {};
            padNames.forEach((v, k) => { obj[k] = v });
            zip.file('pad_names.json', JSON.stringify(obj));
        }

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `repertorio-${new Date().toISOString().slice(0, 10)}.multitracks.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // V5: Import playlist from ZIP (with full audio files)
    const importPlaylist = async (file: File): Promise<void> => {
        try {
            const zip = await JSZip.loadAsync(file);
            const manifestFile = zip.file('manifest.json');
            if (!manifestFile) return;

            const manifestText = await manifestFile.async('string');
            const data = JSON.parse(manifestText);
            if (!data.songs || !Array.isArray(data.songs)) return;

            // Manifest de ZIP antigo não tem channelOrder: a ordem do arquivo é a que
            // o usuário deixou, então volta manual em vez de virar a ordem padrão.
            // ZIP de antes desta versão (sem knobPans): os pans ±1 são do pan automático antigo
            // e entram no centro, como no reset da conta (Ruling T25-reset-sempre).
            const fromLegacyZip = data.knobPans !== true;
            // ZIP antigo: a mesma volta dos pans da restauração (Ruling I1-rota), sem mexer na saída
            // do aparelho; num aparelho em "Tudo junto" sem o pan automático os ±1 do ZIP ficam.
            const manifestSongs = (data.songs as SavedSong[]).map(migrateManifestSong);
            const device: LegacyPanDevice = { outputs: outputsRef.current, autoPan: autoPanRef.current, legacyPanReset: legacyPanResetRef.current };
            const importedMeta: SavedSong[] = fromLegacyZip ? fixLegacyPans(manifestSongs, device, { moveOutputs: false }).songs : manifestSongs;

            // Limpa o repertório anterior (Map legado + chaves por-stem órfãs)
            // antes de importar o novo, pra não deixar stems velhos no disco.
            await set(DB_KEY_FILES, new Map());
            const stemPrefix = `${DB_KEY_FILES}:ch:`;
            const oldKeys = await keys();
            await Promise.all(
                oldKeys
                    .filter((k): k is string => typeof k === 'string' && k.startsWith(stemPrefix))
                    .map((k) => del(k))
            );

            // Restore audio files — uma chave por stem (igual loadFiles).
            for (const song of importedMeta) {
                for (const ch of song.channels) {
                    // Find audio file for this channel ID
                    const audioFiles = zip.file(new RegExp(`audio/${ch.id}\\.`));
                    if (audioFiles.length > 0) {
                        const audioBlob = await audioFiles[0].async('blob');
                        const ext = audioFiles[0].name.split('.').pop() || 'wav';
                        const audioFile = new File([audioBlob], `${ch.name}.${ext}`, { type: `audio/${ext}` });
                        await set(fileKey(ch.id), audioFile);
                    }
                }
            }

            // Restore custom pads
            const padFilesMap = new Map<string, File>();
            const padFolder = zip.folder('pads');
            if (padFolder) {
                const padEntries = zip.file(/^pads\//);
                for (const entry of padEntries) {
                    const note = entry.name.replace('pads/', '').replace(/\.[^/.]+$/, '');
                    const blob = await entry.async('blob');
                    const ext = entry.name.split('.').pop() || 'wav';
                    padFilesMap.set(note, new File([blob], `${note}.${ext}`, { type: `audio/${ext}` }));
                }
            }
            if (padFilesMap.size > 0) {
                await set('mt_custom_pads', padFilesMap);
            }

            const padNamesFile = zip.file('pad_names.json');
            if (padNamesFile) {
                const padNamesText = await padNamesFile.async('string');
                const padNamesObj = JSON.parse(padNamesText);
                const padNamesMap = new Map<string, string>(Object.entries(padNamesObj));
                await set('mt_custom_pad_names', padNamesMap);
            }

            await set(DB_KEY_META, importedMeta);

            window.location.reload();
        } catch (e) {
            console.error('Failed to import playlist', e);
        }
    };

    // Mudo geral: só o masterMute do grafo. Volume, FADE e AUTO continuam no principal e
    // nenhum play ou fade mexe nele. Sem rampa encadeada (Ruling ÁUDIO): só setTarget.
    const toggleMasterMute = useCallback(() => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return;
        const muted = !masterMutedRef.current;
        masterMutedRef.current = muted;
        graph.masterMute.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, MASTER_MUTE_TC);
        setMasterMuted(muted);
    }, []);

    // Pico das saídas 1 e 2 pro medidor do PRINCIPAL (0 a 1).
    const getOutputLevels = useCallback((): { l: number; r: number } => graphRef.current?.levels() ?? { l: 0, r: 0 }, []);

    // Velocidade nas vozes tocando (e o próximo play já entra nela). Ninguém troca a velocidade
    // tocando hoje: a linha do tempo não é reancorada (Ruling T5-rate, latente).
    const updateTimeStretch = useCallback((speed: number) => {
        setTimeStretch(speed);
        for (const v of voicesRef.current) v.source.playbackRate.value = speed;
    }, []);

    // === Controles de seção do palco antigo: loop (N/∞) e salto agendado (v1.4.16) ===
    // Armar loop numa seção: ao terminar aquela seção, repete `repeats` vezes
    // (ou infinito) e sai sozinho. Loop e salto são mutuamente exclusivos.
    const legacyArmLoop = useCallback((sectionIndex: number, repeats: number | 'infinite') => {
        const song = playlist[activeSongIndex];
        if (!song?.markers || sectionIndex < 0 || sectionIndex >= song.markers.length) return;
        const markers = song.markers;
        loopRef.current = { index: sectionIndex, remaining: repeats };
        setActiveLoop({ index: sectionIndex, remaining: repeats });
        jumpRef.current = null;
        setPendingJump(null);

        // Qual seção está tocando agora?
        let curIdx = -1;
        for (let i = markers.length - 1; i >= 0; i--) {
            if (currentTime >= markers[i].time) { curIdx = i; break; }
        }
        // Repetir uma seção diferente da atual: vai pra ela já (o playhead pode
        // já ter passado, então esperar o "fim" dela nunca dispararia). Na
        // própria seção atual, deixa terminar e repetir no fim, sem cortar.
        if (curIdx !== sectionIndex) {
            seekTo(markers[sectionIndex].time);
        }
    }, [playlist, activeSongIndex, currentTime, seekTo]);

    const legacyCancelLoop = useCallback(() => {
        loopRef.current = null;
        setActiveLoop(null);
    }, []);

    // Agendar salto: no fim da seção atual, volta pra seção alvo uma vez.
    const legacyArmJump = useCallback((sectionIndex: number) => {
        const song = playlist[activeSongIndex];
        if (!song?.markers || sectionIndex < 0 || sectionIndex >= song.markers.length) return;
        jumpRef.current = sectionIndex;
        setPendingJump(sectionIndex);
        loopRef.current = null;
        setActiveLoop(null);
    }, [playlist, activeSongIndex]);

    const legacyCancelJump = useCallback(() => {
        jumpRef.current = null;
        setPendingJump(null);
    }, []);

    // Modo do palco que vale (R-25): só muda com a VS parada; pedido tocando vale na próxima
    // parada. O que estava armado no mecanismo de antes sai.
    useEffect(() => {
        if (isPlaying || stageModeRef.current === requestedStageMode) return;
        if (stageModeRef.current === 'novo') {
            sectionSchedulerRef.current?.setIntent(null);
            setLanded(null);
        } else {
            loopRef.current = null;
            jumpRef.current = null;
            setActiveLoop(null);
            setPendingJump(null);
        }
        stageModeRef.current = requestedStageMode;
        setStageMode(requestedStageMode);
    }, [requestedStageMode, isPlaying]);

    // Modo de fim trocado tocando: entrou no FADE, a rampa é marcada (se nada está armado);
    // saiu dele, a rampa sai e, se o principal já descia, ele volta pro volume em 50 ms.
    useEffect(() => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        if (playbackMode === 'fade-out') syncFade();
        else dropFade(ctx, true);
    }, [playbackMode]);

    // === Comandos de seção do palco novo (T28) ===
    // Quem decide é a regra da T4 (src/lib/sectionArm.ts); aqui só executa. Tocando, arma no
    // agendador; parado, leva a VS pro início da seção e desarma. Sem o portão do plano pede
    // upgrade e nada muda. Só valem no palco novo: no antigo não fazem nada (ele usa os
    // adaptadores abaixo). A seção atual é a que se ouve (tempo ouvido).
    const armContext = (gates: StageGates): ArmContext => ({
        current: sectionIndexAt(spansRef.current, heardPosition()),
        isPlaying,
        sectionCount: spansRef.current.length,
        gates,
    });
    const runArm = (rule: (intent: ArmIntent | null) => ArmResult): { upgrade: boolean } => {
        if (stageModeRef.current !== 'novo') return { upgrade: false };
        const scheduler = sectionScheduler();
        if (!scheduler) return { upgrade: false };
        const r = rule(scheduler.intent);
        if (r.upgrade) return { upgrade: true };
        if (r.seekToSection !== null) {
            const span = spansRef.current[r.seekToSection];
            if (span) seekTo(span.start);
        }
        scheduler.setIntent(r.intent);
        return { upgrade: false };
    };
    const armSection = (i: number) => runArm((intent) => tapSection(intent, i, armContext(sectionGates)));
    const stepSection = (dir: -1 | 1) => runArm((intent) => stepSectionIntent(intent, dir, armContext(sectionGates)));
    const armRepeat = (plays: Plays) => runArm((intent) => armRepeatIntent(intent, plays, armContext(sectionGates)));
    const toggleSectionLoop = () => runArm((intent) => toggleLoop(intent, armContext(sectionGates)));
    // Cancelar nunca pede plano.
    const cancelArm = () => {
        if (stageModeRef.current === 'novo') sectionSchedulerRef.current?.setIntent(null);
    };

    // === Adaptadores (palco antigo e banda), que respeitam o modo que vale agora ===
    // Palco novo, com índice de span: armJump arma { i, 1 } sem nunca cancelar (parado na seção
    // atual arma "repete a atual 1x", Ruling T4-c); armLoop é o "repetir N" da banda no sentido
    // antigo (bandRepeat: em outra seção, N + 1 passagens), com o teto subido uma passagem pra
    // banda (9x numa outra seção = 10 passagens). Palco antigo: o caminho da v1.4.16, com o índice
    // da marca. O resultado de upgrade não volta pra ninguém (a banda não abre os Planos).
    const armJump = (sectionIndex: number) => {
        if (stageModeRef.current !== 'novo') { legacyArmJump(sectionIndex); return; }
        runArm((intent) => armAt(intent, sectionIndex, 1, armContext(sectionGates)));
    };
    const armLoop = (sectionIndex: number, repeats: number | 'infinite') => {
        if (stageModeRef.current !== 'novo') { legacyArmLoop(sectionIndex, repeats); return; }
        // Da rede o -1 (infinito) pode chegar como texto: o App só troca o -1 numérico.
        const times: Plays = repeats === 'infinite' || Number(repeats) === -1 ? 'infinite' : repeats;
        const gates = { ...sectionGates, maxRepeats: sectionGates.maxRepeats + 1 };
        runArm((intent) => {
            const c = armContext(gates);
            const asked = bandRepeat(sectionIndex, times, c.current);
            return armAt(intent, asked.target, asked.plays, c);
        });
    };
    const cancelJump = () => {
        if (stageModeRef.current === 'novo') cancelArm();
        else legacyCancelJump();
    };
    const cancelLoop = () => {
        if (stageModeRef.current === 'novo') cancelArm();
        else legacyCancelLoop();
    };
    // O pedido do palco novo no formato antigo, pra banda (HOST_STATE) e quem mais lê pendingJump/activeLoop.
    const currentSpanIndex = isPlaying ? playingSpan : sectionIndexAt(sectionSpansView, currentTime);
    const newStageArm = useMemo(() => legacySectionView(sectionIntent, currentSpanIndex), [sectionIntent, currentSpanIndex]);

    return {
        isReady,
        initEngine,
        loadFiles,
        isLoading,
        isRestoring,

        playlist,
        activeSongIndex,
        setPlaylistOrder,
        removeSongFromPlaylist,
        jumpToSong,
        renameSong,
        setCoverImage,
        clearSession,
        setChannelBus,
        exportPlaylist,
        importPlaylist,

        channels,
        play,
        pause,
        seekTo,
        skipBack,
        nextSong,
        prevSong,

        isPlaying,
        currentTime,
        duration,
        masterVolume,

        updateVolume,
        toggleMute,
        toggleSolo,
        updateMasterVolume,
        changePitch,
        setOriginalKey,
        currentMarker,
        setSongMarkers,
        setSongLyrics,
        syncSongMeta,

        // Saídas por papel (T25)
        outputPlan,
        maxOutputChannels,
        masterMuted,
        toggleMasterMute,
        getOutputLevels,

        // Phase 3
        timeStretch,
        updateTimeStretch,

        // Phase 2
        playbackMode,
        setPlaybackMode,
        // Seções: loop (N/∞) e salto agendado. Adaptadores do palco antigo e da banda: no palco
        // novo, índices de span e o pedido no agendador; no antigo, o caminho da v1.4.16.
        activeLoop: stageMode === 'novo' ? newStageArm.activeLoop : activeLoop,
        pendingJump: stageMode === 'novo' ? newStageArm.pendingJump : pendingJump,
        armLoop,
        cancelLoop,
        armJump,
        cancelJump,
        // Palco novo (T28): pulo agendado, REPETIR e LOOP no relógio do áudio.
        stageMode,
        sectionIntent,
        transitionView,
        landed,
        sectionSpansView,
        armSection,
        stepSection,
        armRepeat,
        toggleSectionLoop,
        cancelArm,
        heardNow,
        heardPosition,
        sectionClockMode,
        addChannelToActiveSong,

        // Channel management
        updatePan,
        removeChannel,
        reorderChannels,
        setChannelMeta,
        createEndlessMetronomeSong,

        // Pré-contagem
        precountEnabled,
        precountBeats,
        isCountingIn,
        precountTimes,
        setPrecountBeats,
        togglePrecountEnabled,
        playWithPrecount,
        cancelCountIn,

        // Grade da música ativa (T27)
        songGrid: activeGrid,
        gridWarning: songGridWarning,
        setSongMeter,
        redetectSongGrid,
        isReadingGrid,
    };
}
