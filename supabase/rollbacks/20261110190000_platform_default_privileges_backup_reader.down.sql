-- Desfaz 20261110190000_platform_default_privileges_backup_reader.sql. EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove apenas os privilegios padrao concedidos a app_backup_reader
-- para objetos FUTUROS (nao altera tabelas existentes) e tira a migracao do registro.
begin;
alter default privileges for role postgres in schema app, billing, audit, ops, private
  revoke select on tables from app_backup_reader;
alter default privileges for role postgres in schema app, billing, audit, ops, private
  revoke select on sequences from app_backup_reader;
delete from ops.schema_migration where version = '20261110190000';
commit;
