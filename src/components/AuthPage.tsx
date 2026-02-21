import { useState } from 'react';
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthPageProps {
}

export function AuthPage({ }: AuthPageProps) {
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === 'login') {
                const { error } = await supabase!.auth.signInWithPassword({ email, password });
                if (error) throw error;
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
        <div className="min-h-screen bg-black text-white font-sans flex font-inter">
            {/* Left Column (Branding) */}
            <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-b from-orange-600 via-orange-900 to-black p-12 flex-col justify-between relative overflow-hidden">
                {/* Minimalist Header Logo */}
                <div className="flex items-center gap-3 relative z-10">
                    <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center">
                        <div className="w-3 h-3 bg-white rounded-full"></div>
                    </div>
                    <span className="text-xl font-bold tracking-tight">Multitracks</span>
                </div>

                {/* Main Branding Content */}
                <div className="max-w-md relative z-10 my-auto">
                    <h1 className="text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight tracking-tight">
                        Comece a usar <br />agora mesmo
                    </h1>
                    <p className="text-gray-300 text-lg mb-12">
                        Sistema profissional para reprodução contínua de multitracks e cliques ao vivo.
                    </p>

                    {/* Component Steps */}
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4 bg-white text-black p-4 rounded-xl shadow-lg transform transition-transform hover:scale-[1.02]">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-bold text-sm">1</div>
                            <span className="font-semibold text-sm">Crie sua conta</span>
                        </div>
                        <div className="flex items-center gap-4 bg-white/5 text-gray-400 p-4 rounded-xl border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-black/50 text-gray-400 border border-white/10 flex items-center justify-center font-bold text-sm">2</div>
                            <span className="font-medium text-sm">Configure seu repertório</span>
                        </div>
                        <div className="flex items-center gap-4 bg-white/5 text-gray-400 p-4 rounded-xl border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-black/50 text-gray-400 border border-white/10 flex items-center justify-center font-bold text-sm">3</div>
                            <span className="font-medium text-sm">De play e conduza</span>
                        </div>
                    </div>
                </div>

                {/* Footer Brand */}
                <div className="relative z-10 text-xs text-white/40 tracking-widest uppercase font-bold text-center">
                    Multitracks Playback
                </div>

                {/* Decorative glowing orb */}
                <div className="absolute top-1/4 -right-32 w-96 h-96 bg-orange-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40"></div>
            </div>

            {/* Right Column (Form) */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 relative">

                {/* Mobile Header Logo */}
                <div className="absolute top-8 left-8 flex items-center gap-3 lg:hidden">
                    <div className="w-8 h-8 rounded-full border-2 border-orange-500 flex items-center justify-center">
                        <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    </div>
                    <span className="text-lg font-bold tracking-tight text-white">Multitracks</span>
                </div>

                <div className="w-full max-w-md">
                    <div className="mb-10 text-center lg:text-left">
                        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                            {mode === 'login' ? 'Acesse sua Conta' : mode === 'register' ? 'Crie sua Conta' : 'Recuperar Senha'}
                        </h2>
                        <p className="text-gray-400 text-sm">
                            {mode === 'login' ? 'Bem-vindo de volta! Insira seus dados.' : mode === 'register' ? 'Insira seus dados para criar sua conta.' : 'Insira seu email para receber instruções de recuperação.'}
                        </p>
                    </div>

                    {/* Social Buttons */}
                    {mode !== 'forgot' && (
                        <>
                            <div className="flex flex-col gap-4 mb-8">
                                <button
                                    onClick={handleGoogleLogin}
                                    className="flex items-center justify-center gap-2 h-12 w-full rounded-lg border border-zinc-800 text-white font-medium hover:bg-zinc-900 transition-colors cursor-pointer"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                    </svg>
                                    Google
                                </button>
                            </div>

                            <div className="flex items-center gap-4 mb-8">
                                <div className="h-px bg-zinc-800 flex-1"></div>
                                <span className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Ou</span>
                                <div className="h-px bg-zinc-800 flex-1"></div>
                            </div>
                        </>
                    )}

                    {error && <div className="p-4 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
                    {message && <div className="p-4 mb-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">{message}</div>}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-zinc-400 text-xs font-semibold mb-2">Email</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-4 top-3.5 text-zinc-500" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-lg pl-11 pr-4 py-3 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all placeholder:text-zinc-600"
                                    placeholder="ex. seuemail@exemplo.com"
                                />
                            </div>
                        </div>

                        {mode !== 'forgot' && (
                            <div>
                                <label className="block text-zinc-400 text-xs font-semibold mb-2">Senha</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-4 top-3.5 text-zinc-500" />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-lg pl-11 pr-4 py-3 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all placeholder:text-zinc-600"
                                        placeholder="Digite sua senha"
                                        minLength={6}
                                    />
                                    <div className="absolute right-4 top-3.5 text-zinc-500 text-xs font-medium">
                                        Mínimo 6 caracteres.
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-4 h-12 bg-white text-black font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-gray-200 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : (
                                <>
                                    {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Cadastrar' : 'Enviar Instruções'}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-8 text-center text-sm">
                        {mode === 'login' ? (
                            <div className="flex flex-col gap-3">
                                <button onClick={() => setMode('forgot')} className="text-zinc-400 hover:text-white transition-colors cursor-pointer">Esqueceu sua senha?</button>
                                <div className="text-zinc-400">
                                    Não tem uma conta? <button onClick={() => setMode('register')} className="text-white font-bold hover:underline cursor-pointer">Faça cadastro</button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-zinc-400">
                                Já tem uma conta? <button onClick={() => setMode('login')} className="text-white font-bold hover:underline cursor-pointer">Entrar</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
