import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { X, Check } from 'lucide-react';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PLANS = [
    {
        id: 'prod_jpqSjSmGAUGUxpw3UEa3JpQJ',
        name: 'Essencial Mensal',
        price: 19.90,
        priceStr: 'R$ 19,90',
        period: '/mês',
        description: 'Para músicos e ministros ativos',
        features: ['Acesso a pads online', 'Gerenciamento de setlists', 'Recursos essenciais']
    },
    {
        id: 'prod_GPymBqgXuBsLN2wD10YQ3RYc',
        name: 'Essencial Anual',
        price: 178.80,
        priceStr: 'R$ 178,80',
        period: '/ano',
        description: 'Para músicos e ministros ativos',
        features: ['Acesso a pads online', 'Gerenciamento de setlists', 'Recursos essenciais', 'Desconto especial anual']
    },
    {
        id: 'prod_bM64Ub31zLk0YHEcDjL5yP23',
        name: 'Pro Mensal',
        price: 34.90,
        priceStr: 'R$ 34,90',
        period: '/mês',
        description: 'Para equipes e produtores',
        features: ['Tudo do Essencial', 'Separação de áudio AI (Spleeter)', 'Uploads de multi-faixas', 'Ferramentas de admin'],
        isPopular: true
    },
    {
        id: 'prod_3eYCE4MpatcwfmBXfpFH4S6D',
        name: 'Pro Anual',
        price: 334.80,
        priceStr: 'R$ 334,80',
        period: '/ano',
        description: 'Para equipes e produtores',
        features: ['Tudo do Essencial', 'Separação de áudio AI (Spleeter)', 'Uploads de multi-faixas', 'Desconto de 2 meses']
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
            setLoadingPlan(plan.id);
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productId: plan.id,
                    productName: plan.name,
                    priceCents: Math.round(plan.price * 100),
                    userId: user.id,
                    email: user.email
                })
            });

            const data = await response.json().catch(() => ({ error: 'Resposta do servidor não é um JSON válido' }));
            
            if (response.ok && data.url) {
                // Redireciona para o checkout do AbacatePay
                window.location.href = data.url;
            } else {
                console.error('Erro no checkout:', data);
                alert(`Erro ao gerar checkout: ${data.error || response.statusText || 'Erro interno no servidor'}`);
            }
        } catch (error) {
            console.error('Erro de rede ou processamento:', error);
            alert('Não foi possível conectar com o servidor. Verifique sua conexão ou tente novamente mais tarde.');
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
                                key={plan.id} 
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
                                        disabled={loadingPlan === plan.id}
                                        className={`w-full py-2.5 rounded textxs font-bold uppercase tracking-wider transition-all active:scale-[0.98] ${
                                            plan.isPopular 
                                            ? 'bg-primary text-black hover:bg-[#b0f545] disabled:opacity-50' 
                                            : 'bg-white/10 text-white hover:bg-white/20 disabled:opacity-50'
                                        }`}
                                    >
                                        {loadingPlan === plan.id ? 'Processando...' : 'Assinar Agora'}
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
