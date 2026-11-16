import { useEffect, useLayoutEffect, useRef } from 'react'
import type { StageActions, StageView } from '../../lib/stageContracts'
import { stageKeyAction } from './stageKeys'

/** Editável: contentEditable de verdade ou herdado (o jsdom não tem `isContentEditable`). */
function isEditable(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

/**
 * Teclado do palco novo (regras em `stageKeyAction`). Escuta o `keydown` na `window`, na fase de
 * bolha: chega depois dos painéis e diálogos (que tratam o Esc na captura do `document`) e dos
 * controles (que marcam ou param as teclas que usam), então evento já tratado não vira atalho.
 * O Esc só é usado com algo armado (cancela o pulo); sem nada armado a tecla segue pro resto.
 * Desligado (`enabled` falso, com um modal do App aberto) ou sem música, não escuta nada.
 * Lê sempre a vista e as ações da última renderização.
 */
export function useStageShortcuts(view: StageView, actions: StageActions, opts: { enabled: boolean }): void {
  const latest = useRef({ view, actions })
  useLayoutEffect(() => { latest.current = { view, actions } })

  useEffect(() => {
    if (!opts.enabled) return
    const onKey = (e: KeyboardEvent) => {
      const { view: v, actions: a } = latest.current
      if (!v.song) return
      const target = e.target instanceof Element ? e.target : null
      const action = stageKeyAction({
        code: e.code, key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, repeat: e.repeat,
        defaultPrevented: e.defaultPrevented || e.isComposing, targetTag: target?.tagName, targetEditable: target ? isEditable(target) : false,
        targetRole: target?.getAttribute('role') ?? undefined,
      }, { editMode: v.editMode, sectionCount: v.sections.length })
      if (!action) return
      switch (action.kind) {
        case 'togglePlay': a.togglePlay(); break
        case 'tapSection': {
          const s = v.sections[action.index]
          if (!s) return
          a.tapSection(s.index)
          break
        }
        case 'stepSection': a.stepSection(action.dir); break
        case 'seekBy': a.seekBy(action.dt); break
        case 'escape':
          if (v.intent === null) return
          a.cancelArm()
          break
        case 'toggleLoop': a.toggleLoop(); break
        case 'mark': a.markSection(action.label); break
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts.enabled])
}
