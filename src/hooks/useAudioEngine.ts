import { useState, useRef, useEffect, useCallback } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import JSZip from 'jszip';
import * as Tone from 'tone';
import SignalsmithStretch, { type SignalsmithStretchNode } from 'signalsmith-stretch';
import type { Channel, Song, Marker } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { detectKey, generateEndlessClickTrackFromSample } from '../lib/AudioAnalyzer';
import { loadClickSelection } from '../lib/clickLibrary';
import { sanitizeSemitones, wantsFormantCompensation } from '../lib/pitchRules';
import { getCachedStem, getCachedStemNames, isSongCached } from '../lib/offlineCache';
import { applyChannelMetaToList, autoPanFor, channelGain, isPitchExempt, pickMainChannel, pitchChangeAction, type ChannelMetaPatch } from '../lib/channelRoles';
import { arrangeChannels } from '../lib/channelNames';
import { REPERTOIRE_SCHEMA_VERSION, migrateManifestSong, migrateSavedSong, toManifestSong, toSavedSong, type SavedSong } from '../lib/repertoireSchema';

// Engine de tom: signalsmith-stretch (MIT). O worklet e o WASM são gerados
// inline em runtime (Blob + base64), então funciona offline no desktop sob
// file:// — sem arquivo servido e sem caminho absoluto (que era o que quebrava
// o RubberBand no desktop). Pitch puro: muda o tom sem alterar a velocidade.

// O formato do repertório salvo no aparelho (SavedSong, v2 com nome, papel e
// ordem do usuário) e do manifest do ZIP vive em src/lib/repertoireSchema.ts.

// Folga entre o play e o som sair: todas as faixas são agendadas pro MESMO
// instante `when`, um pouco à frente do relógio (mesmo padrão do
// syncedTrackPlayer). 40 ms é imperceptível ao apertar play.
const START_LEAD_S = 0.04;

export function useAudioEngine(userId?: string) {
    const DB_KEY_META = userId ? `mt_meta_playlist_${userId}` : 'mt_meta_playlist';
    const DB_KEY_FILES = userId ? `mt_files_${userId}` : 'mt_files';

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
    const masterGainRef = useRef<GainNode | null>(null);

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

    // === Phase 3: Bus Groups & Time-Stretch ===
    const bus1GainRef = useRef<GainNode | null>(null);
    const bus2GainRef = useRef<GainNode | null>(null);
    const [bus1Volume, setBus1Volume] = useState(1);
    const [bus2Volume, setBus2Volume] = useState(1);
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

    const createPitchNode = async (ctx: AudioContext): Promise<SignalsmithStretchNode | null> => {
        try {
            // Nasce parado (inativo); só processa depois do start() no play().
            return await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
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
        // Click e Guia (regra central, o papel manual vale) nunca transpõem: ficam em 0
        // e sem formantes. Formantes só em voz, pela regra de pitchRules.ts.
        const exempt = isPitchExempt(ch);
        void slot.node.schedule({
            semitones: exempt ? 0 : semitones,
            formantCompensation: wantsFormantCompensation(ch.name, exempt),
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

    // Core persistence. Grava o repertório v2: tudo o que já era salvo (mixagem,
    // tom, marcadores, letra, cifra) mais sourceId, nome e papel do usuário e a ordem.
    const saveStateToDB = async (list: Song[]) => {
        await set(DB_KEY_META, list.map(toSavedSong));
    };

    const updatePlaylistAndSave = (newList: Song[]) => {
        setPlaylist(newList);
        saveStateToDB(newList);
    };

    // Apply Audio Device Output Routing
    useEffect(() => {
        if (!audioCtxRef.current) return;
        const applyDevice = async () => {
            // TS generic trick because setSinkId is not fully typed in all TS versions
            const ctx = audioCtxRef.current as any;
            if (typeof ctx.setSinkId === 'function') {
                try {
                    const deviceId = settings.audioDeviceId === 'default' ? '' : settings.audioDeviceId;
                    await ctx.setSinkId(deviceId);
                } catch (e) {
                    console.error("Failed to set audio sink. Permissions or unsupported browser.", e);
                }
            }
        };
        applyDevice();
    }, [settings.audioDeviceId, isReady]);

    // Apply Live Auto-Pan if setting changes during playback
    useEffect(() => {
        if (!audioCtxRef.current || !activeSong) return;
        setPlaylist(prev => {
            const newList = [...prev];
            const updatedSong = { ...newList[activeSongIndex] };
            updatedSong.channels = updatedSong.channels.map(ch => {
                // Ligado: Click e Guia à esquerda, o resto à direita (papel manual vence).
                // Desligado: volta ao centro. Mexe só no pan, como antes.
                const newPan = settings.autoPan ? autoPanFor(ch, true).pan : 0;

                // Apply immediately to node
                if (ch.pannerNode && audioCtxRef.current) {
                    ch.pannerNode.pan.setTargetAtTime(newPan, audioCtxRef.current.currentTime, 0.05);
                }
                return { ...ch, pan: newPan };
            });
            newList[activeSongIndex] = updatedSong;
            saveStateToDB(newList);
            return newList;
        });
    }, [settings.autoPan, activeSongIndex, isReady]);

    // Sync pitch ref whenever the active song or its pitch changes
    useEffect(() => {
        currentPitchRef.current = sanitizeSemitones(activeSong?.pitch ?? 0);
    }, [activeSong?.pitch, activeSongIndex]);

    // Initialize engine
    const initEngine = useCallback(async () => {
        if (!audioCtxRef.current) {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const master = ctx.createGain();
            master.connect(ctx.destination);
            master.gain.value = 1;

            audioCtxRef.current = ctx;
            masterGainRef.current = master;
            Tone.setContext(ctx);
            setIsReady(true);

            // Try Restore. Registro v1 (antes da Parte 1) migra pra v2 aqui; o
            // primeiro save depois grava v2 com a mesma ordem, nome e papel.
            const storedMeta = await get<SavedSong[]>(DB_KEY_META);
            const savedMeta = Array.isArray(storedMeta) ? storedMeta.map(migrateSavedSong) : [];
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
                            const gain = ctx.createGain();

                            panner.pan.value = metaCh.pan;
                            gain.gain.value = channelGain(metaCh, metaSong.channels);

                            panner.connect(gain);
                            gain.connect(master);

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
    }, [DB_KEY_META, DB_KEY_FILES]);

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
            await Promise.all(channels
                .filter(ch => !isPitchExempt(ch))
                .map(ch => ensurePitchSlot(ctx, ch)));
            // Outro play() (troca de tom, seek, pausa) começou enquanto o worklet
            // nascia: este desiste. Sem isso as duas levas de fontes tocavam juntas.
            if (gen !== playGenRef.current) return;
            // Latência real do nó, perguntada uma vez ao pacote (é fixa).
            if (pitchLatencyRef.current === null) {
                const anySlot = channels.map(ch => pitchSlotsRef.current.get(ch.id)).find(Boolean);
                if (anySlot) {
                    try {
                        const seconds = await anySlot.node.latency();
                        if (Number.isFinite(seconds) && seconds > 0 && seconds < 1) pitchLatencyRef.current = seconds;
                    } catch (e) {
                        console.error('Não consegui ler a latência do worklet de tom', e);
                    }
                    if (gen !== playGenRef.current) return;
                }
            }
        }
        // Lido de novo: o tom pode ter mudado (entre dois tons != 0) durante a espera.
        const playPitch = currentPitchRef.current;
        // Um instante só pra todas as faixas. Com start(0) ("assim que der"), se
        // o laço cruzava um bloco de áudio (2,67 ms) parte das faixas começava um
        // ou dois blocos depois (medido: 7 a 10 de 52 reinícios, até 5,3 ms).
        const when = ctx.currentTime + START_LEAD_S;
        // Com tom != 0 as faixas transpostas saem com a latência do worklet; quem
        // não passa por ele (Click e Guia pela regra central, ou worklet que falhou)
        // atrasa o mesmo tanto. Tom 0: sem atraso.
        const viaPitch = (ch: Channel) => playPitch !== 0 && !isPitchExempt(ch) && pitchSlotsRef.current.has(ch.id);
        const compensation = channels.some(viaPitch) ? pitchLatencyRef.current : null;

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
            // fonte vai DIRETO pro panner — sem worklet — então N faixas não
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

            source.start(when, pausedAtRef.current);
            ch.sourceNode = source;
            liveSourcesRef.current.add(source);
            source.onended = () => { liveSourcesRef.current.delete(source); };
        }

        startTimeRef.current = when;
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
                setTimeout(() => {
                    executeNextSong();
                }, 1500);
            }
        } else {
            executeNextSong();
        }
    }, [activeSongIndex, playlist.length, isPlaying, executeNextSong]);

    const prevSong = useCallback(() => {
        if (activeSongIndex <= 0) {
            skipBack();
            return;
        }

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

        // Roteamento (pan/bus) sai só do nome do arquivo, sem precisar do áudio
        // decodificado, então roda ANTES do decode. Regra central: com pan
        // automático, Click e Guia à esquerda (bus 1) e o resto à direita (bus 2).
        const routingFor = (fileName: string): { pan: number; bus: '1' | '2' | '1/2' } =>
            autoPanFor({ id: '', name: fileName }, settings.autoPan);

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
                const { pan, bus } = routingFor(nm);
                return { uuid: crypto.randomUUID(), idx, pan, bus, name: nm.replace(/\.[^/.]+$/, "") };
            });
        } else {
            prepared = filesArray.map((file, idx) => {
                const { pan, bus } = routingFor(file.name);
                return { uuid: crypto.randomUUID(), idx, pan, bus, name: file.name.replace(/\.[^/.]+$/, ""), file };
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

                const panner = audioCtxRef.current.createStereoPanner();
                const gain = audioCtxRef.current.createGain();

                panner.pan.value = p.pan;
                gain.gain.value = 1;

                panner.connect(gain);

                // Route through bus nodes based on assignment
                if (p.bus === '1' && bus1GainRef.current) {
                    gain.connect(bus1GainRef.current);
                } else if (p.bus === '2' && bus2GainRef.current) {
                    gain.connect(bus2GainRef.current);
                } else {
                    // '1/2' = goes to both buses (or direct to master as fallback)
                    if (bus1GainRef.current && bus2GainRef.current) {
                        gain.connect(bus1GainRef.current);
                        gain.connect(bus2GainRef.current);
                    } else {
                        gain.connect(masterGainRef.current!);
                    }
                }

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
        if (!audioCtxRef.current || !masterGainRef.current) return;
        setIsLoading(true);

        try {
            const { type, subdivision } = loadClickSelection();
            const { clickBlob } = await generateEndlessClickTrackFromSample(type, subdivision, bpm);
            const file = new File([clickBlob], 'Metronomo Loop.wav', { type: 'audio/wav' });

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            const gain = audioCtxRef.current.createGain();

            // O loop é Click pela regra central: com pan automático vai pra L (-1, bus 1); sem, centro.
            const routing = autoPanFor({ id: '', name: file.name }, settings.autoPan);
            panner.pan.value = routing.pan;
            gain.gain.value = 1;

            panner.connect(gain);
            if (settings.autoPan && bus1GainRef.current) {
                gain.connect(bus1GainRef.current);
            } else {
                // fallbacks to master if bus isn't strictly necessary, but let's connect to 1 or master
                gain.connect(masterGainRef.current);
            }

            const uuid = crypto.randomUUID();
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
                pan: routing.pan,
                bus: routing.bus
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
        if (!audioCtxRef.current || !masterGainRef.current || playlist.length === 0 || activeSongIndex < 0) return;
        setIsLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            const gain = audioCtxRef.current.createGain();

            // Regra central: com pan automático, Click e Guia à esquerda (bus 1) e o resto à direita (bus 2).
            const routing = autoPanFor({ id: '', name: file.name }, settings.autoPan);
            const panValue = routing.pan;

            panner.pan.value = panValue;
            gain.gain.value = 1;

            panner.connect(gain);

            if (panValue === -1 && bus1GainRef.current) {
                gain.connect(bus1GainRef.current);
            } else if (panValue === 1 && bus2GainRef.current) {
                gain.connect(bus2GainRef.current);
            } else {
                if (bus1GainRef.current && bus2GainRef.current) {
                    gain.connect(bus1GainRef.current);
                    gain.connect(bus2GainRef.current);
                } else {
                    gain.connect(masterGainRef.current);
                }
            }

            const uuid = crypto.randomUUID();
            await set(fileKey(uuid), file);

            const newChannel: Channel = {
                id: uuid,
                name: file.name.replace(/\.[^/.]+$/, ''),
                buffer: audioBuffer,
                file: file,
                gainNode: gain,
                pannerNode: panner,
                sourceNode: null,
                volume: 1,
                muted: false,
                soloed: false,
                pan: panValue,
                bus: routing.bus
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
        if (!ctx) return;

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

        for (let i = 0; i < precountBeats; i++) {
            const startTime = ctx.currentTime + i * beatDuration;
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            const panner = ctx.createStereoPanner();
            // Route to the same side as click/guide (left when autoPan is on)
            panner.pan.value = settings.autoPan ? -1 : 0;
            osc.connect(gainNode);
            gainNode.connect(panner);
            panner.connect(ctx.destination);
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
    }, [precountEnabled, precountBeats, play]);

    const removeSongFromPlaylist = (songId: string) => {
        const currentActiveId = playlist[activeSongIndex]?.id;
        const removedIndex = playlist.findIndex(s => s.id === songId);
        // Para e devolve pra reserva os worklets de tom da música removida
        // (close() não existe no pacote; sem isso eles seguiam rodando).
        playlist.find(s => s.id === songId)?.channels.forEach(ch => releasePitchNode(ch.id));
        const newPlaylist = playlist.filter(s => s.id !== songId);

        updatePlaylistAndSave(newPlaylist);

        if (newPlaylist.length === 0) {
            stopAllNodes();
            setActiveSongIndex(0);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        if (songId === currentActiveId) {
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

        song.channels = song.channels.map(ch => {
            if (ch.id === id && audioCtxRef.current) {
                ch.pannerNode.pan.setTargetAtTime(pan, audioCtxRef.current.currentTime, 0.05);
                return { ...ch, pan };
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
        if (roleChanged) {
            // O papel decide o lado do pan automático (after já é cópia nova).
            if (settings.autoPan) {
                const { pan, bus } = autoPanFor(after, true);
                after.pan = pan;
                after.bus = bus;
                if (ctx) after.pannerNode.pan.setTargetAtTime(pan, ctx.currentTime, 0.05);
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
        const action = pitchChangeAction(before, after, { isPlaying, pitch: currentPitchRef.current });
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
    // esperava o worklet nascer desiste sem agendar fontes.
    useEffect(() => {
        if (!restartAfterMetaRef.current) return;
        restartAfterMetaRef.current = false;
        const ctx = audioCtxRef.current;
        if (!isPlaying || !ctx) return;
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

    // V5: Set channel bus routing
    const setChannelBus = (channelId: string, bus: '1' | '2' | '1/2') => {
        const panMap = { '1': -1, '2': 1, '1/2': 0 };
        const newPan = panMap[bus];

        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.channels = song.channels.map(ch => {
            if (ch.id === channelId && audioCtxRef.current) {
                ch.pannerNode.pan.setTargetAtTime(newPan, audioCtxRef.current.currentTime, 0.05);
                return { ...ch, bus, pan: newPan };
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

        zip.file('manifest.json', JSON.stringify({ version: 5, songs: manifest }, null, 2));

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
            const importedMeta: SavedSong[] = (data.songs as SavedSong[]).map(migrateManifestSong);

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

    // Bus volume controls
    const updateBus1Volume = useCallback((v: number) => {
        setBus1Volume(v);
        if (bus1GainRef.current) bus1GainRef.current.gain.value = v;
    }, []);

    const updateBus2Volume = useCallback((v: number) => {
        setBus2Volume(v);
        if (bus2GainRef.current) bus2GainRef.current.gain.value = v;
    }, []);

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

        // Phase 3
        bus1Volume,
        bus2Volume,
        updateBus1Volume,
        updateBus2Volume,
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
