import { useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'
import type { RecoveryAuthClient } from '../lib/passwordRecovery'
import { Button, Notice, Panel, TextField } from './ui'

// Tela "Criar nova senha", depois do link de recuperação do email (web e desktop).
// A pessoa já está com a sessão de recuperação; aqui só troca a senha com updateUser.

const MIN_LENGTH = 8

function friendlyError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('session') || m.includes('expired') || m.includes('jwt')) {
    return 'O link de recuperação venceu. Peça um novo em Esqueceu sua senha?, na tela de entrar.'
  }
  if (m.includes('different from the old')) return 'A senha nova precisa ser diferente da anterior.'
  if (m.includes('at least') || m.includes('weak')) return 'O servidor achou a senha fraca. Use uma senha mais longa, com letras e números.'
  return `Não deu pra salvar a senha nova: ${message}`
}

export function NewPasswordPage({ client, onDone, onCancel }: {
  client: RecoveryAuthClient
  onDone: () => void
  // Antes de salvar: sai da conta e vai pra tela de entrar (não fica logado pelo link).
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) return setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`)
    if (password !== confirm) return setError('As duas senhas não são iguais.')
    setSaving(true)
    try {
      const { error: updateError } = await client.auth.updateUser({ password })
      if (updateError) setError(friendlyError(updateError.message))
      else setSaved(true)
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-ps-ink font-ps-sans text-ps-bone flex items-center justify-center px-ps-gutter py-10">
      <main className="w-full max-w-sm flex flex-col">
        <div className="mb-8 flex justify-center"><PlaybackStudioWordmark size="md" tone="light" /></div>
        <Panel className="flex flex-col gap-5 p-6">
          <h1 className="font-bold text-[28px] leading-tight text-center">Criar nova senha</h1>
          {saved ? (
            <div className="flex flex-col gap-5">
              <Notice role="status" className="text-center">Senha nova salva. Você já está conectado.</Notice>
              <Button tone="primary" size="lg" onClick={onDone}>
                Continuar
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <p className="text-ps-mut text-ps-base leading-snug text-center text-pretty">Use pelo menos {MIN_LENGTH} caracteres. Digite duas vezes pra conferir.</p>
              <TextField id="nova-senha" label="Nova senha" type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} />
              <TextField id="repita-senha" label="Repita a nova senha" type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} />
              {error && <Notice tone="alert" role="alert">{error}</Notice>}
              {/* Salvando: o texto fica e o ícone gira. */}
              <Button
                type="submit"
                tone="primary"
                size="lg"
                disabled={saving}
                icon={saving ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Lock size={16} />}
                className="mt-1"
              >
                Salvar nova senha
              </Button>
              <Button tone="ghost" onClick={onCancel}>
                Cancelar e voltar pra tela de entrar
              </Button>
            </form>
          )}
        </Panel>
      </main>
    </div>
  )
}
