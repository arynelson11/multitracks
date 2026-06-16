# Análise Competitiva — MultiTracks Brasil

> Referência/concorrente principal observado no Instagram (@multitracksbr): 57,6 mil seguidores, 1.763 posts.
> Objetivo deste doc: saber onde NÃO competir de frente e qual brecha explorar.

## Modelo de negócio deles (e por que importa)
MultiTracks é **catálogo licenciado**: você assina e baixa multitracks **prontos** de músicas específicas que eles licenciaram com os artistas. Exige contratos, produção e escala. Pra liderar nisso precisaria de mais artista, mais produção, mais fama. **Não competimos aqui.**

## O que eles fazem bem (aprender)
- Prova social pesada com rostos e artistas worship conhecidos (palco, equipes, cantores).
- Mix de feed equilibrado: produto + pessoas + educativo (formato podcast/depoimento) + lançamentos.
- Consistência de marca (marca d'água em tudo).

## Onde NÃO competir
- Não tentar ter mais foto de palco / artista famoso / estética gospel premium. Copiar a estética deles vira clone pobre.
- Não posicionar o diferencial como "tenho multitracks" (eles também têm, e dominam o termo no Brasil com @multitracksbr).

## A brecha (nosso posicionamento que ganha)
O ponto fraco do catálogo é a nossa força:

| MultiTracks (catálogo) | Playback Studio (ferramenta) |
|---|---|
| Só as músicas que eles licenciaram | **Qualquer música** que você quiser |
| Espera o release sair | Separa na hora |
| Você recebe o que existe | **Você cria** o que precisa |
| Loop de seção ao vivo é Premium (caro, em dólar) | Loop ao vivo acessível, em Real |

**Mensagem-âncora (sem citar nome do concorrente):**
> "A música que o pastor escolheu não tá em catálogo nenhum? No Playback Studio, qualquer música vira multitracks. Sem esperar release."

O diferencial é o **mecanismo** (separa qualquer música + controla ao vivo), não a **categoria** (ter multitracks).

## Diferenciação visual (de propósito)
Direção do nosso feed (estúdio dark, laranja, mãos > rostos, screenshot do app) nos separa visualmente deles, que são fotográficos/gospel com rostos. Quem rola o feed percebe que é outra coisa. Manter isso, não imitar o feed deles.

---

# Concorrente 2 — Moises (@moises.ai)

> 233 mil seguidores, verificado. "The Creative Suite for Musicians". Global, multi-instrumento (guitarristas, bateristas, baixistas, cantores), NÃO focado em worship.

## Diferença crucial vs MultiTracks
Moises **também separa qualquer música por IA** ("Stem Generation"). Então, contra o Moises, "separo qualquer música" **NÃO é diferencial** (é empate). Eles transformaram separação por IA em commodity.

## Onde NÃO competir
Não posicionar a separação por IA como diferencial principal. Dois gigantes (Moises global + outros) já fazem. Brigar nisso é brigar onde somos os menores.

## A brecha contra o Moises (camada de execução ao vivo)
Moises é ferramenta de **estúdio/estudo** (treinar, remixar, tirar partes). NÃO toca ao vivo no culto. Nosso território é o que vem DEPOIS da separação, pro palco:
- Tocar **offline no palco** (app desktop).
- **Loop do refrão ao vivo** + Modo Ao Vivo (banda no celular).
- **Click com levada brasileira**, voice guide, transposição na hora.
- Pensado pro **domingo brasileiro**, não pro home studio global.

Frase-resumo: **"O Moises te ajuda a estudar a música. O Playback Studio te faz tocar ela no domingo."**

---

# Síntese: posicionamento por concorrente

| | Contra MultiTracks (catálogo) | Contra Moises (suite de IA) |
|---|---|---|
| Diferencial a usar | "qualquer música, não só catálogo" | "feito pro palco/domingo" |
| Por quê | dependem de licença/release | Moises não toca ao vivo no culto |

**Território mais defensável (vale pros dois):** ninguém junta num produto só "separa qualquer música + toca offline no palco + repete o refrão ao vivo + Modo Ao Vivo + levada brasileira", pensado pro domingo. O diferencial é a **camada de execução ao vivo + worship BR**, não a separação isolada.

## Aplicado em
- `src/components/LandingPage.tsx`: contraste "qualquer música vs catálogo" (vs MultiTracks) no hero, benefícios e FAQ; a camada ao vivo (vs Moises) já está nas seções de loop/Modo Ao Vivo.
- Conteúdo de Instagram: ver `docs/MARKETING_LANCAMENTO.md` (Reels 1/3/5/6 são a camada ao vivo; Reel 2 e carrossel "Multitracks vs catálogo" cobrem o contraste de catálogo).
