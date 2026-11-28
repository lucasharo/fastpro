-- Desfaz 20261113210000_geo_expand_discovery_requests.sql (Issue 36, H-023). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Remove as duas funcoes de descoberta e a linha de controle. Nenhum dado e tocado. Idempotente (if exists).
begin;

drop function if exists private.discover_requests(uuid, integer, smallint, integer, uuid);
drop function if exists private.discover_scan(uuid, double precision, double precision, integer, integer, smallint, integer, uuid, timestamptz);

delete from ops.schema_migration where version = '20261113210000';

commit;
