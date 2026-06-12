import { useState, useEffect } from 'react';
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark';
import { isElectron, onDeepLinkAuth } from '../lib/desktop';

import { DomingoMark } from './brand/DomingoMark';

interface AuthPageProps {
}

export function AuthPage({ }: AuthPageProps) {
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    // ── Electron: escuta o deep link de volta do navegador ──
    useEffect(() => {
        if (!isElectron || !supabase) return;

        const cleanup = onDeepLinkAuth(async (fragment) => {
            // fragment = "access_token=xxx&refresh_token=yyy&..."
            const params = new URLSearchParams(fragment);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');

            if (accessToken && refreshToken) {
                const { error } = await supabase!.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                if (error) {
                    setError('Erro ao restaurar sessão do Google: ' + error.message);
                }
                // Se deu certo, o onAuthStateChange do useAuth vai pegar a sessão.
            }
        });

        return cleanup;
    }, []);

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
                setMessage('Cadastro feito. Verifica seu email pra confirmar.');
            } else if (mode === 'forgot') {
                const { error } = await supabase!.auth.resetPasswordForEmail(email);
                if (error) throw error;
                setMessage('Instruções de recuperação enviadas pro seu email.');
            }
        } catch (err: any) {
            setError(err.message || 'Algo deu errado.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            if (isElectron) {
                // No Electron: monta a URL do OAuth manualmente e abre no navegador do sistema.
                // O redirect vai pra playbackstudio://auth/callback pra o app capturar o token.
                const { data, error } = await supabase!.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: 'playbackstudio://auth/callback',
                        skipBrowserRedirect: true, // Não deixa o Supabase redirecionar a janela atual
                    }
                });
                if (error) throw error;
                // Abre a URL de auth no navegador do sistema
                if (data?.url) {
                    window.playbackDesktop?.openExternalUrl(data.url);
                }
            } else {
                // No navegador: fluxo normal, redireciona na mesma janela
                const { error } = await supabase!.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin
                    }
                });
                if (error) throw error;
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao conectar com Google.');
        }
    };

    return (
        <div className="min-h-screen bg-tinta text-bone flex">
            {/* Left Column (Branding) */}
            <div className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-between relative overflow-hidden"
                style={{ background: 'linear-gradient(180deg, #1A1A1E 0%, #121214 60%, #0E0E10 100%)' }}>
                {/* Atmosphere — laranja glow on dark cool */}
                <div className="absolute top-1/4 -right-32 w-96 h-96 bg-laranja rounded-full mix-blend-screen filter blur-[140px] opacity-[0.18]"></div>
                <div className="absolute -bottom-32 -left-20 w-80 h-80 bg-musgo rounded-full mix-blend-screen filter blur-[140px] opacity-[0.1]"></div>

                {/* Header logo */}
                <div className="flex items-center relative z-10">
                    <PlaybackStudioWordmark size="md" tone="light" />
                </div>

                {/* Main branding content */}
                <div className="max-w-md relative z-10 my-auto">
                    <div className="inline-flex items-baseline gap-3 mb-6 select-none">
                        <span className="text-warm-400 text-[13px] font-medium tracking-wide">pronto pro</span>
                        <DomingoMark size="md" tone="laranja" />
                    </div>
                    <h1 className="font-display font-semibold text-bone text-4xl lg:text-5xl mb-6 leading-[1.05] tracking-[-0.02em]">
                        Toda música, todo<br />domingo, na sua mão.
                    </h1>
                    <p className="text-warm-200 text-[15px] mb-12 leading-relaxed">
                        Separe qualquer música em stems prontos. Pra sua equipe chegar pronta no próximo culto.
                    </p>

                    {/* Steps */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-laranja/[0.08] border border-laranja/25 text-bone">
                            <div className="w-8 h-8 rounded-md bg-laranja text-bone flex items-center justify-center font-display font-semibold text-[14px]">1</div>
                            <span className="font-medium text-[13px]">Criar conta</span>
                        </div>
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-bone/[0.03] border border-tinta-border text-warm-200">
                            <div className="w-8 h-8 rounded-md bg-tinta-border text-warm-200 flex items-center justify-center font-display font-semibold text-[14px]">2</div>
                            <span className="font-medium text-[13px]">Subir sua primeira música</span>
                        </div>
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-bone/[0.03] border border-tinta-border text-warm-200">
                            <div className="w-8 h-8 rounded-md bg-tinta-border text-warm-200 flex items-center justify-center font-display font-semibold text-[14px]">3</div>
                            <span className="font-medium text-[13px]">Ensaiar pronto pro domingo</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="relative z-10 text-[11px] text-warm-400 tracking-wide text-center">
                    Feito por quem toca.
                </div>
            </div>

            {/* Right Column (Form) */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 relative bg-tinta">
                {/* Mobile header */}
                <div className="absolute top-8 left-8 flex items-center gap-2 lg:hidden">
                    <PlaybackStudioWordmark size="sm" tone="light" />
                </div>

                <div className="w-full max-w-md">
                    <div className="mb-10 text-center lg:text-left">
                        <h2 className="font-display font-semibold text-bone text-3xl mb-2 tracking-[-0.01em]">
                            {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Recuperar senha'}
                        </h2>
                        <p className="text-warm-400 text-[13px]">
                            {mode === 'login' ? 'Bem-vindo de volta.' : mode === 'register' ? 'Vamos te mostrar como deixar seu próximo domingo mais leve.' : 'A gente envia instruções pro seu email.'}
                        </p>
                    </div>

                    {/* Social Buttons */}
                    {mode !== 'forgot' && (
                        <>
                            <div className="flex flex-col gap-4 mb-8">
                                <button
                                    onClick={handleGoogleLogin}
                                    className="flex items-center justify-center gap-2.5 h-12 w-full rounded-xl border border-tinta-border bg-tinta-raised text-bone font-medium text-[13px] hover:bg-tinta-border transition-all cursor-pointer active:scale-[0.98]"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                    </svg>
                                    Continuar com Google
                                </button>
                            </div>

                            <div className="flex items-center gap-4 mb-8">
                                <div className="h-px bg-tinta-border flex-1"></div>
                                <span className="text-warm-400 text-[10px] font-medium uppercase tracking-[0.2em]">ou</span>
                                <div className="h-px bg-tinta-border flex-1"></div>
                            </div>
                        </>
                    )}

                    {error && <div className="p-3 mb-6 rounded-lg bg-error/10 border border-error/25 text-error text-[13px]">{error}</div>}
                    {message && <div className="p-3 mb-6 rounded-lg bg-success/10 border border-success/25 text-success text-[13px]">{message}</div>}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-warm-400 text-[11px] font-medium mb-2 uppercase tracking-wider">Email</label>
                            <div className="relative">
                                <Mail size={15} className="absolute left-4 top-3.5 text-warm-400" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-tinta-raised border border-tinta-border rounded-xl pl-11 pr-4 py-3 text-bone placeholder:text-warm-400/50 text-[14px] focus:border-laranja focus:outline-none focus:ring-2 focus:ring-laranja/15 transition-colors"
                                    placeholder="seu@email.com"
                                />
                            </div>
                        </div>

                        {mode !== 'forgot' && (
                            <div>
                                <label className="block text-warm-400 text-[11px] font-medium mb-2 uppercase tracking-wider">Senha</label>
                                <div className="relative">
                                    <Lock size={15} className="absolute left-4 top-3.5 text-warm-400" />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-tinta-raised border border-tinta-border rounded-xl pl-11 pr-4 py-3 text-bone placeholder:text-warm-400/50 text-[14px] focus:border-laranja focus:outline-none focus:ring-2 focus:ring-laranja/15 transition-colors"
                                        placeholder="Sua senha"
                                        minLength={6}
                                    />
                                    <div className="absolute right-4 top-3.5 text-warm-400/60 text-[10px]">
                                        mín 6
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-4 h-12 bg-laranja hover:bg-laranja-dark text-bone font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer text-[14px] shadow-lg shadow-laranja/20"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : (
                                <>
                                    {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar instruções'}
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-8 text-center text-sm">
                        {mode === 'login' ? (
                            <div className="flex flex-col gap-3">
                                <button onClick={() => setMode('forgot')} className="text-warm-400 hover:text-bone transition-colors cursor-pointer text-[13px]">Esqueceu sua senha?</button>
                                <div className="text-warm-400 text-[13px]">
                                    Não tem conta? <button onClick={() => setMode('register')} className="text-laranja hover:underline cursor-pointer font-medium">Criar conta</button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-warm-400 text-[13px]">
                                Já tem conta? <button onClick={() => setMode('login')} className="text-laranja hover:underline cursor-pointer font-medium">Entrar</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
