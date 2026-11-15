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
// +4 a 7 dB de ruído e até 3 dB de inclinação nos harmônicos).
export const wantsFormantCompensation = (name: string): boolean =>
    isVoiceChannelName(name) && !isClickOrGuideName(name);
