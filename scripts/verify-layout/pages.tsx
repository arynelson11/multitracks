// Páginas do Separador no verificador (Parte 3, faixa D): as vistas montadas só com props, sem
// Supabase nem motor, com o pior caso de texto. Medidas como as telas da faixa C. Nada daqui entra no app.
import { SeparatorHome } from '../../src/components/separator/SeparatorHome'
import { SeparatorOptions } from '../../src/components/separator/SeparatorOptions'
import { SEPARATIONS } from './pageFixtures'

const noop = () => {}

export function SeparatorPage({ estado }: { estado: 'separador-inicio' | 'separador-opcoes' }) {
  if (estado === 'separador-opcoes') return <SeparatorOptions options={[2, 4, 6]} onBack={noop} onChoose={noop} />
  return <SeparatorHome separations={SEPARATIONS} loading={false} onBack={noop} onPickFile={noop} onOpen={noop} onDelete={noop} />
}
