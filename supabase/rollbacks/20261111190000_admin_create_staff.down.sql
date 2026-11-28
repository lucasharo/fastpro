-- Desfaz 20261111190000_admin_create_staff.sql (H-102). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove a funcao de reserva, o gatilho e as tabelas
-- app.approval_vote, app.approval_request e app.admin_staff (com o que existir nelas) e tira a
-- migracao do registro. Nao toca em app.app_user nem nas funcoes de H-011/H-012/H-015.
begin;
drop function if exists private.admin_email_is_reserved(text);
drop table if exists app.approval_vote;
drop function if exists private.approval_vote_guard();
drop table if exists app.approval_request;
drop table if exists app.admin_staff;
delete from ops.schema_migration where version = '20261111190000';
commit;
