import { X, MonitorSpeaker, RefreshCcw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect } from 'react';
import type { Channel } from '../types';
import { PricingModal } from './PricingModal';
import { supabase } from '../lib/supabase';
import { planDisplayName, isPaidPlan } from '../lib/plans';
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark';
import { ProfileTab } from './ProfileTab';
import { CHANGELOG } from '../lib/changelog';
import { Sparkles } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    channels: Channel[];
    onSetChannelBus: (channelId: string, bus: '1' | '2' | '1/2') => void;
    onOpenAdmin: () => void;
    onReplayTour: () => void;
}

type Tab = 'Perfil' | 'Geral' | 'Buses' | 'Novidades' | 'Assinatura' | 'Sobre';

export function SettingsModal({ isOpen, onClose, channels, onSetChannelBus, onOpenAdmin, onReplayTour }: SettingsModalProps) {
    const { settings, updateSetting, availableAudioDevices, refreshAudioDevices } = useSettings();
    const { user, updateProfile, updatePassword, signOutEverywhere, deleteAccount } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('Perfil');
    const [isPricingOpen, setIsPricingOpen] = useState(false);
    const [userPlan, setUserPlan] = useState<string>('free');

    useEffect(() => {
        const fetchPlan = async () => {
            if (user && supabase) {
                const { data } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
                if (data) setUserPlan(data.plan || 'free');
            }
        };
        fetchPlan();
    }, [user]);

    const isAdmin = user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com';

    if (!isOpen) return null;

    const tabs: Tab[] = ['Perfil', 'Geral', 'Buses', 'Novidades', 'Assinatura', 'Sobre'];

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

                    {activeTab === 'Perfil' && user && (
                        <ProfileTab
                            user={user}
                            userPlan={userPlan}
                            updateProfile={updateProfile}
                            updatePassword={updatePassword}
                            signOutEverywhere={signOutEverywhere}
                            deleteAccount={deleteAccount}
                            onUpgrade={() => setIsPricingOpen(true)}
                            onClose={onClose}
                        />
                    )}

                    {activeTab === 'Geral' && (
                        <div className="flex flex-col gap-6">
                            {/* Rever tutorial */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-white text-sm font-bold">Tutorial</h3>
                                    <p className="text-text-muted text-[10px] font-mono">Rever o guia de uso do app</p>
                                </div>
                                <button
                                    onClick={() => { onClose(); onReplayTour(); }}
                                    className="ml-4 shrink-0 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/25 active:scale-95 transition-all cursor-pointer"
                                >
                                    Ver tutorial
                                </button>
                            </div>

                            <hr className="border-border" />

                            {/* Auto Pan */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-white text-sm font-bold">Pan Estéreo Automático</h3>
                                    <p className="text-text-muted text-[10px] font-mono">Click e Guia no canal L, faixas no canal R</p>
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
                                        Dispositivo de Áudio
                                        <button onClick={refreshAudioDevices} className="opacity-40 hover:opacity-100 transition-all active:scale-90 cursor-pointer"><RefreshCcw size={12} /></button>
                                    </h3>
                                    <p className="text-text-muted text-[10px] font-mono">Selecionar dispositivo de saída principal</p>
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
                                    <h3 className="text-white text-sm font-bold">Grade de Compasso</h3>
                                    <p className="text-text-muted text-[10px] font-mono">Grade de beats na forma de onda (Em breve)</p>
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
                                        <h3 className="text-secondary text-sm font-bold uppercase tracking-wider">Painel de Upload</h3>
                                        <p className="text-text-muted text-[10px] font-mono">Publicar músicas na biblioteca da nuvem</p>
                                    </div>
                                    <button
                                        onClick={() => { onClose(); onOpenAdmin(); }}
                                        className="px-3 py-1.5 bg-secondary text-black text-[10px] font-bold rounded-md hover:scale-105 active:scale-95 transition-all cursor-pointer uppercase tracking-wider"
                                    >
                                        Abrir Painel
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
                            <p className="text-text-muted text-[10px] mb-4 font-mono">Define para qual bus estéreo cada canal é roteado. Bus 1 = L, Bus 2 = R, 1/2 = Estéreo.</p>
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

                    {activeTab === 'Novidades' && (
                        <div className="flex flex-col gap-5 max-w-lg mx-auto">
                            {CHANGELOG.map((entry, idx) => (
                                <div key={entry.version} className={idx === 0 ? 'bg-primary/[0.06] border border-primary/20 rounded-xl p-4' : 'border-b border-white/5 pb-5'}>
                                    <div className="flex items-center gap-2 mb-2">
                                        {idx === 0 && <Sparkles size={14} className="text-primary" />}
                                        <span className={`font-bold ${idx === 0 ? 'text-white' : 'text-zinc-300'}`}>{entry.title}</span>
                                        <span className="text-[10px] font-mono text-text-muted ml-auto">v{entry.version}</span>
                                    </div>
                                    <ul className="space-y-1.5">
                                        {entry.items.map((item, i) => (
                                            <li key={i} className="flex items-start gap-2 text-[13px] text-zinc-400 leading-relaxed">
                                                <span className="mt-1.5 w-1 h-1 rounded-full bg-text-muted shrink-0" />
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'Assinatura' && (
                        <div className="flex flex-col items-center justify-center p-6 gap-6">
                            <div className="w-full max-w-md bg-[#1c1c1e] rounded-xl p-6 border border-border flex flex-col items-center text-center shadow-lg">
                                <h3 className="text-white text-lg font-bold uppercase tracking-wider mb-2">Seu Plano Atual</h3>
                                
                                <div className="text-3xl font-black text-laranja uppercase mb-4 tracking-widest">
                                    {planDisplayName(userPlan)}
                                </div>

                                <p className="text-text-muted text-xs font-mono mb-6">
                                    {!isPaidPlan(userPlan)
                                        ? 'Você está no plano Livre. Faça upgrade para liberar todas as funcionalidades.'
                                        : 'Obrigado por apoiar o Playback Studio. Aproveite tudo do seu plano.'}
                                </p>

                                {(() => {
                                    const LIMITS = { free: 5, essencial: 50, pro: 150, essencial_anual: 50, pro_anual: 150 };
                                    const userPlanKey = (userPlan || 'free').toLowerCase();
                                    const maxLimit = LIMITS[userPlanKey as keyof typeof LIMITS] || 5;
                                    const currentUsage = parseInt(localStorage.getItem('separator_usage') || '0');
                                    const usagePercent = Math.min(100, Math.round((currentUsage / maxLimit) * 100));
                                    
                                    return (
                                        <div className="w-full bg-white/5 rounded-lg p-4 mb-6 border border-white/10 text-left">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-white text-xs font-bold uppercase tracking-wider">Separações de Faixas com IA</span>
                                                <span className="text-text-muted text-[10px] font-mono">{currentUsage} / {maxLimit} usadas</span>
                                            </div>
                                            <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-500 ${usagePercent > 90 ? 'bg-red-500' : 'bg-primary'}`} 
                                                    style={{ width: `${usagePercent}%` }}
                                                />
                                            </div>
                                            <p className="text-white/30 text-[9px] font-mono mt-2">O limite é renovado a cada ciclo de faturamento.</p>
                                        </div>
                                    );
                                })()}
                                
                                <button
                                    onClick={() => setIsPricingOpen(true)}
                                    className="px-6 py-3 bg-laranja text-bone text-xs font-bold uppercase tracking-wider rounded-lg transition-transform hover:scale-105 active:scale-95 shadow-lg shadow-laranja/25 mb-2"
                                >
                                    {!isPaidPlan(userPlan) ? 'Ver Planos & Assinar' : 'Alterar Plano'}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'Sobre' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                            <PlaybackStudioWordmark size="lg" tone="light" />
                            <div className="text-text-muted text-[10px] font-mono tracking-wider mt-2">A plataforma do domingo · v5.0</div>
                            <div className="text-text-muted/40 text-[9px] max-w-sm font-mono">Stems pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.</div>
                        </div>
                    )}
                </div>
            </div>
            <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
        </div >
    );
}
