// @vitest-environment jsdom
// Conjuntos de pads da nuvem na linguagem do palco (Parte 3, faixa C): a janela do palco e tudo
// o que a tela fazia (buscar, escolher, renomear e apagar no admin, carregando, erro e vazio).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PadSetsModal } from './PadSetsModal'
import { StageDialog } from './stage/StageDialog'
import { oldLanguageClasses } from '../test/psLanguage'

vi.mock('../lib/supabase', () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })) }))

const DESC = 'Pads quentes pra ministração, gravados em estúdio com reverb longo e camadas de cordas'
const SETS = [
  { id: 'a/1', name: 'Pads Domingo', description: DESC, base_path: 'pads/a', created_at: '2026-11-01', note_urls: { C: 'c.mp3' } },
  { id: 'b', name: 'Ambiente', description: null, base_path: 'pads/b', created_at: '2026-11-02' },
]

type Resposta = { ok: boolean; status?: number; json: () => Promise<unknown> }
let fetchMock: ReturnType<typeof vi.fn>

function stubCatalog(get: () => Promise<Resposta>) {
  fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? Promise.resolve({ ok: true, json: async () => ({}) }) : get()))
  vi.stubGlobal('fetch', fetchMock)
}

const ok = (sets: unknown[]) => async () => ({ ok: true, json: async () => ({ sets }) })

function abrir(isAdmin = false) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const selected = { id: 'b', name: 'Ambiente', base_path: 'pads/b' }
  render(<PadSetsModal isOpen onClose={onClose} onSelect={onSelect} selectedPadSet={selected} isAdmin={isAdmin} />)
  return { onSelect, onClose }
}

const escolha = (nome: string) => screen.findByRole('button', { name: new RegExp(`^${nome}`) })
const pedidos = (metodo: string) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === metodo)

beforeEach(() => stubCatalog(ok(SETS)))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Pads da nuvem: nada some', () => {
  it('lista, marca o conjunto em uso e escolhe (e fecha)', async () => {
    const { onSelect, onClose } = abrir()
    expect(screen.getByRole('dialog', { name: 'Pads da nuvem' })).toBeTruthy()
    const domingo = await escolha('Pads Domingo')
    expect(domingo.textContent).toContain(DESC)
    expect((await escolha('Ambiente')).getAttribute('aria-current')).toBe('true')
    expect(domingo.getAttribute('aria-current')).toBeNull()
    fireEvent.click(domingo)
    expect(onSelect).toHaveBeenCalledWith({ id: 'a/1', name: 'Pads Domingo', base_path: 'pads/a', note_urls: { C: 'c.mp3' } })
    expect(onClose).toHaveBeenCalled()
  })

  it('carregando enquanto a busca não volta', () => {
    stubCatalog(() => new Promise(() => {}))
    abrir()
    expect(screen.getByRole('status').textContent).toContain('Carregando')
  })

  it('erro de carregar mostra o código em alerta', async () => {
    stubCatalog(async () => ({ ok: false, status: 500, json: async () => ({ code: 'erro' }) }))
    abrir()
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('Falha ao carregar o catálogo.')
    expect(alerta.textContent).toContain('500 erro')
  })

  it('catálogo vazio diz que não há conjunto e onde enviar', async () => {
    stubCatalog(ok([]))
    abrir()
    expect(await screen.findByText('Nenhum conjunto de pads disponível.')).toBeTruthy()
    expect(screen.getByText('Envie pads pelo painel Admin.')).toBeTruthy()
  })

  it('quem não é admin não vê renomear nem apagar', async () => {
    abrir()
    await escolha('Pads Domingo')
    expect(screen.queryByRole('button', { name: /^Renomear/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Apagar/ })).toBeNull()
  })

  it('admin renomeia: campos preenchidos, Salvar manda o PATCH e atualiza; nome vazio vira "Sem nome"', async () => {
    const { onSelect } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto') as HTMLInputElement
    expect(nome.value).toBe('Pads Domingo')
    expect((screen.getByLabelText('Descrição (opcional)') as HTMLInputElement).value).toBe(DESC)
    // Editando, tocar noutro conjunto não escolhe.
    fireEvent.click(await escolha('Ambiente'))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.change(nome, { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    const [url, init] = pedidos('PATCH')[0]
    expect(url).toBe('/api/pad-catalog')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ id: 'a/1', name: 'Sem nome', description: DESC })
    expect(await escolha('Sem nome')).toBeTruthy()
  })

  it('admin cancela a edição sem mandar nada', async () => {
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(pedidos('PATCH')).toHaveLength(0)
  })

  it('admin apaga com confirmação; cancelar não manda nada', async () => {
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect(screen.getByText('Apagar "Pads Domingo"?')).toBeTruthy()
    expect(screen.getByText('Esta ação não pode ser desfeita.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(pedidos('DELETE')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Apagar Pads Domingo' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apagar' })) })
    const [url] = pedidos('DELETE')[0]
    expect(url).toBe('/api/pad-catalog?id=a%2F1')
    expect(screen.queryByRole('button', { name: /^Pads Domingo/ })).toBeNull()
  })
})

// Revisão macro BC (BC2-M4, BC2-M8): o Esc e o toque fora novos dos pads, e o Esc na edição só cancela a edição.
describe('Pads da nuvem: Esc e toque fora', () => {
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const toqueFora = () => {
    const camada = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.pointerDown(camada)
    fireEvent.click(camada)
  }

  it('sem edição, Esc fecha e o toque fora também', async () => {
    const { onClose } = abrir(true)
    await escolha('Pads Domingo')
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    toqueFora()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renomeando, o Esc no campo cancela só a edição (a janela fica) e o toque fora não fecha', async () => {
    const { onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto') as HTMLInputElement
    fireEvent.change(nome, { target: { value: 'Pads de Domingo à Noite' } })
    toqueFora()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Nome do conjunto') as HTMLInputElement).value).toBe('Pads de Domingo à Noite')
    nome.focus()
    esc()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(pedidos('PATCH')).toHaveLength(0)
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirmando o apagar, o Esc cancela só a confirmação, com o foco no Cancelar dela', async () => {
    const { onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect(document.activeElement?.textContent).toBe('Cancelar')
    toqueFora()
    expect(onClose).not.toHaveBeenCalled()
    esc()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Apagar "Pads Domingo"?')).toBeNull()
    expect(pedidos('DELETE')).toHaveLength(0)
  })
})

// Manutenção (2026-11-27): renomear e apagar mostram o envio (sem clique duplo) e dizem quando falham,
// na própria janela (nada de alert).
describe('Pads da nuvem: envio de renomear e apagar', () => {
  // GET do catálogo normal; PATCH e DELETE respondem pelo `envio` do teste.
  function stubEnvio(envio: (metodo: string) => Promise<Resposta>) {
    fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? envio(init.method) : ok(SETS)()))
    vi.stubGlobal('fetch', fetchMock)
  }
  const preso = () => {
    let soltar!: (r: Resposta) => void
    const p = new Promise<Resposta>((r) => { soltar = r })
    return { p, soltar: (r: Resposta) => soltar(r) }
  }
  const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement
  let alerta: ReturnType<typeof vi.spyOn>
  beforeEach(() => { alerta = vi.spyOn(window, 'alert').mockImplementation(() => {}) })
  afterEach(() => { expect(alerta).not.toHaveBeenCalled(); alerta.mockRestore() })

  it('renomear: enquanto envia, o Salvar diz Salvando, fica desligado e dois toques mandam um pedido só', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    fireEvent.change(screen.getByLabelText('Nome do conjunto'), { target: { value: 'Domingo à noite' } })
    await act(async () => { fireEvent.click(botao('Salvar')) })
    const salvando = botao('Salvando...')
    expect(salvando.disabled).toBe(true)
    expect(salvando.getAttribute('aria-busy')).toBe('true')
    expect(botao('Cancelar').disabled).toBe(true)
    // Os outros conjuntos não abrem edição nem apagar no meio do envio.
    expect(botao('Renomear Ambiente').disabled).toBe(true)
    expect(botao('Apagar Ambiente').disabled).toBe(true)
    await act(async () => { fireEvent.click(salvando) })
    expect(pedidos('PATCH')).toHaveLength(1)
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
    expect(await escolha('Domingo à noite')).toBeTruthy()
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
  })

  // Revisão das telas (M2): os dois toques no mesmo act chegam antes de o React aplicar o desligado;
  // só o ref barra o segundo (com o botão já desligado, o React nem chamaria o onClick).
  // Revisão das telas (M4): o que se digitasse durante o "Salvando..." sumia no sucesso (o pedido leva o
  // nome do clique). Os campos ficam só de leitura (não desligados: o foco continua neles).
  it('enquanto envia, o nome e a descrição ficam só de leitura e voltam no fim', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto') as HTMLInputElement
    const desc = screen.getByLabelText('Descrição (opcional)') as HTMLInputElement
    expect([nome.readOnly, desc.readOnly]).toEqual([false, false])
    await act(async () => { fireEvent.click(botao('Salvar')) })
    expect([nome.readOnly, desc.readOnly]).toEqual([true, true])
    expect([nome.disabled, desc.disabled]).toEqual([false, false])
    await act(async () => { envio.soltar({ ok: false, status: 500, json: async () => ({}) }) })
    expect([nome.readOnly, desc.readOnly]).toEqual([false, false])
  })

  // Revisão das telas (M5): escolher outro conjunto no meio do apagar fechava a janela no meio do envio, e
  // a frase da falha só aparecia na próxima abertura.
  it('enquanto envia, escolher um conjunto fica desligado e não fecha a janela', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    const { onSelect, onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    await act(async () => { fireEvent.click(botao('Apagar')) })
    const ambiente = await escolha('Ambiente')
    expect((ambiente as HTMLButtonElement).disabled).toBe(true)
    // Com o botão já desligado, o toque nem chega ao onClick: quem barra aqui é o disabled (o ref do
    // escolher é provado no teste seguinte, com os dois toques no mesmo act).
    fireEvent.click(ambiente)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { envio.soltar({ ok: false, status: 500, json: async () => ({}) }) })
    expect(((await escolha('Ambiente')) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('Não deu pra apagar agora.')
  })

  it('o ref barra escolher no mesmo act do apagar, antes de o React desligar o botão', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    const { onSelect, onClose } = abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    const ambiente = await escolha('Ambiente')
    await act(async () => { fireEvent.click(botao('Apagar')); fireEvent.click(ambiente) })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
  })

  it('toque duplo no Salvar antes de o botão desligar manda um PATCH só', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const salvar = botao('Salvar')
    await act(async () => { fireEvent.click(salvar); fireEvent.click(salvar) })
    expect(pedidos('PATCH')).toHaveLength(1)
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
  })

  it('toque duplo no Apagar antes de o botão desligar manda um DELETE só', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    const apagar = botao('Apagar')
    await act(async () => { fireEvent.click(apagar); fireEvent.click(apagar) })
    expect(pedidos('DELETE')).toHaveLength(1)
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
  })

  it('renomear falhou (servidor recusou ou sem internet): a edição fica aberta com o nome digitado e a frase na janela', async () => {
    stubEnvio(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    fireEvent.change(screen.getByLabelText('Nome do conjunto'), { target: { value: 'Domingo à noite' } })
    await act(async () => { fireEvent.click(botao('Salvar')) })
    expect(screen.getByRole('alert').textContent).toBe('Não deu pra salvar o nome agora. Confira a internet e tente de novo.')
    expect((screen.getByLabelText('Nome do conjunto') as HTMLInputElement).value).toBe('Domingo à noite')
    expect(botao('Salvar').disabled).toBe(false)
    // Sem internet (o fetch lança): a mesma frase, sem erro solto.
    stubEnvio(async () => { throw new TypeError('Failed to fetch') })
    await act(async () => { fireEvent.click(botao('Salvar')) })
    expect(screen.getByRole('alert').textContent).toContain('Não deu pra salvar o nome agora.')
    // Cancelar some com a frase; o nome de antes fica.
    fireEvent.click(botao('Cancelar'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await escolha('Pads Domingo')).toBeTruthy()
  })

  it('apagar: enquanto envia, o Apagar diz Apagando e fica desligado; um pedido só', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    await act(async () => { fireEvent.click(botao('Apagar')) })
    const apagando = botao('Apagando...')
    expect(apagando.disabled).toBe(true)
    expect(apagando.getAttribute('aria-busy')).toBe('true')
    expect(botao('Cancelar').disabled).toBe(true)
    await act(async () => { fireEvent.click(apagando) })
    expect(pedidos('DELETE')).toHaveLength(1)
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
    expect(screen.queryByRole('button', { name: /^Pads Domingo/ })).toBeNull()
  })

  it('apagar falhou: o conjunto fica, a confirmação fica aberta e a frase aparece na janela', async () => {
    stubEnvio(async () => { throw new TypeError('Failed to fetch') })
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    await act(async () => { fireEvent.click(botao('Apagar')) })
    expect(screen.getByRole('alert').textContent).toBe('Não deu pra apagar agora. Confira a internet e tente de novo.')
    expect(screen.getByText('Apagar "Pads Domingo"?')).toBeTruthy()
    expect(botao('Apagar').disabled).toBe(false)
    fireEvent.click(botao('Cancelar'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await escolha('Pads Domingo')).toBeTruthy()
  })
})

// Revisão das telas (I1): no Chromium o botão focado que fica desligado perde o foco pro body, e aí o
// Esc não cancela, o Tab sai pra trás da janela e, no palco antigo, o Espaço toca a música por baixo. O
// foco fica dentro da janela no envio e volta pro botão (falha) ou pra janela (sucesso) no fim.
// Revisão das telas (M3) e re-revisão (N2): uma linha aberta por vez, e nada some sem Cancelar ou Salvar
// (Ruling). Com uma linha aberta (renomear ou apagar), o lápis e a lixeira dos outros conjuntos ficam
// desligados, como no envio; antes, abrir o apagar de outro jogava fora o nome que estava sendo digitado.
describe('Pads da nuvem: uma linha aberta por vez', () => {
  const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement

  it('renomeando (também depois de uma falha), os outros conjuntos não abrem nada e o nome digitado fica', async () => {
    fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : ok(SETS)()))
    vi.stubGlobal('fetch', fetchMock)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    fireEvent.change(screen.getByLabelText('Nome do conjunto'), { target: { value: 'Domingo à noite' } })
    expect([botao('Renomear Ambiente').disabled, botao('Apagar Ambiente').disabled]).toEqual([true, true])
    await act(async () => { fireEvent.click(botao('Salvar')) })
    expect(screen.getByRole('alert').textContent).toContain('Não deu pra salvar o nome agora.')
    expect([botao('Renomear Ambiente').disabled, botao('Apagar Ambiente').disabled]).toEqual([true, true])
    fireEvent.click(botao('Apagar Ambiente'))
    expect(screen.queryByText('Apagar "Ambiente"?')).toBeNull()
    expect((screen.getByLabelText('Nome do conjunto') as HTMLInputElement).value).toBe('Domingo à noite')
    // Só o Cancelar fecha; daí os outros voltam.
    fireEvent.click(botao('Cancelar'))
    expect([botao('Renomear Ambiente').disabled, botao('Apagar Ambiente').disabled]).toEqual([false, false])
  })

  it('confirmando o apagar, os outros conjuntos não abrem nada até o Cancelar', async () => {
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect([botao('Renomear Ambiente').disabled, botao('Apagar Ambiente').disabled]).toEqual([true, true])
    fireEvent.click(botao('Renomear Ambiente'))
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(screen.getByText('Apagar "Pads Domingo"?')).toBeTruthy()
    fireEvent.click(botao('Cancelar'))
    expect([botao('Renomear Ambiente').disabled, botao('Apagar Ambiente').disabled]).toEqual([false, false])
  })
})

describe('Pads da nuvem: o foco no envio', () => {
  function stubEnvio(envio: () => Promise<Resposta>) {
    fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? envio() : ok(SETS)()))
    vi.stubGlobal('fetch', fetchMock)
  }
  const preso = () => {
    let soltar!: (r: Resposta) => void
    const p = new Promise<Resposta>((r) => { soltar = r })
    return { p, soltar: (r: Resposta) => soltar(r) }
  }
  const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement
  const dialogo = () => screen.getByRole('dialog', { name: 'Pads da nuvem' })
  const falha: Resposta = { ok: false, status: 500, json: async () => ({}) }
  const sucesso: Resposta = { ok: true, json: async () => ({}) }

  it('renomear: com o foco no Salvar, o envio leva o foco pra janela; a falha devolve pro Salvar', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    botao('Salvar').focus()
    await act(async () => { fireEvent.click(botao('Salvar')) })
    // O Salvar desligado não fica com o foco: a janela fica.
    expect(document.activeElement).toBe(dialogo())
    // Como o Chromium faria com o botão desligado: o foco cai no body no meio do envio.
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { envio.soltar(falha) })
    expect(document.activeElement).toBe(botao('Salvar'))
  })

  it('renomear: no sucesso a linha some e o foco fica na janela', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    botao('Salvar').focus()
    await act(async () => { fireEvent.click(botao('Salvar')) })
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { envio.soltar(sucesso) })
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(document.activeElement).toBe(dialogo())
  })

  it('apagar: o foco do Cancelar (autoFocus) vai pra janela no envio; a falha leva pro Apagar; o sucesso, pra janela', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Pads Domingo' }))
    expect(document.activeElement?.textContent).toBe('Cancelar')
    await act(async () => { fireEvent.click(botao('Apagar')) })
    expect(document.activeElement).toBe(dialogo())
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { envio.soltar(falha) })
    expect(document.activeElement).toBe(botao('Apagar'))
    const segundo = preso()
    stubEnvio(() => segundo.p)
    await act(async () => { fireEvent.click(botao('Apagar')) })
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { segundo.soltar(sucesso) })
    expect(screen.queryByText('Apagar "Pads Domingo"?')).toBeNull()
    expect(document.activeElement).toBe(dialogo())
  })

  // Re-revisão das telas (N1): o fim do envio só devolve o foco quando ele está perdido (body) ou na própria
  // janela. Quem está no campo de texto fica nele (no iPad, pular pro botão fecharia o teclado).
  it('com o foco no campo do nome, o envio e a falha não tiram o foco dele', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    abrir(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto')
    nome.focus()
    await act(async () => { fireEvent.click(botao('Salvar')) })
    expect(document.activeElement).toBe(nome)
    await act(async () => { envio.soltar(falha) })
    expect(document.activeElement).toBe(nome)
  })

  it('outra janela do palco aberta por cima no meio do envio não perde o foco no fim', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    const props = { isOpen: true, onClose: vi.fn(), onSelect: vi.fn(), selectedPadSet: null, isAdmin: true }
    const view = render(<PadSetsModal {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    botao('Salvar').focus()
    await act(async () => { fireEvent.click(botao('Salvar')) })
    view.rerender(<><PadSetsModal {...props} /><StageDialog open title="Por cima" onClose={vi.fn()}><button type="button">Ok de cima</button></StageDialog></>)
    const deCima = screen.getByRole('dialog', { name: 'Por cima' })
    expect(deCima.contains(document.activeElement)).toBe(true)
    const antes = document.activeElement
    await act(async () => { envio.soltar(falha) })
    expect(document.activeElement).toBe(antes)
    expect(deCima.contains(document.activeElement)).toBe(true)
  })
})

// Revisão das telas (M8): a resposta chegando com a janela fechada e o Esc no meio do envio.
describe('Pads da nuvem: envio com a janela fechada e Esc', () => {
  function stubEnvio(envio: () => Promise<Resposta>) {
    fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method ? envio() : ok(SETS)()))
    vi.stubGlobal('fetch', fetchMock)
  }
  const preso = () => {
    let soltar!: (r: Resposta) => void
    const p = new Promise<Resposta>((r) => { soltar = r })
    return { p, soltar: (r: Resposta) => soltar(r) }
  }
  const props = { onClose: vi.fn(), onSelect: vi.fn(), selectedPadSet: { id: 'b', name: 'Ambiente', base_path: 'pads/b' }, isAdmin: true }

  it('a janela fecha no meio do renomear; a resposta chega e, reaberta, os botões estão de volta', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    const view = render(<PadSetsModal isOpen {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeTruthy()
    view.rerender(<PadSetsModal isOpen={false} {...props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { envio.soltar({ ok: true, json: async () => ({}) }) })
    // Fechada, nada foca nem quebra.
    expect(document.activeElement).toBe(document.body)
    view.rerender(<PadSetsModal isOpen {...props} />)
    const renomear = await screen.findByRole('button', { name: 'Renomear Ambiente' }) as HTMLButtonElement
    expect(renomear.disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Salvando...' })).toBeNull()
  })

  it('o Esc no meio do envio não cancela a linha nem fecha a janela', async () => {
    const envio = preso()
    stubEnvio(() => envio.p)
    const onClose = vi.fn()
    render(<PadSetsModal isOpen {...props} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear Pads Domingo' }))
    const nome = screen.getByLabelText('Nome do conjunto')
    nome.focus()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    fireEvent.keyDown(nome, { key: 'Escape', code: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome do conjunto')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeTruthy()
    await act(async () => { envio.soltar({ ok: false, status: 500, json: async () => ({}) }) })
    expect(screen.getByRole('alert').textContent).toContain('Não deu pra salvar o nome agora.')
    // Terminado o envio, o Esc volta a cancelar a edição.
    fireEvent.keyDown(screen.getByLabelText('Nome do conjunto'), { key: 'Escape', code: 'Escape' })
    expect(screen.queryByLabelText('Nome do conjunto')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Pads da nuvem: linguagem do palco', () => {
  it('só classes da linguagem nova, com o admin aberto', async () => {
    abrir(true)
    await escolha('Pads Domingo')
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})
