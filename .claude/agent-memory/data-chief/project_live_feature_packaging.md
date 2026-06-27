---
name: project-live-feature-packaging
description: "Tese de packaging/monetização da feature Modo Ao Vivo (loop/seções/multi-device LAN) do Playback Studio — gate por equipe, não por feature. North Star revisada."
metadata:
  type: project
---

Recomendação de Data Chief (2026-06-15) sobre packaging da feature nova de controle ao vivo (marcar seções, loop finito/infinito, "voltar para parte", controle multi-dispositivo da banda via LAN). Custo marginal da feature ~zero (não usa nuvem, diferente da separação por IA).

**Tese central — gate no eixo "indivíduo → equipe", NÃO na feature em si:**
- Livre: seções + atalhos + loop FINITO (1 ativo/música). Dá hábito, não o palco. Aquisição/ativação.
- Pro: loop infinito + "voltar para parte" + multi-device até 3 dispositivos. Destrava "minha banda".
- Studio: multi-device ILIMITADO + múltiplos repertórios. Plano "ministério inteiro" (igreja de alto CLV).

**Why:** o founder quis dar 100% grátis ("app é pra todos"). Data Chief discordou: (1) anchoring de gratuidade queima percepção de valor; (2) a feature ao vivo é o melhor gatilho de upgrade ASPIRACIONAL (vs. cota de IA que é gatilho negativo de custo); (3) custo zero = margem 100% quando monetizada, melhor margem do catálogo. MultiTracks já cobra loop como premium = mercado educado que se paga.

**Value metric — mudança estratégica:** cota de separação por IA é metric DEFENSIVO (gate de custo Replicate, manter como está mas tirar do papel de herói). O metric OFENSIVO/expansível é SEATS/multi-device — escala com tamanho da equipe, e a igreja/ministério é o segmento de maior CLV e menor churn (orçamento institucional). Possível plano futuro "Igreja/Ministério" por seats — NÃO lançar até validar tração multi-device.

**North Star revisada proposta:** de "separações feitas" (vaidade de custo) → "domingos tocados com a banda conectada" (sessões ao vivo multi-device/semana). Alinha com verbal nail "DOMINGO" da marca [[playback-studio-brand]].

**How to apply:** Ao mexer em PLAN_LIMITS/gating do Modo Ao Vivo ou na landing de preços, seguir esta distribuição. Landing deve reposicionar eixo dos planos como Você→Banda→Ministério e mover o herói de "separações" para "sua banda conectada no palco". MÉTRICA CRÍTICA a instrumentar desde o dia 1 do lançamento: uso multi-device por sessão ao vivo (decide se plano Igreja/seats se justifica). Cotas de separação atuais em [[project-playback-studio]] (PLAN_LIMITS em api/separate-audio.ts).

---

**PRICING do repackaging (recomendação Data Chief 2026-06-15) — founder já travou o gating; isto é só precificação:**

Gating travado pelo founder: Livre = seções+atalhos+loop finito até 4x, sem Ao Vivo. Pro = loop infinito + Ao Vivo até 4 aparelhos (banda acompanha música/tom/letra+play/próxima, NÃO controla seções). Studio = Ao Vivo ilimitado + controle TOTAL remoto (loop/seções). Mudança de valor: Modo Ao Vivo era grátis pra todos, virou pago e ganhou controle de execução (feature que MultiTracks cobra no Premium). Custo marginal ~zero (não é nuvem; nuvem é a separação IA, já com cota). Margem incremental ≈100%.

Números recomendados (ASSIMÉTRICO de propósito):
- **Pro: MANTER R$49,90/mês, anual R$37,90/mês (~24% off).** Não subir — é o value metric de conversão (banda pequena = 4 devices = exatamente o Pro), abaixo da barreira psicológica dos R$50. Usar o valor novo como arma de conversão: "mesmo preço, agora com Modo Ao Vivo + controle ao vivo".
- **Studio: SUBIR para R$119,90/mês, anual R$89,90/mês (~25% off)** (de 99,90/79,90). Topo de baixa elasticidade (igreja com orçamento), janela de reprecificação é AGORA (aumento percebido como consequência do valor novo, não ganância). Alarga gap Pro→Studio (2,0x→2,4x) abrindo espaço pro futuro plano Igreja/seats.
- **Grandfathering:** Studio atual mantém 99,90/79,90 indefinidamente enquanto ativo; comunicar como benefício de lealdade ("entrou cedo, preço garantido"). Pro não muda. Todos pagos recebem comunicado "seu plano agora inclui Ao Vivo com controle, sem custo extra" (anti-churn + goodwill).
- **Anual ~25% segue adequado** (faixa saudável 20-30%; trava churn em base worship voluntária/orçamento anual de igreja). Padronizar ~25%.

Anchoring competitivo: MultiTracks playback entry US$59,99/mês (~R$330), bundle One US$134,99/mês (~R$745). Pro a R$49,90 = ~1/6 do entry MT. Teto de elasticidade enorme acima; risco é preço baixo demais sinalizar produto menor, não "caro".

**Regra de ouro aplicada:** só se sobe preço quando se entrega valor novo visível — estamos nessa janela exata; não desperdiçar no topo. Próxima reprecificação real virá do plano Igreja/seats, gatilhada pela métrica de multi-device/sessão.
