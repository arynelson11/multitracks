// Login do /admin na web (quem abre /admin sem estar logado), na linguagem do palco como o resto do
// admin: a marca com o selo Admin, os campos e o botão do kit, o erro em alerta.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PlaybackStudioWordmark } from '../components/brand/PlaybackStudioWordmark';
import { Button, Notice, Panel, TextField } from '../components/ui';

// Sem chegar no servidor (manutenção 2026-11-27): o pedido lançou, ou o Supabase devolveu o erro
// de rede dele (AuthRetryableFetchError). A frase é a da internet, não a da senha.
const NETWORK_TEXT = 'Não deu pra falar com o servidor agora. Confira a internet e tente de novo.';
const isNetworkError = (e: { name?: string; status?: number }) => e.name === 'AuthRetryableFetchError' || e.status === 0;

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError('Supabase não configurado.'); return; }
    setLoading(true); setError(null);
    // try/finally: um erro de rede no meio nunca deixa o Entrar preso em "carregando".
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(isNetworkError(error) ? NETWORK_TEXT : 'E-mail ou senha inválidos.');
      // Sucesso: onAuthStateChange do useAuth atualiza o guard automaticamente.
    } catch (e) {
      console.error('[admin] login falhou', e);
      setError(NETWORK_TEXT);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ps-ink p-ps-gutter font-ps-sans text-ps-bone">
      <Panel variant="raised" className="w-full max-w-sm p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <PlaybackStudioWordmark size="sm" />
              <span className="ps-label">Admin</span>
            </div>
            <h1 className="text-ps-md font-bold">Painel do admin</h1>
          </div>
          <TextField label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <TextField label="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <Notice tone="alert" role="alert">{error}</Notice>}
          <Button
            type="submit" tone="primary" disabled={loading} aria-busy={loading || undefined}
            icon={loading ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : undefined}
          >
            Entrar
          </Button>
        </form>
      </Panel>
    </div>
  );
}
