import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

// Barra fixa no rodapé que aparece quando há uma nova versão disponível.
//
// App desktop (Electron):
//   - Windows: o electron-updater já baixou; o botão reinicia e instala.
//   - macOS: só avisamos (app não assinado não pode auto-instalar); o botão
//     abre a página de download pra baixar o novo instalador.
//
// Navegador (PWA / service worker):
//   - O código novo já está no servidor; o service worker baixa a nova versão
//     em segundo plano. O botão troca pra ela (skipWaiting) e recarrega a aba.
type UpdateState =
  | { kind: 'none' }
  | { kind: 'ready'; version: string }       // desktop Windows: baixado, pronto pra reiniciar
  | { kind: 'available'; version: string }    // desktop Mac: existe versão nova pra baixar
  | { kind: 'web' };                          // navegador: nova versão do site pronta pra aplicar

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'none' });
  const [dismissed, setDismissed] = useState(false);
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);

  // ── Desktop (Electron) ──
  useEffect(() => {
    const desktop = window.playbackDesktop;
    if (!desktop) return;
    const offReady = desktop.onUpdateReady((version) => setState({ kind: 'ready', version }));
    const offAvail = desktop.onUpdateAvailable(({ version }) => setState({ kind: 'available', version }));
    return () => { offReady(); offAvail(); };
  }, []);

  // ── Navegador (service worker) ──
  useEffect(() => {
    if (window.playbackDesktop) return;            // no app o canal é o de cima
    if (!('serviceWorker' in navigator)) return;

    let interval: ReturnType<typeof setInterval> | undefined;
    let onFocus: (() => void) | undefined;
    let cancelled = false;

    const markReady = (sw: ServiceWorker) => {
      setWaitingSW(sw);
      setState({ kind: 'web' });
      setDismissed(false);
    };

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || cancelled) return;

      // Já existe uma versão nova esperando (baixada numa sessão anterior).
      if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);

      // Uma versão nova foi encontrada durante esta sessão.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) markReady(sw);
        });
      });

      // Procura atualização periodicamente e ao voltar o foco pra aba.
      const check = () => reg.update().catch(() => {});
      interval = setInterval(check, 30 * 60 * 1000);
      onFocus = () => check();
      window.addEventListener('focus', onFocus);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (onFocus) window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (state.kind === 'none' || dismissed) return null;

  const isReady = state.kind === 'ready';       // desktop win
  const isWeb = state.kind === 'web';
  const usesRefreshIcon = isReady || isWeb;

  const handleAction = () => {
    if (isWeb) {
      if (waitingSW) {
        // Quando o novo service worker assumir o controle, recarrega pra pegar
        // a versão nova. Fallback recarrega mesmo se o evento não disparar.
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
        waitingSW.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        window.location.reload();
      }
      return;
    }
    window.playbackDesktop?.installUpdate();
  };

  const title = isReady ? 'Atualização pronta' : 'Nova versão disponível';
  const description = isWeb
    ? 'Uma versão nova do Playback Studio está pronta. Atualize para usar.'
    : isReady
      ? `Versão ${state.version} baixada. Reinicie para aplicar.`
      : `Versão ${state.version} já saiu. Baixe a nova versão.`;
  const buttonLabel = isReady ? 'Reiniciar' : isWeb ? 'Atualizar' : 'Baixar';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[min(92vw,440px)]">
      <div className="flex items-center gap-3 bg-card border border-primary/30 rounded-xl shadow-2xl shadow-black/40 px-4 py-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
          {usesRefreshIcon ? <RefreshCw size={16} className="text-primary" /> : <Download size={16} className="text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold text-sm leading-tight">{title}</p>
          <p className="text-text-muted text-[11px] truncate">{description}</p>
        </div>
        <button
          onClick={handleAction}
          className="shrink-0 px-3.5 py-2 rounded-lg bg-primary text-black text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all cursor-pointer"
        >
          {buttonLabel}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-text-muted hover:text-white transition-colors cursor-pointer"
          title="Agora não"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
