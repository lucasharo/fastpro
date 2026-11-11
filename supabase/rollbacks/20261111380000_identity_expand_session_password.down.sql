-- Desfaz 20261111380000_identity_expand_session_password.sql (H-016). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Remove as sessoes por senha (sem desafio, que nao cabem no estado
-- anterior; as demais tabelas que referenciam app.app_session apagam em cascata), restaura challenge_id
-- obrigatorio e o CHECK de purpose de 150000, e tira a migracao do registro.
begin;
delete from app.app_session where purpose = 'password';
alter table app.app_session drop constraint if exists app_session_desafio_por_senha;
alter table app.app_session drop constraint if exists app_session_purpose_check;
alter table app.app_session add constraint app_session_purpose_check
  check (purpose in ('login', 'publish'));
alter table app.app_session alter column challenge_id set not null;
comment on column app.app_session.challenge_id is null;
delete from ops.schema_migration where version = '20261111380000';
commit;
