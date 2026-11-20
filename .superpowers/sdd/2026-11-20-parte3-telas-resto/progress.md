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
