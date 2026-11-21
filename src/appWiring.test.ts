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

  it('tirar a música atual no Livre: a seguinte só vira a atual pelo portão; recusada, não sobra música atual e a tela é pedida', () => {
    // Os dois palcos tiram música só pela versão com o Livre (o painel REPERTÓRIOS e a lixeira do cartão do palco antigo).
    expect(app).toMatch(/repRemove:\s*\(id: string\)\s*=>\s*removeSongGated\(id\)/)
    expect(app).toMatch(/removeSongGated\(song\.id\)/)
    // removeSongFromPlaylist( só dentro do removeSongGated: a troca recusada e a normal.
    expect(app.match(/\bremoveSongFromPlaylist\(/g)).toHaveLength(2)
    expect(app).toMatch(/const removeSongGated = \(id: string\) => \{[\s\S]{0,300}livre\.isLivre && removalOpensRefusedSong\(playlist, activeSongIndex, id, \(s\) => livre\.canOpenSong\(stageSongKey\(s\), stageSongOpenOpts\(s, new Date\(\)\)\)\)[\s\S]{0,100}removeSongFromPlaylist\(id, \{ openNext: false \}\)[\s\S]{0,60}livre\.requestLimit\('stage-songs'\)[\s\S]{0,60}\}\s*removeSongFromPlaylist\(id\)/)
  })

  it('comandos next, prev e select-song da banda passam pelas versões com o Livre', () => {
    expect(app).toMatch(/case 'next':\s*nextSongGated\(\)/)
    expect(app).toMatch(/case 'prev':\s*prevSongGated\(\)/)
    expect(app).toMatch(/case 'select-song':[^\n]*jumpToSongGated\(/)
  })

  it('o motor recebe autoNext pelo plano', () => { expect(app).toMatch(/autoNext:\s*isAdmin\s*\|\|\s*canUseRepertoire\(userPlan\)/) })

  it('a música atual conta pelo stageSongKey', () => { expect(app).toMatch(/noteSongOpened\(stageSongKey\(/) })

  it('um useLivre só no App, depois do hostActive e antes da entrada do buildStageView, com o Ao Vivo ligado nele (T18)', () => {
    expect(app.match(/\buseLivre\(/g)).toHaveLength(1)
    const host = app.indexOf('const hostActive =')
    const expired = app.indexOf('const onLiveExpired =')
    const hook = app.indexOf('const livre = useLivre(')
    const view = app.indexOf('const stageView =')
    expect(host).toBeGreaterThan(0)
    expect(expired).toBeGreaterThan(host)
    expect(hook).toBeGreaterThan(expired)
    expect(view).toBeGreaterThan(hook)
    expect(app).toMatch(/useLivre\(\{\s*userId: user\?\.id \?\? null,\s*plan: userPlan,\s*isAdmin,\s*busy: \{ isPlaying, isCountingIn \},\s*liveActive: hostActive\b/)
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

  it('a sessão do Ao Vivo conta os minutos do Livre e, quando acabam, desliga a banda sem tocar no motor', () => {
    const body = app.match(/const onLiveExpired = \(\) => \{[^}]*\}/)![0]
    expect(body).toMatch(/handleStopLiveMode\(\)/)
    expect(body).toMatch(/setRemoteSessionCode\(null\)/)
    expect(body).toMatch(/setApprovedIps\(\[\]\)/)
    expect(body).not.toMatch(/\b(pause|stopAll\w*|cancelCountIn)\(/)
    expect(app).toMatch(/liveActive:\s*hostActive/)
    // Ruling R16-mudada: na rede local o tempo só corre com um celular conectado; na sessão pela
    // nuvem (o líder não vê quem entrou, Ruling T18-remoto) corre enquanto ela estiver ligada.
    expect(app).toMatch(/liveActive:\s*hostActive\s*&&\s*\(\s*connectedIps\.length\s*>\s*0\s*\|\|\s*remoteSessionCode\s*!==\s*null\s*\)/)
    // Desligar o servidor esvazia a lista de celulares (o Electron não manda a lista vazia depois de
    // fechar): senão, ligar o HOST de novo contaria os minutos com celular que já saiu.
    const stop = app.match(/const handleStopLiveMode = async \(\) => \{[\s\S]*?\n {2}\}/)![0]
    expect(stop).toMatch(/setConnectedDevices\(\[\]\)/)
    expect(stop).not.toMatch(/\b(pause|stopAll\w*|cancelCountIn)\(/)
  })

  it('começar o Ao Vivo no Livre sem minutos pede a tela live', () => {
    expect(app).toMatch(/canStartLive\(\)[\s\S]{0,120}requestLimit\('live'\)/)
    const start = app.match(/const handleStartLiveMode = async \(\) => \{[\s\S]*?\n {2}\}/)![0]
    // O portão antigo (Ao Vivo só no pago) saiu: todos os planos abrem o HOST.
    expect(start).not.toMatch(/canUseLiveMode|setIsPricingOpen/)
    expect(start).toMatch(/^const handleStartLiveMode = async \(\) => \{[\s\S]{0,400}if \(!livre\.canStartLive\(\)\) \{\s*livre\.requestLimit\('live'\)\s*return\s*\}[\s\S]*?setIsLiveModeOpen\(true\)/)
    expect(app).not.toMatch(/\bcanUseLiveMode\b/)
  })

  it('o 2º celular no Livre pede a tela do celular a mais; no pago passa do teto e abre os Planos', () => {
    // Teto pelo plano; o admin nunca tem o limite do Livre (no plano Livre fica sem teto).
    expect(app).toMatch(/const liveDeviceCap = isAdmin && planTier\(userPlan\) === 'free' \? Infinity : maxLiveDevices\(userPlan\)/)
    const one = app.match(/const approveLiveDevice = \(ip: string\) => \{[\s\S]*?\n {2}\}/)![0]
    expect(one).toMatch(/approvedIps\.length >= liveDeviceCap\)\s*\{\s*if \(livre\.isLivre\) livre\.requestLimit\('live-devices'\)\s*else setIsPricingOpen\(true\)\s*return\s*\}/)
    const all = app.match(/const approveAllLiveDevices = \(\) => \{[\s\S]*?\n {2}\}/)![0]
    expect(all).toMatch(/connectedIps\.slice\(0, liveDeviceCap\)/)
    expect(all).toMatch(/connectedIps\.length > liveDeviceCap && livre\.isLivre\) livre\.requestLimit\('live-devices'\)/)
    // A tela dos minutos ("Os 10 minutos de hoje com a banda acabaram") fica só pro começo sem minutos.
    expect(one).not.toMatch(/requestLimit\('live'\)/)
    expect(all).not.toMatch(/requestLimit\('live'\)/)
    // Nenhum efeito escondido dentro da função que atualiza o estado (o React pede que ela seja pura).
    expect(app).not.toMatch(/setApprovedIps\(prev => \{[\s\S]{0,300}?(setIsPricingOpen|requestLimit)\(/)
    expect(app).toMatch(/onToggleDevice=\{approveLiveDevice\}/)
    expect(app).toMatch(/onToggleAll=\{approveAllLiveDevices\}/)
  })

  it('a tela inicial tem o AdSlot home e o PricingModal', () => {
    const start = app.indexOf('// ───────────────── SPLASH')
    const end = app.indexOf('// Editor de marcadores do admin', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const splash = app.slice(start, end)
    expect(splash).toMatch(/<AdSlot[\s\S]*?placement="home"[\s\S]*?userId=\{user\.id\}[\s\S]*?isLivre=\{livre\.isLivre\}[\s\S]*?quiet=\{engineQuiet\}[\s\S]*?onCta=\{\(\) => setIsPricingOpen\(true\)\}/)
    // Embaixo dos dois botões.
    expect(splash.indexOf('<AdSlot')).toBeGreaterThan(splash.indexOf('Separação de Faixas'))
    expect(splash).toMatch(/<PricingModal isOpen=\{isPricingOpen\} onClose=\{\(\) => setIsPricingOpen\(false\)\} \/>/)
    // Música parada de verdade: nem tocando, nem na pré-contagem.
    expect(app).toMatch(/const engineQuiet = !isPlaying && !isCountingIn\b/)
  })

  it('as Novidades esperam a música parar, com o mesmo engineQuiet do anúncio', () => {
    const at = app.indexOf('setShowWhatsNew(true), 700)')
    expect(at).toBeGreaterThan(0)
    const effect = app.slice(app.lastIndexOf('useEffect(', at), app.indexOf('])', at) + 2)
    expect(effect).toMatch(/if \(!user \|\| !isReady \|\| forceShowSplash \|\| showTour \|\| !engineQuiet\) return/)
    // A música que começa nos 700 ms cancela a abertura (o efeito roda de novo e limpa o timer).
    expect(effect).toMatch(/return \(\) => clearTimeout\(t\)\s*\}, \[[^\]]*\bengineQuiet\b[^\]]*\]\)$/)
    // Só esse efeito abre as Novidades.
    expect(app.match(/setShowWhatsNew\(true\)/g)).toHaveLength(1)
  })

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

// Parte 3 (faixa D): a música separada abre no palco, com o painel SEPARAÇÃO.
describe('separação abrindo no palco', () => {
  it('o App entrega a separação pro palco pelo loadFiles com a ligação e o mixer salvo', () => {
    expect(app).toMatch(/const openSeparationOnStage = \(o: StageSeparationOpen\) => \{[\s\S]{0,200}setIsSeparatorOpen\(false\)[\s\S]{0,80}setForceShowSplash\(false\)[\s\S]{0,80}initEngine\(\)/)
    expect(app).toMatch(/loadFiles\(dt\.files, meta\.name, undefined, undefined, meta\.originalKey, meta\.bpm, \{/)
    expect(app).toMatch(/separation:\s*meta\.separation/)
    expect(app).toMatch(/channelStates:\s*separationChannelStates\(stemsToOpen\(o\.sep\)\)/)
    // Espera o motor pronto e o repertório restaurado (a regra em si: stageHandoff.test.ts).
    expect(app).toMatch(/const step = pendingSeparationStep\(o\.sep\.id, \{ isReady, isRestoring \}, playlist\)\s*if \(step === 'esperar'\) return/)
  })

  it('sep-1 C1: a separação que o repertório restaurado já tem só pula, sem carregar de novo', () => {
    expect(app).toMatch(/const arrived = \(\) => setSeparationArrival\(\{ sepId: o\.sep\.id, justSeparated: o\.justSeparated \}\)\s*if \(step === 'pular'\) \{ arrived\(\); return \}/)
    // O pular vem antes do carregamento.
    expect(app.indexOf("if (step === 'pular')")).toBeLessThan(app.indexOf('loadFiles(dt.files'))
  })

  it('com a VS tocando a separação espera a parada pra virar a atual', () => {
    expect(app).toMatch(/separationArrival[\s\S]{0,400}const quietNow = !isPlaying && !isCountingIn[\s\S]{0,80}if \(i < 0 \|\| !quietNow\) return/)
    expect(app).toMatch(/findSeparationSong\(playlist, arrival\.sepId\)/)
  })

  it('separação já no repertório: só pula, sem baixar de novo', () => {
    expect(app).toMatch(/if \(o\.files\) setPendingSeparation\(o\)\s*else setSeparationArrival\(/)
    expect(app).toMatch(/stageSeparationIds = useMemo\(\(\) => new Set\(playlist\.flatMap\(\(s\) => \(s\.separation \? \[s\.separation\.id\] : \[\]\)\)\)/)
  })

  it('a gaveta SEPARAÇÃO entra na casca e o Livre baixa e salva pela tela de limite download', () => {
    expect(app).toMatch(/separation:\s*separationPanelShown \? \(\s*<SeparationPanel/)
    expect(app).toMatch(/onLimit=\{\(\) => requestLivreLimit\('download'\)\}/)
    expect(app).toMatch(/const requestLivreLimit = livre\.requestLimit/)
    expect(app).toMatch(/const canDownloadSeparation = isAdmin \|\| canDownloadStems\(userPlan\)/)
    expect(app).toMatch(/const canCloudSaveSeparation = isAdmin \|\| planTier\(userPlan\) !== 'free'/)
    expect(app).toMatch(/const separationPanelShown = !!activeSong\?\.separation && separationPanelSongId === activeSong\.id/)
    // O anúncio do fim no painel: só no Livre, com a separação que acabou de terminar, parado.
    expect(app).toMatch(/<AdSlot placement="separation-done"[^>]*quiet=\{!isPlaying && !isCountingIn\}[^>]*justSeparated/)
    expect(app).toMatch(/const showSeparationAd = livre\.isLivre && justSeparatedId !== null/)
  })

  it('as ferramentas trocam o canal pela troca atômica do motor', () => {
    expect(app).toMatch(/replaceAppChannel\(activeSong\.id, names, file\)/)
    expect(app).toMatch(/busy: isPlaying \|\| isCountingIn/)
  })

  it('a música atual e o pulo do repertório passam stageSongOpenOpts', () => {
    expect(app.match(/stageSongOpenOpts\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(app).toMatch(/noteSongOpened\(stageSongKey\(activeSong\), stageSongOpenOpts\(activeSong, new Date\(\)\)\)/)
    expect(app).toMatch(/canOpenSong\(stageSongKey\(song\), stageSongOpenOpts\(song, new Date\(\)\)\)/)
  })

  it('menu FAIXAS tem Separação e Minhas separações', () => {
    expect(app).toMatch(/hasSeparation && \([\s\S]{0,200}onSeparation\(\)[\s\S]{0,120}Separação/)
    expect(app).toMatch(/onMySeparations\(\) \}\}>[\s\S]{0,120}Minhas separações/)
    expect(app).toMatch(/hasSeparation=\{hasSongSeparation\} onSeparation=\{stageCalls\.tracksSeparation\} onMySeparations=\{stageCalls\.tracksMySeparations\}/)
  })

  it('o Separador recebe stageAvailable pelo wantNewStage', () => {
    expect(app).toMatch(/<SeparatorStudio[\s\S]*?stageAvailable=\{wantNewStage\}/)
    expect(app).toMatch(/<SeparatorStudio[\s\S]*?stageSeparationIds=\{stageSeparationIds\}/)
    expect(app).toMatch(/<SeparatorStudio[\s\S]*?onOpenOnStage=\{openSeparationOnStage\}/)
  })

  it('publicar na nuvem pela gaveta: janela do palco que não fecha publicando e o teclado do palco desligado', () => {
    expect(app).toMatch(/<StageDialog[\s\S]{0,120}open=\{cloudSaveShown\}[\s\S]{0,300}closeDisabled=\{stageSeparation\.busy === 'cloud'\}/)
    // sep-1 M2: o teclado do palco segue a mesma condição da janela.
    expect(app).toMatch(/livre\.limit === null && !cloudSaveShown/)
    expect(app).toMatch(/const cloudSaveShown = !!stageSeparation\.sep && cloudSaveSongId !== null && cloudSaveSongId === activeSongId/)
  })

  it('sep-1 I6 e M2: a gaveta e a janela de publicar são da música em que abriram; trocar de música fecha as duas', () => {
    expect(app).toMatch(/useEffect\(\(\) => \{\s*const left = panelSongRef\.current[\s\S]{0,200}setSeparationPanelSongId\(\(id\) => \(id === left \? null : id\)\)\s*setCloudSaveSongId\(\(id\) => \(id === left \? null : id\)\)\s*\}, \[activeSongId\]\)/)
    // Só a chegada (parada) e o FAIXAS > Separação abrem a gaveta.
    expect(app.match(/setSeparationPanelSongId\((?!null\)|\(id\))/g)).toHaveLength(2)
    expect(app).toMatch(/const quietNow = !isPlaying && !isCountingIn[\s\S]{0,300}setSeparationPanelSongId\(playlist\[i\]\.id\)/)
    expect(app).toMatch(/tracksSeparation: \(\) => \{ setSeparationTab\('faixas'\); setSeparationPanelSongId\(activeSong\?\.id \?\? null\) \}/)
    expect(app).toMatch(/onOpenCloudSave=\{stageCalls\.openSeparationCloudSave\}/)
  })

  it('sep-1 I5: a separação sai do estado quando o carregamento pega as faixas', () => {
    expect(app).toMatch(/if \(step === 'esperar'\) return\s*\/\/[^\n]*\n\s*setPendingSeparation\(null\)/)
    expect(app).not.toMatch(/pendingSeparationSeen/)
  })

  it('sep-1 M3: nada decodificou, a frase aparece no palco (nunca tocando) e a chegada não fica pendente', () => {
    expect(app).toMatch(/\.then\(\(ok\) => \{ entered = ok \}\)\)/)
    expect(app).toMatch(/\.then\(\(\) => \{ if \(entered\) arrived\(\); else setSeparationLoadFailed\(true\) \}\)/)
    expect(app).toMatch(/<Toast open=\{separationLoadFailed\}[\s\S]{0,200}playing=\{isPlaying \|\| isCountingIn\}[\s\S]{0,80}\{STAGE_LOAD_ERROR_TEXT\}/)
  })

  it('nenhum alert, confirm ou prompt novo no App', () => {
    expect(app.match(/\balert\(/g)?.length ?? 0).toBe(4)
    expect(app).not.toMatch(/window\.(prompt|confirm)\(/)
  })
})
