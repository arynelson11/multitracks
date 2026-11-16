# Admin central do Playback Studio (Plano de Implementação)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Revisão:** 2026-11-16, depois do pré-voo (`.superpowers/sdd/admin-preflight.md`, 46 achados, feito sobre a cobrança em `ea9986a`; a cobrança já está em `34ff00f` sem mudar contrato que o admin use) e das Rulings ADM-B1, ADM-B2, ADM-B3, ADM-ordem e ADM-demais do ledger. O que mudou está na seção "Mudanças do pré-voo". Onde este texto e o pré-voo divergem, vale este texto.

**Objetivo:** Levar o admin pra dentro do app (web e computador), com a tela de pendências e marcações da cobrança primeiro, e depois números confiáveis (assinantes, financeiro, custo de IA por trabalho) e ações sobre cada assinante, tudo verificado no servidor pelo papel `profiles.is_admin` e registrado.

**Arquitetura:** O admin vira uma tela interna do `App.tsx` (estado `isAdminPanelOpen`, nunca URL), que reaproveita `src/admin/` com uma casca nova na linguagem `ps-*`; o endereço `/admin` continua na web. No servidor, `api/admin-stats.ts` vira um roteador `?action=` (continua 12 funções) que chama módulos em `api/_lib/admin/`; as ações de cobrança reusam as funções da Fase 3 (`api/_lib/billing.ts`), e os números saem de funções SQL `admin_*` (só `service_role`). Cada ação grava `admin_audit_log`: as que só mexem no banco gravam na mesma transação; as que falam com o Asaas gravam "pendente" antes e o resultado depois.

**Tech Stack:** Vite 7 + React 19 + TypeScript + Tailwind v4 (tokens `ps-*` e peças de `src/components/ui/`) + Vercel Functions (`api/`) + Supabase (Postgres, RLS, funções `security definer`) + Asaas (só por mock nos testes) + Replicate (só por mock) + PTAX do Banco Central (só por mock) + Electron (o app roda de `file://`) + Vitest/jsdom/Testing Library + Postgres descartável pros testes SQL.

**Spec:** `docs/superpowers/specs/2026-11-16-admin-central-design.md` (autoridade). **Cobrança que o admin usa:** clone `~/playback-studio-work/cobranca`, branch `fix/cobranca` (não publicada); o que foi construído e as regras em `.superpowers/sdd/cobranca-report.md` (seções 1 a 12); as decisões do coordenador nas linhas "Ruling COB-*" de `.superpowers/sdd/2026-11-15-parte1-linguagem-canais/progress.md` (em especial COB-I7-v2, COB-R7, COB-RECONCILE e COB-ORDEM); as regras vivas em `PLAYBACK_STUDIO_FATOS.md` do clone, seção "Cobrança, cota e cancelamento". **Visual:** `DESIGN_SYSTEM.md` seção 1.7 e `src/components/ui/` (Button, Chip, Segmented, Panel, Led).

## Global Constraints

- **No máximo 12 funções em `api/`** (plano Hobby da Vercel; hoje são 12). Nenhum arquivo novo de endpoint: toda ação nova é `?action=` em `api/admin-stats.ts`. `api/_lib/` e `api/__tests__/` não contam. Conferência: `find api -name '*.ts' -not -path 'api/_lib/*' -not -path 'api/__tests__/*' | wc -l` dá `12`.
- **Toda ação de admin é verificada no servidor** por `verifyAdmin`, que lê `profiles.is_admin` (substitui o e-mail escrito à mão). O front só esconde botão; nunca é a trava. Sem coluna, sem chave de serviço ou com erro de banco, a pessoa não é admin (falha fechada).
- **Registro de cada ação de admin:** quem (id e e-mail do admin), quando, o quê (ação e alvo), antes e depois, resultado. Sem conseguir gravar o registro, a ação não roda.
- **Plano no app e cobrança no Asaas nunca desencontrados** (antiobjetivo do spec). Toda ação que mexe nos dois fala com o Asaas primeiro e grava no banco depois (ordem das funções da Fase 3); falha no meio vira pendência (`billing_pending_actions`) ou marcação (`needs_admin_review`) visível em Pendências, e repetir a ação termina o que faltou. Nenhuma ação do admin estorna dinheiro pela API (estorno é no painel do Asaas, FATOS).
- **Funciona no app de computador** (`file://`): API só por `apiUrl()` (`src/lib/api.ts`), nenhum caminho absoluto `/` pra asset, nenhum `window.location` pra abrir o admin, link externo só por `openExternalUrl()` (`src/lib/desktop.ts`). E funciona na web, inclusive em `/admin`.
- **Português do Brasil, sem travessão** (caractere U+2014) em texto de interface, mensagem do servidor, comentário novo, doc e commit. Nos testes, `const TRAVESSAO = String.fromCharCode(0x2014)` (nunca o caractere no código). Valor vazio aparece como `sem dado`.
- **Migrations só ficam escritas.** Rodar na produção é passo de lançamento com o dono (seção "Publicação"). Testes SQL só num Postgres local descartável, fora do repositório. Cada execução do `run-all.sh` usa um container próprio (`pbs-admin-sql-$$`); cada tarefa roda só o próprio arquivo de teste SQL, e a suíte inteira roda só no portão (ADM-B3).
- **Asaas, Replicate e Banco Central só por mock nos testes** (`createFakeAsaas` de `api/__tests__/billingHarness.ts`, `vi.fn` pro `fetch`). Nenhuma chamada de rede nos testes.
- **Custo de IA gravado por trabalho** na tabela `predictions` (modelo, faixas, tempo de processamento, status, custo em US$ e R$). Preço do hardware conferido na documentação do Replicate pra versão usada; câmbio do dia (PTAX venda), com o último guardado se a consulta falhar; o painel mostra a data do câmbio.
- **Segurança (padrões do projeto, memória "Security patterns"):** `applyCors` + `verifyAdmin` em todo caminho do admin; `service_role` só no servidor; tabela nova com RLS ligada e `revoke all ... from anon, authenticated`; toda função `admin_*` com `security definer`, `set search_path = public, pg_temp`, `revoke execute ... from public, anon, authenticated` e `grant execute ... to service_role`; as que mudam algo conferem `public.is_admin_user(p_admin)`. Nenhum segredo no código; nenhum detalhe técnico do Asaas ou do banco na resposta (mensagem pronta em português).
- **Visual:** telas novas do admin só com tokens `ps-*` e peças de `src/components/ui/`. Laranja (`ps-or`) = ligado ou ação principal; âmbar (`ps-alert`) = precisa de você; neutros pro resto. O dourado `primary` não entra. Números com `ps-num`. Classe sempre escrita inteira (nada de interpolar nome de classe).
- **Arquivos da cobrança que nenhuma tarefa edita:** `api/_lib/billing.ts`, `api/_lib/asaas.ts`, `api/_lib/pricing.ts`, `api/webhook/asaas.ts`, `api/_lib/reconcile.ts`, `db/supabase_cota_mensal.sql`. O admin importa deles. Exceções com dono: `db/supabase_assinaturas.sql` (só a função `user_has_cloud_library`, T1) e `api/checkout.ts` (só a trava de bloqueado na criação do checkout, T13).
- **Testes:** teste de DOM começa com `// @vitest-environment jsdom` e chama `afterEach(cleanup)`; não há `jest-dom` nem `user-event` (`fireEvent` e asserções nativas). Leitura de arquivo (`node:fs`) só dentro do próprio `*.test.ts`. ESLint `react-refresh/only-export-components`: `.tsx` exporta só componentes; tipos e funções vão pra `.ts` ao lado. Teste de API importa o handler e usa `createRes()` de `api/__tests__/fakeSupabase.ts`. O e-mail do dono e os nomes que um teste procura em arquivo são montados em tempo de execução (`const OWNER = ['arynelson11', 'gmail.com'].join('@')`, como o `TRAVESSAO`), e toda varredura de arquivo pula `*.test.ts` e `*.test.tsx`.
- **Execução:** clone `~/playback-studio-work/admin`, branch `feat/admin-central` (fora do iCloud). Todo comando começa com `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null; LOGS="$(mktemp -d)"; cd ~/playback-studio-work/admin` e redireciona saída longa pra `$LOGS`. Commits convencionais terminando com `[admin] [T<N>]`, sempre `git add <arquivo>` por nome. Nada de push, tag ou publicação: só o @devops, depois do dono aprovar a prévia.
- **Documentação viva:** cada tarefa com efeito pro usuário ou pro dono termina o relatório com uma "Linha pro FATOS"; o coordenador aplica as linhas em `PLAYBACK_STUDIO_FATOS.md` no portão da onda (um escritor só). A T28 consolida.

## Review Focus

Os cinco casos que o spec implica e que mais machucam o dono usando o admin, cada um com o teste que o prende na tarefa dona do código:

1. **Ação pela metade entre o Asaas e o app** (rede cai entre os dois passos, banco falha depois do Asaas, dois cliques em Confirmar, duas abas). Esperado: nunca fica um trocado e o outro não sem aviso; repetir termina; o segundo clique não faz nada a mais. Testes: T16 `troca: o Asaas trocou e o banco falhou, a ficha fica marcada e a nova tentativa conclui`, T16 `erro de banco depois do PUT no Asaas também marca a ficha`, T16 `cancelar de novo devolve already_canceled sem chamar o Asaas`, T4 `dois cliques seguidos em Confirmar chamam onConfirm uma vez`, T5 `conferir de novo responde not_flagged e não grava outro registro`.
2. **Quem não é admin chamando ação de admin** (token de usuário comum, conta com o e-mail do dono mas `is_admin` falso, usuário tentando se promover direto no banco, app de computador antigo). Esperado: 403 no servidor e o banco recusa. Testes: T6 `todas as ações registradas respondem 403 pra usuário comum` (no Corte A; a T28 fixa a lista das 20), T2 `o e-mail do dono com is_admin falso não é admin`, T1 `usuário comum não se dá is_admin nem com policy de update aberta`.
3. **Virada do dia e do mês em Brasília** (pagamento ou separação às 23:30 do dia 30 em Brasília, que já é dia 1º em UTC; data `AAAA-MM-DD` lida como UTC no navegador e mostrada um dia antes). Esperado: conta no mês de Brasília e mostra o dia certo. Testes: T10 `trabalho de 2026-12-01T02:30Z conta em novembro`, T22 `pagamento confirmado em 2026-11-30 conta em novembro`, T4 `fmtDay('2026-12-01') mostra 01/12/2026`, T16 `cortesia de 30 dias pedida às 22:00 de Brasília vale até o fim do dia 16/12`.
4. **Número que parece certo e está errado sem aviso** (trabalho de versão sem preço conhecido, câmbio velho, cancelada no período contada como ativa, trabalho que ninguém consultou até o fim). Esperado: fica fora da soma e aparece contado à parte, com a data do câmbio. Testes: T12 `versão sem preço fica sem custo`, T10 `trabalho com dólar e sem real conta como sem custo`, T22 `cancelada no período fica fora dos ativos que renovam`, T15 `câmbio com mais de 4 dias liga o alerta`, T19 `mostra "3 trabalhos sem custo" e a data do câmbio`.
5. **Asaas fora do ar ou lento enquanto o admin age ou abre a ficha.** Esperado: nada muda, a mensagem diz isso, a ficha abre sem o bloco "No Asaas agora" e sem diferença inventada. Testes: T6 `Asaas fora na conferência: 502 e nada marcado`, T16 `cancelar com o Asaas fora: 502 e nada muda`, T25 `Asaas fora: a ficha abre com aviso e sem diferenças`.

---

## Decisões tomadas neste plano (o dono confere)

O dono deixou as decisões com o coordenador ("pode começar pelo que você acha certo"). Cada uma vale até o dono mudar na prévia.

- **D1. Onde:** clone novo `~/playback-studio-work/admin`, branch `feat/admin-central`, criada a partir da `fix/cobranca` final (depois da rodada 5 aceita). Assim o Corte A sai junto com a cobrança.
- **D2. Duas publicações.** Corte A = Onda 1 (pendências, marcações, registro, papel de admin, botão ADMIN dentro do app): sai junto com a Fase 3 da cobrança (COB-ORDEM). Corte B = Ondas 2 a 4 (números confiáveis, custo de IA, ações sobre o assinante): sai depois, quando o dono aprovar a prévia.
- **D3. Endpoint:** continua `api/admin-stats.ts`, agora roteado por `?action=`. O `?source=asaas|replicate` antigo continua até a T28, pras abas antigas do Corte A.
- **D4. Papel:** `profiles.is_admin`, lido pelo servidor com a chave de serviço. O e-mail do dono aparece uma vez só, na linha da migration que marca o primeiro admin. As regras do banco passam a usar `public.is_admin()`.
- **D5. Proteção do perfil:** um gatilho recusa qualquer mudança em papel, bloqueio, plano e cota feita por quem não é o backend (defesa extra, mesmo que alguém crie uma policy de update no painel).
- **D6. Ordem do SQL no lançamento:** `supabase_admin_papel.sql`, `supabase_cota_mensal.sql`, `supabase_assinaturas.sql` (editado pra usar `is_admin()`), `supabase_admin_base.sql`; no Corte B, `supabase_admin_custos.sql`, `supabase_admin_gestao.sql`, `supabase_admin_numeros.sql`.
- **D7. Registro:** ação só no banco grava o registro na mesma transação; ação com o Asaas grava "pendente" antes e o resultado depois (se o fechamento falhar, fica "sem confirmação" visível). O registro só aceita inserir e fechar o pendente; apagar e reescrever são recusados pelo banco. `admin_id` e `target_user_id` ficam sem chave estrangeira, com os e-mails copiados no próprio registro (ADM-B2): excluir a conta de quem aparece nele, ou de um admin, nunca falha, e o e-mail do alvo fica no registro depois da exclusão (guarda, como na cobrança).
- **D8. Pendências:** "marcar como feito" à mão só vale pra estorno, caso pra olhar e remoção de cobrança futura, e o servidor confere no Asaas antes: estorno precisa estar estornado ou em estorno; remoção precisa não ter mais cobrança futura em aberto. Inativar ou remover assinatura só fecha quando o Asaas confirma (botão "Tentar agora"). Descartar ("Não vou estornar") só vale pra estorno e caso pra olhar. O caso que a conferência diária abre pra assinatura ativa no Asaas sem registro no app (`asaas:<id>`) só fecha se o Asaas já não cobra mais, porque esse caso nunca volta a ser criado.
- **D9. Cortesia** mora em `billing_subscriptions` (`kind = 'courtesy'`), já construída na Fase 3; não entram colunas de cortesia no perfil. "Por N dias" = vale até o fim do dia hoje + N em Brasília (N de 1 a 365), ou sem data. O spec §7 fala em campos de cortesia no perfil: fica pro dono confirmar (ponto 4 abaixo). Conta com assinatura paga cancelada ainda dentro do período só recebe cortesia de plano maior, sem data ou com data depois do fim desse período; e não se dá duas cortesias iguais ativas.
- **D10. Bloquear** fecha o acesso ao app e às funções do servidor (separar, consultar separação, enviar arquivo, salvar na nuvem, assinar) e não mexe na cobrança: a confirmação avisa e a Visão geral mostra "bloqueados com assinatura ativa". O bloqueado ainda consegue cancelar a assinatura e excluir a conta. Conta admin não pode ser bloqueada.
- **D11. Ajustar cota:** "Zerar" (o contador do mês volta a 0) e "Somar N" (cota extra só no mês atual, de 1 a 500, guardada no perfil e somada ao limite pelo servidor). A função de consumo testada com corridas (`consume_separation_token`) não muda. O extra do mês tem teto de 1000 e passar dele é recusado com mensagem; "Somar" feito em duas abas soma duas vezes (as duas ficam no Registro).
- **D12. Mudar plano** só pra quem tem assinatura paga ativa (`changePlan` da Fase 3: vale a partir da próxima cobrança, sem proporcional, acesso muda na hora). Pra conta no Livre o caminho é cortesia. Se o Asaas trocar e o banco não, a ficha fica marcada em Pendências e "Mudar plano" de novo termina. Qualquer erro depois de o servidor ler a assinatura (menos Asaas fora, recusa do Asaas, assinatura não achada no Asaas e servidor sem chave) também marca a ficha, porque o Asaas pode ter trocado.
- **D13. Cancelar pelo admin:** "no fim do período" ou "agora", sempre sem estorno automático.
- **D14. A ficha consulta o Asaas na hora** (só GET) e mostra em âmbar qualquer diferença de status, valor ou ciclo entre o app e o Asaas. O vencimento compara a cobrança em aberto do ciclo (mesma regra da conferência diária), nunca o `nextDueDate` da assinatura, que aponta pra próxima a ser gerada.
- **D15. Preço do hardware** fica numa constante em `api/_lib/aiCost.ts`, conferida em replicate.com/pricing e na página do modelo no dia da implementação, com a data e o link. Trabalho de versão sem preço conhecido fica sem custo e é contado à parte.
- **D16. Câmbio:** PTAX de venda do Banco Central (API Olinda, pública, sem chave), guardada em `fx_rates`, consultada no máximo a cada 6 horas; se falhar, vale a última guardada. O custo em R$ usa a PTAX pura (sem IOF nem spread do cartão) e a tela diz isso. A consulta que o usuário faz no fim da separação só usa o câmbio já guardado (nunca espera o Banco Central).
- **D17. Quando o custo é gravado:** quando o app consulta o trabalho e ele termina (`api/check-separation.ts`); e uma varredura ao abrir Custos de IA completa os que ficaram sem custo, até 20 por vez, inclusive os antigos. Trabalho gravado sem câmbio conta como sem custo até a varredura completar o R$.
- **D18. Números:** receita do mês = cobranças pagas com data de pagamento no mês de Brasília (bruto e líquido do Asaas); MRR = assinaturas pagas ativas que renovam vezes o preço da tabela única (`api/_lib/pricing.ts`; anual dividido por 12); inadimplente = conta com cobrança vencida em aberto; cancelamentos do mês por motivo, sem contar troca de plano e compra repetida; margem = receita líquida menos custo de IA, com a frase "sem R2, Supabase e Vercel" na tela. Assinante de antes da Fase 3 (sem linha de assinatura) é contado à parte como "assinatura antiga sem registro" e aparece em Assinantes como Pagando, com a marcação Para conferir.
- **D19. Link do Asaas:** "Ver no Asaas" abre a fatura do cliente (`invoiceUrl`, consultada na hora), onde se vê o status mas não se estorna. O estorno é feito no painel do Asaas, buscando pelo id da cobrança; Pendências e Financeiro têm o botão "Copiar id".
- **D20. Último acesso** = última abertura do app, gravada no máximo uma vez por hora a partir desta versão; antes disso a ficha mostra o último login com esse rótulo.
- **D21. A aba "Uso & Sinais" sai na T28:** power users viram a ordenação "Mais separações" em Assinantes e "pagantes sumidos" vira o filtro "Sumidos há 30 dias".
- **D22. No Corte A** as abas antigas (Visão geral, Assinantes com a lista de hoje, Financeiro, Custos de IA, Uso) continuam com os números de hoje, sem travessão; a aba Pendências abre primeiro. No Corte B a Visão geral abre primeiro, com o alerta que leva a Pendências. As abas antigas são uma exceção temporária ao visual novo do spec §8, aceita até a T17 a T20 as reescreverem; a casca, as telas de carregando e de acesso negado, Pendências e Registro já nascem na linguagem nova.
- **D23. Testes SQL** num Postgres descartável fora do repositório (`~/playback-studio-work/admin-sql-tests/`), como na cobrança, e reaplicando os testes SQL da cobrança pra provar que a edição da T1 não quebrou nada. Cada execução usa um container próprio e cada tarefa roda só o próprio arquivo; a suíte inteira, com os testes e as três corridas reais da cobrança, roda no portão (ADM-B3).
- **D24. Trabalhos ficam depois da exclusão da conta:** `predictions.user_id` passa a aceitar nulo, com a chave `on delete set null`, pra excluir a conta não mudar o custo de IA nem a margem de meses passados.
- **D25. `predictions.model`** é o `model_name` do demucs (`htdemucs` ou `htdemucs_6s`) em todo lugar que grava (separação nova e varredura), nunca o `model` do Replicate.
- **D26. Ordem do Portão A (ADM-ordem):** SQL na produção com OK explícito do dono, prévia na web, publicação, conferência no app de computador. A prévia não pode ser no app de computador, que sempre chama a API de produção.

**Pontos que só o dono confirma** (o plano já decidiu como está acima; mudar é barato até a Onda 3):
1. Bloquear também deve cancelar a assinatura sozinho? (D10: não; só avisa.)
2. "Somar separações" é extra só no mês, que some no dia 1º? (D11.)
3. Custo em R$ pela PTAX pura ou com o IOF e o spread do cartão que paga o Replicate? (D16: PTAX pura, escrito na tela.)
4. A cortesia mora nas linhas da assinatura da Fase 3 (D9), e não em colunas do perfil como o spec §7 escreve. Fica assim?

## Mudanças do pré-voo

Uma linha por achado de `.superpowers/sdd/admin-preflight.md`, todos aplicados (Rulings ADM-B1, ADM-B2, ADM-B3, ADM-ordem e ADM-demais).

- **B1:** a T9 ganha `LibraryModal.tsx`, `SeparatorStudio.tsx`, `SettingsModal.tsx` e `useSeparationLibrary.ts`, que trocam `isAdminEmail` pelo `isAdmin` de `useAuth()`.
- **B2:** `admin_audit_log` sem chave estrangeira em `admin_id` e `target_user_id`, com os e-mails copiados; testes de excluir a conta de quem está no registro e de um admin (T5) e de excluir o admin que bloqueou alguém (T21); D7.
- **B3:** `run-all.sh` com container por execução e argumento pra rodar um arquivo só; cada tarefa SQL roda só o próprio arquivo, a suíte inteira só no portão; ordem das ondas igual.
- **I1:** na T16, qualquer erro depois de ler a assinatura (fora Asaas fora, recusa, não achada e sem chave) marca a ficha; teste de erro de banco depois do PUT.
- **I2:** na T6, caso `asaas:` da conferência diária só fecha se o Asaas não cobra mais; na T8, o diálogo avisa que o caso não volta.
- **I3:** na T16, cortesia pra conta com paga cancelada no período só de plano maior e que vá além da data; teste.
- **I4:** a T27 ganha `SeparatorStudio.tsx`: a checagem antes de subir o arquivo usa o limite com a cota extra (`monthlyLimit`).
- **I5:** na T25, o vencimento do Asaas é o da cobrança em aberto do ciclo (`openDueDate`, regra da conferência diária), nunca o `nextDueDate` da assinatura.
- **I6:** na T6, `futurePendingCharges` protege o id guardado e o ciclo cortado, como `removeFuturePendingCharges`; teste.
- **I7:** na T3, `BillingError` usa `httpStatus` e `db_error` vira 500 sem a mensagem do banco; teste.
- **I8:** na T1 e na Publicação, a conferência do papel aceita `user_has_cloud_library` (trocada logo depois) e a consulta repete depois do `supabase_admin_base.sql`, esperando 0.
- **I9:** na T1, cada policy só é recriada se a tabela existir (`payments`, `songs`, `stems`, `storage.objects`).
- **I10:** na T1, `psqlt` adaptado entra no Files, o `run-all.sh` conta os dois formatos de saída, o `05-helpers.sql` vai na frente de cada `4*` e as três corridas da cobrança entram no fim.
- **I11:** Portão A com prévia na web depois do SQL na produção; o app de computador só confere depois de publicar (ADM-ordem).
- **I12:** os Steps 4 de T2, T12, T13 e T23 rodam listas explícitas de arquivos de teste, nunca a pasta inteira.
- **I13:** e-mail do dono e nomes procurados montados em tempo de execução, varreduras pulando `*.test.ts(x)` (T2, T9, T28 e Global Constraints).
- **I14:** `predictions.model` = `model_name` do demucs na T12 e na T23; teste "a varredura grava o mesmo model"; D25.
- **M1:** `is_admin()` também pra `anon` (devolve falso sem login).
- **M2:** a T4 monta as abas por uma lista tipada `ComponentType<TabProps>`; as abas antigas entram sem props e T17 a T20 passam a declarar `TabProps` sem mexer no `AdminApp`.
- **M3:** a T4 refaz as telas de carregando e de acesso negado com `ps-*`.
- **M4:** o tipo da ficha vira `SubscriberDetailData` (seção B, T17, T25, T26).
- **M5:** a T25 converte `all` e `none` em `null`; na T21 `null` = sem filtro.
- **M6:** `admin_adjust_quota` devolve `over_limit` acima de 1000; a T16 responde 409, e 404 pro `not_found`.
- **M7:** a T16 recusa cortesia repetida do mesmo plano; "Somar" em duas abas soma duas vezes (D11).
- **M8:** na T16, a tradução da mensagem fica fora do `withAudit`; teste "troca pela metade fica partial no registro".
- **M9:** na T16, `not_found` do Asaas depois de ler a assinatura vira 502; `grantCourtesy` recebe `new Date(until)`.
- **M10:** descartar só vale pra `refund_payment` e `admin_review` (T5 e T6).
- **M11:** na T8, `reasonText` traduz `vencida`, `estorno` e os valores de `cancel_source`; `compra_duplicada` fica como legado.
- **M12:** a tela vazia de Pendências diz só "Nada pendente agora.".
- **M13:** a T20 ganha o alerta "Avisos e pendências tentando sozinhos" (`alerts.auto`).
- **M14:** a `BlockedScreen` ganha "Excluir minha conta" e o `onOpenPricing` não abre nada.
- **M15:** a T27 extrai `shouldShowBlocked` pra `profileFlags.ts` e testa a função.
- **M16:** a D9 vira o ponto 4 dos que só o dono confirma.
- **M17:** a D19 diz que o link é a fatura do cliente; a T8 ganha "Copiar id" no estorno.
- **M18:** a D22 registra as abas antigas como exceção temporária até T17 a T20.
- **M19:** a T10 troca a chave de `predictions.user_id` pra `on delete set null`; `AiJob.userId` aceita nulo; D24.
- **M20:** assinante antigo sem linha aparece Pagando com Para conferir (T21) e é contado em `legacyPaid` (T22, T20); D18.
- **M21:** `brtMonth` reusa `brtToday` (T13); a T4 cria `src/admin/lib/period.ts`, usado por T18, T19 e T26.
- **M22:** a varredura do POST usa `budgetMs 20000` (T24).
- **M23:** na T12, status estranho vira `unknown` e falha ao gravar uma linha não trava a varredura; teste.
- **M24:** `touchLastSeen` com trava de módulo (T9).
- **M25:** `getSubscription` lida por tipo local e `null` = removida (T25); `getPayment` nulo responde 409 ou 404 e o status sai em português (T6).
- **M26:** se a versão ficar fora da tabela de preços, o teste da tabela real vira `it.skip` e o coordenador decide (T12).
- **M27:** cabeçalho cita as seções 1 a 12 do relatório; `registry.ts` sai da frase de arquivos da T28.
- **M28:** o teste de 403 de todas as ações registradas nasce na T6 (lote 1B); a T28 só fixa a lista das 20 (ADM-ordem).
- **M29:** a T23 usa só o câmbio guardado (`getStoredUsdBrl`, T11); `withoutCost` conta também `cost_brl` nulo (seção C, T10, T22); a varredura completa o R$ (T12).

---

## Pré-requisitos

- [ ] **P1. Base.** A cobrança fechou (rodada 5 e o ajuste final, COB-PRE) e a re-revisão foi aceita pelo coordenador. O pré-voo foi feito sobre `ea9986a`, e a cobrança já estava em `34ff00f` sem mudar contrato que o admin use. Então: `git clone ~/playback-studio-work/cobranca ~/playback-studio-work/admin && cd ~/playback-studio-work/admin && git checkout -b feat/admin-central origin/fix/cobranca && git remote set-url origin "$(git -C ~/playback-studio-work/cobranca remote get-url origin)" && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm ci`. Copiar este plano e o spec pra `docs/superpowers/plans/` e `docs/superpowers/specs/` do clone e commitar (`docs(admin): plano e spec do admin central [admin]`). Portão de partida verde: `npx vitest run`, `npx tsc -b`, `npm run typecheck`, `npx tsc -p api/tsconfig.json --noEmit`, `DESKTOP=1 npx vite build`, 12 funções.
- [ ] **P2. Conferência da rodada 5 (regra fixa).** Conferido no pré-voo (`api/_lib/reconcile.ts` em `ea9986a`): a conferência diária grava só por `billing_flag_review` e por `admin_review` sem tentativa automática, então T5 e T8 seguem como estão e não entra `lastReconcileAt`. No HEAD final, reler `api/_lib/reconcile.ts` com a regra abaixo. Se a conferência diária grava só por `billing_flag_review` e `billing_enqueue_action(..., 'admin_review', ..., p_auto_retry => false)`, as T5 e T8 seguem como estão (as marcações dela aparecem nas fontes 1 e 2 da fila). Se ela grava o resumo da execução numa tabela própria, o coordenador acrescenta à T5 o campo `lastReconcileAt` (a data mais recente dessa tabela) no JSON de `admin_review_queue` e à T8 a linha "Última conferência diária: dd/mm/aaaa hh:mm". Se ela grava em qualquer outro lugar, para e decide antes da Onda 1.
- [ ] **P3. Testes SQL:** criar `~/playback-studio-work/admin-sql-tests/` copiando (sem mudar os originais) `00-baseline-stubs.sql`, `10-seed.sql`, `20-quota-tests.sql`, `30-billing-tests.sql`, `psqlt` e o roteiro das três corridas reais de `~/playback-studio-work/cobranca-sql-tests/`. A T1 adapta o `psqlt` e escreve o `run-all.sh`.

## Ondas, dependências e paralelismo

Duas tarefas do mesmo lote nunca tocam o mesmo arquivo. Arquivos com mais de um dono, e a ordem: `src/admin/tabs/ReviewTab.tsx` e `AuditTab.tsx` (T4 cria o lugar, T8 e T7 preenchem); `src/admin/tabs/SubscribersTab.tsx` (T4 renomeia, T17 reescreve, T26 liga as ações); `OverviewTab.tsx`, `FinanceTab.tsx`, `AiCostTab.tsx` (T4 tira o travessão, T20, T18 e T19 reescrevem); `src/admin/AdminApp.tsx` (T4, depois T28); `src/App.tsx`, `src/lib/profileFlags.ts` e `src/components/SeparatorStudio.tsx` (T9, depois T27); `src/hooks/useAuth.ts` (só T9); `src/admin/lib/period.ts` (só T4); `api/separate-audio.ts`, `api/check-separation.ts` e `api/__tests__/separate-audio.test.ts` (T13, depois T23); `api/_lib/admin/*.ts` de área (T3 cria vazio, uma tarefa preenche cada um); `api/__tests__/fakeSupabase.ts` (só T12); `api/admin-stats.ts` (T3, depois T28); `api/_lib/admin/registry.ts` (só T3); `api/__tests__/admin-registry.test.ts` (T6 cria, T28 fixa a lista das 20 ações); `~/playback-studio-work/admin-sql-tests/run-all.sh` e `psqlt` (só T1; as outras tarefas SQL só criam o próprio `4*-*.sql`).

| Onda | Lote | Tarefas | Depende de |
|---|---|---|---|
| 1 (Corte A) | 1A fundação | T1 SQL do papel · T2 Papel no servidor · T3 Roteador e registro · T4 Casca do admin e cliente da API | P1 a P3 |
| 1 (Corte A) | 1B telas | T5 SQL do registro e da fila · T6 Servidor das pendências · T7 Registro · T8 Tela de Pendências · T9 Entrada pelo app | T5: T1. T6: T3. T7: T3, T4. T8: T4. T9: T2, T4 |
| | | **Portão A:** SQL na produção (OK do dono), prévia na web, publicação junto com a cobrança, conferência no app de computador | Onda 1 inteira |
| 2 | | T10 SQL do custo e do câmbio · T11 Câmbio do dia · T12 Custo por trabalho · T13 Bloqueio e cota extra nos endpoints · T14 Servidor do Financeiro · T15 Servidor da Visão geral · T16 Servidor das ações · T17 Tela de Assinantes · T18 Tela do Financeiro · T19 Tela de Custos de IA · T20 Tela da Visão geral | T10: T1. T13: T2. T14 a T16: T3. T17 a T20: T4. T15: T5 |
| 3 | | T21 SQL de assinantes, bloqueio e cota · T22 SQL dos números · T23 Grava o trabalho · T24 Servidor de Custos de IA · T25 Servidor de Assinantes · T26 Ações na ficha · T27 Conta bloqueada e cota extra no app | T21, T22: T10. T23: T11, T12, T13. T24: T11, T12. T25: T13. T26: T17. T27: T9, T13 |
| 4 | | T28 Limpeza, abas finais e documentação | todas |
| | | **Portão B e publicação** | Onda 4 |

28 tarefas em 4 ondas (a Onda 1 em dois lotes, 1A e 1B, que destravam a cobrança). Caminho crítico: T1, T5, T6, T8 (Corte A); T10, T21 e T22 no SQL e T12, T23, T24 no custo (Corte B).

**Regras de execução paralela (as da Parte 2):**
- Cada agente só toca os arquivos do bloco **Files** da sua tarefa. Precisou de outro, para e avisa o coordenador.
- Checkout compartilhado no clone. Commits pequenos, por nome de arquivo. Se aparecer `.git/index.lock`, esperar e repetir; nunca apagar o lock de outro agente.
- Cada agente roda só os testes da própria tarefa. `tsc`, eslint, build e a suíte SQL completa são do **portão** do lote ou da onda: `npx vitest run`, `npx tsc -b`, `npm run typecheck`, `npx tsc -p api/tsconfig.json --noEmit`, eslint nos arquivos do lote (0 erros nos novos, nenhum erro novo nos antigos), `DESKTOP=1 npx vite build`, contagem de funções (12) e `bash ~/playback-studio-work/admin-sql-tests/run-all.sh` sem argumento (0 falhas).
- O Step 4 que cita outros arquivos de teste roda só a lista escrita nele, nunca a pasta inteira. Tarefa SQL roda `bash ~/playback-studio-work/admin-sql-tests/run-all.sh <seu-arquivo>.sql`: container próprio e só o seu arquivo, depois de aplicar as migrations que existirem.
- Tarefa de servidor que chama função SQL ainda não escrita usa o contrato da seção Arquitetura e testa com `db.setRpc(...)`; a tarefa SQL dona prova o mesmo formato no Postgres.

## Arquitetura (vale pra várias tarefas)

### A. Contrato das ações (`/api/admin-stats?action=...`)

Todas exigem `Authorization: Bearer <token de admin>`. GET lê `req.query`; POST lê o corpo JSON. Página de lista: `page` começa em 1, `pageSize` fixo 50 (`p_limit = 50`, `p_offset = (page - 1) * 50`). Datas `AAAA-MM-DD` são dias de Brasília; instantes são ISO.

| Ação | Método | Entrada | Resposta | Servidor | SQL ou função da Fase 3 |
|---|---|---|---|---|---|
| `review` | GET | | `ReviewQueue` | T6 | `admin_review_queue()` |
| `payment-link` | GET | `id` (`pay_...`) | `{ paymentId, status, invoiceUrl }` | T6 | `getPayment` |
| `resolve-flag` | POST | `{ subscriptionRef, note }` | `{ result: 'resolved' }` | T6 | `admin_resolve_flag` |
| `close-action` | POST | `{ actionId, outcome: 'done'\|'canceled', note }` | `{ result: 'closed' }` | T6 | `admin_close_action` |
| `retry-action` | POST | `{ actionId }` | `{ status, attempts, lastError }` | T6 | `runPendingActions({ ids })` |
| `retry-event` | POST | `{ eventId }` | `{ processed, result }` | T6 | `admin_reset_event` + `processStoredEvent` |
| `audit` | GET | `page`, `userId?` | `AuditPage` | T7 | `admin_audit_list` |
| `finance` | GET | `from?`, `to?`, `status?`, `page?` | `FinancePage` | T14 | `admin_finance` |
| `overview` | GET | | `Overview` | T15 | `admin_overview` + `admin_review_queue` |
| `change-plan` | POST | `{ userId, planKey }` | `{ result: 'changed'\|'unchanged', planKey }` | T16 | `changePlan` |
| `grant-courtesy` | POST | `{ userId, planKey, days: number\|null, note? }` | `{ courtesyId, until }` | T16 | `grantCourtesy` |
| `end-courtesy` | POST | `{ userId, courtesyId }` | `{ result }` | T16 | `endCourtesy` |
| `cancel-subscription` | POST | `{ userId, when: 'now'\|'period_end' }` | `{ result, accessUntil, pendingStop }` | T16 | `cancelSubscriptionForUser({ source: 'admin' })` |
| `block` | POST | `{ userId, reason }` | `{ result: 'blocked' }` | T16 | `admin_set_block` |
| `unblock` | POST | `{ userId }` | `{ result: 'unblocked' }` | T16 | `admin_set_block` |
| `adjust-quota` | POST | `{ userId, mode: 'reset'\|'add', amount? }` | `{ used, bonus, periodStart }` | T16 | `admin_adjust_quota` |
| `ai-costs` | GET | `from?`, `to?`, `page?` | `AiCosts` | T24 | `admin_ai_costs` |
| `ai-costs-sweep` | POST | `{ limit? }` | `{ recorded, unknown, failed, brlCompleted, more }` | T24 | `sweepPendingCosts` |
| `subscribers` | GET | `q?`, `plan?`, `status?`, `flag?`, `sort?`, `page?` | `SubscriberPage` | T25 | `admin_list_subscribers` |
| `subscriber` | GET | `userId` | `SubscriberDetailData` | T25 | `admin_subscriber_detail` |

### B. Formatos de resposta

As funções SQL devolvem `jsonb` com as chaves em camelCase exatamente como abaixo; o servidor repassa e só acrescenta os campos marcados "servidor". O front tem a sua cópia dos tipos (o backend não importa de `src/`), em `src/admin/lib/<área>Types.ts`.

```ts
type PlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'

type ReviewAction = { id: number; action: 'delete_subscription' | 'inactivate_subscription' | 'delete_future_payments' | 'refund_payment' | 'admin_review'
  reason: string; autoRetry: boolean; attempts: number; lastError: string | null; nextAttemptAt: string; createdAt: string
  subscriptionRef: string; asaasSubscriptionId: string | null; paymentId: string | null; dueDate: string | null; amount: number | null
  userId: string | null; email: string | null; planKey: string | null }
type ReviewFlag = { subscriptionRef: string; userId: string | null; email: string | null; planKey: string; kind: 'asaas' | 'courtesy'
  status: 'active' | 'canceled'; cancelSource: string | null; adminNote: string | null; updatedAt: string }
type ReviewEvent = { id: string; event: string; status: 'pending' | 'failed' | 'exhausted'; attempts: number; lastError: string | null; receivedAt: string }
type ReviewQueue = { actions: ReviewAction[]; flags: ReviewFlag[]; events: ReviewEvent[]
  counts: { manual: number; auto: number; total: number }; generatedAt: string }
// manual = ações com autoRetry falso + flags + eventos 'exhausted'; auto = ações com autoRetry + eventos 'pending' ou 'failed'

type AuditEntry = { id: number; createdAt: string; finishedAt: string | null; adminEmail: string; action: string
  targetUserId: string | null; targetEmail: string | null; targetRef: string | null
  result: 'pending' | 'ok' | 'failed' | 'partial'; message: string | null; note: string | null; before: unknown; after: unknown }
type AuditPage = { total: number; page: number; pageSize: number; rows: AuditEntry[] }   // page e pageSize: servidor

type Overview = {
  month: { start: string; end: string; label: string }          // label: servidor ("novembro de 2026")
  revenue: { grossBrl: number; netBrl: number; payments: number; refundedBrl: number; refunds: number }
  mrrBrl: number                                                  // servidor
  subscribers: { activeByPlan: Partial<Record<PlanKey, number>>; endingByPlan: Partial<Record<PlanKey, number>>
    courtesyByPlan: Partial<Record<PlanKey, number>>; overdueAccounts: number; blockedWithActiveSub: number
    legacyPaid: number }                                         // plano pago sem linha de assinatura (antes da Fase 3)
  cancellations: { total: number; bySource: Partial<Record<'user' | 'user_refund' | 'unpaid' | 'refund' | 'asaas' | 'admin' | 'account_deleted', number>> }
  aiCost: { jobs: number; succeeded: number; failed: number; costBrl: number; costUsd: number; withoutCost: number }
  marginBrl: number                                               // servidor: revenue.netBrl - aiCost.costBrl
  fx: { date: string | null; rate: number | null; ageDays: number | null }   // ageDays: servidor
  alerts: { manual: number; auto: number; blockedWithActiveSub: number; withoutCost: number; fxOld: boolean }  // servidor
}

type FinanceRow = { paymentId: string; userId: string | null; email: string | null; planKey: string | null; status: string
  value: number | null; netValue: number | null; dueDate: string | null; paymentDate: string | null; confirmedDate: string | null
  refundedAt: string | null; lastEvent: string; lastEventAt: string }
type FinancePage = { range: { from: string; to: string }
  totals: { grossBrl: number; netBrl: number; paidCount: number; refundedBrl: number; overdueBrl: number; overdueCount: number }
  byMonth: { month: string; grossBrl: number; netBrl: number; byPlan: Partial<Record<PlanKey, number>> }[]   // 12 meses até `to`
  overdue: { paymentId: string; userId: string | null; email: string | null; planKey: string | null; dueDate: string; value: number | null }[]
  rows: FinanceRow[]; total: number; page: number; pageSize: number }

type AiJob = { replicateId: string; createdAt: string; userId: string | null; email: string | null; model: string | null; stemCount: number | null
  status: string | null; predictSeconds: number | null; hardware: string | null; costUsd: number | null; costBrl: number | null
  fxRate: number | null; fxDate: string | null }
type AiCosts = { range: { from: string; to: string }
  totals: { jobs: number; succeeded: number; failed: number; canceled: number; unknown: number; withoutCost: number
    costUsd: number; costBrl: number; avgBrlPerSucceeded: number | null; predictSeconds: number }
  byUser: { userId: string | null; email: string | null; jobs: number; costBrl: number }[]     // 50 de maior custo; userId nulo = conta excluída
  byModel: { model: string | null; stemCount: number | null; jobs: number; costBrl: number; avgSeconds: number | null }[]
  fx: { minDate: string | null; maxDate: string | null }
  rows: AiJob[]; total: number; page: number; pageSize: number
  prices: { checkedAt: string; source: string; table: { hardware: string; usdPerSecond: number }[] }   // servidor
  sweep: { recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean; skipped: boolean } }      // servidor

type SubscriberStatus = 'paid_active' | 'ending' | 'courtesy' | 'free' | 'blocked'
type SubscriberRow = { userId: string; email: string | null; name: string | null; plan: string; courtesyPlan: string | null
  status: SubscriberStatus; nextDueDate: string | null; accessUntil: string | null; separationsMonth: number
  createdAt: string; lastSeenAt: string | null; lastSignInAt: string | null
  flags: ('review' | 'red' | 'due7' | 'blocked' | 'inactive30')[] }
type SubscriberPage = { total: number; page: number; pageSize: number; rows: SubscriberRow[] }

type SubscriptionRow = { id: string; kind: 'asaas' | 'courtesy'; planKey: PlanKey; cycle: 'MONTHLY' | 'YEARLY' | null; status: 'active' | 'canceled'
  startedAt: string; nextDueDate: string | null; paidUntil: string | null; accessUntil: string | null; cancelSource: string | null
  canceledAt: string | null; asaasSubscriptionId: string | null; asaasStoppedAt: string | null; lastPaidDueDate: string | null
  needsAdminReview: boolean; adminNote: string | null }
type SubscriberDetailData = {
  profile: { userId: string; email: string | null; name: string | null; provider: string | null; plan: string; planExpiresAt: string | null
    isAdmin: boolean; blockedAt: string | null; blockedReason: string | null; createdAt: string; lastSignInAt: string | null; lastSeenAt: string | null }
  quota: { used: number; bonus: number; periodStart: string; resetsAt: string; limit: number | null }   // limit: servidor (null pra admin)
  subscriptions: SubscriptionRow[]
  payments: (FinanceRow & { subscriptionRef: string | null; originalDueDate: string | null })[]      // 50 mais novos
  legacyPayments: { id: string; planKey: string; value: number; cycle: string | null; paidAt: string }[]
  separations: { month: number; total: number }
  aiCost: { monthBrl: number; totalBrl: number; jobsWithoutCost: number }
  openActions: ReviewAction[]
  plans: { key: PlanKey; label: string; value: number; cycle: 'MONTHLY' | 'YEARLY' }[]                 // servidor (PLAN_PRICING)
  asaasLive: ({ subscriptionRef: string; ok: true; status: string; value: number; cycle: string; openDueDate: string | null; deleted: boolean }
            | { subscriptionRef: string; ok: false; error: string })[]                                     // servidor
  mismatches: string[]                                                                                       // servidor
}
```

### C. Regras comuns

- **Mês e dia de Brasília** no SQL: `public.billing_today()` (Fase 3) e `public.separation_period_start(now())` (cota). Intervalo de um dia `d` em `timestamptz`: de `(d::timestamp at time zone 'America/Sao_Paulo')` até `((d + 1)::timestamp at time zone 'America/Sao_Paulo')`. No servidor: `brtToday` e `addDays` de `api/_lib/billing.ts`. Meia-noite de Brasília de um dia `d` como instante: `new Date(d + 'T03:00:00Z')` (sem horário de verão desde 2019).
- **Status pago do Asaas:** `CONFIRMED`, `RECEIVED`, `RECEIVED_IN_CASH` (`PAID_STATUSES` da Fase 3). Data de pagamento de uma cobrança: `coalesce(confirmed_date, payment_date)`.
- **Plano efetivo:** `profiles.plan`, ou `'free'` se `plan_expires_at <= now()` (igual a `effectivePlan`).
- **Mensagens do servidor** são frases prontas em português, sem nome de coluna, sem detalhe do Asaas e sem travessão.
- **Trabalho sem custo** = `cost_recorded_at` nulo, `cost_usd` nulo ou `cost_brl` nulo. Toda contagem `withoutCost` usa esta regra, e as somas em R$ só somam quem tem `cost_brl`.
- **`predictions.model`** é o `model_name` do demucs (`htdemucs` ou `htdemucs_6s`), nunca o `model` do Replicate (dono/nome).

---

## Onda 1, lote 1A: fundação

### Task 1: SQL do papel de admin e dos campos do perfil

**Files:**
- Create: `db/supabase_admin_papel.sql`
- Modify: `db/supabase_assinaturas.sql` (só a função `user_has_cloud_library` e o cabeçalho, que passa a dizer "rodar DEPOIS de db/supabase_admin_papel.sql")
- Modify (só uma linha de aviso no topo): `db/supabase-setup.sql`, `db/supabase-migration.sql`, `db/supabase_rpc_setup.sql`, `db/supabase_admin_setup.sql`, `db/supabase_payments.sql`, `db/supabase_user_separations_plan_gate.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/run-all.sh`, `05-helpers.sql`, `40-papel-tests.sql`, `README.md`
- Modify (fora do repositório): `~/playback-studio-work/admin-sql-tests/psqlt` (a cópia de P3 passa a ler o container de `PBS_SQL_CONTAINER`)

**Interfaces:**
- Produces (colunas novas em `public.profiles`, todas `add column if not exists`): `is_admin boolean not null default false`; `blocked_at timestamptz`; `blocked_reason text`; `blocked_by uuid references auth.users(id) on delete set null`; `last_seen_at timestamptz`; `quota_bonus integer not null default 0 check (quota_bonus between 0 and 1000)`; `quota_bonus_period timestamptz`.
- Produces: `public.is_admin() returns boolean` (stable, security definer; `auth.uid()`; execute pra `anon`, `authenticated` e `service_role`; sem login devolve falso). `public.is_admin_user(p_user uuid) returns boolean` (só `service_role`). `public.touch_last_seen() returns void` (security definer; grava `last_seen_at = now()` na própria linha só se for nulo ou mais velho que 1 hora; execute pra `authenticated`).
- Produces: gatilho `profiles_guard_protected` (`before insert or update on public.profiles`) com a função `public.profiles_guard_protected()`.
- Produces: policies reescritas com `public.is_admin()`, cada uma só se `to_regclass` da tabela não for nulo (`public.payments`, `public.songs`, `public.stems`, `storage.objects`; a base dos testes SQL não tem `songs` nem `stems`): `"Admin can read all profiles"` (profiles), `"payments_admin_read"` (payments, se a tabela existir), `songs_admin_write`, `stems_admin_write`, `storage_admin_write` (storage.objects, mesmos buckets `covers`, `stems`, `samples`, `loops`); `public.get_admin_dashboard_stats()` recriada com o mesmo corpo de `db/supabase_rpc_setup.sql` e a trava trocada por `if not public.is_admin() then raise exception 'Unauthorized: admin access required' using errcode = '42501'; end if;`.
- Produces: `run-all.sh` com a ordem fixa `ORDER=(db/supabase_admin_papel.sql db/supabase_cota_mensal.sql db/supabase_assinaturas.sql db/supabase_admin_base.sql db/supabase_admin_custos.sql db/supabase_admin_gestao.sql db/supabase_admin_numeros.sql)`: aplica `00-baseline-stubs.sql` e `10-seed.sql`, depois cada arquivo da lista que existir no clone, duas vezes. Sem argumento (portão) roda `20-quota-tests.sql`, `30-billing-tests.sql`, todo `4*-*.sql` em ordem e, no fim, as três corridas reais da cobrança; com argumento (`run-all.sh 43-gestao-tests.sql`) roda só aquele arquivo. Cada `4*` vai com `05-helpers.sql` na frente, na mesma sessão (o `ok` vive em `pg_temp`). Conta os dois formatos de saída (`ok` e `FALHA` dos testes do admin; `NOTICE: ok:`, `FALHOU` e `TODOS_OK` dos da cobrança), imprime `N ok, M falhas` e sai com código diferente de 0 se houver falha. Container com nome por execução (`export PBS_SQL_CONTAINER=pbs-admin-sql-$$`, lido também pelo `psqlt`), imagem `public.ecr.aws/supabase/postgres:17.11.0.011`, sem porta exposta, removido no fim por `trap`; nunca apaga container de outra execução.

Gatilho (algoritmo que os testes não determinam sozinhos; compara por `jsonb` pra funcionar mesmo antes de as colunas da cobrança existirem):

```sql
create or replace function public.profiles_guard_protected() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  k text;
  keys text[] := array['is_admin','blocked_at','blocked_reason','blocked_by','last_seen_at','quota_bonus',
                       'quota_bonus_period','plan','plan_expires_at','tokens_used','tokens_period_start'];
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;   -- backend, SQL Editor e funções security definer
  end if;
  if tg_op = 'INSERT' then
    if coalesce((to_jsonb(new)->>'is_admin')::boolean, false)
       or coalesce(to_jsonb(new)->>'plan', 'free') <> 'free'
       or (to_jsonb(new)->>'blocked_at') is not null
       or coalesce((to_jsonb(new)->>'quota_bonus')::int, 0) <> 0 then
      raise exception 'campo protegido do perfil' using errcode = '42501';
    end if;
    return new;
  end if;
  foreach k in array keys loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception 'campo protegido do perfil: %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
```

Primeiro admin (a única linha com o e-mail): `update public.profiles set is_admin = true where id in (select id from auth.users where lower(email) = 'arynelson11@gmail.com');`. Conferência no fim do arquivo: `select id, email from public.profiles where is_admin;` (espera 1 linha) e a lista de policies e funções que ainda citam o e-mail (`select schemaname, tablename, policyname from pg_policies where coalesce(qual,'') || coalesce(with_check,'') like '%arynelson11@gmail.com%'` e `select proname from pg_proc where prosrc like '%arynelson11@gmail.com%'`; espera 0 policies e nenhuma função além de `user_has_cloud_library`, que o `supabase_assinaturas.sql` troca logo depois, na ordem da D6). Arquivo inteiro em transação, `lock_timeout = '5s'`, `statement_timeout = '60s'`, idempotente.

`user_has_cloud_library()` em `db/supabase_assinaturas.sql` passa a ser:

```sql
select coalesce((select p.plan in ('essencial_mensal','essencial_anual','pro_mensal','pro_anual')
                        and (p.plan_expires_at is null or p.plan_expires_at > now())
                        and p.blocked_at is null
                   from public.profiles p where p.id = auth.uid()), false)
       or public.is_admin();
```

Linha de aviso nos arquivos antigos: `-- SUPERADO: as regras de admin deste arquivo foram trocadas pelo papel profiles.is_admin (db/supabase_admin_papel.sql). Não rodar de novo.`

- [ ] **Step 1: Escrever as verificações** em `40-papel-tests.sql`, cada uma `select ok('<nome>', <expressão booleana>);` (`ok` vem de `05-helpers.sql`, que conta e imprime `ok` ou `FALHA <nome>`). Verificações:
  - `is_admin falso pra anon`, `is_admin falso pra usuário comum` (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid comum>","email":"a@b.com"}'`), `is_admin verdadeiro pro admin semeado`.
  - `usuário comum não se dá is_admin sem policy de update` (o update não muda a linha) e `usuário comum não se dá is_admin nem com policy de update aberta` (cria `create policy tmp_upd on public.profiles for update to authenticated using (id = auth.uid())`, o update falha com `42501`, remove a policy).
  - `usuário comum não muda plan, quota_bonus nem blocked_at` (mesma policy temporária, `42501` em cada um).
  - `insert do usuário com is_admin verdadeiro falha com 42501`.
  - `service_role muda is_admin`.
  - `touch_last_seen grava e não regrava antes de 1 hora` (segunda chamada deixa `last_seen_at` igual).
  - `nuvem: admin sem plano tem acesso`, `nuvem: Pro bloqueado não tem`, `nuvem: Pro com plan_expires_at passado não tem`, `nuvem: Pro tem`.
  - `nenhuma policy cita o e-mail`, `nenhuma função cita o e-mail`.
  - `get_admin_dashboard_stats recusa usuário comum com 42501`, `get_admin_dashboard_stats responde pro admin`.
  - `is_admin_user não executa como authenticated` (`42501`).
  - `migration roda numa base sem songs, stems e payments` (as policies dessas tabelas são puladas).
- [ ] **Step 2: Rodar e ver falhar:** `bash ~/playback-studio-work/admin-sql-tests/run-all.sh > $LOGS/sql.txt 2>&1; tail -5 $LOGS/sql.txt` (sem argumento: a T1 é a única tarefa SQL do lote 1A e mexe no SQL da cobrança, então roda tudo). Esperado: falhas por função inexistente. Se alguma verificação da cópia de `30-billing-tests.sql` depender do e-mail do admin na nuvem, trocar só nessa cópia por um admin com `is_admin = true` e anotar no README.
- [ ] **Step 3: Escrever `db/supabase_admin_papel.sql`** (seções: colunas, funções, gatilho, policies, `get_admin_dashboard_stats`, primeiro admin, conferência) **e a edição de `user_has_cloud_library`**.
- [ ] **Step 4: Rodar de novo.** Esperado: `0 falhas`, inclusive os testes da cobrança (17 da cota e os da cobrança, com as migrations aplicadas duas vezes).
- [ ] **Step 5: Commit**

```bash
git add db/supabase_admin_papel.sql db/supabase_assinaturas.sql db/supabase-setup.sql db/supabase-migration.sql db/supabase_rpc_setup.sql db/supabase_admin_setup.sql db/supabase_payments.sql db/supabase_user_separations_plan_gate.sql
git commit -m "feat(admin): papel de admin no perfil, gatilho que protege papel, bloqueio e cota, regras do banco por is_admin [admin] [T1]"
```

Linha pro FATOS: "Admin é o papel `profiles.is_admin` (o e-mail virou só o primeiro admin); regras do banco e do servidor usam o papel. SQL do lançamento: `supabase_admin_papel.sql` antes de `supabase_cota_mensal.sql`."

### Task 2: Papel e bloqueio lidos do banco no servidor

**Files:**
- Modify: `api/_lib/auth.ts`
- Test: `api/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: colunas `profiles.is_admin` e `profiles.blocked_at` (T1).
- Produces:
  - `export type AuthOk = { ok: true; userId: string; email: string; isAdmin: boolean; blocked: boolean }` (`AuthFail` e `AuthResult` iguais).
  - `export const BLOCKED_MESSAGE = 'Sua conta está bloqueada. Fale com a gente pelo WhatsApp.'`
  - `export async function readProfileFlags(userId: string): Promise<{ isAdmin: boolean; blocked: boolean }>`: cliente com `SUPABASE_SERVICE_ROLE_KEY`, `select('is_admin, blocked_at').eq('id', userId).maybeSingle()`; sem chave, sem linha ou com qualquer erro devolve `{ isAdmin: false, blocked: false }` e registra um aviso sem token nem e-mail.
  - `verifyUser(req)`: igual a hoje até validar o token; depois chama `readProfileFlags` e devolve `isAdmin` e `blocked` do banco. Token inválido não lê o perfil.
  - `verifyAdmin(req)`: igual (403 `'Forbidden: admin required'` quando não é admin).
  - `export async function verifyActiveUser(req): Promise<AuthResult>`: `verifyUser` e, se `blocked`, `{ ok: false, status: 403, error: BLOCKED_MESSAGE }`.
  - A constante `ADMIN_EMAILS` sai do arquivo.

- [ ] **Step 1: Escrever os testes** (`vi.mock('@supabase/supabase-js')` com `createClient(url, key)` devolvendo o cliente de login quando `key` é a chave anônima e um `createBillingDb` quando é a de serviço):
  - `o e-mail do dono com is_admin falso não é admin`: usuário `OWNER` (montado em tempo de execução), perfil `{ is_admin: false }`; `verifyAdmin` devolve `{ ok: false, status: 403 }`.
  - `is_admin verdadeiro no banco é admin, qualquer que seja o e-mail`: `quem@igreja.com`, `{ is_admin: true }`; `verifyAdmin` ok com `isAdmin: true`.
  - `sem chave de serviço não é admin nem bloqueado`.
  - `coluna ausente (42703) não é admin`; `erro de banco não é admin e não bloqueia`.
  - `token inválido responde 401 sem ler o perfil` (nenhuma leitura em `db.reads`).
  - `verifyActiveUser com blocked_at preenchido responde 403 com BLOCKED_MESSAGE`; `verifyActiveUser sem bloqueio passa`.
  - `o arquivo não cita o e-mail do dono`: `readFileSync('api/_lib/auth.ts','utf8')` não contém `OWNER`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/auth.test.ts > $LOGS/t2.txt 2>&1; tail -20 $LOGS/t2.txt`. Esperado: FAIL (`readProfileFlags` e `verifyActiveUser` não existem).
- [ ] **Step 3: Implementar** as funções acima em `api/_lib/auth.ts`.
- [ ] **Step 4: Rodar** este teste e os que importam endpoints com `auth.js`: `npx vitest run api/__tests__/auth.test.ts api/__tests__/separate-audio.test.ts api/__tests__/cancel-subscription.test.ts api/__tests__/checkout-create.test.ts api/__tests__/delete-account.test.ts api/__tests__/dates-brt.test.ts > $LOGS/t2b.txt 2>&1; tail -5 $LOGS/t2b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/auth.ts api/__tests__/auth.test.ts
git commit -m "feat(admin): servidor le o papel de admin e o bloqueio do perfil, sem e-mail escrito a mao [admin] [T2]"
```

### Task 3: Roteador `?action=`, respostas e registro das ações

**Files:**
- Modify: `api/admin-stats.ts` (vira só o roteador)
- Create: `api/_lib/admin/http.ts`, `api/_lib/admin/audit.ts`, `api/_lib/admin/registry.ts`, `api/_lib/admin/legacyStats.ts` (o código de hoje de `asaasStats` e `replicateStats`, movido sem mudar)
- Create (vazios, cada um com `export const handlers: AdminHandlers = {}` e um comentário dizendo a tarefa dona): `api/_lib/admin/review.ts` (T6), `auditList.ts` (T7), `finance.ts` (T14), `overview.ts` (T15), `subscriberActions.ts` (T16), `aiCosts.ts` (T24), `subscribers.ts` (T25)
- Modify: `vercel.json` (acrescenta `"api/admin-stats.ts": { "maxDuration": 30 }`, sem mexer no resto)
- Test: `api/__tests__/admin-router.test.ts`, `api/__tests__/admin-audit.test.ts`, `api/__tests__/functions-limit.test.ts`

**Interfaces:**
- Consumes: `verifyAdmin` (T2), `applyCors`, `asaasFromEnv(5000)`, `BillingError`.
- Produces (`http.ts`):
  - `export type AdminCtx = { db: SupabaseClient; asaas: AsaasApi | null; admin: { userId: string; email: string }; now: Date; query: Record<string, string>; body: Record<string, unknown> }`
  - `export type AdminHandler = { method: 'GET' | 'POST'; run: (ctx: AdminCtx) => Promise<unknown> }`; `export type AdminHandlers = Record<string, AdminHandler>`
  - `export class AdminError extends Error { readonly status: number }` (`constructor(status: number, message: string)`)
  - `export function mergeHandlers(...maps: AdminHandlers[]): AdminHandlers` (lança `Ação repetida no admin: <nome>`)
  - Validadores que lançam `AdminError(400, ...)`: `str(src, key, { label, min?, max?, pattern?, optional? })` (mensagens `Preencha <label>.`, `<Label> precisa ter pelo menos <min> caracteres.`, `<Label> pode ter no máximo <max> caracteres.`, `<Label> está em formato inválido.`), `int(src, key, { label, min, max, optional?, fallback? })` (`<Label> precisa ser um número de <min> a <max>.`), `uuid(src, key, label)`, `oneOf(src, key, values, { label, fallback? })`, `day(src, key, { label, optional? })` (`AAAA-MM-DD` de data real).
  - `export function toHttpError(e: unknown): { status: number; error: string }`: `AdminError` usa `status` e a mensagem; `BillingError` usa `httpStatus` e a mensagem, menos `code = 'db_error'`, que vira `500 'Erro inesperado no servidor.'`; qualquer outro erro também vira esse 500 (a mensagem original só vai pro log).
  - `export function createAdminRouter(handlers: AdminHandlers): (req: any, res: any) => Promise<void>`
- Produces (`audit.ts`):
  - `export type AuditAction = 'resolve_flag' | 'close_action' | 'retry_action' | 'retry_event' | 'change_plan' | 'grant_courtesy' | 'end_courtesy' | 'cancel_subscription' | 'block' | 'unblock' | 'adjust_quota'`
  - `export async function auditStart(ctx: AdminCtx, e: { action: AuditAction; targetUserId?: string | null; targetRef?: string | null; before?: unknown; note?: string | null }): Promise<number>`: `rpc('admin_log_start', { p_admin, p_action, p_target_user, p_target_ref, p_before, p_note })`; erro vira `AdminError(500, 'Não deu pra registrar a ação no histórico, então nada foi feito.')`.
  - `export async function auditFinish(ctx, id: number, result: 'ok' | 'failed' | 'partial', after?: unknown, message?: string | null): Promise<void>`: `rpc('admin_log_finish', { p_id, p_result, p_after, p_message })`; nunca lança (só registra no log).
  - `export async function withAudit<T>(ctx, e, fn: () => Promise<T>, after?: (r: T) => unknown): Promise<T>`: `auditStart`; roda `fn`; sucesso fecha `ok` com `after(r)`; erro fecha `partial` se for `BillingError` com `code === 'partial'`, senão `failed`, com a mensagem, e relança.
- Produces (`registry.ts`): `export const ADMIN_HANDLERS = mergeHandlers(review, auditList, finance, overview, subscriberActions, aiCosts, subscribers)`.
- Roteador: `applyCors(req, res, 'GET,POST,OPTIONS')`; `OPTIONS` 200; `verifyAdmin` (401/403); `Cache-Control: no-store` em toda resposta; com `req.query.source` e método GET chama `legacyStats` (até a T28); sem env do Supabase `500 'Servidor sem configuração do banco.'`; ação desconhecida `400 'Ação desconhecida: <nome>'`; método errado `405 'Esta ação usa <GET|POST>.'`; `ctx.query` só com valores string; `ctx.body` só objeto; resposta 200 com o que `run` devolver.

- [ ] **Step 1: Escrever os testes** (`vi.mock('../_lib/auth.js')` controlando `verifyAdmin`; roteador montado com `createAdminRouter({ ping: { method: 'GET', run }, echo: { method: 'POST', run } })`):
  - `sem token responde 401`, `usuário comum responde 403 e não roda a ação`, `ação desconhecida responde 400 com o nome`, `GET numa ação POST responde 405`, `OPTIONS responde 200`, `toda resposta tem Cache-Control no-store`.
  - `BillingError vira o status e a mensagem dela` (`new BillingError('asaas_unavailable', 'O Asaas não respondeu.', 502)` dá 502), `AdminError(409) vira 409`, `erro qualquer vira 500 sem vazar a mensagem` (corpo `{ error: 'Erro inesperado no servidor.' }`), `BillingError db_error vira 500 sem a mensagem do banco` (`new BillingError('db_error', 'Falha no banco (x): y', 500)` dá `{ error: 'Erro inesperado no servidor.' }`).
  - `?source=asaas continua chamando o painel antigo` (mock de `legacyStats`).
  - `str recusa nota curta com a mensagem certa`: `str({ note: 'ok' }, 'note', { label: 'a nota', min: 3 })` lança `A nota precisa ter pelo menos 3 caracteres.`; `day` recusa `2026-02-30`.
  - `mergeHandlers recusa ação repetida`.
  - Auditoria (`admin-audit.test.ts`): `withAudit grava início e fim ok com o depois`; `BillingError partial fecha como partial e relança`; `erro comum fecha como failed`; `sem conseguir registrar o início a ação não roda` (`fn` não é chamada, 500 com a frase).
  - `functions-limit.test.ts`: `api/ tem exatamente 12 funções` (lista recursiva de `.ts` fora de `_lib` e `__tests__`).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-router.test.ts api/__tests__/admin-audit.test.ts api/__tests__/functions-limit.test.ts > $LOGS/t3.txt 2>&1; tail -20 $LOGS/t3.txt`. Esperado: FAIL nos dois primeiros, PASS no da contagem.
- [ ] **Step 3: Implementar** `http.ts`, `audit.ts`, `registry.ts`, os módulos vazios, o `legacyStats.ts` movido e o roteador em `api/admin-stats.ts` (default export `createAdminRouter(ADMIN_HANDLERS)` com o desvio do `?source=`).
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/admin-stats.ts api/_lib/admin/http.ts api/_lib/admin/audit.ts api/_lib/admin/registry.ts api/_lib/admin/legacyStats.ts api/_lib/admin/review.ts api/_lib/admin/auditList.ts api/_lib/admin/finance.ts api/_lib/admin/overview.ts api/_lib/admin/subscriberActions.ts api/_lib/admin/aiCosts.ts api/_lib/admin/subscribers.ts vercel.json api/__tests__/admin-router.test.ts api/__tests__/admin-audit.test.ts api/__tests__/functions-limit.test.ts
git commit -m "feat(admin): roteador ?action= no admin-stats, validacao em portugues e registro de cada acao [admin] [T3]"
```

### Task 4: Casca do admin na linguagem nova e cliente da API

**Files:**
- Modify: `src/admin/AdminApp.tsx`, `src/admin/AdminShell.tsx`
- Create: `src/admin/lib/adminApi.ts`, `src/admin/lib/fmt.ts`, `src/admin/lib/period.ts`, `src/admin/lib/tabs.ts`, `src/admin/lib/reviewTypes.ts`, `src/admin/hooks/useAdminQuery.ts`, `src/admin/components/ConfirmDialog.tsx`, `src/admin/tabs/ReviewTab.tsx` e `src/admin/tabs/AuditTab.tsx` (os dois só com o texto "Carregando...", donos T8 e T7)
- Rename: `src/admin/tabs/UsersTab.tsx` para `src/admin/tabs/SubscribersTab.tsx` (`git mv`; componente vira `SubscribersTab`, conteúdo igual)
- Modify (só trocar o travessão por `sem dado`): `src/admin/lib/format.ts`, `src/admin/tabs/OverviewTab.tsx`, `FinanceTab.tsx`, `AiCostTab.tsx`, `UsageTab.tsx`, `SubscribersTab.tsx` (os seis arquivos de `src/admin/` que hoje têm o caractere)
- Test: `src/admin/lib/adminApi.test.ts`, `src/admin/lib/fmt.test.ts`, `src/admin/lib/period.test.ts`, `src/admin/components/ConfirmDialog.test.tsx`, `src/admin/AdminApp.test.tsx`, `src/admin/noEmDash.test.ts`

**Interfaces:**
- Consumes: `apiUrl` (`src/lib/api.ts`), `getAuthHeaders` (`src/lib/supabase.ts`), `Button`, `Chip`, `Panel`, `Led` (`src/components/ui`), `PlaybackStudioWordmark`.
- Produces:
  - `adminApi.ts`: `export class AdminApiError extends Error { readonly status: number }`; `export async function adminGet<T>(action: string, params?: Record<string, string | number | undefined>): Promise<T>`; `export async function adminPost<T>(action: string, body: Record<string, unknown>): Promise<T>`. URL `apiUrl('/api/admin-stats?' + new URLSearchParams({ action, ...params sem undefined }))`. Mensagens: 401 `Sua sessão expirou. Entre de novo.`; 403 `Esta conta não é admin.`; falha de rede `Não deu pra falar com o servidor. Confira a internet e tente de novo.`; outro status, o `error` do corpo ou `Erro inesperado (código <N>).`
  - `useAdminQuery.ts`: `export type AdminQueryState<T> = { data: T | null; loading: boolean; error: string | null; refetch: () => Promise<void> }`; `export function useAdminQuery<T>(action: string, params?: Record<string, string | number | undefined>, opts?: { enabled?: boolean }): AdminQueryState<T>` (resposta velha nunca sobrescreve a nova).
  - `fmt.ts`: `EMPTY = 'sem dado'`; `fmtBRL(v: number | null)`; `fmtUSD(v: number | null)` (4 casas abaixo de US$ 0,01); `fmtDay(d: string | null)` (de `AAAA-MM-DD` sem passar por `new Date`); `fmtDateTimeBR(iso: string | null)` (`dd/mm/aaaa hh:mm` em America/Sao_Paulo); `planLabel(key)` (`free` Livre, `essencial_mensal` Pro Mensal, `essencial_anual` Pro Anual, `pro_mensal` Studio Mensal, `pro_anual` Studio Anual); `paymentStatusLabel(status)` (PENDING em aberto, CONFIRMED confirmada, RECEIVED recebida, RECEIVED_IN_CASH recebida em dinheiro, OVERDUE vencida, REFUNDED estornada, REFUND_REQUESTED estorno pedido, REFUND_IN_PROGRESS estorno em andamento, DELETED removida, CHARGEBACK_REQUESTED contestação; outro, o próprio status em minúsculas); `cancelSourceLabel(source)` (user pelo app, user_refund arrependimento, unpaid falta de pagamento, refund estorno, asaas no painel do Asaas, superseded troca de plano, duplicate compra repetida, admin pelo admin, account_deleted conta excluída).
  - `tabs.ts`: `export type AdminTabId = 'review' | 'overview' | 'subscribers' | 'finance' | 'aicost' | 'audit' | 'usage'`; `export type Navigate = (id: AdminTabId, focus?: { userId?: string }) => void`; `export type TabProps = { onNavigate: Navigate; focusUserId: string | null }`; `export const TAB_LABELS: Record<AdminTabId, string>` = Pendências, Visão geral, Assinantes, Financeiro, Custos de IA, Registro, Uso.
  - `period.ts` (dias de Brasília no front, sem passar `AAAA-MM-DD` por `new Date`): `brtTodayLocal(now?: Date): string`; `addDaysLocal(day: string, n: number): string`; `monthRange(day: string, offsetMonths: number): { from: string; to: string }`. Usado por T18, T19 e T26.
  - `reviewTypes.ts`: `ReviewAction`, `ReviewFlag`, `ReviewEvent`, `ReviewQueue` da seção Arquitetura B.
  - `AdminApp({ onClose }: { onClose?: () => void })`: guarda (`useAdminGuard`) igual a hoje; aba ativa começa em `'review'`; ordem das abas no Corte A: Pendências, Visão geral, Assinantes, Financeiro, Custos de IA, Registro, Uso; faz `useAdminQuery<ReviewQueue>('review')` e passa `review` pra `ReviewTab` (`TabProps & { review: AdminQueryState<ReviewQueue> }`); as outras abas ficam numa lista tipada `{ id: AdminTabId; Component: ComponentType<TabProps> }[]` e são montadas com `<Component {...tabProps} />`. As abas antigas, que não têm props, entram nessa lista sem mudar (função com menos parâmetros é aceita pelo tipo), e quem reescreve cada uma (T17 a T20) passa a declarar `TabProps` sem mexer no `AdminApp`. Guarda `focusUserId` vindo do `onNavigate`. As telas de carregando e de acesso negado do guarda são refeitas com `ps-*` (`bg-ps-ink`, texto `text-ps-bone`, aviso em `text-ps-alert`), sem `bg-[#0e0e10]` nem `text-primary`.
  - `AdminShell({ email, tabs, active, onSelect, onClose, onSignOut, reviewCount })`: fundo `bg-ps-ink`, texto `text-ps-bone`, `font-ps-sans`; topo com `PlaybackStudioWordmark size="sm"` e o rótulo `ps-label` "Admin", e-mail em `text-ps-mut`; com `onClose` mostra `Button tone="ghost"` "Voltar ao app", sem ele "Sair"; abas num `role="tablist"` rolável na horizontal, cada uma `Chip` com `role="tab"`, `aria-selected` e `on` na ativa; a de Pendências mostra o número e um `Led state="alert"` quando `reviewCount.manual > 0`; conteúdo com `px-ps-gutter`.
  - `ConfirmDialog({ open, title, children, confirmLabel, tone = 'primary', note, busy, error, onConfirm, onCancel })` com `note?: { label: string; required: boolean; minLength?: number }` e `onConfirm(note: string)`: `Panel variant="pop"` em camada fixa, `role="dialog"`, `aria-modal`, Esc cancela (menos com `busy`), Confirmar desligado com `busy` ou nota inválida, erro mostrado dentro do diálogo em `text-ps-alert`, trava interna contra segundo clique até `busy` voltar a falso ou o diálogo reabrir.

- [ ] **Step 1: Escrever os testes:**
  - `adminApi usa apiUrl (no computador vira https://playbackstudio.com.br/api/...)`: mock de `../../lib/api` com `apiUrl: (p) => 'https://playbackstudio.com.br' + p`; `adminGet('review')` chama `fetch('https://playbackstudio.com.br/api/admin-stats?action=review', { headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } })`.
  - `adminGet monta os parâmetros e descarta undefined`: `adminGet('subscribers', { q: 'ana maria', page: 2, plan: undefined })` chama `...?action=subscribers&q=ana+maria&page=2`.
  - `adminPost manda o corpo em JSON`; `401 vira mensagem de sessão expirada`; `falha de rede vira a mensagem de internet`; `409 usa o erro do servidor` (`{ error: 'Esta marcação já foi conferida.' }`).
  - `monthRange('2026-11-16', -1)` dá `{ from: '2026-10-01', to: '2026-10-31' }`; `brtTodayLocal(new Date('2026-12-01T02:30:00Z'))` dá `2026-11-30`; `addDaysLocal('2026-11-16', 30)` dá `2026-12-16`.
  - `tela de acesso negado não usa text-primary nem bg-[#0e0e10]`.
  - `fmtDay('2026-12-01') mostra 01/12/2026`; `fmtDateTimeBR('2026-12-01T02:30:00Z') mostra 30/11/2026 23:30`; `fmtBRL(1078.8)` dá `R$ 1.078,80` (normalizar `U+00A0` pra espaço); `fmtBRL(null)` dá `sem dado`; `planLabel` dos 5 planos; `paymentStatusLabel('OVERDUE')` dá `vencida`.
  - `dois cliques seguidos em Confirmar chamam onConfirm uma vez`; `Esc cancela`; `com busy Esc não cancela e Confirmar fica desligado`; `nota obrigatória curta desliga Confirmar`; `erro aparece dentro do diálogo`.
  - `com onClose mostra Voltar ao app e chama onClose`; `sem onClose mostra Sair`; `abas na ordem do Corte A`; `a aba Pendências mostra o total vindo de review` (mock de `adminGet` devolvendo `counts: { manual: 2, auto: 1, total: 3 }`).
  - `noEmDash.test.ts`: nenhum arquivo em `src/admin/` contém `TRAVESSAO` (leitura recursiva com `node:fs`).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin > $LOGS/t4.txt 2>&1; tail -20 $LOGS/t4.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar** os arquivos acima, renomear a aba e trocar os travessões.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git mv src/admin/tabs/UsersTab.tsx src/admin/tabs/SubscribersTab.tsx
git add src/admin/AdminApp.tsx src/admin/AdminShell.tsx src/admin/lib/adminApi.ts src/admin/lib/fmt.ts src/admin/lib/period.ts src/admin/lib/tabs.ts src/admin/lib/reviewTypes.ts src/admin/hooks/useAdminQuery.ts src/admin/components/ConfirmDialog.tsx src/admin/tabs/ReviewTab.tsx src/admin/tabs/AuditTab.tsx src/admin/tabs/SubscribersTab.tsx src/admin/lib/format.ts src/admin/tabs/OverviewTab.tsx src/admin/tabs/FinanceTab.tsx src/admin/tabs/AiCostTab.tsx src/admin/tabs/UsageTab.tsx src/admin/lib/adminApi.test.ts src/admin/lib/fmt.test.ts src/admin/lib/period.test.ts src/admin/components/ConfirmDialog.test.tsx src/admin/AdminApp.test.tsx src/admin/noEmDash.test.ts
git commit -m "feat(admin): casca do admin na linguagem nova, cliente da API pelo apiUrl e confirmacao com trava [admin] [T4]"
```

## Onda 1, lote 1B: telas do Corte A

### Task 5: SQL do registro e da fila de pendências

**Files:**
- Create: `db/supabase_admin_base.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/41-base-tests.sql`

**Interfaces:**
- Consumes: `public.is_admin_user` (T1); `billing_subscriptions`, `billing_pending_actions`, `asaas_webhook_events` (Fase 3).
- Produces (tabela, RLS ligada, `revoke all ... from anon, authenticated`):

```sql
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  admin_id       uuid,                -- sem chave estrangeira (ADM-B2): excluir a conta nunca esbarra no registro
  admin_email    text not null,       -- copiado na hora
  action         text not null check (action in ('resolve_flag','close_action','retry_action','retry_event','change_plan',
                   'grant_courtesy','end_courtesy','cancel_subscription','block','unblock','adjust_quota')),
  target_user_id uuid,                -- sem chave estrangeira (ADM-B2)
  target_email   text,                -- copiado na hora; fica depois da exclusão da conta
  target_ref     text,
  before         jsonb,
  after          jsonb,
  result         text not null check (result in ('pending','ok','failed','partial')),
  message        text,
  note           text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_user_id, created_at desc);
```

- Produces: gatilho `admin_audit_append_only` (`before update or delete`): `delete` sempre recusa (`42501`); `update` só se `old.result = 'pending'`, `new.result` em `ok`/`failed`/`partial` e só mudarem `result`, `after`, `message` e `finished_at`.
- Produces (funções, só `service_role`; as que recebem `p_admin` recusam com `42501` se `not public.is_admin_user(p_admin)`; e-mails tirados de `auth.users` na hora):
  - `admin_audit_insert(p_admin uuid, p_action text, p_target_user uuid, p_target_ref text, p_before jsonb, p_after jsonb, p_result text, p_note text) returns bigint` (interna: `revoke execute ... from public, anon, authenticated, service_role`; só as outras funções `admin_*` a chamam, na mesma transação).
  - `admin_log_start(p_admin uuid, p_action text, p_target_user uuid, p_target_ref text, p_before jsonb, p_note text) returns bigint` (grava `pending`).
  - `admin_log_finish(p_id bigint, p_result text, p_after jsonb, p_message text) returns void`.
  - `admin_review_queue() returns jsonb` no formato `ReviewQueue`: ações `billing_pending_actions` com `status = 'pending'` (manuais primeiro, depois por `created_at`), com e-mail e `planKey` da assinatura; flags `billing_subscriptions` com `needs_admin_review` (mais recentes primeiro); eventos `asaas_webhook_events` com status `failed` ou `exhausted`, ou `pending` recebido há mais de 10 minutos (100 mais recentes); `counts` como na seção B; `generatedAt = now()`.
  - `admin_resolve_flag(p_admin uuid, p_subscription_ref text, p_note text) returns text`: `not_found`, `not_flagged` (sem novo registro) ou `resolved` (grava `needs_admin_review = false`, acrescenta ao `admin_note` com ` | ` o texto `conferido pelo admin em DD/MM/AAAA: <nota>` e o registro `resolve_flag` com antes e depois, tudo na mesma transação).
  - `admin_close_action(p_admin uuid, p_action_id bigint, p_outcome text, p_note text) returns text`: `not_open` se não está `pending`; `not_allowed` pra `delete_subscription` e `inactivate_subscription`, e pra `canceled` em qualquer ação fora de `refund_payment` e `admin_review`; senão `closed` (`status = 'done'` ou `'canceled'`, `done_at = now()`, `done_note = 'admin: ' || p_note`) e o registro `close_action` na mesma transação.
  - `admin_reset_event(p_admin uuid, p_event_id text) returns text`: `not_found`, `already_done` ou `reset` (`status = 'failed'`, `attempts = 0`, `last_error = 'reiniciado pelo admin'`).
  - `admin_audit_list(p_limit int, p_offset int, p_target uuid default null) returns jsonb`: `{ total, rows: AuditEntry[] }`, mais novos primeiro.
- Conferência no fim: a tabela, o gatilho e as 7 funções existem; `authenticated` não executa nenhuma `admin_*`.

- [ ] **Step 1: Escrever as verificações** em `41-base-tests.sql`:
  - `registro não deixa apagar`, `registro fechado não muda`, `registro pendente fecha uma vez` (a segunda mudança falha).
  - `excluir a conta de quem está no registro funciona e a linha fica com o e-mail` (apagar o login do alvo em `auth.users`, como faz `api/delete-account.ts`); `excluir um admin que agiu funciona e a linha fica`.
  - `admin_log_start recusa quem não é admin com 42501`.
  - `fila traz ação pendente com e-mail e plano`, `fila não traz ação feita`, `fila traz assinatura marcada`, `fila traz evento esgotado e evento parado há 11 minutos`, `fila não traz evento pendente de 5 minutos`, `contagem manual e automática` (2 manuais, 1 flag, 1 esgotado, 2 automáticas e 1 falhado dão `manual = 4`, `auto = 3`, `total = 7`).
  - `conferir tira a marcação, acrescenta a nota e grava o registro na mesma chamada`; `conferir de novo responde not_flagged e não grava outro registro`.
  - `marcação nova da conferência diária volta a aparecer depois de conferida` (`billing_flag_review` com texto novo põe `needs_admin_review` de volta em verdadeiro).
  - `fechar estorno como feito grava done e admin: nota`; `fechar inativação responde not_allowed e não muda nada`; `fechar ação já feita responde not_open`; `descartar remoção de cobrança futura responde not_allowed`.
  - `reiniciar evento esgotado zera as tentativas`; `reiniciar evento feito responde already_done`.
  - `lista do registro pagina e filtra por conta`.
  - `authenticated não executa admin_review_queue nem admin_resolve_flag` (`42501`).
- [ ] **Step 2: Rodar e ver falhar:** `bash ~/playback-studio-work/admin-sql-tests/run-all.sh 41-base-tests.sql > $LOGS/sql41.txt 2>&1; tail -5 $LOGS/sql41.txt`. Esperado: falhas no `41-base-tests.sql`.
- [ ] **Step 3: Escrever `db/supabase_admin_base.sql`** (em transação, idempotente, `lock_timeout = '5s'`, `statement_timeout = '60s'`).
- [ ] **Step 4: Rodar de novo** o mesmo comando. Esperado: `0 falhas` (com a migration aplicada duas vezes).
- [ ] **Step 5: Commit**

```bash
git add db/supabase_admin_base.sql
git commit -m "feat(admin): registro das acoes que so aceita inserir e fechar, fila de pendencias e conferencias no banco [admin] [T5]"
```

### Task 6: Servidor das pendências

**Files:**
- Modify: `api/_lib/admin/review.ts`
- Test: `api/__tests__/admin-review.test.ts`, `api/__tests__/admin-registry.test.ts` (nasce aqui, ADM-ordem)

**Interfaces:**
- Consumes: `AdminHandlers`, validadores, `AdminError` (T3); `withAudit` e `ADMIN_HANDLERS` (T3); `getPayment`, `getSubscription`, `listSubscriptionPayments`, `AsaasError` (`api/_lib/asaas.ts`); `runPendingActions`, `processStoredEvent`, `brtToday`, `toBrtDate` (`api/_lib/billing.ts`); funções SQL da T5.
- Produces: `export const handlers: AdminHandlers` com `review`, `payment-link`, `resolve-flag`, `close-action`, `retry-action`, `retry-event` (contrato da seção A). Também `export function futurePendingCharges(payments: AsaasPayment[], keep: { paymentId: string | null; cycleDue: string | null }, today: string): AsaasPayment[]`, com as mesmas três condições de `removeFuturePendingCharges` (`api/_lib/asaas.ts`): em aberto (`PENDING`, sem `deleted`), vencimento depois de `today`, e fora do id guardado e fora do ciclo cortado (`originalDueDate`, senão `dueDate`, igual a `cycleDue`). E `export function paymentStatusName(status: string): string`, cópia no servidor da tabela de `paymentStatusLabel` (T4).
- Regras:
  - `resolve-flag`: `subscriptionRef` até 200, `note` de 3 a 500 (`label: 'a nota'`); `not_found` 404 `Marcação não encontrada.`; `not_flagged` 409 `Esta marcação já foi conferida.`.
  - `close-action`: lê a ação (`billing_pending_actions` por id).
    - Inativar ou remover assinatura: 409 `Esta pendência se resolve sozinha quando o Asaas confirmar. Use Tentar agora.`
    - `canceled` só vale pra `refund_payment` e `admin_review` e não consulta o Asaas (menos no caso `asaas:` abaixo); nas outras ações, 409 `Só estorno e caso pra olhar podem ser descartados.` (o mesmo pro `not_allowed` do SQL).
    - `done` em `refund_payment`: `getPayment` precisa vir com status `REFUNDED`, `REFUND_REQUESTED` ou `REFUND_IN_PROGRESS`; outro status, 409 `O Asaas mostra a cobrança <id> como <paymentStatusName>. Estorne no painel do Asaas antes de marcar como feito.`; `null` (404 do Asaas), 409 `O Asaas não achou a cobrança <id>.`
    - `done` em `delete_future_payments`: lista as cobranças da assinatura (`asaas_subscription_id` da ação, ou o da linha em `billing_subscriptions`) com `listSubscriptionPayments` e exige `futurePendingCharges(payments, { paymentId: asaas_payment_id, cycleDue: due_date }, brtToday(now))` vazio; senão 409 `Ainda há cobrança futura em aberto no Asaas: <ids separados por vírgula>. Remova no painel antes de marcar como feito.`
    - `done` ou `canceled` em `admin_review` com `subscription_ref` começando por `asaas:` (caso da conferência diária: assinatura ativa no Asaas sem registro no app): `getSubscription` do id depois do prefixo; se está `ACTIVE` e não removida, 409 `O Asaas ainda cobra esta assinatura. Pare a cobrança no painel do Asaas antes de fechar.` (esse caso nunca volta a ser criado depois de fechado, regra Q12 da cobrança).
    - Asaas fora (`AsaasError`): 502 `Não deu pra conferir no Asaas agora. Nada foi marcado.`; `not_open`: 409 `Esta pendência já foi fechada.`.
  - `retry-action`: só `pending` com `auto_retry`, senão 409 `Esta pendência não é tentada sozinha.`; `withAudit({ action: 'retry_action', targetRef: String(id) })` em volta de `runPendingActions(deps, { ids: [id], limit: 1 })`; relê e devolve `{ status, attempts, lastError }`.
  - `retry-event`: `withAudit({ action: 'retry_event', targetRef: eventId })`; `admin_reset_event` (`already_done` 409 `Este aviso já foi processado.`, `not_found` 404); lê o `payload` e chama `processStoredEvent(deps, id, payload, 0)`; devolve `{ processed: ok, result }`.
  - `payment-link`: `id` com `/^pay_[A-Za-z0-9]+$/` (`label: 'o id da cobrança'`); `getPayment`; devolve `{ paymentId, status, invoiceUrl }` (`invoiceUrl` do objeto do Asaas, ou `null`); `getPayment` nulo, 404 `O Asaas não achou a cobrança <id>.`; Asaas fora 502 `O Asaas não respondeu agora.`.
  - Nenhum caminho chama estorno no Asaas.
  - `api/__tests__/admin-registry.test.ts`: percorre `Object.keys(ADMIN_HANDLERS)` com o método de cada ação e espera 403 pra usuário comum em todas, sem rodar nenhuma `run`; nesta tarefa confere que as 6 ações da T6 estão na lista (a T7 acrescenta `audit` no mesmo lote, e a T28 fixa a lista exata das 20).

- [ ] **Step 1: Escrever os testes** (`createBillingDb`, `createFakeAsaas`, `db.setRpc` pras funções da T5, hora fixa `2026-11-16T15:00:00Z`):
  - `GET review repassa a fila`.
  - `conferir com nota curta responde 400`; `conferir já conferida responde 409`.
  - `estorno marcado como feito com a cobrança CONFIRMED no Asaas responde 409 com "confirmada" e não fecha` (`admin_close_action` não chamada); `com REFUNDED fecha`; `getPayment nulo responde 409 sem fechar`.
  - `remoção marcada como feita com pay_9 PENDING vencendo 2026-12-16 responde 409 citando pay_9`; `só com a vencida protegida em aberto fecha`.
  - `cobrança do ciclo cortado adiada pro futuro não é cobrada do admin` (`pay_8` em aberto com `originalDueDate` igual ao `due_date` da pendência e vencimento novo em 2026-12-20: fecha).
  - `inativação não fecha à mão`; `descartar remoção de cobrança futura responde 409`.
  - `caso asaas: com a assinatura ACTIVE no Asaas não fecha` (nem como feito nem descartado); `caso asaas: com a assinatura removida fecha`.
  - `todas as ações registradas respondem 403 pra usuário comum` (`admin-registry.test.ts`).
  - `Asaas fora na conferência: 502 e nada marcado`.
  - `tentar agora chama runPendingActions com ids [7] e devolve o novo estado`; `tentar agora em pendência manual responde 409`.
  - `reprocessar evento esgotado zera e processa`; `reprocessar evento feito responde 409`.
  - `payment-link recusa id fora do padrão e devolve a fatura`.
  - `nenhuma ação estorna`: em todos os testes, `asaas.post` nunca recebe caminho com `/refund`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-review.test.ts api/__tests__/admin-registry.test.ts > $LOGS/t6.txt 2>&1; tail -20 $LOGS/t6.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar** os handlers em `api/_lib/admin/review.ts`.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/review.ts api/__tests__/admin-review.test.ts api/__tests__/admin-registry.test.ts
git commit -m "feat(admin): pendencias no servidor, conferindo no Asaas antes de marcar estorno ou remocao como feitos [admin] [T6]"
```

Linha pro FATOS: "Pendências: o admin confere marcações, fecha estornos e casos pra olhar (o servidor confere no Asaas antes), tenta de novo pendências e avisos do Asaas que falharam; inativar e remover assinatura só fecham pelo Asaas."

### Task 7: Registro (servidor e tela)

**Files:**
- Modify: `api/_lib/admin/auditList.ts`, `src/admin/tabs/AuditTab.tsx`
- Create: `src/admin/lib/auditTypes.ts`, `src/admin/lib/auditText.ts`
- Test: `api/__tests__/admin-audit-list.test.ts`, `src/admin/lib/auditText.test.ts`, `src/admin/tabs/AuditTab.test.tsx`

**Interfaces:**
- Consumes: T3 (`AdminHandlers`, `int`, `uuid`); `admin_audit_list` (T5); T4 (`useAdminQuery`, `fmtDateTimeBR`, `TabProps`, `Panel`, `Chip`).
- Produces: handler `audit` (GET, `page` de 1 a 1000, `userId` opcional) chamando `rpc('admin_audit_list', { p_limit: 50, p_offset, p_target })` e devolvendo `AuditPage`. `auditText.ts`: `actionLabel(action)` (resolve_flag conferiu marcação, close_action fechou pendência, retry_action tentou pendência de novo, retry_event reprocessou aviso do Asaas, change_plan mudou o plano, grant_courtesy deu cortesia, end_courtesy encerrou cortesia, cancel_subscription cancelou a assinatura, block bloqueou, unblock desbloqueou, adjust_quota ajustou a cota) e `resultLabel(result)` (ok feito, failed falhou, partial em parte, pending sem confirmação). `AuditTab(props: TabProps & { userId?: string })`: lista com data e hora, admin, ação, conta (e-mail, ou a referência), resultado num `Chip small` (`on` só em "feito"; "falhou" e "em parte" em `text-ps-alert`), mensagem; "Ver antes e depois" mostra os dois JSON em `ps-num`; paginação "Anteriores" e "Mais novos".

- [ ] **Step 1: Escrever os testes:** `página 2 pede p_offset 50`; `userId inválido responde 400`; `actionLabel e resultLabel de todos os valores`; `a tela mostra sem confirmação pro pendente`; `Ver antes e depois abre os dois JSON`; `sem registros mostra Nenhuma ação registrada ainda.`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-audit-list.test.ts src/admin/lib/auditText.test.ts src/admin/tabs/AuditTab.test.tsx > $LOGS/t7.txt 2>&1; tail -20 $LOGS/t7.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/auditList.ts src/admin/tabs/AuditTab.tsx src/admin/lib/auditTypes.ts src/admin/lib/auditText.ts api/__tests__/admin-audit-list.test.ts src/admin/lib/auditText.test.ts src/admin/tabs/AuditTab.test.tsx
git commit -m "feat(admin): aba Registro com quem fez o que, quando, antes e depois [admin] [T7]"
```

### Task 8: Tela de Pendências

**Files:**
- Modify: `src/admin/tabs/ReviewTab.tsx`
- Create: `src/admin/lib/reviewText.ts`
- Test: `src/admin/lib/reviewText.test.ts`, `src/admin/tabs/ReviewTab.test.tsx`

**Interfaces:**
- Consumes: `ReviewQueue` e tipos (`src/admin/lib/reviewTypes.ts`, T4); `AdminQueryState`, `adminPost`, `adminGet`, `ConfirmDialog`, `fmt*`, `TabProps` (T4); `openExternalUrl` (`src/lib/desktop.ts`); ações `resolve-flag`, `close-action`, `retry-action`, `retry-event`, `payment-link` (T6).
- Produces: `reviewText.ts`: `actionTitle(action)` (refund_payment Estornar à mão, admin_review Caso pra olhar, delete_future_payments Remover cobrança futura, inactivate_subscription Inativar assinatura no Asaas, delete_subscription Remover assinatura no Asaas); `reasonText(reason)` (estorno_recusado_pelo_asaas: O Asaas recusou o estorno automático do arrependimento; arrependimento_pedido_nao_e_a_primeira_assinatura: Arrependimento pedido numa assinatura que não é a primeira da conta; rede_de_seguranca: Renovação passou do vencimento sem aviso do Asaas; vencida: Renovação vencida; estorno: Estorno feito no painel; os valores de `cancel_source` (`user`, `user_refund`, `unpaid`, `refund`, `asaas`, `superseded`, `duplicate`, `admin`, `account_deleted`) por `cancelSourceLabel` da T4; compra_duplicada: Compra repetida do mesmo plano, só como legado, porque a cobrança não gera mais esse motivo; qualquer outro, o texto com `_` trocado por espaço); `noteLines(adminNote)` (divide por ` | `, descarta vazios); `eventTitle(event)` (`Aviso do Asaas que falhou: <EVENTO>`). `ReviewTab(props: TabProps & { review: AdminQueryState<ReviewQueue> })`.
- Tela:
  - Topo: "Atualizado às hh:mm" e `Button` "Atualizar"; a regra do FATOS numa linha `text-ps-mut`: "Antes de estornar à mão, confira no Asaas se a cobrança já não está estornada."
  - Grupo "Precisa de você" (ações manuais, marcações, avisos esgotados), com `Led state="alert"` no título quando tem item; grupo "Tentando sozinho" (ações automáticas e avisos que falharam), com tentativas, último erro e próxima tentativa.
  - Cada item num `Panel`: título, e-mail (clicável: `onNavigate('subscribers', { userId })`), plano, valor e vencimento quando houver, motivo, as linhas da nota.
  - Botões por tipo: estorno ("Ver no Asaas", "Copiar id" com `navigator.clipboard.writeText`, "Já estornei no Asaas", "Não vou estornar"); caso pra olhar ("Conferido"); remoção de cobrança futura ("Já removi no Asaas", "Tentar agora"); inativar ou remover assinatura ("Tentar agora"); marcação ("Conferido"); aviso ("Tentar de novo").
  - "Conferido", "Não vou estornar" e "Já..." abrem `ConfirmDialog` com nota obrigatória de pelo menos 3 caracteres; o "Conferido" de caso pra olhar avisa no diálogo `Este caso não volta a aparecer depois de fechado.`; o erro do servidor aparece dentro do diálogo; ao dar certo, fecha e chama `review.refetch()`.
  - Vazio: "Nada pendente agora." (sem afirmar uma conferência que pode não ter rodado).

- [ ] **Step 1: Escrever os testes:**
  - `reasonText conhece os motivos da cobrança e troca sublinhado por espaço no resto`; `reasonText traduz vencida, estorno e os motivos de cancel_source` (`duplicate` vira `compra repetida`); `noteLines divide por barra`.
  - `Copiar id copia o id da cobrança do estorno`; `Conferido de caso pra olhar avisa que não volta`.
  - `separa Precisa de você de Tentando sozinho` (fila com 1 estorno manual, 1 inativação automática, 1 marcação).
  - `Já estornei no Asaas manda close-action com outcome done e a nota` (`adminPost` chamado com `('close-action', { actionId: 7, outcome: 'done', note: 'estornei hoje' })`).
  - `o 409 do servidor aparece dentro do diálogo e nada fecha`.
  - `Conferido numa marcação manda resolve-flag com subscriptionRef`.
  - `Ver no Asaas pede payment-link e abre a fatura` (`openExternalUrl` chamado com a `invoiceUrl`).
  - `fila vazia mostra Nada pendente agora.`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/lib/reviewText.test.ts src/admin/tabs/ReviewTab.test.tsx > $LOGS/t8.txt 2>&1; tail -20 $LOGS/t8.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/tabs/ReviewTab.tsx src/admin/lib/reviewText.ts src/admin/lib/reviewText.test.ts src/admin/tabs/ReviewTab.test.tsx
git commit -m "feat(admin): aba Pendencias com o que precisa do dono e o que esta tentando sozinho [admin] [T8]"
```

Linha pro FATOS: "As marcações e pendências da cobrança (inclusive as da conferência diária) aparecem na aba Pendências do admin."

### Task 9: Entrada pelo app e papel no cliente

**Files:**
- Create: `src/lib/profileFlags.ts`, `src/components/AdminEntryButton.tsx`
- Delete: `src/lib/admin.ts`
- Modify: `src/hooks/useAuth.ts`, `src/admin/hooks/useAdminGuard.ts`, `src/App.tsx`, `src/components/LibraryModal.tsx`, `src/components/SeparatorStudio.tsx`, `src/components/SettingsModal.tsx`, `src/hooks/useSeparationLibrary.ts` (ADM-B1)
- Test: `src/lib/profileFlags.test.ts`, `src/components/AdminEntryButton.test.tsx`, `src/admin/hooks/useAdminGuard.test.ts`, `src/adminEntry.test.ts`

**Interfaces:**
- Consumes: colunas da T1 e `touch_last_seen()`; `AdminApp({ onClose })` (T4).
- Produces:
  - `profileFlags.ts`: `export type ProfileFlags = { isAdmin: boolean; blockedAt: string | null }`; `export async function fetchProfileFlags(userId: string): Promise<ProfileFlags>` (`select('is_admin, blocked_at').eq('id', userId).maybeSingle()`; erro ou coluna ausente dá `{ isAdmin: false, blockedAt: null }`); `export function touchLastSeen(): void` (`rpc('touch_last_seen')`, sem esperar, erro ignorado; trava de módulo `let touched = false`, então roda uma vez por abertura do app mesmo com várias instâncias do `useAuth`).
  - `useAuth()` passa a devolver também `isAdmin: boolean` e `blockedAt: string | null`, buscados junto com o plano (`Promise.all` antes de `setLoading(false)`, então `loading` cobre os dois); `touchLastSeen()` uma vez por sessão aberta.
  - `useAdminGuard()` decide por `isAdmin` (nunca pelo e-mail).
  - `AdminEntryButton({ isAdmin, variant, onOpen }: { isAdmin: boolean; variant: 'toolbar' | 'drawer'; onOpen: () => void })`: não renderiza nada sem `isAdmin`; `toolbar` com as classes e o ícone `Shield` do botão de hoje (texto ADMIN), `drawer` como o item do menu de hoje (texto Admin).
  - `App.tsx`: `const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false)`; logo depois do `if (isSeparatorOpen) return ...`, `if (isAdminPanelOpen && isAdmin) return <Suspense fallback={...}><AdminApp onClose={() => setIsAdminPanelOpen(false)} /></Suspense>`; os dois botões que faziam `window.location.href = '/admin'` viram `<AdminEntryButton ... onOpen={() => { setIsAdminPanelOpen(true); setIsMobileDrawerOpen(false) }} />`; todo `isAdminEmail(user?.email)` vira `isAdmin`; a rota `/admin` da web continua como está. O estado `isAdminOpen` (modal de envio de músicas) não muda.
  - Os quatro outros arquivos que importam `isAdminEmail` (`src/components/LibraryModal.tsx`, `src/components/SeparatorStudio.tsx`, `src/components/SettingsModal.tsx`, `src/hooks/useSeparationLibrary.ts`) passam a usar `const { isAdmin } = useAuth()` (todos já chamam `useAuth()`) no lugar de `isAdminEmail(user?.email)`, sem outra mudança.

- [ ] **Step 1: Escrever os testes:**
  - `fetchProfileFlags devolve o papel e o bloqueio`; `coluna ausente devolve não admin`.
  - `useAdminGuard nega quem tem o e-mail do dono e is_admin falso` (e-mail `OWNER` montado em tempo de execução).
  - `touchLastSeen chama o banco uma vez só` (duas chamadas, um `rpc`).
  - `AdminEntryButton não aparece pra quem não é admin`; `o clique chama onOpen e não mexe no endereço` (`window.location.href` igual antes e depois).
  - `adminEntry.test.ts` (lê os arquivos): `App.tsx não abre o admin por endereço` (sem `window.location.href = '/admin'`); `nada em src/ cita isAdminEmail nem ADMIN_EMAILS` (nomes montados em tempo de execução, varredura pulando `*.test.ts` e `*.test.tsx`); `src/lib/admin.ts não existe`; `nada em src/ contém o e-mail do dono` (`OWNER`, o e-mail inteiro: o nome de usuário do GitHub em `DownloadPage.tsx` não conta).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/lib/profileFlags.test.ts src/components/AdminEntryButton.test.tsx src/admin/hooks/useAdminGuard.test.ts src/adminEntry.test.ts > $LOGS/t9.txt 2>&1; tail -20 $LOGS/t9.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo** e também `npm run typecheck > $LOGS/t9tc.txt 2>&1; tail -5 $LOGS/t9tc.txt`. Esperado: PASS e tipos ok.
- [ ] **Step 5: Commit**

```bash
git rm src/lib/admin.ts
git add src/lib/profileFlags.ts src/components/AdminEntryButton.tsx src/hooks/useAuth.ts src/admin/hooks/useAdminGuard.ts src/App.tsx src/components/LibraryModal.tsx src/components/SeparatorStudio.tsx src/components/SettingsModal.tsx src/hooks/useSeparationLibrary.ts src/lib/profileFlags.test.ts src/components/AdminEntryButton.test.tsx src/admin/hooks/useAdminGuard.test.ts src/adminEntry.test.ts
git commit -m "feat(admin): admin abre dentro do app, botao ADMIN so pra quem tem o papel, sem e-mail no front [admin] [T9]"
```

Linha pro FATOS: "O admin abre dentro do app (web e computador) pelo botão ADMIN, que só aparece pra quem tem o papel de admin; na web `playbackstudio.com.br/admin` continua funcionando."

### Portão A e publicação junto com a cobrança (ordem da Ruling ADM-ordem)

- [ ] Portão completo verde (seção "Regras de execução paralela"), com `run-all.sh` sem argumento rodando `supabase_admin_papel.sql`, a cota, a cobrança e `supabase_admin_base.sql`, e o `admin-registry.test.ts` da T6 passando.
- [ ] Revisão do lote (fresca) sobre o diff da Onda 1, com foco nos itens 1, 2 e 5 do Review Focus.
- [ ] Coordenador aplica as Linhas pro FATOS da Onda 1 e junta os passos do Corte A (seção "Publicação") aos passos de lançamento da cobrança.
- [ ] **1. SQL na produção, com OK explícito do dono** (passo 1 do Corte A na seção "Publicação"). O SQL do Corte A é compatível com o código que está no ar: acrescenta colunas, tabelas e funções e marca o primeiro admin, e as regras novas reconhecem o dono pelo papel.
- [ ] **2. Prévia na web** (preview da Vercel, que usa o Supabase de produção): entrar com a conta admin, tocar ADMIN, ver Pendências e Registro, voltar ao app; numa conta comum, o botão não aparece. A prévia não pode ser no app de computador: ele sempre chama a API de produção, que ainda não tem o roteador novo.
- [ ] **3. Publicação** pelo @devops junto com a Fase 3 (COB-ORDEM), a partir do commit do Portão A (web, Mac e Windows juntos).
- [ ] **4. Conferência no app de computador**, depois de publicar: tocar ADMIN, ver Pendências e Registro, voltar ao app.

## Onda 2

### Task 10: SQL do custo por trabalho e do câmbio

**Files:**
- Create: `db/supabase_admin_custos.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/42-custos-tests.sql`

**Interfaces:**
- Produces (colunas em `public.predictions`, `add column if not exists`): `model text`; `version text`; `stem_count smallint check (stem_count in (2, 4, 6))`; `status text check (status in ('starting','processing','succeeded','failed','canceled','unknown'))`; `predict_seconds numeric(10, 3)`; `hardware text`; `usd_per_second numeric(12, 8)`; `cost_usd numeric(12, 6)`; `fx_usd_brl numeric(10, 4)`; `fx_date date`; `cost_brl numeric(12, 4)`; `completed_at timestamptz`; `cost_recorded_at timestamptz`. Índices `predictions_created_idx (created_at)` e `predictions_cost_pending_idx (created_at) where cost_recorded_at is null`.
- Produces: `predictions.user_id` passa a aceitar nulo e a chave pra `auth.users` vira `on delete set null` (o mesmo bloco `do $$` que a cobrança usou em `payments`), pra excluir a conta não apagar o custo de IA de meses passados (D24).
- Produces: `create table if not exists public.fx_rates (rate_date date primary key, usd_brl numeric(10, 4) not null check (usd_brl > 0), source text not null default 'bcb_ptax_venda', fetched_at timestamptz not null default now())`, RLS ligada, `revoke all ... from anon, authenticated`.
- Produces: `public.admin_ai_costs(p_from date, p_to date, p_limit int, p_offset int) returns jsonb` no formato `AiCosts` (sem os campos do servidor). Regras: período em dias de Brasília (seção C); `withoutCost` = trabalhos sem custo pela regra da seção C (`cost_recorded_at`, `cost_usd` ou `cost_brl` nulo); `costUsd` e `costBrl` somam só os que têm valor; `avgBrlPerSucceeded` = soma do `cost_brl` dos `succeeded` com custo dividida pela quantidade deles (nulo se 0); `unknown` conta `status = 'unknown'`; `byUser` os 50 de maior `costBrl` (conta excluída aparece com `userId` e `email` nulos); `byModel` agrupado por `model` e `stem_count`; `fx` com o menor e o maior `fx_date` do período; `rows` mais novos primeiro.
- Conferência no fim: as 13 colunas e a tabela existem.

- [ ] **Step 1: Escrever as verificações:** `trabalho de 2026-12-01T02:30Z conta em novembro`; `trabalho de 2026-11-01T02:59Z conta em outubro`; `sem custo conta à parte e fica fora da soma`; `média só dos concluídos com custo`; `por pessoa em ordem de custo`; `por modelo e número de faixas`; `fx traz a menor e a maior data`; `paginação e total`; `trabalho com dólar e sem real conta como sem custo`; `excluir a conta deixa o trabalho com user_id nulo e o custo no mês`; `authenticated não lê fx_rates nem executa admin_ai_costs`; `migration aplicada duas vezes sem erro`.
- [ ] **Step 2: Rodar e ver falhar:** `bash ~/playback-studio-work/admin-sql-tests/run-all.sh 42-custos-tests.sql > $LOGS/sql42.txt 2>&1; tail -5 $LOGS/sql42.txt`. Esperado: falhas no `42-custos-tests.sql`.
- [ ] **Step 3: Escrever a migration.**
- [ ] **Step 4: Rodar de novo** o mesmo comando. Esperado: `0 falhas`.
- [ ] **Step 5: Commit**

```bash
git add db/supabase_admin_custos.sql
git commit -m "feat(admin): custo de IA por trabalho na tabela predictions e tabela de cambio do dia [admin] [T10]"
```

### Task 11: Câmbio do dia

**Files:**
- Create: `api/_lib/fx.ts`
- Test: `api/__tests__/fx.test.ts`

**Interfaces:**
- Consumes: `fx_rates` (T10); `brtToday`, `addDays` (`api/_lib/billing.ts`).
- Produces:
  - `export type FxRate = { rate: number; date: string; stale: boolean }` (`stale` = veio do último guardado porque a consulta falhou).
  - `export function ptaxPeriodUrl(from: string, to: string): string`: `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='MM-DD-AAAA'&@dataFinalCotacao='MM-DD-AAAA'&$format=json&$select=cotacaoVenda,dataHoraCotacao`.
  - `export async function getUsdBrl(db: SupabaseClient, deps: { now: Date; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<FxRate | null>`. Algoritmo: `today = brtToday(now)`; lê a linha mais recente com `rate_date <= today`; se ela foi buscada há menos de 6 horas, devolve sem consultar; senão consulta `ptaxPeriodUrl(addDays(today, -7), today)` com `AbortController` (3000 ms por padrão), ignora cotação com `cotacaoVenda <= 0`, grava cada dia devolvido em `fx_rates` (upsert por `rate_date`, `rate_date` = 10 primeiros caracteres de `dataHoraCotacao`) e devolve a mais recente com `stale: false`; se a consulta falhar ou vier vazia, devolve a última guardada (de qualquer idade) com `stale: true`; sem nada guardado, `null`. Nunca lança.
  - `export async function getStoredUsdBrl(db: SupabaseClient, now: Date): Promise<FxRate | null>`: só lê a linha mais recente com `rate_date <= today`, sem consultar o Banco Central (`stale` verdadeiro se ela foi buscada há mais de 6 horas); erro ou nada guardado dá `null`. É a que roda dentro da consulta do usuário (T23).

- [ ] **Step 1: Escrever os testes** (`fetchFn` falso, banco falso):
  - `linha de hoje buscada há 2 horas não consulta o Banco Central`.
  - `sem linha consulta o período certo e grava`: `now = 2026-11-16T15:00:00Z`, URL com `'11-09-2026'` e `'11-16-2026'`; resposta `{ value: [{ cotacaoVenda: 5.3712, dataHoraCotacao: '2026-11-13 13:09:27.531' }, { cotacaoVenda: 5.3655, dataHoraCotacao: '2026-11-16 13:04:11.002' }] }` devolve `{ rate: 5.3655, date: '2026-11-16', stale: false }` e grava as duas linhas.
  - `à 01:00 de Brasília usa o dia de Brasília` (`now = 2026-11-17T04:00:00Z` dá fim `'11-17-2026'`).
  - `consulta com tempo esgotado devolve a última guardada como stale` (`{ rate: 5.30, date: '2026-11-10', stale: true }`).
  - `resposta vazia no fim de semana devolve a última guardada`.
  - `cotação zero ou negativa é ignorada`.
  - `sem nada guardado e sem consulta devolve null`.
  - `getStoredUsdBrl nunca consulta o Banco Central` (`fetchFn` nunca chamado) e `devolve null sem nada guardado`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/fx.test.ts > $LOGS/t11.txt 2>&1; tail -20 $LOGS/t11.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `api/_lib/fx.ts`.
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/fx.ts api/__tests__/fx.test.ts
git commit -m "feat(admin): cambio do dia pela PTAX de venda do Banco Central, com o ultimo guardado se a consulta falhar [admin] [T11]"
```

### Task 12: Preço e custo por trabalho

**Files:**
- Create: `api/_lib/aiCost.ts`
- Modify: `api/__tests__/fakeSupabase.ts` (acrescenta `.is(col, value)` e `.gte(col, value)` ao query builder falso)
- Test: `api/__tests__/aiCost.test.ts`

**Interfaces:**
- Consumes: colunas da T10; `FxRate` (T11, só o tipo).
- Produces:
  - `export const DEMUCS_VERSION = '25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953'` (sai de `api/separate-audio.ts` na T23).
  - `export const PRICES_SOURCE = 'https://replicate.com/pricing'` e `export const PRICES_CHECKED_AT = '<AAAA-MM-DD do dia da conferência>'`.
  - `export const HARDWARE_USD_PER_SECOND: Record<string, number>` e `export const VERSION_HARDWARE: Record<string, { model: string; hardware: string; source: string }>`, preenchidas na conferência do Step 3.
  - `export type JobCost = { hardware: string | null; usdPerSecond: number | null; costUsd: number | null; costBrl: number | null; fxRate: number | null; fxDate: string | null }`
  - `export function jobCost(input: { version: string | null; status: string | null; predictSeconds: number | null }, fx: FxRate | null, prices = HARDWARE_USD_PER_SECOND, versions = VERSION_HARDWARE): JobCost`. Regras: versão sem preço conhecido, todo custo nulo; `failed` ou `canceled` sem `predictSeconds`, `costUsd = 0` (o Replicate só cobra tempo de processamento); `succeeded` sem `predictSeconds`, nulo; `costUsd` arredondado em 6 casas, `costBrl = costUsd * fx.rate` em 4 casas; sem câmbio, `costBrl`, `fxRate` e `fxDate` nulos.
  - `export function isTerminal(status: string | null | undefined): boolean` (`succeeded`, `failed`, `canceled`).
  - `export function stemCountFromInput(input: unknown): 2 | 4 | 6 | null` (`two_stems` preenchido dá 2; `model_name = 'htdemucs_6s'` dá 6; `model_name = 'htdemucs'` dá 4; sem dado, nulo).
  - `export type ReplicatePredictionLike = { id: string; model?: string | null; version?: string | null; status: string; input?: unknown; metrics?: { predict_time?: number } | null; completed_at?: string | null }`
  - `export async function recordPredictionResult(db: SupabaseClient, p: ReplicatePredictionLike, fx: FxRate | null, now: Date): Promise<'recorded' | 'already' | 'not_terminal' | 'unknown_row'>`: lê a linha (`model, version, stem_count, cost_recorded_at`); preenche só onde estão nulos: `model` com `input.model_name` (nulo se o Replicate não devolver o input; nunca o `p.model` do Replicate, seção C), `version` com `p.version` e `stem_count` com `stemCountFromInput(p.input)`; status fora de `starting`, `processing`, `succeeded`, `failed` e `canceled` vira `unknown`; grava status, tempo, `JobCost`, `completed_at` e `cost_recorded_at = now` com `.eq('replicate_id', p.id).is('cost_recorded_at', null)`; zero linhas atualizadas dá `'already'`.
  - `export async function sweepPendingCosts(db, getPrediction: (id: string) => Promise<ReplicatePredictionLike | null>, getFx: () => Promise<FxRate | null>, opts: { now: Date; limit: number; budgetMs: number; olderThanMs: number; clock?: () => number }): Promise<{ recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean }>`: primeiro, com câmbio, completa o R$ de quem tem dólar e não tem real (`.gte('cost_usd', 0).is('cost_brl', null)`, sem chamar o Replicate; conta em `brlCompleted`); depois busca `limit + 1` linhas com `cost_recorded_at` nulo criadas antes de `now - olderThanMs`, das mais velhas pras mais novas; câmbio pedido uma vez; `getPrediction` nulo (404 do Replicate) grava `status = 'unknown'` e `cost_recorded_at` com custo nulo; falha ao gravar uma linha grava `status = 'unknown'` com `cost_recorded_at` e segue (conta em `failed`), pra nenhuma linha ocupar a janela pra sempre; trabalho ainda não terminado fica pra depois; para quando passar do `budgetMs`; `more` diz se sobrou.

- [ ] **Step 1: Escrever os testes:**
  - `custo com a tabela de exemplo`: preços `{ 'nvidia-t4': 0.000225 }`, versões `{ v1: { model: 'x/y', hardware: 'nvidia-t4', source: 's' } }`, 40 s, câmbio `{ rate: 5.3712, date: '2026-11-16', stale: false }` dão `usdPerSecond 0.000225`, `costUsd 0.009`, `costBrl 0.0483`.
  - `versão sem preço fica sem custo` (todo custo nulo); `falhou sem tempo custa 0`; `concluído sem tempo fica sem custo`; `sem câmbio grava só o dólar`.
  - `a tabela real cobre a versão do demucs`: `VERSION_HARDWARE[DEMUCS_VERSION].hardware` tem preço em `HARDWARE_USD_PER_SECOND`; `PRICES_CHECKED_AT` casa `/^\d{4}-\d{2}-\d{2}$/` e não está no futuro. Se no Step 3 a versão ficar fora da tabela, este teste vira `it.skip` com o motivo escrito e o coordenador decide antes do portão.
  - `stemCountFromInput` dos três casos e do vazio.
  - `gravar trabalho concluído preenche tudo e marca a hora`; `gravar de novo responde already e não muda nada`; `trabalho em andamento não grava`; `linha que não existe responde unknown_row`; `não sobrescreve modelo já gravado`; `model vem do input.model_name, nunca do model do Replicate` (`p.model = 'dono/demucs'`, `input.model_name = 'htdemucs_6s'` grava `htdemucs_6s`, o mesmo que a T23 grava).
  - `status estranho não trava a varredura` (vira `unknown` com `cost_recorded_at`); `falha ao gravar uma linha marca unknown e segue`; `varredura completa o real de quem tem dólar quando há câmbio`.
  - `varredura pega as mais velhas, marca 404 como unknown e para no orçamento` (relógio falso: o terceiro passo passa do orçamento; `more: true`).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/aiCost.test.ts > $LOGS/t12.txt 2>&1; tail -20 $LOGS/t12.txt`. Esperado: FAIL.
- [ ] **Step 3: Conferir o preço e implementar.** Abrir https://replicate.com/pricing e a página do modelo da versão `DEMUCS_VERSION` (o campo `model` da prediction diz qual é; a página mostra em qual hardware ele roda). Preencher `VERSION_HARDWARE` com o modelo, o nome do hardware como a página de preços escreve e o link da página do modelo; preencher `HARDWARE_USD_PER_SECOND` com o preço por segundo desse hardware; `PRICES_CHECKED_AT` com a data. Se a página do modelo não disser o hardware, deixar a versão fora da tabela (o trabalho fica sem custo e aparece contado à parte) e avisar o coordenador. Depois implementar o resto.
- [ ] **Step 4: Rodar de novo** este teste e os que importam `fakeSupabase.ts` e não são de outra tarefa da onda (`separate-audio.test.ts` e `plan.test.ts` são da T13 e ficam pro portão): `npx vitest run api/__tests__/aiCost.test.ts api/__tests__/asaas-webhook.test.ts api/__tests__/asaas-notifications.test.ts api/__tests__/billing-admin.test.ts api/__tests__/cancel-subscription.test.ts api/__tests__/checkout-create.test.ts api/__tests__/dates-brt.test.ts api/__tests__/delete-account.test.ts api/__tests__/reconcile.test.ts api/__tests__/single-paid-permutations.test.ts > $LOGS/t12b.txt 2>&1; tail -5 $LOGS/t12b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/aiCost.ts api/__tests__/fakeSupabase.ts api/__tests__/aiCost.test.ts
git commit -m "feat(admin): preco do hardware conferido no Replicate e custo por trabalho em dolar e real [admin] [T12]"
```

Linha pro FATOS: "Custo de IA: preço do hardware do Replicate conferido em <data> (<hardware>, US$ <preço>/s) pra versão do htdemucs; câmbio PTAX de venda do dia."

### Task 13: Bloqueio e cota extra nos endpoints

**Files:**
- Modify: `api/separate-audio.ts`, `api/check-separation.ts`, `api/get-upload-url.ts`, `api/insert-song.ts`, `api/insert-stems.ts`, `api/upload-stem-from-url.ts`, `api/checkout.ts` (só a trava na criação), `api/_lib/plan.ts`
- Modify: `api/__tests__/separate-audio.test.ts`, `api/__tests__/plan.test.ts`
- Test: `api/__tests__/blocked-access.test.ts`

**Interfaces:**
- Consumes: `verifyActiveUser`, `BLOCKED_MESSAGE`, `AuthOk.blocked` (T2); colunas `quota_bonus` e `quota_bonus_period` (T1).
- Produces (`api/_lib/plan.ts`):
  - `export const PLAN_LIMITS: Record<string, number> = { free: 5, essencial_mensal: 50, essencial_anual: 50, pro_mensal: 150, pro_anual: 150 }` (sai de `separate-audio.ts`).
  - `export function brtMonth(at: Date | string): string` (`brtToday(new Date(at)).slice(0, 7)`, reusando `brtToday` de `api/_lib/billing.ts`).
  - `export function quotaBonusFor(row: { quota_bonus?: number | null; quota_bonus_period?: string | null } | null, now: Date): number` (o bônus só vale se `brtMonth(quota_bonus_period) === brtMonth(now)`).
  - `export async function getQuotaBonus(supabase: any, userId: string, now?: Date): Promise<number>` (coluna ausente dá 0; outro erro lança, como `getUserPlan`).
- Endpoints: `separate-audio`, `check-separation`, `get-upload-url`, `insert-song`, `insert-stems` e `upload-stem-from-url` trocam `verifyUser` por `verifyActiveUser`. `checkout.ts`: depois do roteamento das ações (`cancel`, `cancel-preview`, `sync` continuam pra quem está bloqueado), `if (auth.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE })` antes de criar o checkout. `separate-audio`: limite = `PLAN_LIMITS[plan] + await getQuotaBonus(...)`; a mensagem 402 usa esse total.

- [ ] **Step 1: Escrever os testes:**
  - `separar bloqueado responde 403 com a frase e não consome cota` (`consume_separation_token` não chamada).
  - `os seis endpoints usam verifyActiveUser` (leitura dos arquivos: importam `verifyActiveUser` e não chamam `verifyUser(`).
  - `bloqueado não cria checkout` (403) e `bloqueado ainda cancela a assinatura` (`?action=cancel` segue).
  - `cota extra do mês soma no limite`: Livre com `quota_bonus 10` e período `2026-11-01T03:00:00Z`, agora `2026-11-16T15:00:00Z`, chama `consume_separation_token` com `p_limit: 15`; com período de outubro, `p_limit: 5`; a mensagem 402 diz `15 separações`.
  - `quotaBonusFor na virada`: período `2026-11-01T03:00:00Z` vale em `2026-12-01T02:30:00Z` (ainda 30/11 em Brasília) e não vale em `2026-12-01T03:30:00Z`.
  - Atualizar a fábrica de `vi.mock('../_lib/auth.js')` em `separate-audio.test.ts` pra exportar `verifyActiveUser`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/blocked-access.test.ts api/__tests__/separate-audio.test.ts api/__tests__/plan.test.ts > $LOGS/t13.txt 2>&1; tail -20 $LOGS/t13.txt`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** os testes que esta tarefa pode quebrar: `npx vitest run api/__tests__/blocked-access.test.ts api/__tests__/separate-audio.test.ts api/__tests__/plan.test.ts api/__tests__/checkout-create.test.ts api/__tests__/dates-brt.test.ts api/__tests__/cancel-subscription.test.ts > $LOGS/t13b.txt 2>&1; tail -5 $LOGS/t13b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/separate-audio.ts api/check-separation.ts api/get-upload-url.ts api/insert-song.ts api/insert-stems.ts api/upload-stem-from-url.ts api/checkout.ts api/_lib/plan.ts api/__tests__/separate-audio.test.ts api/__tests__/plan.test.ts api/__tests__/blocked-access.test.ts
git commit -m "feat(admin): conta bloqueada nao separa, nao envia nem assina, e cota extra do mes soma no limite [admin] [T13]"
```

Linha pro FATOS: "Conta bloqueada pelo admin não separa, não consulta separação, não envia arquivo, não salva na nuvem e não assina; ainda cancela a assinatura e exclui a conta. Cota extra dada pelo admin vale só no mês em que foi dada."

### Task 14: Servidor do Financeiro

**Files:**
- Modify: `api/_lib/admin/finance.ts`
- Test: `api/__tests__/admin-finance.test.ts`

**Interfaces:**
- Consumes: T3; `brtToday`; `admin_finance` (contrato; SQL na T22).
- Produces: handler `finance` (GET). `from` e `to` opcionais (`day`); sem eles, o mês atual de Brasília (`now = 2026-11-16T15:00:00Z` dá `from 2026-11-01`, `to 2026-11-30`); `from` depois de `to` responde 400 `A data inicial precisa vir antes da final.`; intervalo maior que 366 dias responde 400 `Escolha um período de até um ano.`; `status` em `all`, `paid`, `pending`, `overdue`, `refunded`, `deleted` (padrão `all`); `page` de 1 a 1000. Chama `rpc('admin_finance', { p_from, p_to, p_status, p_limit: 50, p_offset })` e devolve `FinancePage` com `page` e `pageSize`.

- [ ] **Step 1: Testes:** `sem datas usa o mês de Brasília`; `às 23:30 do dia 30 em Brasília ainda é novembro` (`now = 2026-12-01T02:30:00Z`); `datas invertidas respondem 400`; `status desconhecido responde 400`; `página 3 pede p_offset 100`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-finance.test.ts > $LOGS/t14.txt 2>&1; tail -20 $LOGS/t14.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/finance.ts api/__tests__/admin-finance.test.ts
git commit -m "feat(admin): financeiro no servidor com periodo em dias de Brasilia [admin] [T14]"
```

### Task 15: Servidor da Visão geral

**Files:**
- Modify: `api/_lib/admin/overview.ts`
- Test: `api/__tests__/admin-overview.test.ts`

**Interfaces:**
- Consumes: T3; `PLAN_PRICING` (`api/_lib/pricing.ts`); `brtToday`; `admin_overview` (contrato; SQL na T22) e `admin_review_queue` (T5).
- Produces: handler `overview` (GET) e as funções puras exportadas:
  - `export function mrrBrl(activeByPlan: Partial<Record<PlanKey, number>>): number` (soma de quantidade vezes valor mensal; anual dividido por 12; 2 casas).
  - `export function monthLabel(startDay: string): string` (`'2026-11-01'` dá `novembro de 2026`).
  - `export function fxAgeDays(fxDate: string | null, now: Date): number | null` (dias de Brasília entre o câmbio e hoje).
  - Chama `rpc('admin_overview', { p_now: ctx.now.toISOString() })`, pros testes de virada controlarem a hora.
  - Resposta: o JSON de `admin_overview` mais `month.label`, `mrrBrl`, `marginBrl = round2(revenue.netBrl - aiCost.costBrl)`, `fx.ageDays` e `alerts = { manual, auto } da fila + { blockedWithActiveSub, withoutCost } do overview + { fxOld: ageDays === null || ageDays > 4 }`.

- [ ] **Step 1: Testes:** `MRR de 2 Pro Mensal e 1 Studio Anual dá 189.70`; `margem é a receita líquida menos a IA` (`452.30 - 12.40 = 439.90`); `monthLabel('2026-11-01')`; `câmbio com mais de 4 dias liga o alerta` (`fx.date 2026-11-11`, hoje 16/11: `ageDays 5`, `fxOld true`); `câmbio de ontem não liga`; `sem câmbio liga`; `alertas trazem a contagem da fila`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-overview.test.ts > $LOGS/t15.txt 2>&1; tail -20 $LOGS/t15.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/overview.ts api/__tests__/admin-overview.test.ts
git commit -m "feat(admin): visao geral no servidor com MRR pela tabela de precos, margem e alertas [admin] [T15]"
```

### Task 16: Servidor das ações sobre o assinante

**Files:**
- Modify: `api/_lib/admin/subscriberActions.ts`
- Test: `api/__tests__/admin-subscriber-actions.test.ts`

**Interfaces:**
- Consumes: T3 (`withAudit`, validadores); `changePlan`, `grantCourtesy`, `endCourtesy`, `cancelSubscriptionForUser`, `BillingError`, `brtToday`, `addDays` (`api/_lib/billing.ts`); `isPlanKey`, `PLAN_PRICING`; `billing_flag_review` (Fase 3); `admin_set_block`, `admin_adjust_quota` (contrato; SQL na T21).
- Produces: handlers `change-plan`, `grant-courtesy`, `end-courtesy`, `cancel-subscription`, `block`, `unblock`, `adjust-quota` (contrato da seção A) e `export function courtesyUntil(now: Date, days: number): string` (`new Date(addDays(brtToday(now), days + 1) + 'T03:00:00Z').toISOString()`).
- Regras (alvo sempre do corpo, `userId` uuid; plano com `isPlanKey`; tudo dentro de `withAudit`, com `before` lido antes):
  - `change-plan`: lê a assinatura paga ativa da conta (`billing_subscriptions` com `kind = 'asaas'` e `status = 'active'`); sem ela, 404 `Esta conta não tem assinatura paga ativa. Para dar um plano sem cobrança, use Dar cortesia.`, sem chamar `changePlan`. `before` = `{ planKey, value, cycle }` dessa linha. Dentro do `withAudit`, `changePlan(deps, { userId, newPlanKey })`, e o `fn` relança o `BillingError` original: a tradução da mensagem acontece fora do `withAudit`, pro registro fechar como `partial` quando for o caso. Depois:
    - `unchanged`: 200.
    - `asaas_unavailable` ou `asaas_rejected`: 502 `O Asaas não trocou o plano. Nada mudou.`
    - `not_found` (a assinatura não foi achada no Asaas): 502 `O Asaas não achou esta assinatura. Nada mudou.`
    - `misconfigured`: 500 `O servidor está sem a chave do Asaas.`
    - qualquer outro erro (`partial`, `db_error` ou outro): o Asaas pode ter trocado. Chama `billing_flag_review(<id da assinatura>, 'troca de plano pelo admin: o Asaas pode ter trocado para <planKey> e o banco nao; usar Mudar plano de novo')` e responde 500 `O Asaas trocou o plano, mas o app não. A ficha ficou marcada em Pendências; use Mudar plano de novo para terminar.`
  - `grant-courtesy`: `days` inteiro de 1 a 365 ou `null`; `note` até 300; `until = days === null ? null : courtesyUntil(now, days)`; chama `grantCourtesy` com `until: until ? new Date(until) : null`; devolve `{ courtesyId, until }`. Recusas antes de gravar (com `planRank` local: Studio 2, Pro 1, como `billing_plan_rank`):
    - já existe cortesia ativa do mesmo plano: 409 `Esta conta já tem uma cortesia de <plano> ativa.`
    - a conta tem assinatura paga cancelada com `access_until` no futuro e a cortesia não é de plano maior, ou acaba antes desse `access_until`: 409 `Esta conta ainda tem o <plano> pago até dd/mm/aaaa. Dê uma cortesia de plano maior que vá além dessa data.` (sem isso a cortesia vence a paga e a pessoa conta como Livre antes do fim do período pago; caso (e) da cobrança).
  - `end-courtesy`: `courtesyId` precisa começar com `cortesia:` e pertencer ao `userId` (lê `billing_subscriptions`), senão 400 `Esta cortesia não é desta conta.`.
  - `cancel-subscription`: `when` em `now` ou `period_end`; `cancelSubscriptionForUser(deps, { userId, source: 'admin', immediate: when === 'now' })`; mensagens pro admin: `asaas_unavailable` 502 `O Asaas não respondeu. Nada foi cancelado.`; `not_found` 404 `Esta conta não tem assinatura ativa.`; `partial` repassa o status com `Parte do cancelamento foi feita: ` mais a mensagem da Fase 3; `misconfigured` 500 `O servidor está sem a chave do Asaas.`.
  - `block`: `reason` de 3 a 300 (`label: 'o motivo'`); `admin_set_block(p_admin, p_user, true, p_reason)`; `is_admin` responde 400 `Não dá pra bloquear uma conta admin.`; `already` responde 409 `Esta conta já está bloqueada.`; `not_found` 404 `Conta não encontrada.`. `unblock` igual com `p_block = false` (`already` 409 `Esta conta não está bloqueada.`). O registro dessas duas é gravado pelo SQL na mesma transação (não usar `withAudit`).
  - `adjust-quota`: `mode` em `reset` ou `add`; `add` exige `amount` de 1 a 500; chama `admin_adjust_quota` (registro no SQL) e repassa `{ used, bonus, periodStart }`; `result = 'not_found'` responde 404 `Conta não encontrada.`; `over_limit` responde 409 `A cota extra deste mês já está no máximo (1000).`. "Somar" feito em duas abas soma duas vezes (cada uma fica no Registro).
  - Nenhum caminho estorna.

- [ ] **Step 1: Testes** (`createBillingDb`, `createFakeAsaas`, `db.setRpc` pras funções SQL, hora `2026-11-16T15:00:00Z` salvo onde dito):
  - `mudar plano grava antes e depois no registro`.
  - `troca: o Asaas trocou e o banco falhou, a ficha fica marcada e a nova tentativa conclui` (`billing_change_plan` falha na primeira e responde `changed` na segunda; `billing_flag_review` chamada uma vez; a segunda resposta é 200 `changed`; o PUT no Asaas tem o mesmo corpo nas duas).
  - `mudar plano de conta no Livre responde 404 com a dica da cortesia`; `Asaas fora: 502 e o banco não muda`.
  - `erro de banco depois do PUT no Asaas também marca a ficha` (`billing_change_plan` com erro do banco vira `db_error`: `billing_flag_review` chamada e a mesma frase do `partial`); `troca pela metade fica partial no registro`; `assinatura não achada no Asaas responde 502 sem a dica da cortesia`.
  - `cortesia repetida do mesmo plano responde 409`; `cortesia menor, ou que acaba antes do fim da paga cancelada, responde 409`; `cortesia maior sem data sobre paga cancelada passa`.
  - `somar além de 1000 responde 409`; `ajustar conta inexistente responde 404`.
  - `cortesia de 30 dias pedida às 22:00 de Brasília vale até o fim do dia 16/12` (`now = 2026-11-17T01:00:00Z`, `until = '2026-12-17T03:00:00.000Z'`); `0 e 366 dias respondem 400`; `sem data grava until nulo`.
  - `encerrar cortesia de outra conta responde 400`.
  - `cancelar agora chama o cancelamento com immediate verdadeiro e source admin`; `no fim do período com immediate falso`; `cancelar de novo devolve already_canceled sem chamar o Asaas`; `cancelar com o Asaas fora: 502 e nada muda`.
  - `bloquear sem motivo responde 400`; `bloquear admin responde 400`.
  - `somar 0 ou 501 responde 400`; `zerar repassa o novo contador`.
  - `userId fora do formato responde 400`.
  - `nenhuma ação estorna` (nenhum POST com `/refund`).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-subscriber-actions.test.ts > $LOGS/t16.txt 2>&1; tail -20 $LOGS/t16.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/subscriberActions.ts api/__tests__/admin-subscriber-actions.test.ts
git commit -m "feat(admin): acoes sobre o assinante no servidor, Asaas primeiro, banco depois, meio caminho vira pendencia [admin] [T16]"
```

### Task 17: Tela de Assinantes e ficha

**Files:**
- Modify: `src/admin/tabs/SubscribersTab.tsx` (reescrita)
- Create: `src/admin/components/SubscriberDetail.tsx`, `src/admin/lib/subscribersTypes.ts`, `src/admin/lib/subscriberText.ts`
- Test: `src/admin/lib/subscriberText.test.ts`, `src/admin/tabs/SubscribersTab.test.tsx`, `src/admin/components/SubscriberDetail.test.tsx`

**Interfaces:**
- Consumes: T4 (`useAdminQuery`, `adminGet`, `fmt*`, `TabProps`, `Segmented`, `Chip`, `Panel`, `Button`, `Led`); ações `subscribers`, `subscriber`, `audit` (contrato).
- Produces:
  - `subscribersTypes.ts`: `SubscriberRow`, `SubscriberPage`, `SubscriptionRow`, `SubscriberDetailData`, `SubscriberStatus` (seção B; o tipo da ficha não tem o mesmo nome do componente).
  - `subscriberText.ts`: `statusLabel(status)` (paid_active Pagando, ending Até o fim do período, courtesy Cortesia, free Livre, blocked Bloqueado); `flagLabel(flag)` (review Para conferir, red No vermelho, due7 Vence em 7 dias, blocked Bloqueado, inactive30 Sumido há 30 dias); `lastAccessText(row)` (`Último acesso dd/mm/aaaa hh:mm`; sem `lastSeenAt`, `Último login dd/mm/aaaa hh:mm`; sem os dois, `sem dado`).
  - `SubscribersTab(props: TabProps & { renderActions?: (detail: SubscriberDetailData, reload: () => void) => ReactNode })`.
  - `SubscriberDetail({ userId, onClose, renderActions, onNavigate })`.
- Tela:
  - Lista: busca (espera 300 ms; nome, e-mail ou id); `Segmented` de status (Todos, Pagando, Até o fim do período, Cortesia, Livre, Bloqueados: `all`, `paid_active`, `ending`, `courtesy`, `free`, `blocked`); `Chip`s de marcação, um por vez (Vence em 7 dias, No vermelho, Para conferir, Sumidos há 30 dias: `due7`, `red`, `review`, `inactive30`); seletor de plano (Todos os planos e os 4); `Segmented` de ordem (Mais novos, Mais separações, Último acesso: `created`, `separations`, `last_seen`). Linhas com nome ou e-mail, plano, status, próxima cobrança ou fim do acesso, separações do mês, último acesso e marcações. Paginação "Anterior" e "Próxima" com `1 a 50 de 132`. `focusUserId` abre a ficha direto.
  - Ficha (painel lateral a partir de 1024 px, tela cheia abaixo):
    - Seções: Conta (cadastro, último acesso, login, bloqueio); Assinaturas (linhas, com o motivo do cancelamento por `cancelSourceLabel` e a nota do admin); Pagamentos (status por `paymentStatusLabel`, valor, líquido, vencimento, pagamento); Uso e custo (separações do mês e total, cota `used / limit + bonus`, custo de IA do mês e total, `N trabalhos sem custo`).
    - "No Asaas agora": cada `asaasLive` (status, valor, ciclo e o vencimento da cobrança em aberto, `openDueDate`); erro mostra a frase do servidor; com `mismatches`, um `Panel` com `inset-ring-ps-alert-line` e o título "Diferença entre o app e o Asaas", uma linha por diferença.
    - "Pendências desta conta" (`openActions`, com link pra aba Pendências); "Registro desta conta" (últimas 10 de `audit?userId=`).
    - O lugar de `renderActions(detail, reload)` no topo.

- [ ] **Step 1: Testes:**
  - `filtros viram parâmetros`: escolher Bloqueados e No vermelho chama `adminGet('subscribers', { status: 'blocked', flag: 'red', page: 1, sort: 'created' })`.
  - `busca espera 300 ms` (timers falsos); `paginação mostra 51 a 100 de 132 na página 2`.
  - `lastAccessText cai pro último login`.
  - `ficha mostra as diferenças com o Asaas em alerta`; `ficha com o Asaas fora mostra a frase e nenhuma diferença`.
  - `focusUserId abre a ficha`; `renderActions recebe a ficha`.
  - Texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/lib/subscriberText.test.ts src/admin/tabs/SubscribersTab.test.tsx src/admin/components/SubscriberDetail.test.tsx > $LOGS/t17.txt 2>&1; tail -20 $LOGS/t17.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/tabs/SubscribersTab.tsx src/admin/components/SubscriberDetail.tsx src/admin/lib/subscribersTypes.ts src/admin/lib/subscriberText.ts src/admin/lib/subscriberText.test.ts src/admin/tabs/SubscribersTab.test.tsx src/admin/components/SubscriberDetail.test.tsx
git commit -m "feat(admin): aba Assinantes com busca, filtros e ficha que compara o app com o Asaas [admin] [T17]"
```

### Task 18: Tela do Financeiro

**Files:**
- Modify: `src/admin/tabs/FinanceTab.tsx` (reescrita)
- Create: `src/admin/lib/financeTypes.ts`
- Test: `src/admin/tabs/FinanceTab.test.tsx`

**Interfaces:**
- Consumes: T4; ações `finance` e `payment-link`; `openExternalUrl`.
- Produces: `FinancePage` e `FinanceRow` em `financeTypes.ts`; `FinanceTab(props: TabProps)`.
- Tela:
  - Período por `Segmented` (Este mês, Mês passado, Últimos 12 meses: `from` e `to` por `monthRange` e `brtTodayLocal` de `src/admin/lib/period.ts`); status por `Segmented` (Todas, Pagas, Em aberto, Vencidas, Estornadas, Removidas).
  - Totais: recebido bruto, líquido, quantidade paga, estornado, vencido (valor e contas).
  - Receita por mês: barras de `div` com largura proporcional ao maior mês, valor escrito ao lado, separado por plano.
  - Lista "No vermelho" (cobranças vencidas), com o e-mail levando à ficha.
  - Tabela de cobranças com status, valor, líquido, vencimento, pagamento, conta e plano; botões "Ver no Asaas" (`payment-link` e `openExternalUrl`) e "Copiar id" (`navigator.clipboard.writeText`).
  - Frase fixa: "Estorno é feito no painel do Asaas. Antes de estornar, confira se a cobrança já não está estornada."

- [ ] **Step 1: Testes:** `Mês passado em 16/11/2026 pede 2026-10-01 a 2026-10-31`; `Vencidas pede status overdue`; `Ver no Asaas abre a fatura`; `Copiar id copia pay_1`; `barras na proporção do maior mês`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/tabs/FinanceTab.test.tsx > $LOGS/t18.txt 2>&1; tail -20 $LOGS/t18.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/tabs/FinanceTab.tsx src/admin/lib/financeTypes.ts src/admin/tabs/FinanceTab.test.tsx
git commit -m "feat(admin): aba Financeiro com todas as cobrancas, valor pago real e link pro Asaas [admin] [T18]"
```

### Task 19: Tela de Custos de IA

**Files:**
- Modify: `src/admin/tabs/AiCostTab.tsx` (reescrita)
- Create: `src/admin/lib/aiCostsTypes.ts`
- Test: `src/admin/tabs/AiCostTab.test.tsx`

**Interfaces:**
- Consumes: T4; ações `ai-costs` e `ai-costs-sweep`.
- Produces: `AiCosts` e `AiJob` em `aiCostsTypes.ts`; `AiCostTab(props: TabProps)`.
- Tela:
  - Período por `Segmented` (Este mês, Mês passado, Últimos 90 dias), com as datas de `src/admin/lib/period.ts`.
  - Totais: custo em R$ e US$, trabalhos, concluídos, falhas, média por separação concluída, tempo de processamento.
  - Por modelo e faixas; por pessoa (o e-mail leva à ficha; `userId` nulo aparece como `conta excluída`).
  - Lista paginada dos trabalhos, com status (succeeded concluído, failed falhou, canceled cancelado, unknown sem dado do Replicate, starting ou processing em andamento).
  - Bloco do preço: "Preço do hardware conferido em dd/mm/aaaa (replicate.com/pricing)" e a tabela.
  - Bloco do câmbio: "Câmbio PTAX de venda do Banco Central, de dd/mm/aaaa a dd/mm/aaaa, sem IOF nem spread do cartão".
  - Com `totals.withoutCost > 0`, um `Panel` em alerta: "<N> trabalhos sem custo" e `Button` "Completar custos que faltam" (`adminPost('ai-costs-sweep', {})` e depois `refetch`).

- [ ] **Step 1: Testes:** `mostra "3 trabalhos sem custo" e a data do câmbio`; `Completar custos chama a varredura e recarrega`; `sem trabalhos sem custo não mostra o alerta`; `status unknown vira sem dado do Replicate`; `conta excluída aparece assim na lista por pessoa`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/tabs/AiCostTab.test.tsx > $LOGS/t19.txt 2>&1; tail -20 $LOGS/t19.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/tabs/AiCostTab.tsx src/admin/lib/aiCostsTypes.ts src/admin/tabs/AiCostTab.test.tsx
git commit -m "feat(admin): aba Custos de IA por trabalho gravado, com data do cambio e do preco [admin] [T19]"
```

### Task 20: Tela da Visão geral

**Files:**
- Modify: `src/admin/tabs/OverviewTab.tsx` (reescrita)
- Create: `src/admin/lib/overviewTypes.ts`
- Test: `src/admin/tabs/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: T4; ação `overview`.
- Produces: `Overview` em `overviewTypes.ts`; `OverviewTab(props: TabProps)`.
- Tela:
  - Título com `month.label`.
  - Quatro números em `Panel`: "Recebido no mês" (bruto e, abaixo, líquido), "MRR", "Custo de IA no mês", "Margem do mês" (com a legenda "receita líquida menos IA; sem R2, Supabase e Vercel").
  - Assinantes por plano: Pagando, Até o fim do período, Cortesia; "No vermelho: N contas"; com `subscribers.legacyPaid > 0`, "N assinaturas antigas sem registro" (leva pra `subscribers`).
  - Cancelamentos do mês por motivo (`cancelSourceLabel`).
  - Alertas clicáveis, cada um com `Led state="alert"`: pendências manuais (vai pra `review`), avisos e pendências tentando sozinhos (`alerts.auto`, leva pra `review`; é onde entra o aviso do Asaas com erro), trabalhos sem custo (`aicost`), bloqueados com assinatura ativa (`subscribers`), câmbio velho (`aicost`).
  - Linha do câmbio: "Câmbio: R$ 5,37 por US$ em 16/11/2026 (PTAX venda, Banco Central)".

- [ ] **Step 1: Testes:** `alerta de pendências leva pra aba Pendências` (`onNavigate('review')`); `sem alertas mostra Nada pedindo atenção agora.`; `a margem mostra a legenda do que fica de fora`; `câmbio sem dado mostra sem dado`; `alerta de tentando sozinho leva pra Pendências`; `assinaturas antigas sem registro aparecem`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/tabs/OverviewTab.test.tsx > $LOGS/t20.txt 2>&1; tail -20 $LOGS/t20.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/tabs/OverviewTab.tsx src/admin/lib/overviewTypes.ts src/admin/tabs/OverviewTab.test.tsx
git commit -m "feat(admin): visao geral com receita paga, MRR, custo de IA, margem e alertas [admin] [T20]"
```

## Onda 3

### Task 21: SQL de assinantes, ficha, bloqueio e cota

**Files:**
- Create: `db/supabase_admin_gestao.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/43-gestao-tests.sql`

**Interfaces:**
- Consumes: T1 (colunas do perfil, `is_admin_user`), T5 (`admin_audit_insert`), T10 (custo em `predictions`), Fase 3 (tabelas de cobrança), cota (`separation_period_start`).
- Produces (só `service_role`):
  - `admin_list_subscribers(p_search text, p_plan text, p_status text, p_flag text, p_sort text, p_limit int, p_offset int) returns jsonb` no formato `{ total, rows: SubscriberRow[] }`. Todas as contas de `auth.users` com o perfil. Status por precedência: `blocked` (com `blocked_at`), `paid_active` (assinatura `asaas` ativa com acesso, ou plano efetivo pago sem nenhuma linha `asaas`, que é assinante de antes da Fase 3 e ganha a marcação `review`), `courtesy` (cortesia ativa e nenhuma paga), `ending` (cancelada com `access_until > now()`), senão `free`. `courtesyPlan` = plano da cortesia ativa, se houver. Marcações: `review` (assinatura com `needs_admin_review` ou ação manual aberta da conta), `red` (cobrança `OVERDUE` em aberto, ou corte por `unpaid` nos últimos 30 dias sem assinatura ativa), `due7` (próximo vencimento entre hoje e hoje + 7 em Brasília), `blocked`, `inactive30` (plano efetivo pago e `coalesce(last_seen_at, last_sign_in_at)` mais velho que 30 dias). Parâmetro de filtro nulo = sem filtro. Busca sem diferenciar caixa em e-mail e nome, ou id exato. Ordem `created` (cadastro mais novo), `separations` (separações do mês) ou `last_seen` (acesso mais recente, nulos no fim). `separationsMonth` conta `predictions` do mês de Brasília.
  - `admin_subscriber_detail(p_user uuid) returns jsonb` no formato `SubscriberDetailData` sem os campos do servidor (nulo se a conta não existe). `quota.used` = `tokens_used` se `tokens_period_start` é do mês atual, senão 0; `quota.bonus` = `quota_bonus` se `quota_bonus_period` é do mês atual, senão 0; `periodStart` e `resetsAt` como `get_my_separation_usage`. `payments`: os 50 mais novos da conta. `aiCost.monthBrl` e `totalBrl` somam `cost_brl`. `openActions`: ações `pending` da conta.
  - `admin_set_block(p_admin uuid, p_user uuid, p_block boolean, p_reason text) returns text`: `not_found`, `is_admin` (alvo admin), `already`, `blocked` (grava `blocked_at = now()`, `blocked_reason`, `blocked_by = p_admin`) ou `unblocked` (limpa os três), com o registro `block` ou `unblock` (antes e depois) na mesma transação.
  - `admin_adjust_quota(p_admin uuid, p_user uuid, p_mode text, p_amount int) returns jsonb` `{ result, used, bonus, periodStart }`: `reset` grava `tokens_used = 0` e `tokens_period_start` do mês atual; `add` (1 a 500) soma em `quota_bonus` se `quota_bonus_period` é do mês atual, senão começa do zero, e grava o período; `result` `ok`, `not_found` ou `over_limit` (a soma passaria de 1000; nada muda); registro `adjust_quota` na mesma transação.
- Conferência no fim: as 4 funções existem.

- [ ] **Step 1: Verificações:** `precedência de status` (bloqueado pagando aparece Bloqueado); `pagando com cortesia maior mostra courtesyPlan`; `cancelada no período aparece Até o fim do período`; `assinante antigo sem linha aparece Pagando com Para conferir`; `filtro nulo não filtra`; `busca ANA acha ana@igreja.com`; `filtro due7 pega vencimento em 6 dias e não em 8`; `filtro red pega OVERDUE em aberto`; `inactive30 ignora conta Livre`; `ordem por separações`; `total e paginação`; `ficha traz só os pagamentos da conta`; `cota do mês anterior conta 0`; `separação às 23:30 do dia 30 em Brasília conta no mês certo`; `bloquear admin responde is_admin e não muda`; `bloquear grava o registro na mesma chamada`; `bloquear de novo responde already`; `excluir o admin que bloqueou alguém funciona` (o `blocked_by` vira nulo e a linha do registro fica); `somar 10 duas vezes no mês dá 20`; `somar 500 três vezes no mês responde over_limit na terceira e não muda`; `somar em mês novo recomeça`; `zerar grava 0`; `authenticated não executa nenhuma das 4`.
- [ ] **Step 2: Rodar e ver falhar:** `bash ~/playback-studio-work/admin-sql-tests/run-all.sh 43-gestao-tests.sql > $LOGS/sql43.txt 2>&1; tail -5 $LOGS/sql43.txt`. Esperado: falhas no `43-gestao-tests.sql`.
- [ ] **Step 3: Escrever a migration.**
- [ ] **Step 4: Rodar de novo** o mesmo comando. Esperado: `0 falhas`.
- [ ] **Step 5: Commit**

```bash
git add db/supabase_admin_gestao.sql
git commit -m "feat(admin): lista e ficha do assinante, bloqueio e ajuste de cota no banco com registro na mesma transacao [admin] [T21]"
```

### Task 22: SQL dos números (Visão geral e Financeiro)

**Files:**
- Create: `db/supabase_admin_numeros.sql`
- Create (fora do repositório): `~/playback-studio-work/admin-sql-tests/44-numeros-tests.sql`

**Interfaces:**
- Consumes: T10 (custo em `predictions`, `fx_rates`), Fase 3 (`billing_subscriptions`, `billing_payments`).
- Produces (só `service_role`):
  - `admin_overview(p_now timestamptz default now()) returns jsonb` com `month { start, end }`, `revenue`, `subscribers`, `cancellations`, `aiCost`, `fx { date, rate }` (seção B, sem os campos do servidor). Regras:
    - Receita: cobranças com status pago e data de pagamento no mês de Brasília (`grossBrl` soma `value`, `netBrl` soma `net_value`, `payments` conta).
    - Estornos: `status = 'REFUNDED'` com `refunded_at` no mês (`refundedBrl`, `refunds`).
    - `activeByPlan`: `kind = 'asaas'`, `status = 'active'` e acesso válido. `endingByPlan`: `status = 'canceled'` e `access_until > p_now`. `courtesyByPlan`: cortesia ativa com acesso válido.
    - `overdueAccounts`: contas distintas com cobrança `OVERDUE`. `blockedWithActiveSub`: perfis bloqueados com assinatura `asaas` ativa. `legacyPaid`: perfis com plano efetivo pago e nenhuma linha `asaas` (assinante de antes da Fase 3), contados à parte e fora do `activeByPlan`.
    - Cancelamentos: `canceled_at` no mês, `kind = 'asaas'`, motivo fora de `superseded` e `duplicate`.
    - `aiCost`: `predictions` do mês, com `withoutCost` pela regra da seção C. `fx`: linha mais recente de `fx_rates`.
  - `admin_finance(p_from date, p_to date, p_status text, p_limit int, p_offset int) returns jsonb` no formato `FinancePage` sem `page` e `pageSize`.
    - Filtro por status: `paid` (os três pagos), `pending` (`PENDING`), `overdue` (`OVERDUE`), `refunded` (`REFUNDED`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`), `deleted` (`DELETED`), `all`.
    - Linha no período pela data de pagamento, ou pelo vencimento quando não paga. Plano pela assinatura (`subscription_ref`).
    - `byMonth`: os 12 meses até `p_to`, por data de pagamento. `overdue`: todas as `OVERDUE`, independente do período.
- Conferência no fim: as 2 funções existem.

- [ ] **Step 1: Verificações:** `pagamento confirmado em 2026-11-30 conta em novembro`; `pagamento de 2026-12-01 fica fora de novembro`; `estornada sai da receita e entra nos estornos`; `cancelada no período fica fora dos ativos que renovam` (e entra em `endingByPlan`); `cortesia fica à parte`; `troca e compra repetida não contam como cancelamento`; `bloqueado com assinatura ativa é contado`; `assinatura antiga sem registro conta em legacyPaid e fica fora do activeByPlan`; `custo de IA do mês soma só quem tem custo`; `trabalho com dólar e sem real entra em withoutCost`; `financeiro filtra vencidas`; `financeiro agrupa 12 meses por plano`; `no vermelho ignora o período`; `authenticated não executa as 2`.
- [ ] **Step 2: Rodar e ver falhar:** `bash ~/playback-studio-work/admin-sql-tests/run-all.sh 44-numeros-tests.sql > $LOGS/sql44.txt 2>&1; tail -5 $LOGS/sql44.txt`. Esperado: falhas no `44-numeros-tests.sql`.
- [ ] **Step 3: Escrever a migration.**
- [ ] **Step 4: Rodar de novo** o mesmo comando. Esperado: `0 falhas`.
- [ ] **Step 5: Commit**

```bash
git add db/supabase_admin_numeros.sql
git commit -m "feat(admin): numeros da visao geral e do financeiro pelo status real e pelo valor pago [admin] [T22]"
```

### Task 23: Grava o trabalho ao começar e ao terminar

**Files:**
- Modify: `api/separate-audio.ts`, `api/check-separation.ts`, `api/__tests__/separate-audio.test.ts`
- Test: `api/__tests__/check-separation.test.ts`

**Interfaces:**
- Consumes: `DEMUCS_VERSION`, `recordPredictionResult`, `isTerminal` (T12); `getStoredUsdBrl` (T11); `verifyActiveUser` (T13).
- Produces:
  - `separate-audio`: grava em `predictions` também `model` (`htdemucs` ou `htdemucs_6s`: o `model_name` do demucs, a mesma regra da T12), `version: DEMUCS_VERSION`, `stem_count` (2, 4 ou 6) e `status: 'starting'`; se o insert falhar com `42703` (SQL do Corte B ainda não rodado), repete só com `replicate_id` e `user_id`.
  - `check-separation`: cria o cliente de serviço também pro admin; depois de `replicate.predictions.get`, se `isTerminal(prediction.status)`, chama `getStoredUsdBrl(db, now)` (só o câmbio guardado: a resposta do usuário nunca espera o Banco Central) e `recordPredictionResult(db, prediction, fx, now)` dentro de `try/catch`; a resposta é a mesma com ou sem gravação.

- [ ] **Step 1: Testes:**
  - `separar grava modelo, versão, faixas e status`; `com a coluna ausente grava só o dono`.
  - `trabalho concluído grava o custo uma vez`; `a segunda consulta não grava de novo`; `em andamento não grava`; `falha ao gravar não muda a resposta 200`; `sem câmbio grava o dólar`; `admin consultando também grava`; `a consulta não chama o Banco Central` (`fetch` nunca chamado).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/check-separation.test.ts api/__tests__/separate-audio.test.ts > $LOGS/t23.txt 2>&1; tail -20 $LOGS/t23.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** os testes que esta tarefa pode quebrar: `npx vitest run api/__tests__/check-separation.test.ts api/__tests__/separate-audio.test.ts api/__tests__/checkout-create.test.ts api/__tests__/dates-brt.test.ts api/__tests__/cancel-subscription.test.ts > $LOGS/t23b.txt 2>&1; tail -5 $LOGS/t23b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/separate-audio.ts api/check-separation.ts api/__tests__/separate-audio.test.ts api/__tests__/check-separation.test.ts
git commit -m "feat(admin): cada separacao grava modelo, faixas, tempo e custo quando termina [admin] [T23]"
```

Linha pro FATOS: "Cada separação grava em `predictions` o modelo, as faixas, o tempo de processamento, o status e o custo em US$ e R$ (com o câmbio e a data) quando termina."

### Task 24: Servidor de Custos de IA

**Files:**
- Modify: `api/_lib/admin/aiCosts.ts`
- Test: `api/__tests__/admin-ai-costs.test.ts`

**Interfaces:**
- Consumes: T3; `sweepPendingCosts`, `HARDWARE_USD_PER_SECOND`, `PRICES_CHECKED_AT`, `PRICES_SOURCE` (T12); `getUsdBrl` (T11); `Replicate` (`predictions.get`; 404 vira `null`); `admin_ai_costs` (T10).
- Produces:
  - Handler `ai-costs` (GET): `from` e `to` como no Financeiro (mês de Brasília por padrão, até 366 dias); `page`. Antes de somar, roda `sweepPendingCosts` com `limit 20`, `budgetMs 10000` e `olderThanMs 600000`; sem `REPLICATE_API_TOKEN`, `sweep.skipped = true`. Depois `rpc('admin_ai_costs', ...)`, com `prices = { checkedAt, source, table }` e `sweep`.
  - Handler `ai-costs-sweep` (POST): `limit` de 1 a 100 (padrão 50), `budgetMs 20000` (com `maxDuration` 30, sobra folga pra uma consulta em andamento e pro câmbio); devolve o resultado da varredura.

- [ ] **Step 1: Testes:** `sem datas usa o mês de Brasília`; `a varredura roda antes de somar` (ordem das chamadas); `sem token do Replicate a varredura é pulada e a soma sai`; `a resposta traz a tabela de preços e a data`; `limite 0 ou 101 na varredura responde 400`; `404 do Replicate conta como unknown`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-ai-costs.test.ts > $LOGS/t24.txt 2>&1; tail -20 $LOGS/t24.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/aiCosts.ts api/__tests__/admin-ai-costs.test.ts
git commit -m "feat(admin): custos de IA no servidor pelo banco, completando os trabalhos que ficaram sem custo [admin] [T24]"
```

### Task 25: Servidor de Assinantes e ficha

**Files:**
- Modify: `api/_lib/admin/subscribers.ts`
- Test: `api/__tests__/admin-subscribers.test.ts`

**Interfaces:**
- Consumes: T3; `PLAN_LIMITS` (T13); `PLAN_PRICING`, `isPlanKey`; `getSubscription`, `listSubscriptionPayments`, `AsaasError` (`api/_lib/asaas.ts`); `admin_list_subscribers`, `admin_subscriber_detail` (contrato; SQL na T21).
- Produces:
  - Handler `subscribers` (GET): `q` até 120; `plan` em `all` e as 4 chaves; `status` em `all`, `paid_active`, `ending`, `courtesy`, `free`, `blocked`; `flag` em `none`, `review`, `red`, `due7`, `blocked`, `inactive30`; `sort` em `created`, `separations`, `last_seen`; `page`. `all` e `none` viram `null` antes do `rpc`. Devolve `SubscriberPage`.
  - Handler `subscriber` (GET, `userId` uuid): nulo do SQL responde 404 `Conta não encontrada.`. Acrescenta `quota.limit` (`null` se `profile.isAdmin`, senão `PLAN_LIMITS[plano efetivo]`), `plans` (de `PLAN_PRICING`) e `asaasLive`: até 3 linhas `asaas` com `asaasSubscriptionId` que estejam ativas ou encerradas sem `asaasStoppedAt`, cada uma com `getSubscription` e `listSubscriptionPayments` em paralelo (5 s cada). `getSubscription` é lida por um tipo local com `status`, `value`, `cycle` e `deleted`, e `null` (404) = removida (`deleted: true`). `openDueDate` = vencimento da cobrança em aberto (`PENDING`, `OVERDUE` ou `AWAITING_RISK_ANALYSIS`, sem `deleted`) de menor ciclo (`originalDueDate`, senão `dueDate`) depois do `lastPaidDueDate` da linha, a mesma regra de `api/_lib/reconcile.ts`, e nulo se houver cobrança paga de ciclo depois do último pago (pagamento que o app ainda não contou). `AsaasError` vira `{ ok: false, error: 'O Asaas não respondeu agora.' }`. Também acrescenta `mismatches`.
  - `export function compareWithAsaas(row: SubscriptionRow, live: { status: string; value: number; cycle: string; openDueDate: string | null; deleted: boolean }): string[]`. Frases exatas, valores com `Intl` pt-BR:
    - App ativa e Asaas `INACTIVE`, `EXPIRED` ou removida: `No Asaas a assinatura está <STATUS ou REMOVIDA>, mas no app ela está ativa.`
    - App encerrada e Asaas `ACTIVE`: `O Asaas ainda cobra esta assinatura, mas no app ela está encerrada.`
    - Valor diferente de `PLAN_PRICING[row.planKey].value`: `No Asaas o valor é R$ 119,90, mas o plano no app é Pro Mensal (R$ 49,90).`
    - Ciclo diferente: `No Asaas o ciclo é mensal, mas o plano no app é anual.`
    - Vencimento da cobrança em aberto diferente do próximo vencimento do app, só com a linha ativa e `openDueDate` não nulo: `No Asaas a cobrança em aberto vence em 16/12/2026, mas no app a próxima cobrança é 17/12/2026.` (nunca compara o `nextDueDate` da assinatura, que aponta pra próxima a ser gerada).

- [ ] **Step 1: Testes:** `filtros inválidos respondem 400`; `conta inexistente responde 404`; `limite de cota pelo plano efetivo e nulo pra admin`; `all e none viram null`; `compareWithAsaas` com cada uma das 5 frases; `a data compara a cobrança em aberto, não o nextDueDate da assinatura`; `com pagamento ainda não contado a data não é comparada`; `404 do Asaas conta como removida` (normalizar `U+00A0`); `Asaas fora: a ficha abre com aviso e sem diferenças`; `no máximo 3 consultas ao Asaas`; `ficha sem assinatura não consulta o Asaas`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-subscribers.test.ts > $LOGS/t25.txt 2>&1; tail -20 $LOGS/t25.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo.** Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/admin/subscribers.ts api/__tests__/admin-subscribers.test.ts
git commit -m "feat(admin): lista e ficha do assinante no servidor, com o Asaas consultado na hora e as diferencas em frase [admin] [T25]"
```

### Task 26: Ações na ficha

**Files:**
- Create: `src/admin/components/SubscriberActions.tsx`, `src/admin/lib/actionText.ts`
- Modify: `src/admin/tabs/SubscribersTab.tsx` (passa `renderActions`)
- Test: `src/admin/lib/actionText.test.ts`, `src/admin/components/SubscriberActions.test.tsx`

**Interfaces:**
- Consumes: `SubscriberDetailData` e o componente `SubscriberDetail` (T17); `brtTodayLocal` e `addDaysLocal` (`src/admin/lib/period.ts`, T4); `ConfirmDialog`, `adminPost`, `fmtDay`, `fmtBRL`, `planLabel` (T4); as 7 ações da T16.
- Produces (`actionText.ts`; preço sempre do `detail.plans`; datas por `fmtDay`, e o último dia da cortesia por `addDaysLocal(brtTodayLocal(), days)`):
  - `changePlanText(cur, next, nextDueDate)`: `A assinatura no Asaas passa de Pro Mensal (R$ 49,90 por mês) para Studio Mensal (R$ 119,90 por mês) a partir da próxima cobrança, em 16/12/2026. O acesso muda agora. Não há cobrança nem desconto proporcional.` (anual escreve `por ano`; sem data, `a partir da próxima cobrança.`).
  - `courtesyText(planLabel, untilDay, paidLabel)`:
    - Com data e sem paga: `Studio Anual sem cobrança até 16/12/2026 (fim do dia). Nada muda no Asaas. No fim, a conta volta sozinha para o Livre.`
    - Com paga: troca a última frase por `No fim, a conta volta para o Pro Mensal, que continua sendo cobrado normalmente.`
    - Sem data: `Studio Anual sem cobrança e sem data para acabar. Nada muda no Asaas. Para encerrar, use Encerrar cortesia.`
    - Cortesia de plano igual ou menor que o pago acrescenta `A cortesia de um plano igual ou menor que o pago não muda nada para esta conta.`
  - `endCourtesyText(planLabel, paidLabel)`: `A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta volta para o Livre.` (com paga: `A conta volta para o Pro Mensal pago.`).
  - `cancelText(when, planLabel, accessUntilDay)`:
    - `period_end`: `A renovação para agora no Asaas e nada mais é cobrado. A conta continua no Pro Mensal até 16/12/2026 e depois volta para o Livre. Nenhum estorno é feito.`
    - `now`: `A assinatura é removida no Asaas agora e a conta volta para o Livre na hora. Nenhum estorno é feito; se precisar devolver dinheiro, estorne no painel do Asaas.`
  - `blockText(hasActivePaid)`: `A pessoa perde o acesso ao app agora: separar, biblioteca em nuvem, enviar arquivos e assinar.` mais, se paga ativa, ` A cobrança no Asaas continua. Para parar de cobrar, cancele a assinatura também.`
  - `unblockText()`: `O acesso volta agora. Nada muda no Asaas.`
  - `quotaText(mode, used, limit, bonus, amount, lastDay)`:
    - `reset`: `O contador deste mês volta de 4 para 0 (limite 5). Nada muda no Asaas.`
    - `add`: `Mais 10 separações só neste mês: o limite vai de 5 para 15 até 30/11/2026. Nada muda no Asaas.`
  - `SubscriberActions({ detail, reload }: { detail: SubscriberDetailData; reload: () => void })`. Botões conforme o estado:
    - "Mudar plano" (só com paga ativa; seletor dos outros 3 planos).
    - "Dar cortesia" (plano; 7, 30 ou 90 dias, outro número ou "Sem data"; nota opcional) e "Encerrar cortesia" (com cortesia ativa).
    - "Cancelar assinatura" (com paga ativa; `Segmented` No fim do período ou Agora).
    - "Bloquear" (motivo obrigatório) ou "Desbloquear" (nenhum dos dois em conta admin).
    - "Ajustar cota" (`Segmented` Zerar ou Somar; número de 1 a 500).
  - Cada ação abre `ConfirmDialog` com o texto acima. `tone="alert"` em Cancelar agora e Bloquear. Erro dentro do diálogo; sucesso fecha, mostra "Feito." e chama `reload()`.

- [ ] **Step 1: Testes:** cada frase de `actionText` com os valores acima (normalizar `U+00A0`); `Mudar plano não aparece sem paga ativa`; `Bloquear não aparece pra admin`; `confirmar cortesia de 30 dias manda grant-courtesy com days 30`; `Sem data manda days null`; `Cancelar agora manda when now e usa o tom de alerta`; `erro do servidor fica no diálogo`; `sucesso recarrega a ficha`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/admin/lib/actionText.test.ts src/admin/components/SubscriberActions.test.tsx > $LOGS/t26.txt 2>&1; tail -20 $LOGS/t26.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo** e `npx vitest run src/admin > $LOGS/t26b.txt 2>&1; tail -5 $LOGS/t26b.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/admin/components/SubscriberActions.tsx src/admin/lib/actionText.ts src/admin/tabs/SubscribersTab.tsx src/admin/lib/actionText.test.ts src/admin/components/SubscriberActions.test.tsx
git commit -m "feat(admin): acoes na ficha do assinante com confirmacao que diz o efeito no Asaas [admin] [T26]"
```

Linha pro FATOS: "Na ficha do assinante o admin muda o plano, dá e encerra cortesia, cancela (no fim do período ou agora, sem estorno), bloqueia e desbloqueia e ajusta a cota do mês; cada confirmação diz o efeito no Asaas e tudo fica no Registro."

### Task 27: Conta bloqueada e cota extra no app

**Files:**
- Create: `src/components/BlockedScreen.tsx`
- Modify: `src/App.tsx`, `src/lib/separationUsage.ts`, `src/components/SeparationUsageMeter.tsx`, `src/components/SeparatorStudio.tsx` (I4), `src/lib/profileFlags.ts` (M15)
- Test: `src/components/BlockedScreen.test.tsx`, `src/lib/profileFlags.test.ts` (acrescentar), `src/lib/separationUsage.test.ts` (acrescentar), `src/components/SeparationUsageMeter.test.tsx` (acrescentar), `src/blockedGate.test.ts`

**Interfaces:**
- Consumes: `useAuth().blockedAt`, `isAdmin`, `signOut`, `deleteAccount` (T9 e o `useAuth` de hoje); `SubscriptionPanel`; `deleteAccountNotice` e `fetchCancelPreview` (`src/lib/subscription.ts`); regra do bônus (T13).
- Produces:
  - `BlockedScreen({ plan, onSignOut, onDeleteAccount })`: título "Sua conta está bloqueada", texto "Fale com a gente pelo WhatsApp para entender e resolver.", o `SubscriptionPanel` da pessoa (pra ela poder cancelar; o `onOpenPricing` não abre nada, porque o checkout recusa conta bloqueada), `Button` "Excluir minha conta" (a mesma confirmação do Perfil: `deleteAccountNotice(await fetchCancelPreview(), plan)` e digitar EXCLUIR, depois `onDeleteAccount()`) e `Button` "Sair"; tokens `ps-*`.
  - `profileFlags.ts`: `export function shouldShowBlocked(s: { user: unknown; blockedAt: string | null; isAdmin: boolean }): boolean` (com login, com `blockedAt` e sem ser admin). `App.tsx`: depois dos bloqueios de login e carregamento, `if (shouldShowBlocked({ user, blockedAt, isAdmin })) return <BlockedScreen plan={userPlan} onSignOut={signOut} onDeleteAccount={deleteAccount} />`.
  - `separationUsage.ts`: `export async function fetchQuotaBonus(now?: Date): Promise<number>` (pega o id da sessão; lê `quota_bonus, quota_bonus_period` da própria linha; bônus só se o período é do mês atual de Brasília; erro ou coluna ausente, 0); `export function brtMonth(at: Date | string): string` (mesma regra da T13); `export function monthlyLimit(plan: string, bonus: number): number` (`maxSeparationsPerMonth(plan) + bonus`).
  - `SeparationUsageMeter`: limite = `monthlyLimit(plan, bonus)`; com bônus, a frase vira `5 separações por mês + 10 extras neste mês. O contador volta a zero em 01/12/2026.`
  - `SeparatorStudio.tsx`: a checagem antes de subir o arquivo (hoje `used >= maxSeparationsPerMonth(plan)`) passa a usar `monthlyLimit(userPlan, await fetchQuotaBonus())`, e a frase do aviso usa esse total. Sem isso, "Somar N" nunca chega ao servidor.

- [ ] **Step 1: Testes:** `tela de bloqueado mostra o texto, a assinatura, Excluir minha conta e Sair`; `Sair chama onSignOut`; `Excluir com EXCLUIR digitado chama onDeleteAccount, sem ele não chama`; `Assinar de novo na tela de bloqueado não abre nada`; `shouldShowBlocked` (bloqueado comum mostra; admin com `blockedAt` não; sem login não); `blockedGate.test.ts` lê `App.tsx` e confere que ele chama `shouldShowBlocked` (complemento); `monthlyLimit('free', 10)` dá 15; `o Separador barra pelo limite com o bônus` (lê `SeparatorStudio.tsx`: usa `monthlyLimit` e `fetchQuotaBonus`; complemento do teste da função); `bônus de outubro não vale em novembro`; `bônus de novembro vale às 23:30 do dia 30`; `medidor com bônus mostra 4 / 15 usadas e a frase dos extras`; `sem bônus a frase de hoje não muda`; texto sem `TRAVESSAO`.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run src/components/BlockedScreen.test.tsx src/lib/profileFlags.test.ts src/lib/separationUsage.test.ts src/components/SeparationUsageMeter.test.tsx src/blockedGate.test.ts > $LOGS/t27.txt 2>&1; tail -20 $LOGS/t27.txt`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar de novo** e `npm run typecheck > $LOGS/t27tc.txt 2>&1; tail -5 $LOGS/t27tc.txt`. Esperado: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/BlockedScreen.tsx src/App.tsx src/lib/separationUsage.ts src/components/SeparationUsageMeter.tsx src/components/SeparatorStudio.tsx src/lib/profileFlags.ts src/components/BlockedScreen.test.tsx src/lib/profileFlags.test.ts src/lib/separationUsage.test.ts src/components/SeparationUsageMeter.test.tsx src/blockedGate.test.ts
git commit -m "feat(admin): tela de conta bloqueada no app e medidor com a cota extra do mes [admin] [T27]"
```

## Onda 4

### Task 28: Limpeza, abas finais e documentação viva

**Files:**
- Modify: `api/admin-stats.ts` (sai o desvio do `?source=`), `src/admin/AdminApp.tsx` (abas finais)
- Delete: `api/_lib/admin/legacyStats.ts`, `src/admin/hooks/useAdminUsers.ts`, `src/admin/hooks/useFinanceStats.ts`, `src/admin/hooks/useAiCostStats.ts`, `src/admin/tabs/UsageTab.tsx`, `src/admin/lib/metrics.ts`, e `src/admin/lib/format.ts`, `src/admin/components/StatCard.tsx`, `BarChart.tsx`, `DataTable.tsx` se nenhum arquivo importar mais (conferir com `grep -rn`)
- Modify: `PLAYBACK_STUDIO_FATOS.md`, `DESIGN_SYSTEM.md`
- Modify (testes): `api/__tests__/admin-registry.test.ts` (criado na T6; aqui fixa a lista exata das 20 ações), `src/admin/AdminApp.test.tsx`

**Interfaces:**
- Consumes: tudo.
- Produces:
  - Abas finais, nesta ordem: Visão geral, Assinantes, Financeiro, Custos de IA, Pendências, Registro. A aba "Uso" sai e a ativa começa em `'overview'`; o número e o `Led` de Pendências continuam.
  - `PLAYBACK_STUDIO_FATOS.md`:
    - Seção "Admin" reescrita: papel `is_admin`; abre dentro do app e em `/admin`; as 6 abas; ações e regras D8 a D14; custo de IA e câmbio D15 a D17; números D18.
    - Na seção de cobrança, "É a lista que o admin vai ver" passa a citar a aba Pendências e "ainda sem tela" da cortesia sai.
    - Seção 4: `api/admin-stats.ts` roteado por `?action=`.
    - Entrada datada no Histórico de mudanças.
    - Passos de lançamento dos dois cortes (seção "Publicação").
    - Nota: `get_admin_dashboard_stats` ficou sem uso, protegido pelo papel.
  - `DESIGN_SYSTEM.md` seção 1.7: "o admin (`src/admin/`) usa só a linguagem nova".

- [ ] **Step 1: Testes:** no `admin-registry.test.ts` da T6, a lista passa a ser exatamente as 20 ações da seção A, cada uma com 403 pra usuário comum; `?source=asaas agora responde 400` (ação desconhecida); `abas finais na ordem e Visão geral primeiro`; `nada em api/ e src/ contém o e-mail do dono` (`OWNER` montado em tempo de execução, varredura recursiva pulando `*.test.ts` e `*.test.tsx`).
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run api/__tests__/admin-registry.test.ts src/admin/AdminApp.test.tsx > $LOGS/t28.txt 2>&1; tail -20 $LOGS/t28.txt`.
- [ ] **Step 3: Implementar** a limpeza, as abas e os documentos.
- [ ] **Step 4: Portão completo** (incluindo a suíte SQL com os 7 arquivos e a contagem de 12 funções). Esperado: tudo verde.
- [ ] **Step 5: Commit**

```bash
git rm api/_lib/admin/legacyStats.ts src/admin/hooks/useAdminUsers.ts src/admin/hooks/useFinanceStats.ts src/admin/hooks/useAiCostStats.ts src/admin/tabs/UsageTab.tsx src/admin/lib/metrics.ts
git add api/admin-stats.ts src/admin/AdminApp.tsx PLAYBACK_STUDIO_FATOS.md DESIGN_SYSTEM.md api/__tests__/admin-registry.test.ts src/admin/AdminApp.test.tsx
git commit -m "chore(admin): sai o painel antigo, abas finais, FATOS e design system atualizados [admin] [T28]"
```

## Publicação (passos de lançamento com o dono)

**Corte A, junto com a cobrança da Fase 3 (COB-ORDEM):**
1. **Com OK explícito do dono**, Supabase de produção, SQL Editor, nesta ordem: `db/supabase_admin_papel.sql` (a conferência mostra 1 admin, nenhuma policy com o e-mail e, no máximo, a função `user_has_cloud_library`, que o próximo arquivo troca), `db/supabase_cota_mensal.sql`, `db/supabase_assinaturas.sql`, `db/supabase_admin_base.sql`. Depois do último, repetir a consulta das policies e funções que citam o e-mail: aí espera 0. Se aparecer alguma, parar e mandar a lista pro coordenador.
2. Os passos da cobrança que vêm antes do deploy, como estão no FATOS (por exemplo, `CRON_SECRET` na Vercel).
3. Prévia na web (Portão A, passo 2).
4. Publicação web e computador (Mac e Windows) juntos.
5. Os passos da cobrança depois do deploy (eventos no Asaas com envio Sequencial, notificações só por e-mail, sandbox).
6. O dono abre o app de computador, toca ADMIN e vê Pendências e Registro (Portão A, passo 4). Combinar com ele de quanto em quanto tempo olhar as Pendências (o estorno de compra repetida é sempre manual).

**Corte B:**
1. Com OK explícito do dono, SQL Editor, nesta ordem: `db/supabase_admin_custos.sql`, `db/supabase_admin_gestao.sql`, `db/supabase_admin_numeros.sql`.
2. Prévia na web (o app de computador só vê o roteador novo depois de publicar).
3. Publicação web e computador.
4. O dono abre Custos de IA uma vez (a varredura completa os trabalhos antigos, 20 por vez) e confere a Visão geral contra o painel do Asaas do mês.

## Cobertura do spec

| Spec | Tarefas |
|---|---|
| 2. Abrir dentro do app; `/admin` na web | T4, T9 |
| 2. Números confiáveis (status real, receita paga, custo por trabalho, câmbio do dia) | T10 a T12, T14, T15, T19, T20, T22 a T24 |
| 2. Ações (plano, cancelar, cortesia, bloquear, cota) | T13, T16, T21, T26, T27 |
| 2 e 8. Registro de tudo | T3, T5, T7, T16, T21 |
| 4. Antiobjetivos | Global Constraints, Review Focus 1 e 2, T6, T16, T25 |
| 5. Regras de cobrança (mesmas funções da Fase 3) | T6, T16 (importam de `api/_lib/billing.ts`) |
| 6. Visão geral, Assinantes, Financeiro, Custos de IA, Registro | T20, T17 e T26, T18, T19, T7 |
| 7. Dados (`predictions`, `is_admin`, registro, bloqueio, cortesia) | T1, T5, T10, D9 |
| 8. 12 funções, servidor verifica, `file://`, linguagem nova, migrations só escritas | Global Constraints, T3, T28 |
| COB-ORDEM e COB-RECONCILE (tela de pendências antes de publicar a cobrança) | Onda 1, P2, Portão A |
