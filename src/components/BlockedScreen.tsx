import { useRef, useState } from 'react'
import { Button, Panel } from './ui'
import { SubscriptionPanel } from './SubscriptionPanel'
import { isPaidPlan } from '../lib/plans'
import { deleteAccountNotice, fetchCancelPreview } from '../lib/subscription'
import { openExternalUrl } from '../lib/desktop'

// Tela de conta bloqueada pelo admin (D10). Entra no lugar do app inteiro: a pessoa ainda
// fala com a gente, cancela a assinatura (o bloqueio não mexe na cobrança), exclui a conta
// ou sai. Assinar de novo não leva a lugar nenhum, porque o checkout recusa conta bloqueada.

// Mesmo número de suporte da página inicial (LandingPage.tsx).
const WHATSAPP_URL =
  'https://wa.me/5522997249896?text=' +
  encodeURIComponent('Olá! Minha conta do Playback Studio está bloqueada e quero entender o que aconteceu.')

const CONFIRM_WORD = 'EXCLUIR'

type Props = {
  plan: string
  onSignOut: () => void | Promise<void>
  onDeleteAccount: () => Promise<void>
}

// notice: undefined = conferindo a assinatura; null = sem aviso (plano Livre).
type Confirm = { notice: string | null | undefined; typed: string; busy: boolean; error: string | null }

const noop = () => {}

export function BlockedScreen({ plan, onSignOut, onDeleteAccount }: Props) {
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  // Cada abertura da confirmação ganha um número: a prévia que chega de uma abertura antiga é descartada.
  const openId = useRef(0)

  const openConfirm = () => {
    const id = ++openId.current
    // O mesmo aviso do Perfil: quem tem plano pago vê o que acontece com o dinheiro antes de confirmar.
    if (!isPaidPlan(plan)) {
      setConfirm({ notice: null, typed: '', busy: false, error: null })
      return
    }
    setConfirm({ notice: undefined, typed: '', busy: false, error: null })
    void fetchCancelPreview().catch(() => null).then((preview) => {
      if (openId.current !== id) return
      setConfirm((c) => (c ? { ...c, notice: deleteAccountNotice(preview, plan) } : c))
    })
  }

  const closeConfirm = () => {
    openId.current++
    setConfirm(null)
  }

  const canDelete = !!confirm && confirm.notice !== undefined && !confirm.busy && confirm.typed.trim() === CONFIRM_WORD

  const doDelete = async () => {
    if (!canDelete) return
    setConfirm((c) => (c ? { ...c, busy: true, error: null } : c))
    try {
      // Deu certo: o useAuth sai da conta e o app volta pro login.
      await onDeleteAccount()
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Não foi possível excluir a conta. Tente novamente.'
      setConfirm((c) => (c ? { ...c, busy: false, error: message } : c))
    }
  }

  return (
    <main className="min-h-[100dvh] bg-ps-ink text-ps-bone font-ps-sans flex flex-col items-center px-ps-gutter py-10">
      <div className="w-full max-w-md flex flex-col gap-4">
        <Panel className="p-5 flex flex-col gap-3">
          <h1 className="text-ps-lg font-bold leading-tight">Sua conta está bloqueada</h1>
          <p className="text-ps-base text-ps-mut leading-relaxed">Fale com a gente pelo WhatsApp para entender e resolver.</p>
          <Button tone="primary" className="self-start" onClick={() => openExternalUrl(WHATSAPP_URL)}>
            Falar no WhatsApp
          </Button>
        </Panel>

        <SubscriptionPanel plan={plan} onChanged={noop} onOpenPricing={noop} />

        {confirm ? (
          <Panel variant="raised" role="dialog" aria-label="Excluir a conta?" className="p-5 flex flex-col gap-3">
            <h2 className="text-ps-md font-bold">Excluir a conta?</h2>
            <p className="text-ps-base text-ps-bone leading-relaxed">Isto apaga sua conta permanentemente e não pode ser desfeito.</p>
            {confirm.notice === undefined ? (
              <p className="text-ps-base text-ps-mut leading-relaxed">Conferindo o que acontece com a sua assinatura...</p>
            ) : confirm.notice ? (
              <p className="text-ps-base text-ps-mut leading-relaxed">{confirm.notice}</p>
            ) : null}
            <label className="flex flex-col gap-2 text-ps-sm text-ps-mut">
              Digite {CONFIRM_WORD} para confirmar
              <input
                type="text"
                value={confirm.typed}
                onChange={(e) => {
                  const typed = e.target.value
                  setConfirm((c) => (c ? { ...c, typed } : c))
                }}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={confirm.busy}
                className="w-full min-h-ps-touch rounded-ps-md bg-ps-well px-ps-pad-x font-ps-mono text-ps-md text-ps-bone inset-ring inset-ring-ps-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
              />
            </label>
            {confirm.error && (
              <p role="alert" className="text-ps-sm text-ps-alert leading-relaxed break-words">{confirm.error}</p>
            )}
            <div className="flex flex-wrap gap-ps-gap">
              <Button disabled={!canDelete} onClick={() => { void doDelete() }}>
                {confirm.busy ? 'Excluindo...' : 'Excluir de vez'}
              </Button>
              <Button tone="ghost" disabled={confirm.busy} onClick={closeConfirm}>Voltar</Button>
            </div>
          </Panel>
        ) : null}

        <div className="flex flex-wrap gap-ps-gap">
          {!confirm && <Button onClick={openConfirm}>Excluir minha conta</Button>}
          <Button tone="ghost" onClick={() => { void Promise.resolve(onSignOut()).catch(noop) }}>Sair</Button>
        </div>
      </div>
    </main>
  )
}
