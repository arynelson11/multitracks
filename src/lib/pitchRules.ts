// Regras puras da troca de tom (sem Web Audio): tom escrito -> semitom e
// semitons seguros pro motor. Testadas por scripts/verify-pitch/unit.mjs.
// Quem transpõe, quem passa pelo atraso de latência e quem ganha compensação de
// formantes NÃO sai daqui: vem da regra central de canais (isPitchExempt e
// wantsFormantCompensation em src/lib/channelRoles.ts, com o papel manual e o
// nome dado pelo usuário). Os testes por pedaço de nome que ficavam aqui saíram.

// Sem acento e em minúsculas: "Lá m" -> "la m" (solfejo).
export const normalizeChannelName = (name: string): string =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
