# Ledger: Parte 3, partes 3 a 5 (tela inicial, Biblioteca e Planos no layout do palco)

Plano: `docs/superpowers/plans/2026-11-20-parte3-inicio-biblioteca-planos.md`. Branch `feat/parte3-inicio-biblioteca-planos`, base `e4dab79`.
Worktree: `~/playback-studio-work/parte3-inicio`. Uma linha por tarefa: commit e testes.

| Tarefa | Commit | Testes |
|---|---|---|
| T0 motor (N1 e gaveta) | 92ff71a (+ e99195f, tipo do teste da gaveta) | grid 49/49 (N1 RED antes), useStageSeparation 22/22 (2 RED antes) |
| T1 tela inicial | 3a556c4 | home 7/7, appWiring 57/57, livre ok; verify-layout inicio e inicio-anuncio 18/18 |
| T2 casca da Biblioteca | 02c31e7 | library 14/14 (com os 5 de hoje do LibraryModal), PricingModal 15/15 (1 novo: Planos por cima da janela do palco) |
| T3 linhas, editar, excluir e baixar | 491dac3 | library + LibraryModal 29/29 (bpm 4, livre 6, view 15, rows 4); verify-layout biblioteca e biblioteca-editar 10/10 (5 tamanhos) |
| T4 Planos | 6cb770c | pricing + PricingModal 32/32 (catálogo 4, vista 8, contêiner 20 com os 9 da T16 da 1b nos seletores novos); verify-layout planos e planos-oferta 10/10 (5 tamanhos) |

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
- Decisão (T4): o preço do primeiro mês fica neutro (`bone`, o mesmo tamanho do preço cheio), com "Primeiro mês por" em `ps-label`, e o anel do Pro Mensal é o `line-3` (mais forte), não laranja (o plano pedia o preço em `ps-or` e o anel laranja, Q9). Por quê: laranja quer dizer ligado ou ação principal; a tela de limite da 1b também mostra o preço da oferta neutro e deixa o laranja no botão. O laranja da tela fica só no botão do Pro Mensal (`primary`). Custo se errado: duas classes.
- Decisão (T4): "Abrimos o pagamento...", a oferta que terminou e os erros ficam no pé da janela (rodapé do `StageDialog`), sempre à vista. Por quê: antes os erros eram avisos do navegador por cima de tudo; no alto da lista, com os cartões em uma coluna no celular, a frase ficaria fora da tela de quem tocou no Studio Anual. Custo se errado: mover os `Notice` pro alto do conteúdo.
- Decisão (T4): a frase da oferta que terminou (`offerNote`) e a do erro (`message`) são separadas, como antes (a da oferta fica até fechar; o erro some a cada tentativa nova e ao abrir de novo). Custo se errado: nenhum.
- Decisão (T4): o clique dentro dos Planos (e no fundo deles) não sai da `PricingView` (`stopPropagation` numa volta `contents`). Por quê: as Configurações montam os Planos dentro da camada delas e fecham com clique que não cai na caixa delas; antes a caixa dos Planos parava o clique. O toque no fundo dos Planos agora fecha só os Planos (antes fechava as Configurações junto). Custo se errado: nenhum que eu tenha achado; quem quiser o clique de dentro terá de ouvir na captura.
- Decisão (T4): com os Planos virando janela do palco, a camada provisória da T2 (`aboveStageDialogs`) saiu: a pilha do kit põe os Planos por cima de qualquer janela aberta antes. Esc e toque fora fecham os Planos (antes só o X e o toque fora); com o "Trocar de plano?" aberto, o Esc fecha só ele. Custo se errado: nenhum.

## Motor (Tarefa 0): verify-pitch e section-jump, antes (e4dab79) e depois (92ff71a)

- verify-pitch completo: antes 521 critérios, 3 falhas; depois 521, 4 falhas. As 3 dos dois lados são o SPLIT sem a referência da v1.4.15 ("falta a referência"); a 4ª do depois foi a STALL (folga agendada fora por 2,663 ms, 1 bloco de relógio, carga perto de 6, com testes rodando ao lado). Rodados de novo sozinhos: STALL depois 13/13 e antes 13/13 (carga 4,7); referência `SPLIT --rev b53a95c --tag v1415` 27/27; SPLIT antes 38/38 e depois 38/38.
- section-jump: antes 13/13 OK, depois 13/13 OK.

## Portão final (uma vez, `caffeinate -i`, 2026-11-21)

- `npx vitest run`: 200 arquivos, 4496 testes, código 0, sem "Errors" (carga 2,7 no começo, 9,4 no fim).
- `npx tsc -b`: código 0.
- `npm run typecheck`: os 7 erros antigos (MetronomeModal.auto.test 1, useAudioEngine.grid.test 1 na linha 296, useAudioEngine.transition.test 5). Na primeira rodada eram 8: o 8º era do teste novo da gaveta (tipo do `getMockImplementation`), corrigido em e99195f.
- eslint nos 29 arquivos de código tocados: 7 erros e 23 avisos, todos antigos (App.tsx 6 erros e 1 aviso, useAudioEngine.ts 1 erro e 21 avisos, LibraryModal.tsx 1 aviso de deps que já existia); os mesmos números da base nesses arquivos.
- `DESKTOP=1 npx vite build`: ok.
- `node scripts/verify-layout/run.mjs`: 389 combinações, 389 ok, 0 falhas (26271 textos, 1873 botões só de ícone, 13003 alvos de toque).
- Travessão: 0 nas linhas adicionadas contra `origin/main` (5e52512, buscado agora), 0 nas da branch (e4dab79..HEAD) e 0 nas mensagens de commit. Os arquivos inteiros com travessão (DESIGN_SYSTEM, FATOS, App.tsx, useAudioEngine.ts) já tinham antes.


## Onda de correção da revisão macro (2026-11-21, a partir de ffcb300)

Revisões: `review-inicio-1.md` (motor, Biblioteca, App, verificador e docs) e `review-inicio-2.md` (tela inicial e Planos). Uma linha por achado.

| Achado | Commit | Testes |
|---|---|---|
| inicio-1 I1 e M1 (fila de gravação por separação, só o que mudou) | 3a23cd6 (+ 5e666dc, tipo no tsc) | useStageSeparation 25/25 (3 RED antes: click, voz guia e a ordem inversa; a prova do revisor passa) |
| inicio-1 I2 e M2 (frases do baixar, espaço em disco na janela) | 3694a75 | useCloudLibrary 4 novos (RED antes), LibraryModal 1 novo, o "nenhum alert" lê também o useCloudLibrary.ts |
| inicio-1 M3, M4 e M5 (lixeira, confirmação que não reabre, edição presa à aba) | 1441470 (+ 645b787, `confirmLabel`) | LibraryModal 5 novos e 2 ajustados (RED antes), removeScopeOf, removeSong 'device', vista |
| inicio-1 M6 e M7, inicio-2 Minor 7 (docs e verificador) | b2cf1bf | verify-layout dos estados novos 30/30 antes do portão |
| inicio-2 Minor 1 e 2 (erro tardio, aviso do navegador) | 7960888 | PricingModal 2 novos (RED antes) |
| inicio-2 Minor 3 e 4 (laranja só ligado, um anel) | 69bd3da | pricingView 2 novos (RED antes) |
| inicio-2 Minor 6 e 8 (Configurações com os Planos de verdade, paridade de preço) | 9103aa5 | SettingsModal.planos 3 novos (sem o stopPropagation, 2 falham), pricingCatalog 1 novo |
| inicio-2 Minor 5 (Q9) | sem commit | Ruling Q9-neutro: selo, anel e preço do primeiro mês ficam neutros |
| inicio-2 Important (Configurações sem hideOffer) | sem commit | corrigido na outra branch, chega pelo merge (não mexido aqui) |

### Decisões da onda

- Decisão (I1): a leitura da separação também entra na fila (e o efeito da leitura vem depois do da troca), pra a volta à música ler o que a gravação da troca e a de uma ação no ar deixaram. Custo se errado: a gaveta pode mostrar o carregando um pouco mais ao voltar pra música com gravação na fila (duas idas à rede).
- Decisão (M5): "Tirar deste aparelho" é o nome único de tirar só do aparelho, também pro admin e pra qualquer um sem internet (no lugar de "Remover do Cache Local" e "Remover do aparelho?"). O dono que não é admin, com a música fora do aparelho, fica sem lixeira (a RLS não deixa ele apagar na nuvem). Custo se errado: dois textos em `ROW_COPY`/`DELETE_COPY` e uma linha em `removeScopeOf`.
- Decisão (M4): a edição sai do que está à vista (`shownSongs`) em vez de fechar ao trocar de aba: o digitado fica guardado e volta com a aba. Custo se errado: fechar a edição no `onTab`.
- Decisão (M2): a frase de espaço é a de antes; cada tentativa de baixar limpa a frase da janela (também a de um erro da edição, se ela estiver aberta). Custo se errado: limpar só a de espaço.
- Decisão (I2): "Carregando offline..." e "Erro: Indisponível offline" ficaram (o Ruling lista os outros; "offline" já é palavra da tela, o selo OFFLINE).
- Decisão (Minor 7): o `planos-troca` junta os três avisos no pé mesmo pra quem já paga (a oferta que terminou não acontece pra ele): é o pior caso de layout, não um caso real.

### Portão da onda (uma vez, `caffeinate -i`, 2026-11-21)

- `npx vitest run`: 202 arquivos, 4519 testes, 4518 passaram e 1 falhou, sem "Errors": `useAudioEngine.outputs.test.ts` "papel manual Guia no Baixo religa no barramento da guia sem cortar o medidor" (teste de tempo do motor, `letAudioRun`, com carga 12,9 no fim da rodada). Sozinho, logo depois (carga 10,2): 42/42. O motor não foi tocado nesta onda.
- `npx tsc -b`: código 0.
- `npm run typecheck`: os 7 erros antigos (MetronomeModal.auto.test 1, useAudioEngine.grid.test 1 na linha 296, useAudioEngine.transition.test 5).
- eslint nos 22 arquivos .ts/.tsx tocados: 0 erros, 2 avisos antigos de deps (LibraryModal.tsx e useCloudLibrary.ts, efeitos não mexidos).
- `DESKTOP=1 npx vite build`: ok.
- `node scripts/verify-layout/run.mjs`: 411 combinações, 411 ok, 0 falhas (26829 textos, 1943 botões só de ícone, 13174 alvos de toque); carga de 8,3 a 15.
- Som, com a carga abaixo de 5 (4,8 ao começar): referência `SPLIT --rev b53a95c --tag v1415` 27/27; `verify-pitch` completo 521 critérios, 0 falhas; `section-jump` 13/13 OK.
- `api/`: 12 funções.
- Travessão: 0 nas linhas adicionadas contra `origin/main` (5e52512), 0 na onda (ffcb300..HEAD) e 0 nas mensagens de commit.

## Ajustes residuais (2026-11-27, a partir de 53f3eca; `review-inicio-fix.md`, Ruling INICIO-residuais)

| Ajuste | Commit | Testes |
|---|---|---|
| 1. A confirmação da lixeira guarda o escopo de quando abriu (`removeScopeHolds`) | dc61aa5 | LibraryModal.livre 2 novos (RED antes: a janela virava "Excluir da nuvem?" com a internet voltando, e "Excluir da nuvem?" virava "Tirar deste aparelho?" com a internet caindo), libraryRows 1 novo |
| 2. Textos técnicos da Biblioteca viram frases pro usuário | d75cc4b | useCloudLibrary 1 novo (RED antes: "Carregando offline...") e a guarda sem "offline" nem "Erro:", libraryRows 1 novo, 3 travas de texto acertadas (libraryView 2, LibraryModal.livre 1) |
| 3. A frase de espaço em disco com estado próprio, presa no alto | 7e49114 | LibraryModal.livre 1 novo e libraryView 1 novo (RED antes: a frase ia pro formulário e o IMPORTAR apagava o "BPM inválido"); verificador `biblioteca-editar` com as duas frases |

### Decisões dos ajustes

- Decisão (1): aberta como "Excluir da nuvem?", a internet cair (com a música ainda no aparelho) fecha a janela em vez de manter o título com uma ação que não dá mais pra fazer. Custo se errado: o admin perde a janela aberta e toca a lixeira de novo.
- Decisão (2): "Abrindo do aparelho...", "Essa música não está no aparelho. Conecte à internet pra baixar.", a dica "Abrir a música guardada neste aparelho" e "da Nuvem e deste aparelho?" no texto de excluir. O selo e o botão OFFLINE ficam (são o rótulo do estado na tela). A frase "Essa música não está no aparelho..." continua sem aparecer na linha (o `downloadingSongId` vai a nulo junto, como antes): só o texto mudou. Custo se errado: trocar a palavra.
- Decisão (3): a frase de espaço fica dentro do bloco preso da busca e das abas (sempre à vista com a lista rolada), substitui a decisão M2 da onda anterior (baixar não limpa mais o erro da edição) e só sai na próxima tentativa de baixar, como antes; fechar e abrir a Biblioteca não a limpa (igual ao erro da edição). Custo se errado: limpar ao abrir a janela.

### Portão dos ajustes (uma vez, `caffeinate -i`, 2026-11-27)

- `npx vitest run`: 202 arquivos, 4526 testes, 4525 passaram e 1 falhou, sem "Errors": `manualClickTrack.test.ts` "10 min de click: a thread nunca fica presa mais que 50 ms" (teste de tempo, carga de 13,6 no começo a 50,1 no fim). Sozinho, logo depois (carga 44): 6/6.
- `npx tsc -b`: código 0.
- `npm run typecheck`: os 7 erros antigos (MetronomeModal.auto.test 1, useAudioEngine.grid.test 1, useAudioEngine.transition.test 5).
- eslint nos 9 arquivos .ts/.tsx tocados: 0 erros, os 2 avisos antigos de deps (LibraryModal.tsx e useCloudLibrary.ts).
- `DESKTOP=1 npx vite build`: ok.
- `node scripts/verify-layout/run.mjs`: 411 combinações, 407 ok e 4 sem resposta em 40 s por carga (de 15,7 a 53,8), 0 falhas de layout; os 4 (`config` 810x1080, `novidades` 1024x740, `aovivo-erro` 900x740, `separador-player` 1920x1080) sozinhos com `--no-build --jobs 1`: 4/4 ok. As 25 da Biblioteca ok, `biblioteca-editar` com as duas frases nos 5 tamanhos.
- Travessão: 0 nas linhas adicionadas contra `origin/main` (67320d6), 0 nos ajustes (53f3eca..HEAD) e 0 nas mensagens.
