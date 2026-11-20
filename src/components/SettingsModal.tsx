import { Download } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect, useId, useMemo, useRef } from 'react';
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
import { Button, Panel, Select, Switch, TabPanel, Tabs } from './ui';
import { SettingRow } from './settings/SettingRow';
import { Icon } from './stage/icons';

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
}

type Tab = 'Perfil' | 'Geral' | 'Buses' | 'Novidades' | 'Assinatura' | 'Sobre';

export function SettingsModal({ isOpen, onClose, channels, onSetChannelBus, onOpenAdmin, onReplayTour, desktopUpdate, onInstallUpdate, focusSection = null, isPlaying = false, maxOutputChannels = 2, outputWarning = null }: SettingsModalProps) {
    const { settings, updateSetting, canPickOutput, outputLoadWarnings } = useSettings();
    // Plano efetivo (cancelado vale até a data de fim, depois é Livre).
    const { user, userPlan, isAdmin, refreshPlan, updateProfile, updatePassword, signOutEverywhere, deleteAccount } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('Perfil');
    const tabsId = useId();
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-ps-gutter" onClick={onClose}>
            <Panel
                variant="pop"
                role="dialog"
                aria-modal="true"
                aria-label="Configurações"
                className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden font-ps-sans text-ps-bone"
                onClick={e => e.stopPropagation()}
            >

                {/* Cabeçalho: abas (descem de linha quando não cabem) e o X do palco */}
                <div className="flex shrink-0 items-start gap-3 border-b border-ps-line p-3">
                    <Tabs
                        id={tabsId}
                        aria-label="Abas das Configurações"
                        tabs={tabs.map(t => ({ value: t, label: t }))}
                        value={activeTab}
                        onChange={setActiveTab}
                        className="min-w-0 flex-1"
                    />
                    <Button icon={<Icon name="x" />} aria-label="Fechar" title="Fechar" onClick={onClose} />
                </div>

                {/* Conteúdo da aba aberta */}
                <TabPanel tabsId={tabsId} value={activeTab} className="min-h-[400px] max-h-[70vh] overflow-y-auto bg-ps-ink-0 p-6">

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

                            <hr className="border-ps-line" />

                            {/* Rever tutorial */}
                            <SettingRow title="Tutorial" description="Rever o guia de uso do app">
                                <Button onClick={() => { onClose(); onReplayTour(); }}>
                                    Ver tutorial
                                </Button>
                            </SettingRow>

                            <hr className="border-ps-line" />

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
                                    <hr className="border-ps-line" />
                                    <Switch
                                        label="Pan Estéreo Automático"
                                        description="Click e Guia no canal L, faixas no canal R"
                                        checked={settings.autoPan}
                                        onChange={changeAutoPan}
                                    />
                                </>
                            )}

                            <hr className="border-ps-line" />

                            {/* Em breve: ligada e sem ação, como antes. */}
                            <Switch
                                label="Grade de Compasso"
                                description="Grade de beats na forma de onda (Em breve)"
                                checked
                                disabled
                                onChange={() => {}}
                            />

                            <hr className="border-ps-line" />

                            {/* Cloud Admin Access */}
                            {isAdmin && (
                                <SettingRow
                                    title="Painel de Upload"
                                    description="Publicar músicas na biblioteca da nuvem"
                                    className="mt-4 rounded-ps-lg bg-ps-s1 p-3 inset-ring inset-ring-ps-line"
                                >
                                    <Button onClick={() => { onClose(); onOpenAdmin(); }}>
                                        Abrir Painel
                                    </Button>
                                </SettingRow>
                            )}
                        </div>
                    )}

                    {activeTab === 'Buses' && stereoMode && (
                        <div className="flex flex-col gap-1">
                            {channels.length === 0 ? (
                                <div className="flex items-center justify-center h-40 px-4 text-center text-ps-base text-ps-mut">
                                    Carregue uma música primeiro para ver os canais.
                                </div>
                            ) : (
                                <>
                                    <p className="mb-4 text-ps-base leading-snug text-pretty text-ps-mut">Define para qual bus estéreo cada canal é roteado. Bus 1 = L, Bus 2 = R, 1/2 = Estéreo.</p>
                                    {channels.map(ch => {
                                        const label = labelById.get(ch.id) ?? ch.name;
                                        return (
                                            <div key={ch.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ps-line py-2.5 last:border-b-0">
                                                <span title={ch.name} className="min-w-0 break-words text-ps-base font-bold text-ps-bone">{label}</span>
                                                <Select
                                                    label={`Bus de ${label}`}
                                                    hideLabel
                                                    value={ch.bus}
                                                    onChange={(e) => onSetChannelBus(ch.id, e.target.value as '1' | '2' | '1/2')}
                                                    className="shrink-0"
                                                >
                                                    <option value="1">1 (L)</option>
                                                    <option value="2">2 (R)</option>
                                                    <option value="1/2">1/2 (Stereo)</option>
                                                </Select>
                                            </div>
                                        );
                                    })}
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
                </TabPanel>
            </Panel>
            <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
        </div>
    );
}
