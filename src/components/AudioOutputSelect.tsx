import { useEffect } from 'react';
import { MonitorSpeaker, RefreshCcw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';

// Seletor da saída de áudio principal (aba Geral das Configurações). Ao aparecer, lista as
// saídas; o pedido de microfone (só pra mostrar o nome delas) fica nas regras de
// src/lib/audioOutputs.ts. No navegador que não troca a saída, só mostra o aviso.
export function AudioOutputSelect() {
    const { settings, updateSetting, availableAudioDevices, refreshAudioDevices, canPickOutput } = useSettings();

    useEffect(() => {
        void refreshAudioDevices();
    }, [refreshAudioDevices]);

    return (
        <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
                <h3 className="text-white text-sm font-bold flex items-center gap-2">
                    Dispositivo de Áudio
                    {canPickOutput && (
                        <button onClick={refreshAudioDevices} aria-label="Atualizar a lista de dispositivos" title="Atualizar a lista de dispositivos" className="opacity-40 hover:opacity-100 transition-all active:scale-90 cursor-pointer"><RefreshCcw size={12} /></button>
                    )}
                </h3>
                <p className="text-text-muted text-[10px] font-mono">Selecionar dispositivo de saída principal</p>
                {canPickOutput && (
                    <p className="text-text-muted/60 text-[9px] font-mono mt-0.5">Pra mostrar o nome das saídas, o navegador pede acesso ao microfone. Nada é gravado.</p>
                )}
            </div>
            <div className="shrink-0 flex items-center justify-end">
                {canPickOutput ? (
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
                ) : (
                    <p className="text-text-muted text-[10px] font-mono max-w-[200px] text-right">Este navegador não deixa escolher a saída de áudio</p>
                )}
            </div>
        </div>
    );
}
