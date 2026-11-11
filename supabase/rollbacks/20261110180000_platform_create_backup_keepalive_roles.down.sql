-- Desfaz 20261110180000_platform_create_backup_keepalive_roles.sql. EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento, depois de conferir que nenhuma exportacao em andamento usa o papel.
-- Remove os privilegios concedidos, os parametros de sessao e os dois papeis (que nao possuem objetos),
-- e tira a migracao do registro. Se um login ou senha tiver sido criado manualmente, o DROP ROLE o remove
-- junto: a falha por dependencia aborta a transacao inteira (nada e alterado pela metade).
begin;
revoke select on all sequences in schema app, billing, audit, ops, private from app_backup_reader;
revoke select on all tables in schema app, billing, audit, ops, private from app_backup_reader;
revoke usage on schema app, billing, audit, ops, private, extensions from app_backup_reader;
alter role app_backup_reader reset all;
alter role app_keepalive reset all;
drop role app_backup_reader;
drop role app_keepalive;
delete from ops.schema_migration where version = '20261110180000';
commit;
