-- Desfaz 20261111240000_admin_restrict_rbac_delete.sql (H-102). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Devolve o DELETE a app_system nas tres tabelas e tira a migracao do registro.
begin;
grant delete on app.admin_user_role, app.admin_invite, app.admin_session to app_system;
delete from ops.schema_migration where version = '20261111240000';
commit;
