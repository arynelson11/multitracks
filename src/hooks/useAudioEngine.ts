import { useState, useRef, useEffect, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import JSZip from 'jszip';
import * as Tone from 'tone';
import { createRubberBandNode } from 'rubberband-web';
import type { Channel, Song, Marker } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { detectKey } from '../lib/AudioAnalyzer';

const RUBBERBAND_PROCESSOR_URL = '/rubberband-processor.js';

function semitoneRatio(semitones: number): number {
    return Math.pow(2, semitones / 12);
}

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
    coverImage?: string;
    channels: SavedChannel[];
    duration: number;
    pitch?: number;
    originalKey?: string | null;
}

export function useAudioEngine() {
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

    // === Phase 2: Playback Modes & VAMP ===
    const [playbackMode, setPlaybackMode] = useState<'continue' | 'stop' | 'fade-out'>('continue');
    const [vampActive, setVampActive] = useState(false);
    const vampStartRef = useRef<number | null>(null);
    const vampEndRef = useRef<number | null>(null);

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

    const activeSong = playlist[activeSongIndex];
    const channels = activeSong?.channels || [];

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
            originalKey: song.originalKey || null
        }));
        await set('mt_meta_playlist', metaFormat);
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
            const savedMeta = await get<SavedSong[]>('mt_meta_playlist');
            const savedFiles = await get<Map<string, File>>('mt_files');

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

                            const fileNameLower = metaCh.name.toLowerCase();
                            const isClickOrGuide = fileNameLower.includes('click') || fileNameLower.includes('metronomo') || fileNameLower.includes('guia') || fileNameLower.includes('guide');

                            const pitchShiftNode = await createRubberBandNode(ctx, RUBBERBAND_PROCESSOR_URL);
                            const pitchSemitones = isClickOrGuide ? 0 : (metaSong.pitch || 0);
                            pitchShiftNode.setPitch(semitoneRatio(pitchSemitones));

                            panner.connect(pitchShiftNode);
                            pitchShiftNode.connect(gain);
                            gain.connect(master);

                            return {
                                id: metaCh.id,
                                name: metaCh.name,
                                buffer: audioBuffer,
                                file: file,
                                gainNode: gain,
                                pannerNode: panner,
                                sourceNode: null,
                                volume: metaCh.volume,
                                muted: metaCh.muted,
                                soloed: metaCh.soloed,
                                pan: metaCh.pan,
                                bus: metaCh.bus || '1/2',
                                pitchShiftNode: pitchShiftNode
                            };
                        } catch (e) {
                            console.error(`Failed to restore channel ${metaCh.name}`, e);
                            return null;
                        }
                    });

                    const channels = (await Promise.all(channelPromises)).filter((c): c is Channel => c !== null);
                    if (channels.length === 0) return null;

                    let originalKey = metaSong.originalKey || null;
                    if (!originalKey) {
                        const mainCh = channels.find(ch => {
                            const n = ch.name.toLowerCase();
                            return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide');
                        });
                        if (mainCh) originalKey = detectKey(mainCh.buffer);
                    }

                    return {
                        id: metaSong.id,
                        name: metaSong.name,
                        coverImage: metaSong.coverImage,
                        duration: metaSong.duration,
                        pitch: metaSong.pitch || 0,
                        originalKey,
                        channels
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
    }, []);

    const stopAllNodes = useCallback(() => {
        channels.forEach(ch => {
            if (ch.sourceNode) {
                try { ch.sourceNode.stop(); } catch (e) { }
                ch.sourceNode.disconnect();
                ch.sourceNode = null;
            }
        });
    }, [channels]);

    const play = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || channels.length === 0) return;

        if (ctx.state === 'suspended') ctx.resume();

        stopAllNodes();

        // Clear any auto-next timeout if user manually played
        if (autoNextTimeoutRef.current) {
            clearTimeout(autoNextTimeoutRef.current);
            autoNextTimeoutRef.current = null;
        }

        channels.forEach(ch => {
            const source = ctx.createBufferSource();
            source.buffer = ch.buffer;
            source.connect(ch.pannerNode);
            // Phase 3: Apply time-stretch
            source.playbackRate.value = timeStretch;
            source.start(0, pausedAtRef.current);
            ch.sourceNode = source;
        });

        startTimeRef.current = ctx.currentTime;
        setIsPlaying(true);
    }, [channels, stopAllNodes]);

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

        // === VAMP: Loop between markers ===
        if (vampActive && vampEndRef.current !== null && elapsed >= vampEndRef.current) {
            const loopStart = vampStartRef.current || 0;
            seekTo(loopStart);
            return;
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
    }, [isPlaying, duration, activeSongIndex, playlist.length, stopAllNodes, executeNextSong, vampActive, playbackMode, masterVolume, seekTo]);

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
    const loadFiles = async (files: FileList, overrideSongName?: string, coverImage?: string, songMarkers?: Marker[], overrideOriginalKey?: string | null) => {
        if (!audioCtxRef.current || !masterGainRef.current) return;
        setIsLoading(true);

        const filesDb = await get<Map<string, File>>('mt_files') || new Map<string, File>();

        const filesArray = Array.from(files);
        const results: (Channel | null)[] = [];
        const BATCH_SIZE = 4;

        for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
            const batch = filesArray.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (file) => {
                if (!audioCtxRef.current || !masterGainRef.current) return null;

                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

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


                const pitchShiftNode = await createRubberBandNode(audioCtxRef.current!, RUBBERBAND_PROCESSOR_URL);
                pitchShiftNode.setPitch(1.0); // no pitch change initially

                panner.connect(pitchShiftNode);
                pitchShiftNode.connect(gain);


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
                    sourceNode: null,
                    volume: 1,
                    muted: false,
                    soloed: false,
                    pan: panValue,
                    bus: busValue,
                    pitchShiftNode: pitchShiftNode
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

        await set('mt_files', filesDb);

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

        const newSong: Song = {
            id: crypto.randomUUID(),
            name: songName,
            coverImage: coverImage,
            channels: newChannels,
            duration: maxDuration,
            pitch: 0,
            originalKey,
            markers: songMarkers || undefined
        };

        const newPlaylist = [...playlist, newSong];
        if (playlist.length === 0) {
            setDuration(maxDuration);
            setActiveSongIndex(0);
            setCurrentTime(0);
        }
        updatePlaylistAndSave(newPlaylist);
        setIsLoading(false);
    };

    const addChannelToActiveSong = async (file: File) => {
        if (!audioCtxRef.current || !masterGainRef.current || playlist.length === 0 || activeSongIndex < 0) return;
        setIsLoading(true);

        const filesDb = await get('mt_files') || new Map();

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

            const pitchShiftNode = await createRubberBandNode(audioCtxRef.current!, RUBBERBAND_PROCESSOR_URL);
            pitchShiftNode.setPitch(1.0);

            panner.connect(pitchShiftNode);
            pitchShiftNode.connect(gain);

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
            await set('mt_files', filesDb);

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
                bus: panValue === -1 ? '1' : panValue === 1 ? '2' : '1/2',
                pitchShiftNode: pitchShiftNode
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

    // Setlist actions
    const setPlaylistOrder = (newPlaylist: Song[]) => {
        const currentActiveId = playlist[activeSongIndex]?.id;
        updatePlaylistAndSave(newPlaylist);

        const newIndex = newPlaylist.findIndex(s => s.id === currentActiveId);
        if (newIndex !== -1 && newIndex !== activeSongIndex) {
            setActiveSongIndex(newIndex);
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
            if (ch.id === id && audioCtxRef.current) {
                const isMuted = !ch.muted;
                const effectiveVol = isMuted ? 0 : ch.volume;
                ch.gainNode.gain.setTargetAtTime(effectiveVol, audioCtxRef.current.currentTime, 0.05);
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
            if (audioCtxRef.current) {
                let effectiveVol = ch.volume;
                if (ch.muted) effectiveVol = 0;
                if (anySoloed && !ch.soloed) effectiveVol = 0;

                ch.gainNode.gain.setTargetAtTime(effectiveVol, audioCtxRef.current.currentTime, 0.05);
            }
        });

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

        const newPlaylist = [...playlist];
        const song = { ...newPlaylist[activeSongIndex] };
        song.pitch = clampedPitch;

        song.channels.forEach(ch => {
            const fileNameLower = ch.name.toLowerCase();
            const isClickOrGuide = fileNameLower.includes('click') || fileNameLower.includes('metronomo') || fileNameLower.includes('guia') || fileNameLower.includes('guide');
            if (!isClickOrGuide && ch.pitchShiftNode) {
                ch.pitchShiftNode.setPitch(semitoneRatio(clampedPitch));
            }
        });

        newPlaylist[activeSongIndex] = song;
        updatePlaylistAndSave(newPlaylist);
    }, [playlist, activeSongIndex, activeSong]);

    // Clear Session
    const clearSession = async () => {
        await set('mt_meta_playlist', []);
        await set('mt_files', new Map());
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
        const filesDb = await get<Map<string, File>>('mt_files') || new Map<string, File>();

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

            await set('mt_meta_playlist', importedMeta);
            await set('mt_files', filesMap);

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

    // VAMP controls
    const toggleVamp = useCallback(() => {
        if (vampActive) {
            // Deactivate VAMP
            setVampActive(false);
            vampStartRef.current = null;
            vampEndRef.current = null;
        } else {
            // Activate VAMP - loop current marker section
            const song = playlist[activeSongIndex];
            if (!song?.markers || song.markers.length === 0) return;

            const markers = song.markers;
            let currentIdx = -1;
            for (let i = markers.length - 1; i >= 0; i--) {
                if (currentTime >= markers[i].time) {
                    currentIdx = i;
                    break;
                }
            }

            if (currentIdx === -1) return;

            vampStartRef.current = markers[currentIdx].time;
            vampEndRef.current = currentIdx < markers.length - 1
                ? markers[currentIdx + 1].time
                : duration;
            setVampActive(true);
        }
    }, [vampActive, playlist, activeSongIndex, currentTime, duration]);

    return {
        isReady,
        initEngine,
        loadFiles,
        isLoading,
        isRestoring,

        playlist,
        activeSongIndex,
        setPlaylistOrder,
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
        vampActive,
        toggleVamp,
        addChannelToActiveSong
    };
}
