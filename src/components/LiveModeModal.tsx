import { useId, useRef } from 'react';
import { X, Server, Wifi, Gamepad2, Smartphone, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Chip, IconButton, Led, Notice, Panel, Switch } from './ui';

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
    const titleId = useId();
    // Apertou dentro da caixa (ex.: arrastando pra selecionar o endereço): o clique que cai na
    // camada de fora (ancestral comum) não fecha, como no StageDialog (revisão macro BC, BC2-M9).
    const pressedInside = useRef(false);
    const allApproved = devices.length > 0 && devices.every(ip => approvedIps.includes(ip));
    const remoteLink = remoteSessionCode ? `https://playbackstudio.com.br/?s=${remoteSessionCode}` : '';
    if (!isOpen) return null;

    const live = !isStarting && !serverError && !!serverUrl;

    // Camada própria em z-[100], fora do StageDialog: passando do limite de aparelhos, o App abre os
    // Planos (z-[110]) por cima desta janela. Toque fora fecha, como sempre.
    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-ps-gutter"
            onPointerDown={e => { pressedInside.current = e.target !== e.currentTarget; }}
            onClick={() => {
                const inside = pressedInside.current;
                pressedInside.current = false;
                if (!inside) onClose();
            }}
        >
            <Panel
                variant="pop"
                role="dialog"
                aria-labelledby={titleId}
                onClick={e => { pressedInside.current = false; e.stopPropagation(); }}
                className="flex max-h-full w-full max-w-md flex-col overflow-hidden font-ps-sans text-ps-bone"
            >
                <div className="flex shrink-0 items-center gap-3 border-b border-ps-line py-2 pl-5 pr-2">
                    <Led state={live ? 'live' : 'off'} label={live ? 'Ao vivo' : undefined} />
                    <h2 id={titleId} className="min-w-0 flex-1 text-ps-md font-bold">Modo Ao Vivo</h2>
                    <IconButton tone="ghost" aria-label="Fechar" icon={<X size={18} />} onClick={onClose} />
                </div>

                {/* justify-center-safe: centraliza só quando cabe. Com a banda inteira conectada, o
                    justify-center jogava o topo do QR acima do começo da rolagem (BC2-I2). */}
                <div className="flex min-h-[300px] flex-col items-center justify-center-safe overflow-y-auto p-5">
                    {isStarting ? (
                        <div role="status" className="flex flex-col items-center gap-4">
                            <Server size={48} aria-hidden="true" className="animate-ps-blink text-ps-dim motion-reduce:animate-none" />
                            <p className="ps-label">Iniciando o servidor...</p>
                        </div>
                    ) : serverError ? (
                        <Notice tone="alert" role="alert" className="w-full">
                            <span className="block">Erro ao iniciar o servidor</span>
                            <span className="block font-ps-mono text-ps-sm font-normal break-words">{serverError}</span>
                        </Notice>
                    ) : serverUrl ? (
                        <div className="flex w-full flex-col items-center gap-4">
                            {/* O QR code precisa de fundo claro pra câmera ler. */}
                            <div className="rounded-ps-lg bg-white p-4">
                                <QRCodeSVG data-qr="" value={serverUrl} size={200} level="H" includeMargin={false} />
                            </div>

                            <div className="flex w-full flex-col items-center gap-2 rounded-ps-lg bg-ps-s1 p-4 text-center inset-ring inset-ring-ps-line">
                                <p className="flex items-center gap-2 text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut">
                                    <Wifi size={14} aria-hidden="true" className="shrink-0" />
                                    Conecte na mesma rede
                                </p>
                                <p className="text-ps-sm text-ps-mut">Acesse pelo navegador do celular:</p>
                                <p className="max-w-full rounded-ps-md bg-ps-ink-0 px-3 py-1.5 font-ps-mono text-ps-sm font-bold text-ps-bone break-all select-all">
                                    {serverUrl}
                                </p>
                            </div>

                            {/* Quem controla: aprovação por aparelho */}
                            <div className="flex w-full flex-col gap-2 rounded-ps-lg bg-ps-s1 p-3 inset-ring inset-ring-ps-line">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="flex items-center gap-2 pl-1 text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut">
                                        <Gamepad2 size={14} aria-hidden="true" className="shrink-0" />
                                        Quem controla
                                    </p>
                                    {devices.length > 0 && (
                                        <Button onClick={onToggleAll}>{allApproved ? 'Bloquear todos' : 'Liberar todos'}</Button>
                                    )}
                                </div>

                                {devices.length === 0 ? (
                                    <p className="flex items-center justify-center gap-1.5 py-2 text-center text-ps-sm text-ps-mut">
                                        <Smartphone size={14} aria-hidden="true" className="shrink-0" /> Nenhum dispositivo conectado ainda.
                                    </p>
                                ) : (
                                    <ul className="flex flex-col gap-1.5">
                                        {devices.map((ip, i) => {
                                            const approved = approvedIps.includes(ip);
                                            return (
                                                <li key={ip} className="flex items-center justify-between gap-2 pl-1">
                                                    <span className="flex min-w-0 items-center gap-1.5 font-ps-mono text-ps-sm text-ps-bone break-all">
                                                        <Smartphone size={14} aria-hidden="true" className="shrink-0 text-ps-mut" />
                                                        {ip || `Dispositivo ${i + 1}`}
                                                    </span>
                                                    <Chip small on={approved} aria-pressed={approved} onClick={() => onToggleDevice(ip)}>
                                                        {approved ? 'Controla' : 'Só segue'}
                                                    </Chip>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            {/* Músico remoto (internet): oculto até a Fase 5 (controle pela nuvem) ficar pronta */}
                            {false && (
                            <div className="flex w-full flex-col gap-2 rounded-ps-lg bg-ps-s1 p-3 inset-ring inset-ring-ps-line">
                                <Switch label="Músico remoto (internet)" checked={!!remoteSessionCode} onChange={onToggleRemote} />
                                {remoteSessionCode && (
                                    <div className="flex flex-col gap-1.5">
                                        <p className="text-ps-sm text-ps-mut">Mande este link pro músico que está fora da rede:</p>
                                        <div className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 rounded-ps-md bg-ps-ink-0 px-2 py-1.5 font-ps-mono text-ps-sm text-ps-bone break-all select-all">{remoteLink}</span>
                                            <IconButton aria-label="Copiar link" icon={<Copy size={14} />} onClick={() => navigator.clipboard?.writeText(remoteLink)} />
                                        </div>
                                        <p className="text-ps-sm text-ps-mut">O remoto acompanha música, tom, seção e letra (não ouve o áudio).</p>
                                    </div>
                                )}
                            </div>
                            )}

                            <div className="flex w-full flex-col">
                                <Button tone="alert" onClick={onStopServer}>Desativar Modo Ao Vivo</Button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </Panel>
        </div>
    );
}
