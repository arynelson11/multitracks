# verify-layout: texto cortado e alvos de toque do palco novo

Verificador da T20 (Parte 2). Monta o palco novo (`StageShell`) e as duas seções
das Configurações da T19 com os dados de `fixture.ts`, abre no Chrome headless
em 5 tamanhos de tela e mede o que está na tela. Regra do dono: nenhum texto
encostando na borda ou cortado. Não entra no app e não precisa de dependência
nova: usa o Vite, o React e o Tailwind do repo e o Google Chrome da máquina.

```bash
source ~/.nvm/nvm.sh && nvm use 24
node scripts/verify-layout/run.mjs                                    # 9 estados x 5 tamanhos (45 combinações)
node scripts/verify-layout/run.mjs --only 1280x800 --estado quebrado  # prova: tem de sair com 1
node scripts/verify-layout/run.mjs --estado tom,compasso --only 1024x768
```

| Opção | O que faz |
|---|---|
| `--only 1280x800[,1440x900]` | só esses tamanhos (padrão: os 5) |
| `--estado normal[,tom]` | só esses estados (padrão: os 9 normais; `quebrado` é a prova) |
| `--jobs N` | quantos Chrome ao mesmo tempo (padrão 3) |
| `--no-build` | usa a página já montada em `.build/` |

Sai com `0` quando todas as combinações passam, `1` com qualquer falha (ou
página que não respondeu) e `2` com opção errada. O JSON de cada combinação fica
em `results/<estado>_<LxA>.json`. Outro Chrome: `CHROME=/caminho/do/chrome`.

## Tamanhos e estados

Tamanhos: `1024x768`, `1280x760`, `1280x800`, `1440x900` e `1920x1080` (o palco
novo liga a partir de 740 px de altura, Ruling T18-altura).

| Estado | O que mostra |
|---|---|
| `normal` | tocando no Refrão, sem pulo armado |
| `contando` | pulo armado pro "Refrão Final Estendido", contagem no tempo 2, aviso COMPASSO ASSUMIDO, OFFLINE, HOST ligado e o aviso SAÍDAS |
| `pads` | painel de pads aberto, pad G# tocando |
| `editar` | modo EDITAR (barra de marcar seções), parado |
| `livre` | plano Livre: convite pra marcar seções e o aviso SEM CLICK LIDO |
| `repertorio` | gaveta REPERTÓRIOS aberta com 6 músicas e Anotações |
| `tom` | grade de tons aberta (toque no botão do tom) |
| `compasso` | diálogo do compasso aberto no EDITAR |
| `config` | as duas seções da T19 numa página própria: placa de 2 canais (caindo de 4 ou mais, com avisos) e de 8 canais |
| `quebrado` | prova: o palco normal com um botão de largura fixa e texto longo e um caso de cada regra |

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
  Na vertical a rolagem é como a página (o EDITAR em 1024x768 rola, de
  propósito). A caixa que emoldura o texto (selo, botão, aviso PRÓXIMA) também
  não pode ser cortada. Na vertical conta a tinta das letras (medida no canvas
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
  por cima da outra em qualquer largura, e o nome do repertório ao lado de
  "MÚSICA 3 DE 6" só a partir de 1700 px.

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
