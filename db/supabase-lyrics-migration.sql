    -- ============================================================
    -- Fase 4 (letra/cifra) — Playback Studio Live Mode
    -- Adiciona letra, letra sincronizada e cifra por música.
    -- Seguro de rodar mais de uma vez (IF NOT EXISTS).
    -- RLS já existente cobre estas colunas (SELECT público;
    -- mutações apenas admin/service_role — ver supabase-migration.sql).
    -- ============================================================

    -- Letra pura (documento corrido) — pode vir da busca automática (LRCLIB) ou ser editada.
    ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS lyrics        TEXT DEFAULT NULL;

    -- Letra sincronizada no formato LRC ([mm:ss.xx] linha) — habilita o auto-scroll no palco.
    ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS lyrics_synced TEXT DEFAULT NULL;

    -- Cifra (acordes sobre a letra) — colada/editada manualmente (sem fonte automática confiável).
    ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS chords        TEXT DEFAULT NULL;
