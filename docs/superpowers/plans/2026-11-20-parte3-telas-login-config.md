# Parte 3, faixa B: login e Configurações no layout do palco. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** levar o login (entrar, criar conta, recuperar senha e criar nova senha) e as Configurações (abas Perfil, Geral, Buses, Novidades, Assinatura e Sobre) para a linguagem do palco novo, sem mudar o que essas telas fazem, e entregar antes as peças novas do kit (`src/components/ui/`) que as faixas B e C usam.

**Architecture:** primeiro o kit (campo de texto, área de texto, seletor, interruptor, abas, aviso, e os limites conhecidos do Chip e do Segmented que as telas precisam). Depois cada tela troca as classes antigas (`daw-panel`, `primary`, `tinta`, `laranja`, `warm-*`, `text-muted`) pelas peças do kit e pelos tokens `ps-*`, mantendo cada handler, prop, texto de botão, campo e estado. Cada tarefa começa por um teste de "nada some" (inventário do que a tela faz hoje) que passa antes e depois, mais o teste do que muda no visual (RED antes, GREEN depois). O verificador de layout ganha estados das telas novas.

**Tech Stack:** Vite 7, React 19, TypeScript 5.9, Tailwind v4.2 (tokens `ps-*` em `src/styles/ps-tokens.css`), Vitest 4 + jsdom + Testing Library, Chrome headless (`scripts/verify-layout/`).

**Spec:** `docs/superpowers/specs/2026-11-19-parte3-telas-e-livre-design.md` (seções 2.5, 4, 9, 11, 12) e `docs/superpowers/specs/2026-11-15-palco-ao-vivo-design.md` (5b). Regras da faixa: `~/playback-studio-work/parte3-faixas/regras-comuns.md`. Visual: mockup v5 (`.superpowers/brainstorm/14859-1794743390/content/palco-desktop-v5.html`, no repo principal).

## Global Constraints

- Muda a cara, não o que o app faz: nenhuma função some, nenhum botão perde a ação, nenhuma prop ou handler muda de sentido.
- Linguagem: tokens `ps-*`, Inter + JetBrains Mono (`font-ps-sans`, `ps-num`), laranja = ligado ou ação principal, branco = armado, cor da seção = seção, âmbar = alerta. Sem o dourado `primary` em tela nova.
- Alvo de toque de 44 px (`min-h-ps-touch`), largura pelo texto (nunca `w-` fixo com texto dentro), nenhum texto cortado ou encostando.
- Nada de caminho absoluto "/" novo em `src/`; nada de `window.prompt`, `window.alert` ou `window.confirm` novo (os que já existem ficam: "Excluir conta" com `prompt` é decisão do dono, FATOS linha 210).
- Português do Brasil, nenhum travessão (U+2014) em linha adicionada, "multitracks" e "separação de faixas".
- Não tocar: `src/App.tsx`, `src/lib/plans.ts`, `offer.ts`, `checkout.ts`, `productEvents.ts`, `src/lib/livre*`, `src/hooks/useLivre.ts`, `src/components/livre/*`, `PricingModal.tsx`, `LibraryModal.tsx`, `SeparatorStudio.tsx`, `SeparationUsageMeter.tsx`, `api/*`, `db/*`, `src/admin/*`, `useAudioEngine.ts`, `src/audio/*`, `src/workers/*`, `src/components/stage/*` (só importar), telas da faixa C. Também `SubscriptionPanel.tsx` (a frente 1b muda o texto dele, D13 do plano dela; mexer aqui dá conflito) e `src/appWiring.test.ts` (a 1b mexe).
- Um commit por tarefa: `git commit -m "..." -- <arquivos>`. FATOS e DESIGN_SYSTEM no mesmo passo, entrada datada 2026-11-20 marcada "[NÃO PUBLICADO]".

## Review Focus

1. Login no celular (390 px) e na janela estreita do app de computador: o formulário cabe sem rolar de lado e sem texto cortado. Pino: estados `login` e `novasenha` do verificador em 390x844 (T8).
2. As Configurações abertas pelo aviso SAÍDAS do palco caem na aba Geral, rolando até as saídas, inclusive com a aba Buses some quando o modo sai de "Tudo junto". Pino: teste `aviso SAÍDAS abre na Geral` (T4).
3. Seis abas numa janela de 390 px: as abas descem de linha, nenhuma cortada. Pino: `Tabs` com `flex-wrap` e `shrink-0` (T1) e o estado `config-geral` em 390x844 (T8).
4. Interruptor do pan automático com a música tocando: continua passando pela confirmação de mandar o click pro PA. Pino: teste `pan automático passa pela confirmação` (T5).
5. Campo com erro: o leitor de tela ouve o erro (aria-invalid e aria-describedby), e o erro do formulário da nova senha continua com `role="alert"`. Pino: testes do TextField (T1) e de `passwordRecovery.test.tsx` (T3).

---

### Task 1: Peças novas do kit

**Files:**
- Create: `src/components/ui/Field.tsx` (TextField, TextArea e Select, com a moldura comum de rótulo, ajuda e erro), `src/components/ui/Switch.tsx`, `src/components/ui/Tabs.tsx` (Tabs e TabPanel), `src/components/ui/Notice.tsx`
- Modify: `src/components/ui/index.ts`, `src/components/ui/Chip.tsx` (anel de foco laranja e visual de desligado), `src/components/ui/Segmented.tsx` (opção desligada apagada, a marcada não), `src/components/ui/ui.test.tsx`, `DESIGN_SYSTEM.md` seção 2.6, `src/components/settings/AudioOutputsSection.tsx` (tira o contorno local do Segmented desligado, que o kit passa a fazer)
- Fora do repo: `~/playback-studio-work/parte3-faixas/kit-novo.md` (API de cada peça nova e o commit)

**Interfaces (Produces):**
- `TextField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FieldProps & { icon?: ReactNode; trailing?: ReactNode; inputClassName?: string })`
- `TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & { textareaClassName?: string })`
- `Select(props: SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { selectClassName?: string })`, com as `<option>` como filhos
- `FieldProps = { label: ReactNode; hideLabel?: boolean; help?: ReactNode; error?: ReactNode; className?: string }` (o `className` vai no contêiner do campo inteiro)
- `Switch(props: { checked: boolean; onChange(checked: boolean): void; label: ReactNode; description?: ReactNode; hideLabel?: boolean; disabled?: boolean; id?: string; className?: string })`: `button role="switch"`
- `Tabs<T extends string>(props: { id: string; tabs: TabItem<T>[]; value: T; onChange(v: T): void; 'aria-label': string; className?: string })`, `TabItem<T> = { value: T; label: string; disabled?: boolean }`; `TabPanel(props: HTMLAttributes<HTMLDivElement> & { tabsId: string; value: string })`; ids `tabId(id, value) = \`${id}-tab-${value}\`` e `tabPanelId(id) = \`${id}-panel\``
- `Notice(props: HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'alert' })`

- [ ] Testes novos em `ui.test.tsx` (RED): TextField liga rótulo, ajuda e erro (`getByLabelText`, `aria-describedby` com os dois ids, `aria-invalid="true"` só com erro, anel âmbar `inset-ring-ps-alert-line` no lugar do `inset-ring-ps-line`, fonte de 16 px `text-ps-md`, alvo `min-h-ps-touch`, ícone `aria-hidden`); TextArea e Select com as mesmas ligações; `hideLabel` mantém o nome acessível; Switch `role="switch"` com `aria-checked`, clique e Espaço chamam `onChange(!checked)`, desligado não chama, alvo de 44 px; Tabs `tablist` com nome, `aria-selected`, só a selecionada no Tab, setas com volta pulando a desligada, Home e End, clique na já selecionada não chama, `aria-controls` igual ao id do `TabPanel` e `aria-labelledby` do painel igual ao id da aba; Tabs com `flex-wrap` e abas `shrink-0`; Notice info e alert sem par de utilidades conflitantes; Chip com `focus-visible:outline-ps-or` e `disabled:opacity-35`; opção desligada não marcada do Segmented com `opacity-35`, a marcada desligada sem.
- [ ] Rodar `npx vitest run src/components/ui/ui.test.tsx`: falha (peças não existem).
- [ ] Implementar as peças (classes literais, variação substitui a base, `shrink-0`, sem largura fixa).
- [ ] Rodar `npx vitest run src/components/ui src/components/settings`: passa.
- [ ] DESIGN_SYSTEM 2.6: uma subseção por peça nova e os limites conhecidos atualizados. Commit. Escrever `kit-novo.md`. `SendMessage(to: "main")` com o commit.

### Task 2: Login (`AuthPage.tsx`: entrar, criar conta, recuperar senha)

**Files:** Modify `src/components/AuthPage.tsx`; Create `src/components/AuthPage.screens.test.tsx`; `DESIGN_SYSTEM.md` (3.5 "Auth column header" passa a apontar a linguagem nova), `PLAYBACK_STUDIO_FATOS.md`.

Inventário (o que tem de continuar): coluna da marca só a partir de `lg` (Wordmark, "pronto pro" + DomingoMark, título "Toda música, todo domingo, na sua mão.", texto, os 3 passos, "Feito por quem toca."); no celular a Wordmark no topo; título e subtítulo por modo; "Continuar com Google" (fora do modo recuperar) com o "ou"; erro e mensagem; campo Email (placeholder `seu@email.com`, `required`, `type=email`); Senha fora do recuperar (placeholder `Sua senha`, `minLength 6`, "mín 6"); botão de enviar com o texto por modo e o carregando (desligado); "Esqueceu sua senha?", "Não tem conta? Criar conta" e "Já tem conta? Entrar"; deep link do desktop (sem mudança).

- [ ] Teste "nada some" por modo (passa antes da mudança): textos, campos com atributos, botões e o que cada um chama (`signInWithPassword`, `signUp`, `resetPasswordForEmail`, `signInWithOAuth`), carregando desliga o botão, erro e mensagem aparecem.
- [ ] Teste do visual (RED): campos achados pelo rótulo (`getByLabelText('Email')`, `getByLabelText('Senha')`), erro num `Notice` âmbar, botão de enviar `Button primary` com nome acessível mesmo carregando, nenhuma classe antiga (`tinta`, `laranja`, `warm-`, `font-display`).
- [ ] Trocar o visual com `TextField`, `Button`, `Notice`, tokens `ps-*`. `AuthPage.recovery.test.tsx` continua passando sem mudança.
- [ ] Rodar os dois testes; FATOS e DESIGN_SYSTEM; commit.

### Task 3: Criar nova senha (`NewPasswordPage.tsx`)

**Files:** Modify `src/components/NewPasswordPage.tsx`; Modify `src/lib/passwordRecovery.test.tsx` (só acrescenta o teste do visual).

- [ ] Teste do visual (RED): campos pelo rótulo (`Nova senha`, `Repita a nova senha`) dentro do kit, `Salvar nova senha` como `Button primary`, Cancelar como `Button ghost`, erro com `role="alert"` em âmbar, sem `tinta`/`laranja`/`warm-`.
- [ ] Trocar o visual; os testes de hoje do arquivo passam sem mudança. Commit.

### Task 4: Casca das Configurações (`SettingsModal.tsx`)

**Files:** Modify `src/components/SettingsModal.tsx`; Create `src/components/SettingsModal.test.tsx` (com `useAuth`, `useSettings`, `SeparationUsageMeter`, `SubscriptionPanel`, `PricingModal`, `AudioOutputSelect` e `ProfileTab` simulados).

Decisão: a casca não usa o `StageDialog` (largura máxima de 512 px contra os 672 de hoje, título obrigatório, Esc na captura da janela fecharia as Configurações com os Planos abertos por cima, e o `z-[120]` dele ficaria por cima do `PricingModal`, `z-[110]`). Fica a camada própria (`z-[100]`, toque fora fecha, sem Esc, como hoje) com o mesmo visual: `Panel variant="pop"`, fundo `bg-black/60`, X do palco de 44 px.

- [ ] Teste "nada some": fechado não renderiza; abas por modo (com Buses só em "Tudo junto"); clicar em cada aba mostra o conteúdo; X e toque fora chamam `onClose`, toque dentro não; aviso SAÍDAS (`focusSection="outputs"`) abre na Geral; sair de "Tudo junto" com Buses aberta volta pra Geral.
- [ ] Teste do visual (RED): `role="dialog"` com nome "Configurações", `tablist` "Abas das Configurações" com as abas do kit, painel `tabpanel` ligado à aba, X com `aria-label="Fechar"`, sem `daw-panel`, `lcd-display` nem `primary`.
- [ ] Implementar com `Tabs`, `TabPanel`, `Panel`, `Button` e `Icon`. Commit.

### Task 5: Aba Geral e aba Buses

**Files:** Modify `src/components/SettingsModal.tsx`, `src/components/AudioOutputSelect.tsx`, `src/components/settings/AudioOutputsSection.tsx` (MapSelect vira `Select` do kit); Create `src/components/settings/SettingRow.tsx` (linha título, descrição e controle à direita, que desce embaixo em tela estreita); Test `src/components/SettingsModal.test.tsx`, `src/components/settings/settings.test.tsx`, Create `src/components/AudioOutputSelect.test.tsx`.

- [ ] Teste "nada some": chave do Palco primeiro (antes de "Ver tutorial", que fecha e chama `onReplayTour`); seletor do aparelho junto das saídas (`data-settings-outputs`); pan automático só em "Tudo junto", chama `updateSetting('autoPan')` passando por `needsCueToPaConfirm` e `window.confirm` quando tocando; "Grade de Compasso (Em breve)" ligado e sem ação; "Abrir Painel" só pra admin (fecha e chama `onOpenAdmin`); Buses: sem canais mostra "Carregue uma música primeiro para ver os canais.", com canais um seletor por canal com o nome organizado e `onSetChannelBus(id, valor)`.
- [ ] Teste do visual (RED): pan automático e grade como `Switch` (`role="switch"`), seletores do aparelho, do mapa e dos buses como `Select` do kit (rótulo ligado), Ver tutorial e Abrir Painel como `Button`.
- [ ] Implementar. `appWiring.test.ts` continua passando (ordem e distância de 1500 caracteres). Commit.

### Task 6: Aba Perfil (`ProfileTab.tsx`)

**Files:** Modify `src/components/ProfileTab.tsx`; Create `src/components/ProfileTab.test.tsx` (`uploadToR2`, `fetchCancelPreview` simulados).

Inventário: foto (toca e abre o seletor de arquivo, envia, carregando, erro com `alert` de hoje), nome e e-mail; Nome de exibição com Salvar (carregando, "Nome salvo!", "Erro ao salvar o nome."); Senha: duas caixas e Atualizar (desligado sem senha, mínimo 6, "As senhas não conferem.", "Senha atualizada!", erro); Plano e "Membro desde" com "Fazer upgrade" só no Livre; "Sair de todos os dispositivos" (`confirm` de hoje); "Excluir minha conta" com o `prompt` EXCLUIR de hoje (decisão do dono), sem mudar o fluxo.

- [ ] Teste "nada some" cobrindo cada item acima (passa antes).
- [ ] Teste do visual (RED): campos pelo rótulo (`Nome de exibição`, `Nova senha`, `Confirmar nova senha`), botões do kit, sem `primary`, `text-muted`, `bg-black/40`.
- [ ] Implementar. Commit.

### Task 7: Abas Novidades, Assinatura e Sobre

**Files:** Modify `src/components/SettingsModal.tsx`; Test `src/components/SettingsModal.test.tsx`.

- [ ] Teste "nada some": Novidades com a atualização do desktop ("Baixar" chama `onInstallUpdate`) e cada entrada do `CHANGELOG` (título, versão e itens); Assinatura com o nome do plano, a frase por plano, `SeparationUsageMeter` com `plan` e `isAdmin`, `SubscriptionPanel` com `onChanged` chamando `refreshPlan` e `onOpenPricing` abrindo os Planos, e o botão "Ver Planos & Assinar" ou "Alterar Plano"; Sobre com a Wordmark, "A plataforma do domingo · v<versão>" e a frase.
- [ ] Teste do visual (RED): moldura da Assinatura em `Panel`, botões do kit, versões em `ps-num`, sem `primary` nem `zinc-`.
- [ ] Implementar (sem tocar no `SeparationUsageMeter` nem no `SubscriptionPanel`). Commit.

### Task 8: Verificador de layout com as telas novas

**Files:** Modify `scripts/verify-layout/run.mjs` (lista de estados e um `--only` que aceita `390x844`), `scripts/verify-layout/fixture.ts` (estados novos no `ESTADOS`), `scripts/verify-layout/main.tsx`; Create `scripts/verify-layout/telasB.tsx` (páginas do login e das Configurações com dados de teste) e `scripts/verify-layout/fakes/` (simulações de `useAuth`, `supabase` e `r2` só neste build); Modify `scripts/verify-layout/vite.config.ts` (os apelidos das simulações) e `README.md`.

Estados: `login`, `criarconta`, `recuperar`, `novasenha`, `config-perfil`, `config-geral`, `config-buses`, `config-novidades`, `config-assinatura`, `config-sobre`. Tamanhos: 1024x740, 1280x800, 1920x1080 e 390x844.

- [ ] Rodar o verificador nos estados novos: sem falha. Rodar os estados antigos: continuam passando. Commit.

### Task 9: Portão e entrega

- [ ] Com `caffeinate -i`: `npx vitest run`, `npx tsc -b`, `npm run typecheck` (7 erros antigos), eslint nos arquivos tocados, `DESKTOP=1 npx vite build`, `node scripts/verify-layout/run.mjs` (estados novos e antigos). Números no relatório.
- [ ] FATOS e DESIGN_SYSTEM conferidos; `report.md` no ledger.
