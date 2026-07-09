import { useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError('Supabase não configurado'); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('Email ou senha inválidos');
    setLoading(false);
    // Sucesso: onAuthStateChange do useAuth atualiza o guard automaticamente.
  };

  return (
    <div className="min-h-screen bg-[#0e0e10] flex items-center justify-center p-6">
      <form onSubmit={submit} className="daw-panel rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg border border-primary/20"><Shield size={20} className="text-primary" /></div>
          <div>
            <h1 className="text-white font-black text-sm uppercase tracking-wider">Painel Administrativo</h1>
            <p className="text-[10px] text-text-muted font-mono">Playback Studio</p>
          </div>
        </div>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="email"
          className="w-full daw-input text-white text-sm px-3 py-2.5 rounded-lg" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha" autoComplete="current-password"
          className="w-full daw-input text-white text-sm px-3 py-2.5 rounded-lg" />
        {error && <p className="text-accent-red text-xs font-mono">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-primary text-black font-bold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
