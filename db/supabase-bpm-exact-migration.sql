-- ============================================================
-- BPM com decimais e compasso na nuvem (Parte 2, T23)
--
-- Aditiva e segura: só cria duas colunas que aceitam vazio. Nenhuma linha
-- muda e a coluna songs.bpm (inteira) continua sendo a que os apps antigos
-- leem e gravam. O app novo grava bpm e bpm_exact juntos (bpm = bpm_exact
-- arredondado; ver src/lib/cloudBpm.ts) e lê o exato só quando ele bate com o
-- inteiro, então uma edição feita por app antigo continua valendo.
--
-- Pode rodar mais de uma vez (IF NOT EXISTS). As policies de RLS da tabela
-- songs valem para as colunas novas: grava quem hoje já pode gravar o bpm.
--
-- ORDEM DE LANÇAMENTO: rodar no Supabase > SQL Editor ANTES de publicar o
-- app (web e desktop) e a API que gravam estas colunas. O app novo tolera o
-- banco sem elas (lê o inteiro e regrava sem as colunas novas), mas o BPM
-- decimal e o compasso só ficam salvos na nuvem depois desta migration.
-- ============================================================

-- aditiva e segura: apps antigos continuam lendo o bpm inteiro
alter table public.songs add column if not exists bpm_exact numeric(6,2) null check (bpm_exact is null or (bpm_exact > 0 and bpm_exact < 400));
alter table public.songs add column if not exists time_signature text null check (time_signature is null or time_signature in ('3/4','4/4','5/4','6/8','7/8','12/8'));

comment on column public.songs.bpm_exact is 'BPM com 2 casas. Vale só quando round(bpm_exact) = bpm; senão o app usa bpm (inteiro, lido pelos apps antigos).';
comment on column public.songs.time_signature is 'Compasso da música (3/4, 4/4, 5/4, 6/8, 7/8 ou 12/8). Vazio = não informado.';

-- Verificação
select column_name, data_type, numeric_precision, numeric_scale, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'songs'
  and column_name in ('bpm', 'bpm_exact', 'time_signature')
order by column_name;
