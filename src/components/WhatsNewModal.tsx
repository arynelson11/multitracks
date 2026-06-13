import { Sparkles, X } from 'lucide-react';
import { CHANGELOG } from '../lib/changelog';

interface WhatsNewModalProps {
  onClose: () => void;
}

// Popup mostrado na abertura do app quando há uma versão nova que o usuário
// ainda não viu. Exibe a entrada mais recente do changelog.
export function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const latest = CHANGELOG[0];
  if (!latest) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141416] border border-primary/20 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-b from-primary/10 to-transparent">
          <button onClick={onClose} className="absolute top-4 right-4 text-text-muted hover:text-white cursor-pointer"><X size={18} /></button>
          <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <p className="text-primary text-[11px] font-bold uppercase tracking-widest mb-1">Novidades · v{latest.version}</p>
          <h2 className="text-white font-bold text-xl">{latest.title}</h2>
        </div>

        {/* Items */}
        <div className="px-6 pb-6">
          <ul className="space-y-2.5">
            {latest.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300 leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
