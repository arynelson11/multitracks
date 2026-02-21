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

-- Habilitar RLS (Row Level Security)
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stems ENABLE ROW LEVEL SECURITY;

-- Política: leitura pública (qualquer pessoa pode ver as músicas)
CREATE POLICY "Leitura pública de songs" ON songs FOR SELECT USING (true);
CREATE POLICY "Leitura pública de stems" ON stems FOR SELECT USING (true);

-- Política: escrita pública (para você poder inserir pelo dashboard)
-- Em produção, troque por autenticação
CREATE POLICY "Inserção livre de songs" ON songs FOR INSERT WITH CHECK (true);
CREATE POLICY "Update livre de songs" ON songs FOR UPDATE USING (true);
CREATE POLICY "Delete livre de songs" ON songs FOR DELETE USING (true);
CREATE POLICY "Inserção livre de stems" ON stems FOR INSERT WITH CHECK (true);
CREATE POLICY "Update livre de stems" ON stems FOR UPDATE USING (true);
CREATE POLICY "Delete livre de stems" ON stems FOR DELETE USING (true);

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

-- Remover políticas antigas se existirem para evitar conflitos
DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
DROP POLICY IF EXISTS "Public View" ON storage.objects;

-- Permitir que qualquer pessoa veja arquivos (Leitura Pública)
CREATE POLICY "Public View"
ON storage.objects FOR SELECT
USING ( bucket_id IN ('covers', 'stems') );

-- Permitir que qualquer pessoa faça Upload (Escrita Pública)
-- Em um app profissional, você usaria autenticação aqui.
CREATE POLICY "Public Upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id IN ('covers', 'stems') );

-- Permitir que qualquer pessoa atualize arquivos
CREATE POLICY "Public Update"
ON storage.objects FOR UPDATE
USING ( bucket_id IN ('covers', 'stems') );
