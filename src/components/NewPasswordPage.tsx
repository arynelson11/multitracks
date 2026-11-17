import { useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark'
import type { RecoveryAuthClient } from '../lib/passwordRecovery'

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

  const input = 'w-full rounded-xl bg-tinta-raised border border-tinta-border px-4 py-3 text-[16px] text-bone placeholder:text-ps-mut focus:outline-none focus:border-laranja'

  return (
    <div className="min-h-screen bg-tinta text-bone flex items-center justify-center px-5 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><PlaybackStudioWordmark size="md" tone="light" /></div>
        <h1 className="font-display font-semibold text-[28px] leading-tight mb-2 text-center">Criar nova senha</h1>
        {saved ? (
          <div className="text-center">
            <p role="status" className="text-warm-200 text-[15px] mb-6">Senha nova salva. Você já está conectado.</p>
            <button
              onClick={onDone}
              className="w-full rounded-xl bg-laranja hover:bg-laranja-light text-ps-on-or font-semibold py-3 text-[15px] transition-colors cursor-pointer"
            >
              Continuar
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <p className="text-warm-200 text-[14px] text-center mb-2">Use pelo menos {MIN_LENGTH} caracteres. Digite duas vezes pra conferir.</p>
            <div>
              <label htmlFor="nova-senha" className="block text-[13px] text-warm-200 mb-1.5">Nova senha</label>
              <input id="nova-senha" type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="repita-senha" className="block text-[13px] text-warm-200 mb-1.5">Repita a nova senha</label>
              <input id="repita-senha" type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} className={input} />
            </div>
            {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-laranja hover:bg-laranja-light text-ps-on-or font-semibold py-3 text-[15px] transition-colors cursor-pointer disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
              Salvar nova senha
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 text-[14px] text-warm-200 hover:text-bone transition-colors cursor-pointer"
            >
              Cancelar e voltar pra tela de entrar
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
