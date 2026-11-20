// Login do /admin na web (quem abre /admin sem estar logado), na linguagem do palco como o resto do
// admin: a marca com o selo Admin, os campos e o botão do kit, o erro em alerta.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PlaybackStudioWordmark } from '../components/brand/PlaybackStudioWordmark';
import { Button, Notice, Panel, TextField } from '../components/ui';

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError('Supabase não configurado.'); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('E-mail ou senha inválidos.');
    setLoading(false);
    // Sucesso: onAuthStateChange do useAuth atualiza o guard automaticamente.
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
