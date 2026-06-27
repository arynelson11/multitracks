// Trace de diagnóstico que SOBREVIVE ao reload da aba (inclusive a um crash de
// memória no iOS, que recarrega a página). Em vez de depender do "Preservar Log"
// do Safari, gravamos cada passo no localStorage (síncrono e durável). Quando o
// app reinicia, pbTraceFlushOnStartup() imprime o trace da sessão anterior no
// console — assim dá pra ver a ÚLTIMA fase antes da aba morrer.
//
// Uso: pbTraceReset() no início do fluxo, pbTrace() em cada fase, pbTraceClear()
// no fim com sucesso. Se a aba morrer no meio, o trace parcial fica salvo e é
// impresso no próximo carregamento.

const KEY = 'pb_trace';

interface TraceEntry { t: number; m: string }

function read(): TraceEntry[] {
    try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export function pbTraceReset(msg: string): void {
    try {
        localStorage.setItem(KEY, JSON.stringify([{ t: Date.now(), m: msg }]));
    } catch { /* storage indisponível: segue só no console */ }
    console.log('[PB]', msg);
}

export function pbTrace(msg: string): void {
    try {
        const arr = read();
        arr.push({ t: Date.now(), m: msg });
        localStorage.setItem(KEY, JSON.stringify(arr));
    } catch { /* noop */ }
    console.log('[PB]', msg);
}

export function pbTraceClear(): void {
    try {
        localStorage.removeItem(KEY);
    } catch { /* noop */ }
}

// Chamado uma vez no boot do app. Se a sessão anterior deixou um trace (porque a
// aba morreu antes de limpar), imprime no console pra leitura post-mortem.
export function pbTraceFlushOnStartup(): void {
    const arr = read();
    if (arr.length === 0) return;
    const t0 = arr[0]?.t || 0;
    console.log('%c[PB] ===== TRACE DA SESSÃO ANTERIOR (recuperado após reload) =====', 'color:#FF6B35;font-weight:bold');
    arr.forEach((e) => console.log(`[PB] +${e.t - t0}ms  ${e.m}`));
    console.log('%c[PB] ===== FIM DO TRACE ANTERIOR (a última linha acima = onde morreu) =====', 'color:#FF6B35;font-weight:bold');
}
