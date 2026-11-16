# Admin central do Playback Studio (design)

Status: decidido pelo Claude com autorização do dono ("pode começar pelo que você acha certo", 2026-11-16). O dono confere ao ver a prévia. Amplia o spec do painel só de leitura de 2026-07-08 (`docs/superpowers/specs/2026-07-08-admin-dashboard-design.md`), que fica como histórico.

## 1. Por que

O dono só abre o admin pelo navegador (no app de computador o botão ADMIN leva pra `file:///admin` e a tela fica em branco). E o admin de hoje só mostra números, que ainda por cima não batem com a realidade: quem cancela continua contado como pagante, só o primeiro pagamento é gravado (com o preço da tabela, não o pago), o custo da IA é estimado com preço de hardware digitado à mão e só olha os últimos 500 trabalhos. O dono quer um lugar dentro do app onde controla o negócio: assinantes, dinheiro e custo da IA, e onde consegue agir (cancelar, ativar, trocar plano, dar upgrade).

## 2. Objetivos

- Abrir o admin dentro do app (desktop e web), sem sair para o navegador; o endereço `/admin` continua funcionando na web.
- Números confiáveis: assinantes ativos e inadimplentes pelo status real da assinatura; receita pelo que foi pago de fato; custo de IA por trabalho gravado no banco, com o preço certo do hardware e o câmbio do dia.
- Ações sobre um assinante: mudar o plano (upgrade e downgrade), cancelar a assinatura, ativar uma conta (plano cortesia por um prazo), bloquear e desbloquear o acesso, ajustar a cota do mês.
- Tudo o que o admin faz fica registrado (quem, quando, o quê, antes e depois).

## 3. Não objetivos (por enquanto)

- Custos de R2, Supabase e Vercel no painel (não há integração; fica pra depois, com campo manual opcional).
- Estorno pelo app (o painel mostra o link da cobrança no Asaas; estorno é feito lá).
- Vários níveis de admin (só um papel: admin).

## 4. Antiobjetivos (o que tornaria isso um fracasso)

- Ação de admin que muda o plano no app e não muda a cobrança no Asaas (ou o contrário), deixando os dois desencontrados.
- Qualquer pessoa que não seja admin conseguir chamar uma ação de admin.
- Número no painel que parece certo e está errado sem aviso.

## 5. Regras de negócio (do dono e do coordenador)

- Renovação não paga até o vencimento: no mesmo dia a conta volta para o Livre e a assinatura é cancelada no Asaas (dono). Pagamento atrasado que chegar depois restaura o plano até o fim daquele período e aparece para o admin conferir.
- Cancelamento pelo próprio assinante: fica com o plano até o fim do período pago (coordenador). Arrependimento de 7 dias na primeira compra: reembolso e Livre na hora.
- Aviso de vencimento no mensal: dentro do app a partir de 3 dias antes e no dia, mais as notificações do próprio Asaas se a API permitir (dono).
- Essas três regras são implementadas na Fase 3 da cobrança (branch fix/cobranca); o admin usa as mesmas funções do servidor.

## 6. O que o admin faz (telas)

Abre como uma tela interna do app (estado, não URL). Botão ADMIN só aparece pra admin.

- **Visão geral:** receita do mês (paga), MRR, assinantes ativos por plano, inadimplentes, cancelamentos do mês, custo de IA do mês, margem; alertas (pagamento atrasado restaurado, webhook com erro).
- **Assinantes:** lista com busca e filtros (plano, status, vencendo em 7 dias, no vermelho). Ficha do assinante: plano, status, próxima cobrança, fim do período pago, histórico de pagamentos, separações do mês e totais, custo de IA dele, data de cadastro e último acesso. Ações na ficha, cada uma com confirmação que diz o efeito no Asaas:
  - Mudar plano (upgrade ou downgrade): atualiza a assinatura no Asaas (valor e ciclo) e o plano no app; mostra o valor novo antes de confirmar.
  - Ativar com cortesia: dá um plano por N dias sem cobrança; volta sozinho pro Livre no fim.
  - Cancelar assinatura: agora ou no fim do período.
  - Bloquear / desbloquear acesso.
  - Ajustar a cota do mês (zerar ou somar separações).
- **Financeiro:** todas as cobranças (criadas, pagas, vencidas, estornadas) com valor pago real e link pro Asaas; receita por plano e por mês; inadimplência.
- **Custos de IA:** por trabalho gravado no banco (modelo, faixas, tempo de processamento, custo em US$ e R$, status, usuário); total do mês, média por separação, por usuário, falhas.
- **Registro:** lista das ações de admin.

## 7. Dados (o que precisa existir)

- Da Fase 3: ids do cliente e da assinatura no Asaas, status, ciclo, próxima cobrança, fim do período, tabela de pagamentos com todos os eventos e valor real.
- Novo: na tabela `predictions`, ao terminar um trabalho, gravar modelo, número de faixas, tempo de processamento, status e custo (preço do hardware conferido na documentação do Replicate para a versão usada; câmbio do dia com o último valor guardado se a consulta falhar, e o painel mostra a data do câmbio).
- Novo: `profiles.is_admin` (papel de admin) no lugar do e-mail escrito à mão em vários lugares; o servidor e as regras do banco passam a usar o papel; o e-mail atual vira o primeiro admin.
- Novo: tabela de registro das ações de admin.
- Novo: campos de bloqueio e de cortesia (plano, fim) no perfil.

## 8. Restrições

- A Vercel no plano atual aceita no máximo 12 funções em `api/` (hoje são 12): nada de arquivo novo de endpoint; ações entram como `?action=` em endpoint existente.
- Toda ação de admin é verificada no servidor (papel admin), nunca só no front. Padrões de segurança do projeto (auth/CORS, RLS, sem segredo no código).
- Funciona no app desktop (file://, sem caminho absoluto) e na web.
- Visual na linguagem nova (tokens `ps-*` e peças base da Parte 1); português do Brasil, sem travessão.
- Migrations só escritas; rodar na produção é passo de lançamento com o dono.

## 9. Abordagens consideradas

- **A. Admin como tela interna do app, reaproveitando as abas atuais e trocando a fonte dos dados (escolhida):** resolve o desktop sem depender de URL, reaproveita o que já existe, e as ações chamam as mesmas funções da cobrança.
- B. Abrir o admin da web no navegador a partir do app: rápido, mas o dono pediu dentro do app e o login fica separado.
- C. Admin como app separado: dobra o trabalho de login, deploy e segurança sem ganho.

## 10. Ordem

1. Fase 3 da cobrança termina e é revisada (base de dados e funções).
2. Admin: plano em tarefas, execução com agentes, revisão, prévia pro dono, publicação.

## 11. Deixado para o construtor

Layout fino de cada tela dentro da linguagem nova; paginação e filtros; formato dos gráficos; textos das confirmações (curtos, dizendo o efeito no Asaas).
