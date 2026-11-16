import { apiUrl } from '../lib/api';
import { getAuthHeaders } from '../lib/supabase';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { X, Check } from 'lucide-react';
import { isPaidPlan, planDisplayName } from '../lib/plans';
import { isElectron, openExternalUrl } from '../lib/desktop';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// planKey = nome interno do plano (vai pro backend, que sabe o preço e o ciclo).
const PLANS = [
    {
        planKey: 'essencial_mensal',
        name: 'Pro Mensal',
        priceStr: 'R$ 49,90',
        period: '/mês',
        description: 'Pra equipe que toca toda semana',
        features: ['Separação em 2, 4 e 6 faixas', 'Download em WAV e MP3', 'BPM pela IA, voz guia e pads', 'Modo Ao Vivo (até 4 aparelhos)'],
        isPopular: true
    },
    {
        planKey: 'essencial_anual',
        name: 'Pro Anual',
        priceStr: 'R$ 454,80',
        period: '/ano',
        description: 'Pra equipe que toca toda semana',
        features: ['Tudo do Pro Mensal', 'Modo Ao Vivo (até 4 aparelhos)', 'Loop infinito ao vivo', 'Equivale a R$ 37,90/mês']
    },
    {
        planKey: 'pro_mensal',
        name: 'Studio Mensal',
        priceStr: 'R$ 119,90',
        period: '/mês',
        description: 'Pra quem leva o ao vivo a sério',
        features: ['Tudo do Pro', 'Modo Ao Vivo sem limite de aparelhos', 'A banda controla loop e seções pelo celular', '150 separações de faixas por mês']
    },
    {
        planKey: 'pro_anual',
        name: 'Studio Anual',
        priceStr: 'R$ 1.078,80',
        period: '/ano',
        description: 'Pra quem leva o ao vivo a sério',
        features: ['Tudo do Studio Mensal', 'Modo Ao Vivo ilimitado', 'Controle total pela banda', 'Equivale a R$ 89,90/mês']
    }
];

export function PricingModal({ isOpen, onClose }: PricingModalProps) {
    const { user, userPlan, planExpiresAt } = useAuth();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    // Quem já paga confirma a troca antes: o plano novo é cobrado cheio e o
    // atual termina assim que o novo é pago (o webhook encerra a assinatura
    // antiga no Asaas), sem desconto proporcional.
    const [pendingPlan, setPendingPlan] = useState<typeof PLANS[0] | null>(null);
    const [openedExternally, setOpenedExternally] = useState(false);
    const isSwitching = isPaidPlan(userPlan);
    const currentName = planDisplayName(userPlan);

    if (!isOpen) return null;

    const handleSubscribe = async (plan: typeof PLANS[0], confirmedSwitch = false) => {
        if (!user) {
            alert('Por favor, faça login para assinar um plano.');
            return;
        }

        try {
            setLoadingPlan(plan.planKey);
            const response = await fetch(apiUrl('/api/checkout'), {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify({ planKey: plan.planKey, confirmedSwitch })
            });

            const rawText = await response.text();
            let data: any = null;
            try { data = rawText ? JSON.parse(rawText) : null; } catch { /* não-JSON */ }

            if (response.ok && data?.url) {
                // No app de computador o pagamento abre no navegador do sistema
                // (cartão e 3D Secure funcionam lá; o app relê o plano ao voltar).
                if (isElectron) {
                    openExternalUrl(data.url);
                    setOpenedExternally(true);
                    return;
                }
                window.location.href = data.url;
                return;
            }

            console.error('[checkout] HTTP', response.status);
            // 409 = já tem este plano ativo; o servidor manda a mensagem pronta.
            alert(typeof data?.error === 'string' ? data.error : 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.');
        } catch (error) {
            console.error('Erro de rede ou processamento:', error);
            alert(`Não foi possível conectar com o servidor.\n${error instanceof Error ? error.message : ''}`);
        } finally {
            setLoadingPlan(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
            <div className="daw-panel w-full max-w-5xl rounded-lg flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-[#141416]">
                    <div>
                        <h2 className="text-white text-lg font-bold uppercase tracking-wider">Escolha seu Plano</h2>
                        <p className="text-text-muted text-xs font-mono">
                            {isSwitching
                                ? 'Trocar de plano: o novo é cobrado cheio e o atual termina na hora, sem proporcional.'
                                : 'Desbloqueie todo o poder do seu estúdio em nuvem'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-md text-text-muted transition-all cursor-pointer">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 bg-[#0e0e10] overflow-y-auto max-h-[80vh]">
                    {openedExternally && (
                        <div role="status" className="mb-6 rounded-xl border border-white/15 bg-[#1c1c1e] p-4 text-zinc-300 text-xs leading-relaxed">
                            Abrimos o pagamento no seu navegador. Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes.
                        </div>
                    )}
                    {pendingPlan && (
                        <div role="dialog" aria-label="Trocar de plano?" className="mb-6 rounded-xl border border-amber-400/40 bg-[#1c1c1e] p-4">
                            <h3 className="text-white text-sm font-bold mb-1">Trocar de plano?</h3>
                            <p className="text-zinc-300 text-xs leading-relaxed mb-3">
                                O {pendingPlan.name} é cobrado cheio agora ({pendingPlan.priceStr}{pendingPlan.period}). O {currentName} termina na hora, assim que o novo for pago, sem desconto proporcional do que já foi pago.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setPendingPlan(null)}
                                    className="px-4 py-2 rounded-lg bg-white/10 text-white text-xs font-bold cursor-pointer"
                                >
                                    Voltar
                                </button>
                                <button
                                    onClick={() => { const p = pendingPlan; setPendingPlan(null); void handleSubscribe(p, true); }}
                                    className="px-4 py-2 rounded-lg bg-primary text-black text-xs font-bold cursor-pointer"
                                >
                                    Confirmar troca
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {PLANS.map((plan) => (
                            <div 
                                key={plan.planKey}
                                className={`relative flex flex-col rounded-xl overflow-hidden border ${plan.isPopular ? 'border-primary ring-1 ring-primary/50' : 'border-border'} bg-[#1c1c1e] transition-transform hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5`}
                            >
                                {plan.isPopular && (
                                    <div className="absolute top-0 right-0 bg-primary text-black text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-bl-lg">
                                        Mais Popular
                                    </div>
                                )}
                                
                                <div className="p-5 flex-1 flex flex-col">
                                    <h3 className="text-white text-sm font-bold uppercase tracking-widest mb-1">{plan.name}</h3>
                                    <p className="text-text-muted text-[10px] font-mono h-8">{plan.description}</p>
                                    
                                    <div className="mt-4 mb-6">
                                        <span className="text-2xl font-black text-white">{plan.priceStr}</span>
                                        <span className="text-text-muted font-mono text-[10px]">{plan.period}</span>
                                    </div>

                                    <ul className="flex-1 space-y-3 mb-6">
                                        {plan.features.map((feat, i) => (
                                            <li key={i} className="flex flex-start gap-2 text-[11px] font-mono text-gray-300">
                                                <Check size={14} className="text-primary shrink-0 opacity-80 mt-0.5" />
                                                <span className="leading-tight">{feat}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                
                                <div className="p-4 border-t border-border/50 bg-[#141416]">
                                    <button
                                        onClick={() => (isSwitching ? setPendingPlan(plan) : handleSubscribe(plan))}
                                        disabled={loadingPlan === plan.planKey || (plan.planKey === userPlan && !planExpiresAt)}
                                        className={`w-full py-2.5 rounded textxs font-bold uppercase tracking-wider transition-all active:scale-[0.98] ${
                                            plan.isPopular 
                                            ? 'bg-primary text-black hover:bg-[#b0f545] disabled:opacity-50' 
                                            : 'bg-white/10 text-white hover:bg-white/20 disabled:opacity-50'
                                        }`}
                                    >
                                        {loadingPlan === plan.planKey
                                            ? 'Processando...'
                                            : plan.planKey === userPlan && !planExpiresAt ? 'Seu plano atual' : 'Assinar Agora'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
