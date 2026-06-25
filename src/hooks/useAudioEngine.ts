import { useState, useRef, useEffect, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import JSZip from 'jszip';
import * as Tone from 'tone';
import SignalsmithStretch from 'signalsmith-stretch';
import type { Channel, Song, Marker } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { detectKey, generateEndlessClickTrackFromSample } from '../lib/AudioAnalyzer';
import { loadClickSelection } from '../lib/clickLibrary';

// Engine de tom: signalsmith-stretch (MIT). O worklet e o WASM são gerados
// inline em runtime (Blob + base64), então funciona offline no desktop sob
// file:// — sem arquivo servido e sem caminho absoluto (que era o que quebrava
// o RubberBand no desktop). Pitch puro: muda o tom sem alterar a velocidade.

interface SavedChannel {
    id: string;
    name: string;
    volume: number;
    muted: boolean;
    soloed: boolean;
    pan: number;
    bus: '1' | '2' | '1/2';
}

interface SavedSong {
    id: string;
    name: string;
    bpm?: number;
    coverImage?: string;
    channels: SavedChannel[];
    duration: number;
    pitch?: number;
    originalKey?: string | null;
    // Metadados que também precisam sobreviver offline (reabrir o app). Sem
    // isso, marcadores/seções, letra e cifra se perdiam ao fechar.
    artist?: string;
    markers?: Marker[];
    lyrics?: string | null;
    lyricsSynced?: string | null;
    chords?: string | null;
}

export function useAudioEngine(userId?: string) {
    const DB_KEY_META = userId ? `mt_meta_playlist_${userId}` : 'mt_meta_playlist';
    const DB_KEY_FILES = userId ? `mt_files_${userId}` : 'mt_files';
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

    // Click/voz-guia nunca transpõem (ficam em 0 semitons).
    const isClickOrGuideName = (name: string): boolean => {
        const n = name.toLowerCase();
        return n.includes('click') || n.includes('metronomo') || n.includes('guia') || n.includes('guide');
    };

    // Cria a engine de tom, pré-conecta ao panner e inicia neutra (modo
    // live-input). Ela fica SEMPRE na cadeia (source→engine→panner); mudar de
    // tom só troca um parâmetro, sem reconectar nós nem pause/play.
    const setupPitchNode = async (ctx: AudioContext, panner: StereoPannerNode): Promise<any> => {
        const node = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        node.connect(panner);
        node.start();
        node.schedule({ semitones: 0, formantCompensation: true, formantBaseHz: 0 });
        return node;
    };

    // Aplica o tom numa faixa (preservando formantes; click/guia ficam neutros).
    const applyPitchToChannel = (ch: Channel, semitones: number) => {
        if (!ch.pitchShiftNode || typeof ch.pitchShiftNode.schedule !== 'function') return;
        const isClickOrGuide = isClickOrGuideName(ch.name);
        ch.pitchShiftNode.schedule({
            semitones: isClickOrGuide ? 0 : semitones,
            formantCompensation: !isClickOrGuide,
            formantBaseHz: 0,
        });
    };

    // Core persistence
    const saveStateToDB = async (list: Song[]) => {
        const metaFormat: SavedSong[] = list.map(song => ({
            id: song.id,
            name: song.name,
            coverImage: song.coverImage,
            duration: song.duration,
            channels: song.channels.map(ch => ({
                id: ch.id,
                name: ch.name,
                volume: ch.volume,
                muted: ch.muted,
                soloed: ch.soloed,
                pan: ch.pan,
                bus: ch.bus || '1/2'
            })),
            pitch: song.pitch || 0,
            originalKey: song.originalKey || null,
            bpm: song.bpm,
            artist: song.artist,
            markers: song.markers,
            lyrics: song.lyrics ?? null,
            lyricsSynced: song.lyricsSynced ?? null,
            chords: song.chords ?? null
        }));
        await set(DB_KEY_META, metaFormat);
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
                const fileNameLower = ch.name.toLowerCase();
                const isClickOrGuide = fileNameLower.includes('click') || fileNameLower.includes('metronomo') || fileNameLower.includes('guia') || fileNameLower.includes('guide');

                let newPan = ch.pan;
                if (settings.autoPan) {
                    newPan = isClickOrGuide ? -1 : 1;
                } else {
                    newPan = 0; // Restore center if disabled
                }

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
        currentPitchRef.current = activeSong?.pitch ?? 0;
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

            // Try Restore
            const savedMeta = await get<SavedSong[]>(DB_KEY_META);
            const savedFiles = await get<Map<string, File>>(DB_KEY_FILES);

            if (savedMeta && savedMeta.length > 0 && savedFiles) {
                setIsRestoring(true);

                const restoreSongs = async (metaSong: SavedSong): Promise<Song | null> => {
                    const channelPromises = metaSong.channels.map(async (metaCh): Promise<Channel | null> => {
                        const file = savedFiles.get(metaCh.id);
                        if (!file || !ctx) return null;

                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                            const panner = ctx.createStereoPanner();
                            const gain = ctx.createGain();

                            panner.pan.value = metaCh.pan;
                            let effectiveVol = metaCh.volume;
                            if (metaCh.muted) effectiveVol = 0;
                            if (metaSong.channels.some(c => c.soloed) && !metaCh.soloed) effectiveVol = 0;
                            gain.gain.value = effectiveVol;

                            panner.connect(gain);
                            gain.connect(master);

                            const rbNode = await setupPitchNode(ctx, panner);

                            return {
                                id: metaCh.id,
                                name: metaCh.name,
                                buffer: audioBuffer,
                                file: file,
                                gainNode: gain,
                                pannerNode: panner,
                                pitchShiftNode: rbNode,
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

                    const channels = (await Promise.all(channelPromises)).filter((c): c is Channel => c !== null);
                    if (channels.length === 0) return null;

                    const mainCh = channels.find(ch => {
                        const n = ch.name.toLowerCase();
                        return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide');
                    });

                    let originalKey = metaSong.originalKey || null;
                    if (!originalKey && mainCh) originalKey = detectKey(mainCh.buffer);

                    const bpm = metaSong.bpm ?? undefined;

                    return {
                        id: metaSong.id,
                        name: metaSong.name,
                        coverImage: metaSong.coverImage,
                        duration: metaSong.duration,
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
            // Não desconectar a engine de tom aqui: ela fica sempre na cadeia,
            // persistente por canal (só a fonte é parada/recriada a cada play).
        });
    }, [channels]);

    const play = useCallback(async () => {
        const ctx = audioCtxRef.current;
        if (!ctx || channels.length === 0) return;

        // iOS / Safari: must await resume before scheduling sources.
        // Otherwise sources are scheduled while ctx.currentTime is frozen,
        // and after resume they play "in the past" — silently.
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (e) { console.error('Failed to resume AudioContext', e); }
        }

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

        const anySoloed = channels.some(c => c.soloed);
        channels.forEach(ch => {
            const source = ctx.createBufferSource();
            source.buffer = ch.buffer;
            
            const nameL = ch.name.toLowerCase();

            if (nameL.includes('metronomo loop')) {
                source.loop = true;
            }
            // Cancel any pending gain automation and apply correct volume immediately
            if (ch.gainNode) {
                ch.gainNode.gain.cancelScheduledValues(ctx.currentTime);
                let vol = ch.volume;
                if (ch.muted || (anySoloed && !ch.soloed)) vol = 0;
                ch.gainNode.gain.setValueAtTime(vol, ctx.currentTime);
            }

            // Engine de tom SEMPRE na cadeia (pré-conectada ao panner). A fonte
            // só entra nela; o tom atual já está aplicado no nó. playbackRate
            // fica em 1.0 — mudar o tom nunca altera a velocidade/BPM da música.
            source.playbackRate.value = 1.0;
            if (ch.pitchShiftNode) {
                applyPitchToChannel(ch, currentPitchRef.current);
                source.connect(ch.pitchShiftNode);
            } else {
                source.connect(ch.pannerNode);
            }

            source.start(0, pausedAtRef.current);
            ch.sourceNode = source;
        });

        startTimeRef.current = ctx.currentTime;
        setIsPlaying(true);
    }, [channels, stopAllNodes, masterVolume]);

    const pause = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || !isPlaying) return;

        stopAllNodes();
        pausedAtRef.current += ctx.currentTime - startTimeRef.current;
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
        const elapsed = (audioCtxRef.current.currentTime - startTimeRef.current) * timeStretch + pausedAtRef.current;

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
    const loadFiles = async (files: FileList, overrideSongName?: string, coverImage?: string, songMarkers?: Marker[], overrideOriginalKey?: string | null, overrideBpm?: number, meta?: { artist?: string; lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null }) => {
        if (!audioCtxRef.current || !masterGainRef.current) return;
        setIsLoading(true);

        // try/finally garante que o loading sempre desligue: se qualquer decode
        // ou worklet falhar no meio, a UI não fica presa em "carregando".
        try {
        const filesDb = await get<Map<string, File>>(DB_KEY_FILES) || new Map<string, File>();

        const filesArray = Array.from(files);
        const results: (Channel | null)[] = [];
        // Use small batches on touch devices to keep peak memory low.
        // Each concurrent decode holds an ArrayBuffer + the resulting AudioBuffer
        // simultaneously — on phones with 4-6 stems this can OOM the tab.
        const isTouch = typeof window !== 'undefined'
            && window.matchMedia
            && window.matchMedia('(pointer: coarse)').matches;
        const BATCH_SIZE = isTouch ? 1 : 4;

        for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
            const batch = filesArray.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (file) => {
                if (!audioCtxRef.current || !masterGainRef.current) return null;

                let audioBuffer: AudioBuffer;
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
                } catch (e) {
                    console.error(`Failed to decode ${file.name}`, e);
                    return null;
                }

                const panner = audioCtxRef.current.createStereoPanner();
                const gain = audioCtxRef.current.createGain();

                const fileNameLower = file.name.toLowerCase();
                let panValue = 0;
                if (settings.autoPan) {
                    if (fileNameLower.includes('click') || fileNameLower.includes('metronomo') || fileNameLower.includes('guia') || fileNameLower.includes('guide')) {
                        panValue = -1;
                    } else {
                        panValue = 1;
                    }
                }

                panner.pan.value = panValue;
                gain.gain.value = 1;

                const rbNode = await setupPitchNode(audioCtxRef.current, panner);

                panner.connect(gain);

                const uuid = crypto.randomUUID();
                filesDb.set(uuid, file);

                const busValue: '1' | '2' | '1/2' = panValue === -1 ? '1' : panValue === 1 ? '2' : '1/2';

                // Route through bus nodes based on assignment
                if (busValue === '1' && bus1GainRef.current) {
                    gain.connect(bus1GainRef.current);
                } else if (busValue === '2' && bus2GainRef.current) {
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

                return {
                    id: uuid,
                    name: file.name.replace(/\.[^/.]+$/, ""), // remove extension
                    buffer: audioBuffer,
                    file: file,
                    gainNode: gain,
                    pannerNode: panner,
                    pitchShiftNode: rbNode,
                    sourceNode: null,
                    volume: 1,
                    muted: false,
                    soloed: false,
                    pan: panValue,
                    bus: busValue
                } as Channel;
            });
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }
        const newChannels: Channel[] = results.filter((ch): ch is Channel => ch !== null);

        let maxDuration = 0;
        newChannels.forEach(ch => {
            if (ch.buffer.duration > maxDuration) maxDuration = ch.buffer.duration;
        });

        await set(DB_KEY_FILES, filesDb);

        // Use override name, folder name, or first file name as Song Name
        let songName = overrideSongName;
        if (!songName) {
            const pathParts = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/') : [];
            songName = pathParts.length > 1 ? pathParts[0] : (files[0].name.split('-')[0] || `Música ${playlist.length + 1}`);
        }

        const mainChannel = newChannels.find(ch => {
            const n = ch.name.toLowerCase();
            return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide');
        });
        const originalKey = overrideOriginalKey !== undefined
            ? overrideOriginalKey
            : (mainChannel ? detectKey(mainChannel.buffer) : null);

        const bpm = overrideBpm !== undefined ? overrideBpm : undefined;

        const newSong: Song = {
            id: crypto.randomUUID(),
            name: songName,
            coverImage: coverImage,
            channels: newChannels,
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

        const filesDb = await get<Map<string, File>>(DB_KEY_FILES) || new Map<string, File>();

        try {
            const { type, subdivision } = loadClickSelection();
            const { clickBlob } = await generateEndlessClickTrackFromSample(type, subdivision, bpm);
            const file = new File([clickBlob], 'Metronomo Loop.wav', { type: 'audio/wav' });

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            const gain = audioCtxRef.current.createGain();

            // Panner para click tradicionalmente fica em L ou C. autoPan joga click pra L (-1)
            panner.pan.value = settings.autoPan ? -1 : 0;
            gain.gain.value = 1;

            panner.connect(gain);
            if (settings.autoPan && bus1GainRef.current) {
                gain.connect(bus1GainRef.current);
            } else {
                // fallbacks to master if bus isn't strictly necessary, but let's connect to 1 or master
                gain.connect(masterGainRef.current);
            }

            const uuid = crypto.randomUUID();
            filesDb.set(uuid, file);
            await set(DB_KEY_FILES, filesDb);

            const rbNode = await setupPitchNode(audioCtxRef.current, panner);

            const newChannel: Channel = {
                id: uuid,
                name: 'Metronomo Loop',
                buffer: audioBuffer,
                file: file,
                gainNode: gain,
                pannerNode: panner,
                pitchShiftNode: rbNode,
                sourceNode: null,
                volume: 1,
                muted: false,
                soloed: false,
                pan: panner.pan.value,
                bus: settings.autoPan ? '1' : '1/2'
            };

            const newSong: Song = {
                id: crypto.randomUUID(),
                name: `Metrônomo ${bpm} BPM`,
                coverImage: '',
                channels: [newChannel],
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

        const filesDb = await get(DB_KEY_FILES) || new Map();

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            const panner = audioCtxRef.current.createStereoPanner();
            const gain = audioCtxRef.current.createGain();

            const fileNameLower = file.name.toLowerCase();
            let panValue = 0;
            if (settings.autoPan && (fileNameLower.includes('click') || fileNameLower.includes('metronomo') || fileNameLower.includes('guia') || fileNameLower.includes('guide'))) {
                panValue = -1;
            } else if (settings.autoPan) {
                panValue = 1;
            }

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
            filesDb.set(uuid, file);
            await set(DB_KEY_FILES, filesDb);

            const rbNode = await setupPitchNode(audioCtxRef.current, panner);

            const newChannel: Channel = {
                id: uuid,
                name: file.name.replace(/\.[^/.]+$/, ''),
                buffer: audioBuffer,
                file: file,
                gainNode: gain,
                pannerNode: panner,
                pitchShiftNode: rbNode,
                sourceNode: null,
                volume: 1,
                muted: false,
                soloed: false,
                pan: panValue,
                bus: panValue === -1 ? '1' : panValue === 1 ? '2' : '1/2'
            };

            const newPlaylist = [...playlist];
            const song = { ...newPlaylist[activeSongIndex] };
            song.channels = [...song.channels, newChannel];

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
            play();
        }, totalMs);
    }, [precountEnabled, precountBeats, play]);

    const removeSongFromPlaylist = (songId: string) => {
        const currentActiveId = playlist[activeSongIndex]?.id;
        const removedIndex = playlist.findIndex(s => s.id === songId);
        // Fecha as engines de tom da música removida (libera os worklets WASM).
        playlist.find(s => s.id === songId)?.channels.forEach(ch => {
            try { ch.pitchShiftNode?.close?.(); } catch { /* engine já encerrada */ }
        });
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
    const updateVolume = (id: string, volume: number) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => {
            if (ch.id === id && audioCtxRef.current) {
                const effectiveVol = ch.muted ? 0 : volume;
                ch.gainNode.gain.setTargetAtTime(effectiveVol, audioCtxRef.current.currentTime, 0.05);
                return { ...ch, volume };
            }
            return ch;
        });
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const toggleMute = (id: string) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => {
            if (ch.id === id) {
                const isMuted = !ch.muted;
                const effectiveVol = isMuted ? 0 : ch.volume;
                if (ch.gainNode && audioCtxRef.current) {
                    ch.gainNode.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
                    ch.gainNode.gain.setValueAtTime(effectiveVol, audioCtxRef.current.currentTime);
                }
                return { ...ch, muted: isMuted };
            }
            return ch;
        });
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    };

    const toggleSolo = (id: string) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        if (!song) return;

        song.channels = song.channels.map(ch => {
            if (ch.id === id) {
                return { ...ch, soloed: !ch.soloed };
            }
            return ch;
        });

        const anySoloed = song.channels.some(ch => ch.soloed);

        song.channels.forEach(ch => {
            if (ch.gainNode && audioCtxRef.current) {
                let effectiveVol = ch.volume;
                if (ch.muted) effectiveVol = 0;
                if (anySoloed && !ch.soloed) effectiveVol = 0;
                ch.gainNode.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
                ch.gainNode.gain.setValueAtTime(effectiveVol, audioCtxRef.current.currentTime);
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
            }
            try { ch.pitchShiftNode?.close?.(); } catch { /* engine já encerrada */ }
            ch.gainNode.disconnect();
            ch.pannerNode.disconnect();
        }

        song.channels = song.channels.filter(c => c.id !== channelId);
        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);

        // Remove from files DB
        const filesDb = await get<Map<string, File>>(DB_KEY_FILES);
        if (filesDb) {
            filesDb.delete(channelId);
            await set(DB_KEY_FILES, filesDb);
        }
    };

    const reorderChannels = (newOrder: Channel[]) => {
        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.channels = newOrder;
        newPlaylist[activeSongIndex] = song;
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

        // Clamp to -12 / +12 Semitones
        const clampedPitch = Math.max(-12, Math.min(12, newPitch));
        if (currentPitchRef.current === clampedPitch) return;

        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.pitch = clampedPitch;

        currentPitchRef.current = clampedPitch;

        // Engine sempre na cadeia: trocar de tom é só atualizar o parâmetro nos
        // nós (com preservação de formantes). Sem pause/play, sem reconectar
        // cadeia — era esse reroute que silenciava/travava ao cruzar o tom 0.
        // Aplica esteja tocando ou não; o nó guarda o estado pro próximo play.
        song.channels.forEach(ch => applyPitchToChannel(ch, clampedPitch));

        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    }, [playlist, activeSongIndex, activeSong]);

    // Clear Session
    const clearSession = async () => {
        await set(DB_KEY_META, []);
        await set(DB_KEY_FILES, new Map());
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
        const filesDb = await get<Map<string, File>>(DB_KEY_FILES) || new Map<string, File>();

        const manifest = playlist.map(song => ({
            id: song.id,
            name: song.name,
            coverImage: song.coverImage,
            duration: song.duration,
            channels: song.channels.map(ch => ({
                id: ch.id,
                name: ch.name,
                volume: ch.volume,
                muted: ch.muted,
                soloed: ch.soloed,
                pan: ch.pan,
                bus: ch.bus
            }))
        }));

        zip.file('manifest.json', JSON.stringify({ version: 5, songs: manifest }, null, 2));

        // Add each audio file to the zip
        for (const song of playlist) {
            for (const ch of song.channels) {
                const file = filesDb.get(ch.id);
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

            const importedMeta: SavedSong[] = data.songs;
            const filesMap = new Map<string, File>();

            // Restore audio files
            for (const song of importedMeta) {
                for (const ch of song.channels) {
                    // Find audio file for this channel ID
                    const audioFiles = zip.file(new RegExp(`audio/${ch.id}\\.`));
                    if (audioFiles.length > 0) {
                        const audioBlob = await audioFiles[0].async('blob');
                        const ext = audioFiles[0].name.split('.').pop() || 'wav';
                        const audioFile = new File([audioBlob], `${ch.name}.${ext}`, { type: `audio/${ext}` });
                        filesMap.set(ch.id, audioFile);
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
            await set(DB_KEY_FILES, filesMap);

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
