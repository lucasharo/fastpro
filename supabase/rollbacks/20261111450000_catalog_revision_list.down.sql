-- Desfaz 20261111450000_catalog_revision_list.sql (H-107, 81 §2). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove so a funcao de leitura do historico (nenhuma tabela ou grant de escrita foi criado) e
-- tira a migracao do registro. Nao toca em app.catalog_revision nem nas funcoes de escrita do catalogo.
begin;

drop function if exists private.catalog_revision_list(text, uuid);

delete from ops.schema_migration where version = '20261111450000';

commit;
