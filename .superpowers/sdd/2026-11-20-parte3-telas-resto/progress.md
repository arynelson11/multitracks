# Ledger: Parte 3, faixa C (demais telas no layout do palco)

Plano: `docs/superpowers/plans/2026-11-20-parte3-telas-resto.md`. Branch `feat/parte3-telas-c`, base `52eba03`.
Worktree: `~/playback-studio-work/parte3-telas-c`. Uma linha por tarefa: commit e testes.

| Tarefa | Commit | Testes |
|---|---|---|
| Plano | (este commit) | sem código |

## Decisões

- Decisão: o Modo Ao Vivo do host não usa o `StageDialog`. Por quê: quem passa do limite de aparelhos ganha os Planos (`PricingModal`, z-[110]) por cima do Ao Vivo, e o `StageDialog` (z-[120], foco preso) os taparia. Custo se errado: uma janela com camada própria a mais pra manter.
- Decisão: fechar o Metrônomo (X, Esc, toque fora) não faz nada enquanto o click é gerado. Por quê: o X já era desligado nessa hora e o `StageDialog` não tem X desligado. Custo se errado: antes o toque fora fechava mesmo gerando (o click entrava igual).
- Decisão: entrada única no FATOS e seção única (2.9) no DESIGN_SYSTEM pra faixa C. Por quê: a faixa B mexe nos mesmos arquivos ao mesmo tempo; uma entrada e uma seção próprias deixam a junção sem briga linha a linha. Custo se errado: o coordenador junta as entradas depois.

## Kit

- Kit novo da faixa B juntado: `git merge 6a18d4a` (merge `5161167`), a única junção desta faixa. Plano ajustado (seção "Ajuste depois do kit").

## Pre-flight

- T1 produz `oldLanguageClasses` e `TelaPage`/`TELA_*`; T2 a T10 consomem. Sem conflito.

## Tarefas

- Task 1: Ruling: a data do cabeçalho do DESIGN_SYSTEM (linha "Atualizado") não muda nesta faixa; a data fica no título da seção 2.9. Por quê: a faixa B mexe na mesma linha e a junção brigaria. Custo se errado: o coordenador acerta a linha na junção.
- Task 1: Ruling: o verificador ganhou o modo celular (`?celular=390x844`, iframe) no `run.mjs` e no `main.tsx`. Por quê: o Chrome headless não abre janela abaixo de 500 px (a 390x844 voltava 500x844 e dava ERRO). Custo se errado: a faixa B pode precisar do mesmo e juntar o mesmo trecho.
- Task 1: Ruling: o ajuste do campo do kit (e66a3eb, 2 linhas em `src/components/ui/Field.tsx`) entrou como commit próprio `9c42b95`, idêntico ao da faixa B, a pedido do coordenador. Custo se errado: nenhum (mesma mudança dos dois lados, a junção não briga).
- Task 1: Ruling: GERAR CLICK MANUAL e Gerar click IA aparecem os dois em caixa alta (`uppercase` no IA, texto igual). Por quê: os dois botões lado a lado com caixas diferentes ficavam desencontrados. Custo se errado: nenhum (o nome acessível não muda).
Task 1: complete (commits 6a0111a..74dcacc, tests: npx vitest run src/components/MetronomeModal src/components/ui →    Duration  8.25s (transform 1.95s, setup 0ms, import 4.06s, tests 7.77s, environment 3.57s))
- Task 2: Ruling: o texto passa de "banco de pads" pra "conjunto de pads" (vazio, frase de cima) e "Falha ao carregar catálogo." vira "Falha ao carregar o catálogo.". Por quê: o spec chama de "conjuntos de pads"; uma palavra só na tela. Custo se errado: só texto.
- Task 2: Ruling: Salvar e Cancelar da edição e Apagar e Cancelar da confirmação viram botões com texto (antes ícones de ✓ e X sem nome). Por quê: alvo de 44 px e clareza; a ação de cada um não muda. Custo se errado: linha da edição mais alta.
- Task 2: nota: `react-hooks/set-state-in-effect` no efeito da busca (linha 35) já existia antes; o efeito não mudou.
Task 2: complete (commits 74dcacc..9014cfd, tests: npx vitest run src/components/PadSetsModal →    Duration  4.59s (transform 449ms, setup 0ms, import 1.25s, tests 1.14s, environment 1.69s))
- Task 3: Ruling: o aviso "Versão sincronizada disponível" fica em `mut` (antes verde). Por quê: o musgo claro é "ao vivo" e o verde não é token; aviso informativo é neutro. Custo se errado: só cor.
Task 3: complete (commits 9014cfd..bf8fdf9, tests: npx vitest run src/components/LyricsEditor →    Duration  2.60s (transform 247ms, setup 0ms, import 727ms, tests 532ms, environment 1.02s))
- Kit (2ª leva): peças do `aedcb86` (IconButton, Tag, ProgressBar, Slider, FilePicker, Toast, SearchField) copiadas iguais no commit `2b3658b` (só `src/components/ui/`), a pedido do coordenador.
- Task 4: Ruling: a letra do teleprompter rola dentro da tela quando não cabe (antes saía cortada) e o centro vem de `my-auto`. Por quê: o verificador acusou a letra longa passando do começo da rolagem com `justify-center`. Custo se errado: nenhum pra letra curta (fica no meio como antes).
- Task 4: Ruling: a barra de progresso do teleprompter é a `ProgressBar` do kit (laranja), não a cinza de antes. Por quê: pedido do coordenador de usar a peça do kit. Custo se errado: só cor.
- Task 4: troca no `App.tsx` pra o coordenador fazer na junção (linhas do bloco `{isTeleprompterMode && (...)}`, hoje 2643 a 2690): `{isTeleprompterMode && <Teleprompter songName={playlist[activeSongIndex]?.name ?? null} hasMarkers={(playlist[activeSongIndex]?.markers?.length ?? 0) > 0} marker={currentMarker ?? null} currentTime={currentTime} duration={duration} onClose={() => setIsTeleprompterMode(false)} />}` e `import { Teleprompter } from './components/Teleprompter'`.
Task 4: complete (commits bf8fdf9..d1b232d, tests: npx vitest run src/components/Teleprompter src/components/ui →    Duration  2.49s (transform 439ms, setup 0ms, import 1.22s, tests 778ms, environment 2.06s))
- Task 5: Ruling: o selo da versão e os pontos da lista das Novidades ficam neutros (antes dourados). Por quê: laranja é "ligado" ou a ação principal (Entendi); a versão é informação. Custo se errado: só cor.
Task 5: complete (commits 1cb08f3..2cf6930, tests: npx vitest run src/components/WhatsNewModal →    Duration  3.34s (transform 398ms, setup 0ms, import 858ms, tests 310ms, environment 1.71s))
Task 6: complete (commits 2cf6930..bdfc330, tests: npx vitest run src/components/UpdateBanner →    Duration  4.35s (transform 389ms, setup 0ms, import 1.29s, tests 499ms, environment 1.95s))
- Task 7: nota: `react-hooks/set-state-in-effect` no efeito que mede o alvo do tour já existia antes; o efeito não mudou.
Task 7: complete (commits bdfc330..8bd9817, tests: npx vitest run src/components/GuidedTour →    Duration  2.09s (transform 208ms, setup 0ms, import 633ms, tests 297ms, environment 897ms))
- Task 8: Ruling: o guia de instalar no celular (`InstallAppGuide.tsx`) entrou junto com a página de download, só nas classes. Por quê: é uma seção da página; deixar no visual antigo deixaria a página com duas caras. Custo se errado: o aviso de instalar do app (`InstallAppBanner`, que usa o guia e não é desta faixa) fica com o guia no visual novo dentro da moldura antiga.
- Task 8: Ruling: `font-display` saiu da lista de classes antigas do `oldLanguageClasses`. Por quê: é a fonte da marca, usada pelo `PlaybackStudioWordmark` em qualquer tela (o admin novo também). Custo se errado: tela que usar Fraunces fora da marca passa no teste.
- Task 8: Ruling: o link Baixar e o cartão do instalador têm classes `ps-*` próprias (o kit não tem link com cara de botão nem `Panel` com destaque). Pedido pro kit no relatório: `ButtonLink`. Custo se errado: duas classes pra manter iguais ao `Button primary`.
- Task 8: Ruling: o título da página de download sai da Fraunces e vai pra Inter extranegrito. Por quê: a página passa a ser do app (linguagem do palco), não da landing. Custo se errado: só a fonte do título.
Task 8: complete (commits 8bd9817..8ab2e56, tests: npx vitest run src/components/DownloadPage src/components/InstallAppGuide →    Duration  1.41s (transform 364ms, setup 0ms, import 817ms, tests 568ms, environment 788ms))
- Task 9: Ruling: o bloco escondido do músico remoto (`{false && ...}`, Fase 5) também passou pra linguagem nova (`Switch` e `IconButton` do kit), sem aparecer. Por quê: quando ligar na Fase 5, já sai na cara certa. Custo se errado: nenhum na tela de hoje. O `no-constant-binary-expression` dele já existia.
- Task 9: Ruling: "Desativar Modo Ao Vivo" no âmbar (`Button tone="alert"`), não no vermelho de antes. Por quê: o kit não tem vermelho de perigo; âmbar é o alerta da linguagem. Custo se errado: só cor.
Task 9: complete (commits 8ab2e56..d0c62b1, tests: npx vitest run src/components/LiveModeModal →    Duration  1.16s (transform 142ms, setup 0ms, import 362ms, tests 222ms, environment 408ms))
- Task 10: Ruling: as abas do `AdminShell` continuam `Chip` (o `Tabs` do kit só aceita rótulo de texto e a aba Pendências mostra contador e LED); só saiu o `TAB_FOCUS`, que o `Chip` agora já tem. Custo se errado: duas formas de aba no app até o `Tabs` aceitar conteúdo.
- Task 10: Ruling: a nota do `ConfirmDialog` virou o `TextArea` do kit (as linhas de ajuda no `help`, o foco de abrir pelo `textarea` da janela); os 437 testes de `src/admin` passaram sem mudança. Custo se errado: nenhum visível (mesma caixa, 16 px).
- Task 10: Ruling: as mensagens do login do admin ganharam ponto final e "E-mail" com hífen ("E-mail ou senha inválidos.", "Supabase não configurado."). Custo se errado: só texto.
Task 10: complete (commits d0c62b1..1c8aec0, tests: npx vitest run src/admin →    Duration  6.03s (transform 7.33s, setup 0ms, import 13.93s, tests 27.04s, environment 14.38s))
- Task 11: verificador das 16 telas da faixa C nos 8 tamanhos: 128 de 128 ok (2232 textos, 208 botões só de ícone, 704 alvos); em 390x844, as 14 que abrem no celular: 14 de 14 ok. Nenhuma classe antiga nos arquivos tocados; só os 2 `alert(...)` que já existiam no Metrônomo (linhas não mexidas); travessão em linha adicionada: 0; caminho "/" novo: nenhum (o `href="/"` do Voltar da página de download já existia, só mudou a classe). Nada a consertar.
Task 11: complete (commits 1c8aec0..1c8aec0, tests: node scripts/verify-layout/run.mjs --estado adminlogin --only 1280x800 --no-build → Medidos: 7 textos, 0 botões só de ícone e 3 alvos de toque; exceções aceitas: 0 M/S (32x30) e 0 blocos estreitos da onda.)
- Final review: self-review (sem subagente: o brief da faixa proíbe chamar subagentes).
- Final: fixed o Modo Ao Vivo marcava `aria-modal` sem prender o foco, e os Planos que abrem por cima (fora da janela) ficariam escondidos do leitor de tela; tirado o `aria-modal`. Teste "camada própria abaixo dos Planos..." RED e depois GREEN; `LiveModeModal` + `ConfirmDialog` 30 de 30.
- Final: fixed o foco de abrir do `ConfirmDialog` procurava o primeiro `textarea` da janela (um `textarea` no texto de quem chama roubaria o foco da nota); volta a achar a nota pelo id, com o id nas dependências do efeito (o `useId` não muda, roda uma vez). Coberto pelos testes de foco que já existiam no `ConfirmDialog.test.tsx` (sem RED novo: comportamento igual ao de antes da T10).
- Task 12: as duas correções acima entraram enquanto o portão rodava (`vitest` já tinha começado); os testes delas rodaram de novo à parte (30 de 30) e o `tsc -b`, o `typecheck` e o build do portão rodaram depois delas.

## Portão (T12, uma vez, `caffeinate -i`, HEAD `1c8aec0`; o `c1332dc` entrou durante)

- vitest: 3924 de 3925 (163 arquivos, sem "Errors"); a de tempo `src/lib/manualClickTrack.test.ts` (62,2 ms contra 50) com load 11 a 23; sozinha 6 de 6 (load 15,47). Testes do `c1332dc` de novo: 30 de 30.
- `tsc -b` limpo; `npm run typecheck` com os 7 erros antigos; ESLint nos 30 arquivos tocados: 3 erros antigos em linhas não mexidas, 0 novos; `DESKTOP=1 npx vite build` ok.
- verify-layout: 216 de 216 (11 estados do palco + 16 da faixa C, 8 tamanhos); 390x844: 14 de 14.
- Ruling: o `report.md` não foi gravado (o ambiente recusou arquivo de relatório de subagente); o relatório vai inteiro na resposta ao coordenador, e este ledger guarda as decisões e os números. Custo se errado: o coordenador copia o texto da resposta.
- Ruling: a pasta do ledger fica (o brief pede o ledger na worktree) e nada de "finishing-a-development-branch" (o brief proíbe merge, push e tag). Custo se errado: nenhum.
Task 12: complete (commits 1c8aec0..4e6b16f, tests: npx vitest run src/components/LiveModeModal src/admin/components/ConfirmDialog src/lib/manualClickTrack.test.ts →    Duration  2.61s (transform 353ms, setup 0ms, import 834ms, tests 2.89s, environment 791ms))

## Onda de correção da revisão macro BC (2026-11-20, a partir de 9788a32)

Revisões: `parte3-faixas/review-bc-1.md`, `review-bc-2.md`, `review-bc-3.md`. Todos os achados pedidos entraram, com teste RED antes e GREEN depois onde há comportamento.
- 87344b5 [BC1-I1] [BC1-I2] pilha do StageDialog com um ouvinte de Esc só; foco na janela de cima e volta pra de fora ao fechar a de dentro (teste com flushSync, a ordem do navegador).
- a5796e4 [BC2-I1] [BC2-M8] StageDialog `dismissible` e `closeDisabled`; letra e cifra com texto não salvo só fecha no X.
- ec58134 [BC2-M4] [BC2-M8] pads: Esc na edição ou no apagar cancela só a linha; foco no Cancelar da confirmação.
- ece784b [BC2-I3] [BC2-M5] [BC2-M6] prazo de 15 s na amostra do click (AudioAnalyzer, corrida e AbortController); X do Metrônomo desligado gerando; FATOS:187 certo.
- 9860fe7 [BC1-I3] [BC1-I4] [BC1-M2] [BC1-M6] [BC1-M7] Configurações: teclas presas na camada, foco na aba, Tab girando, Esc fora dos Planos, guarda do toque de dentro, cores neutras nas Novidades, piso min(400px,55dvh) e 844x390 no verificador.
- 7fd09c4 [BC1-M1] [BC1-M8] regiões status sempre na página (`empty:absolute`) no login e no perfil; teste do divisor "ou" certo.
- 8854362 [BC1-M3] [BC1-M4] [BC1-M5] doc da Tag (e o kit-novo.md, fora do git), ids das Tabs com encodeURIComponent, FilePicker desligado.
- b24cab2 [BC2-I2] [BC2-M9] Ao Vivo com justify-center-safe e guarda do toque de dentro; regra nova do verificador (nada acima do topo da rolagem) e estado aovivo-cheio. RED medido: aovivo 1024x740 (11,1 px) e aovivo-cheio 1024x740 (86,1 px) e 1280x800 (56,1 px).
- 7568f9b [BC2-M7] teleprompter sem Math.round.
- 8c24f54 [BC3-2] [BC3-3] UpdateBanner com a região status sempre na página; cores neutras no aviso, no guia e no download (anel line-3 e Tag SEU SISTEMA).
- e9605bb [BC3-7] alvos do tour por tour.
- 49ee7ba [BC3-4] [BC3-5] [BC3-8] estados atualizacao-web e download-celular, o tour no passo mais longo, contas e a prova da moldura no README.
- b081d8b [BC3-1] [BC3-6] DESIGN_SYSTEM.
- Decisão: o clique que sobe dos Planos pra camada das Configurações continua fechando as duas (estrutura de antes, deixada de lado pela revisão); a guarda do BC1-M7 só olha o apertar dentro do Panel. Custo se errado: nenhum novo.
- Decisão: o prazo do BC2-I3 fica no pedido da amostra (rede), não na geração inteira, pra não cortar uma geração lenta de música longa num computador fraco. O alert existente ("Erro ao gerar metrônomo.") não mudou; a frase em português do prazo vai no erro (console). Custo se errado: quem usa vê o aviso genérico de erro.
- Portão (uma vez, `caffeinate -i`, HEAD b081d8b): vitest 4038 de 4038 (170 arquivos, sem "Errors", load 2,5 a 8,8); `tsc -b` limpo; `npm run typecheck` com os 7 antigos; ESLint nos 35 arquivos tocados: 8 erros, os mesmos 8 da base (linhas antigas); `DESKTOP=1 npx vite build` ok; verify-layout 298 de 298; prova `quebrado` em 390x844 e 1280x800 saindo com 1; travessão nas linhas acrescentadas desde 52eba03: 0.
