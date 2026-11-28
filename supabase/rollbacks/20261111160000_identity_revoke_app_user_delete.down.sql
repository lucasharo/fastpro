-- Desfaz 20261111160000_identity_revoke_app_user_delete.sql (H-012, revisao S-3). EXECUCAO MANUAL e
-- consciente: so em banco de desenvolvimento. Devolve o DELETE de app_user para app_system (estado da
-- 20261111150000) e tira a migracao do registro.
begin;
grant delete on app.app_user to app_system;
delete from ops.schema_migration where version = '20261111160000';
commit;
