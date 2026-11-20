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

