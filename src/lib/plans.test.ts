// Regras de recurso por plano (Parte 3, Livre como amostra, spec seção 5). Cada recurso tem a
// sua função em plans.ts; o Livre ganha o que roda no aparelho e não custa nada, e quem paga
// continua com tudo de antes.
import { describe, expect, it } from 'vitest'
import {
  ALL_STEM_COUNTS,
  canBandControlSections,
  canChangeKey,
  canDownloadStems,
  canUseBpmDetection,
  canUseCloudPads,
  canUseGeneratedClick,
  canUseLiveMode,
  canUsePlatformCatalog,
  canUseRepertoire,
  canUseSections,
  canUseVoiceGuide,
  liveDailyLimitMs,
  maxLiveDevices,
  maxSeparationsPerMonth,
  maxStageSongsPerMonth,
  separationStemOptions,
} from './plans'

// Os 5 IDs internos de hoje, o legado 'gratuito' e a conta sem plano lido.
const LIVRE = ['free', 'gratuito', null, undefined, 'plano-que-nao-existe'] as const
const PRO = ['essencial_mensal', 'essencial_anual'] as const
const STUDIO = ['pro_mensal', 'pro_anual'] as const
const PAGOS = [...PRO, ...STUDIO] as const
const TODOS = [...LIVRE, ...PAGOS] as const

describe('plans: Livre como amostra', () => {
  it('Livre: 3 separações em 4 ou 6 faixas; Pro 50 e Studio 150 em 2, 4 ou 6', () => {
    expect(maxSeparationsPerMonth('free')).toBe(3)
    expect(separationStemOptions('free')).toEqual([4, 6])
    expect(separationStemOptions('pro_anual')).toEqual([2, 4, 6])
    for (const id of LIVRE) {
      expect(maxSeparationsPerMonth(id)).toBe(3)
      expect(separationStemOptions(id)).toEqual([4, 6])
    }
    for (const id of PRO) expect(maxSeparationsPerMonth(id)).toBe(50)
    for (const id of STUDIO) expect(maxSeparationsPerMonth(id)).toBe(150)
    for (const id of PAGOS) expect(separationStemOptions(id)).toEqual([2, 4, 6])
    // A lista completa (a do admin no Separador) é a mesma de quem paga.
    expect(ALL_STEM_COUNTS).toEqual([2, 4, 6])
  })

  it('Livre: 3 músicas por mês no palco; pagos sem limite', () => {
    expect(maxStageSongsPerMonth('free')).toBe(3)
    expect(maxStageSongsPerMonth('essencial_mensal')).toBe(Infinity)
    for (const id of LIVRE) expect(maxStageSongsPerMonth(id)).toBe(3)
    for (const id of PAGOS) expect(maxStageSongsPerMonth(id)).toBe(Infinity)
  })

  it('Livre: Ao Vivo com 1 celular e 10 minutos por dia; Pro 4 e Studio sem limite, sem teto de tempo', () => {
    expect(maxLiveDevices('free')).toBe(1)
    expect(liveDailyLimitMs('free')).toBe(600_000)
    expect(liveDailyLimitMs('pro_mensal')).toBeNull()
    for (const id of TODOS) expect(canUseLiveMode(id)).toBe(true)
    for (const id of LIVRE) {
      expect(maxLiveDevices(id)).toBe(1)
      expect(liveDailyLimitMs(id)).toBe(600_000)
    }
    for (const id of PRO) expect(maxLiveDevices(id)).toBe(4)
    for (const id of STUDIO) expect(maxLiveDevices(id)).toBe(Infinity)
    for (const id of PAGOS) expect(liveDailyLimitMs(id)).toBeNull()
  })

  it('voz guia, BPM pela IA, click gerado, seções, tom e catálogo abertos pra todos', () => {
    for (const id of TODOS) {
      expect(canUseVoiceGuide(id)).toBe(true)
      expect(canUseBpmDetection(id)).toBe(true)
      expect(canUseGeneratedClick(id)).toBe(true)
      expect(canUseSections(id)).toBe(true)
      expect(canChangeKey(id)).toBe(true)
      expect(canUsePlatformCatalog(id)).toBe(true)
    }
  })

  it('baixar, pads da nuvem e repertório seguem pagos; banda nas seções só no Studio', () => {
    for (const id of LIVRE) {
      expect(canDownloadStems(id)).toBe(false)
      expect(canUseCloudPads(id)).toBe(false)
      expect(canUseRepertoire(id)).toBe(false)
      expect(canBandControlSections(id)).toBe(false)
    }
    for (const id of PAGOS) {
      expect(canDownloadStems(id)).toBe(true)
      expect(canUseCloudPads(id)).toBe(true)
      expect(canUseRepertoire(id)).toBe(true)
    }
    for (const id of PRO) expect(canBandControlSections(id)).toBe(false)
    for (const id of STUDIO) expect(canBandControlSections(id)).toBe(true)
  })

  it('o ID vale em maiúsculas, como o planTier', () => {
    expect(separationStemOptions('PRO_ANUAL')).toEqual([2, 4, 6])
    expect(maxStageSongsPerMonth('Essencial_Mensal')).toBe(Infinity)
    expect(canUseCloudPads('FREE')).toBe(false)
  })
})
