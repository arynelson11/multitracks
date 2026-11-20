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
