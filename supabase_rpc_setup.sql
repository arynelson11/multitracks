-- ============================================================
-- ADMIN DASHBOARD: Fetch stats directly from auth.users
-- 🔒 SECURITY HARDENED (C3) — antes: qualquer usuário autenticado
-- conseguia chamar e enumerar emails de todos os usuários.
-- Execute este script no SQL Editor do Supabase.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Bloqueia ataque de search_path em SECURITY DEFINER (CVE-class).
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_email text;
    -- Mantenha em sincronia com a lista de admins em src/App.tsx.
    -- TODO: migrar para uma coluna profiles.is_admin para evitar duplicação.
    admin_emails constant text[] := ARRAY['arynelson11@gmail.com', 'arynel11@gmail.com'];
BEGIN
    caller_email := auth.jwt() ->> 'email';
    IF caller_email IS NULL OR NOT (caller_email = ANY(admin_emails)) THEN
        RAISE EXCEPTION 'Unauthorized: admin access required'
            USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'totalUsers', (SELECT COUNT(*) FROM auth.users),
            'activeUsers', (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at >= (now() - interval '30 days')),
            'inactiveUsers', (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at < (now() - interval '30 days') OR last_sign_in_at IS NULL),
            'totalSongs', (SELECT COUNT(*) FROM public.songs),
            'totalTokensUsed', 0,
            'totalSubscribers', 0,
            'monthlyRevenue', 0,
            'users', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', u.id,
                        'email', u.email,
                        'display_name', u.raw_user_meta_data ->> 'full_name',
                        'provider', u.raw_app_meta_data ->> 'provider',
                        'created_at', u.created_at,
                        'last_sign_in_at', u.last_sign_in_at,
                        'is_active', (u.last_sign_in_at >= (now() - interval '30 days')),
                        'songs_count', 0,
                        'tokens_used', 0,
                        'plan', 'free'
                    )
                ) FROM auth.users u
            ), '[]'::jsonb)
        )
    );
END;
$$;

-- Lockdown: revoga acesso default, deixa só authenticated (que ainda passa
-- pelo gate de email dentro da função).
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

-- Verificação: deve listar apenas 'authenticated' como grantee.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name   = 'get_admin_dashboard_stats';
