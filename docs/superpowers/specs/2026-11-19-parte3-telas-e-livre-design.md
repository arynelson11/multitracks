# Parte 3: o app todo no layout do palco, e o Livre como amostra

> Desenho aprovado em conversa com o dono em 2026-11-19 (aguardando a aprovação deste documento). Continua o spec `2026-11-15-palco-ao-vivo-design.md` (Parte 3, "demais telas") e junta a mudança do plano Livre. Fonte única dos fatos do produto: `PLAYBACK_STUDIO_FATOS.md`. Marcações: **[dono]** = decidido pelo dono; **[Claude]** = escolha minha, pra o dono conferir.

## 1. Intenção e porquê

**O Livre não converte.** De julho a novembro de 2026 entraram 66 cadastros e nenhum virou pagante; 82% nunca fizeram uma separação; os 8 perfis com plano pago no banco são cortesias do dono (amigos e irmão). O Livre custa menos de R$ 5 por mês (cerca de 11 separações por mês a ~R$ 0,15 cada). O problema não é custo, é conversão: o Livre de hoje mostra a parte menos impressionante (separação em 2 faixas, só ouvir) e, ao mesmo tempo, dá de graça coisas que deviam ser do pago (abrir multitracks importadas e o catálogo da plataforma e tocar no palco sem limite de músicas).

**O que o dono quer [dono]:** "que o grátis seja apenas uma amostra do que o app tem para oferecer"; anúncio do **próprio** Playback Studio, pra levar a pessoa a assinar, no estilo do Spotify; e um desconto que "caiba dentro da margem e não sangre o financeiro".

**Junto [dono]:** "o app todo, no mesmo layout" do palco novo (publicado na v1.4.20). O palco é a referência visual; as outras telas ainda estão no visual antigo.

**Sucesso:** mais cadastros chegando à primeira separação e mais cadastros virando pagantes, medidos na Visão geral do admin (v1.4.18) antes e depois de cada parte; e o app inteiro com uma cara só.

## 2. Objetivos

1. **Livre = prova de tudo, em dose pequena [dono: amostra; números: Claude].** A pessoa usa de verdade as funções que fazem o produto valer a pena, em quantidade pequena, e sente falta quando o limite acaba.
2. **Anúncio da casa, só com a música parada [dono].** Nunca com som, nunca com a música tocando ou na contagem.
3. **Oferta do primeiro mês com desconto [dono: desconto na margem; valores: Claude].**
4. **A música separada abre no próprio palco [dono].** Um player só no app inteiro.
5. **Todas as telas no layout do palco [dono].** Muda a cara, não o que o app faz (exceto o que este documento manda mudar).

## 3. Não objetivos

- Anúncio de terceiros (AdSense e parecidos), anúncio com som ou vídeo.
- Mudar o preço cheio dos planos ou o que o Pro e o Studio têm hoje.
- A landing do site (`LandingPage.tsx`, `DemoMixer.tsx`) e o celular da banda (`FollowerView.tsx`, Projeto 3 do spec do palco).
- Promoção com cupom digitado, indicação, plano novo.

## 4. Anti-objetivos (falha mesmo se funcionar)

- Qualquer anúncio, oferta, aviso de limite ou tela por cima aparecendo **com a música tocando ou durante a pré-contagem**; qualquer limite do Livre que **pare o som** no meio de uma música.
- Tirar função de quem paga, ou o restyle sumir com alguma função (o spec do palco já exige: nenhuma função some).
- Desconto que se repete (por conta, por e-mail novo em massa) ou que vale pra sempre.
- Quebrar o app de computador (roda de `file://`: nada de caminho absoluto "/", nada de `window.prompt/alert/confirm` novo), o modo offline ou o Modo Ao Vivo de quem paga.
- Trava do Livre só no cliente para o que custa dinheiro (separação): o servidor tem de barrar.

## 5. O Livre novo (amostra) [números: Claude, conferir]

| Função | Livre hoje | Livre novo | Pago (sem mudança) |
|---|---|---|---|
| Separação de faixas | 5/mês, só 2 faixas | **3/mês, em 4 ou 6 faixas** (resultado completo) | Pro 50, Studio 150, 2/4/6 faixas |
| Baixar faixas (WAV/MP3) | não | não | sim |
| Tocar no palco novo (seções, pulo no 1, tom, click gerado, BPM) | só ouvir, sem seções nem tom | **tudo funciona**, uma música por vez | sim |
| Músicas diferentes no palco por mês | sem limite (importadas e catálogo) | **até 3 músicas diferentes por mês** no palco (separadas, importadas ou do catálogo) | sem limite |
| Repertório (várias músicas, montar o culto) | sim, sem trava (importar, .zip, painel REPERTÓRIOS) | **não** (ver as regras do repertório abaixo) | sim |
| Modo Ao Vivo (celular da banda) | não | **1 celular, uma sessão de até 10 minutos por dia** (o contador zera à meia-noite de Brasília; a banda desconecta; o som do palco nunca para) | Pro até 4, Studio ilimitado |
| Biblioteca na nuvem, salvar/publicar na nuvem, pads da nuvem | não | não (tudo no aparelho, como hoje) | sim |
| Catálogo da plataforma (BIBLIOTECA) | bloqueado (pede assinatura, `handlePremiumFeature` em `App.tsx`) | **abre, e cada música conta nas 3 do mês** | sem limite |
| Voz guia (manual e automática), BPM pela IA, Metrônomo com click IA, click gerado | não (pago) | **sim** (rodam no aparelho e não custam nada) | sim |

Regras:
- A cota de separação continua no servidor (`api/_lib/plan.ts` `PLAN_LIMITS.free` de 5 para 3; `api/separate-audio.ts` deixa de forçar 2 faixas no Livre; `consume_separation_token` segue contando por mês civil de Brasília).
- "Músicas diferentes no palco por mês" é contado por aparelho e conta (no Livre tudo é local); abrir de novo a mesma música no mês não conta outra vez. **[Claude]** Pode ser burlado limpando o aparelho; é aceitável (amostra, custo zero, o que custa dinheiro é a separação, que o servidor barra).
- O limite nunca corta uma música aberta: ele só vale na hora de abrir a próxima.
- **Separação do mês sempre abre [Claude].** O resultado de uma separação feita no mês abre no palco mesmo com as 3 músicas gastas (a separação já é limitada pelo servidor e já custou dinheiro); reabrir uma separação de mês anterior conta como música.
- **Regras do repertório [Claude].** Nada que está no aparelho é apagado (FATOS: "arquivos não somem"). O repertório guardado continua visível; no Livre, abrir uma música dele conta nas 3 do mês, e abrir outra troca a atual ("uma música por vez"). Montar repertório novo com várias músicas, "próxima"/AUTO entre músicas e importar ou exportar .zip passam a ser do pago. Importar uma multitrack avulsa do aparelho continua, contando nas 3.
- **Recursos do aparelho abertos [Claude].** Tudo que roda no aparelho e não custa nada entra na amostra (voz guia, BPM pela IA, Metrônomo com click IA, click gerado); o `src/lib/plans.ts` ganha funções próprias pra cada um (hoje o click gerado está preso a `canUseBpmDetection`). O que usa a nuvem ou gera arquivo pra levar embora (baixar, biblioteca na nuvem, pads da nuvem, salvar/publicar) continua pago.
- **Plano guardado no aparelho [Claude].** Hoje, no app de computador sem internet, quem paga abre como Livre (`src/lib/planState.ts` não guarda o plano). Com os limites novos isso cortaria quem paga no culto offline: o último plano conhecido fica guardado no aparelho e vale offline até a data de fim do plano (ou 30 dias sem conferir, o que vier antes).

## 6. Anúncio da casa [dono: só parado; formato: Claude]

Onde aparece (sempre com a música parada e fora da pré-contagem):
1. **Ao abrir o app** (tela inicial), no máximo uma vez por dia: um cartão "O que o Pro faz por você", com o resultado (não a lista de recursos).
2. **Quando uma separação termina**, ao lado do resultado: "No Pro você baixa essas faixas e salva na nuvem".
3. **Ao bater um limite** (separação, músicas do mês, Ao Vivo, repertório, baixar): a tela do limite traz a **oferta do primeiro mês** (seção 7).
4. **Selo discreto no palco parado**: um chip "LIVRE · 2 de 3 músicas este mês" que abre os Planos.

Frequência: no máximo **um anúncio grande por sessão** além da tela de limite; o selo é permanente e discreto. Nenhum anúncio bloqueia o uso do que o Livre tem.

## 7. Oferta do primeiro mês [Claude, conferir]

- **Pro Mensal: primeiro mês por R$ 24,90** (preço cheio R$ 49,90). **Studio Mensal: primeiro mês por R$ 59,90** (cheio R$ 119,90). Anual sem oferta (já tem desconto: R$ 37,90 e R$ 89,90 por mês).
- **Margem:** o pior caso de IA por assinante é a cota inteira usada (Pro 50 x ~R$ 0,15 = ~R$ 7,50; Studio 150 x ~R$ 0,15 = ~R$ 22,50), mais a taxa do cartão do Asaas; sobra margem nos dois.
- **Quando aparece:** na tela de limite (seção 6, item 3), válida por **48 horas** a partir da primeira vez que aparece naquele mês, com o relógio visível. Passadas as 48 horas, o preço volta ao cheio até o mês seguinte. **[dono] A oferta volta uma vez por mês:** todo mês em que a pessoa bater um limite ganha uma nova janela de 48 horas, até assinar. O registro é um por conta e por mês.
- **Uso uma vez por conta:** o desconto só vale na primeira assinatura da conta (a mesma regra que o arrependimento de 7 dias já usa em `api/_lib/billing.ts`, "Primeira assinatura da conta?"), conferido pelo servidor no checkout.
- **[dono] Conta nova pra pegar o desconto de novo: aceitar o risco e avisar.** Nada de pedir CPF no app. Depois do pagamento, o servidor lê o CPF do cliente no Asaas e guarda só um resumo dele (hash), nunca o número; se o mesmo CPF já usou a oferta noutra conta, a ficha ganha uma marcação em Pendências do admin. O prejuízo máximo é o desconto de uma vez (R$ 25 no Pro, R$ 60 no Studio).
- **Garantia de 7 dias continua:** o estorno devolve o que foi pago (o valor com desconto).
- **Como cobrar no Asaas [Claude]:** o checkout (`api/checkout.ts`, item com `value` e `subscription.cycle`) é criado com o valor do primeiro mês; quando o primeiro pagamento confirma, o servidor troca o valor da assinatura no Asaas pro preço cheio com `PUT /subscriptions/{id}` e `updatePendingPayments: true` (o mesmo caminho da troca de plano, `billing.ts`, perto da linha 918). Se essa troca falhar, vira pendência (`billing_pending_actions`), tentada de novo até dar certo, e aparece no admin (Pendências). A conferência diária (`api/_lib/reconcile.ts`) não compara valor, então não marca a primeira cobrança como erro. O registro da oferta (quem viu, quando expira, se usou) fica no banco, com escrita só pelo servidor.

## 8. A música separada abre no palco [dono]

- O Separador deixa de ter player próprio (o mixer de `SeparatorStudio.tsx` com faixas e ondas some como tela). Fluxo: carregar áudio, a IA separa, a música **abre no palco novo** (a mesma onda, transporte, mixer e seções).
- O que era só do Separador vira um **painel do palco** quando a música aberta veio de uma separação: BAIXAR (WAV/MP3), SALVAR, VOZ GUIA, BPM pela IA, SYNC. No Livre, BAIXAR e SALVAR na nuvem mostram o anúncio (seção 6).
- A lista "Minhas separações" continua, no layout do palco, como parte da Biblioteca ou do início (decisão do construtor, mantendo o acesso em um toque).
- **Onde o palco novo não aparece [Claude]** (tela menor que 1024 x 740, como celular e tablet em pé, e quem escolheu o palco Antigo): a separação abre no player do Separador de hoje (`SeparatorStudio.tsx`), que fica como reserva com todas as funções (BAIXAR, SALVAR, VOZ GUIA, BPM, SYNC). Nada some pra quem paga. Esse player ganha o visual novo na parte 6 (o resto), sem mudar o que faz.

## 9. As telas no layout do palco [dono: o app todo]

Linguagem: a do palco novo (tokens `ps-*`, Inter + JetBrains Mono, painéis, chips, seletor segmentado, LEDs, cores com um significado só: laranja = ligado, branco = armado, cor da seção = seção, âmbar = alerta; nenhum texto encostando na borda ou cortado). Reaproveitar as peças do palco (`src/components/stage/*`) e a casca.

Telas (do spec do palco, 5b): tela inicial, login (`AuthPage.tsx`), Separador (vira o fluxo da seção 8), Biblioteca (`LibraryModal.tsx`, abas PLATAFORMA e MINHAS MÚSICAS), Configurações (`SettingsModal.tsx`, `ProfileTab.tsx`, abas Perfil, Geral, Novidades, Assinatura, Sobre), Planos (`PricingModal.tsx`), Metrônomo (`MetronomeModal.tsx`), conjuntos de pads (`PadSetsModal.tsx`), Modo Ao Vivo do host (`LiveModeModal.tsx`), letra (`LyricsEditor.tsx`) e teleprompter, novidades (`WhatsNewModal.tsx`), aviso de atualização (`UpdateBanner.tsx`), tour (`GuidedTour.tsx`), página de download (`DownloadPage.tsx`) e o painel `/admin`.

## 9b. Medição [Claude]

O sucesso se mede no admin, e o "antes" tem de existir antes de o Livre novo ir pro ar. Por isso a medição entra na parte 1, antes de ligar as regras novas:
- A Visão geral do admin ganha o funil por mês: cadastros, quantos chegaram à primeira separação, quantos viraram pagantes, e o tempo até virar pagante. O "antes" sai do que o banco já tem (contas, `predictions`, assinaturas).
- Ofertas vistas, ofertas usadas, anúncios vistos e anúncios clicados viram eventos gravados pelo servidor (tabela nova, escrita só pelo servidor, sem dado pessoal além da conta), porque não dá pra reconstruir isso depois.

## 10. Abordagens consideradas

- **A. Uma parte por vez, cada uma publicada quando fica pronta [dono escolheu].** Ordem: (0) peças base no estilo do palco (janela/modal, painel, botão, chip, tela de limite com oferta); (1) medição no admin e plano guardado no aparelho, depois o Livre novo + anúncio + oferta; (2) Separador abrindo no palco; (3) tela inicial e login; (4) Biblioteca; (5) Configurações e Planos; (6) o resto (Ao Vivo do host, Metrônomo, pads, letra e teleprompter, novidades, atualização, tour, download, /admin). Resultado em dias, risco espalhado; por um tempo convivem telas novas e antigas.
- **B. Tudo numa branch e um lançamento só.** Visual inteiro de uma vez, mas espera longa e risco concentrado (na Parte 2 precisou de uma correção logo depois). Descartada.
- **C. Primeiro o visual de tudo, depois o Livre.** O que traz assinante demora mais. Descartada.

## 11. Restrições

- Cada parte: TDD onde houver comportamento, suíte, `tsc -b`, build do desktop, verify-layout (e verify-pitch se tocar o motor), FATOS e DESIGN_SYSTEM atualizados no mesmo passo, português do Brasil, nenhum travessão "—" em texto, vocabulário "multitracks" e "separação de faixas".
- No máximo 12 funções em `api/` (Hobby da Vercel): nada de arquivo novo na raiz de `api/`; reaproveitar `checkout.ts`, `separate-audio.ts` e o roteador do admin.
- Publicação de cada parte pelo @devops (web + Mac + Windows juntos), depois do portão; o dono é avisado a cada uma. SQL novo na produção (registro da oferta, mudança de cota) só com o OK do dono.
- O palco antigo continua existindo como reserva (Configurações > Geral > Palco > Antigo) e recebe as regras do Livre também (mesmos limites), sem restyle.

## 12. Deixado pro construtor

- O texto exato dos anúncios e da tela de limite (com a regra de copy do produto: resultado antes de recurso, sem prometer número de vendas, nenhum travessão).
- O desenho visual de cada tela dentro da linguagem do palco (o mockup v5 e as peças de `src/components/stage` são a referência).
- Como contar "músicas diferentes no palco por mês" no aparelho e onde mostrar o selo.
- O formato da tabela do registro da oferta e do timer do Ao Vivo do Livre.
- Onde fica "Minhas separações" (Biblioteca ou início).
