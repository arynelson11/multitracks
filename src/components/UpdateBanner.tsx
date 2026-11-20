import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { Button, IconButton, Panel } from './ui';

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

    // Com autoUpdate a versão nova assume sozinha. Se isso acontecer com o app
    // aberto, avisa e oferece recarregar (sem recarregar sozinho: não corta música).
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (!hadController || cancelled) return;
      setWaitingSW(null);
      setState({ kind: 'web' });
      setDismissed(false);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

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
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (interval) clearInterval(interval);
      if (onFocus) window.removeEventListener('focus', onFocus);
    };
  }, []);

  const show = state.kind !== 'none' && !dismissed;
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

  const version = state.kind === 'ready' || state.kind === 'available' ? state.version : '';
  const title = isReady ? 'Atualização pronta' : 'Nova versão disponível';
  const description = isWeb
    ? 'Uma versão nova do Playback Studio está pronta. Atualize para usar.'
    : isReady
      ? `Versão ${version} baixada. Reinicie para aplicar.`
      : `Versão ${version} já saiu. Baixe a nova versão.`;
  const buttonLabel = isReady ? 'Reiniciar' : isWeb ? 'Atualizar' : 'Baixar';

  // Aviso no rodapé, por cima de tudo e sem bloquear o app: não é janela e não puxa o foco.
  // A região status fica sempre na página (vazia sem aviso, sem pegar toque) e o aviso entra
  // nela: região que nasce já com o texto muitas vezes não é lida (revisão macro BC, BC3-2).
  return (
    <div role="status" className="pointer-events-none fixed bottom-4 left-1/2 z-[9999] w-[min(92vw,440px)] -translate-x-1/2 font-ps-sans">
      {show && (
        <Panel variant="pop" className="pointer-events-auto flex flex-wrap items-center gap-3 px-4 py-3">
          {/* Quadrado neutro: laranja é ligado e a ação principal, que já é o botão (BC3-3). */}
          <div aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-ps-md bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line">
            {usesRefreshIcon ? <RefreshCw size={16} /> : <Download size={16} />}
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-ps-base font-bold leading-tight text-ps-bone">{title}</p>
            <p className="text-ps-sm text-ps-mut break-words">{description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button tone="primary" onClick={handleAction}>{buttonLabel}</Button>
            <IconButton tone="ghost" aria-label="Agora não" icon={<X size={16} />} onClick={() => setDismissed(true)} />
          </div>
        </Panel>
      )}
    </div>
  );
}
