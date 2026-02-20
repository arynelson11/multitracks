import { useRef, useCallback, useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';

const noteFreqs: Record<string, number> = {
    'C': 130.81,
    'Db': 138.59,
    'D': 146.83,
    'Eb': 155.56,
    'E': 164.81,
    'F': 174.61,
    'Gb': 185.00,
    'G': 196.00,
    'Ab': 207.65,
    'A': 220.00,
    'Bb': 233.08,
    'B': 246.94
};

interface PlayingNode {
    source?: AudioBufferSourceNode;
    osc1?: OscillatorNode;
    osc2?: OscillatorNode;
    gain: GainNode;
    filter?: BiquadFilterNode;
}

export function usePadSynth() {
    const audioCtxRef = useRef<AudioContext | null>(null);
    const activeNodeRef = useRef<PlayingNode | null>(null);
    const [activeNote, setActiveNote] = useState<string | null>(null);
    const [padVolume, setPadVolume] = useState(0.4);
    const [customPads, setCustomPads] = useState<Map<string, AudioBuffer>>(new Map());
    const [customPadNames, setCustomPadNames] = useState<Map<string, string>>(new Map());

    // Load custom pads from IDB on mount
    useEffect(() => {
        (async () => {
            const savedPadFiles = await get<Map<string, File>>('mt_custom_pads');
            const savedPadNames = await get<Map<string, string>>('mt_custom_pad_names');
            if (savedPadFiles && savedPadFiles.size > 0) {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                audioCtxRef.current = ctx;
                const bufferMap = new Map<string, AudioBuffer>();
                for (const [note, file] of savedPadFiles.entries()) {
                    try {
                        const ab = await file.arrayBuffer();
                        const buffer = await ctx.decodeAudioData(ab);
                        bufferMap.set(note, buffer);
                    } catch (e) {
                        console.error(`Failed to decode custom pad for ${note}`, e);
                    }
                }
                setCustomPads(bufferMap);
            }
            if (savedPadNames) {
                setCustomPadNames(savedPadNames);
            }
        })();
    }, []);

    const initPadSynth = useCallback(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }, []);

    const fadeOutAndCleanup = useCallback((node: PlayingNode, ctx: AudioContext) => {
        node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        setTimeout(() => {
            try {
                node.osc1?.stop();
                node.osc2?.stop();
                node.source?.stop();
            } catch (e) { }
            node.osc1?.disconnect();
            node.osc2?.disconnect();
            node.source?.disconnect();
            node.gain.disconnect();
            node.filter?.disconnect();
        }, 2500);
    }, []);

    const stopPad = useCallback(() => {
        if (!audioCtxRef.current || !activeNodeRef.current) return;
        fadeOutAndCleanup(activeNodeRef.current, audioCtxRef.current);
        activeNodeRef.current = null;
        setActiveNote(null);
    }, [fadeOutAndCleanup]);

    // Live volume update
    const updatePadVolume = useCallback((vol: number) => {
        setPadVolume(vol);
        if (activeNodeRef.current && audioCtxRef.current) {
            activeNodeRef.current.gain.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.05);
        }
    }, []);

    const playPad = useCallback((note: string) => {
        initPadSynth();
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        if (activeNote === note) {
            stopPad();
            return;
        }

        // Fade out previous pad
        if (activeNodeRef.current) {
            fadeOutAndCleanup(activeNodeRef.current, ctx);
        }

        const customBuffer = customPads.get(note);

        if (customBuffer) {
            // Play custom sample
            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            source.buffer = customBuffer;
            source.loop = true;
            source.connect(gain);
            gain.connect(ctx.destination);

            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(padVolume, ctx.currentTime + 1.5);

            source.start();
            activeNodeRef.current = { source, gain };
        } else {
            // Synthesize pad
            const freq = noteFreqs[note] || noteFreqs['C'];
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();

            osc1.type = 'sawtooth';
            osc1.frequency.value = freq;
            osc2.type = 'sine';
            osc2.frequency.value = freq / 2;

            filter.type = 'lowpass';
            filter.frequency.value = 400;

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(padVolume, ctx.currentTime + 2);

            osc1.start();
            osc2.start();
            activeNodeRef.current = { osc1, osc2, gain, filter };
        }

        setActiveNote(note);
    }, [activeNote, initPadSynth, stopPad, fadeOutAndCleanup, customPads, padVolume]);

    const loadCustomPad = useCallback(async (note: string, file: File) => {
        initPadSynth();
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        try {
            const ab = await file.arrayBuffer();
            const buffer = await ctx.decodeAudioData(ab);

            setCustomPads(prev => {
                const next = new Map(prev);
                next.set(note, buffer);
                return next;
            });
            setCustomPadNames(prev => {
                const next = new Map(prev);
                next.set(note, file.name.replace(/\.[^/.]+$/, ''));
                return next;
            });

            // Persist to IDB
            const savedFiles = await get<Map<string, File>>('mt_custom_pads') || new Map<string, File>();
            savedFiles.set(note, file);
            await set('mt_custom_pads', savedFiles);

            const savedNames = await get<Map<string, string>>('mt_custom_pad_names') || new Map<string, string>();
            savedNames.set(note, file.name.replace(/\.[^/.]+$/, ''));
            await set('mt_custom_pad_names', savedNames);
        } catch (e) {
            console.error('Failed to load custom pad', e);
        }
    }, [initPadSynth]);

    const clearCustomPad = useCallback(async (note: string) => {
        setCustomPads(prev => {
            const next = new Map(prev);
            next.delete(note);
            return next;
        });
        setCustomPadNames(prev => {
            const next = new Map(prev);
            next.delete(note);
            return next;
        });

        const savedFiles = await get<Map<string, File>>('mt_custom_pads') || new Map<string, File>();
        savedFiles.delete(note);
        await set('mt_custom_pads', savedFiles);

        const savedNames = await get<Map<string, string>>('mt_custom_pad_names') || new Map<string, string>();
        savedNames.delete(note);
        await set('mt_custom_pad_names', savedNames);
    }, []);

    return { playPad, stopPad, activeNote, initPadSynth, loadCustomPad, clearCustomPad, customPads, customPadNames, padVolume, updatePadVolume };
}
