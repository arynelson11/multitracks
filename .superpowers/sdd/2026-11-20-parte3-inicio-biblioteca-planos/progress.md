# Ledger: Parte 3, partes 3 a 5 (tela inicial, Biblioteca e Planos no layout do palco)

Plano: `docs/superpowers/plans/2026-11-20-parte3-inicio-biblioteca-planos.md`. Branch `feat/parte3-inicio-biblioteca-planos`, base `e4dab79`.
Worktree: `~/playback-studio-work/parte3-inicio`. Uma linha por tarefa: commit e testes.

| Tarefa | Commit | Testes |
|---|---|---|
| T0 motor (N1 e gaveta) | 92ff71a | grid 49/49 (N1 RED antes), useStageSeparation 22/22 (2 RED antes) |
| T1 tela inicial | 3a556c4 | home 7/7, appWiring 57/57, livre ok; verify-layout inicio e inicio-anuncio 18/18 |
| T2 casca da Biblioteca | 02c31e7 | library 14/14 (com os 5 de hoje do LibraryModal), PricingModal 15/15 (1 novo: Planos por cima da janela do palco) |
| T3 linhas, editar, excluir e baixar | (este commit) | library + LibraryModal 29/29 (bpm 4, livre 6, view 15, rows 4); verify-layout biblioteca e biblioteca-editar 10/10 (5 tamanhos) |

## Decisões

- Decisão (T0 a): `readSongGrid` devolve `'de-novo'` quando um canal lido saiu da música durante a leitura (conferido pela id em `latest.channels`), e o corredor faz `continue` com `job.read` ainda ligado. Por quê: o Ruling pede descartar e manter a leitura; um terceiro resultado deixa o corredor como dono do `job.read`, como já é no `'espera'`. Custo se errado: uma leitura a mais (barata, no Worker) quando o click troca no meio.
- Decisão (T0 b): a correção fica no hook (`useStageSeparation`), não no App. Na troca de chave, o trabalho que sai grava na hora (`persist({}, w)`, sem esperar os 800 ms) e o `cuesPending` fica num conjunto por chave, aplicado quando a música volta e lida da gravação (a leitura da volta espera a gravação da troca). Não gera o canal da música que saiu (o `replaceChannel` do App é da música ativa). Custo se errado: a voz guia da música que saiu só é gerada ao voltar e fechar a gaveta parado (como o Ruling pede, sem o opcional).

- Decisão (T1): os estados do verificador são `inicio` (a `HomeScreen` sem anúncio) e `inicio-anuncio` (com o `AdSlot` de verdade no `ad`), os dois nos 8 tamanhos do palco e em 390x844, e não só nos 4 "de página" do plano. Por quê: o `PAGES`/`PAGE_SIZES` que o plano cita não existe (o Separador usou listas próprias no `run.mjs`); o `inicio` da 1b já media 9 tamanhos e nenhum tamanho pode sair. Custo se errado: 10 combinações a mais na rodada.
- Decisão (T1): a seção do DESIGN_SYSTEM é a 2.11, não a 2.10 do plano (a 2.10 já é a Separação, da faixa D). Custo se errado: o coordenador renumera.
- Decisão (T1): o lugar do anúncio (`data-home-ad`, `empty:hidden`) só monta quando o App passa `ad`; o App sempre passa o `AdSlot`, que decide sozinho (a vista não decide nada sobre anúncio). Custo se errado: nenhum no app.
- Decisão (T2): enquanto os Planos não viram janela do palco (T4), o `PricingModal` de antes sobe a camada pra um degrau acima da janela do palco mais alta aberta (`aboveStageDialogs`, lida do `openDialogs`). Por quê: a Biblioteca virou `StageDialog` (z-[120]) e o "Ver os planos" da tela de limite do Livre abria os Planos (z-[110]) atrás dela; a parte B tem de ser publicável sozinha. Custo se errado: uma tela de limite que abrisse com os Planos e a Biblioteca abertos ficaria no mesmo degrau dos Planos (raro: o limite espera a música parar); a T4 troca isso pela pilha.
- Decisão (T2): a busca e as abas ficam presas no alto da janela (`sticky`) enquanto a lista rola. Por quê: antes elas ficavam fora da rolagem; o `StageDialog` só tem título, conteúdo que rola e rodapé. Custo se errado: nenhum (nada some).
- Decisão (T3): "ADICIONADA" e "Mais Popular" são `Tag` neutras, não laranja (o plano pedia `on`). Por quê: o kit (revisão macro BC, BC1-M3) fixou laranja só pra ligado e neutro pra destaque e "Adicionada". O OFFLINE de música no aparelho é `Tag` neutra com a luz (`dot`), não musgo (musgo é ao vivo). Custo se errado: uma classe por selo.
- Decisão (T3): IMPORTAR, ABRIR, ADICIONADA, OFFLINE e SALVAR continuam em caixa alta (eram texto em caixa alta no código, não só CSS; a regra é não trocar texto). IMPORTAR e ABRIR passam a mostrar o texto também no celular (antes só o ícone abaixo de 640 px). Custo se errado: trocar strings no `ROW_COPY`/`EDIT_COPY`.
- Decisão (T3): o X da edição ganhou o nome "Fechar a edição" (antes sem nome) e o Esc dentro dela fecha só a edição; editando, a Biblioteca não fecha no Esc nem no toque fora (`dismissible={false}` do kit). Por quê: o kit diz que edição na linha não pode jogar fora o digitado. Custo se errado: nenhum (o X continua).
- Decisão (T3): o erro da edição aparece dentro do formulário (perto do SALVAR) e, sem edição aberta, no alto da lista. Por quê: com a edição no fim de uma lista longa, a frase no alto ficaria fora da tela. Custo se errado: nenhum.
- Decisão (T3): a capa nova ganhou o "Tirar" do `FilePicker` (voltar pra nenhuma capa escolhida). Por quê: prático e de função clara (antes não dava pra desfazer a escolha sem fechar a edição). Custo se errado: um botão a mais.
- Decisão (T3): a confirmação de excluir fica aberta, girando, até o `removeSong` terminar, e fecha sozinha depois (antes o `confirm` fechava na hora e a lixeira girava). Custo se errado: nenhum (a lixeira da linha também gira).
- Decisão (T3): `biblioteca` e `biblioteca-editar` medem também em 844x390 (celular deitado), além dos 4 do plano. Custo se errado: 2 combinações a mais.

## Tarefas
