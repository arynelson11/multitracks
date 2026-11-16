import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import JSZip from 'jszip';
import * as Tone from 'tone';
import SignalsmithStretch, { type SignalsmithStretchNode } from 'signalsmith-stretch';
import type { Channel, ChannelRole, Song, Marker } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { detectKey, generateEndlessClickTrackFromSample } from '../lib/AudioAnalyzer';
import { loadClickSelection } from '../lib/clickLibrary';
import { sanitizeSemitones } from '../lib/pitchRules';
import { getCachedStem, getCachedStemNames, isSongCached } from '../lib/offlineCache';
import { applyChannelMetaToList, autoPanFor, channelGain, isPitchExempt, pickMainChannel, pitchChangeAction, wantsFormantCompensation, type ChannelMetaPatch } from '../lib/channelRoles';
import { arrangeChannels, resolveChannelRole, type ChannelIdentity } from '../lib/channelNames';
import { REPERTOIRE_SCHEMA_VERSION, migrateManifestSong, migrateSavedSong, toManifestSong, toSavedSong, type SavedSong } from '../lib/repertoireSchema';
import { createOutputGraph, type OutputGraph } from '../audio/outputGraph';
import { effectivePan, planOutputs, sanitizeOutputs, type PlannedOutputs } from '../lib/outputPlan';
import type { OutputPlan, OutputSettings } from '../lib/stageContracts';

// Engine de tom: signalsmith-stretch (MIT). O worklet e o WASM são gerados
// inline em runtime (Blob + base64), então funciona offline no desktop sob
// file:// — sem arquivo servido e sem caminho absoluto (que era o que quebrava
// o RubberBand no desktop). Pitch puro: muda o tom sem alterar a velocidade.

// O formato do repertório salvo no aparelho (SavedSong, v2 com nome, papel e
// ordem do usuário) e do manifest do ZIP vive em src/lib/repertoireSchema.ts.

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
// O que a pré-contagem antiga usa como canal: um Click sem knob.
const COUNT_CHANNEL = { id: '', name: 'Click', role: 'click' as const, pan: 0 };

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

/** Espera o relógio do áudio passar de `t`. Desiste se ele parar, se o contexto não estiver tocando ou se passar do teto. */
function waitForAudioTime(ctx: BaseAudioContext, t: number): Promise<void> {
    return new Promise((resolve) => {
        const started = performance.now();
        const clockAtStart = ctx.currentTime;
        const tick = () => {
            const waited = performance.now() - started;
            const frozen = waited > FROZEN_CLOCK_MS && ctx.currentTime === clockAtStart;
            if (ctx.currentTime >= t || ctx.state !== 'running' || frozen || waited > MAX_CUT_WAIT_MS) resolve();
            else setTimeout(tick, 1);
        };
        tick();
    });
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

// Primeira restauração de cada conta depois da migração (R-23, Ruling T25-legacy): os pans
// ±1 que o pan automático antigo gravou voltam ao centro (o barramento da aba Buses volta
// junto pro '1/2', que é o pan 0). A marca da conta fica no aparelho.
const withLegacyPansReset = (song: SavedSong): SavedSong => ({
    ...song,
    channels: song.channels.map((ch) => (Math.abs(ch.pan) === 1 ? { ...ch, pan: 0, bus: '1/2' as const } : ch)),
});

export function useAudioEngine(userId?: string) {
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
    const { settings } = useSettings();
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
    const playlistRef = useRef<Song[]>([]);
    const faderBusRef = useRef(new WeakMap<GainNode, ChannelRole>());
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

    // === Seções: loop (N vezes ou infinito) e salto agendado ===
    // Os refs são a fonte da verdade dentro do loop de rAF (updateTime); os
    // estados só espelham pra UI re-renderizar. Loop e salto disparam no FIM da
    // seção atual (transição musical), nunca no clique.
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

    const animationRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
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
    const countInTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countInOscsRef = useRef<OscillatorNode[]>([]);

    const activeSong = playlist[activeSongIndex];
    const channels = activeSong?.channels || [];

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
    // Fontes tocando agora, fora do estado do React: stopAllNodes para todas.
    // Se o repertório for copiado (ex.: volume mexido) enquanto um play() espera
    // o worklet nascer, a cópia não teria a referência e a fonte ficaria órfã.
    const liveSourcesRef = useRef(new Set<AudioBufferSourceNode>());
    // Cada play() pega um número. Se outro play() (troca de tom, seek...) começar
    // enquanto este espera o worklet nascer, o antigo desiste sem agendar nada.
    const playGenRef = useRef(0);
    // true entre o play() parar as fontes e agendar as novas: nada está tocando,
    // a posição é pausedAtRef (startTimeRef ainda é a do play anterior).
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

    // Posição atual da música. Com um play() pendente nada está tocando: a
    // posição é a de onde ele vai retomar. Sem isso, a troca rápida de tom somava
    // o tempo do play anterior e a música pulava segundos pra frente.
    const getPlaybackPosition = (ctx: BaseAudioContext): number => {
        if (playPendingRef.current) return pausedAtRef.current;
        // Antes do `when` agendado a música ainda não andou (não volta pra trás).
        return Math.max(0, ctx.currentTime - startTimeRef.current) * timeStretch + pausedAtRef.current;
    };

    // Cancela um play() que ainda espera o worklet nascer (1ª vez transposto,
    // 50 a 300 ms). Quem troca de música sem passar pelo play() chama isto antes
    // de trocar (só quando a música muda de fato):
    // sem isso o play antigo terminava depois e tocava a música anterior (a
    // closure dele tem os canais dela) com a tela já na outra.
    const cancelPendingPlay = () => {
        playGenRef.current++;
        playPendingRef.current = false;
    };

    // Core persistence. Grava o repertório v2: tudo o que já era salvo (mixagem,
    // tom, marcadores, letra, cifra) mais sourceId, nome e papel do usuário e a ordem.
    const saveStateToDB = async (list: Song[]) => {
        await set(DB_KEY_META, list.map(toSavedSong));
    };

    const updatePlaylistAndSave = (newList: Song[]) => {
        setPlaylist(newList);
        saveStateToDB(newList);
    };

    // O repertório mais novo pra troca de rota fora da renderização (antes dos efeitos abaixo).
    useEffect(() => { playlistRef.current = playlist; }, [playlist]);

    // Canal novo (restauração, arquivo, canal avulso, metrônomo): pan efetivo no panner e o
    // fader no corte do barramento do papel. Nunca direto no principal.
    const connectChannel = (cuts: RouteCuts, graph: OutputGraph, ch: ChannelIdentity & { pan: number }, panner: StereoPannerNode, gain: GainNode) => {
        const role = resolveChannelRole(ch);
        const pan = channelPanFor(ch, graph.plan, autoPanRef.current);
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
    const panPending = (plan: OutputPlan, autoPan: boolean) =>
        allChannels().some((ch) => pannerPanRef.current.get(ch.pannerNode) !== channelPanFor(ch, plan, autoPan));
    const syncAllPans = (ctx: BaseAudioContext, plan: OutputPlan, autoPan: boolean) => {
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
    // Algo soando pelo motor agora (faixas tocando ou pré-contagem)? Sem som não há estalo
    // nem vazamento possível: a troca vai na hora.
    const isSounding = () => liveSourcesRef.current.size > 0 || countInOscsRef.current.length > 0;
    const needsCut = () => {
        const ctx = audioCtxRef.current;
        return !!ctx && !!routeCutsRef.current && ctx.state === 'running' && isSounding();
    };
    /**
     * Troca no fundo de um corte de 3 ms nos três barramentos: desce (âncora com
     * setValueAtTime e rampa linear, nunca depois de setTarget: o corte não tem outra
     * automação), a partir de uma folga à frente do relógio, espera o relógio do áudio passar
     * do fundo, faz a troca inteira na mesma tarefa e sobe em 3 ms (também com folga). Sem
     * som, só a troca.
     */
    const withRouteCut = async (change: () => void | Promise<void>): Promise<void> => {
        const ctx = audioCtxRef.current;
        const cuts = routeCutsRef.current;
        if (!ctx || !cuts || !needsCut()) {
            await change();
            return;
        }
        const nodes = Object.values(cuts);
        const t0 = ctx.currentTime + cutLead(ctx);
        const bottom = t0 + ROUTE_CUT_S;
        for (const g of nodes) {
            g.gain.cancelScheduledValues(t0);
            g.gain.setValueAtTime(1, t0);
            g.gain.linearRampToValueAtTime(0, bottom);
        }
        await waitForAudioTime(ctx, bottom + 128 / ctx.sampleRate);
        try {
            await change();
        } finally {
            const up = Math.max(ctx.currentTime + cutLead(ctx), bottom);
            for (const g of nodes) {
                g.gain.setValueAtTime(0, up);
                g.gain.linearRampToValueAtTime(1, up + ROUTE_CUT_S);
            }
            await waitForAudioTime(ctx, up + ROUTE_CUT_S);
        }
    };
    // As trocas vão numa fila, na ordem: uma nunca começa no meio do corte de outra.
    const routeQueueRef = useRef<Promise<void>>(Promise.resolve());
    const routeJobsRef = useRef(0);
    const enqueueRoute = (job: () => Promise<void>) => {
        routeJobsRef.current++;
        routeQueueRef.current = routeQueueRef.current
            .then(job)
            .catch((e) => console.error('[saídas] a troca de rota falhou', e))
            .finally(() => { routeJobsRef.current--; });
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
        const plan = routeOutputs(ctx, graph, outputsRef.current, max);
        syncAllPans(ctx, graph.plan, autoPanRef.current);
        setMaxOutputChannels(max);
        setOutputPlan(plan);
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
                try {
                    await ctx.setSinkId(deviceId);
                } catch (e) {
                    console.error("Failed to set audio sink. Permissions or unsupported browser.", e);
                }
            }
            // O aparelho novo pode ter outro número de canais: plano novo com o máximo dele.
            applyOutputsNow();
        }));
    }, [settings.audioDeviceId, isReady]);

    // Rede de segurança: canal novo ou repertório trocado fora de uma troca de rota. Os
    // canais já nascem com o pan certo; aqui só corrige o que tiver ficado pra trás.
    useEffect(() => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph || routeJobsRef.current > 0) return;
        syncAllPans(ctx, graph.plan, autoPanRef.current);
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
            // Primeira restauração desta conta (R-23, Rulings T25-legacy e T25-reset-sempre):
            // os pans ±1 gravados antes desta versão (pan automático antigo, ligado ou já
            // desligado) voltam ao centro e já ficam gravados, com todas as músicas (inclusive
            // a que não abrir agora); depois a conta ganha a marca dela. Uma vez só por conta.
            const resetLegacyPans = readLocal(LEGACY_PANS_DONE_KEY) !== '1';
            const migratedMeta = Array.isArray(storedMeta) ? storedMeta.map(migrateSavedSong) : [];
            const savedMeta = resetLegacyPans ? migratedMeta.map(withLegacyPansReset) : migratedMeta;
            if (resetLegacyPans) {
                if (savedMeta.some((s, i) => s.channels.some((ch, j) => ch.pan !== migratedMeta[i].channels[j].pan))) {
                    await set(DB_KEY_META, savedMeta);
                }
                writeLocal(LEGACY_PANS_DONE_KEY, '1');
            }
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
                        chords: metaSong.chords ?? null
                    };
                };

                const songResults = await Promise.all(savedMeta.map(restoreSongs));
                const restoredPlaylist = songResults.filter((s): s is Song => s !== null);

                if (restoredPlaylist.length > 0) {
                    setPlaylist(restoredPlaylist);
                    setDuration(restoredPlaylist[0].duration);
                }
                setIsRestoring(false);
            }
        }
    }, [DB_KEY_META, DB_KEY_FILES, LEGACY_PANS_DONE_KEY, refreshOutputs]);

    const stopAllNodes = useCallback(() => {
        channels.forEach(ch => {
            if (ch.sourceNode) {
                try { ch.sourceNode.stop(); } catch (e) { }
                ch.sourceNode.disconnect();
                ch.sourceNode = null;
            }
        });
        liveSourcesRef.current.forEach(src => {
            try { src.stop(); } catch { /* já parada */ }
            src.disconnect();
        });
        liveSourcesRef.current.clear();
        // Sem fonte, o worklet ativo seguiria rodando o DSP à toa (mais caro que
        // tocando): para todos. O play() religa os que vai usar.
        stopPitchNodes();
    }, [channels]);

    const play = useCallback(async () => {
        const ctx = audioCtxRef.current;
        if (!ctx || channels.length === 0) return;
        const gen = ++playGenRef.current;
        playPendingRef.current = true;

        // iOS / Safari: must await resume before scheduling sources.
        // Otherwise sources are scheduled while ctx.currentTime is frozen,
        // and after resume they play "in the past" — silently.
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (e) { console.error('Failed to resume AudioContext', e); }
        }
        if (gen !== playGenRef.current) return;

        // Reset master gain in case a previous fade-out left it near zero.
        if (masterGainRef.current) {
            masterGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
            masterGainRef.current.gain.setValueAtTime(masterVolume, ctx.currentTime);
        }

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

        // Monta as fontes de todas as faixas e só então agenda todas no mesmo
        // instante, lido depois de montar tudo: o laço de start() só agenda
        // (microssegundos). Com start(0) ("assim que der") e o laço longo, se ele
        // cruzava um bloco de áudio (2,67 ms) parte das faixas começava um ou dois
        // blocos depois (medido: 7 a 10 de 52 reinícios).
        const scheduleAll = (leadQuanta: number) => {
            const prepared: AudioBufferSourceNode[] = [];
            for (const ch of channels) {
                const source = ctx.createBufferSource();
                source.buffer = ch.buffer;

                const nameL = ch.name.toLowerCase();

                if (nameL.includes('metronomo loop')) {
                    source.loop = true;
                }
                // Cancel any pending gain automation and apply correct volume immediately
                if (ch.gainNode) {
                    ch.gainNode.gain.cancelScheduledValues(ctx.currentTime);
                    ch.gainNode.gain.setValueAtTime(channelGain(ch, channels), ctx.currentTime);
                }

                // BYPASS NO TOM 0: a engine de tom (worklet+WASM) é um phase-vocoder
                // caro que roda DSP por quadro mesmo parada. No tom 0 (caso comum) a
                // fonte vai DIRETO pro panner, sem worklet, então N faixas não
                // saturam a thread de áudio (era isso que zerava o som em músicas de
                // muitos canais). O worklet só nasce, sob demanda, quando a música
                // está transposta e a faixa não é click/guia.
                source.playbackRate.value = 1.0;
                const slot = viaPitch(ch) ? pitchSlotsRef.current.get(ch.id) : undefined;
                if (slot) {
                    startPitchNode(slot);
                    applyPitchToChannel(ch, playPitch);
                    source.connect(slot.node);
                } else if (compensation) {
                    // Click/guia (ou worklet que falhou) com a música transposta: mesmo atraso.
                    source.connect(getLatencyDelay(ctx, ch, compensation));
                } else {
                    // Tom 0: direto, sem worklet e sem atraso.
                    source.connect(ch.pannerNode);
                }

                ch.sourceNode = source;
                liveSourcesRef.current.add(source);
                source.onended = () => { liveSourcesRef.current.delete(source); };
                prepared.push(source);
            }
            const when = nextRenderQuantum(ctx, leadQuanta);
            const offset = pausedAtRef.current;
            for (const source of prepared) source.start(when, offset);
            return { when, prepared };
        };

        let scheduled = scheduleAll(START_LEAD_QUANTA);
        // O relógio chegou no instante comum antes de o laço terminar: o motor
        // pode ter calculado aquele bloco com parte das faixas ainda sem start(),
        // e essas começariam um bloco depois até o próximo reinício. Descarta e
        // agenda de novo com a folga de reserva. Raro: precisa de 2 blocos de
        // áudio calculados durante um laço de microssegundos.
        if (ctx.currentTime >= scheduled.when) {
            for (const source of scheduled.prepared) {
                source.onended = null;
                try { source.stop(); } catch { /* já parada */ }
                source.disconnect();
                liveSourcesRef.current.delete(source);
            }
            scheduled = scheduleAll(Math.ceil(RETRY_LEAD_S * ctx.sampleRate / 128));
            // Rastro pro teste em aparelho fraco: quantos reinícios ganharam os 40 ms.
            console.warn(`[tom] reinício reagendado com a folga de reserva (${++leadRetriesRef.current})`);
        }

        startTimeRef.current = scheduled.when;
        playPendingRef.current = false;
        setIsPlaying(true);
    }, [channels, stopAllNodes, masterVolume]);

    const pause = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || !isPlaying) return;

        // Cancela um play() que ainda espera o worklet nascer.
        const wasPending = playPendingRef.current;
        playGenRef.current++;
        playPendingRef.current = false;
        stopAllNodes();
        if (!wasPending) pausedAtRef.current += Math.max(0, ctx.currentTime - startTimeRef.current);
        setIsPlaying(false);

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }
        // Pausou no fade da "próxima": fica nesta música, parada.
        if (nextSongTimerRef.current !== null) {
            clearTimeout(nextSongTimerRef.current);
            nextSongTimerRef.current = null;
        }
    }, [isPlaying, stopAllNodes]);

    const skipBack = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        // V3: 2-second rule for restart
        if (currentTime > 2) {
            const wasPlaying = isPlaying;
            stopAllNodes();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            if (wasPlaying) play();
            return;
        }

        // Behavior if <= 2 seconds
        if (activeSongIndex > 0) {
            if (autoNextTimeoutRef.current) {
                clearTimeout(autoNextTimeoutRef.current);
                autoNextTimeoutRef.current = null;
            }
            stopAllNodes();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            setActiveSongIndex(prev => prev - 1);
            setDuration(playlist[activeSongIndex - 1].duration);
            if (isPlaying) setShouldAutoPlayNext(true);
        } else {
            const wasPlaying = isPlaying;
            stopAllNodes();
            pausedAtRef.current = 0;
            setCurrentTime(0);
            if (wasPlaying) play();
        }
    }, [currentTime, isPlaying, play, activeSongIndex, playlist, stopAllNodes]);

    const seekTo = useCallback((time: number) => {
        if (!audioCtxRef.current || duration === 0) return;

        // Bound time
        const targetTime = Math.max(0, Math.min(time, duration));

        const wasPlaying = isPlaying;

        stopAllNodes();
        pausedAtRef.current = targetTime;
        setCurrentTime(targetTime);

        // Clear any auto track switch timeouts
        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        if (wasPlaying) {
            play();
        }
    }, [duration, isPlaying, play, stopAllNodes]);

    const executeNextSong = useCallback(() => {
        if (activeSongIndex >= playlist.length - 1) return;
        cancelPendingPlay();

        stopAllNodes();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setCurrentMarker(null);
        setActiveSongIndex(prev => prev + 1);
        setDuration(playlist[activeSongIndex + 1].duration);
        setShouldAutoPlayNext(true);

        if (masterGainRef.current && audioCtxRef.current) {
            masterGainRef.current.gain.setValueAtTime(0.01, audioCtxRef.current.currentTime);
            masterGainRef.current.gain.exponentialRampToValueAtTime(masterVolume || 0.01, audioCtxRef.current.currentTime + 1.0);
        }
    }, [activeSongIndex, playlist, masterVolume, stopAllNodes]);

    const nextSong = useCallback(() => {
        if (activeSongIndex >= playlist.length - 1) return;

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        if (isPlaying) {
            // Fade out current song then execute next
            if (masterGainRef.current && audioCtxRef.current) {
                masterGainRef.current.gain.setTargetAtTime(0.01, audioCtxRef.current.currentTime, 0.3);
                if (nextSongTimerRef.current !== null) clearTimeout(nextSongTimerRef.current);
                nextSongTimerRef.current = window.setTimeout(() => {
                    nextSongTimerRef.current = null;
                    executeNextSong();
                }, 1500);
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
        cancelPendingPlay();

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        stopAllNodes();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setActiveSongIndex(prev => prev - 1);
        setDuration(playlist[activeSongIndex - 1].duration);

        if (isPlaying) {
            setShouldAutoPlayNext(true);
        }
    }, [activeSongIndex, playlist, isPlaying, skipBack, stopAllNodes]);

    useEffect(() => {
        if (shouldAutoPlayNext && channels.length > 0) {
            setShouldAutoPlayNext(false);
            play();
        }
    }, [shouldAutoPlayNext, channels, play]);


    // Update time loop
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

        // === Seções: loop e salto ===
        const songMarkers = playlist[activeSongIndex]?.markers;
        if (songMarkers && songMarkers.length > 0) {
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

        if (elapsed >= duration) {
            setCurrentTime(duration);
            setIsPlaying(false);
            stopAllNodes();

            // Playback Mode logic
            if (playbackMode === 'stop') {
                // Just stop, don't advance
                return;
            }

            if (playbackMode === 'fade-out') {
                // Already stopped - no auto-advance
                return;
            }

            // playbackMode === 'continue' (default)
            if (activeSongIndex < playlist.length - 1) {
                if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
                autoNextTimeoutRef.current = window.setTimeout(() => {
                    executeNextSong();
                }, 5000);
            }
            return;
        }

        // Fade-out mode: fade in the last 5 seconds
        if (playbackMode === 'fade-out' && duration > 5 && elapsed >= duration - 5) {
            const remaining = duration - elapsed;
            const fadeGain = Math.max(0.001, remaining / 5);
            if (masterGainRef.current && audioCtxRef.current) {
                masterGainRef.current.gain.setTargetAtTime(fadeGain * masterVolume, audioCtxRef.current.currentTime, 0.1);
            }
        }

        setCurrentTime(elapsed);
        animationRef.current = requestAnimationFrame(updateTime);
    }, [isPlaying, duration, activeSongIndex, playlist, stopAllNodes, executeNextSong, playbackMode, masterVolume, seekTo]);

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
    const loadFiles = async (files: FileList, overrideSongName?: string, coverImage?: string, songMarkers?: Marker[], overrideOriginalKey?: string | null, overrideBpm?: number, meta?: { artist?: string; lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null; sourceId?: string }) => {
        if (!audioCtxRef.current || !masterGainRef.current) return;
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
            chords: meta?.chords ?? null
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
            chords: meta?.chords ?? null
        };

        const newPlaylist = [...playlist, newSong];
        if (playlist.length === 0) {
            setDuration(maxDuration);
            setActiveSongIndex(0);
            setCurrentTime(0);
        }
        updatePlaylistAndSave(newPlaylist);
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

    const addChannelToActiveSong = async (file: File) => {
        if (!audioCtxRef.current || !masterGainRef.current || !graphRef.current || !routeCutsRef.current || playlist.length === 0 || activeSongIndex < 0) return;
        const graph = graphRef.current;
        const cuts = routeCutsRef.current;
        setIsLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            setupPannerForBuffer(panner, audioBuffer);
            const gain = audioCtxRef.current.createGain();

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
                file: file,
                gainNode: gain,
                pannerNode: panner,
                sourceNode: null,
                volume: 1,
                muted: false,
                soloed: false,
                pan: panValue,
                bus: '1/2'
            };

            const newPlaylist = [...playlist];
            const song = { ...newPlaylist[activeSongIndex] };
            // Ordem automática encaixa o canal novo na ordem padrão; manual põe no fim.
            song.channels = arrangeChannels([...song.channels, newChannel], song.channelOrder);

            if (audioBuffer.duration > song.duration) {
                song.duration = audioBuffer.duration;
                setDuration(audioBuffer.duration);
            }

            newPlaylist[activeSongIndex] = song;
            updatePlaylistAndSave(newPlaylist);
        } catch (e) {
            console.error('Failed to add channel to active song:', e);
        } finally {
            setIsLoading(false);
        }
    };

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

    const cancelCountIn = useCallback(() => {
        if (countInTimeoutRef.current) {
            clearTimeout(countInTimeoutRef.current);
            countInTimeoutRef.current = null;
        }
        countInOscsRef.current.forEach(osc => { try { osc.stop(); } catch {} });
        countInOscsRef.current = [];
        setIsCountingIn(false);
    }, []);

    // O timer da pré-contagem chama o play() mais novo, com a lista de canais de
    // quando a contagem acaba: trocar o papel de um canal durante a contagem (tom
    // diferente de 0) já vale no play. Com o play() da hora do clique, um Click que
    // virou Normal saía sem transpor na PA até o próximo play.
    const playRef = useRef(play);
    useEffect(() => { playRef.current = play; }, [play]);

    const playWithPrecount = useCallback(async () => {
        const ctx = audioCtxRef.current;
        const graph = graphRef.current;
        if (!ctx || !graph) return;

        if (!precountEnabled) {
            await play();
            return;
        }

        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (e) { console.error('Failed to resume AudioContext', e); }
        }

        setIsCountingIn(true);
        countInOscsRef.current = [];

        const bpm = 100;
        const beatDuration = 60 / bpm;

        // A contagem agora passa pelo principal: um fade-out que deixou o ganho perto de 0
        // calaria os bipes. Volta pro volume já aqui (o play() faz o mesmo ao começar).
        graph.master.gain.cancelScheduledValues(ctx.currentTime);
        graph.master.gain.setValueAtTime(masterVolume, ctx.currentTime);
        // Pan efetivo do Click (Ruling T25-precount): -1 no ouvido da saída 1 e em "Tudo
        // junto" com o pan automático (como a v1.4.16), +1 com o lado trocado, 0 em "Tudo
        // junto" sem pan automático. Calculado uma vez pra contagem inteira.
        const countPan = channelPanFor(COUNT_CHANNEL, graph.plan, settings.autoPan);

        for (let i = 0; i < precountBeats; i++) {
            const startTime = ctx.currentTime + i * beatDuration;
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            const panner = ctx.createStereoPanner();
            // Bipe mono entra ESTÉREO no barramento do Click por um panner próprio (o
            // barramento espera estéreo: mono direto lá sairia +6 dB), passando pelo corte
            // do Click como os canais. Dali segue o StereoPanner do barramento e sai onde o
            // Click sai: nunca na VS, nem em "4 ou mais". Mesmo nível da v1.4.16 com o
            // principal em 1. A T26 refaz a contagem.
            panner.pan.value = countPan;
            osc.connect(gainNode);
            gainNode.connect(panner);
            panner.connect(routeCutsRef.current?.click ?? graph.input('click'));
            osc.type = 'square';
            osc.frequency.value = i === 0 ? 1200 : 880;
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.003);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
            osc.start(startTime);
            osc.stop(startTime + 0.1);
            countInOscsRef.current.push(osc);
        }

        const totalMs = precountBeats * beatDuration * 1000;
        countInTimeoutRef.current = setTimeout(() => {
            countInTimeoutRef.current = null;
            countInOscsRef.current = [];
            setIsCountingIn(false);
            void playRef.current();
        }, totalMs);
    }, [precountEnabled, precountBeats, play, masterVolume, settings.autoPan]);

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
            setActiveSongIndex(0);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        if (songId === currentActiveId) {
            cancelPendingPlay();
            stopAllNodes();
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
        cancelPendingPlay();

        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        stopAllNodes();
        pausedAtRef.current = 0;
        setCurrentTime(0);
        setCurrentMarker(null);
        setActiveSongIndex(index);
        setDuration(playlist[index].duration);

        if (isPlaying) setShouldAutoPlayNext(true);
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
            if (ch.sourceNode) {
                try { ch.sourceNode.stop(); } catch (_) {}
                ch.sourceNode.disconnect();
                liveSourcesRef.current.delete(ch.sourceNode);
            }
            releasePitchNode(ch.id);
            ch.gainNode.disconnect();
            ch.pannerNode.disconnect();
        }

        song.channels = song.channels.filter(c => c.id !== channelId);
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
            if (ctx && graph && cuts) {
                switchRoute(() => {
                    moveFaderToRole(cuts, after);
                    syncChannelPan(ctx, after, graph.plan, autoPanRef.current, false);
                });
            }
            // E quem continua tocando com Solo ligado: reaplica o ganho em todos, como o toggleSolo.
            next.forEach(ch => {
                if (ch.gainNode && ctx) {
                    ch.gainNode.gain.cancelScheduledValues(ctx.currentTime);
                    ch.gainNode.gain.setValueAtTime(channelGain(ch, next), ctx.currentTime);
                }
            });
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
            masterGainRef.current.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.05);
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
                const elapsed = getPlaybackPosition(ctx);
                pausedAtRef.current = Math.min(Math.max(elapsed, 0), duration || elapsed);
                // Para fontes e worklets. Voltando ao tom 0 os worklets ficam
                // parados (stop(), sem DSP) e ligados ao canal: a próxima troca
                // reaproveita em vez de criar outro.
                stopAllNodes();
                void play();
            } else if (clampedPitch !== 0) {
                song.channels.forEach(ch => applyPitchToChannel(ch, clampedPitch));
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
        if (!restartAfterMetaRef.current) return;
        restartAfterMetaRef.current = false;
        const ctx = audioCtxRef.current;
        if ((!isPlaying && !playPendingRef.current) || !ctx) return;
        const elapsed = getPlaybackPosition(ctx);
        pausedAtRef.current = Math.min(Math.max(elapsed, 0), duration || elapsed);
        stopAllNodes();
        // Canal que virou Click ou Guia toca sem a engine de tom: o worklet dele para
        // e volta pra reserva (por id), pro próximo canal que precisar.
        channels.forEach(ch => { if (isPitchExempt(ch)) releasePitchNode(ch.id); });
        void play();
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
            const importedMeta: SavedSong[] = (data.songs as SavedSong[]).map(migrateManifestSong).map((s) => (fromLegacyZip ? withLegacyPansReset(s) : s));

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

    const updateTimeStretch = useCallback((speed: number) => {
        setTimeStretch(speed);
        // Apply to all playing sources
        channels.forEach(ch => {
            if (ch.sourceNode) {
                ch.sourceNode.playbackRate.value = speed;
            }
        });
    }, [channels]);

    // === Controles de seção: loop (N/∞) e salto agendado ===
    // Armar loop numa seção: ao terminar aquela seção, repete `repeats` vezes
    // (ou infinito) e sai sozinho. Loop e salto são mutuamente exclusivos.
    const armLoop = useCallback((sectionIndex: number, repeats: number | 'infinite') => {
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

    const cancelLoop = useCallback(() => {
        loopRef.current = null;
        setActiveLoop(null);
    }, []);

    // Agendar salto: no fim da seção atual, volta pra seção alvo uma vez.
    const armJump = useCallback((sectionIndex: number) => {
        const song = playlist[activeSongIndex];
        if (!song?.markers || sectionIndex < 0 || sectionIndex >= song.markers.length) return;
        jumpRef.current = sectionIndex;
        setPendingJump(sectionIndex);
        loopRef.current = null;
        setActiveLoop(null);
    }, [playlist, activeSongIndex]);

    const cancelJump = useCallback(() => {
        jumpRef.current = null;
        setPendingJump(null);
    }, []);

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
        // Seções: loop (N/∞) e salto agendado
        activeLoop,
        pendingJump,
        armLoop,
        cancelLoop,
        armJump,
        cancelJump,
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
        setPrecountBeats,
        togglePrecountEnabled,
        playWithPrecount,
        cancelCountIn,
    };
}
