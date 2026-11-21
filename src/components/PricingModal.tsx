import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { isPaidPlan, planDisplayName } from '../lib/plans';
import { startCheckout, type CheckoutPlanKey } from '../lib/checkout';
import { fetchOffer, toOfferView } from '../lib/offer';
import type { OfferView } from './livre/limitCopy';
import { PricingView } from './pricing/PricingView';
import type { PricingCardView } from './pricing/PricingView';
import { PRICING_COPY, PRICING_PLANS, reais } from './pricing/pricingCatalog';
import type { PricingPlan } from './pricing/pricingCatalog';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Música tocando ou na pré-contagem (Livre): os cartões mostram o preço cheio, sem o desconto. */
    hideOffer?: boolean;
}

const NO_OFFER: OfferView = { status: 'none' };

// Os cartões (nomes, preços pelos PRICES, recursos) estão em pricing/pricingCatalog.ts; a cara, na
// PricingView (janela do palco, Parte 3). Aqui ficam a conta, a oferta do primeiro mês e o checkout.
export function PricingModal({ isOpen, onClose, hideOffer = false }: PricingModalProps) {
    const { user, userPlan, planExpiresAt } = useAuth();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    // Quem já paga confirma a troca antes: o plano novo é cobrado cheio e o
    // atual termina assim que o novo é pago (o webhook encerra a assinatura
    // antiga no Asaas), sem desconto proporcional.
    const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
    const [openedExternally, setOpenedExternally] = useState(false);
    const isSwitching = isPaidPlan(userPlan);
    const currentName = planDisplayName(userPlan);

    // Oferta do primeiro mês (Parte 3): a tela de Planos só lê a janela (nunca abre; quem abre
    // é a tela de limite). Quem já paga não lê: a oferta é só da primeira assinatura e o aviso
    // de troca fala do preço cheio. Cada vez que abre, começa sem desconto (preço cheio) até
    // o servidor responder; a resposta de uma abertura antiga não vale pra nova.
    const offerFor = isOpen && user && !isSwitching ? user.id : null;
    const [offer, setOffer] = useState<OfferView>(NO_OFFER);
    const [offerEndedNote, setOfferEndedNote] = useState<string | null>(null);
    const [offerAsked, setOfferAsked] = useState(offerFor);
    if (offerAsked !== offerFor) {
        setOfferAsked(offerFor);
        setOffer(NO_OFFER);
        setOfferEndedNote(null);
    }
    useEffect(() => {
        if (!offerFor) return;
        let current = true;
        void fetchOffer({ open: false }).then((r) => {
            if (current) setOffer(toOfferView(r, Date.now()));
        });
        return () => { current = false; };
    }, [offerFor]);

    // O preço do primeiro mês que ESTA tela mostra no cartão (nulo: preço cheio). O checkout
    // manda `offer: true` só com ele na tela, pra nunca cobrar diferente do que a pessoa viu.
    // Com a música tocando (`hideOffer`, Ruling pads-tocando) a oferta não aparece por cima do
    // palco: o cartão fica no cheio e volta a mostrar o desconto quando a música para.
    const offerPrice = (planKey: CheckoutPlanKey): number | null => {
        if (hideOffer || isSwitching || offer.status !== 'active') return null;
        if (planKey === 'essencial_mensal' || planKey === 'pro_mensal') return offer.prices[planKey];
        return null;
    };

    // Erro do último assinar (antes era o aviso do navegador): frase na janela (Parte 3). Cada vez
    // que a tela abre, começa sem erro.
    const [message, setMessage] = useState<string | null>(null);
    const [seenOpen, setSeenOpen] = useState(isOpen);
    if (seenOpen !== isOpen) {
        setSeenOpen(isOpen);
        setMessage(null);
    }

    if (!isOpen) return null;

    const handleSubscribe = async (plan: PricingPlan, confirmedSwitch = false) => {
        if (!user) {
            setMessage(PRICING_COPY.loginNeeded);
            return;
        }

        const withOffer = !confirmedSwitch && offerPrice(plan.planKey) !== null;
        setMessage(null);
        setLoadingPlan(plan.planKey);
        try {
            const out = await startCheckout({ planKey: plan.planKey, confirmedSwitch, offer: withOffer });
            if (out.kind === 'opened') {
                if (out.external) setOpenedExternally(true);
                return;
            }
            if (out.offerEnded) {
                // A oferta terminou (ou a conta já assinou): o desconto sai da tela, a frase do
                // servidor fica nela e a pessoa decide se assina pelo cheio. Nada abre sozinho.
                setOffer(NO_OFFER);
                setOfferEndedNote(out.message);
                return;
            }
            // 409 = já tem este plano ativo; o servidor manda a mensagem pronta.
            setMessage(out.message);
        } catch (error) {
            console.error('Erro de rede ou processamento:', error);
            setMessage(PRICING_COPY.network(error instanceof Error ? error.message : ''));
        } finally {
            setLoadingPlan(null);
        }
    };

    const cards: PricingCardView[] = PRICING_PLANS.map((plan) => {
        const firstMonth = plan.offerable ? offerPrice(plan.planKey) : null;
        const current = plan.planKey === userPlan && !planExpiresAt;
        const loading = loadingPlan === plan.planKey;
        return { ...plan, offerPrice: firstMonth !== null ? reais(firstMonth) : null, current, loading, disabled: loading || current };
    });

    const choose = (planKey: CheckoutPlanKey) => {
        const plan = PRICING_PLANS.find((p) => p.planKey === planKey);
        if (!plan) return;
        if (isSwitching) setPendingPlan(plan);
        else void handleSubscribe(plan);
    };

    return (
        <PricingView
            open
            onClose={onClose}
            switching={isSwitching}
            currentName={currentName}
            cards={cards}
            openedExternally={openedExternally}
            pending={pendingPlan ? { name: pendingPlan.name, price: pendingPlan.price, period: pendingPlan.period } : null}
            onConfirmSwitch={() => { const p = pendingPlan; setPendingPlan(null); if (p) void handleSubscribe(p, true); }}
            onCancelSwitch={() => setPendingPlan(null)}
            offerNote={offerEndedNote}
            message={message}
            onChoose={choose}
        />
    );
}
