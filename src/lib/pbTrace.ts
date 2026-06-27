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

// Mostra o trace da sessão anterior NA TELA (caixa fixa no topo), pra ler direto
// no celular sem precisar do Inspetor Web. Some ao tocar em "Fechar e limpar".
export function pbTraceShowOnStartup(): void {
    pbTraceFlushOnStartup();
    if (typeof document === 'undefined') return;
    const arr = read();
    if (arr.length === 0) return;

    const render = () => {
        if (!document.body) { setTimeout(render, 100); return; }
        const t0 = arr[0]?.t || 0;
        const lines = arr.map((e) => `+${e.t - t0}ms  ${e.m}`).join('\n');

        const box = document.createElement('div');
        box.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
            'background:#16161a', 'color:#fff', 'font:12px/1.45 ui-monospace,Menlo,monospace',
            'padding:12px 14px', 'border-bottom:3px solid #FF6B35',
            'max-height:70vh', 'overflow:auto', '-webkit-overflow-scrolling:touch'
        ].join(';');

        const title = document.createElement('div');
        title.textContent = 'DIAGNÓSTICO — última linha = onde travou:';
        title.style.cssText = 'color:#FF6B35;font-weight:bold;margin-bottom:8px';

        const pre = document.createElement('pre');
        pre.textContent = lines;
        pre.style.cssText = 'white-space:pre-wrap;margin:0';

        const btn = document.createElement('button');
        btn.textContent = 'Fechar e limpar';
        btn.style.cssText = 'margin-top:10px;padding:8px 14px;background:#FF6B35;color:#000;border:none;border-radius:6px;font-weight:bold';
        btn.onclick = () => { pbTraceClear(); box.remove(); };

        box.appendChild(title);
        box.appendChild(pre);
        box.appendChild(btn);
        document.body.appendChild(box);
    };
    render();
}
