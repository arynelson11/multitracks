# Ledger: Parte 3, partes 3 a 5 (tela inicial, Biblioteca e Planos no layout do palco)

Plano: `docs/superpowers/plans/2026-11-20-parte3-inicio-biblioteca-planos.md`. Branch `feat/parte3-inicio-biblioteca-planos`, base `e4dab79`.
Worktree: `~/playback-studio-work/parte3-inicio`. Uma linha por tarefa: commit e testes.

| Tarefa | Commit | Testes |
|---|---|---|
| T0 motor (N1 e gaveta) | 92ff71a | grid 49/49 (N1 RED antes), useStageSeparation 22/22 (2 RED antes) |
| T1 tela inicial | (este commit) | home 7/7, appWiring 57/57, livre ok; verify-layout inicio e inicio-anuncio 18/18 |

## Decisões

- Decisão (T0 a): `readSongGrid` devolve `'de-novo'` quando um canal lido saiu da música durante a leitura (conferido pela id em `latest.channels`), e o corredor faz `continue` com `job.read` ainda ligado. Por quê: o Ruling pede descartar e manter a leitura; um terceiro resultado deixa o corredor como dono do `job.read`, como já é no `'espera'`. Custo se errado: uma leitura a mais (barata, no Worker) quando o click troca no meio.
- Decisão (T0 b): a correção fica no hook (`useStageSeparation`), não no App. Na troca de chave, o trabalho que sai grava na hora (`persist({}, w)`, sem esperar os 800 ms) e o `cuesPending` fica num conjunto por chave, aplicado quando a música volta e lida da gravação (a leitura da volta espera a gravação da troca). Não gera o canal da música que saiu (o `replaceChannel` do App é da música ativa). Custo se errado: a voz guia da música que saiu só é gerada ao voltar e fechar a gaveta parado (como o Ruling pede, sem o opcional).

- Decisão (T1): os estados do verificador são `inicio` (a `HomeScreen` sem anúncio) e `inicio-anuncio` (com o `AdSlot` de verdade no `ad`), os dois nos 8 tamanhos do palco e em 390x844, e não só nos 4 "de página" do plano. Por quê: o `PAGES`/`PAGE_SIZES` que o plano cita não existe (o Separador usou listas próprias no `run.mjs`); o `inicio` da 1b já media 9 tamanhos e nenhum tamanho pode sair. Custo se errado: 10 combinações a mais na rodada.
- Decisão (T1): a seção do DESIGN_SYSTEM é a 2.11, não a 2.10 do plano (a 2.10 já é a Separação, da faixa D). Custo se errado: o coordenador renumera.
- Decisão (T1): o lugar do anúncio (`data-home-ad`, `empty:hidden`) só monta quando o App passa `ad`; o App sempre passa o `AdSlot`, que decide sozinho (a vista não decide nada sobre anúncio). Custo se errado: nenhum no app.

## Tarefas


