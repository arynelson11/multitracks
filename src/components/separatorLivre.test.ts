// Separador no Livre (Parte 3), conferido no texto do código como no appWiring.test.ts: o
// SeparatorStudio inteiro não monta no teste. A T14 põe as opções de faixas pelo plano
// (Ruling R7: o teste saiu da T19); a T19 acrescenta aqui o resto do Separador no Livre.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const sep = read('./SeparatorStudio.tsx')
const TRAVESSAO = String.fromCharCode(0x2014)

// A tela de opções: do `if` dela até o `if` da tela de envio, logo abaixo.
const start = sep.indexOf("if (separationStep === 'options' && pendingFile)")
const end = sep.indexOf("if (separationStep === 'upload' && !file && stems.length === 0)")
const optionsScreen = sep.slice(start, end)

describe('Separador no Livre', () => {
  it('as opções de faixas vêm de separationStemOptions', () => {
    expect(sep).toMatch(/separationStemOptions\(userPlan\)/)
  })

  it('a tela de opções não decide o plano sozinha: nenhum 2, 4 ou 6 fixo, sem cadeado e sem selo PRO', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    // Parte 3 (faixa D): os cartões saem da vista SeparatorOptions, que só mostra as opções que recebe.
    expect(optionsScreen).toMatch(/<SeparatorOptions options=\{stemOptions\}/)
    const optionsView = read('./separator/SeparatorOptions.tsx')
    expect(optionsView).toMatch(/options\.map\(/)
    expect(optionsView).toMatch(/options\.filter\(/)
    expect(optionsView).not.toMatch(/\b[246]\s*faixas|<Lock\b|planTier\(|>PRO</)
    expect(optionsScreen).not.toMatch(/handleSelectOption\(\s*[246]/)
    expect(optionsScreen).not.toMatch(/<Lock\b/)
    expect(optionsScreen).not.toMatch(/canUsePro|canUseStudio|planTier\(/)
    expect(optionsScreen).not.toMatch(/>PRO</)
    expect(optionsScreen).not.toContain(TRAVESSAO)
  })

  it('admin nunca tem a trava do Livre: vê as opções de quem paga', () => {
    expect(optionsScreen).toMatch(/isAdmin\s*\?\s*ALL_STEM_COUNTS\s*:\s*separationStemOptions\(userPlan\)/)
  })
})

// T19: o resto do Separador no Livre. Ruling R11: quem paga mantém o alert com a data de volta do
// contador e os Planos; o alert sai só do ramo do Livre. Ruling R12: o palco atrás continua
// tocando com o Separador aberto, então a tela de limite e o anúncio olham o motor do App também.
const app = read('../App.tsx')

// Corpo de `const nome = ...` até o `};` que fecha no recuo de 2 espaços.
const body = (name: string) => {
  const i = sep.indexOf(`const ${name} = `)
  const j = sep.indexOf('\n  };', i)
  return i < 0 || j < 0 ? '' : sep.slice(i, j)
}

// As telas do Separador, cada uma um retorno do componente.
const screenFrom = (startMark: string, endMark: string) => {
  const i = sep.indexOf(startMark)
  const j = endMark ? sep.indexOf(endMark, i) : sep.length
  return i < 0 || j < 0 ? '' : sep.slice(i, j)
}
const homeScreen = screenFrom("if (separationStep === 'upload' && !file && stems.length === 0)", 'if (isProcessing) {')
const processingScreen = screenFrom('if (isProcessing) {', '{/* ═══ HEADER')
const studioScreen = screenFrom('{/* ═══ HEADER', '')

describe('Separador no Livre: limites, tela de limite e anúncio (T19)', () => {
  it('o motor que conta é o player daqui junto com o do palco atrás (stageBusy, R12)', () => {
    expect(sep).toMatch(/stageBusy: EngineBusy;/)
    expect(sep).toMatch(/const busy: EngineBusy = \{ isPlaying: isPlaying \|\| stageBusy\.isPlaying, isCountingIn: stageBusy\.isCountingIn \};/)
    expect(sep).toMatch(/const quiet = isQuiet\(busy\);/)
    // Os minutos do Ao Vivo só correm na instância do App.
    expect(sep).toMatch(/useLivre\(\{ userId, plan: userPlan, isAdmin, busy, liveActive: false, onLiveExpired: \(\) => \{\} \}\)/)
    // Parte 3 (faixa D): o App passa também o palco disponível e a entrega pro palco.
    expect(app).toMatch(/<SeparatorStudio onClose=\{\(\) => setIsSeparatorOpen\(false\)\} stageBusy=\{\{ isPlaying, isCountingIn \}\}[\s\S]{0,200}\/>/)
  })

  // Revisão macro 1b (parte 2, M4): a conta, o plano e o papel vêm do App, que só passa do
  // carregando com eles lidos. O Separador não tem useAuth próprio (que começava em Livre até ler
  // o perfil e, com a rede lenta, abria separação de mês anterior sem contar).
  // Ruling pads-tocando: recurso pago no Livre com a música tocando (a daqui ou a do palco atrás).
  it('recurso pago no Livre tocando: os Planos esperam a música parar e não mostram o desconto', () => {
    expect(sep).toMatch(/const openPlans = usePlansWhenQuiet\(isLivre, quiet, \(\) => setIsPricingOpen\(true\)\);/)
    expect(sep).toMatch(/const hidePlansOffer = isLivre && !quiet;/)
    // Salvar na nuvem sem o recurso: no Separador no palco vai pela tela de limite download (sep-2 I1,
    // asserção mais abaixo), que já espera a música parar; os outros recursos pagos usam o openPlans.
    expect(body('detectBpmFromAudio')).toMatch(/openPlans\(\)/)
    expect(sep).toMatch(/onVoice=\{\(\) => canVoiceGuide \? setShowVoiceGuide\(true\) : openPlans\(\)\}/)
    const modals = sep.match(/<PricingModal [\s\S]*?\/>/g) ?? []
    expect(modals).toHaveLength(3)
    for (const m of modals) expect(m).toMatch(/hideOffer=\{hidePlansOffer\}/)
  })

  it('a conta, o plano e o papel vêm do App, sem useAuth próprio', () => {
    // Junção com o Separador no palco (faixa D): depois da conta vêm as props do palco.
    expect(app).toMatch(/<SeparatorStudio onClose=\{\(\) => setIsSeparatorOpen\(false\)\} stageBusy=\{\{ isPlaying, isCountingIn \}\} userId=\{user\?\.id \?\? null\} userPlan=\{userPlan\} isAdmin=\{isAdmin\}[\s\S]{0,200}\/>/)
    expect(sep).toMatch(/userId: string \| null;\s*userPlan: string;\s*isAdmin: boolean;/)
    expect(sep).toMatch(/= \(\{ onClose, stageBusy, userId, userPlan, isAdmin, stageAvailable = false, stageSeparationIds = NO_STAGE_SEPARATIONS, onOpenOnStage \}\) =>/)
    expect(sep).not.toMatch(/\buseAuth\b/)
    expect(sep).not.toMatch(/authLoading/)
    expect(sep).not.toMatch(/\buser\?\.|\buser\./)
    expect(sep).toMatch(/const isLivre = livre\.isLivre;/)
  })

  it('limite de separações (contador lido antes e o 402): o Livre pede a tela separations sem alert; quem paga mantém o aviso e os Planos', () => {
    const p = body('processAudio')
    expect(p).not.toBe('')
    expect(p).toMatch(/if \(usage && usage\.used >= maxLimit\) \{\s*if \(isLivre\) \{ showLivreSeparationLimit\(\); return; \}\s*alert\(`Você já usou/)
    expect(p).toMatch(/res\.status === 402\) \{\s*if \(isLivre\) \{ showLivreSeparationLimit\(\); return; \}\s*setIsPricingOpen\(true\);/)
    const h = body('showLivreSeparationLimit')
    expect(h).toMatch(/livre\.requestLimit\('separations'\)/)
    expect(h).toMatch(/setIsProcessing\(false\)/)
    expect(h).toMatch(/setFile\(null\)/)
    expect(h).not.toMatch(/alert\(|setIsPricingOpen/)
  })

  it('baixar sem o download no plano: o Livre pede a tela download, quem paga abre os Planos como hoje', () => {
    expect(sep).toMatch(/requestLimit\('download'\)/)
    expect(body('blockDownload')).toMatch(/if \(isLivre\) livre\.requestLimit\('download'\);\s*else setIsPricingOpen\(true\);/)
    expect(body('downloadStem')).toMatch(/if \(!canDownload\) \{ blockDownload\(\); return; \}/)
    expect(sep).toMatch(/canDownload \? downloadStem\(stem\) : blockDownload\(\)/)
    expect(sep).not.toMatch(/canDownload \? downloadStem\(stem\) : setIsPricingOpen/)
  })

  it('abrir separação salva passa por canOpenSong com separationKey e freeThisMonth antes de abrir e conta com as mesmas opções', () => {
    const o = body('handleOpenSavedSeparation')
    expect(o).toMatch(/if \(isLivre\) \{/)
    expect(o).toMatch(/const freeThisMonth = separationIsThisMonth\(sep\.createdAt, new Date\(\)\);/)
    expect(o).toMatch(/canOpenSong\(separationKey\(sep\.id\),\s*\{\s*freeThisMonth/)
    expect(o).toMatch(/\{ livre\.requestLimit\('stage-songs'\); return; \}/)
    // A conta vem antes de qualquer troca de tela.
    expect(o.indexOf('canOpenSong(')).toBeGreaterThan(0)
    expect(o.indexOf('canOpenSong(')).toBeLessThan(o.indexOf('stageAvailable'))
    // Revisão sep-2 M1: com o palco novo quem conta é o palco, na chegada; aqui só o caminho de
    // reserva conta (openInReserve), com as mesmas opções, antes de trocar de tela.
    expect(o).not.toMatch(/noteSongOpened\(/)
    expect(o).toMatch(/openInReserve\(sep, false\)/)
    const r = body('openInReserve')
    expect(r).toMatch(/const freeThisMonth = separationIsThisMonth\(sep\.createdAt, new Date\(\)\);/)
    expect(r).toMatch(/noteSongOpened\(separationKey\(sep\.id\),\s*\{\s*freeThisMonth\s*\}\)/)
    expect(r.indexOf('noteSongOpened(')).toBeLessThan(r.indexOf('setStems('))
    // Abrir outra desliga o anúncio do fim (o "Abrir aqui no Separador" de uma recém-separada mantém).
    expect(r).toMatch(/setJustSeparated\(justSeparatedNow\)/)
    expect(o.indexOf('openInReserve(sep, false)')).toBeGreaterThan(0)
  })

  it('a separação que acabou de terminar abre sem contar nas 3 e liga o anúncio do fim', () => {
    const p = body('processAudio')
    expect(p).toMatch(/setStems\(persistedStems\);[\s\S]*?setJustSeparated\(true\);/)
    expect(p).not.toMatch(/noteSongOpened|canOpenSong/)
  })

  it('o anúncio do fim da separação fica ao lado do resultado e só com a música parada (a daqui e a do palco)', () => {
    expect(sep).toMatch(/<AdSlot[\s\S]*?placement="separation-done"[\s\S]*?quiet=\{quiet\}/)
    const at = sep.indexOf('<AdSlot')
    const ad = sep.slice(at, sep.indexOf('/>', at))
    expect(ad).toMatch(/userId=\{userId\}/)
    expect(ad).toMatch(/isLivre=\{isLivre\}/)
    expect(ad).toMatch(/justSeparated=\{justSeparated\}/)
    expect(ad).toMatch(/onCta=\{\(\) => setIsPricingOpen\(true\)\}/)
    // Na tela do resultado, embaixo da área das faixas, no fluxo (sem cobrir nada).
    expect(studioScreen).toContain('<AdSlot')
    expect(at).toBeGreaterThan(sep.indexOf('{/* ═══ WORKSPACE ═══ */}'))
    expect(sep.indexOf('<AdSlot', at + 1)).toBe(-1)
  })

  it('a tela de limite é renderizada pelo Separador, uma por tipo, e fecha antes de abrir os Planos', () => {
    expect(sep).toMatch(/<LimitGate[\s\S]*?kind=\{livre\.limit\}/)
    const at = sep.indexOf('<LimitGate')
    const gate = sep.slice(at, sep.indexOf('/>', at))
    expect(gate).toMatch(/key=\{livre\.limit\}/)
    expect(gate).toMatch(/onClose=\{livre\.closeLimit\}/)
    expect(gate).toMatch(/onSeePlans=\{\(\) => \{ livre\.closeLimit\(\); setIsPricingOpen\(true\) \}\}/)
    expect(sep).toMatch(/const limitGate = livre\.limit !== null && \(/)
  })

  it('a tela de limite vale em todas as telas do Separador, e a tela de envio também abre os Planos', () => {
    expect(optionsScreen).toContain('{limitGate}')
    expect(homeScreen).toContain('{limitGate}')
    expect(homeScreen).toMatch(/<PricingModal isOpen=\{isPricingOpen\} onClose=\{\(\) => setIsPricingOpen\(false\)\} hideOffer=\{hidePlansOffer\} \/>/)
    expect(processingScreen).toContain('{limitGate}')
    expect(studioScreen).toContain('{limitGate}')
  })

  it('toda gravação da separação leva a data dela: reabrir uma de outubro nunca vira deste mês', () => {
    const calls = sep.split('saveSeparation({').slice(1)
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(c.slice(0, c.indexOf('stems:'))).toMatch(/createdAt/)
    expect(body('openInReserve')).toMatch(/setActiveSepCreatedAt\(sep\.createdAt\)/)
    expect(body('goToSeparatorHome')).toMatch(/setActiveSepCreatedAt\(null\)/)
  })

  it('revisão sep-2 I1: no Livre o Exportar vai pra tela de limite download, e os Planos nunca abrem atrás de uma janela', () => {
    expect(sep).toMatch(/onExport=\{\(\) => \(canCloudSave \? setShowSaveForm\(true\) : blockCloudSave\(\)\)\}/)
    expect(sep).toMatch(/const blockCloudSave = blockDownload;/)
    expect(body('handleSaveToDatabase')).toMatch(/if \(!canCloudSave\) \{ setShowSaveForm\(false\); blockCloudSave\(\); return; \}/)
    // Junção com a 1b: a janela do BPM fecha antes e os Planos passam pelo openPlans (no Livre tocando, esperam a música parar).
    expect(body('detectBpmFromAudio')).toMatch(/if \(!canBpm\) \{ setShowBpmModal\(false\); openPlans\(\); return; \}/)
  })
})
