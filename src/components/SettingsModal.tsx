import { X, MonitorSpeaker, RefreshCcw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../hooks/useAuth';
import { useState } from 'react';
import type { Channel } from '../types';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    channels: Channel[];
    onSetChannelBus: (channelId: string, bus: '1' | '2' | '1/2') => void;
    onOpenAdmin: () => void;
}

type Tab = 'Geral' | 'Buses' | 'Sobre';

export function SettingsModal({ isOpen, onClose, channels, onSetChannelBus, onOpenAdmin }: SettingsModalProps) {
    const { settings, updateSetting, availableAudioDevices, refreshAudioDevices } = useSettings();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('Geral');

    const isAdmin = user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com';

    if (!isOpen) return null;

    const tabs: Tab[] = ['Geral', 'Buses', 'Sobre'];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="daw-panel w-full max-w-2xl rounded-lg flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
                    <div className="flex-1"></div>
                    <div className="flex lcd-display rounded-md p-0.5 w-full max-w-md">
                        {tabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 text-[10px] font-bold py-1.5 rounded transition-all active:scale-95 cursor-pointer uppercase tracking-wider font-mono ${activeTab === tab ? 'bg-primary/15 text-primary' : 'text-text-muted hover:bg-white/5 hover:text-white'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 flex justify-end">
                        <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-md text-text-muted transition-all active:scale-90 cursor-pointer">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto min-h-[400px] max-h-[70vh] p-6 bg-[#0e0e10]">

                    {activeTab === 'Geral' && (
                        <div className="flex flex-col gap-6">
                            {/* Auto Pan */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-white text-sm font-bold">Auto Pan Stereo</h3>
                                    <p className="text-text-muted text-[10px] font-mono">Route Click & Guide to L channel, tracks to R</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                                    <input type="checkbox" className="sr-only peer" checked={settings.autoPan} onChange={(e) => updateSetting('autoPan', e.target.checked)} />
                                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>

                            <hr className="border-border" />

                            {/* Audio Device */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1 pr-4">
                                    <h3 className="text-white text-sm font-bold flex items-center gap-2">
                                        Audio Device
                                        <button onClick={refreshAudioDevices} className="opacity-40 hover:opacity-100 transition-all active:scale-90 cursor-pointer"><RefreshCcw size={12} /></button>
                                    </h3>
                                    <p className="text-text-muted text-[10px] font-mono">Select master output device</p>
                                </div>
                                <div className="shrink-0 flex items-center justify-end">
                                    <div className="relative">
                                        <select
                                            className="appearance-none daw-input hover:bg-white/5 text-white text-[10px] font-bold py-2 pl-3 pr-8 rounded-md cursor-pointer max-w-[200px] truncate font-mono"
                                            value={settings.audioDeviceId}
                                            onChange={(e) => updateSetting('audioDeviceId', e.target.value)}
                                        >
                                            <option value="default" className="bg-[#1c1c1e] text-white">Padrão do Sistema</option>
                                            {availableAudioDevices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(device => (
                                                <option key={device.deviceId} value={device.deviceId} className="bg-[#1c1c1e] text-white">
                                                    {device.label || `Dispositivo (${device.deviceId.substring(0, 5)}...)`}
                                                </option>
                                            ))}
                                        </select>
                                        <MonitorSpeaker size={16} className="absolute right-3 top-2.5 opacity-50 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            <hr className="border-border" />

                            <div className="flex items-center justify-between opacity-50 pointer-events-none">
                                <div>
                                    <h3 className="text-white text-sm font-bold">Waveform Grid</h3>
                                    <p className="text-text-muted text-[10px] font-mono">Overlay beat grid on waveform (Coming Soon)</p>
                                </div>
                                <label className="relative inline-flex items-center ml-4 shrink-0">
                                    <input type="checkbox" className="sr-only peer" checked readOnly />
                                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>

                            <hr className="border-border" />

                            {/* Cloud Admin Access */}
                            {isAdmin && (
                                <div className="flex items-center justify-between p-3 bg-secondary/5 rounded-md border border-secondary/15 mt-4">
                                    <div>
                                        <h3 className="text-secondary text-sm font-bold uppercase tracking-wider">Upload Panel</h3>
                                        <p className="text-text-muted text-[10px] font-mono">Publish songs to cloud library</p>
                                    </div>
                                    <button
                                        onClick={() => { onClose(); onOpenAdmin(); }}
                                        className="px-3 py-1.5 bg-secondary text-black text-[10px] font-bold rounded-md hover:scale-105 active:scale-95 transition-all cursor-pointer uppercase tracking-wider"
                                    >
                                        Open Panel
                                    </button>
                                </div>
                            )}
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
                            <p className="text-text-muted text-[10px] mb-4 font-mono">Define which stereo bus each channel routes to. Bus 1 = L, Bus 2 = R, 1/2 = Stereo.</p>
                                    {channels.map(ch => (
                                        <div key={ch.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0">
                                            <span className="text-white font-bold text-xs font-mono uppercase tracking-wider">{ch.name}</span>
                                            <select
                                                className="daw-input text-white text-[10px] font-bold py-1 px-2 rounded-md cursor-pointer font-mono"
                                                value={ch.bus}
                                                onChange={(e) => onSetChannelBus(ch.id, e.target.value as '1' | '2' | '1/2')}
                                            >
                                                <option value="1" className="bg-[#1c1c1e] text-white">1 (L)</option>
                                                <option value="2" className="bg-[#1c1c1e] text-white">2 (R)</option>
                                                <option value="1/2" className="bg-[#1c1c1e] text-white">1/2 (Stereo)</option>
                                            </select>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'Sobre' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                            <div className="text-3xl font-black tracking-[0.15em] text-primary uppercase font-mono">PLAYBACK</div>
                            <div className="text-text-muted text-[10px] font-mono tracking-wider">Studio Engine v5.0</div>
                            <div className="text-text-muted/40 text-[9px] max-w-sm font-mono">Professional multitrack playback system. Built with Web Audio API, React, and IndexedDB.</div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
}
