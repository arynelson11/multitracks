import { useEffect } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { Button, Select } from './ui';

// Seletor da saída de áudio principal (aba Geral das Configurações). Ao aparecer, lista as
// saídas; o pedido de microfone (só pra mostrar o nome delas) fica nas regras de
// src/lib/audioOutputs.ts. No navegador que não troca a saída, só mostra o aviso.
export function AudioOutputSelect() {
    const { settings, updateSetting, availableAudioDevices, refreshAudioDevices, canPickOutput } = useSettings();

    useEffect(() => {
        void refreshAudioDevices();
    }, [refreshAudioDevices]);

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
                <h3 className="text-ps-base font-bold text-ps-bone">Dispositivo de Áudio</h3>
                {canPickOutput && (
                    <Button
                        tone="ghost"
                        icon={<RefreshCcw size={14} />}
                        onClick={refreshAudioDevices}
                        aria-label="Atualizar a lista de dispositivos"
                        title="Atualizar a lista de dispositivos"
                    />
                )}
            </div>
            <p className="text-ps-base leading-snug text-pretty text-ps-mut">Selecionar dispositivo de saída principal</p>
            {canPickOutput ? (
                <Select
                    label="Dispositivo de Áudio"
                    hideLabel
                    help="Pra mostrar o nome das saídas, o navegador pede acesso ao microfone. Nada é gravado."
                    value={settings.audioDeviceId}
                    onChange={(e) => updateSetting('audioDeviceId', e.target.value)}
                    className="w-full max-w-md"
                >
                    <option value="default">Padrão do Sistema</option>
                    {availableAudioDevices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `Dispositivo (${device.deviceId.substring(0, 5)}...)`}
                        </option>
                    ))}
                </Select>
            ) : (
                <p className="text-ps-base leading-snug text-pretty text-ps-mut">Este navegador não deixa escolher a saída de áudio</p>
            )}
        </section>
    );
}
