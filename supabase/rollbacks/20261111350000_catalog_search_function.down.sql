-- Desfaz 20261111350000_catalog_search_function.sql (H-019). EXECUCAO MANUAL, so em dev.
-- Remove so a funcao de busca; catalog_public_list e as tabelas do catalogo ficam como estao.
begin;
drop function if exists private.catalog_search(text);
delete from ops.schema_migration where version = '20261111350000';
commit;
