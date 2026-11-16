import { describe, expect, it } from 'vitest'
import type { ChannelRole } from '../types'
import type { OutputPlan, OutputSettings } from './stageContracts'
import { DEFAULT_OUTPUTS, OUTPUTS_MIGRATED_KEY, OUTPUTS_MIGRATED_VALUE, OUTPUT_WARNING_TEXT, effectivePan, migrateOutputs, multiChoices, outputSummary, planOutputs, sanitizeOutputs } from './outputPlan'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = ['next', 'play', 'cancel', 'start', 'repeat', 'section', 'edit', 'settings', 'upgrade']
const ROLES: ChannelRole[] = ['click', 'guide', 'normal']
const KNOBS = [-1, -0.3, 0, 0.42, 1]

const STEREO: OutputSettings = { ...DEFAULT_OUTPUTS, mode: 'stereo' }
const MULTI: OutputSettings = { ...DEFAULT_OUTPUTS, mode: 'multi' }
const multi = (vsPair: number, click: number, guide: number): OutputSettings => ({ ...MULTI, multi: { vsPair, click, guide } })
// Mapa como pode vir do aparelho: texto de select, nulo, lixo.
const rawMulti = (m: Record<string, unknown>): OutputSettings => ({ ...MULTI, multi: m as unknown as OutputSettings['multi'] })

// Planos variados: os três modos, aparelhos de 0 a 64 canais, os dois lados e mapas válidos e inválidos.
const planosVariados: (OutputPlan & { warning: string | null })[] = []
for (const mode of ['stereo', 'split2', 'multi'] as const) for (const max of [0, 2, 3, 4, 8, 18, 64]) for (const earOnSecond of [false, true])
  for (const [vsPair, click, guide] of [[0, 2, 3], [4, 0, 1], [2, 5, 5], [1, 2, 3], [30, 0, 31]])
    planosVariados.push(planOutputs({ mode, earOnSecond, multi: { vsPair, click, guide } }, max))

describe('padrão', () => {
  it('Click e Guia separados, ouvido na saída 1, mapa VS 1/2, Click 3, Guia 4', () => {
    expect(DEFAULT_OUTPUTS).toEqual({ mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } })
  })
})

describe('planOutputs', () => {
  it('nenhum plano separado põe click ou guia do lado ou na saída da VS', () => {
    for (const mode of ['split2', 'multi'] as const) for (const max of [0, 1, 2, 3, 4, 6, 8, 18, 64]) for (const earOnSecond of [false, true])
      for (const vsPair of [-2, 0, 1, 2, 4, 30]) for (const click of [-1, 0, 1, 2, 3, 5, 40]) for (const guide of [0, 1, 3, 7]) {
        const p = planOutputs({ mode, earOnSecond, multi: { vsPair, click, guide } }, max)
        for (const o of [...p.click, ...p.guide]) expect(p.vs).not.toContain(o)
        for (const o of [...p.vs, ...p.click, ...p.guide]) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(p.channels) }
        if (p.mode === 'split2') for (const pan of [-1, -0.3, 0, 1]) {
          expect(Math.sign(effectivePan(pan, 'click', p))).toBe(earOnSecond && !p.fellBackFrom ? 1 : -1)
          expect(effectivePan(pan, 'normal', p)).toBe(-effectivePan(pan, 'guide', p))
        }
      }
  })

  // Rodada 1: o literal do brief (mapa padrão em 2 canais vira separados com Click na saída 1)
  // punha o Click na saída 1, que era da VS no mapa salvo. Ele só cai em separados quando a VS
  // salva não usa as saídas 1 e 2.
  it('2 canais com 4 ou mais escolhido cai em separados e avisa quando a VS salva não usa as saídas 1 e 2', () =>
    expect(planOutputs(multi(2, 0, 1), 2)).toMatchObject({ mode: 'split2', fellBackFrom: 'multi', click: [0], vs: [1], warning: 'poucos-canais' }))

  it('a queda pra separados põe o ouvido na saída 1 mesmo com o lado trocado', () => {
    for (const max of [NaN, Infinity, -Infinity, -1, 0, 1, 2, 3, 3.9]) for (const earOnSecond of [false, true]) for (const m of [multi(2, 0, 1), multi(4, 2, 3), multi(30, 0, 0)])
      expect(planOutputs({ ...m, earOnSecond }, max)).toEqual({ mode: 'split2', channels: 2, vs: [1], click: [0], guide: [0], panByRole: true, fellBackFrom: 'multi', warning: 'poucos-canais' })
  })

  it('mapa padrão num aparelho de 2 canais: a VS fica nas saídas 1 e 2 e Click e Guia ficam sem saída, com aviso', () => {
    for (const max of [NaN, Infinity, -1, 0, 1, 2]) for (const earOnSecond of [false, true])
      expect(planOutputs({ ...MULTI, earOnSecond }, max)).toEqual({ mode: 'multi', channels: 2, vs: [0, 1], click: [], guide: [], panByRole: true, fellBackFrom: 'multi', warning: 'sem-saida-ouvido' })
  })

  it('3 canais com a VS salva nas saídas 1 e 2: Click e Guia juntos na saída 3', () => {
    expect(planOutputs(MULTI, 3)).toEqual({ mode: 'multi', channels: 3, vs: [0, 1], click: [2], guide: [2], panByRole: true, fellBackFrom: 'multi', warning: 'poucos-canais' })
  })

  it('Click e Guia nunca caem no par da VS salvo, em placa nenhuma; mapa que cabe vale inteiro', () => {
    const falhas: string[] = []
    for (const vsPair of [0, 2, 4, 6, 30]) for (const click of [0, 1, 2, 3, 4, 5, 6, 7, 8, 29, 30, 31]) for (const guide of [0, 1, 2, 3, 5, 7, 31])
      for (const max of [0, 2, 3, 4, 5, 6, 8, 18, 32, 64]) for (const earOnSecond of [false, true]) {
        const p = planOutputs({ mode: 'multi', earOnSecond, multi: { vsPair, click, guide } }, max)
        const nome = `VS ${vsPair}, Click ${click}, Guia ${guide}, ${max} canais`
        for (const o of [...p.click, ...p.guide]) if (o === vsPair || o === vsPair + 1 || p.vs.includes(o) || o >= p.channels) falhas.push(`${nome}: ouvido na ${o}`)
        if (p.channels >= 4 && (p.click.length !== 1 || p.guide.length !== 1)) falhas.push(`${nome}: sem saída com ${p.channels} canais`)
        const valido = ![click, guide].some((o) => o === vsPair || o === vsPair + 1)
        const cabe = p.channels >= 4 && Math.max(vsPair + 1, click, guide) < p.channels
        if (valido && cabe && (p.vs[0] !== vsPair || p.click[0] !== click || p.guide[0] !== guide || p.warning !== null)) falhas.push(`${nome}: mapa trocado`)
      }
    expect(falhas).toEqual([])
  })

  it('placa menor com o mesmo cabeamento: Click e Guia vão pra saídas livres, fora do par da VS', () => {
    expect(planOutputs(multi(2, 4, 5), 4)).toEqual({ mode: 'multi', channels: 4, vs: [2, 3], click: [0], guide: [1], panByRole: true, fellBackFrom: null, warning: 'mapa-ajustado' })
    expect(planOutputs(multi(2, 4, 5), 5)).toEqual({ mode: 'multi', channels: 5, vs: [2, 3], click: [4], guide: [0], panByRole: true, fellBackFrom: null, warning: 'mapa-ajustado' })
  })

  it('campo do mapa que veio como texto de select é lido campo a campo, sem perder o par da VS', () => {
    expect(planOutputs(rawMulti({ vsPair: 2, click: 0, guide: '1' }), 8)).toMatchObject({ mode: 'multi', vs: [2, 3], click: [0], guide: [1], warning: null })
    expect(planOutputs(rawMulti({ vsPair: ' 4 ', click: '0', guide: '1' }), 8)).toMatchObject({ vs: [4, 5], click: [0], guide: [1], warning: null })
    expect(planOutputs(rawMulti({ vsPair: 2, click: 0, guide: 'x' }), 8)).toMatchObject({ vs: [2, 3], click: [0], guide: [1], warning: 'mapa-ajustado' })
    expect(planOutputs(rawMulti({ vsPair: 2, click: '1.5', guide: null }), 8)).toMatchObject({ vs: [2, 3], click: [0], guide: [1], warning: 'mapa-ajustado' })
  })

  it('par da VS ilegível: assume o par que não pega Click e Guia legíveis (de preferência 1/2)', () => {
    expect(planOutputs(rawMulti({ vsPair: 'x', click: 0, guide: 1 }), 8)).toMatchObject({ vs: [2, 3], click: [0], guide: [1], warning: 'mapa-ajustado' })
    expect(planOutputs(rawMulti({ vsPair: null, click: 2, guide: 3 }), 8)).toMatchObject({ vs: [0, 1], click: [2], guide: [3], warning: 'mapa-ajustado' })
    expect(planOutputs(rawMulti({ vsPair: null, click: 2, guide: 3 }), 2)).toMatchObject({ vs: [0, 1], click: [], guide: [], warning: 'sem-saida-ouvido' })
    expect(planOutputs(rawMulti({ vsPair: null, click: 0, guide: 1 }), 2)).toMatchObject({ mode: 'split2', vs: [1], click: [0], warning: 'poucos-canais' })
    expect(planOutputs(rawMulti({}), 8)).toMatchObject({ vs: [0, 1], click: [2], guide: [3], warning: 'mapa-ajustado' })
    expect(planOutputs({ ...MULTI, multi: undefined as unknown as OutputSettings['multi'] }, 8)).toMatchObject({ vs: [0, 1], click: [2], guide: [3] })
  })

  it('tudo junto: as duas saídas pra todo mundo, sem pan pelo papel', () => {
    for (const max of [NaN, 0, 2, 8, 64]) for (const earOnSecond of [false, true])
      expect(planOutputs({ ...STEREO, earOnSecond }, max)).toEqual({ mode: 'stereo', channels: 2, vs: [0, 1], click: [0, 1], guide: [0, 1], panByRole: false, fellBackFrom: null, warning: null })
  })

  it('separados: Click e Guia no lado do ouvido, VS no outro, com 2 canais em qualquer placa', () => {
    for (const max of [2, 8, 64]) {
      expect(planOutputs(DEFAULT_OUTPUTS, max)).toEqual({ mode: 'split2', channels: 2, vs: [1], click: [0], guide: [0], panByRole: true, fellBackFrom: null, warning: null })
      expect(planOutputs({ ...DEFAULT_OUTPUTS, earOnSecond: true }, max)).toEqual({ mode: 'split2', channels: 2, vs: [0], click: [1], guide: [1], panByRole: true, fellBackFrom: null, warning: null })
    }
  })

  it('4 ou mais: mapa válido vale, com os canais da placa até 32', () => {
    expect(planOutputs(MULTI, 4)).toEqual({ mode: 'multi', channels: 4, vs: [0, 1], click: [2], guide: [3], panByRole: true, fellBackFrom: null, warning: null })
    expect(planOutputs(multi(4, 0, 1), 8)).toEqual({ mode: 'multi', channels: 8, vs: [4, 5], click: [0], guide: [1], panByRole: true, fellBackFrom: null, warning: null })
    expect(planOutputs(multi(30, 0, 29), 64)).toMatchObject({ channels: 32, vs: [30, 31], click: [0], guide: [29], warning: null })
    expect(planOutputs(MULTI, 18).channels).toBe(18)
    expect(planOutputs(MULTI, 6.7).channels).toBe(6)
  })

  it('4 ou mais: Click e Guia podem dividir a mesma saída', () => {
    expect(planOutputs(multi(0, 2, 2), 4)).toMatchObject({ mode: 'multi', vs: [0, 1], click: [2], guide: [2] })
  })

  it('4 ou mais: mapa inválido é corrigido campo a campo, longe da VS, e avisa', () => {
    // [vsPair, click, guide, canais] -> [início do par da VS, click, guia]
    const invalidos: [number, number, number, number, number, number, number][] = [
      [1, 2, 3, 8, 0, 2, 3], [-2, 2, 3, 8, 0, 2, 3], [2.5, 4, 5, 8, 0, 4, 5], [NaN, 2, 3, 8, 0, 2, 3], // par ilegível
      [4, 0, 1, 4, 2, 0, 1], [6, 0, 1, 7, 2, 0, 1], [32, 0, 1, 64, 2, 0, 1], // par fora da placa: outro par, longe de Click e Guia
      [0, 1, 3, 8, 0, 2, 3], [0, 0, 3, 8, 0, 2, 3], [0, -1, 3, 8, 0, 2, 3], [0, 8, 3, 8, 0, 2, 3], [0, 2.5, 3, 8, 0, 2, 3], [0, Infinity, 3, 8, 0, 2, 3], // click
      [0, 2, 1, 8, 0, 2, 3], [0, 2, 4, 4, 0, 2, 3], [0, 2, NaN, 8, 0, 2, 3], [2, 0, 3, 8, 2, 0, 1], // guia
    ]
    for (const [vsPair, click, guide, max, vs, c, g] of invalidos)
      expect(planOutputs(multi(vsPair, click, guide), max)).toMatchObject({ mode: 'multi', vs: [vs, vs + 1], click: [c], guide: [g], fellBackFrom: null, warning: 'mapa-ajustado' })
  })

  it('não muda as configurações recebidas', () => {
    const s = multi(1, 0, 0)
    planOutputs(s, 8)
    expect(s).toEqual(multi(1, 0, 0))
  })
})

describe('effectivePan', () => {
  it('tudo junto usa o pan do knob; 4 ou mais usa o knob só na VS', () => {
    const stereo = planOutputs(STEREO, 8)
    const many = planOutputs(MULTI, 8)
    for (const pan of KNOBS) {
      for (const role of ROLES) expect(effectivePan(pan, role, stereo)).toBe(pan)
      expect(effectivePan(pan, 'normal', many)).toBe(pan)
      expect(effectivePan(pan, 'click', many)).toBe(-1)
      expect(effectivePan(pan, 'guide', many)).toBe(-1)
    }
  })

  it('separados força o lado pelo papel e ignora o knob, como o pan automático da v1.4.15', () => {
    const ear1 = planOutputs(DEFAULT_OUTPUTS, 2)
    const ear2 = planOutputs({ ...DEFAULT_OUTPUTS, earOnSecond: true }, 2)
    const caiu = planOutputs({ ...multi(2, 0, 1), earOnSecond: true }, 2)
    for (const pan of KNOBS) {
      expect([effectivePan(pan, 'click', ear1), effectivePan(pan, 'guide', ear1), effectivePan(pan, 'normal', ear1)]).toEqual([-1, -1, 1])
      expect([effectivePan(pan, 'click', ear2), effectivePan(pan, 'guide', ear2), effectivePan(pan, 'normal', ear2)]).toEqual([1, 1, -1])
      expect([effectivePan(pan, 'click', caiu), effectivePan(pan, 'guide', caiu), effectivePan(pan, 'normal', caiu)]).toEqual([-1, -1, 1])
    }
  })

  it('pan do knob fora da faixa ou inválido não chega no panner', () => {
    const stereo = planOutputs(STEREO, 2)
    const many = planOutputs(MULTI, 8)
    for (const p of [stereo, many]) {
      expect(effectivePan(NaN, 'normal', p)).toBe(0)
      expect(effectivePan(Infinity, 'normal', p)).toBe(0)
      expect(effectivePan(3, 'normal', p)).toBe(1)
      expect(effectivePan(-2, 'normal', p)).toBe(-1)
    }
    expect(effectivePan(NaN, 'click', many)).toBe(-1)
    expect(effectivePan(NaN, 'normal', planOutputs(DEFAULT_OUTPUTS, 2))).toBe(1)
  })
})

describe('sanitizeOutputs', () => {
  it('configuração válida volta igual, como cópia nova', () => {
    for (const s of [DEFAULT_OUTPUTS, STEREO, { ...DEFAULT_OUTPUTS, earOnSecond: true }, multi(4, 0, 1)]) {
      const out = sanitizeOutputs(s)
      expect(out).toEqual(s)
      expect(out).not.toBe(s)
      expect(out?.multi).not.toBe(s.multi)
    }
  })

  it('sem modo conhecido é nulo', () => {
    for (const raw of [undefined, null, 'split2', 2, true, [], ['split2'], {}, { mode: 'mono' }, { mode: 'SPLIT2' }, { mode: null }])
      expect(sanitizeOutputs(raw)).toBeNull()
  })

  it('modo conhecido com o resto estragado guarda o modo e corrige o mapa campo a campo', () => {
    expect(sanitizeOutputs({ mode: 'multi' })).toEqual({ mode: 'multi', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } })
    expect(sanitizeOutputs({ mode: 'split2', earOnSecond: 'true' })).toEqual({ ...DEFAULT_OUTPUTS, earOnSecond: false })
    const casos: [unknown, [number, number, number]][] = [
      [null, [0, 2, 3]], ['x', [0, 2, 3]], [{ vsPair: 0, click: 2 }, [0, 2, 3]], [{ vsPair: 0, click: 2, guide: '3' }, [0, 2, 3]],
      [{ vsPair: -2, click: 2, guide: 3 }, [0, 2, 3]], [{ vsPair: 0, click: 2.5, guide: 3 }, [0, 2, 3]], [{ vsPair: 0, click: 2, guide: 32 }, [0, 2, 3]],
      [{ vsPair: 1, click: 3, guide: 4 }, [0, 3, 4]], [{ vsPair: 30, click: 2, guide: 31 }, [30, 2, 3]], [{ vsPair: 0, click: 1, guide: 3 }, [0, 2, 3]],
      [{ vsPair: 2, click: 0, guide: '1' }, [2, 0, 1]], [{ vsPair: '2', click: '0', guide: 'x' }, [2, 0, 1]], [{ vsPair: 'x', click: 0, guide: 1 }, [2, 0, 1]],
    ]
    for (const [bad, [vsPair, click, guide]] of casos)
      expect(sanitizeOutputs({ mode: 'multi', earOnSecond: true, multi: bad })).toEqual({ mode: 'multi', earOnSecond: true, multi: { vsPair, click, guide } })
  })

  it('guarda o mapa escolhido numa placa maior mesmo que não caiba na placa de agora', () => {
    expect(sanitizeOutputs({ mode: 'multi', earOnSecond: false, multi: { vsPair: 6, click: 0, guide: 1 } })?.multi).toEqual({ vsPair: 6, click: 0, guide: 1 })
  })

  it('só os campos conhecidos voltam', () => {
    expect(sanitizeOutputs({ ...DEFAULT_OUTPUTS, extra: 1, multi: { vsPair: 0, click: 2, guide: 3, bus: '1' } })).toEqual(DEFAULT_OUTPUTS)
  })
})

describe('migrateOutputs', () => {
  it('migração: pan automático (padrão) vira separados, desliga e zera os pans uma vez', () => {
    expect(migrateOutputs({ autoPan: true })).toEqual({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: true })
    expect(migrateOutputs({})).toMatchObject({ resetLegacyPans: true }); expect(migrateOutputs({ autoPan: false })).toMatchObject({ outputs: { mode: 'stereo' }, resetLegacyPans: false })
    expect(migrateOutputs({ autoPan: true, outputs: { ...DEFAULT_OUTPUTS, mode: 'stereo' } })).toMatchObject({ outputs: { mode: 'stereo' }, resetLegacyPans: false })
  })

  it('pan automático desligado vira tudo junto, sem zerar pan nenhum', () => {
    expect(migrateOutputs({ autoPan: false })).toEqual({ outputs: STEREO, autoPan: false, resetLegacyPans: false })
    expect(migrateOutputs({ autoPan: false, outputs: { mode: 'x' } })).toEqual({ outputs: STEREO, autoPan: false, resetLegacyPans: false })
  })

  it('qualquer outro valor do pan automático conta como o padrão ligado', () => {
    for (const autoPan of [undefined, null, 'false', 0, 1, {}])
      expect(migrateOutputs({ autoPan })).toEqual({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: true })
    expect(migrateOutputs({ autoPan: true, outputs: 'split2' })).toEqual({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: true })
  })

  it('saídas já gravadas vencem e guardam o interruptor do pan automático', () => {
    expect(migrateOutputs({ autoPan: true, outputs: STEREO })).toEqual({ outputs: STEREO, autoPan: true, resetLegacyPans: false })
    expect(migrateOutputs({ autoPan: false, outputs: multi(4, 0, 1) })).toEqual({ outputs: multi(4, 0, 1), autoPan: false, resetLegacyPans: false })
    expect(migrateOutputs({ outputs: DEFAULT_OUTPUTS })).toEqual({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: false })
  })

  it('nunca entrega o objeto do padrão pra quem chamou', () => {
    const m = migrateOutputs({})
    expect(m.outputs).not.toBe(DEFAULT_OUTPUTS)
    m.outputs.multi.click = 7
    m.outputs.mode = 'stereo'
    expect(DEFAULT_OUTPUTS).toEqual({ mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } })
    expect(migrateOutputs({ autoPan: false }).outputs.multi).not.toBe(DEFAULT_OUTPUTS.multi)
  })
})

describe('depois da migração (Ruling T6-1)', () => {
  // Os 6 valores estragados da sonda da revisão.
  const ESTRAGADOS: unknown[] = [undefined, null, '{', {}, { mode: 'SPLIT2' }, { mode: null, earOnSecond: true }]

  it('marcador numa chave própria do aparelho, fora das configurações', () => {
    expect(OUTPUTS_MIGRATED_KEY).toBe('mt_outputs_migrated')
    expect(OUTPUTS_MIGRATED_KEY).not.toBe('mt_app_settings')
    expect(OUTPUTS_MIGRATED_VALUE).toBe('1')
  })

  it('com o marcador, modo ilegível vira Click e Guia separados, nunca tudo junto, e não zera pan nenhum', () => {
    for (const outputs of ESTRAGADOS) for (const autoPan of [false, true, undefined, 'x']) {
      const m = migrateOutputs({ autoPan, outputs, outputsMigrated: true })
      expect(m.outputs.mode).toBe('split2')
      expect(m.resetLegacyPans).toBe(false)
      expect(m.autoPan).toBe(autoPan === true)
    }
    expect(migrateOutputs({ autoPan: false, outputs: { mode: null, earOnSecond: true }, outputsMigrated: true }).outputs).toEqual({ ...DEFAULT_OUTPUTS, earOnSecond: true })
  })

  it('com o marcador, guarda o lado e o mapa quando dá pra ler', () => {
    expect(migrateOutputs({ outputs: { mode: 'quatro', earOnSecond: true, multi: { vsPair: 4, click: 0, guide: '1' } }, outputsMigrated: true }).outputs)
      .toEqual({ mode: 'split2', earOnSecond: true, multi: { vsPair: 4, click: 0, guide: 1 } })
  })

  it('com o marcador, saídas gravadas e válidas continuam como estão (tudo junto também)', () => {
    expect(migrateOutputs({ autoPan: true, outputs: STEREO, outputsMigrated: true })).toMatchObject({ outputs: STEREO, autoPan: true, resetLegacyPans: false })
    expect(migrateOutputs({ autoPan: false, outputs: multi(4, 0, 1), outputsMigrated: true })).toMatchObject({ outputs: multi(4, 0, 1), resetLegacyPans: false })
  })

  it('só true conta como marcador', () => {
    for (const outputsMigrated of ['true', '1', 1, {}, null, false]) {
      expect(migrateOutputs({ autoPan: false, outputs: undefined, outputsMigrated })).toMatchObject({ outputs: STEREO, resetLegacyPans: false })
      expect(migrateOutputs({ autoPan: true, outputsMigrated })).toMatchObject({ outputs: DEFAULT_OUTPUTS, autoPan: false, resetLegacyPans: true })
    }
  })

  it('sanitizeOutputs com migrated nunca é nulo e o modo ilegível vira separados', () => {
    for (const raw of [...ESTRAGADOS, 'split2', 2, [], { mode: 'mono' }]) {
      const out = sanitizeOutputs(raw, { migrated: true })
      expect(out).not.toBeNull()
      expect(out.mode).toBe('split2')
      expect(sanitizeOutputs(raw)).toBeNull()
      expect(sanitizeOutputs(raw, { migrated: 'true' as unknown as boolean })).toBeNull()
    }
    expect(sanitizeOutputs(STEREO, { migrated: true })).toEqual(STEREO)
  })
})

describe('multiChoices', () => {
  it('pares da VS começam em saída ímpar (1/2, 3/4...) e as avulsas são todas as saídas', () => {
    expect(multiChoices(4)).toEqual({ vsPairs: [0, 2], singles: [0, 1, 2, 3] })
    expect(multiChoices(5)).toEqual({ vsPairs: [0, 2], singles: [0, 1, 2, 3, 4] })
    expect(multiChoices(8)).toEqual({ vsPairs: [0, 2, 4, 6], singles: [0, 1, 2, 3, 4, 5, 6, 7] })
  })

  it('aparelho estranho conta como 2 canais e placa grande para em 32', () => {
    for (const max of [NaN, Infinity, -3, 0, 1, 2, 2.9]) expect(multiChoices(max)).toEqual({ vsPairs: [0], singles: [0, 1] })
    const big = multiChoices(64)
    expect(big.singles).toHaveLength(32)
    expect(big.vsPairs).toHaveLength(16)
    expect(big.vsPairs.at(-1)).toBe(30)
  })

  it('toda escolha oferecida, com Click e Guia fora do par, vira um plano que vale', () => {
    for (const max of [4, 5, 8, 18]) {
      const { vsPairs, singles } = multiChoices(max)
      for (const vsPair of vsPairs) for (const click of singles) for (const guide of singles) {
        if ([click, guide].some((o) => o === vsPair || o === vsPair + 1)) continue
        expect(planOutputs(multi(vsPair, click, guide), max)).toMatchObject({ mode: 'multi', vs: [vsPair, vsPair + 1], click: [click], guide: [guide] })
      }
    }
  })
})

describe('outputSummary', () => {
  it('resumo de cada modo, com as saídas contadas a partir de 1', () => {
    expect(outputSummary(planOutputs(STEREO, 2))).toBe('Tudo junto nas saídas 1 e 2')
    expect(outputSummary(planOutputs(DEFAULT_OUTPUTS, 2))).toBe('Click e Guia na saída 1 · VS na saída 2')
    expect(outputSummary(planOutputs({ ...DEFAULT_OUTPUTS, earOnSecond: true }, 2))).toBe('Click e Guia na saída 2 · VS na saída 1')
    expect(outputSummary(planOutputs(MULTI, 4))).toBe('VS nas saídas 1 e 2 · Click na 3 · Guia na 4')
    expect(outputSummary(planOutputs(multi(4, 0, 1), 8))).toBe('VS nas saídas 5 e 6 · Click na 1 · Guia na 2')
    expect(outputSummary(planOutputs(multi(0, 2, 2), 4))).toBe('VS nas saídas 1 e 2 · Click e Guia na 3')
    expect(outputSummary(planOutputs(multi(2, 0, 1), 2))).toBe('Click e Guia na saída 1 · VS na saída 2')
    expect(outputSummary(planOutputs(MULTI, 2))).toBe('VS nas saídas 1 e 2 · Click e Guia sem saída')
  })

  it('resumo em português sem travessão', () => {
    expect(planosVariados.length).toBeGreaterThan(100)
    for (const p of planosVariados) {
      const s = outputSummary(p)
      expect(s).not.toContain(TRAVESSAO)
      expect(s).not.toMatch(/undefined|NaN|null/)
      for (const w of PROIBIDAS) expect(s.toLowerCase()).not.toContain(w)
    }
  })

  it('aviso de cada plano tem texto em português, sem travessão', () => {
    const vistos = new Set(planosVariados.map((p) => p.warning).filter((w) => w !== null))
    expect([...vistos].sort()).toEqual(['mapa-ajustado', 'poucos-canais', 'sem-saida-ouvido'])
    for (const text of Object.values(OUTPUT_WARNING_TEXT)) {
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain(TRAVESSAO)
      for (const w of PROIBIDAS) expect(text.toLowerCase()).not.toContain(w)
    }
  })
})
