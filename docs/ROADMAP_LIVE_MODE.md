# Roadmap de Implementação: Playback Studio Live Mode

Este documento registra as fases de implementação do modo ao vivo (hook/sessão) offline no Playback Studio, conforme definido anteriormente para garantir o foco do desenvolvimento.

## Decisões Arquiteturais e Conceito
- **App Desktop (Electron):** O Playback rodará como app desktop (Mac/Windows). O áudio é reproduzido com o mesmo motor do Chrome, garantindo transposição previsível.
- **Offline First:** O cenário de palco exige operação sem internet. O computador do líder atua como **Host Local** (Servidor HTTP + WebSocket) na rede LAN (roteador do palco).
- **Apenas o Líder toca o áudio:** Os músicos da banda conectam na sessão local via navegador nos celulares/tablets para **seguir** a sessão, sem baixar ou tocar áudio.
- **Sincronização Local:** Sincroniza música atual, parte/seção em destaque, tom e play/pause. A posição do playhead é interpolada localmente nos clientes.

---

## Fases de Implementação

### ✅ Fase 0: Fundação desktop
- **Status:** Concluído.
- **Descrição:** Envelopar o Playback atual no Electron. O app rodando como programa de desktop, usando a mesma base do React. Processo de build preparado.

### ✅ Fase 1: Cache offline + indicador de conexão
- **Status:** Concluído.
- **Descrição:** Gerenciador de download dos multitracks (R2 para disco), validação de plano com validade offline, degradação graciosa das funções online, selo de status e checagem "pronto pro offline" antes do show.

### 🟡 Fase 2: Host local
- **Status:** A Fazer (Próximo Passo)
- **Descrição:** O servidor (HTTP + WebSocket) embutido no app do líder, operando dentro da rede local do roteador. 
- **Entregável:** O app exibe o IP local e um QR code para que a banda se conecte pelo navegador.

### ⏳ Fase 3: Modo seguir + sincronização
- **Status:** Na fila
- **Descrição:** A banda vê a música atual e a próxima, a parte/seção em destaque, o tom e a cifra/letra, com um botão para sugerir alterações. 
- **Entregável:** Sincronização offline, via rede local, de música, parte, tom e play/pause/posição.

### ⏳ Fase 4: Estrutura de seções (Paralelo)
- **Status:** Na fila
- **Descrição:** Marcadores de seção por música (verso, refrão, ponte, loop) e a cifra/letra organizada por seção. 
- **Entregável:** Dados estruturados para servir de base e sincronizar a "parte atual" corretamente no modo follower. Pode ser desenvolvida em paralelo às outras fases por focar em estrutura de dados.

### ⏳ Fase 5: Nuvem opcional (híbrido)
- **Status:** Na fila
- **Descrição:** Quando há internet disponível e algum músico está remoto, a mesma lógica de sincronização conecta ao Supabase Realtime para funcionar via internet.

### ⏳ Fase 6: Pré-lançamento
- **Status:** Na fila
- **Descrição:** Assinatura de código (Apple Developer + certificado Windows), auto-update nativo do Electron e criação/disponibilização da página oficial de download no site.

---

## Tarefa Futura
- **Onboarding e Tutorial Passo a Passo:** Criar um guia interativo / passo a passo detalhando o uso da plataforma (no navegador e no app) para o usuário final, mas apenas após **todas as funcionalidades estarem 100% testadas e funcionando**.
