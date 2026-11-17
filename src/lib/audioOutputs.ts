// Lista as saídas de áudio do aparelho (pro seletor de dispositivo nas Configurações).
//
// O navegador só mostra o NOME das saídas depois que o site recebe acesso ao microfone.
// Por isso o pedido de microfone só acontece aqui, e só quando as três coisas valem:
// alguém pediu a lista (askLabels, só a aba Geral das Configurações, depois do login), o
// navegador consegue trocar a saída (canPickOutput: AudioContext com setSinkId, ou seja
// Chrome, Edge e o app desktop) e existe saída sem nome. iPhone, iPad, Safari e Firefox não
// trocam a saída, então nunca pedem (no iOS, abrir o microfone com música tocando mexe na
// sessão de áudio). A carga do site, a landing e a troca de aparelho listam sem pedir nada.

export interface MediaDevicesLike {
  enumerateDevices(): Promise<MediaDeviceInfo[]>
  getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>
}

const outputsOf = (devices: MediaDeviceInfo[]) => devices.filter(d => d.kind === 'audiooutput')

// O navegador deixa escolher a saída de áudio do app? (o motor usa AudioContext.setSinkId)
export function canPickAudioOutput(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
}

export async function listAudioOutputs(
  mediaDevices: MediaDevicesLike | undefined,
  { askLabels, canPickOutput }: { askLabels: boolean; canPickOutput: boolean },
): Promise<MediaDeviceInfo[]> {
  if (!mediaDevices?.enumerateDevices) return []
  let outputs = outputsOf(await mediaDevices.enumerateDevices())
  if (askLabels && canPickOutput && outputs.some(d => !d.label) && mediaDevices.getUserMedia) {
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
