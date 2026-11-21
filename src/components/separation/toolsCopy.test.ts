// Revisão sep-2 M2: o motivo de um erro só aparece na tela quando é uma frase pra quem usa. Código
// HTTP, erro de rede, do servidor ou em inglês vira a frase de reserva (nada técnico na tela).
import { describe, expect, it } from 'vitest'
import { CLOUD_COPY, VOICE_COPY, friendlyReason } from './toolsCopy'
import { PROGRESS_COPY } from '../separator/separatorCopy'

const TRAVESSAO = String.fromCharCode(0x2014)

describe('friendlyReason e as frases de erro', () => {
  it('deixa passar a frase em português pra quem usa', () => {
    for (const ok of ['sem permissão', 'Você chegou no limite de separações deste mês.', 'Sessão expirada. Faça login novamente.', 'Sem faixas para analisar']) {
      expect(friendlyReason(ok)).toBe(ok)
    }
  })

  it('código HTTP, rede, servidor e inglês não aparecem', () => {
    for (const bad of [
      'HTTP 500', 'Falha no upload server-side: HTTP 502', 'Failed to fetch', 'NetworkError when attempting to fetch resource.',
      'Load failed', 'Unable to decode audio data', 'new row violates row-level security policy', 'Unexpected token < in JSON at position 0',
      'TypeError: x is undefined', '', '   ',
    ]) expect(friendlyReason(bad)).toBeNull()
  })

  it('publicar, detectar a voz guia e separar usam a frase de reserva quando o motivo é técnico', () => {
    expect(CLOUD_COPY.error('sem permissão')).toBe('Erro ao salvar: sem permissão')
    expect(CLOUD_COPY.error('HTTP 500')).toBe('Não deu pra salvar agora. Confira a internet e tente de novo.')
    expect(VOICE_COPY.detectError('Sem faixas para analisar')).toBe('Não foi possível analisar a estrutura: Sem faixas para analisar')
    expect(VOICE_COPY.detectError('Unable to decode audio data')).toBe('Não foi possível analisar a estrutura do áudio. Tente de novo.')
    expect(PROGRESS_COPY.processError('Sessão expirada. Faça login novamente.')).toBe('Erro no processamento: Sessão expirada. Faça login novamente.')
    expect(PROGRESS_COPY.processError('Failed to fetch')).toBe('Não deu pra separar agora. Confira a internet e tente de novo.')
    for (const t of [CLOUD_COPY.error('HTTP 500'), VOICE_COPY.detectError('x is undefined'), PROGRESS_COPY.processError('Load failed')]) {
      expect(t).not.toContain(TRAVESSAO)
    }
  })
})
