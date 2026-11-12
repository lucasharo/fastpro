-- Desfaz 20261112140000_media_expand_reduce_ready.sql (H-027, Issue #40). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Recusa se houver foto ja reduzida ou recusada (status ready ou rejected) ou objeto
-- no bucket request-photos: nada e apagado com dado de foto. Remove as funcoes novas, as restricoes e as oito
-- colunas novas de app.media_asset, e tira a migracao do registro. As funcoes e colunas da #39 nao sao tocadas.
-- O bucket 'request-photos' NAO e apagado aqui (o Supabase bloqueia DELETE direto em storage.buckets; mesmo
-- padrao do desfazer da #39). Depois deste arquivo, remover o bucket vazio pela API do Storage.
begin;

do $$
begin
  if exists (select 1 from app.media_asset where status in ('ready', 'rejected')) then
    raise exception 'media_desfazer_recusado: ha fotos ready ou rejected em app.media_asset' using errcode = 'P0001';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'request-photos') then
    raise exception 'media_desfazer_recusado: ha objetos no bucket request-photos' using errcode = 'P0001';
  end if;
end;
$$;

drop function if exists private.media_original_cleanup_list(integer);
drop function if exists private.media_original_removed(uuid, timestamptz);
drop function if exists private.media_reduce_release(uuid, smallint, boolean);
drop function if exists private.media_reduce_reject(uuid, smallint, text, timestamptz);
drop function if exists private.media_reduce_done(uuid, smallint, integer, integer, integer, timestamptz);
drop function if exists private.media_reduce_begin(text, uuid, timestamptz, integer);

alter table app.media_asset drop constraint if exists media_asset_ready_confirmed_ck;
alter table app.media_asset drop constraint if exists media_asset_reject_ck;
alter table app.media_asset drop constraint if exists media_asset_ready_solo_ck;
alter table app.media_asset drop constraint if exists media_asset_ready_ck;
alter table app.media_asset drop constraint if exists media_asset_attempts_ck;
alter table app.media_asset drop constraint if exists media_asset_reject_code_ck;
alter table app.media_asset drop constraint if exists media_asset_ready_dim_ck;
alter table app.media_asset drop constraint if exists media_asset_ready_bytes_ck;

alter table app.media_asset
  drop column if exists original_removed_at,
  drop column if exists reduce_attempts,
  drop column if exists reduce_lease_until,
  drop column if exists reject_code,
  drop column if exists ready_height,
  drop column if exists ready_width,
  drop column if exists ready_bytes,
  drop column if exists ready_at;

delete from ops.schema_migration where version = '20261112140000';

commit;
