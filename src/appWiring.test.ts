// Ligações do palco novo no App (T29), conferidas no texto do código com expressões tolerantes
// (Ruling 5 da Parte 1): o App inteiro não monta no teste, então aqui fica o que não pode sumir.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const app = read('./App.tsx')
const main = read('../electron/main.ts')
const settingsModal = read('./components/SettingsModal.tsx')
const TRAVESSAO = String.fromCharCode(0x2014)

describe('ligações do palco novo', () => {
  it('electron/main.ts liga backgroundThrottling: false', () => expect(main).toMatch(/backgroundThrottling\s*:\s*false/))

  it('o atalho antigo sai cedo com o palco novo', () => expect(app).toMatch(/if\s*\(\s*useNewStage\s*\)\s*return/))

  it('o App monta o StageShell e passa o stageMode pro motor', () => {
    expect(app).toMatch(/<StageShell[\s>]/)
    expect(app).toMatch(/stageMode/)
    // Uma decisão só (R-25): a chave "novo" E a tela larga, e o motor recebe o mesmo valor.
    expect(app).toMatch(/stageVersion\s*===\s*'novo'\s*&&\s*wide/)
    expect(app).toMatch(/stageMode\s*:\s*useNewStage\s*\?\s*'novo'\s*:\s*'antigo'/)
  })

  it('COMEÇO tocando arma a primeira seção pela API de seção armada; senão volta pro 0:00 (Ruling I3-comeco)', () => {
    expect(app).toMatch(/goToStart:\s*\(\)\s*=>\s*\{\s*if\s*\(\s*startAction\(\s*isPlaying\s*,\s*sectionSpansView\.length\s*,\s*sectionGates\s*\)\s*===\s*'arm'\s*\)\s*upgradeIf\(\s*armSection\(\s*0\s*\)\s*\)\s*else\s*seekTo\(\s*0\s*\)/)
  })

  it('nenhum window.prompt no App (o Electron lança "prompt() is not supported"): renomear e o metrônomo infinito usam o diálogo do app', () => {
    expect(app).not.toMatch(/\bprompt\s*\(/)
    expect(app).toMatch(/<TextPromptDialog[\s\S]*?createEndlessMetronomeSong\(/)
    expect(app).toMatch(/<TextPromptDialog[\s\S]*?renameSong\(/)
  })

  it('o palco novo define e redefine o tom original com a ação do palco antigo (setOriginalKey e tom de volta pro 0)', () => {
    expect(app).toMatch(/setOriginalKey:\s*\(key: string \| null\)\s*=>\s*handlePremiumFeature\(\(\)\s*=>\s*\{\s*setOriginalKey\(key\);\s*changePitch\(0\)\s*\}\)/)
  })

  it('o motor recebe o click gerado pelo plano e os portões das seções', () => {
    expect(app).toMatch(/autoClick\s*:\s*canUseBpmDetection\(\s*userPlan\s*\)/)
    expect(app).toMatch(/sectionGates/)
  })

  it('o compasso salvo da biblioteca chega no loadFiles (sem ele o click que falta nunca é gerado)', () => {
    expect(app).toMatch(/timeSignature\s*:\s*extra\?\.timeSignature/)
  })

  it('o Metrônomo recebe o compasso da grade da música', () => expect(app).toMatch(/<MetronomeModal[^>]*initialSignature=/s))

  it('o palco recebe o aviso das saídas do plano', () => expect(app).toMatch(/outputWarning=\{\s*outputPlan\.warning\s*\}/))

  it('os nomes dos 12 tons vêm do KEY_NAMES (nenhuma cópia do array no App)', () => {
    expect(app).toMatch(/KEY_NAMES/)
    expect(app).not.toMatch(/\[\s*'C'\s*,\s*'C#'\s*,\s*'D'/)
  })

  it('a banda comanda as seções só pelos adaptadores do motor, com o portão do Studio', () => {
    expect(app).toMatch(/case 'arm-jump':[^\n]*canBandControlSections\(userPlan\)[^\n]*armJump\(/)
    expect(app).toMatch(/case 'arm-loop':[^\n]*canBandControlSections\(userPlan\)[^\n]*armLoop\(/)
    expect(app).toMatch(/case 'cancel-loop':[^\n]*canBandControlSections\(userPlan\)[^\n]*cancelLoop\(/)
  })

  it('tour do palco novo com os textos novos', () => {
    expect(app).toContain('A lista do repertório e as Anotações ficam no painel REPERTÓRIOS.')
    expect(app).toContain('Toque numa seção pra armar: ela termina, conta 1-2-3-4 no click e entra no 1.')
    expect(app).toContain('REPETIR com o número de vezes, ou ∞ e LOOP pra repetir sem parar.')
    expect(app).toContain('Tocar de novo na seção armada, no X do aviso ou Esc cancela.')
    expect(app).toContain('Teclas 1 a 9 armam, setas trocam de seção, Shift + setas andam 5 s; marcar seções fica no EDITAR.')
    expect(app).toContain('Ajustes do app, saídas de áudio (Click e Guia separados da VS) e a chave do palco. É aqui também que você reabre este tutorial.')
  })

  it('Configurações: chave do palco primeiro na aba Geral, saídas junto do seletor do aparelho', () => {
    const stage = settingsModal.indexOf('<StageVersionSetting')
    const outputs = settingsModal.indexOf('<AudioOutputsSection')
    const device = settingsModal.indexOf('<AudioOutputSelect')
    const tutorial = settingsModal.indexOf('Ver tutorial')
    expect(stage).toBeGreaterThan(0)
    expect(stage).toBeLessThan(tutorial)
    expect(outputs).toBeGreaterThan(0)
    expect(device).toBeGreaterThan(0)
    expect(Math.abs(outputs - device)).toBeLessThan(1500)
  })

  it('nenhum travessão nas linhas novas do App, das Configurações e do Electron', () => {
    for (const text of [app, settingsModal, main]) {
      for (const line of text.split('\n')) if (/StageShell|useNewStage|stageMode|StageVersionSetting|AudioOutputsSection|backgroundThrottling/.test(line)) expect(line).not.toContain(TRAVESSAO)
    }
  })
})
