import { describe, expect, it } from 'vitest'
import { SECTION_SHORTCUTS } from '../../lib/sectionTypes'
import { isWideStage, stageKeyAction } from './stageKeys'
import type { StageKeyEvent } from './stageKeys'

type KeyPatch = Partial<StageKeyEvent> & { edit?: boolean }

/** Evento de teclado com tudo desligado, mais o que o caso pede (`edit` liga o modo EDITAR). */
const key = (e: KeyPatch): StageKeyEvent => {
  const { edit: _edit, ...rest } = e
  void _edit
  return {
    code: '', key: '', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, defaultPrevented: false, ...rest,
  }
}

describe('atalhos do palco', () => {
  it.each([
    [{ code: 'Space' }, { kind: 'togglePlay' }], [{ code: 'Digit3' }, { kind: 'tapSection', index: 2 }], [{ code: 'Digit9' }, null],
    [{ code: 'ArrowLeft' }, { kind: 'stepSection', dir: -1 }], [{ code: 'ArrowRight', shiftKey: true }, { kind: 'seekBy', dt: 5 }],
    [{ code: 'KeyR' }, null], [{ code: 'KeyR', edit: true }, { kind: 'mark', label: 'Refrão' }], [{ code: 'KeyL' }, { kind: 'toggleLoop' }],
    [{ code: 'Space', repeat: true }, null], [{ code: 'Space', targetTag: 'TEXTAREA' }, null], [{ code: 'Digit1', metaKey: true }, null],
    [{ code: 'Escape', defaultPrevented: true }, null], [{ code: 'Escape' }, { kind: 'escape' }],
  ] as [KeyPatch, unknown][])('tecla %o', (e, out) => expect(stageKeyAction(key(e), { editMode: !!e.edit, sectionCount: 5 })).toEqual(out))

  // Ruling T18-altura (substitui o mínimo de 600 da R-25): o palco novo liga a partir de 740 px de altura.
  it.each([[1024, 740, true], [1024, 739, false], [1023, 800, false], [1280, 600, false], [1920, 1080, true]])(
    'palco largo %s x %s', (w, h, ok) => expect(isWideStage(w, h)).toBe(ok),
  )

  const ctx = { editMode: false, sectionCount: 9 }

  it('1 a 9 armam a seção daquela posição, também no teclado numérico; 0 não faz nada', () => {
    for (let n = 1; n <= 9; n++) {
      expect(stageKeyAction(key({ code: `Digit${n}` }), ctx)).toEqual({ kind: 'tapSection', index: n - 1 })
      expect(stageKeyAction(key({ code: `Numpad${n}` }), ctx)).toEqual({ kind: 'tapSection', index: n - 1 })
    }
    expect(stageKeyAction(key({ code: 'Digit0' }), ctx)).toBeNull()
    expect(stageKeyAction(key({ code: 'Digit1' }), { editMode: false, sectionCount: 0 })).toBeNull()
  })

  it('setas: seção anterior e seguinte; com Shift, 5 s pra trás e pra frente', () => {
    expect(stageKeyAction(key({ code: 'ArrowRight' }), ctx)).toEqual({ kind: 'stepSection', dir: 1 })
    expect(stageKeyAction(key({ code: 'ArrowLeft', shiftKey: true }), ctx)).toEqual({ kind: 'seekBy', dt: -5 })
    // Segurar a seta repete (o operador anda várias seções ou vários trechos de 5 s).
    expect(stageKeyAction(key({ code: 'ArrowRight', repeat: true }), ctx)).toEqual({ kind: 'stepSection', dir: 1 })
    expect(stageKeyAction(key({ code: 'ArrowRight', shiftKey: true, repeat: true }), ctx)).toEqual({ kind: 'seekBy', dt: 5 })
  })

  it('Esc também pelo nome da tecla', () => {
    expect(stageKeyAction(key({ key: 'Escape' }), ctx)).toEqual({ kind: 'escape' })
  })

  it('as 6 letras de marcar só valem no modo EDITAR, com o nome do tipo', () => {
    for (const s of SECTION_SHORTCUTS) {
      expect(stageKeyAction(key({ code: s.code }), ctx)).toBeNull()
      expect(stageKeyAction(key({ code: s.code }), { ...ctx, editMode: true })).toEqual({ kind: 'mark', label: s.name })
    }
    // L é loop nos dois modos.
    expect(stageKeyAction(key({ code: 'KeyL' }), { ...ctx, editMode: true })).toEqual({ kind: 'toggleLoop' })
  })

  it('tecla segurada não repete Espaço, números, L nem marcar', () => {
    for (const code of ['Space', 'Digit2', 'Numpad4', 'KeyL']) expect(stageKeyAction(key({ code, repeat: true }), ctx)).toBeNull()
    expect(stageKeyAction(key({ code: 'KeyV', repeat: true }), { ...ctx, editMode: true })).toBeNull()
  })

  it('Meta, Ctrl e Alt deixam a tecla pro sistema (Cmd+1, Ctrl+R, Alt+seta)', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      for (const code of ['Space', 'Digit1', 'ArrowLeft', 'KeyL', 'Escape']) expect(stageKeyAction(key({ code, [mod]: true }), ctx)).toBeNull()
    }
  })

  it('evento já tratado (painel, diálogo, controle) não vira atalho', () => {
    for (const code of ['Space', 'Digit1', 'ArrowRight', 'KeyL', 'Escape']) expect(stageKeyAction(key({ code, defaultPrevented: true }), ctx)).toBeNull()
  })

  it('campo de texto fica com todas as teclas', () => {
    for (const targetTag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      for (const code of ['Space', 'Digit1', 'ArrowLeft', 'KeyL', 'Escape']) expect(stageKeyAction(key({ code, targetTag }), ctx)).toBeNull()
    }
    expect(stageKeyAction(key({ code: 'Digit1', targetTag: 'DIV', targetEditable: true }), ctx)).toBeNull()
    for (const targetRole of ['textbox', 'searchbox', 'combobox', 'spinbutton']) {
      expect(stageKeyAction(key({ code: 'KeyL', targetTag: 'DIV', targetRole }), ctx)).toBeNull()
    }
  })

  // Ruling T18-atalho: o controle com o foco fica com as teclas que ele usa. Sem isso as setas no
  // volume dos pads, nas abas, no fader e no seletor AUTO/PARAR/FADE andariam 5 s ou trocariam a seção.
  it('controle deslizante, aba e opção do seletor ficam com as setas', () => {
    for (const targetRole of ['slider', 'tab', 'radio', 'scrollbar', 'option', 'menuitem']) {
      for (const shiftKey of [false, true]) {
        expect(stageKeyAction(key({ code: 'ArrowLeft', shiftKey, targetTag: 'DIV', targetRole }), ctx)).toBeNull()
        expect(stageKeyAction(key({ code: 'ArrowRight', shiftKey, targetTag: 'BUTTON', targetRole }), ctx)).toBeNull()
      }
    }
  })

  it('botão, aba, opção e caixa de marcar com o foco ficam com o Espaço (o navegador aperta o botão)', () => {
    expect(stageKeyAction(key({ code: 'Space', targetTag: 'BUTTON' }), ctx)).toBeNull()
    expect(stageKeyAction(key({ code: 'Space', targetTag: 'SUMMARY' }), ctx)).toBeNull()
    for (const targetRole of ['button', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'option']) {
      expect(stageKeyAction(key({ code: 'Space', targetTag: 'DIV', targetRole }), ctx)).toBeNull()
    }
  })

  it('com o foco num botão os outros atalhos continuam (o Chrome e o app do computador focam o botão tocado)', () => {
    const onButton = { targetTag: 'BUTTON' }
    expect(stageKeyAction(key({ code: 'Digit2', ...onButton }), ctx)).toEqual({ kind: 'tapSection', index: 1 })
    expect(stageKeyAction(key({ code: 'ArrowRight', ...onButton }), ctx)).toEqual({ kind: 'stepSection', dir: 1 })
    expect(stageKeyAction(key({ code: 'ArrowLeft', shiftKey: true, ...onButton }), ctx)).toEqual({ kind: 'seekBy', dt: -5 })
    expect(stageKeyAction(key({ code: 'KeyL', ...onButton }), ctx)).toEqual({ kind: 'toggleLoop' })
    expect(stageKeyAction(key({ code: 'Escape', ...onButton }), ctx)).toEqual({ kind: 'escape' })
    // No controle deslizante, só as setas são dele: os números e o Espaço seguem valendo.
    expect(stageKeyAction(key({ code: 'Digit1', targetTag: 'DIV', targetRole: 'slider' }), ctx)).toEqual({ kind: 'tapSection', index: 0 })
    expect(stageKeyAction(key({ code: 'Space', targetTag: 'DIV', targetRole: 'slider' }), ctx)).toEqual({ kind: 'togglePlay' })
  })

  it('outras teclas não fazem nada', () => {
    for (const code of ['KeyA', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Backspace', 'F5', '']) expect(stageKeyAction(key({ code }), ctx)).toBeNull()
  })
})
