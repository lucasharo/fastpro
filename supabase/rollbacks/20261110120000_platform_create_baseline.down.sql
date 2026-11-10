-- Desfaz 20261110120000_platform_create_baseline.sql. EXECUCAO MANUAL e consciente: so rode em
-- banco de desenvolvimento. Falha de proposito se houver objetos de dominio nos esquemas
-- (nao usa CASCADE nos esquemas). Remova antes as migracoes posteriores.
begin;
delete from ops.schema_migration where version = '20261110120000';
revoke usage on schema extensions from app_api, app_system;
drop role if exists app_api;
drop role if exists app_system;
drop table if exists ops.schema_migration;
drop schema if exists private;
drop schema if exists audit;
drop schema if exists billing;
drop schema if exists app;
drop schema if exists ops;
drop extension if exists btree_gist;
drop extension if exists citext;
drop extension if exists unaccent;
drop extension if exists pg_trgm;
drop extension if exists postgis;
commit;
