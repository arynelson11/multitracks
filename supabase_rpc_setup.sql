-- ============================================================
-- ADMIN DASHBOARD: Fetch stats directly from auth.users
-- Execute este script no SQL Editor do Supabase
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
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
    );
$$;
