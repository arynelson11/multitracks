import { X, ChevronRight, MonitorSpeaker, RefreshCcw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useState } from 'react';
import type { Channel } from '../types';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    channels: Channel[];
    onSetChannelBus: (channelId: string, bus: '1' | '2' | '1/2') => void;
}

type Tab = 'Geral' | 'Canais' | 'Buses' | 'MIDI' | 'Sobre';

export function SettingsModal({ isOpen, onClose, channels, onSetChannelBus }: SettingsModalProps) {
    const { settings, updateSetting, availableAudioDevices, refreshAudioDevices } = useSettings();
    const [activeTab, setActiveTab] = useState<Tab>('Geral');

    if (!isOpen) return null;

    const tabs: Tab[] = ['Geral', 'Canais', 'Buses', 'MIDI', 'Sobre'];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#1c1c1e] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div className="flex-1"></div>
                    <div className="flex bg-black/40 rounded-lg p-1 w-full max-w-md">
                        {tabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors cursor-pointer ${activeTab === tab ? 'bg-white/20 text-white shadow' : 'text-text-muted hover:bg-white/5'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 flex justify-end">
                        <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-text-muted transition-colors cursor-pointer">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto min-h-[400px] max-h-[70vh] p-6 bg-[#000000]">

                    {activeTab === 'Geral' && (
                        <div className="flex flex-col gap-6">
                            {/* Auto Pan */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-white text-base font-medium">Auto Pan Estéreo</h3>
                                    <p className="text-text-muted text-xs">Enviar Metrônomo & Guia para canal esquerdo (L) e tracks para o direito (R)</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                                    <input type="checkbox" className="sr-only peer" checked={settings.autoPan} onChange={(e) => updateSetting('autoPan', e.target.checked)} />
                                    <div className="w-11 h-6 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0A84FF]"></div>
                                </label>
                            </div>

                            <hr className="border-white/5" />

                            {/* Audio Device */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1 pr-4">
                                    <h3 className="text-white text-base font-medium flex items-center gap-2">
                                        Dispositivo de Áudio
                                        <button onClick={refreshAudioDevices} className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"><RefreshCcw size={14} /></button>
                                    </h3>
                                    <p className="text-text-muted text-xs">Selecione por onde o som master vai sair (Placa de Áudio / Fone)</p>
                                </div>
                                <div className="shrink-0 flex items-center justify-end">
                                    <div className="relative">
                                        <select
                                            className="appearance-none bg-transparent hover:bg-white/5 border border-white/10 text-white text-sm font-medium py-2 pl-4 pr-10 rounded-lg cursor-pointer outline-none transition-colors max-w-[200px] truncate"
                                            value={settings.audioDeviceId}
                                            onChange={(e) => updateSetting('audioDeviceId', e.target.value)}
                                        >
                                            <option value="default">Padrão do Sistema</option>
                                            {availableAudioDevices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(device => (
                                                <option key={device.deviceId} value={device.deviceId}>
                                                    {device.label || `Dispositivo (${device.deviceId.substring(0, 5)}...)`}
                                                </option>
                                            ))}
                                        </select>
                                        <MonitorSpeaker size={16} className="absolute right-3 top-2.5 opacity-50 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            <hr className="border-white/5" />

                            <div className="flex items-center justify-between opacity-50 pointer-events-none">
                                <div>
                                    <h3 className="text-white text-base font-medium">Grade da Waveform</h3>
                                    <p className="text-text-muted text-xs">Sobrepor grade de compasso e beat na onda wave (Em Breve)</p>
                                </div>
                                <label className="relative inline-flex items-center ml-4 shrink-0">
                                    <input type="checkbox" className="sr-only peer" checked readOnly />
                                    <div className="w-11 h-6 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0A84FF]"></div>
                                </label>
                            </div>
                        </div>
                    )}

                    {activeTab === 'Buses' && (
                        <div className="flex flex-col gap-1">
                            {channels.length === 0 ? (
                                <div className="flex items-center justify-center h-40 text-text-muted/50">
                                    Carregue uma música primeiro para ver os canais.
                                </div>
                            ) : (
                                <>
                                    <p className="text-text-muted text-xs mb-4">Defina para qual bus estéreo (saída) cada canal será direcionado. Bus 1 = Esquerdo (L), Bus 2 = Direito (R), 1/2 = Centro (Estéreo).</p>
                                    {channels.map(ch => (
                                        <div key={ch.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-b-0">
                                            <span className="text-white font-medium text-sm">{ch.name}</span>
                                            <select
                                                className="bg-transparent border border-white/10 text-white text-sm font-medium py-1.5 px-3 rounded-lg cursor-pointer outline-none hover:bg-white/5 transition-colors"
                                                value={ch.bus}
                                                onChange={(e) => onSetChannelBus(ch.id, e.target.value as '1' | '2' | '1/2')}
                                            >
                                                <option value="1">1 (L)</option>
                                                <option value="2">2 (R)</option>
                                                <option value="1/2">1/2 (Stereo)</option>
                                            </select>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'Sobre' && (
                        <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
                            <div className="text-4xl font-bold tracking-tighter text-primary">MULTITRACKS</div>
                            <div className="text-text-muted text-sm">Playback WebApp v5.0</div>
                            <div className="text-text-muted/50 text-xs max-w-sm">Sistema de reprodução multitrack para uso ao vivo. Desenvolvido com Web Audio API, React e IndexedDB.</div>
                        </div>
                    )}

                    {(activeTab === 'Canais' || activeTab === 'MIDI') && (
                        <div className="flex items-center justify-center h-full text-text-muted/50 flex-col gap-2 py-12">
                            <div className="flex items-center justify-center p-4 rounded-full border border-white/5 bg-white/5">
                                <ChevronRight size={32} className="opacity-30" />
                            </div>
                            <span>Em Desenvolvimento</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
