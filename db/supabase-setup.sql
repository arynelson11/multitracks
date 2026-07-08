-- ============================================
-- Multitracks Cloud Library - Supabase Setup
-- Execute este SQL no Supabase SQL Editor
-- ============================================

-- Tabela de músicas
CREATE TABLE songs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT DEFAULT '',
  key TEXT DEFAULT '',
  bpm INT DEFAULT 0,
  cover_url TEXT DEFAULT NULL,
  markers JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de stems (canais de áudio)
CREATE TABLE stems (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  "order" INT DEFAULT 0
);

-- Índices
CREATE INDEX idx_stems_song_id ON stems(song_id);
CREATE INDEX idx_songs_name ON songs(name);

-- 🔒 RLS habilitada com policies seguras — ver supabase-migration.sql
-- para os detalhes (SELECT público; mutações apenas admin/service_role).
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stems ENABLE ROW LEVEL SECURITY;

CREATE POLICY songs_public_read ON songs FOR SELECT
    TO anon, authenticated USING (true);
CREATE POLICY stems_public_read ON stems FOR SELECT
    TO anon, authenticated USING (true);

CREATE POLICY songs_admin_write ON songs FOR ALL TO authenticated
    USING      (auth.jwt() ->> 'email' = 'arynelson11@gmail.com')
    WITH CHECK (auth.jwt() ->> 'email' = 'arynelson11@gmail.com');
CREATE POLICY stems_admin_write ON stems FOR ALL TO authenticated
    USING      (auth.jwt() ->> 'email' = 'arynelson11@gmail.com')
    WITH CHECK (auth.jwt() ->> 'email' = 'arynelson11@gmail.com');

-- ============================================
-- Storage Buckets (criar pelo Dashboard > Storage)
-- ============================================
-- 1. Criar bucket "covers" → Tipo: Public
-- 2. Criar bucket "stems" → Tipo: Public
-- 
-- Depois faça upload dos arquivos pelo Dashboard:
-- - Capas: Storage > covers > upload
-- - Stems: Storage > stems > upload
--
-- Para pegar a URL pública de um arquivo:
-- https://SEU-PROJETO.supabase.co/storage/v1/object/public/covers/nome-da-imagem.jpg
-- https://SEU-PROJETO.supabase.co/storage/v1/object/public/stems/nome-do-audio.wav
--
-- ============================================
-- Exemplo de inserção
-- ============================================
-- 
-- INSERT INTO songs (name, artist, key, bpm, cover_url) VALUES
-- ('Grande é o Senhor', 'Adhemar de Campos', 'G', 72,
--  'https://SEU-PROJETO.supabase.co/storage/v1/object/public/covers/grande-e-o-senhor.jpg');
--
-- -- Pegue o ID da música inserida e use nos stems:
-- INSERT INTO stems (song_id, name, file_url, "order") VALUES
-- ('UUID-DA-MUSICA', 'Click', 'https://SEU-PROJETO.supabase.co/storage/v1/object/public/stems/click.wav', 1),
-- ('UUID-DA-MUSICA', 'Guia', 'https://SEU-PROJETO.supabase.co/storage/v1/object/public/stems/guia.wav', 2),
-- ('UUID-DA-MUSICA', 'Bass', 'https://SEU-PROJETO.supabase.co/storage/v1/object/public/stems/bass.wav', 3),
-- ============================================
-- Políticas de STORAGE (Importante para o Upload Funcionar)
-- ============================================

-- 🔒 SECURITY HARDENED (C6): SELECT público; INSERT/UPDATE/DELETE só admin.
-- service_role bypassa RLS por design — endpoints /api/* não são afetados.
-- Pads usam Cloudflare R2 (fora do escopo dessas policies).
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
                AND auth.jwt() ->> 'email' = 'arynelson11@gmail.com')
    WITH CHECK (bucket_id IN ('covers', 'stems', 'samples', 'loops')
                AND auth.jwt() ->> 'email' = 'arynelson11@gmail.com');
