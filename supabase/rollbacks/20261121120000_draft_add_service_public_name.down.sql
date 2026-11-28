-- Desfaz 20261121120000_draft_add_service_public_name.sql (Issue 159). EXECUCAO MANUAL, so em dev.
-- Remove so a funcao private.service_public_name; draft_get, draft_create e draft_patch ficam como estao.
begin;
drop function if exists private.service_public_name(uuid);
delete from ops.schema_migration where version = '20261121120000';
commit;
