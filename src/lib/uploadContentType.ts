// Resolve o Content-Type que vai pro /api/get-upload-url (e pro PUT no R2).
//
// Por que existe: o servidor só aceita audio/*, image/* ou application/octet-stream
// (ALLOWED_CONTENT_TYPES em api/get-upload-url.ts). O navegador nem sempre manda um
// tipo desses: no iPad/iPhone um arquivo escolhido no app Arquivos pode vir como
// video/mp4, video/quicktime, com maiúsculas ou com parâmetros (";codecs=..."), e o
// upload morria com "[Vercel API 400] Invalid contentType" antes de começar.
// Aqui a gente normaliza pra um tipo aceito, sem afrouxar a regra do servidor.

const SERVER_ALLOWED = /^(audio\/|image\/|application\/octet-stream$)/;

const TYPE_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  // Contêiner de vídeo: o que a separação usa é a trilha de áudio dentro dele.
  mp4: 'audio/mp4',
  m4v: 'audio/mp4',
  mov: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export function resolveUploadContentType(file: { type?: string; name?: string }): string {
  const raw = (file.type || '').split(';')[0].trim().toLowerCase();
  if (raw && SERVER_ALLOWED.test(raw)) return raw;

  const ext = (file.name || '').split('.').pop()?.toLowerCase() ?? '';
  if (TYPE_BY_EXTENSION[ext]) return TYPE_BY_EXTENSION[ext];

  // video/webm → audio/webm etc. O R2 só guarda bytes; o rótulo precisa ser aceito.
  if (raw.startsWith('video/')) return raw.replace(/^video\//, 'audio/');

  return 'application/octet-stream';
}

// Filtro dos botões de escolher áudio (<input type="file" accept=...>).
// Só "audio/*" não basta no iPhone/iPad: o seletor do iOS deixava MP3 APAGADO,
// sem dar pra tocar (visto em 2026-11-09 com um .mp3 baixado pelo Chrome).
// Listar as extensões e os tipos explícitos faz o iOS reconhecer cada formato.
export const AUDIO_FILE_ACCEPT = [
  'audio/*',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.caf',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac',
].join(',');
