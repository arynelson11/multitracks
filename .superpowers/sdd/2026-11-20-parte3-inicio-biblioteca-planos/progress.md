# Ledger: Parte 3, partes 3 a 5 (tela inicial, Biblioteca e Planos no layout do palco)

Plano: `docs/superpowers/plans/2026-11-20-parte3-inicio-biblioteca-planos.md`. Branch `feat/parte3-inicio-biblioteca-planos`, base `e4dab79`.
Worktree: `~/playback-studio-work/parte3-inicio`. Uma linha por tarefa: commit e testes.

| Tarefa | Commit | Testes |
|---|---|---|
| T0 motor (N1 e gaveta) | ver linha abaixo | grid 49/49, useStageSeparation 22/22 |

## Decisões

- Decisão (T0 a): `readSongGrid` devolve `'de-novo'` quando um canal lido saiu da música durante a leitura (conferido pela id em `latest.channels`), e o corredor faz `continue` com `job.read` ainda ligado. Por quê: o Ruling pede descartar e manter a leitura; um terceiro resultado deixa o corredor como dono do `job.read`, como já é no `'espera'`. Custo se errado: uma leitura a mais (barata, no Worker) quando o click troca no meio.
- Decisão (T0 b): a correção fica no hook (`useStageSeparation`), não no App. Na troca de chave, o trabalho que sai grava na hora (`persist({}, w)`, sem esperar os 800 ms) e o `cuesPending` fica num conjunto por chave, aplicado quando a música volta e lida da gravação (a leitura da volta espera a gravação da troca). Não gera o canal da música que saiu (o `replaceChannel` do App é da música ativa). Custo se errado: a voz guia da música que saiu só é gerada ao voltar e fechar a gaveta parado (como o Ruling pede, sem o opcional).

## Tarefas

