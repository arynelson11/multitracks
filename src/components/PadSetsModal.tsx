import { useEffect, useState } from 'react';
import { X, Cloud, Loader2, Layers, CheckCircle2 } from 'lucide-react';
import { fetchPadSets, type CloudPadSet } from '../lib/supabase';
import type { SelectedPadSet } from '../hooks/usePadSynth';

// Fallback always-available entry pointing to the legacy R2 path
const LEGACY_PAD_SET: CloudPadSet = {
    id: '__legacy__',
    name: 'Pads do Sistema',
    description: 'Banco padrão de pads',
    base_path: 'system_pads',
    created_at: '',
};

interface PadSetsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (padSet: SelectedPadSet) => void;
    selectedPadSet: SelectedPadSet | null;
}

export function PadSetsModal({ isOpen, onClose, onSelect, selectedPadSet }: PadSetsModalProps) {
    const [extraSets, setExtraSets] = useState<CloudPadSet[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        fetchPadSets()
            .then(data => {
                // Filter out any duplicate of the legacy slot
                setExtraSets(data.filter(s => s.base_path !== 'system_pads'));
            })
            .catch(() => setExtraSets([]))
            .finally(() => setLoading(false));
    }, [isOpen]);

    if (!isOpen) return null;

    // Legacy always first, then any Supabase-registered sets
    const allSets = [LEGACY_PAD_SET, ...extraSets];

    const handleSelect = (padSet: CloudPadSet) => {
        onSelect({ id: padSet.id, name: padSet.name, base_path: padSet.base_path });
        onClose();
    };

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
                        <div className="flex items-center justify-center py-4 gap-2 text-text-muted">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-[9px] font-mono uppercase tracking-wider">Carregando...</span>
                        </div>
                    )}

                    {allSets.map(padSet => {
                        const isActive = selectedPadSet?.id === padSet.id ||
                            (!selectedPadSet && padSet.id === '__legacy__');
                        return (
                            <button
                                key={padSet.id}
                                onClick={() => handleSelect(padSet)}
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
