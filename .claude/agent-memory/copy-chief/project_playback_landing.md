---
name: project-playback-landing
description: Estado e posicionamento da landing/pricing do Playback Studio (copy), incluindo diferencial ao vivo e mapa de planos
metadata:
  type: project
---

> ⚠️ **ESTADO ATUAL (2026-07-08):** fatos de produto vivem em `PLAYBACK_STUDIO_FATOS.md` (fonte única). Correções sobre o texto abaixo: pagamento é **Asaas** (não AbacatePay); **Livre separa só 2 faixas** e NÃO tem seções/loop (loop finito grátis foi removido); Pro separa 2/4/6 faixas; Studio = 150 sep/mês + Ao Vivo ilimitado. Preços: Pro R$ 49,90 (R$ 37,90 anual), Studio R$ 119,90 (R$ 89,90 anual).

Landing e pricing do Playback Studio vivem em `src/components/LandingPage.tsx` (array `PLANS`, `FAQS`, `AUDIENCE`, seções hero/guide/como-funciona) e `src/components/PricingModal.tsx` (4 cards mensal/anual, IDs de produto AbacatePay fixos). Mapa de planos canônico em `src/lib/plans.ts`.

**Diferencial central de conversão (2026-06-15):** o unique mechanism defensável do produto é o USO AO VIVO no palco (loop de seção infinito + Modo Ao Vivo com a banda conectando o celular), não só a separação por IA. A copy deve elevar isso a promessa central, não detalhe escondido. Mercado já está saturado em "separação por IA" (sofisticação estágio 3-4).

**Why:** público é solution-aware (worship/banda que já sofre o "setlist mudou sábado à noite"); separação sozinha não diferencia mais.
**How to apply:** ao mexer em hero/benefícios/planos, sempre carregar loop ao vivo + Modo Ao Vivo. Manter âncora "pronto pro domingo" e storytelling Sexta/Sábado/Domingo (validados).

**Matriz de planos (refletir exatamente):** Livre=grátis (5 sep/mês, 2-4 faixas, loop finito até 4x, SEM Modo Ao Vivo). Pro=50 sep/mês, 6 faixas, loop infinito, Modo Ao Vivo até 4 aparelhos. Studio=150 sep/mês, Modo Ao Vivo ilimitado, banda controla loop/seções pelo celular. Ver [[feedback_vocab_multitracks]] e [[feedback_no_em_dashes]].

**Erros recorrentes da copy a vigiar:** "auto-detecção de seções" (FALSO, é marcação MANUAL com atalhos); "stems" como termo principal (usar "separação de faixas"/"multitracks"); jargão interno no pricing ("Spleeter", "Ferramentas de admin").
