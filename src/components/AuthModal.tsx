import { useState } from 'react';
import { X, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === 'login') {
                const { error } = await supabase!.auth.signInWithPassword({ email, password });
                if (error) throw error;
                onClose();
            } else if (mode === 'register') {
                const { error } = await supabase!.auth.signUp({ email, password });
                if (error) throw error;
                setMessage('Cadastro realizado! Verifique seu email para confirmar.');
            } else if (mode === 'forgot') {
                const { error } = await supabase!.auth.resetPasswordForEmail(email);
                if (error) throw error;
                setMessage('Instruções de recuperação enviadas para o seu email.');
            }
        } catch (err: any) {
            setError(err.message || 'Ocorreu um erro.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google' });
            if (error) throw error;
        } catch (err: any) {
            setError(err.message || 'Erro ao conectar com Google.');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
            <div className="bg-[#1c1c1e] w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                    <h2 className="text-white font-bold text-lg">
                        {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar Conta' : 'Recuperar Senha'}
                    </h2>
                    <button onClick={onClose} className="p-1.5 bg-white/5 hover:bg-white/20 rounded-full text-text-muted transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    {error && <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
                    {message && <div className="p-3 mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">{message}</div>}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-text-muted text-xs font-semibold mb-1.5 uppercase tracking-wider">Email</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3 top-3 text-white/40" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 text-white rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                                    placeholder="seu@email.com"
                                />
                            </div>
                        </div>

                        {mode !== 'forgot' && (
                            <div>
                                <label className="block text-text-muted text-xs font-semibold mb-1.5 uppercase tracking-wider">Senha</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-3 top-3 text-white/40" />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 text-white rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                                        placeholder="••••••••"
                                        minLength={6}
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-2 bg-primary text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : (
                                <>
                                    {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Cadastrar' : 'Enviar Instruções'}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 flex items-center gap-4">
                        <div className="h-px bg-white/10 flex-1"></div>
                        <span className="text-text-muted text-xs uppercase tracking-widest">OU</span>
                        <div className="h-px bg-white/10 flex-1"></div>
                    </div>

                    <button
                        onClick={handleGoogleLogin}
                        className="w-full mt-6 bg-white text-black font-bold py-2.5 rounded-lg flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Continuar com Google
                    </button>

                    <div className="mt-6 flex flex-col gap-2 text-center text-sm">
                        {mode === 'login' ? (
                            <>
                                <button onClick={() => setMode('forgot')} className="text-text-muted hover:text-white transition-colors">Esqueceu a senha?</button>
                                <button onClick={() => setMode('register')} className="text-text-muted hover:text-white transition-colors">Não tem uma conta? <span className="text-primary">Cadastre-se</span></button>
                            </>
                        ) : (
                            <button onClick={() => setMode('login')} className="text-text-muted hover:text-white transition-colors">Já tem uma conta? <span className="text-primary">Entrar</span></button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
