# PLAYBACK STUDIO — Fatos Atuais (Fonte Única de Verdade)

> **Última atualização:** 2026-07-08
> **Para que serve:** este é o documento canônico dos fatos do produto. Qualquer pessoa ou agente que for criar conteúdo, copy, proposta ou tomar decisão DEVE ler este arquivo primeiro. Se algo em outro doc contradiz isto, este vence.
> **Regra:** toda alteração de produto (preço, plano, feature, provedor, stack) atualiza este arquivo no mesmo passo. Ver seção "Histórico de mudanças".
> **Fontes de verdade no código:** `src/lib/plans.ts` (tiers e capabilities), `src/components/PricingModal.tsx` (cards e preços), `api/checkout.ts` (preços reais cobrados), `api/separate-audio.ts` (cotas).

---

## 1. O produto em uma linha

Playback Studio separa qualquer música em faixas (multitracks) prontas para a equipe de worship chegar preparada no domingo. Feito por quem toca, para quem toca. A plataforma do domingo.

- **Domínio:** playbackstudio.com.br
- **Onde roda:** navegador (web) + **app de celular e tablet** (o site instalado na tela de início, PWA: iPhone/iPad via Compartilhar > Adicionar à Tela de Início, Android via "Instalar app"; desde 2026-11-09, v1.4.11) + app desktop (Electron) para Mac (Apple Silicon e Intel) e Windows, com Modo Ao Vivo por rede local. O app de celular tem tudo da web; Modo Ao Vivo (host) e uso offline seguem exclusivos do desktop.
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

Painel completo em `playbackstudio.com.br/admin` (rota própria, login próprio, só o email admin). Cinco abas com dados reais: Visão Geral (dinheiro que entra, que sai em IA e lucro estimado), Usuários (plano real, atividade, e economia por usuário: quanto cada um paga × quanto custa em IA = margem), Financeiro (receita e MRR do Asaas, por plano), Custos IA (gasto Replicate por mês/hardware/usuário) e Uso & Sinais (power users, pagantes sumidos, taxa de sucesso). Custo de IA por usuário é exato (cruza a tabela `predictions` com o Replicate). Receita por usuário: a aba Usuários mostra "Paga/mês" com o valor **exato** do último pagamento quando há registro na tabela `payments` (gravada pelo webhook do Asaas), caindo pro aproximado (plano × preço, marcado com ~) quando não há; e "Total pago" (LTV, tudo que o usuário já pagou). O RPC `get_admin_dashboard_stats` agrega `payments` por usuário (`total_paid` + mensal-equivalente do último pagamento).

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

### 2026-11-09: App de celular/tablet + layout que se adapta a qualquer tela [v1.4.11]
**App instalável (PWA):** o manifesto estava com `display: 'browser'` DE PROPÓSITO (distribuição era só o desktop). Agora `standalone`, `orientation: 'any'`, ícones quadrados de fundo cheio (`public/pwa-192.png`, `pwa-512.png` também como maskable, `apple-touch-icon.png` 180), barra de status do iPhone `black` (o app fica abaixo do relógio; o CSS não trata safe-area) e `maximum-scale=1` (iPhone não dá zoom sozinho ao tocar em campo). Chrome confirma: zero erro de instalabilidade. Instalação: `src/hooks/usePWAInstall.ts` (captura o `beforeinstallprompt` no nível do módulo pra não perder; detecta iPadOS que se diz Mac), `src/components/InstallAppGuide.tsx` (botão no Android, passo a passo do Safari no iPhone/iPad, QR code no computador) na página `/download` (seção "No celular e no tablet") e `src/components/InstallAppBanner.tsx` no app (só celular/tablet fora do app instalado, aparece após 15 s, "Agora não" esconde 30 dias). Não testado em aparelho real: login com Google dentro do app instalado no iPhone (e-mail funciona).
**Layout por tamanho de tela, não por tipo:** o app decidia pelo `pointer-coarse` (qualquer tela de toque, até iPad grande deitado, caía no layout empilhado de celular, com a PÁGINA inteira rolando e o mixer saindo da tela). Agora há 3 variantes em `src/index.css`: `compact` (largura < 640: celular em pé, layout de celular), `tight` (≥ 640 e altura ≤ 860: notebook/iPad deitado, enxuga a vertical) e `short` (≥ 640 e altura ≤ 560: celular deitado, bem compacto). Raiz do app é sempre uma tela fixa (`h-[100dvh]`), só áreas internas rolam. Cabeçalho: rótulos viram ícones por largura (só ícone < 1280, 4 principais com rótulo ≥ 1280, todos ≥ 1680), sem rolagem lateral nele (cortaria os menus suspensos); todo botão ganhou `title`/`aria-label`. Celular deitado: transporte vai pro cabeçalho (modo Auto/Parar/Fade vira 1 botão que alterna), repertório 64 px, seções compactas, pads 4×3, capa do fader menor via `--knob-half`. Mixer: largura dos canais calculada por `ResizeObserver` pra caber um número inteiro (nada pela metade) + encaixe ao rolar no toque. Pads encolhem pra caber (grade com `grid-rows`). Separador: cabeçalho compacto, coluna de controles 156 px no celular em pé, altura das faixas medida na área real (antes supunha cabeçalho de 144 px) e recalculada ao girar, controles e ondas com rolagem vertical sincronizada (com compensação da barra horizontal). Nativo: sem overscroll, sem destaque cinza no toque, `touch-action: manipulation`, botões sem seleção de texto, janela de Novidades com altura máxima e rolagem. Verificado com fotos no Chrome headless em 8 tamanhos (iPhone em pé/deitado, SE, Pro Max, iPad em pé/deitado, 1280×720, 1920×1080) com repertório de teste de 24 canais: página nunca rola inteira, zero erro de JS; `tsc -b` limpo, ESLint sem problema novo.

### 2026-11-09: Click sincronizado no Separador + upload no iPad [v1.4.10]
**Upload no iPad:** o irmão do Ary não conseguia separar pelo iPad: erro "[Vercel API 400] Invalid contentType" logo no envio pro R2. Causa: `src/lib/r2.ts` mandava o `file.type` cru do navegador, e o `api/get-upload-url.ts` só aceita `audio/*`, `image/*` ou `application/octet-stream`. No iPad, arquivo escolhido no app Arquivos pode vir como `video/mp4`, `video/quicktime`, com maiúscula ou com parâmetro. Fix: `src/lib/uploadContentType.ts` normaliza o tipo (pela extensão; vídeo vira `audio/mp4`, já que a separação usa só a trilha de áudio; desconhecido vira `application/octet-stream`). A regra do servidor continua igual. Os logs da Vercel mostram 2 erros 400 nesse endpoint em 2026-11-09, mas o tipo enviado não aparece no log.
**Click do Separador fora do tempo, 4 causas:** (1) o 1º click era sempre colado em 0:00.000 do arquivo, nunca no 1º tempo da música; (2) o BPM nunca era detectado no Separador (padrão 120, sempre inteiro), e meio BPM de erro dá ~0,75 s de atraso no fim de 3 min; (3) o botão SYNC procurava a faixa `'click'`, mas o id é `'metronome'`, então nunca fazia nada; (4) cada faixa tocava num `<audio>` separado, que começam com dezenas de ms de diferença entre si a cada play/seek. Fix: `src/lib/beatGrid.ts` mede BPM com decimais + posição do 1º tempo + tempo forte na faixa de bateria (busca conjunta período/fase na música inteira, sem deriva; testado em áudio sintético com erro < 2,1 ms e na bateria real da demo, cravando 135,04 BPM com < 6 ms nos bumbos). `generateManualClickTrackFromSample` ganhou o parâmetro `grid` e posiciona cada click pelo tempo absoluto. O Separador agora toca tudo por `src/lib/syncedTrackPlayer.ts` (AudioBuffers no mesmo AudioContext, todo play/seek no mesmo tick usa o mesmo `start(when)`, então a sincronia é por amostra). As faixas são criadas de forma incremental: gerar o click não recarrega mais as outras faixas nem para a música. O click entra na hora e sobe pro R2 em segundo plano. O SYNC (±10 ms) regrava o click com o deslocamento. No modal de BPM entraram "Detectar BPM da música" (só planos pagos, igual antes: `canUseBpmDetection`; abre medindo sozinho se o BPM ainda está no padrão 120) e "Mover o 1". Pra todos os planos, o click é alinhado à fase da música no BPM escolhido. O click "IA" do player principal (`MetronomeModal`) usa a mesma grade (antes também começava em 0:00). Player principal (`useAudioEngine.play`): o `await` do nó de tom saiu de dentro do laço de `start()`, porque na 1ª vez tocando transposto as faixas começavam defasadas.
**Atenção, memória no iPad:** o Separador agora decodifica cada faixa inteira (como o player principal já fazia). 6 faixas de 3,5 min ficam em ~500 MB.
**Detalhe do iPad:** o arquivo do irmão era **MP3** (não vídeo). Ou seja, o Safari do iPad mandou um tipo fora de `audio/*` pra um `.mp3`. O fix cobre isso (tipo recusado cai pra extensão: `.mp3` vira `audio/mpeg`). Pra próxima, `api/get-upload-url.ts` passou a logar o tipo recusado + extensão (`[get-upload-url] contentType recusado:`), visível no `vercel logs`.
**Verificado antes do deploy:** `tsc -b` limpo; ESLint sem nenhum problema novo (41 antes, 41 depois, todos antigos); `npm run build` ok; teste no Chrome headless com as 6 faixas reais da demo pelo WaveSurfer + `SyncedTrackPlayer`: diferença entre faixas de 0 ms após play, após o click entrar com a música tocando, após seek e após replay; click gerado a ~1 ms da grade; zero erro no console. Curiosidade: o decodificador de MP3 do Chrome pôs o 1º tempo 13 ms antes do decodificador do macOS (`afconvert`). Por isso a grade é medida no MESMO áudio decodificado que está tocando.
**Segurança (mesma release):** `.env.vercel` e `.env.vercel.prod` saíram do git (estavam versionados no repo público apesar do `.gitignore`; os tokens OIDC dentro já tinham expirado em 2026-02-22). `electron/main.ts`: o `setWindowOpenHandler` só repassa `http(s)` pro sistema abrir (antes qualquer protocolo). Revisados e OK: endpoints `/api/*` (auth, dono, anti-SSRF no `upload-stem-from-url`, chave do R2 presa à pasta do usuário), comandos remotos do modo ao vivo (só IPs aprovados, IP vem do socket), isolamento do Electron. Nenhum segredo real nos arquivos versionados; no histórico do `main` (264 commits) não aparecem chaves do Replicate, Asaas, R2 nem service_role.
**Ambiente:** repo saiu do iCloud (`~/Documents/...`) pra `~/Developer/multitracks` (clone limpo). O iCloud gerava cópias-lixo (`.git/refs/heads/main 2`, `.git/index 2`, `.claude/settings.local 2.json`) e cancelava leituras em lote ("Operation canceled"). O tsc/ESLint travando com 0% de CPU é do Node 26.1.0 local, não do iCloud. Com Node 24 (`~/.nvm/versions/node/v24.19.0`) o `tsc -b` roda em 8 s e o build em 20 s.

### 2026-08-19 — Assinatura ad-hoc no Mac + instrução correta pro erro "app está danificado" [v1.4.8]
Usuário reportou (amigo dele, Mac M1) que o app não abre e mostra "app está danificado". Causa raiz: `electron-builder.yml` tinha `identity: null` no bloco `mac`, ou seja o `.app` saía sem NENHUMA assinatura, nem ad-hoc. Apple Silicon exige assinatura pra rodar qualquer binário; sem ela o Gatekeeper classifica como corrompido (erro mais severo, sem opção de "abrir mesmo assim") em vez do aviso mais brando de "desenvolvedor não identificado". Fix: `identity: "-"` (assinatura ad-hoc, grátis, sem conta Apple Developer) + `hardenedRuntime: false` (evita crash por falta de entitlements, já que sem notarização o hardened runtime não traz benefício). Não é garantia 100% em toda versão do macOS — a solução garantida continua sendo `xattr -cr` no Terminal. Também corrigido o texto de ajuda em `src/components/DownloadPage.tsx` (dizia só "clique com o botão direito", que não resolve o erro "danificado"): agora tem o passo a passo certo (botão direito → Ajustes do Sistema → Terminal com `xattr -cr "/Applications/Playback Studio.app"` como último recurso) e um bug de encoding onde o símbolo  do menu Apple sumia (`<strong></strong>` vazio) virou texto "Menu ". **Publicado:** release v1.4.8 saiu em 2026-08-19 (run 32301328768, tudo verde). O log do build no macOS confirma a assinatura aplicada nos dois apps (`identityName=-` em `release/mac` e `release/mac-arm64`), com notarização pulada como esperado. Detalhe importante: v1.4.4 até v1.4.7 foram releases só de web, com o build desktop cancelado de propósito, então o instalador publicado estava parado na v1.4.3 (sem nenhuma assinatura) desde 2026-07-09. A v1.4.8 é o primeiro instalador novo desde então, e é a primeira versão assinada de fato.

### 2026-07-09 — Linha de transporte centralizada ao quebrar linha [v1.4.7]
Depois do fix de causa raiz da v1.4.6 (`md:flex-1` → `md:flex-auto`), a linha de transporte parou de cortar mas ficou feia visualmente: as duas zonas laterais (BPM/TOM e VOZ/SYNC/MASTER) usavam `justify-end`/`justify-start` para "encostar" no bloco central — isso fazia sentido numa linha só, mas quando o conteúdo quebrava pra 2 linhas, a zona que sobrava sozinha na segunda linha crescia (`flex-auto`) pra ocupar a linha toda e ficava com o conteúdo jogado pra um lado só, sobrando um vão vazio enorme do outro lado (feedback do usuário com print: "está comendo bordas"). Simplificado: as duas zonas viraram `flex-none` (sem crescer, tamanho = conteúdo) e o container pai usa `justify-center` sempre (não só `justify-center md:justify-between`) — agora o grupo inteiro fica centralizado numa linha só quando cabe, e cada linha fica centralizada também quando quebra, sem vão vazio de um lado. Padding lateral (`px-2 md:px-4` → `px-3 sm:px-4`) e gaps (`gap-x-2 gap-y-2 md:gap-5` → `gap-x-3 gap-y-3 sm:gap-x-5`) também aumentados pra não ficar "comendo borda". Validado visualmente no Chrome real em ~820px (quebra em 2 linhas, ambas centralizadas) e ~1200px (cabe numa linha, centralizado). Só afeta o separador (web); não muda preço/plano/stack.

### 2026-07-09 — Separador de faixas responsivo (mobile/tablet) [v1.4.6]
Fix de produto no `src/components/SeparatorStudio.tsx` (tela de mixer/separação): em telas estreitas o header cortava/sobrepunha botões e o nome da música, e a área de waveform vazava da tela. Corrigido: (1) header — grupos de botões (voltar / DL·salvar·exportar) viraram `shrink-0` (tamanho fixo, nunca comprimem) e o título virou `flex-1 min-w-0` (é ele que trunca com "..." quando falta espaço, nunca mais sobrepõe os botões). (2) Mixer e waveform continuam **sempre lado a lado** (não empilha, por pedido explícito — testado e revertido depois de uma tentativa de empilhar). (3) Waveform nunca mais comprime a música inteira pra caber na tela: a área agora tem largura real = duração × 40px/s (`WAVEFORM_PX_PER_SECOND`) e rola horizontalmente até o fim da música, com régua/playhead/marcadores de voz vivendo no mesmo wrapper (tudo rola em sincronia). Mixer mantém scroll vertical próprio conforme a quantidade de canais. Também: `overflow-x: hidden` em `html, body` (`src/index.css`) pra travar qualquer vazamento horizontal da página inteira em mobile.

**Causa raiz do corte na linha de transporte (BPM/TOM/play/voz/sync/master), achada só na v1.4.6 depois de duas tentativas:** as zonas laterais dessa linha usavam `md:flex-1` (Tailwind: `flex: 1 1 0%`, ou seja **flex-basis 0**) combinado com `min-w-0`. O algoritmo de quebra de linha do CSS flexbox decide quebrar ANTES de aplicar o `flex-grow`, usando o flex-basis de cada item como tamanho hipotético — com basis 0, o browser sempre "acha" que os itens cabem numa linha só (0+0+0 < qualquer largura) e nunca aciona o wrap, deixando o conteúdo real (os botões) vazar/cortar em vez de quebrar. Isso reproduzia em QUALQUER largura ≥`md` (768px), em qualquer navegador (Chrome e Safari, confirmado via DevTools responsive e device real) — não era cache, não era bug de um device específico. `flex-wrap` sozinho (adicionado na v1.4.5) não resolvia porque o problema não era a propriedade wrap em si, era o cálculo de tamanho hipotético zerado. Fix: trocado `md:flex-1` → `md:flex-auto` (`flex: 1 1 auto`, basis real/baseado em conteúdo) nas duas zonas — mantém o "encostar no centro" visual, mas agora o wrap é calculado com o tamanho real do conteúdo. Validado nas larguras exatas que cortavam (768px, ~932-944px) via Chrome real: agora cabe tudo numa linha (768-944 na real tinha espaço de sobra, só não era usado) ou quebra limpo pra segunda linha, sem cortar nada. **Lição:** `flex-1`/`flex-basis:0` quebra a heurística de wrap do flexbox — se um item precisa poder quebrar linha E crescer, usar `flex-auto`, nunca `flex-1`.

Só afeta o separador (web); não muda preço/plano/stack.

### 2026-07-09 — Email de contato/suporte no site [v1.4.3]
Adicionado o email de suporte `contatoplaybackstudio@gmail.com` como canal de contato no rodapé da landing (`src/components/LandingPage.tsx`, link "Email" via `mailto:`, ao lado do WhatsApp). Este é o email oficial de suporte do Playback Studio daqui pra frente. Só afeta a landing web.

### 2026-07-09 — Contato/suporte por WhatsApp no site [v1.4.2]
Adicionado contato de WhatsApp na landing (`src/components/LandingPage.tsx`): botão flutuante fixo verde no canto inferior direito ("Fale com a gente") + link "Suporte" no rodapé. Número `5522997249896` via `wa.me` com mensagem pré-preenchida. Ícone WhatsApp é SVG do glifo oficial (lucide não tem ícone de marca). Só afeta a landing web.

### 2026-07-09 — Player da landing com stems reais + token durável [v1.4.1]
O player de demonstração da landing (`src/components/DemoMixer.tsx`) tocava tudo sintetizado via Web Audio (osciladores), o que soava artificial e feio. Passou a carregar **6 stems reais** separados no próprio Playback Studio (`public/demo/{vocais,bateria,baixo,guitarra,teclado,outros}.mp3` — trecho de 24s, mono, 96kbps, ~282KB cada, ~1.7MB total) e tocá-los em loop sincronizado. Mute/solo agora cortam/isolam a faixa real (cada stem tem seu ganho → analyser → master com compressor + boost de 1.5x, já que stems separados vêm baixos); os VU meters reagem ao áudio real. Canais reduzidos de 8 → 7 (removidos Click/Piano/Pad que não existiam como stem). Paths via `import.meta.env.BASE_URL`. **Auth durável:** `getAuthHeaders()` em `src/lib/supabase.ts` passou a renovar o token de sessão antes de expirar (janela de 60s), eliminando o erro "401 Invalid or expired token" no upload/separação quando a sessão do desktop ficava velha (commit `17bdd9c`). Deploy: web (Vercel) + desktop (Electron Mac AS/Intel + Win).

### 2026-07-08 — Painel /admin completo + fix de segurança de admin [v1.4.0]
Nova página `playbackstudio.com.br/admin` (rota própria no SPA, code-split, login próprio, só `arynelson11@gmail.com`): 5 abas com dados reais. Usuários e planos passam a vir de `profiles.plan` de verdade (antes o RPC cravava `plan:'free'` pra todo mundo). Financeiro do Asaas ganhou MRR e receita por plano. Custos de IA por usuário: o endpoint `admin-stats?source=replicate` cruza as predictions do Replicate com a tabela `predictions` (dono de cada separação) e agrega custo por usuário; a aba Usuários mostra paga × custa × margem, com destaque pra quem está no vermelho. Nova tabela `public.payments` gravada pelo webhook do Asaas no `CHECKOUT_PAID` (best-effort, antes de limpar `pending_checkouts`) para histórico exato de receita por usuário do lançamento em diante. **Segurança:** removido o email admin `arynel11@gmail.com` (não pertencia ao dono, dava admin + tudo ilimitado + leitura de todos os perfis) de todos os gates: `api/_lib/auth.ts`, `src/lib/admin.ts` (nova allowlist única do front), RPC, RLS `Admin can read all profiles`, `user_has_cloud_library`, `App.tsx` e componentes/hooks que tinham o padrão cravado. Aposentado o antigo modal `AdminDashboard` (o botão ADMIN agora abre `/admin`). A aba Usuários lê a tabela `payments` para receita **exata** por usuário (Paga/mês exato quando há pagamento registrado + Total pago/LTV), caindo pro aproximado (plano × preço) quando não há histórico. **SQL rodado no deploy:** `db/supabase_payments.sql`, `db/supabase_rpc_setup.sql` (atualizado, inclui agregação de payments por usuário) e os gates SQL com o email corrigido (`supabase_admin_setup.sql`, `supabase_user_separations_plan_gate.sql`). Deploy em produção (v1.4.0): web (Vercel) + desktop (Electron Mac AS/Intel + Win).

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
