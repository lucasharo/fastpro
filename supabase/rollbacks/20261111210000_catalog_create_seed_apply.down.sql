-- Desfaz 20261111210000_catalog_create_seed_apply.sql (H-018). EXECUCAO MANUAL e consciente, so em dev.
-- Remove as funcoes de validacao e aplicacao da semente. Nao apaga grupos, servicos nem sinonimos
-- ja inseridos (sao dados do catalogo; apagar exige decisao do dono). Tira a migracao do registro.
begin;
drop function if exists private.catalog_seed_apply(jsonb);
drop function if exists private.catalog_seed_validate(jsonb);
delete from ops.schema_migration where version = '20261111210000';
commit;
