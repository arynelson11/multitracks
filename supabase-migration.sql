-- ============================================
-- Migração: corrigir acesso às tabelas songs e stems
-- Execute no Supabase > SQL Editor
-- ============================================

-- Adicionar coluna markers se não existir
ALTER TABLE songs ADD COLUMN IF NOT EXISTS markers JSONB DEFAULT NULL;

-- Remover TODAS as políticas existentes nas tabelas songs e stems
-- para limpar qualquer conflito
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies WHERE tablename = 'songs' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.songs', pol.policyname);
    END LOOP;

    FOR pol IN
        SELECT policyname FROM pg_policies WHERE tablename = 'stems' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.stems', pol.policyname);
    END LOOP;
END $$;

-- Desabilitar RLS nas tabelas de conteúdo público
-- (songs e stems são dados globais acessíveis a todos)
ALTER TABLE songs DISABLE ROW LEVEL SECURITY;
ALTER TABLE stems DISABLE ROW LEVEL SECURITY;

-- Verificar resultado
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('songs', 'stems') AND schemaname = 'public';
