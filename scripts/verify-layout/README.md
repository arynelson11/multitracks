# verify-layout: texto cortado e alvos de toque do palco novo

Verificador da T20 (Parte 2). Monta o palco novo (`StageShell`) e as duas seções
das Configurações da T19 com os dados de `fixture.ts`, abre no Chrome headless
em 8 tamanhos de tela e mede o que está na tela. Regra do dono: nenhum texto
encostando na borda ou cortado. Não entra no app e não precisa de dependência
nova: usa o Vite, o React e o Tailwind do repo e o Google Chrome da máquina.

```bash
source ~/.nvm/nvm.sh && nvm use 24
node scripts/verify-layout/run.mjs                                    # rodada inteira (270 combinações, abaixo)
node scripts/verify-layout/run.mjs --only 1280x800 --estado quebrado  # prova: tem de sair com 1
node scripts/verify-layout/run.mjs --estado tom,compasso --only 1024x768
```

| Opção | O que faz |
|---|---|
| `--only 1280x800[,1440x900]` | só esses tamanhos, pra todos os estados pedidos (padrão: os de cada estado, abaixo) |
| `--estado normal[,tom]` | só esses estados (padrão: todos os normais; `quebrado` é a prova) |
| `--jobs N` | quantos Chrome ao mesmo tempo (padrão 3) |
| `--no-build` | usa a página já montada em `.build/` |

Sem opção, a rodada mede os 11 estados do palco e as 16 telas da faixa C nos 8
tamanhos (216), as 14 telas da faixa C que abrem no celular também em 390x844
(14; o Modo Ao Vivo do host só existe no computador) e as 10 telas da faixa B em
5 tamanhos (50): 280 combinações.

Demais telas da Parte 3 (faixa C): cada uma tem um estado (lista em
`telasEstados.ts`, telas montadas em `telas.tsx`), medido como o palco, sem a
regra de estrutura.

Largura de celular (as duas faixas, um jeito só): o Chrome headless não abre
janela abaixo de 500 px, então qualquer tamanho mais estreito que isso roda na
rota `/moldura` do `run.mjs`, uma página mínima com a página do verificador num
iframe do tamanho pedido. O iframe vira a janela dela (`innerWidth`, media
queries e a medida) e é ela quem manda o resultado; a página do verificador não
sabe da moldura.

Sai com `0` quando todas as combinações passam, `1` com qualquer falha (ou
página que não respondeu) e `2` com opção errada. O JSON de cada combinação fica
em `results/<estado>_<LxA>.json`. Outro Chrome: `CHROME=/caminho/do/chrome`.

## Telas da faixa B da Parte 3 (login e Configurações)

Sem `--estado`, a rodada normal também mede 10 telas fora do palco (`telasB.ts` e `TelasBPage.tsx`, Parte 3, faixa B,
não publicado) em 1024x740, 1280x800, 1920x1080, 390x844 (celular) e 844x390 (celular deitado, onde as Configurações cortavam o fim da aba): 50 combinações a mais.

| Estado | O que mostra |
|---|---|
| `login`, `criarconta`, `recuperar` | a tela de entrar nos três modos (`AuthPage`) |
| `novasenha` | Criar nova senha (`NewPasswordPage`) |
| `config-perfil`, `config-geral`, `config-buses`, `config-novidades`, `config-assinatura`, `config-sobre` | as Configurações abertas em cada aba, logadas como admin em "Tudo junto", com nome, e-mail, aparelho de saída e canais compridos e o aviso de atualização |

A conta e as configurações saem de `fakes/` (o `vite.config.ts` troca o `src/hooks/useAuth.ts` e o
`src/contexts/SettingsContext.tsx` do app por elas só neste build; o palco não usa nenhum dos dois).
O contador de separações e o painel da assinatura são os de verdade, sem servidor (mostram o que
mostram sem rede). O 390x844 roda na moldura de celular (acima). `--only` vale também pra essas telas.

```bash
node scripts/verify-layout/run.mjs --estado login,config-geral --only 390x844
```

## Tamanhos e estados

Tamanhos: `1024x740` (a menor tela do palco novo, Ruling T18-altura), `1024x768`,
`1280x760`, `1280x800`, `1440x900` e `1920x1080`, mais duas larguras abaixo de
1024: `900x740` (janela estreitada) e `810x1080` (iPad girado pra retrato). O
palco novo só fica nelas com a música tocando (a troca de palco espera a música
parar, R-25); ali a casca rola de lado (Ruling I2-estreito) e a regra vira
"nada inalcançável": o que passa da borda da casca chega rolando.

| Estado | O que mostra |
|---|---|
| `normal` | tocando no Refrão, sem pulo armado |
| `contando` | pulo armado pro "Refrão Final Estendido", contagem no tempo 2, aviso COMPASSO ASSUMIDO, OFFLINE, HOST ligado e o aviso SAÍDAS |
| `pads` | painel de pads aberto, pad G# tocando |
| `editar` | modo EDITAR (barra de marcar seções), parado |
| `livre` | plano Livre: convite pra marcar seções e o aviso SEM CLICK LIDO |
| `selo` | plano Livre parado com o selo "LIVRE · 3 de 3 músicas este mês" na barra, OFFLINE, HOST ligado e o aviso SAÍDAS (o pior caso da barra; abaixo de 1280 px o selo encurta e o "Playback Studio" sai) |
| `repertorio` | gaveta REPERTÓRIOS aberta com 6 músicas e Anotações |
| `tom` | grade de tons aberta (toque no botão do tom), com "Redefinir detecção de tom" |
| `semtom` | grade aberta sem tom original: semitons em 3 linhas, com "Definir o tom original" ao lado do 0 |
| `compasso` | diálogo do compasso aberto no EDITAR |
| `metronomo` | Metrônomo (Parte 3, faixa C) numa página própria, com uma música que já tem click |
| `padsnuvem` | Pads da nuvem (faixa C) como admin, 3 conjuntos com nome e descrição longos, um em uso |
| `padsnuvem-editar` | o mesmo, renomeando o primeiro conjunto |
| `letra` | Letra e cifra (faixa C), aba Letra com a versão sincronizada, artista longo |
| `cifra` | o mesmo, na aba Cifra (linhas longas rolando de lado dentro da área) |
| `teleprompter` | Teleprompter (faixa C) no "Refrão Final Estendido" com 4 linhas longas de letra |
| `teleprompter-vazio` | Teleprompter sem música e sem seções |
| `novidades` | Novidades (faixa C) com a entrada mais nova do changelog de verdade |
| `atualizacao` | Aviso de atualização (faixa C) do app de computador no Mac ("Versão 1.4.30 já saiu") |
| `tour` | Tour (faixa C) no passo do Modo Ao Vivo, com o spotlight num botão no meio da página |
| `tour-centro` | Tour no primeiro passo, sem alvo (balão no meio) |
| `download` | Página de download (faixa C) inteira, no computador Mac (os dois instaladores do Mac em destaque) |
| `download-ajuda` | o mesmo, com a ajuda do Mac aberta (os 4 passos e o comando do Terminal) |
| `aovivo` | Modo Ao Vivo do host (faixa C) ligado, endereço longo e três aparelhos (um sem IP, um IPv6, um liberado); só existe no computador, então sem 390 |
| `aovivo-erro` | o mesmo, com o erro de abrir o servidor |
| `adminlogin` | Login do /admin na web (faixa C) |
| `config` | as duas seções da T19 numa página própria: placa de 2 canais (caindo de 4 ou mais, com avisos) e de 8 canais |
| `quebrado` | prova: o palco normal com um botão de largura fixa e texto longo e um caso pra cada ramo das regras (15 falhas, uma por ramo) |

O fixture é o pior caso de texto: 14 canais com os nomes organizados mais
longos da Parte 1 ("Percussão Dedilhado Ambiente"), 9 seções (uma "Refrão
Final Estendido"), música, artista e repertório com nomes longos. As ações não
fazem nada e o relógio fica parado na contagem (tempo 2). Antes de medir, a
página confere que o estado montou (a grade aberta, o painel na tela, o balão
da contagem mostrando 2); se não montou, a combinação sai como erro, nunca
como aprovada.

## Regras (check.ts)

Para todo elemento com texto próprio que está na tela:

- **(a) cortado**: o texto não passa da própria caixa (`scrollWidth` e
  `scrollHeight` contra `clientWidth` e `clientHeight` quando o `overflow` não é
  `visible`) nem de nenhum contêiner que corta na cadeia de blocos que o contêm
  (`overflow` hidden ou clip; numa rolagem, o que fica antes do começo não chega
  rolando). Numa fileira que rola de lado (botoeira, mixer), nada pela metade na
  borda com ela parada (Ruling T10-rolagem); o que está todo fora chega rolando.
  Dentro de um contêiner que rola na vertical, o que fica embaixo chega rolando;
  quem barra a área do palco rolando é a regra de estrutura. A caixa que emoldura o texto (selo, botão, aviso PRÓXIMA) também
  não pode ser cortada, nem a caixa do botão só de ícone (o X do aviso PRÓXIMA,
  a lixeira, o Metrônomo), que não tem texto próprio. A casca que rola de lado
  na tela estreita (`data-scroll-reach`) não acusa o que fica pela metade na
  borda dela: chega rolando. Na vertical conta a tinta das letras (medida no canvas
  com a fonte do elemento), não a caixa da linha.
- **(b) encostando**: em `button`, `[role=button]`, `[role=radio]` e selos
  (caixa visível de até 40 px de altura), o texto fica a 4 px ou mais das
  bordas na horizontal, medido na caixa que se vê mais perto do texto (o botão,
  quando ele não tem fundo próprio). Em caixa maior (célula, painel), o texto
  não sai dela.
- **(c) toque**: `button`, `[role=button]`, `[role=radio]`, `input` e `select`
  com 44x44 px. Exceções aceitas: M/S do mixer (`data-touch-exception="ms"`) com
  32x30 px, e bloco estreito da onda (`data-narrow`, Ruling T9-estreito) só na
  largura. Controle `inert` ou com `pointer-events: none` não é alvo.
- **(d) rolagem**: a página não rola de lado.
- **estrutura** (só no palco, arquitetura D do plano): as faixas (barra do app,
  transporte, onda, botoeira, faixa do meio, mixer) na mesma ordem e sem uma
  por cima da outra em qualquer largura, o nome do repertório ao lado de
  "MÚSICA 3 DE 6" só a partir de 1700 px e a área do palco (`[data-stage-scroll]`)
  sem rolar na vertical. Folga só no `editar` e no `compasso`, até 38 px (a T18
  aceitou o EDITAR rolar em tela baixa; na v1.4.20, 38 px em 1024x740 com o
  mixer no mínimo de 200 px no EDITAR); ao vivo, nada. Abaixo de 1024 px a
  barra da rolagem de lado da casca soma na folga. A partir de 1024 px a casca
  (`[data-stage-hscroll]`) não rola de lado: a barra do app inteira cabe, com
  OFFLINE, HOST, o aviso SAÍDAS e o selo do Livre (Parte 3; a regra (a) não vê
  isso, porque a casca que rola de lado não acusa o que passa da borda). O
  aviso SAÍDAS, que fica por cima da barra, não cobre o selo ONLINE, o selo do
  Livre nem o menu. Vale pra cada `[data-stage-shell]` da página (a prova tem
  um palco de mentira).

Não usa `elementFromPoint`: o que está por cima de quê não é medido, então as
etiquetas PRÓXIMA, REPETE e LOOP da onda (`pointer-events-none`) não mudam nada.

## Lendo uma falha

```
[FALHA] contando 1280x760: 1
  (cortado) div[data-stage-scroll] > main[aria-label="Palco"] > section[aria-label="Transporte"] > div:nth-of-type(3) > div[data-next-pill] "PRÓXIMA"
      a caixa do texto passa 3.1px da borda de cima de div#root > div[data-stage-shell] > div[data-stage-scroll], antes do começo da rolagem (overflow-y auto)
```

Tipo da regra, caminho do elemento (até 5 níveis, pelos `data-*`, `role`,
`aria-label` e `title`), o texto e as medidas. Esse exemplo é da primeira rodada
(aviso COMPASSO ASSUMIDO quebrando linha no PRÓXIMA em 1280 px), corrigido na
própria T20.

## Como funciona

- `vite.config.ts`: raiz nesta pasta, `@vitejs/plugin-react` e
  `@tailwindcss/vite`, saída em `.build/`. Só neste build o `src/index.css`
  ganha um `@source "."` (a pasta `src/`), pra o Tailwind gerar as classes dos
  componentes como no app.
- `run.mjs`: monta a página, sobe um servidor local e abre um Chrome headless
  (`--headless=new`) por combinação. O `--window-size` do headless novo é o da
  janela e a área da página sai menor: uma página mínima mede a diferença uma
  vez e cada combinação confere que a área ficou no tamanho pedido.
- `main.tsx` monta o estado, abre o que é estado da casca (grade de tons,
  compasso) com um toque de ponteiro, confere o estado e chama o `check.ts`,
  que espera as fontes e as medidas dos componentes, mede e manda o resultado
  por POST.
