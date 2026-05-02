-- ============================================
-- Migração: corrigir RLS para stems e songs
-- Execute no Supabase > SQL Editor
-- ============================================

-- Adicionar coluna markers se não existir
ALTER TABLE songs ADD COLUMN IF NOT EXISTS markers JSONB DEFAULT NULL;

-- Garantir que RLS está habilitado (para segurança)
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stems ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas que possam conflitar
DROP POLICY IF EXISTS "Admin can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Admin can insert stems" ON public.stems;
DROP POLICY IF EXISTS "Admin can update songs" ON public.songs;
DROP POLICY IF EXISTS "Admin can delete songs" ON public.songs;
DROP POLICY IF EXISTS "Admin can delete stems" ON public.stems;
DROP POLICY IF EXISTS "Public can read songs" ON public.songs;
DROP POLICY IF EXISTS "Public can read stems" ON public.stems;

-- Leitura pública (qualquer usuário pode ver músicas e stems)
CREATE POLICY "Public can read songs"
ON public.songs FOR SELECT
USING (true);

CREATE POLICY "Public can read stems"
ON public.stems FOR SELECT
USING (true);

-- Admin pode inserir músicas
CREATE POLICY "Admin can insert songs"
ON public.songs FOR INSERT
WITH CHECK (
    auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
);

-- Admin pode inserir stems
CREATE POLICY "Admin can insert stems"
ON public.stems FOR INSERT
WITH CHECK (
    auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
);

-- Admin pode atualizar músicas
CREATE POLICY "Admin can update songs"
ON public.songs FOR UPDATE
USING (
    auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
);

-- Admin pode deletar músicas e stems
CREATE POLICY "Admin can delete songs"
ON public.songs FOR DELETE
USING (
    auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
);

CREATE POLICY "Admin can delete stems"
ON public.stems FOR DELETE
USING (
    auth.jwt() ->> 'email' IN ('arynelson11@gmail.com', 'arynel11@gmail.com')
);
