import { X, Server, Wifi, Gamepad2, Smartphone, Globe, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface LiveModeModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverUrl: string | null;
    isStarting: boolean;
    serverError: string | null;
    onStopServer: () => void;
    devices: string[];
    approvedIps: string[];
    onToggleDevice: (ip: string) => void;
    onToggleAll: () => void;
    remoteSessionCode: string | null;
    onToggleRemote: () => void;
}

export function LiveModeModal({
    isOpen,
    onClose,
    serverUrl,
    isStarting,
    serverError,
    onStopServer,
    devices,
    approvedIps,
    onToggleDevice,
    onToggleAll,
    remoteSessionCode,
    onToggleRemote
}: LiveModeModalProps) {
    const allApproved = devices.length > 0 && devices.every(ip => approvedIps.includes(ip));
    const remoteLink = remoteSessionCode ? `https://playbackstudio.com.br/?s=${remoteSessionCode}` : '';
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

                            {/* Controle remoto — aprovação por dispositivo */}
                            <div className="w-full mb-3 bg-[#1c1c1e] border border-border rounded-lg p-3">
                                <div className="flex items-center justify-between gap-2 mb-2.5">
                                    <span className="flex items-center gap-2 text-text-muted">
                                        <Gamepad2 size={13} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Quem controla</span>
                                    </span>
                                    {devices.length > 0 && (
                                        <button
                                            onClick={onToggleAll}
                                            className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 bg-white/5 text-text-muted border border-border hover:text-white"
                                        >
                                            {allApproved ? 'Bloquear todos' : 'Liberar todos'}
                                        </button>
                                    )}
                                </div>

                                {devices.length === 0 ? (
                                    <p className="text-[11px] text-text-muted text-center py-2 flex items-center justify-center gap-1.5">
                                        <Smartphone size={12} /> Nenhum dispositivo conectado ainda.
                                    </p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {devices.map((ip, i) => {
                                            const approved = approvedIps.includes(ip);
                                            return (
                                                <div key={ip} className="flex items-center justify-between gap-2">
                                                    <span className="text-xs text-white font-mono truncate min-w-0 flex items-center gap-1.5">
                                                        <Smartphone size={12} className="text-text-muted shrink-0" />
                                                        {ip || `Dispositivo ${i + 1}`}
                                                    </span>
                                                    <button
                                                        onClick={() => onToggleDevice(ip)}
                                                        className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${approved ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-white/5 text-text-muted border border-border'}`}
                                                    >
                                                        {approved ? 'Controla' : 'Só segue'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Músico remoto (internet) */}
                            <div className="w-full mb-3 bg-[#1c1c1e] border border-border rounded-lg p-3">
                                <button
                                    onClick={onToggleRemote}
                                    className={`w-full py-2.5 px-3 rounded-lg border flex items-center justify-between gap-3 transition-all active:scale-95 ${remoteSessionCode ? 'bg-secondary/15 border-secondary/40 text-secondary' : 'bg-white/5 border-border text-text-muted hover:bg-white/10'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <Globe size={15} />
                                        <span className="text-xs font-bold uppercase tracking-wider">Músico remoto (internet)</span>
                                    </span>
                                    <span className={`relative w-9 h-5 rounded-full transition-colors ${remoteSessionCode ? 'bg-secondary' : 'bg-white/20'}`}>
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${remoteSessionCode ? 'left-[18px]' : 'left-0.5'}`} />
                                    </span>
                                </button>
                                {remoteSessionCode && (
                                    <div className="mt-2.5">
                                        <p className="text-[10px] text-text-muted mb-1.5">Mande este link pro músico que está fora da rede:</p>
                                        <div className="flex items-center gap-2">
                                            <span className="flex-1 text-[11px] text-white font-mono bg-black/30 py-1.5 px-2 rounded-md truncate select-all">{remoteLink}</span>
                                            <button
                                                onClick={() => navigator.clipboard?.writeText(remoteLink)}
                                                className="shrink-0 p-2 rounded-md bg-secondary/15 text-secondary border border-secondary/30 active:scale-90 transition-all"
                                                title="Copiar link"
                                            >
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                        <p className="text-[9px] text-text-muted mt-1.5">O remoto acompanha música, tom, seção e letra (não ouve o áudio).</p>
                                    </div>
                                )}
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
