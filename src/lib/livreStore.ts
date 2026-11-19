import { liveLedgerFor, stageLedgerFor, withOpened, type LiveLedger, type StageLedger } from './livreRules'

// Store do Livre no aparelho: as músicas do mês no palco, os minutos do Ao Vivo do dia e o
// dia do último anúncio da tela inicial, guardados por conta no localStorage. As regras
// (o que conta, quando zera) ficam em livreRules.ts; aqui só se lê e grava.
//
// O armazenamento pode faltar ou lançar (aba privada, cota cheia): a leitura que falha
// devolve vazio e a escrita que falha não faz nada (nem avisa). Funciona igual no navegador
// e no app de computador (file://). Cada escrita sobe um número de versão e avisa quem se
// inscreveu, pro useSyncExternalStore do hook; o evento `storage` de outra janela também.

const PREFIX = 'ps-livre-'
const stageKey = (userId: string) => `${PREFIX}musicas:${userId}`
const liveKey = (userId: string) => `${PREFIX}aovivo:${userId}`
const homeAdKey = (userId: string) => `${PREFIX}anuncio-inicio:${userId}`

let version = 0
const listeners = new Set<() => void>()

function changed(): void {
  version += 1
  for (const cb of [...listeners]) cb()
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// Grava e avisa. Igual ao que já está guardado: nada muda e ninguém é avisado.
function writeRaw(key: string, value: string): void {
  try {
    if (localStorage.getItem(key) === value) return
    localStorage.setItem(key, value)
  } catch {
    return
  }
  changed()
}

function readJson(key: string): unknown {
  const raw = readRaw(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ── Músicas do mês no palco ──

export function readStageLedger(userId: string, month: string): StageLedger {
  return stageLedgerFor(readJson(stageKey(userId)), month)
}

// Lê o que está guardado agora, junta a música e grava na hora: duas telas do app abrindo
// músicas nunca apagam a conta uma da outra.
export function recordStageSong(userId: string, key: string, month: string): StageLedger {
  const current = readStageLedger(userId, month)
  const next = withOpened(current, key)
  if (next !== current) writeRaw(stageKey(userId), JSON.stringify(next))
  return next
}

// ── Minutos do Ao Vivo do dia ──

export function readLiveLedger(userId: string, day: string): LiveLedger {
  return liveLedgerFor(readJson(liveKey(userId)), day)
}

export function writeLiveLedger(userId: string, l: LiveLedger): void {
  writeRaw(liveKey(userId), JSON.stringify({ day: l.day, usedMs: l.usedMs }))
}

// ── Anúncio da tela inicial ──

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/

// O dia de Brasília ('AAAA-MM-DD') em que o anúncio da tela inicial apareceu por último.
export function readHomeAdDay(userId: string): string | null {
  const raw = readRaw(homeAdKey(userId))
  return raw && DAY_FORMAT.test(raw) ? raw : null
}

export function writeHomeAdDay(userId: string, day: string): void {
  writeRaw(homeAdKey(userId), day)
}

// Um anúncio grande por sessão: vale até recarregar o app (fica só na memória).
let bigAdShown = false

export function bigAdShownThisSession(): boolean {
  return bigAdShown
}

export function markBigAdShown(): void {
  if (bigAdShown) return
  bigAdShown = true
  changed()
}

// ── Aviso de mudança ──

function onStorage(e: StorageEvent): void {
  // Chave nula: a outra janela limpou o armazenamento inteiro.
  if (e.key === null || e.key.startsWith(PREFIX)) changed()
}

export function subscribeLivre(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    if (!listeners.delete(cb)) return
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function livreVersion(): number {
  return version
}
