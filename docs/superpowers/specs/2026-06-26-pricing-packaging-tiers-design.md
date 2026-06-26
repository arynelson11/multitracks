# Packaging por tier: Livre / Pro / Studio

**Data:** 2026-06-26
**Status:** Aprovado (design), pendente de plano de implementação

## Problema

O gating hoje é binário (`free` vs pago). A separação de faixas no plano Livre está
generosa demais: o usuário grátis recebe BPM detectado pela IA, voz guia, separação
em até 4 faixas e marcação de seções, sem trava. Isso entrega valor de mais antes do
paywall e enfraquece a conversão.

O objetivo é transformar o Livre num "gostinho" da plataforma: ele prova que a IA
separa a música de verdade, e para aí. Todo o trabalho de levar a música pronta pro
palco (preparar, baixar, reger ao vivo) vira pago, distribuído entre Pro e Studio.

## Objetivos

- Livre vira prova de conceito: ouvir a separação, sem levar nada embora.
- Mover BPM, voz guia, download, seções/loop e separação em 4/6 faixas para o pago.
- Dar a Pro e Studio uma história clara: Pro prepara e rege (você no controle),
  Studio escala o ao vivo (banda autônoma, sem limite).
- Substituir a trava binária por checagens por tier (`free` | `pro` | `studio`).
- Alinhar a copy (LandingPage e PricingModal) com o gating real.

## Não-objetivos

- Mudar o motor de separação (Demucs/Replicate) ou os formatos de áudio.
- Renomear IDs internos de plano (`free`, `essencial_*`, `pro_*`) — quebra AbacatePay
  e `profiles.plan`. O mapa de tier em `plans.ts` continua absorvendo esses IDs.
- Mexer em preços. Valores atuais ficam: Pro R$ 49,90 / 37,90 anual;
  Studio R$ 119,90 / 89,90 anual.
- Implementar "múltiplos repertórios" como feature real (já removido da copy).

## Matriz de packaging

### LIVRE (grátis) — "Prove que funciona"

| Recurso | Acesso |
|---|---|
| Separações por mês | 5 |
| Faixas por separação | Só 2 (vocal + instrumental) |
| Ouvir faixas isoladas no mixer | Sim (dentro da plataforma) |
| Biblioteca de separações local (navegador) | Sim |
| Download (WAV/MP3) | Não |
| BPM pela IA | Não |
| Voz guia | Não |
| Marcar seções / loop ao vivo | Não |
| Transposição de tom | Não |
| Pads de ambiente | Não |
| Modo Ao Vivo | Não |
| Biblioteca cloud / repertório .zip / teleprompter | Não |

### PRO — R$ 49,90 (37,90 anual) — "Leve pro domingo"

- 50 separações/mês, separação em **2, 4 e 6 faixas**
- **Download em WAV e MP3**
- **BPM pela IA** + click com levada brasileira
- **Voz guia** (manual e automática)
- **Marcar seções** + repetir trecho em loop infinito ao vivo
- Transposição de tom
- Pads de ambiente
- Modo Ao Vivo: banda conecta por QR Code, **até 4 aparelhos**
- Teleprompter de letras
- Biblioteca cloud + repertório com backup .zip
- Suporte por email

### STUDIO — R$ 119,90 (89,90 anual) — "Palco sem limite"

- 150 separações/mês, prioridade máxima no processamento
- Tudo do Pro
- Modo Ao Vivo **sem limite de aparelhos**
- A banda **controla** loop e seções pelo celular (não só acompanha)
- Suporte prioritário

**Lógica do split:** Pro entrega tudo pra preparar e reger (você no controle, banda
acompanha, até 4 aparelhos). Studio escala a operação ao vivo (aparelhos ilimitados,
banda co-controla, prioridade). O eixo de diferenciação é o tamanho e a autonomia da
equipe no palco, não features de estúdio.

## Mudanças de gating (código)

Fonte única de regras: `src/lib/plans.ts`. Hoje já existe `planTier()` retornando
`'free' | 'pro' | 'studio'`. Adicionar helpers por capability e consumir nas telas.

### Novos helpers em `plans.ts`

```ts
// Separação: free trava em 2 faixas; pago libera 4 e 6.
export function maxStemCount(id): 2 | 6   // free → 2, pro/studio → 6

// Levar a faixa embora é pago.
export function canDownloadStems(id): boolean        // planTier !== 'free'

// Qualidade de vida de preparo: pagas.
export function canUseBpmDetection(id): boolean      // planTier !== 'free'
export function canUseVoiceGuide(id): boolean        // planTier !== 'free'
export function canUseSections(id): boolean          // planTier !== 'free'
```

`canUseLiveMode`, `maxLiveDevices`, `canBandControlSections` continuam como estão.
`canUseInfiniteLoop` e `FREE_MAX_LOOP_REPEATS` deixam de ter uso (free não tem
seções): remover após migrar `SectionBar`, ou manter retornando paga. Decisão:
**remover** para não deixar caminho morto.

### `SeparatorStudio.tsx`

| Local | Hoje | Mudança |
|---|---|---|
| Tela de opções, `handleSelectOption(4, false, false)` (~1260) | 4 faixas grátis | Passar a exigir Pro: `(4, true, false)` + badge/lock como o 6 |
| `handleSelectOption(2, …)` (~1253) | livre | Mantém livre |
| `downloadStem()` (~242) e botões de download | sem trava | Bloquear quando `!canDownloadStems(userPlan)`: abre `PricingModal`. Mostrar ícone de cadeado nos botões de download no Livre |
| Botão Voz Guia `setShowVoiceGuide(true)` (~1549) | sem trava | Envolver em checagem `canUseVoiceGuide`; Livre vê cadeado e cai no `PricingModal` |
| Campo "BPM (IA)" (~1741) | exibe sempre | Ocultar o campo de BPM quando `!canUseBpmDetection(userPlan)` |
| `LIMITS` (~800) | free: 5 | Mantém 5 |

`isAdmin` continua furando todas as travas (comportamento atual preservado).

### `App.tsx` (player ao vivo)

| Local | Hoje | Mudança |
|---|---|---|
| Marcação de seções (`createMarker` / `setSongMarkers`, `SectionBar` ~1287) | sem trava | Gatear por `canUseSections(userPlan)`; Livre não marca nem usa loop |
| `SectionBar` `infiniteAllowed` / `maxRepeats` (~1297) | usa `canUseInfiniteLoop` / `FREE_MAX_LOOP_REPEATS` | Como Livre perde seções, simplificar para `infiniteAllowed` por tier pago; remover dependência de `FREE_MAX_LOOP_REPEATS` |
| Tom (~766), Pads (~1437/1644), Biblioteca cloud (~751), Modo Ao Vivo (~256), aparelhos (~1895) | já pagos via `handlePremiumFeature` / helpers | Sem mudança |

`handlePremiumFeature` (~336) continua sendo o atalho "free → PricingModal" para as
features que são simplesmente pago-ou-não.

## Mudanças de copy

### `LandingPage.tsx` — array `PLANS`

- **Livre:** ajustar para refletir o novo escopo:
  - "5 separações de faixas por mês"
  - "Separação em 2 faixas (vocal + instrumental)"
  - "Ouça cada faixa isolada no mixer"
  - "Biblioteca de separações local, salva no navegador"
  - Remover: "Voz guia", "Marque as seções", "Repita um trecho ao vivo, até 4 vezes"
- **Pro:** adicionar "Download em WAV e MP3", "Separação em 2, 4 e 6 faixas",
  "BPM detectado pela IA", "Teleprompter de letras", "Repertório com backup .zip",
  manter voz guia, pads, click, loop infinito, ao vivo (4), transposição.
- **Studio:** manter (já sem "múltiplos repertórios").

### `PricingModal.tsx` — array `PLANS`

Alinhar os `features` resumidos de cada produto com a matriz (hoje citam
"Pads, voice guide e click brasileiro" no Pro — manter coerente; garantir que
nada prometa recurso de Livre como se fosse exclusivo do pago e vice-versa).

## Edge cases

- **Downgrade Pro/Studio → Livre:** separações antigas em 4/6 faixas continuam
  tocando no mixer (somente ouvir), mas o usuário não baixa e novas separações
  ficam limitadas a 2 faixas. BPM/voz guia já gerados continuam salvos no registro;
  a UI só esconde os controles de geração/edição para o Livre.
- **Admin:** `isAdmin` ignora todas as travas (inclusive download, BPM, voz guia).
- **Sessão sem plano definido:** `planTier(null)` retorna `'free'` (já é o default).
- **PricingModal como destino único:** toda trava nova abre o mesmo
  `PricingModal`, mantendo um só ponto de upsell.

## Testes

Sem suíte automatizada de UI no repo; validação manual por tier (free / pro / studio
/ admin), cobrindo:

1. Livre só separa em 2 faixas; 4 e 6 mostram cadeado e abrem PricingModal.
2. Livre não baixa (botões travados) e não vê BPM nem voz guia.
3. Livre não marca seções nem usa loop no player.
4. Pro libera 4/6 faixas, download, BPM, voz guia, seções+loop infinito,
   ao vivo até 4 aparelhos.
5. Studio: ao vivo ilimitado + banda controla seções pelo celular.
6. Admin fura todas as travas.
7. Downgrade: separação antiga de 6 faixas ainda toca, mas sem download.

## Arquivos afetados

- `src/lib/plans.ts` — novos helpers por capability; remover loop-finito-grátis
- `src/components/SeparatorStudio.tsx` — 4 faixas Pro, download/BPM/voz guia travados
- `src/App.tsx` — seções/loop travados no Livre; `SectionBar` simplificado
- `src/components/SectionBar.tsx` — props de loop por tier pago
- `src/components/LandingPage.tsx` — copy do array `PLANS`
- `src/components/PricingModal.tsx` — copy dos `features`
