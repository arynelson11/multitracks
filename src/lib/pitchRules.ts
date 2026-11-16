// Regras puras da troca de tom (sem Web Audio). Testadas por
// scripts/verify-pitch/unit.mjs.

// Nome sem acento e em minúsculas: "METRÔNOMO" -> "metronomo".
export const normalizeChannelName = (name: string): string =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Click/voz-guia nunca transpõem (ficam fora do worklet de tom). Ignora acento
// e caixa: o click do Separador se chama "Metrônomo" e, sem isso, era
// transposto e saía atrasado junto com os instrumentos.
export const isClickOrGuideName = (name: string): boolean => {
    const n = normalizeChannelName(name);
    return n.includes('click') || n.includes('metronomo') || n.includes('guia') || n.includes('guide');
};

// Termos de faixa de voz. "coral" entra junto com "coro" (nome comum em pt-BR).
const VOICE_TERMS = ['vocal', 'voz', 'vox', 'lead', 'backing', 'coro', 'coral', 'choir', 'bv'];

export const isVoiceChannelName = (name: string): boolean => {
    const n = normalizeChannelName(name);
    return VOICE_TERMS.some(t => n.includes(t));
};

// Liga a compensação de formantes do worklet de tom nesta faixa? Só em voz:
// com rastreio automático (formantBaseHz 0) ela piora instrumento (medido:
// +4 a 7 dB de ruído e até 3 dB de inclinação nos harmônicos). Click e Guia
// nunca: o motor passa em `exempt` o papel da regra central de canais
// (isPitchExempt, onde o papel manual vale); sem ele, vale o teste por nome.
export const wantsFormantCompensation = (name: string, exempt: boolean = isClickOrGuideName(name)): boolean =>
    isVoiceChannelName(name) && !exempt;

// Tônica de um tom em qualquer grafia comum -> semitom (0 = C ... 11 = B).
// Aceita sustenido e bemol (#, b, ♯, ♭), minúsculas e menor/maior depois da
// tônica ("Am", "F#m", "Ebm", "Cmaj"): o semitom é o da tônica. O que não
// reconhecer devolve null (e quem chama não transpõe).
const NOTE_SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const KEY_QUALITY = /^(m|min|minor|menor|maj|major|maior)?$/i;

export const keyToSemitone = (key: string | null | undefined): number | null => {
    if (typeof key !== 'string') return null;
    const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(key.trim().replace(/♯/g, '#').replace(/♭/g, 'b'));
    if (!m || !KEY_QUALITY.test(m[3].trim())) return null;
    const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return (NOTE_SEMITONE[m[1].toLowerCase()] + accidental + 12) % 12;
};

// Semitons do tom original até o tom escolhido, pelo caminho mais curto
// (-6..+6). Tom não reconhecido de qualquer lado: 0 (não transpõe, nunca NaN).
export const semitonesBetweenKeys = (fromKey: string | null | undefined, toKey: string | null | undefined): number => {
    const from = keyToSemitone(fromKey);
    const to = keyToSemitone(toKey);
    if (from === null || to === null) return 0;
    const diff = to - from;
    return diff > 6 ? diff - 12 : diff < -6 ? diff + 12 : diff;
};

// Semitons que podem ir pro motor: número finito entre -12 e +12. NaN ou
// infinito viram 0 (NaN no worklet zera a saída inteira, medido).
export const sanitizeSemitones = (value: number): number =>
    Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
