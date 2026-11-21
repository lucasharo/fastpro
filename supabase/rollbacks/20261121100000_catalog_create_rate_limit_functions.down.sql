-- Desfaz 20261121100000_catalog_create_rate_limit_functions.sql (Issue 156, F6). EXECUCAO MANUAL, so em dev.
-- Remove so as duas funcoes privadas do limite de taxa da busca; private.rl_check/rl_hit ficam como estao.
begin;
drop function if exists private.catalog_rate_check(text, integer, integer, integer, timestamptz);
drop function if exists private.catalog_rate_hit(text, integer, timestamptz);
delete from ops.schema_migration where version = '20261121100000';
commit;
