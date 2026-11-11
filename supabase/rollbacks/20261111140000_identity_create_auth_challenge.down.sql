-- Desfaz 20261111140000_identity_create_auth_challenge.sql (H-011). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove funcoes e a tabela app.auth_challenge (com os desafios que
-- existirem) e tira a migracao do registro.
begin;
drop function if exists private.auth_challenge_purge(timestamptz);
drop function if exists private.auth_challenge_mark_delivered(uuid, timestamptz);
drop function if exists private.auth_challenge_verify_code(uuid, text, text, text, integer, timestamptz);
drop function if exists private.auth_challenge_consume_link(text, timestamptz);
drop function if exists private.auth_challenge_create(uuid, text, text, text, text, bytea, bytea, uuid, text, timestamptz);
drop function if exists private.auth_challenge_ativo_id(text, text, timestamptz);
drop function if exists private.auth_challenge_config(text, integer, integer, integer);
drop table if exists app.auth_challenge;
delete from ops.schema_migration where version = '20261111140000';
commit;
