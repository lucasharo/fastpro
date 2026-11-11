-- Desfaz 20261111180000_identity_create_active_session.sql (H-014). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as funcoes de sessao ativa, o indice e as restricoes novas,
-- e as colunas recent_auth_at e auth_method; tira a migracao do registro. Sessoes 'ativa' que existirem
-- ficam sem a prova recente (o estado de H-012 nao as conhece); a etapa de identificacao nao muda.
begin;
drop function if exists private.app_session_mark_recent_auth(uuid, timestamptz);
drop function if exists private.app_session_revoke_all(uuid, timestamptz);
drop function if exists private.app_session_revoke(uuid, timestamptz);
drop function if exists private.app_session_get(text, timestamptz);
drop function if exists private.app_session_convert(text, text, timestamptz);
alter table app.app_session drop constraint if exists app_session_ativa_consistente;
alter table app.app_session drop constraint if exists app_session_auth_method_valido;
drop index if exists app.app_session_secret_hash_uidx;
alter table app.app_session drop column if exists auth_method;
alter table app.app_session drop column if exists recent_auth_at;
delete from ops.schema_migration where version = '20261111180000';
commit;
