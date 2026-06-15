import { useCallback, useEffect, useState } from 'react';

export interface DesktopUpdate {
  latestVersion: string;
  url: string;
}

// Checa no app desktop se existe uma versão mais nova publicada. Faz a consulta
// ao montar e toda vez que a janela ganha foco — assim cobre o caso de o app
// ficar aberto por horas e uma versão sair nesse meio tempo (a checagem por
// timer do main roda só na abertura e a cada 6h). No navegador fica inerte.
export function useDesktopUpdate(): { update: DesktopUpdate | null; install: () => void } {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);

  const check = useCallback(async () => {
    const desktop = window.playbackDesktop;
    if (!desktop?.checkForUpdate) return;
    try {
      const res = await desktop.checkForUpdate();
      if (res.hasUpdate && res.latestVersion) {
        setUpdate({ latestVersion: res.latestVersion, url: res.url });
      } else {
        setUpdate(null);
      }
    } catch {
      // Falha de rede: mantém o estado atual, sem travar a UI.
    }
  }, []);

  useEffect(() => {
    if (!window.playbackDesktop?.checkForUpdate) return;
    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  const install = useCallback(() => {
    window.playbackDesktop?.installUpdate();
  }, []);

  return { update, install };
}
