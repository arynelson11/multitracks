-- ============================================================
-- ADMIN DASHBOARD: Setup SQL para Supabase
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Criar tabela profiles (sincronizada com auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    provider TEXT,
    tokens_used INTEGER DEFAULT 0,
    songs_count INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    created_at TIMESTAMP WITH TIME ZONE,
    last_sign_in_at TIMESTAMP WITH TIME ZONE
);

-- 2. Habilitar RLS na tabela profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Política: qualquer usuário logado pode ler seu próprio perfil
CREATE POLICY "Users can read own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- 4. Política: admin pode ler todos os perfis
CREATE POLICY "Admin can read all profiles"
    ON public.profiles FOR SELECT
    USING (
        auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
    );

-- 5. Sincronizar usuários existentes do auth.users -> profiles
INSERT INTO public.profiles (id, email, display_name, provider, created_at, last_sign_in_at)
SELECT
    u.id,
    u.email,
    u.raw_user_meta_data ->> 'full_name',
    u.raw_app_meta_data ->> 'provider',
    u.created_at,
    u.last_sign_in_at
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    provider = EXCLUDED.provider,
    last_sign_in_at = EXCLUDED.last_sign_in_at;

-- 6. Trigger: auto-criar perfil quando novo usuário se cadastra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, provider, created_at, last_sign_in_at)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_app_meta_data ->> 'provider',
        NEW.created_at,
        NEW.last_sign_in_at
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        last_sign_in_at = EXCLUDED.last_sign_in_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dropar trigger se já existir e recriar
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Função RPC que retorna contagem de músicas por usuário (para futuro uso)
-- Pode expandir conforme a app evolui

-- 8. Verificação: listar todos os perfis inseridos
SELECT * FROM public.profiles ORDER BY created_at DESC;
