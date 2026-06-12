import { X, Server, Wifi } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface LiveModeModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverUrl: string | null;
    isStarting: boolean;
    serverError: string | null;
    onStopServer: () => void;
}

export function LiveModeModal({ 
    isOpen, 
    onClose, 
    serverUrl, 
    isStarting, 
    serverError, 
    onStopServer 
}: LiveModeModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="daw-panel w-full max-w-md rounded-lg flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border shrink-0 bg-[#0e0e10]">
                    <div className="flex items-center gap-2">
                        <Server size={18} className="text-primary" />
                        <h2 className="text-white text-sm font-bold uppercase tracking-wider font-mono">Modo Ao Vivo</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-md text-text-muted transition-all active:scale-90 cursor-pointer">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-col p-6 bg-[#121214] flex items-center justify-center min-h-[300px]">
                    {isStarting ? (
                        <div className="flex flex-col items-center gap-4 animate-pulse">
                            <Server size={48} className="text-primary/50" />
                            <p className="text-white text-xs font-mono uppercase tracking-wider">Iniciando Servidor...</p>
                        </div>
                    ) : serverError ? (
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                                <X size={32} className="text-red-500" />
                            </div>
                            <div>
                                <p className="text-white font-bold mb-1">Erro ao iniciar servidor</p>
                                <p className="text-text-muted text-xs font-mono">{serverError}</p>
                            </div>
                        </div>
                    ) : serverUrl ? (
                        <div className="flex flex-col items-center w-full animate-in fade-in zoom-in duration-300">
                            <div className="bg-white p-4 rounded-xl mb-6 shadow-lg shadow-white/5">
                                <QRCodeSVG 
                                    value={serverUrl} 
                                    size={200}
                                    level="H"
                                    includeMargin={false}
                                />
                            </div>
                            
                            <div className="w-full bg-[#1c1c1e] border border-border rounded-lg p-4 mb-6 flex flex-col items-center">
                                <div className="flex items-center gap-2 mb-2 text-primary">
                                    <Wifi size={14} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">Conecte na mesma rede</span>
                                </div>
                                <div className="text-center">
                                    <p className="text-text-muted text-xs mb-1">Acesse pelo navegador do celular:</p>
                                    <p className="text-white font-mono font-bold text-sm bg-black/30 py-1.5 px-3 rounded-md select-all">
                                        {serverUrl}
                                    </p>
                                </div>
                            </div>

                            <button 
                                onClick={onStopServer}
                                className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 text-xs font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95"
                            >
                                Desativar Modo Ao Vivo
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
