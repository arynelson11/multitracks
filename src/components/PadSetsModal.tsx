import { useEffect, useState } from 'react';
import { X, Cloud, Loader2, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchPadSets, type CloudPadSet } from '../lib/supabase';
import type { SelectedPadSet } from '../hooks/usePadSynth';

interface PadSetsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (padSet: SelectedPadSet) => void;
    selectedPadSet: SelectedPadSet | null;
}

export function PadSetsModal({ isOpen, onClose, onSelect, selectedPadSet }: PadSetsModalProps) {
    const [padSets, setPadSets] = useState<CloudPadSet[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        setError(null);
        fetchPadSets()
            .then(data => setPadSets(data))
            .catch(() => setError('Erro ao carregar pads da nuvem.'))
            .finally(() => setLoading(false));
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <div className="daw-panel w-full max-w-sm rounded-lg flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-secondary/10 rounded-md border border-secondary/15">
                            <Cloud size={14} className="text-secondary" />
                        </div>
                        <div>
                            <h2 className="text-white font-black text-xs uppercase tracking-wider">Pads da Nuvem</h2>
                            <p className="text-[9px] text-text-muted font-mono">Selecione um banco de pads</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-all active:scale-90 cursor-pointer">
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-8 gap-2 text-text-muted">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-[10px] font-mono uppercase tracking-wider">Carregando...</span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 p-2.5 bg-accent-red/5 border border-accent-red/15 rounded-md text-accent-red text-[10px] font-mono">
                            <AlertCircle size={12} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {!loading && !error && padSets.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-text-muted">
                            <Layers size={24} className="opacity-30" />
                            <p className="text-[10px] font-mono uppercase tracking-wider text-center">
                                Nenhum banco de pads disponível.<br />
                                <span className="opacity-60">Envie pads pelo painel Admin.</span>
                            </p>
                        </div>
                    )}

                    {!loading && padSets.map(padSet => {
                        const isActive = selectedPadSet?.id === padSet.id;
                        return (
                            <button
                                key={padSet.id}
                                onClick={() => { onSelect({ id: padSet.id, name: padSet.name, base_path: padSet.base_path }); onClose(); }}
                                className={`w-full flex items-center gap-3 p-3 rounded-md border text-left transition-all active:scale-[0.98] cursor-pointer
                                    ${isActive
                                        ? 'bg-secondary/10 border-secondary/30 text-secondary'
                                        : 'bg-white/3 border-border text-text-main hover:bg-white/5 hover:border-border-light'
                                    }`}
                            >
                                <div className={`p-1.5 rounded-md border ${isActive ? 'bg-secondary/15 border-secondary/25' : 'bg-white/5 border-border'}`}>
                                    <Layers size={14} className={isActive ? 'text-secondary' : 'text-text-muted'} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold uppercase tracking-wider font-mono truncate">{padSet.name}</p>
                                    {padSet.description && (
                                        <p className="text-[9px] text-text-muted font-mono truncate mt-0.5">{padSet.description}</p>
                                    )}
                                </div>
                                {isActive && <CheckCircle2 size={14} className="text-secondary shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
