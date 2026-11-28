-- Desfaz 20261111440000_draft_create_request_draft.sql (H-025). EXECUCAO MANUAL e consciente: so em banco
-- de desenvolvimento. Remove as quatro funcoes e a tabela (com os rascunhos que houver nela) e tira a
-- migracao do registro. Nao toca em app.service nem nas funcoes de limite (rl_check, rl_hit).
begin;

drop function if exists private.draft_discard(text, timestamptz);
drop function if exists private.draft_patch(text, timestamptz, integer, jsonb);
drop function if exists private.draft_create(text, text, timestamptz, integer, text, jsonb, integer);
drop function if exists private.draft_get(text, timestamptz);
drop table if exists app.request_draft;

delete from ops.schema_migration where version = '20261111440000';

commit;
