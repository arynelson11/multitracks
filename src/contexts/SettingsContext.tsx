import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { canPickAudioOutput, listAudioOutputs } from '../lib/audioOutputs';

export interface AppSettings {
    autoPan: boolean;
    audioDeviceId: string;
}

const defaultSettings: AppSettings = {
    autoPan: true,
    audioDeviceId: 'default'
};

interface SettingsContextType {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    availableAudioDevices: MediaDeviceInfo[];
    refreshAudioDevices: () => Promise<void>;
    // false no iPhone, iPad, Safari e Firefox: o navegador não deixa trocar a saída de áudio.
    canPickOutput: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);
    const [availableAudioDevices, setAvailableAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);
    const [canPickOutput] = useState(canPickAudioOutput);

    useEffect(() => {
        const stored = localStorage.getItem('mt_app_settings');
        if (stored) {
            try {
                setSettings({ ...defaultSettings, ...JSON.parse(stored) });
            } catch (e) {
                console.error("Failed to parse settings", e);
            }
        }
        setIsLoaded(true);
    }, []);

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            localStorage.setItem('mt_app_settings', JSON.stringify(next));
            return next;
        });
    };

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

    if (!isLoaded) return null;

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, availableAudioDevices, refreshAudioDevices, canPickOutput }}>
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
