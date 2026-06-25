# Templates de email transacional — Playback Studio

Emails de autenticação com a identidade da marca, prontos pra colar no Supabase.
Não precisam de código nem deploy: o Supabase já envia esses emails, a gente só troca o visual.

## Onde colar

Painel do **Supabase** → projeto → **Authentication** → **Emails** (ou "Email Templates").
Pra cada template, cole o HTML correspondente no campo de corpo e ajuste o **assunto**.

| Template no Supabase | Arquivo | Assunto sugerido |
|---|---|---|
| **Confirm signup** | `build/email-templates/confirmacao-cadastro.html` | Confirma seu cadastro no Playback Studio |
| **Reset Password** | `build/email-templates/recuperar-senha.html` | Redefinir sua senha do Playback Studio |
| **Magic Link** | `build/email-templates/magic-link.html` | Seu link de entrada no Playback Studio |

> Abra cada arquivo `.html`, copie todo o conteúdo (a 1ª linha é só um comentário lembrando onde colar e o assunto, pode copiar junto que o email ignora) e cole no campo do Supabase.

## Variáveis

Os templates usam `{{ .ConfirmationURL }}`, a variável do Supabase que vira o link real
(confirmar conta / redefinir senha / entrar). Não troque o nome dela. O Supabase
substitui automaticamente no envio.

## Notas de design (por que é assim)

- **Clientes de email não carregam fontes do Google nem CSS externo.** Por isso o HTML
  usa estilos inline, layout em tabela e fontes seguras (Georgia no título, Arial no corpo).
  A identidade vem da **cor** (laranja #FF6B35 sobre dark #121214/#1A1A1E), da estrutura e do tom.
- O PlayMark é representado por três triângulos (►►►) porque imagem hospedada exigiria URL externa.

## Teste depois de colar

1. No app, faça um cadastro novo com um email seu → confira se o email de confirmação chega com a cara nova.
2. Use "esqueci a senha" → confira o de recuperação.
3. Olhe em **caixa de entrada e spam**. Se cair em spam, vale o passo do remetente próprio (SMTP) abaixo.

## Próximo passo opcional: remetente próprio (entregabilidade)

Hoje o "De:" é o remetente padrão do Supabase. Pra virar `nao-responda@playbackstudio.com.br`
e melhorar a entrega (menos spam), dá pra configurar **SMTP customizado** no Supabase
(Authentication → SMTP Settings) com um provedor (Resend, Brevo, etc) + ajustes de DNS (SPF/DKIM).
Fica pra quando você tiver um email no domínio. Me chama que eu te guio.
