-- ============================================
-- 🔒 SECURITY HARDENING (C2): Habilitar RLS em songs e stems
-- ============================================
-- Antes: RLS desabilitada → qualquer cliente com a anon key (que está no
-- bundle JS público) podia INSERT/UPDATE/DELETE arbitrariamente no catálogo.
-- Depois: SELECT público; mutações apenas via admin (JWT email)
-- ou service_role (bypassa RLS por design — usado em /api/*).
--
-- Esta migração SUBSTITUI o ALTER TABLE ... DISABLE ROW LEVEL SECURITY
-- que existia aqui antes. Execute no Supabase > SQL Editor.
-- ============================================

-- 1. Colunas (mantidas idempotentes)
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS markers   JSONB   DEFAULT NULL;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS user_id   UUID    DEFAULT NULL;

-- 2. Habilita RLS
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stems ENABLE ROW LEVEL SECURITY;

-- 3. Limpa qualquer policy pré-existente para evitar conflitos
DO $$
DECLARE
    pol RECORD;
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['songs', 'stems']
    LOOP
        FOR pol IN
            SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = tbl
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
        END LOOP;
    END LOOP;
END $$;

-- 4. Policies de leitura: catálogo é público (anon e authenticated leem tudo)
CREATE POLICY songs_public_read
    ON public.songs FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY stems_public_read
    ON public.stems FOR SELECT
    TO anon, authenticated
    USING (true);

-- 5. Policies de escrita: apenas admins (gate por email no JWT).
-- service_role bypassa RLS automaticamente — endpoints /api/* não são afetados.
-- TODO: migrar para profiles.is_admin para evitar duplicação com supabase_rpc_setup.sql.
CREATE POLICY songs_admin_write
    ON public.songs FOR ALL
    TO authenticated
    USING       (auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'))
    WITH CHECK  (auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'));

CREATE POLICY stems_admin_write
    ON public.stems FOR ALL
    TO authenticated
    USING       (auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'))
    WITH CHECK  (auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'));

-- 6. Verificação (RLS songs/stems)
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('songs', 'stems');

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('songs', 'stems')
ORDER BY tablename, cmd;

-- ============================================
-- 🔒 SECURITY HARDENING (C6): Storage policies (covers, stems, samples, loops)
-- ============================================
-- Antes: "Public Upload"/"Public Update" → qualquer cliente sobrescrevia/subia
-- arquivos arbitrários. Depois: SELECT público; mutações apenas admin/service_role.
-- Pads usam Cloudflare R2 (fora do escopo destas policies).
-- ============================================

DROP POLICY IF EXISTS "Public Upload"     ON storage.objects;
DROP POLICY IF EXISTS "Public View"       ON storage.objects;
DROP POLICY IF EXISTS "Public Update"     ON storage.objects;
DROP POLICY IF EXISTS storage_public_read ON storage.objects;
DROP POLICY IF EXISTS storage_admin_write ON storage.objects;

CREATE POLICY storage_public_read
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (bucket_id IN ('covers', 'stems', 'samples', 'loops'));

CREATE POLICY storage_admin_write
    ON storage.objects FOR ALL
    TO authenticated
    USING      (bucket_id IN ('covers', 'stems', 'samples', 'loops')
                AND auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'))
    WITH CHECK (bucket_id IN ('covers', 'stems', 'samples', 'loops')
                AND auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com'));

-- Verificação (storage)
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd;

-- ============================================
-- 🔒 SECURITY HARDENING (C5): Cota atômica de separações
-- ============================================
-- Incrementa profiles.tokens_used em +1 SE estiver abaixo do limite.
-- Retorna TRUE se consumiu, FALSE se atingiu cota.
-- Atômico — sem race condition entre requests concorrentes.
-- Chamada apenas pelo backend via service_role (consumido em /api/separate-audio).
-- ============================================

CREATE OR REPLACE FUNCTION public.consume_separation_token(p_user_id UUID, p_limit INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    updated_rows INT;
BEGIN
    UPDATE public.profiles
       SET tokens_used = COALESCE(tokens_used, 0) + 1
     WHERE id = p_user_id
       AND COALESCE(tokens_used, 0) < p_limit;
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    RETURN updated_rows = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_separation_token(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_separation_token(UUID, INT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_separation_token(UUID, INT) TO service_role;

-- Reembolso caso o serviço externo (Replicate) falhe depois do consume.
CREATE OR REPLACE FUNCTION public.refund_separation_token(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE public.profiles
       SET tokens_used = GREATEST(COALESCE(tokens_used, 0) - 1, 0)
     WHERE id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_separation_token(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_separation_token(UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_separation_token(UUID) TO service_role;
