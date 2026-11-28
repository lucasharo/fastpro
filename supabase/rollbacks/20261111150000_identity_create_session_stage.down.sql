-- Desfaz 20261111150000_identity_create_session_stage.sql (H-012). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove funcoes e as tabelas app.app_session e app.app_user (com
-- as sessoes e usuarios que existirem) e tira a migracao do registro.
begin;
drop function if exists private.app_session_purge(timestamptz);
drop function if exists private.app_session_open_stage(uuid, uuid, uuid, text, uuid, text, timestamptz);
drop function if exists private.app_user_ensure(text, uuid, timestamptz);
drop function if exists private.app_user_find(text);
drop table if exists app.app_session;
drop table if exists app.app_user;
delete from ops.schema_migration where version = '20261111150000';
commit;
