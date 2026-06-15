import { apiUrl } from '../lib/api';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { X, Check } from 'lucide-react';

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
        features: ['50 separações de faixas por mês', 'Loop infinito ao vivo', 'Modo Ao Vivo (até 4 aparelhos)', 'Pads, voice guide e click brasileiro'],
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
    const { user } = useAuth();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubscribe = async (plan: typeof PLANS[0]) => {
        if (!user) {
            alert('Por favor, faça login para assinar um plano.');
            return;
        }

        try {
            setLoadingPlan(plan.planKey);
            const response = await fetch(apiUrl('/api/checkout'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planKey: plan.planKey,
                    userId: user.id,
                    email: user.email,
                    name: user.user_metadata?.full_name || user.user_metadata?.name || ''
                })
            });

            const rawText = await response.text();
            let data: any = null;
            try { data = rawText ? JSON.parse(rawText) : null; } catch { /* não-JSON */ }

            if (response.ok && data?.url) {
                window.location.href = data.url;
                return;
            }

            console.error('[checkout] HTTP', response.status, response.statusText, '\nbody:', rawText);
            const baseMsg = data?.error || response.statusText || `HTTP ${response.status}`;
            const detail = data?.details
                ? (typeof data.details === 'object' ? JSON.stringify(data.details, null, 2) : String(data.details))
                : (!data && rawText ? rawText.slice(0, 500) : '');
            alert(`Erro ao gerar checkout (HTTP ${response.status}): ${baseMsg}${detail ? '\n\nDetalhes:\n' + detail : ''}`);
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
                        <p className="text-text-muted text-xs font-mono">Desbloqueie todo o poder do seu estúdio em nuvem</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-md text-text-muted transition-all cursor-pointer">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 bg-[#0e0e10] overflow-y-auto max-h-[80vh]">
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
                                        onClick={() => handleSubscribe(plan)}
                                        disabled={loadingPlan === plan.planKey}
                                        className={`w-full py-2.5 rounded textxs font-bold uppercase tracking-wider transition-all active:scale-[0.98] ${
                                            plan.isPopular 
                                            ? 'bg-primary text-black hover:bg-[#b0f545] disabled:opacity-50' 
                                            : 'bg-white/10 text-white hover:bg-white/20 disabled:opacity-50'
                                        }`}
                                    >
                                        {loadingPlan === plan.planKey ? 'Processando...' : 'Assinar Agora'}
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
