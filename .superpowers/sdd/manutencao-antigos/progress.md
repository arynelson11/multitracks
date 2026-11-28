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
- Item 4: o cache offline da biblioteca (offlineCache) NÃO foi usado: ele é preso a uma música da nuvem (índice CloudSong, sourceId) e não sai quando a música sai do repertório (vazaria centenas de MB por separação). As faixas descem direto pras chaves por faixa do repertório (`mt_files_<conta>:ch:<id>`, as mesmas que o loadFiles gravava depois), com a id do canal gerada no download; o loadFiles ganhou `storedStems` e lê de lá no decode (1 por vez no toque, 4 no computador, como antes). Estado final no aparelho: os arquivos ficam nas mesmas chaves por faixa de antes, mas há a lista `mt_files_<conta>:staged`, que guarda a id de cada faixa até a música entrar no registro provisório (correção I1, `[manut-fix]`; antes dela, até uma restauração de outra sessão 1 h depois) e fica vazia depois. (Frase corrigida na revisão M5: antes dizia "igual ao de antes", o que não era exato.)
- Item 4: lista `mt_files_<conta>:staged` com a sessão e a hora de cada faixa gravada antes de entrar. A restauração tira as de outra sessão com mais de 1 h que nenhuma música usa (o app caiu entre o download e a música entrar). Por que 1 h: outra aba pode estar baixando agora. Custo se errado: faixas soltas ficam no disco até uma restauração depois.
- Item 4: o App tira as faixas quando a separação já estava no repertório (pular), quando outra chega antes de a anterior carregar e quando o loadFiles devolve false. Se o loadFiles lançar no meio, não tira (o registro provisório pode já apontar pra elas); a limpeza da restauração decide.
- Item 4: sem `stemStore` (não acontece no App), a separação abre no Separador de reserva em vez de baixar pro palco.
- Verificador: estados `letra-fora` e `padsnuvem-falha` (commit 99279dd), 9 tamanhos cada, 36/36 ok na rodada só deles.

## Portão (uma vez, com caffeinate -i; logs em `gate/`, carga no `gate/summary.txt` e `gate/rerun.txt`)
- verify-pitch ANTES (53f3eca, carga 46 a 52): 521 critérios, 6 falhas: 3 do SPLIT sem a referência da v1.4.15 (feita depois com `SPLIT --rev b53a95c --tag v1415`; o SPLIT de 53f3eca com ela: 38 critérios, 0 falhas), SONGS e SONGS_ANTIGO no relógio de áudio e SONGS_ANTIGO "som em todas as 30 faixas". Sozinhos (carga 10 a 19): SONGS, SONGS_ANTIGO e STALL, 101 critérios, 0 falhas.
- verify-pitch DEPOIS (HEAD, carga 9 subindo até 83): 521 critérios, 2 falhas: SONGS_ANTIGO no relógio de áudio (0,852) e STALL "folga agendada exata" (fora por 1 bloco, 2,667 ms). Sozinhos (carga 19 a 20): SONGS_ANTIGO e STALL passam; SONGS caiu só no relógio (0,929); SONGS sozinho de novo (carga 8): 44 critérios, 0 falhas.
- section-jump: antes 13/13 OK, depois 13/13 OK.
- vitest (carga 151 a 58): 204 arquivos, 4547 testes, 8 falhas em 6 arquivos não tocados (5 de prazo ou tempo, 3 asserções em outputs, voices e SubscribersTab); os 6 sozinhos (carga 25 a 20): 161/161. Somando, os 4547 passam (não rodei a suíte inteira de novo).
- tsc -b: 0. npm run typecheck: os mesmos 7 erros antigos (MetronomeModal.auto.test 1, useAudioEngine.grid.test 1, useAudioEngine.transition.test 5).
- eslint nos 22 arquivos tocados: nenhum erro novo (App 6, SeparatorStudio 7, useAudioEngine 1, todos de antes; PadSetsModal de 1 pra 0).
- DESKTOP=1 vite build: ok.
- verify-layout: 429 combinações, 428 ok e 1 sem resposta em 40 s (tom 1920x1080, carga 28 a 78); sozinha: ok. 0 falhas de medida.
- Travessão (U+2014): 0 nas linhas acrescentadas contra 53f3eca e contra origin/main, 0 nas mensagens de commit.

## Onda de correção das revisões (a partir de c3fe872, roteiro `parte3-faixas/manutencao-fix-brief.md`, commits com [manut-fix])

| Item | Commit | Testes (RED, depois GREEN) |
|------|--------|----------------------------|
| 1. C1: sessão do stagedStems sob demanda, id com reserva fora de contexto seguro | e7a287a | RED 1 ("crypto.randomUUID is not a function" ao carregar sem randomUUID); GREEN stagedStems 6 + motor 43. Busca em src/: os outros crypto.randomUUID só rodam em ações do computador (App: marcar seção e marcadores; motor: loadFiles, canais), nenhum ao carregar nem na tela da banda |
| 2. Verificação da rede local (scripts/verify-lan, README do verify-layout) | 1f3e370 | RED no build com o C1 (#root vazio, "Uncaught TypeError: crypto.randomUUID is not a function"); GREEN depois do C1 (montada, 0 erros). FollowerView 24 |
| 3. I1: anotação sai da lista no registro provisório | c6c2990 | RED 2; GREEN stagedStems + motor 51 |
| 4. M1: exceção no loadFiles desfaz; App tira em todo caso que não entrou | 39de60b | RED 2 (disco cheio no registro provisório, exceção depois dele); GREEN motor 46, appWiring 59 |
| 5. M2: frase do disco cheio | 3eff215 | RED 2; GREEN 34 |
| 6. M3: .catch nos dois descartes soltos | 05912c6 | RED 2; GREEN 82 |
| 7. M4: storedStemsToDrop puro; Voltar depois de um put; uma por vez no toque | 000d997 | RED 1 (função ausente); mutação: sem o descarte os dois testes de Voltar falham; GREEN 143 |
| 8. M5: lista vazia sem DataTransfer; frase do ledger | e2fa2a2 | RED 2 (appWiring); GREEN 107; tsc 0 |
| 9. I1 telas: foco no envio (pads e letra) | ec83ffe | RED 7; GREEN 38 (com o Buscar letra; mutação confirma) |
| 10. Ruling defesa: onKey do palco antigo com janela aberta | 53a0f83 | RED 1; GREEN 101 |
| 11. M2 telas: toque duplo no mesmo act, guarda da letra, o Esc do comentário | 6c05749 | testes novos; mutação: sem o ref e sem a guarda os 3 falham; GREEN 41 |
| 12. M3 pads: uma linha aberta por vez | b95a6a9 | RED 1; GREEN 23 |
| 13. M4 pads: campos só de leitura no envio | f3548ee | RED 1; GREEN 24 |
| 14. M5 pads: escolher desligado no envio | 3d31cc2 | RED 2; GREEN 26 |
| 15. M6 letra: só id, nome, artista, duração e textos; viva pela id; sai quando a conta muda | c718ee1 | RED 2; GREEN 85 |
| 16. M7: frase do FATOS do login | c3f204d | docs |
| 17. M8: login com as formas reais, console sem a senha, pads com a janela fechada e Esc, estados do verificador | 796496c | RED 1 (console levava a senha no objeto do erro); os outros cobrem o que já funcionava; verificador 90/90 nos estados tocados |
| 18. Login 429 e 500/AuthUnknownError | 4c45bfd | RED 3; GREEN src/admin 441 |

### Decisões da onda
- Item 2: script próprio (`scripts/verify-lan/run.mjs`) documentado no README do verify-layout, em vez de um modo do verify-layout: ele serve o `dist/` real (não a página de medida) e mede outra coisa. O marcador da tela da banda é `data-follower-view` no FollowerView (só atributo). Custo se errado: nenhum.
- Item 9: o foco vai pra janela no começo do envio (o botão desligado não fica com ele) e, no fim, volta pro botão apertado (falha) ou fica na janela (sucesso). O campo de texto com foco fica com ele. Na letra também no Buscar letra (mesmo defeito, mesmo arquivo).
- Item 11: a guarda `if (!songInPlaylist) return` só é alcançável se um clique chegar com o botão desligado; o teste chama o onClick do botão pelas props do React (`__reactProps$`), com comentário. Sem a guarda o teste falha.
- Item 17: estado `adminlogin-rede` no verificador fica de fora: o build do verificador não tem o Supabase (sem .env), então o login só chega no "Supabase não configurado.".
- Item 18: a frase do servidor é "O servidor teve um problema agora. Tente de novo em alguns minutos." (não havia uma frase do servidor no app pra reaproveitar). O `AuthRetryableFetchError` (rede e os 502, 503 e 504 que o auth-js repete) continua com a frase da internet, pelo nome.
- Item 9 (complemento, 2cc5d6a): os ajudantes do foco da letra saíram do componente (o lint acusava 2 avisos novos de dependência).

### Portão da onda (logs em `gate-fix/`, carga 5 a 8)
- Testes dos arquivos tocados (e vizinhos: admin, appWiring, FollowerView, letra, pads, Separador, StageDialog, motor, useLiveSync, letra e cifra, separação, stagedStems, teleprompter, blockedGate): 43 arquivos, 810 testes, 0 falhas.
- `npx tsc -b`: 0. `npm run typecheck`: os mesmos 7 erros antigos.
- eslint nos 23 arquivos tocados: nenhum erro nem aviso novo (App 6 erros e 1 aviso, SeparatorStudio 7, useAudioEngine 1 e 21 avisos, todos de antes).
- `DESKTOP=1 npx vite build` (dentro do verify-lan): ok.
- `node scripts/verify-lan/run.mjs`: a tela da banda monta em http://192.168.18.210, fora de contexto seguro (sem randomUUID), 0 erros soltos. No build de antes do C1: #root vazio e 1 erro solto.
- verify-layout dos estados tocados (letra, cifra, letra-fora, os 6 dos pads, adminlogin): 90/90.
- Travessão: 0 nas linhas acrescentadas contra origin/main, 0 nas mensagens da onda e da branch.
- Fora do portão pedido (o loadFiles mudou nesta onda): verify-pitch inteiro 521 critérios, 0 falhas (carga 3 a 5); section-jump 13/13 OK.
