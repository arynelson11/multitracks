# Manutenção: quatro problemas antigos (branch fix/manutencao-antigos, base 53f3eca)

Worktree `/Users/macbookpro/playback-studio-work/manutencao`. Uma linha por item: commit e testes.
Base das medições de áudio: verify-pitch e section-jump com `--rev 53f3eca` (logs `pitch-antes.log`, `jump-antes.log` nesta pasta).

| Item | Status | Commit | Testes |
|------|--------|--------|--------|
| 1. Letra salva na música errada | feito | e63ccb7 | RED 7 falhas + módulo ausente; GREEN LyricsEditor 14, lyricsSave 4, appWiring ok (76 nos 3 arquivos) |
| 2. Login do admin preso em "carregando" | feito | 5ba55bd | RED 3; GREEN AdminLogin 9 (src/admin 434) |
| 3. Pads sem estado de envio | feito | 34d005b | RED 4; GREEN PadSetsModal 16 |
| 4. Faixas da separação na memória do iPad | feito | 0ed697a (motor), 31b4777 (Separador, App, FATOS) | RED 16 (stageHandoff 6, motor 4, Separador 5, assinatura 1) + stagedStems módulo ausente; GREEN 219 nos 12 arquivos tocados |

## Decisões
- Item 1: o App guarda a música (objeto) ao abrir (`lyricsEditorSong`) e o editor guarda de novo no primeiro render (useState), então o nome, a busca e a id não seguem a música ativa. `songInPlaylist` é calculado pela id a cada render; o `saveSongLyrics` confere de novo e devolve 'missing' sem gravar. Por que: o brief pede gravar sempre na de quando abriu. Custo se errado: nenhum pra quem usa (antes gravava na errada).
- Item 1: fora do repertório o Salvar desliga e a janela avisa, com o texto na área pra copiar; a janela não fecha sozinha (nem com o repertório vazio, que antes fechava o editor). Custo se errado: o admin fecha pelo X.
- Item 2: além do pedido que lança, o AuthRetryableFetchError (status 0) que o Supabase devolve sem lançar também mostra a frase da internet (antes dizia senha inválida). Custo se errado: nenhum; senha errada mantém a frase.
- Item 3: na falha a linha fica aberta (antes fechava calada), pra não perder o nome digitado e dar pra tentar de novo. Rótulos "Salvando..." e "Apagando..." no próprio botão.
- Item 4: o cache offline da biblioteca (offlineCache) NÃO foi usado: ele é preso a uma música da nuvem (índice CloudSong, sourceId) e não sai quando a música sai do repertório (vazaria centenas de MB por separação). As faixas descem direto pras chaves por faixa do repertório (`mt_files_<conta>:ch:<id>`, as mesmas que o loadFiles gravava depois), com a id do canal gerada no download; o loadFiles ganhou `storedStems` e lê de lá no decode (1 por vez no toque, 4 no computador, como antes). Estado final no aparelho igual ao de antes.
- Item 4: lista `mt_files_<conta>:staged` com a sessão e a hora de cada faixa gravada antes de entrar. A restauração tira as de outra sessão com mais de 1 h que nenhuma música usa (o app caiu entre o download e a música entrar). Por que 1 h: outra aba pode estar baixando agora. Custo se errado: faixas soltas ficam no disco até uma restauração depois.
- Item 4: o App tira as faixas quando a separação já estava no repertório (pular), quando outra chega antes de a anterior carregar e quando o loadFiles devolve false. Se o loadFiles lançar no meio, não tira (o registro provisório pode já apontar pra elas); a limpeza da restauração decide.
- Item 4: sem `stemStore` (não acontece no App), a separação abre no Separador de reserva em vez de baixar pro palco.
- Verificador: estados `letra-fora` e `padsnuvem-falha` (commit 99279dd), 9 tamanhos cada, 36/36 ok na rodada só deles.

## Portão (uma vez, com caffeinate -i; logs em `gate/`, carga no `gate/summary.txt` e `gate/rerun.txt`)
- verify-pitch ANTES (53f3eca, carga 46 a 52): 521 critérios, 6 falhas: 3 do SPLIT sem a referência da v1.4.15 (feita depois com `SPLIT --rev b53a95c --tag v1415`; o SPLIT de 53f3eca com ela: 38 critérios, 0 falhas), SONGS e SONGS_ANTIGO no relógio de áudio e SONGS_ANTIGO "som em todas as 30 faixas". Sozinhos (carga 10 a 19): SONGS, SONGS_ANTIGO e STALL, 101 critérios, 0 falhas.
- verify-pitch DEPOIS (HEAD, carga 9 subindo até 83): 521 critérios, 2 falhas: SONGS_ANTIGO no relógio de áudio (0,852) e STALL "folga agendada exata" (fora por 1 bloco, 2,667 ms). Sozinhos (carga 19 a 20): SONGS_ANTIGO e STALL passam; SONGS caiu só no relógio (0,929); SONGS sozinho de novo (carga 8): 44 critérios, 0 falhas.
- section-jump: antes 13/13 OK, depois 13/13 OK.
- vitest (carga 151 a 58): 204 arquivos, 4547 testes, 8 falhas em 6 arquivos não tocados (5 de prazo ou tempo, 3 asserções em outputs, voices e SubscribersTab); os 6 sozinhos (carga 25 a 20): 161/161. Fora da carga: 4547 testes, 0 falhas.
- tsc -b: 0. npm run typecheck: os mesmos 7 erros antigos (MetronomeModal.auto.test 1, useAudioEngine.grid.test 1, useAudioEngine.transition.test 5).
- eslint nos 22 arquivos tocados: nenhum erro novo (App 6, SeparatorStudio 7, useAudioEngine 1, todos de antes; PadSetsModal de 1 pra 0).
- DESKTOP=1 vite build: ok.
- verify-layout: 429 combinações, 428 ok e 1 sem resposta em 40 s (tom 1920x1080, carga 28 a 78); sozinha: ok. 0 falhas de medida.
- Travessão (U+2014): 0 nas linhas acrescentadas contra 53f3eca e contra origin/main, 0 nas mensagens de commit.
