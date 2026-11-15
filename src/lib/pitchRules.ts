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
