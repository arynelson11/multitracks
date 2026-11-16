import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { canPickAudioOutput, listAudioOutputs } from '../lib/audioOutputs';
import { migrateOutputs, OUTPUTS_MIGRATED_KEY, OUTPUTS_MIGRATED_VALUE, type OutputWarning } from '../lib/outputPlan';
import type { OutputSettings, StageVersion } from '../lib/stageContracts';

export interface AppSettings {
    // Pan automático: só existe em "Tudo junto" (R-23). Quem usava passa pra "Click e Guia separados".
    autoPan: boolean;
    audioDeviceId: string;
    // Saídas de áudio por papel (spec 5e): Tudo junto, Click e Guia separados ou 4 ou mais.
    outputs: OutputSettings;
    // Palco novo ou antigo (R-25). Padrão: novo.
    stageVersion: StageVersion;
    // Pede ao motor pra zerar, na primeira restauração, os pans ±1 que o pan automático gravou.
    legacyPanReset: boolean;
}

const SETTINGS_KEY = 'mt_app_settings';

interface SettingsContextType {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    availableAudioDevices: MediaDeviceInfo[];
    refreshAudioDevices: () => Promise<void>;
    // false no iPhone, iPad, Safari e Firefox: o navegador não deixa trocar a saída de áudio.
    canPickOutput: boolean;
    // Avisos da leitura das saídas gravadas (ex.: lado assumido). Somem quando o operador
    // grava uma escolha de saídas (updateSetting('outputs', ...)).
    outputLoadWarnings: readonly OutputWarning[];
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lê as configurações do aparelho e faz a migração das saídas (R-23) a partir do JSON CRU
 * gravado, nunca do objeto já mesclado com os padrões (Ruling T12/T25 b): quem nunca gravou
 * nada tinha o pan automático ligado (era o padrão) e precisa entrar em "Click e Guia
 * separados". O marcador "já migrado" mora numa chave própria (Ruling T6-1).
 */
function readStoredSettings(): { settings: AppSettings; warnings: OutputWarning[] } {
    let raw: Record<string, unknown> = {};
    let outputsMigrated = false;
    try {
        outputsMigrated = localStorage.getItem(OUTPUTS_MIGRATED_KEY) === OUTPUTS_MIGRATED_VALUE;
        const stored = localStorage.getItem(SETTINGS_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        if (isRecord(parsed)) raw = parsed;
    } catch (e) {
        console.error("Failed to parse settings", e);
    }
    const migrated = migrateOutputs({ autoPan: raw.autoPan, outputs: raw.outputs, outputsMigrated });
    return {
        settings: {
            ...raw,
            audioDeviceId: typeof raw.audioDeviceId === 'string' ? raw.audioDeviceId : 'default',
            outputs: migrated.outputs,
            autoPan: migrated.autoPan,
            // Valor estranho vira o palco novo.
            stageVersion: raw.stageVersion === 'antigo' ? 'antigo' : 'novo',
            // O pedido de zerar fica gravado até o motor fazer a primeira restauração.
            legacyPanReset: migrated.resetLegacyPans || raw.legacyPanReset === true,
        },
        warnings: migrated.warnings,
    };
}

/**
 * Grava a migração: as saídas (dentro das configurações) e depois o marcador, juntos. Se só o
 * marcador sumir, as saídas válidas vencem e nada é zerado de novo; se só as configurações
 * sumirem, o marcador impede cair em "Tudo junto" (Ruling T6-1).
 */
function saveMigratedSettings(settings: AppSettings): void {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        localStorage.setItem(OUTPUTS_MIGRATED_KEY, OUTPUTS_MIGRATED_VALUE);
    } catch (e) {
        console.error("Failed to save settings", e);
    }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [initial] = useState(readStoredSettings);
    const [settings, setSettings] = useState<AppSettings>(initial.settings);
    const [outputLoadWarnings, setOutputLoadWarnings] = useState<readonly OutputWarning[]>(initial.warnings);
    const [availableAudioDevices, setAvailableAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [canPickOutput] = useState(canPickAudioOutput);

    // A migração vale já na primeira carga: grava antes de qualquer outra mudança.
    useEffect(() => {
        saveMigratedSettings(initial.settings);
    }, [initial]);

    const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        // Escolha de saídas gravada pelo operador: os avisos da leitura antiga não valem mais.
        if (key === 'outputs') setOutputLoadWarnings([]);
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    // Lista as saídas e, se faltar o nome delas, pede o microfone (o navegador só
    // mostra os nomes com essa permissão). Quem chama é a aba Geral das Configurações,
    // que só existe depois do login: a carga do site e a landing nunca pedem microfone.
    // Navegador que não troca a saída (canPickOutput falso) não lista nem pede nada.
    const refreshAudioDevices = useCallback(async () => {
        if (!canPickOutput) return;
        try {
            setAvailableAudioDevices(await listAudioOutputs(navigator.mediaDevices, { askLabels: true, canPickOutput }));
        } catch (e) {
            console.error("Failed to enumerate audio devices", e);
        }
    }, [canPickOutput]);

    // Troca de aparelho (fone ou interface plugada): atualiza a lista sem pedir nada.
    useEffect(() => {
        if (!canPickOutput) return;
        const onDeviceChange = () => {
            listAudioOutputs(navigator.mediaDevices, { askLabels: false, canPickOutput })
                .then(setAvailableAudioDevices)
                .catch(e => console.error("Failed to enumerate audio devices", e));
        };
        navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
        return () => {
            navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
        };
    }, [canPickOutput]);

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, availableAudioDevices, refreshAudioDevices, canPickOutput, outputLoadWarnings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}
