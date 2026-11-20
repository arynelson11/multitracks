// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StageDialog } from './StageDialog'
import type { StageDialogProps } from './StageDialog'
import { usePanelDismiss } from './panelDismiss'

afterEach(cleanup)

const TRAVESSAO = String.fromCharCode(0x2014)
const TITLE = 'As 3 separações deste mês acabaram'

function props(patch: Partial<StageDialogProps> = {}): StageDialogProps {
  return {
    open: true,
    title: TITLE,
    onClose: vi.fn(),
    children: <p>No Pro são 50 separações por mês.</p>,
    footer: (
      <>
        <button type="button">Agora não</button>
        <button type="button">Ver os planos</button>
      </>
    ),
    ...patch,
  }
}

const overlayOf = (container: HTMLElement) => container.firstElementChild as HTMLElement
const closeButton = () => screen.getByRole('button', { name: 'Fechar' })

/** Um painel do palco aberto por baixo (REPERTÓRIOS, pads): mesma pilha do Esc da casca. */
function PanelBelow({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  usePanelDismiss(true, onClose, ref)
  return <div ref={ref} tabIndex={-1} role="dialog" aria-label="Repertório">painel</div>
}

describe('StageDialog (janela por cima no estilo do palco)', () => {
  it('fechado não renderiza nada', () => {
    const { container } = render(<StageDialog {...props({ open: false })} />)
    expect(container.firstChild).toBeNull()
  })

  it('role dialog, aria-modal e o título ligado por aria-labelledby', () => {
    render(<StageDialog {...props()} />)
    const dialog = screen.getByRole('dialog', { name: TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe(TITLE)
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.id).not.toBe('')
  })

  it('abre com o foco no primeiro botão e devolve o foco a quem abriu ao fechar', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const p = props()
    const { rerender } = render(<StageDialog {...p} />)
    expect(document.activeElement).toBe(closeButton())
    rerender(<StageDialog {...p} open={false} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('desmontada aberta (quem chama tira do ar) também devolve o foco a quem abriu', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<StageDialog {...props()} />)
    expect(document.activeElement).toBe(closeButton())
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('no StrictMode (efeito rodando duas vezes) o foco ainda volta pra quem abriu de verdade', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const p = props()
    const { rerender } = render(<StrictMode><StageDialog {...p} /></StrictMode>)
    expect(document.activeElement).toBe(closeButton())
    rerender(<StrictMode><StageDialog {...p} open={false} /></StrictMode>)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('se o foco já foi pra outro lugar fora da janela, ao fechar ele fica lá', () => {
    const opener = document.createElement('button')
    opener.textContent = 'abriu'
    const other = document.createElement('button')
    other.textContent = 'outro'
    document.body.append(opener, other)
    opener.focus()
    const p = props()
    const { rerender } = render(<StageDialog {...p} />)
    other.focus()
    rerender(<StageDialog {...p} open={false} />)
    expect(document.activeElement).toBe(other)
    opener.remove()
    other.remove()
  })

  it('renderizar de novo com outro onClose não tira o foco de onde ele está', () => {
    const p = props()
    const { rerender } = render(<StageDialog {...p} />)
    const later = screen.getByRole('button', { name: 'Ver os planos' })
    later.focus()
    rerender(<StageDialog {...p} onClose={vi.fn()} />)
    expect(document.activeElement).toBe(later)
  })

  it('Esc fecha e não chega a um ouvinte de keydown na janela', () => {
    const windowKeydown = vi.fn()
    window.addEventListener('keydown', windowKeydown)
    const p = props()
    render(<StageDialog {...p} />)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(windowKeydown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', windowKeydown)
  })

  it('o Esc fecha só a janela: o painel do palco aberto por baixo continua aberto', () => {
    const panelClose = vi.fn()
    const p = props()
    render(<><PanelBelow onClose={panelClose} /><StageDialog {...p} /></>)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(panelClose).not.toHaveBeenCalled()
  })

  it('nenhuma tecla de dentro chega aos atalhos do palco (o Espaço não toca a música por baixo)', () => {
    const windowKeydown = vi.fn()
    window.addEventListener('keydown', windowKeydown)
    const p = props()
    render(<StageDialog {...p} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Agora não' }), { key: ' ', code: 'Space' })
    fireEvent.keyDown(screen.getByText('No Pro são 50 separações por mês.'), { key: '1', code: 'Digit1' })
    expect(windowKeydown).not.toHaveBeenCalled()
    expect(p.onClose).not.toHaveBeenCalled()
    window.removeEventListener('keydown', windowKeydown)
  })

  it('toque fora fecha; toque dentro não', () => {
    const p = props()
    const { container } = render(<StageDialog {...p} />)
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('No Pro são 50 separações por mês.'))
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(overlayOf(container))
    fireEvent.click(overlayOf(container))
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('apertar dentro e soltar fora (arrastar pra selecionar o texto) não fecha', () => {
    const p = props()
    const { container } = render(<StageDialog {...p} />)
    fireEvent.pointerDown(screen.getByText('No Pro são 50 separações por mês.'))
    fireEvent.click(overlayOf(container)) // o clique cai no ancestral comum: a camada de fora
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(overlayOf(container))
    fireEvent.click(overlayOf(container))
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab no último botão volta pro primeiro e Shift+Tab no primeiro vai pro último', () => {
    render(<StageDialog {...props()} />)
    const first = closeButton()
    const middle = screen.getByRole('button', { name: 'Agora não' })
    const last = screen.getByRole('button', { name: 'Ver os planos' })
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' })).toBe(false) // o padrão do navegador foi parado
    expect(document.activeElement).toBe(first)
    expect(fireEvent.keyDown(first, { key: 'Tab', code: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(last)
    // No meio, o Tab segue o caminho normal do navegador.
    middle.focus()
    expect(fireEvent.keyDown(middle, { key: 'Tab', code: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(middle)
  })

  it('com o foco na própria caixa (clique no texto), Tab vai pro primeiro e Shift+Tab pro último', () => {
    render(<StageDialog {...props()} />)
    const box = screen.getByRole('dialog')
    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.keyDown(box, { key: 'Tab', code: 'Tab' })
    expect(document.activeElement).toBe(closeButton())
    box.focus()
    fireEvent.keyDown(box, { key: 'Tab', code: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver os planos' }))
  })

  it('o Tab pula botão desligado', () => {
    render(<StageDialog {...props({ footer: <><button type="button">Agora não</button><button type="button" disabled>Assinar</button></> })} />)
    const ultimoLigado = screen.getByRole('button', { name: 'Agora não' })
    ultimoLigado.focus()
    fireEvent.keyDown(ultimoLigado, { key: 'Tab', code: 'Tab' })
    expect(document.activeElement).toBe(closeButton())
  })

  it('o botão Fechar tem 44 px (min-h-ps-touch), o X do palco e fecha no toque', () => {
    const p = props()
    render(<StageDialog {...p} />)
    const btn = closeButton()
    expect(btn.className).toContain('min-h-ps-touch')
    expect(btn.className).toContain('min-w-ps-touch')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    fireEvent.click(btn)
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('camada por cima de tudo com fundo escuro e 16 px de folga; caixa no Panel pop', () => {
    const { container } = render(<StageDialog {...props()} />)
    const overlay = overlayOf(container).className.split(' ')
    for (const c of ['fixed', 'inset-0', 'z-[120]', 'bg-black/60', 'p-ps-gutter']) expect(overlay).toContain(c)
    const box = screen.getByRole('dialog').className.split(' ')
    for (const c of ['bg-ps-pop', 'rounded-ps-xl', 'shadow-ps-pop', 'inset-ring', 'inset-ring-ps-line-2', 'max-h-full', 'w-full']) expect(box).toContain(c)
  })

  it('md é o padrão (max-w-lg) e sm é a estreita (max-w-sm)', () => {
    const { rerender } = render(<StageDialog {...props()} />)
    expect(screen.getByRole('dialog').className.split(' ')).toContain('max-w-lg')
    expect(screen.getByRole('dialog').className.split(' ')).not.toContain('max-w-sm')
    rerender(<StageDialog {...props({ size: 'sm' })} />)
    expect(screen.getByRole('dialog').className.split(' ')).toContain('max-w-sm')
    expect(screen.getByRole('dialog').className.split(' ')).not.toContain('max-w-lg')
  })

  it('o conteúdo rola dentro da caixa e o rodapé fica fora da rolagem', () => {
    render(<StageDialog {...props()} />)
    const body = screen.getByText('No Pro são 50 separações por mês.').parentElement!
    expect(body.className.split(' ')).toContain('overflow-y-auto')
    expect(body.className.split(' ')).toContain('min-h-0')
    expect(body.contains(screen.getByRole('button', { name: 'Ver os planos' }))).toBe(false)
  })

  it('sem footer não sobra rodapé vazio', () => {
    render(<StageDialog {...props({ footer: undefined })} />)
    const box = screen.getByRole('dialog')
    expect(box.children.length).toBe(2) // cabeçalho e conteúdo
  })

  it('nenhum travessão nos textos da janela', () => {
    const { container } = render(<StageDialog {...props()} />)
    expect(container.innerHTML).not.toContain(TRAVESSAO)
  })
})

describe('StageDialog: duas janelas abertas (pilha) e tamanho lg', () => {
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const two = (a: StageDialogProps, b: StageDialogProps) => (
    <>
      <StageDialog {...a} />
      <StageDialog {...b} />
    </>
  )

  it('o Esc fecha só a janela aberta por último; fechada ela, o próximo Esc fecha a de baixo', () => {
    const a = props({ title: 'Metrônomo', open: true })
    const b = props({ title: 'Limite', open: false })
    const { rerender } = render(two(a, b))
    rerender(two(a, { ...b, open: true }))
    esc()
    expect(b.onClose).toHaveBeenCalledTimes(1)
    expect(a.onClose).not.toHaveBeenCalled()
    rerender(two(a, { ...b, open: false }))
    esc()
    expect(a.onClose).toHaveBeenCalledTimes(1)
    expect(b.onClose).toHaveBeenCalledTimes(1)
  })

  it('a aberta por último manda mesmo vindo antes no código (irmã de cima no DOM)', () => {
    const a = props({ title: 'Limite', open: false })
    const b = props({ title: 'Metrônomo', open: true })
    const { rerender } = render(two(a, b))
    rerender(two({ ...a, open: true }, b))
    esc()
    expect(a.onClose).toHaveBeenCalledTimes(1)
    expect(b.onClose).not.toHaveBeenCalled()
  })

  it('janela aberta dentro de outra (mesmo abrindo juntas) é a de cima', () => {
    const inner = props({ title: 'Limite' })
    const outer = props({ title: 'Metrônomo', children: <StageDialog {...inner} /> })
    render(<StrictMode><StageDialog {...outer} /></StrictMode>)
    esc()
    expect(inner.onClose).toHaveBeenCalledTimes(1)
    expect(outer.onClose).not.toHaveBeenCalled()
  })

  it('toque fora só fecha a janela de cima', () => {
    const a = props({ title: 'Metrônomo' })
    const b = props({ title: 'Limite', open: false })
    const { container, rerender } = render(two(a, b))
    rerender(two(a, { ...b, open: true }))
    const [overlayA, overlayB] = Array.from(container.children) as HTMLElement[]
    fireEvent.pointerDown(overlayA)
    fireEvent.click(overlayA)
    expect(a.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(overlayB)
    fireEvent.click(overlayB)
    expect(b.onClose).toHaveBeenCalledTimes(1)
  })

  it('uma janela só continua fechando no Esc depois de outra ter aberto e fechado', () => {
    const a = props({ title: 'Primeira' })
    const { unmount } = render(<StageDialog {...a} />)
    unmount()
    const b = props({ title: 'Segunda' })
    render(<StageDialog {...b} />)
    esc()
    expect(b.onClose).toHaveBeenCalledTimes(1)
    expect(a.onClose).not.toHaveBeenCalled()
  })

  it('com o fechar de verdade, um Esc fecha só a de cima (irmãs)', () => {
    function Duas() {
      const [a, setA] = useState(true)
      const [b, setB] = useState(true)
      return (
        <>
          <StageDialog {...props({ title: 'Primeira', open: a, onClose: () => flushSync(() => setA(false)) })} />
          <StageDialog {...props({ title: 'Segunda', open: b, onClose: () => flushSync(() => setB(false)) })} />
        </>
      )
    }
    render(<Duas />)
    esc()
    expect(screen.queryByRole('dialog', { name: 'Segunda' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Primeira' })).not.toBeNull()
  })

    it('lg é a larga (max-w-2xl, até 672 px), pra letra e cifra', () => {
    render(<StageDialog {...props({ size: 'lg' })} />)
    const box = screen.getByRole('dialog').className.split(' ')
    expect(box).toContain('max-w-2xl')
    for (const c of ['max-w-lg', 'max-w-sm']) expect(box).not.toContain(c)
  })
})

// Revisão macro BC (BC1-I1 e BC1-I2): a janela de dentro abrindo junto com a de fora. O fechar
// aplicado na hora (flushSync) faz o que o navegador faz com uma tecla de verdade: o React aplica
// o setState numa microtarefa, que roda entre um ouvinte e o próximo (o fireEvent do jsdom não roda).
describe('StageDialog: janela de dentro aberta junto com a de fora (ordem real do navegador)', () => {
  function Nested({ syncClose = true }: { syncClose?: boolean }) {
    const [outer, setOuter] = useState(true)
    const [inner, setInner] = useState(true)
    const close = (set: (v: boolean) => void) => () => (syncClose ? flushSync(() => set(false)) : set(false))
    return (
      <StageDialog open={outer} title="Fora" onClose={close(setOuter)}>
        <p>conteúdo de fora</p>
        <StageDialog open={inner} title="Dentro" onClose={close(setInner)}>
          <p>conteúdo de dentro</p>
        </StageDialog>
      </StageDialog>
    )
  }
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const fechar = (nome: string) => screen.getByRole('dialog', { name: nome }).querySelector<HTMLElement>('button[aria-label="Fechar"]')!

  it('o foco fica na janela de cima (a de dentro)', () => {
    render(<Nested syncClose={false} />)
    expect(document.activeElement).toBe(fechar('Dentro'))
  })

  it('no StrictMode o foco também fica na de dentro', () => {
    render(<StrictMode><Nested syncClose={false} /></StrictMode>)
    expect(document.activeElement).toBe(fechar('Dentro'))
  })

  it('um Esc fecha só a de dentro; o próximo fecha a de fora', () => {
    render(<Nested />)
    esc()
    expect(screen.queryByRole('dialog', { name: 'Dentro' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Fora' })).not.toBeNull()
    esc()
    expect(screen.queryByRole('dialog', { name: 'Fora' })).toBeNull()
  })

  it('fechada a de dentro, o foco vai pra de fora (não pro palco por trás); fechada a de fora, volta pra quem abriu', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Abrir'
    document.body.appendChild(opener)
    opener.focus()
    render(<Nested />)
    esc()
    expect(document.activeElement).toBe(fechar('Fora'))
    esc()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('a de fora fechando com a de dentro aberta: o foco volta pra quem abriu', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    function Pai() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>tirar</button>
          <StageDialog open={open} title="Fora" onClose={() => setOpen(false)}>
            <StageDialog open title="Dentro" onClose={() => {}}><p>x</p></StageDialog>
          </StageDialog>
        </>
      )
    }
    render(<Pai />)
    expect(document.activeElement).toBe(fechar('Dentro'))
    fireEvent.click(screen.getByRole('button', { name: 'tirar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('abrindo uma janela de dentro depois, pelo botão de dentro, ao fechar ela o foco volta pro botão', () => {
    function Abre() {
      const [inner, setInner] = useState(false)
      return (
        <StageDialog open title="Fora" onClose={() => {}}>
          <button type="button" onClick={() => setInner(true)}>Ver mais</button>
          <StageDialog open={inner} title="Dentro" onClose={() => flushSync(() => setInner(false))}><p>x</p></StageDialog>
        </StageDialog>
      )
    }
    render(<Abre />)
    const ver = screen.getByRole('button', { name: 'Ver mais' })
    ver.focus()
    fireEvent.click(ver)
    expect(document.activeElement).toBe(fechar('Dentro'))
    esc()
    expect(screen.queryByRole('dialog', { name: 'Dentro' })).toBeNull()
    expect(document.activeElement).toBe(ver)
  })
})
