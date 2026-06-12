import { isElectron } from './desktop';

// As funções serverless (/api/*) são servidas pela própria origem no app web.
// No desktop (Electron) não há servidor de API local, então apontamos para o
// domínio de produção. O CORS é resolvido no main process do Electron, que
// injeta os headers Access-Control-* nas respostas dessas chamadas.
const API_BASE = isElectron ? 'https://playbackstudio.com.br' : '';

/** Resolve o caminho de uma função serverless conforme o ambiente (web ou desktop). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
