import { Button, Notice, ProgressBar } from '../ui'
import { PROGRESS_COPY } from './separatorCopy'

export interface SeparatorProgressProps {
  title: string
  subtitle: string
  percent: number
  detail: string
  /** Com erro: a frase em alerta, "Tentar de novo" e "Voltar" (o "Abrindo no palco" usa). */
  error?: string | null
  onRetry?(): void
  /** Com erro: abrir no player de reserva do Separador (o "Abrindo no palco" usa, sep-2 I3). */
  onOpenHere?(): void
  /** "Voltar" também aparece sem erro quando vem (cancela o "Abrindo no palco"). */
  onBack?(): void
}

/** Tela de trabalho do Separador (separando, abrindo no palco): barra laranja, etapa e porcentagem. */
export function SeparatorProgress({ title, subtitle, percent, detail, error, onRetry, onOpenHere, onBack }: SeparatorProgressProps) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div data-separator-progress className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-ps-ink px-ps-gutter py-8 font-ps-sans text-ps-bone">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <h2 className="text-ps-lg font-extrabold leading-tight text-ps-bone">{title}</h2>
        <p className="text-ps-base leading-snug text-ps-mut">{subtitle}</p>
        {error ? (
          <>
            <Notice tone="alert" role="alert" className="w-full text-left">{error}</Notice>
            <div className="flex flex-wrap justify-center gap-2">
              {onRetry && <Button tone="primary" onClick={onRetry}>{PROGRESS_COPY.retry}</Button>}
              {onOpenHere && <Button onClick={onOpenHere}>{PROGRESS_COPY.openHere}</Button>}
              {onBack && <Button onClick={onBack}>{PROGRESS_COPY.back}</Button>}
            </div>
          </>
        ) : (
          <>
            <ProgressBar label={title} hideLabel value={value} valueText={`${value}%`} className="mt-3 w-full" />
            <p className="min-h-8 text-ps-base leading-snug text-ps-mut">{detail}</p>
            <p className="ps-num text-ps-sm font-bold text-ps-bone">{PROGRESS_COPY.done(value)}</p>
            {onBack && <Button onClick={onBack}>{PROGRESS_COPY.back}</Button>}
          </>
        )}
      </div>
    </div>
  )
}
