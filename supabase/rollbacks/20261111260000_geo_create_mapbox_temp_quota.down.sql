-- Desfaz 20261111260000_geo_create_mapbox_temp_quota.sql (H-020). EXECUCAO MANUAL, so em dev.
-- Remove apenas a funcao de reserva. ops.external_quota e suas linhas nao sao apagadas (outros
-- servicos usam a tabela e as linhas do servico mapbox_geocoding_temp sao so contadores).
begin;
drop function if exists private.mapbox_temp_quota_take(timestamptz, integer, integer);
delete from ops.schema_migration where version = '20261111260000';
commit;
