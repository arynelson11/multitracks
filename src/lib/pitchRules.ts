// Regras puras da troca de tom (sem Web Audio). Testadas por
// scripts/verify-pitch/unit.mjs.

// Nome sem acento e em minúsculas: "METRÔNOMO" -> "metronomo".
export const normalizeChannelName = (name: string): string =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Teste antigo de click/voz-guia só pelo nome, sem acento e sem caixa ("metronom"
// cobre metronomo, metrônomo, metronome e metronom). NÃO decide áudio: no motor,
// quem fica fora do worklet de tom, o atraso de latência, o lado do pan
// automático e o Solo saem da regra central de canais (isPitchExempt,
// autoPanFor e channelGain em src/lib/channelRoles.ts, onde o papel manual vale
// e "Metronome" já é Click). Aqui ele só é o padrão de `exempt` em
// wantsFormantCompensation pra quem chama sem o papel (os testes em Node).
export const isClickOrGuideName = (name: string): boolean => {
    const n = normalizeChannelName(name);
    return n.includes('click') || n.includes('metronom') || n.includes('guia') || n.includes('guide');
};

// Termos de faixa de voz. "coral" entra junto com "coro" (nome comum em pt-BR);
// "voc" e "bgv" são as abreviações de vocal e de backing vocal.
const VOICE_TERMS = ['vocal', 'voc', 'voz', 'vox', 'backing', 'bgv', 'coro', 'coral', 'choir', 'bv'];
// "lead" sozinho é voz ("Lead", "Lead 2"), mas também nomeia instrumento solo
// ("Lead Guitar", "Synth Lead", "Lead Keys"). Com um destes no nome, não é voz.
const LEAD_INSTRUMENT_TERMS = ['guitar', 'gtr', 'guit', 'synth', 'key', 'keys', 'piano', 'bass', 'baixo'];

export const isVoiceChannelName = (name: string): boolean => {
    const n = normalizeChannelName(name);
    if (VOICE_TERMS.some(t => n.includes(t))) return true;
    return n.includes('lead') && !LEAD_INSTRUMENT_TERMS.some(t => n.includes(t));
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
// tônica ("Am", "F#m", "Ebm", "Cmaj"): o semitom é o da tônica. Aceita também
// solfejo (Dó, Ré, Mi, Fá, Sol, Lá, Si), com ou sem acento, como muita gente
// digita no Brasil ("Lá m", "Rém", "Sol#", "Sib"). O que não reconhecer
// devolve null (e quem chama não transpõe).
const NOTE_SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SOLFEGE_SEMITONE: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const KEY_QUALITY = /^(m|min|minor|menor|maj|major|maior)?$/i;

const withAccidental = (semitone: number, accidental: string): number =>
    (semitone + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;

export const keyToSemitone = (key: string | null | undefined): number | null => {
    if (typeof key !== 'string') return null;
    const k = key.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(k);
    if (m && KEY_QUALITY.test(m[3].trim())) return withAccidental(NOTE_SEMITONE[m[1].toLowerCase()], m[2]);
    // Solfejo, sem acento e em minúsculas: "Lá m" -> "la m", "Rém" -> "rem".
    const s = /^(do|re|mi|fa|sol|la|si)\s*([#b]?)(.*)$/.exec(normalizeChannelName(k));
    if (s && KEY_QUALITY.test(s[3].trim())) return withAccidental(SOLFEGE_SEMITONE[s[1]], s[2]);
    return null;
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
