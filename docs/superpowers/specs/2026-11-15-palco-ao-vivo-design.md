# Palco ao vivo + app na linguagem nova: layout novo e troca de seção com contagem (Projeto 1)

**Data:** 2026-11-15
**Status:** APROVADO pelo dono (Ary) em 2026-11-15. Próximo passo: plano de implementação (superpowers:writing-plans), começando pela Parte 1.
**Mockup visual aprovado (fonte da verdade do visual):** `.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html` (HTML interativo, abrir no navegador). Ele já resolve espaçamentos, estados e ícones; este documento descreve o comportamento e as regras.

---

## 1. Por que

No culto, quando o ministro muda o rumo da música (repetir o refrão, voltar pro verso, ir pra ponte), o operador **para a VS**. A função de trocar de seção já existe no app, mas fica pequena e escondida (`src/components/SectionBar.tsx`: faixa de 64px, ações em ícones de 10px), tocar no bloco pula na hora com corte seco, e o pulo é disparado pela checagem de tela (`requestAnimationFrame` + `seekTo`), o que pode dar soluço e cair fora do tempo.

O objetivo é que trocar de seção ao vivo seja **visível, a um toque, e musicalmente perfeito**, a ponto de o operador nunca mais precisar parar a VS.

Referência que o dono gosta: app "Playback" da MultiTracks.com e a "Controladora Elite" (concorrente). Usar a mesma linguagem (onda grande com seções, transporte, mixer embaixo), **com a identidade do Playback Studio e diferenças suficientes pra não ficar igual**.

## 2. Objetivos

1. Tela do palco nova (computador e tablet) com as seções sempre à vista e grandes.
2. Troca de seção com o comportamento do item 4: termina o trecho, conta no click, entra no tempo.
3. Pulo **cravado no tempo** (agendado no relógio do áudio, sem soluço).
4. Seções novas **encaixadas no compasso** (usando BPM + 1º tempo de `src/lib/beatGrid.ts`).
5. Atalhos práticos novos no transporte (lista na seção 5).

## 3. Não objetivos (outros projetos, nessa ordem combinada)

- **Projeto 2:** detecção automática de seções (o app entrega a música já marcada). Pesquisa em andamento.
- **Projeto 3:** celular deitado no Modo Ao Vivo, com botão que alterna Seções / Letra / Cifra (cada visão ocupa a tela toda).
- **Projeto 4:** ajuste de andamento (BPM −5 −1 +1 +5), que vale só pra aquele momento e não fica salvo. Exige todas as faixas no motor signalsmith; ver risco de CPU na seção 8.
- **Projeto 5:** integração com o Holyrics.
- Fora de tudo: GRUPOS, botões de visualização (mixer/letra/grade), lupa de zoom na onda.

**Antiobjetivos** (seria fracasso mesmo "funcionando"):
- O pulo dar soluço, corte audível ou cair fora do tempo.
- A contagem sair na PA (ela é só do click / ouvido da banda).
- Botão na tela sem função real (regra do dono).
- Regressão de desempenho em música de 24 canais (já tivemos silêncio total por worklets demais, v1.3.10).
- Quebrar o Modo Ao Vivo, o modo offline ou o app desktop (Electron roda de `file://`).

## 4. Comportamento da troca de seção (decidido pelo dono)

1. O operador toca numa seção (na onda ou na botoeira). Ela fica **armada** ("PRÓXIMA"), destacada e pulsando, e aparece o aviso PRÓXIMA no transporte. Tocar de novo na armada **cancela**. Tocar em outra seção troca o alvo.
2. A VS **continua tocando normal** até o fim da seção atual. Nada para.
3. **No último compasso da seção atual, entra a contagem 1-2-3-4 só no canal do click** (ouvido da banda, nunca na PA). É o próprio click acentuado, sem voz falando o nome da seção. A contagem segue o compasso da música (4/4 conta 4; outro compasso conta os tempos dele). As bolinhas do aviso PRÓXIMA acompanham a contagem.
4. **No primeiro tempo do compasso seguinte, a VS entra na seção escolhida**, sem soluço e sem sair do tempo.
5. **Sempre existe click.** Não há VS sem click. Se uma música chegar sem faixa de click, o app gera uma ao carregar, com o BPM e o 1º tempo detectados *(decisão do Claude)*.
6. Mantém o que já existe: repetir a seção N vezes (seletor − / +), repetir infinito (∞), "repetir a atual", banda controlando pelo celular no Modo Ao Vivo conforme o plano. **Novo:** o REPETIR passa a usar o mesmo fluxo do pulo (termina a seção, conta 1-2-3-4 no click e volta pro começo dela), repetindo o número de vezes escolhido.
7. **Como o armado aparece (aprovado no mockup v5):** o armado é **branco** (borda branca, listras animadas e uma seta tracejada na onda saindo do fim da seção atual até a escolhida), pra não confundir com nenhuma cor de seção. A contagem aparece em 3 lugares ao mesmo tempo: bolinhas no aviso PRÓXIMA, número grande no botão da seção armada e no canal Click. Antes do último compasso o aviso mostra "em N comp.". O aviso tem um X pra cancelar. Se o click estiver mudo, o aviso mostra **"CLICK DESLIGADO"** (a banda não vai ouvir a contagem).
8. **Código de cores com um significado só:** laranja = ligado; branco = armado; cor da seção = seção; âmbar = alerta.

*(decisão do Claude)* Se o operador armar com menos de um compasso inteiro faltando pra acabar a seção, a contagem sai curta (só os tempos que faltam) e o pulo acontece no fim da seção do mesmo jeito.

## 5. Layout (decidido pelo dono)

De cima pra baixo, no computador:

1. **Barra fina do app:** logo PlayMark + "Playback Studio", ONLINE, menu (REPERTÓRIOS, FAIXAS, BIBLIOTECA, EDITAR, HOST no desktop, CONFIG, INÍCIO do app, usuário/SAIR).
2. **Transporte centralizado.** Aviso **PRÓXIMA** pulsando à direita, só quando há pulo armado, com as bolinhas da contagem.
3. **Forma de onda grande** com as seções como blocos coloridos por tipo e o playhead. Tocar num bloco arma o pulo.
4. **Botoeira de seções:** fileira de botões grandes, um por seção, na ordem da música, com estados AGORA e PRÓXIMA.
5. **Faixa do meio, alta:** tempo atual grande + BPM e compasso (só exibição neste projeto); TOM; seção atual com repetir/∞; capa com música **anterior / próxima** + título + posição no repertório ("1 de 6"); botões grandes **PAD** e **LETRA** (teleprompter).
6. **Mixer plano e enxuto.** Em cada canal, de cima pra baixo: **PAN** (knob, com valor L/C/R) → **fader com o nível acendendo dentro do trilho** → **M S** → nome. Coluna de botões ao lado (inclui EDITAR CANAIS e atalho de PADS) e canal PRINCIPAL separado à direita.
7. **Painel de pads escondido:** só abre (por cima do mixer) ao apertar PAD. Mantém abas PADS / SAMPLES / LOOPS, volume, grade C a B, conjunto na nuvem e EDITAR.

A **lista completa do repertório e as Anotações saem da frente** e ficam no painel REPERTÓRIOS. Durante o culto bastam anterior/próxima (decisão do dono; o lugar das Anotações é *decisão do Claude*).

**MARCAR e EDITAR seções ficam FORA do palco** (decisão do dono, pra evitar toque acidental no culto). Continuam acessíveis pelo EDITAR do menu. Os atalhos de marcar por tecla (I V P R B F) também valem só no modo de edição. *(o comportamento dos atalhos fora do palco é decisão do Claude; hoje eles funcionam direto no palco)*

**Detalhes aprovados no mockup v5:**
- Transporte: seletor **AUTO / PARAR / FADE** à esquerda ("FIM DA MÚSICA"); no centro COMEÇO, Play (PlayMark, anel pulsa no tempo), LOOP, CLICK com o botãozinho do METRÔNOMO colado, PRÉ-CONT. com o número de tempos colado, SEÇÃO ◂ ▸; aviso PRÓXIMA à direita.
- Botoeira: cada botão mostra a tecla de atalho (1 a 9) e o tempo de início; o AGORA mostra o progresso ("comp. 9/12").
- Música anterior/próxima **só perto da capa**, não ao lado do Play (evita trocar de música sem querer). O botão de próxima diz "A SEGUIR: <nome>".
- Faixa do meio: tempo/duração em fonte mono grande; TOM abre a grade de 12 tons com −1, ORIG. e +1; seção atual com REPETIR (− Nx +) e ∞.
- Mixer: PAN com arco na cor do canal, centro marcado e valor ao lado; arrastar gira, duplo clique centraliza. Nível segmentado com marca de pico e 0 dB. **Fader só muda arrastando** (toque sem querer não pula o volume); duplo clique volta a 0 dB. Solo escurece os outros canais; mute apaga o canal. Principal com nível estéreo L/R e escala em dB.
- Painel de pads abre **sem cobrir o Principal**.
- Atalhos de teclado: 1 a 9 arma a seção; setas = seção anterior/seguinte; Esc cancela; L = loop.
- Os botões de andamento (−5 −1 +1 +5, "ANDAMENTO ALTERADO" em âmbar, "original 72") aparecem no mockup mas **só entram no Projeto 4**. No Projeto 1 o BPM é só exibição (regra: nenhum botão sem função).
- O botão "DEMO" no canto da onda existe só no mockup.
- Ícones em SVG (não caracteres que viram emoji no Mac); fontes Inter + JetBrains Mono com números de largura fixa; alvos de toque de pelo menos 44px (exceto M/S com 14 canais em 1280px, que fica em ~36x32px; o dono aprovou o mockup com esse tamanho).
- Nenhum texto pode encostar na borda ou ficar cortado (pedido explícito do dono). O mockup v5 passou num verificador automático em 1280x760, 1280x800, 1440x900 e 1920x1080; a implementação deve manter isso.

**Controles novos (não existem hoje, vamos construir):**
- **COMEÇO:** volta a VS pro 0:00 (nome diferente do INÍCIO do app, que vai pra tela inicial).
- **SEÇÃO ◂ ▸:** arma a seção anterior / seguinte.
- **LOOP** no transporte: repete a seção atual no infinito (mesma função do ∞ que já existe).
- **CLICK** no transporte: liga/desliga o canal de click (atalho do M do canal).
- **TOM −1 / +1:** atalho do `changePitch`, além do botão TOM que abre a grade de 12 tons (que já existe).
- Botoeira de seções e aviso PRÓXIMA com contagem.

**Controles que já existem e continuam:** AUTO / PARAR / FADE (seletor de fim de música), anterior / play-pause (com pré-contagem) / próxima, PRÉ-CONTAGEM, METRÔNOMO, TOM (grade), MARCAR seção (atalhos I V P R B F), EDITAR seções, repetir N / ∞, pan / volume / M / S por canal, EDITAR CANAIS, PRINCIPAL, pads, letra (teleprompter), HOST.

**Identidade visual:** dark `#121214`, laranja `#FF6B35`, bone `#E8E8EC`, musgo `#5B6B47`. Cores por seção (de `SECTION_SHORTCUTS`): Intro `#3b82f6`, Verso `#10b981`, Pré `#f59e0b`, Refrão `#FF6B35`, Ponte `#8b5cf6`, Final `#ec4899`. Nunca usar travessão em texto da interface.

## 5b. O app todo na linguagem nova (entra neste mesmo projeto, decisão do dono)

O dono aprovou o visual do palco (mockup v5) e quer **o app inteiro** nessa linguagem, no mesmo projeto ("vamos fazer junto, já quero ver no app").

**Linguagem a levar pro app todo (extraída do mockup v5):** tokens de cor (fundo, superfícies s1/s2/s3, linhas, laranja e suas variações "soft"/"line", bone, musgo, âmbar de alerta, branco do armado), raios, espaçamentos, botões (com largura que acompanha o texto, nunca fixa com texto dentro), chips, seletor segmentado, painéis, LEDs de estado, tipografia (Inter + JetBrains Mono, números de largura fixa), ícones SVG. Código de cores com um significado só (laranja = ligado, branco = armado, cor da seção = seção, âmbar = alerta). Nenhum texto encostando na borda ou cortado.

**Telas e peças que mudam** (componentes atuais em `src/components/` e `src/admin/`): palco (`App.tsx` + `SectionBar.tsx`), Separador IA (`SeparatorStudio.tsx`), Biblioteca (`LibraryModal.tsx`), repertórios/faixas, Configurações (`SettingsModal.tsx`, `ProfileTab.tsx`), Planos (`PricingModal.tsx`), Metrônomo (`MetronomeModal.tsx`), conjuntos de pads (`PadSetsModal.tsx`), Modo Ao Vivo/host (`LiveModeModal.tsx`), editor de letra (`LyricsEditor.tsx`), teleprompter, novidades (`WhatsNewModal.tsx`), aviso de atualização (`UpdateBanner.tsx`), tour guiado (`GuidedTour.tsx`), login (`AuthPage.tsx`), página de download (`DownloadPage.tsx`) e o painel `/admin`.

**Ficam de fora deste projeto:** a landing (`LandingPage.tsx`, `DemoMixer.tsx`), que é página de marketing e tem a sua própria direção; e o `FollowerView.tsx` (celular no Modo Ao Vivo), que é o Projeto 3. *(as duas exclusões são decisão do Claude)*

**Ordem dentro do projeto** *(decisão do Claude)*: (1) tokens e peças base no tema do Tailwind v4 (`@theme` em `src/index.css`; hoje `--color-primary` está `#d4a843`, verificar contra o laranja da marca `#FF6B35`); (2) palco com a troca de seção; (3) demais telas, uma a uma, cada uma revisada antes da próxima.

**O app tem assinantes pagantes usando em produção** (o dono avisou e autorizou mexer). Então: trabalho em branch, nada vai pra produção sem o dono ver e aprovar, e o fluxo de lançamento continua sendo o de sempre (web + desktop juntos, push e tag pelo @devops). Nenhuma função existente pode sumir no restyle: muda a cara, não o que o app faz (exceto o que este documento manda mudar no palco).

## 5c. Nomes de canais organizados automaticamente (pedido do dono)

Hoje os canais aparecem com o nome cru do arquivo importado, grande e feio (ex.: `CLICK 13..`, `BASS_1`, `DRUMS_1`, `AG BASE_..`, `AG DEDIL..`, `AMB REVE..`, `GTR AMB ..`, `GTR SOLO..`, `GTR1_1`, `KEY 1_1`, `KEY 2_1`, `MASTER_1`, `PIANO DE..`). O dono quer que o app **reconheça e deixe no padrão**, como no mockup: `Click`, `Guia`, `Bateria`, `Percussão`, `Baixo`, `Synth Bass`, `Violão`, `Guitarra 1`, `Guitarra 2`, `Teclado`, `Piano`, `Pad`, `Vocal`, `Backing`.

Regras:
- Reconhecer o instrumento por palavras comuns em PT e EN, siglas e números (ex.: CLICK/METRO/CLK → Click; GUIDE/GUIA/CUE → Guia; DRUMS/BATERIA/KIT → Bateria; PERC → Percussão; BASS/BAIXO/BX → Baixo; SYNTH BASS/SUB → Synth Bass; AG/ACOUSTIC/VIOLAO/VL → Violão; EG/GTR/GUITAR/GUIT → Guitarra; KEY/KEYS/TECLADO/SYNTH → Teclado; PIANO/PNO → Piano; PAD → Pad; VOX/VOCAL/LEAD/VOZ → Vocal; BV/BACKING/CORO/CHOIR → Backing; AMB/AMBIENCE → Ambiência).
- Manter o complemento útil em português e curto: `AG BASE` → Violão Base, `AG DEDIL` → Violão Dedilhado, `GTR SOLO` → Guitarra Solo, `GTR AMB` → Guitarra Ambiente. Remover sufixos de exportação (`_1`, `13`, extensão, "copy").
- Mesmo instrumento repetido ganha número (Guitarra 1, Guitarra 2; Teclado 1, Teclado 2).
- Nome que não reconhecer: só limpa (tira sufixos e underscores, capitaliza) sem inventar instrumento.
- Cor do canal pela família do instrumento (consistente entre músicas).
- **O nome que o usuário der no EDITAR CANAIS sempre vence** o automático.
- *(decisão do Claude)* A normalização é aplicada na exibição a partir do nome original, que continua guardado (aparece no EDITAR CANAIS). Assim nada se perde e funciona também nas músicas que já estão na biblioteca, sem mexer nos 3 lugares onde os dados da música ficam guardados.
- **Ordem padrão dos canais (decisão do dono):** Click e Guia primeiro, depois Bateria, Percussão, Baixo, Synth Bass, Violões, Guitarras, Teclados, Piano, Pad/Ambiência, Vocal, Backing; o que não for reconhecido vai pro fim. Mesma família mantém a ordem original entre si. O app já tem `reorderChannels` em `useAudioEngine.ts` (reordenação manual no modo de edição): **se o usuário reordenar na mão, a ordem dele vence** e deixa de ser reaplicada naquela música. *(decisão do Claude)*
- Os detectores que hoje acham o canal de click/guia pelo nome (ex.: o `waveBuffer` do `SectionBar` em `App.tsx`, o metrônomo) devem usar a mesma regra de reconhecimento.

## 5e. Saídas de áudio independentes: VS x Click/Guia (Parte 2, decisão do dono)

Na mesa de som existe **um canal pra Click/Guia e outro pra VS**. Hoje o dono resolve isso girando na mão o pan de cada canal (click/guia todo pra esquerda, o resto todo pra direita), o que amarra os knobs de pan ao roteamento. O app passa a separar sozinho, **independente do pan dos canais**, pelo papel do canal (Click/Guia x Normal, seção 9b):

- **Saída de 2 canais** (fone do computador ou placa de 2 canais; o dono usa hoje uma Focusrite de 2 canais): saída 1 = **Click + Guia**, saída 2 = **VS** (soma mono de todos os canais normais, com compensação de nível pra não distorcer). Com 2 saídas a VS fica mono por física (uma das duas vai pro click/guia), o que bate com a mesa ter 1 canal pra VS. Lado trocável (1 ↔ 2) *(decisão do Claude)*.
- **Placa de 4 ou mais canais** (o dono quer o app pronto pra quando tiver): **VS em estéreo nas saídas 1/2** (aí o pan dos canais vale), **Click e Guia em saídas próprias** (ex.: 3 = Click, 4 = Guia, ou os dois juntos em 3/4), com um mapa de saídas configurável.
- **Tudo junto em estéreo** continua existindo como opção (ensaio em casa no fone, sem mesa) *(decisão do Claude)*.
- Base no código: já existe a escolha do aparelho de saída (`setSinkId` em `useAudioEngine.ts`) e a aba "Buses" nas Configurações com `bus: '1' | '2' | '1/2'` por canal, mas o roteamento por bus **nunca foi ligado** (`bus1GainRef`/`bus2GainRef` são lidos e nunca criados). A Parte 2 completa isso (provável `ChannelMergerNode` + `destination.channelCount` discreto pra 4+ saídas). Suporte a mais de 2 saídas precisa ser testado no app desktop e no Chrome; Safari/iPad provavelmente ficam limitados a 2.
- A contagem do pulo (seção 4) sai onde o Click sai.

## 5d. Entrega em partes (decisão do dono)

Vai pros assinantes **em partes**, cada parte só depois do dono ver e aprovar, com o fluxo normal de lançamento (web + desktop juntos):

- **Parte 1, linguagem nova + canais organizados:** tokens e peças base no tema; nomes de canais reconhecidos e ordem padrão (5c), incluindo papel do canal e renomear no EDITAR CANAIS. Menor risco.
- **Parte 2, palco novo + troca de seção:** layout do palco (5), pulo agendado no relógio do áudio com contagem no click (4), BPM com decimais, compasso por música, modo EDITAR do palco, protocolo do Modo Ao Vivo (9b). Com uma **chave pra voltar ao palco antigo** se der problema num domingo *(onde fica a chave é decisão do construtor)*.
- **Parte 3, demais telas:** restyle das telas listadas em 5b, uma a uma.

O dono autorizou usar **vários agentes em paralelo** e pediu pra distribuir da melhor forma. A divisão em tarefas paralelas (sem dois agentes mexendo no mesmo arquivo ao mesmo tempo) é do plano de implementação.

## 6. Plataformas e planos

- **Computador e tablet:** palco completo deste documento. Web e app desktop, com toda atualização saindo junto pras duas plataformas.
- **Celular:** fica no Projeto 3 (Modo Ao Vivo, sempre deitado).
- **Planos:** seguem as regras atuais de `src/lib/plans.ts`. Marcar seções é dos pagos; loop infinito é dos pagos; banda controlando seções pelo celular é do Studio. No Livre, a botoeira aparece vazia com o convite pra marcar (que leva ao upgrade). *(como mostrar no Livre é decisão do Claude)*

## 7. O que o código já tem (pontos de partida)

- `src/components/SectionBar.tsx`: onda + blocos + loop/salto. Base pra onda e botoeira novas.
- `src/hooks/useAudioEngine.ts`: `armLoop` / `armJump` / `cancelJump`, `loopRef` / `jumpRef`, e o laço `updateTime` (rAF) que executa loop e salto via `seekTo`. **Isso é o que precisa virar agendamento no relógio do áudio.**
- `src/lib/syncedTrackPlayer.ts`: já faz play/seek de várias faixas no mesmo tick com `start(when)` (usado no Separador). Pode servir de modelo.
- `src/lib/beatGrid.ts`: BPM com decimais + 1º tempo + tempo forte. Base pra encaixar seções no compasso e calcular o instante exato do pulo.
- Pré-contagem (`playWithPrecount`, `precountBeats`) e metrônomo já existem.
- Modo Ao Vivo: `useLiveSync` e `FollowerView` já mandam `arm-jump` / `arm-loop` / `cancel-loop`. O estado "armado" e a contagem precisam chegar aos celulares conectados.
- Seções (`markers`) vivem em **3 lugares**: banco (`songs`), cache offline (`src/lib/offlineCache.ts`) e repertório persistido. Qualquer mudança nelas (ex.: encaixar no compasso) precisa sincronizar os 3.

## 8. Restrições e riscos técnicos

- **Desempenho:** o motor signalsmith só liga com tom ≠ 0, porque 24 worklets ao mesmo tempo silenciaram o áudio. O pulo agendado não pode criar worklets novos à toa nem duplicar nós de áudio a cada pulo.
- **Desktop `file://`:** nada de caminho absoluto `/` pra assets (usar `import.meta.env.BASE_URL`).
- **Tom alterado:** pular com tom ≠ 0 precisa manter a cadeia do pitch funcionando, sem sumir o som.
- **Latência do signalsmith** (`latency()`): o playhead pode adiantar alguns ms. Avaliar se afeta o casamento visual da contagem.
- Atualizar `PLAYBACK_STUDIO_FATOS.md` (features e histórico) quando sair.

## 9. Deixado para o construtor

- Arquitetura exata do agendamento (parar fontes atuais e iniciar as novas no mesmo `when`, ou outra técnica equivalente) e como gerar a contagem acentuada no canal de click respeitando o fader, o pan e o mute do click.
- Como encaixar no compasso as seções já marcadas antes (regravar ou só considerar a grade na hora do pulo).
- Layout do tablet em retrato (paisagem é o principal) e quebras de tela entre 1024 e 1280px.
- Atalhos de teclado pros controles novos.

## 9b. Respostas à revisão (decisões do Claude, marcadas pro dono conferir)

- **Posicionar a VS livremente continua existindo** (nenhuma função some). Com a VS **parada**, tocar numa seção (onda ou botoeira) leva a VS pro início dela (bom pro ensaio e pro "começa do refrão"). Com a VS **tocando**, tocar arma o pulo. A faixa fina da régua de tempo no topo da onda aceita **arrastar pra posicionar** em qualquer ponto (tocando ou parado). Teclado: ←/→ = seção anterior/seguinte; **Shift+←/→ = ±5 s** (a função de hoje continua, só muda a tecla).
- **Papel do canal:** o EDITAR CANAIS ganha a escolha do papel de cada canal (**Click / Guia / Normal**), além de renomear. O papel manual vence o reconhecimento automático em tudo: onde sai a contagem, ouvido x PA no autoPan, fora da troca de tom e "a música já tem click". **Canais com papel Click ou Guia continuam tocando quando outro canal está em Solo** (decisão do dono: numa VS o click e a guia nunca saem do fone da banda); o M deles continua funcionando normalmente. O reconhecimento automático por nome fica amplo (CLICK, CLK, METRO, MTR, TEMPO, BEAT, GUIDE, GUIA, CUE...). A mudança de roteamento que isso causa em músicas já salvas (ex.: `CUE` passa a ir pro ouvido) é desejada.
- **Renomear canal e papel ficam salvos** no repertório do usuário e no cache offline daquele aparelho/conta (o `SavedChannel`, com migração dos repertórios existentes). **Nunca alteram a música da biblioteca em nuvem** nem o que outros usuários veem.
- **"EDITAR" vira um modo do próprio palco** (mesmo layout): nele aparecem MARCAR (botões + teclas I V P R B F), remover/ajustar seções, EDITAR CANAIS (renomear, papel, reordenar) e o compasso da música. O editor avançado de marcadores do admin (cor e letra por seção, salvar na nuvem) entra nesse modo só pro admin. A reordenação/remoção de músicas que o EDITAR faz hoje vai pro painel REPERTÓRIOS.
- **BPM com casas decimais:** passa a ser salvo com decimais (hoje `api/insert-song.ts` corta com `Math.trunc` e `songs.bpm` é INT), porque o pulo no compasso depende disso. Requer migration aditiva e segura.
- **Modo Ao Vivo neste projeto:** só o protocolo e um mínimo de tela. O host passa a enviar o pulo armado (seção alvo) e a contagem; o celular, ainda no visual atual, mostra "PRÓXIMA: <seção>" e a contagem **aproximada** (a rede tem atraso; o som exato é o click no ouvido). O redesenho do celular é o Projeto 3.

- **Compasso de cada música (decisão do dono):** o app **lê o canal de click** pra descobrir o compasso: o click tem o 1º tempo acentuado (mais forte e/ou mais agudo), então a distância entre os acentos dá quantos tempos tem o compasso (e confirma onde cai o 1). Se o click não tiver acento reconhecível, assume **4/4**. O compasso detectado pode ser corrigido por música no modo EDITAR e fica salvo junto com a música (mesma regra dos 3 lugares). A contagem conta **os tempos do click no compasso**: 4/4 conta 4, 3/4 conta 3, 6/8 conta 6 (o dono pode trocar 6/8 pra contar 2 pulsos). As bolinhas do aviso PRÓXIMA acompanham esse número.
- **Voz guia no pulo** *(decisão do Claude, aguardando o dono)*: quando há pulo ou repetição armada, o canal de **Guia fica mudo só no último compasso** antes da troca (a contagem substitui o aviso de seção, evitando ouvir "Refrão" quando o destino é a Ponte). Automação de volume agendada no mesmo instante do pulo.

## 10. Decisões do Claude (o dono deve conferir)

- Música sem click: gerar ao carregar.
- Armar com menos de um compasso restante: contagem curta, pulo no fim da seção.
- Anotações dentro do painel REPERTÓRIOS.
- No Livre, a botoeira vazia vira convite pra marcar seções (upgrade).
