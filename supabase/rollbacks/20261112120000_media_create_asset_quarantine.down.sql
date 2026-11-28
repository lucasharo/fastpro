-- Desfaz 20261112120000_media_create_asset_quarantine.sql (H-026). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Recusa se houver fotos (app.media_asset) ou objetos no bucket quarantine: nada e apagado
-- com dado pendente. Remove funcoes, trigger e tabela, e tira a migracao do registro. O bucket vazio e
-- removido depois pela API do Storage (ver comentario abaixo).
-- Nao toca em request_draft nem nas funcoes draft_* de H-025.
begin;

do $$
begin
  if exists (select 1 from app.media_asset) then
    raise exception 'media_desfazer_recusado: ha fotos em app.media_asset' using errcode = 'P0001';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'quarantine') then
    raise exception 'media_desfazer_recusado: ha objetos no bucket quarantine' using errcode = 'P0001';
  end if;
end;
$$;

drop function if exists private.media_known(uuid[]);
drop function if exists private.media_purge_done(uuid[]);
drop function if exists private.media_sweep(timestamptz, integer);
drop function if exists private.media_finalize(text, uuid, integer, timestamptz);
drop function if exists private.media_get(text, uuid, timestamptz);
drop function if exists private.media_issue(text, uuid, text, integer, timestamptz, integer);
drop trigger if exists media_asset_limite on app.media_asset;
drop function if exists private.media_asset_limite();
drop table if exists app.media_asset;

-- O bucket 'quarantine' NAO e apagado aqui: o Supabase bloqueia DELETE direto em storage.buckets
-- ("Use the Storage API"). Depois deste arquivo, remover o bucket vazio pela API do Storage
-- (DELETE /storage/v1/bucket/quarantine, com a chave de servico do ambiente). Sem ele o bucket fica
-- privado e vazio, sem efeito sobre o restante do banco.

delete from ops.schema_migration where version = '20261112120000';

commit;
