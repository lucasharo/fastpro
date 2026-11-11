-- Desfaz 20261111390000_geo_create_geocode_functions.sql (H-021). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Remove as funcoes de reserva, gravacao, sem resultado, liberacao, painel e cota, e
-- tira a migracao do registro. As tabelas (20261111370000) ficam; as linhas de ops.external_quota do servico
-- mapbox_permanent sao so contadores e nao sao apagadas (mesmo criterio do H-020).
begin;

drop function if exists private.geo_panel(timestamptz);
drop function if exists private.geo_release(uuid);
drop function if exists private.geo_mark_no_result(uuid, timestamptz);
drop function if exists private.geo_store_permanent(uuid, text, double precision, double precision, text, timestamptz);
drop function if exists private.geo_reserve(text, uuid, text, timestamptz, integer, integer, integer, integer);
drop function if exists private.mapbox_permanent_quota_take(timestamptz, integer, integer);

delete from ops.schema_migration where version = '20261111390000';

commit;
