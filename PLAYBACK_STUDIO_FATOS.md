# PLAYBACK STUDIO — Fatos Atuais (Fonte Única de Verdade)

> **Última atualização:** 2026-07-08
> **Para que serve:** este é o documento canônico dos fatos do produto. Qualquer pessoa ou agente que for criar conteúdo, copy, proposta ou tomar decisão DEVE ler este arquivo primeiro. Se algo em outro doc contradiz isto, este vence.
> **Regra:** toda alteração de produto (preço, plano, feature, provedor, stack) atualiza este arquivo no mesmo passo. Ver seção "Histórico de mudanças".
> **Fontes de verdade no código:** `src/lib/plans.ts` (tiers e capabilities), `src/components/PricingModal.tsx` (cards e preços), `api/checkout.ts` (preços reais cobrados), `api/separate-audio.ts` (cotas).

---

## 1. O produto em uma linha

Playback Studio separa qualquer música em faixas (multitracks) prontas para a equipe de worship chegar preparada no domingo. Feito por quem toca, para quem toca. A plataforma do domingo.

- **Domínio:** playbackstudio.com.br
- **Onde roda:** navegador (web) + app desktop (Electron) para Mac (Apple Silicon e Intel) e Windows, com Modo Ao Vivo por rede local.
- **Upload aceito:** arquivos MP3, WAV ou AAC. **Não aceita link** (YouTube etc.).
- **Separação:** IA (Replicate, modelo htdemucs) em 2, 4 ou 6 faixas.

## 2. Planos, preços e o que cada um entrega

Os nomes internos (no banco `profiles.plan`, no checkout e no webhook) são: `free`, `essencial_mensal`, `essencial_anual`, `pro_mensal`, `pro_anual`. O nome exibido é Livre / Pro / Studio. Os IDs internos NÃO mudam (presos ao Asaas e ao banco).

| Plano (exibido) | ID interno | Preço mensal | Preço anual | Equivalente/mês no anual |
|---|---|---|---|---|
| **Livre** | `free` | Grátis | Grátis | Grátis |
| **Pro Mensal** | `essencial_mensal` | R$ 49,90 | — | — |
| **Pro Anual** | `essencial_anual` | — | R$ 454,80 | R$ 37,90 |
| **Studio Mensal** | `pro_mensal` | R$ 119,90 | — | — |
| **Studio Anual** | `pro_anual` | — | R$ 1.078,80 | R$ 89,90 |

### Livre (grátis) — o "gostinho" da separação
- 5 separações por mês.
- Separação **só em 2 faixas** (vocal + instrumental).
- Ouvir no mixer multicanal.
- Biblioteca de separações **local** (fica no navegador, não sincroniza).
- **Não tem:** download, BPM pela IA, voz guia, marcação de seções/loop, transposição de tom, pads, Modo Ao Vivo, biblioteca em nuvem, repertório, salvar/publicar na nuvem.

### Pro (R$ 49,90/mês ou R$ 37,90/mês no anual) — a equipe que toca toda semana
- 50 separações por mês.
- Separação em **2, 4 ou 6 faixas**.
- **Download em WAV e MP3.**
- BPM detectado pela IA.
- Voz guia (manual e automática).
- Pads.
- Marcar seções + loop infinito ao vivo.
- Transposição de tom.
- **Modo Ao Vivo até 4 aparelhos** (banda conecta o celular por QR Code; acompanha música/tom/letra e play/próxima). **Exclusivo do app desktop** (ver seção "Exclusivo do app desktop").
- Teleprompter.
- Biblioteca em nuvem + repertório (salvar/publicar).

### Studio (R$ 119,90/mês ou R$ 89,90/mês no anual) — quem leva o ao vivo a sério
- 150 separações por mês.
- Tudo do Pro, mais:
- **Modo Ao Vivo sem limite de aparelhos.**
- **A banda controla loop e seções pelo celular** (controle remoto total).
- Prioridade no processamento.

### Admin
Conta admin (`arynelson11@gmail.com`) tem tudo ilimitado e fura todas as travas.

Painel completo em `playbackstudio.com.br/admin` (rota própria, login próprio, só o email admin). Cinco abas com dados reais: Visão Geral (dinheiro que entra, que sai em IA e lucro estimado), Usuários (plano real, atividade, e economia por usuário: quanto cada um paga × quanto custa em IA = margem), Financeiro (receita e MRR do Asaas, por plano), Custos IA (gasto Replicate por mês/hardware/usuário) e Uso & Sinais (power users, pagantes sumidos, taxa de sucesso). Custo de IA por usuário é exato (cruza a tabela `predictions` com o Replicate); receita por usuário é aproximada pelo plano atual e exata do lançamento em diante via a tabela `payments` (gravada pelo webhook do Asaas).

### Exclusivo do app desktop (não tem na web)
Confirmado no código (2026-07-08):
- **Modo Ao Vivo (Host):** o botão HOST e o servidor local só existem no app Electron (`window.playbackDesktop?.isElectron` em `src/App.tsx`; `startLocalServer()` é nativo do desktop). Na web o botão HOST nem aparece. **A banda NÃO instala nada:** cada músico abre o **navegador do celular** no endereço/QR da rede local (ex.: `http://192.168.x.x:8080`) e acompanha player, mixer, pads, repertório, letra e cifra em tempo real. Quem o host liberar também controla (play/próxima, seções, loop); no Studio, controle total sem limite de aparelhos.
- **Tocar offline:** depois de carregar as músicas, o app desktop funciona sem internet (bom pra igreja com Wi-Fi ruim). A web depende de conexão.
- Resto (separação IA, mixer multicanal, pads, repertório, transposição, biblioteca) é **igual** na web e no desktop. O único recurso realmente exclusivo do app é o **Modo Ao Vivo**; offline é uma vantagem prática do desktop.

## 3. Posicionamento e marca (resumo; detalhe no Brand Book)

- **Categoria a possuir:** "a plataforma do domingo".
- **Frase central:** "Feito por quem toca."
- **Palavra a martelar:** DOMINGO.
- **Vilão:** "O Catálogo" (o gatekeeping de catálogos licenciados gringos).
- **Arquétipo:** Sage × Caregiver.
- **Paleta:** Laranja `#FF6B35` + Tinta (dark) `#121214` + Bone `#E8E8EC` + Musgo `#5B6B47`. Dark por padrão.
- **Logo:** PlayMark (triângulo de play com 3 cortes = faixas separadas) + wordmark "Playback" (semibold) + "Studio" (italic laranja).
- **Regra de copy:** nunca usar travessão (em dash). Termo canônico é "multitracks"/"separação de faixas" (não "stems" como termo principal). Seções são **marcação manual com atalhos**, não "auto-detecção".
- **Detalhe completo:** `PLAYBACK_STUDIO_BRAND_BOOK.md`.

## 4. Stack técnica

- **Frontend:** Vite + React 19 + TypeScript.
- **Backend:** Supabase (auth, banco, storage) + Cloudflare R2 (áudio) + endpoints serverless em `api/*` na Vercel.
- **IA de separação:** Replicate (htdemucs).
- **Pagamento:** **Asaas** (BRL, checkout hospedado, cartão, assinatura recorrente). Migrou do AbacatePay. Preço é definido no backend (`api/checkout.ts`), não em painel.
- **Deploy:** Vercel (web) + Electron builder (desktop Mac/Windows). Toda atualização sai junto para web e desktop.

## 5. Telas e features visíveis (material de referência para conteúdo)

Confirmado por prints do produto em produção (2026-07-08):

**Tela "Separador IA" (entrada):**
- Título "Separador IA", subtítulo "Motor de separação multi-faixa profissional".
- Botão "Carregar áudio & iniciar" aceitando **MP3, WAV ou AAC** (sem link).
- Biblioteca "Minhas Separações" com cards mostrando nº de faixas (ex.: 6 e 7 faixas), BPM e as cores dos canais.

**Tela ao vivo / repertório (o palco):**
- Barra superior: Repertórios, Faixas, Biblioteca, Metrônomo, Tom (transpose), Pré-contagem, Editar, Admin, Config, Início. Indicador "ONLINE".
- Repertório com as músicas em cards (capa, tom, BPM, duração).
- **Mixer multicanal de verdade** (no exemplo, 24 canais: BASS, guitarras EG, KEYS, ARP, CLICK, DRUMS, pads etc.), cada canal com fader, pan, volume e botões Mute/Solo.
- **Reprodutor de Pads:** abas Pads / Samples / Loops, pads na nuvem e grid cromático (C a B) com volume.
- Marcação de **Seções** ao vivo ("marcar Refrão/Verso e repetir trechos ao vivo"), Editor avançado, Letra/Cifra (teleprompter), Anotações.
- Transport ao vivo: Auto / Parar / Fade, com anterior / play / próxima.

## 6. Histórico de mudanças (para saber o que foi feito sem rodar tudo)

### 2026-07-08 — Painel /admin completo + fix de segurança de admin (implementado, aguardando deploy)
Nova página `playbackstudio.com.br/admin` (rota própria no SPA, code-split, login próprio, só `arynelson11@gmail.com`): 5 abas com dados reais. Usuários e planos passam a vir de `profiles.plan` de verdade (antes o RPC cravava `plan:'free'` pra todo mundo). Financeiro do Asaas ganhou MRR e receita por plano. Custos de IA por usuário: o endpoint `admin-stats?source=replicate` cruza as predictions do Replicate com a tabela `predictions` (dono de cada separação) e agrega custo por usuário; a aba Usuários mostra paga × custa × margem, com destaque pra quem está no vermelho. Nova tabela `public.payments` gravada pelo webhook do Asaas no `CHECKOUT_PAID` (best-effort, antes de limpar `pending_checkouts`) para histórico exato de receita por usuário do lançamento em diante. **Segurança:** removido o email admin `arynel11@gmail.com` (não pertencia ao dono, dava admin + tudo ilimitado + leitura de todos os perfis) de todos os gates: `api/_lib/auth.ts`, `src/lib/admin.ts` (nova allowlist única do front), RPC, RLS `Admin can read all profiles`, `user_has_cloud_library`, `App.tsx` e componentes/hooks que tinham o padrão cravado. Aposentado o antigo modal `AdminDashboard` (o botão ADMIN agora abre `/admin`). **SQL a rodar no deploy:** `db/supabase_payments.sql`, `db/supabase_rpc_setup.sql` (atualizado), e os gates SQL com o email corrigido (`supabase_admin_setup.sql`, `supabase_user_separations_plan_gate.sql`). **Atenção:** a mudança no `api/webhook/asaas.ts` é área de pagamento, testar no sandbox do Asaas antes de produção. Deploy sai para web (Vercel) + desktop (Electron).

### 2026-07-08 — Confirmado o que é exclusivo do app desktop (para marketing)
Auditoria de código + site pra separar web × desktop. **Único recurso exclusivo do app: Modo Ao Vivo (Host)** — botão HOST e servidor local só rodam no Electron (`src/App.tsx`, `startLocalServer`); web não tem o botão. A banda entra pelo **navegador do celular** (não instala app). Offline é vantagem prática do desktop. Todo o resto (separação, mixer, pads, repertório, transpose, biblioteca) é igual nas duas plataformas. Registrado na nova seção "Exclusivo do app desktop". Motivou um 2º post/carrossel só do app (Modo Ao Vivo). Prints guardados em `marketing/prints/` (web, app-desktop, app-celular).

### 2026-07-08 — Lançamento v1.3.17 no ar (deployado)
Push `8537b83` + tag `v1.3.17` no `origin/main`; deploy Vercel em Production com status Ready. Ambos os SQL rodados no Supabase (`predictions` antes, `user_separations_plan_gate` depois): 4 policies ativas na biblioteca em nuvem. Webhook Asaas verificado: `CHECKOUT_PAID` marcado, webhook ativo e `ASAAS_WEBHOOK_TOKEN` batendo com a Vercel. Fluxo pagamento → upgrade automático de plano confirmado ponta a ponta na config. Consolida as duas entradas abaixo (checkup de segurança + remoção do diagnóstico), que agora estão em produção.

### 2026-07-08 — Remoção do diagnóstico temporário (implementado, aguardando deploy)
Removido o sistema de trace de diagnóstico (`src/lib/pbTrace.ts`) que era debug temporário do bug de iOS (aba morrendo no download/load). Sumiu a caixa "DIAGNÓSTICO" que aparecia no topo da tela após reload. Removidas as chamadas em `main.tsx`, `useAudioEngine.ts` e `useCloudLibrary.ts`. Sem impacto funcional (era só log).

### 2026-07-08 — Checkup de segurança pré-lançamento (implementado, aguardando deploy)
Correções de código já feitas na branch local, ainda NÃO publicadas (deploy é bump+push+tag do @devops):
- **Segurança:** `admin-stats` passou a exigir admin; fechado IDOR em `check-separation` (tabela `predictions`); `checkout` passou a exigir auth (userId do JWT); `separate-audio` trava nº de faixas por plano.
- **Monetização (travas server-side):** biblioteca de separações em nuvem virou exclusiva de plano pago (RLS em `user_separations` + cliente roteia Livre pro local); "Salvar & Publicar" (sobe WAV pro R2) virou exclusivo de pago (gate em `insert-song`/`insert-stems`).
- **Stats admin:** migradas de AbacatePay para Asaas.
- **SQL a rodar no deploy:** `db/supabase_predictions.sql` (antes do deploy, já rodado) e `db/supabase_user_separations_plan_gate.sql` (depois do deploy do cliente).
- **Pendências menores:** download no Livre trava só no botão (bucket R2 público, decidido manter); `ALLOWED_ORIGINS` ausente (ok pro web, checar desktop).

> **Como manter este histórico:** cada mudança relevante de produto/infra ganha uma linha datada aqui, do mais novo para o mais antigo. Assim ninguém precisa reabrir o código pra saber o estado.
