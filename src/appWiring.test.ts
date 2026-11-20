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
    expect(app).toMatch(/setOriginalKey:\s*\(key: string \| null\)\s*=>\s*\w+\(\s*canChangeKey\(\s*userPlan\s*\)\s*,\s*\(\)\s*=>\s*\{\s*setOriginalKey\(key\);\s*changePitch\(0\)\s*\}\s*\)/)
  })

  it('marcadores e letra acham a música da nuvem pela id (sourceId), nunca pelo nome com "contém"', () => {
    expect(app).not.toMatch(/\.includes\(\s*cs\.name\s*\)|cs\.name\.includes\(/)
    expect(app.match(/cloudSongOf\(\s*await fetchCloudSongs\(\)\s*,\s*activeSong\s*\)/g)).toHaveLength(2)
    expect(app).toContain('os marcadores ficam só neste aparelho')
  })

  it('o motor recebe autoClick: canUseGeneratedClick(userPlan) e os portões das seções', () => {
    expect(app).toMatch(/autoClick:\s*canUseGeneratedClick\(userPlan\)/)
    expect(app).not.toMatch(/autoClick\s*:\s*canUseBpmDetection/)
    expect(app).toMatch(/sectionGates/)
  })

  it('handlePremiumFeature sumiu: tom por canChangeKey, biblioteca por canUsePlatformCatalog e pads da nuvem por canUseCloudPads', () => {
    expect(app).not.toMatch(/handlePremiumFeature/)
    // Tom: o palco novo (trocar o tom e o tom original) e o TOM do palco antigo.
    expect(app).toMatch(/changePitch:\s*\(semitones: number\)\s*=>\s*\w+\(\s*canChangeKey\(\s*userPlan\s*\)\s*,\s*\(\)\s*=>\s*changePitch\(semitones\)\s*\)/)
    expect(app).toMatch(/data-tour="tom" onClick=\{\(\) => \w+\(\s*canChangeKey\(\s*userPlan\s*\)\s*,\s*\(\)\s*=>\s*setIsKeyPickerOpen\(/)
    expect(app.match(/canChangeKey\(userPlan\)/g)).toHaveLength(3)
    // Biblioteca da plataforma: o palco novo, o botão do palco antigo e a gaveta do celular.
    expect(app).toMatch(/openLibrary:\s*\(\)\s*=>\s*\w+\(\s*canUsePlatformCatalog\(\s*userPlan\s*\)\s*,\s*\(\)\s*=>\s*setIsLibraryOpen\(true\)\s*\)/)
    expect(app.match(/\w+\(canUsePlatformCatalog\(userPlan\), \(\) => setIsLibraryOpen\(true\)\)/g)).toHaveLength(3)
    // Conjuntos de pads da nuvem, nos dois palcos.
    expect(app).toMatch(/padSets:\s*\(\)\s*=>\s*\w+\(\s*canUseCloudPads\(\s*userPlan\s*\)\s*,\s*\(\)\s*=>\s*setIsPadSetsModalOpen\(true\)\s*\)/)
    expect(app.match(/\w+\(canUseCloudPads\(userPlan\), \(\) => setIsPadSetsModalOpen\(true\)\)/g)).toHaveLength(2)
  })

  it('o painel de pads do celular abre pra todos (os pads rodam no aparelho)', () => {
    expect(app).toMatch(/<button onClick=\{\(\) => setMobileView\('pads'\)\}/)
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

  it('a biblioteca pergunta ao Livre com cloud:<id> antes de baixar', () => {
    expect(app).toMatch(/onBeforeDownload=\{\(songId\)\s*=>[\s\S]{0,200}cloud:\$\{songId\}/)
  })

  it('importar, repertório, próxima, anterior e .zip passam pelas versões com o Livre nos dois palcos', () => {
    for (const n of ['importFilesGated', 'jumpToSongGated', 'nextSongGated', 'prevSongGated', 'exportZipGated', 'importZipGated']) {
      expect(app).toMatch(new RegExp(`\\b${n}\\(`))
    }
    expect(app).not.toMatch(/onClick=\{nextSong\}|onClick=\{prevSong\}|onChange=\{handleImport\}/)
  })

  it('nenhum caminho antigo troca de música, importa ou mexe no .zip por fora das versões com o Livre (Ruling R9)', () => {
    // jumpToSong( só dentro do jumpToSongGated (o destructure do motor não tem parêntese).
    expect(app.match(/\bjumpToSong\(/g)).toHaveLength(1)
    expect(app).toMatch(/const jumpToSongGated = (?:useCallback\()?\(i: number\) => \{[^}]*\}\s*jumpToSong\(i\)/)
    // Próxima e anterior do motor só dentro das versões com o Livre.
    expect(app.match(/\bnextSong\(\)/g)).toHaveLength(1)
    expect(app).toMatch(/const nextSongGated = (?:useCallback\()?\(\) => \{[\s\S]{0,200}\bnextSong\(\)/)
    expect(app.match(/\bprevSong\(\)/g)).toHaveLength(1)
    expect(app).toMatch(/const prevSongGated = (?:useCallback\()?\(\) => \{[\s\S]{0,300}\bprevSong\(\)/)
    // Arquivos do aparelho e da biblioteca: todo loadFiles( passa pelo carregamento que abre a música no Livre.
    const loads = app.match(/\bloadFiles\(/g) ?? []
    expect(loads.length).toBeGreaterThan(0)
    expect(app.match(/loadAsCurrent\(\(\) => loadFiles\(/g)).toHaveLength(loads.length)
    expect(app).not.toMatch(/loadFiles\(e\.target\.files\)/)
    // Salvar e Carregar .zip.
    expect(app).not.toMatch(/onClick=\{handleExport\}/)
    expect(app.match(/\bhandleExport\(/g)).toHaveLength(1)
    expect(app).toMatch(/const exportZipGated = \(\) => \{[\s\S]{0,200}\bhandleExport\(\)/)
    expect(app.match(/\bimportPlaylist\(/g)).toHaveLength(1)
    expect(app).toMatch(/const importZipGated = \(file: File\) => \{[\s\S]{0,200}\bimportPlaylist\(file\)/)
  })

  it('no Livre, próxima, anterior e .zip pedem a tela do repertório; abrir outra música pede a das músicas do mês', () => {
    expect(app).toMatch(/const nextSongGated = (?:useCallback\()?\(\) => \{[\s\S]{0,200}livre\.requestLimit\('repertoire'\)/)
    expect(app).toMatch(/const prevSongGated = (?:useCallback\()?\(\) => \{[\s\S]{0,300}livre\.requestLimit\('repertoire'\)/)
    expect(app).toMatch(/const exportZipGated = \(\) => \{[\s\S]{0,200}livre\.requestLimit\('repertoire'\)/)
    expect(app).toMatch(/const importZipGated = \(file: File\) => \{[\s\S]{0,200}livre\.requestLimit\('repertoire'\)/)
    expect(app).toMatch(/const jumpToSongGated = (?:useCallback\()?\(i: number\) => \{[^}]*canOpenSong\(stageSongKey\([^}]*livre\.requestLimit\('stage-songs'\)/)
    expect(app).toMatch(/const importFilesGated = \(files: FileList\) => \{[^}]*canOpenNewSong\(\)[^}]*livre\.requestLimit\('stage-songs'\)/)
  })

  it('comandos next, prev e select-song da banda passam pelas versões com o Livre', () => {
    expect(app).toMatch(/case 'next':\s*nextSongGated\(\)/)
    expect(app).toMatch(/case 'prev':\s*prevSongGated\(\)/)
    expect(app).toMatch(/case 'select-song':[^\n]*jumpToSongGated\(/)
  })

  it('o motor recebe autoNext pelo plano', () => { expect(app).toMatch(/autoNext:\s*isAdmin\s*\|\|\s*canUseRepertoire\(userPlan\)/) })

  it('a música atual conta pelo stageSongKey', () => { expect(app).toMatch(/noteSongOpened\(stageSongKey\(/) })

  it('um useLivre só no App, depois do hostActive e antes da entrada do buildStageView, com o Ao Vivo ainda desligado', () => {
    expect(app.match(/\buseLivre\(/g)).toHaveLength(1)
    const host = app.indexOf('const hostActive =')
    const expired = app.indexOf('const onLiveExpired =')
    const hook = app.indexOf('const livre = useLivre(')
    const view = app.indexOf('const stageView =')
    expect(host).toBeGreaterThan(0)
    expect(expired).toBeGreaterThan(host)
    expect(hook).toBeGreaterThan(expired)
    expect(view).toBeGreaterThan(hook)
    expect(app).toMatch(/useLivre\(\{\s*userId: user\?\.id \?\? null,\s*plan: userPlan,\s*isAdmin,\s*busy: \{ isPlaying, isCountingIn \},\s*liveActive: false,/)
    expect(app).toMatch(/livre:\s*livre\.isLivre\s*\?\s*livre\.stage\s*:\s*null/)
  })

  it('a tela de limite está no App e desliga os atalhos', () => {
    expect(app).toMatch(/<LimitGate[\s\S]*?kind=\{livre\.limit\}/)
    expect(app).toMatch(/stageKeyboard\s*=[\s\S]{0,400}livre\.limit\s*===\s*null/)
    // Palco antigo: como o diálogo do app (textPrompt), o teclado não age por baixo da tela de limite.
    expect(app).toMatch(/if \(textPrompt !== null\) return[\s\S]{0,300}if \(livre\.limit !== null\) return/)
  })

  it('"Ver todos os planos" fecha a tela de limite antes de abrir os Planos (a tela fica por cima deles)', () => {
    expect(app).toMatch(/<LimitGate[^>]*onSeePlans=\{\(\)\s*=>\s*\{\s*livre\.closeLimit\(\);\s*setIsPricingOpen\(true\)\s*\}\}/)
  })

  it('o selo grava o clique e abre os Planos', () => { expect(app).toMatch(/openLivreBadge:\s*\(\)\s*=>\s*\{\s*trackAd\('ad_clicked',\s*'badge'\)/) })

  it('nenhum alert, confirm ou prompt novo no App', () => {
    // Os 4 de hoje: o editor de marcadores do admin.
    expect(app.match(/\balert\s*\(/g)).toHaveLength(4)
    expect(app).not.toMatch(/\b(confirm|prompt)\s*\(/)
  })

  it('nenhum travessão nas linhas novas do App, das Configurações e do Electron', () => {
    for (const text of [app, settingsModal, main]) {
      for (const line of text.split('\n')) if (/StageShell|useNewStage|stageMode|StageVersionSetting|AudioOutputsSection|backgroundThrottling/.test(line)) expect(line).not.toContain(TRAVESSAO)
    }
  })
})
