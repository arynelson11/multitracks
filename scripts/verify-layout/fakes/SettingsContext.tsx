// Só no verificador de layout (faixa B da Parte 3): no lugar do src/contexts/SettingsContext.tsx,
// configurações fixas em "Tudo junto" (com a aba Buses e o pan automático) e uma saída com nome
// comprido. Não lista aparelhos nem pede microfone. Nada daqui entra no app.
import type React from 'react'

const settings = {
  autoPan: true,
  audioDeviceId: 'placa',
  outputs: { mode: 'stereo' as const, earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } },
  stageVersion: 'novo' as const,
  stageVersionChosen: true,
  legacyPanReset: false,
}

const devices = [
  { deviceId: 'placa', label: 'Alto-falantes do MacBook Pro (Integrado) com o nome mais comprido possível', kind: 'audiooutput', groupId: 'a' },
  { deviceId: 'focusrite', label: 'Focusrite Scarlett 2i2 4th Gen (USB)', kind: 'audiooutput', groupId: 'b' },
] as unknown as MediaDeviceInfo[]

const value = {
  settings,
  updateSetting: () => {},
  availableAudioDevices: devices,
  refreshAudioDevices: async () => {},
  canPickOutput: true,
  outputLoadWarnings: [] as const,
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// O módulo do app exporta o provider e o hook juntos; a simulação segue a mesma forma.
// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  return value
}
