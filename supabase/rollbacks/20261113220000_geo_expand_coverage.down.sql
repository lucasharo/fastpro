-- Desfaz 20261113220000_geo_expand_coverage.sql (Issue 37, H-024). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Remove as funcoes de cobertura, as cinco funcoes puras, o indice de bases, a tabela de cache
-- e a linha de controle. Nenhum dado de origem e tocado. Idempotente (if exists).
begin;

drop function if exists private.coverage_for_request(uuid, uuid, text, timestamptz, integer, integer, integer);
drop function if exists private.coverage_take(text, integer, timestamptz);
drop function if exists private.coverage_exists(uuid, double precision, double precision, timestamptz);
drop function if exists private.discovery_serves(boolean, boolean, boolean, double precision, integer);
drop function if exists private.discovery_mod_onl(text, boolean);
drop function if exists private.discovery_mod_pres(text);
drop function if exists private.discovery_open(text, timestamptz, timestamptz);
drop function if exists private.discovery_dist_m(double precision, double precision, double precision, double precision);

drop index if exists app.geocode_point_match_cell_base_idx;
drop table if exists ops.coverage_cache;

delete from ops.schema_migration where version = '20261113220000';

commit;
