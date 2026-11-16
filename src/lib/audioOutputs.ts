// Lista as saídas de áudio do aparelho (pro seletor de dispositivo nas Configurações).
//
// O navegador só mostra o NOME das saídas depois que o site recebe acesso ao microfone.
// Por isso o pedido de microfone só acontece aqui, com askLabels, e só quando falta nome:
// quem chama com askLabels é a tela de Configurações (só existe depois do login). A carga
// do site, a landing e a troca de aparelho (devicechange) listam sem pedir nada.

export interface MediaDevicesLike {
  enumerateDevices(): Promise<MediaDeviceInfo[]>
  getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>
}

const outputsOf = (devices: MediaDeviceInfo[]) => devices.filter(d => d.kind === 'audiooutput')

export async function listAudioOutputs(
  mediaDevices: MediaDevicesLike | undefined,
  { askLabels }: { askLabels: boolean },
): Promise<MediaDeviceInfo[]> {
  if (!mediaDevices?.enumerateDevices) return []
  let outputs = outputsOf(await mediaDevices.enumerateDevices())
  const missingLabels = outputs.length === 0 || outputs.some(d => !d.label)
  if (askLabels && missingLabels && mediaDevices.getUserMedia) {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      outputs = outputsOf(await mediaDevices.enumerateDevices())
    } catch (e) {
      console.warn('Sem acesso ao microfone: os nomes das saídas de áudio podem ficar vazios.', e)
    }
  }
  return outputs
}
