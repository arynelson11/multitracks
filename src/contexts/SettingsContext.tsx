import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { listAudioOutputs } from '../lib/audioOutputs';

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
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);
    const [availableAudioDevices, setAvailableAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

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
    const refreshAudioDevices = useCallback(async () => {
        try {
            setAvailableAudioDevices(await listAudioOutputs(navigator.mediaDevices, { askLabels: true }));
        } catch (e) {
            console.error("Failed to enumerate audio devices", e);
        }
    }, []);

    // Troca de aparelho (fone ou interface plugada): atualiza a lista sem pedir nada.
    useEffect(() => {
        const onDeviceChange = () => {
            listAudioOutputs(navigator.mediaDevices, { askLabels: false })
                .then(setAvailableAudioDevices)
                .catch(e => console.error("Failed to enumerate audio devices", e));
        };
        navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
        return () => {
            navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
        };
    }, []);

    if (!isLoaded) return null;

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, availableAudioDevices, refreshAudioDevices }}>
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
