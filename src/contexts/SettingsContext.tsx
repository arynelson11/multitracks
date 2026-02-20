import React, { createContext, useContext, useState, useEffect } from 'react';

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

    const refreshAudioDevices = async () => {
        try {
            // Requesting microphone permission briefly is sometimes needed in browsers to get the full labels of output devices
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
            } catch (e) {
                console.warn("User denied or no mic, device labels might be empty.", e);
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
            setAvailableAudioDevices(audioOutputs);
        } catch (e) {
            console.error("Failed to enumerate audio devices", e);
        }
    };

    // Keep devices fresh if permissions change
    useEffect(() => {
        refreshAudioDevices();
        navigator.mediaDevices?.addEventListener('devicechange', refreshAudioDevices);
        return () => {
            navigator.mediaDevices?.removeEventListener('devicechange', refreshAudioDevices);
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
