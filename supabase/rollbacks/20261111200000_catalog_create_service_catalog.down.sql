-- Desfaz 20261111200000_catalog_create_service_catalog.sql (H-018). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Antes, desfazer 20261111180100_catalog_create_seed_apply (se aplicada).
-- Remove as tabelas do catalogo (com seus dados), a view e as funcoes; tira a migracao do registro.
-- NAO apaga linhas de audit.audit_event (append-only). Se existirem eventos catalog.* ja gravados,
-- a remocao das acoes em audit.action_catalog falha por chave estrangeira (restrict) e a transacao
-- inteira e desfeita: nesse caso o rollback nao e possivel sem descartar a auditoria, e a decisao e do dono.
begin;
drop view if exists app.catalog_public;
drop function if exists private.catalog_admin_list();
drop function if exists private.catalog_synonym_save(uuid, integer, jsonb);
drop function if exists private.catalog_service_save(uuid, integer, jsonb);
drop function if exists private.catalog_group_save(uuid, integer, jsonb);
drop function if exists private.catalog_fields_text(text[]);
drop function if exists private.catalog_patch_uuid(jsonb, text);
drop function if exists private.catalog_patch_position(jsonb, text);
drop function if exists private.catalog_patch_bool(jsonb, text);
drop function if exists private.catalog_patch_text(jsonb, text, integer, boolean);
drop function if exists private.catalog_patch_check(jsonb, text[]);
drop function if exists private.catalog_assert_admin();
drop table if exists app.catalog_seed_run;
drop table if exists app.catalog_revision;
drop table if exists app.service_synonym;
drop table if exists app.service;
drop table if exists app.service_group;
drop function if exists private.catalog_tg_service_invariant();
drop function if exists private.catalog_tg_group_invariant();
drop function if exists private.catalog_check_group(uuid);
drop function if exists private.catalog_norm(text);
delete from audit.action_catalog where action in (
  'catalog.group.changed', 'catalog.service.changed', 'catalog.synonym.changed', 'catalog.seed.applied');
delete from ops.schema_migration where version = '20261111200000';
commit;
