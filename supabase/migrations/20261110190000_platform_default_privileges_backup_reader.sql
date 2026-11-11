-- H-010 | Leitura futura do backup: tabelas e sequencias criadas pelo papel de migracao (postgres) nos
-- esquemas do produto ja nascem legiveis por app_backup_reader. Nao concede nada em objetos existentes
-- (isso e a 20261110180000) e nao muda os papeis. Sem isso, uma tabela nova ficaria fora do backup
-- ate alguem lembrar do grant (o teste T-BK-09 acusaria, mas so depois).
-- Desfazer: supabase/rollbacks/20261110190000_platform_default_privileges_backup_reader.down.sql

alter default privileges for role postgres in schema app, billing, audit, ops, private
  grant select on tables to app_backup_reader;
alter default privileges for role postgres in schema app, billing, audit, ops, private
  grant select on sequences to app_backup_reader;
