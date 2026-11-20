import { useState, useEffect } from 'react';
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PlaybackStudioWordmark } from './brand/PlaybackStudioWordmark';
import { isElectron, onDeepLinkAuth } from '../lib/desktop';
import { SITE_URL } from '../content/site';
import { DomingoMark } from './brand/DomingoMark';
import { Button, Notice, Panel, TextField } from './ui';

// Os links dos e-mails de cadastro e de recuperar senha sempre voltam no site, na web e no
// desktop (o app de file:// não recebe link de e-mail com segurança: o deep link se perde se o
// app não estiver aberto, e no celular não abre nada). A tela Criar nova senha fica no site.
const AUTH_EMAIL_REDIRECT = `${SITE_URL}/`;
const DESKTOP_RECOVERY_HINT = 'Abra o link do e-mail no navegador, crie a nova senha e volte ao app para entrar.';

const STEPS = ['Criar conta', 'Subir sua primeira música', 'Ensaiar pronto pro domingo'] as const;

// Logo do Google com as cores dele (marca de terceiro: as cores são do dado, não do código de estados).
function GoogleLogo() {
    return (
        <svg className="size-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    );
}


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
            // Recuperar senha não passa pelo app: se um link desses chegar aqui, não loga
            // com ele e orienta a usar o navegador (mensagem própria, não a do Google).
            if (params.get('type') === 'recovery') {
                setError(null);
                setMessage(DESKTOP_RECOVERY_HINT);
                return;
            }
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');

            if (accessToken && refreshToken) {
                const { error } = await supabase!.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                if (error) {
                    setError('Erro ao entrar com o Google: ' + error.message);
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
                const { error } = await supabase!.auth.signUp({
                    email,
                    password,
                    options: { emailRedirectTo: AUTH_EMAIL_REDIRECT },
                });
                if (error) throw error;
                setMessage('Cadastro feito. Verifica seu email pra confirmar.');
            } else if (mode === 'forgot') {
                const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: AUTH_EMAIL_REDIRECT });
                if (error) throw error;
                setMessage(isElectron
                    ? `Instruções de recuperação enviadas pro seu e-mail. ${DESKTOP_RECOVERY_HINT}`
                    : 'Instruções de recuperação enviadas pro seu email.');
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

    const title = mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Recuperar senha';
    const subtitle = mode === 'login' ? 'Bem-vindo de volta.' : mode === 'register' ? 'Vamos te mostrar como deixar seu próximo domingo mais leve.' : 'A gente envia instruções pro seu email.';
    const submitLabel = mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar instruções';

    return (
        <div className="min-h-dvh bg-ps-ink font-ps-sans text-ps-bone flex">
            {/* Coluna da marca (só a partir de lg), no fundo mais escuro do palco */}
            <aside className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-between gap-10 relative overflow-hidden bg-ps-ink-0 border-r border-ps-line">
                {/* Brilho laranja e musgo de fundo, decorativo */}
                <div aria-hidden="true" className="pointer-events-none absolute top-1/4 -right-32 size-96 rounded-full bg-ps-or opacity-[0.14] blur-[140px]"></div>
                <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-ps-moss opacity-[0.12] blur-[140px]"></div>

                <div className="flex items-center relative z-10">
                    <PlaybackStudioWordmark size="md" tone="light" />
                </div>

                <div className="max-w-md relative z-10 my-auto">
                    <div className="inline-flex items-baseline gap-3 mb-6 select-none">
                        <span className="ps-label">pronto pro</span>
                        <DomingoMark size="md" tone="laranja" />
                    </div>
                    <h1 className="font-bold text-ps-bone text-[40px] xl:text-[48px] mb-6 leading-[1.05] tracking-[-0.02em] text-balance">
                        Toda música, todo<br />domingo, na sua mão.
                    </h1>
                    <p className="text-ps-mut text-ps-md mb-10 leading-relaxed text-pretty">
                        Separe qualquer música em multitracks prontas. Pra sua equipe chegar pronta no próximo culto.
                    </p>

                    {/* Passos: o primeiro (onde a pessoa está) em laranja */}
                    <ol className="flex flex-col gap-2">
                        {STEPS.map((step, i) => (
                            <li
                                key={step}
                                className={`flex items-center gap-3 rounded-ps-lg px-4 py-3 inset-ring ${i === 0 ? 'bg-ps-or-soft text-ps-bone inset-ring-ps-or-line' : 'bg-ps-s1 text-ps-mut inset-ring-ps-line'}`}
                            >
                                <span className={`ps-num inline-flex size-8 shrink-0 items-center justify-center rounded-ps-md text-ps-base font-bold ${i === 0 ? 'bg-ps-or text-ps-on-or' : 'bg-ps-s3 text-ps-mut'}`}>{i + 1}</span>
                                <span className="text-ps-base font-semibold">{step}</span>
                            </li>
                        ))}
                    </ol>
                </div>

                <p className="relative z-10 ps-label text-center">Feito por quem toca.</p>
            </aside>

            {/* Coluna do formulário */}
            <main className="w-full lg:w-1/2 flex flex-col items-center px-ps-gutter py-8 sm:p-12">
                {/* Marca no topo, fora do lg (no fluxo, nunca por cima do formulário) */}
                <div className="w-full max-w-md mb-8 flex items-center lg:hidden">
                    <PlaybackStudioWordmark size="sm" tone="light" />
                </div>

                <Panel className="w-full max-w-md my-auto p-6 sm:p-8 flex flex-col gap-6">
                    <div className="text-center lg:text-left">
                        <h2 className="font-bold text-ps-bone text-[28px] leading-tight mb-2 tracking-[-0.01em]">{title}</h2>
                        <p className="text-ps-mut text-ps-base leading-snug text-pretty">{subtitle}</p>
                    </div>

                    {/* Google (fora do recuperar senha) */}
                    {mode !== 'forgot' && (
                        <>
                            <div className="flex flex-col">
                                <Button size="lg" onClick={handleGoogleLogin} icon={<GoogleLogo />}>
                                    Continuar com Google
                                </Button>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="h-px bg-ps-line flex-1"></div>
                                <span className="ps-label">ou</span>
                                <div className="h-px bg-ps-line flex-1"></div>
                            </div>
                        </>
                    )}

                    {error && <Notice tone="alert" role="alert">{error}</Notice>}
                    {/* A região status fica sempre na página (vazia, fora do fluxo pelo empty:absolute, sem
                        sobrar espaço) e só o texto entra nela: região que nasce já com o texto muitas
                        vezes não é lida pelo leitor de tela. */}
                    <div role="status" className="empty:absolute">{message ? <Notice>{message}</Notice> : null}</div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <TextField
                            label="Email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="seu@email.com"
                            icon={<Mail size={15} />}
                        />

                        {mode !== 'forgot' && (
                            <TextField
                                label="Senha"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Sua senha"
                                minLength={6}
                                icon={<Lock size={15} />}
                                trailing="mín 6"
                            />
                        )}

                        {/* Carregando: o texto fica (o nome do botão não some) e o ícone gira. */}
                        <Button
                            type="submit"
                            tone="primary"
                            size="lg"
                            disabled={loading}
                            icon={loading ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" /> : undefined}
                            className="mt-2"
                        >
                            {submitLabel}
                            {!loading && <ArrowRight size={16} aria-hidden="true" />}
                        </Button>
                    </form>

                    <div className="flex flex-col items-center gap-2 text-ps-base text-ps-mut">
                        {mode === 'login' ? (
                            <>
                                <Button tone="ghost" onClick={() => setMode('forgot')}>Esqueceu sua senha?</Button>
                                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                                    <span>Não tem conta?</span>
                                    <Button onClick={() => setMode('register')}>Criar conta</Button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                                <span>Já tem conta?</span>
                                <Button onClick={() => setMode('login')}>Entrar</Button>
                            </div>
                        )}
                    </div>
                </Panel>
            </main>
        </div>
    );
}
