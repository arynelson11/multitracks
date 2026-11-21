import { X, Download } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Channel } from '../types';
import { buildChannelLabels } from '../lib/channelNames';
import { PricingModal } from './PricingModal';
import { AudioOutputSelect } from './AudioOutputSelect';
import { planDisplayName, isPaidPlan } from '../lib/plans';
import { SeparationUsageMeter } from './SeparationUsageMeter';
import { SubscriptionPanel } from './SubscriptionPanel';
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark';
import { ProfileTab } from './ProfileTab';
import { CHANGELOG } from '../lib/changelog';
import { Sparkles } from 'lucide-react';
import { StageVersionSetting } from './settings/StageVersionSetting';
import { AudioOutputsSection } from './settings/AudioOutputsSection';
import { CUE_TO_PA_CONFIRM_TEXT, needsCueToPaConfirm, type OutputWarning } from '../lib/outputPlan';
import type { OutputSettings } from '../lib/stageContracts';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    channels: Channel[];
    onSetChannelBus: (channelId: string, bus: '1' | '2' | '1/2') => void;
    onOpenAdmin: () => void;
    onReplayTour: () => void;
    desktopUpdate?: { latestVersion: string; url: string } | null;
    onInstallUpdate?: () => void;
    // Aberto pelo aviso SAÍDAS do palco (Ruling T18-saidas): já na aba Geral, na seção de saídas.
    focusSection?: 'outputs' | null;
    // Música tocando (ou na pré-contagem): troca que manda o click pro PA pede confirmação (Ruling T29-confirma).
    isPlaying?: boolean;
    // Canais do aparelho de saída de agora e o aviso do plano do motor (inclusive o sink-timeout).
    maxOutputChannels?: number;
    outputWarning?: OutputWarning | null;
    // Livre com a música tocando ou na pré-contagem: os Planos daqui não mostram o desconto, como os outros do App (Ruling pads-tocando).
    hideOffer?: boolean;
}

type Tab = 'Perfil' | 'Geral' | 'Buses' | 'Novidades' | 'Assinatura' | 'Sobre';

export function SettingsModal({ isOpen, onClose, channels, onSetChannelBus, onOpenAdmin, onReplayTour, desktopUpdate, onInstallUpdate, focusSection = null, isPlaying = false, maxOutputChannels = 2, outputWarning = null, hideOffer = false }: SettingsModalProps) {
    const { settings, updateSetting, canPickOutput, outputLoadWarnings } = useSettings();
    // Plano efetivo (cancelado vale até a data de fim, depois é Livre).
    const { user, userPlan, isAdmin, refreshPlan, updateProfile, updatePassword, signOutEverywhere, deleteAccount } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('Perfil');
    const [isPricingOpen, setIsPricingOpen] = useState(false);

    // Aberto pelo aviso SAÍDAS: vai pra aba Geral (ajuste no render, quando abre) e rola até as saídas.
    const outputsRef = useRef<HTMLDivElement>(null);
    const openedFor = isOpen ? focusSection : null;
    const [seenOpenedFor, setSeenOpenedFor] = useState<'outputs' | null>(null);
    if (openedFor !== seenOpenedFor) {
        setSeenOpenedFor(openedFor);
        if (openedFor === 'outputs') setActiveTab('Geral');
    }
    useEffect(() => {
        if (isOpen && focusSection === 'outputs' && activeTab === 'Geral') outputsRef.current?.scrollIntoView({ block: 'start' });
    }, [isOpen, focusSection, activeTab]);

    // Fora de "Tudo junto" a aba Buses e o pan automático não decidem a saída (o papel do canal
    // decide): somem (Ruling T25-autopan, R-23). Quem estava na aba Buses volta pra Geral.
    const stereoMode = settings.outputs.mode === 'stereo';
    if (!stereoMode && activeTab === 'Buses') setActiveTab('Geral');

    // Avisos das saídas: os da leitura do que estava gravado e o do plano do motor (o sink-timeout
    // só existe nele); a seção junta sem repetir.
    const outputAlerts = useMemo<readonly OutputWarning[]>(
        () => (outputWarning && !outputLoadWarnings.includes(outputWarning) ? [...outputLoadWarnings, outputWarning] : outputLoadWarnings),
        [outputWarning, outputLoadWarnings],
    );
    // Com a música tocando, trocar pra uma saída que manda Click ou Guia pro PA pede confirmação.
    const confirmCueToPa = (next: { outputs: OutputSettings; autoPan: boolean }) =>
        !needsCueToPaConfirm({ outputs: settings.outputs, autoPan: settings.autoPan }, next, maxOutputChannels, isPlaying)
        || window.confirm(CUE_TO_PA_CONFIRM_TEXT);
    const changeOutputs = (outputs: OutputSettings) => {
        if (confirmCueToPa({ outputs, autoPan: settings.autoPan })) updateSetting('outputs', outputs);
    };
    const changeAutoPan = (autoPan: boolean) => {
        if (confirmCueToPa({ outputs: settings.outputs, autoPan })) updateSetting('autoPan', autoPan);
    };

    // Nome organizado de cada canal, só pra exibição (o original segue em ch.name).
    // Fechado, não calcula: os canais mudam a cada mexida no mixer.
    const labelById = useMemo(() => {
        const map = new Map<string, string>();
        if (isOpen) for (const l of buildChannelLabels(channels)) map.set(l.id, l.label);
        return map;
    }, [isOpen, channels]);

    if (!isOpen) return null;

    const tabs: Tab[] = stereoMode ? ['Perfil', 'Geral', 'Buses', 'Novidades', 'Assinatura', 'Sobre'] : ['Perfil', 'Geral', 'Novidades', 'Assinatura', 'Sobre'];

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
                            {/* Chave do palco (R-25), a primeira opção: vale na próxima vez que a música parar. */}
                            <StageVersionSetting value={settings.stageVersion} onChange={(v) => updateSetting('stageVersion', v)} />

                            <hr className="border-border" />

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

                            {/* Audio Device (lista e pedido de microfone só aqui, com a aba Geral aberta) e,
                                junto dele, as saídas por papel: Tudo junto, Click e Guia separados ou 4 ou mais. */}
                            <div ref={outputsRef} data-settings-outputs="" className="flex flex-col gap-6 scroll-mt-2">
                                <AudioOutputSelect />
                                <AudioOutputsSection
                                    outputs={settings.outputs}
                                    maxChannels={maxOutputChannels}
                                    supportsDevicePick={canPickOutput}
                                    onChange={changeOutputs}
                                    loadWarnings={outputAlerts}
                                />
                            </div>

                            {/* Auto Pan: só em "Tudo junto" (R-23; fora dele o papel decide a saída), desligado por padrão. */}
                            {stereoMode && (
                                <>
                                    <hr className="border-border" />
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-white text-sm font-bold">Pan Estéreo Automático</h3>
                                            <p className="text-text-muted text-[10px] font-mono">Click e Guia no canal L, faixas no canal R</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                                            <input type="checkbox" className="sr-only peer" checked={settings.autoPan} onChange={(e) => changeAutoPan(e.target.checked)} />
                                            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                </>
                            )}

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

                    {activeTab === 'Buses' && stereoMode && (
                        <div className="flex flex-col gap-1">
                            {channels.length === 0 ? (
                                <div className="flex items-center justify-center h-40 text-text-muted/50">
                                    Carregue uma música primeiro para ver os canais.
                                </div>
                            ) : (
                                <>
                            <p className="text-text-muted text-[10px] mb-4 font-mono">Define para qual bus estéreo cada canal é roteado. Bus 1 = L, Bus 2 = R, 1/2 = Estéreo.</p>
                                    {channels.map(ch => (
                                        <div key={ch.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-b-0">
                                            <span title={ch.name} className="min-w-0 break-words text-white font-bold text-xs font-mono uppercase tracking-wider">{labelById.get(ch.id) ?? ch.name}</span>
                                            <select
                                                className="daw-input shrink-0 text-white text-[10px] font-bold py-1 px-2 rounded-md cursor-pointer font-mono"
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
                            {desktopUpdate && (
                                <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                                        <Download size={18} className="text-primary" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-white font-bold text-sm leading-tight">Atualização disponível</p>
                                        <p className="text-text-muted text-[12px]">A versão {desktopUpdate.latestVersion} já saiu. Baixe para atualizar o app.</p>
                                    </div>
                                    <button
                                        onClick={() => onInstallUpdate?.()}
                                        className="shrink-0 px-4 py-2 rounded-lg bg-primary text-black text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all cursor-pointer"
                                    >
                                        Baixar
                                    </button>
                                </div>
                            )}
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

                                <SeparationUsageMeter plan={userPlan} isAdmin={isAdmin} />

                                <SubscriptionPanel
                                    plan={userPlan}
                                    onChanged={() => { void refreshPlan(); }}
                                    onOpenPricing={() => setIsPricingOpen(true)}
                                />

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
                            <div className="text-text-muted text-[10px] font-mono tracking-wider mt-2">A plataforma do domingo · v{CHANGELOG[0]?.version}</div>
                            <div className="text-text-muted/40 text-[9px] max-w-sm font-mono">Multitracks pra qualquer música. Pra sua banda chegar pronta no domingo. Feito por quem toca.</div>
                        </div>
                    )}
                </div>
            </div>
            <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} hideOffer={hideOffer} />
        </div >
    );
}
